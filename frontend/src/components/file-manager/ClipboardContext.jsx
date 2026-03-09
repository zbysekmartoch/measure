/**
 * ClipboardContext — server-backed clipboard for copy/paste of files and folders
 * across different FileManagerEditor instances **and browser windows/tabs**.
 *
 * The clipboard is stored on the server per authenticated user so that all
 * windows / sessions of the same user share the same clipboard.
 *
 * Stores: { type: 'file'|'folder', path, apiBasePath }
 * So paste knows *where* to fetch the source from.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useToast } from '../Toast';

const ClipboardCtx = createContext(null);

/** Helper — auth header for API calls */
function authHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('authToken')}`,
    ...extra,
  };
}

/** Fetch clipboard from server */
async function fetchClipboard() {
  try {
    const r = await fetch('/api/v1/clipboard', { headers: authHeaders() });
    if (!r.ok) return null;
    const data = await r.json();
    return data.clipboard || null;
  } catch {
    return null;
  }
}

/** Save clipboard to server */
async function saveClipboard(entry) {
  try {
    await fetch('/api/v1/clipboard', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(entry),
    });
  } catch { /* best-effort */ }
}

export function FileClipboardProvider({ children }) {
  // clipboard: { type: 'file'|'folder', path: string, apiBasePath: string } | null
  const [clipboard, setClipboard] = useState(null);
  const toast = useToast();
  const lastTsRef = useRef(0); // track server timestamp to avoid stale overwrites

  // ---- Sync from server ----
  const refreshFromServer = useCallback(async () => {
    const remote = await fetchClipboard();
    if (remote) {
      const ts = remote.ts || 0;
      if (ts >= lastTsRef.current) {
        lastTsRef.current = ts;
        setClipboard(remote);
      }
    } else {
      // server clipboard was cleared or empty
      if (lastTsRef.current === 0) return; // never set locally, nothing to clear
      setClipboard(null);
      lastTsRef.current = 0;
    }
  }, []);

  // Refresh on mount
  useEffect(() => {
    refreshFromServer();
  }, [refreshFromServer]);

  // Refresh when window gains focus (user switches between windows)
  useEffect(() => {
    const onFocus = () => refreshFromServer();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshFromServer]);

  // Also use BroadcastChannel for instant same-browser sync
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('file-clipboard');
    bc.onmessage = (ev) => {
      const data = ev.data;
      if (data && data.ts >= lastTsRef.current) {
        lastTsRef.current = data.ts;
        setClipboard(data);
      } else if (!data) {
        setClipboard(null);
        lastTsRef.current = 0;
      }
    };
    return () => bc.close();
  }, []);

  /** Broadcast to other same-browser tabs */
  const broadcast = useCallback((entry) => {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('file-clipboard');
        bc.postMessage(entry);
        bc.close();
      }
    } catch { /* ignore */ }
  }, []);

  // ---- Copy actions ----
  const copyFile = useCallback(async (filePath, apiBasePath) => {
    const entry = { type: 'file', path: filePath, apiBasePath };
    // optimistic local update
    const ts = Date.now();
    const full = { ...entry, ts };
    lastTsRef.current = ts;
    setClipboard(full);
    broadcast(full);
    await saveClipboard(entry);

    const name = filePath.split('/').pop();
    toast.info(`Copied file "${name}"`);
  }, [toast, broadcast]);

  const copyFolder = useCallback(async (folderPath, apiBasePath) => {
    const entry = { type: 'folder', path: folderPath, apiBasePath };
    const ts = Date.now();
    const full = { ...entry, ts };
    lastTsRef.current = ts;
    setClipboard(full);
    broadcast(full);
    await saveClipboard(entry);

    const name = folderPath.split('/').pop() || folderPath;
    toast.info(`Copied folder "${name}"`);
  }, [toast, broadcast]);

  const clear = useCallback(async () => {
    setClipboard(null);
    lastTsRef.current = 0;
    broadcast(null);
    try {
      await fetch('/api/v1/clipboard', {
        method: 'DELETE',
        headers: authHeaders(),
      });
    } catch { /* best-effort */ }
  }, [broadcast]);

  return (
    <ClipboardCtx.Provider value={{ clipboard, copyFile, copyFolder, clear, refreshFromServer }}>
      {children}
    </ClipboardCtx.Provider>
  );
}

export function useFileClipboard() {
  const ctx = useContext(ClipboardCtx);
  if (!ctx) throw new Error('useFileClipboard must be inside FileClipboardProvider');
  return ctx;
}
