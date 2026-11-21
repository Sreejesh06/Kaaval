import React from 'react';
import type { GuardMode, IncidentRecord } from '../types';

interface Props {
  guardMode: GuardMode;
  sonarArmed: boolean;
  activePromptMl: string;
  liveTranscriptMl: string;
  vadActive: boolean;
  consentRemainingSec: number;
  voiceRmsDb: number;
  incidents: IncidentRecord[];
  onRequestArm: () => void;
  onTriggerTestCheckin: () => void;
  onReplayAudio: (base64Audio: string) => void;
}

export const TriageTimeline: React.FC<Props> = ({
  guardMode,
  sonarArmed,
  activePromptMl,
  liveTranscriptMl,
  vadActive,
  consentRemainingSec,
  voiceRmsDb,
  incidents,
  onRequestArm,
  onTriggerTestCheckin,
  onReplayAudio,
}) => {
  const inCheckin =
    guardMode === 'PLAYING_PROMPT' ||
    guardMode === 'LISTENING_CONSENT' ||
    guardMode === 'TRIAGING_RESPONSE';

  return (
    <div className="triage-stack">
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Malayalam voice check-in</span>
          <span className="panel-meta">
            {inCheckin ? 'Gate open · 9.5s consent' : 'Locked · >17.5 kHz only'}
          </span>
        </div>

        <div className="live-dialogue">
          <div>
            <div className="dialogue-label">Bulbul v3 prompt (ml-IN)</div>
            <div
              className="ml"
              style={{
                color: activePromptMl ? 'var(--content-primary)' : 'var(--content-secondary)',
                fontWeight: activePromptMl ? 500 : 400,
              }}
            >
              {activePromptMl || 'Idle — triggers only on physical fall + stillness or apnea.'}
            </div>
          </div>

          <div
            style={{
              borderTop: '1px solid var(--line-default)',
              paddingTop: 12,
            }}
          >
            <div
              className="dialogue-label"
              style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}
            >
              <span>
                Saaras v4 stream{' '}
                {guardMode === 'LISTENING_CONSENT'
                  ? vadActive
                    ? '· Speech detected'
                    : `· ${consentRemainingSec.toFixed(1)}s (${voiceRmsDb.toFixed(0)} dBFS)`
                  : ''}
              </span>
              {guardMode === 'TRIAGING_RESPONSE' && (
                <span style={{ color: 'var(--status-warn)', fontWeight: 600 }}>Triaging...</span>
              )}
            </div>
            <div
              className="ml"
              style={{
                minHeight: 22,
                color: liveTranscriptMl ? 'var(--accent)' : 'var(--content-secondary)',
                fontWeight: liveTranscriptMl ? 500 : 400,
              }}
            >
              {liveTranscriptMl ||
                (guardMode === 'LISTENING_CONSENT'
                  ? 'മലയാളത്തിൽ മറുപടി പറയൂ...'
                  : 'Speech firewall locked (<17.5 kHz zeroed).')}
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Caregiver dispatch &amp; model trace</span>
          <span className="panel-meta">{incidents.length} logged</span>
        </div>

        {incidents.length === 0 ? (
          <div className="empty-state-box">
            <p>
              No check-ins recorded in this session. Simulate a slump + 4s stillness or trigger a
              manual Malayalam verification check-in.
            </p>
            {!sonarArmed ? (
              <button type="button" className="btn-arm" onClick={onRequestArm}>
                Arm sonar to monitor room
              </button>
            ) : (
              <button
                type="button"
                disabled={inCheckin}
                onClick={onTriggerTestCheckin}
              >
                Run test voice check-in
              </button>
            )}
          </div>
        ) : (
          incidents.slice(0, 4).map((inc) => (
            <div key={inc.id} className={`incident-card sev-${inc.classification}`}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <span className={`badge ${inc.classification}`}>
                  <span
                    className={`led ${
                      inc.classification === 'SAFE' ? 'on-teal' : 'on-red'
                    }`}
                  />
                  {inc.classification === 'SAFE' ? 'Safe · Local only' : inc.classification}
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--content-muted)' }}>
                  {new Date(inc.timestampIso).toLocaleTimeString()} ·{' '}
                  {inc.distanceMeters.toFixed(2)}m
                </span>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 6 }}>
                {inc.snapshotDataUrl && (
                  <img
                    src={inc.snapshotDataUrl}
                    alt="Anonymized Sonic Ironbow silhouette"
                    width={92}
                    height={52}
                    style={{
                      width: 92,
                      height: 52,
                      aspectRatio: '92 / 52',
                      border: '1px solid var(--line-default)',
                      borderRadius: 6,
                      flexShrink: 0,
                    }}
                  />
                )}
                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--content-primary)' }}>
                  {inc.clinicalSummaryEn}
                </div>
              </div>

              {inc.transcriptMl && (
                <div
                  className="mono"
                  style={{ fontSize: 11.5, color: 'var(--content-secondary)', marginBottom: 6 }}
                >
                  <span className="ml" style={{ color: 'var(--content-primary)', fontWeight: 500 }}>
                    &ldquo;{inc.transcriptMl}&rdquo;
                  </span>{' '}
                  → &ldquo;{inc.transcriptEn}&rdquo;
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: '1px solid var(--line-default)',
                }}
              >
                <span
                  className="ml"
                  style={{ fontSize: 12, color: 'var(--content-secondary)' }}
                >
                  Kaaval: &ldquo;{inc.replyMl}&rdquo;
                </span>
                {inc.replyAudioBase64 && (
                  <button
                    type="button"
                    onClick={() => onReplayAudio(inc.replyAudioBase64!)}
                    style={{ minHeight: 34, padding: '0 12px', fontSize: 12 }}
                  >
                    Replay audio
                  </button>
                )}
              </div>

              <table className="trace-table">
                <thead>
                  <tr>
                    <th>Sarvam model</th>
                    <th>Latency</th>
                    <th>Step output</th>
                  </tr>
                </thead>
                <tbody>
                  {inc.sarvamTraces.map((tr, idx) => (
                    <tr key={idx}>
                      <td style={{ color: 'var(--content-primary)', fontWeight: 500 }}>
                        {tr.model}
                      </td>
                      <td style={{ color: 'var(--accent)', fontWeight: 500 }}>
                        {tr.latencyMs} ms
                      </td>
                      <td style={{ color: 'var(--content-secondary)' }}>{tr.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
