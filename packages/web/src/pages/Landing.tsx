import React, { useState, useEffect, useRef } from 'react';
import { fetchPageContent } from '../services/pageContentService';

export type FeatureItem = { icon: string; title: string; description: string };
export type StatItem = { value: string; label: string };
export type HomepageContent = {
  hero: { badge: string; headline: string; subheadline: string; ctaPrimary: string; ctaSecondary: string };
  features: { title: string; subtitle: string; items: FeatureItem[] };
  stats: { items: StatItem[] };
  cta: { headline: string; subheadline: string; buttonText: string };
};
export const defaultHomepageContent: HomepageContent = {
  hero: { badge: 'Now with AI-powered distribution', headline: 'Publish smarter.\nGrow faster.', subheadline: 'Dakyworld Hub gives your team one powerful workspace to create, schedule, and publish content across every social platform.', ctaPrimary: 'Start for free', ctaSecondary: 'See how it works' },
  features: { title: 'Everything your brand needs', subtitle: 'One platform. Every tool. Zero complexity.', items: [] },
  stats: { items: [] },
  cta: { headline: 'Ready to take control of your social presence?', subheadline: 'Join Dakyworld Hub and start publishing smarter today.', buttonText: "Get started — it's free" },
};

const DW_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;450;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

.dw-root { --accent:#5B6CF9; --accent-soft:rgba(91,108,249,0.1); --accent-glow:rgba(91,108,249,0.35); --bg:#FAFAFA; --bg-2:#F4F4F5; --bg-3:#E9E9EB; --ink:#0A0A0B; --ink-2:#3B3B42; --ink-3:#6B6B78; --ink-4:#9898A6; --rule:rgba(10,10,11,0.08); --shadow-sm:0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.05); --shadow-md:0 4px 12px rgba(0,0,0,0.08),0 2px 6px rgba(0,0,0,0.05); font-family:'Geist',system-ui,sans-serif; background:var(--bg); color:var(--ink); overflow-x:hidden; }

/* Nav */
.dw-nav { position:fixed; top:0; left:0; right:0; z-index:100; height:60px; display:flex; align-items:center; padding:0 40px; transition:background 200ms,box-shadow 200ms; }
.dw-nav.scrolled { background:rgba(250,250,250,0.85); backdrop-filter:blur(12px); box-shadow:0 1px 0 var(--rule); }
.dw-nav-brand { display:flex; align-items:center; gap:8px; font-weight:600; font-size:15px; letter-spacing:-0.01em; }
.dw-brand-mark { width:24px; height:24px; border-radius:6px; background:var(--accent); position:relative; }
.dw-brand-mark::after { content:''; position:absolute; inset:5px; border-radius:2px; background:rgba(255,255,255,0.5); }
.dw-nav-links { display:flex; gap:28px; margin:0 auto; }
.dw-nav-links a { font-size:13.5px; color:var(--ink-3); text-decoration:none; transition:color 150ms; }
.dw-nav-links a:hover { color:var(--ink); }
.dw-nav-cta { display:flex; gap:8px; align-items:center; }
.dw-btn { display:inline-flex; align-items:center; gap:6px; border-radius:8px; font-size:13px; font-weight:500; cursor:pointer; text-decoration:none; transition:all 150ms; border:none; font-family:inherit; }
.dw-btn-ghost { background:transparent; color:var(--ink-2); border:1px solid var(--rule); padding:0 14px; height:34px; }
.dw-btn-ghost:hover { background:var(--bg-2); border-color:rgba(10,10,11,0.15); }
.dw-btn-primary { background:var(--accent); color:#fff; padding:0 16px; height:34px; box-shadow:0 1px 3px var(--accent-glow); }
.dw-btn-primary:hover { opacity:0.9; transform:translateY(-1px); }
.dw-btn-lg { height:44px; padding:0 22px; font-size:14px; border-radius:10px; }
.dw-arrow { transition:transform 150ms; }
.dw-btn-primary:hover .dw-arrow { transform:translateX(3px); }

/* Hero */
.dw-hero { min-height:100vh; display:flex; align-items:center; padding:80px 0 40px; position:relative; overflow:hidden; }
.dw-orbs { position:absolute; inset:0; pointer-events:none; }
.dw-orb { position:absolute; border-radius:50%; filter:blur(80px); animation:dwFloat 8s ease-in-out infinite; }
.dw-orb-1 { width:480px; height:480px; top:-100px; right:-80px; background:radial-gradient(circle,rgba(91,108,249,0.18),transparent 70%); }
.dw-orb-2 { width:360px; height:360px; bottom:-60px; left:-60px; background:radial-gradient(circle,rgba(91,108,249,0.10),transparent 70%); animation-delay:-3s; }
.dw-orb-3 { width:240px; height:240px; top:40%; left:40%; background:radial-gradient(circle,rgba(91,108,249,0.06),transparent 70%); animation-delay:-6s; }
@keyframes dwFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-20px)} }
.dw-container { max-width:1200px; margin:0 auto; padding:0 40px; }
.dw-hero-grid { display:grid; grid-template-columns:1fr 1fr; gap:60px; align-items:center; }
.dw-eyebrow { display:inline-flex; align-items:center; gap:8px; font-family:'JetBrains Mono',monospace; font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:var(--ink-3); margin-bottom:4px; }
.dw-eyebrow::before { content:''; width:6px; height:6px; border-radius:50%; background:var(--accent); box-shadow:0 0 10px var(--accent-glow); display:inline-block; }
.dw-h-display { font-size:clamp(40px,4.5vw,64px); font-weight:700; line-height:1.08; letter-spacing:-0.03em; color:var(--ink); margin:0; }
.dw-h-display em.dw-accent { font-style:normal; color:var(--accent); }
.dw-lede { font-size:16px; line-height:1.65; color:var(--ink-3); max-width:440px; }
.dw-hero-cta-row { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
.dw-hero-meta { display:flex; gap:16px; flex-wrap:wrap; }
.dw-hero-meta span { display:flex; align-items:center; gap:5px; font-size:12px; color:var(--ink-4); font-family:'JetBrains Mono',monospace; }
.dw-check { width:16px; height:16px; border-radius:50%; background:var(--accent-soft); color:var(--accent); display:inline-flex; align-items:center; justify-content:center; }

/* Hero Visual */
.dw-hero-visual { position:relative; height:520px; }
.dw-connectors { position:absolute; inset:0; width:100%; height:100%; }
.dw-connector { fill:none; stroke:var(--accent); stroke-width:1; stroke-dasharray:4 6; opacity:0.4; }
.dw-brain { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); display:flex; align-items:center; justify-content:center; }
.dw-brain-ring { position:absolute; border-radius:50%; border:1px solid rgba(91,108,249,0.2); animation:dwPulse 3s ease-in-out infinite; }
.dw-brain-ring:first-child { width:100px; height:100px; }
.dw-brain-ring-2 { width:140px; height:140px; animation-delay:-1.5s; }
@keyframes dwPulse { 0%,100%{transform:scale(1);opacity:0.4} 50%{transform:scale(1.05);opacity:0.8} }
.dw-brain-core { width:72px; height:72px; border-radius:50%; background:var(--ink); display:flex; align-items:center; justify-content:center; flex-direction:column; box-shadow:0 0 40px var(--accent-glow); position:relative; }
.dw-brain-core span { font-size:10px; font-weight:600; color:#fff; font-family:'JetBrains Mono',monospace; display:flex; align-items:center; gap:4px; }
.dw-pulse-dot { width:6px; height:6px; border-radius:50%; background:var(--accent); animation:dwBlink 1.2s ease-in-out infinite; }
@keyframes dwBlink { 0%,100%{opacity:1} 50%{opacity:0.2} }
.dw-fan-card { position:absolute; background:#fff; border:1px solid var(--rule); border-radius:12px; padding:12px 14px; width:196px; box-shadow:var(--shadow-md); animation:dwFloat 6s ease-in-out infinite; }
.dw-fan-card:nth-child(2){animation-delay:-1s} .dw-fan-card:nth-child(3){animation-delay:-2s} .dw-fan-card:nth-child(4){animation-delay:-3s} .dw-fan-card:nth-child(5){animation-delay:-4s} .dw-fan-card:nth-child(6){animation-delay:-5s}
.dw-fan-1 { top:20px; left:50%; transform:translateX(-140%); }
.dw-fan-2 { top:20px; right:0; }
.dw-fan-3 { top:50%; left:0; transform:translateY(-50%); }
.dw-fan-4 { bottom:60px; left:50%; transform:translateX(-150%); }
.dw-fan-5 { bottom:60px; right:0; }
.dw-fan-card-head { display:flex; align-items:center; gap:8px; font-size:12px; font-weight:600; color:var(--ink-2); margin-bottom:6px; }
.dw-platform-dot { width:20px; height:20px; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:9px; font-weight:700; color:#fff; flex-shrink:0; }
.dw-fan-card-body { font-size:11.5px; line-height:1.5; color:var(--ink-3); margin-bottom:8px; }
.dw-fan-card-meta { display:flex; gap:5px; }
.dw-pill { font-size:10px; font-family:'JetBrains Mono',monospace; padding:2px 7px; background:var(--bg-2); border-radius:4px; color:var(--ink-4); }
.dw-typing-dots span { display:inline-block; width:4px; height:4px; background:var(--accent); border-radius:50%; animation:dwTyping 1.2s infinite; margin:0 1px; }
.dw-typing-dots span:nth-child(2){animation-delay:0.2s} .dw-typing-dots span:nth-child(3){animation-delay:0.4s}
@keyframes dwTyping { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-4px)} }

/* Reveal */
.dw-reveal { opacity:0; transform:translateY(16px); transition:opacity 600ms cubic-bezier(0.22,1,0.36,1),transform 600ms cubic-bezier(0.22,1,0.36,1); }
.dw-reveal.in { opacity:1; transform:none; }
.dw-stagger>* { opacity:0; transform:translateY(16px); transition:opacity 500ms cubic-bezier(0.22,1,0.36,1),transform 500ms cubic-bezier(0.22,1,0.36,1); }
.dw-stagger.in>*:nth-child(1){opacity:1;transform:none;transition-delay:0ms}
.dw-stagger.in>*:nth-child(2){opacity:1;transform:none;transition-delay:80ms}
.dw-stagger.in>*:nth-child(3){opacity:1;transform:none;transition-delay:160ms}
.dw-stagger.in>*:nth-child(4){opacity:1;transform:none;transition-delay:240ms}
.dw-stagger.in>*:nth-child(5){opacity:1;transform:none;transition-delay:320ms}

/* Stats band */
.dw-stats-band { border-top:1px solid var(--rule); border-bottom:1px solid var(--rule); background:var(--bg-2); padding:40px 0; }
.dw-stats-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:0; }
.dw-stat { text-align:center; padding:0 24px; border-right:1px solid var(--rule); }
.dw-stat:last-child { border-right:none; }
.dw-stat-value { font-size:40px; font-weight:700; letter-spacing:-0.04em; color:var(--ink); line-height:1; margin-bottom:6px; font-variant-numeric:tabular-nums; }
.dw-unit { font-size:24px; }
.dw-stat-label { font-size:12px; font-family:'JetBrains Mono',monospace; color:var(--ink-4); text-transform:uppercase; letter-spacing:0.05em; }

