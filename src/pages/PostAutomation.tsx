import { useState } from 'react';
import { CheckCircle2, Sparkles, Sliders } from 'lucide-react';
import ScheduleCalendar from '../components/calendar/ScheduleCalendar';

export default function PostAutomation() {
  const [autoQueue, setAutoQueue] = useState(true);
  const [bestTime, setBestTime] = useState(true);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [dailySummary, setDailySummary] = useState(true);
  const [activeTab, setActiveTab] = useState<'general' | 'calendar' | 'social'>('general');

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Post Automation</h1>
        <p className="text-base text-slate-500">
          Configure automation defaults before publishing. These settings keep your posts consistent and scheduled the
          way you want.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Automation sections">
        {[
          { id: 'general' as const, label: 'General' },
          { id: 'calendar' as const, label: 'Calendar' },
          { id: 'social' as const, label: 'Social Templates' },
        ].map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                isActive
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'general' ? (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white">
                  <Sparkles size={18} />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">Automation Defaults</div>
                  <div className="text-xs text-slate-500">Apply these whenever you create a new post.</div>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <input type="checkbox" checked={autoQueue} onChange={(e) => setAutoQueue(e.target.checked)} />
                  <div>
                    <div className="text-sm font-semibold text-slate-800">Auto-queue new posts</div>
                    <div className="text-xs text-slate-500">Place drafts into the scheduling queue immediately.</div>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <input type="checkbox" checked={bestTime} onChange={(e) => setBestTime(e.target.checked)} />
                  <div>
                    <div className="text-sm font-semibold text-slate-800">Use best-time suggestions</div>
                    <div className="text-xs text-slate-500">Apply AI-recommended posting windows.</div>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <input type="checkbox" checked={approvalRequired} onChange={(e) => setApprovalRequired(e.target.checked)} />
                  <div>
                    <div className="text-sm font-semibold text-slate-800">Require approval before post</div>
                    <div className="text-xs text-slate-500">Keep posts in review until you approve.</div>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <input type="checkbox" checked={dailySummary} onChange={(e) => setDailySummary(e.target.checked)} />
                  <div>
                    <div className="text-sm font-semibold text-slate-800">Daily automation summary</div>
                    <div className="text-xs text-slate-500">Receive a recap of scheduled and published posts.</div>
                  </div>
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white">
                  <Sliders size={18} />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">Automation Checklist</div>
                  <div className="text-xs text-slate-500">Use this before every scheduled post.</div>
                </div>
              </div>

              <div className="mt-4 space-y-3 text-sm text-slate-600">
                {[
                  'Connect at least one integration.',
                  'Confirm your default scheduling window.',
                  'Review automation rules for this week.',
                  'Preview content for each platform.',
                ].map((item) => (
                  <div key={item} className="flex items-start gap-2">
                    <CheckCircle2 size={16} className="text-emerald-500 mt-0.5" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-blue-50 p-5">
              <div className="text-sm font-bold text-blue-900">Next step</div>
              <p className="mt-2 text-sm text-blue-800">
                When you are ready, head back to Posts to create or schedule your next automation-ready post.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'calendar' ? <ScheduleCalendar /> : null}

      {activeTab === 'social' ? (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-fuchsia-600 text-white">
                  <Sparkles size={18} />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">Social Templates</div>
                  <div className="text-xs text-slate-500">Save reusable layouts for repeatable publishing.</div>
                </div>
              </div>

              <div className="mt-4 space-y-3 text-sm text-slate-600">
                {[
                  'Create a template from a high-performing post.',
                  'Save default hashtags per network.',
                  'Apply brand voice notes so every post stays on tone.',
                ].map((item) => (
                  <div key={item} className="flex items-start gap-2">
                    <CheckCircle2 size={16} className="text-emerald-500 mt-0.5" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-bold text-slate-900">Template tip</div>
              <p className="mt-2 text-sm text-slate-500">
                Pair each template with a scheduling window so new posts auto-inherit the right timing.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
