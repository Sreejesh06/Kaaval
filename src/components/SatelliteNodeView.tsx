import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KaavalSonarEngine } from '../audio/sonarEngine';
import type { DetectedPerson, RadarFrame, SatelliteTelemetry, SatelliteZone } from '../types';

interface Props {
  onBackToConsole?: () => void;
}

function mapSatelliteTargetToRoom(
  person: DetectedPerson,
  zone: SatelliteZone,
  idx: number
): DetectedPerson {
  const d = person.distanceMeters;
  if (zone === 'BACK') {
    return {
      ...person,
      id: 100 + person.id + idx,
      azimuthDeg: 180,
      x: 0,
      z: -d,
      zone: 'BACK',
      source: 'SATELLITE',
    };
  }
  if (zone === 'OPPOSITE') {
    const zMapped = Math.max(0.35, 3.2 - d);
    return {
      ...person,
      id: 100 + person.id + idx,
      azimuthDeg: 0,
      x: 0,
      z: zMapped,
      zone: 'OPPOSITE',
      source: 'SATELLITE',
    };
  }
  if (zone === 'LEFT') {
    return {
      ...person,
      id: 100 + person.id + idx,
      azimuthDeg: -90,
      x: -d,
      z: 1.15,
      zone: 'LEFT',
      source: 'SATELLITE',
    };
  }
  return {
    ...person,
    id: 100 + person.id + idx,
    azimuthDeg: 90,
    x: d,
    z: 1.15,
    zone: 'RIGHT',
    source: 'SATELLITE',
  };
}

