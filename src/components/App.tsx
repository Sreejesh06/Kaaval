import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KaavalSonarEngine } from '../audio/sonarEngine';
import { getFilteredSatelliteTargets } from '../audio/fusion';
import type {
  AnomalyTriggerReason,
  BenchmarkSummary,
  GuardMode,
  IncidentRecord,
  IndianLangCode,
  RadarFrame,
  SatelliteTelemetry,
} from '../types';
import { INDIAN_LANGUAGES } from '../languages';
import { ArborFooter, ArborNavbar, type ArborRoute } from './ArborChrome';
import { IconMicCheck, IconPhonePair, IconSliders } from './BrandAndIcons';
import { QrCodeSvg } from './QrCodeSvg';
import { SaasOverview } from './SaasOverview';
import { RadarScopes } from './RadarScopes';
import { SonicIronbowView } from './SonicIronbowView';
import { SpatialField3D } from './SpatialField3D';
import { TriageTimeline } from './TriageTimeline';
import { BenchmarkPanel } from './BenchmarkPanel';
import { CaregiverView } from './CaregiverView';
import { SatelliteNodeView } from './SatelliteNodeView';

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

function resolveRouteFromUrl(): ArborRoute {
  if (typeof window === 'undefined') return 'OVERVIEW';
  const path = window.location.pathname;
  const view = new URLSearchParams(window.location.search).get('view');
  if (path.startsWith('/caregiver') || view === 'caregiver') return 'CAREGIVER';
  if (path.startsWith('/satellite') || view === 'satellite') return 'SATELLITE';
  if (view === 'console') return 'CONSOLE';
  if (view === 'benchmark') return 'BENCHMARK';
  return 'OVERVIEW';
}

function routeToPath(route: ArborRoute): string {
  switch (route) {
    case 'CAREGIVER':
      return '/caregiver';
    case 'SATELLITE':
      return '/satellite';
    case 'CONSOLE':
      return '/?view=console';
    case 'BENCHMARK':
      return '/?view=benchmark';
    case 'OVERVIEW':
    default:
      return '/';
  }
}

