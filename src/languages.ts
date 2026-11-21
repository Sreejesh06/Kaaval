import type { IndianLangCode } from './types';

export interface ClientLangOption {
  code: IndianLangCode;
  nameEn: string;
  nativeName: string;
  speakHint: string;
}

export const INDIAN_LANGUAGES: ClientLangOption[] = [
  {
    code: 'ml-IN',
    nameEn: 'Malayalam',
    nativeName: 'മലയാളം',
    speakHint: 'മലയാളത്തിൽ മറുപടി പറയൂ...',
  },
  {
    code: 'ta-IN',
    nameEn: 'Tamil',
    nativeName: 'தமிழ்',
    speakHint: 'தமிழில் பதிலளிக்கவும்...',
  },
  {
    code: 'hi-IN',
    nameEn: 'Hindi',
    nativeName: 'हिन्दी',
    speakHint: 'कृपया हिंदी में जवाब दीजिए...',
  },
  {
    code: 'kn-IN',
    nameEn: 'Kannada',
    nativeName: 'ಕನ್ನಡ',
    speakHint: 'ದಯವಿಟ್ಟು ಕನ್ನಡದಲ್ಲಿ ಉತ್ತರಿಸಿ...',
  },
  {
    code: 'te-IN',
    nameEn: 'Telugu',
    nativeName: 'తెలుగు',
    speakHint: 'దయచేసి తెలుగులో సమాధానం చెప్పండి...',
  },
  {
    code: 'bn-IN',
    nameEn: 'Bengali',
    nativeName: 'বাংলা',
    speakHint: 'দয়া করে বাংলায় উত্তর দিন...',
  },
  {
    code: 'mr-IN',
    nameEn: 'Marathi',
    nativeName: 'मराठी',
    speakHint: 'कृपया मराठीत उत्तर द्या...',
  },
  {
    code: 'gu-IN',
    nameEn: 'Gujarati',
    nativeName: 'ગુજરાતી',
    speakHint: 'કૃપા કરીને ગુજરાતીમાં જવાબ આપો...',
  },
  {
    code: 'pa-IN',
    nameEn: 'Punjabi',
    nativeName: 'ਪੰਜਾਬੀ',
    speakHint: 'ਕਿਰਪਾ ਕਰਕੇ ਪੰਜਾਬੀ ਵਿੱਚ ਜਵਾਬ ਦਿਓ...',
  },
  {
    code: 'en-IN',
    nameEn: 'English',
    nativeName: 'English',
    speakHint: 'Please speak your response now...',
  },
];

export function getLangMeta(code?: IndianLangCode | string): ClientLangOption {
  return INDIAN_LANGUAGES.find((l) => l.code === code) || INDIAN_LANGUAGES[0];
}
