import { useState, useEffect } from 'react';
import { Check, Sparkles, Tag, ArrowRight } from 'lucide-react';
import { pricingService } from '../services/pricingService';
import { PricingPlan } from '../types/pricing';

type BillingCycle = 'monthly' | 'yearly';

function discountedPrice(price: number, pct: number) {
  return price * (1 - pct / 100);
}

const Pricing = () => {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        const data = await pricingService.getPlans();
        const filtered = data
          .filter((p) => p.billingPeriod === billingCycle && p.isActive)
          .sort((a, b) => a.price - b.price);
        setPlans(filtered);
      } catch (error) {
        console.error('Failed to load pricing plans:', error);
      } finally {
        setIsLoading(false);
      }
    };
    void fetchPlans();
  }, [billingCycle]);

  return (
    <div className="space-y-8 pb-8">
      {/* ── Hero header ── */}
      <section className="rounded-[32px] border border-slate-200 bg-white px-6 py-10 md:px-10">
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-amber-700">
            <Sparkles size={14} />
            Pricing
          </div>
          <h1 className="mt-5 text-4xl font-black tracking-[-0.04em] text-slate-950 md:text-5xl">
            Plans built for every creator
          </h1>
          <p className="mt-4 text-base leading-7 text-slate-500">
            Choose the plan that fits how much content you publish, how many platforms you connect, and how much your team needs.
          </p>

          {/* ── Billing toggle ── */}
          <div className="mt-8 inline-flex flex-col items-center gap-2">
            <div className="relative flex rounded-2xl border-2 border-slate-200 bg-slate-100 p-1.5">
              {(['monthly', 'yearly'] as BillingCycle[]).map((cycle) => {
                const isActive = cycle === billingCycle;
                return (
                  <button
                    key={cycle}
                    type="button"
                    onClick={() => setBillingCycle(cycle)}
                    className={`relative flex min-w-[120px] items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all duration-200 ${
                      isActive
                        ? 'bg-slate-950 text-white shadow-md'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {cycle === 'monthly' ? 'Monthly' : 'Yearly'}
                    {cycle === 'yearly' && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide transition-colors ${
                          isActive ? 'bg-emerald-400 text-white' : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        −20%
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-400">
              {billingCycle === 'yearly'
                ? '✓ Annual billing active — saving up to 20%'
                : 'Switch to annual to save up to 20%'}
            </p>
          </div>
        </div>
      </section>

      {/* ── Plan cards ── */}
      <section className="grid gap-6 xl:grid-cols-3">
        {isLoading ? (
          <div className="col-span-full grid gap-6 xl:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-96 animate-pulse rounded-[30px] border border-slate-200 bg-slate-100" />
            ))}
          </div>
        ) : plans.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <p className="text-slate-600">No pricing plans available for this billing period.</p>
          </div>
        ) : (
          plans.map((plan) => {
            const basePlanName = plan.name.replace(/\s*\((Monthly|Yearly)\)/, '');
            const isFeatured = basePlanName === 'Growth' || basePlanName === 'Pro' || basePlanName === 'Business';
            const hasDiscount = (plan.discountPercentage ?? 0) > 0;
            const finalPrice = hasDiscount ? discountedPrice(plan.price, plan.discountPercentage) : plan.price;

            return (
              <article
                key={plan.id}
                className={`relative rounded-[30px] border p-6 md:p-8 transition-shadow hover:shadow-lg ${
                  isFeatured
                    ? 'border-slate-950 bg-slate-950 text-white'
                    : 'border-slate-200 bg-white text-slate-900'
                }`}
              >
                {/* Sale badge */}
                {plan.isOnSale && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <div className="flex items-center gap-1.5 rounded-full bg-[#e6332a] px-4 py-1 text-[11px] font-bold uppercase tracking-widest text-white shadow-lg shadow-red-200">
                      <Tag size={10} />
                      On Sale
                    </div>
                  </div>
                )}

                {/* Plan header */}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-black">{basePlanName}</h2>
                    <p className={`mt-2 text-sm leading-6 ${isFeatured ? 'text-slate-300' : 'text-slate-500'}`}>
                      {plan.description}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {isFeatured && !plan.isOnSale && !hasDiscount && (
                      <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-white">
                        Popular
                      </span>
                    )}
                    {hasDiscount && (
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${isFeatured ? 'bg-emerald-400/80 text-white' : 'bg-emerald-100 text-emerald-700'}`}>
                        -{Math.round(plan.discountPercentage)}% off
                      </span>
                    )}
                  </div>
                </div>

                {/* Price */}
                <div className="mt-8">
                  {hasDiscount ? (
                    <div className="flex flex-col gap-0.5">
                      <span className={`text-sm line-through ${isFeatured ? 'text-slate-500' : 'text-slate-400'}`}>
                        ${plan.price.toFixed(0)} / {plan.billingPeriod === 'monthly' ? 'mo' : 'yr'}
                      </span>
                      <div className="flex items-end gap-2">
                        <span className="text-5xl font-black tracking-[-0.04em]">
                          ${finalPrice.toFixed(0)}
                        </span>
                        <span className={`pb-1 text-sm font-medium ${isFeatured ? 'text-slate-300' : 'text-slate-500'}`}>
                          / {plan.billingPeriod === 'monthly' ? 'month' : 'year'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-end gap-2">
                      <span className="text-5xl font-black tracking-[-0.04em]">
                        {plan.price === 0 ? 'Free' : `$${plan.price}`}
                      </span>
                      {plan.price > 0 && (
                        <span className={`pb-1 text-sm font-medium ${isFeatured ? 'text-slate-300' : 'text-slate-500'}`}>
                          / {plan.billingPeriod === 'monthly' ? 'month' : 'year'}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* CTA button */}
                <button
                  type="button"
                  className={`group mt-7 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition-colors ${
                    isFeatured
                      ? 'bg-white text-slate-950 hover:bg-slate-100'
                      : 'bg-slate-950 text-white hover:bg-slate-800'
                  }`}
                >
                  {plan.price === 0 ? 'Get started free' : `Choose ${basePlanName}`}
                  <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                </button>

                {/* Features */}
                <ul className="mt-7 space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                          isFeatured ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-900'
                        }`}
                      >
                        <Check size={12} />
                      </span>
                      <span className={`text-sm leading-6 ${isFeatured ? 'text-slate-200' : 'text-slate-600'}`}>
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
};

export default Pricing;
