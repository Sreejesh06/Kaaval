import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KaavalSonarEngine } from '../audio/sonarEngine';
import type {
  AnomalyTriggerReason,
  BenchmarkSummary,
  GuardMode,
  IncidentRecord,
  RadarFrame,
} from '../types';
import { RadarScopes } from './RadarScopes';
import { SonicIronbowView } from './SonicIronbowView';
import { SpatialField3D } from './SpatialField3D';
import { TriageTimeline } from './TriageTimeline';
import { BenchmarkPanel } from './BenchmarkPanel';
import { CaregiverView } from './CaregiverView';

const EMPTY_BENCHMARK: BenchmarkSummary = {
  trials: [],
  matrix: {
    EMPTY_CABIN: { EMPTY_CABIN: 0, SEATED_BREATHING: 0, WALKING_NORMAL: 0, FALL_STILLNESS: 0 },
    SEATED_BREATHING: { EMPTY_CABIN: 0, SEATED_BREATHING: 0, WALKING_NORMAL: 0, FALL_STILLNESS: 0 },
    WALKING_NORMAL: { EMPTY_CABIN: 0, SEATED_BREATHING: 0, WALKING_NORMAL: 0, FALL_STILLNESS: 0 },
    FALL_STILLNESS: { EMPTY_CABIN: 0, SEATED_BREATHING: 0, WALKING_NORMAL: 0, FALL_STILLNESS: 0 },
  },
  accuracyPct: 0,
  falseAlarmRatePct: 0,
  fallRecallPct: 0,
};

