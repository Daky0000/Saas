import { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com') ? '' : rawApiBaseUrl.replace(/\/$/, '');

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function OAuthCallback() {
  const [status, setStatus] = useState<'working' | 'error'>('working');
  const [message, setMessage] = useState<string>('Connecting...');

  const info = useMemo(() => {
    const parts = window.location.pathname.split('/').filter(Boolean);
    const platform = parts[1] ? String(parts[1]).trim().toLowerCase() : '';
    const params = new URLSearchParams(window.location.search);
    return {
      platform,
      code: String(params.get('code') || ''),
      state: String(params.get('state') || ''),
      error: String(params.get('error') || ''),
      errorDescription: String(params.get('error_description') || ''),
    };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        if (!info.platform) throw new Error('Missing platform in callback URL');
        if (info.error) throw new Error(info.errorDescription || info.error);
        if (!info.code || !info.state) throw new Error('Missing code or state');

        const res = await fetch(`${API_BASE_URL}/api/oauth/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ platform: info.platform, code: info.code, state: info.state }),
        });

        const text = await res.text();
        let data: any = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = null; }
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || 'OAuth callback failed');
        }

        const returnTo = typeof data?.returnTo === 'string' ? data.returnTo : '';
        const redirectPath = returnTo && returnTo.startsWith('/') ? returnTo : '/integrations?success=true';
        window.location.replace(redirectPath);
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'OAuth connection failed');
      }
    })();
  }, [info]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center">
        {status === 'working' ? (
          <>
            <div className="flex items-center justify-center">
              <Loader2 size={24} className="animate-spin text-slate-400" />
            </div>
            <div className="mt-3 text-sm font-semibold text-slate-800">{message}</div>
            <div className="mt-1 text-xs text-slate-500">You will be redirected automatically.</div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-center gap-2 text-red-700">
              <AlertCircle size={18} />
              <div className="text-sm font-bold">Connection failed</div>
            </div>
            <div className="mt-2 text-sm text-slate-700">{message}</div>
            <a href="/integrations" className="mt-4 inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              Back to Integrations
            </a>
          </>
        )}
      </div>
    </div>
  );
}
