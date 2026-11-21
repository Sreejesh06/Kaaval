import React, { useEffect, useState } from 'react';
import { INDIAN_LANGUAGES, getLangMeta } from '../languages';
import type { GuardMode, IncidentRecord, IndianLangCode } from '../types';
import { QrCodeSvg } from './QrCodeSvg';

interface RoomHeartbeat {
  guardMode: GuardMode;
  peopleCount?: number;
  distanceM: number;
  azimuthDeg: number;
  bpm: number | null;
  motionEnergy: number;
}

interface Props {
  lanUrls?: string[];
  sonarArmed?: boolean;
  onRequestArm?: () => void;
  onTriggerTestCheckin?: () => void;
  onBackToConsole?: () => void;
}

const QUICK_REASSURANCES: Array<{ label: string; text: string; lang: IndianLangCode }> = [
  {
    label: 'Call neighbor',
    text: 'Hold on Amma, do not try to stand up alone. I am calling the neighbor next door right now.',
    lang: 'en-IN',
  },
  {
    label: 'Help on the way',
    text: 'Amma stay calm and rest where you are, medical help is on the way immediately.',
    lang: 'en-IN',
  },
  {
    label: 'Doctor notified',
    text: 'We got your room alert and spoke to the family doctor. Stay seated comfortably, we are coming.',
    lang: 'en-IN',
  },
  {
    label: 'Hindi → Elder language',
    text: 'माँ जी घबराइए मत, मैं अभी पड़ोसी को बुला रहा हूँ।',
    lang: 'hi-IN',
  },
];

