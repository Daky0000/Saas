import { Magnet, Plug } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Marketing → Lead Generation.
//
// Placeholder shell. The lead-gen module is being ported in from another
// project; drop its components/services in here and replace this body. The
// route (`/marketing/leads`), the PageType (`marketing-leads`) and the nav key
// (`marketing-leads`, toggleable from Admin → Navigation) are already wired.
// ─────────────────────────────────────────────────────────────────────────────

export default function MarketingLeads() {
  return (
    <div className="pb-10">
      <div className="mb-6">
        <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Lead Generation</h1>
        <p className="mt-2 text-base text-slate-500">
          Find, capture, and qualify new leads, then push them straight into Contacts and the CRM pipeline.
        </p>
      </div>

      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
        <Magnet size={28} className="mx-auto text-slate-300" />
        <p className="mt-3 text-sm font-bold text-slate-900">Module not connected yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
          The lead generation module is being integrated. Until then, use Forms to capture inbound leads and
          Lead Scoring to qualify them.
        </p>
        <p className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-400">
          <Plug size={12} /> Route, navigation, and visibility toggle are already wired
        </p>
      </div>
    </div>
  );
}
