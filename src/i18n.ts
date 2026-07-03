import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

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

i18n
  .use(LanguageDetector)
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
    supportedLngs: ['en', 'ja', 'zh', 'ko', 'es', 'fr', 'de', 'vi', 'th', 'id', 'ru'],
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'welmes-lang',
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
