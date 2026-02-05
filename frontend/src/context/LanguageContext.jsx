/**
 * Language Context Provider
 * Provides internationalization (i18n) support for the application.
 * Handles language detection, storage, and translation functions.
 * Supports Czech (cz), Slovak (sk), and English (en) languages.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { translations } from '../i18n/translations.js';

const LanguageContext = createContext();

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
};

// Function for detecting browser language
const detectBrowserLanguage = () => {
  // Get browser language
  const browserLang = navigator.language || navigator.userLanguage;
  const langCode = browserLang.toLowerCase();
  
  // Map browser languages to our language codes
  if (langCode.startsWith('cs') || langCode.startsWith('cz')) return 'cz';
  if (langCode.startsWith('sk')) return 'sk';
  if (langCode.startsWith('en')) return 'en';
  
  // Fallback to English
  return 'en';
};

export const LanguageProvider = ({ children }) => {
  const [language, setLanguage] = useState(() => {
    // 1. Try to load from localStorage
    const savedLanguage = localStorage.getItem('language');
    if (savedLanguage && ['cz', 'sk', 'en'].includes(savedLanguage)) {
      return savedLanguage;
    }
    
    // 2. If not saved, detect from browser
    return detectBrowserLanguage();
  });

  useEffect(() => {
    localStorage.setItem('language', language);
  }, [language]);

  const t = (key, params = {}) => {
    let text = translations[language]?.[key] || translations.cz[key] || key;
    
    // Interpolate parameters {param}
    if (params && typeof params === 'object') {
      Object.keys(params).forEach(param => {
        text = text.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
      });
    }
    
    return text;
  };

  const changeLanguage = (newLanguage) => {
    setLanguage(newLanguage);
  };

  return (
    <LanguageContext.Provider value={{ language, changeLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};