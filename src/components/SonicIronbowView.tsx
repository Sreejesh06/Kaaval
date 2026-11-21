import React, { useEffect, useRef, useState } from 'react';
import type { GuardMode, RadarFrame } from '../types';

interface Props {
  latestFrameRef: React.MutableRefObject<RadarFrame | null>;
  frameSeqRef: React.MutableRefObject<number>;
  guardMode: GuardMode;
  sonarArmed: boolean;
  snapshotGetterRef?: React.MutableRefObject<(() => string | undefined) | null>;
}

const GRID_W = 360;
const GRID_H = 202;
const PIXELS = GRID_W * GRID_H;

function buildIronbowLut(): Uint8Array {
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [2, 1, 8]],
    [0.14, [20, 10, 56]],
    [0.28, [64, 10, 106]],
    [0.42, [118, 23, 110]],
    [0.56, [174, 48, 91]],
    [0.70, [223, 82, 56]],
    [0.83, [249, 138, 14]],
    [0.93, [252, 208, 48]],
    [1.0, [253, 255, 182]],
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

function sampleBilinear(
  grid: Float32Array,
  rows: number,
  cols: number,
  rNorm: number,
  cNorm: number
): number {
  const rf = Math.max(0, Math.min(rows - 1.001, rNorm * (rows - 1)));
  const cf = Math.max(0, Math.min(cols - 1.001, cNorm * (cols - 1)));
  const r0 = Math.floor(rf);
  const c0 = Math.floor(cf);
  const dr = rf - r0;
  const dc = cf - c0;
  const i00 = grid[r0 * cols + c0];
  const i01 = grid[r0 * cols + c0 + 1];
  const i10 = grid[(r0 + 1) * cols + c0];
  const i11 = grid[(r0 + 1) * cols + c0 + 1];
  return (i00 * (1 - dc) + i01 * dc) * (1 - dr) + (i10 * (1 - dc) + i11 * dc) * dr;
}

/**
 * Smooth multi-lobe acoustic human scattering envelope in screen space:
 * Evaluates head, shoulders, breathing thoracic core, torso, and lower body (upright vs fallen)
 * strictly from measured ultrasonic distance, stereo azimuth, IQ chest phase, and motion energy.
 */
function humanAcousticField(
  px: number,
  py: number,
  cx: number,
  footY: number,
  scale: number,
  collapsed: number,
  breathBoost: number
): number {
  // Interpolate anatomical scattering centers between upright (0) and horizontal fallen (1)
  const c = collapsed;
  const headX = cx + c * 46 * scale;
  const headY = footY - (1 - c) * 92 * scale - c * 14 * scale;

  const chestX = cx + c * 22 * scale;
  const chestY = footY - (1 - c) * 62 * scale - c * 13 * scale;

  const shLX = cx - (1 - c) * 19 * scale + c * 18 * scale;
  const shRX = cx + (1 - c) * 19 * scale + c * 26 * scale;
  const shY = footY - (1 - c) * 68 * scale - c * 16 * scale;

  const hipX = cx - c * 8 * scale;
  const hipY = footY - (1 - c) * 34 * scale - c * 11 * scale;

  const legLX = cx - (1 - c) * 8 * scale - c * 32 * scale;
  const legRX = cx + (1 - c) * 8 * scale - c * 28 * scale;
  const legY = footY - (1 - c) * 14 * scale - c * 10 * scale;

  const g = (x0: number, y0: number, rx: number, ry: number, w: number) => {
    const dx = (px - x0) / Math.max(2, rx * scale);
    const dy = (py - y0) / Math.max(2, ry * scale);
    const d2 = dx * dx + dy * dy;
    return d2 > 7 ? 0 : w * Math.exp(-0.5 * d2);
  };

  // Sum smooth Gaussian scattering lobes -> produces organic FLIR-like silhouette + bloom
  const val =
    g(headX, headY, 10.5, 12.5, 0.86) +
    g(chestX, chestY, 16.5 + breathBoost * 25, 20.0 + breathBoost * 20, 0.94 + breathBoost) +
    g(shLX, shY, 11.0, 13.0, 0.52) +
    g(shRX, shY, 11.0, 13.0, 0.52) +
    g(hipX, hipY, 14.5, 17.0, 0.72) +
    g(legLX, legY, 7.5, 16.0, 0.54) +
    g(legRX, legY, 7.5, 16.0, 0.54);

  return Math.min(1.05, val);
}

