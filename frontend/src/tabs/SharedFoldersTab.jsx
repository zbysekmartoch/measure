/**
 * SharedFoldersTab — shows folders explicitly shared with the current user.
 * Folders are grouped by lab. Clicking a folder opens a read-only file browser.
 */
import React, { useState, useEffect, useCallback } from 'react';
import FileManagerEditor from '../components/FileManagerEditor.jsx';
import { fetchJSON } from '../lib/fetchJSON.js';

export default function SharedFoldersTab({ appConfig }) {
  const [sharedFolderGroups, setSharedFolderGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeBrowser, setActiveBrowser] = useState(null); // { labId, labName, folderPath }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJSON('/api/v1/labs/shared-folders');
      setSharedFolderGroups(data?.items || []);
    } catch {
      setSharedFolderGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div style={{ padding: 20, color: '#6b7280', fontSize: 13 }}>Loading…</div>;
  }

  if (sharedFolderGroups.length === 0) {
    return (
      <div style={{ padding: 20, color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>
        No folders have been shared with you.
      </div>
    );
  }

  // Strip 'scripts/' prefix to get path relative to scripts root
  const folderRelPath = (folderPath) =>
    folderPath.replace(/^scripts\//, '').replace(/^\/+/, '');

  if (activeBrowser) {
    const apiBasePath = `/api/v1/labs/${activeBrowser.labId}/scripts`;
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '6px 10px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => setActiveBrowser(null)}
            style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 12 }}
          >
            ← Back
          </button>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
            📁 {activeBrowser.labName} / {folderRelPath(activeBrowser.folderPath)}
          </span>
        </div>
        <div style={{ flex: 1, overflow: 'hidden', padding: 4 }}>
          <FileManagerEditor
            apiBasePath={apiBasePath}
            showModificationDate
            title={`${activeBrowser.labName} — ${folderRelPath(activeBrowser.folderPath)}`}
            csvPreviewMaxRows={appConfig?.csvPreviewMaxRows}
            previewMaxFileSize={appConfig?.previewMaxFileSize}
            pollingEnabled={false}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Shared folders</div>
        <button
          onClick={load}
          style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 12 }}
        >
          ↻ Refresh
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sharedFolderGroups.map(group => (
          <div key={group.labId} style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            {/* Lab header */}
            <div style={{ padding: '8px 12px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15 }}>🔬</span>
              <span style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>{group.labName}</span>
            </div>
            {/* Folder list */}
            <div>
              {(group.folders || []).map(folderPath => {
                const displayName = folderRelPath(folderPath);
                return (
                  <div
                    key={folderPath}
                    onClick={() => setActiveBrowser({ labId: group.labId, labName: group.labName, folderPath })}
                    style={{
                      padding: '8px 16px',
                      borderBottom: '1px solid #f3f4f6',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#eff6ff'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                  >
                    <span style={{ fontSize: 16 }}>📁</span>
                    <span style={{ fontSize: 13, color: '#374151' }}>{displayName}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>click to browse →</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