export const SatelliteNodeView: React.FC<Props> = ({ onBackToConsole }) => {
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [armed, setArmed] = useState<boolean>(false);
  const [voicePaused, setVoicePaused] = useState<boolean>(false);
  const [wakeLocked, setWakeLocked] = useState<boolean>(false);
  const [zone, setZone] = useState<SatelliteZone>('BACK');
  const [txGain, setTxGain] = useState<number>(0.82);
  const [sampleRate, setSampleRate] = useState<number>(48000);
  const [httpsPort, setHttpsPort] = useState<number>(5443);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const [hud, setHud] = useState({
    peopleCount: 0,
    distanceM: 0,
    dispMm: 0,
    bpm: null as number | null,
    motionEnergy: 0,
    sonarDb: -60,
  });

  const engineRef = useRef<KaavalSonarEngine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestFrameRef = useRef<RadarFrame | null>(null);
  const zoneRef = useRef<SatelliteZone>(zone);
  zoneRef.current = zone;
  const armedRef = useRef<boolean>(armed);
  armedRef.current = armed;
  const sampleRateRef = useRef<number>(sampleRate);
  sampleRateRef.current = sampleRate;
  const nodeIdRef = useRef<string>(`poco-${Math.random().toString(36).slice(2, 7)}`);
  const lastHudMsRef = useRef<number>(0);
  const lastWsSendMsRef = useRef<number>(0);
  const wakeLockObjRef = useRef<{ release?: () => Promise<void> } | null>(null);

  const isLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const needsHttpsJump =
    typeof window !== 'undefined' && !window.isSecureContext && !isLocalhost;

  const acquireWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<{ release?: () => Promise<void> }> };
      };
      if (nav.wakeLock) {
        wakeLockObjRef.current = await nav.wakeLock.request('screen');
        setWakeLocked(true);
      }
    } catch {
      setWakeLocked(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/lan-info')
      .then((r) => r.json())
      .then((d: { httpsPort?: number }) => {
        if (d.httpsPort) setHttpsPort(d.httpsPort);
      })
      .catch(() => {});

    const onVis = () => {
      if (document.visibilityState === 'visible' && armedRef.current) {
        acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVis);

    let closed = false;
    let retryTimer = 0;

    const connectWs = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/hub?role=satellite`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        ws.send(JSON.stringify({ type: 'register', role: 'satellite' }));
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as { type?: string; paused?: boolean };
          if (msg.type === 'room_voice_gate' && engineRef.current && armedRef.current) {
            const shouldPause = Boolean(msg.paused);
            setVoicePaused(shouldPause);
            engineRef.current.setWorkletMode(shouldPause ? 'VOICE_PAUSE' : 'SONAR_LOCKED');
          }
        } catch {
          // Ignore malformed WS frames
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closed) retryTimer = window.setTimeout(connectWs, 1800);
      };
    };

    connectWs();
    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', onVis);
      window.clearTimeout(retryTimer);
      wsRef.current?.close();
      wakeLockObjRef.current?.release?.().catch(() => {});
    };
  }, [acquireWakeLock]);

  // Render crisp 30fps 1D OS-CFAR Range Scope directly on POCO M2 Pro screen
  useEffect(() => {
    let rafId = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        const w = canvas.width;
        const h = canvas.height;
        ctx.fillStyle = '#0d0814';
        ctx.fillRect(0, 0, w, h);

        // Distance grid lines (0.5m .. 2.5m)
        ctx.strokeStyle = 'rgba(255, 244, 193, 0.12)';
        ctx.fillStyle = '#9a8eb0';
        ctx.font = '10px "DM Mono", monospace';
        for (const m of [0.5, 1.0, 1.5, 2.0, 2.5]) {
          const x = (m / 2.6) * w;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
          ctx.fillText(`${m.toFixed(1)}m`, x + 4, 14);
        }

        const rf = latestFrameRef.current;
        if (rf && armedRef.current) {
          const prof = rf.clutterRemovedProfile;
          const maxBins = Math.min(prof.length, Math.floor(2.6 / rf.metersPerSample));
          let peak = 1e-5;
          for (let i = 0; i < maxBins; i++) {
            if (prof[i] > peak) peak = prof[i];
          }
          const normScale = 1 / Math.max(peak, rf.directMag * 0.02);

          ctx.strokeStyle = '#ffe24d';
          ctx.fillStyle = 'rgba(255, 226, 77, 0.18)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(0, h - 8);
          for (let i = 0; i < maxBins; i += 2) {
            const px = (i / maxBins) * w;
            const py = h - 8 - Math.min(1, prof[i] * normScale) * (h - 30);
            ctx.lineTo(px, py);
          }
          ctx.lineTo(w, h - 8);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Highlight locked backside human targets
          rf.targets.forEach((t, idx) => {
            const tx = Math.min(w - 6, Math.max(6, (t.distanceMeters / 2.6) * w));
            ctx.strokeStyle = '#3ed598';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(tx, 18);
            ctx.lineTo(tx, h - 8);
            ctx.stroke();

            ctx.fillStyle = '#3ed598';
            ctx.fillText(`B${idx + 1} ${t.distanceMeters.toFixed(2)}m`, Math.min(w - 78, tx + 5), 28 + idx * 14);
          });
        } else {
          ctx.fillStyle = '#cbbce0';
          ctx.font = '600 12px "DM Mono", monospace';
          ctx.fillText('TAP [ARM POCO SATELLITE] TO GUARD BACKSIDE ZONE', 18, h * 0.54);
        }
      }
      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const handleRadarFrame = useCallback((frame: RadarFrame) => {
    latestFrameRef.current = frame;
    const now = performance.now();

    if (now - lastHudMsRef.current > 120) {
      lastHudMsRef.current = now;
      setHud({
        peopleCount: frame.peopleCount,
        distanceM: frame.targetMeters,
        dispMm: frame.displacementMm,
        bpm: frame.respirationBpm,
        motionEnergy: frame.motionEnergy,
        sonarDb: frame.sonarDb,
      });
    }

    // Stream compact 10 Hz telemetry over /ws/hub to Laptop Room Console
    if (now - lastWsSendMsRef.current > 95 && wsRef.current?.readyState === WebSocket.OPEN) {
      lastWsSendMsRef.current = now;
      const activeZone = zoneRef.current;
      const mappedTargets = frame.targets.map((t, idx) =>
        mapSatelliteTargetToRoom(t, activeZone, idx)
      );

      // Downsample 48 range slices (0..2.6m) for Laptop's Whole-Room Mini-Radar
      const bins = 48;
      const maxBin = Math.min(
        frame.clutterRemovedProfile.length,
        Math.floor(2.6 / frame.metersPerSample)
      );
      const compactProfile: number[] = new Array(bins).fill(0);
      const normRef = Math.max(1e-6, frame.directMag * 0.022);
      for (let b = 0; b < bins; b++) {
        const i0 = Math.floor((b * maxBin) / bins);
        const i1 = Math.max(i0 + 1, Math.floor(((b + 1) * maxBin) / bins));
        let mx = 0;
        for (let i = i0; i < i1; i++) {
          if (frame.clutterRemovedProfile[i] > mx) mx = frame.clutterRemovedProfile[i];
        }
        compactProfile[b] = Number(Math.min(1, mx / normRef).toFixed(3));
      }

      const payload: SatelliteTelemetry = {
        nodeId: nodeIdRef.current,
        deviceLabel: 'POCO M2 Pro (Mono 17.6–18.4 kHz)',
        zone: activeZone,
        armed: true,
        sampleRate: sampleRateRef.current,
        peopleCount: mappedTargets.length,
        targets: mappedTargets,
        targetMeters: frame.targetMeters,
        displacementMm: Number(frame.displacementMm.toFixed(2)),
        respirationBpm: frame.respirationBpm ? Number(frame.respirationBpm.toFixed(1)) : null,
        motionEnergy: Number(frame.motionEnergy.toFixed(2)),
        sonarDb: Number(frame.sonarDb.toFixed(1)),
        primitives: frame.primitives,
        rangeProfile: compactProfile,
        updatedAtMs: Date.now(),
      };

      wsRef.current.send(
        JSON.stringify({
          type: 'satellite_telemetry',
          data: payload,
        })
      );
    }
  }, []);

  const armSatellite = async () => {
    try {
      setErrorMsg('');
      if (!engineRef.current) {
        engineRef.current = new KaavalSonarEngine(handleRadarFrame);
      }
      const info = await engineRef.current.start(0, 'SATELLITE_MONO');
      engineRef.current.setGain(txGain);
      setSampleRate(info.sampleRate);
      setArmed(true);
      await acquireWakeLock();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const secureRedirectUrl =
    typeof window !== 'undefined'
      ? `https://${window.location.hostname}:${httpsPort}/satellite`
      : '';

  return (
    <div>
      <div className="console-command-band">
        <div className="console-command-inner">
          <div className="console-command-title">
            <h1>POCO M2 Pro satellite node</h1>
            <span>Orthogonal 17.60–18.42 kHz backside blind-spot sensor</span>
          </div>

          <div className="console-command-controls">
            <span className="status-inline">
              <span className={`led ${wsConnected ? 'on-teal' : 'on-red'}`} />
              <span>{wsConnected ? 'Hub linked' : 'Connecting'}</span>
            </span>
            {armed && (
              <span className="status-inline">
                <span className={`led ${voicePaused ? 'on-amber' : 'on-teal'}`} />
                <span>
                  {voicePaused
                    ? 'Paused for voice'
                    : wakeLocked
                    ? 'Awake · 17.6–18.4k'
                    : '17.6–18.4k'}
                </span>
              </span>
            )}
            {onBackToConsole && (
              <button type="button" onClick={onBackToConsole}>
                Open laptop console
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="caregiver-shell">
        {needsHttpsJump && (
          <div
            className="cg-alert-banner"
            style={{
              background: 'var(--yellow)',
              borderColor: 'var(--ink)',
            }}
          >
            <div
              className="mono"
              style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}
            >
              Android Chrome requires HTTPS for ultrasonic mic access
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--ink)', marginBottom: 12 }}>
              Tap below to switch to Kaaval&apos;s local encrypted gateway (accept the self-signed
              LAN certificate once via <strong>Advanced → Proceed</strong>).
            </p>
            <a
              href={secureRedirectUrl}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 42,
                padding: '0 18px',
                borderRadius: 999,
                background: 'var(--ink)',
                color: 'var(--yellow)',
                fontWeight: 700,
                textDecoration: 'none',
              }}
            >
              Open secure satellite ({secureRedirectUrl})
            </a>
          </div>
        )}

        {errorMsg && (
          <div className="cg-alert-banner">
            <strong>Audio setup notice:</strong> {errorMsg}
          </div>
        )}

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head">
            <span className="panel-title">Physical placement &amp; blind-spot zone</span>
            <span className="panel-meta">Bottom mono speaker + USB-C mic</span>
          </div>
          <p style={{ fontSize: 13.5, color: 'var(--content-secondary)', marginBottom: 14 }}>
            1. Unplug Bluetooth audio and set POCO media volume to{' '}
            <strong style={{ color: 'var(--content-primary)' }}>70–85%</strong>.<br />
            2. Lay the phone flat behind your laptop with the{' '}
            <strong style={{ color: 'var(--content-primary)' }}>
              bottom USB-C / speaker edge pointing into the blind zone
            </strong>
            .
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <label className="ctrl-inline">
              Blind-spot zone:
              <select value={zone} onChange={(e) => setZone(e.target.value as SatelliteZone)}>
                <option value="BACK">Backside (-Z behind laptop)</option>
                <option value="OPPOSITE">Opposite wall (facing inward)</option>
                <option value="LEFT">Left blind wing (-X)</option>
                <option value="RIGHT">Right blind wing (+X)</option>
              </select>
            </label>

            <label className="ctrl-inline">
              POCO gain ({Math.round(txGain * 100)}%):
              <input
                type="range"
                min="0.35"
                max="0.95"
                step="0.05"
                value={txGain}
                onChange={(e) => {
                  const g = parseFloat(e.target.value);
                  setTxGain(g);
                  engineRef.current?.setGain(g);
                }}
              />
            </label>

            {!armed ? (
              <button
                type="button"
                className="btn-arm"
                disabled={needsHttpsJump}
                onClick={armSatellite}
              >
                Arm POCO satellite
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-green"
                  onClick={() => engineRef.current?.zeroClutter()}
                >
                  Zero clutter
                </button>
                <button type="button" onClick={() => engineRef.current?.recalibrateDirectPath()}>
                  Re-lock bleed
                </button>
              </>
            )}
          </div>
        </div>

      <section className="metric-bar" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="metric-cell">
          <span className="readout-k">Backside Occupancy</span>
          <span className="metric-val teal">
            {!armed
              ? '--'
              : hud.peopleCount === 0
              ? '0 (CLEAR)'
              : `${hud.peopleCount} · ${hud.distanceM.toFixed(2)}m`}
          </span>
        </div>
        <div className="metric-cell">
          <span className="readout-k">Chest Respiration</span>
          <span className="metric-val teal">
            {hud.bpm ? `${hud.bpm.toFixed(0)} BPM` : armed ? `${hud.dispMm >= 0 ? '+' : ''}${hud.dispMm.toFixed(2)} mm` : '--'}
          </span>
        </div>
        <div className="metric-cell">
          <span className="readout-k">Zone Motion</span>
          <span className={`metric-val ${hud.motionEnergy >= 4.2 ? 'red' : ''}`}>
            {armed ? hud.motionEnergy.toFixed(2) : '--'}
          </span>
        </div>
        <div className="metric-cell">
          <span className="readout-k">FDMA Sub-Band</span>
          <span className="metric-val" style={{ fontSize: 15 }}>
            17.60–18.42 kHz ({sampleRate / 1000}k)
          </span>
        </div>
      </section>

      <div className="panel night-panel">
        <div className="panel-head">
          <span className="panel-title">POCO 1D Ultrasonic Range Profile (0.36m – 2.60m)</span>
          <span className="panel-meta">&lt;17.5 kHz SPEECH ZEROED · 0 px CAMERA</span>
        </div>
        <canvas ref={canvasRef} className="scope-canvas" width={640} height={175} />
      </div>
      </div>
    </div>
  );
};
