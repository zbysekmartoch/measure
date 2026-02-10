/**
 * ClipboardContext — global clipboard for copy/paste of files and folders
 * across different FileManagerEditor instances.
 *
 * Stores: { type: 'file'|'folder', path, apiBasePath }
 * So paste knows *where* to fetch the source from.
 */
import React, { createContext, useCallback, useContext, useState } from 'react';
import { useToast } from '../Toast';

const ClipboardCtx = createContext(null);

export function FileClipboardProvider({ children }) {
  // clipboard: { type: 'file'|'folder', path: string, apiBasePath: string } | null
  const [clipboard, setClipboard] = useState(null);
  const toast = useToast();

  const copyFile = useCallback((filePath, apiBasePath) => {
    setClipboard({ type: 'file', path: filePath, apiBasePath });
    const name = filePath.split('/').pop();
    toast.info(`Copied file "${name}"`);
  }, [toast]);

  const copyFolder = useCallback((folderPath, apiBasePath) => {
    setClipboard({ type: 'folder', path: folderPath, apiBasePath });
    const name = folderPath.split('/').pop() || folderPath;
    toast.info(`Copied folder "${name}"`);
  }, [toast]);

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