function formatGuardStatus(mode: GuardMode, prealertLeftSec: number): string {
  switch (mode) {
    case 'OFFLINE':
      return 'Standby · 0 px cam';
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
  const [activeRoute, setActiveRoute] = useState<ArborRoute>(resolveRouteFromUrl);
  const [guardMode, setGuardMode] = useState<GuardMode>('OFFLINE');
  const [viewMode, setViewMode] = useState<'IRONBOW' | 'SONAR3D'>('IRONBOW');
  const [elderLang, setElderLang] = useState<IndianLangCode>('ml-IN');
  const [autoDetectSpeech, setAutoDetectSpeech] = useState<boolean>(false);
  const [creditLocked, setCreditLocked] = useState<boolean>(true);
  const [autoTriggerEnabled, setAutoTriggerEnabled] = useState<boolean>(false);
  const [showTune, setShowTune] = useState<boolean>(false);
  const [showPairBar, setShowPairBar] = useState<boolean>(false);
  const [lanUrls, setLanUrls] = useState<string[]>([]);
  const [satHttpsUrls, setSatHttpsUrls] = useState<string[]>([]);
  const [satConnected, setSatConnected] = useState<boolean>(false);
  const [satArmed, setSatArmed] = useState<boolean>(false);
  const [sampleRate, setSampleRate] = useState<number>(48000);
  const [rangeLockM, setRangeLockM] = useState<number>(0);
  const [maxZoneM, setMaxZoneM] = useState<number>(3.0);
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
  const [waStatus, setWaStatus] = useState<{
    configured: boolean;
    recipient: string;
    sending: boolean;
    feedback: string;
  }>({ configured: false, recipient: '', sending: false, feedback: '' });
  const [benchmark, setBenchmark] = useState<BenchmarkSummary>(EMPTY_BENCHMARK);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const latestFrameRef = useRef<RadarFrame | null>(null);
  const satelliteRef = useRef<SatelliteTelemetry | null>(null);
  const frameSeqRef = useRef<number>(0);
  const trialSubscriberRef = useRef<((f: RadarFrame) => void) | null>(null);
  const engineRef = useRef<KaavalSonarEngine | null>(null);
  const snapshotGetterRef = useRef<(() => string | undefined) | null>(null);
  const hubWsRef = useRef<WebSocket | null>(null);
  const checkinBusyRef = useRef<boolean>(false);

  const guardModeRef = useRef<GuardMode>('OFFLINE');
  guardModeRef.current = guardMode;
  const fallThreshRef = useRef<number>(fallThreshold);
  fallThreshRef.current = fallThreshold;
  const apneaLimitRef = useRef<number>(apneaLimitSec);
  apneaLimitRef.current = apneaLimitSec;
  const autoTrigRef = useRef<boolean>(autoTriggerEnabled);
  autoTrigRef.current = autoTriggerEnabled;
  const satArmedRef = useRef<boolean>(satArmed);
  satArmedRef.current = satArmed;
  const elderLangRef = useRef<IndianLangCode>(elderLang);
  elderLangRef.current = elderLang;
  const autoDetectRef = useRef<boolean>(autoDetectSpeech);
  autoDetectRef.current = autoDetectSpeech;

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

  const navigateTo = useCallback((next: ArborRoute) => {
    setActiveRoute(next);
    const targetPath = routeToPath(next);
    if (window.location.pathname + window.location.search !== targetPath) {
      window.history.pushState(null, '', targetPath);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onPop = () => setActiveRoute(resolveRouteFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const [bootedStandaloneMobileCompanion] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const initial = resolveRouteFromUrl();
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    return isMobile && (initial === 'CAREGIVER' || initial === 'SATELLITE');
  });

  useEffect(() => {
    if (bootedStandaloneMobileCompanion) return;

    fetch('/api/health')
      .then((r) => r.json())
      .then((h) => {
        if (typeof h.creditGuardLocked === 'boolean') setCreditLocked(h.creditGuardLocked);
        if (h.elderLang) setElderLang(h.elderLang as IndianLangCode);
        if (typeof h.autoDetectSpeech === 'boolean') setAutoDetectSpeech(h.autoDetectSpeech);
        if (typeof h.whatsappConfigured === 'boolean') {
          setWaStatus((prev) => ({
            ...prev,
            configured: h.whatsappConfigured,
            recipient: h.whatsappRecipient || '',
          }));
        }
      })
      .catch(() => { });

    fetch('/api/lan-info')
      .then((r) => r.json())
      .then((info: { lanIps?: string[]; httpsPort?: number }) => {
        const port = window.location.port || '5173';
        const hPort = info.httpsPort || 5443;
        const ips = info.lanIps || [];
        const cgUrls = ips.map((ip) => `http://${ip}:${port}/caregiver`);
        const satUrls = ips.map((ip) => `https://${ip}:${hPort}/satellite`);
        setLanUrls(cgUrls.length ? cgUrls : [`${window.location.origin}/caregiver`]);
        setSatHttpsUrls(
          satUrls.length ? satUrls : [`https://${window.location.hostname}:${hPort}/satellite`]
        );
      })
      .catch(() => { });

    fetch('/api/incidents')
      .then((r) => r.json())
      .then((d) => {
        if (d.incidents) setIncidents(d.incidents);
        if (d.sarvamStats) setSarvamCallCount(d.sarvamStats.calls);
      })
      .catch(() => { });

    fetch('/api/benchmark')
      .then((r) => r.json())
      .then((d) => {
        if (d && d.trials) setBenchmark(d);
      })
      .catch(() => { });

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
          if (msg.type === 'room_language') {
            if (msg.elderLang) setElderLang(msg.elderLang as IndianLangCode);
            if (typeof msg.autoDetectSpeech === 'boolean') {
              setAutoDetectSpeech(msg.autoDetectSpeech);
            }
            return;
          }
          if (msg.type === 'satellite_status') {
            const conn = Boolean(msg.connected);
            const arm = Boolean(msg.armed);
            setSatConnected(conn);
            setSatArmed(arm);
            satelliteRef.current = conn && arm && msg.telemetry ? msg.telemetry : null;
            engineRef.current?.setNodeProfile(arm ? 'HOST_DUAL_STEREO' : 'SOLO_STEREO');
          } else if (msg.type === 'satellite_telemetry' && msg.data) {
            setSatConnected(true);
            setSatArmed(Boolean(msg.data.armed));
            satelliteRef.current = msg.data;
            frameSeqRef.current += 1;
            engineRef.current?.setNodeProfile(
              msg.data.armed ? 'HOST_DUAL_STEREO' : 'SOLO_STEREO'
            );
          } else if (msg.type === 'caregiver_reassurance') {
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
  }, [bootedStandaloneMobileCompanion]);

  const notifySatelliteVoiceGate = (paused: boolean) => {
    if (hubWsRef.current?.readyState === WebSocket.OPEN) {
      hubWsRef.current.send(JSON.stringify({ type: 'room_voice_gate', paused }));
    }
  };

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
        notifySatelliteVoiceGate(true);

        const currentLang = elderLangRef.current;
        const currentAuto = autoDetectRef.current;

        const promptRes = await fetch(
          `/api/prompt-audio?trigger=${encodeURIComponent(trigger)}&lang=${encodeURIComponent(
            currentLang
          )}`
        );
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

        const sttResult = await engine.streamConsentWindow(
          windowMs,
          (partial, vad) => {
            setLiveTranscriptMl(partial);
            setVadActive(vad);
          },
          currentLang,
          currentAuto
        );
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
            elderLang: currentLang,
            ...(sttResult.detectedLang ? { detectedLang: sttResult.detectedLang } : {}),
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
        notifySatelliteVoiceGate(false);
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
      const sat = satelliteRef.current;
      const satFresh = sat && sat.armed && Date.now() - sat.updatedAtMs < 3500 ? sat : null;
      const dedupedSatTargets = getFilteredSatelliteTargets(
        frame.targets || [],
        satFresh,
        true
      );
      const combinedPeople = frame.peopleCount + dedupedSatTargets.length;
      const useBacksidePrimary = frame.peopleCount === 0 && dedupedSatTargets.length > 0;
      const fusedDistM = useBacksidePrimary
        ? dedupedSatTargets[0].distanceMeters
        : frame.peopleCount > 0
          ? frame.targetMeters
          : 0;
      const fusedAzDeg = useBacksidePrimary ? 180 : frame.targetAzimuthDeg;
      const fusedBpm = frame.respirationBpm ?? (satFresh ? satFresh.respirationBpm : null);
      const fusedMotion = Math.max(frame.motionEnergy, satFresh ? satFresh.motionEnergy : 0);

      if (now - lastHudUpdateMsRef.current > 120) {
        lastHudUpdateMsRef.current = now;
        setHud({
          peopleCount: combinedPeople,
          distanceM: fusedDistM,
          azimuthDeg: fusedAzDeg,
          dispMm:
            useBacksidePrimary && satFresh ? satFresh.displacementMm : frame.displacementMm,
          bpm: fusedBpm,
          motionEnergy: fusedMotion,
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
              peopleCount: combinedPeople,
              distanceM: fusedDistM,
              azimuthDeg: fusedAzDeg,
              bpm: fusedBpm,
              motionEnergy: fusedMotion,
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

      const activeMotion = Math.max(frame.motionEnergy, satFresh ? satFresh.motionEnergy : 0);
      const pre = prealertStateRef.current;
      if (pre.active) {
        const elapsedSec = (now - pre.startedMs) / 1000;
        setPrealertLeftSec(Math.max(0, 4.0 - elapsedSec));
        if (activeMotion > pre.peakMotion) pre.peakMotion = activeMotion;
        if (elapsedSec > 1.1) {
          pre.postMotions.push(activeMotion);
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

      if (activeMotion >= fallThreshRef.current) {
        pre.active = true;
        pre.startedMs = now;
        pre.peakMotion = activeMotion;
        pre.distanceAtSpike =
          frame.peopleCount > 0 || !satFresh ? frame.targetMeters : satFresh.targetMeters;
        pre.bpmBefore = frame.respirationBpm ?? (satFresh ? satFresh.respirationBpm : null);
        pre.postMotions = [];
        setPrealertLeftSec(4.0);
        setGuardMode('ANOMALY_PREALERT');
        return;
      }

      if (apneaLimitRef.current > 0) {
        if (activeMotion > 0.75 || frame.respirationBpm !== null) {
          stillnessSinceMsRef.current = now;
        } else if ((now - stillnessSinceMsRef.current) / 1000 >= apneaLimitRef.current) {
          stillnessSinceMsRef.current = now;
          runConsentCheckIn(
            'PROLONGED_ABSENCE_OF_RESPIRATION',
            frame.targetMeters,
            activeMotion,
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
      const profile = satArmedRef.current ? 'HOST_DUAL_STEREO' : 'SOLO_STEREO';
      const info = await engineRef.current.start(rangeLockM, profile);
      setSampleRate(info.sampleRate);
      stillnessSinceMsRef.current = performance.now();
      setGuardMode('ARMED_MONITORING');
    } catch (err) {
      setErrorMsg('AudioWorklet error: ' + (err as Error).message);
    }
  };

  const handleGlobalPrimaryAction = async () => {
    if (activeRoute === 'OVERVIEW') {
      navigateTo('CONSOLE');
    }
    if (guardMode === 'OFFLINE') {
      await armSonar();
    } else {
      engineRef.current?.zeroClutter();
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
    <div className="app-frame">
      {/* Persistent Global Arbor Navbar — 100% locked coordinates across ALL 5 routes */}
      <ArborNavbar
        activeRoute={activeRoute}
        sonarArmed={sonarArmed}
        onNavigate={navigateTo}
        onPrimaryAction={handleGlobalPrimaryAction}
      />

      <div className="app-body">
        {activeRoute === 'CAREGIVER' ? (
          <CaregiverView
            lanUrls={lanUrls}
            sonarArmed={sonarArmed}
            onRequestArm={armSonar}
            onTriggerTestCheckin={() =>
              runConsentCheckIn(
                'MANUAL_VERIFICATION_TEST',
                hud.distanceM,
                hud.motionEnergy,
                hud.bpm,
                hud.azimuthDeg
              )
            }
            onBackToConsole={() => navigateTo('CONSOLE')}
          />
        ) : activeRoute === 'SATELLITE' ? (
          <SatelliteNodeView
            satHttpsUrls={satHttpsUrls}
            hostSatConnected={satConnected}
            hostSatArmed={satArmed}
            hostSatTelemetryRef={satelliteRef}
            onBackToConsole={() => navigateTo('CONSOLE')}
          />
        ) : activeRoute === 'OVERVIEW' ? (
          <SaasOverview
            sonarArmed={sonarArmed}
            benchmarkTrialsCount={benchmark.trials.length}
            onOpenConsole={() => navigateTo('CONSOLE')}
            onArmAndOpenConsole={async () => {
              navigateTo('CONSOLE');
              if (guardMode === 'OFFLINE') await armSonar();
            }}
            onOpenCaregiver={() => navigateTo('CAREGIVER')}
            onOpenBenchmark={() => navigateTo('BENCHMARK')}
            onOpenSatellite={() => navigateTo('SATELLITE')}
          />
        ) : (
          <>
            {/* Signature Electric Cobalt Console Command Band */}
            <div className="console-command-band">
              <div className="console-command-inner">
                <div className="console-command-title">
                  <h1>
                    {activeRoute === 'CONSOLE'
                      ? 'Live room acoustic console'
                      : 'Houseboat 4×4 acoustic benchmark'}
                  </h1>
                  <span>
                    {satArmed
                      ? '3-band FDMA whole-room mesh (Laptop + POCO Node B) · 0 px camera'
                      : '17.60–20.25 kHz stereo FDMA · Hardware camera strictly off'}
                  </span>
                </div>

                <div className="console-command-controls">
                  <span className="status-inline">
                    <span className={`led ${ledClass}`} />
                    <span>{formatGuardStatus(guardMode, prealertLeftSec)}</span>
                  </span>

                  {satConnected && (
                    <span className="status-inline">
                      <span className={`led ${satArmed ? 'on-teal' : 'on-amber'}`} />
                      <span>{satArmed ? 'POCO Node B armed' : 'POCO Node B linked'}</span>
                    </span>
                  )}

                  {errorMsg && <span className="err-inline">{errorMsg}</span>}

                  {activeRoute === 'CONSOLE' ? (
                    <>
                      <label
                        className="ctrl-inline"
                        title="Elder's home language (Sarvam Bulbul v3 + Saaras v4 + 105B + Translate across 10 Bharat languages)"
                      >
                        <select
                          aria-label="Elder home language"
                          value={elderLang}
                          onChange={async (e) => {
                            const nextLang = e.target.value as IndianLangCode;
                            setElderLang(nextLang);
                            await fetch('/api/language', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ elderLang: nextLang }),
                            }).catch(() => { });
                          }}
                        >
                          {INDIAN_LANGUAGES.map((l) => (
                            <option key={l.code} value={l.code}>
                              {l.nativeName} · {l.nameEn}
                            </option>
                          ))}
                        </select>
                      </label>

                      <button
                        type="button"
                        className={autoDetectSpeech ? 'pill-on' : ''}
                        onClick={async () => {
                          const nextAuto = !autoDetectSpeech;
                          setAutoDetectSpeech(nextAuto);
                          await fetch('/api/language', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ autoDetectSpeech: nextAuto }),
                          }).catch(() => { });
                        }}
                        title="Enable Saaras v4 automatic Indian language identification (language_code=unknown)"
                      >
                        {autoDetectSpeech ? 'Auto-ID: on' : 'Auto-ID: off'}
                      </button>

                      <button
                        type="button"
                        className={!creditLocked ? 'pill-on' : ''}
                        onClick={toggleCreditGuard}
                        title="Protects Sarvam API credits while testing sonar. Toggle to Sarvam live only for spoken voice check-in demos."
                      >
                        {creditLocked ? '0-credit lock' : 'Sarvam live'}
                      </button>

                      {sonarArmed && (
                        <button
                          type="button"
                          onClick={() => engineRef.current?.zeroClutter()}
                        >
                          Zero clutter
                        </button>
                      )}

                      <button
                        type="button"
                        className={autoTriggerEnabled ? 'pill-on' : ''}
                        onClick={() => setAutoTriggerEnabled((v) => !v)}
                        title="Enable autonomous fall + stillness voice check-in"
                      >
                        {autoTriggerEnabled ? 'Auto-fall: on' : 'Auto-fall: paused'}
                      </button>

                      <button
                        type="button"
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
                        <IconMicCheck size={15} />
                        Voice check-in
                      </button>

                      <button
                        type="button"
                        className={showPairBar ? 'pill-on' : ''}
                        onClick={() => setShowPairBar((v) => !v)}
                      >
                        <IconPhonePair size={15} />
                        Pair phones
                      </button>
                    </>
                  ) : (
                    <>
                      {sonarArmed && (
                        <>
                          <button
                            type="button"
                            onClick={() => engineRef.current?.zeroClutter()}
                          >
                            Zero clutter
                          </button>
                          <button
                            type="button"
                            onClick={() => engineRef.current?.recalibrateDirectPath()}
                          >
                            Re-lock direct path
                          </button>
                        </>
                      )}
                      <button type="button" onClick={() => navigateTo('CONSOLE')}>
                        Open live console
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    className={showTune ? 'pill-on' : ''}
                    onClick={() => setShowTune((v) => !v)}
                  >
                    <IconSliders size={15} />
                    Tune
                  </button>
                </div>
              </div>
            </div>

            <div className="shell">
              {showPairBar && (
                <div className="pair-bar">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
                    {lanUrls[0] && (
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <QrCodeSvg value={lanUrls[0]} size={88} />
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--content-primary)' }}>
                            Caregiver phone app
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--content-secondary)', marginBottom: 4 }}>
                            Scan on same Wi-Fi hotspot for alerts &amp; 2-way Malayalam voice
                          </div>
                          {lanUrls.map((u) => (
                            <a
                              key={u}
                              href={u}
                              target="_blank"
                              rel="noreferrer"
                              className="mono"
                              style={{ color: 'var(--accent)', fontSize: 12, marginRight: 10 }}
                            >
                              {u}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {satHttpsUrls[0] && (
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <QrCodeSvg value={satHttpsUrls[0]} size={88} />
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--content-primary)' }}>
                            POCO Node B satellite (HTTPS)
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--content-secondary)', marginBottom: 4 }}>
                            Scan on Android Chrome to guard backside blind spot
                          </div>
                          {satHttpsUrls.map((u) => (
                            <a
                              key={u}
                              href={u}
                              target="_blank"
                              rel="noreferrer"
                              className="mono"
                              style={{ color: 'var(--content-secondary)', fontSize: 12, marginRight: 10 }}
                            >
                              {u}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                    <button
                      type="button"
                      disabled={waStatus.sending}
                      onClick={async () => {
                        setWaStatus((p) => ({ ...p, sending: true, feedback: 'Sending to WhatsApp...' }));
                        try {
                          const r = await fetch('/api/whatsapp/test', { method: 'POST' });
                          const d = await r.json();
                          setWaStatus((p) => ({
                            ...p,
                            sending: false,
                            feedback: d.sent
                              ? `WhatsApp delivered to ${d.recipientMasked} ✓`
                              : d.detail || 'Check TextMeBot WhatsApp link',
                          }));
                        } catch {
                          setWaStatus((p) => ({
                            ...p,
                            sending: false,
                            feedback: 'Network error sending WhatsApp',
                          }));
                        }
                      }}
                    >
                      {waStatus.sending
                        ? 'Sending WhatsApp...'
                        : `Send test WhatsApp (${waStatus.recipient || '+91•••4916'})`}
                    </button>
                    <button
                      type="button"
                      onClick={() => window.open('/caregiver', '_blank', 'width=430,height=780')}
                    >
                      Caregiver window
                    </button>
                    <button type="button" onClick={() => navigateTo('SATELLITE')}>
                      Satellite view
                    </button>
                    {waStatus.feedback && (
                      <span className="mono" style={{ fontSize: 11.5, color: 'var(--accent)' }}>
                        {waStatus.feedback}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {showTune && (
                <div className="tune-drawer">
                  <label className="ctrl-inline">
                    Detection radius:
                    <select
                      value={maxZoneM}
                      onChange={(e) => {
                        const m = parseFloat(e.target.value);
                        setMaxZoneM(m);
                        engineRef.current?.setMaxRange(m);
                      }}
                    >
                      <option value={1.4}>1.4 m (Desk/floor — ignore bed)</option>
                      <option value={2.1}>2.1 m (Bedside)</option>
                      <option value={3.0}>3.0 m (Full room)</option>
                    </select>
                  </label>
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
                    style={{ fontSize: 11.5, color: 'var(--content-muted)', marginLeft: 'auto' }}
                  >
                    {sampleRate} Hz · Sarvam calls: {sarvamCallCount}
                  </span>
                </div>
              )}

              {/* Unified 5-Column Telemetry Ribbon */}
              <section className="metric-bar" aria-label="Live room telemetry">
                <div className="metric-cell">
                  <span className="readout-k">
                    <span
                      className={`led ${(sonarArmed || satArmed) && hud.peopleCount > 0 ? 'on-teal' : ''
                        }`}
                    />
                    Room occupancy
                  </span>
                  <span className="metric-val teal">
                    {!sonarArmed && !satArmed
                      ? '--'
                      : hud.peopleCount === 0
                        ? '0 · Empty'
                        : `${hud.peopleCount} · ${hud.distanceM.toFixed(2)}m (${hud.azimuthDeg >= 0 ? '+' : ''
                        }${hud.azimuthDeg.toFixed(0)}°)`}
                  </span>
                </div>
                <div className="metric-cell">
                  <span className="readout-k">Chest phase</span>
                  <span className="metric-val">
                    {sonarArmed
                      ? `${hud.dispMm >= 0 ? '+' : ''}${hud.dispMm.toFixed(2)} mm`
                      : '--'}
                  </span>
                </div>
                <div className="metric-cell">
                  <span className="readout-k">Respiration</span>
                  <span className="metric-val teal">
                    {hud.bpm
                      ? `${hud.bpm.toFixed(0)} BPM`
                      : sonarArmed || satArmed
                        ? 'Acquiring'
                        : '--'}
                  </span>
                </div>
                <div className="metric-cell">
                  <span className="readout-k">Motion impulse</span>
                  <span
                    className={`metric-val ${hud.motionEnergy >= fallThreshold ? 'amber' : ''}`}
                  >
                    {sonarArmed || satArmed ? hud.motionEnergy.toFixed(2) : '--'}
                  </span>
                </div>
                <div className="metric-cell">
                  <span className="readout-k">
                    <span
                      className={`led ${guardMode === 'LISTENING_CONSENT' ? 'on-amber' : 'on-red'
                        }`}
                    />
                    Speech (&lt;17.5 kHz)
                  </span>
                  <span className="metric-val red">
                    {guardMode === 'LISTENING_CONSENT'
                      ? `Open ${consentRemainingSec.toFixed(0)}s`
                      : 'Zeroed'}
                  </span>
                </div>
              </section>

              {activeRoute === 'CONSOLE' ? (
                <main className="console-layout">
                  <div>
                    {viewMode === 'IRONBOW' ? (
                      <SonicIronbowView
                        latestFrameRef={latestFrameRef}
                        satelliteRef={satelliteRef}
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
                        satelliteRef={satelliteRef}
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
                    sonarArmed={sonarArmed}
                    elderLang={elderLang}
                    autoDetectSpeech={autoDetectSpeech}
                    activePromptMl={activePromptMl}
                    liveTranscriptMl={liveTranscriptMl}
                    vadActive={vadActive}
                    consentRemainingSec={consentRemainingSec}
                    voiceRmsDb={voiceRmsDb}
                    incidents={incidents}
                    onRequestArm={armSonar}
                    onTriggerTestCheckin={() =>
                      runConsentCheckIn(
                        'MANUAL_VERIFICATION_TEST',
                        hud.distanceM,
                        hud.motionEnergy,
                        hud.bpm,
                        hud.azimuthDeg
                      )
                    }
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
                  latestFrameRef={latestFrameRef}
                  frameSeqRef={frameSeqRef}
                  guardMode={guardMode}
                  fallThreshold={fallThreshold}
                  onRequestArm={armSonar}
                  subscribeFrames={(cb) => {
                    trialSubscriberRef.current = cb;
                  }}
                  onSummaryUpdated={setBenchmark}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Persistent Global Arbor Footer — present across ALL 5 routes */}
      <ArborFooter
        activeRoute={activeRoute}
        sonarArmed={sonarArmed}
        creditLocked={creditLocked}
        benchmarkTrialsCount={benchmark.trials.length}
        lanCaregiverUrl={lanUrls[0]}
        onNavigate={navigateTo}
        onToggleCreditLock={toggleCreditGuard}
        onPrimaryAction={handleGlobalPrimaryAction}
      />
    </div>
  );
};
