import fs from 'node:fs';
import path from 'node:path';
import type { AnomalyTriggerReason, IndianLangCode, SarvamTraceStep } from '../src/types.js';

const SARVAM_BASE = 'https://api.sarvam.ai';
const DATA_DIR = path.resolve('data');
const TTS_CACHE_FILE = path.join(DATA_DIR, 'tts-cache.json');

export interface LangProfile {
  code: IndianLangCode;
  nameEn: string;
  nativeName: string;
  elderAddress: string;
  prompts: Record<AnomalyTriggerReason, string>;
  unresponsiveReply: string;
  safeFallbackReply: string;
  emergencyFallbackReply: string;
  defaultCaregiverReassurance: string;
  safeRegex: RegExp;
}

export const BHARAT_LANGUAGES: Record<IndianLangCode, LangProfile> = {
  'ml-IN': {
    code: 'ml-IN',
    nameEn: 'Malayalam',
    nativeName: 'മലയാളം',
    elderAddress: 'അമ്മേ',
    prompts: {
      FALL_IMPACT_AND_STILLNESS:
        'അമ്മേ, പെട്ടെന്നൊരു വലിയ അനക്കം കണ്ടു. കുഴപ്പമൊന്നുമില്ലല്ലോ? സഹായം വേണമെങ്കിൽ പറയൂ.',
      PROLONGED_ABSENCE_OF_RESPIRATION:
        'അമ്മേ, കുറെ നേരമായി അനക്കമൊന്നും കാണുന്നില്ല. സുഖമാണോ? ഒന്ന് മറുപടി പറയൂ.',
      MANUAL_VERIFICATION_TEST:
        'അമ്മേ, സുഖമാണോ? എന്തെങ്കിലും സഹായം വേണമെങ്കിൽ ഇപ്പോൾ പറയാം.',
    },
    unresponsiveReply:
      'മറുപടി ലഭിച്ചില്ല. കുടുംബാംഗങ്ങളെ ഉടൻ വിവരമറിയിക്കുന്നു. പേടിക്കേണ്ട, സഹായം ഉടൻ എത്തും.',
    safeFallbackReply: 'അമ്മേ, സന്തോഷം. സുഖമായി വിശ്രമിക്കൂ.',
    emergencyFallbackReply: 'അമ്മേ, പേടിക്കേണ്ട. വിവരം കുടുംബാംഗങ്ങളെ ഉടൻ അറിയിച്ചിട്ടുണ്ട്.',
    defaultCaregiverReassurance: 'അമ്മേ, പേടിക്കേണ്ട, ഞാൻ ഉടൻ സഹായം അയക്കുന്നുണ്ട്.',
    safeRegex: /കുഴപ്പമില്ല|സുഖമാണ്|സാരമില്ല|fine|okay|ok\b/i,
  },
  'ta-IN': {
    code: 'ta-IN',
    nameEn: 'Tamil',
    nativeName: 'தமிழ்',
    elderAddress: 'அம்மா',
    prompts: {
      FALL_IMPACT_AND_STILLNESS:
        'அம்மா, திடீரென ஒரு பெரிய அசைவு தெரிந்தது. நீங்கள் நலமாக இருக்கிறீர்களா? உதவி வேண்டுமென்றால் சொல்லுங்கள்.',
      PROLONGED_ABSENCE_OF_RESPIRATION:
        'அம்மா, சிறிது நேரமாக எந்த அசைவும் இல்லை. நலமாக இருக்கிறீர்களா? பதில் சொல்லுங்கள்.',
      MANUAL_VERIFICATION_TEST:
        'அம்மா, நீங்கள் நலமாக இருக்கிறீர்களா? ஏதாவது உதவி வேண்டுமென்றால் இப்போது சொல்லலாம்.',
    },
    unresponsiveReply:
      'பதில் எதுவும் கிடைக்கவில்லை. குடும்பத்தினருக்கு உடனே தகவல் அனுப்பப்படுகிறது. கவலைப்படாதீர்கள், உதவி விரைவில் வரும்.',
    safeFallbackReply: 'அம்மா, மிக்க மகிழ்ச்சி. நிம்மதியாக ஓய்வெடுங்கள்.',
    emergencyFallbackReply: 'அம்மா, பயப்படாதீர்கள். குடும்பத்தினருக்கு உடனே தகவல் அனுப்பப்பட்டுள்ளது.',
    defaultCaregiverReassurance: 'அம்மா, பயப்படாதீர்கள், நான் உடனே உதவியை அனுப்புகிறேன்.',
    safeRegex: /பரவாயில்லை|நலமாக|நல்லா இருக்கேன்|ஒன்னுமில்ல|fine|okay|ok\b/i,
  },
  'hi-IN': {
    code: 'hi-IN',
    nameEn: 'Hindi',
    nativeName: 'हिन्दी',
    elderAddress: 'माँ जी',
    prompts: {
      FALL_IMPACT_AND_STILLNESS:
        'माँ जी, अभी अचानक तेज़ हलचल महसूस हुई। क्या आप ठीक हैं? अगर मदद चाहिए तो बताइए।',
      PROLONGED_ABSENCE_OF_RESPIRATION:
        'माँ जी, कुछ देर से कोई हलचल नहीं दिख रही है। क्या आप ठीक हैं? कृपया जवाब दीजिए।',
      MANUAL_VERIFICATION_TEST:
        'माँ जी, क्या आप ठीक हैं? अगर किसी मदद की ज़रूरत हो तो अभी बताइए।',
    },
    unresponsiveReply:
      'कोई जवाब नहीं मिला। परिवार को तुरंत सूचना भेजी जा रही है। घबराइए मत, मदद तुरंत पहुँच रही है।',
    safeFallbackReply: 'माँ जी, यह सुनकर अच्छा लगा। आराम से विश्राम कीजिए।',
    emergencyFallbackReply: 'माँ जी, घबराइए मत। परिवार को तुरंत सूचना दे दी गई है।',
    defaultCaregiverReassurance: 'माँ जी, चिंता मत कीजिए, मैं अभी तुरंत मदद भेज रहा हूँ।',
    safeRegex: /ठीक हूँ|ठीक है|कोई बात नहीं|सब ठीक|fine|okay|ok\b/i,
  },
  'kn-IN': {
    code: 'kn-IN',
    nameEn: 'Kannada',
    nativeName: 'ಕನ್ನಡ',
    elderAddress: 'ಅಮ್ಮಾ',
    prompts: {
      FALL_IMPACT_AND_STILLNESS:
        'ಅಮ್ಮಾ, ಈಗ ತಾನೇ ಜೋರಾದ ಚಲನೆ ಕಂಡುಬಂದಿದೆ. ನೀವು ಕ್ಷೇಮವಾಗಿದ್ದೀರಾ? ಸಹಾಯ ಬೇಕಿದ್ದರೆ ಹೇಳಿ.',
      PROLONGED_ABSENCE_OF_RESPIRATION:
        'ಅಮ್ಮಾ, ಸ್ವಲ್ಪ ಸಮಯದಿಂದ ಯಾವುದೇ ಚಲನೆ ಕಾಣುತ್ತಿಲ್ಲ. ನೀವು ಚೆನ್ನಾಗಿದ್ದೀರಾ? ದಯವಿಟ್ಟು ಉತ್ತರಿಸಿ.',
      MANUAL_VERIFICATION_TEST:
        'ಅಮ್ಮಾ, ನೀವು ಚೆನ್ನಾಗಿದ್ದೀರಾ? ಏನಾದರೂ ಸಹಾಯ ಬೇಕಿದ್ದರೆ ಈಗ ಹೇಳಬಹುದು.',
    },
    unresponsiveReply:
      'ಯಾವುದೇ ಉತ್ತರ ಬಂದಿಲ್ಲ. ಕುಟುಂಬದವರಿಗೆ ತಕ್ಷಣ ಮಾಹಿತಿ ನೀಡಲಾಗುತ್ತಿದೆ. ಹೆದರಬೇಡಿ, ಸಹಾಯ ಶೀಘ್ರದಲ್ಲೇ ಬರುತ್ತದೆ.',
    safeFallbackReply: 'ಅಮ್ಮಾ, ಸಂತೋಷ. ನೆಮ್ಮದಿಯಾಗಿ ವಿಶ್ರಾಂತಿ ತೆಗೆದುಕೊಳ್ಳಿ.',
    emergencyFallbackReply: 'ಅಮ್ಮಾ, ಹೆದರಬೇಡಿ. ಕುಟುಂಬದವರಿಗೆ ತಕ್ಷಣ ತಿಳಿಸಲಾಗಿದೆ.',
    defaultCaregiverReassurance: 'ಅಮ್ಮಾ, ಗಾಬರಿಯಾಗಬೇಡಿ, ನಾನು ಈಗಲೇ ಸಹಾಯ ಕಳುಹಿಸುತ್ತಿದ್ದೇನೆ.',
    safeRegex: /ಚೆನ್ನಾಗಿದ್ದೇನೆ|ಪರವಾಗಿಲ್ಲ|ಏನಿಲ್ಲ|fine|okay|ok\b/i,
  },
  'te-IN': {
    code: 'te-IN',
    nameEn: 'Telugu',
    nativeName: 'తెలుగు',
    elderAddress: 'అమ్మా',
    prompts: {
      FALL_IMPACT_AND_STILLNESS:
        'అమ్మా, ఇప్పుడే పెద్ద కదలిక కనిపించింది. మీరు క్షేమంగా ఉన్నారా? సహాయం కావాలంటే చెప్పండి.',
      PROLONGED_ABSENCE_OF_RESPIRATION:
        'అమ్మా, కొంతసేపటి నుండి కదలిక కనిపించడం లేదు. మీరు బాగున్నారా? దయచేసి బదులివ్వండి.',
      MANUAL_VERIFICATION_TEST:
        'అమ్మా, మీరు బాగున్నారా? ఏదైనా సహాయం కావాలంటే ఇప్పుడే చెప్పండి.',
    },
    unresponsiveReply:
      'ఎలాంటి సమాధానం రాలేదు. కుటుంబ సభ్యులకు వెంటనే సమాచారం అందిస్తున్నాము. భయపడకండి, సహాయం వెంటనే వస్తుంది.',
    safeFallbackReply: 'అమ్మా, సంతోషం. ప్రశాంతంగా విశ్రాంతి తీసుకోండి.',
    emergencyFallbackReply: 'అమ్మా, కంగారు పడకండి. కుటుంబ సభ్యులకు వెంటనే సమాచారం అందించాము.',
    defaultCaregiverReassurance: 'అమ్మా, భయపడకండి, నేను ఇప్పుడే సహాయం పంపిస్తున్నాను.',
    safeRegex: /బాగున్నాను|పర్వాలేదు|ఏమీ లేదు|fine|okay|ok\b/i,
  },
  'bn-IN': {
    code: 'bn-IN',
    nameEn: 'Bengali',
    nativeName: 'বাংলা',
    elderAddress: 'মা',
    prompts: {
      FALL_IMPACT_AND_STILLNESS:
        'মা, হঠাৎ একটা বড় নড়াচড়া বোঝা গেছে। আপনি কি ঠিক আছেন? সাহায্য লাগলে বলুন।',
      PROLONGED_ABSENCE_OF_RESPIRATION:
        'মা, কিছুক্ষণ ধরে কোনো সাড়া পাওয়া যাচ্ছে না। আপনি কি ঠিক আছেন? দয়া করে উত্তর দিন।',
      MANUAL_VERIFICATION_TEST:
        'মা, আপনি কি ভালো আছেন? কোনো সাহায্য লাগলে এখন বলতে পারেন।',
    },
    unresponsiveReply:
      'কোনো উত্তর পাওয়া যায়নি। পরিবারের সদস্যদের এক্ষুনি জানানো হচ্ছে। ভয় পাবেন না, সাহায্য আসছে।',
    safeFallbackReply: 'মা, শুনে নিশ্চিন্ত হলাম। আরাম করে বিশ্রাম নিন।',
    emergencyFallbackReply: 'মা, ভয় পাবেন না। পরিবারকে এক্ষুনি খবর দেওয়া হয়েছে।',
    defaultCaregiverReassurance: 'মা, চিন্তা করবেন না, আমি এক্ষুনি সাহায্য পাঠাচ্ছি।',
    safeRegex: /ঠিক আছি|ভালো আছি|কিছু হয়নি|fine|okay|ok\b/i,
  },
  'mr-IN': {
    code: 'mr-IN',
    nameEn: 'Marathi',
    nativeName: 'मराठी',
    elderAddress: 'आई',
    prompts: {
      FALL_IMPACT_AND_STILLNESS:
        'आई, आत्ताच अचानक मोठी हालचाल जाणवली. तुम्ही ठीक आहात का? मदत हवी असल्यास सांगा.',
      PROLONGED_ABSENCE_OF_RESPIRATION:
        'आई, काही वेळापासून कोणतीही हालचाल दिसत नाही. तुम्ही ठीक आहात का? कृपया उत्तर द्या.',
      MANUAL_VERIFICATION_TEST:
        'आई, तुम्ही ठीक आहात का? काही मदत हवी असल्यास आता सांगा.',
    },
    unresponsiveReply:
      'कोणतेही उत्तर मिळाले नाही. कुटुंबीयांना तात्काळ कळवले जात आहे. घाबरू नका, मदत लगेच पोहोचत आहे.',
    safeFallbackReply: 'आई, ऐकून बरे वाटले. निवांत विश्रांती घ्या.',
    emergencyFallbackReply: 'आई, घाबरू नका. कुटुंबीयांना लगेच कळवले आहे.',
    defaultCaregiverReassurance: 'आई, काळजी करू नका, मी आत्ताच मदत पाठवत आहे.',
    safeRegex: /ठीक आहे|काही नाही|बरी आहे|fine|okay|ok\b/i,
  },
  'gu-IN': {
    code: 'gu-IN',
    nameEn: 'Gujarati',
    nativeName: 'ગુજરાતી',
    elderAddress: 'બા',
    prompts: {
      FALL_IMPACT_AND_STILLNESS:
        'બા, હમણાં જ અચાનક મોટી હિલચાલ જણાઈ. તમે ઠીક છો ને? મદદ જોઈતી હોય તો કહો.',
      PROLONGED_ABSENCE_OF_RESPIRATION:
        'બા, થોડા સમયથી કોઈ હિલચાલ દેખાતી નથી. તમે કુશળ છો ને? કૃપા કરીને જવાબ આપો.',
      MANUAL_VERIFICATION_TEST:
        'બા, તમે ઠીક છો ને? કોઈ મદદની જરૂર હોય તો અત્યારે કહો.',
    },
    unresponsiveReply:
      'કોઈ જવાબ મળ્યો નથી. પરિવારજનોને તરત જ જાણ કરવામાં આવી રહી છે. ગભરાશો નહીં, મદદ તરત પહોંચે છે.',
    safeFallbackReply: 'બા, જાણીને આનંદ થયો. આરામથી વિશ્રામ કરો.',
    emergencyFallbackReply: 'બા, ગભરાશો નહીં. પરિવારને તરત જાણ કરી દેવામાં આવી છે.',
    defaultCaregiverReassurance: 'બા, ચિંતા કરશો નહીં, હું હમણાં જ મદદ મોકલું છું.',
    safeRegex: /ઠીક છું|બરાબર|કંઈ નથી|fine|okay|ok\b/i,
  },
  'pa-IN': {
    code: 'pa-IN',
    nameEn: 'Punjabi',
    nativeName: 'ਪੰਜਾਬੀ',
    elderAddress: 'ਬੀਜੀ',
    prompts: {
      FALL_IMPACT_AND_STILLNESS:
        'ਬੀਜੀ, ਹੁਣੇ ਅਚਾਨਕ ਤੇਜ਼ ਹਲਚਲ ਮਹਿਸੂਸ ਹੋਈ। ਕੀ ਤੁਸੀਂ ਠੀਕ ਹੋ? ਮਦਦ ਚਾਹੀਦੀ ਹੋਵੇ ਤਾਂ ਦੱਸੋ।',
      PROLONGED_ABSENCE_OF_RESPIRATION:
        'ਬੀਜੀ, ਕੁਝ ਦੇਰ ਤੋਂ ਕੋਈ ਹਲਚਲ ਨਹੀਂ ਦਿਖ ਰਹੀ। ਕੀ ਤੁਸੀਂ ਠੀਕ ਹੋ? ਕਿਰਪਾ ਕਰਕੇ ਜਵਾਬ ਦਿਓ।',
      MANUAL_VERIFICATION_TEST:
        'ਬੀਜੀ, ਕੀ ਤੁਸੀਂ ਠੀਕ ਹੋ? ਜੇ ਕੋਈ ਮਦਦ ਚਾਹੀਦੀ ਹੈ ਤਾਂ ਹੁਣੇ ਦੱਸੋ।',
    },
    unresponsiveReply:
      'ਕੋਈ ਜਵਾਬ ਨਹੀਂ ਮਿਲਿਆ। ਪਰਿਵਾਰ ਨੂੰ ਤੁਰੰਤ ਸੂਚਿਤ ਕੀਤਾ ਜਾ ਰਿਹਾ ਹੈ। ਘਬਰਾਓ ਨਾ, ਮਦਦ ਤੁਰੰਤ ਪਹੁੰਚ ਰਹੀ ਹੈ।',
    safeFallbackReply: 'ਬੀਜੀ, ਸੁਣ ਕੇ ਖੁਸ਼ੀ ਹੋਈ। ਆਰਾਮ ਨਾਲ ਵਿਸ਼ਰਾਮ ਕਰੋ।',
    emergencyFallbackReply: 'ਬੀਜੀ, ਘਬਰਾਓ ਨਾ। ਪਰਿਵਾਰ ਨੂੰ ਤੁਰੰਤ ਦੱਸ ਦਿੱਤਾ ਗਿਆ ਹੈ।',
    defaultCaregiverReassurance: 'ਬੀਜੀ, ਚਿੰਤਾ ਨਾ ਕਰੋ, ਮੈਂ ਹੁਣੇ ਮਦਦ ਭੇਜ ਰਿਹਾ ਹਾਂ।',
    safeRegex: /ਠੀਕ ਹਾਂ|ਠੀਕ ਹੈ|ਕੋਈ ਗੱਲ ਨਹੀਂ|fine|okay|ok\b/i,
  },
  'en-IN': {
    code: 'en-IN',
    nameEn: 'English (India)',
    nativeName: 'English',
    elderAddress: 'Amma',
    prompts: {
      FALL_IMPACT_AND_STILLNESS:
        'Amma, a sudden impact was detected in the room. Are you alright? Please speak if you need help.',
      PROLONGED_ABSENCE_OF_RESPIRATION:
        'Amma, there has been no movement for a while. Are you doing okay? Please answer.',
      MANUAL_VERIFICATION_TEST:
        'Amma, checking in on you. Please tell me if you are fine or if you need assistance.',
    },
    unresponsiveReply:
      'No spoken response detected. Alerting your family right away. Please stay calm, help is on the way.',
    safeFallbackReply: 'Glad to hear you are safe, Amma. Please rest comfortably.',
    emergencyFallbackReply: 'Stay calm Amma, your family has been alerted immediately.',
    defaultCaregiverReassurance: 'Amma stay calm, I am sending help to you right away.',
    safeRegex: /\b(i am fine|i'm fine|all good|no problem|doing okay|im okay|okay|fine)\b/i,
  },
};

export const CHECKIN_PROMPTS = BHARAT_LANGUAGES['ml-IN'].prompts;

export function resolveLangCode(code?: string | null): IndianLangCode {
  if (code && code in BHARAT_LANGUAGES) {
    return code as IndianLangCode;
  }
  return 'ml-IN';
}

export function getCheckinPrompt(trigger: AnomalyTriggerReason, lang?: string | null): string {
  const prof = BHARAT_LANGUAGES[resolveLangCode(lang)];
  return prof.prompts[trigger] || prof.prompts.FALL_IMPACT_AND_STILLNESS;
}

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
  creditGuardLocked: true,
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

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 9500
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function synthesizeSpeech(
  text: string,
  langCode: IndianLangCode = 'ml-IN'
): Promise<{
  audioBase64: string;
  trace: SarvamTraceStep;
}> {
  const resolved = resolveLangCode(langCode);
  const cacheKey = `${resolved}::${text}`;
  const legacyHit = resolved === 'ml-IN' ? ttsCache[text] : undefined;
  const cachedAudio = ttsCache[cacheKey] || legacyHit;

  if (cachedAudio) {
    return {
      audioBase64: cachedAudio,
      trace: {
        model: 'bulbul:v3 (cached)',
        endpoint: 'DISK CACHE (0 credits)',
        latencyMs: 1,
        detail: `Served cached ${resolved} MP3 (${text.length} chars)`,
      },
    };
  }

  if (sarvamStats.creditGuardLocked) {
    const fallbackAudio = legacyHit || (resolved === 'ml-IN' ? Object.values(ttsCache)[0] || '' : '');
    return {
      audioBase64: fallbackAudio,
      trace: {
        model: 'CREDIT-GUARD (0 cr)',
        endpoint: 'LOCAL BYPASS',
        latencyMs: 0,
        detail: `Bulbul TTS (${resolved}) paused in 0-credit mode — unlock Sarvam Live for ${BHARAT_LANGUAGES[resolved].nameEn} audio`,
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
      target_language_code: resolved,
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

  if (audioBase64 && text.length < 240) {
    ttsCache[cacheKey] = audioBase64;
    saveTtsCache();
  }

  return {
    audioBase64,
    trace: {
      model: 'bulbul:v3',
      endpoint: 'POST /text-to-speech',
      latencyMs: Date.now() - t0,
      detail: `Synthesized ${resolved} (${BHARAT_LANGUAGES[resolved].nameEn}) MP3 (${Math.round((audioBase64.length * 0.75) / 1024)} KB)`,
    },
  };
}

export const synthesizeMalayalam = (text: string) => synthesizeSpeech(text, 'ml-IN');

export async function translateToEnglish(
  inputText: string,
  sourceLang: IndianLangCode
): Promise<{
  translatedText: string;
  trace: SarvamTraceStep;
}> {
  if (sourceLang === 'en-IN') {
    return {
      translatedText: inputText,
      trace: {
        model: 'sarvam-translate:v1 (passthrough)',
        endpoint: 'en-IN direct',
        latencyMs: 0,
        detail: `Input already in English ("${inputText.slice(0, 64)}")`,
      },
    };
  }

  const t0 = Date.now();
  const res = await fetchWithTimeout(`${SARVAM_BASE}/translate`, {
    method: 'POST',
    headers: {
      'api-subscription-key': getApiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: inputText,
      source_language_code: sourceLang,
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
      detail: `${sourceLang} -> en-IN ("${json.translated_text.slice(0, 64)}")`,
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
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm16]);
}

export async function transcribeFallbackRest(
  pcm16: Buffer,
  langOrUnknown = 'ml-IN'
): Promise<{
  transcript: string;
  detectedLang?: IndianLangCode;
  trace: SarvamTraceStep;
}> {
  const t0 = Date.now();
  const wav = pcm16ToWavBuffer(pcm16, 16000);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'consent_window.wav');
  form.append('language_code', langOrUnknown);
  form.append('model', 'saaras:v3');

  const res = await fetchWithTimeout(`${SARVAM_BASE}/speech-to-text`, {
    method: 'POST',
    headers: { 'api-subscription-key': getApiKey() },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Saaras REST fallback HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { transcript?: string; language_code?: string };
  recordCall('saaras:v3');
  const detectedLang = data.language_code ? resolveLangCode(data.language_code) : undefined;
  return {
    transcript: (data.transcript || '').trim(),
    detectedLang,
    trace: {
      model: 'saaras:v3 (REST fallback)',
      endpoint: 'POST /speech-to-text',
      latencyMs: Date.now() - t0,
      detail: `Recovered ${detectedLang || langOrUnknown} transcript from ${Math.round((pcm16.length / 32000) * 10) / 10}s PCM`,
    },
  };
}

export function sanitizeClosingReply(text: string): string {
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
  elderLang?: IndianLangCode;
  distanceMeters: number;
  peakMotionEnergy: number;
  respirationBpmBefore: number | null;
  sttTrace?: SarvamTraceStep;
}): Promise<{
  elderLang: IndianLangCode;
  elderLangLabel: string;
  transcriptEn: string;
  classification: 'SAFE' | 'EMERGENCY' | 'UNRESPONSIVE';
  clinicalSummaryEn: string;
  replyMl: string;
  replyAudioBase64: string;
  traces: SarvamTraceStep[];
  offlineFallback?: boolean;
}> {
  const langCode = resolveLangCode(params.elderLang);
  const prof = BHARAT_LANGUAGES[langCode];
  const traces: SarvamTraceStep[] = [];
  if (params.sttTrace) traces.push(params.sttTrace);

  const cleaned = params.transcriptMl.trim();

  if (sarvamStats.creditGuardLocked) {
    const isSafe = prof.safeRegex.test(cleaned);
    const classification = !cleaned ? 'UNRESPONSIVE' : isSafe ? 'SAFE' : 'EMERGENCY';
    const simReply = !cleaned
      ? prof.unresponsiveReply
      : isSafe
      ? prof.safeFallbackReply
      : prof.emergencyFallbackReply;
    return {
      elderLang: langCode,
      elderLangLabel: `${prof.nativeName} (${prof.nameEn})`,
      transcriptEn: cleaned
        ? `[0-Credit Sim · ${prof.nameEn}] Spoken reply captured — unlock Sarvam Live for cloud translation`
        : '[No spoken reply during 9.5s consent window]',
      classification,
      clinicalSummaryEn: !cleaned
        ? `Unresponsive after ${params.trigger.replaceAll('_', ' ').toLowerCase()} at ${params.distanceMeters.toFixed(2)}m (${prof.nameEn} check-in). Immediate family alert triggered.`
        : isSafe
        ? `Resident confirmed well-being in ${prof.nameEn} at ${params.distanceMeters.toFixed(2)}m.`
        : `Distress / help request detected in ${prof.nameEn} at ${params.distanceMeters.toFixed(2)}m. Alerting family.`,
      replyMl: sanitizeClosingReply(simReply),
      replyAudioBase64: '',
      traces: [
        ...traces,
        {
          model: 'CREDIT-GUARD (0 cr)',
          endpoint: 'LOCAL RULE TRIAGE',
          latencyMs: 0,
          detail: `Simulated ${prof.nameEn} (${langCode}) triage — toggle Sarvam Live for 4-model cloud inference`,
        },
      ],
    };
  }

  if (!cleaned) {
    const replyNative = sanitizeClosingReply(prof.unresponsiveReply);
    try {
      const tts = await synthesizeSpeech(replyNative, langCode);
      traces.push(tts.trace);
      return {
        elderLang: langCode,
        elderLangLabel: `${prof.nativeName} (${prof.nameEn})`,
        transcriptEn: '[No verbal response during 9.5-second consent window]',
        classification: 'UNRESPONSIVE',
        clinicalSummaryEn: `Unresponsive after ${params.trigger.replaceAll('_', ' ').toLowerCase()} at ${params.distanceMeters.toFixed(2)}m (peak motion ${params.peakMotionEnergy.toFixed(1)}, prior respiration ${params.respirationBpmBefore ? params.respirationBpmBefore.toFixed(0) + ' BPM' : 'tracking'}). Immediate caregiver call required.`,
        replyMl: replyNative,
        replyAudioBase64: tts.audioBase64,
        traces,
      };
    } catch {
      traces.push({
        model: 'OFFLINE-FALLBACK',
        endpoint: 'LOCAL RULE ENGINE',
        latencyMs: 0,
        detail: `Network timeout — local ${prof.nameEn} geriatric safety fallback`,
      });
      return {
        elderLang: langCode,
        elderLangLabel: `${prof.nativeName} (${prof.nameEn})`,
        transcriptEn: '[No verbal response during 9.5-second consent window]',
        classification: 'UNRESPONSIVE',
        clinicalSummaryEn: `Unresponsive after ${params.trigger.replaceAll('_', ' ').toLowerCase()} at ${params.distanceMeters.toFixed(2)}m (offline fallback). Immediate caregiver call required.`,
        replyMl: replyNative,
        replyAudioBase64: ttsCache[`${langCode}::${replyNative}`] || '',
        traces,
        offlineFallback: true,
      };
    }
  }

  try {
    const chatStart = Date.now();
    const [trRes, chatRes] = await Promise.all([
      translateToEnglish(cleaned, langCode),
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
              content: `You are Kaaval, a warm, respectful Indian elder-care home voice guardian speaking directly TO an elderly parent in ${prof.nameEn} (${langCode}), addressing them affectionately as "${prof.elderAddress}". An ultrasonic room sensor detected a sudden physical anomaly and asked if they are alright. Read their spoken reply ("spokenTranscript") and return ONLY raw valid JSON (no markdown fences): {"classification":"SAFE"|"EMERGENCY","clinicalSummaryEn":"concise 1-sentence clinical summary in English for family caregivers","replyNative":"1 short warm closing statement written strictly in ${prof.nameEn} script (${langCode}) spoken BY YOU TO "${prof.elderAddress}" (NEVER ask any follow-up question because the microphone closes immediately after this sentence)"}. Classify as EMERGENCY if there is any fall, slip, pain, dizziness, breathlessness, weakness, call for help, or unclear distressed utterance (reassure them in replyNative that family is being notified right now); classify as SAFE only if they clearly confirm they are fine.`,
            },
            {
              role: 'user',
              content: JSON.stringify({
                language: `${prof.nameEn} (${langCode})`,
                trigger: params.trigger,
                distanceMeters: Number(params.distanceMeters.toFixed(2)),
                respirationBpmBefore: params.respirationBpmBefore,
                spokenTranscript: cleaned,
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
      replyNative: string;
    } = {
      classification: 'EMERGENCY',
      clinicalSummaryEn: `Resident responded in ${prof.nameEn}: "${trRes.translatedText}". Flagged for precaution.`,
      replyNative: prof.emergencyFallbackReply,
    };

    if (jsonMatch) {
      try {
        const candidate = JSON.parse(jsonMatch[0]);
        if (candidate.classification === 'SAFE' || candidate.classification === 'EMERGENCY') {
          const candReply = candidate.replyNative || candidate.replyMl;
          parsed = {
            classification: candidate.classification,
            clinicalSummaryEn:
              typeof candidate.clinicalSummaryEn === 'string' && candidate.clinicalSummaryEn.trim()
                ? candidate.clinicalSummaryEn.trim()
                : parsed.clinicalSummaryEn,
            replyNative:
              typeof candReply === 'string' && candReply.trim()
                ? candReply.trim()
                : parsed.replyNative,
          };
        }
      } catch {
        // Keep conservative emergency fallback if JSON parse fails
      }
    }

    const sanitizedReply = sanitizeClosingReply(parsed.replyNative);

    traces.push({
      model: 'sarvam-105b-conversations',
      endpoint: 'POST /v1/chat/completions',
      latencyMs: Date.now() - chatStart,
      detail: `Classified (${langCode}) -> ${parsed.classification}`,
    });

    const tts = await synthesizeSpeech(sanitizedReply, langCode);
    traces.push(tts.trace);

    return {
      elderLang: langCode,
      elderLangLabel: `${prof.nativeName} (${prof.nameEn})`,
      transcriptEn: trRes.translatedText,
      classification: parsed.classification,
      clinicalSummaryEn: parsed.clinicalSummaryEn,
      replyMl: sanitizedReply,
      replyAudioBase64: tts.audioBase64,
      traces,
    };
  } catch {
    const isSafe = prof.safeRegex.test(cleaned);
    const classification: 'SAFE' | 'EMERGENCY' = isSafe ? 'SAFE' : 'EMERGENCY';
    const replyNative = sanitizeClosingReply(
      classification === 'SAFE' ? prof.safeFallbackReply : prof.emergencyFallbackReply
    );

    traces.push({
      model: 'OFFLINE-FALLBACK',
      endpoint: 'LOCAL RULE ENGINE',
      latencyMs: 0,
      detail: `Network timeout — local ${prof.nameEn} phrase fallback`,
    });

    return {
      elderLang: langCode,
      elderLangLabel: `${prof.nativeName} (${prof.nameEn})`,
      transcriptEn:
        classification === 'SAFE'
          ? `[Offline fallback: Resident confirmed safety in ${prof.nameEn}]`
          : `[Offline fallback — ${prof.nameEn} speech: "${cleaned}"]`,
      classification,
      clinicalSummaryEn:
        classification === 'SAFE'
          ? `Offline fallback: Resident confirmed safety in ${prof.nameEn}.`
          : `Offline fallback after ${params.trigger.replaceAll('_', ' ').toLowerCase()} at ${params.distanceMeters.toFixed(2)}m. Precautionary family alert triggered.`,
      replyMl: replyNative,
      replyAudioBase64: ttsCache[`${langCode}::${replyNative}`] || '',
      traces,
      offlineFallback: true,
    };
  }
}

export async function synthesizeCaregiverBridge(
  inputText: string,
  sourceLang: IndianLangCode,
  targetElderLang: IndianLangCode = 'ml-IN'
): Promise<{
  spokenMalayalam: string;
  targetLang: IndianLangCode;
  audioBase64: string;
  traces: SarvamTraceStep[];
}> {
  const resolvedSource = resolveLangCode(sourceLang);
  const resolvedTarget = resolveLangCode(targetElderLang);
  const targetProf = BHARAT_LANGUAGES[resolvedTarget];
  const defaultReassurance = targetProf.defaultCaregiverReassurance;

  if (sarvamStats.creditGuardLocked) {
    return {
      spokenMalayalam: defaultReassurance,
      targetLang: resolvedTarget,
      audioBase64:
        ttsCache[`${resolvedTarget}::${defaultReassurance}`] ||
        (resolvedTarget === 'ml-IN' ? Object.values(ttsCache)[0] || '' : ''),
      traces: [
        {
          model: 'CREDIT-GUARD',
          endpoint: 'LOCAL BYPASS (0 credits)',
          latencyMs: 0,
          detail: `Simulated ${targetProf.nameEn} (${resolvedTarget}) caregiver bridge while Credit Guard is locked`,
        },
      ],
    };
  }

  const traces: SarvamTraceStep[] = [];
  const cleanedInput = inputText.trim();
  let spokenNative = cleanedInput || defaultReassurance;

  if (cleanedInput && resolvedSource !== resolvedTarget) {
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
          source_language_code: resolvedSource,
          target_language_code: resolvedTarget,
          model: 'sarvam-translate:v1',
        }),
      });

      if (!res.ok) {
        throw new Error(`Sarvam Translate HTTP ${res.status}: ${await res.text()}`);
      }

      const json = (await res.json()) as { translated_text?: string };
      recordCall('sarvam-translate:v1');
      spokenNative = (json.translated_text || '').trim() || defaultReassurance;
      traces.push({
        model: 'sarvam-translate:v1',
        endpoint: 'POST /translate',
        latencyMs: Date.now() - t0,
        detail: `${resolvedSource} -> ${resolvedTarget} ("${spokenNative.slice(0, 64)}")`,
      });
    } catch {
      spokenNative = defaultReassurance;
      traces.push({
        model: 'OFFLINE-FALLBACK',
        endpoint: 'LOCAL RULE ENGINE',
        latencyMs: Date.now() - t0,
        detail: `Network timeout — local ${targetProf.nameEn} caregiver reassurance`,
      });
    }
  }

  let audioBase64 = '';
  try {
    const tts = await synthesizeSpeech(spokenNative, resolvedTarget);
    audioBase64 = tts.audioBase64;
    traces.push(tts.trace);
  } catch {
    audioBase64 = ttsCache[`${resolvedTarget}::${spokenNative}`] || '';
    traces.push({
      model: 'OFFLINE-FALLBACK',
      endpoint: 'LOCAL CACHE',
      latencyMs: 0,
      detail: `Network timeout — served cached ${targetProf.nameEn} audio`,
    });
  }

  return {
    spokenMalayalam: spokenNative,
    targetLang: resolvedTarget,
    audioBase64,
    traces,
  };
}

export async function warmPromptCache(): Promise<void> {
  for (const text of Object.values(BHARAT_LANGUAGES['ml-IN'].prompts)) {
    try {
      await synthesizeSpeech(text, 'ml-IN');
    } catch (err) {
      console.warn('[kaaval] Prompt pre-warm skipped:', (err as Error).message);
    }
  }
}
