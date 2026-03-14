import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, BarChart3, Calendar, Image, Share2, Zap, type LucideIcon, MessageSquare, Bell, List, Plus, Users, Settings, Mic, Video, ChevronRight, Hash, Search, Home, ChevronDown
} from 'lucide-react';
import { fetchPageContent } from '../services/pageContentService';
import PublicFooter from '../components/landing/PublicFooter';

// ─── TYPES AND DEFAULTS FROM OLD FILE (to keep features, stats, etc. working) ──────────────────

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

const ICON_MAP: Record<string, LucideIcon> = { Calendar, Share2, Image, BarChart3, Zap };

const FeatureIcon = ({ name, size = 18 }: { name: string; size?: number }) => {
  const Icon: LucideIcon = ICON_MAP[name] ?? Zap;
  return <Icon size={size} />;
};


// ─── NEW HERO SECTION COMPONENTS ────────────────────────────────────────────────

const NewHeader = () => {
  return (
    <header className="sticky top-0 z-50 h-20 bg-white/80 backdrop-blur-lg border-b border-border-gray">
      <div className="container mx-auto flex h-full items-center justify-between px-6 md:px-20">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary-blue">
            <MessageSquare size={20} className="text-white" />
          </div>
          <span className="text-2xl font-bold text-text-dark tracking-tighter">ChatFlow</span>
        </div>
        <nav className="hidden md:flex items-center gap-10">
          <a href="#" className="text-nav text-text-gray hover:text-text-dark transition-colors">Features</a>
          <a href="#" className="text-nav text-text-gray hover:text-text-dark transition-colors">Benefits</a>
          <a href="#" className="text-nav text-text-gray hover:text-text-dark transition-colors">Integrations</a>
          <a href="#" className="text-nav text-text-gray hover:text-text-dark transition-colors">Pricing</a>
          <a href="#" className="text-nav text-text-gray hover:text-text-dark transition-colors">FAQ</a>
          <a href="#" className="text-nav text-text-gray hover:text-text-dark transition-colors">Blogs</a>
        </nav>
        <div className="hidden md:block">
          <button className="text-btn rounded-md bg-dark-blue px-6 py-3 text-white hover:opacity-90 transition-opacity">
            Get Started
          </button>
        </div>
      </div>
    </header>
  );
};

const FloatingIconCard = ({ icon, position, size, iconSize = 50, iconClass = '' }: { icon: React.ElementType, position: string, size: string, iconSize?: number, iconClass?: string }) => (
    <div className={`absolute ${position} ${size} hidden md:flex items-center justify-center rounded-2xl bg-white shadow-floating-icon`}>
        <div className='p-5'>
            {React.createElement(icon, { size: iconSize, className: iconClass })}
        </div>
    </div>
);

