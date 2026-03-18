import { useMemo, useState } from 'react';
import { Calendar, CheckCircle2, Clock, Sparkles, Sliders } from 'lucide-react';

const WINDOWS = [
  { id: 'morning', label: 'Morning Focus', window: '8:00 AM - 11:00 AM' },
  { id: 'midday', label: 'Midday Boost', window: '11:00 AM - 2:00 PM' },
  { id: 'evening', label: 'Evening Push', window: '5:00 PM - 8:00 PM' },
];

export default function PostAutomation() {
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [autoQueue, setAutoQueue] = useState(true);
  const [bestTime, setBestTime] = useState(true);
  const [defaultWindow, setDefaultWindow] = useState('morning');
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [dailySummary, setDailySummary] = useState(true);

  const timezoneOptions = useMemo(
    () => ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London'],
    []
  );

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Post Automation</h1>
        <p className="text-base text-slate-500">
          Configure automation defaults before publishing. These settings keep your posts consistent and scheduled the
          way you want.
        </p>
      </div>

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

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
                <Clock size={18} />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">Scheduling Window</div>
                <div className="text-xs text-slate-500">Pick the default window for scheduled posts.</div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {WINDOWS.map((slot) => (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => setDefaultWindow(slot.id)}
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    defaultWindow === slot.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-sm font-semibold">{slot.label}</div>
                  <div className="text-xs">{slot.window}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-white">
                <Calendar size={18} />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">Timezone</div>
                <div className="text-xs text-slate-500">Ensure scheduled times follow your preferred zone.</div>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700"
              >
                {timezoneOptions.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <span className="text-xs text-slate-500">Current timezone detected: {timezone}</span>
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
    </div>
  );
}