/* Section */
.dw-section { padding:100px 0; }
.dw-section-head { text-align:center; max-width:700px; margin:0 auto 56px; }
.dw-h-section { font-size:clamp(32px,3vw,48px); font-weight:700; letter-spacing:-0.03em; line-height:1.1; margin:12px 0 0; }

/* Problem grid */
.dw-problem-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }
.dw-problem-cell { background:var(--bg-2); border:1px solid var(--rule); border-radius:14px; padding:24px; }
.dw-problem-cell h3 { font-size:16px; font-weight:600; margin:12px 0 8px; }
.dw-problem-cell p { font-size:14px; line-height:1.65; color:var(--ink-3); }
.dw-problem-bad { font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--ink-4); text-transform:uppercase; letter-spacing:0.06em; }
.dw-problem-good { font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--accent); margin-top:16px; text-transform:uppercase; letter-spacing:0.06em; }

/* Feature tabs */
.dw-feature-tabs { display:flex; gap:4px; border-bottom:1px solid var(--rule); margin-bottom:40px; }
.dw-feature-tab { display:flex; align-items:center; gap:7px; padding:10px 16px; border:none; background:transparent; font-size:13px; font-weight:500; color:var(--ink-4); cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; transition:color 150ms,border-color 150ms; font-family:inherit; }
.dw-feature-tab:hover { color:var(--ink-2); }
.dw-feature-tab.active { color:var(--ink); border-bottom-color:var(--accent); }
.dw-feature-stage { display:grid; grid-template-columns:1fr 1fr; gap:48px; align-items:start; }
.dw-feature-copy h3 { font-size:24px; font-weight:700; letter-spacing:-0.02em; margin:0 0 12px; }
.dw-feature-copy p { font-size:15px; line-height:1.65; color:var(--ink-3); }
.dw-feature-bullets { list-style:none; padding:0; margin:20px 0 0; display:flex; flex-direction:column; gap:10px; }
.dw-feature-bullets li { display:flex; align-items:center; gap:10px; font-size:14px; color:var(--ink-2); }
.dw-feature-bullets li svg { color:var(--accent); flex-shrink:0; }
.dw-feature-screen { background:var(--bg); border:1px solid var(--rule); border-radius:14px; overflow:hidden; box-shadow:var(--shadow-md); min-height:300px; }
.dw-fs-chrome { display:flex; align-items:center; gap:6px; padding:10px 14px; background:var(--bg-2); border-bottom:1px solid var(--rule); }
.dw-fs-chrome .dw-dot { width:8px; height:8px; border-radius:50%; background:var(--bg-3); }
.dw-fs-chrome .dw-title { margin-left:8px; font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--ink-4); }
.dw-fs-body { padding:16px; }
.dw-ai-gen-prompt { font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--ink-2); background:var(--bg-2); border-radius:8px; padding:10px 12px; margin-bottom:12px; }
.dw-caret { display:inline-block; width:2px; height:13px; background:var(--accent); margin-left:2px; animation:dwBlink 1s infinite; vertical-align:text-bottom; }
.dw-ai-gen-row { display:flex; gap:12px; padding:10px; background:var(--bg); border:1px solid var(--rule); border-radius:8px; margin-bottom:8px; }
.dw-ai-gen-row .dw-num { font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--accent); font-weight:600; padding-top:1px; flex-shrink:0; }
.dw-ai-gen-row .dw-text { font-size:13px; color:var(--ink-2); line-height:1.5; }
.dw-ai-gen-row .dw-meta { display:flex; gap:6px; margin-top:5px; font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--ink-4); align-items:center; }

/* Steps */
.dw-steps { display:grid; grid-template-columns:repeat(3,1fr); gap:24px; margin-top:24px; }
.dw-step { background:var(--bg); border:1px solid var(--rule); border-radius:16px; padding:28px; }
.dw-step-num { font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--ink-4); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:12px; }
.dw-step h3 { font-size:17px; font-weight:600; letter-spacing:-0.01em; margin:0 0 8px; }
.dw-step p { font-size:14px; line-height:1.65; color:var(--ink-3); margin:0 0 16px; }
.dw-step-illu { height:100px; }

/* Learning loop */
.dw-loop-wrap { display:grid; grid-template-columns:1fr 1fr; gap:60px; align-items:center; }
.dw-loop-viz { position:relative; height:380px; display:flex; align-items:center; justify-content:center; }
.dw-loop-svg { width:380px; height:380px; }
.dw-loop-node { position:absolute; display:flex; flex-direction:column; align-items:center; gap:3px; background:var(--bg); border:1px solid var(--rule); border-radius:12px; padding:12px 16px; font-size:13px; font-weight:600; box-shadow:var(--shadow-sm); transition:border-color 300ms,box-shadow 300ms; text-align:center; }
.dw-loop-node small { font-size:10px; font-family:'JetBrains Mono',monospace; color:var(--ink-4); font-weight:400; }
.dw-loop-node .dw-ico { width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:14px; background:var(--accent-soft); color:var(--accent); margin-bottom:4px; transition:background 300ms,color 300ms; }
.dw-loop-1 { top:10px; left:50%; transform:translateX(-50%); }
.dw-loop-2 { top:50%; right:10px; transform:translateY(-50%); }
.dw-loop-3 { bottom:10px; left:50%; transform:translateX(-50%); }
.dw-loop-4 { top:50%; left:10px; transform:translateY(-50%); }
.dw-chip { font-size:12px; font-family:'JetBrains Mono',monospace; padding:6px 10px; background:var(--bg); border:1px solid var(--rule); border-radius:6px; color:var(--ink-2); }
.dw-chips { display:flex; gap:8px; flex-wrap:wrap; margin-top:24px; }

