import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './locales/zh.json';
import en from './locales/en.json';

const STORED_LANG = (() => {
  try { return localStorage.getItem('language') || undefined; } catch { return undefined; }
})();

const browserLang = typeof navigator !== 'undefined'
  ? (navigator.language?.startsWith('zh') ? 'zh' : 'en')
  : 'zh';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    lng: STORED_LANG || browserLang,
    fallbackLng: 'zh',
    interpolation: { escapeValue: false },
  });

export function setLanguage(lang: 'zh' | 'en') {
  i18n.changeLanguage(lang);
  try {
    localStorage.setItem('language', lang);
  } catch {
    // The selected language remains active in memory when storage is unavailable.
  }
}

export default i18n;
