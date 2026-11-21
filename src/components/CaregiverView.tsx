import React, { useEffect, useState } from 'react';
import type { GuardMode, IncidentRecord } from '../types';
import { KaavalNavbarBrand } from './BrandAndIcons';

interface RoomHeartbeat {
  guardMode: GuardMode;
  distanceM: number;
  azimuthDeg: number;
  bpm: number | null;
  motionEnergy: number;
}

const QUICK_REASSURANCES: Array<{ label: string; text: string; lang: 'en-IN' | 'ml-IN' }> = [
  {
    label: 'Call neighbor (EN → ML)',
    text: 'Hold on Amma, do not try to stand up alone. I am calling Shaji uncle next door right now.',
    lang: 'en-IN',
  },
  {
    label: 'Help on the way (EN → ML)',
    text: 'Amma stay calm and rest where you are, medical help is on the way immediately.',
    lang: 'en-IN',
  },
  {
    label: 'Direct Malayalam',
    text: 'അമ്മേ പേടിക്കേണ്ട, ഞാൻ ഇപ്പോൾ തന്നെ അയൽവാസിയെ വിളിക്കുന്നുണ്ട്.',
    lang: 'ml-IN',
  },
];

export const CaregiverView: React.FC<{ onBackToConsole?: () => void }> = ({
  onBackToConsole,
}) => {
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [heartbeat, setHeartbeat] = useState<RoomHeartbeat>({
    guardMode: 'OFFLINE',
    distanceM: 0,
    azimuthDeg: 0,
    bpm: null,
    motionEnergy: 0,
  });
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [customMsg, setCustomMsg] = useState<string>('');
  const [sourceLang, setSourceLang] = useState<'en-IN' | 'ml-IN' | 'hi-IN'>('en-IN');
  const [sending, setSending] = useState<boolean>(false);
  const [lastSpokenMl, setLastSpokenMl] = useState<string>('');
  const [creditLocked, setCreditLocked] = useState<boolean>(true);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h) => {
        if (typeof h.creditGuardLocked === 'boolean') setCreditLocked(h.creditGuardLocked);
      })
      .catch(() => {});

    fetch('/api/incidents')
      .then((r) => r.json())
      .then((d) => {
        if (d.incidents) setIncidents(d.incidents);
      })
      .catch(() => {});

    let closed = false;
    let ws: WebSocket | null = null;
    let retryTimer = 0;

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws/hub?role=caregiver`);

      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => {
        setWsConnected(false);
        if (!closed) retryTimer = window.setTimeout(connect, 2000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'room_telemetry' && msg.data) {
            setHeartbeat(msg.data);
          } else if (msg.type === 'incident_created') {
            if (msg.incidents) setIncidents(msg.incidents);
            if (
              msg.record?.classification === 'EMERGENCY' ||
              msg.record?.classification === 'UNRESPONSIVE'
            ) {
              navigator.vibrate?.([280, 120, 280, 120, 400]);
            }
          } else if (msg.type === 'caregiver_reassurance') {
            if (msg.incidents) setIncidents(msg.incidents);
            if (msg.reply?.spokenMalayalam) setLastSpokenMl(msg.reply.spokenMalayalam);
          }
        } catch {
          // Ignore malformed message
        }
      };
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);

  const sendReassurance = async (text: string, lang: 'en-IN' | 'ml-IN' | 'hi-IN') => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const latestId = incidents[0]?.id;
      const res = await fetch('/api/caregiver-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incidentId: latestId,
          message: trimmed,
          sourceLang: lang,
        }),
      });
      const data = await res.json();
      if (data.incidents) setIncidents(data.incidents);
      if (data.reply?.spokenMalayalam) setLastSpokenMl(data.reply.spokenMalayalam);
      setCustomMsg('');
    } finally {
      setSending(false);
    }
  };

  const latestEmergency =
    incidents[0] &&
    (incidents[0].classification === 'EMERGENCY' ||
      incidents[0].classification === 'UNRESPONSIVE')
      ? incidents[0]
      : null;

  return (
    <div>
      <header className="gx-nav-wrap">
        <nav className="gx-nav" style={{ maxWidth: 760 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <KaavalNavbarBrand onClick={onBackToConsole} />
            <span className="status-inline">
              <span className={`led ${wsConnected ? 'on-teal' : 'on-red'}`} />
              <span>{wsConnected ? 'Live room link' : 'Reconnecting'}</span>
            </span>
          </div>

          {onBackToConsole && (
            <button type="button" onClick={onBackToConsole}>
              Room console
            </button>
          )}
        </nav>
      </header>

      <div className="console-command-band">
        <div className="console-command-inner" style={{ maxWidth: 760 }}>
          <div className="console-command-title">
            <h1>Caregiver mobile companion</h1>
            <span>കുടുംബ കണ്ണി · Two-way Malayalam room voice bridge</span>
          </div>
        </div>
      </div>

      <div className="caregiver-shell">
        {latestEmergency && (
          <div className="cg-alert-banner">
            <div className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--pink)' }}>
              Active {latestEmergency.classification.toLowerCase()} alert ·{' '}
              {new Date(latestEmergency.timestampIso).toLocaleTimeString()}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>
              {latestEmergency.clinicalSummaryEn}
            </div>
          </div>
        )}

        <section className="metric-bar" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="metric-cell">
            <span className="readout-k">Room state</span>
            <span className="metric-val teal" style={{ fontSize: 17 }}>
              {heartbeat.guardMode === 'OFFLINE'
                ? 'Standby'
                : heartbeat.guardMode.replaceAll('_', ' ').toLowerCase()}
            </span>
          </div>
          <div className="metric-cell">
            <span className="readout-k">Distance</span>
            <span className="metric-val" style={{ fontSize: 17 }}>
              {heartbeat.guardMode !== 'OFFLINE' ? `${heartbeat.distanceM.toFixed(2)}m` : '--'}
            </span>
          </div>
          <div className="metric-cell">
            <span className="readout-k">Respiration</span>
            <span className="metric-val teal" style={{ fontSize: 17 }}>
              {heartbeat.bpm ? `${heartbeat.bpm.toFixed(0)} BPM` : 'Monitoring'}
            </span>
          </div>
        </section>

        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-head">
            <span className="panel-title">Speak back to Amma&apos;s room speaker</span>
            <span className="panel-meta">
              {creditLocked ? '0-credit sim' : 'Sarvam Translate + Bulbul v3'}
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {QUICK_REASSURANCES.map((q, idx) => (
              <button
                type="button"
                key={idx}
                disabled={sending}
                onClick={() => sendReassurance(q.text, q.lang)}
              >
                {q.label}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendReassurance(customMsg, sourceLang);
            }}
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
          >
            <select
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value as 'en-IN' | 'ml-IN' | 'hi-IN')}
            >
              <option value="en-IN">English → Malayalam</option>
              <option value="hi-IN">Hindi → Malayalam</option>
              <option value="ml-IN">Malayalam direct</option>
            </select>

            <input
              type="text"
              className="cg-input"
              placeholder="Type message to speak aloud in Amma's room..."
              value={customMsg}
              onChange={(e) => setCustomMsg(e.target.value)}
            />

            <button type="submit" className="btn-arm" disabled={sending || !customMsg.trim()}>
              {sending ? 'Speaking...' : 'Speak in room'}
            </button>
          </form>

          {lastSpokenMl && (
            <div
              className="ml"
              style={{
                marginTop: 10,
                fontSize: 13,
                color: 'var(--green-bright)',
                fontWeight: 600,
              }}
            >
              Spoken aloud in room: &ldquo;{lastSpokenMl}&rdquo;
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Verified room events &amp; privacy snapshots</span>
            <span className="panel-meta">{incidents.length}</span>
          </div>

          {incidents.length === 0 ? (
            <div
              className="mono"
              style={{ color: 'var(--muted-on-dark)', fontSize: 12, padding: '8px 2px' }}
            >
              Quiet baseline — false alarms verified safe in Malayalam do not wake you.
            </div>
          ) : (
            incidents.map((inc) => (
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
                    {inc.classification === 'SAFE'
                      ? 'Safe · Auto-dismissed'
                      : inc.classification}
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--muted-on-dark)' }}>
                    {new Date(inc.timestampIso).toLocaleTimeString()} ·{' '}
                    {inc.distanceMeters.toFixed(2)}m
                    {typeof inc.azimuthDeg === 'number'
                      ? ` · ${inc.azimuthDeg.toFixed(0)}°`
                      : ''}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {inc.snapshotDataUrl && (
                    <img
                      src={inc.snapshotDataUrl}
                      alt="Anonymized Sonic Ironbow silhouette"
                      style={{
                        width: 112,
                        height: 63,
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: 8,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: 'var(--white)',
                        marginBottom: 4,
                      }}
                    >
                      {inc.clinicalSummaryEn}
                    </div>
                    {inc.transcriptMl && (
                      <div
                        className="mono"
                        style={{ fontSize: 11.5, color: 'var(--muted-on-dark)' }}
                      >
                        <span className="ml" style={{ color: 'var(--white)', fontWeight: 600 }}>
                          &ldquo;{inc.transcriptMl}&rdquo;
                        </span>{' '}
                        → &ldquo;{inc.transcriptEn}&rdquo;
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
