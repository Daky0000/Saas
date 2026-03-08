import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  DollarSign,
  Eye,
  EyeOff,
  RefreshCw,
  XCircle,
} from 'lucide-react';

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com') ? '' : rawApiBaseUrl.replace(/\/$/, '');

const authHeaders = () => {
  const token = localStorage.getItem('auth_token');
  return {
    Authorization: `Bearer ${token ?? ''}`,
    'Content-Type': 'application/json',
  };
};

// ── Types ────────────────────────────────────────────────────────────────────

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
  updated_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const statusBadge = (status: PaymentTransaction['status']) => {
  switch (status) {
    case 'successful':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
          <CheckCircle2 size={12} /> Successful
        </span>
      );
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
          <Clock size={12} /> Pending
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-600">
          <XCircle size={12} /> Failed
        </span>
      );
  }
};

const fmt = (n: number) =>
  new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 }).format(n);

// ── Component ─────────────────────────────────────────────────────────────────

const PaymentManagement = () => {
  // Config state
  const [config, setConfig] = useState<HubtelConfig>({ clientId: '', clientSecret: '', merchantAccountNumber: '' });
  const [showSecret, setShowSecret] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSuccess, setConfigSuccess] = useState(false);

  // Stats & transactions state
  const [stats, setStats] = useState<PaymentStats | null>(null);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | PaymentTransaction['status']>('all');

  // ── Load Hubtel config ──────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setConfigLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/hubtel`, {
          headers: authHeaders(),
        });
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

  // ── Save Hubtel config ──────────────────────────────────────────────────────
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
      setTimeout(() => setConfigSuccess(false), 3000);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setConfigSaving(false);
    }
  };

  const filteredTransactions = statusFilter === 'all'
    ? transactions
    : transactions.filter((t) => t.status === statusFilter);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 p-6 md:p-8">

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

      {/* ── Hubtel Configuration ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">Hubtel Configuration</h2>
            <p className="mt-1 text-sm text-slate-500">
              Enter your Hubtel API credentials. Get them from the{' '}
              <span className="font-semibold text-slate-700">Hubtel Merchant Dashboard → API Keys</span>.
            </p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#00a859] text-white font-black text-lg">H</div>
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
                  placeholder="Your Hubtel Client ID"
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none focus:border-slate-400"
                />
                <p className="text-xs text-slate-500">Found in Hubtel dashboard under API Keys.</p>
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
                <p className="text-xs text-slate-500">Keep this value secure.</p>
              </label>
            </div>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-800">Merchant Account Number</span>
              <input
                type="text"
                value={config.merchantAccountNumber}
                onChange={(e) => setConfig((c) => ({ ...c, merchantAccountNumber: e.target.value }))}
                placeholder="e.g. 2024XXXX"
                className="h-12 w-full max-w-sm rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none focus:border-slate-400"
              />
              <p className="text-xs text-slate-500">Your Hubtel merchant account number (used for initiating payments).</p>
            </label>

            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-600 space-y-1">
              <p className="font-semibold text-slate-800">Callback URL (add to your Hubtel app)</p>
              <code className="block rounded-lg bg-white border border-slate-200 px-3 py-2 font-mono text-slate-700">
                https://contentflow-api.onrender.com/api/payments/hubtel/callback
              </code>
            </div>

            {configError && (
              <p className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
                <AlertCircle size={16} /> {configError}
              </p>
            )}
            {configSuccess && (
              <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                <CheckCircle2 size={16} /> Hubtel credentials saved successfully.
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void saveConfig()}
                disabled={configSaving}
                className="rounded-2xl bg-slate-950 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
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
          <div className="space-y-px p-4">
            {[1, 2, 3].map((n) => <div key={n} className="h-14 animate-pulse rounded-xl bg-slate-50" />)}
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">No transactions yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500">
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
                  <tr key={tx.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-800">{tx.customer_name || '—'}</div>
                      {tx.customer_phone && <div className="text-xs text-slate-500">{tx.customer_phone}</div>}
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-900">{fmt(tx.amount)}</td>
                    <td className="px-6 py-4 text-slate-600">{tx.description || '—'}</td>
                    <td className="px-6 py-4">{statusBadge(tx.status)}</td>
                    <td className="px-6 py-4">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {tx.client_reference?.slice(0, 8) ?? '—'}
                      </code>
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {new Date(tx.created_at).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })}
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
