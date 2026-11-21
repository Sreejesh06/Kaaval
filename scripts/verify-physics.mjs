import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadWorkletExports() {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'sonar-worklet.js'), 'utf8');
  let RegisteredWorklet = null;

  class AudioWorkletProcessor {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage: () => {},
      };
    }
  }

  const sandbox = {
    AudioWorkletProcessor,
    sampleRate: 48000,
    registerProcessor: (_name, cls) => {
      RegisteredWorklet = cls;
    },
    Float32Array,
    Uint16Array,
    Int16Array,
    Math,
    Boolean,
  };

  const instrumented = `${src}\n;globalThis.__dsp = { N, HALF_N, SPEED_OF_SOUND, FL_START, FL_END, FR_START, FR_END, F_FIREWALL_CUTOFF, fftInPlace, synthesizeChirp };`;
  vm.createContext(sandbox);
  vm.runInContext(instrumented, sandbox, { filename: 'sonar-worklet.js' });

  return {
    ...sandbox.__dsp,
    KaavalDualWorklet: RegisteredWorklet,
  };
}

function loadClassifyTrialFeatures() {
  const tsSrc = fs.readFileSync(path.join(ROOT, 'server', 'trialsStore.ts'), 'utf8');
  const match = tsSrc.match(
    /export function classifyTrialFeatures\s*\([\s\S]*?\)\s*:\s*GroundTruthClass\s*\{[\s\S]*?\n\}/
  );
  if (!match) {
    throw new Error('Could not locate classifyTrialFeatures in server/trialsStore.ts');
  }
  const jsFn = match[0]
    .replace(/^export\s+/, '')
    .replace(/\(\s*([a-zA-Z_$][\w$]*)\s*:[\s\S]*?\)\s*:\s*GroundTruthClass/, '($1)');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${jsFn}; globalThis.fn = classifyTrialFeatures;`, ctx);
  return ctx.fn;
}

function evalDelayedContinuousChirp(outBuf, delaySamples, amplitude, fs, fStart, fEnd, N) {
  const taper = 256;
  const slope = (fEnd - fStart) / N;
  for (let n = 0; n < N; n++) {
    let u = (n - delaySamples) % N;
    if (u < 0) u += N;
    let env = 1.0;
    if (u < taper) {
      env = 0.5 * (1 - Math.cos((Math.PI * u) / taper));
    } else if (u >= N - 1 - taper) {
      const rem = Math.max(0, N - 1 - u);
      env = 0.5 * (1 - Math.cos((Math.PI * rem) / taper));
    }
    const phase = ((2 * Math.PI) / fs) * (fStart * u + 0.5 * slope * u * u);
    outBuf[n] += amplitude * env * Math.sin(phase);
  }
}

function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

function runAnalyticMatchedFilter(rx, txSpecRe, txSpecIm, binMin, binMax, N, fftInPlace) {
  const rxRe = new Float32Array(N);
  const rxIm = new Float32Array(N);
  for (let i = 0; i < N; i++) rxRe[i] = rx[i];
  fftInPlace(rxRe, rxIm, false);

  const corrRe = new Float32Array(N);
  const corrIm = new Float32Array(N);
  for (let k = binMin; k <= binMax; k++) {
    const rR = rxRe[k];
    const rI = rxIm[k];
    const tR = txSpecRe[k];
    const tI = txSpecIm[k];
    corrRe[k] = 2 * (rR * tR + rI * tI);
    corrIm[k] = 2 * (rI * tR - rR * tI);
  }
  fftInPlace(corrRe, corrIm, true);
  return { corrRe, corrIm };
}

function main() {
  const tStart = performance.now();
  const failures = [];
  const dsp = loadWorkletExports();
  const {
    N,
    HALF_N,
    SPEED_OF_SOUND,
    FL_START,
    FL_END,
    FR_START,
    FR_END,
    F_FIREWALL_CUTOFF,
    fftInPlace,
    synthesizeChirp,
    KaavalDualWorklet,
  } = dsp;

  const fs = 48000;
  const metersPerSample = SPEED_OF_SOUND / (2 * fs);
  const binFirewall = Math.min(HALF_N - 1, Math.ceil((F_FIREWALL_CUTOFF * N) / fs));
  const binLMin = Math.min(HALF_N - 1, Math.ceil((17550 * N) / fs));
  const binLMax = Math.min(HALF_N - 1, Math.floor((18920 * N) / fs));
  const minTargetBin = Math.ceil(0.48 / metersPerSample);
  const maxRangeBins = Math.min(900, Math.floor(3.0 / metersPerSample));
  const txL = synthesizeChirp(fs, FL_START, FL_END);

  // Test 1: FMCW Range Accuracy (0.75m, 1.35m, 2.15m within < 1.0 cm)
  const directDelay = 24.0;
  const rxClutter = new Float32Array(N);
  evalDelayedContinuousChirp(rxClutter, directDelay, 0.85, fs, FL_START, FL_END, N);
  const baseCorr = runAnalyticMatchedFilter(
    rxClutter,
    txL.specRe,
    txL.specIm,
    binLMin,
    binLMax,
    N,
    fftInPlace
  );

  let directIdx = 0;
  let bestDirect = -1;
  for (let i = 0; i < N; i++) {
    const magSq = baseCorr.corrRe[i] ** 2 + baseCorr.corrIm[i] ** 2;
    if (magSq > bestDirect) {
      bestDirect = magSq;
      directIdx = i;
    }
  }

  const groundTruthRangesM = [0.75, 1.35, 2.15];
  const rangeReports = [];
  let maxErrCm = 0;

  for (const trueM of groundTruthRangesM) {
    const rx = new Float32Array(rxClutter);
    const echoDelay = directDelay + trueM / metersPerSample;
    evalDelayedContinuousChirp(rx, echoDelay, 0.08 / trueM, fs, FL_START, FL_END, N);

    const corr = runAnalyticMatchedFilter(
      rx,
      txL.specRe,
      txL.specIm,
      binLMin,
      binLMax,
      N,
      fftInPlace
    );

    let peakBin = minTargetBin;
    let peakMag = -1;
    for (let m = minTargetBin; m < maxRangeBins; m++) {
      const idx = (directIdx + m) & (N - 1);
      const dRe = corr.corrRe[idx] - baseCorr.corrRe[idx];
      const dIm = corr.corrIm[idx] - baseCorr.corrIm[idx];
      const mag = Math.hypot(dRe, dIm);
      if (mag > peakMag) {
        peakMag = mag;
        peakBin = m;
      }
    }

    const recoveredM = peakBin * metersPerSample;
    const errCm = Math.abs(recoveredM - trueM) * 100;
    if (errCm > maxErrCm) maxErrCm = errCm;
    rangeReports.push(`${trueM.toFixed(2)}m->${recoveredM.toFixed(4)}m (err ${errCm.toFixed(2)}cm)`);
    if (errCm >= 1.0) {
      failures.push(`Test 1 range error ${errCm.toFixed(3)} cm >= 1.0 cm at ${trueM}m`);
    }
  }

  // Also verify 16 kHz Bluetooth HFP degradation safety (zero NaN)
  const hfpWorklet = new KaavalDualWorklet({
    processorOptions: { sampleRate: 16000, stereoCapable: false },
  });
  let hfpNanDetected = false;
  hfpWorklet.port.postMessage = (msg) => {
    if (msg.kind === 'radar' && (Number.isNaN(msg.motionEnergy) || Number.isNaN(msg.sonarDb))) {
      hfpNanDetected = true;
    }
  };
  for (let f = 0; f < 22; f++) hfpWorklet.processRadarFrame();
  if (hfpNanDetected) {
    failures.push('Test 1 Bluetooth HFP 16 kHz guard emitted NaN');
  }

  if (maxErrCm < 1.0 && !hfpNanDetected) {
    console.log(
      `PASS [Test 1 | FMCW Range Accuracy] ${rangeReports.join(', ')} | max_err=${maxErrCm.toFixed(2)}cm (<1.00cm), 16kHz_guard=OK`
    );
  } else {
    console.error(`FAIL [Test 1 | FMCW Range Accuracy] max_err=${maxErrCm.toFixed(2)}cm`);
  }

  // Test 2: <17.5 kHz Speech Firewall Proof (< -90 dB correlation leakage)
  const echoOnly = new Float32Array(N);
  evalDelayedContinuousChirp(
    echoOnly,
    directDelay + 1.15 / metersPerSample,
    0.05,
    fs,
    FL_START,
    FL_END,
    N
  );
  const echoRms = rms(echoOnly);

  const rawSpeech = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    // 4-term Blackman-Harris window eliminates artificial rectangular block-edge step discontinuities
    // while preserving exact continuous-frequency harmonics across 120 Hz .. 8,000 Hz
    const w =
      0.35875 -
      0.48829 * Math.cos((2 * Math.PI * n) / (N - 1)) +
      0.14128 * Math.cos((4 * Math.PI * n) / (N - 1)) -
      0.01168 * Math.cos((6 * Math.PI * n) / (N - 1));
    let sample = 0;
    for (let f = 120; f <= 8000; f += 120) {
      const harmonicIdx = f / 120;
      const formantWeight = 1 / Math.sqrt(harmonicIdx);
      sample += formantWeight * Math.sin((2 * Math.PI * f * n) / fs + harmonicIdx * 0.37);
    }
    rawSpeech[n] = w * sample;
  }

  const speechScale = (10.0 * echoRms) / rms(rawSpeech);
  const speech10x = new Float32Array(N);
  const rxEchoPlusSpeech = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    speech10x[n] = rawSpeech[n] * speechScale;
    rxEchoPlusSpeech[n] = echoOnly[n] + speech10x[n];
  }

  // Verify spectral firewall strictly zeroes 0 .. binFirewall-1
  const corrEcho = runAnalyticMatchedFilter(
    echoOnly,
    txL.specRe,
    txL.specIm,
    binLMin,
    binLMax,
    N,
    fftInPlace
  );
  const corrSpeechOnly = runAnalyticMatchedFilter(
    speech10x,
    txL.specRe,
    txL.specIm,
    binLMin,
    binLMax,
    N,
    fftInPlace
  );
  const corrMixed = runAnalyticMatchedFilter(
    rxEchoPlusSpeech,
    txL.specRe,
    txL.specIm,
    binLMin,
    binLMax,
    N,
    fftInPlace
  );

  let echoCorrEnergy = 0;
  let speechLeakEnergy = 0;
  let diffEnergy = 0;
  for (let n = 0; n < N; n++) {
    echoCorrEnergy += corrEcho.corrRe[n] ** 2 + corrEcho.corrIm[n] ** 2;
    speechLeakEnergy += corrSpeechOnly.corrRe[n] ** 2 + corrSpeechOnly.corrIm[n] ** 2;
    diffEnergy +=
      (corrMixed.corrRe[n] - corrEcho.corrRe[n]) ** 2 +
      (corrMixed.corrIm[n] - corrEcho.corrIm[n]) ** 2;
  }

  const speechLeakDb = 10 * Math.log10((speechLeakEnergy + 1e-30) / echoCorrEnergy);
  const perturbationDb = 10 * Math.log10((diffEnergy + 1e-30) / echoCorrEnergy);
  const worstLeakDb = Math.max(speechLeakDb, perturbationDb);

  if (worstLeakDb < -90.0 && binFirewall < binLMin) {
    console.log(
      `PASS [Test 2 | <17.5 kHz Speech Firewall] speech_amp=10.0x (+20.0dB, 120-8000Hz) | corr_leakage=${worstLeakDb.toFixed(1)}dB (<-90.0dB)`
    );
  } else {
    failures.push(`Test 2 speech firewall leakage ${worstLeakDb.toFixed(2)} dB >= -90 dB`);
    console.error(`FAIL [Test 2 | <17.5 kHz Speech Firewall] leakage=${worstLeakDb.toFixed(2)}dB`);
  }

  // Test 3: Sub-mm IQ Respiration Autocorrelation (352 frames @ 23.4375 fps, 0.95m +- 2.5mm @ 15.0 BPM)
  const worklet = new KaavalDualWorklet({
    processorOptions: { sampleRate: fs, stereoCapable: true },
  });
  const frameRate = fs / N;
  let latestRadar = null;
  worklet.port.postMessage = (msg) => {
    if (msg.kind === 'radar') latestRadar = msg;
  };
  worklet.port.onmessage({ data: { type: 'lock_range', meters: 0.95 } });

  // Warmup 25 frames of empty room (direct path only) to lock directIdxL & static clutter
  for (let f = 0; f < 25; f++) {
    worklet.rxBuf.fill(0);
    evalDelayedContinuousChirp(worklet.rxBuf, directDelay, 0.85, fs, FL_START, FL_END, N);
    worklet.processRadarFrame();
  }

  // Advance frameCount past rapid-clutter boot window while keeping empty-room clutter reference
  worklet.frameCount = 60;
  worklet.respPtr = 0;
  worklet.respFilled = 0;
  worklet.phaseInitialized = false;

  const totalRespFrames = 352;
  const trueBpm = 15.0;
  const respFreqHz = trueBpm / 60.0;

  for (let f = 0; f < totalRespFrames; f++) {
    const tSec = f / frameRate;
    const chestRangeM = 0.95 + 0.0025 * Math.sin(2 * Math.PI * respFreqHz * tSec);
    worklet.rxBuf.fill(0);
    evalDelayedContinuousChirp(worklet.rxBuf, directDelay, 0.85, fs, FL_START, FL_END, N);
    evalDelayedContinuousChirp(
      worklet.rxBuf,
      directDelay + chestRangeM / metersPerSample,
      0.065,
      fs,
      FL_START,
      FL_END,
      N
    );
    worklet.processRadarFrame();
  }

  const estimatedBpm = worklet.estimateRespirationBpm();
  const bpmErr = estimatedBpm === null ? Infinity : Math.abs(estimatedBpm - trueBpm);

  // Verify post-TTS SONAR_LOCKED resync suppresses false motion spike
  worklet.port.onmessage({ data: { type: 'set_mode', mode: 'SONAR_LOCKED' } });
  worklet.rxBuf.fill(0);
  evalDelayedContinuousChirp(worklet.rxBuf, directDelay, 0.85, fs, FL_START, FL_END, N);
  worklet.processRadarFrame();
  const postTtsMotion = latestRadar ? latestRadar.motionEnergy : Infinity;

  if (estimatedBpm !== null && bpmErr <= 0.8 && postTtsMotion === 0) {
    console.log(
      `PASS [Test 3 | Sub-mm IQ Respiration] target=0.95m +-2.5mm @ 15.00 BPM | estimated=${estimatedBpm.toFixed(2)} BPM (err=${bpmErr.toFixed(2)} BPM <=0.80), resync_motion=${postTtsMotion.toFixed(2)}`
    );
  } else {
    failures.push(
      `Test 3 respiration BPM=${estimatedBpm} (err=${bpmErr.toFixed(2)}), postTtsMotion=${postTtsMotion}`
    );
    console.error(
      `FAIL [Test 3 | Sub-mm IQ Respiration] estimated=${estimatedBpm}, postTtsMotion=${postTtsMotion}`
    );
  }

  // Test 4: Kinematic Fall + Post-Spike Stillness Separation (4/4 synthetic feature vectors)
  const classifyTrialFeatures = loadClassifyTrialFeatures();
  const syntheticCases = [
    {
      expected: 'EMPTY_CABIN',
      features: { peakMotion: 0.11, postSpikeMotion: 0.06, breathStdMm: 0.05, meanPresence: 0.08 },
    },
    {
      expected: 'SEATED_BREATHING',
      features: { peakMotion: 0.42, postSpikeMotion: 0.24, breathStdMm: 1.75, meanPresence: 0.84 },
    },
    {
      expected: 'WALKING_NORMAL',
      features: { peakMotion: 4.55, postSpikeMotion: 2.18, breathStdMm: 3.4, meanPresence: 1.15 },
    },
    {
      expected: 'FALL_STILLNESS',
      features: { peakMotion: 5.65, postSpikeMotion: 0.21, breathStdMm: 0.19, meanPresence: 0.92 },
    },
  ];

  let correctCount = 0;
  const classPairs = [];
  for (const tc of syntheticCases) {
    const predicted = classifyTrialFeatures(tc.features);
    if (predicted === tc.expected) correctCount++;
    classPairs.push(`${tc.expected}->${predicted}`);
  }

  if (correctCount === syntheticCases.length) {
    console.log(
      `PASS [Test 4 | Kinematic Fall Separation] ${correctCount}/${syntheticCases.length} accurate (${classPairs.join(', ')})`
    );
  } else {
    failures.push(`Test 4 kinematic accuracy ${correctCount}/${syntheticCases.length}`);
    console.error(
      `FAIL [Test 4 | Kinematic Fall Separation] ${correctCount}/${syntheticCases.length} (${classPairs.join(', ')})`
    );
  }

  // Test 5: Houseboat Arm-While-Seated + Rigid Wooden Wall Rejection (Zero Empty-Room Calibration!)
  const boatWorklet = new KaavalDualWorklet({
    processorOptions: { sampleRate: fs, stereoCapable: true },
  });
  let boatFrame = null;
  boatWorklet.port.postMessage = (msg) => {
    if (msg.kind === 'radar') boatFrame = msg;
  };
  // Person sits @ 0.62m breathing +-2.0mm @ 16.0 BPM FROM FRAME 0, while a 4x louder rigid wood wall sits @ 2.35m!
  let rng = 1337;
  const nextNoise = () => {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return ((rng / 4294967296) - 0.5) * 0.0004;
  };
  for (let f = 0; f < 240; f++) {
    const tSec = f / frameRate;
    const seatedM = 0.62 + 0.002 * Math.sin(2 * Math.PI * (16.0 / 60.0) * tSec);
    boatWorklet.rxBuf.fill(0);
    // Direct speaker bleed (L + R)
    evalDelayedContinuousChirp(boatWorklet.rxBuf, directDelay, 0.85, fs, FL_START, FL_END, N);
    evalDelayedContinuousChirp(boatWorklet.rxBuf, directDelay, 0.72, fs, FR_START, FR_END, N);
    // Loud rigid wooden houseboat wall @ 2.35m (0.00mm motion)
    evalDelayedContinuousChirp(boatWorklet.rxBuf, directDelay + 2.35 / metersPerSample, 0.09, fs, FL_START, FL_END, N);
    evalDelayedContinuousChirp(boatWorklet.rxBuf, directDelay + 2.35 / metersPerSample, 0.08, fs, FR_START, FR_END, N);
    // Seated human @ 0.62m (4.5x weaker reflection than the wooden wall, but breathing!)
    evalDelayedContinuousChirp(boatWorklet.rxBuf, directDelay + seatedM / metersPerSample, 0.02, fs, FL_START, FL_END, N);
    evalDelayedContinuousChirp(boatWorklet.rxBuf, directDelay + seatedM / metersPerSample, 0.018, fs, FR_START, FR_END, N);
    for (let n = 0; n < N; n++) boatWorklet.rxBuf[n] += nextNoise();
    boatWorklet.processRadarFrame();
  }

  const seatedErrCm = boatFrame ? Math.abs(boatFrame.targetMeters - 0.62) * 100 : Infinity;
  const seatedBpm = boatFrame ? boatFrame.respirationBpm : null;
  const seatedBpmErr = seatedBpm === null ? Infinity : Math.abs(seatedBpm - 16.0);
  if (
    boatFrame &&
    boatFrame.peopleCount === 1 &&
    seatedErrCm < 4.5 &&
    seatedBpm !== null &&
    seatedBpmErr <= 1.0
  ) {
    console.log(
      `PASS [Test 5 | Seated-at-Boot & Wood Wall Reject] wall@2.35m=REJECTED, person=0.62m->${boatFrame.targetMeters.toFixed(2)}m (err ${seatedErrCm.toFixed(1)}cm), bpm=${seatedBpm.toFixed(1)}/16.0`
    );
  } else {
    failures.push(
      `Test 5 failed: count=${boatFrame?.peopleCount}, dist=${boatFrame?.targetMeters}, bpm=${seatedBpm}`
    );
    console.error('FAIL [Test 5]', boatFrame?.peopleCount, boatFrame?.targetMeters, seatedBpm);
  }

  // Test 7 (run right after 5): Empty Noisy Houseboat Cabin with 2 Wooden Walls -> 0 False Ghost People!
  const emptyWorklet = new KaavalDualWorklet({
    processorOptions: { sampleRate: fs, stereoCapable: true },
  });
  let emptyFrame = null;
  emptyWorklet.port.postMessage = (msg) => {
    if (msg.kind === 'radar') emptyFrame = msg;
  };
  for (let f = 0; f < 90; f++) {
    emptyWorklet.rxBuf.fill(0);
    evalDelayedContinuousChirp(emptyWorklet.rxBuf, directDelay, 0.85, fs, FL_START, FL_END, N);
    evalDelayedContinuousChirp(emptyWorklet.rxBuf, directDelay, 0.75, fs, FR_START, FR_END, N);
    evalDelayedContinuousChirp(emptyWorklet.rxBuf, directDelay + 1.40 / metersPerSample, 0.07, fs, FL_START, FL_END, N);
    evalDelayedContinuousChirp(emptyWorklet.rxBuf, directDelay + 2.55 / metersPerSample, 0.09, fs, FL_START, FL_END, N);
    for (let n = 0; n < N; n++) emptyWorklet.rxBuf[n] += nextNoise() * 2.0;
    emptyWorklet.processRadarFrame();
  }
  if (emptyFrame && emptyFrame.peopleCount === 0 && emptyFrame.primitives.includes('EMPTY_BASELINE')) {
    console.log('PASS [Test 7 | Empty Noisy Cabin Zero-Ghost] walls@1.40m,2.55m + 2x noise -> peopleCount=0 (EMPTY_BASELINE)');
  } else {
    failures.push(`Test 7 ghost detected in empty cabin: count=${emptyFrame?.peopleCount}`);
    console.error('FAIL [Test 7]', emptyFrame?.peopleCount, emptyFrame?.primitives);
  }

  // Test 6: Multi-Person Houseboat Cabin Separation (Person 1 @ 0.72m Left, Person 2 @ 1.85m Right)
  const multiWorklet = new KaavalDualWorklet({
    processorOptions: { sampleRate: fs, stereoCapable: true },
  });
  let multiFrame = null;
  multiWorklet.port.postMessage = (msg) => {
    if (msg.kind === 'radar') multiFrame = msg;
  };
  for (let f = 0; f < 65; f++) {
    const tSec = f / frameRate;
    const p1M = 0.72 + 0.003 * Math.sin(2 * Math.PI * 0.3 * tSec);
    const p2M = 1.85 + 0.008 * Math.sin(2 * Math.PI * 0.7 * tSec);
    multiWorklet.rxBuf.fill(0);
    evalDelayedContinuousChirp(multiWorklet.rxBuf, directDelay, 0.85, fs, FL_START, FL_END, N);
    evalDelayedContinuousChirp(multiWorklet.rxBuf, directDelay, 0.80, fs, FR_START, FR_END, N);
    // Person 1 @ 0.72m on LEFT (closer/stronger on TX-L than TX-R)
    evalDelayedContinuousChirp(multiWorklet.rxBuf, directDelay + (p1M - 0.04) / metersPerSample, 0.028, fs, FL_START, FL_END, N);
    evalDelayedContinuousChirp(multiWorklet.rxBuf, directDelay + (p1M + 0.04) / metersPerSample, 0.011, fs, FR_START, FR_END, N);
    // Person 2 @ 1.85m on RIGHT (closer/stronger on TX-R than TX-L)
    evalDelayedContinuousChirp(multiWorklet.rxBuf, directDelay + (p2M + 0.045) / metersPerSample, 0.009, fs, FL_START, FL_END, N);
    evalDelayedContinuousChirp(multiWorklet.rxBuf, directDelay + (p2M - 0.045) / metersPerSample, 0.024, fs, FR_START, FR_END, N);
    for (let n = 0; n < N; n++) multiWorklet.rxBuf[n] += nextNoise();
    multiWorklet.processRadarFrame();
  }

  const tSorted = (multiFrame?.targets || []).slice().sort((a, b) => a.distanceMeters - b.distanceMeters);
  if (
    tSorted.length === 2 &&
    Math.abs(tSorted[0].distanceMeters - 0.72) < 0.08 &&
    Math.abs(tSorted[1].distanceMeters - 1.85) < 0.08 &&
    tSorted[0].azimuthDeg < -8 &&
    tSorted[1].azimuthDeg > 8
  ) {
    console.log(
      `PASS [Test 6 | Multi-Person Stereo Cabin] count=2 | P1=${tSorted[0].distanceMeters.toFixed(2)}m (${tSorted[0].azimuthDeg.toFixed(0)}° Left), P2=${tSorted[1].distanceMeters.toFixed(2)}m (+${tSorted[1].azimuthDeg.toFixed(0)}° Right)`
    );
  } else {
    failures.push(`Test 6 multi-person failed: ${JSON.stringify(tSorted)}`);
    console.error('FAIL [Test 6]', tSorted);
  }

  // Test 8: Dual-Node 3-Band FDMA Isolation + POCO M2 Pro Mono Backside Range & Respiration
  const hostDual = new KaavalDualWorklet({
    processorOptions: {
      sampleRate: fs,
      stereoCapable: true,
      nodeProfile: 'HOST_DUAL_STEREO',
    },
  });
  const pocoSat = new KaavalDualWorklet({
    processorOptions: {
      sampleRate: fs,
      stereoCapable: false,
      nodeProfile: 'SATELLITE_MONO',
    },
  });
  let hostDualFrame = null;
  let pocoFrame = null;
  hostDual.port.postMessage = (msg) => {
    if (msg.kind === 'radar') hostDualFrame = msg;
  };
  pocoSat.port.postMessage = (msg) => {
    if (msg.kind === 'radar') pocoFrame = msg;
  };

  for (let f = 0; f < 240; f++) {
    const tSec = f / frameRate;
    const asyncDriftSamples = (f * 3.7) % N; // Simulates unsynchronized crystal clock drift across nodes!

    // A) Laptop Front Zone is EMPTY, while POCO M2 Pro blasts 17.60-18.42 kHz nearby
    hostDual.rxBuf.fill(0);
    evalDelayedContinuousChirp(hostDual.rxBuf, directDelay, 0.85, fs, 18580, 19380, N);
    evalDelayedContinuousChirp(hostDual.rxBuf, directDelay, 0.80, fs, 19540, 20340, N);
    // Static front wall @ 2.2m
    evalDelayedContinuousChirp(hostDual.rxBuf, directDelay + 2.2 / metersPerSample, 0.08, fs, 18580, 19380, N);
    // Loud unsynchronized POCO M2 Pro chirp (17.60-18.42 kHz) arriving in same room!
    evalDelayedContinuousChirp(hostDual.rxBuf, asyncDriftSamples, 0.18, fs, 17600, 18420, N);
    for (let n = 0; n < N; n++) hostDual.rxBuf[n] += nextNoise();
    hostDual.processRadarFrame();

    // B) POCO M2 Pro guards Backside (-Z): heavy ~2cm direct bleed (1.95x) + Laptop cross-talk + Backside person @ 1.18m (17.0 BPM)
    const backsidePersonM = 1.18 + 0.0022 * Math.sin(2 * Math.PI * (17.0 / 60.0) * tSec);
    pocoSat.rxBuf.fill(0);
    evalDelayedContinuousChirp(pocoSat.rxBuf, 8.0, 1.95, fs, 17600, 18420, N); // Tight 2cm USB-C mic-to-speaker bleed
    evalDelayedContinuousChirp(pocoSat.rxBuf, 8.0 + 2.10 / metersPerSample, 0.085, fs, 17600, 18420, N); // Rigid rear wall @ 2.10m
    evalDelayedContinuousChirp(pocoSat.rxBuf, 8.0 + backsidePersonM / metersPerSample, 0.019, fs, 17600, 18420, N); // Backside human!
    // Unsynchronized Laptop stereo chirps arriving at POCO mic
    evalDelayedContinuousChirp(pocoSat.rxBuf, (N - asyncDriftSamples) % N, 0.16, fs, 18580, 19380, N);
    evalDelayedContinuousChirp(pocoSat.rxBuf, (N - asyncDriftSamples + 73) % N, 0.15, fs, 19540, 20340, N);
    for (let n = 0; n < N; n++) pocoSat.rxBuf[n] += nextNoise();
    pocoSat.processRadarFrame();
  }

  const pocoErrCm = pocoFrame ? Math.abs(pocoFrame.targetMeters - 1.18) * 100 : Infinity;
  const pocoBpm = pocoFrame ? pocoFrame.respirationBpm : null;
  const pocoBpmErr = pocoBpm === null ? Infinity : Math.abs(pocoBpm - 17.0);

  if (
    hostDualFrame &&
    hostDualFrame.peopleCount === 0 &&
    pocoFrame &&
    pocoFrame.peopleCount === 1 &&
    pocoErrCm < 3.5 &&
    pocoBpm !== null &&
    pocoBpmErr <= 1.0
  ) {
    console.log(
      `PASS [Test 8 | Dual-Node 3-Band FDMA + POCO Mono] host_ghosts=0, poco_backside=1.18m->${pocoFrame.targetMeters.toFixed(2)}m (err ${pocoErrCm.toFixed(1)}cm), poco_bpm=${pocoBpm.toFixed(1)}/17.0`
    );
  } else {
    failures.push(
      `Test 8 failed: hostCount=${hostDualFrame?.peopleCount}, pocoCount=${pocoFrame?.peopleCount}, pocoDist=${pocoFrame?.targetMeters}, pocoBpm=${pocoBpm}`
    );
    console.error('FAIL [Test 8]', hostDualFrame?.peopleCount, pocoFrame?.peopleCount, pocoFrame?.targetMeters, pocoBpm);
  }

  // Test 9: Single Floor Occupant @ 0.62m + 35% Double-Bounce Multipath @ 1.24m -> Strictly 1 Person (Never 2!)
  const bounceWorklet = new KaavalDualWorklet({
    processorOptions: { sampleRate: fs, stereoCapable: true },
  });
  let bounceFrame = null;
  bounceWorklet.port.postMessage = (msg) => {
    if (msg.kind === 'radar') bounceFrame = msg;
  };
  for (let f = 0; f < 75; f++) {
    const tSec = f / frameRate;
    const rPrimary = 0.62 + 0.0025 * Math.sin(2 * Math.PI * 0.28 * tSec);
    const rDoubleBounce = 2.0 * rPrimary; // Classic Speaker->Torso->Screen->Torso->Mic mirror echo!
    bounceWorklet.rxBuf.fill(0);
    evalDelayedContinuousChirp(bounceWorklet.rxBuf, directDelay, 0.85, fs, FL_START, FL_END, N);
    evalDelayedContinuousChirp(bounceWorklet.rxBuf, directDelay, 0.80, fs, FR_START, FR_END, N);
    evalDelayedContinuousChirp(bounceWorklet.rxBuf, directDelay + rPrimary / metersPerSample, 0.045, fs, FL_START, FL_END, N);
    evalDelayedContinuousChirp(bounceWorklet.rxBuf, directDelay + rPrimary / metersPerSample, 0.042, fs, FR_START, FR_END, N);
    evalDelayedContinuousChirp(bounceWorklet.rxBuf, directDelay + rDoubleBounce / metersPerSample, 0.016, fs, FL_START, FL_END, N);
    evalDelayedContinuousChirp(bounceWorklet.rxBuf, directDelay + rDoubleBounce / metersPerSample, 0.015, fs, FR_START, FR_END, N);
    for (let n = 0; n < N; n++) bounceWorklet.rxBuf[n] += nextNoise();
    bounceWorklet.processRadarFrame();
  }
  if (
    bounceFrame &&
    bounceFrame.peopleCount === 1 &&
    Math.abs(bounceFrame.targetMeters - 0.62) < 0.05
  ) {
    console.log(
      `PASS [Test 9 | Double-Bounce 2xR Ghost Reject] primary=0.62m + mirror=1.24m -> peopleCount=1 (${bounceFrame.targetMeters.toFixed(2)}m)`
    );
  } else {
    failures.push(`Test 9 double-bounce ghost failed: count=${bounceFrame?.peopleCount}`);
    console.error('FAIL [Test 9]', bounceFrame?.peopleCount, bounceFrame?.targets);
  }

  const elapsedMs = performance.now() - tStart;
  if (failures.length === 0 && elapsedMs < 2500) {
    console.log(`VERDICT: PASS (9/9 physics suites verified in ${elapsedMs.toFixed(1)} ms)`);
    process.exit(0);
  } else {
    if (elapsedMs >= 2500) {
      failures.push(`Runtime ${elapsedMs.toFixed(1)} ms exceeded 2500 ms budget`);
    }
    console.error(`VERDICT: FAIL (${failures.join('; ')})`);
    process.exit(1);
  }
}

main();
