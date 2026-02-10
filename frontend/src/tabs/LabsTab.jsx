/**
 * LabsTab — Lab browser + dynamic lab workspace sub-tabs.
 *
 * Sub-tabs:
 *   "My labs"      – list of owned labs, create/delete/edit/share
 *   "Shared labs"  – list of shared labs
 *   "🔬 <name>"    – open lab workspace (one per entered lab, closeable, can pop-out)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJSON } from '../lib/fetchJSON.js';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import LabWorkspaceTab from './LabWorkspaceTab.jsx';
import { icons, tabIcons } from '../lib/uiConfig.js';

export default function LabsTab() {
  const { user } = useAuth();
  const toast = useToast();

  // activeTab: 'mine' | 'shared' | 'lab:<id>'
  const [activeTab, setActiveTab] = useState('mine');

  // Open lab workspace tabs — array of lab metadata objects
  const [openLabs, setOpenLabs] = useState([]);

  // Data
  const [myLabs, setMyLabs] = useState([]);
  const [sharedLabs, setSharedLabs] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  // Selection & editing
  const [selectedLab, setSelectedLab] = useState(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // Create form
  const [newName, setNewName] = useState('');

  const currentList = useMemo(
    () => (activeTab === 'mine' ? myLabs : sharedLabs),
    [activeTab, myLabs, sharedLabs],
  );
  const showList = activeTab === 'mine' || activeTab === 'shared';

  // ---- data loading ----

  const loadLabs = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadLabs(); }, [loadLabs]);

  useEffect(() => {
    if (!selectedLab) return;
    setEditName(selectedLab.name || '');
    setEditDescription(selectedLab.description || '');
  }, [selectedLab]);

  useEffect(() => {
    fetchJSON('/api/v1/users')
      .then((data) => setUsers(data?.items || []))
      .catch(() => setUsers([]));
  }, []);

  // ---- lab tab management ----

  const openLab = useCallback((lab) => {
    setOpenLabs((prev) => (prev.some((l) => l.id === lab.id) ? prev : [...prev, lab]));
    setActiveTab(`lab:${lab.id}`);
  }, []);

  const closeLab = useCallback((labId) => {
    setOpenLabs((prev) => prev.filter((l) => l.id !== labId));
    setActiveTab((prev) => (prev === `lab:${labId}` ? 'mine' : prev));
  }, []);

  // When lab settings are saved from LabSettingsPane, update our copies
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
    const w = 1200;
    const h = 800;
    const left = Math.round((screen.width - w) / 2);
    const top = Math.round((screen.height - h) / 2);
    window.open(
      url.toString(),
      `lab_${labId}`,
      `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`,
    );
  }, []);

  // If URL has ?lab=<id>, auto-open that lab on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const labId = params.get('lab');
    if (!labId || params.get('standalone') === '1') return;
    fetchJSON(`/api/v1/labs/${labId}`)
      .then((lab) => openLab(lab))
      .catch(() => {});
  }, [openLab]);

  // ---- CRUD actions ----

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const lab = await fetchJSON('/api/v1/labs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, description: '' }),
      });
      setNewName('');
      setSelectedLab(lab);
      toast.success(`Lab "${lab.name}" created`);
      await loadLabs();
    } catch (e) {
      toast.error(e?.message || 'Failed to create lab');
    }
  };

  const handleRemove = async () => {
    if (!selectedLab) return;
    if (!confirm(`Delete lab "${selectedLab.name}"?`)) return;
    try {
      await fetchJSON(`/api/v1/labs/${selectedLab.id}`, { method: 'DELETE' });
      toast.success(`Lab "${selectedLab.name}" deleted`);
      // Close its workspace tab if open
      closeLab(selectedLab.id);
      setSelectedLab(null);
      await loadLabs();
    } catch (e) {
      toast.error(e?.message || 'Failed to remove lab');
    }
  };

  const handleSaveDetails = async () => {
    if (!selectedLab) return;
    try {
      const updated = await fetchJSON(`/api/v1/labs/${selectedLab.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, description: editDescription }),
      });
      setSelectedLab(updated);
      // Update the name in the open tab if present
      setOpenLabs((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      toast.success('Lab updated');
      await loadLabs();
    } catch (e) {
      toast.error(e?.message || 'Failed to update lab');
    }
  };

  const toggleShare = async (lab, targetUserId, isChecked) => {
    try {
      let updated;
      if (isChecked) {
        updated = await fetchJSON(`/api/v1/labs/${lab.id}/share`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: targetUserId }),
        });
      } else {
        updated = await fetchJSON(`/api/v1/labs/${lab.id}/share/${targetUserId}`, {
          method: 'DELETE',
        });
      }
      setSelectedLab(updated);
      await loadLabs();
    } catch (e) {
      toast.error(e?.message || 'Failed to update sharing');
    }
  };

  // ---- shared sub-tab button style ----

  const tabStyle = (isActive) => ({
    padding: '8px 12px',
    border: '1px solid #012345',
    borderBottom: 'none',
    marginBottom: isActive ? -1 : 0,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    background: isActive ? '#fff' : '#f3f4f6',
    fontWeight: isActive ? 600 : 400,
    color: '#111827',
    zIndex: isActive ? 1 : 0,
    cursor: 'pointer',
    outline: 'none',
  });

  // ---- render ----

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <button onClick={() => { setActiveTab('mine'); setSelectedLab(null); }} style={tabStyle(activeTab === 'mine')}>
          My labs
        </button>
        <button onClick={() => { setActiveTab('shared'); setSelectedLab(null); }} style={tabStyle(activeTab === 'shared')}>
          Shared labs
        </button>

        {/* Open lab workspace tabs */}
        {openLabs.map((lab) => {
          const isActive = activeTab === `lab:${lab.id}`;
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
              {/* Tab label */}
              <button
                onClick={() => setActiveTab(`lab:${lab.id}`)}
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

              {/* Pop-out button */}
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

              {/* Close button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!confirm(`Close lab "${lab.name}"?`)) return;
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
      </div>

      {/* Content area */}
      <div
        style={{
          border: '1px solid #012345',
          background: '#fff',
          flex: 1,
          minHeight: 0,
          position: 'relative',
        }}
      >
        {/* My labs / Shared labs browser */}
        {showList && (
          <div style={{ height: '100%', display: 'flex', gap: 16, padding: 12, overflow: 'hidden' }}>
            {/* Left column — lab list */}
            <div style={{ width: 340, display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
              {activeTab === 'mine' && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder="New lab name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    style={{ flex: 1, minWidth: 120, padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13 }}
                  />
                  <button className="btn btn-add" onClick={handleCreate} disabled={!newName.trim()}>
                    + Create
                  </button>
                  <button className="btn btn-delete" onClick={handleRemove} disabled={!selectedLab}>
                    − Delete
                  </button>
                </div>
              )}

              <div style={{ fontSize: 12, color: '#6b7280' }}>
                {loading ? 'Loading…' : `${currentList.length} lab${currentList.length !== 1 ? 's' : ''}`}
              </div>

              <div style={{ overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, flex: 1 }}>
                {currentList.length === 0 && !loading && (
                  <div style={{ padding: 16, color: '#9ca3af', textAlign: 'center', fontSize: 13 }}>
                    {activeTab === 'mine' ? 'No labs yet. Create one above.' : 'No shared labs.'}
                  </div>
                )}
                {currentList.map((lab) => (
                  <div
                    key={lab.id}
                    onClick={() => setSelectedLab(lab)}
                    onDoubleClick={() => openLab(lab)}
                    style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid #f3f4f6',
                      cursor: 'pointer',
                      background: selectedLab?.id === lab.id ? '#eff6ff' : '#fff',
                      transition: 'background 0.1s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{lab.name}</span>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={(e) => { e.stopPropagation(); openLab(lab); }}
                      >
                        Enter {icons.enter}
                      </button>
                    </div>
                    {lab.description && (
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{lab.description}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Right column — detail / edit / sharing */}
            <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
              {selectedLab ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>Lab details</div>

                  {activeTab === 'mine' ? (
                    <>
                      <label style={{ fontSize: 12, color: '#6b7280' }}>Name</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        style={{ padding: 8, borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 14 }}
                      />
                      <label style={{ fontSize: 12, color: '#6b7280' }}>Description</label>
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        rows={3}
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
                            const checked =
                              Array.isArray(selectedLab.sharedWith) &&
                              selectedLab.sharedWith.map(String).includes(String(u.id));
                            return (
                              <label
                                key={u.id}
                                style={{ display: 'flex', gap: 8, padding: '6px 10px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', fontSize: 13 }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => toggleShare(selectedLab, u.id, e.target.checked)}
                                />
                                <span>{u.firstName} {u.lastName} ({u.email})</span>
                              </label>
                            );
                          })}
                          {users.filter((u) => String(u.id) !== String(user?.id)).length === 0 && (
                            <div style={{ padding: 12, color: '#9ca3af', fontSize: 13 }}>No other users.</div>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{selectedLab.name}</div>
                      <div style={{ color: '#6b7280', fontSize: 13 }}>{selectedLab.description || '—'}</div>
                      <button className="btn btn-primary" onClick={() => openLab(selectedLab)}>Enter {icons.enter}</button>
                    </>
                  )}
                </div>
              ) : (
                <div style={{ color: '#9ca3af', padding: 20 }}>Select a lab to view details, or double-click to enter.</div>
              )}
            </div>
          </div>
        )}

        {/* Open lab workspaces — rendered but hidden to preserve state */}
        {openLabs.map((lab) => (
          <div
            key={lab.id}
            style={{
              display: activeTab === `lab:${lab.id}` ? 'block' : 'none',
              height: '100%',
              padding: 4,
            }}
          >
            <LabWorkspaceTab lab={lab} onLabUpdate={handleLabUpdate} />
          </div>
        ))}
      </div>
    </div>
  );
}
