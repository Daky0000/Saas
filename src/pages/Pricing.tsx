import { useState, useEffect } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { pricingService } from '../services/pricingService';
import { PricingPlan } from '../types/pricing';

type BillingCycle = 'monthly' | 'yearly';

const Pricing = () => {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        const data = await pricingService.getPlans();
        // Filter by billing period and sort by price
        const filtered = data
          .filter((p) => p.billingPeriod === billingCycle)
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
      <section className="rounded-[32px] border border-slate-200 bg-white px-6 py-8 md:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700">
            <Sparkles size={16} />
            Pricing
          </div>
          <h1 className="mt-5 text-4xl font-black tracking-[-0.04em] text-slate-950 md:text-5xl">
            Plans built around content, cards, integrations, and analytics
          </h1>
          <p className="mt-4 text-base leading-7 text-slate-500">
            Choose the plan that fits how much content you publish, how many tools you connect, and how much collaboration your team needs.
          </p>

          <div className="mt-8 inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
            {(['monthly', 'yearly'] as BillingCycle[]).map((cycle) => {
              const isActive = cycle === billingCycle;
              return (
                <button
                  key={cycle}
                  type="button"
                  onClick={() => setBillingCycle(cycle)}
                  className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors ${
                    isActive ? 'bg-slate-950 text-white' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {cycle === 'monthly' ? 'Monthly' : 'Annual'}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        {isLoading ? (
          <div className="col-span-full flex justify-center py-8">
            <p className="text-slate-600">Loading pricing plans...</p>
          </div>
        ) : plans.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <p className="text-slate-600">No pricing plans available</p>
          </div>
        ) : (
          plans.map((plan) => {
            // Extract base plan name (remove " (Monthly)" or " (Yearly)" suffix)
            const basePlanName = plan.name.replace(/\s*\((Monthly|Yearly)\)/, '');
            const isFeatured = basePlanName === 'Growth';
            
            return (
              <article
                key={plan.id}
                className={`rounded-[30px] border p-6 md:p-7 ${
                  isFeatured
                    ? 'border-slate-950 bg-slate-950 text-white'
                    : 'border-slate-200 bg-white text-slate-900'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-black">{basePlanName}</h2>
                    <p className={`mt-3 text-sm leading-6 ${isFeatured ? 'text-slate-300' : 'text-slate-500'}`}>
                      {plan.description}
                    </p>
                  </div>
                  {isFeatured && (
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-white">
                      Popular
                    </span>
                  )}
                </div>

                <div className="mt-8 flex items-end gap-2">
                  <span className="text-5xl font-black tracking-[-0.04em]">${plan.price}</span>
                  <span className={`pb-1 text-sm font-medium ${isFeatured ? 'text-slate-300' : 'text-slate-500'}`}>
                    / {plan.billingPeriod === 'monthly' ? 'month' : 'year'}
                  </span>
                </div>

                <button
                  type="button"
                  className={`mt-7 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition-colors ${
                    isFeatured
                      ? 'bg-white text-slate-950 hover:bg-slate-100'
                      : 'bg-slate-950 text-white hover:bg-slate-800'
                  }`}
                >
                  {isFeatured ? 'Choose Growth' : basePlanName === 'Starter' ? 'Start Starter' : 'Go Scale'}
                </button>

                <ul className="mt-7 space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full ${
                          isFeatured ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-900'
                        }`}
                      >
                        <Check size={13} />
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
