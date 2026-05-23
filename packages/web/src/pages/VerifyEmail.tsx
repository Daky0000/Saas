import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../utils/apiBase';

export default function VerifyEmail() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Token is in the hash fragment (#token=...) so it's never sent to servers
    // or recorded in access logs / Referer headers.
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('token');
    if (!token) {
      setStatus('error');
      setMessage('No verification token found. Please use the link from your email.');
      return;
    }
    fetch(`${API_BASE_URL}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(r => r.json())
      .then((data: { success: boolean; error?: string; message?: string }) => {
        if (data.success) {
          setStatus('success');
          setMessage(data.message ?? 'Email verified successfully!');
        } else {
          setStatus('error');
          setMessage(data.error ?? 'Verification failed. The link may have expired.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Network error. Please try again.');
      });
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FBFBFA', padding: 24, fontFamily: 'Inter, -apple-system, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 400, background: '#fff', borderRadius: 20, border: '1px solid rgba(0,0,0,0.08)', padding: 40, boxShadow: '0 4px 32px rgba(0,0,0,0.06)', textAlign: 'center' }}>
        {status === 'loading' && (
          <>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" style={{ animation: 'spin 1s linear infinite' }}><circle cx="11" cy="11" r="9" stroke="#5b6cf9" strokeWidth="2" strokeDasharray="28 14" strokeLinecap="round"/></svg>
            </div>
            <p style={{ fontSize: 15, color: '#5C5C60' }}>Verifying your email…</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="10" stroke="#16a34a" strokeWidth="1.5"/><path d="M6.5 11.5 L9.5 14.5 L15.5 8" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0A0A0B', marginBottom: 8 }}>Email verified!</h1>
            <p style={{ fontSize: 14, color: '#5C5C60', marginBottom: 28, lineHeight: 1.5 }}>{message}</p>
            <a href="/dashboard" style={{ display: 'inline-block', background: '#5b6cf9', color: '#fff', borderRadius: 10, padding: '11px 28px', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>Go to dashboard</a>
          </>
        )}
        {status === 'error' && (
          <>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="10" stroke="#dc2626" strokeWidth="1.5"/><path d="M7.5 7.5 L14.5 14.5 M14.5 7.5 L7.5 14.5" stroke="#dc2626" strokeWidth="2" strokeLinecap="round"/></svg>
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0A0A0B', marginBottom: 8 }}>Verification failed</h1>
            <p style={{ fontSize: 14, color: '#5C5C60', marginBottom: 28, lineHeight: 1.5 }}>{message}</p>
            <a href="/login" style={{ display: 'inline-block', background: '#5b6cf9', color: '#fff', borderRadius: 10, padding: '11px 28px', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>Back to sign in</a>
          </>
        )}
      </div>
    </div>
  );
}
