import { useState } from 'react';
import { ArrowLeft, ArrowRight, HelpCircle, X } from 'lucide-react';

export type TourStep = {
  title: string;
  description: string;
  emoji?: string;
};

type Props = {
  steps: TourStep[];
  pageTitle?: string;
};

export default function PageTour({ steps, pageTitle }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  if (!steps.length) return null;

  const current = steps[step];
  const isFirst = step === 0;
  const isLast = step === steps.length - 1;

  const close = () => { setOpen(false); setStep(0); };

  return (
    <>
      {/* Floating help button */}
      <button
        type="button"
        onClick={() => { setStep(0); setOpen(true); }}
        title={`Quick guide${pageTitle ? ` — ${pageTitle}` : ''}`}
        className="fixed bottom-20 right-5 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white shadow-lg text-gray-400 hover:text-indigo-600 hover:border-indigo-300 hover:shadow-indigo-100 transition-all"
      >
        <HelpCircle size={18} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[150] flex items-end justify-end p-5 pointer-events-none"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div
            className="pointer-events-auto w-full max-w-xs rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden"
            style={{ marginBottom: '80px', marginRight: '4px' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-indigo-600">
              <div className="flex items-center gap-2">
                <HelpCircle size={14} className="text-indigo-200" />
                <span className="text-[12px] font-bold text-white">
                  {pageTitle ? `${pageTitle} guide` : 'Page guide'} · {step + 1}/{steps.length}
                </span>
              </div>
              <button
                type="button"
                onClick={close}
                className="rounded-lg p-1 text-indigo-200 hover:text-white hover:bg-indigo-500 transition-colors"
              >
                <X size={13} />
              </button>
            </div>

            {/* Step content */}
            <div className="px-4 py-4 space-y-2 min-h-[120px]">
              <div className="flex items-start gap-2">
                {current.emoji && (
                  <span className="text-xl shrink-0 mt-0.5">{current.emoji}</span>
                )}
                <div>
                  <p className="text-[13px] font-bold text-gray-900">{current.title}</p>
                  <p className="text-[12px] text-gray-500 leading-relaxed mt-1">{current.description}</p>
                </div>
              </div>
            </div>

            {/* Progress + nav */}
            <div className="px-4 pb-4 space-y-3">
              {/* Step dots */}
              <div className="flex items-center gap-1">
                {steps.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setStep(i)}
                    className={`h-1 rounded-full transition-all duration-200 ${
                      i === step ? 'flex-1 bg-indigo-600' : 'w-4 bg-gray-200 hover:bg-gray-300'
                    }`}
                  />
                ))}
              </div>
              {/* Nav buttons */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep((s) => s - 1)}
                  disabled={isFirst}
                  className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-colors"
                >
                  <ArrowLeft size={11} /> Back
                </button>
                {isLast ? (
                  <button
                    type="button"
                    onClick={close}
                    className="flex-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-indigo-700 transition-colors"
                  >
                    Done
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setStep((s) => s + 1)}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-indigo-700 transition-colors"
                  >
                    Next <ArrowRight size={11} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Guide definitions per page ─────────────────────────────────────────────

export const PAGE_GUIDES: Record<string, { title: string; steps: TourStep[] }> = {
  dashboard: {
    title: 'Dashboard',
    steps: [
      { emoji: '🏠', title: 'Your command centre', description: 'The dashboard shows your key stats, scheduled posts, upcoming tasks, and live activity from your AI agent team.' },
      { emoji: '📊', title: 'Stats at a glance', description: 'The top row shows your total posts, scheduled items, and connected social accounts. Click any card to drill into that section.' },
      { emoji: '🤖', title: 'Agent activity feed', description: 'The right column shows what your agents (Nova, Sage, Aria, Flux) are learning and doing for your brand in real time.' },
      { emoji: '💬', title: 'Chat with Daky', description: 'Click the chat bubble in the bottom-right corner to open your AI marketing butler. Ask anything — content ideas, strategies, analytics.' },
    ],
  },
  posts: {
    title: 'Posts',
    steps: [
      { emoji: '✍️', title: 'Create your first post', description: 'Click "New Post" to open the editor. Write your content, add images, and choose which social accounts to publish to.' },
      { emoji: '📅', title: 'Schedule for later', description: 'Instead of publishing immediately, pick a date and time to schedule your post. It will be queued and published automatically.' },
      { emoji: '🔄', title: 'Platform previews', description: 'Each platform (Twitter, LinkedIn, Instagram) has character limits and format rules. The editor shows a live preview per platform.' },
      { emoji: '🤖', title: 'AI-assisted writing', description: 'Open the Daky chat and say "Write me a LinkedIn post about X" — the AI will create a draft you can edit and schedule directly.' },
    ],
  },
  tasks: {
    title: 'Tasks',
    steps: [
      { emoji: '📋', title: 'Kanban board', description: 'Tasks are organised by status: Backlog → In Progress → Review → Done. Drag cards between columns to update status.' },
      { emoji: '➕', title: 'Create a task', description: 'Click the + button in any column or the "New Task" button at the top. Give it a title, description, priority, and due date.' },
      { emoji: '👤', title: 'Assign team members', description: 'Open any task and use the Assignees field to assign it to members of your organisation. Invite people first via Project Settings → Team.' },
      { emoji: '🏷️', title: 'Labels and priority', description: 'Use labels to tag tasks by type (e.g. "Design", "Copy"). Priority levels (Low/Medium/High/Urgent) appear as coloured indicators.' },
    ],
  },
  memory: {
    title: 'Memory',
    steps: [
      { emoji: '🧠', title: 'Your brand memory', description: 'Memory items are facts about your brand that Daky and all 5 agents read before every response. The more you add, the better the advice.' },
      { emoji: '➕', title: 'Add a memory item', description: 'Click "Add Memory" and write anything relevant — your niche, target audience, tone of voice, key products, competitors, or campaign goals.' },
      { emoji: '🤖', title: 'AI-generated memory', description: 'Click "Generate with AI" to let Daky ask you questions and automatically fill in your brand profile based on your answers.' },
      { emoji: '⚡', title: 'Agent compilation', description: 'Every time you save a memory item, all 5 agents automatically recompile their skills — so the next chat is already smarter.' },
    ],
  },
  integrations: {
    title: 'Integrations',
    steps: [
      { emoji: '🔌', title: 'Connect your socials', description: 'Connect Twitter/X, Instagram, LinkedIn, Facebook, and more. Each connection enables scheduling, publishing, and AI insights for that platform.' },
      { emoji: '🔐', title: 'OAuth login', description: 'Clicking "Connect" opens a secure OAuth flow on the platform\'s website. You approve access — no passwords are stored.' },
      { emoji: '🧠', title: 'Auto memory', description: 'On first connection, your profile (handle, follower count, bio) is automatically saved to your Memory so agents know your social presence.' },
      { emoji: '♻️', title: 'Refresh tokens', description: 'Tokens expire over time. If a platform shows "Reconnect", click it to refresh your token without losing any settings.' },
    ],
  },
  analytics: {
    title: 'Analytics',
    steps: [
      { emoji: '📈', title: 'Performance overview', description: 'View publishing trends, engagement metrics, and growth data across all your connected social accounts in one place.' },
      { emoji: '📆', title: 'Date range filter', description: 'Use the date picker to compare performance across different time periods — last 7 days, last month, or a custom range.' },
      { emoji: '🤖', title: 'Ask Aria', description: 'Open the Daky chat and ask "What do my analytics say?" — Aria, the analytics agent, will interpret your numbers and suggest improvements.' },
    ],
  },
  cards: {
    title: 'Cards',
    steps: [
      { emoji: '🎨', title: 'Visual card builder', description: 'Create stunning social media graphics, announcement cards, and promotional visuals using the drag-and-drop canvas editor.' },
      { emoji: '📐', title: 'Canvas presets', description: 'Choose from preset sizes for Instagram (1080×1080), LinkedIn, Twitter, TikTok, or set a custom canvas size.' },
      { emoji: '🖼️', title: 'Add elements', description: 'Use the left panel to add text, shapes, images, and lines. The right panel lets you control position, size, color, and font.' },
      { emoji: '💾', title: 'Export your design', description: 'Click "Export" to download your card as PNG or JPG at high resolution. Save designs to your library for re-use.' },
    ],
  },
  mailing: {
    title: 'Mailing',
    steps: [
      { emoji: '📧', title: 'Email campaigns', description: 'Create and send email campaigns to your subscriber list. Write your content in the rich-text editor or use Daky to generate copy.' },
      { emoji: '👥', title: 'Contact management', description: 'Import contacts via CSV or add them manually. Segment your list with tags to target specific groups.' },
      { emoji: '📊', title: 'Campaign analytics', description: 'After sending, track open rates, click rates, and unsubscribes directly in the campaign detail view.' },
    ],
  },
  campaign: {
    title: 'Campaigns',
    steps: [
      { emoji: '🎯', title: 'What is a campaign?', description: 'A campaign groups related posts, emails, and tasks under a single goal (e.g. a product launch or seasonal promotion).' },
      { emoji: '➕', title: 'Create a campaign', description: 'Click "New Campaign", set a name, goal, start/end date, and add the content pieces you want to track together.' },
      { emoji: '📌', title: 'Track progress', description: 'The campaign overview shows which content is drafted, scheduled, and live — giving you a full picture of your campaign status.' },
    ],
  },
  'project-settings': {
    title: 'Project Settings',
    steps: [
      { emoji: '⚙️', title: 'General settings', description: 'The General tab lets you rename the project, change its colour, and update the description. Only owners and admins can make changes.' },
      { emoji: '👥', title: 'Team tab', description: 'Switch to the Team tab to see all org members and their roles. You can invite new people here with a single email.' },
      { emoji: '📬', title: 'Invite by email', description: 'Enter a colleague\'s email, choose their role (Viewer / Editor / Admin), and click Invite. They\'ll receive a link to join.' },
      { emoji: '🗑️', title: 'Danger zone', description: 'The General tab has a Danger Zone at the bottom. Deleting a project removes all its tasks permanently — type the project name to confirm.' },
    ],
  },
  admin: {
    title: 'Admin',
    steps: [
      { emoji: '🤖', title: 'AI Configuration', description: 'Set your Anthropic or Google Gemini API key, choose the model, and customise the system prompt that Daky uses for all responses.' },
      { emoji: '🧑‍🤝‍🧑', title: 'User management', description: 'View all registered users, their plans, and last active dates. You can promote users to admin or suspend accounts.' },
      { emoji: '💳', title: 'Billing metrics', description: 'See MRR, ARR, active subscriptions, and recent transactions. Drill into individual payments from the Transactions tab.' },
      { emoji: '🎓', title: 'Daky Learn', description: 'Add article and video URLs for Daky to extract marketing insights from. Compile them into AI skills that improve all user responses.' },
      { emoji: '🧠', title: 'Agent Team', description: 'Edit the base system prompt for each of the 5 agents (Daky, Nova, Sage, Aria, Flux). Changes take effect on the next compilation.' },
    ],
  },
  billing: {
    title: 'Billing',
    steps: [
      { emoji: '💳', title: 'Your current plan', description: 'This page shows your active subscription, next billing date, and the features included in your plan.' },
      { emoji: '⬆️', title: 'Upgrade', description: 'Click "Upgrade" to move to a higher tier and unlock more posts, agents, team seats, and analytics.' },
      { emoji: '🔄', title: 'Manage subscription', description: 'Cancel, pause, or change your plan at any time. Changes take effect at the end of your current billing period.' },
    ],
  },
  workspace: {
    title: 'Workspace',
    steps: [
      { emoji: '🏢', title: 'Your organisation', description: 'The workspace shows your organisation\'s name, logo, and all member roles. You can rename the org or update its description here.' },
      { emoji: '👥', title: 'Member roles', description: 'Owners can do everything. Admins can manage members and projects. Editors can create and edit content. Viewers can only read.' },
      { emoji: '📬', title: 'Invitations', description: 'Pending invitations appear in the Invitations tab. You can resend or cancel invites that haven\'t been accepted yet.' },
    ],
  },
};