/* Calendar */
.dw-calendar { background:var(--bg); border:1px solid var(--rule); border-radius:16px; overflow:hidden; box-shadow:var(--shadow-md); }
.dw-calendar-head { display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid var(--rule); }
.dw-month { font-size:15px; font-weight:600; }
.dw-cal-sub { font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--ink-4); text-transform:uppercase; }
.dw-nav-btns { display:flex; gap:4px; }
.dw-cal-icon-btn { width:28px; height:28px; border:1px solid var(--rule); border-radius:6px; display:flex; align-items:center; justify-content:center; background:transparent; cursor:pointer; color:var(--ink-3); }
.dw-cal-icon-btn:hover { background:var(--bg-2); }
.dw-cal-weekdays { display:grid; grid-template-columns:repeat(7,1fr); border-bottom:1px solid var(--rule); }
.dw-cal-weekday { padding:8px 10px; font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--ink-4); text-transform:uppercase; border-right:1px solid var(--rule); }
.dw-cal-weekday:last-child { border-right:none; }
.dw-cal-grid { display:grid; grid-template-columns:repeat(7,1fr); }
.dw-cal-day { min-height:80px; padding:8px; border-bottom:1px solid var(--rule); border-right:1px solid var(--rule); transition:background 150ms; }
.dw-cal-day:nth-child(7n) { border-right:none; }
.dw-cal-day.dim { background:var(--bg-2); }
.dw-cal-day.today .dw-num { color:var(--accent); font-weight:600; }
.dw-cal-day.drop-target { background:rgba(91,108,249,0.06); }
.dw-cal-day .dw-num { font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--ink-3); margin-bottom:4px; }
.dw-cal-pill { display:flex; align-items:center; gap:4px; padding:3px 6px; border-radius:5px; background:var(--bg-2); margin-bottom:3px; cursor:grab; font-size:10.5px; color:var(--ink-2); font-weight:500; user-select:none; }
.dw-cal-pill:active { cursor:grabbing; opacity:0.5; }
.dw-cal-pill.dragging { opacity:0.4; }
.dw-pdot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }

/* Workflow */
.dw-workflow { background:var(--bg); border:1px solid var(--rule); border-radius:14px; overflow:hidden; box-shadow:var(--shadow-sm); }
.dw-workflow-head { display:flex; justify-content:space-between; align-items:center; padding:14px 20px; border-bottom:1px solid var(--rule); background:var(--bg-2); }
.dw-workflow-title { font-size:13px; font-weight:600; }
.dw-workflow-status { display:flex; align-items:center; gap:6px; font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--ink-3); }
.dw-live-dot { width:6px; height:6px; border-radius:50%; background:#22c55e; display:inline-block; box-shadow:0 0 8px #22c55e88; animation:dwBlink 1.5s infinite; }
.dw-workflow-body { padding:20px; display:flex; flex-direction:column; gap:8px; }
.dw-wf-block { display:flex; align-items:center; gap:10px; padding:12px 14px; border:1px solid var(--rule); border-radius:10px; background:var(--bg); transition:border-color 300ms,background 300ms; }
.dw-wf-block.lit { border-color:var(--accent); background:var(--accent-soft); }
.dw-wf-block .dw-kind { font-family:'JetBrains Mono',monospace; font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-4); width:40px; flex-shrink:0; }
.dw-wf-block.lit .dw-kind { color:var(--accent); }
.dw-wf-block .dw-ico { font-size:14px; color:var(--ink-3); flex-shrink:0; }
.dw-wf-block .dw-desc { font-size:13px; color:var(--ink-2); }
.dw-wf-block.lit .dw-desc { color:var(--ink); }
.dw-wf-arrow { text-align:center; color:var(--ink-4); font-size:12px; height:12px; display:flex; align-items:center; justify-content:center; }
.dw-wf-arrow::after { content:'↓'; }

/* Integrations */
.dw-integrations-grid { display:grid; grid-template-columns:repeat(6,1fr); gap:12px; margin-top:16px; }
.dw-int-cell { display:flex; flex-direction:column; align-items:center; gap:8px; padding:20px 12px; background:var(--bg); border:1px solid var(--rule); border-radius:12px; transition:box-shadow 150ms,transform 150ms; }
.dw-int-cell:hover { box-shadow:var(--shadow-md); transform:translateY(-2px); }
.dw-int-cell .dw-logo { width:40px; height:40px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; color:#fff; }
.dw-int-cell .dw-label { font-size:12px; color:var(--ink-3); text-align:center; }

/* Testimonials */
.dw-testi-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:20px; }
.dw-testi { background:var(--bg); border:1px solid var(--rule); border-radius:16px; padding:28px; }
.dw-testi-quote { font-size:15px; line-height:1.65; color:var(--ink-2); margin:12px 0 16px; }
.dw-testi-quote .dw-pull { font-weight:600; color:var(--ink); }
.dw-testi-stat { font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--accent); background:var(--accent-soft); display:inline-block; padding:5px 10px; border-radius:6px; margin-bottom:20px; }
.dw-testi-foot { display:flex; align-items:center; gap:12px; }
.dw-testi-avatar { width:36px; height:36px; border-radius:50%; background:var(--bg-3); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; color:var(--ink-2); border:1px solid var(--rule); flex-shrink:0; }
.dw-testi-name { font-size:13px; font-weight:600; }
.dw-testi-role { font-size:11px; color:var(--ink-4); font-family:'JetBrains Mono',monospace; }

/* FAQ */
.dw-faq { border:1px solid var(--rule); border-radius:14px; overflow:hidden; }
.dw-faq-item { border-bottom:1px solid var(--rule); }
.dw-faq-item:last-child { border-bottom:none; }
.dw-faq-q { width:100%; display:flex; justify-content:space-between; align-items:center; padding:18px 24px; background:transparent; border:none; text-align:left; font-size:15px; font-weight:500; color:var(--ink); cursor:pointer; font-family:inherit; transition:background 150ms; }
.dw-faq-q:hover { background:var(--bg-2); }
.dw-chev { width:20px; height:20px; border-radius:50%; border:1px solid var(--rule); display:flex; align-items:center; justify-content:center; transition:transform 200ms; flex-shrink:0; }
.dw-faq-item.open .dw-chev { transform:rotate(45deg); }
.dw-faq-a { max-height:0; overflow:hidden; transition:max-height 300ms ease; }
.dw-faq-item.open .dw-faq-a { max-height:200px; }
.dw-faq-a-inner { padding:0 24px 18px; font-size:14px; line-height:1.7; color:var(--ink-3); }

/* Final CTA */
.dw-final-cta { background:var(--ink); border-radius:24px; padding:80px 60px; text-align:center; position:relative; overflow:hidden; color:#fff; }
.dw-final-cta h2 { font-size:clamp(32px,3vw,52px); font-weight:700; letter-spacing:-0.03em; line-height:1.1; margin:18px 0 16px; }
.dw-final-cta p { font-size:15px; color:rgba(255,255,255,0.6); line-height:1.65; max-width:440px; margin:0 auto 32px; }
.dw-final-cta .dw-orb-a { position:absolute; width:400px; height:400px; top:-100px; right:-100px; border-radius:50%; background:radial-gradient(circle,rgba(91,108,249,0.3),transparent 70%); pointer-events:none; }
.dw-final-cta .dw-orb-b { position:absolute; width:300px; height:300px; bottom:-80px; left:-80px; border-radius:50%; background:radial-gradient(circle,rgba(91,108,249,0.2),transparent 70%); pointer-events:none; }
.dw-final-meta { margin-top:24px; font-family:'JetBrains Mono',monospace; font-size:12px; color:rgba(255,255,255,0.4); position:relative; z-index:1; }

/* Footer */
.dw-footer { border-top:1px solid var(--rule); padding:60px 0 32px; }
.dw-footer-grid { display:grid; grid-template-columns:2fr 1fr 1fr 1fr 1fr; gap:40px; margin-bottom:48px; }
.dw-footer-brand p { font-size:13px; line-height:1.6; color:var(--ink-4); margin-top:12px; max-width:260px; }
.dw-footer-col h5 { font-size:13px; font-weight:600; margin-bottom:14px; }
.dw-footer-col ul { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:8px; }
.dw-footer-col ul li a { font-size:13px; color:var(--ink-3); text-decoration:none; transition:color 150ms; }
.dw-footer-col ul li a:hover { color:var(--ink); }
.dw-footer-bottom { display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--rule); padding-top:24px; font-size:13px; color:var(--ink-4); }
.dw-footer-bottom .dw-links { display:flex; gap:20px; }
.dw-footer-bottom .dw-links a { color:var(--ink-4); text-decoration:none; transition:color 150ms; }
.dw-footer-bottom .dw-links a:hover { color:var(--ink); }

