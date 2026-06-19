import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en/translation.json';
import ja from './locales/ja/translation.json';
import zh from './locales/zh/translation.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, ja: { translation: ja }, zh: { translation: zh } },
    fallbackLng: 'en',
    supportedLngs: ['en', 'ja', 'zh'],
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'welmes-lang',
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
