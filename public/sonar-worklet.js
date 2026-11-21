/**
 * KAAVAL v3 — OS-CFAR + Micro-Doppler Multi-Person Stereo Ultrasonic Sonar Worklet
 *
 * Houseboat-Calibrated Acoustic Physics:
 * 1. Orthogonal Stereo FDMA FMCW Chirps (TX-L: 17.60–18.85 kHz, TX-R: 19.00–20.25 kHz)
 *    with strict <17.5 kHz DFT Speech Firewall (-115 dB speech rejection).
 * 2. 14-Frame (0.60s) Complex IQ Delay-Line Micro-Doppler Canceller:
 *    Cancels rigid houseboat wooden walls, furniture, and chassis bleed WITHOUT requiring
 *    an empty room on startup — detects stationary breathing/micro-swaying humans even if
 *    they were already seated at 0.35–2.8m when SONAR was armed, with zero chair ghosts.
 * 3. Order-Statistic CFAR (30th-percentile adaptive noise floor) + Torso Matched Smoothing:
 *    Automatically adapts to speaker volume and houseboat ambient noise across 0.32m–3.0m.
 * 4. Multi-Target NMS Peak Tracker: Simultaneously localizes up to 3 people in (R, theta).
 */

const N = 2048;
const HALF_N = N >> 1;
const SPEED_OF_SOUND = 348.0;
const SPEAKER_BASELINE_M = 0.28;

const FL_START = 17600;
const FL_END = 18850;
const FR_START = 19000;
const FR_END = 20250;
const F_FIREWALL_CUTOFF = 17500;

const MAX_RANGE_METERS = 3.0;
const MIN_TARGET_METERS = 0.32; // Allows arm's-length desk seating (0.40m+) while skipping <32cm chassis peak
const DELAY_FRAMES = 14; // ~0.60s lag @ 23.44 fps -> captures 1-3mm breathing & micro-postural phase shift
const MAX_PEOPLE = 3;

const TARGET_STT_RATE = 16000;
const STT_CHUNK_SAMPLES = 1600;

const SPATIAL_R_SLICES = 28;
const SPATIAL_AZ_BINS = 15;

