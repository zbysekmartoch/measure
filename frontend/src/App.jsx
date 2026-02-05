/**
 * Main Application Component
 * 
 * This is the root component that sets up:
 * - Context providers (Language, Settings, Auth)
 * - Tab-based navigation with persistent state
 * - Health info display from backend API
 * - User authentication handling
 */
import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { SettingsProvider, useSettings } from './context/SettingsContext';
import AuthPage from './components/AuthPage';
import { ToastProvider } from './components/Toast';
import AnalysesTab from './tabs/AnalysesTab.jsx';
import ResultsTab from './tabs/ResultsTab';
import DebugTab from './tabs/DebugTab';
import SettingsTab from './tabs/SettingsTab';

/**
 * Main application content displayed after authentication
 * Uses CSS display:none for tab switching to preserve component state
 */
function AppContent() {
  const [tab, setTab] = useState('analytika');
  const [healthInfo, setHealthInfo] = useState(null);
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const { showAdvancedUI } = useSettings();

  // Load backend health info on mount
  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then(data => setHealthInfo(data))
      .catch(err => console.error('Failed to load health info:', err));
  }, []);

  // Reusable tab button component
  const TabButton = ({ id, children }) => (
    <button
      onClick={() => setTab(id)}
      style={{
        padding: '8px 12px',
        border: '1px solid #012345',
        borderBottom: 'none',
        //borderBottom: tab === id ? 'none' : '1px solid #012345',
        marginBottom: tab === id ? -1 : 0,
        borderTopLeftRadius: 8,
        borderTopRightRadius: 8,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        background: tab === id ? '#fff' : '#f3f4f6',
        fontWeight: tab === id ? 600 : 400,
        color: '#111827',
        zIndex: tab === id ? 1 : 0
      }}
    >
      {children}
    </button>
  );

  return (
    <div style={{ height: '100vh', width: '100vw', boxSizing: 'border-box', padding: 12, background: '#fff' }}>
      {/* Header with app title, health info, and user controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <img
          src="/measure-logo.png"
          alt={t('appTitle')}
          style={{ height: 28, width: 'auto', display: 'block' }}
        />
          {healthInfo && (
            <div style={{ fontSize: 11, color: '#6b7280', display: 'flex', gap: 12 }}>
              <span title="Backend Server">
                🖥️ {healthInfo.server?.host}:{healthInfo.server?.port}
              </span>
              <span title="Database">
                🗄️ {healthInfo.database?.host} / {healthInfo.database?.name}
              </span>
              <span title="Version">
                📦 v{healthInfo.version}
              </span>
            </div>
          )}        
        
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>{t('loggedInAs')} {user.firstName} {user.lastName}</span>
            <button
              className="btn btn-logout"
              onClick={logout}
            >
              {t('logout')}
            </button>
          </div>

        </div>

      </div>

      {/* Tab navigation bar */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <TabButton id="analytika">{t('tabAnalyses')}</TabButton>
          <TabButton id="vysledky">{t('tabResults')}</TabButton>
          {showAdvancedUI && <TabButton id="debug">{t('tabDebug')}</TabButton>}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex' }}>
          <TabButton id="nastaveni">{t('tabSettings')}</TabButton>
        </div>
      </div>

      {/* 
        Tab content wrapper - All tabs are rendered simultaneously but hidden when inactive.
        This preserves component state (selections, filters, scroll position) when switching tabs.
        Using display:none instead of conditional rendering to maintain state.
      */}
      <div style={{ border: '1px solid #012345', padding: 10, background: '#fff', height: 'calc(100vh - 130px)', position: 'relative' }}>
        <div style={{ display: tab === 'analytika' ? 'block' : 'none', height: '100%' }}>
          <AnalysesTab />
        </div>
        <div style={{ display: tab === 'vysledky' ? 'block' : 'none', height: '100%' }}>
          <ResultsTab />
        </div>
        {showAdvancedUI && (
          <div style={{ display: tab === 'debug' ? 'block' : 'none', height: '100%' }}>
            <DebugTab />
          </div>
        )}
        <div style={{ display: tab === 'nastaveni' ? 'block' : 'none', height: '100%' }}>
          <SettingsTab />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <SettingsProvider>
        <AuthProvider>
          <ToastProvider>
            <AuthApp />
          </ToastProvider>
        </AuthProvider>
      </SettingsProvider>
    </LanguageProvider>
  );
}

function AuthApp() {
  const { isAuthenticated } = useAuth();
  
  if (!isAuthenticated) {
    return <AuthPage />;
  }
  
  return <AppContent />;
}
