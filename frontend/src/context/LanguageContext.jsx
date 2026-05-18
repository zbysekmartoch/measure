/**
 * Language Context Provider (English-only mode).
 *
 * i18n is intentionally disabled. The app always uses English strings,
 * but we keep the same context API (`useLanguage`) for compatibility.
 */
import React, { createContext, useCallback, useContext } from 'react';
import { translations } from '../i18n/translations.js';

const LanguageContext = createContext();

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
};

export const LanguageProvider = ({ children }) => {
  const language = 'en';

  const t = useCallback((key, params = {}) => {
    let text = translations.en?.[key] || key;

    // Interpolate parameters {param}
    if (params && typeof params === 'object') {
      Object.keys(params).forEach((param) => {
        text = text.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
      });
    }

    return text;
  }, []);

  // Kept as API-compatible no-op.
  const changeLanguage = useCallback(() => {}, []);

  return (
    <LanguageContext.Provider value={{ language, changeLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};