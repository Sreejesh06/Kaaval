import React, { useEffect, useRef, useState } from 'react';
import { getFilteredSatelliteTargets } from '../audio/fusion';
import type {
  DetectedPerson,
  GuardMode,
  RadarFrame,
  SatelliteTelemetry,
  SemanticPrimitive,
} from '../types';

interface Props {
  latestFrameRef: React.MutableRefObject<RadarFrame | null>;
  satelliteRef?: React.MutableRefObject<SatelliteTelemetry | null>;
  frameSeqRef: React.MutableRefObject<number>;
  guardMode: GuardMode;
  sonarArmed: boolean;
  onSwitchToIronbow?: () => void;
  onRequestArm?: () => void;
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
  satelliteRef,
  frameSeqRef,
  guardMode,
  sonarArmed,
  onSwitchToIronbow,
  onRequestArm,
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
      targets: [] as DetectedPerson[],
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
      const rawSat = satelliteRef?.current || null;
      const dualActive = Boolean(rawSat && rawSat.armed && Date.now() - rawSat.updatedAtMs < 4000);
      // Pull camera back & up automatically when POCO Backside Radar is active so [-2.6m .. +3.0m] fits cleanly!
      const pivotZ = dualActive ? 0.25 : 1.45;
      const eyeY = dualActive ? 2.15 : 1.55;
      const eyeZ = dualActive ? -3.15 : -0.85;

      const rx = p.x;
      const rz = p.z - pivotZ;
      const cosY = Math.cos(cam.yaw);
      const sinY = Math.sin(cam.yaw);
      const wx = rx * cosY - rz * sinY;
      const wz = rx * sinY + rz * cosY + pivotZ;

      const dx = wx;
      const dy = p.y - eyeY;
      const dz = wz - eyeZ;

      const cosP = Math.cos(cam.pitch);
      const sinP = Math.sin(cam.pitch);
      const zCam = dz * cosP - dy * sinP;
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
            subject.targets = frame.targets || [];
            subject.x += 0.22 * (frame.targetX - subject.x);
            subject.z += 0.22 * (Math.max(0.32, frame.targetZ) - subject.z);
            subject.dispMm = frame.displacementMm;
            subject.bpm = frame.respirationBpm;
            subject.presence = frame.presenceRatio;
            subject.motion = frame.motionEnergy;
            cachedGrid = frame.spatialGrid;
            gridR = frame.spatialRangeSlices;
            gridAz = frame.spatialAzimuthBins;

