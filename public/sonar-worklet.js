/**
 * KAAVAL v2 — Stereo FDMA 2D Spatial Ultrasonic Sonar & Consent-Gated PCM Worklet
 *
 * Stereo Spatial Physics:
 * - Left Speaker  (Channel 0): Linear FMCW chirp 17.60 kHz -> 18.85 kHz (Tukey-tapered)
 * - Right Speaker (Channel 1): Linear FMCW chirp 19.00 kHz -> 20.25 kHz (Tukey-tapered)
 * - Frequency bands are 100% orthogonal in the same 2048-sample FFT window (zero Doppler skew).
 * - Independent direct-path calibration on L & R removes chassis mic-offset asymmetry.
 * - Fuses L/R Time-Difference-of-Arrival (TDOA) + normalized Stereo Intensity Balance (ILD)
 *   to localize human presence & motion in 2D floor coordinates (X lateral, Z depth) and
 *   populate a 28 x 15 volumetric polar acoustic field for real-time 3D visualization.
 */

const N = 2048;
const HALF_N = N >> 1;
const SPEED_OF_SOUND = 348.0;
const SPEAKER_BASELINE_M = 0.28; // ~28 cm MacBook stereo speaker separation

// Orthogonal FDMA Stereo Ultrasonic Sub-bands inside MacBook's flat 17.6–20.3 kHz plateau
const FL_START = 17600;
const FL_END = 18850;
const FR_START = 19000;
const FR_END = 20250;
const F_FIREWALL_CUTOFF = 17500;

const MAX_RANGE_METERS = 3.0;
const MIN_TARGET_METERS = 0.48; // Blank <48cm laptop chassis/screen/table near-field ringdown
const TARGET_STT_RATE = 16000;
const STT_CHUNK_SAMPLES = 1600;

