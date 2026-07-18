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

type View = 'login' | 'forgot' | 'reset' | 'trial';

export const Login: React.FC<LoginProps> = ({ onLogin, lang, setLang }) => {
  const tr = t(lang);
  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [trialName, setTrialName] = useState('');
  const [trialProducts, setTrialProducts] = useState<Array<{ productName: string; systemId: string; description?: string | null }>>([]);
  const [trialSystemId, setTrialSystemId] = useState('');
  const [trialMsg, setTrialMsg] = useState<string | null>(null);

  // Forgot password
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

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
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail })
      });
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

  useEffect(() => {
    if (view !== 'trial') return;
    fetch('/api/public/products')
      .then(r => r.json())
      .then((d: unknown) => {
        setTrialProducts(Array.isArray(d) ? (d as typeof trialProducts) : []);
      })
      .catch(() => setTrialProducts([]));
  }, [view]);

  const handleTrial = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrialMsg(null);
    if (!email || !password || !trialSystemId) return;
    setLoading(true);
    try {
      const res = await fetch('/api/public/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: trialName, systemId: trialSystemId })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setTrialMsg(data.error || 'Falha ao ativar.');
        return;
      }
      // Primeiro login define a senha (user.password era null)
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const loginData = (await loginRes.json().catch(() => ({}))) as { token?: string; id?: string; email?: string };
      if (loginRes.ok && loginData.token && loginData.id && loginData.email) {
        localStorage.setItem('contentpro_token', loginData.token);
        onLogin(loginData.id, loginData.email);
        return;
      }
      setTrialMsg(tr.trial_success);
      setView('login');
    } catch {
      setTrialMsg(tr.login_error_connection);
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
          <img
            src="/logo.png"
            alt={tr.login_brand_title}
            className="login-brand-logo"
            width={280}
            height={120}
            decoding="async"
          />
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
                onClick={() => { setView('forgot'); setForgotSent(false); setForgotEmail(''); }}
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

        {/* ── TRIAL VIEW ── */}
        {view === 'trial' && (
          <>
            <h2 className="login-subtitle" style={{ fontSize: '18px', fontWeight: 700 }}>{tr.trial_title}</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '12px' }}>{tr.trial_desc}</p>
            {trialMsg && <p style={{ color: '#ef4444', fontSize: '14px', marginBottom: '8px' }}>{trialMsg}</p>}
            <form onSubmit={handleTrial} className="login-form">
              <div className="input-group">
                <label>{tr.trial_name_label}</label>
                <input
                  value={trialName}
                  onChange={(e) => setTrialName(e.target.value)}
                  placeholder={tr.trial_name_placeholder}
                />
              </div>
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
                <label>{tr.trial_product_label}</label>
                <select value={trialSystemId} onChange={(e) => setTrialSystemId(e.target.value)} required>
                  <option value="">{tr.trial_product_placeholder}</option>
                  {trialProducts.map(p => (
                    <option key={p.systemId} value={p.systemId}>{p.productName}</option>
                  ))}
                </select>
              </div>
              <div className="input-group">
                <label>{tr.trial_password_label}</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
                <small style={{ color: 'var(--text-secondary)', marginTop: 6, display: 'block' }}>{tr.trial_password_hint}</small>
              </div>
              <button type="submit" className="login-submit-btn" disabled={loading}>
                {loading ? tr.trial_loading : tr.trial_submit}
              </button>
              <button type="button" className="forgot-password-link" onClick={() => setView('login')} style={{ marginTop: '12px' }}>
                {tr.trial_back_login}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
