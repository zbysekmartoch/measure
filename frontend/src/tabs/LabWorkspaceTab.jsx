/**
 * LabWorkspaceTab — workspace for a single lab.
 *
 * Three main sub-tabs:
 *   📜 Scripts  — file browser + inline editors for lab scripts
 *   📊 Results  — result picker + file browser for result files
 *   ⚙️ Settings — lab name, description, sharing
 *
 * Props:
 *   lab         – lab metadata object { id, name, description, … }
 *   onLabUpdate – callback(updatedLab) when settings change
 */
import React, { useState } from 'react';
import LabScriptsPane from './LabScriptsPane.jsx';
import LabResultsPane from './LabResultsPane.jsx';
import LabSettingsPane from './LabSettingsPane.jsx';

const TABS = [
  { key: 'scripts',  icon: '📜', label: 'Scripts' },
  { key: 'results',  icon: '📊', label: 'Results' },
  { key: 'settings', icon: '⚙️', label: 'Settings' },
];

export default function LabWorkspaceTab({ lab, onLabUpdate }) {
  const [activeTab, setActiveTab] = useState('scripts');

  const tabStyle = (isActive) => ({
    padding: '7px 14px',
    border: '1px solid #012345',
    borderBottom: 'none',
    marginBottom: isActive ? -1 : 0,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    background: isActive ? '#fff' : '#f3f4f6',
    fontWeight: isActive ? 600 : 400,
    color: '#111827',
    zIndex: isActive ? 1 : 0,
    cursor: 'pointer',
    fontSize: 13,
    outline: 'none',
  });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Main sub-tab bar */}
      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', marginTop: 2 }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              ...tabStyle(activeTab === tab.key),
              ...(tab.key === 'settings' ? { marginLeft: 'auto' } : {}),
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div style={{ border: '1px solid #012345', background: '#fff', flex: 1, minHeight: 0, position: 'relative' }}>
        <div style={{ height: '100%', display: activeTab === 'scripts'  ? 'flex' : 'none', flexDirection: 'column', padding: 6 }}>
          <LabScriptsPane lab={lab} />
        </div>
        <div style={{ height: '100%', display: activeTab === 'results'  ? 'flex' : 'none', flexDirection: 'column', padding: 6 }}>
          <LabResultsPane lab={lab} />
        </div>
        <div style={{ height: '100%', display: activeTab === 'settings' ? 'block' : 'none', overflow: 'auto' }}>
          <LabSettingsPane lab={lab} onLabUpdate={onLabUpdate} />
        </div>
      </div>
    </div>
  );
}
