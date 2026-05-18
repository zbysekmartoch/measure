/**
 * Settings Tab
 * User preferences for UI behavior
 */
import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useSettings } from '../context/SettingsContext';

export default function SettingsTab() {
  const { t } = useLanguage();
  const {
    compactButtons,
    setCompactButtons,
    doubleShiftActivation,
    setDoubleShiftActivation,
  } = useSettings();

  return (
    <div style={{ padding: 20, maxWidth: 500 }}>
      <h2 style={{ marginBottom: 24, color: '#111827' }}>{t('tabSettings')}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
              checked={compactButtons}
              onChange={(e) => setCompactButtons(e.target.checked)}
              style={{
                width: 18,
                height: 18,
                cursor: 'pointer'
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 500, fontSize: 14 }}>
                {t('compactButtonsSetting') || 'Compact file buttons'}
              </span>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {t('compactButtonsSettingDescription') || 'Show file action buttons on hover only'}
              </span>
            </div>
          </label>
        </div>

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
              checked={doubleShiftActivation}
              onChange={(e) => setDoubleShiftActivation(e.target.checked)}
              style={{
                width: 18,
                height: 18,
                cursor: 'pointer'
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 500, fontSize: 14 }}>
                {t('doubleShiftActivation') || 'Enable double Shift keyboard menu trigger'}
              </span>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {t('doubleShiftActivationDescription') || 'When enabled, pressing Shift twice quickly opens the keyboard menu'}
              </span>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}