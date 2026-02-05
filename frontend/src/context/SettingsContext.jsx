/**
 * Settings Context Provider
 * Manages application-wide user preferences and settings.
 * Currently handles the advanced UI toggle for showing/hiding advanced features.
 * Settings are persisted to localStorage.
 */
import React, { createContext, useContext, useState, useEffect } from 'react';

const SettingsContext = createContext();

export function SettingsProvider({ children }) {
  const [showAdvancedUI, setShowAdvancedUI] = useState(() => {
    const saved = localStorage.getItem('showAdvancedUI');
    return saved ? JSON.parse(saved) : false;
  });

  useEffect(() => {
    localStorage.setItem('showAdvancedUI', JSON.stringify(showAdvancedUI));
  }, [showAdvancedUI]);

  return (
    <SettingsContext.Provider value={{ showAdvancedUI, setShowAdvancedUI }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
}
