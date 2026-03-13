import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArrowRight, BarChart3, Calendar, Image, Share2, Zap,
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
    badge: 'Now with AI-powered distribution',
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

const ICON_MAP: Record<string, LucideIcon> = { Calendar, Share2, Image, BarChart3, Zap };

const FeatureIcon = ({ name, size = 18 }: { name: string; size?: number }) => {
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
      <div className="text-4xl sm:text-5xl font-black text-[#5b6cf9] tracking-[-0.04em] mb-2 tabular-nums">{display}</div>
      <div className="text-[14px] text-[#6b7280]">{label}</div>
    </div>
  );
}

// ─── Feature card ─────────────────────────────────────────────────────────────

function FeatureCard({ item, index }: { item: FeatureItem; index: number }) {
  const { ref, visible } = useVisible(0.1);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${(index % 3) * 60}ms` }}
      className={`group rounded-2xl border border-[#e5e7eb] bg-white hover:border-[#c7d0fe] hover:shadow-sm p-6 transition-all duration-200 cursor-default ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      }`}
    >
      <div className="mb-4 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[#eef0fe] text-[#5b6cf9] group-hover:bg-[#5b6cf9] group-hover:text-white transition-colors duration-200">
        <FeatureIcon name={item.icon} />
      </div>
      <h3 className="text-[15px] font-semibold text-[#0f0f11] mb-1.5">{item.title}</h3>
      <p className="text-[14px] text-[#6b7280] leading-relaxed">{item.description}</p>
    </div>
  );
}

// ─── Marquee strip ────────────────────────────────────────────────────────────