export const App: React.FC = () => {
  const initialCaregiverRoute =
    typeof window !== 'undefined' &&
    (window.location.pathname.startsWith('/caregiver') ||
      new URLSearchParams(window.location.search).get('view') === 'caregiver');

  const [isCaregiverScreen, setIsCaregiverScreen] = useState<boolean>(initialCaregiverRoute);
  const [guardMode, setGuardMode] = useState<GuardMode>('OFFLINE');
  const [activeTab, setActiveTab] = useState<'CONSOLE' | 'BENCHMARK'>('CONSOLE');
  const [viewMode, setViewMode] = useState<'IRONBOW' | 'SONAR3D'>('IRONBOW');
  const [creditLocked, setCreditLocked] = useState<boolean>(true);
  const [autoTriggerEnabled, setAutoTriggerEnabled] = useState<boolean>(false);
  const [showTune, setShowTune] = useState<boolean>(false);
  const [showPairBar, setShowPairBar] = useState<boolean>(false);
  const [lanUrls, setLanUrls] = useState<string[]>([]);
  const [sampleRate, setSampleRate] = useState<number>(48000);
  const [rangeLockM, setRangeLockM] = useState<number>(0); // Auto-track by default so 3D follows you immediately
  const [fallThreshold, setFallThreshold] = useState<number>(4.5);
  const [apneaLimitSec, setApneaLimitSec] = useState<number>(0);
  const [txGain, setTxGain] = useState<number>(0.58);

  // Throttled numeric telemetry (~8 Hz UI refresh while canvas runs @ 60 Hz)
  const [hud, setHud] = useState({
    distanceM: 0,
    azimuthDeg: 0,
    dispMm: 0,
    bpm: null as number | null,
    motionEnergy: 0,
    sonarDb: -60,
    speechDb: -70,
  });

  const [prealertLeftSec, setPrealertLeftSec] = useState<number>(0);
  const [activePromptMl, setActivePromptMl] = useState<string>('');
  const [liveTranscriptMl, setLiveTranscriptMl] = useState<string>('');
  const [vadActive, setVadActive] = useState<boolean>(false);
  const [consentRemainingSec, setConsentRemainingSec] = useState<number>(0);
  const [voiceRmsDb, setVoiceRmsDb] = useState<number>(-65);
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [sarvamCallCount, setSarvamCallCount] = useState<number>(0);
  const [benchmark, setBenchmark] = useState<BenchmarkSummary>(EMPTY_BENCHMARK);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const latestFrameRef = useRef<RadarFrame | null>(null);
  const frameSeqRef = useRef<number>(0);
  const trialSubscriberRef = useRef<((f: RadarFrame) => void) | null>(null);
  const engineRef = useRef<KaavalSonarEngine | null>(null);
  const snapshotGetterRef = useRef<(() => string | undefined) | null>(null);
  const hubWsRef = useRef<WebSocket | null>(null);
  const checkinBusyRef = useRef<boolean>(false);

  // Mutable refs for autonomous physical state machine inside audio callback
  const guardModeRef = useRef<GuardMode>('OFFLINE');
  guardModeRef.current = guardMode;
  const fallThreshRef = useRef<number>(fallThreshold);
  fallThreshRef.current = fallThreshold;
  const apneaLimitRef = useRef<number>(apneaLimitSec);
  apneaLimitRef.current = apneaLimitSec;
  const autoTrigRef = useRef<boolean>(autoTriggerEnabled);
  autoTrigRef.current = autoTriggerEnabled;

  const prealertStateRef = useRef<{
    active: boolean;
    startedMs: number;
    peakMotion: number;
    distanceAtSpike: number;
    bpmBefore: number | null;
    postMotions: number[];
  }>({
    active: false,
    startedMs: 0,
    peakMotion: 0,
    distanceAtSpike: 0.85,
    bpmBefore: null,
    postMotions: [],
  });

  const stillnessSinceMsRef = useRef<number>(performance.now());
  const lastHudUpdateMsRef = useRef<number>(0);
  const lastHubPushMsRef = useRef<number>(0);
  const cooldownUntilMsRef = useRef<number>(0);
  const hudRef = useRef(hud);
  hudRef.current = hud;

  useEffect(() => {
    if (isCaregiverScreen) return;

    fetch('/api/health')
      .then((r) => r.json())
      .then((h) => {
        if (typeof h.creditGuardLocked === 'boolean') setCreditLocked(h.creditGuardLocked);
      })
      .catch(() => {});

    fetch('/api/lan-info')
      .then((r) => r.json())
      .then((info: { lanIps?: string[] }) => {
        const port = window.location.port || '5173';
        const urls = (info.lanIps || []).map((ip) => `http://${ip}:${port}/caregiver`);
        setLanUrls(urls.length ? urls : [`${window.location.origin}/caregiver`]);
      })
      .catch(() => {});

    fetch('/api/incidents')
      .then((r) => r.json())
      .then((d) => {
        if (d.incidents) setIncidents(d.incidents);
        if (d.sarvamStats) setSarvamCallCount(d.sarvamStats.calls);
      })
      .catch(() => {});

    fetch('/api/benchmark')
      .then((r) => r.json())
      .then((d) => {
        if (d && d.trials) setBenchmark(d);
      })
      .catch(() => {});

    // Connect Room Console to /ws/hub so Caregiver Phone reassurances play aloud in Amma's room
    let closed = false;
    let retryId = 0;
    const connectHub = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/hub?role=room`);
      hubWsRef.current = ws;

      ws.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'caregiver_reassurance') {
            if (msg.incidents) setIncidents(msg.incidents);
            if (msg.audioBase64 && !checkinBusyRef.current) {
              if (engineRef.current) {
                engineRef.current.setWorkletMode('VOICE_PAUSE');
                await engineRef.current.playAlertToneAndBase64Audio(msg.audioBase64, true);
                if (!checkinBusyRef.current) {
                  engineRef.current.setWorkletMode('SONAR_LOCKED');
                }
              } else {
                const tmpCtx = new AudioContext();
                const bin = atob(msg.audioBase64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                const buf = await tmpCtx.decodeAudioData(bytes.buffer.slice(0));
                const src = tmpCtx.createBufferSource();
                src.buffer = buf;
                src.connect(tmpCtx.destination);
                src.onended = () => tmpCtx.close();
                src.start();
              }
            }
          }
        } catch {
          // Ignore malformed WS message
        }
      };

      ws.onclose = () => {
        if (!closed) retryId = window.setTimeout(connectHub, 2000);
      };
    };

    connectHub();
    return () => {
      closed = true;
      window.clearTimeout(retryId);
      hubWsRef.current?.close();
    };
  }, [isCaregiverScreen]);

  const runConsentCheckIn = useCallback(
    async (
      trigger: AnomalyTriggerReason,
      distanceMeters: number,
      peakMotionEnergy: number,
      respirationBpmBefore: number | null,
      azimuthDeg?: number
    ) => {
      const engine = engineRef.current;
      if (!engine || checkinBusyRef.current) return;
      checkinBusyRef.current = true;
      const snapshotDataUrl = snapshotGetterRef.current?.();

      try {
        setErrorMsg('');
        setGuardMode('PLAYING_PROMPT');
        setLiveTranscriptMl('');
        setVadActive(false);

        // 1. Pause chirp smoothly so ultrasound never distorts Malayalam TTS
        engine.setWorkletMode('VOICE_PAUSE');

        const promptRes = await fetch(`/api/prompt-audio?trigger=${encodeURIComponent(trigger)}`);
        if (!promptRes.ok) throw new Error(`Prompt fetch failed (${promptRes.status})`);
        const promptData = (await promptRes.json()) as {
          promptMl: string;
          audioBase64: string;
        };
        setActivePromptMl(promptData.promptMl);

        await engine.playAlertToneAndBase64Audio(promptData.audioBase64, true);

        // 2. Open 9.5-second Consent Speech Gate -> stream 16 kHz PCM to Saaras v4 WS
        const windowMs = 9500;
        setGuardMode('LISTENING_CONSENT');
        setConsentRemainingSec(windowMs / 1000);
        const listenStarted = performance.now();
        const countdownId = window.setInterval(() => {
          const rem = Math.max(0, (windowMs - (performance.now() - listenStarted)) / 1000);
          setConsentRemainingSec(rem);
        }, 100);

        const sttResult = await engine.streamConsentWindow(windowMs, (partial, vad) => {
          setLiveTranscriptMl(partial);
          setVadActive(vad);
        });
        window.clearInterval(countdownId);
        setConsentRemainingSec(0);
        setLiveTranscriptMl(sttResult.transcriptMl);

        // 3. Worklet is now locked back to SONAR_LOCKED (<17.5 kHz zeroed). Run Sarvam Triage!
        setGuardMode('TRIAGING_RESPONSE');
        const triageRes = await fetch('/api/triage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trigger,
            transcriptMl: sttResult.transcriptMl,
            distanceMeters,
            azimuthDeg: azimuthDeg ?? hudRef.current.azimuthDeg,
            snapshotDataUrl,
            peakMotionEnergy,
            respirationBpmBefore,
            sttLatencyMs: sttResult.sttLatencyMs,
            sttModelUsed: sttResult.sttModelUsed,
          }),
        });

        if (!triageRes.ok) throw new Error(`Triage failed (${triageRes.status})`);
        const triageJson = await triageRes.json();
        if (triageJson.incidents) setIncidents(triageJson.incidents);
        if (triageJson.sarvamStats) setSarvamCallCount(triageJson.sarvamStats.calls);

        const rec: IncidentRecord = triageJson.record;

        if (rec.replyAudioBase64) {
          engine.setWorkletMode('VOICE_PAUSE');
          await engine.playAlertToneAndBase64Audio(rec.replyAudioBase64, false);
          engine.setWorkletMode('SONAR_LOCKED');
        }

        setGuardMode(
          rec.classification === 'SAFE' ? 'RESOLVED_SAFE' : 'EMERGENCY_DISPATCHED'
        );
        cooldownUntilMsRef.current = performance.now() + 8000;
        window.setTimeout(() => {
          if (
            guardModeRef.current === 'RESOLVED_SAFE' ||
            guardModeRef.current === 'EMERGENCY_DISPATCHED'
          ) {
            setGuardMode('ARMED_MONITORING');
          }
        }, 6500);
      } catch (err) {
        setErrorMsg((err as Error).message);
        engine.setWorkletMode('SONAR_LOCKED');
        setGuardMode('ARMED_MONITORING');
      } finally {
        checkinBusyRef.current = false;
      }
    },
    []
  );

  const handleRadarFrame = useCallback(
    (frame: RadarFrame) => {
      latestFrameRef.current = frame;
      frameSeqRef.current += 1;
      if (trialSubscriberRef.current) {
        trialSubscriberRef.current(frame);
      }

      const now = performance.now();
      if (now - lastHudUpdateMsRef.current > 120) {
        lastHudUpdateMsRef.current = now;
        setHud({
          distanceM: frame.targetMeters,
          azimuthDeg: frame.targetAzimuthDeg,
          dispMm: frame.displacementMm,
          bpm: frame.respirationBpm,
          motionEnergy: frame.motionEnergy,
          sonarDb: frame.sonarDb,
          speechDb: frame.speechDb,
        });
      }

      if (
        now - lastHubPushMsRef.current > 420 &&
        hubWsRef.current?.readyState === WebSocket.OPEN
      ) {
        lastHubPushMsRef.current = now;
        hubWsRef.current.send(
          JSON.stringify({
            type: 'room_telemetry',
            data: {
              guardMode: guardModeRef.current,
              distanceM: frame.targetMeters,
              azimuthDeg: frame.targetAzimuthDeg,
              bpm: frame.respirationBpm,
              motionEnergy: frame.motionEnergy,
            },
          })
        );
      }

      // Autonomous physical anomaly evaluation ONLY when Auto-Trigger is enabled & armed
      const mode = guardModeRef.current;
      if (
        !autoTrigRef.current ||
        (mode !== 'ARMED_MONITORING' && mode !== 'ANOMALY_PREALERT') ||
        now < cooldownUntilMsRef.current
      ) {
        stillnessSinceMsRef.current = now;
        return;
      }

      // 1. Evaluate active 4.0-second Post-Impact Recovery Window
      const pre = prealertStateRef.current;
      if (pre.active) {
        const elapsedSec = (now - pre.startedMs) / 1000;
        setPrealertLeftSec(Math.max(0, 4.0 - elapsedSec));
        if (frame.motionEnergy > pre.peakMotion) pre.peakMotion = frame.motionEnergy;
        if (elapsedSec > 1.1) {
          pre.postMotions.push(frame.motionEnergy);
        }

        if (elapsedSec >= 4.0) {
          pre.active = false;
          const tailMean =
            pre.postMotions.reduce((a, b) => a + b, 0) / Math.max(1, pre.postMotions.length);
          // If resident continued walking (tailMean >= 1.55), cancel pre-alert silently!
          if (tailMean >= 1.55) {
            setGuardMode('ARMED_MONITORING');
          } else {
            runConsentCheckIn(
              'FALL_IMPACT_AND_STILLNESS',
              pre.distanceAtSpike,
              pre.peakMotion,
              pre.bpmBefore
            );
          }
        }
        return;
      }

      // 2. Detect new high-energy Fall / Sudden Slump Impulse
      if (frame.motionEnergy >= fallThreshRef.current) {
        pre.active = true;
        pre.startedMs = now;
        pre.peakMotion = frame.motionEnergy;
        pre.distanceAtSpike = frame.targetMeters;
        pre.bpmBefore = frame.respirationBpm;
        pre.postMotions = [];
        setPrealertLeftSec(4.0);
        setGuardMode('ANOMALY_PREALERT');
        return;
      }

      // 3. Optional Prolonged Absence of Respiration / Stillness Timer
      if (apneaLimitRef.current > 0) {
        if (frame.motionEnergy > 0.75 || frame.respirationBpm !== null) {
          stillnessSinceMsRef.current = now;
        } else if ((now - stillnessSinceMsRef.current) / 1000 >= apneaLimitRef.current) {
          stillnessSinceMsRef.current = now;
          runConsentCheckIn(
            'PROLONGED_ABSENCE_OF_RESPIRATION',
            frame.targetMeters,
            frame.motionEnergy,
            null
          );
        }
      }
    },
    [runConsentCheckIn]
  );

  const armSonar = async () => {
    try {
      setErrorMsg('');
      if (!engineRef.current) {
        engineRef.current = new KaavalSonarEngine(handleRadarFrame, (rmsDb) =>
          setVoiceRmsDb(rmsDb)
        );
      }
      const info = await engineRef.current.start(rangeLockM);
      setSampleRate(info.sampleRate);
      stillnessSinceMsRef.current = performance.now();
      setGuardMode('ARMED_MONITORING');
    } catch (err) {
      setErrorMsg('Mic/AudioWorklet error: ' + (err as Error).message);
    }
  };

  if (isCaregiverScreen) {
    return <CaregiverView onBackToConsole={() => setIsCaregiverScreen(false)} />;
  }

  const sonarArmed = guardMode !== 'OFFLINE';
  const ledClass =
    guardMode === 'OFFLINE'
      ? ''
      : guardMode === 'ANOMALY_PREALERT'
      ? 'on-amber'
      : guardMode === 'ARMED_MONITORING' || guardMode === 'RESOLVED_SAFE'
      ? 'on-teal'
      : 'on-red';

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">KAAVAL</span>
          <span className="brand-ml">കാവൽ</span>
          <span className="status-inline">
            <span className={`led ${ledClass}`} />
            <span>
              {guardMode === 'ANOMALY_PREALERT'
                ? `PRE-ALERT ${prealertLeftSec.toFixed(1)}s`
                : guardMode.replaceAll('_', ' ')}
            </span>
          </span>
          {errorMsg && <span className="err-inline">{errorMsg}</span>}
        </div>

        <div className="toolbar">
          {!sonarArmed ? (
            <button className="btn-arm" onClick={armSonar}>
              ARM SONAR
            </button>
          ) : (
            <button onClick={() => engineRef.current?.zeroClutter()}>ZERO CLUTTER</button>
          )}

          <button
            className={!creditLocked ? 'btn-danger' : 'btn-tab-active'}
            onClick={async () => {
              const next = !creditLocked;
              const r = await fetch('/api/credit-guard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locked: next }),
              });
              const d = await r.json();
              setCreditLocked(Boolean(d.creditGuardLocked));
            }}
            title="Protects your 500 Sarvam credits during testing. Switch to SARVAM LIVE only for voice rehearsal & judging."
          >
            {creditLocked ? 'CREDITS LOCKED (0 CR)' : 'SARVAM LIVE'}
          </button>

          <button
            className={autoTriggerEnabled ? 'btn-tab-active' : ''}
            onClick={() => setAutoTriggerEnabled((v) => !v)}
            title="Enable autonomous fall -> voice trigger when ready to demo"
          >
            {autoTriggerEnabled ? 'AUTO-FALL: ON' : 'AUTO-FALL: PAUSED'}
          </button>

          <button
            className="btn-danger"
            disabled={
              !sonarArmed ||
              guardMode === 'LISTENING_CONSENT' ||
              guardMode === 'PLAYING_PROMPT' ||
              guardMode === 'TRIAGING_RESPONSE'
            }
            onClick={() =>
              runConsentCheckIn(
                'MANUAL_VERIFICATION_TEST',
                hud.distanceM,
                hud.motionEnergy,
                hud.bpm,
                hud.azimuthDeg
              )
            }
          >
            VOICE CHECK-IN
          </button>

          <button
            className={showPairBar ? 'btn-tab-active' : ''}
            onClick={() => setShowPairBar((v) => !v)}
          >
            PAIR PHONE
          </button>

          <button
            className={showTune ? 'btn-tab-active' : ''}
            onClick={() => setShowTune((v) => !v)}
          >
            TUNE
          </button>

          <button
            className={activeTab === 'CONSOLE' && viewMode === 'IRONBOW' ? 'btn-tab-active' : ''}
            onClick={() => {
              setActiveTab('CONSOLE');
              setViewMode('IRONBOW');
            }}
          >
            IRONBOW
          </button>
          <button
            className={activeTab === 'CONSOLE' && viewMode === 'SONAR3D' ? 'btn-tab-active' : ''}
            onClick={() => {
              setActiveTab('CONSOLE');
              setViewMode('SONAR3D');
            }}
          >
            3D SONAR
          </button>
          <button
            className={activeTab === 'BENCHMARK' ? 'btn-tab-active' : ''}
            onClick={() => setActiveTab('BENCHMARK')}
          >
            EVAL ({benchmark.trials.length})
          </button>
        </div>
      </header>

      {showPairBar && (
        <div className="pair-bar">
          <div>
            <strong>JUDGE / CAREGIVER PHONE URL (SAME HOTSPOT):</strong>{' '}
            {lanUrls.map((u) => (
              <a
                key={u}
                href={u}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#14b8a6', marginRight: 12 }}
              >
                {u}
              </a>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => window.open('/caregiver', '_blank', 'width=430,height=780')}>
              OPEN PHONE WINDOW
            </button>
            <button onClick={() => setIsCaregiverScreen(true)}>SWITCH THIS TAB</button>
          </div>
        </div>
      )}

      {showTune && (
        <div className="tune-drawer">
          <label className="ctrl-inline">
            Range Gate:
            <select
              value={rangeLockM}
              onChange={(e) => {
                const m = parseFloat(e.target.value);
                setRangeLockM(m);
                engineRef.current?.setRangeLock(m);
              }}
            >
              <option value={0}>Auto-Track</option>
              <option value={0.55}>0.55 m</option>
              <option value={0.85}>0.85 m</option>
              <option value={1.25}>1.25 m</option>
              <option value={1.8}>1.80 m</option>
            </select>
          </label>

          <label className="ctrl-inline">
            Fall Trigger ({fallThreshold.toFixed(1)}):
            <input
              type="range"
              min="2.5"
              max="10"
              step="0.5"
              value={fallThreshold}
              onChange={(e) => setFallThreshold(parseFloat(e.target.value))}
            />
          </label>

          <label className="ctrl-inline">
            Apnea Watch:
            <select
              value={apneaLimitSec}
              onChange={(e) => {
                stillnessSinceMsRef.current = performance.now();
                setApneaLimitSec(Number(e.target.value));
              }}
            >
              <option value={0}>Off</option>
              <option value={12}>12s (Demo)</option>
              <option value={30}>30s (Cabin)</option>
              <option value={2700}>45m (Home)</option>
            </select>
          </label>

          <label className="ctrl-inline">
            TX Gain ({Math.round(txGain * 100)}%):
            <input
              type="range"
              min="0.15"
              max="0.9"
              step="0.05"
              value={txGain}
              onChange={(e) => {
                const g = parseFloat(e.target.value);
                setTxGain(g);
                engineRef.current?.setGain(g);
              }}
            />
          </label>

          <button onClick={() => engineRef.current?.recalibrateDirectPath()}>
            RE-LOCK DIRECT PATH
          </button>

          <span className="mono" style={{ fontSize: 10, color: '#566579', marginLeft: 'auto' }}>
            {sampleRate} Hz · Sarvam Calls: {sarvamCallCount}
          </span>
        </div>
      )}

      <section className="metric-bar">
        <div className="metric-cell">
          <span className="readout-k">Position</span>
          <span className="metric-val teal">
            {sonarArmed
              ? `${hud.distanceM.toFixed(2)}m · ${hud.azimuthDeg >= 0 ? '+' : ''}${hud.azimuthDeg.toFixed(0)}°`
              : '--'}
          </span>
        </div>
        <div className="metric-cell">
          <span className="readout-k">Chest Phase</span>
          <span className="metric-val">
            {sonarArmed ? `${hud.dispMm >= 0 ? '+' : ''}${hud.dispMm.toFixed(2)} mm` : '--'}
          </span>
        </div>
        <div className="metric-cell">
          <span className="readout-k">Respiration</span>
          <span className="metric-val teal">
            {hud.bpm ? `${hud.bpm.toFixed(0)} BPM` : sonarArmed ? 'ACQUIRING' : '--'}
          </span>
        </div>
        <div className="metric-cell">
          <span className="readout-k">Motion</span>
          <span className={`metric-val ${hud.motionEnergy >= fallThreshold ? 'amber' : ''}`}>
            {sonarArmed ? hud.motionEnergy.toFixed(2) : '--'}
          </span>
        </div>
        <div className="metric-cell">
          <span className="readout-k">Speech (&lt;17.5 kHz)</span>
          <span className="metric-val red">
            {guardMode === 'LISTENING_CONSENT'
              ? `OPEN ${consentRemainingSec.toFixed(0)}s`
              : 'ZEROED'}
          </span>
        </div>
      </section>

      {activeTab === 'CONSOLE' ? (
        <main className="console-layout">
          <div>
            {viewMode === 'IRONBOW' ? (
              <SonicIronbowView
                latestFrameRef={latestFrameRef}
                frameSeqRef={frameSeqRef}
                guardMode={guardMode}
                sonarArmed={sonarArmed}
                snapshotGetterRef={snapshotGetterRef}
              />
            ) : (
              <SpatialField3D
                latestFrameRef={latestFrameRef}
                frameSeqRef={frameSeqRef}
                guardMode={guardMode}
                sonarArmed={sonarArmed}
              />
            )}
            <RadarScopes
              latestFrameRef={latestFrameRef}
              frameSeqRef={frameSeqRef}
              guardMode={guardMode}
              fallThreshold={fallThreshold}
            />
          </div>
          <TriageTimeline
            guardMode={guardMode}
            activePromptMl={activePromptMl}
            liveTranscriptMl={liveTranscriptMl}
            vadActive={vadActive}
            consentRemainingSec={consentRemainingSec}
            voiceRmsDb={voiceRmsDb}
            incidents={incidents}
            onReplayAudio={async (b64) => {
              if (!engineRef.current) return;
              engineRef.current.setWorkletMode('VOICE_PAUSE');
              await engineRef.current.playAlertToneAndBase64Audio(b64, false);
              engineRef.current.setWorkletMode('SONAR_LOCKED');
            }}
          />
        </main>
      ) : (
        <BenchmarkPanel
          summary={benchmark}
          sonarArmed={sonarArmed}
          subscribeFrames={(cb) => {
            trialSubscriberRef.current = cb;
          }}
          onSummaryUpdated={setBenchmark}
        />
      )}
    </div>
  );
};
