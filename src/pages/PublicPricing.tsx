import { useEffect, useState } from 'react';
import { ArrowRight, Check, Tag } from 'lucide-react';
import { pricingService } from '../services/pricingService';
import { PricingPlan } from '../types/pricing';
import PublicNav from '../components/landing/PublicNav';
import PublicFooter from '../components/landing/PublicFooter';

type BillingCycle = 'monthly' | 'yearly';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(price: number) {
  if (price === 0) return 'Free';
  return `$${price.toFixed(0)}`;
}

function discountedPrice(price: number, pct: number) {
  return price * (1 - pct / 100);
}

// ─── Plan card ────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  cycle,
  onGetStarted,
}: {
  plan: PricingPlan;
  cycle: BillingCycle;
  onGetStarted: () => void;
}) {
  const isFree = plan.price === 0;
  const yearlyDiscount = cycle === 'yearly' && !isFree;
  const hasDiscount = (plan.discountPercentage ?? 0) > 0;
  const finalPrice = hasDiscount ? discountedPrice(plan.price, plan.discountPercentage) : plan.price;

  const isFeatured = plan.name.toLowerCase().includes('pro') || plan.name.toLowerCase().includes('business');

  return (
    <div
      className={`relative flex flex-col rounded-3xl border p-8 transition-all duration-300 ${
        isFeatured
          ? 'border-[#e6332a] bg-[#e6332a] text-white shadow-xl shadow-red-100'
          : 'border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-md'
      }`}
    >
      {/* Sale badge (takes priority over "Most popular") */}
      {plan.isOnSale ? (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-1 text-xs font-bold uppercase tracking-widest text-white whitespace-nowrap">
            <Tag size={10} />
            On Sale
          </div>
        </div>
      ) : isFeatured ? (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-1 text-xs font-bold uppercase tracking-widest text-white whitespace-nowrap">
          Most popular
        </div>
      ) : null}

      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h3 className={`text-lg font-black tracking-[-0.02em] mb-1 ${isFeatured ? 'text-white' : 'text-zinc-900'}`}>
            {plan.name}
          </h3>
          <p className={`text-sm leading-relaxed ${isFeatured ? 'text-white/70' : 'text-zinc-500'}`}>
            {plan.description}
          </p>
        </div>
        {hasDiscount && (
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${isFeatured ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700'}`}>
            -{Math.round(plan.discountPercentage)}%
          </span>
        )}
      </div>

      <div className="mb-6">
        {hasDiscount ? (
          <>
            <div className={`text-sm line-through mb-0.5 ${isFeatured ? 'text-white/50' : 'text-zinc-400'}`}>
              {formatPrice(plan.price)} / {cycle === 'monthly' ? 'mo' : 'yr'}
            </div>
            <div className="flex items-end gap-1.5">
              <span className={`text-5xl font-black tracking-[-0.04em] ${isFeatured ? 'text-white' : 'text-zinc-900'}`}>
                ${finalPrice.toFixed(0)}
              </span>
              <span className={`text-sm mb-1 ${isFeatured ? 'text-white/60' : 'text-zinc-400'}`}>
                / {cycle === 'monthly' ? 'mo' : 'yr'}
              </span>
            </div>
          </>
        ) : (
          <>
            <span className={`text-5xl font-black tracking-[-0.04em] ${isFeatured ? 'text-white' : 'text-zinc-900'}`}>
              {formatPrice(plan.price)}
            </span>
            {!isFree && (
              <span className={`text-sm ml-1.5 ${isFeatured ? 'text-white/60' : 'text-zinc-400'}`}>
                / {cycle === 'monthly' ? 'mo' : 'yr'}
              </span>
            )}
          </>
        )}
        {yearlyDiscount && !hasDiscount && (
          <div className="mt-1 text-xs font-semibold text-emerald-400">Save ~20% vs monthly</div>
        )}
      </div>

      <ul className="flex-1 flex flex-col gap-3 mb-8">
        {plan.features.map((f, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            <Check
              size={16}
              className={`mt-0.5 shrink-0 ${isFeatured ? 'text-white' : 'text-[#e6332a]'}`}
            />
            <span className={isFeatured ? 'text-white/80' : 'text-zinc-600'}>
              {f}
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onGetStarted}
        className={`group w-full flex items-center justify-center gap-2 font-bold py-3.5 rounded-2xl text-sm transition-colors ${
          isFeatured
            ? 'bg-white text-[#e6332a] hover:bg-zinc-50'
            : 'bg-[#e6332a] text-white hover:bg-[#cc2921]'
        }`}
      >
        {isFree ? 'Get started free' : 'Get started'}
        <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
      </button>
    </div>
  );
}

// ─── Fallback plans ───────────────────────────────────────────────────────────

const FALLBACK_PLANS: PricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'Perfect for individuals getting started with social media management.',
    price: 0,
    billingPeriod: 'monthly',
    features: ['3 social accounts', '10 scheduled posts/month', 'Basic analytics', 'Card templates'],
    isActive: true,
    discountPercentage: 0,
    isOnSale: false,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For creators and small teams that need full publishing power.',
    price: 19,
    billingPeriod: 'monthly',
    features: [
      'Unlimited social accounts',
      'Unlimited scheduled posts',
      'Advanced analytics',
      'Custom card templates',
      'Priority support',
    ],
    isActive: true,
    discountPercentage: 0,
    isOnSale: false,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'business',
    name: 'Business',
    description: 'For agencies and brands managing multiple clients and workflows.',
    price: 49,
    billingPeriod: 'monthly',
    features: [
      'Everything in Pro',
      'Team collaboration',
      'Client workspaces',
      'API access',
      'Custom integrations',
      'Dedicated support',
    ],
    isActive: true,
    discountPercentage: 0,
    isOnSale: false,
    createdAt: '',
    updatedAt: '',
  },
];

// ─── FAQ ──────────────────────────────────────────────────────────────────────

const FAQ = [
  {
    q: 'Can I change plans at any time?',
    a: 'Yes. You can upgrade or downgrade your plan at any time from your account settings. Changes take effect at the next billing cycle.',
  },
  {
    q: 'Is there a free trial?',
    a: 'Our Free plan gives you full access to core features with no credit card required. Upgrade when you need more.',
  },
  {
    q: 'What payment methods do you accept?',
    a: 'We accept all major credit and debit cards through Stripe. All payments are secure and encrypted.',
  },
  {
    q: 'Do you offer refunds?',
    a: 'We offer a 7-day refund policy on all paid plans. Contact support@dakyworld.com within 7 days of your purchase.',
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-zinc-100 py-5">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center justify-between text-left gap-4"
      >
        <span className="text-sm font-bold text-zinc-900">{q}</span>
        <span className={`text-xl font-light text-zinc-400 transition-transform duration-200 ${open ? 'rotate-45' : ''}`}>+</span>
      </button>
      {open && <p className="mt-3 text-sm text-zinc-500 leading-relaxed">{a}</p>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type PublicPricingProps = {
  onLoginClick: () => void;
};

export default function PublicPricing({ onLoginClick }: PublicPricingProps) {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    pricingService
      .getPlans()
      .then((data) => {
        const active = data.filter((p) => p.isActive && p.billingPeriod === cycle).sort((a, b) => a.price - b.price);
        setPlans(active.length > 0 ? active : FALLBACK_PLANS);
      })
      .catch(() => setPlans(FALLBACK_PLANS))
      .finally(() => setLoading(false));
  }, [cycle]);

  return (
    <div className="bg-white text-zinc-900 min-h-screen font-sans">
      <PublicNav onLoginClick={onLoginClick} activePath="/pricing" />

      {/* ── Hero ── */}
      <section className="relative flex flex-col items-center justify-center px-6 pt-36 pb-12 text-center overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-red-50/70 via-white to-white" />

        <div className="relative mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-500 shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-[#e6332a]" />
          Simple, transparent pricing
        </div>

        <h1 className="relative max-w-3xl text-5xl sm:text-6xl md:text-7xl font-black tracking-[-0.04em] leading-[0.95] mb-6">
          <span className="block text-zinc-900">Pricing that</span>
          <span className="block text-[#e6332a]">scales with you.</span>
        </h1>

        <p className="relative max-w-lg text-base sm:text-lg text-zinc-500 leading-relaxed mb-10">
          Start free, upgrade when you're ready. No hidden fees. No surprises.
        </p>

        {/* Billing toggle */}
        <div className="relative flex flex-col items-center gap-2">
          <div className="flex items-center gap-1 rounded-2xl border-2 border-zinc-200 bg-zinc-100 p-1.5 shadow-inner">
            {(['monthly', 'yearly'] as BillingCycle[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCycle(c)}
                className={`flex min-w-[120px] items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all duration-200 ${
                  cycle === c
                    ? 'bg-white text-zinc-900 shadow-md'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                {c === 'monthly' ? 'Monthly' : 'Yearly'}
                {c === 'yearly' && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${cycle === 'yearly' ? 'bg-emerald-500 text-white' : 'bg-emerald-100 text-emerald-700'}`}>
                    −20%
                  </span>
                )}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-400">
            {cycle === 'yearly' ? '✓ Annual billing — saving ~20%' : 'Switch to annual to save ~20%'}
          </p>
        </div>
      </section>

      {/* ── Plans ── */}
      <section className="max-w-5xl mx-auto px-6 py-12 md:py-16">
        {loading ? (
          <div className="text-center py-20 text-zinc-400 text-sm">Loading plans…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {plans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} cycle={cycle} onGetStarted={onLoginClick} />
            ))}
          </div>
        )}

        <p className="text-center text-xs text-zinc-400 mt-8">
          All prices in USD. Payments processed securely by Stripe.
        </p>
      </section>

      {/* ── FAQ ── */}
      <section className="max-w-2xl mx-auto px-6 py-16 md:py-24">
        <h2 className="text-3xl font-black tracking-[-0.03em] text-zinc-900 mb-10 text-center">
          Frequently asked questions
        </h2>
        {FAQ.map((item, i) => (
          <FaqItem key={i} q={item.q} a={item.a} />
        ))}
      </section>

      {/* ── CTA Banner ── */}
      <section className="max-w-4xl mx-auto px-6 pb-24 md:pb-32 text-center">
        <div className="rounded-3xl border border-zinc-100 bg-zinc-50 p-12 md:p-16 relative overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-1 rounded-full bg-[#e6332a]" />
          <h2 className="text-3xl sm:text-4xl font-black tracking-[-0.03em] text-zinc-900 mb-4">
            Start building your audience today.
          </h2>
          <p className="text-zinc-500 text-base sm:text-lg mb-8 max-w-md mx-auto">
            Free plan available. No credit card required.
          </p>
          <button
            type="button"
            onClick={onLoginClick}
            className="group inline-flex items-center gap-2 bg-[#e6332a] hover:bg-[#cc2921] text-white font-bold px-8 py-4 rounded-2xl text-sm transition-colors shadow-md shadow-red-100"
          >
            Get started free
            <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
