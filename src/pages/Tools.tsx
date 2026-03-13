import { useEffect, useState } from 'react';
import { ArrowRight, BarChart3, Calendar, CheckCircle2, Image, Zap, type LucideIcon } from 'lucide-react';
import { fetchPageContent } from '../services/pageContentService';
import PublicNav from '../components/landing/PublicNav';
import PublicFooter from '../components/landing/PublicFooter';

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
    headline: 'Create.\nPublish.\nMeasure.',
    subheadline: 'A focused toolkit for creating and managing your blog content.',
  },
  tools: [
    {
      icon: 'Calendar',
      name: 'Smart Scheduler',
      tagline: 'Plan ahead. Publish on time.',
      description: 'Schedule posts and manage your publishing calendar in one place.',
      bullets: ['Publishing calendar view', 'Scheduled posts', 'Queue management'],
    },
    {
      icon: 'Image',
      name: 'Card Designer',
      tagline: 'Stunning visuals, zero design skills.',
      description: 'Build on-brand visuals with our drag-and-drop card editor.',
      bullets: ['Drag-and-drop editor', 'Templates', 'Export images'],
    },
    {
      icon: 'BarChart3',
      name: 'Analytics Dashboard',
      tagline: 'Know what works.',
      description: 'Track performance and understand which content resonates.',
      bullets: ['Performance metrics', 'Content breakdowns', 'Exportable reports'],
    },
  ],
  cta: {
    headline: 'Ready to publish?',
    subheadline: 'Create your next post in minutes.',
    buttonText: 'Get started',
  },
};

const ICON_MAP: Record<string, LucideIcon> = { Calendar, Image, BarChart3, Zap };

const ToolIcon = ({ name, size = 20 }: { name: string; size?: number }) => {
  const Icon: LucideIcon = ICON_MAP[name] ?? Zap;
  return <Icon size={size} />;
};

type ToolsProps = { onLoginClick: () => void };

export default function Tools({ onLoginClick }: ToolsProps) {
  const [content, setContent] = useState<ToolsPageContent>(defaultToolsContent);

  useEffect(() => {
    fetchPageContent('tools')
      .then((c) => {
        if (c && typeof c === 'object') setContent(c as ToolsPageContent);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <PublicNav onLoginClick={onLoginClick} />

      <main className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="rounded-[32px] border border-slate-200 bg-white px-6 py-10 sm:px-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-700">
            <CheckCircle2 size={14} className="text-emerald-600" />
            {content.hero.badge}
          </div>
          <h1 className="mt-5 whitespace-pre-line text-4xl font-black tracking-[-0.04em] text-slate-950 sm:text-5xl">
            {content.hero.headline}
          </h1>
          <p className="mt-4 max-w-2xl text-base text-slate-600">{content.hero.subheadline}</p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {content.tools.map((tool) => (
            <div key={tool.name} className="rounded-3xl border border-slate-200 bg-white p-6">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white">
                <ToolIcon name={tool.icon} />
              </div>
              <div className="mt-4 text-lg font-black text-slate-950">{tool.name}</div>
              <div className="mt-1 text-sm font-semibold text-slate-600">{tool.tagline}</div>
              <p className="mt-3 text-sm text-slate-600">{tool.description}</p>
              <ul className="mt-4 space-y-2">
                {tool.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="mt-0.5 text-emerald-600">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-[32px] border border-slate-200 bg-slate-950 px-8 py-10 text-white">
          <div className="text-2xl font-black tracking-[-0.03em]">{content.cta.headline}</div>
          <div className="mt-2 text-sm text-slate-200">{content.cta.subheadline}</div>
          <button
            type="button"
            onClick={onLoginClick}
            className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 hover:bg-slate-100"
          >
            {content.cta.buttonText} <ArrowRight size={16} />
          </button>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}

