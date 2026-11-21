import React, { useEffect, useRef, useState } from 'react';
import type { BenchmarkSummary, GroundTruthClass, GuardMode, RadarFrame } from '../types';
import { RadarScopes } from './RadarScopes';

interface Props {
  summary: BenchmarkSummary;
  sonarArmed: boolean;
  latestFrameRef: React.MutableRefObject<RadarFrame | null>;
  frameSeqRef: React.MutableRefObject<number>;
  guardMode: GuardMode;
  fallThreshold: number;
  onRequestArm?: () => Promise<void> | void;
  subscribeFrames: (cb: ((f: RadarFrame) => void) | null) => void;
  onSummaryUpdated: (next: BenchmarkSummary) => void;
}

const CLASSES: Array<{
  id: GroundTruthClass;
  label: string;
  shortLabel: string;
  protocol: string;
  liveCue: (elapsedSec: number) => { phaseTitle: string; detail: string; isDropPhase?: boolean };
}> = [
    {
      id: 'EMPTY_CABIN',
      label: 'Empty cabin',
      shortLabel: 'Empty',
      protocol: 'Step >2.5m outside the sonar cone for 5.0s to measure boat/fan false-alarm floor.',
      liveCue: () => ({
        phaseTitle: 'HOLD CLEAR (>2.5m)',
        detail: 'Keep the forward cone empty — measuring ambient houseboat clutter & false-alarm floor.',
      }),
    },
    {
      id: 'SEATED_BREATHING',
      label: 'Seated breathing',
      shortLabel: 'Seated',
      protocol: 'Sit naturally at 0.6–1.4m facing the laptop and breathe normally for 5.0s.',
      liveCue: () => ({
        phaseTitle: 'BREATHE NATURALLY (0.6–1.4m)',
        detail: 'Stay seated and relaxed — locking onto sub-mm chest wall phase (12–20 BPM).',
      }),
    },
    {
      id: 'WALKING_NORMAL',
      label: 'Walking past',
      shortLabel: 'Walking',
      protocol: 'Walk continuously across or toward the cabin at 0.5–2.0m throughout the 5.0s window.',
      liveCue: () => ({
        phaseTitle: 'KEEP MOVING (0.5–2.0m)',
        detail: 'Maintain continuous walking motion — verifying non-fall transit rejection.',
      }),
    },
    {
      id: 'FALL_STILLNESS',
      label: 'Fall + stillness',
      shortLabel: 'Fall',
      protocol: 'Drop or slump rapidly during 0–1.5s, then freeze completely still for 1.5–5.0s.',
      liveCue: (elapsedSec: number) =>
        elapsedSec < 1.55
          ? {
            phaseTitle: 'PHASE 1 (0–1.5s) · DROP OR SLUMP NOW!',
            detail: 'Create a sharp downward torso motion spike above the fall threshold.',
            isDropPhase: true,
          }
          : {
            phaseTitle: 'PHASE 2 (1.5–5.0s) · FREEZE COMPLETELY STILL!',
            detail: 'Hold motionless so the post-spike tail confirms post-fall immobility.',
            isDropPhase: false,
          },
    },
  ];

function labelForClass(id: GroundTruthClass): string {
  return CLASSES.find((c) => c.id === id)?.label ?? id;
}

