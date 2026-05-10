import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import PublicNav from '../components/landing/PublicNav';
import PublicFooter from '../components/landing/PublicFooter';

gsap.registerPlugin(ScrollTrigger);

// ── CMS type stubs (kept for AdminPagesManagement compatibility) ──────────────

export type FeatureItem = { icon: string; title: string; description: string };
export type StatItem = { value: string; label: string };
export type HomepageContent = {
  hero: { badge: string; headline: string; subheadline: string; primaryCta: string; secondaryCta: string; ctaPrimary: string; ctaSecondary: string };
  features: { title: string; subtitle: string; items: FeatureItem[] };
  stats: { items: StatItem[] };
  cta: { headline: string; subheadline: string; buttonText: string };
};
export const defaultHomepageContent: HomepageContent = {
  hero: { badge: 'Now with AI image & video generation', headline: 'Your brand. Your voice. Six channels.', subheadline: 'Dakyworld Hub learns what your audience loves, generates content that sounds exactly like you, and publishes across every platform — automatically.', primaryCta: 'Start for free', secondaryCta: 'Watch 2-min demo', ctaPrimary: 'Start for free', ctaSecondary: 'Watch 2-min demo' },
  features: { title: 'Built for brand-driven content', subtitle: 'Every tool you need to create, publish, and grow across every platform.', items: [{ icon: 'Zap', title: 'Nova AI', description: 'AI that learns your brand voice and writes platform-native content.' }, { icon: 'Image', title: 'AI Studio', description: 'Generate images and design visuals with 200+ templates.' }, { icon: 'Calendar', title: 'Smart Scheduler', description: 'Drag-and-drop calendar with AI-optimal posting times.' }] },
  stats: { items: [{ value: '12,000+', label: 'Brands & creators' }, { value: '6', label: 'Platforms' }, { value: '10×', label: 'Faster publishing' }, { value: '4.8', label: 'Average rating' }] },
  cta: { headline: 'Ship strategy. Not busywork.', subheadline: 'Join 12,000+ brands publishing smarter with AI.', buttonText: 'Start for free' },
};

// ── Shared SVG helpers ────────────────────────────────────────────────────────

function Chk({ s = 11, c = '#5b6cf9' }: { s?: number; c?: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
      <path d="M2 6.5L4.5 9L10 3" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Arr({ s = 13 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none">
      <path d="M2.5 7h9M8 3.5L11.5 7 8 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MockChrome({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-50 border-b border-gray-100">
      <div className="flex gap-1">
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <div key={c} className="w-2 h-2 rounded-full" style={{ background: c }} />
        ))}
      </div>
      <div className="ml-2 text-[10px] text-gray-400 font-mono bg-gray-100 px-2 py-0.5 rounded">{url}</div>
    </div>
  );
}

// ── GSAP scroll animations ────────────────────────────────────────────────────

function useScrollAnimations() {
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('[data-gsap="fade-up"]').forEach((el) => {
        gsap.fromTo(el, { y: 40, opacity: 0 }, {
          y: 0, opacity: 1, duration: 0.8, ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        });
      });
      gsap.utils.toArray<HTMLElement>('[data-gsap="stagger"]').forEach((el) => {
        gsap.fromTo(Array.from(el.children), { y: 32, opacity: 0 }, {
          y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', stagger: 0.1,
          scrollTrigger: { trigger: el, start: 'top 86%', once: true },
        });
      });
      gsap.utils.toArray<HTMLElement>('[data-gsap="counter"]').forEach((el) => {
        const target = parseFloat(el.dataset.target ?? '0');
        const suffix = el.dataset.suffix ?? '';
        const prefix = el.dataset.prefix ?? '';
        const dec = parseInt(el.dataset.dec ?? '0', 10);
        ScrollTrigger.create({
          trigger: el,
          start: 'top 85%',
          once: true,
          onEnter: () => {
            gsap.to({ val: 0 }, {
              val: target, duration: 1.8, ease: 'power2.out',
              onUpdate: function () {
                const v = this.targets()[0].val as number;
                el.textContent = prefix + (dec > 0 ? v.toFixed(dec) : Math.round(v).toLocaleString()) + suffix;
              },
            });
          },
        });
      });
      gsap.utils.toArray<HTMLElement>('.dw-step-n').forEach((el, i) => {
        gsap.fromTo(el, { scale: 0, rotation: -15 }, {
          scale: 1, rotation: 0, duration: 0.6, ease: 'back.out(1.8)', delay: i * 0.12,
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        });
      });
      gsap.fromTo('.dw-int-card', { y: 20, opacity: 0, scale: 0.95 }, {
        y: 0, opacity: 1, scale: 1, duration: 0.5, ease: 'power2.out',
        stagger: { amount: 0.5, from: 'start' },
        scrollTrigger: { trigger: '.dw-int-grid', start: 'top 85%', once: true },
      });
      gsap.fromTo('.dw-testi-card', { y: 30, opacity: 0 }, {
        y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', stagger: 0.15,
        scrollTrigger: { trigger: '.dw-testi-grid', start: 'top 85%', once: true },
      });
      gsap.fromTo('.dw-plan-card', { y: 24, opacity: 0 }, {
        y: 0, opacity: 1, duration: 0.65, ease: 'power3.out', stagger: 0.12,
        scrollTrigger: { trigger: '.dw-plans-grid', start: 'top 85%', once: true },
      });
      gsap.utils.toArray<HTMLElement>('[data-gsap="slide-right"]').forEach((el) => {
        gsap.fromTo(el, { x: 50, opacity: 0 }, {
          x: 0, opacity: 1, duration: 0.9, ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 85%', once: true },
        });
      });
      gsap.utils.toArray<HTMLElement>('[data-gsap="slide-left"]').forEach((el) => {
        gsap.fromTo(el, { x: -50, opacity: 0 }, {
          x: 0, opacity: 1, duration: 0.9, ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 85%', once: true },
        });
      });
    });
    return () => { ctx.revert(); ScrollTrigger.getAll().forEach((t) => t.kill()); };
  }, []);
}

// ── Hero visual ───────────────────────────────────────────────────────────────