export const CaregiverView: React.FC<Props> = ({
  lanUrls: propLanUrls,
  sonarArmed,
  onRequestArm,
  onTriggerTestCheckin,
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
  const [sourceLang, setSourceLang] = useState<IndianLangCode>('en-IN');
  const [elderLang, setElderLang] = useState<IndianLangCode>('ml-IN');
  const [sending, setSending] = useState<boolean>(false);
  const [lastSpokenMl, setLastSpokenMl] = useState<string>('');
  const [creditLocked, setCreditLocked] = useState<boolean>(true);
  const [waRecipient, setWaRecipient] = useState<string>('');
  const [waTesting, setWaTesting] = useState<boolean>(false);
  const [waFeedback, setWaFeedback] = useState<string>('');
  const [localLanUrls, setLocalLanUrls] = useState<string[]>([]);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h) => {
        if (typeof h.creditGuardLocked === 'boolean') setCreditLocked(h.creditGuardLocked);
        if (h.elderLang) setElderLang(h.elderLang as IndianLangCode);
        if (h.whatsappConfigured && h.whatsappRecipient) setWaRecipient(h.whatsappRecipient);
      })
      .catch(() => { });

    fetch('/api/lan-info')
      .then((r) => r.json())
      .then((info: { lanIps?: string[] }) => {
        const port = window.location.port || '5173';
        const ips = info.lanIps || [];
        const urls = ips.map((ip) => `http://${ip}:${port}/caregiver`);
        setLocalLanUrls(urls.length ? urls : [`${window.location.origin}/caregiver`]);
      })
      .catch(() => { });

    fetch('/api/incidents')
      .then((r) => r.json())
      .then((d) => {
        if (d.incidents) setIncidents(d.incidents);
      })
      .catch(() => { });

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
          if (msg.type === 'room_language' && msg.elderLang) {
            setElderLang(msg.elderLang as IndianLangCode);
          } else if (msg.type === 'room_telemetry' && msg.data) {
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
          // Ignore malformed WS message
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

  const sendReassurance = async (text: string, lang: IndianLangCode) => {
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
          targetLang: elderLang,
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

  const triggerWhatsAppTest = async () => {
    if (waTesting) return;
    setWaTesting(true);
    setWaFeedback('Sending WhatsApp alert...');
    try {
      const r = await fetch('/api/whatsapp/test', { method: 'POST' });
      const d = await r.json();
      setWaFeedback(
        d.sent
          ? `WhatsApp delivered to ${d.recipientMasked} ✓`
          : d.detail || 'WhatsApp not configured (.env)'
      );
    } catch {
      setWaFeedback('Network error testing WhatsApp');
    } finally {
      setWaTesting(false);
    }
  };

  const resolvedUrls = propLanUrls?.length ? propLanUrls : localLanUrls;
  const primaryPairUrl =
    resolvedUrls[0] ||
    (typeof window !== 'undefined' ? `${window.location.origin}/caregiver` : '');

  const copyPairUrl = async () => {
    if (!primaryPairUrl) return;
    try {
      await navigator.clipboard.writeText(primaryPairUrl);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 1800);
    } catch {
      // Clipboard blocked on non-secure origin
    }
  };

  const effectiveOnline = heartbeat.guardMode !== 'OFFLINE' || Boolean(sonarArmed);
  const latestEmergency =
    incidents[0] &&
      (incidents[0].classification === 'EMERGENCY' ||
        incidents[0].classification === 'UNRESPONSIVE')
      ? incidents[0]
      : null;

  const elderMeta = getLangMeta(elderLang);

  return (
    <div>
      <div className="console-command-band">
        <div className="console-command-inner">
          <div className="console-command-title">
            <h1>Caregiver family &amp; nurse hub</h1>
            <span>
              കുടുംബ കണ്ണി · Live room telemetry, WhatsApp dispatch &amp; 2-way Bharat voice
            </span>
          </div>

          <div className="console-command-controls">
            <span className="status-inline">
              <span className={`led ${wsConnected ? 'on-teal' : 'on-red'}`} />
              <span>{wsConnected ? 'Live room link' : 'Reconnecting'}</span>
            </span>

            {waRecipient && (
              <span className="status-inline" title="TextMeBot WhatsApp emergency alert target">
                <span className="led on-teal" />
                <span>WhatsApp: {waRecipient}</span>
              </span>
            )}

            <button type="button" disabled={waTesting} onClick={triggerWhatsAppTest}>
              {waTesting ? 'Sending WhatsApp...' : 'Send test WhatsApp'}
            </button>

            {!effectiveOnline && onRequestArm && (
              <button type="button" className="btn-arm" onClick={onRequestArm}>
                Arm room sonar
              </button>
            )}

            {onBackToConsole && (
              <button type="button" onClick={onBackToConsole}>
                Open room console
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="caregiver-shell">
        {waFeedback && (
          <div
            className="cg-spoken-toast"
            style={{ marginTop: 0, marginBottom: 14, background: 'var(--cream)' }}
          >
            <span className="mono" style={{ fontSize: 12.5 }}>
              {waFeedback}
            </span>
          </div>
        )}

        {latestEmergency && (
          <div className="cg-alert-banner">
            <div className="mono" style={{ fontSize: 11.5, fontWeight: 700 }}>
              ACTIVE {latestEmergency.classification} ALERT ·{' '}
              {new Date(latestEmergency.timestampIso).toLocaleTimeString()}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>
              {latestEmergency.clinicalSummaryEn}
            </div>
          </div>
        )}

        {/* 4-Cell Live Elder Room Status Ribbon */}
        <section
          className="metric-bar"
          style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
          aria-label="Elder room live telemetry"
        >
          <div className="metric-cell">
            <span className="readout-k">
              <span className={`led ${effectiveOnline ? 'on-teal' : ''}`} />
              Room state
            </span>
            <span className="metric-val teal" style={{ fontSize: 17 }}>
              {heartbeat.guardMode !== 'OFFLINE'
                ? heartbeat.guardMode.replaceAll('_', ' ').toLowerCase()
                : sonarArmed
                  ? 'armed monitoring'
                  : 'Standby'}
            </span>
          </div>

          <div className="metric-cell">
            <span className="readout-k">Occupancy &amp; zone</span>
            <span className="metric-val" style={{ fontSize: 17 }}>
              {heartbeat.guardMode === 'OFFLINE'
                ? '--'
                : heartbeat.peopleCount === 0 || heartbeat.distanceM <= 0
                  ? '0 · Room clear'
                  : `${heartbeat.peopleCount || 1} · ${heartbeat.distanceM.toFixed(2)}m (${heartbeat.azimuthDeg === 180 ? 'Backside' : 'Front'
                  })`}
            </span>
          </div>

          <div className="metric-cell">
            <span className="readout-k">Breathing rate</span>
            <span className="metric-val teal" style={{ fontSize: 17 }}>
              {heartbeat.bpm
                ? `${heartbeat.bpm.toFixed(0)} BPM`
                : effectiveOnline
                  ? 'Tracking'
                  : '--'}
            </span>
          </div>

          <div className="metric-cell">
            <span className="readout-k">
              <span className="led on-red" />
              Privacy lock
            </span>
            <span className="metric-val red" style={{ fontSize: 16 }}>
              0 px · &lt;17.5k zeroed
            </span>
          </div>
        </section>

        <div className="cg-layout">
          {/* LEFT COLUMN: Two-Way Bharat Voice Bridge + Phone Pairing QR */}
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">
                  Speak into room speaker in {elderMeta.nativeName} ({elderMeta.nameEn})
                </span>
                <span className="panel-meta">
                  {creditLocked ? '0-credit sim' : 'Sarvam Translate + Bulbul v3'}
                </span>
              </div>

              <p style={{ fontSize: 13.5, color: '#3b314d', marginBottom: 12 }}>
                Type or tap a quick message in any Indian language — Kaaval pauses ultrasonic TX,
                plays a gentle chime, and speaks aloud in{' '}
                <strong>
                  {elderMeta.nativeName} ({elderMeta.nameEn})
                </strong>{' '}
                through the room speaker.
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
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
                className="cg-form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendReassurance(customMsg, sourceLang);
                }}
              >
                <div className="field-group">
                  <label htmlFor="cg-source-lang" className="field-label">
                    Your input language
                  </label>
                  <select
                    id="cg-source-lang"
                    value={sourceLang}
                    onChange={(e) => setSourceLang(e.target.value as IndianLangCode)}
                    style={{ width: '100%', minHeight: 44 }}
                  >
                    {INDIAN_LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.code === elderLang
                          ? `${l.nativeName} (${l.nameEn} direct)`
                          : `${l.nameEn} → ${elderMeta.nativeName}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field-group">
                  <label htmlFor="cg-room-msg" className="field-label">
                    Message to room speaker
                  </label>
                  <input
                    id="cg-room-msg"
                    type="text"
                    className="cg-input"
                    placeholder="Hold on Amma, I am calling next door..."
                    value={customMsg}
                    onChange={(e) => setCustomMsg(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  className="btn-arm"
                  disabled={sending || !customMsg.trim()}
                  style={{ minHeight: 44 }}
                >
                  {sending ? 'Speaking...' : 'Speak in room'}
                </button>
              </form>

              {lastSpokenMl && (
                <div className="cg-spoken-toast">
                  Spoken aloud in room:{' '}
                  <span className="ml" style={{ fontWeight: 700 }}>
                    &ldquo;{lastSpokenMl}&rdquo;
                  </span>
                </div>
              )}
            </div>

            {/* Desktop QR Pairing Card (auto-hidden on small phone screens) */}
            {primaryPairUrl && (
              <div className="panel cg-desktop-pair">
                <div className="panel-head">
                  <span className="panel-title">Open caregiver app on your phone</span>
                  <span className="panel-meta">Same Wi-Fi / hotspot</span>
                </div>

                <div className="cg-qr-card">
                  <QrCodeSvg value={primaryPairUrl} size={104} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, color: '#3b314d', marginBottom: 8 }}>
                      Scan with any iOS or Android camera to receive live emergency vibrations,
                      Sonic silhouettes, and 2-way voice controls on your phone.
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      {resolvedUrls.map((u) => (
                        <a
                          key={u}
                          href={u}
                          target="_blank"
                          rel="noreferrer"
                          className="mono"
                          style={{
                            display: 'inline-block',
                            fontSize: 12,
                            fontWeight: 600,
                            color: 'var(--blue)',
                            marginRight: 12,
                            wordBreak: 'break-all',
                          }}
                        >
                          {u}
                        </a>
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button type="button" onClick={copyPairUrl}>
                        {copiedUrl ? 'Copied URL ✓' : 'Copy link'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          window.open('/caregiver', '_blank', 'width=430,height=780')
                        }
                      >
                        Open mobile preview
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Verified Room Events, WhatsApp Receipts & Privacy Snapshots */}
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Verified room events &amp; privacy snapshots</span>
              <span className="panel-meta">{incidents.length} logged</span>
            </div>

            {incidents.length === 0 ? (
              <div className="empty-state-box">
                <p>
                  Quiet baseline — false alarms verified safe in {elderMeta.nameEn} stay local in
                  the room and never spam or wake family caregivers.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  <button
                    type="button"
                    className="btn-arm"
                    disabled={sending}
                    onClick={() =>
                      void sendReassurance(QUICK_REASSURANCES[0].text, QUICK_REASSURANCES[0].lang)
                    }
                  >
                    Send test room reassurance
                  </button>
                  {onTriggerTestCheckin && effectiveOnline && (
                    <button type="button" onClick={onTriggerTestCheckin}>
                      Trigger room voice check-in
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {incidents.map((inc) => (
                  <div key={inc.id} className={`incident-card sev-${inc.classification}`}>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 8,
                      }}
                    >
                      <span className={`badge ${inc.classification}`}>
                        <span
                          className={`led ${inc.classification === 'SAFE' ? 'on-teal' : 'on-red'
                            }`}
                        />
                        {inc.classification === 'SAFE'
                          ? 'Safe · Auto-dismissed'
                          : inc.classification}
                      </span>

                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                        {inc.whatsappDispatch && (
                          <span
                            className="mono"
                            style={{
                              fontSize: 11,
                              color: inc.whatsappDispatch.sent ? '#0e6b45' : 'var(--muted)',
                              fontWeight: 700,
                            }}
                          >
                            {inc.whatsappDispatch.sent
                              ? `WhatsApp sent (${inc.whatsappDispatch.recipientMasked}) ✓`
                              : 'WhatsApp queued'}
                          </span>
                        )}
                        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {new Date(inc.timestampIso).toLocaleTimeString()} ·{' '}
                          {inc.distanceMeters.toFixed(2)}m
                          {inc.azimuthDeg === 180
                            ? ' · Backside'
                            : typeof inc.azimuthDeg === 'number'
                              ? ` · ${inc.azimuthDeg.toFixed(0)}°`
                              : ''}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      {inc.snapshotDataUrl && (
                        <img
                          src={inc.snapshotDataUrl}
                          alt="Anonymized Sonic Ironbow acoustic silhouette"
                          width={112}
                          height={63}
                          style={{
                            width: 112,
                            height: 63,
                            aspectRatio: '16 / 9',
                            border: '2px solid var(--ink)',
                            borderRadius: 8,
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13.5,
                            fontWeight: 600,
                            color: 'var(--ink)',
                            marginBottom: 4,
                          }}
                        >
                          {inc.clinicalSummaryEn}
                        </div>
                        {inc.transcriptMl && (
                          <div className="mono" style={{ fontSize: 11.5, color: '#3b314d' }}>
                            <span className="ml" style={{ color: 'var(--ink)', fontWeight: 700 }}>
                              &ldquo;{inc.transcriptMl}&rdquo;
                            </span>{' '}
                            → &ldquo;{inc.transcriptEn}&rdquo;
                          </div>
                        )}
                        {inc.caregiverReplies && inc.caregiverReplies.length > 0 && (
                          <div
                            className="mono"
                            style={{
                              marginTop: 6,
                              paddingTop: 6,
                              borderTop: '1px dashed rgba(22, 18, 28, 0.22)',
                              fontSize: 11,
                              color: '#0e6b45',
                            }}
                          >
                            Caregiver spoke:{' '}
                            <span className="ml" style={{ fontWeight: 700 }}>
                              &ldquo;
                              {
                                inc.caregiverReplies[inc.caregiverReplies.length - 1]
                                  .spokenMalayalam
                              }
                              &rdquo;
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
