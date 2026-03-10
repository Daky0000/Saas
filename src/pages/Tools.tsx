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

const ToolIcon = ({ name, size = 20 }: { name: string; size?: number }) => {
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
    <div className="bg-white text-[#0f0f11] min-h-screen font-sans">
      <PublicNav onLoginClick={onLoginClick} activePath="/tools" />

      {/* ── Hero ── */}
      <section className="relative flex flex-col items-center justify-center px-6 pt-36 pb-20 text-center overflow-hidden">
        {/* Grid background */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.025]"
          style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', backgroundSize: '48px 48px' }}
        />
        {/* Glow */}
        <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] rounded-full bg-[#5b6cf9]/6 blur-3xl" />

        <div className="relative mb-6 inline-flex items-center gap-2 rounded-full border border-[#c7d0fe] bg-[#eef0fe] px-3.5 py-1.5 text-[12px] font-semibold text-[#5b6cf9]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#5b6cf9]" />
          {hero.badge}
        </div>

        <h1 className="relative max-w-3xl font-black tracking-[-0.05em] leading-[0.93] mb-6">
          {hero.headline.split('\n').map((line, i) => (
            <span
              key={i}
              className={`block text-5xl sm:text-6xl md:text-7xl ${
                i === 0
                  ? 'text-[#0f0f11]'
                  : 'text-transparent bg-clip-text bg-gradient-to-r from-[#5b6cf9] to-[#818cf8]'
              }`}
            >
              {line}
            </span>
          ))}
        </h1>

        <p className="relative max-w-xl text-[16px] text-[#6b7280] leading-[1.7] mb-10">
          {hero.subheadline}
        </p>

        <button
          type="button"
          onClick={onLoginClick}
          className="relative group flex items-center gap-2 bg-[#5b6cf9] hover:bg-[#4f63f7] text-white font-semibold px-6 py-3 rounded-lg text-[15px] transition-all duration-150 shadow-md shadow-blue-200/70 hover:shadow-lg"
        >
          Try it free
          <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
        </button>
      </section>

      {/* ── Tools list ── */}
      <section className="max-w-[1100px] mx-auto px-6 py-16 md:py-24 flex flex-col gap-16">
        {tools.map((tool, i) => (
          <div
            key={i}
            className={`flex flex-col md:flex-row gap-10 md:gap-16 items-start ${
              i % 2 === 1 ? 'md:flex-row-reverse' : ''
            }`}
          >
            {/* Visual card */}
            <div className="w-full md:w-[48%] rounded-2xl border border-[#e5e7eb] bg-[#fafafa] hover:border-[#c7d0fe] transition-colors duration-200 p-8 flex flex-col items-start gap-4 shrink-0">
              <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-[#eef0fe] text-[#5b6cf9]">
                <ToolIcon name={tool.icon} />
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#5b6cf9] mb-1">{tool.name}</div>
                <div className="text-[22px] font-black tracking-[-0.03em] text-[#0f0f11] leading-tight">{tool.tagline}</div>
              </div>
              <ul className="mt-1 flex flex-col gap-2.5">
                {tool.bullets.map((b, j) => (
                  <li key={j} className="flex items-start gap-2.5 text-[14px] text-[#6b7280]">
                    <CheckCircle2 size={15} className="text-[#5b6cf9] mt-0.5 shrink-0" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>

            {/* Text side */}
            <div className="flex flex-col justify-center gap-4">
              <h2 className="text-3xl sm:text-[36px] font-black tracking-[-0.04em] text-[#0f0f11] leading-tight">
                {tool.name}
              </h2>
              <p className="text-[#6b7280] text-[15px] leading-relaxed max-w-lg">{tool.description}</p>
              <button
                type="button"
                onClick={onLoginClick}
                className="group inline-flex items-center gap-2 text-[14px] font-semibold text-[#5b6cf9] hover:text-[#4f63f7] transition-colors w-fit"
              >
                Get started
                <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          </div>
        ))}
      </section>

      {/* ── CTA Banner ── */}
      <section className="max-w-[1000px] mx-auto px-6 pb-24 md:pb-32">
        <div className="rounded-2xl border border-[#c7d0fe] bg-gradient-to-br from-[#eef0fe] via-white to-[#f5f3ff] p-12 md:p-14 text-center relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.04]"
            style={{ backgroundImage: 'radial-gradient(#5b6cf9 1px, transparent 0)', backgroundSize: '24px 24px' }}
          />
          <h2 className="relative text-3xl sm:text-4xl font-black tracking-[-0.04em] text-[#0f0f11] mb-4 leading-tight">
            {cta.headline}
          </h2>
          <p className="relative text-[#6b7280] text-[15px] mb-8 max-w-md mx-auto">{cta.subheadline}</p>
          <button
            type="button"
            onClick={onLoginClick}
            className="relative group inline-flex items-center gap-2 bg-[#5b6cf9] hover:bg-[#4f63f7] text-white font-semibold px-7 py-3.5 rounded-lg text-[15px] transition-all duration-150 shadow-md shadow-blue-200/70 hover:shadow-lg"
          >
            {cta.buttonText}
            <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
