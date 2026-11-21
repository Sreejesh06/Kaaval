export type GuardMode =
  | 'OFFLINE'
  | 'ARMED_MONITORING'
  | 'ANOMALY_PREALERT'
  | 'PLAYING_PROMPT'
  | 'LISTENING_CONSENT'
  | 'TRIAGING_RESPONSE'
  | 'EMERGENCY_DISPATCHED'
  | 'RESOLVED_SAFE';

export type IndianLangCode =
  | 'ml-IN'
  | 'ta-IN'
  | 'hi-IN'
  | 'kn-IN'
  | 'te-IN'
  | 'bn-IN'
  | 'mr-IN'
  | 'gu-IN'
  | 'pa-IN'
  | 'en-IN';

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

export type SonarNodeProfile = 'SOLO_STEREO' | 'HOST_DUAL_STEREO' | 'SATELLITE_MONO';

export type SatelliteZone = 'BACK' | 'OPPOSITE' | 'LEFT' | 'RIGHT';

export interface DetectedPerson {
  id: number;
  distanceMeters: number;
  azimuthDeg: number;
  x: number;
  z: number;
  snrDb: number;
  motion: number;
  zone?: 'FRONT' | SatelliteZone;
  source?: 'LAPTOP' | 'SATELLITE';
}

export interface SatelliteTelemetry {
  nodeId: string;
  deviceLabel: string;
  zone: SatelliteZone;
  armed: boolean;
  sampleRate: number;
  peopleCount: number;
  targets: DetectedPerson[];
  targetMeters: number;
  displacementMm: number;
  respirationBpm: number | null;
  motionEnergy: number;
  sonarDb: number;
  primitives: SemanticPrimitive[];
  rangeProfile: number[];
  updatedAtMs: number;
}

export interface RadarFrame {
  kind: 'radar';
  fs: number;
  metersPerSample: number;
  directPeakIdx: number;
  directMag: number;
  stereoActive: boolean;
  speechDb: number;
  sonarDb: number;
  peopleCount: number;
  targets: DetectedPerson[];
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
  ambientClutterProfile: Float32Array;
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

export interface CaregiverReply {
  id: string;
  timestampIso: string;
  messageInput: string;
  sourceLang: string;
  targetLang?: IndianLangCode;
  spokenMalayalam: string;
  latencyMs: number;
}

export interface IncidentRecord {
  id: string;
  timestampIso: string;
  trigger: AnomalyTriggerReason;
  elderLang?: IndianLangCode;
  elderLangLabel?: string;
  autoDetectedLang?: boolean;
  distanceMeters: number;
  azimuthDeg?: number;
  snapshotDataUrl?: string;
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
  caregiverReplies?: CaregiverReply[];
  whatsappDispatch?: {
    sent: boolean;
    recipientMasked: string;
    latencyMs: number;
    detail: string;
  };
  offlineFallback?: boolean;
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
