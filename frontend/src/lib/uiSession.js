/**
 * uiSession.js — persistence of UI session state across page reloads
 * and diagnostics of why a page load happened.
 *
 * Browsers unload background tabs under memory pressure (Firefox "tab unloading",
 * Chrome "Memory Saver"); when the user returns the page is reloaded from scratch
 * and all React state is gone. We therefore keep the small part of the state that
 * matters (open labs, active tabs, open files, unsaved drafts) in localStorage and
 * restore it on load. Keys are namespaced per user so shared machines do not mix.
 */

const PREFIX = 'measure.ui';
const LOADS_KEY = 'measure.pageLoads';
const HIDE_KEY = 'measure.lastPageHide';
const VITE_KEY = 'measure.viteDisconnect';
const MAX_LOADS = 30;

export function readJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* quota or private mode — ignore */ }
}

/** Build a namespaced key: measure.ui:<userId>:<part>:<part>… */
export function uiKey(userId, ...parts) {
  return [PREFIX, userId ?? 'anon', ...parts].join(':');
}

/** Key under which an unsaved editor draft of a file is kept. */
export function draftKey(userId, labId, filePath) {
  return uiKey(userId, 'draft', labId, filePath);
}

/**
 * Record how this page load came about. Call once at startup.
 *   type         — 'navigate' | 'reload' | 'back_forward' | 'prerender' (Navigation Timing)
 *   wasDiscarded — true when the browser discarded the tab to save memory and
 *                  is now reloading it (Chrome/Edge; Firefox reports 'reload')
 *   lastHide     — when and how the previous page instance went away
 */
export function recordPageLoad() {
  try {
    const nav = performance.getEntriesByType?.('navigation')?.[0];
    const entry = {
      at: new Date().toISOString(),
      type: nav?.type || 'unknown',
      wasDiscarded: document.wasDiscarded === true,
      visibility: document.visibilityState,
      lastHide: readJSON(HIDE_KEY, null),
      viteDisconnect: readJSON(VITE_KEY, null),
      userAgent: navigator.userAgent,
    };
    writeJSON(VITE_KEY, null);
    const list = readJSON(LOADS_KEY, []);
    list.push(entry);
    while (list.length > MAX_LOADS) list.shift();
    writeJSON(LOADS_KEY, list);
    console.info('[measure] page load', entry);

    // Vite dev server only (port 50101): when its HMR WebSocket drops (laptop sleep, network
    // change, dev server restart) the Vite client polls until the server answers and then
    // calls location.reload(). Remember the disconnect so the next page load can explain itself.
    if (import.meta.hot) {
      import.meta.hot.on('vite:ws:disconnect', () => {
        writeJSON(VITE_KEY, { at: new Date().toISOString() });
      });
    }

    window.addEventListener('pagehide', (e) => {
      writeJSON(HIDE_KEY, { at: new Date().toISOString(), event: 'pagehide', persisted: e.persisted === true, visibility: document.visibilityState });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        writeJSON(HIDE_KEY, { at: new Date().toISOString(), event: 'hidden', persisted: null, visibility: 'hidden' });
      }
    });
  } catch { /* ignore */ }
}

export function getPageLoads() {
  return readJSON(LOADS_KEY, []);
}

export function clearPageLoads() {
  writeJSON(LOADS_KEY, null);
}

/** Human explanation of a page-load entry for the Performance tab. */
export function explainPageLoad(entry) {
  if (!entry) return '';
  if (entry.wasDiscarded) return 'Browser discarded the tab to free memory and reloaded it (Memory Saver / tab unloading)';
  if (entry.viteDisconnect) return `Vite dev server connection lost at ${new Date(entry.viteDisconnect.at).toLocaleTimeString()} — the dev client reloaded the page once the server answered again (dev mode on :50101 only)`;
  const hide = entry.lastHide;
  if (entry.type === 'reload') {
    if (hide && hide.event === 'hidden') return 'Reloaded while the tab was in the background — typical for browser tab unloading under memory pressure';
    return 'Reload (F5, or the browser restored the tab)';
  }
  if (entry.type === 'back_forward') return 'Back/forward navigation';
  if (entry.type === 'navigate') {
    if (hide && hide.event === 'pagehide') return 'New navigation after the previous page was closed or navigated away';
    return 'Fresh navigation (new tab, link, or restored window)';
  }
  return entry.type;
}
