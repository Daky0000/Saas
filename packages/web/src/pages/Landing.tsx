import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import PublicNav from '../components/landing/PublicNav';
import PublicFooter from '../components/landing/PublicFooter';

gsap.registerPlugin(ScrollTrigger);

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
.dw{--a:#5b6cf9;--as:rgba(91,108,249,.08);--ag:rgba(91,108,249,.22);--ink:#0a0a0b;--ink2:#374151;--ink3:#6b7280;--ink4:#9ca3af;--b:#e5e7eb;--bg2:#f9fafb;
  font-family:'Inter',system-ui,-apple-system,sans-serif;background:#fff;color:var(--ink);overflow-x:hidden}

@keyframes dw-float  {0%,100%{transform:translateY(0)}  50%{transform:translateY(-10px)}}
@keyframes dw-float2 {0%,100%{transform:translateY(0)}  50%{transform:translateY(-6px)}}
@keyframes dw-pulse  {0%,100%{opacity:1}                50%{opacity:.3}}
@keyframes dw-glow   {0%,100%{opacity:.5}               50%{opacity:.9}}
@keyframes dw-marq   {from{transform:translateX(0)}     to{transform:translateX(-50%)}}
@keyframes dw-bar    {from{height:4px;opacity:0}        to{opacity:1}}
@keyframes dw-spin   {from{transform:rotate(0deg)}      to{transform:rotate(360deg)}}
@keyframes dw-prog   {from{width:0%}                    to{width:68%}}
@keyframes dw-shimmer{from{background-position:-200% 0} to{background-position:200% 0}}

/* will-change for animated elements */
.dw-float-card{animation:dw-float2 7s ease-in-out infinite;will-change:transform}
.dw-float-card:nth-child(2){animation-delay:-2.5s;animation-duration:9s}
.dw-float-card:nth-child(3){animation-delay:-4s;animation-duration:8s}

/* Wrap */
.dw-w{max-width:1160px;margin:0 auto;padding:0 32px}
@media(max-width:640px){.dw-w{padding:0 20px}}
.dw-sec{padding:100px 0}
.dw-sec-sm{padding:64px 0}
@media(max-width:768px){.dw-sec,.dw-sec-sm{padding:60px 0}}

/* Hero */
.dw-hero{min-height:100svh;display:flex;align-items:center;padding:100px 0 64px;position:relative;overflow:hidden;background:#fff}
.dw-hero-glow{position:absolute;pointer-events:none;border-radius:50%}
.dw-hero-g1{top:-8%;right:-6%;width:680px;height:680px;background:radial-gradient(circle,rgba(91,108,249,.13) 0%,transparent 65%);animation:dw-glow 6s ease-in-out infinite}
.dw-hero-g2{bottom:-14%;left:-4%;width:480px;height:480px;background:radial-gradient(circle,rgba(91,108,249,.08) 0%,transparent 65%);animation:dw-glow 8s ease-in-out infinite 2.5s}
.dw-hero-dots{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(circle,#c7d0fe 1px,transparent 1px);background-size:30px 30px;opacity:.3;mask-image:radial-gradient(ellipse 70% 60% at 60% 40%,black 30%,transparent 100%)}
.dw-hero-grid{display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center}
@media(max-width:900px){.dw-hero-grid{grid-template-columns:1fr;gap:48px}}
.dw-hero-copy{max-width:580px}
@media(max-width:900px){.dw-hero-copy{max-width:100%}}

/* Badge */
.dw-badge{display:inline-flex;align-items:center;gap:8px;border:1px solid #c7d0fe;background:#eef0fe;border-radius:999px;padding:6px 14px 6px 10px;font-size:12.5px;font-weight:600;color:var(--a);cursor:pointer;transition:box-shadow .2s,transform .2s;margin-bottom:24px}
.dw-badge:hover{box-shadow:0 0 0 4px rgba(91,108,249,.12);transform:translateY(-1px)}
.dw-dot-live{width:6px;height:6px;border-radius:50%;background:var(--a);animation:dw-pulse 1.6s ease-in-out infinite}
.dw-badge-arr{transition:transform .2s}
.dw-badge:hover .dw-badge-arr{transform:translateX(3px)}

/* Headline */
.dw-h1{font-size:clamp(42px,5.5vw,76px);font-weight:900;line-height:1.02;letter-spacing:-.045em;color:var(--ink);margin:0 0 20px}
.dw-accent-text{background:linear-gradient(135deg,#5b6cf9 0%,#818cf8 45%,#a78bfa 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.dw-lede{font-size:17px;line-height:1.7;color:var(--ink3);margin:0 0 32px;max-width:460px}
@media(max-width:640px){.dw-lede{font-size:15px}}

/* Buttons */
.dw-btn-p{display:inline-flex;align-items:center;gap:8px;background:var(--a);color:#fff;font-size:15px;font-weight:700;padding:14px 24px;border-radius:12px;border:none;cursor:pointer;transition:all .2s;box-shadow:0 4px 18px rgba(91,108,249,.35);will-change:transform}
.dw-btn-p:hover{background:#4f5de6;transform:translateY(-2px);box-shadow:0 8px 28px rgba(91,108,249,.45)}
.dw-btn-g{display:inline-flex;align-items:center;gap:8px;background:transparent;color:var(--ink2);font-size:15px;font-weight:600;padding:14px 22px;border-radius:12px;border:1.5px solid var(--b);cursor:pointer;transition:all .2s}
.dw-btn-g:hover{border-color:#c7d0fe;color:var(--a);background:var(--as)}
.dw-btns{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:28px}
.dw-trust{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.dw-trust-item{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink3)}
.dw-trust-chk{width:16px;height:16px;border-radius:50%;background:var(--as);display:flex;align-items:center;justify-content:center}

/* Hero bento */
.dw-bento{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:auto auto;gap:10px;max-width:520px;margin:0 auto}
@media(max-width:900px){.dw-bento{max-width:600px}}
.dw-bento-card{background:#fff;border:1px solid var(--b);border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.06)}
.dw-bc-chrome{display:flex;align-items:center;gap:5px;padding:9px 12px;background:var(--bg2);border-bottom:1px solid var(--b)}
.dw-bc-dots{display:flex;gap:4px}
.dw-bc-dot{width:7px;height:7px;border-radius:50%}
.dw-bc-url{margin-left:8px;font-size:9.5px;color:var(--ink4);font-family:monospace}
.dw-bc-body{padding:12px}

/* Marquee */
.dw-marq-wrap{overflow:hidden;padding:20px 0;border-top:1px solid var(--b);border-bottom:1px solid var(--b);background:var(--bg2)}
.dw-marq-track{display:flex;width:max-content;animation:dw-marq 24s linear infinite}
.dw-marq-item{display:flex;align-items:center;gap:10px;padding:0 36px;font-size:13.5px;font-weight:600;color:var(--ink3);white-space:nowrap}
.dw-marq-logo{width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#fff;flex-shrink:0}

/* Stats */
.dw-stats{display:grid;grid-template-columns:repeat(4,1fr)}
@media(max-width:640px){.dw-stats{grid-template-columns:1fr 1fr}}
.dw-stat{text-align:center;padding:44px 16px;border-right:1px solid var(--b)}
.dw-stat:last-child{border-right:none}
@media(max-width:640px){.dw-stat:nth-child(2){border-right:none}.dw-stat:nth-child(3){border-top:1px solid var(--b)}}
.dw-stat-v{font-size:clamp(34px,4.5vw,54px);font-weight:900;letter-spacing:-.04em;color:var(--a);line-height:1;margin-bottom:8px}
.dw-stat-l{font-size:12.5px;color:var(--ink4);font-weight:500;text-transform:uppercase;letter-spacing:.05em}

/* Section headings */
.dw-ey{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--a);margin-bottom:16px}
.dw-ey-dot{width:5px;height:5px;border-radius:50%;background:var(--a)}
.dw-h2{font-size:clamp(30px,3.8vw,52px);font-weight:900;letter-spacing:-.04em;line-height:1.06;color:var(--ink);margin:0 0 20px}
.dw-h2-sub{font-size:17px;line-height:1.7;color:var(--ink3);max-width:520px;margin:0 0 48px}
.dw-h3{font-size:clamp(22px,2.5vw,32px);font-weight:800;letter-spacing:-.03em;line-height:1.14;color:var(--ink);margin:0 0 14px}

/* Problem / dark */
.dw-dark{background:var(--ink);color:#fff}
.dw-dark .dw-ey{color:#818cf8}
.dw-dark .dw-h2{color:#fff}
.dw-dark .dw-h2-sub{color:rgba(255,255,255,.5)}
.dw-compare{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:56px;align-items:start}
@media(max-width:768px){.dw-compare{grid-template-columns:1fr;gap:20px}}
.dw-cmp-col{border-radius:20px;padding:28px}
.dw-cmp-b{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)}
.dw-cmp-a{background:rgba(91,108,249,.12);border:1px solid rgba(91,108,249,.3)}
.dw-cmp-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:20px}
.dw-cmp-b .dw-cmp-lbl{color:rgba(255,255,255,.3)}
.dw-cmp-a .dw-cmp-lbl{color:#818cf8}
.dw-cmp-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07);font-size:14px}
.dw-cmp-row:last-child{border-bottom:none}
.dw-cmp-b .dw-cmp-row{color:rgba(255,255,255,.4)}
.dw-cmp-a .dw-cmp-row{color:rgba(255,255,255,.85)}
.dw-cmp-ico{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0}
.dw-cmp-b .dw-cmp-ico{background:rgba(255,255,255,.06)}
.dw-cmp-a .dw-cmp-ico{background:rgba(91,108,249,.25)}

/* Feature sections */
.dw-feat{display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center}
.dw-feat.flip{direction:rtl}
.dw-feat.flip>*{direction:ltr}
@media(max-width:900px){.dw-feat,.dw-feat.flip{grid-template-columns:1fr;gap:40px;direction:ltr}}
.dw-feat-copy{max-width:480px}
.dw-feat-list{list-style:none;padding:0;margin:24px 0 0;display:flex;flex-direction:column;gap:12px}
.dw-feat-li{display:flex;align-items:flex-start;gap:10px;font-size:14.5px;color:var(--ink3);line-height:1.65}
.dw-feat-chk{width:20px;height:20px;border-radius:6px;background:var(--as);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}

/* Mockup */
.dw-mock{border:1px solid var(--b);border-radius:20px;overflow:hidden;box-shadow:0 8px 48px rgba(0,0,0,.07);background:#fff}
.dw-mock-chr{display:flex;align-items:center;gap:5px;padding:10px 14px;background:var(--bg2);border-bottom:1px solid var(--b)}
.dw-mock-dots{display:flex;gap:5px}
.dw-mock-dot{width:8px;height:8px;border-radius:50%}
.dw-mock-url{margin-left:10px;font-size:10.5px;color:var(--ink4);font-family:monospace;background:#e9eaeb;padding:2px 9px;border-radius:4px}
.dw-mock-body{padding:16px}

/* How it works */
.dw-steps{display:grid;grid-template-columns:repeat(3,1fr);position:relative}
@media(max-width:640px){.dw-steps{grid-template-columns:1fr;gap:0}}
.dw-steps-line{position:absolute;top:26px;left:calc(16.5%);right:calc(16.5%);height:2px;background:linear-gradient(90deg,var(--a),#818cf8,#a78bfa);opacity:.25;z-index:0}
@media(max-width:640px){.dw-steps-line{display:none}}
.dw-step{padding:0 20px 40px;text-align:center;position:relative}
@media(max-width:640px){.dw-step{text-align:left;padding:20px 0 20px 60px;border-left:2px solid rgba(91,108,249,.15)}}
.dw-step-n{width:52px;height:52px;border-radius:14px;background:var(--a);color:#fff;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;position:relative;z-index:1;box-shadow:0 4px 14px rgba(91,108,249,.35);will-change:transform}
@media(max-width:640px){.dw-step-n{position:absolute;left:0;top:20px;margin:0;width:44px;height:44px}}
.dw-step-ti{font-size:16px;font-weight:700;color:var(--ink);margin-bottom:8px}
.dw-step-d{font-size:13.5px;color:var(--ink3);line-height:1.65}

/* Testimonials */
.dw-testi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
@media(max-width:900px){.dw-testi-grid{grid-template-columns:1fr}}
@media(min-width:640px) and (max-width:900px){.dw-testi-grid{grid-template-columns:1fr 1fr}}
.dw-testi{background:#fff;border:1px solid var(--b);border-radius:20px;padding:28px;transition:box-shadow .25s,transform .25s;will-change:transform}
.dw-testi:hover{box-shadow:0 10px 36px rgba(0,0,0,.08);transform:translateY(-3px)}
.dw-stars{display:flex;gap:3px;margin-bottom:14px}
.dw-star{color:#f59e0b;font-size:17px}
.dw-tq{font-size:15px;line-height:1.65;color:var(--ink2);margin-bottom:20px;font-style:italic}
.dw-tq-hi{font-style:normal;font-weight:700;color:var(--ink)}
.dw-tstat{display:inline-block;font-size:11.5px;font-weight:700;color:var(--a);background:var(--as);padding:4px 10px;border-radius:6px;margin-bottom:18px}
.dw-tauth{display:flex;align-items:center;gap:10px}
.dw-tav{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0}
.dw-tn{font-size:13px;font-weight:600;color:var(--ink)}
.dw-tr{font-size:11.5px;color:var(--ink4)}

/* Integrations */
.dw-int-g{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-top:48px}
@media(max-width:768px){.dw-int-g{grid-template-columns:repeat(3,1fr)}}
.dw-int{border:1px solid var(--b);border-radius:14px;padding:20px 12px;display:flex;flex-direction:column;align-items:center;gap:8px;transition:border-color .2s,box-shadow .2s,transform .18s;cursor:default;will-change:transform}
.dw-int:hover{border-color:#c7d0fe;box-shadow:0 4px 18px rgba(91,108,249,.12);transform:translateY(-3px)}
.dw-int-logo{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:#fff}
.dw-int-n{font-size:12px;color:var(--ink3);font-weight:500}

/* Pricing preview */
.dw-pp-g{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
@media(max-width:900px){.dw-pp-g{grid-template-columns:1fr;max-width:420px;margin:0 auto}}
.dw-plan{border:1.5px solid var(--b);border-radius:22px;padding:28px;background:#fff;transition:border-color .2s,box-shadow .2s,transform .2s;will-change:transform}
.dw-plan:hover{border-color:#c7d0fe;box-shadow:0 10px 36px rgba(91,108,249,.1);transform:translateY(-2px)}
.dw-plan.feat{border-color:var(--a);background:var(--ink)}
.dw-plan-badge{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:3px 10px;border-radius:999px;margin-bottom:16px}
.dw-plan.feat .dw-plan-badge{background:rgba(91,108,249,.3);color:#818cf8}
.dw-plan:not(.feat) .dw-plan-badge{background:var(--bg2);color:var(--ink4)}
.dw-plan-n{font-size:18px;font-weight:800;color:var(--ink);margin-bottom:4px}
.dw-plan.feat .dw-plan-n{color:#fff}
.dw-plan-d{font-size:13px;color:var(--ink3);margin-bottom:18px}
.dw-plan.feat .dw-plan-d{color:rgba(255,255,255,.45)}
.dw-credits-badge{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:var(--a);background:var(--as);border:1px solid rgba(91,108,249,.18);border-radius:8px;padding:5px 10px;margin-bottom:16px}
.dw-plan.feat .dw-credits-badge{background:rgba(91,108,249,.2);border-color:rgba(91,108,249,.3);color:#818cf8}
.dw-plan-price{font-size:clamp(36px,4vw,48px);font-weight:900;letter-spacing:-.04em;color:var(--ink);line-height:1}
.dw-plan.feat .dw-plan-price{color:#fff}
.dw-plan-per{font-size:14px;color:var(--ink4);font-weight:500}
.dw-plan.feat .dw-plan-per{color:rgba(255,255,255,.4)}
.dw-plan-div{height:1px;background:var(--b);margin:18px 0}
.dw-plan.feat .dw-plan-div{background:rgba(255,255,255,.1)}
.dw-plan-feats{list-style:none;padding:0;margin:0 0 22px;display:flex;flex-direction:column;gap:10px}
.dw-plan-f{display:flex;align-items:center;gap:9px;font-size:13.5px;color:var(--ink2)}
.dw-plan.feat .dw-plan-f{color:rgba(255,255,255,.7)}
.dw-plan-fc{color:var(--a);flex-shrink:0}
.dw-plan.feat .dw-plan-fc{color:#818cf8}
.dw-plan-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:8px;font-size:14px;font-weight:700;padding:13px;border-radius:12px;border:none;cursor:pointer;transition:all .2s}
.dw-plan:not(.feat) .dw-plan-btn{background:var(--ink);color:#fff}
.dw-plan:not(.feat) .dw-plan-btn:hover{background:#1f2937;transform:translateY(-1px)}
.dw-plan.feat .dw-plan-btn{background:#fff;color:var(--a)}
.dw-plan.feat .dw-plan-btn:hover{background:#f0f1ff}

/* Feature highlight full-width */
.dw-fh{background:var(--bg2);border:1px solid var(--b);border-radius:28px;padding:56px;position:relative;overflow:hidden}
@media(max-width:640px){.dw-fh{padding:32px 22px}}
.dw-fh-g{display:grid;grid-template-columns:1fr 1.2fr;gap:56px;align-items:center}
@media(max-width:900px){.dw-fh-g{grid-template-columns:1fr;gap:36px}}

/* Final CTA */
.dw-cta-s{background:var(--ink);padding:100px 0;position:relative;overflow:hidden}
.dw-cta-g1{position:absolute;top:-100px;right:-80px;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,rgba(91,108,249,.22) 0%,transparent 65%);pointer-events:none;animation:dw-glow 5s ease-in-out infinite}
.dw-cta-g2{position:absolute;bottom:-90px;left:-60px;width:380px;height:380px;border-radius:50%;background:radial-gradient(circle,rgba(91,108,249,.14) 0%,transparent 65%);pointer-events:none;animation:dw-glow 7s ease-in-out infinite 2s}
.dw-cta-h{font-size:clamp(36px,4.5vw,66px);font-weight:900;letter-spacing:-.04em;line-height:1.06;color:#fff;text-align:center;margin:0 0 20px}
.dw-cta-sub{font-size:17px;color:rgba(255,255,255,.45);text-align:center;max-width:440px;margin:0 auto 40px;line-height:1.65}
.dw-cta-btns{display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;margin-bottom:24px}
.dw-cta-trust{display:flex;align-items:center;justify-content:center;gap:24px;flex-wrap:wrap}
.dw-cta-t{font-size:13px;color:rgba(255,255,255,.3)}
.dw-cta-t::before{content:'✓  ';color:rgba(91,108,249,.6)}
`;

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

// ── Shared components ─────────────────────────────────────────────────────────

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
    <div className="dw-mock-chr">
      <div className="dw-mock-dots">
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <div key={c} className="dw-mock-dot" style={{ background: c }} />
        ))}
      </div>
      <div className="dw-mock-url">{url}</div>
    </div>
  );
}

// ── GSAP scroll animations ────────────────────────────────────────────────────

function useScrollAnimations() {
  useEffect(() => {
    const ctx = gsap.context(() => {
      // Generic fade-up for sections
      gsap.utils.toArray<HTMLElement>('[data-gsap="fade-up"]').forEach((el) => {
        gsap.fromTo(
          el,
          { y: 40, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.8,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: el,
              start: 'top 88%',
              once: true,
            },
          },
        );
      });

      // Staggered children
      gsap.utils.toArray<HTMLElement>('[data-gsap="stagger"]').forEach((el) => {
        const children = el.children;
        gsap.fromTo(
          children,
          { y: 32, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.7,
            ease: 'power3.out',
            stagger: 0.1,
            scrollTrigger: {
              trigger: el,
              start: 'top 86%',
              once: true,
            },
          },
        );
      });

      // Stats counter animation
      gsap.utils.toArray<HTMLElement>('[data-gsap="counter"]').forEach((el) => {
        const target = parseFloat(el.dataset.target ?? '0');
        const suffix = el.dataset.suffix ?? '';
        const prefix = el.dataset.prefix ?? '';
        const dec = parseInt(el.dataset.dec ?? '0', 10);
        scrollTrigger: {
          trigger: el;
          start: 'top 85%';
          once: true;
        }
        ScrollTrigger.create({
          trigger: el,
          start: 'top 85%',
          once: true,
          onEnter: () => {
            gsap.to({ val: 0 }, {
              val: target,
              duration: 1.8,
              ease: 'power2.out',
              onUpdate: function () {
                const v = this.targets()[0].val as number;
                el.textContent = prefix + (dec > 0 ? v.toFixed(dec) : Math.round(v).toLocaleString()) + suffix;
              },
            });
          },
        });
      });

      // Step icons bounce on enter
      gsap.utils.toArray<HTMLElement>('.dw-step-n').forEach((el, i) => {
        gsap.fromTo(
          el,
          { scale: 0, rotation: -15 },
          {
            scale: 1,
            rotation: 0,
            duration: 0.6,
            ease: 'back.out(1.8)',
            delay: i * 0.12,
            scrollTrigger: {
              trigger: el,
              start: 'top 88%',
              once: true,
            },
          },
        );
      });

      // Integration cards stagger
      gsap.fromTo(
        '.dw-int',
        { y: 20, opacity: 0, scale: 0.95 },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          duration: 0.5,
          ease: 'power2.out',
          stagger: { amount: 0.5, from: 'start' },
          scrollTrigger: {
            trigger: '.dw-int-g',
            start: 'top 85%',
            once: true,
          },
        },
      );

      // Testimonial cards
      gsap.fromTo(
        '.dw-testi',
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.7,
          ease: 'power3.out',
          stagger: 0.15,
          scrollTrigger: {
            trigger: '.dw-testi-grid',
            start: 'top 85%',
            once: true,
          },
        },
      );

      // Plan cards
      gsap.fromTo(
        '.dw-plan',
        { y: 24, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.65,
          ease: 'power3.out',
          stagger: 0.12,
          scrollTrigger: {
            trigger: '.dw-pp-g',
            start: 'top 85%',
            once: true,
          },
        },
      );

      // Comparison columns
      const cmpCols = gsap.utils.toArray<HTMLElement>('.dw-cmp-col');
      if (cmpCols.length) {
        gsap.fromTo(
          cmpCols[0],
          { x: -30, opacity: 0 },
          { x: 0, opacity: 1, duration: 0.7, ease: 'power3.out', scrollTrigger: { trigger: cmpCols[0], start: 'top 85%', once: true } },
        );
        if (cmpCols[1]) {
          gsap.fromTo(
            cmpCols[1],
            { x: 30, opacity: 0 },
            { x: 0, opacity: 1, duration: 0.7, ease: 'power3.out', delay: 0.1, scrollTrigger: { trigger: cmpCols[1], start: 'top 85%', once: true } },
          );
        }
      }

      // Mockup slide-in from right
      gsap.utils.toArray<HTMLElement>('[data-gsap="slide-right"]').forEach((el) => {
        gsap.fromTo(
          el,
          { x: 50, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 0.9,
            ease: 'power3.out',
            scrollTrigger: { trigger: el, start: 'top 85%', once: true },
          },
        );
      });

      gsap.utils.toArray<HTMLElement>('[data-gsap="slide-left"]').forEach((el) => {
        gsap.fromTo(
          el,
          { x: -50, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 0.9,
            ease: 'power3.out',
            scrollTrigger: { trigger: el, start: 'top 85%', once: true },
          },
        );
      });
    });

    return () => {
      ctx.revert();
      ScrollTrigger.getAll().forEach((t) => t.kill());
    };
  }, []);
}

// ── Hero section ──────────────────────────────────────────────────────────────

function HeroVisual() {
  return (
    <div className="dw-bento">
      {/* Wide: AI generation */}
      <div className="dw-bento-card dw-float-card" style={{ gridColumn: '1/-1' }}>
        <div className="dw-bc-chrome">
          <div className="dw-bc-dots">
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} className="dw-bc-dot" style={{ background: c }} />)}
          </div>
          <div className="dw-bc-url">daky.ai/studio</div>
        </div>
        <div className="dw-bc-body" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <span style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>›</span>
            <span style={{ fontSize: 12, color: '#374151', flex: 1 }}>Write 3 LinkedIn posts about our Q2 product launch</span>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#5b6cf9', animation: 'dw-pulse 1.2s ease-in-out infinite' }} />
          </div>
          {[
            { n: '01', text: '"Six months of building in silence. Here\'s what we shipped."', tag: 'Hook', time: 'Tue 7:30 AM' },
            { n: '02', text: '"The one metric that changed our entire product roadmap."', tag: 'POV', time: 'Wed 9:00 AM' },
          ].map((p) => (
            <div key={p.n} style={{ display: 'flex', gap: 9, padding: '9px 10px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#5b6cf9', fontWeight: 700, paddingTop: 2 }}>{p.n}</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 12, color: '#374151', lineHeight: 1.5 }}>{p.text}</p>
                <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
                  <span style={{ fontSize: 10, background: '#eef0fe', color: '#5b6cf9', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>{p.tag}</span>
                  <span style={{ fontSize: 10, color: '#9ca3af' }}>{p.time}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Stats */}
      <div className="dw-bento-card dw-float-card">
        <div className="dw-bc-chrome">
          <div className="dw-bc-dots">{['#ff5f57','#febc2e','#28c840'].map((c) => <div key={c} className="dw-bc-dot" style={{ background: c }} />)}</div>
          <div className="dw-bc-url">analytics</div>
        </div>
        <div className="dw-bc-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.08em', fontFamily: 'monospace', marginBottom: 2 }}>30-day reach</div>
              <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em', color: '#0a0a0b' }}>2.4M</div>
            </div>
            <div style={{ fontSize: 11, color: '#10b981', background: '#d1fae5', padding: '2px 7px', borderRadius: 5, fontWeight: 700 }}>+34%</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 48 }}>
            {[40, 56, 45, 70, 84, 62, 95].map((h, i) => (
              <div key={i} style={{ flex: 1, background: i === 6 ? '#5b6cf9' : '#e5e7eb', borderRadius: '3px 3px 0 0', height: `${h}%`, animation: `dw-bar .7s ease ${i * 80}ms both` }} />
            ))}
          </div>
        </div>
      </div>
      {/* Calendar */}
      <div className="dw-bento-card dw-float-card">
        <div className="dw-bc-chrome">
          <div className="dw-bc-dots">{['#ff5f57','#febc2e','#28c840'].map((c) => <div key={c} className="dw-bc-dot" style={{ background: c }} />)}</div>
          <div className="dw-bc-url">calendar</div>
        </div>
        <div className="dw-bc-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 3 }}>
            {[
              { d: 12, p: [] },
              { d: 13, p: [{ c: '#5b6cf9', l: 'IG' }] },
              { d: 14, p: [{ c: '#0a66c2', l: 'LI' }, { c: '#0a0a0b', l: 'X' }] },
              { d: 15, p: [] },
              { d: 16, p: [{ c: '#1877f2', l: 'FB' }] },
            ].map(({ d, p }) => (
              <div key={d} style={{ background: '#f9fafb', borderRadius: 6, padding: '4px 3px', minHeight: 40 }}>
                <div style={{ fontSize: 8.5, color: '#9ca3af', fontFamily: 'monospace', marginBottom: 2 }}>{d}</div>
                {p.map((pp, j) => (
                  <div key={j} style={{ background: pp.c, color: '#fff', fontSize: 7.5, fontWeight: 700, padding: '1px 3px', borderRadius: 2, marginBottom: 1 }}>{pp.l}</div>
                ))}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 5, padding: '5px 7px', background: '#eef0fe', borderRadius: 7 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#5b6cf9', animation: 'dw-pulse 1.4s ease-in-out infinite' }} />
            <span style={{ fontSize: 9.5, color: '#5b6cf9', fontWeight: 600 }}>AI optimized timing applied</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero({ onCta }: { onCta: () => void }) {
  const copyRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo('.dw-badge', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.2)
        .fromTo('.dw-h1', { y: 32, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8 }, 0.35)
        .fromTo('.dw-lede', { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7 }, 0.55)
        .fromTo('.dw-btns', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.7)
        .fromTo('.dw-trust', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, 0.85)
        .fromTo(visualRef.current, { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.9, ease: 'power2.out' }, 0.4);
    });
    return () => ctx.revert();
  }, []);

  return (
    <section className="dw-hero">
      <div className="dw-hero-glow dw-hero-g1" />
      <div className="dw-hero-glow dw-hero-g2" />
      <div className="dw-hero-dots" />
      <div className="dw-w" style={{ width: '100%' }}>
        <div className="dw-hero-grid">
          <div className="dw-hero-copy" ref={copyRef}>
            <div className="dw-badge" role="button" tabIndex={0} onClick={onCta} onKeyDown={(e) => e.key === 'Enter' && onCta()}>
              <span className="dw-dot-live" />
              Now with AI image &amp; video generation
              <span className="dw-badge-arr">→</span>
            </div>
            <h1 className="dw-h1">
              Your brand.<br />
              Your voice.<br />
              <span className="dw-accent-text">Six channels.</span>
            </h1>
            <p className="dw-lede">
              Dakyworld Hub learns what your audience loves, generates content that sounds exactly like you, and publishes across every platform — automatically.
            </p>
            <div className="dw-btns">
              <button type="button" className="dw-btn-p" onClick={onCta}>
                Start for free <Arr s={14} />
              </button>
              <button type="button" className="dw-btn-g" onClick={onCta}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" opacity=".4" /><path d="M5.5 5L9.5 7 5.5 9V5Z" fill="currentColor" /></svg>
                Watch 2-min demo
              </button>
            </div>
            <div className="dw-trust">
              {['No credit card', '1-min setup', '30-day guarantee'].map((t) => (
                <div key={t} className="dw-trust-item">
                  <div className="dw-trust-chk"><Chk s={9} c="#5b6cf9" /></div>
                  {t}
                </div>
              ))}
            </div>
          </div>
          <div ref={visualRef} style={{ display: 'flex', justifyContent: 'center' }}>
            <HeroVisual />
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Marquee ───────────────────────────────────────────────────────────────────

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
    <div className="dw-marq-wrap">
      <div className="dw-marq-track">
        {doubled.map((p, i) => (
          <div key={i} className="dw-marq-item">
            <div className="dw-marq-logo" style={{ background: p.bg }}>{p.label}</div>
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
    <section style={{ borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
      <div className="dw-w">
        <div className="dw-stats" data-gsap="stagger">
          {[
            { target: 10, suffix: '×', prefix: '', dec: 0, label: 'Faster content creation' },
            { target: 35, suffix: 'h', prefix: '', dec: 0, label: 'Saved per user per month' },
            { target: 30, suffix: '%', prefix: '+', dec: 0, label: 'Avg engagement lift' },
            { target: 4.7, suffix: '/5', prefix: '', dec: 1, label: 'Customer satisfaction' },
          ].map((s) => (
            <div key={s.label} className="dw-stat">
              <div className="dw-stat-v">
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
              <div className="dw-stat-l">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Problem ───────────────────────────────────────────────────────────────────

function Problem() {
  return (
    <section className="dw-sec dw-dark">
      <div className="dw-w">
        <div style={{ maxWidth: 680 }}>
          <div className="dw-ey" data-gsap="fade-up"><span className="dw-ey-dot" />The problem</div>
          <h2 className="dw-h2" data-gsap="fade-up">Five subscriptions.<br />Zero shared context.</h2>
          <p className="dw-h2-sub" data-gsap="fade-up">
            Your content team bounces between five tools that have never met each other. The AI doesn't know your analytics. The scheduler can't write. Daky ends the tab-switching tax.
          </p>
        </div>
        <div className="dw-compare">
          <div className="dw-cmp-col dw-cmp-b">
            <div className="dw-cmp-lbl">⌧ Before Daky</div>
            {[
              { icon: '📅', text: 'Buffer — scheduling only, no AI, no design' },
              { icon: '✍️', text: 'Copy.ai — generic content, forgets your brand' },
              { icon: '🎨', text: 'Canva — design only, can\'t schedule or generate' },
              { icon: '📓', text: 'Notion — planning only, zero publishing' },
              { icon: '📊', text: 'Google Sheets — manual tracking, after the fact' },
            ].map((r, i) => (
              <div key={i} className="dw-cmp-row">
                <div className="dw-cmp-ico">{r.icon}</div>
                <span>{r.text}</span>
              </div>
            ))}
          </div>
          <div className="dw-cmp-col dw-cmp-a">
            <div className="dw-cmp-lbl">✦ With Dakyworld Hub</div>
            {[
              { icon: '✦', text: 'One AI that learns your exact brand voice' },
              { icon: '✦', text: 'Design, generate, and schedule from one place' },
              { icon: '✦', text: 'Six-channel publishing with one click' },
              { icon: '✦', text: 'Analytics that feed back into every new draft' },
              { icon: '✦', text: 'Team collaboration with role-based approvals' },
            ].map((r, i) => (
              <div key={i} className="dw-cmp-row">
                <div className="dw-cmp-ico" style={{ color: '#818cf8' }}>{r.icon}</div>
                <span>{r.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Feature mockups ───────────────────────────────────────────────────────────

function AIMockup() {
  return (
    <div className="dw-mock" data-gsap="slide-right">
      <MockChrome url="daky.ai/studio" />
      <div className="dw-mock-body" style={{ padding: 20 }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10.5, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 8 }}>AI Workflow</div>
          {[
            { name: 'Search brand designs', state: 'done' },
            { name: 'Extract style prompts', state: 'done' },
            { name: 'Tailor to your voice', state: 'running' },
            { name: 'Generate image', state: 'pending' },
            { name: 'Save to history', state: 'pending' },
          ].map((s) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ width: 18, height: 18, borderRadius: 5, background: s.state === 'done' ? '#eef0fe' : s.state === 'running' ? '#fef3c7' : '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {s.state === 'done' && <span style={{ fontSize: 9, color: '#5b6cf9' }}>✓</span>}
                {s.state === 'running' && <span style={{ fontSize: 10, color: '#d97706', display: 'block', animation: 'dw-spin 1s linear infinite' }}>⟳</span>}
                {s.state === 'pending' && <span style={{ display: 'block', width: 5, height: 5, borderRadius: '50%', border: '1.5px solid #d1d5db' }} />}
              </div>
              <span style={{ fontSize: 12.5, color: s.state === 'done' ? '#374151' : s.state === 'running' ? '#d97706' : '#9ca3af', fontWeight: s.state === 'running' ? 600 : 400 }}>{s.name}</span>
            </div>
          ))}
        </div>
        <div style={{ background: 'linear-gradient(135deg,#eef0fe,#f5f3ff)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 10, color: '#5b6cf9', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Generated post · LinkedIn</div>
          <p style={{ margin: 0, fontSize: 13, color: '#374151', lineHeight: 1.6, fontStyle: 'italic' }}>
            "Six months of building in silence. Here's everything we shipped — and why we held back until now."
          </p>
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <span style={{ fontSize: 10, background: '#5b6cf9', color: '#fff', padding: '2px 8px', borderRadius: 5, fontWeight: 600 }}>Hook</span>
            <span style={{ fontSize: 10, background: '#f3f4f6', color: '#6b7280', padding: '2px 8px', borderRadius: 5 }}>Tue 7:30 AM</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DesignMockup() {
  return (
    <div className="dw-mock" data-gsap="slide-left">
      <MockChrome url="daky.ai/studio · Canvas 1080×1080" />
      <div className="dw-mock-body" style={{ padding: 0, display: 'flex', height: 300 }}>
        <div style={{ width: 44, background: '#f9fafb', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '10px 0' }}>
          {['T', '□', '○', '─', '⬆', '🖼'].map((t, i) => (
            <div key={i} style={{ width: 30, height: 30, borderRadius: 7, background: i === 0 ? '#eef0fe' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, border: i === 0 ? '1.5px solid #c7d0fe' : '1.5px solid transparent' }}>{t}</div>
          ))}
        </div>
        <div style={{ flex: 1, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: '100%', aspectRatio: '1/1', maxHeight: 240, background: '#0a0a0b', borderRadius: 10, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <div style={{ position: 'absolute', top: 0, left: '18%', right: '18%', height: '44%', background: 'linear-gradient(135deg,#5b6cf9,#818cf8)', transform: 'rotate(-12deg) translateY(-28%)', borderRadius: 5 }} />
            <div style={{ position: 'absolute', bottom: 0, left: '14%', right: '14%', height: '34%', background: '#2be38b', transform: 'rotate(12deg) translateY(28%)', borderRadius: 5 }} />
            <span style={{ fontSize: 18, fontWeight: 900, color: '#fff', zIndex: 1, textAlign: 'center', lineHeight: 1.2 }}>Your Brand</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.5)', zIndex: 1 }}>Instagram Post</span>
          </div>
        </div>
        <div style={{ width: 90, background: '#fff', borderLeft: '1px solid #e5e7eb', padding: 10 }}>
          <div style={{ fontSize: 9.5, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10, fontWeight: 600 }}>Properties</div>
          {[['Fill', '#0a0a0b'], ['Opacity', '100%'], ['Radius', '10px'], ['W', '1080px']].map(([k, v]) => (
            <div key={k} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: '#9ca3af' }}>{k}</div>
              <div style={{ fontSize: 11, color: '#374151', fontWeight: 600 }}>{v}</div>
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
    <div className="dw-mock" data-gsap="slide-right">
      <MockChrome url="daky.ai/calendar · May 2026" />
      <div className="dw-mock-body" style={{ padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <div key={i} style={{ fontSize: 9.5, color: '#9ca3af', textAlign: 'center', fontFamily: 'monospace', textTransform: 'uppercase' }}>{d}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
          {Array.from({ length: 14 }, (_, i) => {
            const p = posts[i] ?? [];
            const isToday = i === 4;
            return (
              <div key={i} style={{ background: isToday ? '#eef0fe' : '#f9fafb', borderRadius: 7, padding: '5px 4px', minHeight: 52, border: isToday ? '1.5px solid #c7d0fe' : '1.5px solid transparent' }}>
                <div style={{ fontSize: 8.5, color: isToday ? '#5b6cf9' : '#9ca3af', fontWeight: isToday ? 700 : 400, fontFamily: 'monospace', marginBottom: 2 }}>{i + 12}</div>
                {p.map((pp, j) => (
                  <div key={j} style={{ background: pp.bg, color: '#fff', fontSize: 7.5, fontWeight: 700, padding: '1px 3px', borderRadius: 3, marginBottom: 1, textAlign: 'center' }}>{pp.label}</div>
                ))}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 12, padding: '9px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#5b6cf9', animation: 'dw-pulse 1.4s ease-in-out infinite' }} />
          <span style={{ fontSize: 12, color: '#374151', fontWeight: 500 }}>AI optimized posting times applied</span>
        </div>
      </div>
    </div>
  );
}

function AnalyticsMockup() {
  return (
    <div className="dw-mock" data-gsap="slide-right">
      <MockChrome url="daky.ai/analytics" />
      <div className="dw-mock-body" style={{ padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 18 }}>
          {[
            { label: 'Reach', val: '2.4M', delta: '+34%', c: '#10b981' },
            { label: 'Engagement', val: '8.2%', delta: '+12%', c: '#10b981' },
            { label: 'Posts', val: '47', delta: 'this month', c: '#5b6cf9' },
          ].map((m) => (
            <div key={m.label} style={{ background: '#f9fafb', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 9, color: '#9ca3af', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>{m.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#0a0a0b', letterSpacing: '-0.03em' }}>{m.val}</div>
              <div style={{ fontSize: 10, color: m.c, fontWeight: 600, marginTop: 2 }}>{m.delta}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 72, marginBottom: 14 }}>
          {[38, 52, 44, 68, 82, 59, 95].map((h, i) => (
            <div key={i} style={{ flex: 1, background: i === 6 ? '#5b6cf9' : i === 4 ? '#818cf8' : '#e5e7eb', borderRadius: '4px 4px 0 0', height: `${h}%`, animation: `dw-bar .7s ease ${i * 90}ms both` }} />
          ))}
        </div>
        <div style={{ padding: '10px 12px', background: '#eef0fe', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>✦</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#5b6cf9' }}>AI updated your brand profile</div>
            <div style={{ fontSize: 11, color: '#818cf8' }}>Thursday posts now weighted higher</div>
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
    <section className="dw-sec" id="features">
      <div className="dw-w">
        <div style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto 80px' }} data-gsap="fade-up">
          <div className="dw-ey"><span className="dw-ey-dot" />The platform</div>
          <h2 className="dw-h2">Six tools. One workflow.<br />One bill.</h2>
          <p className="dw-h2-sub" style={{ margin: '0 auto' }}>
            Generate, design, schedule, automate, measure, collaborate. Daky replaces five subscriptions and a spreadsheet.
          </p>
        </div>
        {FEATS.map((f) => (
          <div key={f.eyebrow} style={{ marginBottom: 96 }}>
            <div className={`dw-feat ${f.flip ? 'flip' : ''}`}>
              <div className="dw-feat-copy" data-gsap={f.flip ? 'slide-right' : 'slide-left'}>
                <div className="dw-ey"><span className="dw-ey-dot" />{f.eyebrow}</div>
                <h3 className="dw-h3">{f.title.split('\n').map((line, i) => <span key={i}>{i > 0 && <br />}{line}</span>)}</h3>
                <p style={{ fontSize: 16, color: '#6b7280', lineHeight: 1.7 }}>{f.desc}</p>
                <ul className="dw-feat-list">
                  {f.bullets.map((b) => (
                    <li key={b} className="dw-feat-li">
                      <div className="dw-feat-chk"><Chk s={11} c="#5b6cf9" /></div>
                      {b}
                    </li>
                  ))}
                </ul>
                <button type="button" className="dw-btn-g" style={{ marginTop: 28 }} onClick={onCta}>
                  {f.cta} <Arr s={13} />
                </button>
              </div>
              {f.visual}
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
    <section className="dw-sec" style={{ background: '#f9fafb', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
      <div className="dw-w">
        <div style={{ textAlign: 'center', maxWidth: 560, margin: '0 auto 64px' }} data-gsap="fade-up">
          <div className="dw-ey"><span className="dw-ey-dot" />How it works</div>
          <h2 className="dw-h2">Three steps to<br />a month of content.</h2>
        </div>
        <div className="dw-steps">
          <div className="dw-steps-line" />
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
            <div key={s.n} className="dw-step">
              <div className="dw-step-n">{s.icon}</div>
              <div className="dw-step-ti">{s.title}</div>
              <div className="dw-step-d">{s.desc}</div>
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
    <section className="dw-sec">
      <div className="dw-w">
        <div className="dw-fh" data-gsap="fade-up">
          <div className="dw-fh-g">
            <div data-gsap="slide-left">
              <div className="dw-ey"><span className="dw-ey-dot" />Analytics + AI Learning</div>
              <h3 className="dw-h3">Every post makes<br />Daky smarter.</h3>
              <p style={{ fontSize: 16, color: '#6b7280', lineHeight: 1.7, marginBottom: 24 }}>
                Most tools show you charts. Daky uses those charts. Every engagement metric feeds back into the AI — posts that win shape next week's drafts, and posts that flop never repeat.
              </p>
              <ul className="dw-feat-list">
                {[
                  'Cross-platform unified analytics dashboard',
                  'Top-performing post breakdown with why-it-worked analysis',
                  'AI auto-adjusts brand profile weekly based on performance',
                  'Export reports for clients or stakeholders in one click',
                ].map((b) => (
                  <li key={b} className="dw-feat-li">
                    <div className="dw-feat-chk"><Chk s={11} c="#5b6cf9" /></div>
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
    <section className="dw-sec" style={{ background: '#f9fafb', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
      <div className="dw-w">
        <div style={{ textAlign: 'center', maxWidth: 520, margin: '0 auto 52px' }} data-gsap="fade-up">
          <div className="dw-ey"><span className="dw-ey-dot" />Customers</div>
          <h2 className="dw-h2">Loved by creators<br />and teams worldwide.</h2>
        </div>
        <div className="dw-testi-grid">
          {[
            {
              stars: 5,
              quote: 'Finally an AI that actually knows our brand. Every draft sounds like our team wrote it — because it\'s learned from 6 months of our posts.',
              hi: 'sounds like our team',
              stat: '41% engagement lift in 6 weeks',
              name: 'Sarah K.', role: 'Growth Marketing Lead', initials: 'SK', color: '#5b6cf9',
            },
            {
              stars: 5,
              quote: 'Replaced Buffer, Canva, and our ChatGPT subscription. Everything from one place. We save 30+ hours a month and publish 3× as much.',
              hi: '30+ hours a month',
              stat: '3× more content shipped',
              name: 'James B.', role: 'Founder, SaaS Startup', initials: 'JB', color: '#0a66c2',
            },
            {
              stars: 5,
              quote: 'The AI Studio is incredible. Generated a full campaign of visuals in 20 minutes. The credit system means we only pay for what we use.',
              hi: 'full campaign in 20 minutes',
              stat: '85% faster creative production',
              name: 'Priya M.', role: 'Social Media Manager, Agency', initials: 'PM', color: '#f59e0b',
            },
          ].map((t) => (
            <div key={t.name} className="dw-testi">
              <div className="dw-stars">{Array.from({ length: t.stars }, (_, i) => <span key={i} className="dw-star">★</span>)}</div>
              <p className="dw-tq">
                "{t.quote.split(t.hi).map((part, i) => i === 0
                  ? part
                  : [<span key="hi" className="dw-tq-hi">{t.hi}</span>, part]
                )}"
              </p>
              <div className="dw-tstat">{t.stat}</div>
              <div className="dw-tauth">
                <div className="dw-tav" style={{ background: t.color }}>{t.initials}</div>
                <div>
                  <div className="dw-tn">{t.name}</div>
                  <div className="dw-tr">{t.role}</div>
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
    <section className="dw-sec">
      <div className="dw-w">
        <div style={{ textAlign: 'center', maxWidth: 520, margin: '0 auto' }} data-gsap="fade-up">
          <div className="dw-ey"><span className="dw-ey-dot" />Integrations</div>
          <h2 className="dw-h2">Publish everywhere<br />your audience lives.</h2>
          <p style={{ fontSize: 15, color: '#6b7280', maxWidth: 380, margin: '0 auto' }}>Connect once. Daky reformats and publishes to every channel simultaneously.</p>
        </div>
        <div className="dw-int-g">
          {[
            { name: 'Instagram', bg: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', label: 'IG' },
            { name: 'LinkedIn', bg: '#0a66c2', label: 'in' },
            { name: 'X · Twitter', bg: '#0a0a0b', label: '𝕏' },
            { name: 'Facebook', bg: '#1877f2', label: 'f' },
            { name: 'TikTok', bg: 'linear-gradient(135deg,#010101,#69c9d0)', label: '♪' },
            { name: 'YouTube', bg: '#ff0000', label: '▶' },
          ].map((p) => (
            <div key={p.name} className="dw-int">
              <div className="dw-int-logo" style={{ background: p.bg }}>{p.label}</div>
              <div className="dw-int-n">{p.name}</div>
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
    <section className="dw-sec" style={{ background: '#f9fafb', borderTop: '1px solid #e5e7eb' }}>
      <div className="dw-w">
        <div style={{ textAlign: 'center', maxWidth: 520, margin: '0 auto 52px' }} data-gsap="fade-up">
          <div className="dw-ey"><span className="dw-ey-dot" />Pricing</div>
          <h2 className="dw-h2">Start free. Scale<br />when you're ready.</h2>
          <p className="dw-h2-sub" style={{ margin: '0 auto' }}>Credits only used when generating AI visuals. Everything else is unlimited.</p>
        </div>
        <div className="dw-pp-g">
          {[
            { badge: 'Free to start', name: 'Starter', desc: 'For solo creators building a lean workflow.', price: '$19', per: '/mo', credits: 200, features: ['200 AI credits / month', 'Nova AI content generation', 'Canvas design builder', 'Discover template library', '3 connected accounts'], featured: false },
            { badge: 'Most Popular', name: 'Growth', desc: 'For teams scaling their social presence.', price: 'Custom', per: '', credits: 1000, features: ['1,000 AI credits / month', 'Everything in Starter', 'Automation workflows', 'Analytics learning loop', 'Up to 5 team members'], featured: true },
            { badge: 'Agency', name: 'Scale', desc: 'For agencies running multiple brands.', price: 'Custom', per: '', credits: 5000, features: ['5,000 AI credits / month', 'Everything in Growth', 'Multi-workspace management', 'Client role access', 'Unlimited team members'], featured: false },
          ].map((p) => (
            <div key={p.name} className={`dw-plan ${p.featured ? 'feat' : ''}`}>
              <div className="dw-plan-badge">{p.badge}</div>
              <div className="dw-plan-n">{p.name}</div>
              <div className="dw-plan-d">{p.desc}</div>
              <div className="dw-credits-badge">
                <span style={{ fontSize: 14 }}>✦</span>
                {p.credits.toLocaleString()} credits / month
              </div>
              <div style={{ marginBottom: 16 }}>
                <span className="dw-plan-price">{p.price}</span>
                {p.per && <span className="dw-plan-per"> {p.per}</span>}
              </div>
              <div className="dw-plan-div" />
              <ul className="dw-plan-feats">
                {p.features.map((f) => (
                  <li key={f} className="dw-plan-f">
                    <span className="dw-plan-fc"><Chk s={11} c={p.featured ? '#818cf8' : '#5b6cf9'} /></span>
                    {f}
                  </li>
                ))}
              </ul>
              <button type="button" className="dw-plan-btn" onClick={onCta}>
                Get started <Arr s={13} />
              </button>
            </div>
          ))}
        </div>
        <p style={{ textAlign: 'center', fontSize: 13, color: '#9ca3af', marginTop: 24 }}>Annual plans save 20% · 30-day money-back guarantee · No credit card to start</p>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <a href="/pricing" style={{ fontSize: 14, color: '#5b6cf9', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
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
    <section className="dw-cta-s">
      <div className="dw-cta-g1" />
      <div className="dw-cta-g2" />
      <div className="dw-w" style={{ position: 'relative', zIndex: 1 }}>
        <div data-gsap="fade-up">
          <h2 className="dw-cta-h">
            Ship strategy.<br />
            <span style={{ color: '#818cf8' }}>Not busywork.</span>
          </h2>
          <p className="dw-cta-sub">
            Join thousands of creators and teams who use Dakyworld Hub to publish smarter and grow faster every single week.
          </p>
          <div className="dw-cta-btns">
            <button type="button" className="dw-btn-p" style={{ fontSize: 16, padding: '16px 28px' }} onClick={onCta}>
              Start for free — it's on us <Arr s={15} />
            </button>
            <button type="button" className="dw-btn-g" style={{ color: 'rgba(255,255,255,.55)', borderColor: 'rgba(255,255,255,.14)', background: 'transparent' }} onClick={onCta}>
              View pricing
            </button>
          </div>
          <div className="dw-cta-trust">
            <span className="dw-cta-t">No credit card required</span>
            <span className="dw-cta-t">1-minute setup</span>
            <span className="dw-cta-t">30-day money-back guarantee</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function Landing({ onLoginClick }: { onLoginClick: () => void }) {
  useScrollAnimations();

  useEffect(() => {
    const el = document.createElement('style');
    el.id = 'dw-css';
    el.textContent = CSS;
    document.head.appendChild(el);
    return () => { el.remove(); ScrollTrigger.getAll().forEach((t) => t.kill()); };
  }, []);

  return (
    <div className="dw">
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
