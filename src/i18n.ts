import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en/translation.json';
import ja from './locales/ja/translation.json';
import zh from './locales/zh/translation.json';
import ko from './locales/ko/translation.json';
import es from './locales/es/translation.json';
import fr from './locales/fr/translation.json';
import de from './locales/de/translation.json';
import vi from './locales/vi/translation.json';
import th from './locales/th/translation.json';
import id from './locales/id/translation.json';
import ru from './locales/ru/translation.json';

// Keeps <html lang> in step with the UI language so :lang(ko) typography rules apply
i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
});

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ja: { translation: ja },
      zh: { translation: zh },
      ko: { translation: ko },
      es: { translation: es },
      fr: { translation: fr },
      de: { translation: de },
      vi: { translation: vi },
      th: { translation: th },
      id: { translation: id },
      ru: { translation: ru },
    },
    fallbackLng: 'en',
    lng: 'en',
    supportedLngs: ['en', 'ja', 'zh', 'ko', 'es', 'fr', 'de', 'vi', 'th', 'id', 'ru'],
    interpolation: { escapeValue: false },
  });

export function startClientLanguageDetection(): void {
  if (typeof window === 'undefined') return;
  const supported = new Set(['en', 'ja', 'zh', 'ko', 'es', 'fr', 'de', 'vi', 'th', 'id', 'ru']);
  const stored = window.localStorage.getItem('welmes-lang') || '';
  const browser = window.navigator.language.split('-')[0];
  const language = supported.has(stored) ? stored : supported.has(browser) ? browser : 'en';
  if (language !== i18n.language) void i18n.changeLanguage(language);
}

export default i18n;
