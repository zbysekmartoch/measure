/**
 * Main Application Component
 * 
 * This is the root component that sets up:
 * - Context providers (Language, Settings, Auth)
 * - Tab-based navigation with persistent state
 * - Health info display from backend API
 * - User authentication handling
 *
 * Lab workspace tabs are promoted to the top-level tab bar.
 * Standalone mode (?lab=<id>&standalone=1) renders only the lab workspace.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { SettingsProvider } from './context/SettingsContext';
import AuthPage from './components/AuthPage';
import { ToastProvider, useToast } from './components/Toast';
import { FileClipboardProvider } from './components/file-manager/ClipboardContext.jsx';
import SettingsTab from './tabs/SettingsTab';
import LabWorkspaceTab from './tabs/LabWorkspaceTab.jsx';
import { fetchJSON } from './lib/fetchJSON.js';
import { icons, tabIcons } from './lib/uiConfig.js';
import { hasDirtyFiles, hasDirtyFilesForLab } from './lib/dirtyRegistry.js';

/**
 * Standalone lab view — used when opened via popup window (?lab=<id>&standalone=1).
 * Shows only the lab workspace, no header or other tabs.
 */
function StandaloneLabView({ labId }) {
  const [lab, setLab] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchJSON(`/api/v1/labs/${labId}`)
      .then((data) => {
        setLab(data);
        document.title = `🔬 ${data.name} — Measure`;
      })
      .catch(() => setError('Lab not found or access denied.'));
  }, [labId]);

  if (error) return <div style={{ padding: 40, color: '#dc2626' }}>{error}</div>;
  if (!lab) return <div style={{ padding: 40, color: '#6b7280' }}>Loading lab…</div>;

  return (
    <div style={{ height: '100vh', width: '100vw', boxSizing: 'border-box', padding: 8, background: '#fff' }}>
      <LabWorkspaceTab lab={lab} />
    </div>
  );
}

/**
 * Main application content displayed after authentication.
 * Labs browser (My Labs / Shared Labs) + open lab tabs are all at the top level.
 */
