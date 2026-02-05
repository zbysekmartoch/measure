/**
 * Settings Tab
 * User preferences including language selection and UI options
 */
import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useSettings } from '../context/SettingsContext';
import LanguageSelector from '../components/LanguageSelector';

export default function SettingsTab() {
  const { t } = useLanguage();
  const { showAdvancedUI, setShowAdvancedUI } = useSettings();

  return (
    <div style={{ padding: 20, maxWidth: 500 }}>
      <h2 style={{ marginBottom: 24, color: '#111827' }}>{t('tabSettings')}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <LanguageSelector />
        
        <div style={{
          padding: 16,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: '#fff'
        }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: 'pointer'
          }}>
            <input
              type="checkbox"
              checked={showAdvancedUI}
              onChange={(e) => setShowAdvancedUI(e.target.checked)}
              style={{
                width: 18,
                height: 18,
                cursor: 'pointer'
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 500, fontSize: 14 }}>
                {t('showAdvancedUI')}
              </span>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {t('showAdvancedUIDescription')}
              </span>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}