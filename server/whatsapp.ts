import fs from 'node:fs';
import path from 'node:path';
import type { IncidentRecord } from '../src/types.js';

export interface WhatsAppDispatchResult {
  sent: boolean;
  recipientMasked: string;
  latencyMs: number;
  detail: string;
}

let lastSendAtMs = 0;

function readDotEnvKey(key: string): string {
  if (process.env[key]) return process.env[key]!.trim();
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return '';
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0 && trimmed.slice(0, eq).trim() === key) {
        return trimmed
          .slice(eq + 1)
          .trim()
          .replace(/^['"]|['"]$/g, '');
      }
    }
  } catch {
    // Ignore .env read errors
  }
  return '';
}

export function getWhatsAppConfig(): {
  configured: boolean;
  phone: string;
  maskedPhone: string;
  apiKey: string;
} {
  const rawPhone = readDotEnvKey('TEXTMEBOT_PHONE');
  const apiKey = readDotEnvKey('TEXTMEBOT_API_KEY');
  const digits = rawPhone.replace(/[^\d+]/g, '');
  // Normalize 10-digit Indian mobile numbers to +91XXXXXXXXXX for WhatsApp E.164 routing
  const normalizedPhone =
    /^\d{10}$/.test(digits)
      ? `+91${digits}`
      : digits.startsWith('91') && digits.length === 12
      ? `+${digits}`
      : digits;

  const maskedPhone =
    normalizedPhone.length >= 6
      ? `${normalizedPhone.slice(0, 4)}••••${normalizedPhone.slice(-4)}`
      : normalizedPhone;

  return {
    configured: Boolean(normalizedPhone && apiKey),
    phone: normalizedPhone,
    maskedPhone,
    apiKey,
  };
}

export function formatWhatsAppIncidentMessage(
  record: IncidentRecord,
  caregiverUrl: string
): string {
  const isUnresponsive = record.classification === 'UNRESPONSIVE';
  const headerBadge = isUnresponsive
    ? '🚨 *KAAVAL URGENT ALERT — NO VOICE RESPONSE*'
    : '🚨 *KAAVAL EMERGENCY ALERT — FALL VERIFIED*';

  const timeStr = new Date(record.timestampIso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const zoneLabel =
    record.azimuthDeg === 180
      ? `Backside Zone (${record.distanceMeters.toFixed(2)} m)`
      : typeof record.azimuthDeg === 'number'
      ? `Front Zone · ${record.distanceMeters.toFixed(2)} m (${record.azimuthDeg >= 0 ? '+' : ''}${record.azimuthDeg.toFixed(0)}°)`
      : `${record.distanceMeters.toFixed(2)} m`;

  const bpmStr = record.respirationBpmBefore
    ? `${record.respirationBpmBefore.toFixed(0)} BPM`
    : 'Acquiring';

  const triggerLabel =
    record.trigger === 'PROLONGED_ABSENCE_OF_RESPIRATION'
      ? 'Prolonged Stillness / Apnea Watch'
      : record.trigger === 'MANUAL_VERIFICATION_TEST'
      ? 'Live Safety Verification Check-In'
      : 'Fall Impact + 4.0s Post-Impact Stillness';

  const langHeader = record.elderLangLabel || 'Malayalam (ml-IN)';
  const dialogueBlock = record.transcriptMl
    ? [
        `🗣️ *Sarvam Voice Check-In (${langHeader}):*`,
        `• *Elder:* "${record.transcriptMl}"`,
        `• *English:* _"${record.transcriptEn}"_`,
      ].join('\n')
    : [
        `🗣️ *Sarvam Voice Check-In (${langHeader}):*`,
        `• _9.5s consent mic window elapsed with zero spoken reply._`,
      ].join('\n');

  return [
    `${headerBadge} · *കാവൽ*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `⚠️ *Reason:* ${triggerLabel}`,
    `🕒 *Time:* ${timeStr}`,
    ``,
    `📍 *Ultrasonic Room Telemetry (0 px Camera):*`,
    `• *Location:* ${zoneLabel}`,
    `• *Impact Energy:* ${record.peakMotionEnergy.toFixed(2)}`,
    `• *Prior Breathing:* ${bpmStr}`,
    ``,
    dialogueBlock,
    `• *AI Triage:* ${record.clinicalSummaryEn}`,
    ``,
    `📲 *Open 2-Way Bharat Room Speaker:*`,
    `${caregiverUrl}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🔒 _Zero-Camera Ultrasonic Guardian (<17.5 kHz Private)_`,
  ].join('\n');
}

async function callTextMeBot(recipient: string, apiKey: string, text: string): Promise<{
  ok: boolean;
  bodyText: string;
}> {
  const url =
    `https://api.textmebot.com/send.php` +
    `?recipient=${encodeURIComponent(recipient)}` +
    `&apikey=${encodeURIComponent(apiKey)}` +
    `&text=${encodeURIComponent(text)}` +
    `&json=yes`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9500);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    const bodyText = (await res.text()).trim();
    const lower = bodyText.toLowerCase();
    const looksFailed =
      !res.ok ||
      lower.includes('"status":"error"') ||
      lower.includes('error') ||
      lower.includes('invalid') ||
      lower.includes('not connected') ||
      lower.includes('disconnected');
    const looksSuccess =
      lower.includes('success') || lower.includes('"status":"ok"') || lower.includes('sent');
    return {
      ok: looksSuccess || (res.ok && !looksFailed),
      bodyText: bodyText.slice(0, 220),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendWhatsAppTextMeBot(messageText: string): Promise<WhatsAppDispatchResult> {
  const cfg = getWhatsAppConfig();
  if (!cfg.configured) {
    return {
      sent: false,
      recipientMasked: 'Not configured',
      latencyMs: 0,
      detail: 'Set TEXTMEBOT_PHONE and TEXTMEBOT_API_KEY in .env',
    };
  }

  // Respect TextMeBot's 5-second anti-spam spacing between consecutive calls
  const sinceLastMs = Date.now() - lastSendAtMs;
  if (sinceLastMs < 5200 && lastSendAtMs > 0) {
    await new Promise((r) => setTimeout(r, 5200 - sinceLastMs));
  }

  const t0 = Date.now();
  try {
    lastSendAtMs = Date.now();
    let attempt = await callTextMeBot(cfg.phone, cfg.apiKey, messageText);

    // Fallback: if user registered raw 10-digit number without +91 in TextMeBot whitelist
    if (
      !attempt.ok &&
      cfg.phone.startsWith('+91') &&
      /whitelist|not allowed|recipient|authorized/i.test(attempt.bodyText)
    ) {
      await new Promise((r) => setTimeout(r, 5200));
      lastSendAtMs = Date.now();
      attempt = await callTextMeBot(cfg.phone.slice(3), cfg.apiKey, messageText);
    }

    return {
      sent: attempt.ok,
      recipientMasked: cfg.maskedPhone,
      latencyMs: Date.now() - t0,
      detail: attempt.ok
        ? `WhatsApp delivered to ${cfg.maskedPhone}`
        : `TextMeBot response: ${attempt.bodyText || 'Check WhatsApp QR link on textmebot.com'}`,
    };
  } catch (err) {
    return {
      sent: false,
      recipientMasked: cfg.maskedPhone,
      latencyMs: Date.now() - t0,
      detail: `WhatsApp network error: ${(err as Error).message}`,
    };
  }
}
