import React, { useEffect, useRef, useState } from 'react';
import type { DetectedPerson, GuardMode, RadarFrame } from '../types';

interface Props {
  latestFrameRef: React.MutableRefObject<RadarFrame | null>;
  frameSeqRef: React.MutableRefObject<number>;
  guardMode: GuardMode;
  sonarArmed: boolean;
  snapshotGetterRef?: React.MutableRefObject<(() => string | undefined) | null>;
  onSwitchTo3D?: () => void;
  onRequestArm?: () => void;
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

function humanAcousticField(
  px: number,
  py: number,
  cx: number,
  footY: number,
  scale: number,
  collapsed: number,
  breathBoost: number
): number {
  // Fast bounding-box reject before Gaussian math (keeps 3-person loop < 0.8 ms/frame)
  if (Math.abs(px - cx) > 75 * scale || py > footY + 18 * scale || py < footY - 125 * scale) {
    return 0;
  }

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
    return d2 > 6.5 ? 0 : w * Math.exp(-0.5 * d2);
  };

  return Math.min(
    1.05,
    g(headX, headY, 10.5, 12.5, 0.86) +
      g(chestX, chestY, 16.5 + breathBoost * 24, 20.0 + breathBoost * 20, 0.94 + breathBoost) +
      g(shLX, shY, 11.0, 13.0, 0.52) +
      g(shRX, shY, 11.0, 13.0, 0.52) +
      g(hipX, hipY, 14.5, 17.0, 0.72) +
      g(legLX, legY, 7.5, 16.0, 0.54) +
      g(legRX, legY, 7.5, 16.0, 0.54)
  );
}

