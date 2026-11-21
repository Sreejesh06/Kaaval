import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KaavalSonarEngine } from '../audio/sonarEngine';
import type { DetectedPerson, RadarFrame, SatelliteTelemetry, SatelliteZone } from '../types';
import { QrCodeSvg } from './QrCodeSvg';

interface Props {
  satHttpsUrls?: string[];
  hostSatConnected?: boolean;
  hostSatArmed?: boolean;
  hostSatTelemetryRef?: React.MutableRefObject<SatelliteTelemetry | null>;
  onBackToConsole?: () => void;
}

type SatViewMode = 'HOST_PAIR' | 'NODE';

const ZONE_CARDS: Array<{
  id: SatelliteZone;
  title: string;
  tag: string;
  desc: string;
}> = [
    {
      id: 'BACK',
      title: 'Backside (-Z)',
      tag: '180° rear',
      desc: 'Lay phone behind laptop screen pointing into rear cabin blind spot.',
    },
    {
      id: 'OPPOSITE',
      title: 'Opposite wall',
      tag: 'Inward',
      desc: 'Place across the room facing back toward the laptop.',
    },
    {
      id: 'LEFT',
      title: 'Left wing (-X)',
      tag: '-90° port',
      desc: 'Guard left bedside or washroom doorway blind corner.',
    },
    {
      id: 'RIGHT',
      title: 'Right wing (+X)',
      tag: '+90° stbd',
      desc: 'Guard right corridor or deck-doorway blind corner.',
    },
  ];

