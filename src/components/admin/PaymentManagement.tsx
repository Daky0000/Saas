import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  DollarSign,
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCw,
  XCircle,
} from 'lucide-react';

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com') ? '' : rawApiBaseUrl.replace(/\/$/, '');

const authHeaders = () => {
  const token = localStorage.getItem('auth_token');
  return { Authorization: `Bearer ${token ?? ''}`, 'Content-Type': 'application/json' };
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface HubtelConfig {
  clientId: string;
  clientSecret: string;
  merchantAccountNumber: string;
}

interface PaymentStats {
  total: number;
  successful: number;
  pending: number;
  failed: number;
  revenue: number;
}

interface PaymentTransaction {
  id: string;
  amount: number;
  currency: string;
  description: string | null;
  status: 'pending' | 'successful' | 'failed';
  provider: string;
  client_reference: string | null;
  provider_reference: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CALLBACK_URL = `${API_BASE_URL}/api/payments/hubtel/callback`;

const fmt = (n: number) =>
  new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 }).format(n);

const StatusBadge = ({ status }: { status: PaymentTransaction['status'] }) => {
  if (status === 'successful')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
        <CheckCircle2 size={12} /> Successful
      </span>
    );
  if (status === 'pending')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
        <Clock size={12} /> Pending
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-600">
      <XCircle size={12} /> Failed
    </span>
  );
};

// ── Setup Step ────────────────────────────────────────────────────────────────

