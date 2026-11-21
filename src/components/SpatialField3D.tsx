import React, { useEffect, useRef, useState } from 'react';
import type { GuardMode, RadarFrame, SemanticPrimitive } from '../types';

interface Props {
  latestFrameRef: React.MutableRefObject<RadarFrame | null>;
  frameSeqRef: React.MutableRefObject<number>;
  guardMode: GuardMode;
  sonarArmed: boolean;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Pt2 {
  x: number;
  y: number;
  depth: number;
}

const PRIMITIVE_LABELS: Record<SemanticPrimitive, string> = {
  EMPTY_BASELINE: 'EMPTY',
  ROOM_OCCUPIED: 'OCCUPIED',
  RESTING_RESPIRATION: 'BREATHING LOCKED',
  APPROACHING_SENSOR: 'APPROACHING',
  RECEDING_SENSOR: 'RECEDING',
  LATERAL_TRANSIT: 'CROSSING',
  IMPACT_TRANSIENT: 'IMPACT',
  POST_FALL_IMMOBILE: 'FALL IMMOBILE',
};

export const SpatialField3D: React.FC<Props> = ({
  latestFrameRef,
  frameSeqRef,
  guardMode,
  sonarArmed,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [primitives, setPrimitives] = useState<SemanticPrimitive[]>(['EMPTY_BASELINE']);
  const [coords, setCoords] = useState({ x: 0, z: 0.95, az: 0, stereo: true });

  // Verified right-handed forward perspective:
  // z = 0m (MacBook TX-L/R) sits at the bottom foreground; z = 3.0m recedes cleanly to the upper horizon!
  const camRef = useRef({
    yaw: 0.0,
    pitch: 0.42, // ~24 deg looking forward & down into the room
    dragging: false,
    lastX: 0,
    lastY: 0,
  });

  const guardModeRef = useRef(guardMode);
  guardModeRef.current = guardMode;
  const armedRef = useRef(sonarArmed);
  armedRef.current = sonarArmed;

  useEffect(() => {
    let rafId = 0;
    let lastSeq = -1;
    let lastHudMs = 0;
    let wavePhase = 0;

    const subject = {
      x: 0,
      z: 1.0,
      dispMm: 0,
      bpm: null as number | null,
      presence: 0,
      motion: 0,
      collapsed: 0,
    };
    const trail: Array<{ x: number; z: number }> = [];
    let cachedGrid: Float32Array | null = null;
    let gridR = 28;
    let gridAz = 15;

    const project = (p: Vec3, w: number, h: number): Pt2 => {
      const cam = camRef.current;
      // Rotate world point around room center (0, 0, 1.45m) for smooth mouse orbit
      const pivotZ = 1.45;
      const rx = p.x;
      const rz = p.z - pivotZ;
      const cosY = Math.cos(cam.yaw);
      const sinY = Math.sin(cam.yaw);
      const wx = rx * cosY - rz * sinY;
      const wz = rx * sinY + rz * cosY + pivotZ;

      // Camera eye sits behind & above the laptop at (0, 1.55m, -0.85m)
      const dx = wx;
      const dy = p.y - 1.55;
      const dz = wz - (-0.85);

      const cosP = Math.cos(cam.pitch);
      const sinP = Math.sin(cam.pitch);
      // Forward depth along camera ray (z=0 -> ~1.4m near; z=3.0m -> ~4.1m far)
      const zCam = dz * cosP - dy * sinP;
      // Vertical height in camera plane (z=0 -> negative = bottom of screen; z=3.0 -> positive = upper horizon!)
      const yCam = dy * cosP + dz * sinP;

      const focal = Math.min(w * 0.72, h * 1.45);
      const scale = focal / Math.max(0.35, zCam);
      return {
        x: w * 0.5 + dx * scale,
        y: h * 0.50 - yCam * scale,
        depth: zCam,
      };
    };

    const drawLoop = (now: number) => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const seq = frameSeqRef.current;
          const frame = latestFrameRef.current;
          if (frame && seq !== lastSeq) {
            lastSeq = seq;
            subject.x += 0.22 * (frame.targetX - subject.x);
            subject.z += 0.22 * (Math.max(0.5, frame.targetZ) - subject.z);
            subject.dispMm = frame.displacementMm;
            subject.bpm = frame.respirationBpm;
            subject.presence = frame.presenceRatio;
            subject.motion = frame.motionEnergy;
            cachedGrid = frame.spatialGrid;
            gridR = frame.spatialRangeSlices;
            gridAz = frame.spatialAzimuthBins;

            if (frame.presenceRatio > 0.22 || frame.motionEnergy > 0.5) {
              trail.push({ x: subject.x, z: subject.z });
              if (trail.length > 34) trail.shift();
            }

            if (now - lastHudMs > 150) {
              lastHudMs = now;
              setPrimitives(
                guardModeRef.current === 'EMERGENCY_DISPATCHED' ||
                  guardModeRef.current === 'LISTENING_CONSENT'
                  ? [...frame.primitives, 'POST_FALL_IMMOBILE']
                  : frame.primitives
              );
              setCoords({
                x: frame.targetX,
                z: frame.targetZ,
                az: frame.targetAzimuthDeg,
                stereo: frame.stereoActive,
              });
            }
          }

          const mode = guardModeRef.current;
          const confirmedFall =
            mode === 'PLAYING_PROMPT' ||
            mode === 'LISTENING_CONSENT' ||
            mode === 'TRIAGING_RESPONSE' ||
            mode === 'EMERGENCY_DISPATCHED';
          subject.collapsed += 0.12 * ((confirmedFall ? 1.0 : 0.0) - subject.collapsed);

          wavePhase = (wavePhase + 0.014) % 1.0;
          renderObservatory(
            ctx,
            canvas.width,
            canvas.height,
            project,
            cachedGrid,
            gridR,
            gridAz,
            subject,
            trail,
            wavePhase,
            mode,
            armedRef.current
          );
        }
      }
      rafId = requestAnimationFrame(drawLoop);
    };

    rafId = requestAnimationFrame(drawLoop);
    return () => cancelAnimationFrame(rafId);
  }, [latestFrameRef, frameSeqRef]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    camRef.current.dragging = true;
    camRef.current.lastX = e.clientX;
    camRef.current.lastY = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!camRef.current.dragging) return;
    const dx = e.clientX - camRef.current.lastX;
    const dy = e.clientY - camRef.current.lastY;
    camRef.current.lastX = e.clientX;
    camRef.current.lastY = e.clientY;
    camRef.current.yaw = Math.max(-0.95, Math.min(0.95, camRef.current.yaw + dx * 0.006));
    camRef.current.pitch = Math.max(0.22, Math.min(0.88, camRef.current.pitch + dy * 0.005));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    camRef.current.dragging = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };

  return (
    <div className="panel spatial-panel">
      <div className="panel-head">
        <span className="panel-title">Spatial Acoustic Field</span>
        <span className="panel-meta">
          X {coords.x >= 0 ? '+' : ''}
          {coords.x.toFixed(2)}m · Z {coords.z.toFixed(2)}m · {coords.az >= 0 ? '+' : ''}
          {coords.az.toFixed(0)}° · {coords.stereo ? 'STEREO L/R' : 'MONO'} · DRAG TO ORBIT
        </span>
      </div>

      <canvas
        ref={canvasRef}
        className="spatial-canvas"
        width={1100}
        height={380}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />

      <div className="primitives-bar">
        <div className="primitives-list">
          {primitives.map((p) => (
            <span
              key={p}
              className={`prim-pill ${
                p === 'IMPACT_TRANSIENT' || p === 'POST_FALL_IMMOBILE'
                  ? 'prim-alert'
                  : p === 'EMPTY_BASELINE'
                  ? 'prim-dim'
                  : 'prim-active'
              }`}
            >
              {PRIMITIVE_LABELS[p] || p}
            </span>
          ))}
        </div>
        <span className="honesty-tag">0.48–3.0m Range · Stereo FDMA · 0 px Camera</span>
      </div>
    </div>
  );
};