export const SonicIronbowView: React.FC<Props> = ({
  latestFrameRef,
  frameSeqRef,
  guardMode,
  sonarArmed,
  snapshotGetterRef,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [readout, setReadout] = useState({
    occupied: false,
    distM: 0.9,
    azDeg: 0,
    bpm: null as number | null,
    stereo: true,
  });

  const guardModeRef = useRef(guardMode);
  guardModeRef.current = guardMode;
  const armedRef = useRef(sonarArmed);
  armedRef.current = sonarArmed;

  useEffect(() => {
    if (!snapshotGetterRef) return;
    snapshotGetterRef.current = () => {
      const src = canvasRef.current;
      if (!src) return undefined;
      const thumb = document.createElement('canvas');
      thumb.width = 192;
      thumb.height = 108;
      const tCtx = thumb.getContext('2d');
      if (!tCtx) return undefined;
      tCtx.drawImage(src, 0, 0, 192, 108);
      return thumb.toDataURL('image/jpeg', 0.72);
    };
    return () => {
      snapshotGetterRef.current = null;
    };
  }, [snapshotGetterRef]);

  useEffect(() => {
    let rafId = 0;
    let lastSeq = -1;
    let lastHudMs = 0;

    const offCanvas = document.createElement('canvas');
    offCanvas.width = GRID_W;
    offCanvas.height = GRID_H;
    const offCtx = offCanvas.getContext('2d')!;
    const imgData = offCtx.createImageData(GRID_W, GRID_H);
    const persistence = new Float32Array(PIXELS);

    const state = {
      distM: 1.05,
      azDeg: 0,
      dispMm: 0,
      bpm: null as number | null,
      presence: 0,
      motion: 0,
      visAlpha: 0,
      collapsed: 0,
      grid: null as Float32Array | null,
      ambient: null as Float32Array | null,
      directMag: 1,
      metersPerSample: 0.0036,
      gridR: 28,
      gridAz: 15,
    };

    const render = (nowMs: number) => {
      const seq = frameSeqRef.current;
      const rf = latestFrameRef.current;
      if (rf && seq !== lastSeq) {
        lastSeq = seq;
        state.distM += 0.22 * (Math.max(0.48, rf.targetMeters) - state.distM);
        state.azDeg += 0.22 * (rf.targetAzimuthDeg - state.azDeg);
        state.dispMm = rf.displacementMm;
        state.bpm = rf.respirationBpm;
        state.presence = rf.presenceRatio;
        state.motion = rf.motionEnergy;
        state.grid = rf.spatialGrid;
        state.ambient = rf.ambientClutterProfile;
        state.directMag = rf.directMag;
        state.metersPerSample = rf.metersPerSample;
        state.gridR = rf.spatialRangeSlices;
        state.gridAz = rf.spatialAzimuthBins;

        if (nowMs - lastHudMs > 160) {
          lastHudMs = nowMs;
          setReadout({
            occupied: rf.presenceRatio > 0.22 || rf.motionEnergy > 0.42,
            distM: state.distM,
            azDeg: state.azDeg,
            bpm: state.bpm,
            stereo: rf.stereoActive,
          });
        }
      }

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) {
        rafId = requestAnimationFrame(render);
        return;
      }

      const armed = armedRef.current;
      const mode = guardModeRef.current;
      const occupiedTarget =
        armed && (state.presence > 0.20 || state.motion > 0.38 || mode !== 'ARMED_MONITORING')
          ? 1.0
          : 0.0;
      state.visAlpha += 0.14 * (occupiedTarget - state.visAlpha);

      const fallenTarget =
        mode === 'PLAYING_PROMPT' ||
        mode === 'LISTENING_CONSENT' ||
        mode === 'TRIAGING_RESPONSE' ||
        mode === 'EMERGENCY_DISPATCHED'
          ? 1.0
          : 0.0;
      state.collapsed += 0.12 * (fallenTarget - state.collapsed);

      // Perspective room horizon @ 38% height; floor spans y = horizonY .. GRID_H (3.0m -> 0.48m)
      const horizonY = Math.floor(GRID_H * 0.38);
      const normDist = Math.max(0, Math.min(1, (state.distM - 0.48) / (3.0 - 0.48)));
      // Nearer subject (0.55m) sits lower & larger in foreground; farther (2.5m) sits near horizon & smaller
      const footY = GRID_H - 12 - normDist * (GRID_H - horizonY - 22);
      const perspScale = 1.38 / (0.65 + normDist * 1.45);
      const cx = GRID_W * (0.5 + (state.azDeg / 115) * 0.85);
      const breathMod = Math.max(-0.06, Math.min(0.06, state.dispMm * 0.016));
      const motionFlare = Math.min(0.22, state.motion * 0.06);

      const dst = imgData.data;
      const ambNorm = 1 / (state.directMag * 0.55 + 1e-6);

      for (let y = 0; y < GRID_H; y++) {
        const rowOff = y * GRID_W;
        const isFloor = y >= horizonY;
        // Map vertical row to room depth rNorm in [0 (near 0.48m) .. 1 (far 3.0m)]
        const rNorm = isFloor
          ? 1.0 - (y - horizonY) / Math.max(1, GRID_H - 1 - horizonY)
          : 1.0;
        const depthMeters = 0.48 + rNorm * 2.52;

        // Real static room echo at this range (walls/furniture reflection in cold indigo/violet)
        let ambEcho = 0.08;
        if (armed && state.ambient) {
          const bin = Math.min(
            state.ambient.length - 1,
            Math.floor(depthMeters / state.metersPerSample)
          );
          ambEcho = Math.min(0.28, state.ambient[bin] * ambNorm);
        }

        // Back/side wall architectural subtle cold gradient above horizon
        const wallVert = !isFloor ? (horizonY - y) / horizonY : 0;

        for (let x = 0; x < GRID_W; x++) {
          const i = rowOff + x;
          const xSigned = (x / (GRID_W - 1)) * 2 - 1; // -1 .. +1

          // 1. Cold room acoustic background (strictly [0.03 .. 0.34] indigo/royal-purple)
          const sideWallCue = Math.pow(Math.abs(xSigned), 2.4) * 0.11;
          let tCold = 0.035 + ambEcho * 0.72 + sideWallCue - wallVert * 0.04;

          // 2. Real bilinearly-interpolated 2D polar ultrasonic energy plume on floor/space
          let plume = 0;
          if (armed && state.grid) {
            const azNorm = (xSigned / Math.max(0.35, 1 - rNorm * 0.32) + 1) * 0.5;
            if (azNorm >= 0 && azNorm <= 1) {
              const rawCell = sampleBilinear(
                state.grid,
                state.gridR,
                state.gridAz,
                rNorm,
                azNorm
              );
              plume = isFloor ? rawCell * 0.48 : rawCell * Math.exp(-wallVert * 3.2) * 0.32;
            }
          }

          // 3. Acoustic human presence field at measured (targetMeters, targetAzimuthDeg)
          let humanHeat = 0;
          if (state.visAlpha > 0.02) {
            const hField = humanAcousticField(
              x,
              y,
              cx,
              footY,
              perspScale,
              state.collapsed,
              breathMod
            );
            if (hField > 0.01) {
              humanHeat = state.visAlpha * Math.min(1.0, hField * (0.86 + motionFlare));
            }
          }

          const rawTarget = Math.min(0.995, Math.max(tCold + plume * 0.45, tCold * (1 - humanHeat) + humanHeat * 0.96));
          // Smooth temporal thermal persistence (gives organic FLIR sensor response)
          const tSmooth = 0.58 * persistence[i] + 0.42 * rawTarget;
          persistence[i] = tSmooth;

          const lutIdx = Math.max(0, Math.min(255, Math.floor(tSmooth * 255))) * 3;
          const p = i * 4;
          dst[p] = IRONBOW_LUT[lutIdx];
          dst[p + 1] = IRONBOW_LUT[lutIdx + 1];
          dst[p + 2] = IRONBOW_LUT[lutIdx + 2];
          dst[p + 3] = 255;
        }
      }

      offCtx.putImageData(imgData, 0, 0);

      const W = canvas.width;
      const H = canvas.height;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(offCanvas, 0, 0, W, H);

      // Subtle architectural room perspective wireframe overlay (cold violet lines like FLIR room edges)
      drawRoomPerspectiveGuides(ctx, W, H, (horizonY / GRID_H) * H);

      // Target reticle & ultrasonic telemetry badge
      if (state.visAlpha > 0.25) {
        const dispCx = (cx / GRID_W) * W;
        const dispFootY = (footY / GRID_H) * H;
        const boxW = (state.collapsed > 0.5 ? 190 : 108) * perspScale;
        const boxH = (state.collapsed > 0.5 ? 74 : 235) * perspScale;
        drawReticle(
          ctx,
          dispCx - boxW * 0.5,
          dispFootY - boxH,
          boxW,
          boxH,
          mode
        );

        const label = `${state.distM.toFixed(2)}m · ${state.azDeg >= 0 ? '+' : ''}${state.azDeg.toFixed(0)}°${
          state.bpm ? ` · ${state.bpm.toFixed(0)} BPM` : ''
        }`;
        drawCallout(ctx, dispCx, Math.max(30, dispFootY - boxH - 8), label);
      } else if (!armed) {
        ctx.fillStyle = 'rgba(8, 4, 20, 0.72)';
        ctx.fillRect(W * 0.5 - 220, H * 0.5 - 22, 440, 40);
        ctx.strokeStyle = '#74176e';
        ctx.strokeRect(W * 0.5 - 220, H * 0.5 - 22, 440, 40);
        ctx.fillStyle = '#fcffa4';
        ctx.font = '600 12px "IBM Plex Mono", monospace';
        ctx.fillText('CLICK [ARM SONAR] — 100% ACOUSTIC IRONBOW (CAMERA OFF)', W * 0.5 - 202, H * 0.5 + 3);
      }

      // Right-edge FLIR Ironbow dB Colorbar
      drawColorbar(ctx, W, H);

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [latestFrameRef, frameSeqRef]);

  return (
    <div className="panel spatial-panel">
      <div className="panel-head">
        <span className="panel-title">Sonic Ironbow Imager (17.6–20.2 kHz Stereo Ultrasound)</span>
        <span className="panel-meta">
          CAMERA: OFF (HARDWARE LED DARK) ·{' '}
          {readout.occupied
            ? `${readout.distM.toFixed(2)}m · ${readout.azDeg >= 0 ? '+' : ''}${readout.azDeg.toFixed(0)}°`
            : 'QUIET CABIN'}
        </span>
      </div>

      <canvas ref={canvasRef} className="ironbow-canvas" width={960} height={500} />

      <div className="primitives-bar">
        <span className="prim-pill prim-active">
          ZERO OPTICAL SENSORS · PURE ACOUSTIC BACKPROJECTION
        </span>
        <span className="honesty-tag">
          Cold Indigo: Static Room Clutter · Gold/White: Human Echo + IQ Chest Phase
        </span>
      </div>
    </div>
  );
};

function drawRoomPerspectiveGuides(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  hy: number
) {
  ctx.strokeStyle = 'rgba(130, 55, 165, 0.24)';
  ctx.lineWidth = 1;

  // Back wall horizon & corner rays
  const marginX = w * 0.16;
  ctx.strokeRect(marginX, h * 0.08, w - marginX * 2 - 34, hy - h * 0.08);
  ctx.beginPath();
  ctx.moveTo(marginX, hy); ctx.lineTo(0, h);
  ctx.moveTo(w - marginX - 34, hy); ctx.lineTo(w - 34, h);
  ctx.stroke();

  // Metric depth lines along floor (0.5m .. 2.5m)
  ctx.fillStyle = 'rgba(195, 145, 220, 0.55)';
  ctx.font = '10px "IBM Plex Mono", monospace';
  for (const m of [0.6, 1.0, 1.5, 2.0, 2.5]) {
    const rNorm = (m - 0.48) / 2.52;
    const y = h - rNorm * (h - hy);
    const spread = 1 - rNorm * 0.68;
    const xL = (w - 34) * 0.5 * (1 - spread);
    const xR = (w - 34) * 0.5 * (1 + spread);
    ctx.beginPath();
    ctx.moveTo(xL, y);
    ctx.lineTo(xR, y);
    ctx.stroke();
    ctx.fillText(`${m.toFixed(1)}m`, xR + 4, y + 3);
  }
}

function drawReticle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  mode: GuardMode
) {
  const c = 12;
  ctx.strokeStyle =
    mode === 'EMERGENCY_DISPATCHED' || mode === 'LISTENING_CONSENT'
      ? '#e11d48'
      : mode === 'ANOMALY_PREALERT'
      ? '#f59e0b'
      : 'rgba(253, 255, 182, 0.78)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
  ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c);
  ctx.moveTo(x, y + h - c); ctx.lineTo(x, y + h); ctx.lineTo(x + c, y + h);
  ctx.moveTo(x + w - c, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - c);
  ctx.stroke();
}

