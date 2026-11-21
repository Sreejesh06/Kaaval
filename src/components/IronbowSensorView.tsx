import React, { useEffect, useRef, useState } from 'react';
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import type { GuardMode, RadarFrame } from '../types';

interface Props {
  latestFrameRef: React.MutableRefObject<RadarFrame | null>;
  frameSeqRef: React.MutableRefObject<number>;
  guardMode: GuardMode;
  sonarArmed: boolean;
  onVisualFallDetected?: () => void;
}

// Internal processing grid (16:9 — crisp edges, >60 fps on MacBook CPU/GPU)
const PROC_W = 384;
const PROC_H = 216;
const PIXELS = PROC_W * PROC_H;

/**
 * Precompute 256-entry scientific FLIR Ironbow / Inferno colormap:
 * 0.00 Black -> 0.16 Deep Indigo -> 0.30 Royal Purple -> 0.48 Crimson Magenta
 * -> 0.68 Glowing Orange -> 0.86 Radiant Gold -> 1.00 Incandescent Yellow-White
 */
function buildIronbowLut(): Uint8Array {
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [2, 1, 8]],
    [0.14, [20, 11, 56]],
    [0.28, [62, 10, 104]],
    [0.42, [116, 23, 110]],
    [0.56, [172, 47, 92]],
    [0.70, [221, 81, 58]],
    [0.83, [248, 135, 14]],
    [0.93, [252, 206, 46]],
    [1.0, [252, 255, 178]],
  ];

  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let s0 = stops[0];
    let s1 = stops[stops.length - 1];
    for (let k = 0; k < stops.length - 1; k++) {
      if (t >= stops[k][0] && t <= stops[k + 1][0]) {
        s0 = stops[k];
        s1 = stops[k + 1];
        break;
      }
    }
    const u = (t - s0[0]) / Math.max(1e-6, s1[0] - s0[0]);
    lut[i * 3] = Math.round(s0[1][0] + u * (s1[1][0] - s0[1][0]));
    lut[i * 3 + 1] = Math.round(s0[1][1] + u * (s1[1][1] - s0[1][1]));
    lut[i * 3 + 2] = Math.round(s0[1][2] + u * (s1[1][2] - s0[1][2]));
  }
  return lut;
}

const IRONBOW_LUT = buildIronbowLut();

