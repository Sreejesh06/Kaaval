import React, { useEffect, useRef, useState } from 'react';
import type { GuardMode, RadarFrame } from '../types';

interface Props {
  latestFrameRef: React.MutableRefObject<RadarFrame | null>;
  frameSeqRef: React.MutableRefObject<number>;
  guardMode: GuardMode;
  fallThreshold: number;
}

const BREATH_HISTORY_LEN = 280; // ~12 seconds @ 23.4 fps

function heatColor(norm: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, norm));
  if (x < 0.25) {
    return [7, Math.floor(x * 4 * 55), Math.floor(34 + x * 4 * 110)];
  }
  if (x < 0.62) {
    const t = (x - 0.25) / 0.37;
    return [Math.floor(t * 20), Math.floor(55 + t * 130), Math.floor(144 + t * 25)];
  }
  const t = (x - 0.62) / 0.38;
  return [Math.floor(20 + t * 225), Math.floor(185 - t * 25), Math.floor(169 - t * 145)];
}

export const RadarScopes: React.FC<Props> = ({
  latestFrameRef,
  frameSeqRef,
  guardMode,
  fallThreshold,
}) => {
  const cvWaterfallRef = useRef<HTMLCanvasElement | null>(null);
  const cvRangeRef = useRef<HTMLCanvasElement | null>(null);
  const cvBreathRef = useRef<HTMLCanvasElement | null>(null);
  const cvSpecRef = useRef<HTMLCanvasElement | null>(null);
  const [showRawDsp, setShowRawDsp] = useState<boolean>(false);

  const guardModeRef = useRef(guardMode);
  guardModeRef.current = guardMode;
  const fallThreshRef = useRef(fallThreshold);
  fallThreshRef.current = fallThreshold;

  useEffect(() => {
    const breathHistory = new Float32Array(BREATH_HISTORY_LEN);
    let breathPtr = 0;
    const iqTrail: Array<{ r: number; i: number }> = [];
    let lastSeq = -1;
    let rafId = 0;

    const render = () => {
      const seq = frameSeqRef.current;
      const frame = latestFrameRef.current;
      const mode = guardModeRef.current;

      if (frame && seq !== lastSeq) {
        lastSeq = seq;

        breathHistory[breathPtr] = frame.displacementMm;
        breathPtr = (breathPtr + 1) % BREATH_HISTORY_LEN;

        iqTrail.push({ r: frame.iqR, i: frame.iqI });
        if (iqTrail.length > 48) iqTrail.shift();

        drawWaterfall(cvWaterfallRef.current, frame);
        drawRangeProfile(cvRangeRef.current, frame);
        drawBreathingWave(cvBreathRef.current, breathHistory, breathPtr, frame);
        drawSpectrumAndPolar(cvSpecRef.current, frame, iqTrail, mode);
      } else if (mode === 'LISTENING_CONSENT' || mode === 'PLAYING_PROMPT') {
        drawConsentGateOverlay(cvSpecRef.current, mode);
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [latestFrameRef, frameSeqRef]);

  return (
    <div>
      <div className="scopes-grid">
        <div className="panel night-panel">
          <div className="panel-head">
            <span className="panel-title">Sub-mm chest respiration</span>
            <span className="panel-meta">Non-contact ultrasound</span>
          </div>
          <canvas ref={cvBreathRef} className="scope-canvas" width={540} height={152} />
        </div>

        <div className="panel night-panel">
          <div className="panel-head">
            <span className="panel-title">Speech privacy firewall</span>
            <span className="panel-meta" style={{ color: '#3ed598' }}>
              Speak loudly to test · 0 bytes recorded
            </span>
          </div>
          <canvas ref={cvSpecRef} className="scope-canvas" width={540} height={152} />
        </div>

        {showRawDsp && (
          <>
            <div className="panel night-panel">
              <div className="panel-head">
                <span className="panel-title">Range-time waterfall</span>
                <span className="panel-meta">0.32m → 3.0m</span>
              </div>
              <canvas ref={cvWaterfallRef} className="scope-canvas" width={540} height={152} />
            </div>

            <div className="panel night-panel">
              <div className="panel-head">
                <span className="panel-title">FMCW range &amp; motion profile</span>
                <span className="panel-meta">Matched filter</span>
              </div>
              <canvas ref={cvRangeRef} className="scope-canvas" width={540} height={152} />
            </div>
          </>
        )}
      </div>

      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => setShowRawDsp((v) => !v)}
          style={{ minHeight: 28, padding: '3px 12px', fontSize: 11.5 }}
        >
          {showRawDsp ? 'Hide raw FMCW waterfall' : '+ Show raw FMCW waterfall'}
        </button>
      </div>
    </div>
  );
};

function drawWaterfall(canvas: HTMLCanvasElement | null, f: RadarFrame) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  const prev = ctx.getImageData(0, 0, w, h - 2);
  ctx.putImageData(prev, 0, 2);

  const row = ctx.createImageData(w, 2);
  const minBin = Math.floor(0.32 / f.metersPerSample);
  const span = Math.max(1, f.clutterRemovedProfile.length - minBin);
  const normScale = 1 / (f.directMag * 0.16 + 1e-6);

  for (let x = 0; x < w; x++) {
    const bin = minBin + Math.floor((x / w) * span);
    const energy = Math.max(0, (f.clutterRemovedProfile[bin] + 1.5 * f.motionProfile[bin]) * normScale - 0.04);
    const [r, g, b] = heatColor(Math.pow(Math.min(1, energy), 0.72));
    for (let dy = 0; dy < 2; dy++) {
      const idx = (dy * w + x) * 4;
      row.data[idx] = r;
      row.data[idx + 1] = g;
      row.data[idx + 2] = b;
      row.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(row, 0, 0);

  // Subtle distance ticks at top edge
  ctx.fillStyle = 'rgba(232,238,245,0.65)';
  ctx.font = '10px "DM Mono", monospace';
  const maxM = f.clutterRemovedProfile.length * f.metersPerSample;
  for (let m = 0.5; m < maxM; m += 0.5) {
    const x = ((m - 0.2) / (maxM - 0.2)) * w;
    if (x > 12 && x < w - 28) {
      ctx.fillRect(x, 0, 1, 5);
    }
  }
}

function drawRangeProfile(canvas: HTMLCanvasElement | null, f: RadarFrame) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const maxM = f.clutterRemovedProfile.length * f.metersPerSample;
  ctx.strokeStyle = '#141d29';
  ctx.fillStyle = '#566579';
  ctx.font = '10px "DM Mono", monospace';

  for (let m = 0.5; m < maxM; m += 0.5) {
    const x = (m / maxM) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.fillText(`${m.toFixed(1)}m`, x + 3, 12);
  }

  // Active range gate cursors for all confirmed people
  ctx.strokeStyle = 'rgba(20, 184, 166, 0.45)';
  ctx.setLineDash([3, 3]);
  for (const t of f.targets || []) {
    const lx = (t.distanceMeters / maxM) * w;
    ctx.beginPath();
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx, h);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const minBin = Math.floor(0.32 / f.metersPerSample);
  const scale = 1 / (f.directMag * 0.18 + 1e-6);

  ctx.strokeStyle = '#14b8a6';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = minBin; i < f.clutterRemovedProfile.length; i++) {
    const x = (i / f.clutterRemovedProfile.length) * w;
    const y = h - Math.min(h - 10, f.clutterRemovedProfile[i] * scale * (h - 16));
    if (i === minBin) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (let i = minBin; i < f.motionProfile.length; i++) {
    const x = (i / f.motionProfile.length) * w;
    const y = h - Math.min(h - 10, f.motionProfile[i] * scale * 2.1 * (h - 16));
    if (i === minBin) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawBreathingWave(
  canvas: HTMLCanvasElement | null,
  history: Float32Array,
  ptr: number,
  f: RadarFrame
) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = '#141d29';
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  let maxAbs = 2.2;
  for (let i = 0; i < history.length; i++) {
    const a = Math.abs(history[i]);
    if (a > maxAbs) maxAbs = Math.min(18, a);
  }

  ctx.strokeStyle = '#14b8a6';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let i = 0; i < history.length; i++) {
    const v = history[(ptr + i) % history.length];
    const x = (i / (history.length - 1)) * w;
    const y = h / 2 - (v / maxAbs) * (h * 0.41);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = '#8a99ad';
  ctx.font = '10px "DM Mono", monospace';
  ctx.fillText(`SCALE ±${maxAbs.toFixed(1)} mm`, 8, 13);
  ctx.fillText(
    f.respirationBpm ? `AUTOCORR: ${f.respirationBpm.toFixed(0)} BPM` : 'AUTOCORR: ACQUIRING / STILL',
    w - 175,
    13
  );
}

function drawSpectrumAndPolar(
  canvas: HTMLCanvasElement | null,
  f: RadarFrame,
  iqTrail: Array<{ r: number; i: number }>,
  mode: GuardMode
) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const specW = Math.floor(w * 0.65);
  const nyquist = f.fs / 2;
  const cutX = (17500 / nyquist) * specW;

  ctx.fillStyle = 'rgba(225, 29, 72, 0.07)';
  ctx.fillRect(0, 0, cutX, h);

  ctx.strokeStyle = '#e11d48';
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(cutX, 0);
  ctx.lineTo(cutX, h);
  ctx.stroke();
  ctx.setLineDash([]);

  const nBins = f.spectrumDb.length;
  const barW = specW / nBins;
  for (let i = 0; i < nBins; i++) {
    const hz = (i / nBins) * nyquist;
    const norm = Math.max(0, Math.min(1, (f.spectrumDb[i] + 98) / 82));
    const barH = norm * (h - 22);
    ctx.fillStyle = hz < 17500 ? 'rgba(225, 29, 72, 0.55)' : '#14b8a6';
    ctx.fillRect(i * barW, h - barH, Math.max(1, barW - 0.8), barH);
  }

  ctx.font = '600 10px "DM Mono", monospace';
  ctx.fillStyle = '#fda4af';
  ctx.fillText('VOICE BLOCKED (<17.5k = 0)', 6, 13);
  ctx.fillStyle = '#3ed598';
  ctx.fillText('SONAR', cutX + 5, 13);

  // IQ Polar Plot on right 35%
  const cx = specW + (w - specW) / 2;
  const cy = h / 2 + 4;
  const rad = Math.min(w - specW, h) * 0.36;

  ctx.strokeStyle = '#1e2836';
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.moveTo(cx - rad, cy);
  ctx.lineTo(cx + rad, cy);
  ctx.moveTo(cx, cy - rad);
  ctx.lineTo(cx, cy + rad);
  ctx.stroke();

  let maxR = 0.025;
  for (const pt of iqTrail) {
    const m = Math.hypot(pt.r, pt.i);
    if (m > maxR) maxR = m;
  }

  ctx.strokeStyle = '#14b8a6';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  iqTrail.forEach((pt, idx) => {
    const px = cx + (pt.r / maxR) * rad;
    const py = cy - (pt.i / maxR) * rad;
    if (idx === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  if (iqTrail.length > 0) {
    const head = iqTrail[iqTrail.length - 1];
    ctx.fillStyle = mode === 'ANOMALY_PREALERT' ? '#f59e0b' : '#14b8a6';
    ctx.beginPath();
    ctx.arc(cx + (head.r / maxR) * rad, cy - (head.i / maxR) * rad, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawConsentGateOverlay(canvas: HTMLCanvasElement | null, mode: GuardMode) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = '#12080d';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#e11d48';
  ctx.strokeRect(8, 8, w - 16, h - 16);

  ctx.fillStyle = '#fda4af';
  ctx.font = '600 12px "DM Mono", monospace';
  ctx.fillText(
    mode === 'PLAYING_PROMPT'
      ? 'ULTRASOUND PAUSED // PLAYING BULBUL v3 MALAYALAM PROMPT'
      : 'CONSENT MIC UNLOCKED // STREAMING 16 kHz PCM TO SAARAS v4',
    22,
    h / 2 - 6
  );

  ctx.fillStyle = '#8a99ad';
  ctx.font = '11px "DM Mono", monospace';
  ctx.fillText(
    'Speech firewall automatically re-locks (<17.5 kHz zeroed) once check-in completes.',
    22,
    h / 2 + 16
  );
}
