import React, { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { fetchJSON } from '../lib/fetchJSON';

export default function ConfirmResetPasswordForm({ token, onSuccess, onSwitchToLogin }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    if (!token) {
      setError(t('missingResetToken'));
    }
  }, [token, t]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validace
    if (!newPassword) {
      setError(t('passwordRequired'));
      return;
    }

    if (newPassword.length < 3) {
      setError(t('passwordTooShort'));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t('passwordMismatch'));
      return;
    }

    setLoading(true);

    try {
      await fetchJSON('/api/v1/auth/reset-password/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          newPassword,
        }),
      });

      setSuccess(t('passwordResetSuccess'));
      setNewPassword('');
      setConfirmPassword('');
      
      // Redirect to login after 2 seconds
      setTimeout(() => {
        if (onSuccess) {
          onSuccess();
        } else {
          onSwitchToLogin();
        }
      }, 2000);
    } catch (err) {
      let errorMessage = t('passwordResetFailed');
      
      if (err.message) {
        errorMessage = err.message;
      } else if (err.body) {
        try {
          const errorData = typeof err.body === 'string' ? JSON.parse(err.body) : err.body;
          if (errorData.error) {
            errorMessage = errorData.error;
          } else if (errorData.message) {
            errorMessage = errorData.message;
          }
        } catch {
          // If parsing fails, use fallback
        }
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 400, margin: '0 auto' }}>
        <h2 style={{ margin: '0 0 16px 0', textAlign: 'center' }}>{t('resetPassword')}</h2>
        <div style={{ padding: 12, background: '#fee2e2', color: '#991b1b', borderRadius: 6 }}>
          {t('missingResetToken')}
        </div>
        <button
          className="btn btn-primary"
          type="button"
          onClick={onSwitchToLogin}
          style={{ padding: 12 }}
        >
          {t('backToLogin')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 400, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 16px 0', textAlign: 'center' }}>{t('setNewPassword')}</h2>

      {error && (
        <div style={{ padding: 12, background: '#fee2e2', color: '#991b1b', borderRadius: 6 }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ padding: 12, background: '#dcfce7', color: '#166534', borderRadius: 6 }}>
          {success}
        </div>
      )}

      <div>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
          {t('newPassword')}
        </label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          disabled={loading || success}
          required
          minLength={3}
          placeholder={t('newPasswordPlaceholder')}
          style={{
            width: '100%',
            padding: 12,
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontSize: 14,
          }}
        />
      </div>

      <div>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
          {t('confirmPassword')}
        </label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={loading || success}
          required
          minLength={3}
          placeholder={t('confirmPasswordPlaceholder')}
          style={{
            width: '100%',
            padding: 12,
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontSize: 14,
          }}
        />
      </div>

      <button
        className="btn btn-add"
        type="submit"
        disabled={loading || success}
        style={{ padding: 12 }}
      >
        {loading ? t('resetting') : t('resetPasswordButton')}
      </button>

      <button
        type="button"
        onClick={onSwitchToLogin}
        disabled={loading}
        style={{
          padding: 12,
          background: 'transparent',
          color: '#3b82f6',
          border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer',
          textDecoration: 'underline',
        }}
      >
        {t('backToLogin')}
      </button>
    </form>
  );
}
