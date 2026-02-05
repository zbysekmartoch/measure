import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

export default function LoginForm({ onSwitchToRegister, onSwitchToReset }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const { t } = useLanguage();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
    } catch (err) {
      // Try to extract error from JSON response
      let errorMessage = t('loginFailed');
      
      if (err.body) {
        try {
          const errorData = JSON.parse(err.body);
          if (errorData.error) {
            errorMessage = errorData.error;
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

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ margin: '0 0 16px 0', textAlign: 'center' }}>{t('login')}</h2>
      
      {error && (
        <div style={{ padding: 12, background: '#fee2e2', color: '#991b1b', borderRadius: 6 }}>
          {error}
        </div>
      )}

      <div>
        <label style={{ display: 'block', marginBottom: 4, color: '#374151' }}>{t('email')}</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ width: '100%', padding: 12, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 16, boxSizing: 'border-box' }}
        />
      </div>

      <div>
        <label style={{ display: 'block', marginBottom: 4, color: '#374151' }}>{t('password')}</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ width: '100%', padding: 12, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 16, boxSizing: 'border-box' }}
        />
      </div>

      <button
        className="btn btn-primary"
        type="submit"
        disabled={loading}
        style={{ width: '100%', padding: 12, fontSize: 16 }}
      >
        {loading ? t('loggingIn') : t('loginButton')}
      </button>

      <div style={{ textAlign: 'center', fontSize: 14, marginTop: 8 }}>
        <button type="button" onClick={onSwitchToRegister} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', textDecoration: 'underline' }}>
          {t('noAccount')}
        </button>
        <br />
        <button type="button" onClick={onSwitchToReset} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', textDecoration: 'underline', marginTop: 8 }}>
          {t('forgotPassword')}
        </button>
      </div>
    </form>
  );
}