function detectInitialSatMode(): SatViewMode {
  if (typeof window === 'undefined') return 'HOST_PAIR';
  if (window.location.search.includes('mode=node')) return 'NODE';
  const isMobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if (isMobileUa || window.innerWidth < 820) return 'NODE';
  return 'HOST_PAIR';
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

export const SatelliteNodeView: React.FC<Props> = ({
  satHttpsUrls: propHttpsUrls,
  hostSatConnected = false,
  hostSatArmed = false,
  hostSatTelemetryRef,
  onBackToConsole,
}) => {
  const [viewMode, setViewMode] = useState<SatViewMode>(detectInitialSatMode);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [armed, setArmed] = useState<boolean>(false);
  const [voicePaused, setVoicePaused] = useState<boolean>(false);
  const [wakeLocked, setWakeLocked] = useState<boolean>(false);
  const [zone, setZone] = useState<SatelliteZone>('BACK');
  const [txGain, setTxGain] = useState<number>(0.82);
  const [sampleRate, setSampleRate] = useState<number>(48000);
  const [httpsPort, setHttpsPort] = useState<number>(5443);
  const [localHttpsUrls, setLocalHttpsUrls] = useState<string[]>([]);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const [hud, setHud] = useState({
    peopleCount: 0,
    distanceM: 0,
    dispMm: 0,
    bpm: null as number | null,
    motionEnergy: 0,
    sonarDb: -60,
  });

  const [hostSnap, setHostSnap] = useState<SatelliteTelemetry | null>(null);

  const engineRef = useRef<KaavalSonarEngine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostCanvasRef = useRef<HTMLCanvasElement | null>(null);
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

  // Fetch LAN HTTPS URLs so QR pairing works even if opened directly
  useEffect(() => {
    fetch('/api/lan-info')
      .then((r) => r.json())
      .then((d: { lanIps?: string[]; httpsPort?: number }) => {
        const hPort = d.httpsPort || 5443;
        setHttpsPort(hPort);
        const ips = d.lanIps || [];
        const urls = ips.map((ip) => `https://${ip}:${hPort}/satellite`);
        setLocalHttpsUrls(
          urls.length ? urls : [`https://${window.location.hostname}:${hPort}/satellite`]
        );
      })
      .catch(() => { });
  }, []);

  // Connect `/ws/hub?role=satellite` ONLY when running in Phone Sensor (`NODE`) mode!
  // That way opening `Satellite` in `HOST_PAIR` mode on the laptop never spoofs `POCO Node B linked`.
  useEffect(() => {
    if (viewMode !== 'NODE') {
      wsRef.current?.close();
      wsRef.current = null;
      setWsConnected(false);
      if (engineRef.current && armedRef.current) {
        engineRef.current.setWorkletMode('VOICE_PAUSE');
        setArmed(false);
      }
      return;
    }

    const onVis = () => {
      if (document.visibilityState === 'visible' && armedRef.current) {
        void acquireWakeLock();
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
      wakeLockObjRef.current?.release?.().catch(() => { });
    };
  }, [viewMode, acquireWakeLock]);

  useEffect(() => {
    return () => {
      engineRef.current?.setWorkletMode('VOICE_PAUSE');
    };
  }, []);

  // Host Pair Mode: 30fps live preview of streamed 48-bin Node B range profile
  useEffect(() => {
    if (viewMode !== 'HOST_PAIR') return;

    let rafId = 0;
    let lastStateSync = 0;

    const drawHostScope = () => {
      const now = performance.now();
      const sat = hostSatTelemetryRef?.current ?? null;
      const fresh = sat && sat.armed && Date.now() - sat.updatedAtMs < 4000 ? sat : null;

      if (now - lastStateSync > 180) {
        lastStateSync = now;
        setHostSnap(fresh);
      }

      const canvas = hostCanvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        const w = canvas.width;
        const h = canvas.height;
        ctx.fillStyle = '#0d0814';
        ctx.fillRect(0, 0, w, h);

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

        if (fresh && fresh.rangeProfile?.length) {
          const bins = fresh.rangeProfile;
          const barW = Math.max(2, w / bins.length - 2);
          for (let i = 0; i < bins.length; i++) {
            const val = Math.max(0, Math.min(1, bins[i]));
            const bh = val * (h - 32);
            const bx = (i / bins.length) * w;
            ctx.fillStyle = val > 0.45 ? '#ffe24d' : 'rgba(62, 213, 152, 0.55)';
            ctx.fillRect(bx, h - 8 - bh, barW, bh);
          }

          fresh.targets?.forEach((t, idx) => {
            const tx = Math.min(w - 8, Math.max(8, (t.distanceMeters / 2.6) * w));
            ctx.strokeStyle = '#3ed598';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(tx, 18);
            ctx.lineTo(tx, h - 8);
            ctx.stroke();
            ctx.fillStyle = '#3ed598';
            ctx.fillText(
              `NODE B · ${t.distanceMeters.toFixed(2)}m`,
              Math.min(w - 115, tx + 6),
              30 + idx * 14
            );
          });
        } else {
          ctx.fillStyle = '#cbbce0';
          ctx.font = '500 12px "DM Mono", monospace';
          ctx.fillText(
            hostSatConnected
              ? 'PHONE LINKED · TAP [ARM BACKSIDE SATELLITE] ON PHONE'
              : 'WAITING FOR ANDROID NODE B · SCAN HTTPS QR ON THE LEFT',
            18,
            h * 0.54
          );
        }
      }

      rafId = requestAnimationFrame(drawHostScope);
    };

    rafId = requestAnimationFrame(drawHostScope);
    return () => cancelAnimationFrame(rafId);
  }, [viewMode, hostSatConnected, hostSatTelemetryRef]);

  // Phone Sensor Mode: 30fps 1D OS-CFAR Range Scope directly on POCO M2 Pro screen
  useEffect(() => {
    if (viewMode !== 'NODE') return;

    let rafId = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        const w = canvas.width;
        const h = canvas.height;
        ctx.fillStyle = '#0d0814';
        ctx.fillRect(0, 0, w, h);

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

          rf.targets.forEach((t, idx) => {
            const tx = Math.min(w - 6, Math.max(6, (t.distanceMeters / 2.6) * w));
            ctx.strokeStyle = '#3ed598';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(tx, 18);
            ctx.lineTo(tx, h - 8);
            ctx.stroke();

            ctx.fillStyle = '#3ed598';
            ctx.fillText(
              `B${idx + 1} ${t.distanceMeters.toFixed(2)}m`,
              Math.min(w - 78, tx + 5),
              28 + idx * 14
            );
          });
        } else {
          ctx.fillStyle = '#cbbce0';
          ctx.font = '600 12px "DM Mono", monospace';
          ctx.fillText('TAP [ARM BACKSIDE SATELLITE] TO GUARD BLIND ZONE', 18, h * 0.54);
        }
      }
      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [viewMode]);

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

    if (now - lastWsSendMsRef.current > 95 && wsRef.current?.readyState === WebSocket.OPEN) {
      lastWsSendMsRef.current = now;
      const activeZone = zoneRef.current;
      const mappedTargets = frame.targets.map((t, idx) =>
        mapSatelliteTargetToRoom(t, activeZone, idx)
      );

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
      } else {
        engineRef.current.setWorkletMode('SONAR_LOCKED');
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

  const resolvedHttpsUrls = propHttpsUrls?.length ? propHttpsUrls : localHttpsUrls;
  const primaryHttpsUrl =
    resolvedHttpsUrls[0] ||
    (typeof window !== 'undefined'
      ? `https://${window.location.hostname}:${httpsPort}/satellite`
      : '');

  const copyHttpsUrl = async () => {
    if (!primaryHttpsUrl) return;
    try {
      await navigator.clipboard.writeText(primaryHttpsUrl);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div>
      <div className="console-command-band">
        <div className="console-command-inner">
          <div className="console-command-title">
            <h1>
              {viewMode === 'HOST_PAIR'
                ? 'Whole-room blind-spot satellite mesh'
                : 'POCO M2 Pro backside ultrasonic sensor'}
            </h1>
            <span>
              Orthogonal 17.60–18.42 kHz blind-spot node · Zero collision with 18.6–20.3 kHz laptop
              sonar
            </span>
          </div>

          <div className="console-command-controls">
            <div className="mode-seg" role="tablist" aria-label="Satellite view mode">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'HOST_PAIR'}
                className={viewMode === 'HOST_PAIR' ? 'is-active' : ''}
                onClick={() => setViewMode('HOST_PAIR')}
              >
                Pair phone (Host)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'NODE'}
                className={viewMode === 'NODE' ? 'is-active' : ''}
                onClick={() => setViewMode('NODE')}
              >
                Phone sensor mode
              </button>
            </div>

            {viewMode === 'HOST_PAIR' ? (
              <span className="status-inline">
                <span
                  className={`led ${hostSatArmed ? 'on-teal' : hostSatConnected ? 'on-amber' : ''
                    }`}
                />
                <span>
                  {hostSatArmed
                    ? 'Node B streaming'
                    : hostSatConnected
                      ? 'Node B linked'
                      : 'Waiting for phone'}
                </span>
              </span>
            ) : (
              <>
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
              </>
            )}

            {onBackToConsole && (
              <button type="button" onClick={onBackToConsole}>
                Open room console
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="caregiver-shell">
        {viewMode === 'HOST_PAIR' ? (
          /* ================================================================
             MODE A: LAPTOP HOST PAIRING & LIVE NODE B MONITOR (1320px 2-Col)
             ================================================================ */
          <div className="sat-layout">
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">1 · Pair Android phone as backside Node B</span>
                <span className="panel-meta">Encrypted LAN · Port {httpsPort}</span>
              </div>

              <div className="cg-qr-card" style={{ alignItems: 'flex-start' }}>
                {primaryHttpsUrl && <QrCodeSvg value={primaryHttpsUrl} size={128} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13.5, color: '#3b314d', marginBottom: 8 }}>
                    Turn any spare Android phone (e.g. <strong>POCO M2 Pro</strong>) into a rear
                    blind-spot ultrasonic radar node over your houseboat / room Wi-Fi hotspot.
                  </p>
                  <div style={{ marginBottom: 10 }}>
                    {resolvedHttpsUrls.map((u) => (
                      <a
                        key={u}
                        href={u}
                        target="_blank"
                        rel="noreferrer"
                        className="mono"
                        style={{
                          display: 'inline-block',
                          fontSize: 12,
                          fontWeight: 700,
                          color: 'var(--blue)',
                          marginRight: 12,
                          wordBreak: 'break-all',
                        }}
                      >
                        {u}
                      </a>
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button type="button" onClick={copyHttpsUrl}>
                      {copiedUrl ? 'Copied HTTPS link ✓' : 'Copy HTTPS link'}
                    </button>
                    <button type="button" onClick={() => setViewMode('NODE')}>
                      Preview phone sensor UI
                    </button>
                  </div>
                </div>
              </div>

              <div className="sat-stepper">
                <div className={`sat-step ${hostSatConnected ? 'is-done' : ''}`}>
                  <span className="sat-step-num">1</span>
                  <div>
                    <strong style={{ fontSize: 13.5 }}>
                      Scan QR in Android Chrome &amp; accept local TLS
                    </strong>
                    <div style={{ fontSize: 12.5, color: '#3b314d' }}>
                      Android requires HTTPS for WebAudio mic access. Tap{' '}
                      <strong>Advanced → Proceed</strong> once for Kaaval&apos;s auto-generated LAN
                      certificate.
                    </div>
                  </div>
                </div>

                <div className={`sat-step ${hostSatConnected ? 'is-done' : ''}`}>
                  <span className="sat-step-num">2</span>
                  <div>
                    <strong style={{ fontSize: 13.5 }}>
                      {hostSatConnected
                        ? 'Hub WebSocket linked ✓'
                        : 'Waiting for phone to open /satellite...'}
                    </strong>
                    <div style={{ fontSize: 12.5, color: '#3b314d' }}>
                      Unplug Bluetooth audio, set phone media volume to <strong>75–85%</strong>, and
                      point the bottom USB-C edge into the blind zone.
                    </div>
                  </div>
                </div>

                <div className={`sat-step ${hostSatArmed ? 'is-done' : ''}`}>
                  <span className="sat-step-num">3</span>
                  <div>
                    <strong style={{ fontSize: 13.5 }}>
                      {hostSatArmed
                        ? 'Backside 17.6–18.4 kHz radar fused into room console ✓'
                        : 'Tap [Arm backside satellite] on the phone'}
                    </strong>
                    <div style={{ fontSize: 12.5, color: '#3b314d' }}>
                      Targets stream at 10 Hz into Sonic Ironbow &amp; 3D Sonar with wrap-around
                      deduplication.
                    </div>
                  </div>
                </div>
              </div>

              <div className="fdma-split-banner">
                <div className="fdma-band-pill">
                  <div className="mono" style={{ fontSize: 11, color: 'var(--yellow)' }}>
                    NODE A · LAPTOP STEREO
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>
                    18.60 – 20.34 kHz · Front (+Z, ±60°)
                  </div>
                </div>
                <div className="fdma-band-pill">
                  <div className="mono" style={{ fontSize: 11, color: 'var(--green)' }}>
                    NODE B · ANDROID PHONE
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>
                    17.60 – 18.42 kHz · Backside (-Z)
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT CARD: Live Node B Backside Telemetry & Echo Monitor */}
            <div style={{ display: 'grid', gap: 16 }}>
              <section
                className="metric-bar"
                style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginBottom: 0 }}
              >
                <div className="metric-cell">
                  <span className="readout-k">
                    <span className={`led ${hostSnap ? 'on-teal' : ''}`} />
                    Node B status &amp; zone
                  </span>
                  <span className="metric-val teal" style={{ fontSize: 16 }}>
                    {hostSnap
                      ? `Active · ${hostSnap.zone}`
                      : hostSatConnected
                        ? 'Linked · Standby'
                        : 'Unpaired'}
                  </span>
                </div>

                <div className="metric-cell">
                  <span className="readout-k">Backside occupancy</span>
                  <span className="metric-val" style={{ fontSize: 16 }}>
                    {!hostSnap
                      ? '--'
                      : hostSnap.peopleCount === 0
                        ? '0 · Clear'
                        : `${hostSnap.peopleCount} · ${hostSnap.targetMeters.toFixed(2)}m`}
                  </span>
                </div>

                <div className="metric-cell">
                  <span className="readout-k">Chest respiration</span>
                  <span className="metric-val teal" style={{ fontSize: 16 }}>
                    {!hostSnap
                      ? '--'
                      : hostSnap.respirationBpm
                        ? `${hostSnap.respirationBpm.toFixed(0)} BPM`
                        : `${hostSnap.displacementMm >= 0 ? '+' : ''}${hostSnap.displacementMm.toFixed(
                          2
                        )} mm`}
                  </span>
                </div>

                <div className="metric-cell">
                  <span className="readout-k">Zone motion</span>
                  <span
                    className={`metric-val ${hostSnap && hostSnap.motionEnergy >= 4.2 ? 'red' : ''
                      }`}
                    style={{ fontSize: 16 }}
                  >
                    {hostSnap ? hostSnap.motionEnergy.toFixed(2) : '--'}
                  </span>
                </div>
              </section>

              <div className="panel night-panel">
                <div className="panel-head">
                  <span className="panel-title">
                    2 · Live Node B backside echo stream (0.36m – 2.60m)
                  </span>
                  <span className="panel-meta">10 Hz /ws/hub telemetry · 0 px camera</span>
                </div>
                <canvas ref={hostCanvasRef} className="scope-canvas" width={640} height={195} />
              </div>
            </div>
          </div>
        ) : (
          /* ================================================================
             MODE B: ACTIVE PHONE ULTRASONIC SENSOR UI (Thumb-Friendly)
             ================================================================ */
          <div>
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
                  Tap below to switch to Kaaval&apos;s local encrypted gateway (accept the
                  self-signed LAN certificate once via <strong>Advanced → Proceed</strong>).
                </p>
                <a
                  href={primaryHttpsUrl}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    minHeight: 44,
                    padding: '0 18px',
                    borderRadius: 999,
                    background: 'var(--ink)',
                    color: 'var(--yellow)',
                    fontWeight: 700,
                    textDecoration: 'none',
                  }}
                >
                  Open secure satellite ({primaryHttpsUrl})
                </a>
              </div>
            )}

            {errorMsg && (
              <div className="cg-alert-banner">
                <strong>Audio setup notice:</strong> {errorMsg}
              </div>
            )}

            <div className="sat-layout">
              <div className="panel">
                <div className="panel-head">
                  <span className="panel-title">1 · Select blind-spot placement zone</span>
                  <span className="panel-meta">Bottom speaker + USB-C mic</span>
                </div>

                <div className="zone-grid" role="radiogroup" aria-label="Blind spot zone">
                  {ZONE_CARDS.map((z) => {
                    const selected = zone === z.id;
                    return (
                      <button
                        type="button"
                        key={z.id}
                        role="radio"
                        aria-checked={selected}
                        className={`zone-card ${selected ? 'is-selected' : ''}`}
                        onClick={() => setZone(z.id)}
                      >
                        <div className="zone-card-top">
                          <span className="zone-card-title">{z.title}</span>
                          <span className="zone-card-tag">{z.tag}</span>
                        </div>
                        <span className="zone-card-desc">{z.desc}</span>
                      </button>
                    );
                  })}
                </div>

                <div
                  className="rec-coach-box"
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <label className="ctrl-inline" style={{ color: 'var(--ink)', fontWeight: 700 }}>
                    POCO TX gain ({Math.round(txGain * 100)}%):
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

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {!armed ? (
                      <button
                        type="button"
                        className="btn-arm"
                        disabled={needsHttpsJump}
                        onClick={armSatellite}
                      >
                        Arm backside satellite
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
                        <button
                          type="button"
                          onClick={() => engineRef.current?.recalibrateDirectPath()}
                        >
                          Re-lock bleed
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 16 }}>
                <section
                  className="metric-bar"
                  style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginBottom: 0 }}
                >
                  <div className="metric-cell">
                    <span className="readout-k">Backside occupancy</span>
                    <span className="metric-val teal">
                      {!armed
                        ? '--'
                        : hud.peopleCount === 0
                          ? '0 · Clear'
                          : `${hud.peopleCount} · ${hud.distanceM.toFixed(2)}m`}
                    </span>
                  </div>
                  <div className="metric-cell">
                    <span className="readout-k">Chest respiration</span>
                    <span className="metric-val teal">
                      {hud.bpm
                        ? `${hud.bpm.toFixed(0)} BPM`
                        : armed
                          ? `${hud.dispMm >= 0 ? '+' : ''}${hud.dispMm.toFixed(2)} mm`
                          : '--'}
                    </span>
                  </div>
                  <div className="metric-cell">
                    <span className="readout-k">Zone motion</span>
                    <span className={`metric-val ${hud.motionEnergy >= 4.2 ? 'red' : ''}`}>
                      {armed ? hud.motionEnergy.toFixed(2) : '--'}
                    </span>
                  </div>
                  <div className="metric-cell">
                    <span className="readout-k">FDMA sub-band</span>
                    <span className="metric-val" style={{ fontSize: 15 }}>
                      17.60–18.42 kHz ({sampleRate / 1000}k)
                    </span>
                  </div>
                </section>

                <div className="panel night-panel">
                  <div className="panel-head">
                    <span className="panel-title">
                      2 · 1D OS-CFAR range profile (0.36m – 2.60m)
                    </span>
                    <span className="panel-meta">&lt;17.5 kHz speech zeroed · 0 px cam</span>
                  </div>
                  <canvas ref={canvasRef} className="scope-canvas" width={640} height={185} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
