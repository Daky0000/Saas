import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, ExternalLink, Info, Mail, ShieldCheck } from 'lucide-react';

type DeletionStatusResponse =
  | { success: true; data: { code: string; status: 'received' | 'completed' | 'unknown'; createdAt: string; completedAt: string | null } }
  | { success: false; error?: string };

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com') ? '' : rawApiBaseUrl.replace(/\/$/, '');

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-[32px] border border-slate-200 bg-white p-6 md:p-8">
    <h2 className="text-xl font-black tracking-[-0.02em] text-slate-950">{title}</h2>
    <div className="mt-4 space-y-4 text-sm leading-6 text-slate-600">{children}</div>
  </section>
);

const InlineCode = ({ children }: { children: string }) => (
  <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[12px] text-slate-800">
    {children}
  </span>
);

export default function DataDeletion() {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://yourdomain.com';

  const urls = useMemo(() => {
    const apiBase = API_BASE_URL || origin;
    return {
      instructionsUrl: `${origin}/data-deletion`,
      callbackUrl: `${apiBase}/api/meta/data-deletion`,
      statusUrl: `${apiBase}/api/meta/data-deletion/status`,
    };
  }, [origin]);

  const [code, setCode] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'received' | 'completed' | 'unknown' | 'not_found' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = (params.get('code') || '').trim();
    setCode(c);
    if (!c) return;

    let canceled = false;
    setStatus('loading');
    (async () => {
      try {
        const res = await fetch(`${urls.statusUrl}?code=${encodeURIComponent(c)}`);
        const data = (await res.json()) as DeletionStatusResponse;
        if (canceled) return;
        if (!data.success) {
          setStatus(res.status === 404 ? 'not_found' : 'error');
          setStatusMessage(data.error || 'Could not load status');
          return;
        }
        setStatus(data.data.status);
        setStatusMessage('');
      } catch (err) {
        if (canceled) return;
        setStatus('error');
        setStatusMessage(err instanceof Error ? err.message : 'Could not load status');
      }
    })();

    return () => {
      canceled = true;
    };
  }, [urls.statusUrl]);

  const supportEmail = (import.meta.env.VITE_SUPPORT_EMAIL || 'support@yourdomain.com').trim();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 px-4 py-10">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <div className="rounded-[32px] border border-slate-200 bg-white px-6 py-6 md:px-8">
          <h1 className="text-[2.2rem] font-black tracking-[-0.03em] text-slate-950">Data Deletion</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500 md:text-base">
            This page explains how to request deletion of your data and provides the URLs Meta requires for apps that access user data.
          </p>
        </div>

        <Card title="Meta Developer Settings (Copy/Paste)">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 text-slate-400"><Info size={16} /></div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900">Use these URLs in your Meta app settings</div>
                <div className="mt-2 space-y-2 text-sm text-slate-700">
                  <div>
                    <div className="text-xs font-bold text-slate-600">Data Deletion Instructions URL</div>
                    <InlineCode>{urls.instructionsUrl}</InlineCode>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-600">Data Deletion Request URL (Callback)</div>
                    <InlineCode>{urls.callbackUrl}</InlineCode>
                  </div>
                </div>
                <div className="mt-3 text-xs text-slate-500">
                  Meta will send a <InlineCode>signed_request</InlineCode> to the callback URL. We return a confirmation code and a status URL.
                </div>
              </div>
            </div>
          </div>
          <a
            href="https://developers.facebook.com/docs/apps/delete-data/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-900 hover:bg-slate-50"
          >
            Official Meta docs <ExternalLink size={16} className="text-slate-400" />
          </a>
        </Card>

        <Card title="For Users: How to Request Deletion">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-slate-400"><ShieldCheck size={16} /></div>
            <div className="min-w-0">
              <div className="text-sm text-slate-700">
                Email us from the address you used in the app and include:
              </div>
              <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
                <li>Your account email</li>
                <li>Which Meta-connected accounts you want removed (Facebook/Instagram/Threads)</li>
                <li>Any relevant screenshots or error messages (optional)</li>
              </ul>
              <div className="mt-3">
                <a
                  href={`mailto:${encodeURIComponent(supportEmail)}?subject=${encodeURIComponent('Data deletion request')}`}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
                >
                  <Mail size={16} /> Email support
                </a>
                <div className="mt-2 text-xs text-slate-500">Contact: <InlineCode>{supportEmail}</InlineCode></div>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Request Status (If You Have a Confirmation Code)">
          {!code && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              If Meta redirected you here after a deletion request, you’ll have a <InlineCode>code</InlineCode> in the URL.
            </div>
          )}

          {code && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-bold text-slate-600">Confirmation code</div>
              <div className="mt-1 text-sm"><InlineCode>{code}</InlineCode></div>

              <div className="mt-4 flex items-start gap-3">
                <div className="mt-0.5 text-slate-400">
                  {status === 'completed' ? <CheckCircle2 size={16} /> : <Clock size={16} />}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900">
                    {status === 'loading' && 'Loading status…'}
                    {status === 'received' && 'Request received'}
                    {status === 'completed' && 'Request completed'}
                    {status === 'unknown' && 'Status unknown'}
                    {status === 'not_found' && 'Code not found'}
                    {status === 'error' && 'Could not load status'}
                    {status === 'idle' && '—'}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {status === 'received' && 'Your request is recorded. If you need help, email support with this code.'}
                    {status === 'completed' && 'We completed best-effort deletion for any data we can match automatically.'}
                    {status === 'unknown' && 'We recorded your request, but we could not determine the current status.'}
                    {status === 'not_found' && 'This confirmation code does not exist (or has not been recorded yet).'}
                    {status === 'error' && (statusMessage || 'Please try again later.')}
                  </div>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
