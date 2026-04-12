/**
 * usePopoutWindow — generic hook for opening any React content in a popup window.
 *
 * Returns { isPopout, popoutContainer, openPopout, closePopout }
 *
 * Usage:
 *   const popout = usePopoutWindow({ title: 'Scripts', width: 800, height: 600 });
 *   // Render in popout.popoutContainer via createPortal when popout.isPopout
 */
import { useState, useRef, useCallback, useEffect } from 'react';

export function usePopoutWindow({ title = 'Window', width = 800, height = 600, onClose } = {}) {
  const [popoutContainer, setPopoutContainer] = useState(null);
  const popupRef = useRef(null);
  const isPopout = !!popoutContainer;

  const openPopout = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
      return;
    }
    const w = window.open('', `popout_${title}_${Date.now()}`, `width=${width},height=${height},resizable=yes`);
    if (!w) return; // popup blocked

    popupRef.current = w;
    w.document.title = title;
    w.document.open();
    w.document.write('<!DOCTYPE html><html><head></head><body></body></html>');
    w.document.close();

    // Copy stylesheets from parent for consistent styling
    const style = w.document.createElement('style');
    style.textContent = `
      body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #fff; color: #111827; }
      * { box-sizing: border-box; }
      button { font-family: inherit; }
      ::-webkit-scrollbar { width: 8px; }
      ::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 4px; }
    `;
    w.document.head.appendChild(style);

    const container = w.document.createElement('div');
    container.id = 'popout-root';
    container.style.cssText = 'height:100vh;overflow:auto;display:flex;flex-direction:column;';
    w.document.body.appendChild(container);

    setPopoutContainer(container);

    w.addEventListener('beforeunload', () => {
      setPopoutContainer(null);
      popupRef.current = null;
      onClose?.();
    });
  }, [title, width, height, onClose]);

  const closePopout = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) {
      setPopoutContainer(null);
      const w = popupRef.current;
      popupRef.current = null;
      setTimeout(() => { try { w.close(); } catch { /* ignore */ } }, 0);
    } else {
      popupRef.current = null;
      setPopoutContainer(null);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (popupRef.current && !popupRef.current.closed) {
        try { popupRef.current.close(); } catch { /* ignore */ }
      }
    };
  }, []);

  return { isPopout, popoutContainer, openPopout, closePopout };
}
