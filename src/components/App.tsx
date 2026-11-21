import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KaavalSonarEngine } from '../audio/sonarEngine';
import type {
  AnomalyTriggerReason,
  BenchmarkSummary,
  GuardMode,
  IncidentRecord,
  RadarFrame,
} from '../types';
import {
  IconMicCheck,
  IconPhonePair,
  IconSliders,
  IconSonarWave,
  KaavalNavbarBrand,
} from './BrandAndIcons';
import { SaasOverview } from './SaasOverview';
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

function formatGuardStatus(mode: GuardMode, prealertLeftSec: number): string {
  switch (mode) {
    case 'OFFLINE':
      return 'Standby (0 px cam)';
    case 'ARMED_MONITORING':
      return 'Sonar armed';
    case 'ANOMALY_PREALERT':
      return `Pre-alert ${prealertLeftSec.toFixed(1)}s`;
    case 'PLAYING_PROMPT':
      return 'Asking in Malayalam';
    case 'LISTENING_CONSENT':
      return 'Listening (9.5s gate)';
    case 'TRIAGING_RESPONSE':
      return 'Sarvam triage';
    case 'RESOLVED_SAFE':
      return 'Verified safe';
    case 'EMERGENCY_DISPATCHED':
      return 'Emergency alerted';
  }
}

