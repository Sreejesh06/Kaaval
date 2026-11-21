import React, { useEffect, useRef, useState } from 'react';
import { getFilteredSatelliteTargets } from '../audio/fusion';
import type { DetectedPerson, GuardMode, RadarFrame, SatelliteTelemetry } from '../types';

interface Props {
  latestFrameRef: React.MutableRefObject<RadarFrame | null>;
  satelliteRef?: React.MutableRefObject<SatelliteTelemetry | null>;
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
  satelliteRef,
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
      const rawSat = satelliteRef?.current || null;
      const activeSat =
        rawSat && rawSat.armed && Date.now() - rawSat.updatedAtMs < 4000 ? rawSat : null;

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
      }

      const dedupedSatTargets = getFilteredSatelliteTargets(
        armedRef.current ? state.targets : [],
        activeSat,
        armedRef.current
      );

      if (nowMs - lastHudMs > 180) {
        lastHudMs = nowMs;
        const frontTargets = armedRef.current ? state.targets : [];
        const cnt = frontTargets.length + dedupedSatTargets.length;
        const parts: string[] = [];
        frontTargets.forEach((t, idx) => {
          parts.push(
            `${frontTargets.length > 1 ? `P${idx + 1} ` : ''}${t.distanceMeters.toFixed(2)}m (${t.azimuthDeg >= 0 ? '+' : ''}${t.azimuthDeg.toFixed(0)}°)`
          );
        });
        dedupedSatTargets.forEach((t) => {
          parts.push(`Backside ${t.distanceMeters.toFixed(2)}m`);
        });
        const summary =
          cnt === 0
            ? activeSat
              ? '360° room clear'
              : 'Room empty'
            : parts.join(' · ');
        setHeaderInfo({ count: cnt, summary });
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

      // Combine Front Laptop targets + de-duplicated POCO Satellite targets
      const combinedTargets: Array<{ t: DetectedPerson; isSat: boolean }> = [
        ...(armed ? state.targets.map((t) => ({ t, isSat: false })) : []),
        ...dedupedSatTargets.map((t) => ({ t, isSat: true })),
      ];

      // Precompute screen projections for all detected people (sorted back-to-front)
      const projectedPeople = combinedTargets
        .slice()
        .sort((a, b) => b.t.distanceMeters - a.t.distanceMeters)
        .map(({ t, isSat }, idx) => {
          const normDist = Math.max(0, Math.min(1, (t.distanceMeters - 0.32) / (3.0 - 0.32)));
          const footY = GRID_H - 10 - normDist * (GRID_H - horizonY - 20);
          const perspScale = (isSat ? 1.24 : 1.42) / (0.60 + normDist * 1.45);
          let lateralAz = t.azimuthDeg;
          if (isSat) {
            // Offset backside targets slightly right-of-center so they never overlap a dead-center front person
            if (t.zone === 'BACK') lateralAz = 34;
            else if (t.zone === 'OPPOSITE') lateralAz = -34;
            else if (t.zone === 'LEFT') lateralAz = -48;
            else if (t.zone === 'RIGHT') lateralAz = 48;
          }
          const cx = GRID_W * (0.5 + (lateralAz / 112) * 0.85);
          const flare = Math.min(0.20, t.motion * 0.045);
          const isPrimary = idx === combinedTargets.length - 1;
          const satBreath =
            isSat && activeSat
              ? Math.max(-0.06, Math.min(0.06, activeSat.displacementMm * 0.016))
              : breathMod;
          return {
            person: t,
            isSat,
            cx,
            footY,
            perspScale,
            flare,
            collapsed: isPrimary ? state.collapsed : 0,
            breath: isPrimary ? satBreath : 0,
          };
        });

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

      // Draw crisp reticle + callout for EVERY detected person in Front & Backside zones
      projectedPeople.forEach((pr, idx) => {
        const dispCx = (pr.cx / GRID_W) * W;
        const dispFootY = (pr.footY / GRID_H) * H;
        const boxW = (pr.collapsed > 0.5 ? 190 : 108) * pr.perspScale;
        const boxH = (pr.collapsed > 0.5 ? 74 : 235) * pr.perspScale;
        drawReticle(ctx, dispCx - boxW * 0.5, dispFootY - boxH, boxW, boxH, mode, pr.isSat);

        const rank = projectedPeople.length - idx;
        const activeBpm = pr.isSat ? activeSat?.respirationBpm : state.bpm;
        const bpmSuffix = activeBpm ? ` · ${activeBpm.toFixed(0)} BPM` : '';
        const label = pr.isSat
          ? `BACKSIDE · ${pr.person.distanceMeters.toFixed(2)}m${bpmSuffix}`
          : `${projectedPeople.length > 1 ? `P${rank} · ` : ''}${pr.person.distanceMeters.toFixed(2)}m · ${
              pr.person.azimuthDeg >= 0 ? '+' : ''
            }${pr.person.azimuthDeg.toFixed(0)}°${bpmSuffix}`;
        drawCallout(ctx, dispCx, Math.max(28, dispFootY - boxH - 8), label, pr.isSat);
      });

      if (activeSat || armed) {
        drawWholeRoomMiniRadar(
          ctx,
          armed ? state.targets : [],
          activeSat,
          dedupedSatTargets,
          armed
        );
      }

      if (!armed && !activeSat) {
        ctx.fillStyle = 'rgba(10, 11, 20, 0.88)';
        ctx.beginPath();
        ctx.roundRect(W * 0.5 - 220, H * 0.5 - 21, 440, 42, 10);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#a7ef77';
        ctx.beginPath();
        ctx.arc(W * 0.5 - 196, H * 0.5, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f5f5f7';
        ctx.font = '500 12.5px "DM Mono", monospace';
        ctx.fillText('Click anywhere to arm 20 kHz multi-person sonar', W * 0.5 - 182, H * 0.5 + 4);
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
          {headerInfo.count > 0
            ? `${headerInfo.count} ${headerInfo.count === 1 ? 'person' : 'people'} tracked`
            : 'Room empty'}
        </span>
        <span className="honesty-tag">
          Hardware camera LED: OFF · Pure 17.6–20.3 kHz acoustic echo map
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
  mode: GuardMode,
  isSat = false
) {
  const c = 12;
  ctx.strokeStyle =
    mode === 'EMERGENCY_DISPATCHED' || mode === 'LISTENING_CONSENT'
      ? '#ff6fb1'
      : mode === 'ANOMALY_PREALERT'
      ? '#ffe24d'
      : isSat
      ? '#3ed598'
      : 'rgba(253, 255, 182, 0.88)';
  ctx.lineWidth = isSat ? 2.2 : 1.8;
  ctx.beginPath();
  ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
  ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c);
  ctx.moveTo(x, y + h - c); ctx.lineTo(x, y + h); ctx.lineTo(x + c, y + h);
  ctx.moveTo(x + w - c, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - c);
  ctx.stroke();
}

function drawCallout(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  text: string,
  isSat = false
) {
  ctx.font = '500 11px "DM Mono", monospace';
  const tw = ctx.measureText(text).width;
  const bw = tw + 16;
  const bh = 21;
  ctx.fillStyle = 'rgba(22, 18, 28, 0.92)';
  ctx.fillRect(cx - bw * 0.5, y - bh, bw, bh);
  ctx.strokeStyle = isSat ? '#3ed598' : '#ffe24d';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(cx - bw * 0.5, y - bh, bw, bh);
  ctx.fillStyle = isSat ? '#a7f3d0' : '#fff4c1';
  ctx.fillText(text, cx - tw * 0.5, y - 6);
}

function drawWholeRoomMiniRadar(
  ctx: CanvasRenderingContext2D,
  frontTargets: DetectedPerson[],
  sat: SatelliteTelemetry | null,
  satTargets: DetectedPerson[],
  laptopArmed: boolean
) {
  const x0 = 14;
  const y0 = 14;
  const size = 166;
  const cx = x0 + size * 0.5;
  const cy = y0 + size * 0.52;
  const maxR = size * 0.40;

  ctx.fillStyle = 'rgba(14, 10, 22, 0.88)';
  ctx.fillRect(x0, y0, size, size);
  ctx.strokeStyle = sat ? '#3ed598' : 'rgba(195, 145, 220, 0.45)';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(x0, y0, size, size);

  ctx.fillStyle = '#fff4c1';
  ctx.font = '500 9.5px "DM Mono", monospace';
  ctx.fillText(sat ? '360° LAPTOP + POCO' : 'TOP-DOWN CONE (+Z)', x0 + 8, y0 + 13);

  ctx.strokeStyle = 'rgba(195, 145, 220, 0.22)';
  ctx.lineWidth = 1;
  for (const frac of [0.5, 1.0]) {
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * frac, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (laptopArmed) {
    ctx.fillStyle = 'rgba(41, 88, 212, 0.24)';
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.7)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, maxR, ((-90 - 52) * Math.PI) / 180, ((-90 + 52) * Math.PI) / 180);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  if (sat) {
    let centerDeg = 90;
    if (sat.zone === 'OPPOSITE') centerDeg = -90;
    else if (sat.zone === 'LEFT') centerDeg = 180;
    else if (sat.zone === 'RIGHT') centerDeg = 0;

    const beamOriginX = cx;
    const beamOriginY = sat.zone === 'OPPOSITE' ? cy - maxR : cy;
    const drawAngle = sat.zone === 'OPPOSITE' ? 90 : centerDeg;

    ctx.fillStyle = 'rgba(62, 213, 152, 0.22)';
    ctx.strokeStyle = 'rgba(62, 213, 152, 0.85)';
    ctx.beginPath();
    ctx.moveTo(beamOriginX, beamOriginY);
    ctx.arc(
      beamOriginX,
      beamOriginY,
      maxR * (2.6 / 3.0),
      ((drawAngle - 34) * Math.PI) / 180,
      ((drawAngle + 34) * Math.PI) / 180
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = '#ffe24d';
  ctx.fillRect(cx - 8, cy - 2, 16, 4);

  frontTargets.forEach((t) => {
    const px = cx + (t.x / 3.0) * maxR;
    const py = cy - (t.z / 3.0) * maxR;
    ctx.fillStyle = '#ffe24d';
    ctx.beginPath();
    ctx.arc(px, py, 4.2, 0, Math.PI * 2);
    ctx.fill();
  });

  if (sat) {
    satTargets.forEach((t) => {
      const px = cx + (t.x / 3.0) * maxR;
      const py = cy - (t.z / 3.0) * maxR;
      ctx.fillStyle = '#3ed598';
      ctx.beginPath();
      ctx.arc(px, py, 4.8, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.fillStyle = 'rgba(255, 244, 193, 0.65)';
  ctx.font = '8.5px "DM Mono", monospace';
  ctx.fillText('FRONT +Z', cx - 21, y0 + 24);
  ctx.fillText(sat ? `POCO ${sat.zone}` : 'BACK BLIND', cx - 24, y0 + size - 5);
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
