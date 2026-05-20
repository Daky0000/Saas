import { useEffect, useRef, useState } from 'react';
import { HelpCircle, X, ChevronRight } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

export type TourStep = {
  title: string;
  description: string;
  emoji?: string;
  target?: string;
  placement?: 'center' | 'top' | 'bottom' | 'left' | 'right';
  illu?: string;
  cta?: string;
  action?: string;
};

type Props = {
  steps: TourStep[];
  pageTitle?: string;
  pageKey?: string;
  forceStart?: boolean;
  onForceStartConsumed?: () => void;
};

// ── Main export ────────────────────────────────────────────────────────────────

export default function PageTour({ steps, pageTitle, pageKey, forceStart, onForceStartConsumed }: Props) {
  const storageKey = `tour_seen_${pageKey ?? pageTitle?.toLowerCase().replace(/\s+/g, '-') ?? 'page'}`;
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => localStorage.getItem(storageKey) === '1');
  const panelRef = useRef<HTMLDivElement>(null);

  function openPanel() {
    setOpen(true);
    if (!seen) {
      localStorage.setItem(storageKey, '1');
      setSeen(true);
    }
  }

  function closePanel() {
    setOpen(false);
    onForceStartConsumed?.();
  }

  // forceStart: open the panel (used after onboarding)
  useEffect(() => {
    if (forceStart && steps.length > 0) {
      const t = setTimeout(() => openPanel(), 300);
      return () => clearTimeout(t);
    }
  }, [forceStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handle(e: KeyboardEvent) { if (e.key === 'Escape') closePanel(); }
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!steps.length) return null;

  return (
    <>
      {/* Floating ? button */}
      <button
        type="button"
        onClick={openPanel}
        title={`Quick guide${pageTitle ? ` — ${pageTitle}` : ''}`}
        className="fixed bottom-6 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white shadow-md text-gray-400 hover:text-indigo-600 hover:border-indigo-300 transition-all"
        style={{ position: 'fixed', right: 88 }}
      >
        <HelpCircle size={16} />
        {!seen && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-indigo-500 rounded-full border-2 border-white" style={{ animation: 'tourDot 2s ease-in-out infinite' }} />
        )}
      </button>

      {/* Compact floating panel */}
      {open && (
        <div
          ref={panelRef}
          className="fixed z-50"
          style={{
            bottom: 56,
            right: 20,
            width: 320,
            background: '#fff',
            borderRadius: 16,
            border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 20px 60px -10px rgba(0,0,0,0.25), 0 8px 24px -8px rgba(0,0,0,0.15)',
            animation: 'tourPanelIn 220ms cubic-bezier(0.22,1,0.36,1)',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 12px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: 7, background: 'rgba(91,108,249,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <HelpCircle size={14} color="#5B6CF9" />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#0A0A0B' }}>{pageTitle || 'Quick guide'}</span>
            </div>
            <button
              type="button"
              onClick={closePanel}
              style={{ width: 24, height: 24, border: 0, background: 'transparent', cursor: 'pointer', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8C8C90' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#F5F5F3'; e.currentTarget.style.color = '#0A0A0B'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#8C8C90'; }}
            >
              <X size={14} />
            </button>
          </div>

          {/* Steps list */}
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            {steps.map((step, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', gap: 12, padding: '12px 16px',
                  borderBottom: i < steps.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none',
                }}
              >
                {/* Step number / emoji badge */}
                <div style={{
                  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                  background: step.emoji ? 'rgba(91,108,249,0.07)' : '#5B6CF9',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: step.emoji ? 16 : 11, fontWeight: 700,
                  color: step.emoji ? 'inherit' : '#fff',
                  marginTop: 1,
                }}>
                  {step.emoji || String(i + 1)}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0A0A0B', lineHeight: 1.3 }}>{step.title}</p>
                  <p style={{ margin: '3px 0 0', fontSize: 12, color: '#5C5C60', lineHeight: 1.5 }}>{step.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: '#ACACB0' }}>{steps.length} tip{steps.length !== 1 ? 's' : ''}</span>
            <button
              type="button"
              onClick={closePanel}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '7px 14px', borderRadius: 9, border: 0,
                background: '#5B6CF9', color: '#fff',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit',
                boxShadow: '0 4px 12px -4px rgba(91,108,249,0.6)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#4a5be0'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#5B6CF9'; }}
            >
              Got it <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes tourDot { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes tourPanelIn { from{opacity:0;transform:translateY(10px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
      `}</style>
    </>
  );
}

// ── Page guides ────────────────────────────────────────────────────────────────

export const PAGE_GUIDES: Record<string, { title: string; steps: TourStep[] }> = {
  dashboard: {
    title: 'Dashboard',
    steps: [
      { emoji: '🏠', title: 'Your command centre', description: 'The dashboard shows your key stats, scheduled posts, upcoming tasks, and live activity from your AI agent team.' },
      { emoji: '📊', title: 'Stats at a glance', description: 'The top row shows your total posts, scheduled items, and connected social accounts. Click any card to drill in.' },
      { emoji: '🤖', title: 'Agent activity feed', description: 'The right column shows what your agents (Nova, Sage, Aria, Flux) are learning and doing for your brand in real time.' },
      { emoji: '💬', title: 'Chat with Daky', description: 'Click the chat bubble in the bottom-right to open your AI marketing butler. Ask anything — content ideas, strategies, analytics.' },
    ],
  },
  posts: {
    title: 'Posts',
    steps: [
      { emoji: '✍️', title: 'Create your first post', description: 'Click "Add Post" to open the editor. Write your content, add images, and choose which social accounts to publish to.' },
      { emoji: '📅', title: 'Your post library', description: 'All your posts appear here — draft, scheduled, published, and archived. Click any post to edit or reschedule it.' },
      { emoji: '🔄', title: 'Platform previews', description: 'Each platform has character limits and format rules. The editor shows a live preview per platform.' },
      { emoji: '🤖', title: 'AI-assisted writing', description: 'Open the Daky chat and say "Write me a LinkedIn post about X" — the AI will create a draft you can edit and schedule.' },
    ],
  },
  tasks: {
    title: 'Tasks',
    steps: [
      { emoji: '📋', title: 'Kanban board', description: 'Tasks are organised by status: Backlog → In Progress → Review → Done. Drag cards between columns to update status.' },
      { emoji: '➕', title: 'Create a task', description: 'Click the + button in any column or "New Task" at the top. Give it a title, description, priority, and due date.' },
      { emoji: '👤', title: 'Assign team members', description: 'Open any task and use the Assignees field to assign it to members. They get alerted 1 day before the due date.' },
      { emoji: '🏷️', title: 'Labels and priority', description: 'Use labels to tag tasks by type. Priority levels (Low/Medium/High/Urgent) appear as coloured indicators.' },
    ],
  },
  memory: {
    title: 'Memory',
    steps: [
      { emoji: '🧠', title: 'Your brand memory', description: 'Memory items are facts about your brand that all agents read before every response. The more you add, the better the advice.' },
      { emoji: '➕', title: 'Add a memory item', description: 'Click the "Add" button inside any category to write anything relevant — niche, audience, tone of voice, key products.' },
      { emoji: '🤖', title: 'AI-generated memory', description: 'Click "Generate with AI" to let Daky ask you questions and automatically fill in your brand profile.' },
      { emoji: '⚡', title: 'Agent compilation', description: 'Every time you save a memory item, all 5 agents automatically recompile — so the next chat is already smarter.' },
    ],
  },
  integrations: {
    title: 'Integrations',
    steps: [
      { emoji: '🔌', title: 'Connect your socials', description: 'Connect Twitter/X, Instagram, LinkedIn, Facebook, and more. Each connection enables scheduling and AI insights for that platform.' },
      { emoji: '🔐', title: 'OAuth login', description: "Clicking \"Connect\" opens a secure OAuth flow. You approve access — no passwords are stored." },
      { emoji: '🧠', title: 'Auto memory', description: 'On first connection, your profile (handle, follower count, bio) is automatically saved to Memory so agents know your social presence.' },
      { emoji: '♻️', title: 'Refresh tokens', description: 'Tokens expire over time. If a platform shows "Reconnect", click it to refresh without losing settings.' },
    ],
  },
  analytics: {
    title: 'Analytics',
    steps: [
      { emoji: '📈', title: 'Performance overview', description: 'View publishing trends, engagement metrics, and growth data across all your connected social accounts in one place.' },
      { emoji: '📆', title: 'Date range filter', description: 'Use the date picker to compare performance across different time periods — last 7 days, last month, or a custom range.' },
      { emoji: '🤖', title: 'Ask Aria', description: 'Open the Daky chat and ask "What do my analytics say?" — Aria will interpret your numbers and suggest improvements.' },
    ],
  },
  cards: {
    title: 'Cards',
    steps: [
      { emoji: '🎨', title: 'Visual card builder', description: 'Create social media graphics, announcement cards, and promotional visuals using the drag-and-drop canvas editor.' },
      { emoji: '📐', title: 'Canvas presets', description: 'Choose from preset sizes for Instagram (1080×1080), LinkedIn, Twitter, TikTok, or set a custom canvas size.' },
      { emoji: '🖼️', title: 'Add elements', description: 'Use the left panel to add text, shapes, and images. The right panel controls position, size, color, and font.' },
      { emoji: '💾', title: 'Export your design', description: 'Click "Export" to download as PNG or JPG at high resolution. Save designs to your library for re-use.' },
    ],
  },
  marketing: {
    title: 'Marketing Overview',
    steps: [
      { emoji: '📊', title: 'Your marketing hub', description: 'See email and campaign performance at a glance — open rates, active campaigns, total clicks, and conversions in one place.' },
      { emoji: '🔗', title: 'Jump into any section', description: 'Use the sidebar to navigate to Contacts, Email, Campaigns, or Surveys. Each section has its own focused workspace.' },
    ],
  },
  'marketing-contacts': {
    title: 'Contacts',
    steps: [
      { emoji: '👥', title: 'Contact management', description: 'Import contacts via CSV or add them manually. Segment your list with tags to target specific groups.' },
      { emoji: '🏷️', title: 'Segments', description: 'Group contacts by shared properties to send targeted campaigns.' },
    ],
  },
  'marketing-email': {
    title: 'Email Marketing',
    steps: [
      { emoji: '📧', title: 'Email campaigns', description: 'Create and send email campaigns to your subscriber list. Write content in the rich-text editor or use AI to generate copy.' },
      { emoji: '⚡', title: 'Automations', description: 'Set up trigger-based email sequences — welcome emails on signup, re-engagement on inactivity, and more.' },
      { emoji: '📊', title: 'Analytics', description: 'Track open rates, click rates, and unsubscribes directly in the analytics tab.' },
    ],
  },
  'marketing-campaigns': {
    title: 'Campaigns',
    steps: [
      { emoji: '🎯', title: 'Multi-channel campaigns', description: 'Group posts, emails, and paid ads under one campaign goal.' },
      { emoji: '➕', title: 'Create a campaign', description: 'Click "New Campaign", set a goal, add channels, and generate UTM tracking links.' },
      { emoji: '📌', title: 'Track performance', description: 'The Performance tab shows clicks by source, conversion rates, and funnel drop-off.' },
    ],
  },
  'marketing-surveys': {
    title: 'Surveys',
    steps: [
      { emoji: '📝', title: 'Create a survey', description: 'Click "New Survey" to start. Give it a title and description, then add blocks to build your questions.' },
      { emoji: '⊕', title: 'Add blocks', description: 'Click the ── ⊕ ── dividers to add blocks: radio buttons, checkboxes, rating stars, NPS, open text, and more.' },
      { emoji: '👁️', title: 'Preview before sharing', description: 'Click "Preview" in the builder header to see exactly what respondents will see — works even in Draft mode.' },
      { emoji: '🔗', title: 'Share your survey', description: 'Set status to Active, then copy the public link from the Share panel. Anyone with the link can respond.' },
    ],
  },
  'project-settings': {
    title: 'Project Settings',
    steps: [
      { emoji: '⚙️', title: 'General settings', description: 'The General tab lets you rename the project, change its colour, and update the description.' },
      { emoji: '👥', title: 'Team tab', description: 'Switch to the Team tab to see all org members and their roles. You can invite new people here.' },
      { emoji: '📬', title: 'Invite by email', description: "Enter a colleague's email, choose their role (Viewer / Editor / Admin), and click Invite." },
      { emoji: '🗑️', title: 'Danger zone', description: 'Deleting a project removes all its tasks permanently — type the project name to confirm.' },
    ],
  },
  admin: {
    title: 'Admin',
    steps: [
      { emoji: '🧑‍🤝‍🧑', title: 'User Management', description: 'View all registered users, their plans, and last active dates. Promote users to admin or suspend accounts.' },
      { emoji: '💳', title: 'Billing & Subscriptions', description: 'See MRR, ARR, active subscriptions, and recent transactions. Drill into individual payments.' },
      { emoji: '🤖', title: 'AI Configuration', description: 'Set your Anthropic or Google Gemini API key, choose the model, and customise the Daky system prompt.' },
      { emoji: '🎓', title: 'Daky Learn', description: 'Add article and video URLs for Daky to extract marketing insights from and compile into AI skills.' },
    ],
  },
  billing: {
    title: 'Billing',
    steps: [
      { emoji: '💳', title: 'Your current plan', description: 'This card shows your active subscription, next billing date, and usage for the current period.' },
      { emoji: '⬆️', title: 'Upgrade', description: 'Click "Upgrade plan" to move to a higher tier and unlock more posts, agents, team seats, and analytics.' },
      { emoji: '🔄', title: 'Manage subscription', description: 'Cancel, pause, or change your plan at any time. Changes take effect at the end of your current billing period.' },
    ],
  },
  workspace: {
    title: 'Workspace',
    steps: [
      { emoji: '🏢', title: 'Your organisation', description: "The workspace shows your organisation's name, logo, and all member roles. You can rename the org or update its description." },
      { emoji: '👥', title: 'Member roles', description: 'Owners can do everything. Admins manage members and projects. Editors create content. Viewers can only read.' },
      { emoji: '📬', title: 'Invitations', description: "Pending invitations appear in the Invitations tab. You can resend or cancel invites that haven't been accepted." },
    ],
  },
};
