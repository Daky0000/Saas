import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Calendar,
  Globe,
  Image,
  Share2,
  Zap,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { fetchPageContent } from '../services/pageContentService';
import PublicNav from '../components/landing/PublicNav';
import PublicFooter from '../components/landing/PublicFooter';

// ─── Content types ────────────────────────────────────────────────────────────

export type ToolItem = {
  icon: string;
  name: string;
  tagline: string;
  description: string;
  bullets: string[];
};

export type ToolsPageContent = {
  hero: {
    badge: string;
    headline: string;
    subheadline: string;
  };
  tools: ToolItem[];
  cta: {
    headline: string;
    subheadline: string;
    buttonText: string;
  };
};

export const defaultToolsContent: ToolsPageContent = {
  hero: {
    badge: 'Platform Tools',
    headline: 'One toolkit.\nEvery platform.',
    subheadline:
      'Dakyworld Hub ships with purpose-built tools that cover every part of your social media workflow — from creation to publishing to analytics.',
  },
  tools: [
    {
      icon: 'Calendar',
      name: 'Smart Scheduler',
      tagline: 'Plan ahead. Publish on time.',
      description:
        'Take control of your content calendar with drag-and-drop scheduling. Queue posts days, weeks, or months in advance and let the platform handle the rest.',
      bullets: [
        'Visual calendar view across all platforms',
        'Best-time-to-post recommendations',
        'Bulk scheduling with CSV import',
        'Queue management and rescheduling',
      ],
    },
    {
      icon: 'Share2',
      name: 'Multi-Platform Publisher',
      tagline: 'One post. Every platform.',
      description:
        'Write once, publish everywhere. Dakyworld Hub connects to Instagram, TikTok, LinkedIn, Facebook, Twitter/X, Threads, and more — simultaneously.',
      bullets: [
        'Simultaneous publishing to 10+ platforms',
        'Platform-specific formatting and previews',
        'Scheduled and instant publishing modes',
        'Draft and approval workflows',
      ],
    },
    {
      icon: 'Image',
      name: 'Card Designer',
      tagline: 'Stunning visuals, zero design skills.',
      description:
        'Build on-brand content with our drag-and-drop card editor. Start from a template or build from scratch with text, images, gradients, and shapes.',
      bullets: [
        'Drag-and-drop visual editor',
        'Pre-built professional templates',
        'Brand color and font controls',
        'Export as image for any platform',
      ],
    },
    {
      icon: 'BarChart3',
      name: 'Analytics Dashboard',
      tagline: 'Know what works. Do more of it.',
      description:
        'Track your performance across every connected platform in a single unified dashboard. Spot trends early and double down on what resonates.',
      bullets: [
        'Cross-platform performance metrics',
        'Engagement, reach, and follower growth',
        'Content performance breakdowns',
        'Exportable reports',
      ],
    },
    {
      icon: 'Globe',
      name: 'Integrations Hub',
      tagline: 'Works with the tools you already use.',
      description:
        'Dakyworld Hub connects to WordPress for blog publishing, Mailchimp for email campaigns, and a growing list of third-party platforms.',
      bullets: [
        'WordPress post publishing',
        'Mailchimp campaign management',
        'OAuth-secured connections',
        'One-click connect and disconnect',
      ],
    },
    {
      icon: 'Zap',
      name: 'Workflow Automation',
      tagline: 'Set it and forget it.',
      description:
        'Automate repetitive tasks with trigger-based workflows. Republish top-performing posts, notify your team, and keep your queue always full.',
      bullets: [
        'Trigger-based automation rules',
        'Auto-republish top performers',
        'Team notifications and alerts',
        'Queue auto-fill from content library',
      ],
    },
  ],
  cta: {
    headline: 'Every tool your brand needs, in one place.',
    subheadline: 'Start publishing smarter with Dakyworld Hub — free to get started.',
    buttonText: 'Get started for free',
  },
};

// ─── Icon map ─────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, LucideIcon> = {
  Calendar,
  Share2,
  Image,
  BarChart3,
  Globe,
  Zap,
};

const ToolIcon = ({ name, size = 24 }: { name: string; size?: number }) => {
  const Icon: LucideIcon = ICON_MAP[name] ?? Zap;
  return <Icon size={size} />;
};

// ─── Main Tools Page ──────────────────────────────────────────────────────────

