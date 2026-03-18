import { useState } from 'react';
import { ArrowRight } from 'lucide-react';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'content', label: 'Content Analytics' },
  { id: 'audience', label: 'Audience Insights' },
  { id: 'platforms', label: 'Platform Comparison' },
  { id: 'ai', label: 'AI Insights' },
  { id: 'export', label: 'Export' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function EmptyState({ title, description, actionLabel, onAction }: { title: string; description: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
      <div className="text-lg font-black text-slate-900">{title}</div>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
      >
        {actionLabel} <ArrowRight size={14} />
      </button>
    </div>
  );
}

export default function Analytics() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [dateRange, setDateRange] = useState('30days');

  const handleCreatePost = () => {
    window.history.pushState({}, '', '/posts');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const description =
    'No analytics data yet. Publish posts and connect platforms to unlock engagement, audience, and performance insights.';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-4xl font-black text-slate-900">Analytics</h1>
          <p className="mt-2 text-sm text-slate-500">Real data only. Metrics appear after you publish posts.</p>
        </div>
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          <option value="7days">Last 7 days</option>
          <option value="30days">Last 30 days</option>
          <option value="90days">Last 90 days</option>
          <option value="1year">Last year</option>
        </select>
      </div>

      <div className="flex gap-2 border-b border-slate-200 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id ? 'border-slate-950 text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <EmptyState
        title="No Data Available Yet"
        description={description}
        actionLabel="Create your first post"
        onAction={handleCreatePost}
      />
    </div>
  );
}
