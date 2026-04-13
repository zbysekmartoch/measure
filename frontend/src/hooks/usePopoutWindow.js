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

// ── Monaco cross-window focus fix ──────────────────────────────────────────
// Monaco's getActiveDocument() returns mainWindow.document when only 1 window
// is registered (standalone mode). Then getActiveElement() reads .activeElement
// from mainWindow.document — which doesn't point to the popup's focused element.
// We patch document.activeElement: when the main window lost focus (!hasFocus()),
// we check popup windows and return the active element from the focused one.
const _popupWindows = new Set();
let _activeElementPatched = false;

function _ensureActiveElementPatch() {
  if (_activeElementPatched) return;
  const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement')
            || Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'activeElement');
  if (!desc?.get) return;
  _activeElementPatched = true;
  const origGet = desc.get;
  Object.defineProperty(document, 'activeElement', {
    get() {
      const orig = origGet.call(this);
      // When the main window doesn't have focus, a popup window might.
      // Monaco's getActiveDocument() short-circuits to mainWindow.document
      // when no auxiliary windows are registered. We intercept here to
      // return the popup's active element so Monaco detects editor focus.
      if (this === document && !this.hasFocus()) {
        for (const w of _popupWindows) {
          try {
            if (!w.closed && w.document.hasFocus()) {
              return w.document.activeElement;
            }
          } catch { /* popup closed or cross-origin */ }
        }
      }
      return orig;
    },
    configurable: true,
  });
}

export function usePopoutWindow({ title = 'Window', width = 800, height = 600, onClose } = {}) {
  const [popoutContainer, setPopoutContainer] = useState(null);
  const popupRef = useRef(null);
  const observerRef = useRef(null);
  const isPopout = !!popoutContainer;

  const openPopout = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
      return;
    }

    // "popup" feature triggers minimal UI (no address bar) in Chrome/Edge
    const w = window.open('', `popout_${title}_${Date.now()}`, `popup,width=${width},height=${height},resizable=yes`);
    if (!w) return; // popup blocked

    popupRef.current = w;

    // Resolve the app favicon URL
    const faviconEl = document.querySelector('link[rel="icon"]');
    const faviconHref = faviconEl ? new URL(faviconEl.href, location.origin).href : '';
    const faviconTag = faviconHref ? `<link rel="icon" href="${faviconHref}">` : '';

    // Write a complete document with title + favicon
    w.document.open();
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>${faviconTag}</head><body></body></html>`);
    w.document.close();

    // Base styles for the popup
    const baseStyle = w.document.createElement('style');
    baseStyle.textContent = `
      body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #fff; color: #111827; }
      * { box-sizing: border-box; }
      button { font-family: inherit; }
      ::-webkit-scrollbar { width: 8px; }
      ::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 4px; }
    `;
    w.document.head.appendChild(baseStyle);

    // Copy ALL stylesheets from parent window so Monaco & app styles work
    const copyStyleNode = (node) => {
      if (node.tagName === 'STYLE') {
        const clone = w.document.createElement('style');
        clone.textContent = node.textContent;
        if (node.dataset.name) clone.dataset.name = node.dataset.name;
        w.document.head.appendChild(clone);
      } else if (node.tagName === 'LINK' && node.rel === 'stylesheet') {
        const clone = w.document.createElement('link');
        clone.rel = 'stylesheet';
        clone.href = node.href;
        if (node.crossOrigin) clone.crossOrigin = node.crossOrigin;
        w.document.head.appendChild(clone);
      }
    };

    // Copy existing styles from parent
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach(copyStyleNode);

    // Override body styles that break popout layout (e.g. index.css sets
    // body { display:flex; place-items:center } which centers & shrinks content)
    const overrideStyle = w.document.createElement('style');
    overrideStyle.dataset.name = 'popout-override';
    overrideStyle.textContent = `
      body { display: block !important; place-items: unset !important; }
      #root { display: none; }
    `;
    w.document.head.appendChild(overrideStyle);

    // Watch for dynamically added styles (Monaco loads CSS lazily)
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) copyStyleNode(node);
        }
      }
    });
    observer.observe(document.head, { childList: true });
    observerRef.current = observer;

    const container = w.document.createElement('div');
    container.id = 'popout-root';
    container.style.cssText = 'height:100vh;overflow:auto;display:flex;flex-direction:column;';
    w.document.body.appendChild(container);

    setPopoutContainer(container);

    // Register popup for Monaco cross-window focus fix
    _popupWindows.add(w);
    _ensureActiveElementPatch();

    w.addEventListener('beforeunload', () => {
      _popupWindows.delete(w);
      observer.disconnect();
      setPopoutContainer(null);
      popupRef.current = null;
      onClose?.();
    });
  }, [title, width, height, onClose]);

  const closePopout = useCallback(() => {
    if (observerRef.current) { observerRef.current.disconnect(); observerRef.current = null; }
    if (popupRef.current && !popupRef.current.closed) {
      _popupWindows.delete(popupRef.current);
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
      if (observerRef.current) { observerRef.current.disconnect(); observerRef.current = null; }
      if (popupRef.current && !popupRef.current.closed) {
        _popupWindows.delete(popupRef.current);
        try { popupRef.current.close(); } catch { /* ignore */ }
      }
    };
  }, []);

  return { isPopout, popoutContainer, openPopout, closePopout };
}