function PlatformMarquee() {
  const doubled = [...PLATFORMS, ...PLATFORMS];
  return (
    <div className="overflow-hidden">
      <div className="flex gap-10 animate-marquee whitespace-nowrap">
        {doubled.map((p, i) => (
          <span key={i} className="text-[13px] font-medium text-[#9ca3af] hover:text-[#6b7280] transition-colors duration-200 cursor-default">
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
    <div className="relative w-full max-w-3xl mx-auto mt-16 animate-floatSlow">
      {/* Glow */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#5b6cf9]/8 to-transparent blur-3xl -z-10 scale-110" />

      {/* Browser frame */}
      <div className="rounded-xl border border-[#e5e7eb] bg-white shadow-2xl shadow-slate-900/8 overflow-hidden">
        {/* Chrome */}
        <div className="flex items-center gap-1.5 px-4 py-3 border-b border-[#f3f4f6] bg-[#fafafa]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#f87171]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#fbbf24]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#4ade80]" />
          <div className="flex-1 ml-3 h-5 rounded-md bg-[#e5e7eb] max-w-xs" />
          <div className="w-20 h-5 rounded-md bg-[#e5e7eb]" />
        </div>
        {/* App content */}
        <div className="flex h-52 sm:h-72">
          {/* Sidebar */}
          <div className="w-[180px] border-r border-[#f3f4f6] bg-[#fafafa] hidden sm:flex flex-col p-3 gap-1">
            {['Dashboard', 'Posts', 'Cards', 'Analytics'].map((item, i) => (
              <div key={i} className={`h-8 rounded-lg flex items-center px-3 text-[11px] font-medium ${i === 1 ? 'bg-[#5b6cf9]/10 text-[#5b6cf9]' : 'text-[#9ca3af]'}`}>
                {item}
              </div>
            ))}
          </div>
          {/* Main content */}
          <div className="flex-1 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between mb-1">
              <div className="w-24 h-3 rounded-full bg-[#e5e7eb]" />
              <div className="w-20 h-6 rounded-lg bg-[#5b6cf9]/12" />
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {[true, false, false].map((active, i) => (
                <div key={i} className={`rounded-xl border ${active ? 'border-[#c7d0fe] bg-[#eef0fe]' : 'border-[#e5e7eb] bg-[#f9fafb]'} p-3`}>
                  <div className="w-10 h-1.5 rounded-full bg-[#d1d5db] mb-2" />
                  <div className={`w-8 h-4 rounded ${active ? 'bg-[#5b6cf9]/30' : 'bg-[#d1d5db]'}`} />
                </div>
              ))}
            </div>
            <div className="flex gap-2.5 flex-1">
              {[0,1,2].map((i) => (
                <div key={i} className="flex-1 rounded-xl border border-[#e5e7eb] bg-white p-3 flex flex-col gap-1.5">
                  <div className="w-full h-1.5 rounded-full bg-[#f3f4f6]" />
                  <div className="w-4/5 h-1.5 rounded-full bg-[#f3f4f6]" />
                  <div className="w-3/5 h-1.5 rounded-full bg-[#f3f4f6]" />
                  <div className="mt-auto w-14 h-5 rounded-md bg-[#5b6cf9]/12" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Floating badges */}
      <div className="absolute -left-4 sm:-left-10 top-1/4 bg-white rounded-xl border border-[#e5e7eb] shadow-md shadow-slate-900/8 px-3 py-2 flex items-center gap-2 animate-floatA">
        <span className="w-5 h-5 rounded-full bg-[#dcfce7] flex items-center justify-center text-[10px] text-[#16a34a]">✓</span>
        <span className="text-[12px] font-semibold text-[#374151]">Post published</span>
      </div>
      <div className="absolute -right-2 sm:-right-8 bottom-1/4 bg-white rounded-xl border border-[#e5e7eb] shadow-md shadow-slate-900/8 px-3 py-2 flex items-center gap-2 animate-floatB">
        <span className="text-sm">📈</span>
        <span className="text-[12px] font-semibold text-[#374151]">+24% reach</span>
      </div>
    </div>
  );
}

// ─── Inline animation styles ──────────────────────────────────────────────────

const ANIMATION_STYLES = `
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes marquee {
    from { transform: translateX(0); }
    to   { transform: translateX(-50%); }
  }
  @keyframes floatSlow {
    0%, 100% { transform: translateY(0px); }
    50%      { transform: translateY(-8px); }
  }
  @keyframes floatA {
    0%, 100% { transform: translateY(0px) rotate(-1deg); }
    50%      { transform: translateY(-6px) rotate(1deg); }
  }
  @keyframes floatB {
    0%, 100% { transform: translateY(0px) rotate(1deg); }
    50%      { transform: translateY(-5px) rotate(-1deg); }
  }
  @keyframes pulseDot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.5; transform: scale(1.4); }
  }
  .animate-fadeUp-0  { animation: fadeUp 0.5s ease both 0ms; }
  .animate-fadeUp-1  { animation: fadeUp 0.5s ease both 100ms; }
  .animate-fadeUp-2  { animation: fadeUp 0.5s ease both 200ms; }
  .animate-fadeUp-3  { animation: fadeUp 0.5s ease both 300ms; }
  .animate-fadeUp-4  { animation: fadeUp 0.5s ease both 400ms; }
  .animate-marquee   { animation: marquee 32s linear infinite; }
  .animate-floatSlow { animation: floatSlow 6s ease-in-out infinite; }
  .animate-floatA    { animation: floatA 4s ease-in-out infinite; }
  .animate-floatB    { animation: floatB 5s ease-in-out infinite 0.5s; }
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
    <div className="bg-white text-[#0f0f11] min-h-screen font-sans overflow-x-hidden">
      <style>{ANIMATION_STYLES}</style>
      <PublicNav onLoginClick={onLoginClick} activePath="/" />

      {/* ── Hero ── */}
      <section className="relative flex flex-col items-center justify-center px-6 pt-36 pb-10 text-center overflow-hidden">
        {/* Subtle grid background */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.025]"
          style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', backgroundSize: '48px 48px' }}
        />
        {/* Top blue radial glow */}
        <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[420px] rounded-full bg-[#5b6cf9]/6 blur-3xl" />

        {/* Badge */}
        <div className="animate-fadeUp-0 relative mb-6 inline-flex items-center gap-2 rounded-full border border-[#c7d0fe] bg-[#eef0fe] px-3.5 py-1.5 text-[12px] font-semibold text-[#5b6cf9]">
          <span className="animate-pulseDot h-1.5 w-1.5 rounded-full bg-[#5b6cf9]" />
          {hero.badge}
        </div>

        {/* Headline */}
        <h1 className="relative max-w-4xl">
          {hero.headline.split('\n').map((line, i) => (
            <span
              key={i}
              className={`animate-fadeUp-${i + 1} block font-black tracking-[-0.05em] leading-[0.93] ${
                i === 0
                  ? 'text-5xl sm:text-6xl md:text-7xl lg:text-[88px] text-[#0f0f11]'
                  : 'text-5xl sm:text-6xl md:text-7xl lg:text-[88px] text-transparent bg-clip-text bg-gradient-to-r from-[#5b6cf9] to-[#818cf8]'
              }`}
            >
              {line}
            </span>
          ))}
        </h1>

        {/* Sub-headline */}
        <p className="animate-fadeUp-3 relative mt-7 max-w-[540px] text-[16px] text-[#6b7280] leading-[1.7]">
          {hero.subheadline}
        </p>

        {/* CTAs */}
        <div className="animate-fadeUp-4 relative mt-8 flex flex-col sm:flex-row items-center gap-3">
          <button
            type="button"
            onClick={onLoginClick}
            className="group flex items-center gap-2 bg-[#5b6cf9] hover:bg-[#4f63f7] active:bg-[#4558e8] text-white font-semibold px-6 py-3 rounded-lg text-[15px] transition-all duration-150 shadow-md shadow-blue-200/70 hover:shadow-lg hover:shadow-blue-200/80"
          >
            {hero.ctaPrimary}
            <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform duration-150" />
          </button>
          <button
            type="button"
            onClick={scrollToFeatures}
            className="flex items-center gap-2 text-[15px] font-medium text-[#6b7280] hover:text-[#0f0f11] border border-[#e5e7eb] hover:border-[#d1d5db] bg-white active:scale-[0.98] px-6 py-3 rounded-lg transition-all duration-150"
          >
            {hero.ctaSecondary}
            <span className="text-[#9ca3af]">→</span>
          </button>
        </div>

        {/* App mockup */}
        <AppMockup />
      </section>

      {/* ── Platform marquee ── */}
      <section className="border-y border-[#f3f4f6] bg-[#fafafa] py-6 overflow-hidden">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9ca3af] mb-4">
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
        className="max-w-[1200px] mx-auto px-6 py-24 md:py-28"
      >
        <div className={`text-center mb-14 transition-all duration-500 ${featuresVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#eef0fe] border border-[#c7d0fe] px-3 py-1 text-[12px] font-semibold text-[#5b6cf9] mb-5">
            Features
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-[44px] font-black tracking-[-0.04em] text-[#0f0f11] mb-4 leading-tight">
            {features.title}
          </h2>
          <p className="text-[#6b7280] text-[16px]">{features.subtitle}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {features.items.map((item, i) => (
            <FeatureCard key={i} item={item} index={i} />
          ))}
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="border-y border-[#f3f4f6] bg-[#fafafa] py-16">
        <div className="max-w-[1200px] mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {stats.items.map((s, i) => (
            <StatCounter key={i} value={s.value} label={s.label} />
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <HowItWorks onLoginClick={onLoginClick} />

      {/* ── Testimonial ── */}
      <TestimonialSection />

      {/* ── CTA Banner ── */}
      <CtaBanner headline={cta.headline} subheadline={cta.subheadline} buttonText={cta.buttonText} onLoginClick={onLoginClick} />

      <PublicFooter />
    </div>
  );
}

// ─── How it works section ─────────────────────────────────────────────────────

const STEPS = [
  { num: '01', title: 'Connect your accounts', desc: 'Link Instagram, TikTok, LinkedIn and more in seconds with secure OAuth. No technical setup required.' },
  { num: '02', title: 'Create your content', desc: 'Write posts, design visuals with the Card Builder, and preview across platforms before you publish.' },
  { num: '03', title: 'Schedule and publish', desc: 'Pick your times, let the scheduler handle the rest. Monitor results in real-time Analytics.' },
];

function HowItWorks({ onLoginClick }: { onLoginClick: () => void }) {
  const { ref, visible } = useVisible(0.1);
  return (
    <section ref={ref} className="max-w-[1200px] mx-auto px-6 py-20 md:py-24">
      <div className={`text-center mb-12 transition-all duration-500 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}>
        <div className="inline-flex items-center gap-2 rounded-full bg-[#eef0fe] border border-[#c7d0fe] px-3 py-1 text-[12px] font-semibold text-[#5b6cf9] mb-5">
          How it works
        </div>
        <h2 className="text-3xl sm:text-4xl md:text-[44px] font-black tracking-[-0.04em] text-[#0f0f11] leading-tight">
          Up and running in minutes.
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {STEPS.map((step, i) => (
          <div
            key={i}
            style={{ transitionDelay: `${i * 80}ms` }}
            className={`relative rounded-2xl border border-[#e5e7eb] bg-white p-7 hover:border-[#c7d0fe] hover:shadow-sm transition-all duration-200 ${
              visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
            }`}
          >
            {i < STEPS.length - 1 && (
              <div className="hidden md:block absolute top-1/2 -right-2.5 -translate-y-1/2 text-[#d1d5db] text-xl font-black z-10">→</div>
            )}
            <div className="text-[44px] font-black text-[#f3f4f6] tracking-[-0.05em] mb-4 leading-none">{step.num}</div>
            <h3 className="text-[15px] font-semibold text-[#0f0f11] mb-2">{step.title}</h3>
            <p className="text-[14px] text-[#6b7280] leading-relaxed">{step.desc}</p>
          </div>
        ))}
      </div>

      <div className={`text-center mt-10 transition-all duration-500 delay-300 ${visible ? 'opacity-100' : 'opacity-0'}`}>
        <button
          type="button"
          onClick={onLoginClick}
          className="group inline-flex items-center gap-2 text-[14px] font-semibold text-[#5b6cf9] hover:text-[#4f63f7] transition-colors"
        >
          Get started in seconds
          <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>
    </section>
  );
}

// ─── Testimonial section ──────────────────────────────────────────────────────

function TestimonialSection() {
  const { ref, visible } = useVisible(0.2);
  return (
    <section className="border-y border-[#f3f4f6] bg-[#fafafa] py-16 px-6">
      <div
        ref={ref}
        className={`max-w-[720px] mx-auto text-center transition-all duration-500 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}
      >
        <div className="text-[48px] text-[#c7d0fe] mb-4 leading-none font-serif">"</div>
        <p className="text-[18px] sm:text-[22px] font-medium text-[#374151] leading-[1.55] tracking-[-0.01em]">
          Dakyworld Hub cut our social media publishing time in half. One workspace, every platform — it just works.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#5b6cf9] to-[#818cf8] flex items-center justify-center text-white text-[13px] font-bold">
            AK
          </div>
          <div className="text-left">
            <div className="text-[14px] font-semibold text-[#0f0f11]">Alex Kim</div>
            <div className="text-[13px] text-[#9ca3af]">Head of Marketing, Growify</div>
          </div>
        </div>
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
    <section className="max-w-[1200px] mx-auto px-6 py-20 md:py-28">
      <div
        ref={ref}
        className={`relative rounded-2xl border border-[#c7d0fe] bg-gradient-to-br from-[#eef0fe] via-white to-[#f5f3ff] p-12 md:p-16 text-center overflow-hidden transition-all duration-500 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        {/* Subtle dot grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: 'radial-gradient(#5b6cf9 1px, transparent 0)', backgroundSize: '24px 24px' }}
        />
        <div className="relative">
          <h2 className="text-3xl sm:text-4xl font-black tracking-[-0.04em] text-[#0f0f11] mb-4 max-w-xl mx-auto leading-tight">
            {headline}
          </h2>
          <p className="text-[15px] text-[#6b7280] mb-8 max-w-md mx-auto">{subheadline}</p>
          <button
            type="button"
            onClick={onLoginClick}
            className="group inline-flex items-center gap-2 bg-[#5b6cf9] hover:bg-[#4f63f7] text-white font-semibold px-7 py-3.5 rounded-lg text-[15px] transition-all duration-150 shadow-md shadow-blue-200/70 hover:shadow-lg"
          >
            {buttonText}
            <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </div>
    </section>
  );
}