function drawCallout(ctx: CanvasRenderingContext2D, cx: number, y: number, text: string) {
  ctx.font = '600 11px "IBM Plex Mono", monospace';
  const tw = ctx.measureText(text).width;
  const bw = tw + 16;
  const bh = 21;
  ctx.fillStyle = 'rgba(10, 4, 24, 0.86)';
  ctx.fillRect(cx - bw * 0.5, y - bh, bw, bh);
  ctx.strokeStyle = '#fcd030';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - bw * 0.5, y - bh, bw, bh);
  ctx.fillStyle = '#fdffb6';
  ctx.fillText(text, cx - tw * 0.5, y - 6);
}

function drawColorbar(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const barX = w - 22;
  const barY = 18;
  const barH = h - 36;
  for (let i = 0; i < barH; i++) {
    const t = 1 - i / barH;
    const idx = Math.floor(t * 255) * 3;
    ctx.fillStyle = `rgb(${IRONBOW_LUT[idx]},${IRONBOW_LUT[idx + 1]},${IRONBOW_LUT[idx + 2]})`;
    ctx.fillRect(barX, barY + i, 10, 1.5);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.strokeRect(barX, barY, 10, barH);
  ctx.fillStyle = '#fcffa4';
  ctx.font = '9px "IBM Plex Mono", monospace';
  ctx.fillText('0dB', barX - 6, barY - 4);
  ctx.fillStyle = '#9a78c2';
  ctx.fillText('-60', barX - 6, barY + barH + 11);
}