@media (max-width:900px) {
  .dw-hero-grid,.dw-feature-stage,.dw-loop-wrap,.dw-footer-grid { grid-template-columns:1fr; }
  .dw-hero-visual { display:none; }
  .dw-steps,.dw-problem-grid,.dw-testi-grid { grid-template-columns:1fr; }
  .dw-stats-grid { grid-template-columns:repeat(2,1fr); }
  .dw-integrations-grid { grid-template-columns:repeat(3,1fr); }
  .dw-nav-links { display:none; }
  .dw-container { padding:0 20px; }
  .dw-nav { padding:0 20px; }
  .dw-final-cta { padding:48px 24px; }
}
`;

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.dw-reveal, .dw-stagger');
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.1, rootMargin: '0px 0px -5% 0px' });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
}

function Counter({ to, suffix = '', prefix = '', duration = 1600, decimals = 0 }: { to: number; suffix?: string; prefix?: string; duration?: number; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [val, setVal] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !started.current) {
        started.current = true;
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          setVal(to * eased);
          if (t < 1) requestAnimationFrame(tick);
          else setVal(to);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.4 });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, [to, duration]);
  const display = decimals > 0 ? val.toFixed(decimals) : Math.round(val).toLocaleString();
  return <span ref={ref}>{prefix}{display}<span className="dw-unit">{suffix}</span></span>;
}

function DwNav({ onLoginClick }: { onLoginClick: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <nav className={`dw-nav ${scrolled ? 'scrolled' : ''}`}>
      <div className="dw-nav-brand">
        <span className="dw-brand-mark" />
        <span>Dakyworld Hub</span>
      </div>
      <div className="dw-nav-links">
        <a href="#dw-features">Features</a>
        <a href="#dw-how">How it works</a>
        <a href="#dw-integrations">Integrations</a>
        <a href="#dw-testimonials">Customers</a>
        <a href="#dw-faq">FAQ</a>
      </div>
      <div className="dw-nav-cta">
        <button className="dw-btn dw-btn-ghost" style={{ height: 36, fontSize: 13 }} onClick={onLoginClick}>Sign in</button>
        <button className="dw-btn dw-btn-primary" style={{ height: 36, fontSize: 13 }} onClick={onLoginClick}>
          Start free <span className="dw-arrow">→</span>
        </button>
      </div>
    </nav>
  );
}

function DwHero({ onLoginClick }: { onLoginClick: () => void }) {
  return (
    <section className="dw-hero">
      <div className="dw-orbs">
        <div className="dw-orb dw-orb-1" /><div className="dw-orb dw-orb-2" /><div className="dw-orb dw-orb-3" />
      </div>
      <div className="dw-container" style={{ width: '100%' }}>
        <div className="dw-hero-grid">
          <div className="dw-reveal">
            <span className="dw-eyebrow">Dakyworld Hub · v1.4 just shipped</span>
            <h1 className="dw-h-display" style={{ marginTop: 20 }}>
              Your AI content<br />strategist.<br />
              <em className="dw-accent" style={{ fontStyle: 'normal' }}>Always learning.</em>
            </h1>
            <p className="dw-lede" style={{ marginTop: 24 }}>
              The AI content platform that knows your brand, learns from every post, and runs across six channels — so your team ships strategy, not busywork.
            </p>
            <div className="dw-hero-cta-row" style={{ marginTop: 32 }}>
              <button className="dw-btn dw-btn-primary dw-btn-lg" onClick={onLoginClick}>Start free <span className="dw-arrow">→</span></button>
              <button className="dw-btn dw-btn-ghost dw-btn-lg" onClick={onLoginClick}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6.5" stroke="currentColor" strokeOpacity="0.4"/><path d="M5.5 4.5 L9.5 7 L5.5 9.5 Z" fill="currentColor"/></svg>
                Watch 2-min demo
              </button>
            </div>
            <div className="dw-hero-meta" style={{ marginTop: 24 }}>
              <span><DwCheck /> No credit card</span>
              <span><DwCheck /> 1-min setup</span>
              <span><DwCheck /> 30-day guarantee</span>
            </div>
          </div>
          <DwHeroVisual />
        </div>
      </div>
    </section>
  );
}

function DwCheck() {
  return (
    <span className="dw-check">
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5 L3.5 6.5 L7.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </span>
  );
}

function DwHeroVisual() {
  return (
    <div className="dw-hero-visual dw-reveal">
      <svg className="dw-connectors" viewBox="0 0 560 520" preserveAspectRatio="none">
        <path className="dw-connector" d="M 280 260 L 90 80" />
        <path className="dw-connector" d="M 280 260 L 470 80" />
        <path className="dw-connector" d="M 280 260 L 50 420" />
        <path className="dw-connector" d="M 280 260 L 510 420" />
        <path className="dw-connector" d="M 280 260 L 280 500" />
      </svg>
      <div className="dw-brain">
        <div className="dw-brain-ring" /><div className="dw-brain-ring dw-brain-ring-2" />
        <div className="dw-brain-core">
          <span><span className="dw-pulse-dot" />Daky AI</span>
        </div>
      </div>
      <div className="dw-fan-card dw-fan-1">
        <div className="dw-fan-card-head"><span className="dw-platform-dot" style={{ background: 'linear-gradient(135deg,#FEDA77,#F58529,#DD2A7B)' }}>IG</span>Instagram</div>
        <div className="dw-fan-card-body">"Q2 just dropped — here's what 50K creators learned about hooks…"</div>
        <div className="dw-fan-card-meta"><span className="dw-pill">9:14 AM</span><span className="dw-pill">+3 hashtags</span></div>
      </div>
      <div className="dw-fan-card dw-fan-2">
        <div className="dw-fan-card-head"><span className="dw-platform-dot" style={{ background: '#0A66C2' }}>in</span>LinkedIn</div>
        <div className="dw-fan-card-body">"We spent 6 months testing pricing pages. Here's the page that 3x'd signups."</div>
        <div className="dw-fan-card-meta"><span className="dw-pill">Tue 7:30</span><span className="dw-pill">long-form</span></div>
      </div>
      <div className="dw-fan-card dw-fan-3">
        <div className="dw-fan-card-head"><span className="dw-platform-dot" style={{ background: '#0A0A0B' }}>𝕏</span>X (Twitter)</div>
        <div className="dw-fan-card-body"><span className="dw-typing-dots"><span /><span /><span /></span>&nbsp;Drafting thread…</div>
        <div className="dw-fan-card-meta"><span className="dw-pill">5 posts</span><span className="dw-pill">draft</span></div>
      </div>
      <div className="dw-fan-card dw-fan-4">
        <div className="dw-fan-card-head"><span className="dw-platform-dot" style={{ background: '#1877F2' }}>f</span>Facebook</div>
        <div className="dw-fan-card-body">"Founders in Lagos, Accra, Nairobi — meet next week. Free seats inside."</div>
        <div className="dw-fan-card-meta"><span className="dw-pill">Sat 10:00</span><span className="dw-pill">event</span></div>
      </div>
      <div className="dw-fan-card dw-fan-5">
        <div className="dw-fan-card-head"><span className="dw-platform-dot" style={{ background: '#000' }}>♪</span>TikTok</div>
        <div className="dw-fan-card-body">"3 hooks that work in 2026. The third one made me uncomfortable."</div>
        <div className="dw-fan-card-meta"><span className="dw-pill">Fri 6:00 PM</span><span className="dw-pill">vertical</span></div>
      </div>
    </div>
  );
}

function DwStatsBand() {
  return (
    <section className="dw-stats-band">
      <div className="dw-container">
        <div className="dw-stats-grid dw-stagger">
          <div className="dw-stat"><div className="dw-stat-value"><Counter to={10} suffix="×" /></div><div className="dw-stat-label">faster content</div></div>
          <div className="dw-stat"><div className="dw-stat-value"><Counter to={35} suffix="h" /></div><div className="dw-stat-label">saved per month</div></div>
          <div className="dw-stat"><div className="dw-stat-value">+<Counter to={30} suffix="%" /></div><div className="dw-stat-label">avg engagement lift</div></div>
          <div className="dw-stat"><div className="dw-stat-value"><Counter to={4.7} decimals={1} suffix="/5" /></div><div className="dw-stat-label">customer rating</div></div>
        </div>
      </div>
    </section>
  );
}

function DwProblem() {
  return (
    <section className="dw-section">
      <div className="dw-container">
        <div className="dw-section-head dw-reveal">
          <span className="dw-eyebrow">The problem</span>
          <h2 className="dw-h-section">Content teams ship 20% strategy.<br />The other 80% is logistics.</h2>
          <p className="dw-lede" style={{ marginTop: 16 }}>Most platforms only schedule. Most AI tools only generate. You're stuck wiring it all together — formatting, timing, channel quirks, brand voice. Daky flips the ratio.</p>
        </div>
        <div className="dw-problem-grid dw-stagger">
          <div className="dw-problem-cell"><div className="dw-problem-bad">⌧ before</div><h3>Tab-switching tax</h3><p>Buffer to schedule. Copy.ai to draft. Canva to design. Notion to plan. Sheets to track. Five tools, zero context.</p><div className="dw-problem-good">→ daky</div></div>
          <div className="dw-problem-cell"><div className="dw-problem-bad">⌧ before</div><h3>Generic AI output</h3><p>Templated openers. Buzzword soup. Posts that sound like everyone else, because the model never met your brand.</p><div className="dw-problem-good">→ daky</div></div>
          <div className="dw-problem-cell"><div className="dw-problem-bad">⌧ before</div><h3>No learning loop</h3><p>You publish. It performs. The tool forgets. Same generic suggestions next week, no matter what worked.</p><div className="dw-problem-good">→ daky</div></div>
        </div>
      </div>
    </section>
  );
}

const TAB_ICONS: Record<string, React.ReactNode> = {
  sparkle: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1 L8 5.5 L12.5 6.5 L8 7.5 L7 12 L6 7.5 L1.5 6.5 L6 5.5 Z" fill="currentColor"/></svg>,
  cal: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="2.5" width="11" height="10" rx="1.5" stroke="currentColor" fill="none"/><path d="M1.5 5.5 H12.5" stroke="currentColor"/><path d="M4.5 1 V3.5 M9.5 1 V3.5" stroke="currentColor" strokeLinecap="round"/></svg>,
  wf: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="3" cy="3" r="1.6" stroke="currentColor" fill="none"/><circle cx="11" cy="11" r="1.6" stroke="currentColor" fill="none"/><circle cx="11" cy="3" r="1.6" stroke="currentColor" fill="none"/><path d="M4.6 3 H9.4 M11 4.6 V9.4 M9.4 11 H4.6" stroke="currentColor" fill="none"/></svg>,
  chart: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 12 V6 M6 12 V3 M10 12 V8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="M1 12 H13" stroke="currentColor" strokeLinecap="round"/></svg>,
  team: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="5" cy="5" r="2" stroke="currentColor" fill="none"/><circle cx="10.5" cy="6" r="1.4" stroke="currentColor" fill="none"/><path d="M1.5 12 C1.5 9.5 3 8.5 5 8.5 C7 8.5 8.5 9.5 8.5 12" stroke="currentColor" fill="none"/><path d="M9 12 C9 10.5 10 9.8 11 9.8 C12 9.8 12.7 10.5 12.7 12" stroke="currentColor" fill="none"/></svg>,
};

const FEATURES = [
  { id: 'gen', label: 'AI Generation', icon: 'sparkle', title: 'Strategic posts. Not templates.', desc: 'Daky knows your brand voice, your audience, your past wins. Every draft is rooted in what already works for you — not a generic template.', bullets: ['Brand-voice fine-tuning per workspace', 'Per-platform formatting (IG vs LI vs X)', 'Hook, body, CTA, hashtags, posting time'] },
  { id: 'cal', label: 'Calendar', icon: 'cal', title: 'A month, planned in an hour.', desc: 'Drag posts onto days. Daky reformats automatically for each platform and surfaces conflicts before you publish.', bullets: ['Drag-and-drop multi-platform scheduling', 'Optimal-time recommendations', 'Conflict detection and approval flows'] },
  { id: 'auto', label: 'Workflows', icon: 'wf', title: 'If this, then post.', desc: 'Daky automates the recurring stuff — new blog post → social fan-out, form fill → segmented email, threshold hit → boost.', bullets: ['Visual If-This-Then-That builder', 'Triggers from blog, forms, analytics, webhooks', 'Approvals before anything goes live'] },
  { id: 'analytics', label: 'Analytics', icon: 'chart', title: 'Performance that teaches the AI.', desc: "Every metric flows back into Daky. Posts that win shape next week's drafts. Posts that flop never repeat.", bullets: ['Cross-platform unified dashboard', 'Top-performing post breakdown', 'Weekly fine-tuning on your wins'] },
  { id: 'team', label: 'Team', icon: 'team', title: 'Roles, approvals, comments.', desc: 'Editor drafts, Manager approves, Admin oversees. Built for marketing teams and agency client workflows.', bullets: ['Editor / Manager / Admin / Client roles', 'Per-post comments and revision history', 'Multi-workspace for agencies'] },
];

function FsChrome({ title }: { title: string }) {
  return (
    <div className="dw-fs-chrome">
      <span className="dw-dot"/><span className="dw-dot"/><span className="dw-dot"/>
      <span className="dw-title">{title}</span>
    </div>
  );
}

function FeatureScreen({ id }: { id: string }) {
  if (id === 'gen') return (
    <>
      <FsChrome title="daky.ai/generate" />
      <div className="dw-fs-body">
        <div className="dw-ai-gen-prompt"><span style={{ color: 'var(--ink-4)' }}>›</span> Generate 3 LinkedIn posts about our new pricing<span className="dw-caret" /></div>
        <div className="dw-ai-gen-row"><span className="dw-num">01</span><div style={{ flex: 1 }}><div className="dw-text">"We rebuilt our pricing page from scratch. Three things broke. One worked."</div><div className="dw-meta"><span>Hook · scroll-stopper</span><span>•</span><span>Tue 7:30 AM</span></div></div></div>
        <div className="dw-ai-gen-row"><span className="dw-num">02</span><div style={{ flex: 1 }}><div className="dw-text">"$99/month was the floor we kept tripping on. Here's why we held it anyway."</div><div className="dw-meta"><span>POV · founder voice</span><span>•</span><span>Wed 9:15 AM</span></div></div></div>
        <div className="dw-ai-gen-row"><span className="dw-num">03</span><div style={{ flex: 1 }}><div className="dw-text">"5 mistakes we made with our pricing page (and the one fix that 3x'd signups)."</div><div className="dw-meta"><span>Listicle · evergreen</span><span>•</span><span>Thu 8:00 AM</span></div></div></div>
      </div>
    </>
  );
  if (id === 'cal') return (
    <>
      <FsChrome title="daky.ai/calendar" />
      <div className="dw-fs-body" style={{ padding: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderTop: '1px solid var(--rule)' }}>
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
            <div key={d} style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono,monospace', fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', borderBottom: '1px solid var(--rule)', borderRight: '1px solid var(--rule)' }}>{d}</div>
          ))}
          {Array.from({ length: 14 }).map((_, i) => {
            const num = i + 12;
            const isToday = i === 4;
            const posts: Record<number, string[]> = { 1: ['IG · 9:00'], 2: ['LI · 7:30', 'X · 11:00'], 4: ['IG · 9:14', 'LI · 14:00'], 6: ['TT · 18:00'], 8: ['IG · 10:00'], 10: ['LI · 8:00', 'FB · 16:00'], 12: ['X · 12:00'] };
            return (
              <div key={i} style={{ minHeight: 70, padding: 8, borderBottom: '1px solid var(--rule)', borderRight: '1px solid var(--rule)' }}>
                <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: 10, color: isToday ? 'var(--accent)' : 'var(--ink-3)', fontWeight: isToday ? 600 : 400 }}>{num}</div>
                {(posts[i] || []).map((p, j) => (
                  <div key={j} style={{ marginTop: 4, padding: '2px 5px', fontSize: 9.5, fontWeight: 500, background: j === 0 ? 'var(--accent-soft)' : 'var(--bg-2)', color: j === 0 ? 'var(--accent)' : 'var(--ink-2)', borderRadius: 4 }}>{p}</div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
  if (id === 'auto') return (
    <>
      <FsChrome title="daky.ai/automations" />
      <div className="dw-fs-body">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { kind: 'WHEN', d: <span>New blog post is <strong>published</strong></span>, lit: true },
            { kind: 'IF', d: <span>Post receives <strong>100+ views</strong> in 24h</span>, lit: true },
            { kind: 'THEN', d: <span>Generate + schedule on <strong>IG, LinkedIn, X</strong></span>, lit: false },
          ].map((b, i) => (
            <React.Fragment key={i}>
              <div className={`dw-wf-block ${b.lit ? 'lit' : ''}`}>
                <span className="dw-kind">{b.kind}</span>
                <span className="dw-ico">{b.kind === 'WHEN' ? '◆' : b.kind === 'IF' ? '◇' : '▶'}</span>
                <span className="dw-desc">{b.d}</span>
              </div>
              {i < 2 && <div className="dw-wf-arrow" />}
            </React.Fragment>
          ))}
        </div>
      </div>
    </>
  );
  if (id === 'analytics') {
    const bars = [42, 68, 55, 80, 92, 71, 88];
    return (
      <>
        <FsChrome title="daky.ai/analytics" />
        <div className="dw-fs-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
            <div><div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'JetBrains Mono,monospace', textTransform: 'uppercase' }}>30-day reach</div><div style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', marginTop: 4 }}>2.4M</div></div>
            <div style={{ fontSize: 12, color: 'var(--accent)', fontFamily: 'JetBrains Mono,monospace', background: 'var(--accent-soft)', padding: '4px 8px', borderRadius: 6 }}>+34%</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
            {bars.map((b, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{ width: '100%', height: `${b}%`, background: i === 4 ? 'var(--accent)' : 'var(--bg-3)', borderRadius: '4px 4px 0 0' }} />
                <div style={{ fontSize: 9, color: 'var(--ink-4)', fontFamily: 'JetBrains Mono,monospace' }}>W{i + 1}</div>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }
  if (id === 'team') {
    const team = [
      { n: 'Sarah K.', r: 'Editor', a: 'SK', s: 'Drafted 3 posts' },
      { n: 'James B.', r: 'Manager', a: 'JB', s: 'Approved 5 posts' },
      { n: 'Priya M.', r: 'Admin', a: 'PM', s: 'Reviewed analytics' },
      { n: 'Tomás R.', r: 'Editor', a: 'TR', s: 'Commented · 2h ago' },
    ];
    return (
      <>
        <FsChrome title="daky.ai/team" />
        <div className="dw-fs-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {team.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: 'var(--bg)', border: '1px solid var(--rule)', borderRadius: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, border: '1px solid var(--rule)' }}>{m.a}</div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 500 }}>{m.n}</div><div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'JetBrains Mono,monospace' }}>{m.s}</div></div>
                <div style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'JetBrains Mono,monospace', background: 'var(--bg-2)', padding: '3px 8px', borderRadius: 5, textTransform: 'uppercase' }}>{m.r}</div>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }
  return null;
}

function DwFeaturesTabbed() {
  const [active, setActive] = useState('gen');
  const f = FEATURES.find(x => x.id === active)!;
  return (
    <section className="dw-section" id="dw-features">
      <div className="dw-container">
        <div className="dw-section-head dw-reveal">
          <span className="dw-eyebrow">The platform</span>
          <h2 className="dw-h-section">Six tools, one workflow,<br />one bill.</h2>
          <p className="dw-lede" style={{ marginTop: 16 }}>Generate, schedule, automate, measure, collaborate. Daky replaces five subscriptions and a spreadsheet.</p>
        </div>
        <div className="dw-feature-tabs dw-reveal">
          {FEATURES.map(x => (
            <button key={x.id} className={`dw-feature-tab ${active === x.id ? 'active' : ''}`} onClick={() => setActive(x.id)}>
              <span className="dw-icon">{TAB_ICONS[x.icon]}</span>{x.label}
            </button>
          ))}
        </div>
        <div className="dw-feature-stage" key={active}>
          <div className="dw-feature-copy dw-reveal">
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
            <ul className="dw-feature-bullets">
              {f.bullets.map((b, i) => (
                <li key={i}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7.5 L5.5 11 L12 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  {b}
                </li>
              ))}
            </ul>
          </div>
          <div className="dw-feature-screen dw-reveal">
            <FeatureScreen id={active} />
          </div>
        </div>
      </div>
    </section>
  );
}

function BrandIllu() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 240 130" preserveAspectRatio="xMidYMid meet">
      <rect x="20" y="22" width="100" height="86" rx="8" fill="#fff" stroke="rgba(10,10,11,0.1)"/>
      <rect x="32" y="34" width="60" height="6" rx="2" fill="rgba(10,10,11,0.5)"/>
      <rect x="32" y="46" width="40" height="4" rx="2" fill="rgba(10,10,11,0.18)"/>
      <rect x="32" y="56" width="50" height="4" rx="2" fill="rgba(10,10,11,0.18)"/>
      <rect x="32" y="66" width="35" height="4" rx="2" fill="rgba(10,10,11,0.18)"/>
      <circle cx="76" cy="92" r="9" fill="#5B6CF9" fillOpacity="0.12" stroke="#5B6CF9" strokeWidth="0.8"/>
      <text x="76" y="95" fontSize="9" fill="#5B6CF9" textAnchor="middle" fontWeight="600">→</text>
      <rect x="140" y="32" width="80" height="68" rx="10" fill="#0A0A0B"/>
      <circle cx="180" cy="58" r="14" fill="none" stroke="#5B6CF9" strokeWidth="1" strokeDasharray="2 3"/>
      <circle cx="180" cy="58" r="6" fill="#5B6CF9"/>
      <rect x="156" y="80" width="48" height="3" rx="1" fill="rgba(255,255,255,0.5)"/>
      <rect x="162" y="88" width="36" height="3" rx="1" fill="rgba(255,255,255,0.25)"/>
    </svg>
  );
}
function DraftIllu() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 240 130">
      {[0, 1, 2].map(i => (
        <g key={i}>
          <rect x={36 + i * 8} y={20 + i * 12} width="160" height="30" rx="6" fill="#fff" stroke="rgba(10,10,11,0.1)"/>
          <circle cx={50 + i * 8} cy={35 + i * 12} r="3" fill="#5B6CF9"/>
          <rect x={60 + i * 8} y={28 + i * 12} width="100" height="4" rx="2" fill="rgba(10,10,11,0.4)"/>
          <rect x={60 + i * 8} y={38 + i * 12} width="60" height="3" rx="1.5" fill="rgba(10,10,11,0.2)"/>
        </g>
      ))}
    </svg>
  );
}
function LearnIllu() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 240 130">
      <path d="M40 100 Q 80 30 120 70 T 200 40" stroke="#5B6CF9" strokeWidth="2" fill="none" strokeLinecap="round"/>
      <circle cx="40" cy="100" r="4" fill="#5B6CF9" fillOpacity="0.4"/>
      <circle cx="120" cy="70" r="4" fill="#5B6CF9" fillOpacity="0.7"/>
      <circle cx="200" cy="40" r="6" fill="#5B6CF9"/>
      <line x1="40" y1="115" x2="200" y2="115" stroke="rgba(10,10,11,0.1)"/>
      <text x="40" y="125" fontSize="8" fill="rgba(10,10,11,0.4)" fontFamily="monospace">W1</text>
      <text x="118" y="125" fontSize="8" fill="rgba(10,10,11,0.4)" fontFamily="monospace">W4</text>
      <text x="195" y="125" fontSize="8" fill="rgba(10,10,11,0.4)" fontFamily="monospace">W8</text>
    </svg>
  );
}

function DwHowItWorks() {
  const steps = [
    { n: '01', title: 'Daky learns your brand', desc: 'Connect your site and socials. Daky scrapes voice, audience, products, competitors — then builds a memory of how you sound.', illu: <BrandIllu /> },
    { n: '02', title: 'AI drafts strategic content', desc: 'Ask for a month of LinkedIn. Daky returns hooks, bodies, hashtags, posting times — rooted in what already works for you.', illu: <DraftIllu /> },
    { n: '03', title: 'You schedule. It learns.', desc: "Drag onto the calendar. Publish across six channels. Every reaction feeds back into Daky — so next week's drafts are sharper.", illu: <LearnIllu /> },
  ];
  return (
    <section className="dw-section" id="dw-how">
      <div className="dw-container">
        <div className="dw-section-head dw-reveal">
          <span className="dw-eyebrow">How it works</span>
          <h2 className="dw-h-section">Three steps. Two hours.<br />A month of content.</h2>
        </div>
        <div className="dw-steps dw-stagger">
          {steps.map(s => (
            <div className="dw-step" key={s.n}>
              <div className="dw-step-num">STEP {s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
              <div className="dw-step-illu">{s.illu}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DwLearningLoop() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setActive(a => (a + 1) % 4), 1800);
    return () => clearInterval(id);
  }, []);
  const nodes = [
    { label: 'Generate', sub: 'AI drafts', ico: '✦' },
    { label: 'Publish', sub: 'Cross-platform', ico: '↗' },
    { label: 'Measure', sub: 'Performance', ico: '⌁' },
    { label: 'Learn', sub: 'Fine-tune', ico: '◐' },
  ];
  return (
    <section className="dw-section">
      <div className="dw-container">
        <div className="dw-loop-wrap dw-reveal">
          <div className="dw-loop-copy">
            <span className="dw-eyebrow">AI learning loop</span>
            <h2 className="dw-h-section" style={{ marginTop: 16 }}>The only AI that<br />gets sharper every week.</h2>
            <p className="dw-lede" style={{ marginTop: 18 }}>Most AI tools are one-shot. Daky closes the loop. Every post you publish — every save, share, click, scroll — flows back as training signal. By week eight, drafts feel like you wrote them.</p>
            <div className="dw-chips">
              {['Brand voice', 'Audience signals', 'Top-performing hooks', 'Posting cadence'].map(c => (
                <span key={c} className="dw-chip">{c}</span>
              ))}
            </div>
          </div>
          <div className="dw-loop-viz">
            <svg className="dw-loop-svg" viewBox="0 0 380 380">
              <defs>
                <linearGradient id="dwLoopGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#5B6CF9" stopOpacity="0.6"/>
                  <stop offset="100%" stopColor="#5B6CF9" stopOpacity="0.15"/>
                </linearGradient>
              </defs>
              <circle cx="190" cy="190" r="120" fill="none" stroke="url(#dwLoopGrad)" strokeWidth="1.5" strokeDasharray="3 5"/>
              <circle r="6" fill="#5B6CF9">
                <animateMotion dur="7.2s" repeatCount="indefinite" path="M 190 70 A 120 120 0 1 1 189.99 70 Z"/>
              </circle>
            </svg>
            {nodes.map((n, i) => (
              <div key={i} className={`dw-loop-node dw-loop-${i + 1}`} style={{ borderColor: active === i ? 'var(--accent)' : 'var(--rule)', boxShadow: active === i ? '0 12px 30px -10px var(--accent-glow)' : 'var(--shadow-sm)' }}>
                <div className="dw-ico" style={{ background: active === i ? 'var(--accent)' : 'var(--accent-soft)', color: active === i ? '#fff' : 'var(--accent)' }}>{n.ico}</div>
                {n.label}<small>{n.sub}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

type PostItem = { id: string; label: string; color: string };
const INITIAL_POSTS: Record<number, PostItem[]> = {
  3: [{ id: 'p1', label: 'IG · Q2 launch teaser', color: '#DD2A7B' }],
  5: [{ id: 'p2', label: 'LI · Pricing post-mortem', color: '#0A66C2' }, { id: 'p3', label: 'X · Thread (5)', color: '#0A0A0B' }],
  8: [{ id: 'p4', label: 'IG · Behind the scenes', color: '#F58529' }],
  10: [{ id: 'p5', label: 'TT · Hook reel', color: '#0A0A0B' }],
  12: [{ id: 'p6', label: 'LI · Founder essay', color: '#0A66C2' }, { id: 'p7', label: 'FB · Event invite', color: '#1877F2' }],
  15: [{ id: 'p8', label: 'IG · Carousel (4)', color: '#DD2A7B' }],
  17: [{ id: 'p9', label: 'X · Tip thread', color: '#0A0A0B' }],
  20: [{ id: 'p10', label: 'LI · Case study', color: '#0A66C2' }],
};

function DwDragCalendar() {
  const [posts, setPosts] = useState(INITIAL_POSTS);
  const [dragging, setDragging] = useState<{ postId: string; fromDay: number } | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const days: Array<{ blank: boolean; num?: number; key: string | number }> = [];
  const startBlank = 4;
  for (let i = 0; i < startBlank; i++) days.push({ blank: true, key: 'b' + i });
  for (let i = 1; i <= 31; i++) days.push({ blank: false, num: i, key: i });
  while (days.length < 35) days.push({ blank: true, key: 'be' + days.length });

  const onDragStart = (e: React.DragEvent, postId: string, fromDay: number) => {
    setDragging({ postId, fromDay });
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', postId); } catch { /* */ }
  };
  const onDragOver = (e: React.DragEvent, d: typeof days[0]) => {
    if (!d || d.blank) return;
    e.preventDefault();
    setOver(d.num ?? null);
  };
  const onDrop = (e: React.DragEvent, d: typeof days[0]) => {
    e.preventDefault();
    if (!dragging || d.blank || d.num == null) return;
    const { postId, fromDay } = dragging;
    if (fromDay === d.num) { setDragging(null); setOver(null); return; }
    setPosts(prev => {
      const next = { ...prev };
      const fromList = (next[fromDay] || []).slice();
      const idx = fromList.findIndex(p => p.id === postId);
      if (idx === -1) return prev;
      const [moved] = fromList.splice(idx, 1);
      next[fromDay] = fromList;
      next[d.num!] = [...(next[d.num!] || []), moved];
      return next;
    });
    setDragging(null); setOver(null);
  };

  return (
    <section className="dw-section">
      <div className="dw-container">
        <div className="dw-section-head dw-reveal">
          <span className="dw-eyebrow">Try it · drag any post</span>
          <h2 className="dw-h-section">A month of content.<br />One drag away.</h2>
          <p className="dw-lede" style={{ marginTop: 16 }}>Daky's calendar isn't a static grid. Drag to reschedule. Daky reformats per platform, surfaces conflicts, and recommends optimal posting times.</p>
        </div>
        <div className="dw-calendar dw-reveal">
          <div className="dw-calendar-head">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <div className="dw-month">May 2026</div>
              <div className="dw-cal-sub">10 posts scheduled</div>
            </div>
            <div className="dw-nav-btns">
              <button className="dw-cal-icon-btn"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3 L5 7 L9 11" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
              <button className="dw-cal-icon-btn"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3 L9 7 L5 11" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
            </div>
          </div>
          <div className="dw-cal-weekdays">
            {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div key={d} className="dw-cal-weekday">{d}</div>)}
          </div>
          <div className="dw-cal-grid">
            {days.map(d => (
              <div key={d.key}
                className={`dw-cal-day ${d.blank ? 'dim' : ''} ${d.num === 6 ? 'today' : ''} ${over === d.num ? 'drop-target' : ''}`}
                onDragOver={(e) => onDragOver(e, d)}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => onDrop(e, d)}
              >
                {!d.blank && <div className="dw-num">{d.num}</div>}
                {!d.blank && (posts[d.num!] || []).map(p => (
                  <div key={p.id}
                    className={`dw-cal-pill ${dragging?.postId === p.id ? 'dragging' : ''}`}
                    draggable
                    onDragStart={(e) => onDragStart(e, p.id, d.num!)}
                    onDragEnd={() => { setDragging(null); setOver(null); }}
                  >
                    <span className="dw-pdot" style={{ background: p.color }} />
                    <span>{p.label}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function DwWorkflowSection() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStage(s => (s + 1) % 4), 1400);
    return () => clearInterval(id);
  }, []);
  const blocks = [
    { kind: 'WHEN', d: <span>New blog post <strong>publishes</strong> on WordPress</span>, ico: '◆' },
    { kind: 'IF', d: <span>Post hits <strong>100 views</strong> within 24h</span>, ico: '◇' },
    { kind: 'AND', d: <span>Audience segment is <strong>"Founders"</strong></span>, ico: '⊕' },
    { kind: 'THEN', d: <span>Generate posts → schedule on <strong>IG, LI, X</strong></span>, ico: '▶' },
  ];
  return (
    <section className="dw-section">
      <div className="dw-container">
        <div className="dw-section-head dw-reveal">
          <span className="dw-eyebrow">Workflow automation</span>
          <h2 className="dw-h-section">If this happens,<br />let Daky handle it.</h2>
          <p className="dw-lede" style={{ marginTop: 16 }}>Trigger from blog posts, form fills, analytics thresholds, or Zapier. Daky generates and schedules — you approve. Recurring busywork, automated.</p>
        </div>
        <div className="dw-workflow dw-reveal">
          <div className="dw-workflow-head">
            <div className="dw-workflow-title">"Blog → social fan-out" automation</div>
            <div className="dw-workflow-status"><span className="dw-live-dot" />Live · 47 runs this month</div>
          </div>
          <div className="dw-workflow-body">
            {blocks.map((b, i) => (
              <React.Fragment key={i}>
                <div className={`dw-wf-block ${stage >= i ? 'lit' : ''}`}>
                  <span className="dw-kind">{b.kind}</span>
                  <span className="dw-ico">{b.ico}</span>
                  <span className="dw-desc">{b.d}</span>
                </div>
                {i < blocks.length - 1 && <div className="dw-wf-arrow" />}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const INTEGRATIONS = [
  { name: 'Instagram', logo: 'IG', bg: 'linear-gradient(135deg,#FEDA77 0%,#F58529 50%,#DD2A7B 100%)' },
  { name: 'LinkedIn', logo: 'in', bg: '#0A66C2' },
  { name: 'X', logo: '𝕏', bg: '#0A0A0B' },
  { name: 'Facebook', logo: 'f', bg: '#1877F2' },
  { name: 'TikTok', logo: '♪', bg: '#0A0A0B' },
  { name: 'Pinterest', logo: 'P', bg: '#E60023' },
  { name: 'Resend', logo: '✉', bg: '#0A0A0B' },
  { name: 'Mailchimp', logo: 'M', bg: '#FFE01B', color: '#0A0A0B' },
  { name: 'WordPress', logo: 'W', bg: '#21759B' },
  { name: 'Stripe', logo: '$', bg: '#635BFF' },
  { name: 'Zapier', logo: 'Z', bg: '#FF4F00' },
  { name: 'Apify', logo: 'A', bg: '#10B981' },
];

function DwIntegrations() {
  return (
    <section className="dw-section" id="dw-integrations">
      <div className="dw-container">
        <div className="dw-section-head dw-reveal">
          <span className="dw-eyebrow">Integrations</span>
          <h2 className="dw-h-section">Plays with everything<br />your team already uses.</h2>
          <p className="dw-lede" style={{ marginTop: 16 }}>Six social platforms. Email, CMS, payments, scrapers, automation. Daky connects to the stack you have — no migration tax.</p>
        </div>
        <div className="dw-integrations-grid dw-stagger">
          {INTEGRATIONS.map(i => (
            <div className="dw-int-cell" key={i.name}>
              <div className="dw-logo" style={{ background: i.bg, color: (i as any).color || '#fff' }}>{i.logo}</div>
              <div className="dw-label">{i.name}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DwStars() {
  return (
    <div style={{ display: 'inline-flex', gap: 2 }}>
      {[0,1,2,3,4].map(i => (
        <svg key={i} width="14" height="14" viewBox="0 0 14 14" fill="#0A0A0B">
          <path d="M7 1 L8.7 5.2 L13.2 5.5 L9.7 8.4 L10.8 12.8 L7 10.4 L3.2 12.8 L4.3 8.4 L0.8 5.5 L5.3 5.2 Z"/>
        </svg>
      ))}
    </div>
  );
}

function DwTestimonials() {
  const TESTIMONIALS = [
    { quote: <span>"I went from <span className="dw-pull">3 platforms, 0 sleep</span> to a month planned in an afternoon. Daky writes in my voice — I just sign off."</span>, name: 'Sarah Adesanya', role: 'Creator · 240K followers', avatar: 'SA', stat: '+100K in 6 months' },
    { quote: <span>"We were paying for Buffer + Copy.ai + a planning Notion. <span className="dw-pull">Daky replaced all three.</span> Marketing reports its highest velocity ever."</span>, name: 'James Chen', role: 'Head of Marketing · Lattice-style SaaS', avatar: 'JC', stat: '−$420/mo on tools' },
    { quote: <span>"I run a 12-client agency. Daky lets us serve <span className="dw-pull">3× more clients</span> with the same team. The IFTTT workflows are unfair."</span>, name: 'Priya Mehta', role: 'Founder · Threadline Agency', avatar: 'PM', stat: '12 → 38 clients' },
  ];
  return (
    <section className="dw-section" id="dw-testimonials">
      <div className="dw-container">
        <div className="dw-section-head dw-reveal">
          <span className="dw-eyebrow">Customers</span>
          <h2 className="dw-h-section">Teams that ship more,<br />say less, sleep better.</h2>
        </div>
        <div className="dw-testi-grid dw-stagger">
          {TESTIMONIALS.map((t, i) => (
            <div className="dw-testi" key={i}>
              <DwStars />
              <div className="dw-testi-quote">{t.quote}</div>
              <div className="dw-testi-stat">↗ {t.stat}</div>
              <div className="dw-testi-foot">
                <div className="dw-testi-avatar">{t.avatar}</div>
                <div><div className="dw-testi-name">{t.name}</div><div className="dw-testi-role">{t.role}</div></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAQS = [
  { q: 'Is this AI replacing my team?', a: 'No. Daky augments your team by handling the 80% of busywork — formatting, scheduling, optimization — so your team focuses on strategy and creativity. Every post still ships with your approval.' },
  { q: 'How does the AI actually learn?', a: "Every time you rate, edit, or publish a post, that becomes training signal. Each week we fine-tune your workspace's model on your feedback. By month two, drafts feel like you wrote them." },
  { q: 'Can I use it for client accounts?', a: 'Yes. The Agency plan includes 20 team members and unlimited workspaces. White-label is on the Q3 roadmap.' },
  { q: 'What platforms can I publish to?', a: 'Instagram, LinkedIn, X, Facebook, Pinterest natively. TikTok scheduling ships in Q2. We also publish to WordPress and run email campaigns through Resend or Mailchimp.' },
  { q: 'Can I cancel anytime?', a: 'Anytime. No long-term contracts. You keep all your content, drafts, and analytics export when you go.' },
  { q: 'Is my data safe?', a: 'Yes — encrypted in transit and at rest, GDPR compliant, SOC 2 in progress for public launch. Your fine-tuned model is yours and never shared across workspaces.' },
];

function DwFAQ() {
  const [open, setOpen] = useState(0);
  return (
    <section className="dw-section" id="dw-faq">
      <div className="dw-container" style={{ maxWidth: 880 }}>
        <div className="dw-section-head dw-reveal" style={{ textAlign: 'center', margin: '0 auto 56px' }}>
          <span className="dw-eyebrow" style={{ justifyContent: 'center' }}>Questions</span>
          <h2 className="dw-h-section">Everything else<br />you'd want to know.</h2>
        </div>
        <div className="dw-faq dw-reveal">
          {FAQS.map((f, i) => (
            <div className={`dw-faq-item ${open === i ? 'open' : ''}`} key={i}>
              <button className="dw-faq-q" onClick={() => setOpen(open === i ? -1 : i)}>
                <span>{f.q}</span>
                <span className="dw-chev">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2 V10 M2 6 H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </span>
              </button>
              <div className="dw-faq-a"><div className="dw-faq-a-inner">{f.a}</div></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DwFinalCTA({ onLoginClick }: { onLoginClick: () => void }) {
  return (
    <section className="dw-section" id="dw-cta">
      <div className="dw-container">
        <div className="dw-final-cta dw-reveal">
          <div className="dw-orb-a" /><div className="dw-orb-b" />
          <span className="dw-eyebrow" style={{ justifyContent: 'center', color: 'rgba(255,255,255,0.6)' }}>
            <span style={{ background: 'var(--accent)', boxShadow: '0 0 12px var(--accent-glow)', width: 6, height: 6, borderRadius: '50%', display: 'inline-block' }} />
            Public launch · open beta
          </span>
          <h2>Ship a month of content<br />before lunch on Friday.</h2>
          <p>Free forever for solos. $99/mo unlocks the full team workflow. Cancel anytime, keep everything.</p>
          <div className="dw-hero-cta-row" style={{ justifyContent: 'center' }}>
            <button className="dw-btn dw-btn-primary dw-btn-lg" onClick={onLoginClick} style={{ position: 'relative', zIndex: 1 }}>Start free <span className="dw-arrow">→</span></button>
            <button className="dw-btn dw-btn-ghost dw-btn-lg" onClick={onLoginClick} style={{ position: 'relative', zIndex: 1, color: 'rgba(255,255,255,0.7)', borderColor: 'rgba(255,255,255,0.2)' }}>Schedule a demo</button>
          </div>
          <div className="dw-final-meta">no credit card · 1-min setup · 30-day guarantee</div>
        </div>
      </div>
    </section>
  );
}

function DwFooter() {
  return (
    <footer className="dw-footer">
      <div className="dw-container">
        <div className="dw-footer-grid">
          <div className="dw-footer-brand">
            <div className="dw-nav-brand"><span className="dw-brand-mark" /><span style={{ fontWeight: 600 }}>Dakyworld Hub</span></div>
            <p>The AI content platform that knows your brand and learns from every post. Built in Accra · launching everywhere.</p>
          </div>
          <div className="dw-footer-col"><h5>Product</h5><ul><li><a href="#dw-features">Features</a></li><li><a href="#dw-how">How it works</a></li><li><a href="#dw-integrations">Integrations</a></li><li><a href="#">Pricing</a></li><li><a href="#">Changelog</a></li></ul></div>
          <div className="dw-footer-col"><h5>Company</h5><ul><li><a href="#">About</a></li><li><a href="#">Blog</a></li><li><a href="#">Careers</a></li><li><a href="#">Press</a></li></ul></div>
          <div className="dw-footer-col"><h5>Resources</h5><ul><li><a href="#">Docs</a></li><li><a href="#">API</a></li><li><a href="#">Templates</a></li><li><a href="#">Community</a></li></ul></div>
          <div className="dw-footer-col"><h5>Legal</h5><ul><li><a href="/privacy">Privacy</a></li><li><a href="/terms">Terms</a></li><li><a href="#">Security</a></li><li><a href="#">DPA</a></li></ul></div>
        </div>
        <div className="dw-footer-bottom">
          <div>© 2026 Dakyworld. All rights reserved.</div>
          <div className="dw-links"><a href="#">Twitter</a><a href="#">LinkedIn</a><a href="#">Instagram</a><a href="#">YouTube</a></div>
        </div>
      </div>
    </footer>
  );
}

type LandingProps = { onLoginClick: () => void };

export default function Landing({ onLoginClick }: LandingProps) {
  useReveal();

  useEffect(() => {
    void fetchPageContent<HomepageContent>('homepage').then(() => { /* CMS content reserved for future use */ });
  }, []);

  return (
    <div className="dw-root">
      <style dangerouslySetInnerHTML={{ __html: DW_CSS }} />
      <DwNav onLoginClick={onLoginClick} />
      <DwHero onLoginClick={onLoginClick} />
      <DwStatsBand />
      <DwProblem />
      <DwFeaturesTabbed />
      <DwHowItWorks />
      <DwLearningLoop />
      <DwDragCalendar />
      <DwWorkflowSection />
      <DwIntegrations />
      <DwTestimonials />
      <DwFAQ />
      <DwFinalCTA onLoginClick={onLoginClick} />
      <DwFooter />
    </div>
  );
}
