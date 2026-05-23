import { FormEvent, useEffect, useState } from 'react';
import { API_BASE_URL } from '../utils/apiBase';

export default function ResetPassword() {
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token') ?? '');
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (newPassword.length > 72) { setError('Password must be at most 72 characters.'); return; }
    if (newPassword !== confirm) { setError('Passwords do not match.'); return; }
    if (!token) { setError('Invalid or missing reset token. Please request a new link.'); return; }
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await r.json() as { success: boolean; error?: string; message?: string };
      if (!data.success) { setError(data.error ?? 'Failed to reset password.'); return; }
      setSuccess(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FBFBFA', padding: 24, fontFamily: 'Inter, -apple-system, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 400, background: '#fff', borderRadius: 20, border: '1px solid rgba(0,0,0,0.08)', padding: 40, boxShadow: '0 4px 32px rgba(0,0,0,0.06)' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0A0A0B', marginBottom: 8 }}>Set new password</h1>
        <p style={{ fontSize: 14, color: '#5C5C60', marginBottom: 28, lineHeight: 1.5 }}>Enter your new password below.</p>

        {success ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="10" stroke="#16a34a" strokeWidth="1.5"/><path d="M6.5 11.5 L9.5 14.5 L15.5 8" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#0A0A0B', marginBottom: 8 }}>Password updated!</p>
            <p style={{ fontSize: 13, color: '#5C5C60', marginBottom: 24 }}>You can now sign in with your new password.</p>
            <a href="/login" style={{ display: 'inline-block', background: '#5b6cf9', color: '#fff', borderRadius: 10, padding: '11px 28px', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>Go to sign in</a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', color: '#dc2626', fontSize: 13, marginBottom: 20, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="7" cy="7" r="6" stroke="currentColor"/><path d="M7 4V8M7 10V10.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                {error}
              </div>
            )}

            {!token && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', color: '#92400e', fontSize: 13, marginBottom: 20 }}>
                No reset token found. Please use the link from your email.
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#2A2A2C', marginBottom: 6 }}>New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                style={{ width: '100%', padding: '10px 14px', border: '1.5px solid rgba(0,0,0,0.14)', borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#2A2A2C', marginBottom: 6 }}>Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat your password"
                autoComplete="new-password"
                style={{ width: '100%', padding: '10px 14px', border: '1.5px solid rgba(0,0,0,0.14)', borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !token}
              style={{ width: '100%', background: '#5b6cf9', color: '#fff', border: 'none', borderRadius: 10, padding: '12px', fontSize: 14, fontWeight: 700, cursor: submitting || !token ? 'not-allowed' : 'pointer', opacity: submitting || !token ? 0.7 : 1 }}
            >
              {submitting ? 'Updating…' : 'Update password'}
            </button>
            <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: '#5C5C60' }}>
              <a href="/login" style={{ color: '#5b6cf9', textDecoration: 'none', fontWeight: 600 }}>← Back to sign in</a>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