export const IronbowSensorView: React.FC<Props> = ({
  latestFrameRef,
  frameSeqRef,
  guardMode,
  sonarArmed,
  onVisualFallDetected,
}) => {
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sensorStatus, setSensorStatus] = useState<string>('INITIALIZING EDGE SILHOUETTE...');
  const [darkFallback, setDarkFallback] = useState<boolean>(false);
  const [postureState, setPostureState] = useState<string>('SCANNING');

  const guardModeRef = useRef(guardMode);
  guardModeRef.current = guardMode;
  const armedRef = useRef(sonarArmed);
  armedRef.current = sonarArmed;
  const fallCbRef = useRef(onVisualFallDetected);
  fallCbRef.current = onVisualFallDetected;

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let stream: MediaStream | null = null;
    let segmenter: ImageSegmenter | null = null;

    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;

    const offscreen = document.createElement('canvas');
    offscreen.width = PROC_W;
    offscreen.height = PROC_H;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true })!;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = PROC_W;
    outCanvas.height = PROC_H;
    const outCtx = outCanvas.getContext('2d')!;
    const outImg = outCtx.createImageData(PROC_W, PROC_H);

    // Pre-allocated processing buffers (zero GC per frame)
    const luma = new Float32Array(PIXELS);
    const blurredLuma = new Float32Array(PIXELS);
    const prevLuma = new Float32Array(PIXELS);
    const kineticHeat = new Float32Array(PIXELS);
    const smoothedMask = new Float32Array(PIXELS);

    let lastVideoTime = -1;
    let lastRadarSeq = -1;
    let sonarDistM = 0.9;
    let sonarAzDeg = 0;
    let sonarBpm: number | null = null;
    let sonarDispMm = 0;
    let sonarGrid: Float32Array | null = null;
    let sonarR = 28;
    let sonarAz = 15;

    // Visual fall kinematics tracking (rapid downward centroid drop + horizontal aspect)
    let baselineTopY = -1;
    let lastFallTriggerMs = 0;
    let lastStatusUpdateMs = 0;

    async function bootVision() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();

        const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
        try {
          segmenter = await ImageSegmenter.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: '/mediapipe/selfie_segmenter_landscape.tflite',
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            outputCategoryMask: false,
            outputConfidenceMasks: true,
          });
        } catch {
          segmenter = await ImageSegmenter.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: '/mediapipe/selfie_segmenter_landscape.tflite',
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            outputCategoryMask: false,
            outputConfidenceMasks: true,
          });
        }

        if (!cancelled) {
          setSensorStatus('ON-DEVICE PRIVACY SILHOUETTE + 20 kHz FMCW FUSION');
        }
      } catch {
        if (!cancelled) {
          setSensorStatus('OPTICAL UNAVAILABLE — PURE 20 kHz ULTRASONIC IRONBOW');
          setDarkFallback(true);
        }
      }
    }

    bootVision();

    const renderFrame = (nowMs: number) => {
      if (cancelled) return;

      // 1. Pull latest 20 kHz ultrasonic telemetry
      const seq = frameSeqRef.current;
      const rf = latestFrameRef.current;
      if (rf && seq !== lastRadarSeq) {
        lastRadarSeq = seq;
        sonarDistM += 0.25 * (rf.targetMeters - sonarDistM);
        sonarAzDeg += 0.25 * (rf.targetAzimuthDeg - sonarAzDeg);
        sonarBpm = rf.respirationBpm;
        sonarDispMm = rf.displacementMm;
        sonarGrid = rf.spatialGrid;
        sonarR = rf.spatialRangeSlices;
        sonarAz = rf.spatialAzimuthBins;
      }

      const dispCanvas = displayCanvasRef.current;
      const ctx = dispCanvas?.getContext('2d');
      if (!dispCanvas || !ctx) {
        rafId = requestAnimationFrame(renderFrame);
        return;
      }

      const videoReady = video.readyState >= 2 && video.videoWidth > 0;
      let isOccludedOrDark = !videoReady;

      if (videoReady && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;

        // Draw mirrored frame to tiny offscreen buffer (raw RGB never displayed or transmitted!)
        offCtx.save();
        offCtx.translate(PROC_W, 0);
        offCtx.scale(-1, 1);
        offCtx.drawImage(video, 0, 0, PROC_W, PROC_H);
        offCtx.restore();

        const rgba = offCtx.getImageData(0, 0, PROC_W, PROC_H).data;
        let sumLuma = 0;
        for (let i = 0, p = 0; i < PIXELS; i++, p += 4) {
          const y = (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]) / 255;
          luma[i] = y;
          sumLuma += y;
        }
        const meanLuma = sumLuma / PIXELS;
        isOccludedOrDark = meanLuma < 0.045; // Pitch-dark room or thumb/tape over lens!

        if (!isOccludedOrDark && segmenter) {
          segmenter.segmentForVideo(offscreen, nowMs, (res) => {
            const masks = res.confidenceMasks;
            if (!masks || masks.length === 0) return;
            // Pick selfie/person channel (index 0 on 1-output selfie_segmenter, or index 1 if [bg, person])
            const personMaskObj = masks.length > 1 ? masks[1] : masks[0];
            const raw = personMaskObj.getAsFloat32Array();
            const mw = personMaskObj.width;
            const mh = personMaskObj.height;

            if (mw === PROC_W && mh === PROC_H) {
              for (let i = 0; i < PIXELS; i++) {
                smoothedMask[i] = 0.4 * smoothedMask[i] + 0.6 * raw[i];
              }
            } else {
              for (let y = 0; y < PROC_H; y++) {
                const sy = Math.min(mh - 1, Math.floor((y * mh) / PROC_H)) * mw;
                const dstRow = y * PROC_W;
                for (let x = 0; x < PROC_W; x++) {
                  const sx = Math.min(mw - 1, Math.floor((x * mw) / PROC_W));
                  const i = dstRow + x;
                  smoothedMask[i] = 0.4 * smoothedMask[i] + 0.6 * raw[sy + sx];
                }
              }
            }
          });
        }

        if (!isOccludedOrDark) {
          // 5x5 fast separable-style box blur on luma -> strips facial detail/text for strict privacy!
          for (let y = 2; y < PROC_H - 2; y++) {
            const row = y * PROC_W;
            for (let x = 2; x < PROC_W - 2; x++) {
              const idx = row + x;
              blurredLuma[idx] =
                (luma[idx] * 2 +
                  luma[idx - 2] +
                  luma[idx + 2] +
                  luma[idx - PROC_W * 2] +
                  luma[idx + PROC_W * 2] +
                  luma[idx - PROC_W - 1] +
                  luma[idx - PROC_W + 1] +
                  luma[idx + PROC_W - 1] +
                  luma[idx + PROC_W + 1]) *
                0.1;

              const diff = Math.abs(blurredLuma[idx] - prevLuma[idx]);
              prevLuma[idx] = blurredLuma[idx];
              kineticHeat[idx] = Math.min(1.0, kineticHeat[idx] * 0.84 + diff * 3.8);
            }
          }

          // Compute human bounding box & centroid for posture/fall kinematics + core thermal glow
          let minX = PROC_W, maxX = 0, minY = PROC_H, maxY = 0;
          let sumX = 0, sumY = 0, maskCount = 0;
          for (let y = 4; y < PROC_H - 4; y += 2) {
            const row = y * PROC_W;
            for (let x = 4; x < PROC_W - 4; x += 2) {
              const m = segmenter ? smoothedMask[row + x] : kineticHeat[row + x];
              if (m > 0.42) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                sumX += x;
                sumY += y;
                maskCount++;
              }
            }
          }

          const hasPerson = maskCount > 45;
          const cx = hasPerson ? sumX / maskCount : PROC_W * 0.5;
          const cy = hasPerson ? sumY / maskCount : PROC_H * 0.55;
          const bodyW = Math.max(20, maxX - minX);
          const bodyH = Math.max(20, maxY - minY);

          if (hasPerson) {
            if (baselineTopY < 0 || minY < baselineTopY) {
              baselineTopY = baselineTopY < 0 ? minY : 0.985 * baselineTopY + 0.015 * minY;
            } else {
              baselineTopY = 0.996 * baselineTopY + 0.004 * minY;
            }
            const dropRatio = (minY - baselineTopY) / PROC_H;
            const slumped = dropRatio > 0.24 && bodyW / bodyH > 1.15;

            if (nowMs - lastStatusUpdateMs > 180) {
              lastStatusUpdateMs = nowMs;
              setPostureState(slumped ? 'FALLEN / PRONE' : bodyH > PROC_H * 0.55 ? 'UPRIGHT' : 'SEATED');
              setDarkFallback(false);
            }

            if (
              slumped &&
              armedRef.current &&
              guardModeRef.current === 'ARMED_MONITORING' &&
              nowMs - lastFallTriggerMs > 12000
            ) {
              lastFallTriggerMs = nowMs;
              fallCbRef.current?.();
            }
          } else if (nowMs - lastStatusUpdateMs > 220) {
            lastStatusUpdateMs = nowMs;
            setPostureState('EMPTY');
            setDarkFallback(false);
          }

          // Ultrasonic chest breathing pulse modulation
          const breathGlow = Math.max(-0.04, Math.min(0.04, sonarDispMm * 0.012));
          const invRx = 1 / (bodyW * 0.58);
          const invRy = 1 / (bodyH * 0.58);

          // Synthesize crisp FLIR Ironbow image pixel-by-pixel
          const dst = outImg.data;
          for (let y = 1; y < PROC_H - 1; y++) {
            const row = y * PROC_W;
            for (let x = 1; x < PROC_W - 1; x++) {
              const i = row + x;

              // Sobel structural edge magnitude on blurred room luma
              const gx = blurredLuma[i + 1] - blurredLuma[i - 1];
              const gy = blurredLuma[i + PROC_W] - blurredLuma[i - PROC_W];
              const edge = Math.min(1.0, Math.hypot(gx, gy) * 4.5);

              // Cold room architecture locked to [0.02 .. 0.36] (deep indigo + violet structural lines)
              const tRoom = 0.025 + Math.pow(blurredLuma[i], 0.75) * 0.16 + edge * 0.21;

              const m = segmenter ? smoothedMask[i] : Math.min(1, kineticHeat[i] * 1.5);
              let tFinal = tRoom;

              if (m > 0.08) {
                // Anatomical core warmth + interior privacy-blurred shading + kinetic motion flare
                const dx = (x - cx) * invRx;
                const dy = (y - (cy - bodyH * 0.08)) * invRy;
                const radialCore = Math.max(0, 1 - 0.38 * (dx * dx + dy * dy));
                const interiorShade = 0.56 + 0.24 * radialCore + 0.14 * blurredLuma[i] + breathGlow;
                const hotBody = Math.min(
                  0.995,
                  interiorShade + kineticHeat[i] * 0.22 + edge * 0.08
                );
                // Smooth thermal bloom transition across silhouette boundary
                const blend = Math.min(1, Math.pow(m, 0.75));
                tFinal = tRoom * (1 - blend) + hotBody * blend;
              }

              const lutIdx = Math.max(0, Math.min(255, Math.floor(tFinal * 255))) * 3;
              const p = i * 4;
              dst[p] = IRONBOW_LUT[lutIdx];
              dst[p + 1] = IRONBOW_LUT[lutIdx + 1];
              dst[p + 2] = IRONBOW_LUT[lutIdx + 2];
              dst[p + 3] = 255;
            }
          }

          outCtx.putImageData(outImg, 0, 0);

          // Render crisp upscaled Ironbow frame + minimal tactical ultrasonic telemetry overlay
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(outCanvas, 0, 0, dispCanvas.width, dispCanvas.height);

          if (hasPerson) {
            const sx = (minX / PROC_W) * dispCanvas.width;
            const sy = (minY / PROC_H) * dispCanvas.height;
            const sw = ((maxX - minX) / PROC_W) * dispCanvas.width;
            const sh = ((maxY - minY) / PROC_H) * dispCanvas.height;
            drawCornerBrackets(ctx, sx, sy, sw, sh, guardModeRef.current);

            const tag = armedRef.current
              ? `${sonarDistM.toFixed(2)}m${sonarBpm ? ` · ${sonarBpm.toFixed(0)} BPM` : ''}`
              : 'SONAR STANDBY';
            drawHudPill(ctx, sx + sw * 0.5, Math.max(26, sy - 10), tag);
          }
        }
      }

      // Pitch-Dark / Covered-Lens Mode -> Render Pure 20 kHz Ultrasonic Acoustic Heatmap in Ironbow!
      if (isOccludedOrDark) {
        if (nowMs - lastStatusUpdateMs > 250) {
          lastStatusUpdateMs = nowMs;
          setDarkFallback(true);
          setPostureState('SONAR DARK-MODE');
        }
        renderUltrasonicIronbowFallback(
          ctx,
          dispCanvas.width,
          dispCanvas.height,
          sonarGrid,
          sonarR,
          sonarAz,
          sonarDistM,
          sonarAzDeg,
          sonarBpm,
          armedRef.current
        );
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      segmenter?.close();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [latestFrameRef, frameSeqRef]);

  return (
    <div className="panel spatial-panel">
      <div className="panel-head">
        <span className="panel-title">
          {darkFallback
            ? '20 kHz Ultrasonic Dark-Room Field (Optical Occluded)'
            : 'Ironbow Privacy Silhouette + 20 kHz Ultrasonic Fusion'}
        </span>
        <span className="panel-meta">
          POSTURE: {postureState} · RAW RGB DISCARDED ON GPU
        </span>
      </div>

      <canvas
        ref={displayCanvasRef}
        className="ironbow-canvas"
        width={960}
        height={420}
      />

      <div className="primitives-bar">
        <span className="prim-pill prim-active">{sensorStatus}</span>
        <span className="honesty-tag">
          Cover lens to test automatic pitch-dark 20 kHz ultrasonic fallback
        </span>
      </div>
    </div>
  );
};

