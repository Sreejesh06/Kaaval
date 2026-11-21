export type GuardMode =
  | 'OFFLINE'
  | 'ARMED_MONITORING'
  | 'ANOMALY_PREALERT'
  | 'PLAYING_PROMPT'
  | 'LISTENING_CONSENT'
  | 'TRIAGING_RESPONSE'
  | 'EMERGENCY_DISPATCHED'
  | 'RESOLVED_SAFE';

export type AnomalyTriggerReason =
  | 'FALL_IMPACT_AND_STILLNESS'
  | 'PROLONGED_ABSENCE_OF_RESPIRATION'
  | 'MANUAL_VERIFICATION_TEST';

export type SemanticPrimitive =
  | 'EMPTY_BASELINE'
  | 'ROOM_OCCUPIED'
  | 'RESTING_RESPIRATION'
  | 'APPROACHING_SENSOR'
  | 'RECEDING_SENSOR'
  | 'LATERAL_TRANSIT'
  | 'IMPACT_TRANSIENT'
  | 'POST_FALL_IMMOBILE';

export interface RadarFrame {
  kind: 'radar';
  fs: number;
  metersPerSample: number;
  directPeakIdx: number;
  directMag: number;
  stereoActive: boolean;
  speechDb: number;
  sonarDb: number;
  targetMeters: number;
  targetAzimuthDeg: number; // -55 (Left) .. 0 (Center) .. +55 (Right)
  targetX: number; // Lateral meters (-Left / +Right)
  targetZ: number; // Depth meters forward from screen
  radialVelocityMps: number;
  displacementMm: number;
  respirationBpm: number | null;
  iqR: number;
  iqI: number;
  motionEnergy: number;
  presenceRatio: number;
  primitives: SemanticPrimitive[];
  spectrumDb: Float32Array;
  clutterRemovedProfile: Float32Array;
  motionProfile: Float32Array;
  // 28 range slices x 15 azimuth beams (-52 deg .. +52 deg) volumetric floor field
  spatialGrid: Float32Array;
  spatialRangeSlices: number;
  spatialAzimuthBins: number;
}

export interface SarvamTraceStep {
  model: string;
  endpoint: string;
  latencyMs: number;
  detail: string;
}

export interface IncidentRecord {
  id: string;
  timestampIso: string;
  trigger: AnomalyTriggerReason;
  distanceMeters: number;
  azimuthDeg?: number;
  peakMotionEnergy: number;
  respirationBpmBefore: number | null;
  promptMl: string;
  transcriptMl: string;
  transcriptEn: string;
  classification: 'SAFE' | 'EMERGENCY' | 'UNRESPONSIVE';
  clinicalSummaryEn: string;
  replyMl: string;
  replyAudioBase64?: string;
  sarvamTraces: SarvamTraceStep[];
}

export type GroundTruthClass =
  | 'EMPTY_CABIN'
  | 'SEATED_BREATHING'
  | 'WALKING_NORMAL'
  | 'FALL_STILLNESS';

export interface BenchmarkTrial {
  id: string;
  timestampIso: string;
  expected: GroundTruthClass;
  predicted: GroundTruthClass;
  durationSec: number;
  meanDistanceM: number;
  peakMotion: number;
  breathStdMm: number;
  meanPresence: number;
  sonarSnrDb: number;
}

export interface BenchmarkSummary {
  trials: BenchmarkTrial[];
  matrix: Record<GroundTruthClass, Record<GroundTruthClass, number>>;
  accuracyPct: number;
  falseAlarmRatePct: number;
  fallRecallPct: number;
}
