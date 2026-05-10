import { useEffect, useRef, useState, type RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { pricingService } from '../services/pricingService';
import { PricingPlan } from '../types/pricing';
import PublicNav from '../components/landing/PublicNav';
import PublicFooter from '../components/landing/PublicFooter';

gsap.registerPlugin(ScrollTrigger);

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
.pp{--a:#5b6cf9;--as:rgba(91,108,249,.08);--ag:rgba(91,108,249,.22);--ink:#0a0a0b;--ink2:#374151;--ink3:#6b7280;--ink4:#9ca3af;--b:#e5e7eb;--bg2:#f9fafb;
  font-family:'Inter',system-ui,-apple-system,sans-serif;background:#fff;color:var(--ink);overflow-x:hidden}
.pp-w{max-width:1160px;margin:0 auto;padding:0 32px}
@media(max-width:640px){.pp-w{padding:0 20px}}
.pp-sec{padding:96px 0}
@media(max-width:768px){.pp-sec{padding:60px 0}}

/* Hero */
.pp-hero{padding:140px 0 80px;text-align:center;position:relative;overflow:hidden}
.pp-hero-g{position:absolute;top:-60px;left:50%;transform:translateX(-50%);width:800px;height:400px;border-radius:50%;background:radial-gradient(circle,rgba(91,108,249,.1) 0%,transparent 65%);pointer-events:none}
.pp-hero-dots{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(circle,#c7d0fe 1px,transparent 1px);background-size:28px 28px;opacity:.22;mask-image:radial-gradient(ellipse 80% 70% at 50% 30%,black 30%,transparent 100%)}
.pp-badge{display:inline-flex;align-items:center;gap:8px;border:1px solid #c7d0fe;background:#eef0fe;border-radius:999px;padding:6px 16px 6px 12px;font-size:12.5px;font-weight:600;color:var(--a);margin-bottom:28px}
.pp-dot{width:6px;height:6px;border-radius:50%;background:var(--a)}
.pp-h1{font-size:clamp(40px,5vw,72px);font-weight:900;line-height:1.02;letter-spacing:-.045em;color:var(--ink);margin:0 0 22px}
.pp-accent{background:linear-gradient(135deg,#5b6cf9 0%,#818cf8 50%,#a78bfa 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.pp-sub{font-size:17px;color:var(--ink3);line-height:1.7;max-width:500px;margin:0 auto 40px}
@media(max-width:640px){.pp-sub{font-size:15px}}

/* Toggle */
.pp-toggle{display:inline-flex;background:var(--bg2);border:1px solid var(--b);border-radius:14px;padding:5px}
.pp-tog-btn{display:flex;align-items:center;gap:7px;padding:9px 22px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:none;transition:all .2s;background:transparent;color:var(--ink3)}
.pp-tog-btn.active{background:#fff;color:var(--ink);box-shadow:0 1px 6px rgba(0,0,0,.08);border:1px solid var(--b)}
.pp-save-pill{display:inline-block;background:#dcfce7;color:#16a34a;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;padding:2px 8px;border-radius:999px}

/* Plans grid */
.pp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:56px}
@media(max-width:900px){.pp-grid{grid-template-columns:1fr;max-width:440px;margin-left:auto;margin-right:auto}}

/* Plan card */
.pp-card{border:1.5px solid var(--b);border-radius:22px;padding:30px;background:#fff;display:flex;flex-direction:column;transition:border-color .2s,box-shadow .2s,transform .2s;position:relative;will-change:transform}
.pp-card:hover{border-color:#c7d0fe;box-shadow:0 12px 40px rgba(91,108,249,.1);transform:translateY(-3px)}
.pp-card.pp-feat{border-color:var(--a);background:var(--ink)}
.pp-card.pp-feat:hover{border-color:#818cf8;box-shadow:0 12px 40px rgba(91,108,249,.25);transform:translateY(-4px)}
.pp-pop-tag{position:absolute;top:-14px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;padding:4px 14px;border-radius:999px;white-space:nowrap}
.pp-feat .pp-pop-tag{background:var(--a)}
.pp-plan-name{font-size:19px;font-weight:800;letter-spacing:-.02em;color:var(--ink);margin-bottom:5px}
.pp-feat .pp-plan-name{color:#fff}
.pp-plan-desc{font-size:13.5px;color:var(--ink3);line-height:1.6;margin-bottom:18px}
.pp-feat .pp-plan-desc{color:rgba(255,255,255,.45)}
.pp-credits{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--a);background:var(--as);border:1px solid rgba(91,108,249,.18);border-radius:8px;padding:5px 11px;margin-bottom:18px}
.pp-feat .pp-credits{background:rgba(91,108,249,.2);border-color:rgba(91,108,249,.3);color:#818cf8}
.pp-price{font-size:clamp(40px,4.5vw,52px);font-weight:900;letter-spacing:-.04em;color:var(--ink);line-height:1}
.pp-feat .pp-price{color:#fff}
.pp-period{font-size:14px;color:var(--ink4);margin-left:3px}
.pp-feat .pp-period{color:rgba(255,255,255,.4)}
.pp-orig{font-size:13px;color:var(--ink4);text-decoration:line-through;margin-bottom:2px}
.pp-feat .pp-orig{color:rgba(255,255,255,.3)}
.pp-save-note{font-size:12px;color:#16a34a;font-weight:600;margin-top:4px}
.pp-divider{height:1px;background:var(--b);margin:18px 0}
.pp-feat .pp-divider{background:rgba(255,255,255,.1)}
.pp-feats{list-style:none;padding:0;margin:0 0 24px;display:flex;flex-direction:column;gap:10px;flex:1}
.pp-feat-li{display:flex;align-items:flex-start;gap:9px;font-size:13.5px;color:var(--ink2);line-height:1.55}
.pp-feat .pp-feat-li{color:rgba(255,255,255,.7)}
.pp-chk{width:18px;height:18px;border-radius:5px;background:var(--as);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.pp-feat .pp-chk{background:rgba(91,108,249,.25)}
.pp-card-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:7px;font-size:14px;font-weight:700;padding:13px;border-radius:12px;border:none;cursor:pointer;transition:all .2s}
.pp-card:not(.pp-feat) .pp-card-btn{background:var(--ink);color:#fff}
.pp-card:not(.pp-feat) .pp-card-btn:hover{background:#1f2937;transform:translateY(-1px)}
.pp-feat .pp-card-btn{background:#fff;color:var(--a)}
.pp-feat .pp-card-btn:hover{background:#f0f1ff;transform:translateY(-1px)}
.pp-card-note{font-size:11.5px;color:var(--ink4);text-align:center;margin-top:10px}
.pp-feat .pp-card-note{color:rgba(255,255,255,.3)}

/* Credits explainer */
.pp-credits-sec{background:var(--bg2);border-radius:28px;padding:56px;position:relative;overflow:hidden}
@media(max-width:640px){.pp-credits-sec{padding:36px 22px}}
.pp-credits-g{position:absolute;top:-80px;right:-80px;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,rgba(91,108,249,.1) 0%,transparent 65%);pointer-events:none}
.pp-credits-grid{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center}
@media(max-width:900px){.pp-credits-grid{grid-template-columns:1fr;gap:36px}}
.pp-ey{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--a);margin-bottom:14px}
.pp-ey-dot{width:5px;height:5px;border-radius:50%;background:var(--a)}
.pp-h2{font-size:clamp(26px,3.2vw,44px);font-weight:900;letter-spacing:-.04em;line-height:1.08;color:var(--ink);margin:0 0 16px}
.pp-h2-sub{font-size:16px;line-height:1.7;color:var(--ink3)}
.pp-credit-list{display:flex;flex-direction:column;gap:14px;margin-top:28px}
.pp-credit-item{display:flex;align-items:center;gap:14px;padding:14px 16px;background:#fff;border:1px solid var(--b);border-radius:14px}
.pp-credit-ico{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
.pp-credit-cost{font-size:22px;font-weight:900;letter-spacing:-.03em;color:var(--a);min-width:52px;text-align:right}
.pp-credit-label{font-size:13px;font-weight:600;color:var(--ink);margin-bottom:2px}
.pp-credit-hint{font-size:12px;color:var(--ink4)}

/* Credit meter visual */
.pp-meter{background:#fff;border:1px solid var(--b);border-radius:20px;padding:24px}
.pp-meter-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px}
.pp-meter-plan{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--ink4)}
.pp-meter-val{font-size:32px;font-weight:900;letter-spacing:-.04em;color:var(--ink)}
.pp-meter-sub{font-size:12px;color:var(--ink4);margin-top:2px}
.pp-meter-bars{display:flex;flex-direction:column;gap:10px}
.pp-meter-bar-row{display:flex;flex-direction:column;gap:4px}
.pp-meter-bar-label{display:flex;justify-content:space-between;font-size:11px;color:var(--ink3)}
.pp-meter-track{height:8px;background:#f3f4f6;border-radius:999px;overflow:hidden}
.pp-meter-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--a),#818cf8)}
.pp-meter-fill.green{background:linear-gradient(90deg,#10b981,#34d399)}
.pp-meter-fill.amber{background:linear-gradient(90deg,#f59e0b,#fcd34d)}
.pp-meter-refill{display:flex;align-items:center;gap:6px;margin-top:16px;font-size:12px;color:var(--ink3);padding:10px;background:var(--as);border-radius:10px}

/* Comparison table */
.pp-tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.pp-tbl{width:100%;border-collapse:collapse;min-width:640px}
.pp-tbl thead tr{border-bottom:2px solid var(--b)}
.pp-tbl th{padding:16px 20px;font-size:13px;font-weight:700;color:var(--ink3);text-align:left}
.pp-tbl th:not(:first-child){text-align:center}
.pp-tbl th.pp-tbl-hi{color:var(--a);background:var(--as);border-radius:0}
.pp-tbl td{padding:14px 20px;font-size:14px;color:var(--ink2);border-bottom:1px solid #f3f4f6}
.pp-tbl td:not(:first-child){text-align:center}
.pp-tbl-section td{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--ink4);padding-top:24px;padding-bottom:8px;border-bottom:none}
.pp-tbl tr:last-child td{border-bottom:none}
.pp-tbl-hi td{background:rgba(91,108,249,.03)}
.pp-y{color:var(--a)}
.pp-n{color:#d1d5db}

/* FAQ */
.pp-faq-item{border-bottom:1px solid var(--b)}
.pp-faq-q{display:flex;width:100%;align-items:center;justify-content:space-between;gap:16px;padding:22px 0;cursor:pointer;background:transparent;border:none;text-align:left}
.pp-faq-qt{font-size:16px;font-weight:700;color:var(--ink);line-height:1.4}
.pp-faq-ico{width:28px;height:28px;border-radius:8px;background:var(--bg2);border:1px solid var(--b);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .2s,transform .2s;font-size:16px;color:var(--ink3);font-weight:300}
.pp-faq-item.open .pp-faq-ico{background:var(--as);border-color:#c7d0fe;color:var(--a);transform:rotate(45deg)}
.pp-faq-ans{font-size:15px;color:var(--ink3);line-height:1.75;max-height:0;overflow:hidden;transition:max-height .35s ease,opacity .3s;opacity:0}
.pp-faq-item.open .pp-faq-ans{max-height:300px;opacity:1;padding-bottom:22px}

/* CTA bottom */
.pp-cta{background:var(--ink);border-radius:28px;padding:72px 56px;text-align:center;position:relative;overflow:hidden}
@media(max-width:640px){.pp-cta{padding:48px 24px;border-radius:20px}}
.pp-cta-g1{position:absolute;top:-80px;right:-60px;width:400px;height:400px;border-radius:50%;background:radial-gradient(circle,rgba(91,108,249,.25) 0%,transparent 65%);pointer-events:none}
.pp-cta-g2{position:absolute;bottom:-80px;left:-60px;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(91,108,249,.15) 0%,transparent 65%);pointer-events:none}
.pp-cta-h{font-size:clamp(32px,4vw,56px);font-weight:900;letter-spacing:-.04em;color:#fff;line-height:1.06;margin:0 0 16px}
.pp-cta-sub{font-size:16px;color:rgba(255,255,255,.45);margin:0 auto 36px;max-width:440px;line-height:1.65}
.pp-cta-trust{display:flex;align-items:center;justify-content:center;gap:24px;margin-top:20px;flex-wrap:wrap}
.pp-cta-t{font-size:12.5px;color:rgba(255,255,255,.3)}
.pp-cta-t::before{content:'✓  ';color:rgba(91,108,249,.6)}
.pp-btn-p{display:inline-flex;align-items:center;gap:8px;background:var(--a);color:#fff;font-size:15px;font-weight:700;padding:14px 26px;border-radius:12px;border:none;cursor:pointer;transition:all .2s;box-shadow:0 4px 18px rgba(91,108,249,.35)}
.pp-btn-p:hover{background:#4f5de6;transform:translateY(-2px);box-shadow:0 8px 28px rgba(91,108,249,.45)}
.pp-btn-g{display:inline-flex;align-items:center;gap:8px;background:transparent;color:rgba(255,255,255,.6);font-size:15px;font-weight:600;padding:14px 22px;border-radius:12px;border:1.5px solid rgba(255,255,255,.15);cursor:pointer;transition:all .2s}
.pp-btn-g:hover{border-color:rgba(255,255,255,.3);color:#fff}
.pp-cta-btns{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap}

/* Proof bar */
.pp-proof{display:flex;align-items:center;justify-content:center;gap:32px;padding:32px 0;flex-wrap:wrap;border-top:1px solid var(--b);border-bottom:1px solid var(--b);margin:64px 0}
.pp-proof-item{display:flex;flex-direction:column;align-items:center;gap:4px}
.pp-proof-v{font-size:26px;font-weight:900;letter-spacing:-.04em;color:var(--ink)}
.pp-proof-l{font-size:12px;color:var(--ink4);font-weight:500}
@media(max-width:480px){.pp-proof{gap:20px}}

@keyframes pp-pulse{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes pp-bar{from{width:0}to{width:var(--tw)}}
.pp-anim-bar{animation:pp-bar 1s ease .3s both}
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

type BillingCycle = 'monthly' | 'yearly';

function fmt(price: number) {
  return price === 0 ? 'Free' : `$${Math.round(price)}`;
}

function Chk({ dark = false }) {
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
    id: 'starter',
    name: 'Starter',
    description: 'For creators and solo brands finding their content rhythm.',
    price: 0,
    billingPeriod: 'monthly',
    features: ['200 AI credits/month', '3 social accounts', 'AI text generation', 'Content calendar', 'Basic analytics', 'Card templates'],
    isActive: true,
    discountPercentage: 0,
    isOnSale: false,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'growth',
    name: 'Growth',
    description: 'For professionals and teams that publish across every channel.',
    price: 29,
    billingPeriod: 'monthly',
    features: ['2,000 AI credits/month', '10 social accounts', 'AI image generation', 'Custom brand voice', 'Advanced analytics', 'Priority support', 'Team workspace (3 seats)'],
    isActive: true,
    discountPercentage: 0,
    isOnSale: false,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'scale',
    name: 'Scale',
    description: 'For agencies and brands managing multiple clients at full velocity.',
    price: 79,
    billingPeriod: 'monthly',
    features: ['Unlimited AI credits', 'Unlimited accounts', 'AI video generation', 'White-label exports', 'Client workspaces', 'API access', 'Dedicated support', 'Custom integrations'],
    isActive: true,
    discountPercentage: 0,
    isOnSale: false,
    createdAt: '',
    updatedAt: '',
  },
];

const PLAN_CREDITS: Record<string, string> = {
  starter: '200 credits / mo',
  growth: '2,000 credits / mo',
  scale: 'Unlimited credits',
  free: '200 credits / mo',
  pro: '2,000 credits / mo',
  business: 'Unlimited credits',
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

// ── Plan card ─────────────────────────────────────────────────────────────────

function PlanCard({ plan, cycle, onCta }: { plan: PricingPlan; cycle: BillingCycle; onCta: () => void }) {
  const featured = isFeatured(plan);
  const isFree = plan.price === 0;
  const pct = plan.discountPercentage ?? 0;
  const yearlyMult = cycle === 'yearly' && !isFree ? 0.8 : 1;
  const finalPrice = pct > 0 ? plan.price * (1 - pct / 100) : plan.price * yearlyMult;
  const origPrice = plan.price;
  const showOrig = (pct > 0 || (cycle === 'yearly' && !isFree));

  return (
    <div className={`pp-card${featured ? ' pp-feat' : ''}`}>
      {featured && <div className="pp-pop-tag">Most popular</div>}
      {plan.isOnSale && !featured && (
        <div className="pp-pop-tag" style={{ background: '#f59e0b' }}>On Sale</div>
      )}

      <div className="pp-plan-name">{plan.name}</div>
      <div className="pp-plan-desc">{plan.description}</div>

      <div className="pp-credits">
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke={featured ? '#818cf8' : '#5b6cf9'} strokeWidth="1.5" /><path d="M7 4v3l2 2" stroke={featured ? '#818cf8' : '#5b6cf9'} strokeWidth="1.5" strokeLinecap="round" /></svg>
        {getCredits(plan)}
      </div>

      <div>
        {showOrig && (
          <div className="pp-orig">{fmt(origPrice)}<span style={{ fontSize: 12 }}>/{cycle === 'monthly' ? 'mo' : 'yr'}</span></div>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3 }}>
          <span className="pp-price">{isFree ? 'Free' : `$${Math.round(finalPrice)}`}</span>
          {!isFree && <span className="pp-period">/{cycle === 'monthly' ? 'mo' : 'yr'}</span>}
        </div>
        {cycle === 'yearly' && !isFree && pct === 0 && (
          <div className="pp-save-note">Save ~20% vs monthly</div>
        )}
        {pct > 0 && <div className="pp-save-note">Save {Math.round(pct)}%</div>}
      </div>

      <div className="pp-divider" />

      <ul className="pp-feats">
        {plan.features.map((f, i) => (
          <li key={i} className="pp-feat-li">
            <div className="pp-chk"><Chk dark={featured} /></div>
            {f}
          </li>
        ))}
      </ul>

      <button type="button" className="pp-card-btn" onClick={onCta}>
        {isFree ? 'Get started free' : 'Start 7-day trial'}
        <Arr />
      </button>
      <div className="pp-card-note">{isFree ? 'No credit card required' : 'Cancel anytime'}</div>
    </div>
  );
}

// ── Credit meter visual ───────────────────────────────────────────────────────

function CreditMeter() {
  return (
    <div className="pp-meter">
      <div className="pp-meter-top">
        <div>
          <div className="pp-meter-plan">Growth Plan</div>
          <div className="pp-meter-val">2,000</div>
          <div className="pp-meter-sub">credits remaining this month</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#9ca3af' }}>Renews in</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#0a0a0b' }}>18 days</div>
        </div>
      </div>
      <div className="pp-meter-bars">
        {[
          { label: 'AI Text generation', used: 420, total: 2000, pct: 21, cls: '' },
          { label: 'AI Image generation', used: 180, total: 2000, pct: 9, cls: 'green' },
          { label: 'Video generation', used: 60, total: 2000, pct: 3, cls: 'amber' },
        ].map((b) => (
          <div key={b.label} className="pp-meter-bar-row">
            <div className="pp-meter-bar-label">
              <span>{b.label}</span>
              <span>{b.used} used</span>
            </div>
            <div className="pp-meter-track">
              <div className={`pp-meter-fill${b.cls ? ' ' + b.cls : ''}`} style={{ width: `${b.pct}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="pp-meter-refill">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.93 2.93l1.42 1.42M9.65 9.65l1.42 1.42M2.93 11.07l1.42-1.42M9.65 4.35l1.42-1.42" stroke="#5b6cf9" strokeWidth="1.5" strokeLinecap="round" /></svg>
        <span>Credits auto-refill on June 1 · <strong style={{ color: '#0a0a0b' }}>+2,000 AI credits</strong></span>
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
    <div className="pp-tbl-wrap">
      <table className="pp-tbl">
        <thead>
          <tr>
            <th style={{ width: '40%' }}>Features</th>
            <th>Starter</th>
            <th className="pp-tbl-hi">Growth</th>
            <th>Scale</th>
          </tr>
        </thead>
        <tbody>
          {TABLE_ROWS.map((row, i) =>
            'section' in row ? (
              <tr key={i} className="pp-tbl-section">
                <td colSpan={4}>{row.section}</td>
              </tr>
            ) : (
              <tr key={i} className={row.vals?.[1] !== '—' && !row.vals?.[1]?.includes('Basic') ? 'pp-tbl-hi' : ''}>
                <td>{row.label}</td>
                {row.vals?.map((v, j) => (
                  <td key={j}>
                    {v === '✓' ? (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="pp-y" style={{ margin: '0 auto', display: 'block' }}>
                        <circle cx="8" cy="8" r="7" fill="rgba(91,108,249,.1)" />
                        <path d="M5 8L7 10.5L11 5.5" stroke="#5b6cf9" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : v === '—' ? (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="pp-n" style={{ margin: '0 auto', display: 'block' }}>
                        <circle cx="7" cy="7" r="6" fill="#f3f4f6" />
                        <path d="M4.5 7h5" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <span style={{ fontSize: 13 }}>{v}</span>
                    )}
                  </td>
                ))}
              </tr>
            ),
          )}
          <tr>
            <td />
            {['Starter', 'Growth', 'Scale'].map((n, j) => (
              <td key={j} style={{ paddingTop: 20 }}>
                <button
                  type="button"
                  onClick={onCta}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    background: j === 1 ? '#5b6cf9' : '#0a0a0b', color: '#fff',
                    fontSize: 13, fontWeight: 700, padding: '10px 14px', borderRadius: 10, border: 'none',
                    cursor: 'pointer', transition: 'opacity .2s',
                  }}
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
    <div className={`pp-faq-item${open ? ' open' : ''}`}>
      <button type="button" className="pp-faq-q" onClick={() => setOpen((p) => !p)}>
        <span className="pp-faq-qt">{q}</span>
        <span className="pp-faq-ico">+</span>
      </button>
      <div className="pp-faq-ans">{a}</div>
    </div>
  );
}

// ── Scroll animations ─────────────────────────────────────────────────────────

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

// ── Hero entrance ─────────────────────────────────────────────────────────────

function useHeroAnim(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!ref.current) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo('.pp-badge', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, 0.15)
        .fromTo('.pp-h1', { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7 }, 0.3)
        .fromTo('.pp-sub', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.48)
        .fromTo('.pp-toggle', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, 0.62);
    }, ref.current);
    return () => ctx.revert();
  }, [ref]);
}

// ── Main ──────────────────────────────────────────────────────────────────────

type Props = { onLoginClick: () => void };

export default function PublicPricing({ onLoginClick }: Props) {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const heroRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'pp-css';
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => { document.getElementById('pp-css')?.remove(); };
  }, []);

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
    <div className="pp">
      <PublicNav onLoginClick={onLoginClick} activePath="/pricing" />

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="pp-hero" ref={heroRef}>
        <div className="pp-hero-g" />
        <div className="pp-hero-dots" />
        <div className="pp-w" style={{ position: 'relative' }}>
          <div className="pp-badge">
            <span className="pp-dot" />
            Simple, transparent pricing
          </div>
          <h1 className="pp-h1">
            Pricing that grows<br />
            <span className="pp-accent">with your brand.</span>
          </h1>
          <p className="pp-sub">
            Start free with 200 AI credits. Upgrade when you need more power. No hidden fees, ever.
          </p>

          {/* Billing toggle */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div className="pp-toggle">
              {(['monthly', 'yearly'] as BillingCycle[]).map((c) => (
                <button key={c} type="button" className={`pp-tog-btn${cycle === c ? ' active' : ''}`} onClick={() => setCycle(c)}>
                  {c === 'monthly' ? 'Monthly' : 'Yearly'}
                  {c === 'yearly' && <span className="pp-save-pill">−20%</span>}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 12, color: '#9ca3af' }}>
              {cycle === 'yearly' ? '✓ Annual billing — saving ~20% per year' : 'Switch to annual and save ~20%'}
            </p>
          </div>
        </div>
      </section>

      {/* ── Plans ───────────────────────────────────────────────────── */}
      <div className="pp-w">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#9ca3af', fontSize: 14 }}>Loading plans…</div>
        ) : (
          <div className="pp-grid" data-pp="stagger">
            {plans.map((p) => (
              <PlanCard key={p.id} plan={p} cycle={cycle} onCta={onLoginClick} />
            ))}
          </div>
        )}
        <p style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af', marginTop: 20 }}>
          Prices in USD. Billed securely via Stripe. Taxes may apply.
        </p>
      </div>

      {/* ── Social proof bar ─────────────────────────────────────────── */}
      <div className="pp-w">
        <div className="pp-proof" data-pp="stagger">
          {[
            { v: '12,000+', l: 'Brands & creators' },
            { v: '4.8 / 5', l: 'Average rating' },
            { v: '$0', l: 'Setup cost' },
            { v: '24/7', l: 'Support' },
          ].map((s) => (
            <div key={s.l} className="pp-proof-item">
              <div className="pp-proof-v">{s.v}</div>
              <div className="pp-proof-l">{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Credits explainer ────────────────────────────────────────── */}
      <div className="pp-w pp-sec">
        <div className="pp-credits-sec" data-pp="fade">
          <div className="pp-credits-g" />
          <div className="pp-credits-grid">
            <div>
              <div className="pp-ey"><span className="pp-ey-dot" />Credit system</div>
              <h2 className="pp-h2">One credit. Endless possibilities.</h2>
              <p className="pp-h2-sub">Credits are spent when you use AI features. Every plan comes with a monthly credit allowance that auto-refills on your billing date.</p>
              <div className="pp-credit-list">
                {[
                  { ico: '✍️', bg: '#eef0fe', label: 'AI text post', hint: 'LinkedIn, Twitter, Instagram caption…', cost: '1 credit' },
                  { ico: '🖼️', bg: '#fdf4ff', label: 'AI image generation', hint: 'Custom graphics, banners, thumbnails…', cost: '5 credits' },
                  { ico: '🎬', bg: '#fff7ed', label: 'AI short video', hint: 'Reels, TikTok, YouTube Shorts clips…', cost: '20 credits' },
                ].map((c) => (
                  <div key={c.label} className="pp-credit-item">
                    <div className="pp-credit-ico" style={{ background: c.bg }}>{c.ico}</div>
                    <div style={{ flex: 1 }}>
                      <div className="pp-credit-label">{c.label}</div>
                      <div className="pp-credit-hint">{c.hint}</div>
                    </div>
                    <div className="pp-credit-cost">{c.cost}</div>
                  </div>
                ))}
              </div>
            </div>
            <CreditMeter />
          </div>
        </div>
      </div>

      {/* ── Compare table ────────────────────────────────────────────── */}
      <div className="pp-w pp-sec" style={{ paddingTop: 0 }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }} data-pp="fade">
          <div className="pp-ey" style={{ justifyContent: 'center' }}><span className="pp-ey-dot" />Full comparison</div>
          <h2 className="pp-h2" style={{ textAlign: 'center' }}>Everything in one table.</h2>
          <p className="pp-h2-sub" style={{ textAlign: 'center', margin: '0 auto' }}>Not sure which plan fits? Here's every feature side by side.</p>
        </div>
        <div data-pp="fade">
          <CompareTable onCta={onLoginClick} />
        </div>
      </div>

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
      <div className="pp-w pp-sec" style={{ paddingTop: 0, maxWidth: 760, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }} data-pp="fade">
          <div className="pp-ey" style={{ justifyContent: 'center' }}><span className="pp-ey-dot" />FAQ</div>
          <h2 className="pp-h2" style={{ textAlign: 'center' }}>Questions? Answered.</h2>
        </div>
        <div data-pp="stagger">
          {FAQS.map((f, i) => <FaqItem key={i} q={f.q} a={f.a} />)}
        </div>
      </div>

      {/* ── CTA ──────────────────────────────────────────────────────── */}
      <div className="pp-w" style={{ paddingBottom: 80 }}>
        <div className="pp-cta" data-pp="fade">
          <div className="pp-cta-g1" />
          <div className="pp-cta-g2" />
          <div style={{ position: 'relative' }}>
            <h2 className="pp-cta-h">
              Start building your<br />
              audience today.
            </h2>
            <p className="pp-cta-sub">
              Free plan available. No credit card required. Upgrade when you're ready to scale.
            </p>
            <div className="pp-cta-btns">
              <button type="button" className="pp-btn-p" onClick={onLoginClick}>
                Get started free <Arr />
              </button>
              <button type="button" className="pp-btn-g" onClick={onLoginClick}>
                Talk to sales
              </button>
            </div>
            <div className="pp-cta-trust">
              {['Free plan forever', '7-day trial on paid plans', 'Cancel anytime'].map((t) => (
                <span key={t} className="pp-cta-t">{t}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
