/**
 * Analysis Definition Tab
 * Script file browser using FileManagerEditor component
 * Only visible in advanced UI mode
 */
import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import FileManagerEditor from '../components/FileManagerEditor.jsx';
import SqlEditorTab from './SqlEditorTab.jsx';

export default function AnalysisDefinitionTab() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState('files');

  const TabButton = ({ id, children }) => (
    <button
      onClick={() => setActiveTab(id)}
      style={{
        padding: '8px 12px',
        border: '1px solid #012345',
        borderBottom: 'none',
        marginBottom: activeTab === id ? -1 : 0,
        borderTopLeftRadius: 8,
        borderTopRightRadius: 8,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        background: activeTab === id ? '#fff' : '#f3f4f6',
        fontWeight: activeTab === id ? 600 : 400,
        color: '#111827',
        zIndex: activeTab === id ? 1 : 0
      }}
    >
      {children}
    </button>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <TabButton id="files">{t('analysisDefinitionFiles') || 'File editor'}</TabButton>
        <TabButton id="sql">{t('analysisDefinitionSql') || 'SQL editor'}</TabButton>
      </div>

      <div style={{ border: '1px solid #012345', padding: 10, background: '#fff', flex: 1, minHeight: 0, position: 'relative' }}>
        <div style={{ height: '100%', display: activeTab === 'files' ? 'block' : 'none' }}>
          <FileManagerEditor
            apiBasePath="/api/v1/scripts"
            showUpload={true}
            showDelete={true}
            readOnly={false}
            showModificationDate={true}
            title={t('scripts') || 'Skripty'}
            refreshTrigger={0}
          />
        </div>
        <div style={{ height: '100%', display: activeTab === 'sql' ? 'block' : 'none' }}>
          <SqlEditorTab />
        </div>
      </div>
    </div>
  );
}
