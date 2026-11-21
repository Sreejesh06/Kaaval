import React from 'react';
import type { GuardMode, IncidentRecord } from '../types';

interface Props {
  guardMode: GuardMode;
  activePromptMl: string;
  liveTranscriptMl: string;
  vadActive: boolean;
  consentRemainingSec: number;
  voiceRmsDb: number;
  incidents: IncidentRecord[];
  onReplayAudio: (base64Audio: string) => void;
}

export const TriageTimeline: React.FC<Props> = ({
  guardMode,
  activePromptMl,
  liveTranscriptMl,
  vadActive,
  consentRemainingSec,
  voiceRmsDb,
  incidents,
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
            {inCheckin ? 'Gate open (9.5s consent)' : 'Locked (>17.5 kHz only)'}
          </span>
        </div>

        <div className="live-dialogue">
          <div className="dialogue-row">
            <div className="dialogue-label">Bulbul v3 prompt (ml-IN)</div>
            <div
              className="ml"
              style={{
                color: activePromptMl ? 'var(--white)' : 'var(--muted-on-dark)',
                fontWeight: activePromptMl ? 600 : 400,
              }}
            >
              {activePromptMl || 'Idle — triggers only on physical fall + stillness or apnea.'}
            </div>
          </div>

          <div
            className="dialogue-row"
            style={{
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              paddingTop: 10,
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
                    ? '· VAD active'
                    : `· ${consentRemainingSec.toFixed(1)}s (${voiceRmsDb.toFixed(0)} dBFS)`
                  : ''}
              </span>
              {guardMode === 'TRIAGING_RESPONSE' && (
                <span style={{ color: 'var(--yellow)', fontWeight: 700 }}>Triaging...</span>
              )}
            </div>
            <div
              className="ml"
              style={{
                minHeight: 22,
                color: liveTranscriptMl ? 'var(--green-bright)' : 'var(--muted-on-dark)',
                fontWeight: liveTranscriptMl ? 600 : 400,
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
          <div
            className="mono"
            style={{ color: 'var(--muted-on-dark)', fontSize: 12, padding: '6px 2px' }}
          >
            No check-ins logged yet. Simulate a slump + 4s stillness or click Voice check-in in the
            Cobalt bar above.
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
                  {inc.classification === 'SAFE' ? 'Safe · Local only' : inc.classification}
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--muted-on-dark)' }}>
                  {new Date(inc.timestampIso).toLocaleTimeString()} ·{' '}
                  {inc.distanceMeters.toFixed(2)}m
                </span>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 6 }}>
                {inc.snapshotDataUrl && (
                  <img
                    src={inc.snapshotDataUrl}
                    alt="Anonymized Sonic Ironbow silhouette"
                    style={{
                      width: 92,
                      height: 52,
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: 8,
                      flexShrink: 0,
                    }}
                  />
                )}
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--white)' }}>
                  {inc.clinicalSummaryEn}
                </div>
              </div>

              {inc.transcriptMl && (
                <div
                  className="mono"
                  style={{ fontSize: 11.5, color: 'var(--muted-on-dark)', marginBottom: 6 }}
                >
                  <span className="ml" style={{ color: 'var(--white)', fontWeight: 600 }}>
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
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <span
                  className="ml"
                  style={{ fontSize: 12, color: 'var(--lilac)', fontWeight: 500 }}
                >
                  Kaaval: &ldquo;{inc.replyMl}&rdquo;
                </span>
                {inc.replyAudioBase64 && (
                  <button
                    type="button"
                    onClick={() => onReplayAudio(inc.replyAudioBase64!)}
                    style={{ minHeight: 30, padding: '4px 12px', fontSize: 12 }}
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
                      <td style={{ color: 'var(--white)', fontWeight: 500 }}>{tr.model}</td>
                      <td style={{ color: 'var(--green-bright)', fontWeight: 500 }}>
                        {tr.latencyMs} ms
                      </td>
                      <td style={{ color: 'var(--muted-on-dark)' }}>{tr.detail}</td>
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
