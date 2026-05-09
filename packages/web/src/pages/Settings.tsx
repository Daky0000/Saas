import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import {
  Bell,
  Camera,
  Check,
  CreditCard,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Save,
  Shield,
  Trash2,
  User,
} from 'lucide-react';
import { AppUser, normalizeUser } from '../utils/userSession';
import { mediaService } from '../services/mediaService';
import { compressImage } from '../utils/imageCompression';
import { API_BASE_URL } from '../utils/apiBase';

// ─── types ────────────────────────────────────────────────────────────────────

type SettingsProps = {
  currentUser: AppUser | null;
  onUserUpdated: (user: AppUser) => void;
  onNavigateToBilling?: () => void;
};

type ProfileForm = {
  name: string; username: string; email: string;
  phone: string; country: string; website: string;
  bio: string; avatar: string; cover: string;
};

type NotifPrefs = {
  post_published: boolean;
  team_activity: boolean;
  billing_alerts: boolean;
  weekly_digest: boolean;
  marketing_emails: boolean;
};

type BillingSummary = {
  plan_name: string;
  status: string;
  posts_this_period: number;
  posts_limit: number;
  current_period_end: string | null;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

const tok = () => localStorage.getItem('auth_token') ?? '';
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

async function safeJson<T>(r: Response): Promise<T | null> {
  try { return (await r.json()) as T; } catch { return null; }
}

const defaultCover = 'linear-gradient(135deg, rgba(15,23,42,0.88), rgba(37,99,235,0.72) 42%, rgba(56,189,248,0.62) 100%)';

function toForm(u: AppUser | null): ProfileForm {
  return {
    name: u?.name ?? '', username: u?.username ?? '', email: u?.email ?? '',
    phone: u?.phone ?? '', country: u?.country ?? '', website: u?.website ?? '',
    bio: '', avatar: u?.avatar ?? '', cover: u?.cover ?? '',
  };
}

const DEFAULT_NOTIFS: NotifPrefs = {
  post_published: true, team_activity: true,
  billing_alerts: true, weekly_digest: false, marketing_emails: false,
};

// ─── sub-components ───────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${checked ? 'bg-indigo-600' : 'bg-slate-200'}`}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-6 ${className}`}>
      {children}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function Settings({ currentUser, onUserUpdated, onNavigateToBilling }: SettingsProps) {
  const [tab, setTab] = useState<'account' | 'security' | 'notifications' | 'billing'>('account');

  // ── Account tab ──────────────────────────────────────────────────────────
  const [form, setForm] = useState<ProfileForm>(() => toForm(currentUser));
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploadingField, setUploadingField] = useState<'avatar' | 'cover' | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setForm(toForm(currentUser)); }, [currentUser]);

  const setField = (k: keyof ProfileForm, v: string) => {
    setForm((p) => ({ ...p, [k]: v }));
    setProfileMsg(null);
  };

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>, field: 'avatar' | 'cover') => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingField(field);
      const compressed = await compressImage(file);
      const saved = await mediaService.upload({
        url: compressed.url, thumbnail_url: compressed.thumbnail_url,
        file_name: `${field}-${Date.now()}-${file.name}`, original_name: file.name,
        file_size: compressed.file_size, file_type: compressed.file_type,
        width: compressed.width, height: compressed.height, force: true,
      });
      setField(field, saved.url);
    } catch (err) {
      const dup = err as Error & { isDuplicate?: boolean; existingImage?: { url?: string } };
      if (dup?.isDuplicate && dup.existingImage?.url) setField(field, dup.existingImage.url);
      else setProfileMsg({ ok: false, text: err instanceof Error ? err.message : 'Upload failed' });
    } finally {
      setUploadingField(null);
      e.target.value = '';
    }
  };

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.username.trim() || !form.email.trim()) {
      setProfileMsg({ ok: false, text: 'Name, username, and email are required.' });
      return;
    }
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({
          name: form.name.trim(), username: form.username.trim(), email: form.email.trim(),
          phone: form.phone.trim(), country: form.country.trim(), website: form.website.trim(),
          avatar: form.avatar, cover: form.cover,
        }),
      });
      type PR = { success: boolean; error?: string; user?: Partial<AppUser> & { id?: string; email?: string } };
      const data = await safeJson<PR>(r);
      if (!r.ok || !data?.success || !data.user?.id || !data.user?.email) {
        throw new Error(data?.error ?? 'Failed to save profile');
      }
      const updated = normalizeUser({
        id: data.user.id, email: data.user.email,
        name: data.user.name ?? null, username: data.user.username ?? null,
        phone: data.user.phone ?? null, country: data.user.country ?? null,
        website: data.user.website ?? null,
        role: data.user.role === 'admin' ? 'admin' : 'user',
        avatar: data.user.avatar ?? null, cover: data.user.cover ?? null,
      });
      onUserUpdated(updated);
      setProfileMsg({ ok: true, text: 'Profile saved.' });
    } catch (err) {
      setProfileMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Security tab ─────────────────────────────────────────────────────────
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (newPw !== confirmPw) { setPwMsg({ ok: false, text: 'New passwords do not match.' }); return; }
    if (newPw.length < 8) { setPwMsg({ ok: false, text: 'New password must be at least 8 characters.' }); return; }
    setChangingPw(true);
    setPwMsg(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      const data = await safeJson<{ success: boolean; error?: string }>(r);
      if (!r.ok || !data?.success) throw new Error(data?.error ?? 'Failed to change password');
      setPwMsg({ ok: true, text: 'Password changed successfully.' });
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err) {
      setPwMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setChangingPw(false);
    }
  };

  // ── Notifications tab ────────────────────────────────────────────────────
  const [notifs, setNotifs] = useState<NotifPrefs>(DEFAULT_NOTIFS);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const [savingNotifs, setSavingNotifs] = useState(false);
  const [notifMsg, setNotifMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (tab !== 'notifications') return;
    setLoadingNotifs(true);
    fetch(`${API_BASE_URL}/api/user-settings/notification_preferences`, { headers: authHdr() })
      .then((r) => r.json())
      .then((d: { value?: NotifPrefs }) => { if (d.value) setNotifs({ ...DEFAULT_NOTIFS, ...d.value }); })
      .catch(() => undefined)
      .finally(() => setLoadingNotifs(false));
  }, [tab]);

  const saveNotifs = async () => {
    setSavingNotifs(true);
    setNotifMsg(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/user-settings/notification_preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ value: notifs }),
      });
      if (!r.ok) throw new Error('Save failed');
      setNotifMsg({ ok: true, text: 'Preferences saved.' });
    } catch {
      setNotifMsg({ ok: false, text: 'Failed to save preferences.' });
    } finally {
      setSavingNotifs(false);
    }
  };

  const NOTIF_ROWS: { key: keyof NotifPrefs; label: string; desc: string }[] = [
    { key: 'post_published', label: 'Post published', desc: 'When a scheduled post goes live' },
    { key: 'team_activity', label: 'Team activity', desc: 'Member joins, role changes, invitations' },
    { key: 'billing_alerts', label: 'Billing alerts', desc: 'Payment failures, plan changes, renewals' },
    { key: 'weekly_digest', label: 'Weekly digest', desc: 'Summary of your activity every Monday' },
    { key: 'marketing_emails', label: 'Product updates', desc: 'New features, tips, and announcements' },
  ];

  // ── Billing tab ──────────────────────────────────────────────────────────
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [loadingBilling, setLoadingBilling] = useState(false);

  useEffect(() => {
    if (tab !== 'billing') return;
    setLoadingBilling(true);
    fetch(`${API_BASE_URL}/api/billing/subscription`, { headers: authHdr() })
      .then((r) => r.json())
      .then((d: { plan?: { name?: string }; subscription?: { status?: string; current_period_end?: string }; usage?: { posts_this_period?: number; posts_limit?: number } }) => {
        setBilling({
          plan_name: d.plan?.name ?? 'Free Plan',
          status: d.subscription?.status ?? 'active',
          posts_this_period: d.usage?.posts_this_period ?? 0,
          posts_limit: d.usage?.posts_limit ?? 0,
          current_period_end: d.subscription?.current_period_end ?? null,
        });
      })
      .catch(() => undefined)
      .finally(() => setLoadingBilling(false));
  }, [tab]);

  // ── render ────────────────────────────────────────────────────────────────

  const TABS = [
    { id: 'account', label: 'Account', icon: User },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'billing', label: 'Billing', icon: CreditCard },
  ] as const;

  const inputCls = 'h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition';
  const msgCls = (ok: boolean) => `mt-3 rounded-xl border px-4 py-2.5 text-sm ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`;

  return (
    <div className="pb-10">
      {/* header */}
      <div className="mb-6">
        <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Settings</h1>
        <p className="mt-2 text-base text-slate-500">Manage your account, security, and preferences.</p>
      </div>

      {/* tab bar */}
      <div className="mb-6 flex gap-1 rounded-2xl border border-slate-200 bg-white p-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors ${tab === id ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
          >
            <Icon size={14} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* ── Account ── */}
      {tab === 'account' && (
        <form onSubmit={(e) => void saveProfile(e)} className="space-y-5">
          {/* cover + avatar */}
          <SectionCard className="p-0 overflow-hidden">
            <div className="relative h-40">
              <div
                className="absolute inset-0"
                style={form.cover
                  ? { backgroundImage: `url("${form.cover}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : { backgroundImage: defaultCover }}
              />
              <div className="absolute inset-0 bg-black/10" />
              <button
                type="button"
                onClick={() => coverRef.current?.click()}
                className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-xl bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-800 backdrop-blur"
              >
                <ImageIcon size={13} />
                {uploadingField === 'cover' ? 'Uploading…' : 'Change cover'}
              </button>
              <input ref={coverRef} type="file" accept="image/*" onChange={(e) => void handleImageUpload(e, 'cover')} className="hidden" />
            </div>
            <div className="px-6 pb-6">
              <div className="-mt-12 flex items-end gap-4">
                <div className="relative h-24 w-24 shrink-0 rounded-full border-4 border-white bg-slate-100 shadow">
                  {form.avatar
                    ? <img src={form.avatar} alt={form.name} className="h-full w-full rounded-full object-cover" />
                    : <div className="flex h-full w-full items-center justify-center rounded-full text-slate-400"><User size={30} /></div>
                  }
                  <button
                    type="button"
                    onClick={() => avatarRef.current?.click()}
                    className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-950 text-white"
                  >
                    <Camera size={14} />
                  </button>
                  <input ref={avatarRef} type="file" accept="image/*" onChange={(e) => void handleImageUpload(e, 'avatar')} className="hidden" />
                </div>
                <div className="pb-1">
                  <p className="text-lg font-black text-slate-950">{form.name || 'Your name'}</p>
                  <p className="text-sm text-slate-500">@{form.username || 'username'}</p>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* fields */}
          <SectionCard>
            <h2 className="mb-4 text-lg font-black text-slate-950">Personal information</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {([
                { key: 'name', label: 'Full name', type: 'text' },
                { key: 'username', label: 'Username', type: 'text' },
                { key: 'email', label: 'Email address', type: 'email' },
                { key: 'phone', label: 'Phone number', type: 'tel' },
                { key: 'country', label: 'Country', type: 'text' },
                { key: 'website', label: 'Website', type: 'url' },
              ] as { key: keyof ProfileForm; label: string; type: string }[]).map(({ key, label, type }) => (
                <label key={key} className="block space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</span>
                  <input
                    type={type}
                    value={form[key]}
                    onChange={(e) => setField(key, e.target.value)}
                    className={inputCls}
                  />
                </label>
              ))}
            </div>
            <label className="mt-4 block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Bio</span>
              <textarea
                rows={4}
                value={form.bio}
                onChange={(e) => setField('bio', e.target.value)}
                placeholder="Tell your audience what you do…"
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition"
              />
            </label>
            {profileMsg && <p className={msgCls(profileMsg.ok)}>{profileMsg.text}</p>}
          </SectionCard>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingProfile || uploadingField !== null}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {savingProfile ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {savingProfile ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      )}

      {/* ── Security ── */}
      {tab === 'security' && (
        <div className="space-y-5">
          <SectionCard>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100">
                <KeyRound size={16} className="text-indigo-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Change password</p>
                <p className="text-xs text-slate-500">Use a strong password you don't use elsewhere</p>
              </div>
            </div>
            <form onSubmit={(e) => void changePassword(e)} className="space-y-3">
              {([
                { label: 'Current password', val: currentPw, set: setCurrentPw },
                { label: 'New password', val: newPw, set: setNewPw },
                { label: 'Confirm new password', val: confirmPw, set: setConfirmPw },
              ] as { label: string; val: string; set: (v: string) => void }[]).map(({ label, val, set }) => (
                <label key={label} className="block space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</span>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={val}
                      onChange={(e) => { set(e.target.value); setPwMsg(null); }}
                      className={`${inputCls} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    >
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </label>
              ))}
              {pwMsg && <p className={msgCls(pwMsg.ok)}>{pwMsg.text}</p>}
              <button
                type="submit"
                disabled={changingPw || !currentPw || !newPw || !confirmPw}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {changingPw ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {changingPw ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </SectionCard>

          {/* danger zone */}
          <SectionCard className="border-red-200">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-100">
                <Trash2 size={16} className="text-red-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Delete account</p>
                <p className="text-xs text-slate-500">Permanently remove your account and all data</p>
              </div>
            </div>
            <p className="mb-4 text-sm text-slate-600 leading-relaxed">
              Once deleted, all your posts, designs, integrations, and billing history will be gone. This action is irreversible.
            </p>
            <a
              href="/data-deletion"
              onClick={(e) => {
                e.preventDefault();
                window.history.pushState({}, '', '/data-deletion');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-bold text-red-700 hover:bg-red-100 transition-colors"
            >
              <Trash2 size={14} /> Request account deletion
            </a>
          </SectionCard>
        </div>
      )}

      {/* ── Notifications ── */}
      {tab === 'notifications' && (
        <div className="space-y-5">
          <SectionCard>
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100">
                <Bell size={16} className="text-indigo-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Email notifications</p>
                <p className="text-xs text-slate-500">Choose which emails you receive</p>
              </div>
            </div>
            {loadingNotifs
              ? <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-slate-300" /></div>
              : (
                <div className="divide-y divide-slate-100">
                  {NOTIF_ROWS.map(({ key, label, desc }) => (
                    <div key={key} className="flex items-center justify-between py-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{label}</p>
                        <p className="text-xs text-slate-500">{desc}</p>
                      </div>
                      <Toggle
                        checked={notifs[key]}
                        onChange={(v) => setNotifs((p) => ({ ...p, [key]: v }))}
                      />
                    </div>
                  ))}
                </div>
              )
            }
            {notifMsg && <p className={msgCls(notifMsg.ok)}>{notifMsg.text}</p>}
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => void saveNotifs()}
                disabled={savingNotifs || loadingNotifs}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {savingNotifs ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {savingNotifs ? 'Saving…' : 'Save preferences'}
              </button>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Billing ── */}
      {tab === 'billing' && (
        <div className="space-y-5">
          <SectionCard>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100">
                <CreditCard size={16} className="text-indigo-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Current plan</p>
                <p className="text-xs text-slate-500">Your subscription and usage</p>
              </div>
            </div>

            {loadingBilling
              ? <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-slate-300" /></div>
              : billing
                ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
                      <div>
                        <p className="text-xl font-black text-slate-950">{billing.plan_name}</p>
                        <p className="mt-0.5 text-xs font-semibold capitalize text-slate-500">{billing.status}</p>
                      </div>
                      {billing.current_period_end && (
                        <p className="text-right text-xs text-slate-400">
                          Renews<br />
                          <span className="font-semibold text-slate-700">
                            {new Date(billing.current_period_end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        </p>
                      )}
                    </div>

                    {billing.posts_limit > 0 && (
                      <div>
                        <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-500">
                          <span>Posts this period</span>
                          <span>{billing.posts_this_period} / {billing.posts_limit}</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-2 rounded-full bg-indigo-600 transition-all"
                            style={{ width: `${Math.min(100, (billing.posts_this_period / billing.posts_limit) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex gap-3 pt-1">
                      <button
                        type="button"
                        onClick={onNavigateToBilling}
                        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 transition-colors"
                      >
                        <CreditCard size={14} /> Manage billing
                      </button>
                    </div>
                  </div>
                )
                : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
                    <p className="text-sm font-black text-slate-950">Free Plan</p>
                    <p className="mt-1 text-xs text-slate-500">Upgrade to unlock more posts, team members, and integrations.</p>
                    <button
                      type="button"
                      onClick={onNavigateToBilling}
                      className="mt-3 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 transition-colors"
                    >
                      View plans
                    </button>
                  </div>
                )
            }
          </SectionCard>
        </div>
      )}
    </div>
  );
}
