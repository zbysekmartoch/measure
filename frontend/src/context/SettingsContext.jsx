/**
 * Settings Context Provider
 * Manages application-wide user preferences and settings.
 * Settings are persisted to localStorage.
 */
import React, { createContext, useContext, useState, useEffect } from 'react';

const SettingsContext = createContext();

export function SettingsProvider({ children }) {
  const [compactButtons, setCompactButtons] = useState(() => {
    const saved = localStorage.getItem('compactButtons');
    return saved ? JSON.parse(saved) : true;
  });

  const [doubleShiftActivation, setDoubleShiftActivation] = useState(() => {
    const saved = localStorage.getItem('doubleShiftActivation');
    return saved ? JSON.parse(saved) : true;
  });

  const [focusedMode, setFocusedMode] = useState(() => {
    const saved = localStorage.getItem('focusedMode');
    return saved ? JSON.parse(saved) : false;
  });

  useEffect(() => {
    localStorage.setItem('compactButtons', JSON.stringify(compactButtons));
  }, [compactButtons]);

  useEffect(() => {
    localStorage.setItem('doubleShiftActivation', JSON.stringify(doubleShiftActivation));
  }, [doubleShiftActivation]);

  useEffect(() => {
    localStorage.setItem('focusedMode', JSON.stringify(focusedMode));
  }, [focusedMode]);

  return (
    <SettingsContext.Provider value={{
      compactButtons,
      setCompactButtons,
      doubleShiftActivation,
      setDoubleShiftActivation,
      focusedMode,
      setFocusedMode,
    }}>
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
