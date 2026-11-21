import fs from 'node:fs';
import path from 'node:path';
import type {
  BenchmarkSummary,
  BenchmarkTrial,
  CaregiverReply,
  GroundTruthClass,
  IncidentRecord,
} from '../src/types.js';

const DATA_DIR = path.resolve('data');
const STORE_PATH = path.join(DATA_DIR, 'kaaval-store.json');

const CLASSES: GroundTruthClass[] = [
  'EMPTY_CABIN',
  'SEATED_BREATHING',
  'WALKING_NORMAL',
  'FALL_STILLNESS',
];

interface DiskStore {
  incidents: IncidentRecord[];
  trials: BenchmarkTrial[];
}

const recentAudioByIncidentId = new Map<string, string>();

function hydrateIncidents(incidents: IncidentRecord[]): IncidentRecord[] {
  return incidents.map((inc) => {
    const cachedAudio = inc.replyAudioBase64 ?? recentAudioByIncidentId.get(inc.id);
    return cachedAudio !== undefined ? { ...inc, replyAudioBase64: cachedAudio } : inc;
  });
}

function loadStore(): DiskStore {
  if (!fs.existsSync(STORE_PATH)) {
    return { incidents: [], trials: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as DiskStore;
    const incidents = Array.isArray(parsed.incidents) ? parsed.incidents : [];
    const trials = Array.isArray(parsed.trials) ? parsed.trials : [];
    for (const inc of incidents) {
      if (inc.replyAudioBase64 && !recentAudioByIncidentId.has(inc.id)) {
        recentAudioByIncidentId.set(inc.id, inc.replyAudioBase64);
      }
    }
    return { incidents, trials };
  } catch {
    return { incidents: [], trials: [] };
  }
}

function saveStore(store: DiskStore) {
  for (const inc of store.incidents) {
    if (inc.replyAudioBase64) {
      recentAudioByIncidentId.set(inc.id, inc.replyAudioBase64);
    }
  }

  const activeIds = new Set(store.incidents.map((inc) => inc.id));
  for (const cachedId of recentAudioByIncidentId.keys()) {
    if (!activeIds.has(cachedId)) {
      recentAudioByIncidentId.delete(cachedId);
    }
  }

  const diskStore: DiskStore = {
    incidents: store.incidents.map(({ replyAudioBase64: _stripped, ...rest }) => rest),
    trials: store.trials,
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(diskStore, null, 2), 'utf8');
}

export function listIncidents(): IncidentRecord[] {
  return hydrateIncidents(loadStore().incidents);
}

export function appendIncident(incident: IncidentRecord): IncidentRecord[] {
  if (incident.replyAudioBase64) {
    recentAudioByIncidentId.set(incident.id, incident.replyAudioBase64);
  }
  const store = loadStore();
  store.incidents.unshift(incident);
  store.incidents = store.incidents.slice(0, 40);
  saveStore(store);
  return hydrateIncidents(store.incidents);
}

export function appendCaregiverReply(
  incidentId: string | undefined,
  reply: CaregiverReply
): IncidentRecord[] {
  const store = loadStore();
  const target =
    (incidentId ? store.incidents.find((inc) => inc.id === incidentId) : undefined) ??
    store.incidents[0];
  if (target) {
    target.caregiverReplies = [...(target.caregiverReplies || []), reply];
    saveStore(store);
  }
  return hydrateIncidents(store.incidents);
}

export function classifyTrialFeatures(f: {
  peakMotion: number;
  breathStdMm: number;
  meanPresence: number;
  postSpikeMotion?: number;
}): GroundTruthClass {
  // Rule derived from physical ultrasonic acoustics:
  // 1) High transient Doppler/range burst followed by low tail motion -> FALL_STILLNESS
  if (f.peakMotion >= 4.2 && (f.postSpikeMotion ?? 0) < 1.35) {
    return 'FALL_STILLNESS';
  }
  // 2) Sustained elevated motion across the window -> WALKING_NORMAL
  if (f.peakMotion >= 2.1) {
    return 'WALKING_NORMAL';
  }
  // 3) Low macro-motion but clear millimeter IQ phase oscillation (>0.22 mm) -> SEATED_BREATHING
  if (f.breathStdMm >= 0.22 || f.meanPresence >= 0.35) {
    return 'SEATED_BREATHING';
  }
  return 'EMPTY_CABIN';
}

export function computeBenchmarkSummary(trials?: BenchmarkTrial[]): BenchmarkSummary {
  const list = trials ?? loadStore().trials;
  const matrix = {} as Record<GroundTruthClass, Record<GroundTruthClass, number>>;
  for (const r of CLASSES) {
    matrix[r] = {
      EMPTY_CABIN: 0,
      SEATED_BREATHING: 0,
      WALKING_NORMAL: 0,
      FALL_STILLNESS: 0,
    };
  }

  let correct = 0;
  let nonFallTotal = 0;
  let falseFallAlarms = 0;
  let actualFalls = 0;
  let detectedFalls = 0;

  for (const t of list) {
    matrix[t.expected][t.predicted] += 1;
    if (t.expected === t.predicted) correct += 1;
    if (t.expected !== 'FALL_STILLNESS') {
      nonFallTotal += 1;
      if (t.predicted === 'FALL_STILLNESS') falseFallAlarms += 1;
    } else {
      actualFalls += 1;
      if (t.predicted === 'FALL_STILLNESS') detectedFalls += 1;
    }
  }

  return {
    trials: list,
    matrix,
    accuracyPct: list.length ? (correct / list.length) * 100 : 0,
    falseAlarmRatePct: nonFallTotal ? (falseFallAlarms / nonFallTotal) * 100 : 0,
    fallRecallPct: actualFalls ? (detectedFalls / actualFalls) * 100 : 0,
  };
}

export function addBenchmarkTrial(trial: BenchmarkTrial): BenchmarkSummary {
  const store = loadStore();
  store.trials.unshift(trial);
  saveStore(store);
  return computeBenchmarkSummary(store.trials);
}

export function clearBenchmarkTrials(): BenchmarkSummary {
  const store = loadStore();
  store.trials = [];
  saveStore(store);
  return computeBenchmarkSummary([]);
}