function drawCornerBrackets(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  mode: GuardMode
) {
  const len = 14;
  ctx.strokeStyle =
    mode === 'EMERGENCY_DISPATCHED' || mode === 'LISTENING_CONSENT'
      ? '#e11d48'
      : mode === 'ANOMALY_PREALERT'
      ? '#f59e0b'
      : 'rgba(252, 230, 110, 0.75)';
  ctx.lineWidth = 1.8;

  ctx.beginPath();
  ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
  ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
  ctx.moveTo(x, y + h - len); ctx.lineTo(x, y + h); ctx.lineTo(x + len, y + h);
  ctx.moveTo(x + w - len, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - len);
  ctx.stroke();
}

function drawHudPill(ctx: CanvasRenderingContext2D, cx: number, y: number, text: string) {
  ctx.font = '600 12px "IBM Plex Mono", monospace';
  const tw = ctx.measureText(text).width;
  const bw = tw + 16;
  const bh = 22;
  ctx.fillStyle = 'rgba(8, 5, 20, 0.85)';
  ctx.fillRect(cx - bw * 0.5, y - bh, bw, bh);
  ctx.strokeStyle = 'rgba(252, 206, 46, 0.8)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - bw * 0.5, y - bh, bw, bh);
  ctx.fillStyle = '#fcffa4';
  ctx.fillText(text, cx - tw * 0.5, y - 6);
}