export const App: React.FC = () => {
  const initialCaregiverRoute =
    typeof window !== 'undefined' &&
    (window.location.pathname.startsWith('/caregiver') ||
      new URLSearchParams(window.location.search).get('view') === 'caregiver');

  const initialTab =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('view') === 'console'
      ? 'CONSOLE'
      : 'OVERVIEW';

  const [isCaregiverScreen, setIsCaregiverScreen] = useState<boolean>(initialCaregiverRoute);
  const [guardMode, setGuardMode] = useState<GuardMode>('OFFLINE');
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'CONSOLE' | 'BENCHMARK'>(initialTab);
  const [viewMode, setViewMode] = useState<'IRONBOW' | 'SONAR3D'>('IRONBOW');
  const [creditLocked, setCreditLocked] = useState<boolean>(true);
  const [autoTriggerEnabled, setAutoTriggerEnabled] = useState<boolean>(false);
  const [showTune, setShowTune] = useState<boolean>(false);
  const [showPairBar, setShowPairBar] = useState<boolean>(false);
  const [lanUrls, setLanUrls] = useState<string[]>([]);
  const [sampleRate, setSampleRate] = useState<number>(48000);
  const [rangeLockM, setRangeLockM] = useState<number>(0);
  const [fallThreshold, setFallThreshold] = useState<number>(4.5);
  const [apneaLimitSec, setApneaLimitSec] = useState<number>(0);
  const [txGain, setTxGain] = useState<number>(0.72);

  // Throttled numeric telemetry (~8 Hz UI refresh while canvas runs @ 60 Hz)
  const [hud, setHud] = useState({
    peopleCount: 0,
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

        engine.setWorkletMode('VOICE_PAUSE');

        const promptRes = await fetch(`/api/prompt-audio?trigger=${encodeURIComponent(trigger)}`);
        if (!promptRes.ok) throw new Error(`Prompt fetch failed (${promptRes.status})`);
        const promptData = (await promptRes.json()) as {
          promptMl: string;
          audioBase64: string;
        };
        setActivePromptMl(promptData.promptMl);

        await engine.playAlertToneAndBase64Audio(promptData.audioBase64, true);

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
          peopleCount: frame.peopleCount,
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

      const mode = guardModeRef.current;
      if (
        !autoTrigRef.current ||
        (mode !== 'ARMED_MONITORING' && mode !== 'ANOMALY_PREALERT') ||
        now < cooldownUntilMsRef.current
      ) {
        stillnessSinceMsRef.current = now;
        return;
      }

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
      setErrorMsg('AudioWorklet error: ' + (err as Error).message);
    }
  };

  const armAndOpenConsole = async () => {
    setActiveTab('CONSOLE');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (guardMode === 'OFFLINE') {
      await armSonar();
    }
  };

  const toggleCreditGuard = async () => {
    const next = !creditLocked;
    const r = await fetch('/api/credit-guard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked: next }),
    });
    const d = await r.json();
    setCreditLocked(Boolean(d.creditGuardLocked));
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
    <div>
      {/* Sticky GrowthX Offcampus SaaS Navigation Bar */}
      <header className={`gx-nav-wrap ${activeTab === 'OVERVIEW' ? 'on-blue' : ''}`}>
        <nav className="gx-nav" aria-label="Primary product navigation">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <KaavalNavbarBrand
              onClick={() => {
                setActiveTab('OVERVIEW');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />

            <span className="status-inline">
              <span className={`led ${ledClass}`} />
              <span>{formatGuardStatus(guardMode, prealertLeftSec)}</span>
            </span>

            {errorMsg && <span className="err-inline">{errorMsg}</span>}
          </div>

          <div className="gx-nav-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'OVERVIEW'}
              className={`gx-nav-tab ${activeTab === 'OVERVIEW' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('OVERVIEW');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              Product overview
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'CONSOLE'}
              className={`gx-nav-tab ${activeTab === 'CONSOLE' ? 'active' : ''}`}
              onClick={() => setActiveTab('CONSOLE')}
            >
              Live console
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'BENCHMARK'}
              className={`gx-nav-tab ${activeTab === 'BENCHMARK' ? 'active' : ''}`}
              onClick={() => setActiveTab('BENCHMARK')}
            >
              Benchmark ({benchmark.trials.length})
            </button>
            <button
              type="button"
              className="gx-nav-tab"
              onClick={() => setIsCaregiverScreen(true)}
            >
              Caregiver app
            </button>
          </div>

          <div className="gx-nav-actions">
            <button
              type="button"
              className={creditLocked ? '' : 'btn-green'}
              onClick={toggleCreditGuard}
              title="Protects Sarvam API credits while testing sonar. Toggle to Sarvam live only for spoken voice check-in demos."
            >
              {creditLocked ? '0-credit lock' : 'Sarvam live'}
            </button>

            {activeTab === 'OVERVIEW' ? (
              <button
                type="button"
                className="btn-arm"
                onClick={sonarArmed ? () => setActiveTab('CONSOLE') : armAndOpenConsole}
              >
                <IconSonarWave size={16} />
                {sonarArmed ? 'Open console' : 'Arm sonar'}
              </button>
            ) : (
              <>
                {!sonarArmed ? (
                  <button type="button" className="btn-arm" onClick={armSonar}>
                    <IconSonarWave size={16} />
                    Arm sonar
                  </button>
                ) : (
                  <button type="button" onClick={() => engineRef.current?.zeroClutter()}>
                    Zero room clutter
                  </button>
                )}

                <button
                  type="button"
                  className={autoTriggerEnabled ? 'btn-green' : ''}
                  onClick={() => setAutoTriggerEnabled((v) => !v)}
                  title="Enable autonomous fall + stillness voice check-in"
                >
                  {autoTriggerEnabled ? 'Auto-fall: on' : 'Auto-fall: paused'}
                </button>

                <button
                  type="button"
                  className="btn-lilac"
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
                  <IconMicCheck size={16} />
                  Voice check-in
                </button>

                <button
                  type="button"
                  className={showPairBar ? 'btn-tab-active' : ''}
                  onClick={() => setShowPairBar((v) => !v)}
                >
                  <IconPhonePair size={16} />
                  Pair phone
                </button>

                <button
                  type="button"
                  className={showTune ? 'btn-tab-active' : ''}
                  onClick={() => setShowTune((v) => !v)}
                >
                  <IconSliders size={16} />
                  Tune
                </button>
              </>
            )}
          </div>
        </nav>
      </header>

      {activeTab === 'OVERVIEW' ? (
        <SaasOverview
          sonarArmed={sonarArmed}
          benchmarkTrialsCount={benchmark.trials.length}
          onOpenConsole={() => {
            setActiveTab('CONSOLE');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onArmAndOpenConsole={armAndOpenConsole}
          onOpenCaregiver={() => {
            setIsCaregiverScreen(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onOpenBenchmark={() => {
            setActiveTab('BENCHMARK');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      ) : (
        <div className="shell">
          {showPairBar && (
            <div className="pair-bar">
              <div>
                <strong>Caregiver phone link (same Wi-Fi hotspot):</strong>{' '}
                {lanUrls.map((u) => (
                  <a
                    key={u}
                    href={u}
                    target="_blank"
                    rel="noreferrer"
                    className="mono"
                    style={{
                      color: 'var(--blue)',
                      fontWeight: 600,
                      marginLeft: 8,
                      marginRight: 12,
                      textDecorationThickness: '2px',
                    }}
                  >
                    {u}
                  </a>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => window.open('/caregiver', '_blank', 'width=430,height=780')}
                >
                  Open phone window
                </button>
                <button type="button" onClick={() => setIsCaregiverScreen(true)}>
                  Switch this tab
                </button>
              </div>
            </div>
          )}

          {showTune && (
            <div className="tune-drawer">
              <label className="ctrl-inline">
                Range gate:
                <select
                  value={rangeLockM}
                  onChange={(e) => {
                    const m = parseFloat(e.target.value);
                    setRangeLockM(m);
                    engineRef.current?.setRangeLock(m);
                  }}
                >
                  <option value={0}>Auto-track (0.32–3.0m)</option>
                  <option value={0.55}>0.55 m</option>
                  <option value={0.85}>0.85 m</option>
                  <option value={1.25}>1.25 m</option>
                  <option value={1.8}>1.80 m</option>
                </select>
              </label>

              <label className="ctrl-inline">
                Fall threshold ({fallThreshold.toFixed(1)}):
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
                Apnea watch:
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
                Speaker gain ({Math.round(txGain * 100)}%):
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

              <button type="button" onClick={() => engineRef.current?.recalibrateDirectPath()}>
                Re-lock direct path
              </button>

              <span
                className="mono"
                style={{ fontSize: 11.5, color: 'var(--muted)', marginLeft: 'auto' }}
              >
                {sampleRate} Hz · Sarvam calls: {sarvamCallCount}
              </span>
            </div>
          )}

          <section className="metric-bar" aria-label="Live room telemetry">
            <div className="metric-cell">
              <span className="readout-k">Room occupancy</span>
              <span className="metric-val teal">
                {!sonarArmed
                  ? '--'
                  : hud.peopleCount === 0
                  ? '0 (Empty)'
                  : `${hud.peopleCount} · ${hud.distanceM.toFixed(2)}m (${
                      hud.azimuthDeg >= 0 ? '+' : ''
                    }${hud.azimuthDeg.toFixed(0)}°)`}
              </span>
            </div>
            <div className="metric-cell">
              <span className="readout-k">Chest phase</span>
              <span className="metric-val">
                {sonarArmed ? `${hud.dispMm >= 0 ? '+' : ''}${hud.dispMm.toFixed(2)} mm` : '--'}
              </span>
            </div>
            <div className="metric-cell">
              <span className="readout-k">Respiration</span>
              <span className="metric-val teal">
                {hud.bpm ? `${hud.bpm.toFixed(0)} BPM` : sonarArmed ? 'Acquiring' : '--'}
              </span>
            </div>
            <div className="metric-cell">
              <span className="readout-k">Motion impulse</span>
              <span className={`metric-val ${hud.motionEnergy >= fallThreshold ? 'amber' : ''}`}>
                {sonarArmed ? hud.motionEnergy.toFixed(2) : '--'}
              </span>
            </div>
            <div className="metric-cell">
              <span className="readout-k">Speech (&lt;17.5 kHz)</span>
              <span className="metric-val red">
                {guardMode === 'LISTENING_CONSENT'
                  ? `Open ${consentRemainingSec.toFixed(0)}s`
                  : 'Zeroed'}
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
                    onSwitchTo3D={() => setViewMode('SONAR3D')}
                    onRequestArm={armSonar}
                  />
                ) : (
                  <SpatialField3D
                    latestFrameRef={latestFrameRef}
                    frameSeqRef={frameSeqRef}
                    guardMode={guardMode}
                    sonarArmed={sonarArmed}
                    onSwitchToIronbow={() => setViewMode('IRONBOW')}
                    onRequestArm={armSonar}
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
              onRequestArm={armSonar}
              subscribeFrames={(cb) => {
                trialSubscriberRef.current = cb;
              }}
              onSummaryUpdated={setBenchmark}
            />
          )}
        </div>
      )}
    </div>
  );
};