function AppContent() {
  // tab: 'mine' | 'shared' | 'lab:<id>' | 'settings'
  const [tab, setTab] = useState('mine');
  const [healthInfo, setHealthInfo] = useState(null);
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const toast = useToast();

  // ---- Lab data ----
  const [openLabs, setOpenLabs] = useState([]);
  const [myLabs, setMyLabs] = useState([]);
  const [sharedLabs, setSharedLabs] = useState([]);
  const [users, setUsers] = useState([]);
  const [labsLoading, setLabsLoading] = useState(false);
  const [selectedLab, setSelectedLab] = useState(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [newName, setNewName] = useState('');

  // Check for standalone lab mode
  const params = new URLSearchParams(window.location.search);
  const standaloneLabId = params.get('standalone') === '1' ? params.get('lab') : null;

  // Load backend health info on mount
  useEffect(() => {
    if (standaloneLabId) return;
    fetch('/api/health')
      .then(res => res.json())
      .then(data => setHealthInfo(data))
      .catch(err => console.error('Failed to load health info:', err));
  }, [standaloneLabId]);

  // ---- Load labs ----
  const loadLabs = useCallback(async () => {
    setLabsLoading(true);
    try {
      const [mine, shared] = await Promise.all([
        fetchJSON('/api/v1/labs'),
        fetchJSON('/api/v1/labs/shared'),
      ]);
      setMyLabs(mine?.items || []);
      setSharedLabs(shared?.items || []);
    } catch (e) {
      toast.error(e?.message || 'Failed to load labs');
    } finally {
      setLabsLoading(false);
    }
  }, [toast]);

  useEffect(() => { if (!standaloneLabId) loadLabs(); }, [loadLabs, standaloneLabId]);
  useEffect(() => {
    if (selectedLab) { setEditName(selectedLab.name || ''); setEditDescription(selectedLab.description || ''); }
  }, [selectedLab]);
  useEffect(() => {
    if (!standaloneLabId) fetchJSON('/api/v1/users').then((data) => setUsers(data?.items || [])).catch(() => setUsers([]));
  }, [standaloneLabId]);

  // Warn before browser/tab close if there are unsaved files
  useEffect(() => {
    const handler = (e) => {
      if (hasDirtyFiles()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // ---- Lab tab management ----
  const openLab = useCallback((lab) => {
    setOpenLabs((prev) => (prev.some((l) => l.id === lab.id) ? prev : [...prev, lab]));
    setTab(`lab:${lab.id}`);
  }, []);

  const closeLab = useCallback((labId) => {
    setOpenLabs((prev) => prev.filter((l) => l.id !== labId));
    setTab((prev) => (prev === `lab:${labId}` ? 'mine' : prev));
  }, []);

  const handleLabUpdate = useCallback((updated) => {
    setOpenLabs((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
    setMyLabs((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
    setSharedLabs((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
    if (selectedLab?.id === updated.id) setSelectedLab({ ...selectedLab, ...updated });
  }, [selectedLab]);

  const popOutLab = useCallback((labId) => {
    const url = new URL(window.location.origin);
    url.searchParams.set('lab', labId);
    url.searchParams.set('standalone', '1');
    const w = 1200, h = 800;
    const left = Math.round((screen.width - w) / 2);
    const top = Math.round((screen.height - h) / 2);
    window.open(url.toString(), `lab_${labId}`, `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`);
  }, []);

  // If URL has ?lab=<id>, auto-open that lab on mount
  useEffect(() => {
    if (standaloneLabId) return;
    const p = new URLSearchParams(window.location.search);
    const labId = p.get('lab');
    if (!labId) return;
    fetchJSON(`/api/v1/labs/${labId}`).then((lab) => openLab(lab)).catch(() => {});
  }, [standaloneLabId, openLab]);

  // If standalone mode, render only the lab workspace
  if (standaloneLabId) {
    return <StandaloneLabView labId={standaloneLabId} />;
  }

  // ---- CRUD ----
  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const lab = await fetchJSON('/api/v1/labs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName, description: '' }) });
      setNewName(''); setSelectedLab(lab);
      toast.success(`Lab "${lab.name}" created`);
      await loadLabs();
    } catch (e) { toast.error(e?.message || 'Failed to create lab'); }
  };

  const handleRemove = async () => {
    if (!selectedLab) return;
    if (!confirm(`Delete lab "${selectedLab.name}"?`)) return;
    try {
      await fetchJSON(`/api/v1/labs/${selectedLab.id}`, { method: 'DELETE' });
      toast.success(`Lab "${selectedLab.name}" deleted`);
      closeLab(selectedLab.id); setSelectedLab(null);
      await loadLabs();
    } catch (e) { toast.error(e?.message || 'Failed to remove lab'); }
  };

  const handleSaveDetails = async () => {
    if (!selectedLab) return;
    try {
      const updated = await fetchJSON(`/api/v1/labs/${selectedLab.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editName, description: editDescription }) });
      setSelectedLab(updated);
      setOpenLabs((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      toast.success('Lab updated');
      await loadLabs();
    } catch (e) { toast.error(e?.message || 'Failed to update lab'); }
  };

  const handleClone = async (lab) => {
    try {
      const cloned = await fetchJSON(`/api/v1/labs/${lab.id}/clone`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      toast.success(`Lab "${cloned.name}" cloned`);
      await loadLabs();
      setSelectedLab(cloned);
    } catch (e) { toast.error(e?.message || 'Failed to clone lab'); }
  };

  const toggleShare = async (lab, targetUserId, isChecked) => {
    try {
      let updated;
      if (isChecked) {
        updated = await fetchJSON(`/api/v1/labs/${lab.id}/share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: targetUserId }) });
      } else {
        updated = await fetchJSON(`/api/v1/labs/${lab.id}/share/${targetUserId}`, { method: 'DELETE' });
      }
      setSelectedLab(updated);
      await loadLabs();
    } catch (e) { toast.error(e?.message || 'Failed to update sharing'); }
  };

  const currentList = (tab === 'mine' || tab === 'shared')
    ? [...(tab === 'mine' ? myLabs : sharedLabs)].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
    : [];
  const showList = tab === 'mine' || tab === 'shared';

  // Reusable tab button component
  const TabButton = ({ id, children, style: extraStyle }) => (
    <button
      onClick={() => setTab(id)}
      style={{
        padding: '8px 12px',
        border: '1px solid #012345',
        borderBottom: 'none',
        marginBottom: tab === id ? -1 : 0,
        borderTopLeftRadius: 8,
        borderTopRightRadius: 8,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        background: tab === id ? '#fff' : '#f3f4f6',
        fontWeight: tab === id ? 600 : 400,
        color: '#111827',
        zIndex: tab === id ? 1 : 0,
        cursor: 'pointer',
        outline: 'none',
        ...extraStyle,
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
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <TabButton id="mine">My labs</TabButton>
        <TabButton id="shared">Shared labs</TabButton>

        {/* Open lab workspace tabs */}
        {openLabs.map((lab) => {
          const isActive = tab === `lab:${lab.id}`;
          return (
            <span
              key={lab.id}
              style={{
                display: 'inline-flex',
                alignItems: 'stretch',
                marginBottom: isActive ? -1 : 0,
                zIndex: isActive ? 1 : 0,
              }}
            >
              <button
                onClick={() => setTab(`lab:${lab.id}`)}
                title={lab.name}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #012345',
                  borderBottom: 'none',
                  borderRight: 'none',
                  borderRadius: '8px 0 0 0',
                  background: isActive ? '#fff' : '#f3f4f6',
                  fontWeight: isActive ? 600 : 400,
                  color: '#111827',
                  maxWidth: 180,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  fontSize: 'inherit',
                  outline: 'none',
                }}
              >
                🔬 {lab.name}
              </button>
              <button
                onClick={() => popOutLab(lab.id)}
                title="Open in a separate window"
                style={{
                  padding: '4px 6px',
                  border: '1px solid #012345',
                  borderBottom: 'none',
                  borderLeft: 'none',
                  borderRight: 'none',
                  borderRadius: 0,
                  background: isActive ? '#fff' : '#f3f4f6',
                  cursor: 'pointer',
                  color: tabIcons.popOut.color,
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  outline: 'none',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = tabIcons.popOut.hoverColor; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = tabIcons.popOut.color; }}
              >
                {icons.popOut}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasDirtyFilesForLab(lab.id) && !confirm(`Lab "${lab.name}" has unsaved changes. Close anyway?`)) return;
                  closeLab(lab.id);
                }}
                title="Close"
                style={{
                  padding: '4px 6px',
                  border: '1px solid #012345',
                  borderBottom: 'none',
                  borderLeft: 'none',
                  borderRadius: '0 8px 0 0',
                  background: isActive ? '#fff' : '#f3f4f6',
                  cursor: 'pointer',
                  color: tabIcons.close.color,
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  outline: 'none',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = tabIcons.close.hoverColor; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = tabIcons.close.color; }}
              >
                ×
              </button>
            </span>
          );
        })}

        <div style={{ marginLeft: 'auto', display: 'flex' }}>
          <TabButton id="settings">{t('tabSettings')}</TabButton>
        </div>
      </div>

      {/* Content area */}
      <div style={{ border: '1px solid #012345', padding: 10, background: '#fff', height: 'calc(100vh - 130px)', position: 'relative' }}>

        {/* My labs / Shared labs browser */}
        {showList && (
          <div style={{ height: '100%', display: 'flex', gap: 16, padding: 2, overflow: 'hidden' }}>
            {/* Lab list column */}
            <div style={{ width: tab === 'shared' ? '100%' : 340, display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
              {tab === 'mine' && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder="New lab name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    style={{ flex: 1, minWidth: 120, padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13 }}
                  />
                  <button className="btn btn-add" onClick={handleCreate} disabled={!newName.trim()}>+ Create</button>
                  <button className="btn btn-delete" onClick={handleRemove} disabled={!selectedLab}>− Delete</button>
                </div>
              )}

              <div style={{ fontSize: 12, color: '#6b7280' }}>
                {labsLoading ? 'Loading…' : `${currentList.length} lab${currentList.length !== 1 ? 's' : ''}`}
              </div>

              <div style={{ overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, flex: 1 }}>
                {currentList.length === 0 && !labsLoading && (
                  <div style={{ padding: 16, color: '#9ca3af', textAlign: 'center', fontSize: 13 }}>
                    {tab === 'mine' ? 'No labs yet. Create one above.' : 'No shared labs.'}
                  </div>
                )}
                {currentList.map((lab) => (
                  <div
                    key={lab.id}
                    onClick={() => tab === 'mine' && setSelectedLab(lab)}
                    onDoubleClick={() => openLab(lab)}
                    style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid #f3f4f6',
                      cursor: 'pointer',
                      background: tab === 'mine' && selectedLab?.id === lab.id ? '#eff6ff' : '#fff',
                      transition: 'background 0.1s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{lab.name}</span>
                      {lab.description && tab === 'shared' && (
                        <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lab.description}</span>
                      )}
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={(e) => { e.stopPropagation(); handleClone(lab); }}
                          title="Clone lab"
                        >
                          📋 Clone
                        </button>
                        <button
                          className="btn btn-primary"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={(e) => { e.stopPropagation(); openLab(lab); }}
                        >
                          Enter {icons.enter}
                        </button>
                      </div>
                    </div>
                    {lab.description && tab === 'mine' && (
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{lab.description}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Right column — detail / edit / sharing (My Labs only) */}
            {tab === 'mine' && (
            <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
              {selectedLab ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>Lab details</div>

                      <label style={{ fontSize: 12, color: '#6b7280' }}>Name</label>
                      <input
                        type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                        style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 14 }}
                      />
                      <label style={{ fontSize: 12, color: '#6b7280' }}>Description</label>
                      <textarea
                        value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3}
                        style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13 }}
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-edit" onClick={handleSaveDetails}>Save</button>
                        <button className="btn btn-primary" onClick={() => openLab(selectedLab)}>Enter {icons.enter}</button>
                      </div>

                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Sharing</div>
                        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'auto', maxHeight: 220 }}>
                          {users.filter((u) => String(u.id) !== String(user?.id)).map((u) => {
                            const checked = Array.isArray(selectedLab.sharedWith) && selectedLab.sharedWith.map(String).includes(String(u.id));
                            return (
                              <label key={u.id} style={{ display: 'flex', gap: 8, padding: '6px 10px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', fontSize: 13 }}>
                                <input type="checkbox" checked={checked} onChange={(e) => toggleShare(selectedLab, u.id, e.target.checked)} />
                                <span>{u.firstName} {u.lastName} ({u.email})</span>
                              </label>
                            );
                          })}
                          {users.filter((u) => String(u.id) !== String(user?.id)).length === 0 && (
                            <div style={{ padding: 12, color: '#9ca3af', fontSize: 13 }}>No other users.</div>
                          )}
                        </div>
                      </div>
                </div>
              ) : (
                <div style={{ color: '#9ca3af', padding: 20 }}>Select a lab to view details, or double-click to enter.</div>
              )}
            </div>
            )}
          </div>
        )}

        {/* Open lab workspaces — rendered but hidden to preserve state */}
        {openLabs.map((lab) => (
          <div
            key={lab.id}
            style={{
              display: tab === `lab:${lab.id}` ? 'block' : 'none',
              height: '100%',
              padding: 4,
            }}
          >
            <LabWorkspaceTab lab={lab} onLabUpdate={handleLabUpdate} />
          </div>
        ))}

        <div style={{ display: tab === 'settings' ? 'block' : 'none', height: '100%' }}>
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
            <FileClipboardProvider>
              <AuthApp />
            </FileClipboardProvider>
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
