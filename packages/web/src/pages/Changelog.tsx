import PublicNav from '../components/landing/PublicNav';
import PublicFooter from '../components/landing/PublicFooter';

type Entry = {
  version: string;
  date: string;
  title: string;
  tags: Array<'New' | 'Improved' | 'Fixed' | 'Removed'>;
  items: string[];
};

const TAG_COLORS: Record<string, string> = {
  New:      'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Improved: 'bg-blue-50 text-blue-700 ring-blue-200',
  Fixed:    'bg-amber-50 text-amber-700 ring-amber-200',
  Removed:  'bg-red-50 text-red-700 ring-red-200',
};

const ENTRIES: Entry[] = [
  {
    version: '2.4.0',
    date: 'June 2025',
    title: 'Email Analytics & Template Library',
    tags: ['New', 'Improved'],
    items: [
      'Email analytics dashboard: per-campaign open rate, click rate, and unsubscribe tracking with Recharts bar charts.',
      'Expanded email template library to 10 pre-built layouts across 6 categories (Onboarding, Marketing, Content, Events, Engagement, Basic).',
      'Visual mini-preview thumbnails in the template picker with category filter tabs.',
      'Per-campaign performance table with delivery, open, click, and unsubscribe counts.',
    ],
  },
  {
    version: '2.3.0',
    date: 'May 2025',
    title: 'Analytics Route Refactor & LinkedIn Helpers',
    tags: ['Improved'],
    items: [
      'Split 4,500-line analytics monolith into 8 focused sub-modules (TikTok, Facebook, Instagram, Pinterest, Threads, LinkedIn, social accounts, adapter).',
      'Extracted shared LinkedIn helper functions into a canonical module used by both analytics and distribution routes.',
      'Fixed double-prefix routing bug affecting all platform analytics endpoints.',
      'Resolved dead code blog analytics duplication.',
    ],
  },
  {
    version: '2.2.0',
    date: 'April 2025',
    title: 'Zod Validation & Route Tests',
    tags: ['New', 'Improved', 'Fixed'],
    items: [
      'Added Zod validation middleware across all billing and mailing API routes.',
      'Wrote a 16-test suite covering mailing, billing, and validation edge cases.',
      'Fixed unsubscribe token generation and URL consistency in email sends.',
      'Corrected Resend SDK v6 error-handling at all send sites.',
    ],
  },
  {
    version: '2.1.0',
    date: 'March 2025',
    title: 'Drag-to-Reorder & Card Builder Fixes',
    tags: ['New', 'Fixed'],
    items: [
      'Drag-to-reorder blocks in the email builder Contents / layers panel.',
      'Fixed AdminFabricBuilder JSON export format (correct wrapper structure for import).',
      'Silent publish errors now surface to the user near the Publish button.',
      'Preview images in the card builder are resized to max 1200×800 JPEG before storing.',
    ],
  },
  {
    version: '2.0.0',
    date: 'February 2025',
    title: 'Rebrand & Primary Color Update',
    tags: ['Improved'],
    items: [
      'Updated primary brand color from red #e6332a to indigo-blue #5b6cf9 across all components.',
      'Refreshed card builder, email builder, and marketing pages with new palette.',
      'JWT token lifecycle improved: version-specific force_auth_reset key per deploy.',
      'Global fetch interceptor auto-logout on 401 responses.',
    ],
  },
  {
    version: '1.9.0',
    date: 'January 2025',
    title: 'Social Media Analytics',
    tags: ['New'],
    items: [
      'Instagram analytics: profile sync, posts, reach, and engagement metrics.',
      'Pinterest analytics: pin performance, board-level stats, and follower trends.',
      'Threads analytics: post metrics, reply management, and location search.',
      'LinkedIn company pages: follower count, post performance, and organization sync.',
    ],
  },
  {
    version: '1.8.0',
    date: 'December 2024',
    title: 'Email Builder v2',
    tags: ['New', 'Improved'],
    items: [
      'Multi-column section blocks with drag-and-drop reordering.',
      'Video block with thumbnail preview support.',
      'HTML block for custom markup injection.',
      'Pre-send checklist with subject, recipient, and footer validation.',
      'Mobile/desktop preview toggle with iframe rendering.',
    ],
  },
  {
    version: '1.7.0',
    date: 'November 2024',
    title: 'CRM & Lead Scoring',
    tags: ['New'],
    items: [
      'CRM pipeline with Kanban-style deal stages.',
      'Lead scoring automations: assign points on email open, click, or tag events.',
      'Company profiles with linked contacts and activity timeline.',
      'Gmail Agent integration for email-to-CRM activity sync.',
    ],
  },
];

export default function Changelog() {
  return (
    <div className="min-h-screen bg-white font-[Inter,sans-serif]">
      <PublicNav activePath="/changelog" onLoginClick={() => { window.location.href = '/login'; }} />

      <div className="mx-auto max-w-3xl px-5 pb-24 pt-32 sm:px-8">
        <div className="mb-14">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-[#5b6cf9] ring-1 ring-indigo-100">
            Changelog
          </div>
          <h1 className="text-4xl font-black tracking-[-0.03em] text-slate-950 sm:text-5xl">What's new</h1>
          <p className="mt-4 text-lg text-slate-500">
            Every update, improvement, and fix — in one place.
          </p>
        </div>

        <div className="relative">
          <div className="absolute left-[7px] top-0 h-full w-px bg-slate-100" aria-hidden />

          <div className="space-y-12">
            {ENTRIES.map((entry, i) => (
              <article key={entry.version} className="relative pl-8">
                <div className={`absolute left-0 top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-4 ring-white ${i === 0 ? 'bg-[#5b6cf9]' : 'bg-slate-300'}`} />

                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="text-xs font-bold text-slate-400 tabular-nums">{entry.date}</span>
                  <span className="text-xs text-slate-300">·</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">v{entry.version}</span>
                  {entry.tags.map(tag => (
                    <span key={tag} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${TAG_COLORS[tag]}`}>{tag}</span>
                  ))}
                </div>

                <h2 className="mb-3 text-xl font-black tracking-tight text-slate-950">{entry.title}</h2>

                <ul className="space-y-1.5">
                  {entry.items.map((item, j) => (
                    <li key={j} className="flex gap-2.5 text-[15px] text-slate-600 leading-relaxed">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
