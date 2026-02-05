import React from 'react';
import { useLanguage } from '../context/LanguageContext';

export default function LanguageSelector() {
  const { language, changeLanguage, t } = useLanguage();

  const languages = [
    { code: 'cz', name: t('czech'), flag: '🇨🇿' },
    { code: 'sk', name: t('slovak'), flag: '🇸🇰' },
    { code: 'en', name: t('english'), flag: '🇬🇧' }, // nebo 🇺🇸 pro americkou vlajku
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ fontWeight: 600, color: '#374151' }}>{t('language')}</label>
      <select
        value={language}
        onChange={(e) => changeLanguage(e.target.value)}
        style={{
          padding: 8,
          border: '1px solid #d1d5db',
          borderRadius: 4,
          background: 'white',
          fontSize: 14
        }}
      >
        {languages.map(lang => (
          <option key={lang.code} value={lang.code}>
            {lang.flag} {lang.name}
          </option>
        ))}
      </select>
    </div>
  );
}