export const SonicIronbowView: React.FC<Props> = ({
  latestFrameRef,
  frameSeqRef,
  guardMode,
  sonarArmed,
  snapshotGetterRef,
  onSwitchTo3D,
  onRequestArm,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [headerInfo, setHeaderInfo] = useState({
    count: 0,
    summary: 'QUIET CABIN',
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
      targets: [] as DetectedPerson[],
      dispMm: 0,
      bpm: null as number | null,
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
        state.targets = rf.targets || [];
        state.dispMm = rf.displacementMm;
        state.bpm = rf.respirationBpm;
        state.grid = rf.spatialGrid;
        state.ambient = rf.ambientClutterProfile;
        state.directMag = rf.directMag;
        state.metersPerSample = rf.metersPerSample;
        state.gridR = rf.spatialRangeSlices;
        state.gridAz = rf.spatialAzimuthBins;

        if (nowMs - lastHudMs > 180) {
          lastHudMs = nowMs;
          const cnt = state.targets.length;
          const summary =
            cnt === 0
              ? '0 DETECTED (EMPTY CABIN)'
              : state.targets
                  .map(
                    (t, idx) =>
                      `P${idx + 1} ${t.distanceMeters.toFixed(2)}m (${t.azimuthDeg >= 0 ? '+' : ''}${t.azimuthDeg.toFixed(0)}°)`
                  )
                  .join(' · ');
          setHeaderInfo({ count: cnt, summary });
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
      const fallenTarget =
        mode === 'PLAYING_PROMPT' ||
        mode === 'LISTENING_CONSENT' ||
        mode === 'TRIAGING_RESPONSE' ||
        mode === 'EMERGENCY_DISPATCHED'
          ? 1.0
          : 0.0;
      state.collapsed += 0.14 * (fallenTarget - state.collapsed);

      const horizonY = Math.floor(GRID_H * 0.36);
      const breathMod = Math.max(-0.06, Math.min(0.06, state.dispMm * 0.016));

      // Precompute screen projections for all detected people (sorted back-to-front)
      const projectedPeople = armed
        ? state.targets
            .slice()
            .sort((a, b) => b.distanceMeters - a.distanceMeters)
            .map((t, idx) => {
              const normDist = Math.max(0, Math.min(1, (t.distanceMeters - 0.32) / (3.0 - 0.32)));
              const footY = GRID_H - 10 - normDist * (GRID_H - horizonY - 20);
              const perspScale = 1.42 / (0.60 + normDist * 1.45);
              const cx = GRID_W * (0.5 + (t.azimuthDeg / 112) * 0.85);
              const flare = Math.min(0.20, t.motion * 0.045);
              const isPrimary = idx === state.targets.length - 1;
              return {
                person: t,
                cx,
                footY,
                perspScale,
                flare,
                collapsed: isPrimary ? state.collapsed : 0,
                breath: isPrimary ? breathMod : 0,
              };
            })
        : [];

      const dst = imgData.data;
      const ambNorm = 1 / (state.directMag * 0.50 + 1e-6);

      for (let y = 0; y < GRID_H; y++) {
        const rowOff = y * GRID_W;
        const isFloor = y >= horizonY;
        const rNorm = isFloor
          ? 1.0 - (y - horizonY) / Math.max(1, GRID_H - 1 - horizonY)
          : 1.0;
        const depthMeters = 0.32 + rNorm * 2.68;

        let ambEcho = 0.08;
        if (armed && state.ambient) {
          const bin = Math.min(
            state.ambient.length - 1,
            Math.floor(depthMeters / state.metersPerSample)
          );
          ambEcho = Math.min(0.28, state.ambient[bin] * ambNorm);
        }
        const wallVert = !isFloor ? (horizonY - y) / horizonY : 0;

        for (let x = 0; x < GRID_W; x++) {
          const i = rowOff + x;
          const xSigned = (x / (GRID_W - 1)) * 2 - 1;

          // 1. Cold room static acoustic background ([0.03 .. 0.33] indigo/royal purple)
          const sideWallCue = Math.pow(Math.abs(xSigned), 2.4) * 0.11;
          const tCold = 0.035 + ambEcho * 0.70 + sideWallCue - wallVert * 0.04;

          // 2. CFAR-normalized 2D polar ultrasonic energy plume
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
              plume = isFloor ? rawCell * 0.52 : rawCell * Math.exp(-wallVert * 3.0) * 0.32;
            }
          }

          // 3. Superimpose all confirmed people in the room (1, 2, or 3 simultaneously!)
          let humanHeat = 0;
          for (let pIdx = 0; pIdx < projectedPeople.length; pIdx++) {
            const pr = projectedPeople[pIdx];
            const hf = humanAcousticField(
              x,
              y,
              pr.cx,
              pr.footY,
              pr.perspScale,
              pr.collapsed,
              pr.breath
            );
            if (hf > 0.01) {
              const cand = Math.min(1.0, hf * (0.86 + pr.flare));
              if (cand > humanHeat) humanHeat = cand;
            }
          }

          const rawTarget = Math.min(
            0.995,
            Math.max(tCold + plume * 0.48, tCold * (1 - humanHeat) + humanHeat * 0.96)
          );
          const tSmooth = 0.52 * persistence[i] + 0.48 * rawTarget;
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

      drawRoomPerspectiveGuides(ctx, W, H, (horizonY / GRID_H) * H);

      // Draw crisp reticle + callout for EVERY detected person in the cabin
      projectedPeople.forEach((pr, idx) => {
        const dispCx = (pr.cx / GRID_W) * W;
        const dispFootY = (pr.footY / GRID_H) * H;
        const boxW = (pr.collapsed > 0.5 ? 190 : 108) * pr.perspScale;
        const boxH = (pr.collapsed > 0.5 ? 74 : 235) * pr.perspScale;
        drawReticle(ctx, dispCx - boxW * 0.5, dispFootY - boxH, boxW, boxH, mode);

        const rank = projectedPeople.length - idx;
        const bpmSuffix = rank === 1 && state.bpm ? ` · ${state.bpm.toFixed(0)} BPM` : '';
        const label = `P${rank} · ${pr.person.distanceMeters.toFixed(2)}m · ${
          pr.person.azimuthDeg >= 0 ? '+' : ''
        }${pr.person.azimuthDeg.toFixed(0)}°${bpmSuffix}`;
        drawCallout(ctx, dispCx, Math.max(28, dispFootY - boxH - 8), label);
      });

      if (!armed) {
        ctx.fillStyle = 'rgba(22, 18, 28, 0.88)';
        ctx.fillRect(W * 0.5 - 235, H * 0.5 - 23, 470, 42);
        ctx.strokeStyle = '#ffe24d';
        ctx.lineWidth = 2;
        ctx.strokeRect(W * 0.5 - 235, H * 0.5 - 23, 470, 42);
        ctx.fillStyle = '#ffe24d';
        ctx.font = '500 12.5px "DM Mono", monospace';
        ctx.fillText('Click to arm sonar · OS-CFAR multi-person acoustic imager', W * 0.5 - 214, H * 0.5 + 3);
      }

      drawColorbar(ctx, W, H);
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [latestFrameRef, frameSeqRef]);

  return (
    <div className="panel night-panel spatial-panel">
      <div className="panel-head">
        <div>
          <span className="panel-title">Sonic Ironbow imager</span>
          <span className="panel-meta" style={{ marginLeft: 10 }}>
            Camera: 0 px · {headerInfo.summary}
          </span>
        </div>
        {onSwitchTo3D && (
          <button
            type="button"
            onClick={onSwitchTo3D}
            style={{ minHeight: 30, padding: '4px 12px', fontSize: 12.5 }}
          >
            Switch to 3D sonar
          </button>
        )}
      </div>

      <canvas
        ref={canvasRef}
        className="ironbow-canvas"
        width={960}
        height={500}
        onClick={() => {
          if (!sonarArmed) onRequestArm?.();
        }}
        style={{ cursor: sonarArmed ? 'default' : 'pointer' }}
      />

      <div className="primitives-bar">
        <span className={`prim-pill ${headerInfo.count > 0 ? 'prim-active' : 'prim-dim'}`}>
          {headerInfo.count > 0 ? `${headerInfo.count} human target(s) locked` : 'Cabin empty'}
        </span>
        <span className="honesty-tag">
          0.6s micro-Doppler + OS-CFAR · Detects seated &amp; moving people
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

  const marginX = w * 0.16;
  ctx.strokeRect(marginX, h * 0.08, w - marginX * 2 - 34, hy - h * 0.08);
  ctx.beginPath();
  ctx.moveTo(marginX, hy); ctx.lineTo(0, h);
  ctx.moveTo(w - marginX - 34, hy); ctx.lineTo(w - 34, h);
  ctx.stroke();

  ctx.fillStyle = 'rgba(195, 145, 220, 0.55)';
  ctx.font = '10px "DM Mono", monospace';
  for (const m of [0.5, 1.0, 1.5, 2.0, 2.5]) {
    const rNorm = (m - 0.32) / 2.68;
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
      ? '#ff6fb1'
      : mode === 'ANOMALY_PREALERT'
      ? '#ffe24d'
      : 'rgba(253, 255, 182, 0.88)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
  ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c);
  ctx.moveTo(x, y + h - c); ctx.lineTo(x, y + h); ctx.lineTo(x + c, y + h);
  ctx.moveTo(x + w - c, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - c);
  ctx.stroke();
}

function drawCallout(ctx: CanvasRenderingContext2D, cx: number, y: number, text: string) {
  ctx.font = '500 11px "DM Mono", monospace';
  const tw = ctx.measureText(text).width;
  const bw = tw + 16;
  const bh = 21;
  ctx.fillStyle = 'rgba(22, 18, 28, 0.92)';
  ctx.fillRect(cx - bw * 0.5, y - bh, bw, bh);
  ctx.strokeStyle = '#ffe24d';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(cx - bw * 0.5, y - bh, bw, bh);
  ctx.fillStyle = '#fff4c1';
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
  ctx.fillStyle = '#fff4c1';
  ctx.font = '9px "DM Mono", monospace';
  ctx.fillText('+25dB', barX - 14, barY - 4);
  ctx.fillStyle = '#b9a2ff';
  ctx.fillText('CFAR', barX - 12, barY + barH + 11);
}