export const BenchmarkPanel: React.FC<Props> = ({
  summary,
  sonarArmed,
  latestFrameRef,
  frameSeqRef,
  guardMode,
  fallThreshold,
  onRequestArm,
  subscribeFrames,
  onSummaryUpdated,
}) => {
  const [selectedClass, setSelectedClass] = useState<GroundTruthClass>('SEATED_BREATHING');
  const [recordingLeft, setRecordingLeft] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [confirmingReset, setConfirmingReset] = useState<boolean>(false);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
      }
      subscribeFrames(null);
    };
  }, [subscribeFrames]);

  const submitTrial = async (
    expectedClass: GroundTruthClass,
    frames: RadarFrame[],
    durationSec: number
  ) => {
    if (frames.length === 0) return;
    setSubmitting(true);

    try {
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
          expected: expectedClass,
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
    } finally {
      setSubmitting(false);
    }
  };

  const runFiveSecondTrial = async () => {
    if (recordingLeft !== null || submitting) return;

    if (!sonarArmed) {
      await onRequestArm?.();
      return;
    }

    const expectedAtStart = selectedClass;
    const frames: RadarFrame[] = [];
    subscribeFrames((f) => frames.push(f));
    const durationSec = 5.0;
    const started = performance.now();
    setRecordingLeft(durationSec);

    tickRef.current = window.setInterval(() => {
      const elapsed = (performance.now() - started) / 1000;
      const rem = Math.max(0, durationSec - elapsed);
      setRecordingLeft(rem);

      if (rem <= 0) {
        if (tickRef.current !== null) {
          window.clearInterval(tickRef.current);
          tickRef.current = null;
        }
        subscribeFrames(null);
        setRecordingLeft(null);
        void submitTrial(expectedAtStart, frames, durationSec);
      }
    }, 80);
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
  const isRecording = recordingLeft !== null;
  const elapsedSec = isRecording ? Math.max(0, 5.0 - recordingLeft) : 0;
  const progressPct = isRecording ? Math.min(100, (elapsedSec / 5.0) * 100) : 0;
  const activeCue = isRecording ? activeSpec.liveCue(elapsedSec) : null;

  const classRunCount = (cls: GroundTruthClass) =>
    summary.trials.filter((t) => t.expected === cls).length;

  const recentTrials = [...summary.trials].reverse();

  return (
    <div className="bench-layout">
      {/* LEFT COLUMN: Step-by-Step Protocol Runner + Live Acoustic Scopes */}
      <div>
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">1 · Select ground-truth scenario &amp; record 5.0s</span>
            <span className="panel-meta">
              {sonarArmed ? '20 kHz worklet armed' : 'Standby · Arm sonar first'}
            </span>
          </div>

          <div className="proto-grid" role="radiogroup" aria-label="Ground truth class">
            {CLASSES.map((c) => {
              const selected = selectedClass === c.id;
              const runs = classRunCount(c.id);
              return (
                <button
                  type="button"
                  key={c.id}
                  role="radio"
                  aria-checked={selected}
                  disabled={isRecording}
                  className={`proto-card ${selected ? 'is-selected' : ''}`}
                  onClick={() => setSelectedClass(c.id)}
                >
                  <div className="proto-card-top">
                    <span className="proto-card-title">{c.label}</span>
                    <span className="proto-card-count">
                      {runs === 0 ? '0 runs' : `✓ ${runs} ${runs === 1 ? 'run' : 'runs'}`}
                    </span>
                  </div>
                  <span className="proto-card-desc">{c.protocol}</span>
                </button>
              );
            })}
          </div>

          <div
            className={`rec-coach-box ${isRecording ? 'is-recording' : ''} ${activeCue?.isDropPhase ? 'phase-drop' : ''
              }`}
          >
            <div className="rec-coach-head">
              <div style={{ flex: 1, minWidth: 220 }}>
                <div
                  className="mono"
                  style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink)' }}
                >
                  {isRecording
                    ? activeCue?.phaseTitle
                    : `READY · ${activeSpec.label.toUpperCase()} PROTOCOL`}
                </div>
                <div style={{ fontSize: 13, color: '#362c47', marginTop: 3 }}>
                  {isRecording ? activeCue?.detail : activeSpec.protocol}
                </div>
              </div>

              <button
                type="button"
                className="btn-arm"
                disabled={isRecording || submitting}
                onClick={runFiveSecondTrial}
              >
                {isRecording
                  ? `Recording · ${recordingLeft.toFixed(1)}s left`
                  : submitting
                    ? 'Scoring trial...'
                    : !sonarArmed
                      ? 'Arm sonar to start'
                      : `Record 5.0s "${activeSpec.shortLabel}"`}
              </button>
            </div>

            {isRecording && (
              <div className="rec-progress-track" aria-hidden="true">
                <div
                  className={`rec-progress-fill ${activeCue?.isDropPhase ? 'is-drop' : ''}`}
                  style={{ width: `${progressPct.toFixed(1)}%` }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Live Acoustic Scopes — never record blind! */}
        <RadarScopes
          latestFrameRef={latestFrameRef}
          frameSeqRef={frameSeqRef}
          guardMode={guardMode}
          fallThreshold={fallThreshold}
        />
      </div>

      {/* RIGHT COLUMN: KPIs + 4x4 Confusion Matrix + Per-Trial Telemetry Audit */}
      <div style={{ display: 'grid', gap: 14 }}>
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">
              2 · 4×4 confusion matrix ({summary.trials.length} trials)
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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

          <div className="readout-strip">
            <div className="readout">
              <div className="readout-k">Accuracy</div>
              <div className="readout-v teal">{summary.accuracyPct.toFixed(1)}%</div>
              <div className="readout-sub">{summary.trials.length} live 5.0s runs</div>
            </div>
            <div className="readout">
              <div className="readout-k">False-alarm rate</div>
              <div className="readout-v">{summary.falseAlarmRatePct.toFixed(1)}%</div>
              <div className="readout-sub">Pre-voice kinematic gate</div>
            </div>
            <div className="readout">
              <div className="readout-k">Fall recall</div>
              <div className="readout-v amber">{summary.fallRecallPct.toFixed(1)}%</div>
              <div className="readout-sub">Impulse + stillness rule</div>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="matrix-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Actual \ Pred</th>
                  {CLASSES.map((c) => (
                    <th key={c.id}>{c.shortLabel}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CLASSES.map((row) => (
                  <tr key={row.id}>
                    <th style={{ textAlign: 'left' }}>{row.label}</th>
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
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Recorded trial telemetry breakdown</span>
            <span className="panel-meta">Newest first</span>
          </div>

          {recentTrials.length === 0 ? (
            <div className="empty-state-box">
              <p>
                No 5.0s trials recorded yet. Pick a ground-truth card on the left (try{' '}
                <strong>Seated breathing</strong> first, then <strong>Fall + stillness</strong>) to
                populate live kinematic metrics.
              </p>
              {!sonarArmed && onRequestArm && (
                <button type="button" className="btn-arm" onClick={() => onRequestArm()}>
                  Arm sonar to begin
                </button>
              )}
            </div>
          ) : (
            <div className="trial-log-list">
              {recentTrials.map((t, i) => {
                const ok = t.expected === t.predicted;
                const trialNumber = summary.trials.length - i;
                return (
                  <div key={t.id} className="trial-log-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        className={`badge ${ok ? 'SAFE' : 'EMERGENCY'}`}
                        style={{ padding: '2px 8px' }}
                      >
                        #{trialNumber} {ok ? 'MATCH' : 'ERR'}
                      </span>
                      <strong>
                        {labelForClass(t.expected)} → {labelForClass(t.predicted)}
                      </strong>
                    </div>
                    <span style={{ color: '#4d4160' }}>
                      {t.meanDistanceM.toFixed(2)}m · peak {t.peakMotion.toFixed(1)} · σ{' '}
                      {t.breathStdMm.toFixed(2)}mm
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
