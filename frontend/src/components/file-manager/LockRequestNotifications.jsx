/**
 * LockRequestNotifications — floating notification panel showing
 * lock requests from other users asking the current user to release a file lock.
 */
import React from 'react';
import { fileLocking as lockCfg, shadow } from '../../lib/uiConfig.js';

export default function LockRequestNotifications({ lockRequests, onRelease, onDismiss }) {

  if (!lockRequests || lockRequests.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', top: 12, right: 16, zIndex: 10000,
      display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 380,
    }}>
      {lockRequests.map((req) => (
        <div
          key={req.id}
          style={{
            padding: '10px 14px', borderRadius: 8, fontSize: 12,
            background: '#fff', border: `1px solid ${lockCfg.lockedBannerBorder}`,
            boxShadow: shadow.hover,
            display: 'flex', flexDirection: 'column', gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              background: lockCfg.requestBadgeBg, color: lockCfg.requestBadgeColor,
              padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700,
            }}>
              {lockCfg.requestBtn.icon}
            </span>
            <span style={{ fontWeight: 600, color: '#374151' }}>
              Lock request from {req.fromUserName || req.fromUserEmail}
            </span>
          </div>
          <div style={{ color: '#6b7280', fontSize: 11 }}>
            File: <strong>{req.filePath}</strong>
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              onClick={() => onRelease(req)}
              style={{
                padding: '4px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 11,
                background: lockCfg.releaseBtn.bg, color: lockCfg.releaseBtn.color, boxShadow: shadow.small,
              }}
            >
              {lockCfg.releaseBtn.icon} Release
            </button>
            <button
              onClick={() => onDismiss(req)}
              style={{
                padding: '4px 10px', borderRadius: 4, border: '1px solid #d1d5db', cursor: 'pointer', fontSize: 11,
                background: '#f9fafb', color: '#374151',
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
