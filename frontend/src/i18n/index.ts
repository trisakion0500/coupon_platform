import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ko from '@/locales/ko/common.json';
import en from '@/locales/en/common.json';

export const SUPPORTED_LANGUAGES = ['ko', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = 'coupon-platform-lang';

function readStoredLanguage(): SupportedLanguage {
  const stored = localStorage.getItem(STORAGE_KEY);
  return SUPPORTED_LANGUAGES.includes(stored as SupportedLanguage)
    ? (stored as SupportedLanguage)
    : 'ko';
}

/**
 * 프론트엔드 UI 문자열만 다국어화 대상이다 — 백엔드 API 에러 메시지(`result-code.enum.ts`
 * 등)는 한글로 유지하기로 했으므로(2026-07-24), 서버가 내려준 `message`는 그대로 쓰지 않고
 * `result` 코드를 키로 여기서 직접 번역한다(`api/errors.ts` 참고).
 */
void i18n.use(initReactI18next).init({
  resources: {
    ko: { common: ko },
    en: { common: en },
  },
  lng: readStoredLanguage(),
  fallbackLng: 'ko',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: SupportedLanguage): void {
  localStorage.setItem(STORAGE_KEY, lang);
  void i18n.changeLanguage(lang);
}

export default i18n;