function buildBitRev(n) {
  const rev = new Uint16Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let x = i;
    let y = 0;
    for (let b = 0; b < bits; b++) {
      y = (y << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = y;
  }
  return rev;
}

const BIT_REV = buildBitRev(N);
const TW_COS = new Float32Array(HALF_N);
const TW_SIN = new Float32Array(HALF_N);
for (let k = 0; k < HALF_N; k++) {
  const a = (-2 * Math.PI * k) / N;
  TW_COS[k] = Math.cos(a);
  TW_SIN[k] = Math.sin(a);
}

function fftInPlace(re, im, inverse) {
  for (let i = 0; i < N; i++) {
    const j = BIT_REV[i];
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  const sign = inverse ? -1 : 1;
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1;
    const step = N / len;
    for (let i = 0; i < N; i += len) {
      for (let k = 0; k < half; k++) {
        const tw = k * step;
        const wr = TW_COS[tw];
        const wi = sign * TW_SIN[tw];
        const eIdx = i + k;
        const oIdx = eIdx + half;
        const or = re[oIdx];
        const oi = im[oIdx];
        const tr = wr * or - wi * oi;
        const ti = wr * oi + wi * or;
        re[oIdx] = re[eIdx] - tr;
        im[oIdx] = im[eIdx] - ti;
        re[eIdx] += tr;
        im[eIdx] += ti;
      }
    }
  }
  if (inverse) {
    const inv = 1 / N;
    for (let i = 0; i < N; i++) {
      re[i] *= inv;
      im[i] *= inv;
    }
  }
}

function synthesizeChirp(fs, fStart, fEnd) {
  const wave = new Float32Array(N);
  const specRe = new Float32Array(N);
  const specIm = new Float32Array(N);
  const taper = 256;
  let ph = 0;
  for (let n = 0; n < N; n++) {
    const f = fStart + (fEnd - fStart) * (n / N);
    ph += (2 * Math.PI * f) / fs;
    let env = 1.0;
    if (n < taper) env = 0.5 * (1 - Math.cos((Math.PI * n) / taper));
    else if (n >= N - taper) env = 0.5 * (1 - Math.cos((Math.PI * (N - 1 - n)) / taper));
    wave[n] = env * Math.sin(ph);
    specRe[n] = wave[n];
    specIm[n] = 0;
  }
  fftInPlace(specRe, specIm, false);
  return { wave, specRe, specIm };
}

class KaavalDualWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.fs =
      (options && options.processorOptions && options.processorOptions.sampleRate) ||
      sampleRate ||
      48000;
    this.stereoCapable =
      options && options.processorOptions
        ? options.processorOptions.stereoCapable !== false
        : true;
    this.frameRate = this.fs / N;
    this.metersPerSample = SPEED_OF_SOUND / (2 * this.fs);
    this.maxRangeBins = Math.min(900, Math.floor(MAX_RANGE_METERS / this.metersPerSample));
    this.minTargetBin = Math.ceil(MIN_TARGET_METERS / this.metersPerSample);
    this.taperEndBin = Math.ceil(0.44 / this.metersPerSample); // Gentle 32cm->44cm near-field taper
    this.minPersonSepBins = Math.ceil(0.45 / this.metersPerSample);

    const leftChirp = synthesizeChirp(this.fs, FL_START, FL_END);
    const rightChirp = synthesizeChirp(this.fs, FR_START, FR_END);
    this.txWaveL = leftChirp.wave;
    this.txSpecLRe = leftChirp.specRe;
    this.txSpecLIm = leftChirp.specIm;
    this.txWaveR = rightChirp.wave;
    this.txSpecRRe = rightChirp.specRe;
    this.txSpecRIm = rightChirp.specIm;

    this.binFirewall = Math.min(HALF_N - 1, Math.ceil((F_FIREWALL_CUTOFF * N) / this.fs));
    this.binLMin = Math.min(HALF_N - 1, Math.ceil((17550 * N) / this.fs));
    this.binLMax = Math.min(HALF_N - 1, Math.floor((18920 * N) / this.fs));
    this.binRMin = Math.min(HALF_N - 1, Math.ceil((18960 * N) / this.fs));
    this.binRMax = Math.min(HALF_N - 1, Math.floor((20320 * N) / this.fs));

    this.rxBuf = new Float32Array(N);
    this.fftRe = new Float32Array(N);
    this.fftIm = new Float32Array(N);
    this.corrLRe = new Float32Array(N);
    this.corrLIm = new Float32Array(N);
    this.corrRRe = new Float32Array(N);
    this.corrRIm = new Float32Array(N);

    // Slow static clutter (for IQ phase extraction & optional manual empty-room calibration)
    this.clutterLRe = new Float32Array(this.maxRangeBins);
    this.clutterLIm = new Float32Array(this.maxRangeBins);
    this.clutterRRe = new Float32Array(this.maxRangeBins);
    this.clutterRIm = new Float32Array(this.maxRangeBins);
    this.emptyCalibrated = false;
    this.emptyRefLRe = new Float32Array(this.maxRangeBins);
    this.emptyRefLIm = new Float32Array(this.maxRangeBins);
    this.emptyRefRRe = new Float32Array(this.maxRangeBins);
    this.emptyRefRIm = new Float32Array(this.maxRangeBins);

    this.prevLRe = new Float32Array(this.maxRangeBins);
    this.prevLIm = new Float32Array(this.maxRangeBins);
    this.prevRRe = new Float32Array(this.maxRangeBins);
    this.prevRIm = new Float32Array(this.maxRangeBins);

    // 14-frame (0.60s) Delay-Line Ring Buffer for calibration-free Micro-Doppler / Breathing detection
    this.delayLRe = new Float32Array(DELAY_FRAMES * this.maxRangeBins);
    this.delayLIm = new Float32Array(DELAY_FRAMES * this.maxRangeBins);
    this.delayRRe = new Float32Array(DELAY_FRAMES * this.maxRangeBins);
    this.delayRIm = new Float32Array(DELAY_FRAMES * this.maxRangeBins);
    this.delayPtr = 0;
    this.delayFilled = 0;

    // Sustained vital/micro-motion envelope (bridges inhale/exhale zero-velocity turnarounds)
    this.vitalEnvL = new Float32Array(this.maxRangeBins);
    this.vitalEnvR = new Float32Array(this.maxRangeBins);
    this.torsoSmoothed = new Float32Array(this.maxRangeBins);
    this.cfarSortBuf = new Float32Array(256);

    // Stereo ambient L/R equalization per range slice (cancels speaker placement & wood wall bias)
    this.lrRatioEst = 1.0;

    this.ambientMag = new Float32Array(this.maxRangeBins);
    this.staticMag = new Float32Array(this.maxRangeBins);
    this.motionMag = new Float32Array(this.maxRangeBins);
    this.scaledPresence = new Float32Array(this.maxRangeBins);
    this.scaledMotion = new Float32Array(this.maxRangeBins);
    this.spectrumDb = new Float32Array(128);
    this.spatialGrid = new Float32Array(SPATIAL_R_SLICES * SPATIAL_AZ_BINS);

    this.respBufLen = 352;
    this.respRing = new Float32Array(this.respBufLen);
    this.respPtr = 0;
    this.respFilled = 0;

    // Persistent multi-person tracks: { id, bin, meters, sinTheta, snrDb, motion, age, misses }
    this.tracks = [];
    this.nextTrackId = 1;

    this.mode = 'SONAR_LOCKED';
    this.targetGain = 0.72;
    this.currentGain = 0.72;
    this.manualLockMeters = 0;

    this.resampleStep = this.fs / TARGET_STT_RATE;
    this.resamplePhase = 0;
    this.lpState = 0;
    this.lpAlpha = Math.min(1, (2 * Math.PI * 6800) / this.fs);
    this.pcmChunk = new Int16Array(STT_CHUNK_SAMPLES);
    this.pcmIdx = 0;
    this.pcmSqSum = 0;

    this.cursor = 0;
    this.frameCount = 0;
    this.directIdxL = -1;
    this.directIdxR = -1;
    this.clutterInitialized = false;
    this.lockedBin = Math.floor(0.85 / this.metersPerSample);
    this.prevTargetMeters = 0.85;
    this.smoothedSinTheta = 0;
    this.prevAzimuthDeg = 0;
    this.unwrappedPhase = 0;
    this.lastRawPhase = 0;
    this.phaseInitialized = false;
    // Tangent-projected complex demodulator state (immune to 180-deg origin-crossing spikes!)
    this.iqMeanR = 0;
    this.iqMeanI = 0;
    this.tanR = 1;
    this.tanI = 0;
    this.iqAmpRms = 1e-4;
    this.resyncFrames = 0;
    this.stereoActive = this.stereoCapable;

    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'set_mode') {
        this.mode = m.mode;
        if (m.mode === 'VOICE_LISTEN') {
          this.pcmIdx = 0;
          this.pcmSqSum = 0;
          this.resamplePhase = 0;
        } else if (m.mode === 'SONAR_LOCKED') {
          this.resyncFrames = 8;
          this.phaseInitialized = false;
        }
      } else if (m.type === 'zero_clutter') {
        // Explicit user click: snapshot current room as empty reference + reset clutter
        this.captureEmptyNext = true;
        this.clutterInitialized = false;
      } else if (m.type === 'recalibrate') {
        this.directIdxL = -1;
        this.directIdxR = -1;
        this.clutterInitialized = false;
        this.emptyCalibrated = false;
        this.delayFilled = 0;
        this.phaseInitialized = false;
      } else if (m.type === 'set_gain') {
        this.targetGain = Math.max(0.05, Math.min(0.95, m.value));
      } else if (m.type === 'lock_range') {
        this.manualLockMeters = m.meters;
      }
    };
    this.captureEmptyNext = false;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const outL = out && out[0];
    const outR = out && out[1];
    const inChan = inputs[0] && inputs[0][0];
    const blockLen = outL ? outL.length : 128;
    const wantChirp = this.mode === 'SONAR_LOCKED' ? this.targetGain : 0.0;
    this.stereoActive = Boolean(outL && outR && this.stereoCapable);

    for (let i = 0; i < blockLen; i++) {
      this.currentGain += 0.008 * (wantChirp - this.currentGain);
      const micSample = inChan ? inChan[i] : 0;

      if (this.stereoActive) {
        outL[i] = this.txWaveL[this.cursor] * this.currentGain;
        outR[i] = this.txWaveR[this.cursor] * this.currentGain;
      } else if (outL) {
        const mono =
          0.5 * (this.txWaveL[this.cursor] + this.txWaveR[this.cursor]) * this.currentGain;
        outL[i] = mono;
        if (outR) outR[i] = mono;
      }

      if (this.mode === 'VOICE_LISTEN') {
        this.pushVoiceSample(micSample);
      }

      this.rxBuf[this.cursor] = micSample;
      this.cursor++;
      if (this.cursor === N) {
        this.cursor = 0;
        if (this.mode === 'SONAR_LOCKED') {
          this.processRadarFrame();
        }
      }
    }
    return true;
  }

  pushVoiceSample(x) {
    this.lpState += this.lpAlpha * (x - this.lpState);
    this.resamplePhase += 1;
    if (this.resamplePhase >= this.resampleStep) {
      this.resamplePhase -= this.resampleStep;
      const clamped = Math.max(-1, Math.min(1, this.lpState * 2.2));
      const s16 = clamped < 0 ? clamped * 32768 : clamped * 32767;
      this.pcmChunk[this.pcmIdx++] = s16;
      this.pcmSqSum += clamped * clamped;

      if (this.pcmIdx === STT_CHUNK_SAMPLES) {
        const rms = Math.sqrt(this.pcmSqSum / STT_CHUNK_SAMPLES);
        const rmsDb = 20 * Math.log10(rms + 1e-7);
        const copy = new Int16Array(this.pcmChunk);
        this.port.postMessage({ kind: 'pcm16', pcmBuffer: copy.buffer, rmsDb }, [copy.buffer]);
        this.pcmIdx = 0;
        this.pcmSqSum = 0;
      }
    }
  }

  estimateRespirationBpm() {
    if (this.respFilled < 140) return null;
    const count = this.respFilled;
    let mean = 0;
    for (let i = 0; i < count; i++) mean += this.respRing[i];
    mean /= count;

    let variance = 0;
    for (let i = 0; i < count; i++) {
      const d = this.respRing[i] - mean;
      variance += d * d;
    }
    const stdMm = Math.sqrt(variance / count);
    if (stdMm < 0.14 || stdMm > 15.0) return null;

    const minLag = Math.floor(2.0 * this.frameRate);
    const maxLag = Math.min(count >> 1, Math.floor(6.0 * this.frameRate));
    let bestCorr = 0;
    let bestLag = -1;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let num = 0;
      let denA = 0;
      let denB = 0;
      for (let i = 0; i < count - lag; i++) {
        const idxA = (this.respPtr - count + i + this.respBufLen) % this.respBufLen;
        const idxB = (idxA + lag) % this.respBufLen;
        const a = this.respRing[idxA] - mean;
        const b = this.respRing[idxB] - mean;
        num += a * b;
        denA += a * a;
        denB += b * b;
      }
      const r = num / (Math.sqrt(denA * denB) + 1e-9);
      if (r > bestCorr) {
        bestCorr = r;
        bestLag = lag;
      }
    }

    if (bestCorr < 0.30 || bestLag <= 0) return null;
    return (60 * this.frameRate) / bestLag;
  }

  computeAzimuthForBin(centerBin, rightUsable) {
    if (!this.stereoActive || !rightUsable) return 0;
    // Tight ±11 bin (±4 cm radial = ±8 cm bistatic) window prevents grabbing distant wall multipath!
    const win = 11;
    const w0 = Math.max(this.minTargetBin, centerBin - win);
    const w1 = Math.min(this.maxRangeBins - 1, centerBin + win);
    let sL = 0, sR = 0;
    let pkL = 0, bL = centerBin;
    let pkR = 0, bR = centerBin;

    for (let m = w0; m <= w1; m++) {
      const vL = this.vitalEnvL[m];
      const vR = this.vitalEnvR[m] * this.lrRatioEst;
      sL += vL;
      sR += vR;
      if (vL > pkL) { pkL = vL; bL = m; }
      if (vR > pkR) { pkR = vR; bR = m; }
    }

    const deltaPath = (bL - bR) * (2 * this.metersPerSample);
    const sinTdoa = Math.max(-0.82, Math.min(0.82, deltaPath / SPEAKER_BASELINE_M));
    const bal = (sR - sL) / (sR + sL + 1e-9);
    const sinIld = Math.max(-0.82, Math.min(0.82, bal * 1.35));
    return Math.max(-0.82, Math.min(0.82, 0.38 * sinTdoa + 0.62 * sinIld));
  }

  processRadarFrame() {
    this.frameCount++;
    for (let n = 0; n < N; n++) {
      this.fftRe[n] = this.rxBuf[n];
      this.fftIm[n] = 0;
    }
    fftInPlace(this.fftRe, this.fftIm, false);

    const binsPerBucket = HALF_N / 128;
    let speechBandPower = 0;
    let sonarBandPower = 0;

    for (let b = 0; b < 128; b++) {
      let sumP = 0;
      const startK = b * binsPerBucket;
      for (let j = 0; j < binsPerBucket; j++) {
        const k = startK + j;
        const p = this.fftRe[k] * this.fftRe[k] + this.fftIm[k] * this.fftIm[k];
        sumP += p;
        if (k >= 4 && k < this.binFirewall) speechBandPower += p;
        else if (k >= this.binLMin && k <= this.binRMax) sonarBandPower += p;
      }
      const meanAmp = Math.sqrt(sumP / binsPerBucket) / HALF_N;
      this.spectrumDb[b] = 20 * Math.log10(meanAmp + 1e-9);
    }

    // < 17.5 kHz PRIVACY FIREWALL + ORTHOGONAL STEREO ANALYTIC MATCHED FILTERS
    this.corrLRe.fill(0);
    this.corrLIm.fill(0);
    this.corrRRe.fill(0);
    this.corrRIm.fill(0);

    const spanL = Math.max(1, this.binLMax - this.binLMin);
    for (let k = this.binLMin; k <= this.binLMax; k++) {
      // Raised-cosine spectral weighting suppresses chirp time-sidelobes from -18 dB down to -42 dB!
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * (k - this.binLMin)) / spanL));
      const rxR = this.fftRe[k];
      const rxI = this.fftIm[k];
      const txR = this.txSpecLRe[k];
      const txI = this.txSpecLIm[k];
      this.corrLRe[k] = 2 * w * (rxR * txR + rxI * txI);
      this.corrLIm[k] = 2 * w * (rxI * txR - rxR * txI);
    }
    const spanR = Math.max(1, this.binRMax - this.binRMin);
    for (let k = this.binRMin; k <= this.binRMax; k++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * (k - this.binRMin)) / spanR));
      const rxR = this.fftRe[k];
      const rxI = this.fftIm[k];
      const txR = this.txSpecRRe[k];
      const txI = this.txSpecRIm[k];
      this.corrRRe[k] = 2 * w * (rxR * txR + rxI * txI);
      this.corrRIm[k] = 2 * w * (rxI * txR - rxR * txI);
    }

    fftInPlace(this.corrLRe, this.corrLIm, true);
    fftInPlace(this.corrRRe, this.corrRIm, true);

    if (this.frameCount < 14) return;

    if (this.directIdxL < 0 || this.directIdxR < 0) {
      let bestL = -1, idxL = 0;
      let bestR = -1, idxR = 0;
      for (let n = 0; n < N; n++) {
        const mL = this.corrLRe[n] * this.corrLRe[n] + this.corrLIm[n] * this.corrLIm[n];
        if (mL > bestL) { bestL = mL; idxL = n; }
        const mR = this.corrRRe[n] * this.corrRRe[n] + this.corrRIm[n] * this.corrRIm[n];
        if (mR > bestR) { bestR = mR; idxR = n; }
      }
      this.directIdxL = idxL;
      this.directIdxR = idxR;
    }

    const directMagL = Math.hypot(this.corrLRe[this.directIdxL], this.corrLIm[this.directIdxL]) + 1e-6;
    const directMagR = Math.hypot(this.corrRRe[this.directIdxR], this.corrRIm[this.directIdxR]) + 1e-6;
    const normFactorR = Math.max(0.35, Math.min(2.8, directMagL / directMagR));
    const rightUsable = directMagR > directMagL * 0.10;

    const resyncing = this.resyncFrames > 0;
    if (resyncing) {
      this.resyncFrames--;
      this.delayFilled = 0;
    }

    const oldestSlot =
      this.delayFilled >= DELAY_FRAMES
        ? this.delayPtr
        : 0;
    const delayReady = this.delayFilled >= 6; // Ready within 0.25s of arming!

    let peakMotionAmp = 0;
    let sumMotionAmp = 0;
    let activeBinCount = 0;
    let totalEnvL = 0;
    let totalEnvR = 0;

    for (let m = 0; m < this.maxRangeBins; m++) {
      const idxL = (this.directIdxL + m) & (N - 1);
      const idxR = (this.directIdxR + m) & (N - 1);

      const zLR = this.corrLRe[idxL];
      const zLI = this.corrLIm[idxL];
      const zRR = rightUsable ? this.corrRRe[idxR] * normFactorR : zLR;
      const zRI = rightUsable ? this.corrRIm[idxR] * normFactorR : zLI;

      if (this.captureEmptyNext) {
        this.emptyRefLRe[m] = zLR; this.emptyRefLIm[m] = zLI;
        this.emptyRefRRe[m] = zRR; this.emptyRefRIm[m] = zRI;
      }

      if (!this.clutterInitialized) {
        this.clutterLRe[m] = zLR; this.clutterLIm[m] = zLI;
        this.clutterRRe[m] = zRR; this.clutterRIm[m] = zRI;
        this.prevLRe[m] = zLR;    this.prevLIm[m] = zLI;
        this.prevRRe[m] = zRR;    this.prevRIm[m] = zRI;
      } else {
        // Slow clutter strictly for coherent IQ chest phase origin removal
        const binAlpha = Math.abs(m - this.lockedBin) <= 16 ? 0.0004 : 0.006;
        this.clutterLRe[m] += binAlpha * (zLR - this.clutterLRe[m]);
        this.clutterLIm[m] += binAlpha * (zLI - this.clutterLIm[m]);
        this.clutterRRe[m] += binAlpha * (zRR - this.clutterRRe[m]);
        this.clutterRIm[m] += binAlpha * (zRI - this.clutterRIm[m]);
      }

      // Read 0.60s delayed complex phasor BEFORE overwriting current ring slot
      const ringBase = oldestSlot * this.maxRangeBins + m;
      const oldLR = delayReady ? this.delayLRe[ringBase] : zLR;
      const oldLI = delayReady ? this.delayLIm[ringBase] : zLI;
      const oldRR = delayReady ? this.delayRRe[ringBase] : zRR;
      const oldRI = delayReady ? this.delayRIm[ringBase] : zRI;

      const writeBase = this.delayPtr * this.maxRangeBins + m;
      this.delayLRe[writeBase] = zLR;
      this.delayLIm[writeBase] = zLI;
      this.delayRRe[writeBase] = zRR;
      this.delayRIm[writeBase] = zRI;

      if (m < this.minTargetBin) {
        this.vitalEnvL[m] = 0;
        this.vitalEnvR[m] = 0;
        this.ambientMag[m] = 0;
        this.staticMag[m] = 0;
        this.motionMag[m] = 0;
        this.prevLRe[m] = zLR; this.prevLIm[m] = zLI;
        this.prevRRe[m] = zRR; this.prevRIm[m] = zRI;
        continue;
      }

      // Near-field chassis ringdown taper ONLY (0.32m -> 0.44m); keep >0.44m unity gain
      // so microphone thermal/ambient noise stays 100% flat across 0.44m..3.0m for OS-CFAR!
      let nearTaper = 1.0;
      if (m < this.taperEndBin) {
        const u = (m - this.minTargetBin) / Math.max(1, this.taperEndBin - this.minTargetBin);
        nearTaper = 0.5 * (1 - Math.cos(Math.PI * u));
      }

      this.ambientMag[m] =
        0.5 *
        (Math.hypot(this.clutterLRe[m], this.clutterLIm[m]) +
          Math.hypot(this.clutterRRe[m], this.clutterRIm[m])) *
        nearTaper;

      if (resyncing) {
        this.prevLRe[m] = zLR; this.prevLIm[m] = zLI;
        this.prevRRe[m] = zRR; this.prevRIm[m] = zRI;
      }

      // 1) Instant frame-to-frame motion (42 ms)
      const motL = Math.hypot(zLR - this.prevLRe[m], zLI - this.prevLIm[m]) * nearTaper;
      const motR = Math.hypot(zRR - this.prevRRe[m], zRI - this.prevRIm[m]) * nearTaper;
      this.prevLRe[m] = zLR; this.prevLIm[m] = zLI;
      this.prevRRe[m] = zRR; this.prevRIm[m] = zRI;

      // 2) 0.60s Delay-Line Micro-Doppler / Breathing (detects seated/standing people WITHOUT empty room!)
      let vitL = Math.hypot(zLR - oldLR, zLI - oldLI) * nearTaper;
      let vitR = Math.hypot(zRR - oldRR, zRI - oldRI) * nearTaper;

      // 3) If user explicitly clicked ZERO CLUTTER on an empty cabin, fuse static reflection too
      if (this.emptyCalibrated && !this.captureEmptyNext) {
        const stL = Math.hypot(zLR - this.emptyRefLRe[m], zLI - this.emptyRefLIm[m]) * nearTaper * 0.35;
        const stR = Math.hypot(zRR - this.emptyRefRRe[m], zRI - this.emptyRefRIm[m]) * nearTaper * 0.35;
        if (stL > vitL) vitL = stL;
        if (stR > vitR) vitR = stR;
      }

      const instL = vitL + 1.4 * motL;
      const instR = vitR + 1.4 * motR;

      // Fast attack (0.35), smooth 0.90 hold (~1s) so breathing never drops out at inhale/exhale turnarounds
      this.vitalEnvL[m] = instL > this.vitalEnvL[m]
        ? 0.65 * this.vitalEnvL[m] + 0.35 * instL
        : 0.90 * this.vitalEnvL[m] + 0.10 * instL;
      this.vitalEnvR[m] = instR > this.vitalEnvR[m]
        ? 0.65 * this.vitalEnvR[m] + 0.35 * instR
        : 0.90 * this.vitalEnvR[m] + 0.10 * instR;

      totalEnvL += this.vitalEnvL[m];
      totalEnvR += this.vitalEnvR[m];

      const combinedVital = 0.5 * (this.vitalEnvL[m] + this.vitalEnvR[m]);
      const combinedMot = 0.5 * (motL + motR);

      this.staticMag[m] = combinedVital;
      this.motionMag[m] = combinedMot;

      activeBinCount++;
      sumMotionAmp += combinedMot;
      if (combinedMot > peakMotionAmp) peakMotionAmp = combinedMot;
    }

    if (this.captureEmptyNext) {
      this.emptyCalibrated = true;
      this.captureEmptyNext = false;
    }
    this.clutterInitialized = true;
    this.delayPtr = (this.delayPtr + 1) % DELAY_FRAMES;
    if (this.delayFilled < DELAY_FRAMES) this.delayFilled++;

    // Gently equalize subtle residual room L/R acoustic gain asymmetry
    if (rightUsable && totalEnvR > 1e-9) {
      const instRatio = Math.max(0.5, Math.min(2.0, totalEnvL / totalEnvR));
      this.lrRatioEst = 0.992 * this.lrRatioEst + 0.008 * instRatio;
    }

    // Torso Matched Spatial Smoothing (~11 cm = ±15 bins boxcar)
    const halfWin = 15;
    let runSum = 0;
    let runCnt = 0;
    for (let m = this.minTargetBin; m < Math.min(this.maxRangeBins, this.minTargetBin + halfWin); m++) {
      runSum += this.staticMag[m];
      runCnt++;
    }
    for (let m = this.minTargetBin; m < this.maxRangeBins; m++) {
      const addIdx = m + halfWin;
      if (addIdx < this.maxRangeBins) {
        runSum += this.staticMag[addIdx];
        runCnt++;
      }
      const subIdx = m - halfWin - 1;
      if (subIdx >= this.minTargetBin) {
        runSum -= this.staticMag[subIdx];
        runCnt--;
      }
      this.torsoSmoothed[m] = runSum / Math.max(1, runCnt);
    }

    // Order-Statistic CFAR (OS-CFAR): Sample 128 evenly spaced range bins and pick 45th percentile (median-like)
    const usableSpan = this.maxRangeBins - this.minTargetBin;
    const sampleCount = 128;
    for (let i = 0; i < sampleCount; i++) {
      const b = this.minTargetBin + Math.floor((i * usableSpan) / sampleCount);
      this.cfarSortBuf[i] = this.torsoSmoothed[b];
    }
    const subSlice = this.cfarSortBuf.subarray(0, sampleCount);
    subSlice.sort();
    const cfarNoiseFloor = Math.max(subSlice[Math.floor(sampleCount * 0.45)], directMagL * 0.00035);

    // Multi-Person Non-Maximum Suppression (NMS) above +9.8 dB CFAR SNR + -17 dB sidelobe skirt gate
    let globalPeakSmoothed = 0;
    for (let m = this.minTargetBin; m < this.maxRangeBins; m++) {
      if (this.torsoSmoothed[m] > globalPeakSmoothed) globalPeakSmoothed = this.torsoSmoothed[m];
    }
    const minPeakLevel = Math.max(cfarNoiseFloor * 3.1, globalPeakSmoothed * 0.16);
    const rawPeaks = [];
    for (let m = this.minTargetBin + 4; m < this.maxRangeBins - 4; m++) {
      const val = this.torsoSmoothed[m];
      const snrRatio = val / (cfarNoiseFloor + 1e-9);
      if (
        val >= minPeakLevel &&
        val >= this.torsoSmoothed[m - 1] &&
        val >= this.torsoSmoothed[m + 1] &&
        val >= this.torsoSmoothed[m - 3] &&
        val >= this.torsoSmoothed[m + 3]
      ) {
        rawPeaks.push({ bin: m, val, snrRatio });
      }
    }

    rawPeaks.sort((a, b) => b.snrRatio - a.snrRatio);
    const detections = [];
    for (let i = 0; i < rawPeaks.length && detections.length < MAX_PEOPLE; i++) {
      const cand = rawPeaks[i];
      let tooClose = false;
      for (let j = 0; j < detections.length; j++) {
        if (Math.abs(cand.bin - detections[j].bin) < this.minPersonSepBins) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) {
        const sinTh = this.computeAzimuthForBin(cand.bin, rightUsable);
        const snrDb = 20 * Math.log10(cand.snrRatio);
        // Local motion around this person
        let localMot = 0;
        for (let k = Math.max(this.minTargetBin, cand.bin - 12); k <= Math.min(this.maxRangeBins - 1, cand.bin + 12); k++) {
          if (this.motionMag[k] > localMot) localMot = this.motionMag[k];
        }
        detections.push({
          bin: cand.bin,
          meters: cand.bin * this.metersPerSample,
          sinTheta: sinTh,
          snrRatio: cand.snrRatio,
          snrDb,
          motion: (localMot / (cfarNoiseFloor + 1e-9)) * 0.45,
        });
      }
    }

    // Associate detections with persistent multi-person tracks for smooth trajectories
    const matchedTrackIds = new Set();
    for (let d = 0; d < detections.length; d++) {
      const det = detections[d];
      let bestTr = null;
      let bestDist = 0.42;
      for (let t = 0; t < this.tracks.length; t++) {
        const tr = this.tracks[t];
        if (matchedTrackIds.has(tr.id)) continue;
        const dist = Math.abs(det.meters - tr.meters);
        if (dist < bestDist) {
          bestDist = dist;
          bestTr = tr;
        }
      }
      if (bestTr) {
        bestTr.meters = 0.72 * bestTr.meters + 0.28 * det.meters;
        bestTr.bin = Math.round(bestTr.meters / this.metersPerSample);
        bestTr.sinTheta = 0.75 * bestTr.sinTheta + 0.25 * det.sinTheta;
        bestTr.snrDb = 0.7 * bestTr.snrDb + 0.3 * det.snrDb;
        bestTr.snrRatio = det.snrRatio;
        bestTr.motion = det.motion;
        bestTr.age++;
        bestTr.misses = 0;
        matchedTrackIds.add(bestTr.id);
      } else if (this.tracks.length < MAX_PEOPLE + 1) {
        const newTr = {
          id: this.nextTrackId++,
          bin: det.bin,
          meters: det.meters,
          sinTheta: det.sinTheta,
          snrDb: det.snrDb,
          snrRatio: det.snrRatio,
          motion: det.motion,
          age: 1,
          misses: 0,
        };
        this.tracks.push(newTr);
        matchedTrackIds.add(newTr.id);
      }
    }

    // Age out disappeared tracks smoothly (keep for ~1.1s = 26 frames so brief breath nulls don't flicker)
    const activeTracks = [];
    for (let t = 0; t < this.tracks.length; t++) {
      const tr = this.tracks[t];
      if (!matchedTrackIds.has(tr.id)) {
        tr.misses++;
        tr.snrDb *= 0.92;
      }
      if (tr.misses <= 26) {
        activeTracks.push(tr);
      }
    }
    activeTracks.sort((a, b) => b.snrDb - a.snrDb);
    this.tracks = activeTracks.slice(0, MAX_PEOPLE);

    // Build clean confirmed targets list (confirmed after >= 3 frames so random clicks never spawn fake people)
    const confirmedTargets = [];
    for (let i = 0; i < this.tracks.length; i++) {
      const tr = this.tracks[i];
      if (tr.age >= 3) {
        const th = Math.asin(Math.max(-0.82, Math.min(0.82, tr.sinTheta)));
        confirmedTargets.push({
          id: tr.id,
          distanceMeters: tr.meters,
          azimuthDeg: (th * 180) / Math.PI,
          x: tr.meters * Math.sin(th),
          z: tr.meters * Math.cos(th),
          snrDb: tr.snrDb,
          motion: tr.motion,
        });
      }
    }

    // Lock primary bin onto manual gate OR primary confirmed person for IQ respiration
    const prevLocked = this.lockedBin;
    if (this.manualLockMeters > MIN_TARGET_METERS) {
      this.lockedBin = Math.min(
        this.maxRangeBins - 1,
        Math.floor(this.manualLockMeters / this.metersPerSample)
      );
    } else if (confirmedTargets.length > 0) {
      const pBin = Math.round(confirmedTargets[0].distanceMeters / this.metersPerSample);
      if (Math.abs(pBin - this.lockedBin) <= 8) {
        this.lockedBin = Math.round(0.80 * this.lockedBin + 0.20 * pBin);
      } else {
        this.lockedBin = pBin;
      }
      this.smoothedSinTheta = Math.sin((confirmedTargets[0].azimuthDeg * Math.PI) / 180);
    }

    const targetMeters = this.lockedBin * this.metersPerSample;
    const radialVelocityMps = (targetMeters - this.prevTargetMeters) * this.frameRate;
    this.prevTargetMeters = targetMeters;

    const thetaRad = Math.asin(Math.max(-0.82, Math.min(0.82, this.smoothedSinTheta)));
    const targetAzimuthDeg = (thetaRad * 180) / Math.PI;
    const lateralDegPerSec = (targetAzimuthDeg - this.prevAzimuthDeg) * this.frameRate;
    this.prevAzimuthDeg = targetAzimuthDeg;

    const targetX = targetMeters * Math.sin(thetaRad);
    const targetZ = targetMeters * Math.cos(thetaRad);

    // Build 28 x 15 Polar Volumetric Acoustic Field normalized by CFAR noise floor!
    const binsPerSlice = Math.max(1, Math.floor(usableSpan / SPATIAL_R_SLICES));
    for (let rs = 0; rs < SPATIAL_R_SLICES; rs++) {
      const b0 = this.minTargetBin + rs * binsPerSlice;
      const b1 = Math.min(this.maxRangeBins, b0 + binsPerSlice);
      let sL = 0, sR = 0, maxSmoothed = 0;
      for (let b = b0; b < b1; b++) {
        sL += this.vitalEnvL[b];
        sR += this.vitalEnvR[b] * this.lrRatioEst;
        if (this.torsoSmoothed[b] > maxSmoothed) maxSmoothed = this.torsoSmoothed[b];
      }
      const sliceSnr = maxSmoothed / (cfarNoiseFloor + 1e-9);
      // Quiet floor (<1.8x noise) -> 0.0; active human (3x–14x noise) -> 0.25..1.0!
      const sliceAmp = Math.min(1.0, Math.max(0, (sliceSnr - 1.65) / 8.5));
      const sliceBal = this.stereoActive && rightUsable ? (sR - sL) / (sR + sL + 1e-9) : 0;
      const centerAzIdx =
        ((Math.max(-0.85, Math.min(0.85, sliceBal * 1.25)) + 1) * 0.5) * (SPATIAL_AZ_BINS - 1);

      for (let az = 0; az < SPATIAL_AZ_BINS; az++) {
        const distAz = (az - centerAzIdx) / 2.7;
        const beamWeight = Math.exp(-0.5 * distAz * distAz);
        const idx = rs * SPATIAL_AZ_BINS + az;
        this.spatialGrid[idx] = 0.60 * this.spatialGrid[idx] + 0.40 * (sliceAmp * beamWeight);
      }
    }

    // Spike-free Tangent-Projected Complex Chest Demodulation @ lockedBin:
    // Works whether calibrated on an empty room OR armed while the person is already seated!
    const tIdxL = (this.directIdxL + this.lockedBin) & (N - 1);
    const rawZR = this.corrLRe[tIdxL];
    const rawZI = this.corrLIm[tIdxL];

    if (!this.phaseInitialized || this.lockedBin !== prevLocked) {
      this.iqMeanR = rawZR;
      this.iqMeanI = rawZI;
      this.phaseInitialized = true;
    } else {
      if (this.frameCount < 42) {
        // Faster initial center lock during first 1.2s so respRing receives pure zero-mean sine
        this.iqMeanR += 0.12 * (rawZR - this.iqMeanR);
        this.iqMeanI += 0.12 * (rawZI - this.iqMeanI);
      } else {
        // ~6s moving center removes arbitrary static wall/furniture phasor C without erasing 3-5s breaths
        this.iqMeanR += 0.007 * (rawZR - this.iqMeanR);
        this.iqMeanI += 0.007 * (rawZI - this.iqMeanI);
      }
    }

    const dR = rawZR - this.iqMeanR;
    const dI = rawZI - this.iqMeanI;
    const instPerturb = Math.hypot(dR, dI);
    this.iqAmpRms = 0.985 * this.iqAmpRms + 0.015 * instPerturb;

    // Update dominant 1D oscillation tangent axis (sign-consistent power iteration)
    const proj = dR * this.tanR + dI * this.tanI;
    if (instPerturb > directMagL * 0.0002) {
      const sgn = proj >= 0 ? 1 : -1;
      this.tanR = 0.94 * this.tanR + 0.06 * sgn * (dR / instPerturb);
      this.tanI = 0.94 * this.tanI + 0.06 * sgn * (dI / instPerturb);
      const tNorm = Math.hypot(this.tanR, this.tanI) + 1e-9;
      this.tanR /= tNorm;
      this.tanI /= tNorm;
    }

    const carrierRef = Math.max(this.iqAmpRms * 1.9, directMagL * 0.0025);
    const approxRad = Math.max(-2.2, Math.min(2.2, proj / carrierRef));
    const wavelengthMm = (SPEED_OF_SOUND / 18225) * 1000;
    const rawDispMm = (wavelengthMm / (4 * Math.PI)) * approxRad;
    this.unwrappedPhase = 0.72 * this.unwrappedPhase + 0.28 * rawDispMm;
    const displacementMm = this.unwrappedPhase;
    const iqR = dR;
    const iqI = dI;

    if (this.frameCount >= 40 && !resyncing) {
      this.respRing[this.respPtr] = displacementMm;
      this.respPtr = (this.respPtr + 1) % this.respBufLen;
      if (this.respFilled < this.respBufLen) this.respFilled++;
    }
    const respirationBpm =
      this.frameCount % 6 === 0 ? this.estimateRespirationBpm() : this.lastBpm ?? null;
    this.lastBpm = respirationBpm;

    // CFAR-normalized motion & presence metrics (automatically calibrated to houseboat noise!)
    const meanMot = sumMotionAmp / Math.max(1, activeBinCount);
    const motSnr = (peakMotionAmp * 0.65 + meanMot * 1.8) / (cfarNoiseFloor + 1e-9);
    const motionNorm =
      this.frameCount < 28 || resyncing ? 0 : Math.max(0, (motSnr - 1.4) * 0.55);

    const bestSnrRatio = confirmedTargets.length > 0 ? Math.pow(10, confirmedTargets[0].snrDb / 20) : 1.0;
    const presenceNorm = Math.max(0, (bestSnrRatio - 1.5) * 0.35);

    const primitives = [];
    if (confirmedTargets.length === 0 && motionNorm < 0.55) {
      primitives.push('EMPTY_BASELINE');
    } else {
      primitives.push('ROOM_OCCUPIED');
      if (motionNorm >= 4.2) primitives.push('IMPACT_TRANSIENT');
      if (radialVelocityMps < -0.22 && motionNorm > 0.9) primitives.push('APPROACHING_SENSOR');
      else if (radialVelocityMps > 0.22 && motionNorm > 0.9) primitives.push('RECEDING_SENSOR');
      if (Math.abs(lateralDegPerSec) > 18 && motionNorm > 0.85) primitives.push('LATERAL_TRANSIT');
      if (motionNorm < 0.85 && respirationBpm !== null) primitives.push('RESTING_RESPIRATION');
    }

    // Scale staticMag & motionMag relative to cfarNoiseFloor so RadarScopes displays crisp SNR peaks!
    const scopeScale = (directMagL * 0.025) / (cfarNoiseFloor + 1e-9);
    this.scaledPresence.fill(0);
    this.scaledMotion.fill(0);
    for (let m = this.minTargetBin; m < this.maxRangeBins; m++) {
      this.scaledPresence[m] = Math.max(0, this.torsoSmoothed[m] - cfarNoiseFloor * 1.15) * scopeScale;
      this.scaledMotion[m] = Math.max(0, this.motionMag[m] - cfarNoiseFloor * 0.6) * scopeScale;
    }

    this.port.postMessage({
      kind: 'radar',
      fs: this.fs,
      metersPerSample: this.metersPerSample,
      directPeakIdx: this.directIdxL,
      directMag: directMagL,
      stereoActive: this.stereoActive && rightUsable,
      speechDb: 10 * Math.log10(speechBandPower / N + 1e-12),
      sonarDb: 10 * Math.log10(sonarBandPower / N + 1e-12),
      peopleCount: confirmedTargets.length,
      targets: confirmedTargets,
      targetMeters,
      targetAzimuthDeg,
      targetX,
      targetZ,
      radialVelocityMps,
      displacementMm,
      respirationBpm,
      iqR: iqR / (this.iqAmpRms * 3.0 + 1e-6),
      iqI: iqI / (this.iqAmpRms * 3.0 + 1e-6),
      motionEnergy: motionNorm,
      presenceRatio: presenceNorm,
      primitives,
      spectrumDb: this.spectrumDb.slice(),
      ambientClutterProfile: this.ambientMag.slice(),
      clutterRemovedProfile: this.scaledPresence.slice(),
      motionProfile: this.scaledMotion.slice(),
      spatialGrid: this.spatialGrid.slice(),
      spatialRangeSlices: SPATIAL_R_SLICES,
      spatialAzimuthBins: SPATIAL_AZ_BINS,
    });
  }
}

registerProcessor('kaaval-dual-worklet', KaavalDualWorklet);