            if (frame.peopleCount > 0) {
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

          const rawSat = satelliteRef?.current || null;
          const activeSat =
            rawSat && rawSat.armed && Date.now() - rawSat.updatedAtMs < 4000 ? rawSat : null;

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
            activeSat,
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
    <div className="panel night-panel spatial-panel">
      <div className="panel-head">
        <div>
          <span className="panel-title">3D spatial acoustic field</span>
          <span className="panel-meta" style={{ marginLeft: 10 }}>
            X {coords.x >= 0 ? '+' : ''}
            {coords.x.toFixed(2)}m · Z {coords.z.toFixed(2)}m · {coords.az >= 0 ? '+' : ''}
            {coords.az.toFixed(0)}° · {coords.stereo ? 'Stereo L/R' : 'Mono'} · Drag to orbit
          </span>
        </div>
        {onSwitchToIronbow && (
          <button
            type="button"
            onClick={onSwitchToIronbow}
            style={{ minHeight: 30, padding: '4px 12px', fontSize: 12.5 }}
          >
            Switch to Sonic Ironbow
          </button>
        )}
      </div>

      <canvas
        ref={canvasRef}
        className="spatial-canvas"
        width={1100}
        height={380}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={() => {
          if (!sonarArmed) onRequestArm?.();
        }}
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
        <span className="honesty-tag">0.32–3.0m range · Stereo FDMA · 0 px camera</span>
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
    targets: DetectedPerson[];
    x: number;
    z: number;
    dispMm: number;
    bpm: number | null;
    presence: number;
    motion: number;
    collapsed: number;
  },
  activeSat: SatelliteTelemetry | null,
  trail: Array<{ x: number; z: number }>,
  wavePhase: number,
  mode: GuardMode,
  armed: boolean
) {
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, w, h);

  const minZ = activeSat ? -2.6 : 0.0;

  // 1. Perspective Room Floor Grid (expands into -Z backside when POCO Satellite is armed!)
  ctx.strokeStyle = '#0f1620';
  ctx.lineWidth = 1;
  for (let x = -2.0; x <= 2.01; x += 0.4) {
    const a = project({ x, y: 0, z: minZ }, w, h);
    const b = project({ x, y: 0, z: 3.0 }, w, h);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let z = minZ; z <= 3.01; z += 0.5) {
    const a = project({ x: -2.0, y: 0, z }, w, h);
    const b = project({ x: 2.0, y: 0, z }, w, h);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // POCO Satellite Backside Wavefronts (-Z: -0.40m -> -2.5m)
  if (activeSat) {
    for (let k = 0; k < 3; k++) {
      const rWave = 0.42 + ((wavePhase + k / 3) % 1.0) * 2.1;
      const alpha = Math.max(0, 0.26 * (1 - (rWave - 0.42) / 2.1));
      ctx.strokeStyle = `rgba(255, 226, 77, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let deg = -36; deg <= 36; deg += 6) {
        const rad = (deg * Math.PI) / 180;
        const pt = project({ x: rWave * Math.sin(rad), y: 0.01, z: -rWave * Math.cos(rad) }, w, h);
        if (deg === -36) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    }
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
  ctx.fillStyle = '#9aa8bc';
  ctx.font = '10px "DM Mono", monospace';
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

  // 6. Clean 3D Multi-Person Presence Silhouettes & Breathing Halo (Front + de-duplicated Backside)
  const dedupedSat = getFilteredSatelliteTargets(
    armed ? subject.targets : [],
    activeSat,
    armed
  );
  const allTargets: DetectedPerson[] = [
    ...(armed ? subject.targets : []),
    ...dedupedSat,
  ];

  if (allTargets.length > 0) {
    const isEmergency =
      mode === 'EMERGENCY_DISPATCHED' ||
      mode === 'LISTENING_CONSENT' ||
      mode === 'PLAYING_PROMPT';
    const isPrealert = mode === 'ANOMALY_PREALERT';

    allTargets.forEach((person, idx) => {
      const isSat = person.source === 'SATELLITE';
      const isPrimary = idx === 0;
      const accent = isEmergency && isPrimary
        ? '#e11d48'
        : isPrealert && isPrimary
        ? '#f59e0b'
        : isSat
        ? '#ffe24d'
        : isPrimary
        ? '#14b8a6'
        : '#38bdf8';
      const accentDim = isEmergency && isPrimary
        ? 'rgba(225, 29, 72, 0.22)'
        : isPrealert && isPrimary
        ? 'rgba(245, 158, 11, 0.22)'
        : isSat
        ? 'rgba(255, 226, 77, 0.20)'
        : isPrimary
        ? 'rgba(20, 184, 166, 0.20)'
        : 'rgba(56, 189, 248, 0.18)';

      const px = person.x;
      const pz = person.z;
      const floorCenter = project({ x: px, y: 0, z: pz }, w, h);
      drawFloorCircle(ctx, project, px, pz, 0.23, w, h, accent, 1.5);

      if (!isPrimary || subject.collapsed < 0.5) {
        const chestH = 0.78;
        const headH = 1.18;
        const headPt = project({ x: px, y: headH, z: pz }, w, h);
        const shL = project({ x: px - 0.17, y: 0.96, z: pz }, w, h);
        const shR = project({ x: px + 0.17, y: 0.96, z: pz }, w, h);
        const hipL = project({ x: px - 0.11, y: 0.46, z: pz }, w, h);
        const hipR = project({ x: px + 0.11, y: 0.46, z: pz }, w, h);

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

        ctx.strokeStyle = 'rgba(232, 238, 245, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(floorCenter.x, floorCenter.y);
        ctx.lineTo(headPt.x, headPt.y + 8);
        ctx.stroke();

        const dispSource = isSat && activeSat ? activeSat.displacementMm : subject.dispMm;
        const breathR =
          0.21 + (isPrimary || isSat ? Math.max(-0.06, Math.min(0.06, dispSource * 0.015)) : 0);
        drawHorizontalCircle(ctx, project, px, chestH, pz, breathR, w, h, accent, 1.8);

        ctx.fillStyle = '#05070a';
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(headPt.x, headPt.y, 7.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        const bpmVal = isSat ? activeSat?.respirationBpm : isPrimary ? subject.bpm : null;
        drawCalloutPill(
          ctx,
          headPt.x,
          headPt.y - 18,
          isSat
            ? `B · POCO [${person.zone || 'BACK'}] ${person.distanceMeters.toFixed(2)}m${
                bpmVal ? ` · ${bpmVal.toFixed(0)} BPM` : ''
              }`
            : `F${idx + 1} · ${person.distanceMeters.toFixed(2)}m${
                bpmVal ? ` · ${bpmVal.toFixed(0)} BPM` : ''
              }`,
          accent
        );
      } else {
        const bodyEnd = project({ x: px + 0.48, y: 0.12, z: pz + 0.15 }, w, h);
        const bodyStart = project({ x: px - 0.18, y: 0.12, z: pz - 0.05 }, w, h);
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
          `FALL VERIFICATION · ${person.distanceMeters.toFixed(2)}m`,
          '#e11d48'
        );
      }
    });
  } else if (!armed && !activeSat) {
    ctx.fillStyle = '#ffe24d';
    ctx.font = '500 12.5px "DM Mono", monospace';
    ctx.fillText('Click to arm sonar · 3D stereo FDMA acoustic field', w * 0.5 - 180, h * 0.48);
  }

  // 7. Center MacBook Stereo Emitter Bar (+Z) & POCO M2 Pro Mono Bar (-Z)
  const txL = project({ x: -0.14, y: 0.02, z: 0.06 }, w, h);
  const txR = project({ x: 0.14, y: 0.02, z: 0.06 }, w, h);
  ctx.strokeStyle = '#3ed598';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(txL.x, txL.y);
  ctx.lineTo(txR.x, txR.y);
  ctx.stroke();

  ctx.fillStyle = '#cbbce0';
  ctx.font = '10px "DM Mono", monospace';
  ctx.fillText(activeSat ? 'TX-L 18.6–19.4k' : 'TX-L 17.6–18.8k', txL.x - 104, txL.y + 4);
  ctx.fillText(activeSat ? 'TX-R 19.5–20.3k' : 'TX-R 19.0–20.2k', txR.x + 10, txR.y + 4);

  if (activeSat) {
    const pocoL = project({ x: -0.07, y: 0.02, z: -0.08 }, w, h);
    const pocoR = project({ x: 0.07, y: 0.02, z: -0.08 }, w, h);
    ctx.strokeStyle = '#ffe24d';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(pocoL.x, pocoL.y);
    ctx.lineTo(pocoR.x, pocoR.y);
    ctx.stroke();
    ctx.fillStyle = '#ffe24d';
    ctx.fillText(`POCO ${activeSat.zone} 17.6–18.4k`, pocoR.x + 10, pocoR.y + 12);
  }
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
  ctx.font = '500 11px "DM Mono", monospace';
  const tw = ctx.measureText(text).width;
  const padX = 8;
  const boxW = tw + padX * 2;
  const boxH = 20;
  const x0 = cx - boxW * 0.5;
  const y0 = Math.max(8, cy - boxH);

  ctx.fillStyle = 'rgba(22, 18, 28, 0.92)';
  ctx.fillRect(x0, y0, boxW, boxH);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x0, y0, boxW, boxH);

  ctx.fillStyle = '#fff4c1';
  ctx.fillText(text, x0 + padX, y0 + 14);
}
