import fs from 'node:fs';
import path from 'node:path';
import type { AnomalyTriggerReason, SarvamTraceStep } from '../src/types.js';

const SARVAM_BASE = 'https://api.sarvam.ai';
const DATA_DIR = path.resolve('data');
const TTS_CACHE_FILE = path.join(DATA_DIR, 'tts-cache.json');

export const CHECKIN_PROMPTS: Record<AnomalyTriggerReason, string> = {
  FALL_IMPACT_AND_STILLNESS:
    'അമ്മേ, പെട്ടെന്നൊരു വലിയ അനക്കം കണ്ടു. കുഴപ്പമൊന്നുമില്ലല്ലോ? സഹായം വേണമെങ്കിൽ പറയൂ.',
  PROLONGED_ABSENCE_OF_RESPIRATION:
    'അമ്മേ, കുറെ നേരമായി അനക്കമൊന്നും കാണുന്നില്ല. സുഖമാണോ? ഒന്ന് മറുപടി പറയൂ.',
  MANUAL_VERIFICATION_TEST:
    'അമ്മേ, സുഖമാണോ? എന്തെങ്കിലും സഹായം വേണമെങ്കിൽ ഇപ്പോൾ പറയാം.',
};

let ttsCache: Record<string, string> = {};
if (fs.existsSync(TTS_CACHE_FILE)) {
  try {
    ttsCache = JSON.parse(fs.readFileSync(TTS_CACHE_FILE, 'utf8'));
  } catch {
    ttsCache = {};
  }
}

function saveTtsCache() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TTS_CACHE_FILE, JSON.stringify(ttsCache), 'utf8');
}

export const sarvamStats = {
  calls: 0,
  creditGuardLocked: true, // Default LOCKED during dev so zero credits leak accidentally!
  byModel: {} as Record<string, number>,
};

function recordCall(model: string) {
  sarvamStats.calls += 1;
  sarvamStats.byModel[model] = (sarvamStats.byModel[model] || 0) + 1;
}

function getApiKey(): string {
  const k = process.env.SARVAM_API_KEY;
  if (!k) throw new Error('SARVAM_API_KEY missing from .env');
  return k;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 9500): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function synthesizeMalayalam(text: string): Promise<{
  audioBase64: string;
  trace: SarvamTraceStep;
}> {
  if (ttsCache[text]) {
    return {
      audioBase64: ttsCache[text],
      trace: {
        model: 'bulbul:v3 (cached)',
        endpoint: 'DISK CACHE (0 credits)',
        latencyMs: 1,
        detail: `Served cached Malayalam MP3 (${text.length} chars)`,
      },
    };
  }

  if (sarvamStats.creditGuardLocked) {
    const fallbackAudio = Object.values(ttsCache)[0] || '';
    return {
      audioBase64: fallbackAudio,
      trace: {
        model: 'CREDIT-GUARD (0 cr)',
        endpoint: 'LOCAL BYPASS',
        latencyMs: 0,
        detail: 'Outbound Bulbul TTS blocked to preserve hackathon credits',
      },
    };
  }

  const t0 = Date.now();
  const res = await fetchWithTimeout(`${SARVAM_BASE}/text-to-speech`, {
    method: 'POST',
    headers: {
      'api-subscription-key': getApiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      target_language_code: 'ml-IN',
      model: 'bulbul:v3',
      speaker: 'simran',
      pace: 0.96,
      speech_sample_rate: 24000,
      output_audio_codec: 'mp3',
    }),
  });

  if (!res.ok) {
    throw new Error(`Bulbul TTS HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { audios?: string[] };
  const audioBase64 = data.audios?.[0] || '';
  recordCall('bulbul:v3');

  if (audioBase64 && text.length < 220) {
    ttsCache[text] = audioBase64;
    saveTtsCache();
  }

  return {
    audioBase64,
    trace: {
      model: 'bulbul:v3',
      endpoint: 'POST /text-to-speech',
      latencyMs: Date.now() - t0,
      detail: `Synthesized ml-IN MP3 (${Math.round((audioBase64.length * 0.75) / 1024)} KB)`,
    },
  };
}

export async function translateMalayalamToEnglish(textMl: string): Promise<{
  translatedText: string;
  trace: SarvamTraceStep;
}> {
  const t0 = Date.now();
  const res = await fetchWithTimeout(`${SARVAM_BASE}/translate`, {
    method: 'POST',
    headers: {
      'api-subscription-key': getApiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: textMl,
      source_language_code: 'ml-IN',
      target_language_code: 'en-IN',
      model: 'sarvam-translate:v1',
    }),
  });

  if (!res.ok) {
    throw new Error(`Sarvam Translate HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { translated_text: string };
  recordCall('sarvam-translate:v1');

  return {
    translatedText: json.translated_text,
    trace: {
      model: 'sarvam-translate:v1',
      endpoint: 'POST /translate',
      latencyMs: Date.now() - t0,
      detail: `ml-IN -> en-IN ("${json.translated_text.slice(0, 64)}")`,
    },
  };
}

export function pcm16ToWavBuffer(pcm16: Buffer, sampleRate = 16000): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcm16.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm16]);
}