const AppPreview = () => {
  return (
    <div className="relative mx-auto -mt-10 w-full max-w-[900px]">
      <div className="rounded-t-2xl bg-[#F1F5F9] px-4 py-3 flex items-center gap-2">
        <div className="h-3 w-3 rounded-full bg-[#EF4444]"></div>
        <div className="h-3 w-3 rounded-full bg-[#F59E0B]"></div>
        <div className="h-3 w-3 rounded-full bg-[#22C55E]"></div>
      </div>
      <div className="flex h-[400px] rounded-b-2xl bg-white shadow-app-preview overflow-hidden">
        {/* Sidebar */}
        <div className="hidden md:flex flex-col w-[220px] bg-sidebar-dark p-4">
          <div className="flex items-center gap-3 border-b border-gray-500/20 pb-4">
              <div className="h-8 w-8 rounded-md bg-primary-blue"></div>
              <span className="text-white font-semibold text-md">ChatFlow</span>
              <ChevronDown size={16} className="text-text-light-gray ml-auto" />
          </div>
          <div className="py-4">
            <span className="text-text-gray text-xs font-semibold tracking-wider uppercase">Options</span>
            <nav className="mt-3 flex flex-col gap-1">
                <a href="#" className="flex items-center gap-3 rounded-md px-3 py-2 text-body-small text-text-light-gray bg-[#334155]">
                    <Home size={20} className="text-orange-500"/> Search
                </a>
                 <a href="#" className="flex items-center gap-3 rounded-md px-3 py-2 text-body-small text-text-light-gray hover:bg-[#334155]">
                    <Search size={20} /> Search
                </a>
                <a href="#" className="flex items-center gap-3 rounded-md px-3 py-2 text-body-small text-text-light-gray hover:bg-[#334155]">
                    <Users size={20} /> Members
                </a>
                <a href="#" className="flex items-center gap-3 rounded-md px-3 py-2 text-body-small text-text-light-gray hover:bg-[#334155]">
                    <Settings size={20} /> Settings
                </a>
                <a href="#" className="flex items-center gap-3 rounded-md px-3 py-2 text-body-small text-text-light-gray hover:bg-[#334155]">
                    <Bell size={20} /> Notification
                </a>
            </nav>
          </div>
        </div>
        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col bg-white">
            <div className="flex h-14 items-center justify-between border-b border-border-gray px-5">
                <div className="flex items-center gap-2">
                    <Hash size={20} className="text-primary-blue" />
                    <span className="text-md font-semibold text-text-dark">SuperbI-Project</span>
                </div>
                <div className="flex items-center gap-4">
                    <Mic size={20} className="text-text-light-gray" />
                    <Video size={20} className="text-text-light-gray" />
                    <ChevronRight size={20} className="text-text-light-gray" />
                </div>
            </div>
            <div className="flex-1 p-5 space-y-5 overflow-y-auto">
                {/* Messages */}
                {[
                    { avatar: 'bg-red-400', name: 'Tiana Korsgaard', time: '5:20 PM', text: "It's going well. We've made some good progress on the design and we're starting to work on the development phase." },
                    { avatar: 'bg-blue-400', name: 'Corey Dias', time: '5:20 PM', text: "That's great to hear. Have you run into any issues or roadblocks so far?" },
                    { avatar: 'bg-teal-400', name: 'Talan Rosser', time: '5:20 PM', text: "Not really, everything has been going smoothly. We did have to make some changes to the initial plan, but we were able to adjust quickly." }
                ].map((msg, i) => (
                    <div key={i} className="flex items-start gap-3">
                        <div className={`h-9 w-9 rounded-full ${msg.avatar}`}></div>
                        <div className="flex-1">
                            <div className="flex items-baseline gap-2">
                                <span className="text-sm font-semibold text-text-dark">{msg.name}</span>
                                <span className="text-xs text-text-light-gray">{msg.time}</span>
                            </div>
                            <p className="text-body-small text-text-gray">{msg.text}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
        {/* Right Sidebar */}
        <div className="hidden lg:block w-[200px] border-l border-border-gray p-4">
            <h3 className="text-sm font-semibold text-text-dark mb-5">Detail Channels</h3>
            <div className='space-y-5'>
                <div>
                    <label className="text-xs text-text-light-gray font-semibold tracking-wider uppercase">Name Channel</label>
                    <div className="flex items-center gap-1.5 mt-2">
                        <Hash size={14} className="text-primary-blue" />
                        <span className="text-sm font-medium text-text-dark">Superbl-Project</span>
                    </div>
                </div>
                <div>
                    <label className="text-xs text-text-light-gray font-semibold tracking-wider uppercase">About</label>
                    <p className="text-xs text-text-gray mt-2">Discussion and Creating design with Superb result!</p>
                </div>
                 <div>
                    <label className="text-xs text-text-light-gray font-semibold tracking-wider uppercase flex justify-between items-center">
                        <span>Member</span>
                        <Plus size={16}/>
                    </label>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};


const NewHeroSection = ({ onLoginClick }: { onLoginClick: () => void }) => {
  return (
    <section className="relative bg-white pt-20 pb-10 text-center overflow-hidden">
        <div className="container mx-auto px-6 md:px-20">
             {/* Trust Badge */}
            <div className="flex justify-center items-center mb-8">
                <div className="flex items-center gap-2 rounded-full bg-badge-green-bg px-4 py-2 text-sm text-badge-green-text font-medium">
                    <div className="flex -space-x-2 overflow-hidden">
                        <img className="inline-block h-6 w-6 rounded-full ring-2 ring-white" src="https://i.pravatar.cc/24?img=1" alt="" />
                        <img className="inline-block h-6 w-6 rounded-full ring-2 ring-white" src="https://i.pravatar.cc/24?img=2" alt="" />
                        <img className="inline-block h-6 w-6 rounded-full ring-2 ring-white" src="https://i.pravatar.cc/24?img=3" alt="" />
                    </div>
                    <span>Trusted by 10K+ teams</span>
                </div>
            </div>

            {/* Headline */}
            <h1 className="text-h1 text-text-dark max-w-4xl mx-auto">
                Consolidate Your Team Conversations
            </h1>

            {/* Sub-headline */}
            <p className="text-body-large text-text-gray max-w-xl mx-auto mt-6">
                A single, powerful dashboard for real-time messaging, channels, and collaboration.
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-col items-center gap-4">
                 <button
                    type="button"
                    onClick={onLoginClick}
                    className="text-btn rounded-md bg-dark-blue px-8 py-4 text-white hover:opacity-90 transition-transform hover:-translate-y-0.5"
                >
                    Get Started For Free
                </button>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-text-gray">No credit card required</span>
                </div>
            </div>
        </div>

        {/* Floating Icons */}
        <FloatingIconCard icon={MessageSquare} position="top-32 left-20" size="w-24 h-24" iconClass="text-primary-blue" />
        <FloatingIconCard icon={Bell} position="top-64 left-44" size="w-22 h-22" iconSize={40} iconClass="text-primary-blue" />
        <FloatingIconCard icon={List} position="top-96 left-24" size="w-28 h-28" iconSize={60} iconClass="text-primary-blue" />
        <FloatingIconCard icon={MessageSquare} position="top-44 right-20" size="w-24 h-24" iconClass="text-primary-blue" />
        <FloatingIconCard icon={Bell} position="top-72 right-32" size="w-22 h-22" iconSize={40} iconClass="text-primary-blue" />
        <FloatingIconCard icon={List} position="top-96 right-16" size="w-28 h-28" iconSize={60} iconClass="text-primary-blue" />
    </section>
  );
};


// ─── Main Landing Page Component ──────────────────────────────────────────────────

type LandingProps = { onLoginClick: () => void };

export default function Landing({ onLoginClick }: LandingProps) {
  const [content, setContent] = useState<HomepageContent>(defaultHomepageContent);
  const featuresRef = useRef<HTMLElement>(null);
  const { ref: featuresVisRef, visible: featuresVisible } = useVisible(0.05);

  useEffect(() => {
    void fetchPageContent<HomepageContent>('homepage').then((d) => { if (d) setContent(d); });
  }, []);

  const { features, stats, cta } = content;

  return (
    <div className="bg-white text-text-dark min-h-screen font-sans overflow-x-hidden">
      <NewHeader />
      <NewHeroSection onLoginClick={onLoginClick} />
      <AppPreview />

      {/* ─── Other sections from the old file ────────────────────────────────── */}
      {/* NOTE: These sections might need style adjustments to match the new theme */}

      <section
        id="features"
        ref={(el) => {
          (featuresRef as React.MutableRefObject<HTMLElement | null>).current = el;
          (featuresVisRef as React.MutableRefObject<HTMLDivElement | null>).current = el as HTMLDivElement;
        }}
        className="max-w-[1200px] mx-auto px-6 py-24 md:py-28"
      >
        <div className={`text-center mb-14 transition-all duration-500 ${featuresVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}>
          <h2 className="text-h2 text-text-dark mb-4">
            {features.title}
          </h2>
          <p className="text-body-large text-text-gray">{features.subtitle}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {features.items.map((item, i) => (
            <FeatureCard key={i} item={item} index={i} />
          ))}
        </div>
      </section>

      <section className="border-y border-border-gray bg-light-gray-bg py-16">
        <div className="max-w-[1200px] mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {stats.items.map((s, i) => (
            <StatCounter key={i} value={s.value} label={s.label} />
          ))}
        </div>
      </section>

      <CtaBanner headline={cta.headline} subheadline={cta.subheadline} buttonText={cta.buttonText} onLoginClick={onLoginClick} />

      <PublicFooter />
    </div>
  );
}

// ─── Helper components from old file (might need style updates) ──────────────────

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

function StatCounter({ value, label }: StatItem) {
  const { ref, visible } = useVisible(0.3);
  const display = useCountUp(value, visible);
  return (
    <div ref={ref} className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
      <div className="text-4xl sm:text-5xl font-black text-purple-accent tracking-[-0.04em] mb-2 tabular-nums">{display}</div>
      <div className="text-[14px] text-text-gray">{label}</div>
    </div>
  );
}

function FeatureCard({ item, index }: { item: FeatureItem; index: number }) {
  const { ref, visible } = useVisible(0.1);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${(index % 3) * 60}ms` }}
      className={`group rounded-2xl border border-border-gray bg-white hover:border-primary-blue/30 hover:shadow-sm p-6 transition-all duration-200 cursor-default ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      }`}
    >
      <div className="mb-4 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary-blue/10 text-primary-blue group-hover:bg-primary-blue group-hover:text-white transition-colors duration-200">
        <FeatureIcon name={item.icon} />
      </div>
      <h3 className="text-[15px] font-semibold text-text-dark mb-1.5">{item.title}</h3>
      <p className="text-[14px] text-text-gray leading-relaxed">{item.description}</p>
    </div>
  );
}

function CtaBanner({ headline, subheadline, buttonText, onLoginClick }: {
  headline: string; subheadline: string; buttonText: string; onLoginClick: () => void;
}) {
  const { ref, visible } = useVisible(0.2);
  return (
    <section className="max-w-[1200px] mx-auto px-6 py-20 md:py-28">
      <div
        ref={ref}
        className={`relative rounded-2xl border border-primary-blue/30 bg-gradient-to-br from-primary-blue/5 via-white to-secondary/5 p-12 md:p-16 text-center overflow-hidden transition-all duration-500 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        <div className="relative">
          <h2 className="text-h2 text-text-dark mb-4 max-w-xl mx-auto">
            {headline}
          </h2>
          <p className="text-body-reg text-text-gray mb-8 max-w-md mx-auto">{subheadline}</p>
          <button
            type="button"
            onClick={onLoginClick}
            className="group text-btn inline-flex items-center gap-2 bg-dark-blue hover:opacity-90 text-white font-semibold px-7 py-3.5 rounded-lg transition-all duration-150 shadow-md shadow-blue-200/70 hover:shadow-lg"
          >
            {buttonText}
            <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </div>
    </section>
  );
}
