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

export default function LabSettingsPane({ lab, onLabUpdate }) {
  const { t } = useLanguage();
  const toast = useToast();

  const [name, setName] = useState(lab.name || '');
  const [description, setDescription] = useState(lab.description || '');
  const [saving, setSaving] = useState(false);
  const [shareUserId, setShareUserId] = useState('');

  // Sync from prop when lab changes externally
  useEffect(() => {
    setName(lab.name || '');
    setDescription(lab.description || '');
  }, [lab.name, lab.description]);

  const dirty = name !== (lab.name || '') || description !== (lab.description || '');

  // ---- Save ----
  const handleSave = useCallback(async () => {
    if (!name.trim()) { toast.error('Název nesmí být prázdný'); return; }
    try {
      setSaving(true);
      const updated = await fetchJSON(`/api/v1/labs/${lab.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      toast.success(t('labSaved') || 'Laboratoř uložena');
      onLabUpdate?.(updated);
    } catch (err) {
      toast.error(`${t('errorSavingLab') || 'Chyba při ukládání'}: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  }, [lab.id, name, description, t, toast, onLabUpdate]);

  // ---- Share ----
  const handleShare = useCallback(async () => {
    if (!shareUserId.trim()) return;
    try {
      const updated = await fetchJSON(`/api/v1/labs/${lab.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: shareUserId.trim() }),
      });
      toast.success(`Sdíleno s uživatelem #${shareUserId}`);
      setShareUserId('');
      onLabUpdate?.(updated);
    } catch (err) {
      toast.error(`Chyba: ${err.message || err}`);
    }
  }, [lab.id, shareUserId, toast, onLabUpdate]);

  // ---- Unshare ----
  const handleUnshare = useCallback(async (userId) => {
    try {
      const updated = await fetchJSON(`/api/v1/labs/${lab.id}/share/${userId}`, { method: 'DELETE' });
      toast.success(`Sdílení s uživatelem #${userId} zrušeno`);
      onLabUpdate?.(updated);
    } catch (err) {
      toast.error(`Chyba: ${err.message || err}`);
    }
  }, [lab.id, toast, onLabUpdate]);

  const fieldStyle = {
    width: '100%', padding: '8px 12px', border: '1px solid #d1d5db',
    borderRadius: 6, fontSize: 14, background: '#fff',
  };

  const formatDate = (s) => {
    if (!s) return '-';
    try { return new Date(s).toLocaleString('cs-CZ'); } catch { return s; }
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>⚙️ {t('labSettings') || 'Nastavení laboratoře'}</h2>

      {/* Name */}
      <div>
        <label style={{ fontWeight: 500, display: 'block', marginBottom: 4 }}>{t('name') || 'Název'}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} />
      </div>

      {/* Description */}
      <div>
        <label style={{ fontWeight: 500, display: 'block', marginBottom: 4 }}>{t('description') || 'Popis'}</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} style={{ ...fieldStyle, resize: 'vertical' }} />
      </div>

      {/* Save */}
      <div>
        <button
          className="btn btn-add"
          onClick={handleSave}
          disabled={!dirty || saving}
          style={{ padding: '8px 20px' }}
        >
          {saving ? '⏳' : '💾'} {t('save') || 'Uložit'}
        </button>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb' }} />

      {/* Info */}
      <div style={{ fontSize: 13, color: '#6b7280', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>ID: {lab.id}</span>
        <span>Owner: #{lab.ownerId}</span>
        <span>Vytvořeno: {formatDate(lab.createdAt)}</span>
        <span>Aktualizováno: {formatDate(lab.updatedAt)}</span>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb' }} />

      {/* Sharing */}
      <div>
        <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 600 }}>👥 {t('sharing') || 'Sdílení'}</h3>

        {lab.sharedWith?.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {lab.sharedWith.map((uid) => (
              <div key={uid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb' }}>
                <span style={{ flex: 1, fontSize: 13 }}>Uživatel #{uid}</span>
                <button
                  onClick={() => handleUnshare(uid)}
                  style={{ padding: '3px 8px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                >
                  ✕ Odebrat
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: '#9ca3af', fontSize: 13, margin: '0 0 12px' }}>Laboratoř není sdílena s nikým.</p>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            placeholder="User ID"
            value={shareUserId}
            onChange={(e) => setShareUserId(e.target.value)}
            style={{ ...fieldStyle, width: 120 }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleShare(); }}
          />
          <button className="btn btn-edit" onClick={handleShare} disabled={!shareUserId.trim()} style={{ padding: '8px 14px' }}>
            + {t('share') || 'Sdílet'}
          </button>
        </div>
      </div>
    </div>
  );
}
