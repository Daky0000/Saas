import React, { useEffect, useRef, type RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { fetchPageContent } from '../services/pageContentService';
import PublicNav from '../components/landing/PublicNav';
import PublicFooter from '../components/landing/PublicFooter';

gsap.registerPlugin(ScrollTrigger);

// keep exported types for admin CMS compatibility
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

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
.tl{--a:#5b6cf9;--as:rgba(91,108,249,.08);--ink:#0a0a0b;--ink2:#374151;--ink3:#6b7280;--ink4:#9ca3af;--b:#e5e7eb;--bg2:#f9fafb;
  font-family:'Inter',system-ui,-apple-system,sans-serif;background:#fff;color:var(--ink);overflow-x:hidden}
.tl-w{max-width:1160px;margin:0 auto;padding:0 32px}
@media(max-width:640px){.tl-w{padding:0 20px}}
.tl-sec{padding:96px 0}
@media(max-width:768px){.tl-sec{padding:60px 0}}

/* Keyframes */
@keyframes tl-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes tl-pulse{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes tl-glow{0%,100%{opacity:.5}50%{opacity:.9}}
@keyframes tl-bar{from{height:4px}to{}}
@keyframes tl-shimmer{from{background-position:-200% 0}to{background-position:200% 0}}
@keyframes tl-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes tl-prog{from{width:0}to{width:var(--tw,60%)}}
@keyframes tl-type{from{width:0}to{width:100%}}
@keyframes tl-blink{0%,100%{opacity:1}50%{opacity:0}}

/* Hero */
.tl-hero{padding:140px 0 80px;position:relative;overflow:hidden}
.tl-hero-g1{position:absolute;top:-40px;right:-80px;width:640px;height:640px;border-radius:50%;background:radial-gradient(circle,rgba(91,108,249,.12) 0%,transparent 65%);pointer-events:none;animation:tl-glow 6s ease-in-out infinite}
.tl-hero-g2{position:absolute;bottom:-100px;left:-60px;width:440px;height:440px;border-radius:50%;background:radial-gradient(circle,rgba(91,108,249,.07) 0%,transparent 65%);pointer-events:none;animation:tl-glow 9s ease-in-out infinite 3s}
.tl-hero-dots{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(circle,#c7d0fe 1px,transparent 1px);background-size:30px 30px;opacity:.25;mask-image:radial-gradient(ellipse 80% 60% at 65% 40%,black 20%,transparent 100%)}
.tl-hero-grid{display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center}
@media(max-width:900px){.tl-hero-grid{grid-template-columns:1fr;gap:48px}}
.tl-badge{display:inline-flex;align-items:center;gap:8px;border:1px solid #c7d0fe;background:#eef0fe;border-radius:999px;padding:6px 14px 6px 10px;font-size:12.5px;font-weight:600;color:var(--a);margin-bottom:24px}
.tl-dot-live{width:6px;height:6px;border-radius:50%;background:var(--a);animation:tl-pulse 1.6s ease-in-out infinite}
.tl-h1{font-size:clamp(42px,5vw,72px);font-weight:900;line-height:1.02;letter-spacing:-.045em;color:var(--ink);margin:0 0 20px}
.tl-accent{background:linear-gradient(135deg,#5b6cf9,#818cf8,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.tl-lede{font-size:17px;line-height:1.7;color:var(--ink3);margin:0 0 32px;max-width:460px}
@media(max-width:640px){.tl-lede{font-size:15px}}
.tl-btns{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.tl-btn-p{display:inline-flex;align-items:center;gap:8px;background:var(--a);color:#fff;font-size:15px;font-weight:700;padding:14px 24px;border-radius:12px;border:none;cursor:pointer;transition:all .2s;box-shadow:0 4px 18px rgba(91,108,249,.35)}
.tl-btn-p:hover{background:#4f5de6;transform:translateY(-2px);box-shadow:0 8px 28px rgba(91,108,249,.45)}
.tl-btn-g{display:inline-flex;align-items:center;gap:8px;background:transparent;color:var(--ink2);font-size:15px;font-weight:600;padding:14px 22px;border-radius:12px;border:1.5px solid var(--b);cursor:pointer;transition:all .2s}
.tl-btn-g:hover{border-color:#c7d0fe;color:var(--a);background:var(--as)}

/* Platform strip */
.tl-platform-strip{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;padding:20px 0;border-top:1px solid var(--b);border-bottom:1px solid var(--b);background:var(--bg2);margin:64px 0 0}
.tl-platform-pill{display:flex;align-items:center;gap:7px;padding:8px 16px;background:#fff;border:1px solid var(--b);border-radius:99px;font-size:13px;font-weight:600;color:var(--ink3)}
.tl-platform-ico{width:20px;height:20px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fff;flex-shrink:0}

/* Section eyebrow */
.tl-ey{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--a);margin-bottom:14px}
.tl-ey-dot{width:5px;height:5px;border-radius:50%;background:var(--a)}
.tl-h2{font-size:clamp(28px,3.5vw,48px);font-weight:900;letter-spacing:-.04em;line-height:1.06;color:var(--ink);margin:0 0 18px}
.tl-h2-sub{font-size:17px;line-height:1.7;color:var(--ink3);max-width:520px}
.tl-h3{font-size:clamp(22px,2.5vw,32px);font-weight:800;letter-spacing:-.03em;line-height:1.14;color:var(--ink);margin:0 0 12px}

/* Feature rows */
.tl-feat{display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center}
.tl-feat.flip{direction:rtl}
.tl-feat.flip>*{direction:ltr}
@media(max-width:900px){.tl-feat,.tl-feat.flip{grid-template-columns:1fr;gap:40px;direction:ltr}}
.tl-feat-copy{max-width:480px}
.tl-feat-tag{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:4px 12px;border-radius:99px;margin-bottom:16px}
.tl-feat-bullets{list-style:none;padding:0;margin:22px 0 0;display:flex;flex-direction:column;gap:11px}
.tl-feat-li{display:flex;align-items:flex-start;gap:10px;font-size:14.5px;color:var(--ink3);line-height:1.65}
.tl-feat-chk{width:20px;height:20px;border-radius:6px;background:var(--as);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}

/* Mockup cards */
.tl-mock{border:1px solid var(--b);border-radius:20px;overflow:hidden;box-shadow:0 8px 48px rgba(0,0,0,.07);background:#fff;animation:tl-float 8s ease-in-out infinite;will-change:transform}
.tl-mock:nth-of-type(2n){animation-delay:-3s;animation-duration:10s}
.tl-mock-chr{display:flex;align-items:center;gap:5px;padding:10px 14px;background:var(--bg2);border-bottom:1px solid var(--b)}
.tl-mock-dots{display:flex;gap:5px}
.tl-mock-dot{width:8px;height:8px;border-radius:50%}
.tl-mock-url{margin-left:10px;font-size:10.5px;color:var(--ink4);font-family:monospace;background:#e9eaeb;padding:2px 9px;border-radius:4px}
.tl-mock-body{padding:16px}

/* Tool card grid */
.tl-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
@media(max-width:900px){.tl-cards{grid-template-columns:1fr 1fr}}
@media(max-width:540px){.tl-cards{grid-template-columns:1fr}}
.tl-card{border:1.5px solid var(--b);border-radius:20px;padding:24px;background:#fff;transition:border-color .2s,box-shadow .2s,transform .2s;cursor:default;will-change:transform}
.tl-card:hover{border-color:#c7d0fe;box-shadow:0 8px 32px rgba(91,108,249,.1);transform:translateY(-3px)}
.tl-card-ico{width:44px;height:44px;border-radius:13px;display:flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:20px}
.tl-card-name{font-size:16px;font-weight:800;color:var(--ink);margin-bottom:4px}
.tl-card-tag{font-size:12.5px;font-weight:600;color:var(--a);margin-bottom:10px}
.tl-card-desc{font-size:13.5px;color:var(--ink3);line-height:1.6}

/* Workflow diagram */
.tl-flow{display:grid;grid-template-columns:repeat(4,1fr);gap:0;position:relative;margin-top:56px}
@media(max-width:768px){.tl-flow{grid-template-columns:1fr 1fr;gap:20px}}
@media(max-width:440px){.tl-flow{grid-template-columns:1fr}}
.tl-flow-line{position:absolute;top:40px;left:calc(12.5%);right:calc(12.5%);height:2px;background:linear-gradient(90deg,var(--a),#818cf8,#a78bfa,#c084fc);opacity:.2;z-index:0}
@media(max-width:768px){.tl-flow-line{display:none}}
.tl-flow-step{padding:0 12px 36px;text-align:center;position:relative}
.tl-flow-n{width:80px;height:80px;border-radius:22px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;font-size:28px;position:relative;z-index:1;border:1px solid var(--b);background:#fff;box-shadow:0 4px 16px rgba(0,0,0,.06);transition:box-shadow .2s,transform .2s}
.tl-flow-step:hover .tl-flow-n{box-shadow:0 8px 28px rgba(91,108,249,.18);transform:translateY(-4px)}
.tl-flow-ti{font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px}
.tl-flow-d{font-size:13px;color:var(--ink3);line-height:1.6;max-width:180px;margin:0 auto}

/* Stats row */
.tl-stats{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--b);border-radius:22px;overflow:hidden;margin-bottom:64px}
@media(max-width:640px){.tl-stats{grid-template-columns:1fr 1fr}}
.tl-stat{padding:36px 24px;text-align:center;border-right:1px solid var(--b)}
.tl-stat:last-child{border-right:none}
@media(max-width:640px){.tl-stat:nth-child(2){border-right:none}.tl-stat:nth-child(3){border-top:1px solid var(--b)}}
.tl-stat-v{font-size:clamp(28px,3.5vw,44px);font-weight:900;letter-spacing:-.04em;color:var(--a);line-height:1;margin-bottom:6px}
.tl-stat-l{font-size:12px;color:var(--ink4);font-weight:500;text-transform:uppercase;letter-spacing:.05em}

/* Dark section */
.tl-dark{background:var(--ink);color:#fff;border-radius:28px;padding:72px;margin:80px 0;position:relative;overflow:hidden}
@media(max-width:768px){.tl-dark{padding:48px 28px;margin:48px 0}}
.tl-dark-g1{position:absolute;top:-60px;right:-60px;width:380px;height:380px;border-radius:50%;background:radial-gradient(circle,rgba(91,108,249,.22) 0%,transparent 65%);pointer-events:none}
.tl-dark-g2{position:absolute;bottom:-80px;left:-40px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,rgba(91,108,249,.15) 0%,transparent 65%);pointer-events:none}
.tl-dark .tl-ey{color:#818cf8}
.tl-dark .tl-h2{color:#fff}
.tl-dark .tl-h2-sub{color:rgba(255,255,255,.45)}

/* Integration grid */
.tl-int-g{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;margin-top:48px}
@media(max-width:768px){.tl-int-g{grid-template-columns:repeat(3,1fr)}}
.tl-int{border:1px solid var(--b);border-radius:16px;padding:22px 12px;display:flex;flex-direction:column;align-items:center;gap:9px;background:#fff;transition:border-color .2s,box-shadow .2s,transform .18s;will-change:transform}
.tl-int:hover{border-color:#c7d0fe;box-shadow:0 4px 18px rgba(91,108,249,.12);transform:translateY(-4px)}
.tl-int-logo{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:#fff}
.tl-int-n{font-size:12px;color:var(--ink3);font-weight:600}

/* CTA */
.tl-cta{background:var(--ink);border-radius:28px;padding:72px 56px;text-align:center;position:relative;overflow:hidden}
@media(max-width:640px){.tl-cta{padding:48px 24px;border-radius:20px}}
.tl-cta-g1{position:absolute;top:-60px;right:-60px;width:380px;height:380px;border-radius:50%;background:radial-gradient(circle,rgba(91,108,249,.25) 0%,transparent 65%);pointer-events:none}
.tl-cta-g2{position:absolute;bottom:-60px;left:-40px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,rgba(91,108,249,.15) 0%,transparent 65%);pointer-events:none}
.tl-cta-h{font-size:clamp(32px,4vw,56px);font-weight:900;letter-spacing:-.04em;color:#fff;line-height:1.06;margin:0 0 16px}
.tl-cta-sub{font-size:16px;color:rgba(255,255,255,.45);margin:0 auto 36px;max-width:440px;line-height:1.65}
.tl-cta-trust{display:flex;align-items:center;justify-content:center;gap:24px;margin-top:20px;flex-wrap:wrap}
.tl-cta-t{font-size:12.5px;color:rgba(255,255,255,.3)}
.tl-cta-t::before{content:'✓  ';color:rgba(91,108,249,.6)}
.tl-cta-btns{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap}
`;

// ── Shared mini components ────────────────────────────────────────────────────

function MockChrome({ url }: { url: string }) {
  return (
    <div className="tl-mock-chr">
      <div className="tl-mock-dots">
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <div key={c} className="tl-mock-dot" style={{ background: c }} />
        ))}
      </div>
      <div className="tl-mock-url">{url}</div>
    </div>
  );
}

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
      gsap.utils.toArray<HTMLElement>('.tl-flow-n').forEach((el, i) => {
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
      tl.fromTo('.tl-badge', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, 0.15)
        .fromTo('.tl-h1', { y: 32, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8 }, 0.3)
        .fromTo('.tl-lede', { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7 }, 0.5)
        .fromTo('.tl-btns', { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.65)
        .fromTo('.tl-hero-visual', { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.9, ease: 'power2.out' }, 0.35);
    }, ref.current);
    return () => ctx.revert();
  }, [ref]);
}

// ── Hero visual mockup ────────────────────────────────────────────────────────

function HeroVisual() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* AI generation mockup */}
      <div className="tl-mock">
        <MockChrome url="daky.ai/studio — Nova AI" />
        <div className="tl-mock-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <span style={{ fontSize: 9, fontWeight: 700, background: '#eef0fe', color: '#5b6cf9', padding: '2px 7px', borderRadius: 4 }}>NOVA AI</span>
            <span style={{ fontSize: 12, color: '#374151', flex: 1 }}>Write a launch post for our new feature drop</span>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#5b6cf9', animation: 'tl-pulse 1.2s ease-in-out infinite' }} />
          </div>
          <div style={{ padding: '10px 12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, borderLeft: '3px solid #5b6cf9' }}>
            <p style={{ margin: '0 0 6px', fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
              "After 6 months of building in the shadows — our biggest feature is finally here."
            </p>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <span style={{ fontSize: 10, background: '#eef0fe', color: '#5b6cf9', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>Hook</span>
              <span style={{ fontSize: 10, background: '#d1fae5', color: '#065f46', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>LinkedIn</span>
              <span style={{ fontSize: 9, color: '#9ca3af', marginLeft: 'auto' }}>Tue 7:30 AM ↗</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { label: 'Instagram', c: '#e11d48', bg: 'linear-gradient(135deg,#f09433,#dc2743,#bc1888)' },
              { label: 'LinkedIn', c: '#0a66c2', bg: '#0a66c2' },
              { label: 'X (Twitter)', c: '#0a0a0b', bg: '#0a0a0b' },
            ].map((p) => (
              <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', background: p.bg, borderRadius: 6 }}>
                <span style={{ fontSize: 9, color: '#fff', fontWeight: 700 }}>{p.label}</span>
              </div>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6 }}>
              <span style={{ fontSize: 9, color: '#6b7280', fontWeight: 600 }}>+ 3 more</span>
            </div>
          </div>
        </div>
      </div>

      {/* Analytics + Calendar row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="tl-mock">
          <MockChrome url="analytics" />
          <div className="tl-mock-body">
            <div style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>Reach this week</div>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-.03em', color: '#0a0a0b', marginBottom: 8 }}>284K</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 40 }}>
              {[35, 55, 42, 68, 80, 58, 92].map((h, i) => (
                <div key={i} style={{ flex: 1, background: i === 6 ? '#5b6cf9' : '#e5e7eb', borderRadius: '3px 3px 0 0', height: `${h}%`, animation: `tl-bar .7s ease ${i * 80}ms both` }} />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
              <span style={{ fontSize: 9, background: '#d1fae5', color: '#065f46', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>+28%</span>
              <span style={{ fontSize: 9, color: '#9ca3af' }}>vs last week</span>
            </div>
          </div>
        </div>
        <div className="tl-mock">
          <MockChrome url="calendar" />
          <div className="tl-mock-body">
            <div style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>May 2026</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 2 }}>
              {[
                { d: 12, posts: [] },
                { d: 13, posts: ['IG'] },
                { d: 14, posts: ['LI', 'X'] },
                { d: 15, posts: [] },
                { d: 16, posts: ['FB'] },
                { d: 17, posts: ['IG', 'LI'] },
                { d: 18, posts: [] },
                { d: 19, posts: ['TK'] },
                { d: 20, posts: ['LI'] },
                { d: 21, posts: ['IG', 'X', 'FB'] },
              ].map(({ d, posts }) => (
                <div key={d} style={{ background: '#f9fafb', borderRadius: 4, padding: '3px 2px', minHeight: 30 }}>
                  <div style={{ fontSize: 7, color: '#9ca3af', marginBottom: 1 }}>{d}</div>
                  {posts.slice(0, 2).map((p, i) => (
                    <div key={i} style={{ background: p === 'IG' ? '#dc2743' : p === 'LI' ? '#0a66c2' : p === 'X' ? '#0a0a0b' : p === 'FB' ? '#1877f2' : '#010101', color: '#fff', fontSize: 5.5, fontWeight: 700, padding: '1px 2px', borderRadius: 2, marginBottom: 1 }}>{p}</div>
                  ))}
                  {posts.length > 2 && <div style={{ fontSize: 5.5, color: '#9ca3af' }}>+{posts.length - 2}</div>}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', background: '#eef0fe', borderRadius: 6 }}>
              <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#5b6cf9', animation: 'tl-pulse 1.4s ease-in-out infinite' }} />
              <span style={{ fontSize: 8, color: '#5b6cf9', fontWeight: 600 }}>AI timing enabled</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tool sections data ────────────────────────────────────────────────────────

const TOOLS = [
  {
    id: 'nova',
    tag: 'Nova AI',
    tagColor: '#5b6cf9',
    tagBg: '#eef0fe',
    h3: 'Generate content that sounds exactly like you.',
    lede: 'Nova AI learns your brand voice from your past posts, website copy, and tone preferences — then generates content that\'s indistinguishable from what you\'d write yourself.',
    bullets: [
      'Brand voice memory — trained on your content',
      'Platform-native formats: threads, carousels, captions',
      'Tone calibration (professional, witty, casual, bold)',
      'Batch generate a full week of content in minutes',
      'Hashtag intelligence and optimal posting time predictions',
    ],
    flip: false,
    mockup: 'nova',
  },
  {
    id: 'studio',
    tag: 'AI Studio',
    tagColor: '#7c3aed',
    tagBg: '#f5f3ff',
    h3: 'Design visuals your audience stops scrolling for.',
    lede: 'From AI-generated images to a full canvas builder — the AI Studio gives you every visual tool in one place. No Figma, no Photoshop, no external apps.',
    bullets: [
      'Text-to-image generation with brand color palettes',
      'Drag-and-drop canvas builder with 200+ templates',
      'Auto-resize to every platform in one click',
      'Custom brand kit: fonts, colors, logos',
      'Export to PNG, JPG, or publish directly',
    ],
    flip: true,
    mockup: 'studio',
  },
  {
    id: 'calendar',
    tag: 'Smart Scheduler',
    tagColor: '#059669',
    tagBg: '#ecfdf5',
    h3: 'Plan a month of content in one afternoon.',
    lede: 'The drag-and-drop content calendar shows every post across every platform at a glance. Rearrange, duplicate, and bulk-schedule without ever losing the big picture.',
    bullets: [
      'Visual calendar with multi-platform view',
      'AI-recommended optimal posting times',
      'Drag-to-reschedule, bulk actions',
      'Content queue with auto-fill suggestions',
      'Preview posts as they\'ll appear on each platform',
    ],
    flip: false,
    mockup: 'calendar',
  },
  {
    id: 'analytics',
    tag: 'Analytics',
    tagColor: '#d97706',
    tagBg: '#fffbeb',
    h3: 'Know exactly what drives growth — not just likes.',
    lede: 'Deep performance metrics across all platforms in a single dashboard. Track reach, engagement, audience growth, and content ROI with clarity you can actually act on.',
    bullets: [
      'Unified analytics across all 6 platforms',
      'Content performance breakdown by format and topic',
      'Audience growth trends and demographics',
      'Competitor benchmarking (Scale plan)',
      'Scheduled PDF reports for clients or team',
    ],
    flip: true,
    mockup: 'analytics',
  },
];

// ── Mockup components per tool ────────────────────────────────────────────────

function NovaMockup() {
  return (
    <div className="tl-mock" style={{ maxWidth: 500 }}>
      <MockChrome url="daky.ai/studio — Nova AI" />
      <div className="tl-mock-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: '#5b6cf9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: '#fff' }}>N</div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#0a0a0b' }}>Nova AI</div>
            <div style={{ fontSize: 9.5, color: '#9ca3af' }}>Brand voice: Professional + Bold</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981' }} />
            <span style={{ fontSize: 9, color: '#10b981', fontWeight: 600 }}>Ready</span>
          </div>
        </div>

        <div style={{ padding: '10px 12px', background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 12, color: '#374151' }}>
          "Write 3 posts about our AI image generation feature"
        </div>

        {[
          { n: '01', post: '"Your brand visuals, generated in 10 seconds. No designer needed."', platform: 'LinkedIn', tag: 'Product', score: 94 },
          { n: '02', post: '"We just shipped the thing our users asked about most. Thread 🧵"', platform: 'X / Twitter', tag: 'Hook', score: 88 },
          { n: '03', post: '"Behind every great post is a system. Here\'s ours ↓"', platform: 'Instagram', tag: 'Carousel', score: 91 },
        ].map((p) => (
          <div key={p.n} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#5b6cf9', fontWeight: 700, paddingTop: 2, minWidth: 20 }}>{p.n}</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 6px', fontSize: 12, color: '#374151', lineHeight: 1.5 }}>{p.post}</p>
              <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <span style={{ fontSize: 10, background: '#eef0fe', color: '#5b6cf9', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>{p.tag}</span>
                <span style={{ fontSize: 10, color: '#9ca3af' }}>{p.platform}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, background: '#d1fae5', color: '#065f46', padding: '1px 7px', borderRadius: 4, fontWeight: 700 }}>{p.score} score</span>
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
    <div className="tl-mock" style={{ maxWidth: 500 }}>
      <MockChrome url="daky.ai/studio — AI Studio" />
      <div className="tl-mock-body" style={{ display: 'flex', gap: 12 }}>
        {/* Left panel */}
        <div style={{ width: 72, flexShrink: 0 }}>
          <div style={{ fontSize: 9, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.08em' }}>Elements</div>
          {['Text', 'Shape', 'Image', 'Icon', 'BG'].map((el) => (
            <div key={el} style={{ padding: '6px 8px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 7, marginBottom: 4, fontSize: 10, color: '#374151', fontWeight: 600 }}>{el}</div>
          ))}
        </div>
        {/* Canvas */}
        <div style={{ flex: 1, background: 'linear-gradient(135deg,#eef0fe,#f5f3ff)', borderRadius: 12, minHeight: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 14, position: 'relative' }}>
          <div style={{ width: '100%', background: '#5b6cf9', borderRadius: 8, padding: '12px 14px', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: '#fff', letterSpacing: '-.02em', marginBottom: 3 }}>New Feature Alert</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.7)', lineHeight: 1.5 }}>AI-powered image generation — now available on all plans.</div>
          </div>
          <div style={{ display: 'flex', gap: 4, width: '100%' }}>
            {colors.map((c) => <div key={c} style={{ flex: 1, height: 8, background: c, borderRadius: 2 }} />)}
          </div>
          <div style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 9, color: '#5b6cf9', background: '#fff', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>Instagram · 1080×1080</div>
        </div>
        {/* Right panel */}
        <div style={{ width: 72, flexShrink: 0 }}>
          <div style={{ fontSize: 9, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.08em' }}>Brand Kit</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, marginBottom: 8 }}>
            {colors.slice(0, 4).map((c) => <div key={c} style={{ width: 26, height: 26, background: c, borderRadius: 6 }} />)}
          </div>
          <div style={{ fontSize: 9, color: '#9ca3af', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.08em' }}>Export</div>
          {['PNG', 'JPG', 'Publish'].map((e) => (
            <div key={e} style={{ padding: '5px 8px', background: e === 'Publish' ? '#5b6cf9' : '#f9fafb', border: `1px solid ${e === 'Publish' ? '#5b6cf9' : '#e5e7eb'}`, borderRadius: 6, marginBottom: 3, fontSize: 9, color: e === 'Publish' ? '#fff' : '#374151', fontWeight: 700, textAlign: 'center' }}>{e}</div>
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
    { d: 21, c: '#dc2743', l: 'IG' },
    { d: 21, c: '#ff0000', l: 'YT' },
  ];

  return (
    <div className="tl-mock" style={{ maxWidth: 500 }}>
      <MockChrome url="daky.ai/calendar" />
      <div className="tl-mock-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0a0a0b' }}>May 2026</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[{ c: '#dc2743', l: 'IG' }, { c: '#0a66c2', l: 'LI' }, { c: '#0a0a0b', l: 'X' }, { c: '#1877f2', l: 'FB' }].map((p) => (
              <div key={p.l} style={{ width: 18, height: 18, background: p.c, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 7, color: '#fff', fontWeight: 800 }}>{p.l}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3, marginBottom: 6 }}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <div key={i} style={{ fontSize: 8, color: '#9ca3af', textAlign: 'center', fontWeight: 600 }}>{d}</div>
          ))}
          {Array.from({ length: 21 }, (_, i) => i + 11).map((d) => {
            const dayPosts = posts.filter((p) => p.d === d);
            return (
              <div key={d} style={{ background: '#f9fafb', borderRadius: 5, padding: 3, minHeight: 36 }}>
                <div style={{ fontSize: 7.5, color: '#9ca3af', marginBottom: 2 }}>{d}</div>
                {dayPosts.slice(0, 3).map((p, j) => (
                  <div key={j} style={{ width: '100%', height: 5, background: p.c, borderRadius: 2, marginBottom: 1.5 }} title={p.l} />
                ))}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '8px 10px', background: '#eef0fe', borderRadius: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#5b6cf9', animation: 'tl-pulse 1.4s ease-in-out infinite' }} />
          <span style={{ fontSize: 10, color: '#5b6cf9', fontWeight: 600 }}>AI detected best times for this week · applied automatically</span>
        </div>
      </div>
    </div>
  );
}

function AnalyticsMockup() {
  return (
    <div className="tl-mock" style={{ maxWidth: 500 }}>
      <MockChrome url="daky.ai/analytics" />
      <div className="tl-mock-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {[
            { label: 'Total Reach', value: '2.4M', delta: '+34%', positive: true },
            { label: 'Engagement', value: '8.7%', delta: '+2.1%', positive: true },
            { label: 'Followers', value: '12,840', delta: '+847', positive: true },
          ].map((s) => (
            <div key={s.label} style={{ padding: '10px 12px', background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 9, color: '#9ca3af', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em' }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-.03em', color: '#0a0a0b', marginBottom: 3 }}>{s.value}</div>
              <div style={{ fontSize: 10, background: '#d1fae5', color: '#065f46', padding: '1px 6px', borderRadius: 4, fontWeight: 700, display: 'inline-block' }}>{s.delta}</div>
            </div>
          ))}
        </div>

        <div>
          <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 8, fontWeight: 600 }}>Top content formats this month</div>
          {[
            { label: 'Carousel / Slides', pct: 78 },
            { label: 'Short-form video', pct: 65 },
            { label: 'Single image', pct: 42 },
            { label: 'Text post', pct: 31 },
          ].map((b) => (
            <div key={b.label} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#374151', marginBottom: 3 }}>
                <span>{b.label}</span>
                <span style={{ fontWeight: 600 }}>{b.pct}%</span>
              </div>
              <div style={{ height: 6, background: '#f3f4f6', borderRadius: 999 }}>
                <div style={{ height: '100%', width: `${b.pct}%`, background: 'linear-gradient(90deg,#5b6cf9,#818cf8)', borderRadius: 999, animation: 'tl-prog 1s ease .3s both' as string }} />
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

// ── Main ──────────────────────────────────────────────────────────────────────

type Props = { onLoginClick: () => void };

export default function Tools({ onLoginClick }: Props) {
  const heroRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'tl-css';
    style.textContent = CSS;
    document.head.appendChild(style);

    // fire CMS fetch but don't use it — page uses static data
    fetchPageContent('tools').catch(() => undefined);

    return () => { document.getElementById('tl-css')?.remove(); };
  }, []);

  useHeroAnim(heroRef);
  useAnimations();

  return (
    <div className="tl">
      <PublicNav onLoginClick={onLoginClick} activePath="/tools" />

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="tl-sec tl-hero" ref={heroRef} style={{ paddingBottom: 0 }}>
        <div className="tl-hero-g1" />
        <div className="tl-hero-g2" />
        <div className="tl-hero-dots" />
        <div className="tl-w">
          <div className="tl-hero-grid">
            <div>
              <div className="tl-badge">
                <span className="tl-dot-live" />
                Full platform toolkit
              </div>
              <h1 className="tl-h1">
                Every tool.<br />
                One platform.<br />
                <span className="tl-accent">Zero friction.</span>
              </h1>
              <p className="tl-lede">
                From AI content generation to visual design to analytics and automation — everything your brand needs to dominate social media, built under one roof.
              </p>
              <div className="tl-btns">
                <button type="button" className="tl-btn-p" onClick={onLoginClick}>
                  Try it free <Arr />
                </button>
                <button type="button" className="tl-btn-g" onClick={onLoginClick}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" opacity=".4" /><path d="M5.5 5L9.5 7 5.5 9V5Z" fill="currentColor" /></svg>
                  See it in action
                </button>
              </div>
            </div>
            <div className="tl-hero-visual" style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: '100%', maxWidth: 520 }}>
                <HeroVisual />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Platform strip ──────────────────────────────────────────────── */}
      <div className="tl-platform-strip">
        {[
          { name: 'Instagram', bg: 'linear-gradient(135deg,#f09433,#dc2743,#bc1888)', label: 'IG' },
          { name: 'LinkedIn', bg: '#0a66c2', label: 'in' },
          { name: 'X · Twitter', bg: '#0a0a0b', label: '𝕏' },
          { name: 'Facebook', bg: '#1877f2', label: 'f' },
          { name: 'TikTok', bg: '#010101', label: '♪' },
          { name: 'YouTube', bg: '#ff0000', label: '▶' },
        ].map((p) => (
          <div key={p.name} className="tl-platform-pill">
            <div className="tl-platform-ico" style={{ background: p.bg }}>{p.label}</div>
            {p.name}
          </div>
        ))}
      </div>

      {/* ── Stats row ───────────────────────────────────────────────────── */}
      <div className="tl-w" style={{ paddingTop: 72, paddingBottom: 0 }}>
        <div className="tl-stats" data-tl="stagger">
          {[
            { v: '6', l: 'Platforms in one hub' },
            { v: '10×', l: 'Faster than manual' },
            { v: '200+', l: 'Content templates' },
            { v: '12K+', l: 'Active creators' },
          ].map((s) => (
            <div key={s.l} className="tl-stat">
              <div className="tl-stat-v">{s.v}</div>
              <div className="tl-stat-l">{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tool feature sections ────────────────────────────────────────── */}
      {TOOLS.map((tool, i) => {
        const MockupComp = MOCKUP_MAP[tool.mockup];
        return (
          <section key={tool.id} className="tl-sec tl-w">
            <div className={`tl-feat${tool.flip ? ' flip' : ''}`}>
              <div className="tl-feat-copy" data-tl={tool.flip ? 'slide-right' : 'slide-left'}>
                <div className="tl-feat-tag" style={{ background: tool.tagBg, color: tool.tagColor }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: tool.tagColor, display: 'inline-block' }} />
                  {tool.tag}
                </div>
                <h2 className="tl-h3">{tool.h3}</h2>
                <p style={{ fontSize: 15, lineHeight: 1.7, color: '#6b7280' }}>{tool.lede}</p>
                <ul className="tl-feat-bullets">
                  {tool.bullets.map((b) => (
                    <li key={b} className="tl-feat-li">
                      <div className="tl-feat-chk"><Chk /></div>
                      {b}
                    </li>
                  ))}
                </ul>
                {i === 0 && (
                  <div style={{ marginTop: 28 }}>
                    <button type="button" className="tl-btn-p" onClick={onLoginClick} style={{ fontSize: 14, padding: '12px 20px' }}>
                      Try Nova AI free <Arr />
                    </button>
                  </div>
                )}
              </div>
              <div data-tl={tool.flip ? 'slide-left' : 'slide-right'} style={{ display: 'flex', justifyContent: 'center' }}>
                <MockupComp />
              </div>
            </div>
          </section>
        );
      })}

      {/* ── How it all connects ─────────────────────────────────────────── */}
      <section className="tl-sec" style={{ paddingTop: 0 }}>
        <div className="tl-w">
          <div style={{ textAlign: 'center', marginBottom: 16 }} data-tl="fade">
            <div className="tl-ey" style={{ justifyContent: 'center' }}>
              <span className="tl-ey-dot" />Workflow
            </div>
            <h2 className="tl-h2" style={{ textAlign: 'center' }}>From idea to published in 4 steps.</h2>
            <p className="tl-h2-sub" style={{ textAlign: 'center', margin: '0 auto', maxWidth: 500 }}>
              Every tool connects seamlessly. No copy-pasting, no context switching, no tab juggling.
            </p>
          </div>

          <div style={{ position: 'relative' }}>
            <div className="tl-flow-line" />
            <div className="tl-flow">
              {[
                { emoji: '🧠', title: 'Train your brand voice', desc: 'Connect your accounts and past content. Nova AI learns what makes your brand unique.' },
                { emoji: '✍️', title: 'Generate & refine', desc: 'Nova drafts posts, captions, and visuals. You review, tweak, and approve.' },
                { emoji: '📅', title: 'Schedule everywhere', desc: 'Drag to the calendar, pick optimal times, and queue across all 6 platforms at once.' },
                { emoji: '📊', title: 'Analyze & improve', desc: 'See what drives real growth. Feed insights back to Nova for even better future content.' },
              ].map((step) => (
                <div key={step.title} className="tl-flow-step">
                  <div className="tl-flow-n">{step.emoji}</div>
                  <div className="tl-flow-ti">{step.title}</div>
                  <div className="tl-flow-d">{step.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Six tools at a glance ───────────────────────────────────────── */}
      <section className="tl-sec" style={{ background: '#f9fafb', paddingTop: 80, paddingBottom: 80 }}>
        <div className="tl-w">
          <div style={{ textAlign: 'center', marginBottom: 48 }} data-tl="fade">
            <div className="tl-ey" style={{ justifyContent: 'center' }}><span className="tl-ey-dot" />All tools</div>
            <h2 className="tl-h2" style={{ textAlign: 'center' }}>Everything, all at once.</h2>
            <p className="tl-h2-sub" style={{ textAlign: 'center', margin: '0 auto' }}>Six deeply integrated tools that work better together.</p>
          </div>
          <div className="tl-cards" data-tl="stagger">
            {[
              { ico: '✍️', bg: '#eef0fe', name: 'Nova AI', tag: 'Content generation', desc: 'AI that writes in your voice across every format and platform.' },
              { ico: '🎨', bg: '#f5f3ff', name: 'AI Studio', tag: 'Visual design', desc: 'AI image generation + drag-and-drop canvas builder with 200+ templates.' },
              { ico: '📅', bg: '#ecfdf5', name: 'Smart Scheduler', tag: 'Publishing', desc: 'Drag-and-drop content calendar with AI-powered optimal timing.' },
              { ico: '📊', bg: '#fffbeb', name: 'Analytics', tag: 'Performance', desc: 'Unified multi-platform metrics that reveal what actually drives growth.' },
              { ico: '⚡', bg: '#fff1f2', name: 'Automations', tag: 'Workflows', desc: 'Set trigger-based workflows to auto-generate and publish without lifting a finger.' },
              { ico: '👥', bg: '#f0fdf4', name: 'Team & Clients', tag: 'Collaboration', desc: 'Multi-seat workspaces, client portals, and approval flows built in.' },
            ].map((c) => (
              <div key={c.name} className="tl-card">
                <div className="tl-card-ico" style={{ background: c.bg }}>{c.ico}</div>
                <div className="tl-card-name">{c.name}</div>
                <div className="tl-card-tag">{c.tag}</div>
                <div className="tl-card-desc">{c.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Integrations ───────────────────────────────────────────────── */}
      <div className="tl-w tl-sec" style={{ paddingBottom: 0 }}>
        <div style={{ textAlign: 'center', marginBottom: 0 }} data-tl="fade">
          <div className="tl-ey" style={{ justifyContent: 'center' }}><span className="tl-ey-dot" />Integrations</div>
          <h2 className="tl-h2" style={{ textAlign: 'center' }}>Works with your whole stack.</h2>
          <p className="tl-h2-sub" style={{ textAlign: 'center', margin: '0 auto' }}>Connect the tools you already use — Dakyworld Hub plays nicely with everything.</p>
        </div>
        <div className="tl-int-g" data-tl="stagger">
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
            <div key={int.name} className="tl-int">
              <div className="tl-int-logo" style={{ background: int.bg }}>{int.label}</div>
              <div className="tl-int-n">{int.name}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <div className="tl-w tl-sec">
        <div className="tl-cta" data-tl="fade">
          <div className="tl-cta-g1" />
          <div className="tl-cta-g2" />
          <div style={{ position: 'relative' }}>
            <h2 className="tl-cta-h">
              All the tools.<br />
              <span style={{ color: '#818cf8' }}>None of the chaos.</span>
            </h2>
            <p className="tl-cta-sub">
              Join 12,000+ creators and brands who publish smarter with Dakyworld Hub. Free plan available.
            </p>
            <div className="tl-cta-btns">
              <button type="button" className="tl-btn-p" onClick={onLoginClick} style={{ boxShadow: '0 4px 18px rgba(91,108,249,.35)' }}>
                Start for free <Arr />
              </button>
              <button
                type="button"
                onClick={onLoginClick}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'transparent', color: 'rgba(255,255,255,.6)', fontSize: 15, fontWeight: 600, padding: '14px 22px', borderRadius: 12, border: '1.5px solid rgba(255,255,255,.15)', cursor: 'pointer', transition: 'all .2s' }}
              >
                View pricing
              </button>
            </div>
            <div className="tl-cta-trust">
              {['Free plan forever', 'No credit card', 'Setup in 60 seconds'].map((t) => (
                <span key={t} className="tl-cta-t">{t}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
