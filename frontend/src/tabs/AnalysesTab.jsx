/**
 * Analysis Tab Container
 * Main component with sub-tabs for analysis execution and definition
 */
import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useSettings } from '../context/SettingsContext';
import AnalysisExecutionTab from './AnalysisExecutionTab.jsx';
import AnalysisDefinitionTab from './AnalysisDefinitionTab.jsx';

// Main component with sub-tabs
export default function AnalysisTab() {
  const { t } = useLanguage();
  const { showAdvancedUI } = useSettings();
  const [activeSubTab, setActiveSubTab] = useState('execution'); // 'execution' | 'definition'

  const SubTabButton = ({ id, children }) => (
    <button
      onClick={() => setActiveSubTab(id)}
      style={{
        padding: '8px 12px',
        border: '1px solid #012345',
        borderBottom: 'none',
        //borderBottom: tab === id ? 'none' : '1px solid #012345',
        marginBottom: activeSubTab === id ? -1 : 0,
        borderTopLeftRadius: 8,
        borderTopRightRadius: 8,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        background: activeSubTab === id ? '#fff' : '#f3f4f6',
        fontWeight: activeSubTab === id ? 600 : 400,
        color: '#111827',
        zIndex: activeSubTab === id ? 1 : 0
      }}

    >
      {children}
    </button>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Sub-tabs navigation */}
      <div style={{ display: 'flex', gap: 8 }}>
        <SubTabButton id="execution">{t('analysisExecution')}</SubTabButton>
        {showAdvancedUI && (
          <SubTabButton id="definition">{t('analysisDefinition')}</SubTabButton>
        )}
      </div>

      {/* Sub-tabs content */}
      <div style={{ border: '1px solid #012345', padding: 10, background: '#fff', height: 'calc(100% - 60px)', position: 'relative' }}>
        {/* All tabs rendered but hidden to preserve state */}
        <div style={{ height: '100%', display: activeSubTab === 'execution' ? 'block' : 'none' }}>
          <AnalysisExecutionTab />
        </div>
        {showAdvancedUI && (
          <div style={{ height: '100%', display: activeSubTab === 'definition' ? 'block' : 'none' }}>
            <AnalysisDefinitionTab />
          </div>
        )}
      </div>
    </div>
  );
}

