import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BarChart3, Calendar, Globe, Image, Share2, Zap, type LucideIcon } from 'lucide-react';
import { fetchPageContent } from '../services/pageContentService';
import PublicNav from '../components/landing/PublicNav';
import PublicFooter from '../components/landing/PublicFooter';

// ─── Content types ────────────────────────────────────────────────────────────

export type FeatureItem = {
  icon: string;
  title: string;
  description: string;
};

export type StatItem = {
  value: string;
  label: string;
};

export type HomepageContent = {
  hero: {
    badge: string;
    headline: string;
    subheadline: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  features: {
    title: string;
    subtitle: string;
    items: FeatureItem[];
  };
  stats: {
    items: StatItem[];
  };
  cta: {
    headline: string;
    subheadline: string;
    buttonText: string;
  };
};

export const defaultHomepageContent: HomepageContent = {
  hero: {
    badge: 'Social Media Management Platform',
    headline: 'Publish smarter.\nGrow faster.',
    subheadline:
      'Dakyworld Hub gives your team one powerful workspace to create, schedule, and publish content across every social platform — all from one place.',
    ctaPrimary: 'Start for free',
    ctaSecondary: 'See how it works',
  },
  features: {
    title: 'Everything your brand needs',
    subtitle: 'One platform. Every tool. Zero complexity.',
    items: [
      {
        icon: 'Calendar',
        title: 'Smart Scheduling',
        description:
          'Plan and schedule posts weeks in advance. Visualize your content calendar across all platforms.',
      },
      {
        icon: 'Share2',
        title: 'Multi-Platform Publishing',
        description:
          'Publish to Instagram, TikTok, LinkedIn, Facebook, Twitter/X, Threads, and more in one click.',
      },
      {
        icon: 'Image',
        title: 'Card Designer',
        description:
          'Build stunning branded visuals with our drag-and-drop template editor. No design skills required.',
      },
      {
        icon: 'BarChart3',
        title: 'Analytics',
        description:
          'Track performance across platforms. Understand what works and double down on it.',
      },
      {
        icon: 'Globe',
        title: 'Integrations',
        description:
          'Connect WordPress, Mailchimp, and 10+ other tools your team already uses.',
      },
      {
        icon: 'Zap',
        title: 'Lightning Fast',
        description:
          'A snappy, responsive interface built for speed — because every second counts.',
      },
    ],
  },
  stats: {
    items: [
      { value: '10+', label: 'Platforms supported' },
      { value: '∞', label: 'Posts scheduled' },
      { value: '100%', label: 'Your content' },
      { value: '1', label: 'Workspace for all' },
    ],
  },
  cta: {
    headline: 'Ready to take control of your social presence?',
    subheadline: 'Join Dakyworld Hub and start publishing smarter today.',
    buttonText: "Get started — it's free",
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

const FeatureIcon = ({ name, size = 22 }: { name: string; size?: number }) => {
  const Icon: LucideIcon = ICON_MAP[name] ?? Zap;
  return <Icon size={size} />;
};

const PLATFORMS = [
  'Instagram', 'TikTok', 'LinkedIn', 'Facebook',
  'Twitter / X', 'Threads', 'WordPress', 'Mailchimp', 'YouTube', 'Pinterest',
];

// ─── Main Landing Page ────────────────────────────────────────────────────────

type LandingProps = {
  onLoginClick: () => void;
};

export default function Landing({ onLoginClick }: LandingProps) {
  const [content, setContent] = useState<HomepageContent>(defaultHomepageContent);
  const featuresRef = useRef<HTMLElement>(null);

  useEffect(() => {
    void fetchPageContent<HomepageContent>('homepage').then((data) => {
      if (data) setContent(data);
    });
  }, []);

  const scrollToFeatures = () => {
    featuresRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const { hero, features, stats, cta } = content;

  return (
    <div className="bg-white text-zinc-900 min-h-screen font-sans">
      <PublicNav onLoginClick={onLoginClick} activePath="/" />

      {/* ── Hero ── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-20 text-center overflow-hidden">
        {/* Subtle top gradient wash */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-red-50/70 via-white to-white" />

        {/* Badge */}
        <div className="relative mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-500 shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-[#e6332a]" />
          {hero.badge}
        </div>

        {/* Headline */}
        <h1 className="relative max-w-4xl text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-[-0.04em] leading-[0.95] mb-6">
          {hero.headline.split('\n').map((line, i) => (
            <span key={i} className={`block ${i > 0 ? 'text-[#e6332a]' : 'text-zinc-900'}`}>
              {line}
            </span>
          ))}
        </h1>

        {/* Sub-headline */}
        <p className="relative max-w-xl text-base sm:text-lg text-zinc-500 leading-relaxed mb-10">
          {hero.subheadline}
        </p>

        {/* CTAs */}
        <div className="relative flex flex-col sm:flex-row items-center gap-4">
          <button
            type="button"
            onClick={onLoginClick}
            className="group flex items-center gap-2 bg-[#e6332a] hover:bg-[#cc2921] text-white font-bold px-7 py-4 rounded-2xl text-sm transition-colors shadow-md shadow-red-100"
          >
            {hero.ctaPrimary}
            <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
          <button
            type="button"
            onClick={scrollToFeatures}
            className="text-sm font-semibold text-zinc-600 hover:text-zinc-900 border border-zinc-200 hover:border-zinc-300 bg-white px-7 py-4 rounded-2xl transition-colors shadow-sm"
          >
            {hero.ctaSecondary}
          </button>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 opacity-20">
          <div className="w-px h-12 bg-gradient-to-b from-transparent to-zinc-900" />
        </div>
      </section>

      {/* ── Platform strip ── */}
      <section className="border-y border-zinc-100 bg-zinc-50 py-8">
        <p className="text-center text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-5">
          Connects with
        </p>
        <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 px-6">
          {PLATFORMS.map((p) => (
            <span key={p} className="text-sm font-semibold text-zinc-300 hover:text-zinc-500 transition-colors whitespace-nowrap">
              {p}
            </span>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" ref={featuresRef} className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-[-0.03em] text-zinc-900 mb-4">
            {features.title}
          </h2>
          <p className="text-zinc-500 text-base sm:text-lg">{features.subtitle}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.items.map((item, i) => (
            <div
              key={i}
              className="group rounded-3xl border border-zinc-100 bg-zinc-50 hover:bg-white hover:border-zinc-200 hover:shadow-md p-7 transition-all duration-300"
            >
              <div className="mb-4 inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-red-50 text-[#e6332a]">
                <FeatureIcon name={item.icon} />
              </div>
              <h3 className="text-base font-bold text-zinc-900 mb-2">{item.title}</h3>
              <p className="text-sm text-zinc-500 leading-relaxed">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="border-y border-zinc-100 bg-zinc-50 py-16">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {stats.items.map((s, i) => (
            <div key={i}>
              <div className="text-4xl sm:text-5xl font-black text-[#e6332a] tracking-tight mb-2">{s.value}</div>
              <div className="text-sm text-zinc-500">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA Banner ── */}
      <section className="max-w-4xl mx-auto px-6 py-24 md:py-32 text-center">
        <div className="rounded-3xl border border-zinc-100 bg-zinc-50 p-12 md:p-16 relative overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-1 rounded-full bg-[#e6332a]" />
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-[-0.03em] text-zinc-900 mb-4">
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