const SPATIAL_R_SLICES = 28;
const SPATIAL_AZ_BINS = 15; // -52.5 deg .. +52.5 deg in 7.5 deg steps

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
    this.taperEndBin = Math.ceil(0.68 / this.metersPerSample);

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

    // Per-channel static clutter & previous echo state
    this.clutterLRe = new Float32Array(this.maxRangeBins);
    this.clutterLIm = new Float32Array(this.maxRangeBins);
    this.clutterRRe = new Float32Array(this.maxRangeBins);
    this.clutterRIm = new Float32Array(this.maxRangeBins);
    this.prevLRe = new Float32Array(this.maxRangeBins);
    this.prevLIm = new Float32Array(this.maxRangeBins);
    this.prevRRe = new Float32Array(this.maxRangeBins);
    this.prevRIm = new Float32Array(this.maxRangeBins);

    this.cleanLAmp = new Float32Array(this.maxRangeBins);
    this.cleanRAmp = new Float32Array(this.maxRangeBins);
    this.ambientMag = new Float32Array(this.maxRangeBins);
    this.staticMag = new Float32Array(this.maxRangeBins);
    this.motionMag = new Float32Array(this.maxRangeBins);
    this.spectrumDb = new Float32Array(128);
    this.spatialGrid = new Float32Array(SPATIAL_R_SLICES * SPATIAL_AZ_BINS);

    this.respBufLen = 352;
    this.respRing = new Float32Array(this.respBufLen);
    this.respPtr = 0;
    this.respFilled = 0;

    this.mode = 'SONAR_LOCKED';
    this.targetGain = 0.58;
    this.currentGain = 0.58;
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
        this.clutterInitialized = false;
      } else if (m.type === 'recalibrate') {
        this.directIdxL = -1;
        this.directIdxR = -1;
        this.clutterInitialized = false;
        this.phaseInitialized = false;
      } else if (m.type === 'set_gain') {
        this.targetGain = Math.max(0.05, Math.min(0.95, m.value));
      } else if (m.type === 'lock_range') {
        this.manualLockMeters = m.meters;
      }
    };
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
    if (stdMm < 0.18 || stdMm > 14.0) return null;

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

    if (bestCorr < 0.32 || bestLag <= 0) return null;
    return (60 * this.frameRate) / bestLag;
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

    // PRIVACY FIREWALL + DUAL ORTHOGONAL ANALYTIC MATCHED FILTERS (< 17.5 kHz strictly zeroed)
    this.corrLRe.fill(0);
    this.corrLIm.fill(0);
    this.corrRRe.fill(0);
    this.corrRIm.fill(0);

    for (let k = this.binLMin; k <= this.binLMax; k++) {
      const rxR = this.fftRe[k];
      const rxI = this.fftIm[k];
      const txR = this.txSpecLRe[k];
      const txI = this.txSpecLIm[k];
      this.corrLRe[k] = 2 * (rxR * txR + rxI * txI);
      this.corrLIm[k] = 2 * (rxI * txR - rxR * txI);
    }
    for (let k = this.binRMin; k <= this.binRMax; k++) {
      const rxR = this.fftRe[k];
      const rxI = this.fftIm[k];
      const txR = this.txSpecRRe[k];
      const txI = this.txSpecRIm[k];
      this.corrRRe[k] = 2 * (rxR * txR + rxI * txI);
      this.corrRIm[k] = 2 * (rxI * txR - rxR * txI);
    }

    fftInPlace(this.corrLRe, this.corrLIm, true);
    fftInPlace(this.corrRRe, this.corrRIm, true);

    // Wait 18 frames (~0.75s) so speaker gain & room reflections settle before locking
    if (this.frameCount < 18) return;

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
    const normFactorR = Math.max(0.4, Math.min(2.5, directMagL / directMagR));
    const rightUsable = directMagR > directMagL * 0.12;

    const resyncing = this.resyncFrames > 0;
    if (resyncing) this.resyncFrames--;

    let strongestScore = 0;
    let strongestBin = this.lockedBin;
    let peakMotionAmp = 0;
    let sumMotionAmp = 0;
    let peakPresenceAmp = 0;
    let activeBinCount = 0;

    for (let m = 0; m < this.maxRangeBins; m++) {
      const idxL = (this.directIdxL + m) & (N - 1);
      const idxR = (this.directIdxR + m) & (N - 1);

      const zLR = this.corrLRe[idxL];
      const zLI = this.corrLIm[idxL];
      const zRR = rightUsable ? this.corrRRe[idxR] * normFactorR : zLR;
      const zRI = rightUsable ? this.corrRIm[idxR] * normFactorR : zLI;

      if (!this.clutterInitialized) {
        this.clutterLRe[m] = zLR; this.clutterLIm[m] = zLI;
        this.clutterRRe[m] = zRR; this.clutterRIm[m] = zRI;
        this.prevLRe[m] = zLR;    this.prevLIm[m] = zLI;
        this.prevRRe[m] = zRR;    this.prevRIm[m] = zRI;
      } else {
        const binAlpha =
          this.frameCount < 60
            ? 0.08
            : Math.abs(m - this.lockedBin) <= 14
              ? 0.00025
              : 0.0045;
        this.clutterLRe[m] += binAlpha * (zLR - this.clutterLRe[m]);
        this.clutterLIm[m] += binAlpha * (zLI - this.clutterLIm[m]);
        this.clutterRRe[m] += binAlpha * (zRR - this.clutterRRe[m]);
        this.clutterRIm[m] += binAlpha * (zRI - this.clutterRIm[m]);
      }

      if (m < this.minTargetBin) {
        this.cleanLAmp[m] = 0;
        this.cleanRAmp[m] = 0;
        this.ambientMag[m] = 0;
        this.staticMag[m] = 0;
        this.motionMag[m] = 0;
        this.prevLRe[m] = zLR; this.prevLIm[m] = zLI;
        this.prevRRe[m] = zRR; this.prevRIm[m] = zRI;
        continue;
      }

      // Smooth cosine near-field window (0.48m -> 0.68m) + sqrt(R) spherical spreading compensation
      let rangeWeight = Math.sqrt((m * this.metersPerSample) / 0.85);
      if (m < this.taperEndBin) {
        const u = (m - this.minTargetBin) / Math.max(1, this.taperEndBin - this.minTargetBin);
        rangeWeight *= 0.5 * (1 - Math.cos(Math.PI * u));
      }

      // Static room structure reflection (walls, furniture, cabin woodwork)
      this.ambientMag[m] =
        0.5 *
        (Math.hypot(this.clutterLRe[m], this.clutterLIm[m]) +
          Math.hypot(this.clutterRRe[m], this.clutterRIm[m])) *
        rangeWeight;

      const cLR = (zLR - this.clutterLRe[m]) * rangeWeight;
      const cLI = (zLI - this.clutterLIm[m]) * rangeWeight;
      const cRR = (zRR - this.clutterRRe[m]) * rangeWeight;
      const cRI = (zRI - this.clutterRIm[m]) * rangeWeight;

      if (resyncing) {
        this.prevLRe[m] = zLR;
        this.prevLIm[m] = zLI;
        this.prevRRe[m] = zRR;
        this.prevRIm[m] = zRI;
      }

      const dLR = (zLR - this.prevLRe[m]) * rangeWeight;
      const dLI = (zLI - this.prevLIm[m]) * rangeWeight;
      const dRR = (zRR - this.prevRRe[m]) * rangeWeight;
      const dRI = (zRI - this.prevRIm[m]) * rangeWeight;
      this.prevLRe[m] = zLR; this.prevLIm[m] = zLI;
      this.prevRRe[m] = zRR; this.prevRIm[m] = zRI;

      const ampL = Math.hypot(cLR, cLI);
      const ampR = Math.hypot(cRR, cRI);
      const motL = Math.hypot(dLR, dLI);
      const motR = Math.hypot(dRR, dRI);

      this.cleanLAmp[m] = ampL + 1.5 * motL;
      this.cleanRAmp[m] = ampR + 1.5 * motR;

      const combinedClean = 0.5 * (ampL + ampR);
      const combinedMot = 0.5 * (motL + motR);
      this.staticMag[m] = combinedClean;
      this.motionMag[m] = combinedMot;

      activeBinCount++;
      sumMotionAmp += combinedMot;
      if (combinedMot > peakMotionAmp) peakMotionAmp = combinedMot;
      if (combinedClean > peakPresenceAmp) peakPresenceAmp = combinedClean;
      const score = combinedClean + 2.4 * combinedMot;
      if (score > strongestScore) {
        strongestScore = score;
        strongestBin = m;
      }
    }
    this.clutterInitialized = true;

    const prevLocked = this.lockedBin;
    if (this.manualLockMeters > 0.20) {
      this.lockedBin = Math.min(
        this.maxRangeBins - 1,
        Math.floor(this.manualLockMeters / this.metersPerSample)
      );
    } else if (strongestScore > directMagL * 0.004) {
      const delta = strongestBin - this.lockedBin;
      if (Math.abs(delta) <= 7) {
        this.lockedBin = Math.round(0.82 * this.lockedBin + 0.18 * strongestBin);
      } else if (strongestScore > directMagL * 0.02) {
        this.lockedBin = strongestBin;
      }
    }

    const targetMeters = this.lockedBin * this.metersPerSample;
    const radialVelocityMps = (targetMeters - this.prevTargetMeters) * this.frameRate;
    this.prevTargetMeters = targetMeters;

    // 2D Stereo Azimuth Localization around lockedBin:
    // Search +/- 38 lag bins (~27 cm max physical path delta) for peak L arrival vs peak R arrival
    const winRadius = 38;
    const wStart = Math.max(this.minTargetBin, this.lockedBin - winRadius);
    const wEnd = Math.min(this.maxRangeBins - 1, this.lockedBin + winRadius);
    let peakValL = 0, peakBinL = this.lockedBin;
    let peakValR = 0, peakBinR = this.lockedBin;
    let sumWinL = 0, sumWinR = 0;

    for (let m = wStart; m <= wEnd; m++) {
      const vL = this.cleanLAmp[m];
      const vR = this.cleanRAmp[m];
      sumWinL += vL;
      sumWinR += vR;
      if (vL > peakValL) { peakValL = vL; peakBinL = m; }
      if (vR > peakValR) { peakValR = vR; peakBinR = m; }
    }

    // If target is on the RIGHT (+X), path from Right speaker is shorter: peakBinR < peakBinL
    const deltaPathMeters = (peakBinL - peakBinR) * (2 * this.metersPerSample);
    const sinFromTdoa = Math.max(-0.85, Math.min(0.85, deltaPathMeters / SPEAKER_BASELINE_M));
    const intensityBalance = (sumWinR - sumWinL) / (sumWinR + sumWinL + 1e-6);
    const rawSinTheta = this.stereoActive
      ? Math.max(-0.82, Math.min(0.82, 0.52 * sinFromTdoa + 0.48 * Math.max(-0.85, Math.min(0.85, intensityBalance * 1.45))))
      : 0;

    if (strongestScore > directMagL * 0.005) {
      this.smoothedSinTheta = 0.80 * this.smoothedSinTheta + 0.20 * rawSinTheta;
    }

    const thetaRad = Math.asin(Math.max(-0.82, Math.min(0.82, this.smoothedSinTheta)));
    const targetAzimuthDeg = (thetaRad * 180) / Math.PI;
    const lateralDegPerSec = (targetAzimuthDeg - this.prevAzimuthDeg) * this.frameRate;
    this.prevAzimuthDeg = targetAzimuthDeg;

    const targetX = targetMeters * Math.sin(thetaRad);
    const targetZ = targetMeters * Math.cos(thetaRad);

    // Build 28 x 15 Polar Volumetric Acoustic Field for 3D Observatory
    const usableBins = this.maxRangeBins - this.minTargetBin;
    const binsPerSlice = Math.max(1, Math.floor(usableBins / SPATIAL_R_SLICES));
    const fieldNorm = 1 / (directMagL * 0.22 + 1e-6);

    for (let rs = 0; rs < SPATIAL_R_SLICES; rs++) {
      const b0 = this.minTargetBin + rs * binsPerSlice;
      const b1 = Math.min(this.maxRangeBins, b0 + binsPerSlice);
      let sL = 0, sR = 0, maxComb = 0;
      for (let b = b0; b < b1; b++) {
        sL += this.cleanLAmp[b];
        sR += this.cleanRAmp[b];
        const c = this.staticMag[b] + 1.6 * this.motionMag[b];
        if (c > maxComb) maxComb = c;
      }
      const sliceAmp = Math.min(1.0, Math.max(0, maxComb * fieldNorm - 0.04));
      const sliceBal = this.stereoActive && rightUsable ? (sR - sL) / (sR + sL + 1e-6) : 0;
      const centerAzIdx = ((Math.max(-0.85, Math.min(0.85, sliceBal * 1.15)) + 1) * 0.5) * (SPATIAL_AZ_BINS - 1);

      for (let az = 0; az < SPATIAL_AZ_BINS; az++) {
        const distAz = (az - centerAzIdx) / 2.8;
        const beamWeight = Math.exp(-0.5 * distAz * distAz);
        const idx = rs * SPATIAL_AZ_BINS + az;
        this.spatialGrid[idx] = 0.65 * this.spatialGrid[idx] + 0.35 * (sliceAmp * beamWeight);
      }
    }

    // Coherent IQ chest phase extraction from primary channel @ lockedBin
    const tIdxL = (this.directIdxL + this.lockedBin) & (N - 1);
    const iqR = this.corrLRe[tIdxL] - this.clutterLRe[this.lockedBin];
    const iqI = this.corrLIm[tIdxL] - this.clutterLIm[this.lockedBin];
    const rawPhase = Math.atan2(iqI, iqR);

    if (!this.phaseInitialized) {
      this.lastRawPhase = rawPhase;
      this.unwrappedPhase = 0;
      this.phaseInitialized = true;
    } else if (this.lockedBin !== prevLocked) {
      this.lastRawPhase = rawPhase;
    } else {
      let dPhi = rawPhase - this.lastRawPhase;
      while (dPhi > Math.PI) dPhi -= 2 * Math.PI;
      while (dPhi < -Math.PI) dPhi += 2 * Math.PI;
      this.lastRawPhase = rawPhase;
      this.unwrappedPhase = 0.992 * this.unwrappedPhase + dPhi;
    }

    const wavelengthMm = (SPEED_OF_SOUND / 18900) * 1000;
    const displacementMm = (wavelengthMm / (4 * Math.PI)) * this.unwrappedPhase;

    this.respRing[this.respPtr] = displacementMm;
    this.respPtr = (this.respPtr + 1) % this.respBufLen;
    if (this.respFilled < this.respBufLen) this.respFilled++;
    const respirationBpm =
      this.frameCount % 6 === 0 ? this.estimateRespirationBpm() : this.lastBpm ?? null;
    this.lastBpm = respirationBpm;

    // Calibrated motion scale: quiet cabin ≈ 0.08–0.35, normal walk ≈ 1.1–2.8, sudden slump/fall ≥ 4.5
    const meanMot = sumMotionAmp / Math.max(1, activeBinCount);
    const rawMot = ((peakMotionAmp * 0.55 + meanMot * 2.5) / directMagL) * 6.2;
    const motionNorm = this.frameCount < 45 || resyncing ? 0 : Math.max(0, rawMot - 0.12);
    const presenceNorm = (peakPresenceAmp / directMagL) * 5.0;

    const primitives = [];
    if (presenceNorm < 0.25 && motionNorm < 0.55) {
      primitives.push('EMPTY_BASELINE');
    } else {
      primitives.push('ROOM_OCCUPIED');
      if (motionNorm >= 4.2) primitives.push('IMPACT_TRANSIENT');
      if (radialVelocityMps < -0.25 && motionNorm > 1.0) primitives.push('APPROACHING_SENSOR');
      else if (radialVelocityMps > 0.25 && motionNorm > 1.0) primitives.push('RECEDING_SENSOR');
      if (Math.abs(lateralDegPerSec) > 18 && motionNorm > 0.9) primitives.push('LATERAL_TRANSIT');
      if (motionNorm < 0.85 && respirationBpm !== null) primitives.push('RESTING_RESPIRATION');
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
      targetMeters,
      targetAzimuthDeg,
      targetX,
      targetZ,
      radialVelocityMps,
      displacementMm,
      respirationBpm,
      iqR: iqR / directMagL,
      iqI: iqI / directMagL,
      motionEnergy: motionNorm,
      presenceRatio: presenceNorm,
      primitives,
      spectrumDb: this.spectrumDb.slice(),
      ambientClutterProfile: this.ambientMag.slice(),
      clutterRemovedProfile: this.staticMag.slice(),
      motionProfile: this.motionMag.slice(),
      spatialGrid: this.spatialGrid.slice(),
      spatialRangeSlices: SPATIAL_R_SLICES,
      spatialAzimuthBins: SPATIAL_AZ_BINS,
    });
  }
}

registerProcessor('kaaval-dual-worklet', KaavalDualWorklet);
