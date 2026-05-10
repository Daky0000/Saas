import React, { useEffect, useRef, type RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { fetchPageContent } from '../services/pageContentService';
import PublicNav from '../components/landing/PublicNav';
import PublicFooter from '../components/landing/PublicFooter';

gsap.registerPlugin(ScrollTrigger);

// ── Exported types for admin CMS compatibility ────────────────────────────────

export type ToolItem = {
  icon: string;
  name: string;
  tagline: string;
  description: string;
  bullets: string[];
};

export type ToolsPageContent = {
  hero: { badge: string; headline: string; subheadline: string };
  tools: ToolItem[];
  cta: { headline: string; subheadline: string; buttonText: string };
};

export const defaultToolsContent: ToolsPageContent = {
  hero: {
    badge: 'Platform Tools',
    headline: 'Create.\nPublish.\nMeasure.',
    subheadline: 'A focused toolkit for creating and managing your social content.',
  },
  tools: [],
  cta: { headline: 'Ready to publish?', subheadline: 'Create your next post in minutes.', buttonText: 'Get started' },
};

// ── Shared helpers ────────────────────────────────────────────────────────────

function Chk() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
      <path d="M2 6.5L4.5 9L10 3" stroke="#5b6cf9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Arr() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
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

// ── GSAP animations ───────────────────────────────────────────────────────────

function useAnimations() {
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('[data-tl="fade"]').forEach((el) => {
        gsap.fromTo(el, { y: 38, opacity: 0 }, {
          y: 0, opacity: 1, duration: 0.8, ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        });
      });
      gsap.utils.toArray<HTMLElement>('[data-tl="stagger"]').forEach((el) => {
        gsap.fromTo(Array.from(el.children), { y: 30, opacity: 0 }, {
          y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', stagger: 0.1,
          scrollTrigger: { trigger: el, start: 'top 86%', once: true },
        });
      });
      gsap.utils.toArray<HTMLElement>('[data-tl="slide-right"]').forEach((el) => {
        gsap.fromTo(el, { x: 50, opacity: 0 }, {
          x: 0, opacity: 1, duration: 0.9, ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 85%', once: true },
        });
      });
      gsap.utils.toArray<HTMLElement>('[data-tl="slide-left"]').forEach((el) => {
        gsap.fromTo(el, { x: -50, opacity: 0 }, {
          x: 0, opacity: 1, duration: 0.9, ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 85%', once: true },
        });
      });
      gsap.utils.toArray<HTMLElement>('.tl-flow-icon').forEach((el, i) => {
        gsap.fromTo(el, { scale: 0, rotation: -15 }, {
          scale: 1, rotation: 0, duration: 0.6, ease: 'back.out(1.8)', delay: i * 0.12,
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        });
      });
    });
    return () => { ctx.revert(); ScrollTrigger.getAll().forEach((t) => t.kill()); };
  }, []);
}

function useHeroAnim(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!ref.current) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo('.tl-hero-badge', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, 0.15)
        .fromTo('.tl-hero-h1', { y: 32, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8 }, 0.3)
        .fromTo('.tl-hero-lede', { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7 }, 0.5)
        .fromTo('.tl-hero-btns', { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.65)
        .fromTo('.tl-hero-visual', { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.9, ease: 'power2.out' }, 0.35);
    }, ref.current);
    return () => ctx.revert();
  }, [ref]);
}

// ── Hero visual mockups ───────────────────────────────────────────────────────

