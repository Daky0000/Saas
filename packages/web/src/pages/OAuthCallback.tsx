import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../utils/apiBase';

const SUPPORTED_PLATFORMS = new Set([
  'facebook',
  'instagram',
  'linkedin',
  'twitter',
  'pinterest',
  'tiktok',
  'threads',
]);

type Status = 'connecting' | 'success' | 'error';

const parsePlatformFromPath = (pathname: string) => {
  const match = pathname.match(/^\/auth\/([^/]+)\/callback/i);
  return match ? match[1].toLowerCase() : '';
};

export default function OAuthCallback() {
  const [status, setStatus] = useState<Status>('connecting');
  const [message, setMessage] = useState('Finishing connection…');

  useEffect(() => {
    const platform = parsePlatformFromPath(window.location.pathname);
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get('error') || params.get('error_description') || '';
    const code = params.get('code') || '';
    const state = params.get('state') || '';

    if (!platform || !SUPPORTED_PLATFORMS.has(platform)) {
      setStatus('error');
      setMessage('Unsupported integration callback.');
      return;
    }

    if (errorParam) {
      setStatus('error');
      setMessage(decodeURIComponent(errorParam));
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setMessage('Missing OAuth parameters. Please try connecting again.');
      return;
    }

    const token = localStorage.getItem('auth_token');
    if (!token) {
      setStatus('error');
      setMessage('Your session expired. Please log in and try again.');
      return;
    }

    fetch(`${API_BASE_URL}/api/oauth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ platform, code, state }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok || data?.success === false) {
          throw new Error(data?.error || 'Connection failed');
        }
        const returnTo = typeof data?.returnTo === 'string' ? data.returnTo : '/integrations';
        setStatus('success');
        setMessage('Connected! Redirecting…');
        window.location.replace(returnTo.startsWith('/') ? returnTo : '/integrations');
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Connection failed');
      });
  }, []);

  return (
    <div className="min-h-[60vh] rounded-2xl border border-slate-200 bg-white p-8 text-center">
      <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">OAuth Callback</div>
      <div className="mt-3 text-2xl font-black text-slate-900">
        {status === 'connecting' ? 'Connecting…' : status === 'success' ? 'Success' : 'Something went wrong'}
      </div>
      <p className="mt-3 text-sm text-slate-600">{message}</p>
      {status === 'error' ? (
        <button
          type="button"
          onClick={() => window.location.replace('/integrations')}
          className="mt-5 inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Back to Integrations
        </button>
      ) : null}
    </div>
  );
}
