import { useEffect, useRef, useState, type RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { pricingService } from '../services/pricingService';
import { PricingPlan } from '../types/pricing';
import PublicNav from '../components/landing/PublicNav';
import PublicFooter from '../components/landing/PublicFooter';

gsap.registerPlugin(ScrollTrigger);

// ── Types & helpers ───────────────────────────────────────────────────────────

type BillingCycle = 'monthly' | 'yearly';

function Chk({ dark = false }: { dark?: boolean }) {
  const c = dark ? '#818cf8' : '#5b6cf9';
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path d="M2 6.5L4.5 9L10 3" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

// ── Fallback plans ────────────────────────────────────────────────────────────

const FALLBACK: PricingPlan[] = [
  {
    id: 'starter', name: 'Starter',
    description: 'For creators and solo brands finding their content rhythm.',
    price: 0, billingPeriod: 'monthly',
    features: ['200 AI credits/month', '3 social accounts', 'AI text generation', 'Content calendar', 'Basic analytics', 'Card templates'],
    isActive: true, discountPercentage: 0, isOnSale: false, createdAt: '', updatedAt: '',
  },
  {
    id: 'growth', name: 'Growth',
    description: 'For professionals and teams that publish across every channel.',
    price: 29, billingPeriod: 'monthly',
    features: ['2,000 AI credits/month', '10 social accounts', 'AI image generation', 'Custom brand voice', 'Advanced analytics', 'Priority support', 'Team workspace (3 seats)'],
    isActive: true, discountPercentage: 0, isOnSale: false, createdAt: '', updatedAt: '',
  },
  {
    id: 'scale', name: 'Scale',
    description: 'For agencies and brands managing multiple clients at full velocity.',
    price: 79, billingPeriod: 'monthly',
    features: ['Unlimited AI credits', 'Unlimited accounts', 'AI video generation', 'White-label exports', 'Client workspaces', 'API access', 'Dedicated support', 'Custom integrations'],
    isActive: true, discountPercentage: 0, isOnSale: false, createdAt: '', updatedAt: '',
  },
];

const PLAN_CREDITS: Record<string, string> = {
  starter: '200 credits / mo', growth: '2,000 credits / mo', scale: 'Unlimited credits',
  free: '200 credits / mo', pro: '2,000 credits / mo', business: 'Unlimited credits',
};

function getCredits(plan: PricingPlan) {
  const key = plan.name.toLowerCase();
  for (const [k, v] of Object.entries(PLAN_CREDITS)) {
    if (key.includes(k)) return v;
  }
  return `${plan.price === 0 ? '200' : '2,000'} credits / mo`;
}

function isFeatured(plan: PricingPlan) {
  const n = plan.name.toLowerCase();
  return n.includes('growth') || n.includes('pro') || n.includes('business');
}

function fmt(price: number) {
  return price === 0 ? 'Free' : `$${Math.round(price)}`;
}

// ── Animations ────────────────────────────────────────────────────────────────

function useAnimations() {
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('[data-pp="fade"]').forEach((el) => {
        gsap.fromTo(el, { y: 36, opacity: 0 }, {
          y: 0, opacity: 1, duration: 0.8, ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        });
      });
      gsap.utils.toArray<HTMLElement>('[data-pp="stagger"]').forEach((el) => {
        gsap.fromTo(Array.from(el.children), { y: 28, opacity: 0 }, {
          y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', stagger: 0.12,
          scrollTrigger: { trigger: el, start: 'top 86%', once: true },
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
      tl.fromTo('.pp-hero-badge', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, 0.15)
        .fromTo('.pp-hero-h1', { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7 }, 0.3)
        .fromTo('.pp-hero-sub', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.48)
        .fromTo('.pp-hero-toggle', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, 0.62);
    }, ref.current);
    return () => ctx.revert();
  }, [ref]);
}

// ── Plan card ─────────────────────────────────────────────────────────────────

function PlanCard({ plan, cycle, onCta }: { plan: PricingPlan; cycle: BillingCycle; onCta: () => void }) {
  const featured = isFeatured(plan);
  const isFree = plan.price === 0;
  const pct = plan.discountPercentage ?? 0;
  const yearlyMult = cycle === 'yearly' && !isFree ? 0.8 : 1;
  const finalPrice = pct > 0 ? plan.price * (1 - pct / 100) : plan.price * yearlyMult;
  const showOrig = (pct > 0 || (cycle === 'yearly' && !isFree));

  return (
    <div
      className={`relative flex flex-col rounded-[22px] p-7 transition-all ${
        featured
          ? 'border border-[#5b6cf9] bg-[#0a0a0b] hover:-translate-y-1'
          : 'border border-gray-100 bg-white hover:border-[#c7d0fe] hover:shadow-[0_12px_40px_rgba(91,108,249,.1)] hover:-translate-y-0.5'
      }`}
    >
      {featured && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[#5b6cf9] text-white text-[10.5px] font-extrabold uppercase tracking-widest px-3.5 py-1 rounded-full whitespace-nowrap">
          Most popular
        </div>
      )}
      {plan.isOnSale && !featured && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-amber-400 text-white text-[10.5px] font-extrabold uppercase tracking-widest px-3.5 py-1 rounded-full">
          On Sale
        </div>
      )}

      <div className="text-[19px] font-extrabold tracking-tight mb-1" style={{ color: featured ? '#fff' : '#0a0a0b' }}>
        {plan.name}
      </div>
      <div className="text-[13.5px] leading-relaxed mb-4" style={{ color: featured ? 'rgba(255,255,255,.45)' : '#6b7280' }}>
        {plan.description}
      </div>

      <div
        className="inline-flex items-center gap-1.5 text-[12px] font-bold px-2.5 py-1.5 rounded-lg border mb-4"
        style={{
          color: featured ? '#818cf8' : '#5b6cf9',
          background: featured ? 'rgba(91,108,249,.2)' : 'rgba(91,108,249,.08)',
          borderColor: featured ? 'rgba(91,108,249,.3)' : 'rgba(91,108,249,.18)',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" stroke={featured ? '#818cf8' : '#5b6cf9'} strokeWidth="1.5" />
          <path d="M7 4v3l2 2" stroke={featured ? '#818cf8' : '#5b6cf9'} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {getCredits(plan)}
      </div>

      <div className="mb-4">
        {showOrig && (
          <div className="text-[13px] line-through mb-0.5" style={{ color: featured ? 'rgba(255,255,255,.3)' : '#9ca3af' }}>
            {fmt(plan.price)}<span className="text-[12px]">/{cycle === 'monthly' ? 'mo' : 'yr'}</span>
          </div>
        )}
        <div className="flex items-end gap-1">
          <span
            className="font-black tracking-tight leading-none"
            style={{ fontSize: 'clamp(40px, 4.5vw, 52px)', letterSpacing: '-0.04em', color: featured ? '#fff' : '#0a0a0b' }}
          >
            {isFree ? 'Free' : `$${Math.round(finalPrice)}`}
          </span>
          {!isFree && (
            <span className="text-[14px] ml-0.5 pb-1" style={{ color: featured ? 'rgba(255,255,255,.4)' : '#9ca3af' }}>
              /{cycle === 'monthly' ? 'mo' : 'yr'}
            </span>
          )}
        </div>
        {cycle === 'yearly' && !isFree && pct === 0 && (
          <div className="text-[12px] text-emerald-600 font-semibold mt-1">Save ~20% vs monthly</div>
        )}
        {pct > 0 && <div className="text-[12px] text-emerald-600 font-semibold mt-1">Save {Math.round(pct)}%</div>}
      </div>

      <div className="h-px mb-4" style={{ background: featured ? 'rgba(255,255,255,.1)' : '#e5e7eb' }} />

      <ul className="list-none p-0 mb-6 flex flex-col gap-2.5 flex-1">
        {plan.features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-[13.5px] leading-snug" style={{ color: featured ? 'rgba(255,255,255,.7)' : '#374151' }}>
            <div
              className="w-[18px] h-[18px] rounded-md flex items-center justify-center flex-shrink-0 mt-px"
              style={{ background: featured ? 'rgba(91,108,249,.25)' : 'rgba(91,108,249,.08)' }}
            >
              <Chk dark={featured} />
            </div>
            {f}
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="w-full flex items-center justify-center gap-1.5 text-[14px] font-bold py-3.5 rounded-xl border-none cursor-pointer transition-all hover:-translate-y-px"
        style={{
          background: featured ? '#fff' : '#0a0a0b',
          color: featured ? '#5b6cf9' : '#fff',
        }}
        onClick={onCta}
      >
        {isFree ? 'Get started free' : 'Start 7-day trial'} <Arr />
      </button>
      <div className="text-[11.5px] text-center mt-2.5" style={{ color: featured ? 'rgba(255,255,255,.3)' : '#9ca3af' }}>
        {isFree ? 'No credit card required' : 'Cancel anytime'}
      </div>
    </div>
  );
}

// ── Credit meter visual ───────────────────────────────────────────────────────

function CreditMeter() {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6">
      <div className="flex justify-between items-start mb-5">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-1">Growth Plan</div>
          <div className="text-3xl font-black tracking-tight text-[#0a0a0b]">2,000</div>
          <div className="text-[12px] text-gray-400 mt-0.5">credits remaining this month</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-gray-400">Renews in</div>
          <div className="text-[16px] font-extrabold text-[#0a0a0b]">18 days</div>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        {[
          { label: 'AI Text generation', used: 420, total: 2000, pct: 21, color: 'linear-gradient(90deg,#5b6cf9,#818cf8)' },
          { label: 'AI Image generation', used: 180, total: 2000, pct: 9, color: 'linear-gradient(90deg,#10b981,#34d399)' },
          { label: 'Video generation', used: 60, total: 2000, pct: 3, color: 'linear-gradient(90deg,#f59e0b,#fcd34d)' },
        ].map((b) => (
          <div key={b.label}>
            <div className="flex justify-between text-[11px] text-gray-500 mb-1">
              <span>{b.label}</span>
              <span>{b.used} used</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full dw-progress"
                style={{ width: `${b.pct}%`, background: b.color }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 mt-4 text-[12px] text-gray-500 px-2.5 py-2.5 bg-[rgba(91,108,249,.08)] rounded-xl">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.93 2.93l1.42 1.42M9.65 9.65l1.42 1.42M2.93 11.07l1.42-1.42M9.65 4.35l1.42-1.42" stroke="#5b6cf9" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span>Credits auto-refill on June 1 · <strong className="text-[#0a0a0b]">+2,000 AI credits</strong></span>
      </div>
    </div>
  );
}

// ── Comparison table ──────────────────────────────────────────────────────────

const TABLE_ROWS = [
  { section: 'Content Creation' },
  { label: 'AI text generation', vals: ['200/mo', '2,000/mo', 'Unlimited'] },
  { label: 'AI image generation', vals: ['—', '✓', '✓'] },
  { label: 'AI video generation', vals: ['—', '—', '✓'] },
  { label: 'Custom brand voice', vals: ['—', '✓', '✓'] },
  { section: 'Publishing' },
  { label: 'Social accounts', vals: ['3', '10', 'Unlimited'] },
  { label: 'Platforms supported', vals: ['6', '6', '6'] },
  { label: 'Content calendar', vals: ['✓', '✓', '✓'] },
  { label: 'Bulk scheduling', vals: ['—', '✓', '✓'] },
  { label: 'Auto-republish', vals: ['—', '✓', '✓'] },
  { section: 'Design & Studio' },
  { label: 'Card templates', vals: ['20+', '200+', 'All'] },
  { label: 'Custom templates', vals: ['—', '✓', '✓'] },
  { label: 'White-label export', vals: ['—', '—', '✓'] },
  { section: 'Analytics' },
  { label: 'Performance dashboard', vals: ['Basic', 'Advanced', 'Full suite'] },
  { label: 'Audience insights', vals: ['—', '✓', '✓'] },
  { label: 'Competitor benchmarks', vals: ['—', '—', '✓'] },
  { section: 'Collaboration' },
  { label: 'Team seats', vals: ['1', '3', 'Unlimited'] },
  { label: 'Client workspaces', vals: ['—', '—', '✓'] },
  { label: 'API access', vals: ['—', '—', '✓'] },
];

function CompareTable({ onCta }: { onCta: () => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth: 640 }}>
        <thead>
          <tr className="border-b-2 border-gray-100">
            <th className="p-4 text-[13px] font-bold text-gray-500 text-left" style={{ width: '40%' }}>Features</th>
            <th className="p-4 text-[13px] font-bold text-gray-500 text-center">Starter</th>
            <th className="p-4 text-[13px] font-bold text-[#5b6cf9] text-center bg-[rgba(91,108,249,.04)]">Growth</th>
            <th className="p-4 text-[13px] font-bold text-gray-500 text-center">Scale</th>
          </tr>
        </thead>
        <tbody>
          {TABLE_ROWS.map((row, i) =>
            'section' in row ? (
              <tr key={i}>
                <td colSpan={4} className="px-4 pt-6 pb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">
                  {row.section}
                </td>
              </tr>
            ) : (
              <tr key={i} className="border-b border-gray-50 last:border-b-0">
                <td className="px-4 py-3.5 text-[14px] text-gray-700">{row.label}</td>
                {row.vals?.map((v, j) => (
                  <td key={j} className={`px-4 py-3.5 text-center ${j === 1 ? 'bg-[rgba(91,108,249,.03)]' : ''}`}>
                    {v === '✓' ? (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ margin: '0 auto', display: 'block' }}>
                        <circle cx="8" cy="8" r="7" fill="rgba(91,108,249,.1)" />
                        <path d="M5 8L7 10.5L11 5.5" stroke="#5b6cf9" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : v === '—' ? (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ margin: '0 auto', display: 'block' }}>
                        <circle cx="7" cy="7" r="6" fill="#f3f4f6" />
                        <path d="M4.5 7h5" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <span className="text-[13px] text-gray-600">{v}</span>
                    )}
                  </td>
                ))}
              </tr>
            ),
          )}
          <tr>
            <td />
            {['Starter', 'Growth', 'Scale'].map((n, j) => (
              <td key={j} className="px-4 pt-5">
                <button
                  type="button"
                  onClick={onCta}
                  className="w-full flex items-center justify-center gap-1.5 text-[13px] font-bold py-2.5 px-3.5 rounded-xl border-none cursor-pointer transition-opacity hover:opacity-90"
                  style={{ background: j === 1 ? '#5b6cf9' : '#0a0a0b', color: '#fff' }}
                >
                  {n === 'Starter' ? 'Get started free' : `Try ${n}`}
                </button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── FAQ ───────────────────────────────────────────────────────────────────────

const FAQS = [
  { q: 'What are AI credits and how do they work?', a: 'Credits are the currency for AI-powered actions on Dakyworld Hub. Generating a text post costs 1 credit, an AI image costs 5 credits, and an AI video clip costs 20 credits. Credits refresh every billing cycle so unused credits don\'t carry over.' },
  { q: 'Can I change or cancel my plan at any time?', a: 'Yes — upgrade, downgrade, or cancel anytime from your account settings. Upgrades take effect immediately. Downgrades apply at the end of your current billing cycle. No cancellation fees.' },
  { q: 'Is there a free trial for paid plans?', a: 'Every paid plan includes a 7-day free trial with full feature access. No credit card required to start. If you decide not to continue, just cancel before day 7.' },
  { q: 'What social platforms do you support?', a: 'We currently support Instagram, LinkedIn, X (Twitter), Facebook, TikTok, and YouTube. We\'re actively adding more platforms based on user demand.' },
  { q: 'Do you offer discounts for agencies or nonprofits?', a: 'Yes — we offer volume discounts for agencies managing 5+ client workspaces and special pricing for registered nonprofits. Email us at hello@dakyworld.com.' },
  { q: 'Is my data secure?', a: 'All data is encrypted in transit (TLS 1.3) and at rest (AES-256). We never sell your data or use your content to train AI models. We are SOC 2 Type II compliant.' },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gray-100">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 py-5 cursor-pointer bg-transparent border-none text-left"
        onClick={() => setOpen((p) => !p)}
      >
        <span className="text-[16px] font-bold text-[#0a0a0b] leading-snug">{q}</span>
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[16px] font-light transition-all"
          style={{
            background: open ? 'rgba(91,108,249,.08)' : '#f9fafb',
            border: open ? '1px solid #c7d0fe' : '1px solid #e5e7eb',
            color: open ? '#5b6cf9' : '#6b7280',
            transform: open ? 'rotate(45deg)' : 'none',
          }}
        >+</span>
      </button>
      <div
        className="overflow-hidden transition-all duration-300"
        style={{ maxHeight: open ? 300 : 0, opacity: open ? 1 : 0, paddingBottom: open ? 22 : 0 }}
      >
        <p className="text-[15px] text-gray-500 leading-[1.75] m-0">{a}</p>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

type Props = { onLoginClick: () => void };

export default function PublicPricing({ onLoginClick }: Props) {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const heroRef = useRef<HTMLElement>(null);

  useEffect(() => {
    pricingService
      .getPlans()
      .then((data) => {
        const active = data.filter((p) => p.isActive && p.billingPeriod === cycle).sort((a, b) => a.price - b.price);
        setPlans(active.length >= 2 ? active : FALLBACK);
      })
      .catch(() => setPlans(FALLBACK))
      .finally(() => setLoading(false));
  }, [cycle]);

  useHeroAnim(heroRef);
  useAnimations();

  return (
    <div className="bg-white text-[#0a0a0b] overflow-x-hidden font-sans">
      <PublicNav onLoginClick={onLoginClick} activePath="/pricing" />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden text-center pt-36 pb-20"
        ref={heroRef}
      >
        {/* Glow */}
        <div
          className="absolute pointer-events-none rounded-full"
          style={{
            top: -60, left: '50%', transform: 'translateX(-50%)',
            width: 800, height: 400,
            background: 'radial-gradient(circle, rgba(91,108,249,.1) 0%, transparent 65%)',
          }}
        />
        {/* Dots */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[.22]"
          style={{
            backgroundImage: 'radial-gradient(#c7d0fe 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            maskImage: 'radial-gradient(ellipse 80% 70% at 50% 30%, black 30%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 50% 30%, black 30%, transparent 100%)',
          }}
        />

        <div className="max-w-[1160px] mx-auto px-6 relative">
          <div className="pp-hero-badge inline-flex items-center gap-2 border border-[#c7d0fe] bg-[#eef0fe] rounded-full px-4 py-1.5 text-[12.5px] font-semibold text-[#5b6cf9] mb-7">
            <span className="w-1.5 h-1.5 rounded-full bg-[#5b6cf9]" />
            Simple, transparent pricing
          </div>

          <h1
            className="pp-hero-h1 font-black tracking-tight text-[#0a0a0b] mb-6"
            style={{ fontSize: 'clamp(40px, 5vw, 72px)', letterSpacing: '-0.045em', lineHeight: 1.02 }}
          >
            Pricing that grows<br />
            <span className="bg-gradient-to-r from-[#5b6cf9] to-violet-500 bg-clip-text text-transparent">
              with your brand.
            </span>
          </h1>

          <p className="pp-hero-sub text-[17px] text-gray-500 leading-[1.7] max-w-[500px] mx-auto mb-10">
            Start free with 200 AI credits. Upgrade when you need more power. No hidden fees, ever.
          </p>

          {/* Toggle */}
          <div className="pp-hero-toggle flex flex-col items-center gap-2.5">
            <div className="inline-flex bg-gray-50 border border-gray-100 rounded-xl p-1">
              {(['monthly', 'yearly'] as BillingCycle[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[14px] font-semibold cursor-pointer border-none transition-all"
                  style={{
                    background: cycle === c ? '#fff' : 'transparent',
                    color: cycle === c ? '#0a0a0b' : '#6b7280',
                    boxShadow: cycle === c ? '0 1px 6px rgba(0,0,0,.08)' : 'none',
                  }}
                  onClick={() => setCycle(c)}
                >
                  {c === 'monthly' ? 'Monthly' : 'Yearly'}
                  {c === 'yearly' && (
                    <span className="bg-emerald-100 text-emerald-700 text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full">−20%</span>
                  )}
                </button>
              ))}
            </div>
            <p className="text-[12px] text-gray-400">
              {cycle === 'yearly' ? '✓ Annual billing — saving ~20% per year' : 'Switch to annual and save ~20%'}
            </p>
          </div>
        </div>
      </section>

      {/* ── Plans ──────────────────────────────────────────────────────── */}
      <div className="max-w-[1160px] mx-auto px-6">
        {loading ? (
          <div className="text-center py-20 text-gray-400 text-[14px]">Loading plans…</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-14" data-pp="stagger">
            {plans.map((p) => (
              <PlanCard key={p.id} plan={p} cycle={cycle} onCta={onLoginClick} />
            ))}
          </div>
        )}
        <p className="text-center text-[12px] text-gray-400 mt-5">
          Prices in USD. Billed securely via Stripe. Taxes may apply.
        </p>
      </div>

      {/* ── Social proof ────────────────────────────────────────────────── */}
      <div className="max-w-[1160px] mx-auto px-6">
        <div
          className="flex items-center justify-center gap-8 py-8 flex-wrap border-t border-b border-gray-100 my-16"
          data-pp="stagger"
        >
          {[
            { v: '12,000+', l: 'Brands & creators' },
            { v: '4.8 / 5', l: 'Average rating' },
            { v: '$0', l: 'Setup cost' },
            { v: '24/7', l: 'Support' },
          ].map((s) => (
            <div key={s.l} className="flex flex-col items-center gap-1">
              <div className="text-[26px] font-black tracking-tight text-[#0a0a0b]">{s.v}</div>
              <div className="text-[12px] text-gray-400 font-medium">{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Credits explainer ─────────────────────────────────────────────── */}
      <div className="max-w-[1160px] mx-auto px-6 py-24">
        <div
          className="relative overflow-hidden rounded-[28px] p-14"
          style={{ background: '#f9fafb' }}
          data-pp="fade"
        >
          {/* Glow */}
          <div
            className="absolute pointer-events-none rounded-full"
            style={{ top: -80, right: -80, width: 360, height: 360, background: 'radial-gradient(circle, rgba(91,108,249,.1) 0%, transparent 65%)' }}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center relative">
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-widest text-[#5b6cf9] mb-3.5">
                <span className="w-1 h-1 rounded-full bg-[#5b6cf9]" />Credit system
              </div>
              <h2
                className="font-black tracking-tight text-[#0a0a0b] mb-4"
                style={{ fontSize: 'clamp(26px, 3.2vw, 44px)', letterSpacing: '-0.04em', lineHeight: 1.08 }}
              >
                One credit. Endless possibilities.
              </h2>
              <p className="text-[16px] leading-[1.7] text-gray-500 mb-7">
                Credits are spent when you use AI features. Every plan comes with a monthly credit allowance that auto-refills on your billing date.
              </p>
              <div className="flex flex-col gap-3.5">
                {[
                  { ico: '✍️', bg: '#eef0fe', label: 'AI text post', hint: 'LinkedIn, Twitter, Instagram caption…', cost: '1 cr' },
                  { ico: '🖼️', bg: '#fdf4ff', label: 'AI image generation', hint: 'Custom graphics, banners, thumbnails…', cost: '5 cr' },
                  { ico: '🎬', bg: '#fff7ed', label: 'AI short video', hint: 'Reels, TikTok, YouTube Shorts clips…', cost: '20 cr' },
                ].map((c) => (
                  <div key={c.label} className="flex items-center gap-3.5 px-4 py-3.5 bg-white border border-gray-100 rounded-2xl">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-[17px] flex-shrink-0" style={{ background: c.bg }}>{c.ico}</div>
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold text-[#0a0a0b] mb-0.5">{c.label}</div>
                      <div className="text-[12px] text-gray-400">{c.hint}</div>
                    </div>
                    <div className="text-[22px] font-black tracking-tight text-[#5b6cf9] min-w-[52px] text-right">{c.cost}</div>
                  </div>
                ))}
              </div>
            </div>
            <CreditMeter />
          </div>
        </div>
      </div>

      {/* ── Compare table ─────────────────────────────────────────────────── */}
      <div className="max-w-[1160px] mx-auto px-6 pb-24">
        <div className="text-center mb-12" data-pp="fade">
          <div className="inline-flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-widest text-[#5b6cf9] mb-3 justify-center">
            <span className="w-1 h-1 rounded-full bg-[#5b6cf9]" />Full comparison
          </div>
          <h2
            className="font-black tracking-tight text-[#0a0a0b] mb-3 text-center"
            style={{ fontSize: 'clamp(26px, 3.2vw, 44px)', letterSpacing: '-0.04em', lineHeight: 1.08 }}
          >
            Everything in one table.
          </h2>
          <p className="text-[16px] leading-[1.7] text-gray-500 text-center max-w-[480px] mx-auto">
            Not sure which plan fits? Here's every feature side by side.
          </p>
        </div>
        <div data-pp="fade">
          <CompareTable onCta={onLoginClick} />
        </div>
      </div>

      {/* ── FAQ ───────────────────────────────────────────────────────────── */}
      <div className="max-w-[760px] mx-auto px-6 pb-24">
        <div className="text-center mb-12" data-pp="fade">
          <div className="inline-flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-widest text-[#5b6cf9] mb-3 justify-center">
            <span className="w-1 h-1 rounded-full bg-[#5b6cf9]" />FAQ
          </div>
          <h2
            className="font-black tracking-tight text-[#0a0a0b] text-center"
            style={{ fontSize: 'clamp(26px, 3.2vw, 44px)', letterSpacing: '-0.04em', lineHeight: 1.08 }}
          >
            Questions? Answered.
          </h2>
        </div>
        <div data-pp="stagger">
          {FAQS.map((f, i) => <FaqItem key={i} q={f.q} a={f.a} />)}
        </div>
      </div>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <div className="max-w-[1160px] mx-auto px-6 pb-20">
        <div
          className="relative overflow-hidden bg-[#0a0a0b] rounded-[28px] py-[72px] px-14 text-center"
          data-pp="fade"
        >
          {/* Orbs */}
          <div className="absolute pointer-events-none rounded-full" style={{ top: -80, right: -60, width: 400, height: 400, background: 'radial-gradient(circle, rgba(91,108,249,.25) 0%, transparent 65%)' }} />
          <div className="absolute pointer-events-none rounded-full" style={{ bottom: -80, left: -60, width: 300, height: 300, background: 'radial-gradient(circle, rgba(91,108,249,.15) 0%, transparent 65%)' }} />
          <div className="relative">
            <h2
              className="font-black tracking-tight text-white mb-4"
              style={{ fontSize: 'clamp(32px, 4vw, 56px)', letterSpacing: '-0.04em', lineHeight: 1.06 }}
            >
              Start building your<br />audience today.
            </h2>
            <p className="text-[16px] text-white/45 max-w-[440px] mx-auto mb-9 leading-[1.65]">
              Free plan available. No credit card required. Upgrade when you're ready to scale.
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap mb-5">
              <button
                type="button"
                className="inline-flex items-center gap-2 bg-[#5b6cf9] text-white text-[15px] font-bold px-6 py-3.5 rounded-xl border-none cursor-pointer transition-all hover:-translate-y-0.5 hover:bg-[#4f5de6]"
                style={{ boxShadow: '0 4px 18px rgba(91,108,249,.35)' }}
                onClick={onLoginClick}
              >
                Get started free <Arr />
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 bg-transparent text-white/60 text-[15px] font-semibold px-5 py-3.5 rounded-xl cursor-pointer transition-all hover:border-white/30 hover:text-white"
                style={{ border: '1.5px solid rgba(255,255,255,.15)' }}
                onClick={onLoginClick}
              >
                Talk to sales
              </button>
            </div>
            <div className="flex items-center justify-center gap-6 flex-wrap">
              {['Free plan forever', '7-day trial on paid plans', 'Cancel anytime'].map((t) => (
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
