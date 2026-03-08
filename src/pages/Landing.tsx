import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArrowRight, BarChart3, Calendar, Globe, Image, Share2, Zap,
  type LucideIcon,
} from 'lucide-react';
import { fetchPageContent } from '../services/pageContentService';
import PublicNav from '../components/landing/PublicNav';
import PublicFooter from '../components/landing/PublicFooter';

// ─── Content types ────────────────────────────────────────────────────────────

export type FeatureItem = { icon: string; title: string; description: string };
export type StatItem = { value: string; label: string };

export type HomepageContent = {
  hero: {
    badge: string;
    headline: string;
    subheadline: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  features: { title: string; subtitle: string; items: FeatureItem[] };
  stats: { items: StatItem[] };
  cta: { headline: string; subheadline: string; buttonText: string };
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
      { icon: 'Calendar', title: 'Smart Scheduling', description: 'Plan and schedule posts weeks in advance. Visualize your content calendar across all platforms.' },
      { icon: 'Share2', title: 'Multi-Platform Publishing', description: 'Publish to Instagram, TikTok, LinkedIn, Facebook, Twitter/X, Threads, and more in one click.' },
      { icon: 'Image', title: 'Card Designer', description: 'Build stunning branded visuals with our drag-and-drop template editor. No design skills required.' },
      { icon: 'BarChart3', title: 'Analytics', description: 'Track performance across platforms. Understand what works and double down on it.' },
      { icon: 'Globe', title: 'Integrations', description: 'Connect WordPress, Mailchimp, and 10+ other tools your team already uses.' },
      { icon: 'Zap', title: 'Lightning Fast', description: 'A snappy, responsive interface built for speed — because every second counts.' },
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

const ICON_MAP: Record<string, LucideIcon> = { Calendar, Share2, Image, BarChart3, Globe, Zap };

const FeatureIcon = ({ name, size = 22 }: { name: string; size?: number }) => {
  const Icon: LucideIcon = ICON_MAP[name] ?? Zap;
  return <Icon size={size} />;
};

// ─── Platform logos ───────────────────────────────────────────────────────────

const PLATFORMS = [
  'Instagram', 'TikTok', 'LinkedIn', 'Facebook',
  'Twitter / X', 'Threads', 'WordPress', 'Mailchimp', 'YouTube', 'Pinterest',
];

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useVisible(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function useCountUp(target: string, running: boolean) {
  const [display, setDisplay] = useState('0');
  useEffect(() => {
    if (!running) return;
    const num = parseFloat(target.replace(/[^0-9.]/g, ''));
    const suffix = target.replace(/[0-9.]/g, '');
    if (isNaN(num) || target === '∞') { setDisplay(target); return; }
    const duration = 1400;
    const steps = 50;
    const interval = duration / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      const progress = step / steps;
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(eased * num);
      setDisplay(`${current}${suffix}`);
      if (step >= steps) clearInterval(timer);
    }, interval);
    return () => clearInterval(timer);
  }, [running, target]);
  return display;
}

// ─── Stat counter ─────────────────────────────────────────────────────────────

function StatCounter({ value, label }: StatItem) {
  const { ref, visible } = useVisible(0.3);
  const display = useCountUp(value, visible);
  return (
    <div ref={ref} className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
      <div className="text-4xl sm:text-5xl font-black text-[#e6332a] tracking-tight mb-2">{display}</div>
      <div className="text-sm text-zinc-500">{label}</div>
    </div>
  );
}

// ─── Feature card ─────────────────────────────────────────────────────────────

function FeatureCard({ item, index }: { item: FeatureItem; index: number }) {
  const { ref, visible } = useVisible(0.1);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${(index % 3) * 80}ms` }}
      className={`group rounded-3xl border border-zinc-100 bg-zinc-50 hover:bg-white hover:border-zinc-200 hover:shadow-lg hover:-translate-y-1 p-7 transition-all duration-300 cursor-default ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}
    >
      <div className="mb-4 inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-red-50 text-[#e6332a] group-hover:scale-110 group-hover:bg-red-100 transition-all duration-300">
        <FeatureIcon name={item.icon} />
      </div>
      <h3 className="text-base font-bold text-zinc-900 mb-2 group-hover:text-[#e6332a] transition-colors duration-200">{item.title}</h3>
      <p className="text-sm text-zinc-500 leading-relaxed">{item.description}</p>
    </div>
  );
}

// ─── Marquee strip ────────────────────────────────────────────────────────────