function HeroVisual() {
  return (
    <div className="grid grid-cols-2 gap-2.5 max-w-[520px] mx-auto">
      {/* Wide: AI chat card */}
      <div
        className="col-span-2 bg-white rounded-2xl border border-gray-100 shadow-md overflow-hidden dw-float"
        style={{ animation: 'dw-float 7s ease-in-out infinite' }}
      >
        <MockChrome url="daky.ai/studio" />
        <div className="p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 px-2.5 py-2 bg-gray-50 rounded-lg border border-gray-200">
            <span className="text-[11px] text-gray-400 font-mono">›</span>
            <span className="text-[12px] text-gray-700 flex-1">Write 3 LinkedIn posts about our Q2 product launch</span>
            <div className="w-1.5 h-1.5 rounded-full bg-[#5b6cf9] dw-dot-pulse" />
          </div>
          {[
            { n: '01', text: '"Six months of building in silence. Here\'s what we shipped."', tag: 'Hook', time: 'Tue 7:30 AM' },
            { n: '02', text: '"The one metric that changed our entire product roadmap."', tag: 'POV', time: 'Wed 9:00 AM' },
          ].map((p) => (
            <div key={p.n} className="flex gap-2.5 p-2.5 bg-white border border-gray-100 rounded-xl">
              <span className="font-mono text-[10px] text-[#5b6cf9] font-bold pt-0.5">{p.n}</span>
              <div className="flex-1">
                <p className="m-0 text-[12px] text-gray-700 leading-relaxed">{p.text}</p>
                <div className="flex gap-1.5 mt-1">
                  <span className="text-[10px] bg-[#eef0fe] text-[#5b6cf9] px-1.5 py-0.5 rounded font-semibold">{p.tag}</span>
                  <span className="text-[10px] text-gray-400">{p.time}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Analytics mini card */}
      <div
        className="bg-white rounded-2xl border border-gray-100 shadow-md overflow-hidden"
        style={{ animation: 'dw-float 9s ease-in-out infinite 2.5s' }}
      >
        <MockChrome url="analytics" />
        <div className="p-3">
          <div className="flex justify-between items-baseline mb-2">
            <div>
              <div className="text-[9px] text-gray-400 uppercase tracking-widest font-mono mb-0.5">30-day reach</div>
              <div className="text-2xl font-black tracking-tight text-[#0a0a0b]">2.4M</div>
            </div>
            <span className="text-[11px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded font-bold">+34%</span>
          </div>
          <div className="flex items-end gap-1 h-10">
            {[40, 56, 45, 70, 84, 62, 95].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t dw-bar"
                style={{
                  background: i === 6 ? '#5b6cf9' : '#e5e7eb',
                  height: `${h}%`,
                  animationDelay: `${i * 80}ms`,
                  transformOrigin: 'bottom',
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Calendar mini card */}
      <div
        className="bg-white rounded-2xl border border-gray-100 shadow-md overflow-hidden"
        style={{ animation: 'dw-float 8s ease-in-out infinite 4s' }}
      >
        <MockChrome url="calendar" />
        <div className="p-3">
          <div className="grid grid-cols-5 gap-1 mb-2">
            {[
              { d: 12, p: [] as Array<{ c: string; l: string }> },
              { d: 13, p: [{ c: '#5b6cf9', l: 'IG' }] },
              { d: 14, p: [{ c: '#0a66c2', l: 'LI' }, { c: '#0a0a0b', l: 'X' }] },
              { d: 15, p: [] as Array<{ c: string; l: string }> },
              { d: 16, p: [{ c: '#1877f2', l: 'FB' }] },
            ].map(({ d, p }) => (
              <div key={d} className="bg-gray-50 rounded p-1 min-h-[40px]">
                <div className="text-[8px] text-gray-400 font-mono mb-0.5">{d}</div>
                {p.map((pp, j) => (
                  <div key={j} className="text-[7px] font-bold text-white px-0.5 py-px rounded mb-px" style={{ background: pp.c }}>{pp.l}</div>
                ))}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1.5 bg-[#eef0fe] rounded-lg">
            <div className="w-1 h-1 rounded-full bg-[#5b6cf9] dw-dot-pulse" />
            <span className="text-[9px] text-[#5b6cf9] font-semibold">AI timing applied</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero({ onCta }: { onCta: () => void }) {
  const copyRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo('.dw-hero-badge', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.2)
        .fromTo('.dw-hero-h1', { y: 32, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8 }, 0.35)
        .fromTo('.dw-hero-lede', { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7 }, 0.55)
        .fromTo('.dw-hero-btns', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.7)
        .fromTo('.dw-hero-trust', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, 0.85)
        .fromTo(visualRef.current, { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.9, ease: 'power2.out' }, 0.4);
    });
    return () => ctx.revert();
  }, []);

  return (
    <section
      className="relative overflow-hidden bg-white flex items-center min-h-[100svh] pt-24 pb-16"
    >
      {/* Glow orbs */}
      <div
        className="absolute pointer-events-none rounded-full dw-glow"
        style={{
          top: '-8%', right: '-6%', width: 680, height: 680,
          background: 'radial-gradient(circle, rgba(91,108,249,.13) 0%, transparent 65%)',
        }}
      />
      <div
        className="absolute pointer-events-none rounded-full dw-glow-2"
        style={{
          bottom: '-14%', left: '-4%', width: 480, height: 480,
          background: 'radial-gradient(circle, rgba(91,108,249,.08) 0%, transparent 65%)',
        }}
      />
      {/* Dot pattern */}
      <div
        className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage: 'radial-gradient(#c7d0fe 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 60% 40%, black 30%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 60% 40%, black 30%, transparent 100%)',
        }}
      />

      <div className="max-w-[1160px] mx-auto px-6 w-full relative">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Copy */}
          <div className="max-w-[580px]" ref={copyRef}>
            <button
              type="button"
              className="dw-hero-badge inline-flex items-center gap-2 border border-[#c7d0fe] bg-[#eef0fe] rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-[#5b6cf9] mb-6 cursor-pointer hover:shadow-[0_0_0_4px_rgba(91,108,249,.12)] transition-all"
              onClick={onCta}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#5b6cf9] dw-dot-pulse" />
              Now with AI image &amp; video generation
              <span>→</span>
            </button>

            <h1
              className="dw-hero-h1 font-black tracking-tight text-[#0a0a0b] mb-5"
              style={{ fontSize: 'clamp(42px, 5.5vw, 76px)', lineHeight: 1.02, letterSpacing: '-0.045em' }}
            >
              Your brand.<br />
              Your voice.<br />
              <span className="bg-gradient-to-r from-[#5b6cf9] to-violet-500 bg-clip-text text-transparent">
                Six channels.
              </span>
            </h1>

            <p className="dw-hero-lede text-[17px] leading-[1.7] text-gray-500 mb-8 max-w-[460px]">
              Dakyworld Hub learns what your audience loves, generates content that sounds exactly like you, and publishes across every platform — automatically.
            </p>

            <div className="dw-hero-btns flex items-center gap-3 flex-wrap mb-7">
              <button
                type="button"
                className="inline-flex items-center gap-2 bg-[#5b6cf9] text-white text-[15px] font-bold px-6 py-3.5 rounded-xl border-none cursor-pointer transition-all hover:-translate-y-0.5 hover:bg-[#4f5de6]"
                style={{ boxShadow: '0 4px 18px rgba(91,108,249,.35)' }}
                onClick={onCta}
              >
                Start for free → <Arr s={14} />
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 bg-transparent text-gray-700 text-[15px] font-semibold px-5 py-3.5 rounded-xl border border-gray-200 cursor-pointer transition-all hover:border-[#c7d0fe] hover:text-[#5b6cf9] hover:bg-[rgba(91,108,249,.05)]"
                onClick={onCta}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" opacity=".4" /><path d="M5.5 5L9.5 7 5.5 9V5Z" fill="currentColor" /></svg>
                ▶ Watch 2-min demo
              </button>
            </div>

            <div className="dw-hero-trust flex items-center gap-4 flex-wrap">
              {['No credit card', '1-min setup', '30-day guarantee'].map((t) => (
                <div key={t} className="flex items-center gap-1.5 text-[13px] text-gray-500">
                  <div className="w-4 h-4 rounded-full bg-[rgba(91,108,249,.1)] flex items-center justify-center">
                    <Chk s={9} c="#5b6cf9" />
                  </div>
                  {t}
                </div>
              ))}
            </div>
          </div>

          {/* Visual */}
          <div ref={visualRef} className="flex justify-center">
            <HeroVisual />
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Platform marquee ──────────────────────────────────────────────────────────

function Marquee() {
  const ITEMS = [
    { name: 'Instagram', bg: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', label: 'IG' },
    { name: 'LinkedIn', bg: '#0a66c2', label: 'in' },
    { name: 'X · Twitter', bg: '#0a0a0b', label: '𝕏' },
    { name: 'Facebook', bg: '#1877f2', label: 'f' },
    { name: 'TikTok', bg: 'linear-gradient(135deg,#010101,#69c9d0)', label: '♪' },
    { name: 'YouTube', bg: '#ff0000', label: '▶' },
  ];
  const doubled = [...ITEMS, ...ITEMS];
  return (
    <div className="overflow-hidden py-5 border-t border-b border-gray-100 bg-gray-50">
      <div className="flex w-max dw-marquee">
        {doubled.map((p, i) => (
          <div key={i} className="flex items-center gap-2.5 px-9 text-[13.5px] font-semibold text-gray-500 whitespace-nowrap">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-extrabold text-white flex-shrink-0" style={{ background: p.bg }}>{p.label}</div>
            {p.name}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function Stats() {
  return (
    <section className="border-t border-b border-gray-100 bg-white">
      <div className="max-w-[1160px] mx-auto px-6">
        <div className="grid grid-cols-2 lg:grid-cols-4" data-gsap="stagger">
          {[
            { target: 12000, suffix: '+', prefix: '', dec: 0, label: 'Brands & creators' },
            { target: 6, suffix: '', prefix: '', dec: 0, label: 'Platforms connected' },
            { target: 10, suffix: '×', prefix: '', dec: 0, label: 'Faster than manual' },
            { target: 4.8, suffix: '/5', prefix: '', dec: 1, label: 'Average rating' },
          ].map((s) => (
            <div
              key={s.label}
              className="text-center py-11 px-4 border-r border-gray-100 last:border-r-0"
            >
              <div
                className="font-black tracking-tight text-[#5b6cf9] leading-none mb-2"
                style={{ fontSize: 'clamp(34px, 4.5vw, 54px)', letterSpacing: '-0.04em' }}
              >
                <span
                  data-gsap="counter"
                  data-target={s.target}
                  data-suffix={s.suffix}
                  data-prefix={s.prefix}
                  data-dec={s.dec}
                >
                  {s.prefix}0{s.suffix}
                </span>
              </div>
              <div className="text-[12.5px] text-gray-400 font-medium uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Problem (dark) ────────────────────────────────────────────────────────────

function Problem() {
  return (
    <section className="py-24 bg-[#0a0a0b] text-white">
      <div className="max-w-[1160px] mx-auto px-6">
        <div className="max-w-[680px] mb-14">
          <div className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-widest text-[#818cf8] mb-4" data-gsap="fade-up">
            <span className="w-1 h-1 rounded-full bg-[#818cf8]" />
            The problem
          </div>
          <h2
            className="font-black tracking-tight text-white mb-5"
            style={{ fontSize: 'clamp(30px, 3.8vw, 52px)', letterSpacing: '-0.04em', lineHeight: 1.06 }}
            data-gsap="fade-up"
          >
            Five subscriptions.<br />Zero shared context.
          </h2>
          <p className="text-[17px] leading-[1.7] text-white/50 max-w-[520px]" data-gsap="fade-up">
            Your content team bounces between five tools that have never met each other. The AI doesn't know your analytics. The scheduler can't write. Daky ends the tab-switching tax.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          {/* Before */}
          <div className="rounded-2xl p-7" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }}>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/30 mb-5">⌧ Before Daky</div>
            {[
              { icon: '📅', text: 'Buffer — scheduling only, no AI, no design' },
              { icon: '✍️', text: 'Copy.ai — generic content, forgets your brand' },
              { icon: '🎨', text: 'Canva — design only, can\'t schedule or generate' },
              { icon: '📓', text: 'Notion — planning only, zero publishing' },
              { icon: '📊', text: 'Google Sheets — manual tracking, after the fact' },
            ].map((r, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5 border-b border-white/[.07] last:border-b-0 text-[14px] text-white/40">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[13px] flex-shrink-0" style={{ background: 'rgba(255,255,255,.06)' }}>{r.icon}</div>
                <span>{r.text}</span>
              </div>
            ))}
          </div>

          {/* After */}
          <div className="rounded-2xl p-7" style={{ background: 'rgba(91,108,249,.12)', border: '1px solid rgba(91,108,249,.3)' }}>
            <div className="text-[11px] font-bold uppercase tracking-widest text-[#818cf8] mb-5">✦ With Dakyworld Hub</div>
            {[
              { icon: '✦', text: 'One AI that learns your exact brand voice' },
              { icon: '✦', text: 'Design, generate, and schedule from one place' },
              { icon: '✦', text: 'Six-channel publishing with one click' },
              { icon: '✦', text: 'Analytics that feed back into every new draft' },
              { icon: '✦', text: 'Team collaboration with role-based approvals' },
            ].map((r, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5 border-b border-white/[.07] last:border-b-0 text-[14px] text-white/85">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[#818cf8] flex-shrink-0" style={{ background: 'rgba(91,108,249,.25)' }}>{r.icon}</div>
                <span>{r.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Product mockups ───────────────────────────────────────────────────────────

function AIMockup() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden" data-gsap="slide-right">
      <MockChrome url="daky.ai/studio" />
      <div className="p-5">
        <div className="text-[10.5px] text-gray-400 uppercase tracking-widest font-semibold mb-3">AI Workflow</div>
        {[
          { name: 'Search brand designs', state: 'done' },
          { name: 'Extract style prompts', state: 'done' },
          { name: 'Tailor to your voice', state: 'running' },
          { name: 'Generate image', state: 'pending' },
          { name: 'Save to history', state: 'pending' },
        ].map((s) => (
          <div key={s.name} className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-b-0">
            <div
              className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ background: s.state === 'done' ? '#eef0fe' : s.state === 'running' ? '#fef3c7' : '#f3f4f6' }}
            >
              {s.state === 'done' && <span className="text-[9px] text-[#5b6cf9]">✓</span>}
              {s.state === 'running' && <span className="text-[10px] text-amber-600">⟳</span>}
              {s.state === 'pending' && <span className="block w-1 h-1 rounded-full border border-gray-300" />}
            </div>
            <span
              className="text-[12.5px]"
              style={{ color: s.state === 'done' ? '#374151' : s.state === 'running' ? '#d97706' : '#9ca3af', fontWeight: s.state === 'running' ? 600 : 400 }}
            >{s.name}</span>
          </div>
        ))}
        <div className="mt-4 rounded-xl p-3.5" style={{ background: 'linear-gradient(135deg,#eef0fe,#f5f3ff)' }}>
          <div className="text-[10px] text-[#5b6cf9] font-bold uppercase tracking-widest mb-1.5">Generated post · LinkedIn</div>
          <p className="m-0 text-[13px] text-gray-700 leading-relaxed italic">
            "Six months of building in silence. Here's everything we shipped — and why we held back until now."
          </p>
          <div className="flex gap-1.5 mt-2.5">
            <span className="text-[10px] bg-[#5b6cf9] text-white px-2 py-0.5 rounded font-semibold">Hook</span>
            <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded">Tue 7:30 AM</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DesignMockup() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden" data-gsap="slide-left">
      <MockChrome url="daky.ai/studio · Canvas 1080×1080" />
      <div className="flex h-[300px]">
        {/* Left tool bar */}
        <div className="w-11 bg-gray-50 border-r border-gray-100 flex flex-col items-center gap-1.5 py-2.5">
          {['T', '□', '○', '─', '⬆', '🖼'].map((t, i) => (
            <div
              key={i}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[13px]"
              style={{
                background: i === 0 ? '#eef0fe' : 'transparent',
                border: i === 0 ? '1.5px solid #c7d0fe' : '1.5px solid transparent',
              }}
            >{t}</div>
          ))}
        </div>
        {/* Canvas */}
        <div className="flex-1 bg-gray-100 flex items-center justify-center p-4">
          <div
            className="w-full max-h-[240px] rounded-xl relative overflow-hidden flex flex-col items-center justify-center gap-2"
            style={{ aspectRatio: '1/1', background: '#0a0a0b' }}
          >
            <div
              className="absolute top-0 rounded"
              style={{ left: '18%', right: '18%', height: '44%', background: 'linear-gradient(135deg,#5b6cf9,#818cf8)', transform: 'rotate(-12deg) translateY(-28%)' }}
            />
            <div
              className="absolute bottom-0 rounded"
              style={{ left: '14%', right: '14%', height: '34%', background: '#2be38b', transform: 'rotate(12deg) translateY(28%)' }}
            />
            <span className="text-lg font-black text-white z-10 text-center leading-tight">Your Brand</span>
            <span className="text-[10px] text-white/50 z-10">Instagram Post</span>
          </div>
        </div>
        {/* Right properties */}
        <div className="w-[90px] bg-white border-l border-gray-100 p-2.5">
          <div className="text-[9.5px] text-gray-400 uppercase tracking-widest mb-2.5 font-semibold">Properties</div>
          {[['Fill', '#0a0a0b'], ['Opacity', '100%'], ['Radius', '10px'], ['W', '1080px']].map(([k, v]) => (
            <div key={k} className="mb-2">
              <div className="text-[9px] text-gray-400">{k}</div>
              <div className="text-[11px] text-gray-700 font-semibold">{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CalMockup() {
  const posts: Record<number, Array<{ bg: string; label: string }>> = {
    1: [{ bg: '#5b6cf9', label: 'IG' }, { bg: '#0a66c2', label: 'LI' }],
    3: [{ bg: '#0a0a0b', label: 'X' }],
    4: [{ bg: '#1877f2', label: 'FB' }, { bg: '#5b6cf9', label: 'IG' }],
    6: [{ bg: '#010101', label: 'TT' }],
  };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden" data-gsap="slide-right">
      <MockChrome url="daky.ai/calendar · May 2026" />
      <div className="p-4">
        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <div key={i} className="text-[9.5px] text-gray-400 text-center font-mono uppercase">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {Array.from({ length: 14 }, (_, i) => {
            const p = posts[i] ?? [];
            const isToday = i === 4;
            return (
              <div
                key={i}
                className="rounded-lg p-1 min-h-[52px]"
                style={{
                  background: isToday ? '#eef0fe' : '#f9fafb',
                  border: isToday ? '1.5px solid #c7d0fe' : '1.5px solid transparent',
                }}
              >
                <div className="text-[8.5px] font-mono mb-0.5" style={{ color: isToday ? '#5b6cf9' : '#9ca3af', fontWeight: isToday ? 700 : 400 }}>{i + 12}</div>
                {p.map((pp, j) => (
                  <div key={j} className="text-[7.5px] font-bold text-white px-0.5 py-px rounded mb-px text-center" style={{ background: pp.bg }}>{pp.label}</div>
                ))}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-100 rounded-xl">
          <div className="w-2 h-2 rounded-full bg-[#5b6cf9] dw-dot-pulse" />
          <span className="text-[12px] text-gray-700 font-medium">AI optimized posting times applied</span>
        </div>
      </div>
    </div>
  );
}

function AnalyticsMockup() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden" data-gsap="slide-right">
      <MockChrome url="daky.ai/analytics" />
      <div className="p-5">
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          {[
            { label: 'Reach', val: '2.4M', delta: '+34%', c: '#10b981' },
            { label: 'Engagement', val: '8.2%', delta: '+12%', c: '#10b981' },
            { label: 'Posts', val: '47', delta: 'this month', c: '#5b6cf9' },
          ].map((m) => (
            <div key={m.label} className="bg-gray-50 rounded-xl p-2.5 px-3">
              <div className="text-[9px] text-gray-400 font-mono uppercase tracking-widest mb-1">{m.label}</div>
              <div className="text-lg font-extrabold text-[#0a0a0b] tracking-tight">{m.val}</div>
              <div className="text-[10px] font-semibold mt-0.5" style={{ color: m.c }}>{m.delta}</div>
            </div>
          ))}
        </div>
        <div className="flex items-end gap-1 h-16 mb-3.5">
          {[38, 52, 44, 68, 82, 59, 95].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t dw-bar"
              style={{
                background: i === 6 ? '#5b6cf9' : i === 4 ? '#818cf8' : '#e5e7eb',
                height: `${h}%`,
                animationDelay: `${i * 90}ms`,
                transformOrigin: 'bottom',
              }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5 bg-[#eef0fe] rounded-xl">
          <span className="text-sm">✦</span>
          <div>
            <div className="text-[12px] font-bold text-[#5b6cf9]">AI updated your brand profile</div>
            <div className="text-[11px] text-[#818cf8]">Thursday posts now weighted higher</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Features section ──────────────────────────────────────────────────────────

function Features({ onCta }: { onCta: () => void }) {
  const FEATS = [
    {
      eyebrow: 'AI Generation',
      title: 'Content that sounds\nexactly like you.',
      desc: 'Daky reads your past posts, your wins, your audience data — then writes drafts so on-brand, even your team won\'t know the difference.',
      bullets: [
        'Brand-voice memory that deepens every week you use it',
        'Per-platform formatting: LinkedIn ≠ Instagram ≠ X',
        'Hook, body, hashtags, and optimal posting time — all included',
        'Six AI models, priced per use with credits you control',
      ],
      cta: 'Try AI generation',
      visual: <AIMockup />,
      flip: false,
    },
    {
      eyebrow: 'Design Studio',
      title: 'Pro visuals.\nZero design skills.',
      desc: 'Generate AI images or videos with 5 models, or build branded graphics in the canvas editor with templates, layers, and one-click export.',
      bullets: [
        'AI image generation: 3 models — from ✦3 to ✦8 credits',
        'AI video generation: 2 models — Seedance Lite or Higgsfield Pro',
        'Canvas builder with presets for every social platform',
        'Admin-curated Discover template library',
      ],
      cta: 'Open design studio',
      visual: <DesignMockup />,
      flip: true,
    },
    {
      eyebrow: 'Content Calendar',
      title: 'A month planned\nin an hour.',
      desc: 'Drag posts onto days. Daky reformats them for each platform, suggests the optimal time, and catches conflicts before you publish.',
      bullets: [
        'Drag-and-drop multi-platform scheduling',
        'AI-recommended posting times based on past performance',
        'Approval workflows and conflict detection',
        'One post → six platform variants, reformatted automatically',
      ],
      cta: 'See the calendar',
      visual: <CalMockup />,
      flip: false,
    },
  ];

  return (
    <section className="py-24" id="features">
      <div className="max-w-[1160px] mx-auto px-6">
        <div className="text-center max-w-[640px] mx-auto mb-20" data-gsap="fade-up">
          <div className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-widest text-[#5b6cf9] mb-4">
            <span className="w-1 h-1 rounded-full bg-[#5b6cf9]" />The platform
          </div>
          <h2
            className="font-black tracking-tight text-[#0a0a0b] mb-5"
            style={{ fontSize: 'clamp(30px, 3.8vw, 52px)', letterSpacing: '-0.04em', lineHeight: 1.06 }}
          >
            Six tools. One workflow.<br />One bill.
          </h2>
          <p className="text-[17px] leading-[1.7] text-gray-500 max-w-[520px] mx-auto">
            Generate, design, schedule, automate, measure, collaborate. Daky replaces five subscriptions and a spreadsheet.
          </p>
        </div>

        {FEATS.map((f) => (
          <div key={f.eyebrow} className="mb-24 last:mb-0">
            <div className={`grid grid-cols-1 lg:grid-cols-2 gap-20 items-center ${f.flip ? 'lg:[direction:rtl]' : ''}`}>
              <div className={`max-w-[480px] ${f.flip ? 'lg:[direction:ltr]' : ''}`} data-gsap={f.flip ? 'slide-right' : 'slide-left'}>
                <div className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-widest text-[#5b6cf9] mb-4">
                  <span className="w-1 h-1 rounded-full bg-[#5b6cf9]" />{f.eyebrow}
                </div>
                <h3
                  className="font-extrabold tracking-tight text-[#0a0a0b] mb-3.5"
                  style={{ fontSize: 'clamp(22px, 2.5vw, 32px)', letterSpacing: '-0.03em', lineHeight: 1.14 }}
                >
                  {f.title.split('\n').map((line, i) => <span key={i}>{i > 0 && <br />}{line}</span>)}
                </h3>
                <p className="text-[16px] text-gray-500 leading-[1.7]">{f.desc}</p>
                <ul className="list-none p-0 mt-6 flex flex-col gap-3">
                  {f.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2.5 text-[14.5px] text-gray-500 leading-[1.65]">
                      <div className="w-5 h-5 rounded-md bg-[rgba(91,108,249,.08)] flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Chk s={11} c="#5b6cf9" />
                      </div>
                      {b}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="mt-7 inline-flex items-center gap-2 bg-transparent text-gray-700 text-[15px] font-semibold px-5 py-3.5 rounded-xl border border-gray-200 cursor-pointer transition-all hover:border-[#c7d0fe] hover:text-[#5b6cf9]"
                  onClick={onCta}
                >
                  {f.cta} <Arr s={13} />
                </button>
              </div>
              <div className={f.flip ? 'lg:[direction:ltr]' : ''}>{f.visual}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── How it works ──────────────────────────────────────────────────────────────

function HowItWorks() {
  return (
    <section className="py-24 bg-gray-50 border-t border-b border-gray-100">
      <div className="max-w-[1160px] mx-auto px-6">
        <div className="text-center max-w-[560px] mx-auto mb-16" data-gsap="fade-up">
          <div className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-widest text-[#5b6cf9] mb-4">
            <span className="w-1 h-1 rounded-full bg-[#5b6cf9]" />How it works
          </div>
          <h2
            className="font-black tracking-tight text-[#0a0a0b]"
            style={{ fontSize: 'clamp(30px, 3.8vw, 52px)', letterSpacing: '-0.04em', lineHeight: 1.06 }}
          >
            Three steps to<br />a month of content.
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 relative">
          {/* Connector line */}
          <div
            className="absolute hidden sm:block h-0.5 opacity-25 z-0"
            style={{
              top: 26, left: 'calc(16.5%)', right: 'calc(16.5%)',
              background: 'linear-gradient(90deg,#5b6cf9,#818cf8,#a78bfa)',
            }}
          />
          {[
            {
              n: '01',
              title: 'Connect your brand',
              desc: 'Link your socials and website. Daky reads your voice, tone, audience, and past posts — building brand memory in minutes.',
              icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>,
            },
            {
              n: '02',
              title: 'AI drafts strategic content',
              desc: 'Describe what you need in plain English. Daky returns hooks, captions, threads, and optimal posting times rooted in your brand.',
              icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" /></svg>,
            },
            {
              n: '03',
              title: 'Publish. Measure. Get smarter.',
              desc: 'Schedule across six channels in one click. Every post that performs shapes next week\'s suggestions — the AI improves every week.',
              icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>,
            },
          ].map((s) => (
            <div key={s.n} className="px-5 pb-10 text-center relative">
              <div
                className="dw-step-n w-[52px] h-[52px] rounded-[14px] bg-[#5b6cf9] text-white flex items-center justify-center mx-auto mb-5 relative z-10"
                style={{ boxShadow: '0 4px 14px rgba(91,108,249,.35)' }}
              >
                {s.icon}
              </div>
              <div className="text-[16px] font-bold text-[#0a0a0b] mb-2">{s.title}</div>
              <div className="text-[13.5px] text-gray-500 leading-[1.65]">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Analytics highlight ───────────────────────────────────────────────────────

function AnalyticsHighlight() {
  return (
    <section className="py-24">
      <div className="max-w-[1160px] mx-auto px-6">
        <div
          className="relative overflow-hidden rounded-[28px] p-14"
          style={{ background: '#f9fafb', border: '1px solid #e5e7eb' }}
          data-gsap="fade-up"
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
            <div data-gsap="slide-left">
              <div className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-widest text-[#5b6cf9] mb-4">
                <span className="w-1 h-1 rounded-full bg-[#5b6cf9]" />Analytics + AI Learning
              </div>
              <h3
                className="font-extrabold tracking-tight text-[#0a0a0b] mb-3.5"
                style={{ fontSize: 'clamp(22px, 2.5vw, 32px)', letterSpacing: '-0.03em', lineHeight: 1.14 }}
              >
                Every post makes<br />Daky smarter.
              </h3>
              <p className="text-[16px] text-gray-500 leading-[1.7] mb-6">
                Most tools show you charts. Daky uses those charts. Every engagement metric feeds back into the AI — posts that win shape next week's drafts, and posts that flop never repeat.
              </p>
              <ul className="list-none p-0 flex flex-col gap-3">
                {[
                  'Cross-platform unified analytics dashboard',
                  'Top-performing post breakdown with why-it-worked analysis',
                  'AI auto-adjusts brand profile weekly based on performance',
                  'Export reports for clients or stakeholders in one click',
                ].map((b) => (
                  <li key={b} className="flex items-start gap-2.5 text-[14.5px] text-gray-500 leading-[1.65]">
                    <div className="w-5 h-5 rounded-md bg-[rgba(91,108,249,.08)] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Chk s={11} c="#5b6cf9" />
                    </div>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <AnalyticsMockup />
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Testimonials ──────────────────────────────────────────────────────────────

function Testimonials() {
  return (
    <section className="py-24 bg-gray-50 border-t border-b border-gray-100">
      <div className="max-w-[1160px] mx-auto px-6">
        <div className="text-center max-w-[520px] mx-auto mb-14" data-gsap="fade-up">
          <div className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-widest text-[#5b6cf9] mb-4">
            <span className="w-1 h-1 rounded-full bg-[#5b6cf9]" />Customers
          </div>
          <h2
            className="font-black tracking-tight text-[#0a0a0b]"
            style={{ fontSize: 'clamp(30px, 3.8vw, 52px)', letterSpacing: '-0.04em', lineHeight: 1.06 }}
          >
            Loved by creators<br />and teams worldwide.
          </h2>
        </div>

        <div className="dw-testi-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            {
              stars: 5,
              quote: 'We replaced Buffer, Canva, and Copy.ai with one tool. The AI actually sounds like us.',
              hi: 'sounds like us',
              stat: '5× more output per week',
              name: 'Sarah K.', role: 'Founder @NovaBrand', initials: 'SK', color: '#5b6cf9',
            },
            {
              stars: 5,
              quote: 'Scheduled 30 days of content in one afternoon. The calendar view is everything.',
              hi: '30 days of content',
              stat: '60% time saved',
              name: 'Marcus D.', role: 'Head of Growth', initials: 'MD', color: '#0a66c2',
            },
            {
              stars: 5,
              quote: 'The analytics tell you exactly which posts drove signups, not just likes.',
              hi: 'drove signups',
              stat: '2.4M monthly reach',
              name: 'Priya M.', role: 'Social Media Lead', initials: 'PM', color: '#f59e0b',
            },
          ].map((t) => (
            <div
              key={t.name}
              className="dw-testi-card bg-white border border-gray-100 rounded-2xl p-7 transition-all hover:-translate-y-0.5 hover:shadow-xl"
            >
              <div className="flex gap-1 mb-3.5">
                {Array.from({ length: t.stars }, (_, i) => (
                  <span key={i} className="text-amber-400 text-[17px]">★</span>
                ))}
              </div>
              <p className="text-[15px] leading-[1.65] text-gray-700 mb-5 italic">
                "{t.quote.split(t.hi).map((part, i) => i === 0
                  ? part
                  : [<span key="hi" className="not-italic font-bold text-[#0a0a0b]">{t.hi}</span>, part]
                )}"
              </p>
              <div className="inline-block text-[11.5px] font-bold text-[#5b6cf9] bg-[rgba(91,108,249,.08)] px-2.5 py-1 rounded-md mb-4">
                {t.stat}
              </div>
              <div className="flex items-center gap-2.5">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold text-white flex-shrink-0"
                  style={{ background: t.color }}
                >{t.initials}</div>
                <div>
                  <div className="text-[13px] font-semibold text-[#0a0a0b]">{t.name}</div>
                  <div className="text-[11.5px] text-gray-400">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Integrations ──────────────────────────────────────────────────────────────

function Integrations() {
  return (
    <section className="py-24">
      <div className="max-w-[1160px] mx-auto px-6">
        <div className="text-center max-w-[520px] mx-auto mb-0" data-gsap="fade-up">
          <div className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-widest text-[#5b6cf9] mb-4">
            <span className="w-1 h-1 rounded-full bg-[#5b6cf9]" />Integrations
          </div>
          <h2
            className="font-black tracking-tight text-[#0a0a0b] mb-3"
            style={{ fontSize: 'clamp(30px, 3.8vw, 52px)', letterSpacing: '-0.04em', lineHeight: 1.06 }}
          >
            Publish everywhere<br />your audience lives.
          </h2>
          <p className="text-[15px] text-gray-500 max-w-[380px] mx-auto">Connect once. Daky reformats and publishes to every channel simultaneously.</p>
        </div>

        <div className="dw-int-grid grid grid-cols-3 sm:grid-cols-6 gap-3 mt-12">
          {[
            { name: 'Instagram', bg: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', label: 'IG' },
            { name: 'LinkedIn', bg: '#0a66c2', label: 'in' },
            { name: 'X · Twitter', bg: '#0a0a0b', label: '𝕏' },
            { name: 'Facebook', bg: '#1877f2', label: 'f' },
            { name: 'TikTok', bg: 'linear-gradient(135deg,#010101,#69c9d0)', label: '♪' },
            { name: 'YouTube', bg: '#ff0000', label: '▶' },
          ].map((p) => (
            <div
              key={p.name}
              className="dw-int-card border border-gray-100 rounded-xl p-5 py-5 flex flex-col items-center gap-2 transition-all hover:-translate-y-0.5 hover:border-[#c7d0fe] hover:shadow-[0_4px_18px_rgba(91,108,249,.12)] cursor-default"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[15px] font-extrabold text-white" style={{ background: p.bg }}>{p.label}</div>
              <div className="text-[12px] text-gray-500 font-medium">{p.name}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Pricing preview ───────────────────────────────────────────────────────────

function PricingPreview({ onCta }: { onCta: () => void }) {
  return (
    <section className="py-24 bg-gray-50 border-t border-gray-100">
      <div className="max-w-[1160px] mx-auto px-6">
        <div className="text-center max-w-[520px] mx-auto mb-14" data-gsap="fade-up">
          <div className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-widest text-[#5b6cf9] mb-4">
            <span className="w-1 h-1 rounded-full bg-[#5b6cf9]" />Pricing
          </div>
          <h2
            className="font-black tracking-tight text-[#0a0a0b] mb-4"
            style={{ fontSize: 'clamp(30px, 3.8vw, 52px)', letterSpacing: '-0.04em', lineHeight: 1.06 }}
          >
            Start free. Scale<br />when you're ready.
          </h2>
          <p className="text-[17px] leading-[1.7] text-gray-500 max-w-[520px] mx-auto">
            Credits only used when generating AI visuals. Everything else is unlimited.
          </p>
        </div>

        <div className="dw-plans-grid grid grid-cols-1 lg:grid-cols-3 gap-5 max-w-[900px] mx-auto">
          {[
            {
              badge: 'Free to start', name: 'Starter', desc: 'For solo creators building a lean workflow.', price: 'Free', per: '',
              credits: '200 credits / mo',
              features: ['3 connected accounts', 'AI text generation', 'Content calendar', 'Basic analytics', 'Templates'],
              featured: false,
            },
            {
              badge: 'Most Popular', name: 'Growth', desc: 'For teams scaling their social presence.', price: '$29', per: '/mo',
              credits: '2,000 credits / mo',
              features: ['10 connected accounts', 'AI image generation', 'Custom brand voice', 'Advanced analytics', 'Priority support', 'Team (3 seats)'],
              featured: true,
            },
            {
              badge: 'Agency', name: 'Scale', desc: 'For agencies running multiple brands.', price: '$79', per: '/mo',
              credits: 'Unlimited credits',
              features: ['Unlimited accounts', 'AI video generation', 'White-label exports', 'Client workspaces', 'API access', 'Dedicated support'],
              featured: false,
            },
          ].map((p) => (
            <div
              key={p.name}
              className={`dw-plan-card relative rounded-[22px] p-7 flex flex-col transition-all ${
                p.featured
                  ? 'border border-[#5b6cf9] bg-[#0a0a0b] hover:-translate-y-0.5'
                  : 'border border-gray-100 bg-white hover:border-[#c7d0fe] hover:shadow-[0_10px_36px_rgba(91,108,249,.1)] hover:-translate-y-0.5'
              }`}
            >
              <div
                className="inline-block text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full mb-4"
                style={{
                  background: p.featured ? 'rgba(91,108,249,.3)' : '#f9fafb',
                  color: p.featured ? '#818cf8' : '#9ca3af',
                }}
              >{p.badge}</div>
              <div className="text-[18px] font-extrabold mb-1" style={{ color: p.featured ? '#fff' : '#0a0a0b' }}>{p.name}</div>
              <div className="text-[13px] mb-4" style={{ color: p.featured ? 'rgba(255,255,255,.45)' : '#6b7280' }}>{p.desc}</div>
              <div
                className="inline-flex items-center gap-1.5 text-[12px] font-bold px-2.5 py-1.5 rounded-lg border mb-4"
                style={{
                  color: p.featured ? '#818cf8' : '#5b6cf9',
                  background: p.featured ? 'rgba(91,108,249,.2)' : 'rgba(91,108,249,.08)',
                  borderColor: p.featured ? 'rgba(91,108,249,.3)' : 'rgba(91,108,249,.18)',
                }}
              >
                <span className="text-sm">✦</span>{p.credits}
              </div>
              <div className="mb-4">
                <span
                  className="font-black tracking-tight leading-none"
                  style={{ fontSize: 'clamp(36px, 4vw, 48px)', letterSpacing: '-0.04em', color: p.featured ? '#fff' : '#0a0a0b' }}
                >{p.price}</span>
                {p.per && <span className="text-[14px] font-medium ml-1" style={{ color: p.featured ? 'rgba(255,255,255,.4)' : '#9ca3af' }}>{p.per}</span>}
              </div>
              <div className="h-px mb-4" style={{ background: p.featured ? 'rgba(255,255,255,.1)' : '#e5e7eb' }} />
              <ul className="list-none p-0 mb-6 flex flex-col gap-2.5 flex-1">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-[13.5px]" style={{ color: p.featured ? 'rgba(255,255,255,.7)' : '#374151' }}>
                    <span className="flex-shrink-0"><Chk s={11} c={p.featured ? '#818cf8' : '#5b6cf9'} /></span>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="w-full flex items-center justify-center gap-2 text-[14px] font-bold py-3.5 rounded-xl border-none cursor-pointer transition-all"
                style={{
                  background: p.featured ? '#fff' : '#0a0a0b',
                  color: p.featured ? '#5b6cf9' : '#fff',
                }}
                onClick={onCta}
              >
                Get started <Arr s={13} />
              </button>
            </div>
          ))}
        </div>

        <p className="text-center text-[13px] text-gray-400 mt-6">Annual plans save 20% · 30-day money-back guarantee · No credit card to start</p>
        <div className="text-center mt-4">
          <a
            href="/pricing"
            className="text-[14px] text-[#5b6cf9] font-semibold no-underline inline-flex items-center gap-1 hover:underline"
          >
            View full pricing details <Arr s={12} />
          </a>
        </div>
      </div>
    </section>
  );
}

// ── Final CTA ─────────────────────────────────────────────────────────────────

function FinalCTA({ onCta }: { onCta: () => void }) {
  return (
    <section className="py-24 bg-[#0a0a0b] relative overflow-hidden">
      {/* Glow orbs */}
      <div
        className="absolute pointer-events-none rounded-full dw-glow"
        style={{ top: -100, right: -80, width: 520, height: 520, background: 'radial-gradient(circle, rgba(91,108,249,.22) 0%, transparent 65%)' }}
      />
      <div
        className="absolute pointer-events-none rounded-full dw-glow-2"
        style={{ bottom: -90, left: -60, width: 380, height: 380, background: 'radial-gradient(circle, rgba(91,108,249,.14) 0%, transparent 65%)' }}
      />

      <div className="max-w-[1160px] mx-auto px-6 relative z-10" data-gsap="fade-up">
        <h2
          className="font-black tracking-tight text-white text-center mb-5"
          style={{ fontSize: 'clamp(36px, 4.5vw, 66px)', letterSpacing: '-0.04em', lineHeight: 1.06 }}
        >
          Ship strategy.<br />
          <span className="text-[#818cf8]">Not busywork.</span>
        </h2>
        <p className="text-[17px] text-white/45 text-center max-w-[440px] mx-auto mb-10 leading-[1.65]">
          Join thousands of creators and teams who use Dakyworld Hub to publish smarter and grow faster every single week.
        </p>
        <div className="flex items-center justify-center gap-3.5 flex-wrap mb-6">
          <button
            type="button"
            className="inline-flex items-center gap-2 bg-[#5b6cf9] text-white text-[16px] font-bold px-7 py-4 rounded-xl border-none cursor-pointer transition-all hover:-translate-y-0.5 hover:bg-[#4f5de6]"
            style={{ boxShadow: '0 4px 18px rgba(91,108,249,.35)' }}
            onClick={onCta}
          >
            Start for free — it's on us <Arr s={15} />
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 bg-transparent text-white/55 text-[15px] font-semibold px-5 py-4 rounded-xl cursor-pointer transition-all hover:border-white/30 hover:text-white"
            style={{ border: '1.5px solid rgba(255,255,255,.14)' }}
            onClick={onCta}
          >
            View pricing
          </button>
        </div>
        <div className="flex items-center justify-center gap-6 flex-wrap">
          {['No credit card required', '1-minute setup', '30-day money-back guarantee'].map((t) => (
            <span key={t} className="text-[13px] text-white/30 before:content-['✓__'] before:text-[rgba(91,108,249,.6)]">{t}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function Landing({ onLoginClick }: { onLoginClick: () => void }) {
  useScrollAnimations();

  return (
    <div className="bg-white text-[#0a0a0b] overflow-x-hidden font-sans">
      <PublicNav onLoginClick={onLoginClick} activePath="/" />
      <Hero onCta={onLoginClick} />
      <Marquee />
      <Stats />
      <Problem />
      <Features onCta={onLoginClick} />
      <HowItWorks />
      <AnalyticsHighlight />
      <Testimonials />
      <Integrations />
      <PricingPreview onCta={onLoginClick} />
      <FinalCTA onCta={onLoginClick} />
      <PublicFooter />
    </div>
  );
}
