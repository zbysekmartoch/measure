import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const DialogContext = createContext(null);

function DialogModal({ activeDialog, onResolve }) {
  const inputRef = useRef(null);
  const [promptValue, setPromptValue] = useState('');

  useEffect(() => {
    if (!activeDialog) return;
    if (activeDialog.type === 'prompt') {
      setPromptValue(activeDialog.defaultValue ?? '');
    }
  }, [activeDialog]);

  useEffect(() => {
    if (activeDialog?.type !== 'prompt') return;

    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    return () => clearTimeout(timer);
  }, [activeDialog]);

  useEffect(() => {
    if (!activeDialog) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onResolve(activeDialog.type === 'prompt' ? null : false);
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        onResolve(activeDialog.type === 'prompt' ? promptValue : true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeDialog, onResolve, promptValue]);

  if (!activeDialog) return null;

  const title = activeDialog.title ?? (activeDialog.type === 'prompt' ? 'Input required' : 'Please confirm');
  const message = activeDialog.message ?? '';
  const confirmText = activeDialog.confirmText ?? 'OK';
  const cancelText = activeDialog.cancelText ?? 'Cancel';

  const confirmColor = activeDialog.tone === 'danger'
    ? '#dc2626'
    : activeDialog.tone === 'warning'
      ? '#d97706'
      : '#2563eb';

  return (
    <div
      role="presentation"
      onClick={() => onResolve(activeDialog.type === 'prompt' ? null : false)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 11000,
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 440,
          background: '#ffffff',
          borderRadius: 10,
          border: '1px solid #d1d5db',
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>{title}</div>
        {message && (
          <div style={{ fontSize: 14, color: '#374151', whiteSpace: 'pre-wrap' }}>{message}</div>
        )}

        {activeDialog.type === 'prompt' && (
          <input
            ref={inputRef}
            type="text"
            value={promptValue}
            onChange={(event) => setPromptValue(event.target.value)}
            placeholder={activeDialog.placeholder ?? ''}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              fontSize: 14,
              color: '#111827',
            }}
          />
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={() => onResolve(activeDialog.type === 'prompt' ? null : false)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              background: '#f9fafb',
              color: '#111827',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {cancelText}
          </button>
          <button
            onClick={() => onResolve(activeDialog.type === 'prompt' ? promptValue : true)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: 'none',
              background: confirmColor,
              color: '#ffffff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DialogProvider({ children }) {
  const queueRef = useRef([]);
  const activeRef = useRef(null);
  const [activeDialog, setActiveDialog] = useState(null);

  const showNext = useCallback(() => {
    if (activeRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    activeRef.current = next;
    setActiveDialog(next);
  }, []);

  const enqueue = useCallback((type, options = {}) => new Promise((resolve) => {
    queueRef.current.push({ type, ...options, resolve });
    showNext();
  }), [showNext]);

  const resolveDialog = useCallback((value) => {
    const active = activeRef.current;
    if (!active) return;

    active.resolve(value);
    activeRef.current = null;
    setActiveDialog(null);

    setTimeout(() => {
      showNext();
    }, 0);
  }, [showNext]);

  const confirm = useCallback((options = {}) => enqueue('confirm', options), [enqueue]);
  const prompt = useCallback((options = {}) => enqueue('prompt', options), [enqueue]);

  useEffect(() => {
    const queuedDialogs = queueRef.current;

    return () => {
      if (activeRef.current) {
        const fallbackValue = activeRef.current.type === 'prompt' ? null : false;
        activeRef.current.resolve(fallbackValue);
        activeRef.current = null;
      }

      while (queuedDialogs.length > 0) {
        const pending = queuedDialogs.shift();
        if (!pending) continue;
        pending.resolve(pending.type === 'prompt' ? null : false);
      }
    };
  }, []);

  const api = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

  return (
    <DialogContext.Provider value={api}>
      {children}
      <DialogModal activeDialog={activeDialog} onResolve={resolveDialog} />
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const context = useContext(DialogContext);
  if (context) return context;

  return {
    confirm: async () => false,
    prompt: async () => null,
  };
}
