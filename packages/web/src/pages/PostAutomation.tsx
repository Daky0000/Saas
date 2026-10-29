import { useCallback, useEffect, useState } from 'react';
import { Badge, PageHeader, StatGrid, StatTile } from '../components/ui';
import ScheduleCalendar from '../components/calendar/ScheduleCalendar';
import SocialTemplatesTab from '../components/automation/SocialTemplatesTab';
import AutoContentPlans from '../components/automation/AutoContentPlans';
import OnboardingAndStrategyTab from '../components/autopilot/OnboardingAndStrategyTab';
import BrandStudioTab from '../components/autopilot/BrandStudioTab';
import CreativeQueueTab from '../components/autopilot/CreativeQueueTab';
import ApprovalQueueTab from '../components/autopilot/ApprovalQueueTab';
import PublishingActivityTab from '../components/autopilot/PublishingActivityTab';
import PerformanceTab from '../components/autopilot/PerformanceTab';
import { autopilotService, type AutopilotOverview } from '../services/autopilotService';
import { useWorkspace } from '../contexts/WorkspaceContext';

type AutopilotSection =
  | 'strategy'
  | 'brand'
  | 'creative'
  | 'approvals'
  | 'calendar'
  | 'publishing'
  | 'performance'
  | 'autocontent'
  | 'social';

export default function PostAutomation() {
  const { currentOrg, currentProject } = useWorkspace();
  const [activeTab, setActiveTab] = useState<AutopilotSection>('strategy');
  const [overview, setOverview] = useState<AutopilotOverview | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const res = await autopilotService.getOverview();
      setOverview(res);
    } catch {
      // Keep page interactive even before first save
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, currentOrg?.id, currentProject?.id]);

  const tabs: Array<{ id: AutopilotSection; label: string; count?: number }> = [
    { id: 'strategy', label: 'Strategy & Setup' },
    { id: 'brand', label: 'Brand Studio' },
    { id: 'creative', label: 'Creative Queue', count: overview?.counts?.planned },
    { id: 'approvals', label: 'Approval Queue', count: overview?.counts?.review_required },
    { id: 'calendar', label: 'Calendar' },
    { id: 'publishing', label: 'Publishing & Ledger' },
    { id: 'performance', label: 'Performance', count: overview?.counts?.pending_recommendations },
    { id: 'autocontent', label: 'Blog Plans' },
    { id: 'social', label: 'Channel Templates' },
  ];

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="BRAND-AWARE SOCIAL CONTENT AUTOPILOT"
        title="Content Autopilot"
        subtitle="Plan industry-adaptive strategy, govern versioned brand tokens, generate deterministic & AI-assisted creatives within dual cost caps, enforce human compliance sign-off, and publish idempotently across channels."
        action={
          overview?.tenant ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="muted">
                Workspace: {currentProject?.name || currentOrg?.name || 'Personal'} ({overview.tenant.role})
              </Badge>
              {overview.brand && (
                <Badge tone={overview.brand.approval_status === 'approved' ? 'positive' : 'warn'}>
                  Brand v{overview.brand.current_version}
                </Badge>
              )}
            </div>
          ) : undefined
        }
      />

      {overview && (
        <StatGrid columns={5}>
          <StatTile
            label="TOTAL PIECES"
            value={overview.counts.total_items}
            sub="Workspace pipeline"
            onClick={() => setActiveTab('creative')}
          />
          <StatTile
            label="NEEDS REVIEW"
            value={overview.counts.review_required}
            sub="Human QA & sign-off"
            onClick={() => setActiveTab('approvals')}
          />
          <StatTile
            label="APPROVED"
            value={overview.counts.approved}
            sub="Cleared to schedule"
            onClick={() => setActiveTab('approvals')}
          />
          <StatTile
            label="SCHEDULED"
            value={overview.counts.scheduled}
            sub="Named slots queued"
            onClick={() => setActiveTab('publishing')}
          />
          <StatTile
            label="PUBLISHED"
            value={overview.counts.published}
            sub={
              overview.counts.publish_failed > 0
                ? `${overview.counts.publish_failed} failed — inspect ledger`
                : 'Idempotent delivery active'
            }
            onClick={() => setActiveTab('publishing')}
          />
        </StatGrid>
      )}

      {/* Product Sub-Navigation */}
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-line bg-white p-2"
        role="tablist"
        aria-label="Content Autopilot sections"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-xs font-medium transition ${
                isActive
                  ? 'bg-ink text-white'
                  : 'text-muted hover:bg-sunken hover:text-ink'
              }`}
            >
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && tab.count > 0 && (
                <span
                  className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
                    isActive ? 'bg-white/20 text-white' : 'bg-sunken text-ink'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeTab === 'strategy' && (
        <OnboardingAndStrategyTab
          key={`strat:${currentOrg?.id || 'solo'}:${currentProject?.id || 'none'}`}
          onRefreshOverview={() => void loadOverview()}
          onOpenCreativeQueue={() => setActiveTab('creative')}
          onOpenBrandStudio={() => setActiveTab('brand')}
        />
      )}

      {activeTab === 'brand' && (
        <BrandStudioTab
          key={`brand:${currentOrg?.id || 'solo'}:${currentProject?.id || 'none'}`}
          onRefreshOverview={() => void loadOverview()}
        />
      )}

      {activeTab === 'creative' && (
        <CreativeQueueTab
          key={`creative:${currentOrg?.id || 'solo'}:${currentProject?.id || 'none'}`}
          onRefreshOverview={() => void loadOverview()}
          onOpenApprovalQueue={() => setActiveTab('approvals')}
        />
      )}

      {activeTab === 'approvals' && (
        <ApprovalQueueTab
          key={`approvals:${currentOrg?.id || 'solo'}:${currentProject?.id || 'none'}`}
          onRefreshOverview={() => void loadOverview()}
          onOpenPublishing={() => setActiveTab('publishing')}
        />
      )}

      {activeTab === 'calendar' && <ScheduleCalendar />}

      {activeTab === 'publishing' && (
        <PublishingActivityTab
          key={`pub:${currentOrg?.id || 'solo'}:${currentProject?.id || 'none'}`}
          onRefreshOverview={() => void loadOverview()}
        />
      )}

      {activeTab === 'performance' && (
        <PerformanceTab
          key={`perf:${currentOrg?.id || 'solo'}:${currentProject?.id || 'none'}`}
          onRefreshOverview={() => void loadOverview()}
        />
      )}

      {activeTab === 'autocontent' && <AutoContentPlans />}
      {activeTab === 'social' && <SocialTemplatesTab />}
    </div>
  );
}