export async function transcribeFallbackRest(pcm16: Buffer): Promise<{
  transcript: string;
  trace: SarvamTraceStep;
}> {
  const t0 = Date.now();
  const wav = pcm16ToWavBuffer(pcm16, 16000);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'consent_window.wav');
  form.append('language_code', 'ml-IN');
  form.append('model', 'saaras:v3');

  const res = await fetchWithTimeout(`${SARVAM_BASE}/speech-to-text`, {
    method: 'POST',
    headers: { 'api-subscription-key': getApiKey() },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Saaras REST fallback HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { transcript?: string };
  recordCall('saaras:v3');
  return {
    transcript: (data.transcript || '').trim(),
    trace: {
      model: 'saaras:v3 (REST fallback)',
      endpoint: 'POST /speech-to-text',
      latencyMs: Date.now() - t0,
      detail: `Recovered transcript from ${Math.round(pcm16.length / 32000 * 10) / 10}s PCM buffer`,
    },
  };
}

export function sanitizeClosingMalayalam(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const sentences = (trimmed.match(/[^.!?।]+[.!?।]+|[^.!?।]+$/g) || [trimmed])
    .map((segment) => segment.trim())
    .filter(Boolean);

  while (sentences.length > 1 && /[?？]+['"”’)]*$/.test(sentences[sentences.length - 1])) {
    sentences.pop();
  }

  return sentences
    .join(' ')
    .trim()
    .replace(/[?？]+(['"”’)]*)$/, '.$1');
}

export async function triageCheckinResponse(params: {
  trigger: AnomalyTriggerReason;
  transcriptMl: string;
  distanceMeters: number;
  peakMotionEnergy: number;
  respirationBpmBefore: number | null;
  sttTrace?: SarvamTraceStep;
}): Promise<{
  transcriptEn: string;
  classification: 'SAFE' | 'EMERGENCY' | 'UNRESPONSIVE';
  clinicalSummaryEn: string;
  replyMl: string;
  replyAudioBase64: string;
  traces: SarvamTraceStep[];
  offlineFallback?: boolean;
}> {
  const traces: SarvamTraceStep[] = [];
  if (params.sttTrace) traces.push(params.sttTrace);

  const cleaned = params.transcriptMl.trim();

  if (sarvamStats.creditGuardLocked) {
    const isSafe = /കുഴപ്പമില്ല|സുഖമാണ്|സാരമില്ല|fine|okay/i.test(cleaned);
    return {
      transcriptEn: cleaned
        ? '[Credit-Guard Dev Mode: Translation paused — 0 credits used]'
        : '[No verbal response — Credit-Guard Dev Mode]',
      classification: !cleaned ? 'UNRESPONSIVE' : isSafe ? 'SAFE' : 'EMERGENCY',
      clinicalSummaryEn: `[0-CREDIT DEV SIM] Triggered at ${params.distanceMeters.toFixed(2)}m. Toggle [SARVAM LIVE] in top bar for live API calls.`,
      replyMl: sanitizeClosingMalayalam('ക്രെഡിറ്റ് സേവർ മോഡ് സജീവമാണ്.'),
      replyAudioBase64: '',
      traces: [
        {
          model: 'CREDIT-GUARD LOCKED',
          endpoint: '0 CREDITS SPENT',
          latencyMs: 0,
          detail: 'All outbound Sarvam API calls blocked during visual/sonar calibration',
        },
      ],
    };
  }

  if (!cleaned) {
    const replyMl = sanitizeClosingMalayalam(
      'മറുപടി ലഭിച്ചില്ല. കുടുംബാംഗങ്ങളെ ഉടൻ വിവരമറിയിക്കുന്നു. പേടിക്കേണ്ട, സഹായം ഉടൻ എത്തും.'
    );
    try {
      const tts = await synthesizeMalayalam(replyMl);
      traces.push(tts.trace);
      return {
        transcriptEn: '[No verbal response during 10-second consent window]',
        classification: 'UNRESPONSIVE',
        clinicalSummaryEn: `Unresponsive after ${params.trigger.replaceAll('_', ' ').toLowerCase()} at ${params.distanceMeters.toFixed(2)}m (peak motion ${params.peakMotionEnergy.toFixed(1)}, prior respiration ${params.respirationBpmBefore ? params.respirationBpmBefore.toFixed(0) + ' BPM' : 'undetected'}). Immediate caregiver call required.`,
        replyMl,
        replyAudioBase64: tts.audioBase64,
        traces,
      };
    } catch {
      traces.push({
        model: 'OFFLINE-FALLBACK',
        endpoint: 'LOCAL RULE ENGINE',
        latencyMs: 0,
        detail: 'Network timeout — local geriatric safety fallback',
      });
      return {
        transcriptEn: '[No verbal response during 10-second consent window]',
        classification: 'UNRESPONSIVE',
        clinicalSummaryEn: `Unresponsive after ${params.trigger.replaceAll('_', ' ').toLowerCase()} at ${params.distanceMeters.toFixed(2)}m (offline 4G fallback). Immediate caregiver call required.`,
        replyMl,
        replyAudioBase64: ttsCache[replyMl] || Object.values(ttsCache)[0] || '',
        traces,
        offlineFallback: true,
      };
    }
  }

  try {
    const chatStart = Date.now();
    const [trRes, chatRes] = await Promise.all([
      translateMalayalamToEnglish(cleaned),
      fetchWithTimeout(`${SARVAM_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'api-subscription-key': getApiKey(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'sarvam-105b-conversations',
          temperature: 0.1,
          max_tokens: 350,
          messages: [
            {
              role: 'system',
              content:
                'You are Kaaval, a respectful Malayalam home-care voice assistant speaking directly TO an elderly mother ("അമ്മേ") in Kerala. An ultrasonic sensor detected a sudden movement and asked her if she is okay. Read her spoken Malayalam reply ("spokenMalayalam") and return ONLY raw valid JSON (no markdown fences): {"classification":"SAFE"|"EMERGENCY","clinicalSummaryEn":"concise 1-sentence note in English for her adult child/caregiver","replyMl":"1 short warm closing Malayalam statement spoken BY YOU TO the elderly mother addressing her as അമ്മേ (NEVER ask a follow-up question because the microphone closes after this reply, and NEVER say മോനേ)"}. Classify as EMERGENCY if there is any fall, slip, pain, dizziness, breathlessness, weakness, call for help, or unclear distressed fragment (in which case reassure her in replyMl that family is being notified immediately); classify as SAFE only if she clearly confirms she is fine.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                trigger: params.trigger,
                distanceMeters: Number(params.distanceMeters.toFixed(2)),
                respirationBpmBefore: params.respirationBpmBefore,
                spokenMalayalam: cleaned,
              }),
            },
          ],
        }),
      }),
    ]);

    traces.push(trRes.trace);

    if (!chatRes.ok) {
      throw new Error(`sarvam-105b-conversations HTTP ${chatRes.status}: ${await chatRes.text()}`);
    }

    const chatJson = (await chatRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    recordCall('sarvam-105b-conversations');

    const rawContent = (chatJson.choices?.[0]?.message?.content || '').trim();
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    let parsed: {
      classification: 'SAFE' | 'EMERGENCY';
      clinicalSummaryEn: string;
      replyMl: string;
    } = {
      classification: 'EMERGENCY',
      clinicalSummaryEn: `Resident responded: "${trRes.translatedText}". Flagged for precaution.`,
      replyMl: 'വിവരം കുടുംബാംഗങ്ങളെ അറിയിച്ചിട്ടുണ്ട്. അനങ്ങാതെ വിശ്രമിക്കൂ.',
    };

    if (jsonMatch) {
      try {
        const candidate = JSON.parse(jsonMatch[0]);
        if (candidate.classification === 'SAFE' || candidate.classification === 'EMERGENCY') {
          parsed = {
            classification: candidate.classification,
            clinicalSummaryEn:
              typeof candidate.clinicalSummaryEn === 'string' && candidate.clinicalSummaryEn.trim()
                ? candidate.clinicalSummaryEn.trim()
                : parsed.clinicalSummaryEn,
            replyMl:
              typeof candidate.replyMl === 'string' && candidate.replyMl.trim()
                ? candidate.replyMl.trim()
                : parsed.replyMl,
          };
        }
      } catch {
        // Keep conservative emergency fallback if JSON parse fails
      }
    }

    const sanitizedReplyMl = sanitizeClosingMalayalam(parsed.replyMl);

    traces.push({
      model: 'sarvam-105b-conversations',
      endpoint: 'POST /v1/chat/completions',
      latencyMs: Date.now() - chatStart,
      detail: `Classified -> ${parsed.classification}`,
    });

    const tts = await synthesizeMalayalam(sanitizedReplyMl);
    traces.push(tts.trace);

    return {
      transcriptEn: trRes.translatedText,
      classification: parsed.classification,
      clinicalSummaryEn: parsed.clinicalSummaryEn,
      replyMl: sanitizedReplyMl,
      replyAudioBase64: tts.audioBase64,
      traces,
    };
  } catch {
    const isSafe = /കുഴപ്പമില്ല|സുഖമാണ്|സാരമില്ല/.test(cleaned);
    const classification: 'SAFE' | 'EMERGENCY' = isSafe ? 'SAFE' : 'EMERGENCY';
    const replyMl = sanitizeClosingMalayalam(
      classification === 'SAFE'
        ? 'അമ്മേ, സന്തോഷം. സുഖമായി വിശ്രമിക്കൂ.'
        : 'അമ്മേ, പേടിക്കേണ്ട. വിവരം കുടുംബാംഗങ്ങളെ ഉടൻ അറിയിച്ചിട്ടുണ്ട്.'
    );
    const replyAudioBase64 =
      classification === 'EMERGENCY'
        ? ttsCache[replyMl] || Object.values(ttsCache)[0] || ''
        : ttsCache[replyMl] || '';

    traces.push({
      model: 'OFFLINE-FALLBACK',
      endpoint: 'LOCAL RULE ENGINE',
      latencyMs: 0,
      detail: 'Network timeout — local geriatric safety fallback',
    });

    return {
      transcriptEn:
        classification === 'SAFE'
          ? '[Offline 4G fallback: Resident confirmed well-being in Malayalam]'
          : `[Offline 4G fallback — Malayalam speech: "${cleaned}"]`,
      classification,
      clinicalSummaryEn:
        classification === 'SAFE'
          ? 'Offline 4G fallback: Resident confirmed safety via local Malayalam phrase matcher.'
          : `Offline 4G fallback after ${params.trigger.replaceAll('_', ' ').toLowerCase()} at ${params.distanceMeters.toFixed(2)}m. Precautionary emergency escalation triggered locally.`,
      replyMl,
      replyAudioBase64,
      traces,
      offlineFallback: true,
    };
  }
}

export async function synthesizeCaregiverBridge(
  inputText: string,
  sourceLang: 'en-IN' | 'ml-IN' | 'hi-IN'
): Promise<{
  spokenMalayalam: string;
  audioBase64: string;
  traces: SarvamTraceStep[];
}> {
  const defaultReassuranceMl = 'അമ്മേ, പേടിക്കേണ്ട, ഞാൻ ഉടൻ സഹായം അയക്കുന്നുണ്ട്.';

  if (sarvamStats.creditGuardLocked) {
    return {
      spokenMalayalam: defaultReassuranceMl,
      audioBase64: Object.values(ttsCache)[0] || '',
      traces: [
        {
          model: 'CREDIT-GUARD',
          endpoint: 'LOCAL BYPASS (0 credits)',
          latencyMs: 0,
          detail: 'Simulated Malayalam caregiver reassurance while Credit Guard is locked',
        },
      ],
    };
  }

  const traces: SarvamTraceStep[] = [];
  const cleanedInput = inputText.trim();
  let spokenMalayalam = cleanedInput || defaultReassuranceMl;

  if (cleanedInput && sourceLang !== 'ml-IN') {
    const t0 = Date.now();
    try {
      const res = await fetchWithTimeout(`${SARVAM_BASE}/translate`, {
        method: 'POST',
        headers: {
          'api-subscription-key': getApiKey(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: cleanedInput,
          source_language_code: sourceLang,
          target_language_code: 'ml-IN',
          model: 'sarvam-translate:v1',
        }),
      });

      if (!res.ok) {
        throw new Error(`Sarvam Translate HTTP ${res.status}: ${await res.text()}`);
      }

      const json = (await res.json()) as { translated_text?: string };
      recordCall('sarvam-translate:v1');
      spokenMalayalam = (json.translated_text || '').trim() || defaultReassuranceMl;
      traces.push({
        model: 'sarvam-translate:v1',
        endpoint: 'POST /translate',
        latencyMs: Date.now() - t0,
        detail: `${sourceLang} -> ml-IN ("${spokenMalayalam.slice(0, 64)}")`,
      });
    } catch {
      spokenMalayalam = defaultReassuranceMl;
      traces.push({
        model: 'OFFLINE-FALLBACK',
        endpoint: 'LOCAL RULE ENGINE',
        latencyMs: Date.now() - t0,
        detail: 'Network timeout — local caregiver reassurance fallback',
      });
    }
  }

  let audioBase64 = '';
  try {
    const tts = await synthesizeMalayalam(spokenMalayalam);
    audioBase64 = tts.audioBase64;
    traces.push(tts.trace);
  } catch {
    audioBase64 = ttsCache[spokenMalayalam] || Object.values(ttsCache)[0] || '';
    traces.push({
      model: 'OFFLINE-FALLBACK',
      endpoint: 'LOCAL CACHE',
      latencyMs: 0,
      detail: 'Network timeout — served cached Malayalam audio',
    });
  }

  return {
    spokenMalayalam,
    audioBase64,
    traces,
  };
}

export async function warmPromptCache(): Promise<void> {
  for (const text of Object.values(CHECKIN_PROMPTS)) {
    try {
      await synthesizeMalayalam(text);
    } catch (err) {
      console.warn('[kaaval] Prompt pre-warm skipped:', (err as Error).message);
    }
  }
}
