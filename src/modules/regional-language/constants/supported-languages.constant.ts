export type SupportedLanguageCode =
  | 'en'
  | 'kn'
  | 'hi'
  | 'ta'
  | 'te'
  | 'mr'
  | 'ml'
  | 'bn'
  | 'gu';

export const MANDATORY_LANGUAGE_CODES: SupportedLanguageCode[] = [
  'en',
  'kn',
  'hi',
  'ta',
  'te',
  'mr',
  'ml',
  'bn',
  'gu',
];

export interface SupportedLanguageMeta {
  code: SupportedLanguageCode;
  name: string;
  nativeName: string;
  description?: string;
  displayOrder: number;
}

export const SUPPORTED_NINE_REGIONAL_LANGUAGES: SupportedLanguageMeta[] = [
  {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    description: 'Universal default language',
    displayOrder: 1,
  },
  {
    code: 'kn',
    name: 'Kannada',
    nativeName: 'ಕನ್ನಡ',
    description: 'Regional language of Karnataka',
    displayOrder: 2,
  },
  {
    code: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    description: 'National language (Devanagari)',
    displayOrder: 3,
  },
  {
    code: 'ta',
    name: 'Tamil',
    nativeName: 'தமிழ்',
    description: 'Regional language of Tamil Nadu',
    displayOrder: 4,
  },
  {
    code: 'te',
    name: 'Telugu',
    nativeName: 'తెలుగు',
    description: 'Regional language of Andhra Pradesh & Telangana',
    displayOrder: 5,
  },
  {
    code: 'mr',
    name: 'Marathi',
    nativeName: 'मराठी',
    description: 'Regional language of Maharashtra',
    displayOrder: 6,
  },
  {
    code: 'ml',
    name: 'Malayalam',
    nativeName: 'മലയാളം',
    description: 'Regional language of Kerala',
    displayOrder: 7,
  },
  {
    code: 'bn',
    name: 'Bengali',
    nativeName: 'বাংলা',
    description: 'Regional language of West Bengal',
    displayOrder: 8,
  },
  {
    code: 'gu',
    name: 'Gujarati',
    nativeName: 'ગુજરાતી',
    description: 'Regional language of Gujarat',
    displayOrder: 9,
  },
];
