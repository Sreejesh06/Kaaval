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
          <span className="panel-title">Consent-Gated Malayalam Check-In</span>
          <span className="panel-meta">
            {inCheckin ? 'GATE OPEN (VERIFICATION)' : 'GATE LOCKED (>17.5 kHz ONLY)'}
          </span>
        </div>

        <div className="live-dialogue">
          <div className="dialogue-row">
            <div className="dialogue-label">Bulbul v3 Prompt</div>
            <div className="ml" style={{ color: activePromptMl ? '#e8eef5' : '#566579' }}>
              {activePromptMl || 'Idle — triggers only on physical fall or apnea.'}
            </div>
          </div>

          <div className="dialogue-row" style={{ borderTop: '1px solid #1e2836', paddingTop: 8 }}>
            <div className="dialogue-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                Saaras v4 Stream{' '}
                {guardMode === 'LISTENING_CONSENT'
                  ? vadActive
                    ? '[VAD ACTIVE]'
                    : `[${consentRemainingSec.toFixed(1)}s · ${voiceRmsDb.toFixed(0)} dBFS]`
                  : ''}
              </span>
              {guardMode === 'TRIAGING_RESPONSE' && (
                <span style={{ color: '#f59e0b' }}>TRIAGING...</span>
              )}
            </div>
            <div
              className="ml"
              style={{
                minHeight: 22,
                color: liveTranscriptMl ? '#14b8a6' : '#566579',
                fontWeight: liveTranscriptMl ? 500 : 400,
              }}
            >
              {liveTranscriptMl ||
                (guardMode === 'LISTENING_CONSENT'
                  ? 'മലയാളത്തിൽ മറുപടി പറയൂ...'
                  : 'Locked (<17.5 kHz speech discarded).')}
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Caregiver Dispatch</span>
          <span className="panel-meta">{incidents.length}</span>
        </div>

        {incidents.length === 0 ? (
          <div className="mono" style={{ color: '#566579', fontSize: 11, padding: '6px 2px' }}>
            No events logged.
          </div>
        ) : (
          incidents.slice(0, 4).map((inc) => (
            <div key={inc.id} className={`incident-card sev-${inc.classification}`}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 6,
                }}
              >
                <span className={`badge ${inc.classification}`}>{inc.classification}</span>
                <span className="mono" style={{ fontSize: 10, color: '#8a99ad' }}>
                  {new Date(inc.timestampIso).toLocaleTimeString()} | {inc.distanceMeters.toFixed(2)}m
                </span>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 5 }}>
                {inc.snapshotDataUrl && (
                  <img
                    src={inc.snapshotDataUrl}
                    alt="Anonymized Ironbow Posture"
                    style={{
                      width: 88,
                      height: 50,
                      border: '1px solid #2d3b4e',
                      flexShrink: 0,
                    }}
                  />
                )}
                <div style={{ fontSize: 12, fontWeight: 500 }}>
                  {inc.clinicalSummaryEn}
                </div>
              </div>

              {inc.transcriptMl && (
                <div className="mono" style={{ fontSize: 11, color: '#8a99ad', marginBottom: 4 }}>
                  <span className="ml" style={{ color: '#e8eef5' }}>
                    "{inc.transcriptMl}"
                  </span>{' '}
                  → "{inc.transcriptEn}"
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 6,
                  paddingTop: 6,
                  borderTop: '1px solid #1e2836',
                }}
              >
                <span className="ml" style={{ fontSize: 11, color: '#14b8a6' }}>
                  Kaaval: "{inc.replyMl}"
                </span>
                {inc.replyAudioBase64 && (
                  <button onClick={() => onReplayAudio(inc.replyAudioBase64!)}>
                    REPLAY TTS
                  </button>
                )}
              </div>

              <table className="trace-table">
                <thead>
                  <tr>
                    <th>Sarvam Model</th>
                    <th>Latency</th>
                    <th>Step Output</th>
                  </tr>
                </thead>
                <tbody>
                  {inc.sarvamTraces.map((tr, idx) => (
                    <tr key={idx}>
                      <td style={{ color: '#e8eef5' }}>{tr.model}</td>
                      <td style={{ color: '#14b8a6' }}>{tr.latencyMs} ms</td>
                      <td style={{ color: '#8a99ad' }}>{tr.detail}</td>
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