const SetupStep = ({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="flex gap-4">
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-black text-white">
      {step}
    </div>
    <div className="pt-0.5">
      <div className="text-sm font-bold text-slate-900">{title}</div>
      <div className="mt-1 text-sm leading-6 text-slate-500">{children}</div>
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────

const PaymentManagement = () => {
  const [config, setConfig] = useState<HubtelConfig>({ clientId: '', clientSecret: '', merchantAccountNumber: '' });
  const [showSecret, setShowSecret] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSuccess, setConfigSuccess] = useState(false);

  const [stats, setStats] = useState<PaymentStats | null>(null);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | PaymentTransaction['status']>('all');

  // ── Load config ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setConfigLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/hubtel`, { headers: authHeaders() });
        const data = await res.json() as { success: boolean; config: { config: HubtelConfig } | null };
        if (data.success && data.config?.config) {
          setConfig({
            clientId: data.config.config.clientId || '',
            clientSecret: data.config.config.clientSecret || '',
            merchantAccountNumber: data.config.config.merchantAccountNumber || '',
          });
        }
      } catch { /* ignore */ } finally {
        setConfigLoading(false);
      }
    };
    void load();
  }, []);

  // ── Load stats + transactions ───────────────────────────────────────────────
  const loadTransactions = async () => {
    setTxLoading(true);
    try {
      const [statsRes, txRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/admin/payments/stats`, { headers: authHeaders() }),
        fetch(`${API_BASE_URL}/api/admin/payments`, { headers: authHeaders() }),
      ]);
      const statsData = await statsRes.json() as { success: boolean; stats: PaymentStats };
      const txData = await txRes.json() as { success: boolean; transactions: PaymentTransaction[] };
      if (statsData.success) setStats(statsData.stats);
      if (txData.success) setTransactions(txData.transactions);
    } catch { /* ignore */ } finally {
      setTxLoading(false);
    }
  };

  useEffect(() => { void loadTransactions(); }, []);

  // ── Save config ─────────────────────────────────────────────────────────────
  const saveConfig = async () => {
    setConfigSaving(true);
    setConfigError(null);
    setConfigSuccess(false);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/hubtel`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ config, enabled: true }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (!data.success) throw new Error(data.error || 'Failed to save');
      setConfigSuccess(true);
      setTimeout(() => setConfigSuccess(false), 4000);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setConfigSaving(false);
    }
  };

  const filteredTransactions = statusFilter === 'all'
    ? transactions
    : transactions.filter((t) => t.status === statusFilter);

  const isConfigured = config.clientId.length > 0 && config.clientSecret.length > 0;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 p-6 md:p-8">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-black tracking-[-0.03em] text-slate-950">Payments</h1>
        <p className="mt-1 text-sm text-slate-500">
          Configure Hubtel as your payment gateway and monitor all transactions.
        </p>
      </div>

      {/* ── Stats ────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Total Revenue', value: stats ? fmt(Number(stats.revenue)) : '—', icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Successful', value: stats?.successful ?? '—', icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Pending', value: stats?.pending ?? '—', icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Failed', value: stats?.failed ?? '—', icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.bg}`}>
                <Icon size={20} className={card.color} />
              </div>
              <div className="mt-4 text-2xl font-black text-slate-900">{card.value}</div>
              <div className="mt-0.5 text-sm text-slate-500">{card.label}</div>
            </div>
          );
        })}
      </div>

      {/* ── Hubtel Setup Guide ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00a859] text-lg font-black text-white">
                H
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">Hubtel Setup Guide</h2>
                <p className="text-sm text-slate-500">Follow these steps to go live with Hubtel payments.</p>
              </div>
            </div>
          </div>
          <a
            href="https://developers.hubtel.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          >
            <ExternalLink size={13} /> Hubtel Docs
          </a>
        </div>

        <div className="space-y-6 rounded-2xl border border-slate-100 bg-slate-50 p-5">
          <SetupStep step={1} title="Create a Hubtel merchant account">
            Go to{' '}
            <a href="https://merchant.hubtel.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-800 underline underline-offset-2">
              merchant.hubtel.com
            </a>{' '}
            and register your business. You will need a valid Ghana phone number and business registration details.
          </SetupStep>

          <SetupStep step={2} title="Get your API credentials">
            In the Hubtel Merchant Dashboard, go to{' '}
            <span className="font-semibold text-slate-800">Settings → API Keys</span>. Copy your{' '}
            <span className="font-semibold text-slate-800">Client ID</span> and{' '}
            <span className="font-semibold text-slate-800">Client Secret</span>. Also note your{' '}
            <span className="font-semibold text-slate-800">Merchant Account Number</span> from your profile.
          </SetupStep>

          <SetupStep step={3} title="Add the callback URL in Hubtel">
            In your Hubtel app settings, add this exact URL as your{' '}
            <span className="font-semibold text-slate-800">Callback / Webhook URL</span>:
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <code className="flex-1 break-all font-mono text-xs text-slate-700">{CALLBACK_URL}</code>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(CALLBACK_URL)}
                className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200"
              >
                Copy
              </button>
            </div>
          </SetupStep>

          <SetupStep step={4} title="Enter credentials below and save">
            Paste your Client ID, Client Secret, and Merchant Account Number into the form below, then click{' '}
            <span className="font-semibold text-slate-800">Save credentials</span>. Payments will go live immediately.
          </SetupStep>
        </div>
      </div>

      {/* ── Credentials Form ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">Hubtel Credentials</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {isConfigured
                ? 'Credentials are configured. Update them here if they change.'
                : 'No credentials saved yet. Fill in the fields from your Hubtel dashboard.'}
            </p>
          </div>
          {isConfigured && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <CheckCircle2 size={13} /> Configured
            </span>
          )}
        </div>

        {configLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => <div key={n} className="h-12 animate-pulse rounded-2xl bg-slate-100" />)}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-800">Client ID</span>
                <input
                  type="text"
                  value={config.clientId}
                  onChange={(e) => setConfig((c) => ({ ...c, clientId: e.target.value }))}
                  placeholder="e.g. TestClientID0001"
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none focus:border-slate-400"
                />
                <p className="text-xs text-slate-500">From Hubtel dashboard → Settings → API Keys.</p>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-800">Client Secret</span>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={config.clientSecret}
                    onChange={(e) => setConfig((c) => ({ ...c, clientSecret: e.target.value }))}
                    placeholder="Your Hubtel Client Secret"
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 pr-12 text-sm text-slate-800 outline-none focus:border-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showSecret ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <p className="text-xs text-slate-500">Keep this secret. Never share it publicly.</p>
              </label>
            </div>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-800">Merchant Account Number</span>
              <input
                type="text"
                value={config.merchantAccountNumber}
                onChange={(e) => setConfig((c) => ({ ...c, merchantAccountNumber: e.target.value }))}
                placeholder="e.g. 2024XXXX"
                className="h-12 w-full max-w-xs rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none focus:border-slate-400"
              />
              <p className="text-xs text-slate-500">
                Your Hubtel merchant account number (visible on your Hubtel profile page).
              </p>
            </label>

            {configError && (
              <p className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
                <AlertCircle size={16} /> {configError}
              </p>
            )}
            {configSuccess && (
              <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                <CheckCircle2 size={16} /> Hubtel credentials saved. Payments are now live.
              </p>
            )}

            <div className="flex justify-end border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => void saveConfig()}
                disabled={configSaving || (!config.clientId && !config.clientSecret)}
                className="rounded-2xl bg-slate-950 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
              >
                {configSaving ? 'Saving…' : 'Save credentials'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Transactions ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <h2 className="text-lg font-black text-slate-900">Transactions</h2>
            <p className="text-sm text-slate-500">{transactions.length} total</p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none"
            >
              <option value="all">All statuses</option>
              <option value="successful">Successful</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </select>
            <button
              type="button"
              onClick={() => void loadTransactions()}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
            >
              <RefreshCw size={16} className={txLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {txLoading ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3].map((n) => <div key={n} className="h-14 animate-pulse rounded-xl bg-slate-50" />)}
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="py-16 text-center">
            <DollarSign size={32} className="mx-auto text-slate-200" />
            <p className="mt-3 text-sm text-slate-400">No transactions yet</p>
            <p className="mt-1 text-xs text-slate-400">
              Once customers complete payments, they will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-6 py-3">Customer</th>
                  <th className="px-6 py-3">Amount</th>
                  <th className="px-6 py-3">Description</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Reference</th>
                  <th className="px-6 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/60">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-800">{tx.customer_name || '—'}</div>
                      {tx.customer_phone && <div className="text-xs text-slate-500">{tx.customer_phone}</div>}
                    </td>
                    <td className="px-6 py-4 font-bold text-slate-900">{fmt(tx.amount)}</td>
                    <td className="px-6 py-4 text-slate-500">{tx.description || '—'}</td>
                    <td className="px-6 py-4"><StatusBadge status={tx.status} /></td>
                    <td className="px-6 py-4">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {tx.client_reference?.slice(0, 8) ?? '—'}
                      </code>
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {new Date(tx.created_at).toLocaleDateString('en-GH', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default PaymentManagement;
