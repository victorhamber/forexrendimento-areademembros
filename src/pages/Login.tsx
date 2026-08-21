import React, { useState, useEffect } from 'react';
import { t } from '../i18n/translations';
import type { Lang } from '../i18n/translations';
import { SHOW_LANGUAGE_SWITCHER } from '../i18n/featureFlags';
import './Login.css';

interface LoginProps {
  onLogin: (userId: string, email: string) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
}

type View = 'login' | 'forgot' | 'reset';

export const Login: React.FC<LoginProps> = ({ onLogin, lang, setLang }) => {
  const tr = t(lang);
  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [supportUrl, setSupportUrl] = useState('');

  // Forgot password
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState('');

  // Reset password (from URL token)
  const [resetToken, setResetToken] = useState('');
  const [resetUserId, setResetUserId] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetError, setResetError] = useState('');

  // Check URL for reset token on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset_token');
    const userId = params.get('user_id');
    if (token && userId) {
      setResetToken(token);
      setResetUserId(userId);
      setView('reset');
      // Clean the URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Mesmo caminho da dashboard: /api/public/member-hero → supportUrl (Setting member_support_url)
  useEffect(() => {
    let cancelled = false;
    fetch('/api/public/member-hero')
      .then((r) => r.json())
      .then((d: { supportUrl?: string | null }) => {
        if (cancelled) return;
        setSupportUrl(String(d?.supportUrl || '').trim());
      })
      .catch(() => {
        if (!cancelled) setSupportUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openSupport = () => {
    const url = supportUrl.trim();
    if (!url) {
      alert(tr.support_not_configured);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      let data: { error?: string; token?: string; id?: string; email?: string } = {};
      const text = await res.text();
      try {
        data = text ? (JSON.parse(text) as typeof data) : {};
      } catch {
        alert(tr.login_error_connection);
        return;
      }

      if (res.ok) {
        if (data.token) localStorage.setItem('contentpro_token', data.token);
        if (data.id && data.email) onLogin(data.id, data.email);
        else alert(tr.login_error_fields);
      } else {
        alert(data.error || tr.login_error_fields);
      }
    } catch (err) {
      console.error(err);
      alert(tr.login_error_connection);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) return;
    setLoading(true);
    setForgotError('');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail })
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (res.status === 429) {
        setForgotError(data.error || tr.forgot_password_rate_limit);
        return;
      }
      if (!res.ok) {
        setForgotError(data.error || tr.login_error_connection);
        return;
      }
      setForgotSent(true);
    } catch {
      alert(tr.login_error_connection);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setResetError(tr.reset_password_mismatch);
      return;
    }
    setLoading(true);
    setResetError('');
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, userId: resetUserId, newPassword })
      });
      if (res.ok) {
        setResetSuccess(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setResetError(data.error || tr.reset_password_error);
      }
    } catch {
      alert(tr.login_error_connection);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        {SHOW_LANGUAGE_SWITCHER && (
          <div className="login-lang-switcher">
            <button
              className={`lang-btn ${lang === 'pt' ? 'active' : ''}`}
              onClick={() => setLang('pt')}
              title="Português"
            >
              🇧🇷
            </button>
            <button
              className={`lang-btn ${lang === 'es' ? 'active' : ''}`}
              onClick={() => setLang('es')}
              title="Español"
            >
              🇪🇸
            </button>
          </div>
        )}

        <div className="login-identity-block">
          <p className="login-kicker">{tr.login_kicker}</p>
          <h1 className="login-title-main">{tr.login_brand_title}</h1>
        </div>

        {/* ── LOGIN VIEW ── */}
        {view === 'login' && (
          <>
            <p className="login-subtitle">{tr.login_subtitle}</p>
            <form onSubmit={handleSubmit} className="login-form">
              <div className="input-group">
                <label>{tr.login_email_label}</label>
                <input 
                  type="email" 
                  placeholder={tr.login_email_placeholder}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="input-group">
                <label>{tr.login_password_label}</label>
                <input 
                  type="password" 
                  placeholder="••••••••" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <button
                type="button"
                className="forgot-password-link"
                onClick={() => {
                  setView('forgot');
                  setForgotSent(false);
                  setForgotEmail('');
                  setForgotError('');
                }}
              >
                {tr.forgot_password_link}
              </button>
              
              <button type="submit" className="login-submit-btn" disabled={loading}>
                {loading ? tr.login_loading : tr.login_btn}
              </button>
            </form>
          </>
        )}

        {/* ── FORGOT PASSWORD VIEW ── */}
        {view === 'forgot' && (
          <>
            <h2 className="login-subtitle" style={{ fontSize: '18px', fontWeight: 700 }}>{tr.forgot_password_title}</h2>
            {forgotSent ? (
              <div style={{ textAlign: 'center' }}>
                <p style={{ color: 'var(--accent-primary)', lineHeight: 1.6, marginBottom: '16px' }}>{tr.forgot_password_sent}</p>
                <button className="login-submit-btn" onClick={() => { setView('login'); setForgotSent(false); }}>
                  {tr.forgot_password_back}
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="login-form">
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '12px' }}>{tr.forgot_password_desc}</p>
                {forgotError && (
                  <p style={{ color: '#ef4444', fontSize: '14px', marginBottom: '8px', lineHeight: 1.45 }}>
                    {forgotError}
                  </p>
                )}
                <div className="input-group">
                  <label>{tr.login_email_label}</label>
                  <input
                    type="email"
                    placeholder={tr.login_email_placeholder}
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="login-submit-btn" disabled={loading}>
                  {loading ? tr.forgot_password_sending : tr.forgot_password_send}
                </button>
                <button type="button" className="forgot-password-link" onClick={() => setView('login')} style={{ marginTop: '12px' }}>
                  {tr.forgot_password_back}
                </button>
              </form>
            )}
          </>
        )}

        {/* ── RESET PASSWORD VIEW ── */}
        {view === 'reset' && (
          <>
            <h2 className="login-subtitle" style={{ fontSize: '18px', fontWeight: 700 }}>{tr.reset_password_title}</h2>
            {resetSuccess ? (
              <div style={{ textAlign: 'center' }}>
                <p style={{ color: 'var(--accent-primary)', lineHeight: 1.6, marginBottom: '16px' }}>{tr.reset_password_success}</p>
                <button className="login-submit-btn" onClick={() => { setView('login'); setResetSuccess(false); }}>
                  {tr.forgot_password_back}
                </button>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="login-form">
                {resetError && <p style={{ color: '#ef4444', fontSize: '14px', marginBottom: '8px' }}>{resetError}</p>}
                <div className="input-group">
                  <label>{tr.reset_password_placeholder}</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <div className="input-group">
                  <label>{tr.reset_password_confirm}</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <button type="submit" className="login-submit-btn" disabled={loading}>
                  {loading ? tr.reset_password_saving : tr.reset_password_btn}
                </button>
              </form>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        className="login-support-fab"
        onClick={openSupport}
        aria-label={tr.login_support_fab_label}
        title={tr.login_support_fab_label}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M20.52 3.48A11.86 11.86 0 0012.04 0C5.47 0 .13 5.33.13 11.9c0 2.1.55 4.14 1.6 5.95L0 24l6.34-1.66a11.9 11.9 0 005.7 1.45h.01c6.56 0 11.9-5.34 11.9-11.9 0-3.18-1.24-6.17-3.43-8.41zM12.05 21.78h-.01a9.87 9.87 0 01-5.03-1.38l-.36-.21-3.75.98 1-3.65-.24-.38a9.86 9.86 0 01-1.51-5.26c0-5.45 4.44-9.88 9.9-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 012.89 6.99c-.01 5.45-4.44 9.89-9.88 9.89zm5.43-7.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51-.17-.01-.37-.01-.57-.01s-.52.07-.79.37c-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.48.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z" />
        </svg>
      </button>
    </div>
  );
};