function renderObservatory(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  project: (p: Vec3, w: number, h: number) => Pt2,
  grid: Float32Array | null,
  gridR: number,
  gridAz: number,
  subject: {
    x: number;
    z: number;
    dispMm: number;
    bpm: number | null;
    presence: number;
    motion: number;
    collapsed: number;
  },
  trail: Array<{ x: number; z: number }>,
  wavePhase: number,
  mode: GuardMode,
  armed: boolean
) {
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, w, h);

  // 1. Perspective Room Floor Grid (z = 0m at bottom foreground -> z = 3.0m at upper horizon)
  ctx.strokeStyle = '#0f1620';
  ctx.lineWidth = 1;
  for (let x = -2.0; x <= 2.01; x += 0.4) {
    const a = project({ x, y: 0, z: 0 }, w, h);
    const b = project({ x, y: 0, z: 3.0 }, w, h);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let z = 0.5; z <= 3.01; z += 0.5) {
    const a = project({ x: -2.0, y: 0, z }, w, h);
    const b = project({ x: 2.0, y: 0, z }, w, h);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // Subtle back-wall frame @ z = 3.0m for crisp architectural 3D depth cues
  const bwL0 = project({ x: -2.0, y: 0, z: 3.0 }, w, h);
  const bwR0 = project({ x: 2.0, y: 0, z: 3.0 }, w, h);
  const bwL1 = project({ x: -2.0, y: 1.4, z: 3.0 }, w, h);
  const bwR1 = project({ x: 2.0, y: 1.4, z: 3.0 }, w, h);
  ctx.strokeStyle = '#141e2b';
  ctx.beginPath();
  ctx.moveTo(bwL0.x, bwL0.y);
  ctx.lineTo(bwL1.x, bwL1.y);
  ctx.lineTo(bwR1.x, bwR1.y);
  ctx.lineTo(bwR0.x, bwR0.y);
  ctx.stroke();

  // 2. Polar Sonar Sector Arcs (0.5m .. 3.0m opening forward from bottom foreground)
  ctx.strokeStyle = '#1b293b';
  ctx.fillStyle = '#5d6f86';
  ctx.font = '10px "IBM Plex Mono", monospace';
  for (const r of [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]) {
    ctx.beginPath();
    for (let deg = -52; deg <= 52; deg += 4) {
      const rad = (deg * Math.PI) / 180;
      const pt = project({ x: r * Math.sin(rad), y: 0, z: r * Math.cos(rad) }, w, h);
      if (deg === -52) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    const lbl = project(
      { x: r * Math.sin((54 * Math.PI) / 180), y: 0, z: r * Math.cos((54 * Math.PI) / 180) },
      w,
      h
    );
    ctx.fillText(`${r.toFixed(1)}m`, lbl.x + 5, lbl.y + 3);
  }

  for (const deg of [-52, 52]) {
    const rad = (deg * Math.PI) / 180;
    const p0 = project({ x: 0, y: 0, z: 0 }, w, h);
    const p1 = project({ x: 3.0 * Math.sin(rad), y: 0, z: 3.0 * Math.cos(rad) }, w, h);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  // 3. Propagating Ultrasonic Wavefronts (moving forward from bottom sensor into the room)
  if (armed && mode === 'ARMED_MONITORING') {
    for (let k = 0; k < 3; k++) {
      const rWave = 0.48 + ((wavePhase + k / 3) % 1.0) * 2.5;
      const alpha = Math.max(0, 0.2 * (1 - (rWave - 0.48) / 2.5));
      ctx.strokeStyle = `rgba(20, 184, 166, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let deg = -50; deg <= 50; deg += 5) {
        const rad = (deg * Math.PI) / 180;
        const pt = project({ x: rWave * Math.sin(rad), y: 0.005, z: rWave * Math.cos(rad) }, w, h);
        if (deg === -50) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    }
  }

  // 4. Volumetric Acoustic Terrain Contours (0.48m -> 3.0m, back-to-front painter's order)
  if (grid && armed) {
    for (let rs = gridR - 1; rs >= 0; rs--) {
      const rMeters = 0.48 + (rs / (gridR - 1)) * 2.48;
      let maxVal = 0;
      const pts: Pt2[] = [];
      for (let az = 0; az < gridAz; az++) {
        const deg = -52 + (az / (gridAz - 1)) * 104;
        const rad = (deg * Math.PI) / 180;
        const val = Math.min(1.0, grid[rs * gridAz + az]);
        if (val > maxVal) maxVal = val;
        // Gentle, proportional 3D elevation (max 34cm high so it never turns into a giant volcano)
        const yElev = val * 0.34;
        pts.push(project({ x: rMeters * Math.sin(rad), y: yElev, z: rMeters * Math.cos(rad) }, w, h));
      }

      if (maxVal < 0.035) continue;

      ctx.strokeStyle =
        maxVal > 0.65
          ? `rgba(245, 158, 11, ${(0.25 + maxVal * 0.55).toFixed(3)})`
          : `rgba(20, 184, 166, ${(0.18 + maxVal * 0.6).toFixed(3)})`;
      ctx.lineWidth = maxVal > 0.5 ? 1.4 : 1.0;
      ctx.beginPath();
      pts.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
    }
  }

  // 5. Floor Trajectory Trail
  if (armed && trail.length > 1) {
    ctx.strokeStyle = 'rgba(20, 184, 166, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    trail.forEach((pt, idx) => {
      const p2 = project({ x: pt.x, y: 0.01, z: pt.z }, w, h);
      if (idx === 0) ctx.moveTo(p2.x, p2.y);
      else ctx.lineTo(p2.x, p2.y);
    });
    ctx.stroke();
  }

  // 6. Clean 3D Human Presence Silhouette & Breathing Halo (zero wireframe spaghetti)
  const occupied = armed && (subject.presence > 0.2 || subject.motion > 0.4 || subject.collapsed > 0.1);
  if (occupied) {
    const isEmergency =
      mode === 'EMERGENCY_DISPATCHED' ||
      mode === 'LISTENING_CONSENT' ||
      mode === 'PLAYING_PROMPT';
    const isPrealert = mode === 'ANOMALY_PREALERT';
    const accent = isEmergency ? '#e11d48' : isPrealert ? '#f59e0b' : '#14b8a6';
    const accentDim = isEmergency
      ? 'rgba(225, 29, 72, 0.22)'
      : isPrealert
      ? 'rgba(245, 158, 11, 0.22)'
      : 'rgba(20, 184, 166, 0.20)';

    // Floor reticle ring + crosshairs at measured (X, Z)
    const floorCenter = project({ x: subject.x, y: 0, z: subject.z }, w, h);
    drawFloorCircle(ctx, project, subject.x, subject.z, 0.24, w, h, accent, 1.5);
    if (isEmergency) {
      const pulseR = 0.28 + ((wavePhase * 1.6) % 1.0) * 0.45;
      drawFloorCircle(ctx, project, subject.x, subject.z, pulseR, w, h, 'rgba(225,29,72,0.5)', 1.2);
    }

    if (subject.collapsed < 0.5) {
      // Upright Volumetric Beacon: subtle vertical glow column + articulated head/shoulder/chest marker
      const chestH = 0.78;
      const headH = 1.18;
      const chestPt = project({ x: subject.x, y: chestH, z: subject.z }, w, h);
      const headPt = project({ x: subject.x, y: headH, z: subject.z }, w, h);
      const shL = project({ x: subject.x - 0.17, y: 0.96, z: subject.z }, w, h);
      const shR = project({ x: subject.x + 0.17, y: 0.96, z: subject.z }, w, h);
      const hipL = project({ x: subject.x - 0.11, y: 0.46, z: subject.z }, w, h);
      const hipR = project({ x: subject.x + 0.11, y: 0.46, z: subject.z }, w, h);

      // Soft translucent torso polygon
      ctx.fillStyle = accentDim;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(shL.x, shL.y);
      ctx.lineTo(shR.x, shR.y);
      ctx.lineTo(hipR.x, hipR.y);
      ctx.lineTo(hipL.x, hipL.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Vertical spine anchor to floor
      ctx.strokeStyle = 'rgba(232, 238, 245, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(floorCenter.x, floorCenter.y);
      ctx.lineTo(headPt.x, headPt.y + 8);
      ctx.stroke();

      // Thoracic Breathing Ring (modulated by real unwrapped IQ displacementMm)
      const breathR = 0.21 + Math.max(-0.06, Math.min(0.06, subject.dispMm * 0.015));
      drawHorizontalCircle(ctx, project, subject.x, chestH, subject.z, breathR, w, h, accent, 1.8);

      // Clean head circle
      ctx.fillStyle = '#05070a';
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(headPt.x, headPt.y, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      drawCalloutPill(
        ctx,
        headPt.x,
        headPt.y - 18,
        `${Math.hypot(subject.x, subject.z).toFixed(2)}m${
          subject.bpm ? ` · ${subject.bpm.toFixed(0)} BPM` : ''
        }`,
        accent
      );
    } else {
      // Fallen / Horizontal Floor Alert Marker
      const bodyEnd = project({ x: subject.x + 0.48, y: 0.12, z: subject.z + 0.15 }, w, h);
      const bodyStart = project({ x: subject.x - 0.18, y: 0.12, z: subject.z - 0.05 }, w, h);
      ctx.strokeStyle = '#e11d48';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(bodyStart.x, bodyStart.y);
      ctx.lineTo(bodyEnd.x, bodyEnd.y);
      ctx.stroke();

      drawCalloutPill(
        ctx,
        floorCenter.x,
        floorCenter.y - 24,
        `FALL VERIFICATION · ${Math.hypot(subject.x, subject.z).toFixed(2)}m`,
        '#e11d48'
      );
    }
  } else if (!armed) {
    ctx.fillStyle = '#566579';
    ctx.font = '12px "IBM Plex Mono", monospace';
    ctx.fillText('CLICK [ARM SONAR] TO START 3D SPATIAL FIELD', w * 0.5 - 165, h * 0.48);
  }

  // 7. Foreground MacBook Stereo Emitter Bar anchored cleanly at bottom center (z = 0m)
  const txL = project({ x: -0.14, y: 0.02, z: 0.06 }, w, h);
  const txR = project({ x: 0.14, y: 0.02, z: 0.06 }, w, h);
  ctx.strokeStyle = '#14b8a6';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(txL.x, txL.y);
  ctx.lineTo(txR.x, txR.y);
  ctx.stroke();

  ctx.fillStyle = '#8a99ad';
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.fillText('TX-L 17.6–18.8k', txL.x - 102, txL.y + 4);
  ctx.fillText('TX-R 19.0–20.2k', txR.x + 10, txR.y + 4);
}

function drawFloorCircle(
  ctx: CanvasRenderingContext2D,
  project: (p: Vec3, w: number, h: number) => Pt2,
  cx: number,
  cz: number,
  r: number,
  w: number,
  h: number,
  color: string,
  lw: number
) {
  drawHorizontalCircle(ctx, project, cx, 0.01, cz, r, w, h, color, lw);
}

function drawHorizontalCircle(
  ctx: CanvasRenderingContext2D,
  project: (p: Vec3, w: number, h: number) => Pt2,
  cx: number,
  cy: number,
  cz: number,
  r: number,
  w: number,
  h: number,
  color: string,
  lw: number
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const pt = project({ x: cx + r * Math.cos(a), y: cy, z: cz + r * Math.sin(a) }, w, h);
    if (i === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  }
  ctx.stroke();
}

function drawCalloutPill(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  text: string,
  borderColor: string
) {
  ctx.font = '600 11px "IBM Plex Mono", monospace';
  const tw = ctx.measureText(text).width;
  const padX = 8;
  const boxW = tw + padX * 2;
  const boxH = 20;
  const x0 = cx - boxW * 0.5;
  const y0 = Math.max(8, cy - boxH);

  ctx.fillStyle = 'rgba(8, 11, 16, 0.88)';
  ctx.fillRect(x0, y0, boxW, boxH);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0, y0, boxW, boxH);

  ctx.fillStyle = '#e8eef5';
  ctx.fillText(text, x0 + padX, y0 + 14);
}
