import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BarChart3, Calendar, Globe, Image, Share2, Zap, Menu, X, type LucideIcon } from 'lucide-react';
import { fetchPageContent } from '../services/pageContentService';

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

// ─── Platform logos strip ─────────────────────────────────────────────────────

const PLATFORMS = [
  'Instagram',
  'TikTok',
  'LinkedIn',
  'Facebook',
  'Twitter/X',
  'Threads',
  'WordPress',
  'Mailchimp',
  'YouTube',
  'Pinterest',
];

// ─── Nav ──────────────────────────────────────────────────────────────────────

function Nav({ onLoginClick }: { onLoginClick: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navLinks = [
    { label: 'Features', href: '#features' },
    { label: 'Pricing', href: '/pricing-public' },
    { label: 'Tools', href: '/tools' },
  ];

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-[#08080c]/95 backdrop-blur-md border-b border-white/5' : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <span className="text-xl font-black tracking-[-0.04em] text-white">
            Dakyworld<span className="text-[#e6332a]">.</span>
          </span>
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-sm font-medium text-white/60 hover:text-white transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center gap-3">
          <button
            type="button"
            onClick={onLoginClick}
            className="text-sm font-semibold text-white/70 hover:text-white transition-colors"
          >
            Log in
          </button>
          <button
            type="button"
            onClick={onLoginClick}
            className="bg-[#e6332a] hover:bg-[#cc2921] text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-colors"
          >
            Get started
          </button>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          className="md:hidden text-white/70 hover:text-white"
          onClick={() => setMobileOpen((p) => !p)}
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-[#0f0f14] border-t border-white/5 px-6 py-4 flex flex-col gap-4">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-sm font-medium text-white/70 hover:text-white transition-colors"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <button
            type="button"
            onClick={() => { setMobileOpen(false); onLoginClick(); }}
            className="bg-[#e6332a] text-white text-sm font-bold px-5 py-3 rounded-xl"
          >
            Get started
          </button>
        </div>
      )}
    </header>
  );
}

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
    <div className="bg-[#08080c] text-white min-h-screen font-sans">
      <Nav onLoginClick={onLoginClick} />

      {/* ── Hero ── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-16 text-center overflow-hidden">
        {/* Background glow */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="w-[600px] h-[600px] rounded-full bg-[#e6332a]/10 blur-[120px]" />
        </div>

        {/* Badge */}
        <div className="relative mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-white/60">
          <span className="h-1.5 w-1.5 rounded-full bg-[#e6332a]" />
          {hero.badge}
        </div>

        {/* Headline */}
        <h1 className="relative max-w-4xl text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-[-0.04em] leading-[0.95] mb-6">
          {hero.headline.split('\n').map((line, i) => (
            <span key={i} className={i > 0 ? 'block text-[#e6332a]' : 'block'}>
              {line}
            </span>
          ))}
        </h1>

        {/* Sub-headline */}
        <p className="relative max-w-xl text-base sm:text-lg text-white/50 leading-relaxed mb-10">
          {hero.subheadline}
        </p>

        {/* CTAs */}
        <div className="relative flex flex-col sm:flex-row items-center gap-4">
          <button
            type="button"
            onClick={onLoginClick}
            className="group flex items-center gap-2 bg-[#e6332a] hover:bg-[#cc2921] text-white font-bold px-7 py-4 rounded-2xl text-sm transition-colors"
          >
            {hero.ctaPrimary}
            <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
          <button
            type="button"
            onClick={scrollToFeatures}
            className="text-sm font-semibold text-white/50 hover:text-white border border-white/10 hover:border-white/20 px-7 py-4 rounded-2xl transition-colors"
          >
            {hero.ctaSecondary}
          </button>
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-30">
          <div className="w-px h-12 bg-gradient-to-b from-transparent to-white" />
        </div>
      </section>

      {/* ── Platform strip ── */}
      <section className="border-y border-white/5 py-6 overflow-hidden">
        <div className="flex items-center gap-2 mb-3 justify-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-white/30">Connects with</span>
        </div>
        <div className="flex gap-8 overflow-x-auto no-scrollbar px-6 justify-center flex-wrap">
          {PLATFORMS.map((p) => (
            <span key={p} className="text-sm font-semibold text-white/25 hover:text-white/50 transition-colors whitespace-nowrap">
              {p}
            </span>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" ref={featuresRef} className="max-w-7xl mx-auto px-6 py-24 md:py-32">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-[-0.03em] mb-4">
            {features.title}
          </h2>
          <p className="text-white/40 text-base sm:text-lg">{features.subtitle}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.items.map((item, i) => (
            <div
              key={i}
              className="group rounded-3xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/10 p-7 transition-all duration-300"
            >
              <div className="mb-4 inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-[#e6332a]/10 text-[#e6332a]">
                <FeatureIcon name={item.icon} />
              </div>
              <h3 className="text-base font-bold mb-2">{item.title}</h3>
              <p className="text-sm text-white/40 leading-relaxed">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="border-y border-white/5 py-16">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {stats.items.map((s, i) => (
            <div key={i}>
              <div className="text-4xl sm:text-5xl font-black text-[#e6332a] tracking-tight mb-2">{s.value}</div>
              <div className="text-sm text-white/40">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA Banner ── */}
      <section className="max-w-4xl mx-auto px-6 py-24 md:py-32 text-center">
        <div className="rounded-3xl border border-white/5 bg-white/[0.03] p-12 md:p-16 relative overflow-hidden">
          {/* Glow */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="w-72 h-72 rounded-full bg-[#e6332a]/15 blur-[80px]" />
          </div>

          <h2 className="relative text-3xl sm:text-4xl md:text-5xl font-black tracking-[-0.03em] mb-4">
            {cta.headline}
          </h2>
          <p className="relative text-white/40 text-base sm:text-lg mb-8 max-w-md mx-auto">{cta.subheadline}</p>
          <button
            type="button"
            onClick={onLoginClick}
            className="relative group inline-flex items-center gap-2 bg-[#e6332a] hover:bg-[#cc2921] text-white font-bold px-8 py-4 rounded-2xl text-sm transition-colors"
          >
            {cta.buttonText}
            <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/5 px-6 py-10">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/25">
          <span className="font-black text-sm text-white/40 tracking-[-0.03em]">
            Dakyworld<span className="text-[#e6332a]">.</span>
          </span>
          <div className="flex items-center gap-6">
            <a href="/privacy" className="hover:text-white/50 transition-colors">Privacy Policy</a>
            <a href="/terms" className="hover:text-white/50 transition-colors">Terms of Service</a>
            <a href="/login" className="hover:text-white/50 transition-colors">Log in</a>
          </div>
          <span>© {new Date().getFullYear()} Dakyworld. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
