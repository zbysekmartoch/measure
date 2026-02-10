/**
 * LabSettingsPane — "Settings" sub-tab of a lab workspace.
 *
 * Allows editing lab metadata: name, description, sharing.
 *
 * Props:
 *   lab        – lab metadata { id, name, description, ownerId, sharedWith, … }
 *   onLabUpdate – callback(updatedLab) when lab metadata changes
 */
import React, { useCallback, useEffect, useState } from 'react';
import { fetchJSON } from '../lib/fetchJSON.js';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { shadow } from '../lib/uiConfig.js';

export default function LabSettingsPane({ lab, onLabUpdate }) {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();

  const [name, setName] = useState(lab.name || '');
  const [description, setDescription] = useState(lab.description || '');
  const [backupFrequency, setBackupFrequency] = useState(lab.backupFrequency || null);
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [users, setUsers] = useState([]);
  const [labSize, setLabSize] = useState(null);

  // Sync from prop when lab changes externally
  useEffect(() => {
    setName(lab.name || '');
    setDescription(lab.description || '');
    setBackupFrequency(lab.backupFrequency || null);
  }, [lab.name, lab.description, lab.backupFrequency]);

  // Load all users for sharing checkboxes
  useEffect(() => {
    fetchJSON('/api/v1/users')
      .then((data) => setUsers(data?.items || []))
      .catch(() => setUsers([]));
  }, []);

  // Load lab size
  useEffect(() => {
    setLabSize(null);
    fetchJSON(`/api/v1/labs/${lab.id}/size`)
      .then((data) => setLabSize(data?.sizeBytes ?? null))
      .catch(() => setLabSize(null));
  }, [lab.id]);

  const dirty = name !== (lab.name || '') || description !== (lab.description || '') || backupFrequency !== (lab.backupFrequency || null);

  // ---- Save ----
  const handleSave = useCallback(async () => {
    if (!name.trim()) { toast.error('Name must not be empty'); return; }
    try {
      setSaving(true);
      const updated = await fetchJSON(`/api/v1/labs/${lab.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), backupFrequency }),
      });
      toast.success(t('labSaved') || 'Lab saved');
      onLabUpdate?.(updated);
    } catch (err) {
      toast.error(`${t('errorSavingLab') || 'Error saving'}: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  }, [lab.id, name, description, backupFrequency, t, toast, onLabUpdate]);

  // ---- Manual backup ----
  const handleBackup = useCallback(async () => {
    try {
      setBackingUp(true);
      const result = await fetchJSON(`/api/v1/labs/${lab.id}/backup`, { method: 'POST' });
      if (result?.skipped) {
        toast.info('Backup skipped — no changes since last backup');
      } else {
        toast.success('Backup created successfully');
      }
    } catch (err) {
      toast.error(`Backup failed: ${err.message || err}`);
    } finally {
      setBackingUp(false);
    }
  }, [lab.id, toast]);

  // ---- Share (toggle) ----
  const toggleShare = useCallback(async (targetUserId, isChecked) => {
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
      onLabUpdate?.(updated);
    } catch (err) {
      toast.error(`Error: ${err.message || err}`);
    }
  }, [lab.id, toast, onLabUpdate]);

  const fieldStyle = {
    width: '100%', padding: '8px 12px', border: '1px solid #d1d5db',
    borderRadius: 6, fontSize: 14, background: '#fff',
  };

  const formatDate = (s) => {
    if (!s) return '-';
    try { return new Date(s).toLocaleString('en-US'); } catch { return s; }
  };

  const formatSize = (bytes) => {
    if (bytes == null) return '…';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>⚙️ {t('labSettings') || 'Lab settings'}</h2>

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40 }}>
        {/* ──── Left column: name, description, save, info ──── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Name */}
          <div>
            <label style={{ fontWeight: 500, display: 'block', marginBottom: 4 }}>{t('name') || 'Name'}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} />
          </div>

          {/* Description */}
          <div>
            <label style={{ fontWeight: 500, display: 'block', marginBottom: 4 }}>{t('description') || 'Description'}</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} style={{ ...fieldStyle, resize: 'vertical' }} />
          </div>

          {/* Save */}
          <div>
            <button
              className="btn btn-add"
              onClick={handleSave}
              disabled={!dirty || saving}
              style={{ padding: '8px 20px', boxShadow: dirty && !saving ? shadow.normal : 'none' }}
            >
              {saving ? '⏳' : '💾'} {t('save') || 'Save'}
            </button>
          </div>

          {/* Info */}
          <div style={{ fontSize: 13, color: '#6b7280', display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', borderTop: '1px solid #e5e7eb' }}>
            <span>ID: {lab.id}</span>
            <span>Owner: #{lab.ownerId}</span>
            <span>Created: {formatDate(lab.createdAt)}</span>
            <span>Updated: {formatDate(lab.updatedAt)}</span>
            <span>📦 Size: <strong>{formatSize(labSize)}</strong></span>
          </div>
        </div>

        {/* ──── Right column: sharing ──── */}
        <div>
          <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 600 }}>👥 {t('sharing') || 'Sharing'}</h3>

          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'auto', maxHeight: 480 }}>
            {users.filter((u) => String(u.id) !== String(user?.id)).map((u) => {
              const checked =
                Array.isArray(lab.sharedWith) &&
                lab.sharedWith.map(String).includes(String(u.id));
              return (
                <label
                  key={u.id}
                  style={{ display: 'flex', gap: 8, padding: '6px 10px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', fontSize: 13, alignItems: 'center' }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleShare(u.id, e.target.checked)}
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
      </div>

      {/* Backup — full width below the grid */}
      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600 }}>💾 Backup</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            Frequency:
            <select
              value={backupFrequency || ''}
              onChange={(e) => setBackupFrequency(e.target.value || null)}
              style={{ ...fieldStyle, width: 'auto', padding: '4px 8px', fontSize: 13 }}
            >
              <option value="">Disabled</option>
              <option value="manual">Manual only</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <button
            className="btn btn-primary"
            onClick={handleBackup}
            disabled={backingUp}
            style={{ padding: '6px 16px', fontSize: 13 }}
          >
            {backingUp ? '⏳ Backing up…' : '📦 Backup now'}
          </button>
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#9ca3af' }}>
          Duplicate backups (identical content) are automatically skipped.
        </p>
      </div>
    </div>
  );
}