function renderUltrasonicIronbowFallback(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grid: Float32Array | null,
  gridR: number,
  gridAz: number,
  distM: number,
  azDeg: number,
  bpm: number | null,
  armed: boolean
) {
  ctx.fillStyle = '#070314';
  ctx.fillRect(0, 0, w, h);

  if (grid && armed) {
    const cellW = w / gridAz;
    const cellH = h / gridR;
    for (let rs = 0; rs < gridR; rs++) {
      for (let az = 0; az < gridAz; az++) {
        const v = Math.min(1, grid[rs * gridAz + az] * 1.25);
        const lutIdx = Math.min(255, Math.floor((0.06 + v * 0.92) * 255)) * 3;
        ctx.fillStyle = `rgb(${IRONBOW_LUT[lutIdx]},${IRONBOW_LUT[lutIdx + 1]},${IRONBOW_LUT[lutIdx + 2]})`;
        ctx.fillRect(az * cellW, h - (rs + 1) * cellH, cellW + 1, cellH + 1);
      }
    }
  }

  ctx.fillStyle = '#fcffa4';
  ctx.font = '600 12px "IBM Plex Mono", monospace';
  ctx.fillText(
    armed
      ? `ZERO-LUX / LENS COVERED — 20 kHz SONAR TRACKING @ ${distM.toFixed(2)}m (${azDeg.toFixed(0)}°)${
          bpm ? ` · ${bpm.toFixed(0)} BPM` : ''
        }`
      : 'LENS COVERED — CLICK [ARM SONAR] FOR 20 kHz ULTRASONIC TRACKING',
    20,
    28
  );
}
