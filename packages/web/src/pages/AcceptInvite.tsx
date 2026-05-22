import { useEffect, useState } from 'react';
import { Building2, CheckCircle, Loader2, XCircle } from 'lucide-react';
import { API_BASE_URL } from '../utils/apiBase';

type InviteDetails = {
  id: string;
  email: string;
  role: string;
  org_name: string;
  org_id: string;
  invited_by_name: string | null;
  expires_at: string;
};

type Props = {
  token: string;
  onLoginClick: () => void;
};

export default function AcceptInvite({ token, onLoginClick }: Props) {
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const isLoggedIn = Boolean(localStorage.getItem('auth_token'));

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/v1/invitations/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setInvite(data.invitation);
        else setLoadError(data.error || 'Invitation not found');
      })
      .catch(() => setLoadError('Failed to load invitation'));
  }, [token]);

  const accept = async () => {
    const authToken = localStorage.getItem('auth_token');
    if (!authToken) { onLoginClick(); return; }
    setAccepting(true);
    setAcceptError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/invitations/${token}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to accept invitation');
      setAccepted(true);
      setTimeout(() => {
        window.history.pushState({}, '', '/dashboard');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, 2000);
    } catch (e: any) {
      setAcceptError(e.message);
    } finally {
      setAccepting(false);
    }
  };

  if (!invite && !loadError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-8 text-center space-y-4 shadow-sm">
          <XCircle className="h-12 w-12 text-red-400 mx-auto" />
          <h1 className="text-xl font-bold text-slate-900">Invitation unavailable</h1>
          <p className="text-sm text-slate-500">{loadError}</p>
          <button
            type="button"
            onClick={() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); }}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Go to home
          </button>
        </div>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-8 text-center space-y-4 shadow-sm">
          <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto" />
          <h1 className="text-xl font-bold text-slate-900">You're in!</h1>
          <p className="text-sm text-slate-500">
            You've joined <span className="font-semibold text-slate-800">{invite!.org_name}</span>. Redirecting to your dashboard…
          </p>
        </div>
      </div>
    );
  }

  const roleCap = invite!.role.charAt(0).toUpperCase() + invite!.role.slice(1);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-8 shadow-sm space-y-6">
        <div className="text-center space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600">
            <Building2 className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">You're invited!</h1>
          {invite!.invited_by_name && (
            <p className="text-sm text-slate-500">
              <span className="font-semibold text-slate-800">{invite!.invited_by_name}</span> invited you to join
            </p>
          )}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
            <p className="text-lg font-bold text-slate-900">{invite!.org_name}</p>
            <p className="mt-1 text-sm text-slate-500">
              as <span className="font-semibold text-slate-700">{roleCap}</span>
            </p>
          </div>
          <p className="text-xs text-slate-400">
            This invite was sent to <span className="font-semibold">{invite!.email}</span>
          </p>
        </div>

        {acceptError && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 text-center">{acceptError}</p>
        )}

        <div className="space-y-3">
          {!isLoggedIn && (
            <p className="text-center text-sm text-slate-500">
              You need to be logged in to accept this invitation.
            </p>
          )}
          <button
            type="button"
            onClick={accept}
            disabled={accepting}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {accepting && <Loader2 size={15} className="animate-spin" />}
            {accepting ? 'Joining…' : isLoggedIn ? 'Accept invitation' : 'Log in to accept'}
          </button>
        </div>
      </div>
    </div>
  );
}
