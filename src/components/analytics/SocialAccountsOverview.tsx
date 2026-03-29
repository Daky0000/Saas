import { useEffect, useState } from 'react';
import { Loader2, Users, TrendingUp, Eye, MessageSquare } from 'lucide-react';
import { PlatformLogo } from '../PlatformLogo';
import { socialAnalyticsService, type SocialAccount } from '../../services/socialAnalyticsService';
import { formatCompactNumber, formatPercent } from './analyticsUtils';

type Props = {
  days: number;
  onSelectAccount: (account: SocialAccount) => void;
  selectedAccountId: string | null;
};

function AccountCard({ account, selected, onClick }: { account: SocialAccount; selected: boolean; onClick: () => void }) {
  const hasMetrics = account.posts_synced > 0 || account.total_engagement > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-5 text-left transition hover:shadow-md ${
        selected
          ? 'border-slate-900 bg-slate-950 text-white shadow-md'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="shrink-0">
            <PlatformLogo platform={account.platform} size={36} />
          </div>
          <div>
            <div className={`text-sm font-bold capitalize ${selected ? 'text-white' : 'text-slate-900'}`}>
              {account.platform}
            </div>
            <div className={`text-xs truncate max-w-[140px] ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
              {account.account_name || account.handle || '—'}
            </div>
          </div>
        </div>
        {account.followers > 0 && (
          <div className="text-right shrink-0">
            <div className={`text-lg font-black tracking-tight ${selected ? 'text-white' : 'text-slate-950'}`}>
              {formatCompactNumber(account.followers)}
            </div>
            <div className={`text-xs ${selected ? 'text-slate-400' : 'text-slate-400'}`}>followers</div>
          </div>
        )}
      </div>

      <div className={`mt-4 grid grid-cols-3 gap-2 border-t pt-4 ${selected ? 'border-slate-700' : 'border-slate-100'}`}>
        <div className="text-center">
          <div className={`text-sm font-bold ${selected ? 'text-white' : 'text-slate-900'}`}>
            {formatCompactNumber(account.total_reach)}
          </div>
          <div className={`text-[10px] uppercase tracking-wide ${selected ? 'text-slate-400' : 'text-slate-400'}`}>Reach</div>
        </div>
        <div className="text-center">
          <div className={`text-sm font-bold ${selected ? 'text-white' : 'text-slate-900'}`}>
            {formatPercent(account.engagement_rate)}
          </div>
          <div className={`text-[10px] uppercase tracking-wide ${selected ? 'text-slate-400' : 'text-slate-400'}`}>Engagement</div>
        </div>
        <div className="text-center">
          <div className={`text-sm font-bold ${selected ? 'text-white' : 'text-slate-900'}`}>
            {formatCompactNumber(account.posts_synced)}
          </div>
          <div className={`text-[10px] uppercase tracking-wide ${selected ? 'text-slate-400' : 'text-slate-400'}`}>Posts</div>
        </div>
      </div>

      {!hasMetrics && (
        <div className={`mt-3 text-xs ${selected ? 'text-slate-400' : 'text-slate-400'}`}>
          No metrics yet — click Sync to pull data
        </div>
      )}
    </button>
  );
}

export default function SocialAccountsOverview({ days, onSelectAccount, selectedAccountId }: Props) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    socialAnalyticsService
      .getAccounts(days)
      .then((data) => {
        if (!alive) return;
        setAccounts(data.accounts);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Failed to load accounts');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading accounts…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-8 py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-slate-100 text-slate-500">
          <Users size={24} />
        </div>
        <h2 className="mt-5 text-2xl font-black tracking-tight text-slate-950">No connected accounts</h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-slate-500">
          Connect a social account from the Integrations page, then use Sync to pull metrics.
        </p>
        <a href="/integrations" className="mt-6 inline-flex rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
          Go to Integrations
        </a>
      </div>
    );
  }

  const totalFollowers = accounts.reduce((s, a) => s + a.followers, 0);
  const totalReach = accounts.reduce((s, a) => s + a.total_reach, 0);
  const totalEngagement = accounts.reduce((s, a) => s + a.total_engagement, 0);
  const totalPosts = accounts.reduce((s, a) => s + a.posts_synced, 0);

  return (
    <div className="space-y-6">
      {/* Aggregate KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total Followers', value: formatCompactNumber(totalFollowers), icon: <Users size={18} /> },
          { label: 'Total Reach', value: formatCompactNumber(totalReach), icon: <Eye size={18} /> },
          { label: 'Total Engagement', value: formatCompactNumber(totalEngagement), icon: <TrendingUp size={18} /> },
          { label: 'Posts Synced', value: formatCompactNumber(totalPosts), icon: <MessageSquare size={18} /> },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{kpi.label}</div>
                <div className="mt-3 text-3xl font-black tracking-tight text-slate-950">{kpi.value}</div>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                {kpi.icon}
              </div>
            </div>
            <div className="mt-4 text-xs text-slate-400">Across {accounts.length} account{accounts.length !== 1 ? 's' : ''} · last {days}d</div>
          </div>
        ))}
      </div>

      {/* Account cards */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
          Connected Accounts — click to view details
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              selected={selectedAccountId === account.id}
              onClick={() => onSelectAccount(account)}
            />
          ))}
        </div>
      </div>

      {totalPosts === 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">No metrics synced yet.</span> Use the Sync button above to pull real engagement data from your connected platforms.
        </div>
      )}
    </div>
  );
}