type ToolsProps = {
  onLoginClick: () => void;
};

export default function Tools({ onLoginClick }: ToolsProps) {
  const [content, setContent] = useState<ToolsPageContent>(defaultToolsContent);

  useEffect(() => {
    void fetchPageContent<ToolsPageContent>('tools').then((data) => {
      if (data) setContent(data);
    });
  }, []);

  const { hero, tools, cta } = content;

  return (
    <div className="bg-white text-zinc-900 min-h-screen font-sans">
      <PublicNav onLoginClick={onLoginClick} activePath="/tools" />

      {/* ── Hero ── */}
      <section className="relative flex flex-col items-center justify-center px-6 pt-36 pb-20 text-center overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-red-50/70 via-white to-white" />

        <div className="relative mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-500 shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-[#e6332a]" />
          {hero.badge}
        </div>

        <h1 className="relative max-w-3xl text-5xl sm:text-6xl md:text-7xl font-black tracking-[-0.04em] leading-[0.95] mb-6">
          {hero.headline.split('\n').map((line, i) => (
            <span key={i} className={`block ${i > 0 ? 'text-[#e6332a]' : 'text-zinc-900'}`}>
              {line}
            </span>
          ))}
        </h1>

        <p className="relative max-w-xl text-base sm:text-lg text-zinc-500 leading-relaxed mb-10">
          {hero.subheadline}
        </p>

        <button
          type="button"
          onClick={onLoginClick}
          className="relative group flex items-center gap-2 bg-[#e6332a] hover:bg-[#cc2921] text-white font-bold px-7 py-4 rounded-2xl text-sm transition-colors shadow-md shadow-red-100"
        >
          Try it free
          <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
        </button>
      </section>

      {/* ── Tools list ── */}
      <section className="max-w-6xl mx-auto px-6 py-16 md:py-24 flex flex-col gap-20">
        {tools.map((tool, i) => (
          <div
            key={i}
            className={`flex flex-col md:flex-row gap-10 md:gap-16 items-start ${
              i % 2 === 1 ? 'md:flex-row-reverse' : ''
            }`}
          >
            {/* Visual card */}
            <div className="w-full md:w-1/2 rounded-3xl border border-zinc-100 bg-zinc-50 p-10 flex flex-col items-start gap-4 shrink-0">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-red-50 text-[#e6332a]">
                <ToolIcon name={tool.icon} size={26} />
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-[#e6332a] mb-1">{tool.name}</div>
                <div className="text-2xl font-black tracking-[-0.03em] text-zinc-900">{tool.tagline}</div>
              </div>
              <ul className="mt-2 flex flex-col gap-2.5">
                {tool.bullets.map((b, j) => (
                  <li key={j} className="flex items-start gap-2.5 text-sm text-zinc-600">
                    <CheckCircle2 size={16} className="text-[#e6332a] mt-0.5 shrink-0" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>

            {/* Text side */}
            <div className="flex flex-col justify-center gap-4">
              <h2 className="text-3xl sm:text-4xl font-black tracking-[-0.03em] text-zinc-900">
                {tool.name}
              </h2>
              <p className="text-zinc-500 text-base leading-relaxed max-w-lg">{tool.description}</p>
              <button
                type="button"
                onClick={onLoginClick}
                className="group inline-flex items-center gap-2 text-sm font-bold text-[#e6332a] hover:text-[#cc2921] transition-colors w-fit"
              >
                Get started
                <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          </div>
        ))}
      </section>

      {/* ── CTA Banner ── */}
      <section className="max-w-4xl mx-auto px-6 pb-24 md:pb-32 text-center">
        <div className="rounded-3xl border border-zinc-100 bg-zinc-50 p-12 md:p-16 relative overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-1 rounded-full bg-[#e6332a]" />
          <h2 className="text-3xl sm:text-4xl font-black tracking-[-0.03em] text-zinc-900 mb-4">
            {cta.headline}
          </h2>
          <p className="text-zinc-500 text-base sm:text-lg mb-8 max-w-md mx-auto">{cta.subheadline}</p>
          <button
            type="button"
            onClick={onLoginClick}
            className="group inline-flex items-center gap-2 bg-[#e6332a] hover:bg-[#cc2921] text-white font-bold px-8 py-4 rounded-2xl text-sm transition-colors shadow-md shadow-red-100"
          >
            {cta.buttonText}
            <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
