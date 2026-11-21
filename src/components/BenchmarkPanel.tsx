import React, { useState } from 'react';
import type { BenchmarkSummary, GroundTruthClass, RadarFrame } from '../types';

interface Props {
  summary: BenchmarkSummary;
  sonarArmed: boolean;
  onRequestArm?: () => void;
  subscribeFrames: (cb: ((f: RadarFrame) => void) | null) => void;
  onSummaryUpdated: (next: BenchmarkSummary) => void;
}

const CLASSES: Array<{ id: GroundTruthClass; label: string; protocol: string }> = [
  {
    id: 'EMPTY_CABIN',
    label: 'Empty cabin',
    protocol: 'Step >2.5m out of the beam for 5s (measures false-alarm baseline on boat).',
  },
  {
    id: 'SEATED_BREATHING',
    label: 'Seated breathing',
    protocol: 'Sit still at 0.6–1.4m and breathe naturally for 5s.',
  },
  {
    id: 'WALKING_NORMAL',
    label: 'Walking past',
    protocol: 'Walk continuously across or toward the laptop at 0.5–2.0m for 5s.',
  },
  {
    id: 'FALL_STILLNESS',
    label: 'Fall + stillness',
    protocol: 'Drop or slump rapidly in the first 1.5s, then stay motionless for 3.5s.',
  },
];

export const BenchmarkPanel: React.FC<Props> = ({
  summary,
  sonarArmed,
  onRequestArm,
  subscribeFrames,
  onSummaryUpdated,
}) => {
  const [selectedClass, setSelectedClass] = useState<GroundTruthClass>('SEATED_BREATHING');
  const [recordingLeft, setRecordingLeft] = useState<number | null>(null);
  const [confirmingReset, setConfirmingReset] = useState<boolean>(false);

  const runFiveSecondTrial = () => {
    if (!sonarArmed) {
      onRequestArm?.();
      return;
    }
    if (recordingLeft !== null) return;

    const frames: RadarFrame[] = [];
    subscribeFrames((f) => frames.push(f));
    const durationSec = 5.0;
    const started = performance.now();

    const tick = window.setInterval(() => {
      const elapsed = (performance.now() - started) / 1000;
      const rem = Math.max(0, durationSec - elapsed);
      setRecordingLeft(rem);

      if (rem <= 0) {
        window.clearInterval(tick);
        subscribeFrames(null);
        setRecordingLeft(null);
        submitTrial(frames, durationSec);
      }
    }, 100);
  };

  const submitTrial = async (frames: RadarFrame[], durationSec: number) => {
    if (frames.length === 0) return;

    let peakMotion = 0;
    let peakIdx = 0;
    let sumDist = 0;
    let sumPresence = 0;
    let sumSnr = 0;
    let meanDisp = 0;

    frames.forEach((f, idx) => {
      if (f.motionEnergy > peakMotion) {
        peakMotion = f.motionEnergy;
        peakIdx = idx;
      }
      sumDist += f.targetMeters;
      sumPresence += f.presenceRatio;
      sumSnr += f.sonarDb;
      meanDisp += f.displacementMm;
    });
    meanDisp /= frames.length;

    let varDisp = 0;
    for (const f of frames) {
      const d = f.displacementMm - meanDisp;
      varDisp += d * d;
    }
    const breathStdMm = Math.sqrt(varDisp / frames.length);

    const tailStart = Math.min(
      frames.length - 1,
      Math.max(peakIdx + 8, Math.floor(frames.length * 0.6))
    );
    let tailSum = 0;
    let tailCount = 0;
    for (let i = tailStart; i < frames.length; i++) {
      tailSum += frames[i].motionEnergy;
      tailCount++;
    }
    const postSpikeMotion = tailCount > 0 ? tailSum / tailCount : 0;

    const res = await fetch('/api/benchmark/trial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected: selectedClass,
        durationSec,
        meanDistanceM: sumDist / frames.length,
        peakMotion,
        postSpikeMotion,
        breathStdMm,
        meanPresence: sumPresence / frames.length,
        sonarSnrDb: sumSnr / frames.length,
      }),
    });
    const data = await res.json();
    if (data.summary) onSummaryUpdated(data.summary);
  };

  const clearAll = async () => {
    const res = await fetch('/api/benchmark', { method: 'DELETE' });
    onSummaryUpdated(await res.json());
    setConfirmingReset(false);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kaaval-houseboat-benchmark-${Date.now()}.json`;
    a.click();
  };

  const activeSpec = CLASSES.find((c) => c.id === selectedClass)!;

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">
          4×4 confusion matrix · {summary.trials.length} recorded trials
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button type="button" onClick={exportJson} disabled={summary.trials.length === 0}>
            Export JSON
          </button>

          {!confirmingReset ? (
            <button
              type="button"
              onClick={() => setConfirmingReset(true)}
              disabled={summary.trials.length === 0}
            >
              Reset trials
            </button>
          ) : (
            <>
              <button type="button" className="btn-danger" onClick={clearAll}>
                Confirm delete ({summary.trials.length})
              </button>
              <button type="button" onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          background: 'var(--surface-subtle)',
          border: '1px solid var(--line-default)',
          borderRadius: 8,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--content-muted)' }}>
            Ground truth:
          </span>
          {CLASSES.map((c) => (
            <button
              type="button"
              key={c.id}
              className={selectedClass === c.id ? 'btn-tab-active' : ''}
              onClick={() => setSelectedClass(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="btn-arm"
          disabled={recordingLeft !== null}
          onClick={runFiveSecondTrial}
        >
          {recordingLeft !== null
            ? `Recording... ${recordingLeft.toFixed(1)}s`
            : !sonarArmed
            ? 'Arm sonar first'
            : 'Record 5.0s live trial'}
        </button>
      </div>

      <div
        className="mono"
        style={{ fontSize: 12, color: 'var(--content-secondary)', marginBottom: 14 }}
      >
        Protocol for <strong style={{ color: 'var(--content-primary)' }}>{activeSpec.label}</strong>:{' '}
        {activeSpec.protocol}
      </div>

      <div className="readout-strip">
        <div className="readout">
          <div className="readout-k">Classification accuracy</div>
          <div className="readout-v teal">{summary.accuracyPct.toFixed(1)}%</div>
          <div className="readout-sub">{summary.trials.length} live 5s houseboat trials</div>
        </div>
        <div className="readout">
          <div className="readout-k">Unverified false-alarm rate</div>
          <div className="readout-v">{summary.falseAlarmRatePct.toFixed(1)}%</div>
          <div className="readout-sub">Further filtered by Sarvam voice gate</div>
        </div>
        <div className="readout">
          <div className="readout-k">Fall + stillness recall</div>
          <div className="readout-v amber">{summary.fallRecallPct.toFixed(1)}%</div>
          <div className="readout-sub">Impulse + post-spike stillness rule</div>
        </div>
      </div>

      <table className="matrix-table">
        <thead>
          <tr>
            <th>Actual \ Predicted</th>
            {CLASSES.map((c) => (
              <th key={c.id}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CLASSES.map((row) => (
            <tr key={row.id}>
              <th style={{ textAlign: 'left', color: 'var(--content-primary)' }}>{row.label}</th>
              {CLASSES.map((col) => {
                const count = summary.matrix?.[row.id]?.[col.id] ?? 0;
                const cls =
                  count === 0 ? '' : row.id === col.id ? 'cell-diag' : 'cell-err';
                return (
                  <td key={col.id} className={cls}>
                    {count}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
