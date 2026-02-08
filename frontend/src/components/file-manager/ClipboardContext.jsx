/**
 * ClipboardContext — global clipboard for copy/paste of files and folders
 * across different FileManagerEditor instances.
 *
 * Stores: { type: 'file'|'folder', path, apiBasePath }
 * So paste knows *where* to fetch the source from.
 */
import React, { createContext, useCallback, useContext, useState } from 'react';

const ClipboardCtx = createContext(null);

export function FileClipboardProvider({ children }) {
  // clipboard: { type: 'file'|'folder', path: string, apiBasePath: string } | null
  const [clipboard, setClipboard] = useState(null);

  const copyFile = useCallback((path, apiBasePath) => {
    setClipboard({ type: 'file', path, apiBasePath });
  }, []);

  const copyFolder = useCallback((path, apiBasePath) => {
    setClipboard({ type: 'folder', path, apiBasePath });
  }, []);

  const clear = useCallback(() => setClipboard(null), []);

  return (
    <ClipboardCtx.Provider value={{ clipboard, copyFile, copyFolder, clear }}>
      {children}
    </ClipboardCtx.Provider>
  );
}

export function useFileClipboard() {
  const ctx = useContext(ClipboardCtx);
  if (!ctx) throw new Error('useFileClipboard must be inside FileClipboardProvider');
  return ctx;
}