function PlatformMarquee() {
  const doubled = [...PLATFORMS, ...PLATFORMS];
  return (
    <div className="overflow-hidden">
      <div className="flex gap-12 animate-marquee whitespace-nowrap">
        {doubled.map((p, i) => (
          <span key={i} className="text-sm font-semibold text-zinc-300 hover:text-zinc-600 transition-colors duration-200 cursor-default">
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── App mockup ───────────────────────────────────────────────────────────────

function AppMockup() {
  return (
    <div className="relative w-full max-w-2xl mx-auto mt-16 animate-floatSlow">
      {/* Browser frame */}
      <div className="rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-200/80 overflow-hidden">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-100 bg-zinc-50">
          <span className="w-3 h-3 rounded-full bg-red-400" />
          <span className="w-3 h-3 rounded-full bg-yellow-400" />
          <span className="w-3 h-3 rounded-full bg-green-400" />
          <div className="flex-1 ml-3 h-5 rounded-md bg-zinc-200 max-w-xs" />
        </div>
        {/* App content preview */}
        <div className="flex h-48 sm:h-64">
          {/* Sidebar */}
          <div className="w-14 border-r border-zinc-100 bg-zinc-50 flex flex-col items-center pt-4 gap-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className={`w-8 h-8 rounded-xl ${i === 0 ? 'bg-[#e6332a]/20' : 'bg-zinc-200'}`} />
            ))}
          </div>
          {/* Main content */}
          <div className="flex-1 p-4 flex flex-col gap-3">
            <div className="flex gap-3">
              {['bg-red-50 border-red-100', 'bg-zinc-50 border-zinc-100', 'bg-zinc-50 border-zinc-100'].map((cls, i) => (
                <div key={i} className={`flex-1 rounded-xl border ${cls} p-3`}>
                  <div className="w-12 h-2 rounded bg-zinc-200 mb-2" />
                  <div className="w-8 h-4 rounded bg-zinc-300 font-black" />
                </div>
              ))}
            </div>
            <div className="flex gap-3 flex-1">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex-1 rounded-xl border border-zinc-100 bg-zinc-50 p-3 flex flex-col gap-2">
                  <div className="w-full h-2 rounded bg-zinc-200" />
                  <div className="w-3/4 h-2 rounded bg-zinc-200" />
                  <div className="w-1/2 h-2 rounded bg-zinc-200" />
                  <div className="mt-auto w-16 h-5 rounded-lg bg-[#e6332a]/20" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* Floating badges */}
      <div className="absolute -left-6 top-1/4 bg-white rounded-2xl border border-zinc-100 shadow-lg px-3 py-2 flex items-center gap-2 animate-floatA">
        <span className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-xs font-bold">✓</span>
        <span className="text-xs font-semibold text-zinc-700">Post published</span>
      </div>
      <div className="absolute -right-4 bottom-1/4 bg-white rounded-2xl border border-zinc-100 shadow-lg px-3 py-2 flex items-center gap-2 animate-floatB">
        <span className="text-base">📈</span>
        <span className="text-xs font-semibold text-zinc-700">+24% reach</span>
      </div>
    </div>
  );
}

// ─── Inline animation styles ──────────────────────────────────────────────────

const ANIMATION_STYLES = `
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(28px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes marquee {
    from { transform: translateX(0); }
    to   { transform: translateX(-50%); }
  }
  @keyframes floatSlow {
    0%, 100% { transform: translateY(0px); }
    50%      { transform: translateY(-10px); }
  }
  @keyframes floatA {
    0%, 100% { transform: translateY(0px) rotate(-1deg); }
    50%      { transform: translateY(-8px) rotate(1deg); }
  }
  @keyframes floatB {
    0%, 100% { transform: translateY(0px) rotate(1deg); }
    50%      { transform: translateY(-6px) rotate(-1deg); }
  }
  @keyframes blobMove {
    0%, 100% { transform: translate(0, 0) scale(1); }
    33%      { transform: translate(30px, -20px) scale(1.05); }
    66%      { transform: translate(-20px, 15px) scale(0.97); }
  }
  @keyframes pulseDot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: 0.6; transform: scale(1.4); }
  }
  .animate-fadeUp-0  { animation: fadeUp 0.6s ease both 0ms; }
  .animate-fadeUp-1  { animation: fadeUp 0.6s ease both 120ms; }
  .animate-fadeUp-2  { animation: fadeUp 0.6s ease both 220ms; }
  .animate-fadeUp-3  { animation: fadeUp 0.6s ease both 320ms; }
  .animate-fadeUp-4  { animation: fadeUp 0.6s ease both 420ms; }
  .animate-marquee   { animation: marquee 28s linear infinite; }
  .animate-floatSlow { animation: floatSlow 6s ease-in-out infinite; }
  .animate-floatA    { animation: floatA 4s ease-in-out infinite; }
  .animate-floatB    { animation: floatB 5s ease-in-out infinite 0.5s; }
  .animate-blob      { animation: blobMove 12s ease-in-out infinite; }
  .animate-pulseDot  { animation: pulseDot 2s ease-in-out infinite; }
`;

// ─── Main ─────────────────────────────────────────────────────────────────────

type LandingProps = { onLoginClick: () => void };

export default function Landing({ onLoginClick }: LandingProps) {
  const [content, setContent] = useState<HomepageContent>(defaultHomepageContent);
  const featuresRef = useRef<HTMLElement>(null);
  const { ref: featuresVisRef, visible: featuresVisible } = useVisible(0.05);

  useEffect(() => {
    void fetchPageContent<HomepageContent>('homepage').then((d) => { if (d) setContent(d); });
  }, []);

  const scrollToFeatures = useCallback(() => {
    featuresRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const { hero, features, stats, cta } = content;

  return (
    <div className="bg-white text-zinc-900 min-h-screen font-sans overflow-x-hidden">
      <style>{ANIMATION_STYLES}</style>
      <PublicNav onLoginClick={onLoginClick} activePath="/" />

      {/* ── Hero ── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-28 pb-12 text-center overflow-hidden">
        {/* Animated background blobs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="animate-blob absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[500px] rounded-full bg-gradient-to-br from-red-100/70 via-rose-50/50 to-transparent blur-3xl" />
          <div className="animate-blob absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-gradient-to-tl from-zinc-100/80 to-transparent blur-3xl" style={{ animationDelay: '4s' }} />
        </div>

        {/* Dot grid overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 0)', backgroundSize: '28px 28px' }}
        />

        {/* Badge */}
        <div className="animate-fadeUp-0 relative mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 backdrop-blur-sm px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-500 shadow-sm">
          <span className="animate-pulseDot h-1.5 w-1.5 rounded-full bg-[#e6332a]" />
          {hero.badge}
        </div>

        {/* Headline */}
        <h1 className="relative max-w-4xl">
          {hero.headline.split('\n').map((line, i) => (
            <span
              key={i}
              className={`animate-fadeUp-${i + 1} block text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-[-0.04em] leading-[0.95] ${
                i > 0 ? 'text-[#e6332a]' : 'text-zinc-900'
              }`}
            >
              {line}
            </span>
          ))}
        </h1>

        {/* Sub-headline */}
        <p className="animate-fadeUp-3 relative mt-6 max-w-xl text-base sm:text-lg text-zinc-500 leading-relaxed">
          {hero.subheadline}
        </p>

        {/* CTAs */}
        <div className="animate-fadeUp-4 relative mt-8 flex flex-col sm:flex-row items-center gap-4">
          <button
            type="button"
            onClick={onLoginClick}
            className="group flex items-center gap-2 bg-[#e6332a] hover:bg-[#cc2921] active:scale-95 text-white font-bold px-7 py-4 rounded-2xl text-sm transition-all duration-200 shadow-md shadow-red-100 hover:shadow-lg hover:shadow-red-200"
          >
            {hero.ctaPrimary}
            <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform duration-200" />
          </button>
          <button
            type="button"
            onClick={scrollToFeatures}
            className="group text-sm font-semibold text-zinc-600 hover:text-zinc-900 border border-zinc-200 hover:border-zinc-300 bg-white active:scale-95 px-7 py-4 rounded-2xl transition-all duration-200 shadow-sm hover:shadow-md"
          >
            {hero.ctaSecondary}
            <span className="inline-block ml-1 group-hover:translate-x-0.5 transition-transform duration-200">→</span>
          </button>
        </div>

        {/* App mockup */}
        <AppMockup />
      </section>

      {/* ── Platform marquee ── */}
      <section className="border-y border-zinc-100 bg-zinc-50 py-7 overflow-hidden">
        <p className="text-center text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-5">
          Connects with your favourite platforms
        </p>
        <PlatformMarquee />
      </section>

      {/* ── Features ── */}
      <section
        id="features"
        ref={(el) => {
          (featuresRef as React.MutableRefObject<HTMLElement | null>).current = el;
          (featuresVisRef as React.MutableRefObject<HTMLDivElement | null>).current = el as HTMLDivElement;
        }}
        className="max-w-7xl mx-auto px-6 py-24 md:py-32"
      >
        <div className={`text-center mb-16 transition-all duration-700 ${featuresVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-[-0.03em] text-zinc-900 mb-4">
            {features.title}
          </h2>
          <p className="text-zinc-500 text-base sm:text-lg">{features.subtitle}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.items.map((item, i) => (
            <FeatureCard key={i} item={item} index={i} />
          ))}
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="border-y border-zinc-100 bg-zinc-50 py-16">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {stats.items.map((s, i) => (
            <StatCounter key={i} value={s.value} label={s.label} />
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <HowItWorks onLoginClick={onLoginClick} />

      {/* ── CTA Banner ── */}
      <CtaBanner headline={cta.headline} subheadline={cta.subheadline} buttonText={cta.buttonText} onLoginClick={onLoginClick} />

      <PublicFooter />
    </div>
  );
}

// ─── How it works section ─────────────────────────────────────────────────────

const STEPS = [
  { num: '01', title: 'Connect your accounts', desc: 'Link Instagram, TikTok, LinkedIn and more in seconds with secure OAuth.' },
  { num: '02', title: 'Create your content', desc: 'Write posts, design visuals with the Card Builder, and preview across platforms.' },
  { num: '03', title: 'Schedule and publish', desc: 'Pick your times, let the scheduler handle the rest. Monitor results in Analytics.' },
];

function HowItWorks({ onLoginClick }: { onLoginClick: () => void }) {
  const { ref, visible } = useVisible(0.1);
  return (
    <section ref={ref} className="max-w-6xl mx-auto px-6 py-20 md:py-28">
      <div className={`text-center mb-14 transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-5">
          How it works
        </div>
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-[-0.03em] text-zinc-900">
          Up and running in minutes.
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {STEPS.map((step, i) => (
          <div
            key={i}
            style={{ transitionDelay: `${i * 100}ms` }}
            className={`relative rounded-3xl border border-zinc-100 bg-white p-8 hover:border-zinc-200 hover:shadow-md transition-all duration-300 ${
              visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
          >
            {i < STEPS.length - 1 && (
              <div className="hidden md:block absolute top-1/2 -right-3 -translate-y-1/2 text-zinc-200 text-2xl font-black z-10">→</div>
            )}
            <div className="text-5xl font-black text-zinc-100 tracking-[-0.04em] mb-4 leading-none">{step.num}</div>
            <h3 className="text-base font-bold text-zinc-900 mb-2">{step.title}</h3>
            <p className="text-sm text-zinc-500 leading-relaxed">{step.desc}</p>
          </div>
        ))}
      </div>

      <div className={`text-center mt-10 transition-all duration-700 delay-300 ${visible ? 'opacity-100' : 'opacity-0'}`}>
        <button
          type="button"
          onClick={onLoginClick}
          className="group inline-flex items-center gap-2 text-sm font-bold text-[#e6332a] hover:text-[#cc2921] transition-colors"
        >
          Get started in seconds
          <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>
    </section>
  );
}

// ─── CTA banner ───────────────────────────────────────────────────────────────

function CtaBanner({ headline, subheadline, buttonText, onLoginClick }: {
  headline: string; subheadline: string; buttonText: string; onLoginClick: () => void;
}) {
  const { ref, visible } = useVisible(0.2);
  return (
    <section className="max-w-4xl mx-auto px-6 pb-24 md:pb-32">
      <div
        ref={ref}
        className={`rounded-3xl border border-zinc-100 bg-zinc-50 p-12 md:p-16 text-center relative overflow-hidden transition-all duration-700 hover:shadow-lg hover:border-zinc-200 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        {/* Red top accent line */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-1 rounded-full bg-[#e6332a]" />
        {/* Subtle background glow */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-red-50/40 to-transparent" />

        <h2 className="relative text-3xl sm:text-4xl md:text-5xl font-black tracking-[-0.03em] text-zinc-900 mb-4">
          {headline}
        </h2>
        <p className="relative text-zinc-500 text-base sm:text-lg mb-8 max-w-md mx-auto">{subheadline}</p>
        <button
          type="button"
          onClick={onLoginClick}
          className="relative group inline-flex items-center gap-2 bg-[#e6332a] hover:bg-[#cc2921] active:scale-95 text-white font-bold px-8 py-4 rounded-2xl text-sm transition-all duration-200 shadow-md shadow-red-100 hover:shadow-lg hover:shadow-red-200"
        >
          {buttonText}
          <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform duration-200" />
        </button>
      </div>
    </section>
  );
}