function HeroVisual() {
  return (
    <div className="flex flex-col gap-3">
      {/* Nova AI mockup */}
      <div
        className="bg-white rounded-2xl border border-gray-100 shadow-md overflow-hidden"
        style={{ animation: 'dw-float 8s ease-in-out infinite' }}
      >
        <MockChrome url="daky.ai/studio — Nova AI" />
        <div className="p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 px-2.5 py-2 bg-gray-50 rounded-lg border border-gray-200">
            <span className="text-[9px] font-bold bg-[#eef0fe] text-[#5b6cf9] px-1.5 py-0.5 rounded">NOVA AI</span>
            <span className="text-[12px] text-gray-700 flex-1">Write a launch post for our new feature drop</span>
            <div className="w-1 h-1 rounded-full bg-[#5b6cf9] dw-dot-pulse" />
          </div>
          <div className="px-3 py-2.5 bg-white border border-gray-100 rounded-xl border-l-2 border-l-[#5b6cf9]">
            <p className="m-0 mb-1.5 text-[12px] text-gray-700 leading-relaxed">
              "After 6 months of building in the shadows — our biggest feature is finally here."
            </p>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] bg-[#eef0fe] text-[#5b6cf9] px-1.5 py-0.5 rounded font-semibold">Hook</span>
              <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-semibold">LinkedIn</span>
              <span className="text-[9px] text-gray-400 ml-auto">Tue 7:30 AM ↗</span>
            </div>
          </div>
          <div className="flex gap-1.5">
            {[
              { label: 'Instagram', bg: 'linear-gradient(135deg,#f09433,#dc2743,#bc1888)' },
              { label: 'LinkedIn', bg: '#0a66c2' },
              { label: 'X (Twitter)', bg: '#0a0a0b' },
            ].map((p) => (
              <div key={p.label} className="flex items-center gap-1 px-2 py-1 rounded-md" style={{ background: p.bg }}>
                <span className="text-[9px] text-white font-bold">{p.label}</span>
              </div>
            ))}
            <div className="ml-auto flex items-center gap-1 px-2 py-1 bg-gray-50 border border-gray-100 rounded-md">
              <span className="text-[9px] text-gray-500 font-semibold">+ 3 more</span>
            </div>
          </div>
        </div>
      </div>

      {/* Analytics + Calendar row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-md overflow-hidden" style={{ animation: 'dw-float 10s ease-in-out infinite 2s' }}>
          <MockChrome url="analytics" />
          <div className="p-3">
            <div className="text-[9px] text-gray-400 uppercase tracking-widest mb-1 font-mono">Reach this week</div>
            <div className="text-[22px] font-black tracking-tight text-[#0a0a0b] mb-2">284K</div>
            <div className="flex items-end gap-1 h-8">
              {[35, 55, 42, 68, 80, 58, 92].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t dw-bar"
                  style={{ background: i === 6 ? '#5b6cf9' : '#e5e7eb', height: `${h}%`, animationDelay: `${i * 80}ms`, transformOrigin: 'bottom' }}
                />
              ))}
            </div>
            <div className="flex items-center gap-1 mt-2">
              <span className="text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-bold">+28%</span>
              <span className="text-[9px] text-gray-400">vs last week</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-md overflow-hidden" style={{ animation: 'dw-float 9s ease-in-out infinite 4s' }}>
          <MockChrome url="calendar" />
          <div className="p-3">
            <div className="text-[9px] text-gray-400 uppercase tracking-widest mb-2 font-mono">May 2026</div>
            <div className="grid grid-cols-5 gap-0.5">
              {[
                { d: 12, posts: [] as string[] },
                { d: 13, posts: ['IG'] },
                { d: 14, posts: ['LI', 'X'] },
                { d: 15, posts: [] as string[] },
                { d: 16, posts: ['FB'] },
                { d: 17, posts: ['IG', 'LI'] },
                { d: 18, posts: [] as string[] },
                { d: 19, posts: ['TK'] },
                { d: 20, posts: ['LI'] },
                { d: 21, posts: ['IG', 'X', 'FB'] },
              ].map(({ d, posts }) => (
                <div key={d} className="bg-gray-50 rounded p-0.5 min-h-[28px]">
                  <div className="text-[7px] text-gray-400 mb-0.5">{d}</div>
                  {posts.slice(0, 2).map((p, i) => (
                    <div
                      key={i}
                      className="text-[5.5px] font-bold text-white px-0.5 py-px rounded mb-px"
                      style={{ background: p === 'IG' ? '#dc2743' : p === 'LI' ? '#0a66c2' : p === 'X' ? '#0a0a0b' : p === 'FB' ? '#1877f2' : '#010101' }}
                    >{p}</div>
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1 px-1.5 py-1 bg-[#eef0fe] rounded">
              <div className="w-1 h-1 rounded-full bg-[#5b6cf9] dw-dot-pulse" />
              <span className="text-[8px] text-[#5b6cf9] font-semibold">AI timing enabled</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tool section mockups ──────────────────────────────────────────────────────

function NovaMockup() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden max-w-[500px]">
      <MockChrome url="daky.ai/studio — Nova AI" />
      <div className="p-4 flex flex-col gap-2.5">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 rounded-lg bg-[#5b6cf9] flex items-center justify-center text-[12px] font-black text-white">N</div>
          <div>
            <div className="text-[11px] font-bold text-[#0a0a0b]">Nova AI</div>
            <div className="text-[9.5px] text-gray-400">Brand voice: Professional + Bold</div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <div className="w-1 h-1 rounded-full bg-emerald-500" />
            <span className="text-[9px] text-emerald-600 font-semibold">Ready</span>
          </div>
        </div>
        <div className="px-3 py-2.5 bg-gray-50 rounded-xl border border-gray-100 text-[12px] text-gray-700">
          "Write 3 posts about our AI image generation feature"
        </div>
        {[
          { n: '01', post: '"Your brand visuals, generated in 10 seconds. No designer needed."', platform: 'LinkedIn', tag: 'Product', score: 94 },
          { n: '02', post: '"We just shipped the thing our users asked about most. Thread 🧵"', platform: 'X / Twitter', tag: 'Hook', score: 88 },
          { n: '03', post: '"Behind every great post is a system. Here\'s ours ↓"', platform: 'Instagram', tag: 'Carousel', score: 91 },
        ].map((p) => (
          <div key={p.n} className="flex gap-2.5 px-3 py-2.5 bg-white border border-gray-100 rounded-xl">
            <span className="font-mono text-[10px] text-[#5b6cf9] font-bold pt-0.5 min-w-[20px]">{p.n}</span>
            <div className="flex-1">
              <p className="m-0 mb-1.5 text-[12px] text-gray-700 leading-relaxed">{p.post}</p>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] bg-[#eef0fe] text-[#5b6cf9] px-1.5 py-0.5 rounded font-semibold">{p.tag}</span>
                <span className="text-[10px] text-gray-400">{p.platform}</span>
                <span className="ml-auto text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-bold">{p.score} score</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StudioMockup() {
  const colors = ['#5b6cf9', '#818cf8', '#f59e0b', '#10b981', '#e11d48'];
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden max-w-[500px]">
      <MockChrome url="daky.ai/studio — AI Studio" />
      <div className="p-4 flex gap-3">
        {/* Left panel */}
        <div className="w-16 flex-shrink-0">
          <div className="text-[9px] text-gray-400 mb-2 uppercase tracking-widest">Elements</div>
          {['Text', 'Shape', 'Image', 'Icon', 'BG'].map((el) => (
            <div key={el} className="px-2 py-1.5 bg-gray-50 border border-gray-100 rounded-lg mb-1 text-[10px] text-gray-700 font-semibold">{el}</div>
          ))}
        </div>
        {/* Canvas */}
        <div className="flex-1 rounded-xl min-h-[160px] flex flex-col items-center justify-center p-3.5 relative" style={{ background: 'linear-gradient(135deg,#eef0fe,#f5f3ff)' }}>
          <div className="w-full bg-[#5b6cf9] rounded-lg px-3.5 py-3 mb-2">
            <div className="text-[13px] font-black text-white tracking-tight mb-1">New Feature Alert</div>
            <div className="text-[9px] text-white/70 leading-relaxed">AI-powered image generation — now available on all plans.</div>
          </div>
          <div className="flex gap-1 w-full">
            {colors.map((c) => <div key={c} className="flex-1 h-2 rounded-sm" style={{ background: c }} />)}
          </div>
          <div className="absolute bottom-2 right-2 text-[9px] text-[#5b6cf9] bg-white px-1.5 py-0.5 rounded font-semibold">Instagram · 1080×1080</div>
        </div>
        {/* Right panel */}
        <div className="w-16 flex-shrink-0">
          <div className="text-[9px] text-gray-400 mb-2 uppercase tracking-widest">Brand Kit</div>
          <div className="grid grid-cols-2 gap-1 mb-2">
            {colors.slice(0, 4).map((c) => <div key={c} className="w-6 h-6 rounded-md" style={{ background: c }} />)}
          </div>
          <div className="text-[9px] text-gray-400 mb-1.5 uppercase tracking-widest">Export</div>
          {['PNG', 'JPG', 'Publish'].map((e) => (
            <div
              key={e}
              className="py-1 text-center rounded-md mb-1 text-[9px] font-bold"
              style={{
                background: e === 'Publish' ? '#5b6cf9' : '#f9fafb',
                border: `1px solid ${e === 'Publish' ? '#5b6cf9' : '#e5e7eb'}`,
                color: e === 'Publish' ? '#fff' : '#374151',
              }}
            >{e}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CalendarMockup() {
  const posts = [
    { d: 12, c: '#dc2743', l: 'IG' }, { d: 12, c: '#0a66c2', l: 'LI' },
    { d: 14, c: '#0a0a0b', l: 'X' },
    { d: 15, c: '#1877f2', l: 'FB' },
    { d: 17, c: '#dc2743', l: 'IG' }, { d: 17, c: '#0a66c2', l: 'LI' }, { d: 17, c: '#0a0a0b', l: 'X' },
    { d: 19, c: '#010101', l: 'TK' },
    { d: 21, c: '#dc2743', l: 'IG' }, { d: 21, c: '#ff0000', l: 'YT' },
  ];
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden max-w-[500px]">
      <MockChrome url="daky.ai/calendar" />
      <div className="p-4">
        <div className="flex justify-between items-center mb-3">
          <div className="text-[12px] font-bold text-[#0a0a0b]">May 2026</div>
          <div className="flex gap-1">
            {[{ c: '#dc2743', l: 'IG' }, { c: '#0a66c2', l: 'LI' }, { c: '#0a0a0b', l: 'X' }, { c: '#1877f2', l: 'FB' }].map((p) => (
              <div key={p.l} className="w-4.5 h-4.5 rounded flex items-center justify-center" style={{ background: p.c, width: 18, height: 18 }}>
                <span className="text-[7px] text-white font-extrabold">{p.l}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-7 gap-0.5 mb-1.5">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <div key={i} className="text-[8px] text-gray-400 text-center font-semibold">{d}</div>
          ))}
          {Array.from({ length: 21 }, (_, i) => i + 11).map((d) => {
            const dayPosts = posts.filter((p) => p.d === d);
            return (
              <div key={d} className="bg-gray-50 rounded p-0.5 min-h-[36px]">
                <div className="text-[7.5px] text-gray-400 mb-0.5">{d}</div>
                {dayPosts.slice(0, 3).map((p, j) => (
                  <div key={j} className="w-full h-1 rounded mb-px" style={{ background: p.c }} />
                ))}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-2 bg-[#eef0fe] rounded-lg">
          <div className="w-1.5 h-1.5 rounded-full bg-[#5b6cf9] dw-dot-pulse" />
          <span className="text-[10px] text-[#5b6cf9] font-semibold">AI detected best times for this week · applied automatically</span>
        </div>
      </div>
    </div>
  );
}

function AnalyticsMockup() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden max-w-[500px]">
      <MockChrome url="daky.ai/analytics" />
      <div className="p-4 flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Total Reach', value: '2.4M', delta: '+34%' },
            { label: 'Engagement', value: '8.7%', delta: '+2.1%' },
            { label: 'Followers', value: '12,840', delta: '+847' },
          ].map((s) => (
            <div key={s.label} className="px-3 py-2.5 bg-gray-50 rounded-xl border border-gray-100">
              <div className="text-[9px] text-gray-400 mb-1 uppercase tracking-widest">{s.label}</div>
              <div className="text-[18px] font-black tracking-tight text-[#0a0a0b] mb-1">{s.value}</div>
              <div className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-bold inline-block">{s.delta}</div>
            </div>
          ))}
        </div>
        <div>
          <div className="text-[10px] text-gray-500 mb-2 font-semibold">Top content formats this month</div>
          {[
            { label: 'Carousel / Slides', pct: 78 },
            { label: 'Short-form video', pct: 65 },
            { label: 'Single image', pct: 42 },
            { label: 'Text post', pct: 31 },
          ].map((b) => (
            <div key={b.label} className="mb-2">
              <div className="flex justify-between text-[11px] text-gray-600 mb-1">
                <span>{b.label}</span>
                <span className="font-semibold">{b.pct}%</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full dw-progress"
                  style={{ width: `${b.pct}%`, background: 'linear-gradient(90deg,#5b6cf9,#818cf8)' }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const MOCKUP_MAP: Record<string, () => React.ReactElement> = {
  nova: NovaMockup,
  studio: StudioMockup,
  calendar: CalendarMockup,
  analytics: AnalyticsMockup,
};

// ── Tool data ─────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    id: 'nova', tag: 'Nova AI', tagColor: '#5b6cf9', tagBg: '#eef0fe', flip: false, mockup: 'nova',
    h3: 'Generate content that sounds exactly like you.',
    lede: 'Nova AI learns your brand voice from your past posts, website copy, and tone preferences — then generates content that\'s indistinguishable from what you\'d write yourself.',
    bullets: [
      'Brand voice memory — trained on your content',
      'Platform-native formats: threads, carousels, captions',
      'Tone calibration (professional, witty, casual, bold)',
      'Batch generate a full week of content in minutes',
      'Hashtag intelligence and optimal posting time predictions',
    ],
  },
  {
    id: 'studio', tag: 'AI Studio', tagColor: '#7c3aed', tagBg: '#f5f3ff', flip: true, mockup: 'studio',
    h3: 'Design visuals your audience stops scrolling for.',
    lede: 'From AI-generated images to a full canvas builder — the AI Studio gives you every visual tool in one place. No Figma, no Photoshop, no external apps.',
    bullets: [
      'Text-to-image generation with brand color palettes',
      'Drag-and-drop canvas builder with 200+ templates',
      'Auto-resize to every platform in one click',
      'Custom brand kit: fonts, colors, logos',
      'Export to PNG, JPG, or publish directly',
    ],
  },
  {
    id: 'calendar', tag: 'Smart Scheduler', tagColor: '#059669', tagBg: '#ecfdf5', flip: false, mockup: 'calendar',
    h3: 'Plan a month of content in one afternoon.',
    lede: 'The drag-and-drop content calendar shows every post across every platform at a glance. Rearrange, duplicate, and bulk-schedule without ever losing the big picture.',
    bullets: [
      'Visual calendar with multi-platform view',
      'AI-recommended optimal posting times',
      'Drag-to-reschedule, bulk actions',
      'Content queue with auto-fill suggestions',
      'Preview posts as they\'ll appear on each platform',
    ],
  },
  {
    id: 'analytics', tag: 'Analytics', tagColor: '#d97706', tagBg: '#fffbeb', flip: true, mockup: 'analytics',
    h3: 'Know exactly what drives growth — not just likes.',
    lede: 'Deep performance metrics across all platforms in a single dashboard. Track reach, engagement, audience growth, and content ROI with clarity you can actually act on.',
    bullets: [
      'Unified analytics across all 6 platforms',
      'Content performance breakdown by format and topic',
      'Audience growth trends and demographics',
      'Competitor benchmarking (Scale plan)',
      'Scheduled PDF reports for clients or team',
    ],
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

type Props = { onLoginClick: () => void };

export default function Tools({ onLoginClick }: Props) {
  const heroRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // fire CMS fetch but don't use it — page uses static data
    fetchPageContent('tools').catch(() => undefined);
  }, []);

  useHeroAnim(heroRef);
  useAnimations();

  return (
    <div className="bg-white text-[#0a0a0b] overflow-x-hidden font-sans">
      <PublicNav onLoginClick={onLoginClick} activePath="/tools" />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-36 pb-0" ref={heroRef}>
        {/* Glow orbs */}
        <div
          className="absolute pointer-events-none rounded-full dw-glow"
          style={{ top: -40, right: -80, width: 640, height: 640, background: 'radial-gradient(circle, rgba(91,108,249,.12) 0%, transparent 65%)' }}
        />
        <div
          className="absolute pointer-events-none rounded-full dw-glow-2"
          style={{ bottom: -100, left: -60, width: 440, height: 440, background: 'radial-gradient(circle, rgba(91,108,249,.07) 0%, transparent 65%)' }}
        />
        {/* Dots */}
        <div
          className="absolute inset-0 pointer-events-none opacity-25"
          style={{
            backgroundImage: 'radial-gradient(#c7d0fe 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 65% 40%, black 20%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 65% 40%, black 20%, transparent 100%)',
          }}
        />

        <div className="max-w-[1160px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="tl-hero-badge inline-flex items-center gap-2 border border-[#c7d0fe] bg-[#eef0fe] rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-[#5b6cf9] mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5b6cf9] dw-dot-pulse" />
                Full platform toolkit
              </div>
              <h1
                className="tl-hero-h1 font-black tracking-tight text-[#0a0a0b] mb-5"
                style={{ fontSize: 'clamp(42px, 5vw, 72px)', lineHeight: 1.02, letterSpacing: '-0.045em' }}
              >
                Every tool.<br />
                One platform.<br />
                <span className="bg-gradient-to-r from-[#5b6cf9] to-violet-500 bg-clip-text text-transparent">Zero friction.</span>
              </h1>
              <p className="tl-hero-lede text-[17px] leading-[1.7] text-gray-500 mb-8 max-w-[460px]">
                From AI content generation to visual design to analytics and automation — everything your brand needs to dominate social media, built under one roof.
              </p>
              <div className="tl-hero-btns flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 bg-[#5b6cf9] text-white text-[15px] font-bold px-6 py-3.5 rounded-xl border-none cursor-pointer transition-all hover:-translate-y-0.5 hover:bg-[#4f5de6]"
                  style={{ boxShadow: '0 4px 18px rgba(91,108,249,.35)' }}
                  onClick={onLoginClick}
                >
                  Try it free <Arr />
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 bg-transparent text-gray-700 text-[15px] font-semibold px-5 py-3.5 rounded-xl border border-gray-200 cursor-pointer transition-all hover:border-[#c7d0fe] hover:text-[#5b6cf9]"
                  onClick={onLoginClick}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" opacity=".4" /><path d="M5.5 5L9.5 7 5.5 9V5Z" fill="currentColor" /></svg>
                  See it in action
                </button>
              </div>
            </div>
            <div className="tl-hero-visual flex justify-center">
              <div className="w-full max-w-[520px]">
                <HeroVisual />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Platform strip ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-2 flex-wrap px-6 py-5 border-t border-b border-gray-100 bg-gray-50 mt-16">
        {[
          { name: 'Instagram', bg: 'linear-gradient(135deg,#f09433,#dc2743,#bc1888)', label: 'IG' },
          { name: 'LinkedIn', bg: '#0a66c2', label: 'in' },
          { name: 'X · Twitter', bg: '#0a0a0b', label: '𝕏' },
          { name: 'Facebook', bg: '#1877f2', label: 'f' },
          { name: 'TikTok', bg: '#010101', label: '♪' },
          { name: 'YouTube', bg: '#ff0000', label: '▶' },
        ].map((p) => (
          <div key={p.name} className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-100 rounded-full text-[13px] font-semibold text-gray-500">
            <div className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-extrabold text-white flex-shrink-0" style={{ background: p.bg }}>{p.label}</div>
            {p.name}
          </div>
        ))}
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="max-w-[1160px] mx-auto px-6 pt-20 pb-0">
        <div
          className="grid grid-cols-2 lg:grid-cols-4 border border-gray-100 rounded-[22px] overflow-hidden mb-16"
          data-tl="stagger"
        >
          {[
            { v: '6', l: 'Platforms in one hub' },
            { v: '10×', l: 'Faster than manual' },
            { v: '200+', l: 'Content templates' },
            { v: '12K+', l: 'Active creators' },
          ].map((s) => (
            <div
              key={s.l}
              className="py-9 px-6 text-center border-r border-gray-100 last:border-r-0"
            >
              <div
                className="font-black tracking-tight text-[#5b6cf9] leading-none mb-1.5"
                style={{ fontSize: 'clamp(28px, 3.5vw, 44px)', letterSpacing: '-0.04em' }}
              >{s.v}</div>
              <div className="text-[12px] text-gray-400 font-medium uppercase tracking-wider">{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tool feature sections ────────────────────────────────────────────── */}
      {TOOLS.map((tool, i) => {
        const MockupComp = MOCKUP_MAP[tool.mockup];
        return (
          <section key={tool.id} className="py-20 max-w-[1160px] mx-auto px-6">
            <div className={`grid grid-cols-1 lg:grid-cols-2 gap-20 items-center ${tool.flip ? 'lg:[direction:rtl]' : ''}`}>
              <div className={`max-w-[480px] ${tool.flip ? 'lg:[direction:ltr]' : ''}`} data-tl={tool.flip ? 'slide-right' : 'slide-left'}>
                <div
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-4"
                  style={{ background: tool.tagBg, color: tool.tagColor }}
                >
                  <span className="w-1 h-1 rounded-full" style={{ background: tool.tagColor }} />
                  {tool.tag}
                </div>
                <h2
                  className="font-extrabold tracking-tight text-[#0a0a0b] mb-3"
                  style={{ fontSize: 'clamp(22px, 2.5vw, 32px)', letterSpacing: '-0.03em', lineHeight: 1.14 }}
                >
                  {tool.h3}
                </h2>
                <p className="text-[15px] leading-[1.7] text-gray-500 mb-0">{tool.lede}</p>
                <ul className="list-none p-0 mt-5 flex flex-col gap-2.5">
                  {tool.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2.5 text-[14.5px] text-gray-500 leading-[1.65]">
                      <div className="w-5 h-5 rounded-md bg-[rgba(91,108,249,.08)] flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Chk />
                      </div>
                      {b}
                    </li>
                  ))}
                </ul>
                {i === 0 && (
                  <div className="mt-7">
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 bg-[#5b6cf9] text-white text-[14px] font-bold px-5 py-3 rounded-xl border-none cursor-pointer transition-all hover:-translate-y-0.5 hover:bg-[#4f5de6]"
                      style={{ boxShadow: '0 4px 18px rgba(91,108,249,.35)' }}
                      onClick={onLoginClick}
                    >
                      Try Nova AI free <Arr />
                    </button>
                  </div>
                )}
              </div>
              <div
                className={tool.flip ? 'lg:[direction:ltr] flex justify-center' : 'flex justify-center'}
                data-tl={tool.flip ? 'slide-left' : 'slide-right'}
              >
                <MockupComp />
              </div>
            </div>
          </section>
        );
      })}

      {/* ── Workflow diagram ─────────────────────────────────────────────────── */}
      <section className="py-20">
        <div className="max-w-[1160px] mx-auto px-6">
          <div className="text-center mb-16" data-tl="fade">
            <div className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-widest text-[#5b6cf9] mb-4 justify-center">
              <span className="w-1 h-1 rounded-full bg-[#5b6cf9]" />Workflow
            </div>
            <h2
              className="font-black tracking-tight text-[#0a0a0b] mb-4 text-center"
              style={{ fontSize: 'clamp(28px, 3.5vw, 48px)', letterSpacing: '-0.04em', lineHeight: 1.06 }}
            >
              From idea to published in 4 steps.
            </h2>
            <p className="text-[17px] leading-[1.7] text-gray-500 text-center max-w-[500px] mx-auto">
              Every tool connects seamlessly. No copy-pasting, no context switching, no tab juggling.
            </p>
          </div>

          <div className="relative">
            {/* Connector line */}
            <div
              className="absolute hidden lg:block h-0.5 opacity-20 z-0"
              style={{ top: 40, left: 'calc(12.5%)', right: 'calc(12.5%)', background: 'linear-gradient(90deg,#5b6cf9,#818cf8,#a78bfa,#c084fc)' }}
            />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              {[
                { emoji: '🧠', title: 'Train your brand voice', desc: 'Connect your accounts and past content. Nova AI learns what makes your brand unique.' },
                { emoji: '✍️', title: 'Generate & refine', desc: 'Nova drafts posts, captions, and visuals. You review, tweak, and approve.' },
                { emoji: '📅', title: 'Schedule everywhere', desc: 'Drag to the calendar, pick optimal times, and queue across all 6 platforms at once.' },
                { emoji: '📊', title: 'Analyze & improve', desc: 'See what drives real growth. Feed insights back to Nova for even better future content.' },
              ].map((step) => (
                <div key={step.title} className="text-center px-3 pb-9">
                  <div
                    className="tl-flow-icon w-20 h-20 rounded-[22px] mx-auto mb-5 flex items-center justify-center text-[28px] relative z-10 bg-white border border-gray-100 transition-all hover:-translate-y-1"
                    style={{ boxShadow: '0 4px 16px rgba(0,0,0,.06)' }}
                  >{step.emoji}</div>
                  <div className="text-[15px] font-bold text-[#0a0a0b] mb-1.5">{step.title}</div>
                  <div className="text-[13px] text-gray-500 leading-relaxed max-w-[180px] mx-auto">{step.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── All tools grid ───────────────────────────────────────────────────── */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-[1160px] mx-auto px-6">
          <div className="text-center mb-12" data-tl="fade">
            <div className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-widest text-[#5b6cf9] mb-4 justify-center">
              <span className="w-1 h-1 rounded-full bg-[#5b6cf9]" />All tools
            </div>
            <h2
              className="font-black tracking-tight text-[#0a0a0b] mb-3 text-center"
              style={{ fontSize: 'clamp(28px, 3.5vw, 48px)', letterSpacing: '-0.04em', lineHeight: 1.06 }}
            >
              Everything, all at once.
            </h2>
            <p className="text-[17px] leading-[1.7] text-gray-500 text-center max-w-[480px] mx-auto">
              Six deeply integrated tools that work better together.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" data-tl="stagger">
            {[
              { ico: '✍️', bg: '#eef0fe', name: 'Nova AI', tag: 'Content generation', desc: 'AI that writes in your voice across every format and platform.' },
              { ico: '🎨', bg: '#f5f3ff', name: 'AI Studio', tag: 'Visual design', desc: 'AI image generation + drag-and-drop canvas builder with 200+ templates.' },
              { ico: '📅', bg: '#ecfdf5', name: 'Smart Scheduler', tag: 'Publishing', desc: 'Drag-and-drop content calendar with AI-powered optimal timing.' },
              { ico: '📊', bg: '#fffbeb', name: 'Analytics', tag: 'Performance', desc: 'Unified multi-platform metrics that reveal what actually drives growth.' },
              { ico: '⚡', bg: '#fff1f2', name: 'Automations', tag: 'Workflows', desc: 'Set trigger-based workflows to auto-generate and publish without lifting a finger.' },
              { ico: '👥', bg: '#f0fdf4', name: 'Team & Clients', tag: 'Collaboration', desc: 'Multi-seat workspaces, client portals, and approval flows built in.' },
            ].map((c) => (
              <div
                key={c.name}
                className="bg-white rounded-2xl p-6 border border-gray-100 transition-all hover:border-[#c7d0fe] hover:shadow-[0_8px_32px_rgba(91,108,249,.1)] hover:-translate-y-0.5 cursor-default"
              >
                <div className="w-11 h-11 rounded-[13px] flex items-center justify-center mb-4 text-[20px]" style={{ background: c.bg }}>{c.ico}</div>
                <div className="text-[16px] font-extrabold text-[#0a0a0b] mb-1">{c.name}</div>
                <div className="text-[12.5px] font-semibold text-[#5b6cf9] mb-2.5">{c.tag}</div>
                <div className="text-[13.5px] text-gray-500 leading-relaxed">{c.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Integrations ─────────────────────────────────────────────────────── */}
      <div className="max-w-[1160px] mx-auto px-6 py-20">
        <div className="text-center mb-12" data-tl="fade">
          <div className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-widest text-[#5b6cf9] mb-4 justify-center">
            <span className="w-1 h-1 rounded-full bg-[#5b6cf9]" />Integrations
          </div>
          <h2
            className="font-black tracking-tight text-[#0a0a0b] mb-3 text-center"
            style={{ fontSize: 'clamp(28px, 3.5vw, 48px)', letterSpacing: '-0.04em', lineHeight: 1.06 }}
          >
            Works with your whole stack.
          </h2>
          <p className="text-[17px] leading-[1.7] text-gray-500 text-center max-w-[480px] mx-auto">
            Connect the tools you already use — Dakyworld Hub plays nicely with everything.
          </p>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3.5" data-tl="stagger">
          {[
            { name: 'Instagram', bg: 'linear-gradient(135deg,#f09433,#dc2743)', label: 'IG' },
            { name: 'LinkedIn', bg: '#0a66c2', label: 'in' },
            { name: 'X', bg: '#0a0a0b', label: '𝕏' },
            { name: 'Facebook', bg: '#1877f2', label: 'f' },
            { name: 'TikTok', bg: '#010101', label: '♪' },
            { name: 'YouTube', bg: '#ff0000', label: '▶' },
            { name: 'Canva', bg: 'linear-gradient(135deg,#7d2ae8,#00c4cc)', label: 'Ca' },
            { name: 'Slack', bg: '#4a154b', label: 'Sl' },
            { name: 'Notion', bg: '#0a0a0b', label: 'No' },
            { name: 'Zapier', bg: '#ff4a00', label: 'Zp' },
            { name: 'Webhook', bg: '#374151', label: '<>' },
            { name: 'API', bg: '#5b6cf9', label: '{…}' },
          ].map((int) => (
            <div
              key={int.name}
              className="bg-white border border-gray-100 rounded-2xl py-5 px-3 flex flex-col items-center gap-2 transition-all hover:border-[#c7d0fe] hover:shadow-[0_4px_18px_rgba(91,108,249,.12)] hover:-translate-y-1 cursor-default"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[16px] font-extrabold text-white" style={{ background: int.bg }}>{int.label}</div>
              <div className="text-[12px] text-gray-500 font-semibold">{int.name}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <div className="max-w-[1160px] mx-auto px-6 pb-20">
        <div
          className="relative overflow-hidden bg-[#0a0a0b] rounded-[28px] py-[72px] px-14 text-center"
          data-tl="fade"
        >
          {/* Orbs */}
          <div className="absolute pointer-events-none rounded-full" style={{ top: -60, right: -60, width: 380, height: 380, background: 'radial-gradient(circle, rgba(91,108,249,.25) 0%, transparent 65%)' }} />
          <div className="absolute pointer-events-none rounded-full" style={{ bottom: -60, left: -40, width: 280, height: 280, background: 'radial-gradient(circle, rgba(91,108,249,.15) 0%, transparent 65%)' }} />
          <div className="relative">
            <h2
              className="font-black tracking-tight text-white mb-4"
              style={{ fontSize: 'clamp(32px, 4vw, 56px)', letterSpacing: '-0.04em', lineHeight: 1.06 }}
            >
              All the tools.<br />
              <span className="text-[#818cf8]">None of the chaos.</span>
            </h2>
            <p className="text-[16px] text-white/45 max-w-[440px] mx-auto mb-9 leading-[1.65]">
              Join 12,000+ creators and brands who publish smarter with Dakyworld Hub. Free plan available.
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap mb-5">
              <button
                type="button"
                className="inline-flex items-center gap-2 bg-[#5b6cf9] text-white text-[15px] font-bold px-6 py-3.5 rounded-xl border-none cursor-pointer transition-all hover:-translate-y-0.5 hover:bg-[#4f5de6]"
                style={{ boxShadow: '0 4px 18px rgba(91,108,249,.35)' }}
                onClick={onLoginClick}
              >
                Start for free <Arr />
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 bg-transparent text-white/60 text-[15px] font-semibold px-5 py-3.5 rounded-xl cursor-pointer transition-all hover:border-white/30 hover:text-white"
                style={{ border: '1.5px solid rgba(255,255,255,.15)' }}
                onClick={onLoginClick}
              >
                View pricing
              </button>
            </div>
            <div className="flex items-center justify-center gap-6 flex-wrap">
              {['Free plan forever', 'No credit card', 'Setup in 60 seconds'].map((t) => (
                <span key={t} className="text-[12.5px] text-white/30 before:content-['✓__'] before:text-[rgba(91,108,249,.6)]">{t}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
