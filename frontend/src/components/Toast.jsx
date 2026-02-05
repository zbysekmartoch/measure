/**
 * Toast Component
 * Non-modal notification system with auto-dismiss and fadeout effect
 */
import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { appConfig } from '../lib/appConfig.js';

// Toast types with their styles
const toastStyles = {
  success: {
    background: '#dcfce7',
    borderColor: '#22c55e',
    color: '#166534',
    icon: '✓'
  },
  error: {
    background: '#fee2e2',
    borderColor: '#ef4444',
    color: '#991b1b',
    icon: '✕'
  },
  warning: {
    background: '#fef3c7',
    borderColor: '#f59e0b',
    color: '#92400e',
    icon: '⚠'
  },
  info: {
    background: '#dbeafe',
    borderColor: '#3b82f6',
    color: '#1e40af',
    icon: 'ℹ'
  }
};

// Individual Toast item
function ToastItem({ id, message, type = 'info', onClose, duration }) {
  const [isVisible, setIsVisible] = useState(true);
  const [isLeaving, setIsLeaving] = useState(false);
  
  const style = toastStyles[type] || toastStyles.info;
  
  useEffect(() => {
    // Start fadeout before removal
    const fadeTimer = setTimeout(() => {
      setIsLeaving(true);
    }, duration - 300);
    
    // Remove after duration
    const removeTimer = setTimeout(() => {
      setIsVisible(false);
      onClose(id);
    }, duration);
    
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, [id, duration, onClose]);
  
  const handleClose = () => {
    setIsLeaving(true);
    setTimeout(() => {
      setIsVisible(false);
      onClose(id);
    }, 300);
  };
  
  if (!isVisible) return null;
  
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        background: style.background,
        border: `1px solid ${style.borderColor}`,
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        marginBottom: 8,
        opacity: isLeaving ? 0 : 1,
        transform: isLeaving ? 'translateX(100%)' : 'translateX(0)',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
        maxWidth: 400,
        minWidth: 280,
      }}
    >
      <span style={{ fontSize: 18, color: style.color }}>{style.icon}</span>
      <span style={{ flex: 1, color: style.color, fontSize: 14 }}>{message}</span>
      <button
        onClick={handleClose}
        style={{
          background: 'transparent',
          border: 'none',
          color: style.color,
          cursor: 'pointer',
          fontSize: 16,
          padding: '0 4px',
          opacity: 0.7,
        }}
        title="Zavřít"
      >
        ×
      </button>
    </div>
  );
}

// Toast container that displays all toasts
function ToastContainer({ toasts, removeToast, duration }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
      }}
    >
      {toasts.map(toast => (
        <ToastItem
          key={toast.id}
          id={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={removeToast}
          duration={duration}
        />
      ))}
    </div>
  );
}

// Context for global toast access
const ToastContext = createContext(null);

// Toast Provider component
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const duration = appConfig.TOAST_DURATION_MS || 4000;
  
  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    return id;
  }, []);
  
  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);
  
  // Convenience methods
  const toast = useCallback((message) => addToast(message, 'info'), [addToast]);
  toast.success = useCallback((message) => addToast(message, 'success'), [addToast]);
  toast.error = useCallback((message) => addToast(message, 'error'), [addToast]);
  toast.warning = useCallback((message) => addToast(message, 'warning'), [addToast]);
  toast.info = useCallback((message) => addToast(message, 'info'), [addToast]);
  
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} duration={duration} />
    </ToastContext.Provider>
  );
}

// Hook to use toast notifications
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // Fallback to alert if no provider
    const fallback = (msg) => alert(msg);
    fallback.success = fallback;
    fallback.error = fallback;
    fallback.warning = fallback;
    fallback.info = fallback;
    return fallback;
  }
  return context;
}

export default ToastProvider;
