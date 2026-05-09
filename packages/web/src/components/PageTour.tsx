import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, HelpCircle, X } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

export type TourStep = {
  title: string;
  description: string;
  emoji?: string;
  /** CSS selector of the element to spotlight. Omit for a centred modal. */
  target?: string;
  placement?: 'center' | 'top' | 'bottom' | 'left' | 'right';
  illu?: IlluKind;
  cta?: string;
  /**
   * CSS selector of an element to click before showing this step.
   * Use to open tabs/accordions before spotlighting their content.
   * If action === target (self-action), always clicks (nav tabs).
   * If action !== target, clicks only when target is not yet in the DOM (smart toggle-safe).
   */
  action?: string;
};

type IlluKind = 'rocket' | 'nav' | 'tap' | 'chart' | 'pulse' | 'spark' | 'check' | 'mail' | 'memory';

type Props = {
  steps: TourStep[];
  pageTitle?: string;
  pageKey?: string;
  /** When true, opens the tour immediately (used after onboarding completes). */
  forceStart?: boolean;
  onForceStartConsumed?: () => void;
};

type Rect = { left: number; top: number; width: number; height: number; right: number; bottom: number };

// ── Helpers ────────────────────────────────────────────────────────────────────

function useViewport(): [number, number] {
  const [vp, setVp] = useState<[number, number]>([window.innerWidth, window.innerHeight]);
  useEffect(() => {
    const r = () => setVp([window.innerWidth, window.innerHeight]);
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);
  return vp;
}

const CARD_W = 420;
const GAP = 20;

function computePos(
  rect: Rect | null,
  placement: TourStep['placement'],
  cardH: number,
  vw: number,
  vh: number,
): { left: number; top: number; arrow: string | null; arrowX: number; arrowY: number } {
  if (!rect || placement === 'center' || placement === undefined) {
    return { left: (vw - CARD_W) / 2, top: Math.max(16, (vh - cardH) / 2), arrow: null, arrowX: 0, arrowY: 0 };
  }
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let left = 0, top = 0, arrow = placement as string;

  if (placement === 'right') {
    left = rect.right + GAP;
    top = Math.max(16, Math.min(vh - cardH - 16, cy - cardH / 2));
  } else if (placement === 'left') {
    left = rect.left - CARD_W - GAP;
    top = Math.max(16, Math.min(vh - cardH - 16, cy - cardH / 2));
  } else if (placement === 'top') {
    left = Math.max(16, Math.min(vw - CARD_W - 16, cx - CARD_W / 2));
    top = rect.top - cardH - GAP;
  } else {
    left = Math.max(16, Math.min(vw - CARD_W - 16, cx - CARD_W / 2));
    top = rect.bottom + GAP;
  }

  if (top < 16) { top = rect.bottom + GAP; arrow = 'top'; }
  if (top + cardH > vh - 16) { top = rect.top - cardH - GAP; arrow = 'bottom'; }
  if (left < 16) left = 16;
  if (left + CARD_W > vw - 16) left = vw - CARD_W - 16;

  return { left, top, arrow, arrowX: cx - left, arrowY: cy - top };
}

// ── Illustrations ──────────────────────────────────────────────────────────────

function Illu({ kind, emoji }: { kind?: IlluKind; emoji?: string }) {
  const accent = '#5B6CF9';
  const soft = 'rgba(91,108,249,0.10)';

  if (emoji && !kind) {
    return (
      <div className="tour-illu-emoji">
        <span>{emoji}</span>
      </div>
    );
  }

  const k = kind ?? 'check';

  const content: Record<IlluKind, React.ReactNode> = {
    rocket: (
      <svg viewBox="0 0 200 160" className="tour-illu-svg">
        <defs>
          <linearGradient id="il-g1" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor={accent} stopOpacity="0.18"/>
            <stop offset="1" stopColor={accent} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <rect x="20" y="20" width="160" height="120" rx="14" fill="url(#il-g1)" stroke="rgba(10,10,11,0.08)"/>
        <path d="M70 110c10-30 30-50 60-58l8 8c-8 30-28 50-58 60l-10-10z" fill="white" stroke={accent} strokeWidth="1.6"/>
        <circle cx="115" cy="78" r="6" fill={accent}/>
        <path d="M70 110l-10-2-2 12 12-2zM70 110l8 8" stroke={accent} strokeWidth="1.6" fill="none"/>
        <circle cx="40" cy="50" r="2" fill={accent}/><circle cx="160" cy="120" r="2" fill={accent}/>
      </svg>
    ),
    nav: (
      <svg viewBox="0 0 200 160" className="tour-illu-svg">
        <rect x="20" y="20" width="60" height="120" rx="10" fill="white" stroke={accent} strokeWidth="1.6"/>
        <rect x="90" y="20" width="90" height="120" rx="10" fill={soft} stroke="rgba(10,10,11,0.08)"/>
        {[0,1,2,3].map(i=>(
          <rect key={i} x="30" y={36+i*22} width={i===1?40:30} height="8" rx="3" fill={i===1?accent:'rgba(10,10,11,0.15)'}/>
        ))}
        <circle cx="135" cy="55" r="14" fill="white" stroke={accent} strokeWidth="1.6"/>
        <path d="M129 55l4 4 8-8" stroke={accent} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    tap: (
      <svg viewBox="0 0 200 160" className="tour-illu-svg">
        {[0,1,2,3].map(i=>(
          <rect key={i} x={20+i*42} y="40" width="36" height="50" rx="8" fill={i===1?accent:'white'} stroke={i===1?accent:'rgba(10,10,11,0.12)'} strokeWidth="1.6"/>
        ))}
        <circle cx="74" cy="65" r="4" fill="white"/>
        <path d="M100 110c12-4 22-4 30 0" stroke={accent} strokeWidth="2" fill="none" strokeLinecap="round"/>
        <path d="M125 105l5 5-7 4" stroke={accent} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    chart: (
      <svg viewBox="0 0 200 160" className="tour-illu-svg">
        <rect x="20" y="20" width="160" height="120" rx="12" fill="white" stroke="rgba(10,10,11,0.08)"/>
        {[36,18,52,28,68,44,80].map((h,i)=>(
          <rect key={i} x={36+i*20} y={120-h} width="10" height={h} rx="3" fill={i===4?accent:soft}/>
        ))}
        <path d="M30 100c30-20 60-10 90-30s40-10 60-20" stroke={accent} strokeWidth="2" fill="none" strokeLinecap="round"/>
      </svg>
    ),
    pulse: (
      <svg viewBox="0 0 200 160" className="tour-illu-svg">
        <rect x="20" y="40" width="160" height="80" rx="12" fill={soft} stroke="rgba(10,10,11,0.08)"/>
        <rect x="34" y="56" width="40" height="48" rx="8" fill="white" stroke={accent} strokeWidth="1.6"/>
        <rect x="80" y="56" width="40" height="48" rx="8" fill="white" stroke="rgba(10,10,11,0.12)"/>
        <rect x="126" y="56" width="40" height="48" rx="8" fill="white" stroke="rgba(10,10,11,0.12)"/>
        <text x="54" y="86" fontSize="14" fontFamily="sans-serif" fontWeight="600" textAnchor="middle" fill={accent}>2</text>
        <text x="100" y="86" fontSize="14" fontFamily="sans-serif" fontWeight="600" textAnchor="middle" fill="#0A0A0B">1</text>
        <text x="146" y="86" fontSize="14" fontFamily="sans-serif" fontWeight="600" textAnchor="middle" fill="#10B981">1</text>
      </svg>
    ),
    spark: (
      <svg viewBox="0 0 200 160" className="tour-illu-svg">
        <circle cx="100" cy="80" r="40" fill={soft}/>
        <circle cx="100" cy="80" r="28" fill={accent}/>
        <path d="M100 64v32M84 80h32M89 69l22 22M111 69l-22 22" stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
        <circle cx="50" cy="40" r="2" fill={accent}/><circle cx="160" cy="50" r="3" fill={accent}/>
        <circle cx="150" cy="120" r="2.5" fill={accent}/><circle cx="40" cy="110" r="2" fill={accent}/>
      </svg>
    ),
    check: (
      <svg viewBox="0 0 200 160" className="tour-illu-svg">
        <circle cx="100" cy="80" r="44" fill={soft}/>
        <circle cx="100" cy="80" r="30" fill={accent}/>
        <path d="M88 80l8 8 16-18" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="46" cy="44" r="3" fill={accent}/><circle cx="158" cy="56" r="2" fill={accent}/>
        <circle cx="56" cy="120" r="2.5" fill={accent}/>
      </svg>
    ),
    mail: (
      <svg viewBox="0 0 200 160" className="tour-illu-svg">
        <rect x="30" y="40" width="140" height="90" rx="12" fill="white" stroke={accent} strokeWidth="1.6"/>
        <path d="M30 55l70 45 70-45" stroke={accent} strokeWidth="1.6" fill="none" strokeLinecap="round"/>
        <circle cx="155" cy="45" r="14" fill="#EF4444"/>
        <text x="155" y="50" fontSize="13" fontFamily="sans-serif" fontWeight="700" textAnchor="middle" fill="white">3</text>
      </svg>
    ),
    memory: (
      <svg viewBox="0 0 200 160" className="tour-illu-svg">
        <circle cx="100" cy="80" r="44" fill={soft}/>
        <circle cx="100" cy="80" r="28" fill="white" stroke={accent} strokeWidth="2"/>
        <path d="M88 68c4-8 20-8 24 0s-4 16-12 20c-8-4-16-12-12-20z" fill={accent} opacity="0.7"/>
        <path d="M100 88v8" stroke={accent} strokeWidth="2" strokeLinecap="round"/>
        <circle cx="100" cy="100" r="2" fill={accent}/>
      </svg>
    ),
  };

  return (
    <div className="tour-illu">
      {content[k]}
      <span className="tour-illu-badge">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12 5 5L20 7"/>
        </svg>
      </span>
    </div>
  );
}

// ── Spotlight SVG ──────────────────────────────────────────────────────────────

function Spotlight({ rect, padding, opacity }: { rect: Rect | null; padding: number; opacity: number }) {
  const [vw, vh] = useViewport();
  if (!rect) {
    return (
      <div
        style={{
          position: 'fixed', inset: 0,
          background: `rgba(10,10,15,${opacity})`,
          pointerEvents: 'none',
        }}
      />
    );
  }
  const x = rect.left - padding;
  const y = rect.top - padding;
  const w = rect.width + padding * 2;
  const h = rect.height + padding * 2;
  const rx = 12;
  return (
    <svg
      width={vw} height={vh}
      viewBox={`0 0 ${vw} ${vh}`}
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999 }}
    >
      <defs>
        <mask id="tour-mask">
          <rect width={vw} height={vh} fill="white"/>
          <rect x={x} y={y} width={w} height={h} rx={rx} fill="black"/>
        </mask>
      </defs>
      <rect width={vw} height={vh} fill="rgba(10,10,15,1)" fillOpacity={opacity} mask="url(#tour-mask)"/>
      <rect
        x={x-1} y={y-1} width={w+2} height={h+2} rx={rx+1}
        fill="none" stroke="#5B6CF9" strokeOpacity="0.6" strokeWidth="2"
        style={{ animation: 'tourPulse 2.4s ease-in-out infinite' }}
      />
    </svg>
  );
}

// ── Tour overlay ───────────────────────────────────────────────────────────────

function TourOverlay({ steps, onClose }: { steps: TourStep[]; onClose: (skipped: boolean) => void }) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState({ left: 200, top: 200, arrow: null as string | null, arrowX: 0, arrowY: 0 });
  const [vw, vh] = useViewport();
  const [actionDone, setActionDone] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[idx];

  // Perform action (open tab/accordion) before spotlighting the target
  useEffect(() => {
    const s = steps[idx];
    if (!s?.action) { setActionDone(true); return; }

    setActionDone(false);

    // Self-action (action === target): always click (e.g. nav tab buttons always in DOM).
    // Cross-action (action !== target): only click if the target isn't already visible.
    const isSelfAction = s.action === s.target;
    const targetAlreadyVisible = !isSelfAction && !!s.target && !!document.querySelector(s.target);

    if (!targetAlreadyVisible) {
      const el = document.querySelector(s.action) as HTMLElement | null;
      el?.click();
    }

    const delay = targetAlreadyVisible ? 0 : 420;
    const t = setTimeout(() => setActionDone(true), delay);
    return () => clearTimeout(t);
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  const getTargetRect = useCallback((): Rect | null => {
    if (!actionDone) return null;
    if (!step?.target) return null;
    const el = document.querySelector(step.target);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  }, [step?.target, actionDone]);

  // Scroll spotlight target into view
  useEffect(() => {
    if (!actionDone || !step?.target) return;
    const el = document.querySelector(step.target);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [actionDone, step?.target, idx]);

  useLayoutEffect(() => {
    const update = () => setRect(getTargetRect());
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [getTargetRect, idx, vw, vh]);

  useLayoutEffect(() => {
    const cardH = cardRef.current?.offsetHeight ?? 360;
    setPos(computePos(rect, step?.placement, cardH, vw, vh));
  }, [rect, idx, vw, vh, step?.placement]);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(true);
      if (e.key === 'ArrowRight') setIdx((i) => Math.min(i + 1, steps.length - 1));
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onClose, steps.length]);

  const isLast = idx === steps.length - 1;
  const padding = step?.target ? 10 : 0;
  const hasIllu = !!(step?.illu || step?.emoji);

  return (
    <>
      <style>{`
        @keyframes tourPulse { 0%,100%{stroke-opacity:0.2}50%{stroke-opacity:0.8} }
        @keyframes tourCardIn { from{opacity:0;transform:scale(0.94) translateY(6px)} to{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes badgePop { from{transform:scale(0)} to{transform:scale(1)} }
        .tour-card-anim{animation:tourCardIn 360ms cubic-bezier(0.22,1,0.36,1)}
      `}</style>

      {/* Dim overlay */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 999, pointerEvents: 'none' }}>
        <Spotlight rect={rect} padding={padding} opacity={0.62} />
      </div>

      {/* Scrim — blocks clicks on UI behind the overlay without closing */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000 }} />

      {/* Card */}
      <div
        ref={cardRef}
        className="tour-card-anim"
        style={{
          position: 'fixed',
          left: pos.left,
          top: pos.top,
          width: CARD_W,
          background: '#fff',
          borderRadius: 18,
          boxShadow: '0 32px 80px -20px rgba(10,10,15,0.55), 0 12px 32px -12px rgba(10,10,15,0.35)',
          padding: '22px 22px 16px',
          zIndex: 1001,
          transition: 'left 280ms cubic-bezier(0.22,1,0.36,1), top 280ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        {/* Arrow nub */}
        {pos.arrow && pos.arrow !== 'center' && (
          <span style={{
            position: 'absolute',
            width: 16, height: 16,
            background: '#fff',
            transform: 'rotate(45deg)',
            zIndex: -1,
            boxShadow: '-2px -2px 4px rgba(10,10,15,0.06)',
            ...(pos.arrow === 'bottom' ? { top: -6, left: Math.max(28, Math.min(CARD_W - 28, pos.arrowX)) } :
               pos.arrow === 'top'    ? { bottom: -6, left: Math.max(28, Math.min(CARD_W - 28, pos.arrowX)) } :
               pos.arrow === 'right'  ? { left: -6, top: Math.max(20, Math.min((cardRef.current?.offsetHeight ?? 360) - 20, pos.arrowY)) } :
                                        { right: -6, top: Math.max(20, Math.min((cardRef.current?.offsetHeight ?? 360) - 20, pos.arrowY)) }),
          }} />
        )}

        {/* Close */}
        <button
          type="button"
          onClick={() => onClose(true)}
          aria-label="Skip tour"
          style={{
            position: 'absolute', top: 13, right: 13,
            width: 26, height: 26,
            borderRadius: 7, border: 0,
            background: 'transparent', color: '#8C8C90',
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#F5F5F3'; e.currentTarget.style.color = '#0A0A0B'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#8C8C90'; }}
        >
          <X size={15} />
        </button>

        {/* Body */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: hasIllu ? '150px 1fr' : '1fr',
          gap: 18,
          alignItems: 'center',
          padding: '4px 0 14px',
        }}>
          {hasIllu && <Illu kind={step?.illu} emoji={step?.emoji} />}
          <div>
            <div style={{
              display: 'inline-flex',
              fontFamily: 'ui-monospace, monospace',
              fontSize: 9.5,
              letterSpacing: '0.12em',
              color: '#5B6CF9',
              background: 'rgba(91,108,249,0.10)',
              padding: '3px 9px',
              borderRadius: 5,
              marginBottom: 12,
              fontWeight: 600,
            }}>
              STEP {String(idx + 1).padStart(2, '0')}
              <span style={{ color: '#8C8C90', marginLeft: 3, fontWeight: 500 }}> / {String(steps.length).padStart(2, '0')}</span>
            </div>
            <h3 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2, margin: '0 0 8px', color: '#0A0A0B' }}>
              {step?.title}
            </h3>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: '#5C5C60' }}>
              {step?.description}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid rgba(10,10,11,0.07)', gap: 10 }}>
          {/* Dots */}
          <div style={{ display: 'inline-flex', gap: 5 }}>
            {steps.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIdx(i)}
                aria-label={`Go to step ${i + 1}`}
                style={{
                  width: i === idx ? 20 : 6, height: 6,
                  borderRadius: i === idx ? 3 : '50%',
                  background: i === idx ? '#5B6CF9' : i < idx ? '#B8B8BC' : '#ECECE8',
                  border: 0, padding: 0, cursor: 'pointer',
                  transition: 'width 200ms ease, background 200ms ease',
                }}
              />
            ))}
          </div>
          {/* Actions */}
          <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            {!isLast && (
              <button
                type="button"
                onClick={() => onClose(true)}
                style={{ background: 'transparent', border: 0, color: '#8C8C90', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', padding: '7px 9px', borderRadius: 7, fontFamily: 'inherit' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#0A0A0B'; e.currentTarget.style.background = '#F5F5F3'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#8C8C90'; e.currentTarget.style.background = 'transparent'; }}
              >
                Skip tour
              </button>
            )}
            {idx > 0 && (
              <button
                type="button"
                onClick={() => setIdx((i) => i - 1)}
                style={{ background: 'transparent', border: 0, color: '#8C8C90', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', padding: '7px 9px', borderRadius: 7, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#0A0A0B'; e.currentTarget.style.background = '#F5F5F3'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#8C8C90'; e.currentTarget.style.background = 'transparent'; }}
              >
                <ArrowLeft size={11} /> Back
              </button>
            )}
            <button
              type="button"
              onClick={() => isLast ? onClose(false) : setIdx((i) => i + 1)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: '#5B6CF9', color: '#fff', border: 0,
                padding: '8px 15px', borderRadius: 9,
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                boxShadow: '0 5px 16px -5px rgba(91,108,249,0.65)',
                fontFamily: 'inherit',
                transition: 'transform 150ms, box-shadow 150ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 20px -5px rgba(91,108,249,0.7)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 5px 16px -5px rgba(91,108,249,0.65)'; }}
            >
              {isLast ? (step?.cta ?? 'Get started') : 'Next'}
              {!isLast && <ArrowRight size={13} />}
            </button>
          </div>
        </div>
      </div>

      {/* Illustration styles */}
      <style>{`
        .tour-illu {
          position: relative; width: 150px; height: 120px; border-radius: 12px;
          background: #F5F5F3; border: 1px solid rgba(10,10,11,0.07);
          display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;
        }
        .tour-illu-svg { width: 100%; height: 100%; }
        .tour-illu-emoji {
          width: 150px; height: 120px; border-radius: 12px;
          background: rgba(91,108,249,0.06); border: 1px solid rgba(91,108,249,0.12);
          display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 44px;
        }
        .tour-illu-badge {
          position: absolute; top: -7px; right: -7px;
          width: 26px; height: 26px; border-radius: 50%;
          background: #5B6CF9; display: inline-flex; align-items: center; justify-content: center;
          box-shadow: 0 0 0 3px #fff, 0 6px 18px -4px rgba(91,108,249,0.55);
          animation: badgePop 500ms cubic-bezier(0.22,1,0.36,1) 160ms backwards;
        }
      `}</style>
    </>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export default function PageTour({ steps, pageTitle, pageKey, forceStart, onForceStartConsumed }: Props) {
  const storageKey = `tour_seen_${pageKey ?? pageTitle?.toLowerCase().replace(/\s+/g, '-') ?? 'page'}`;
  const [active, setActive] = useState(false);
  const [everSeen, setEverSeen] = useState(() => localStorage.getItem(storageKey) === '1');

  // Auto-start on first visit (only when not triggered by forceStart, to avoid double-fire)
  useEffect(() => {
    if (!forceStart && !everSeen && steps.length > 0) {
      const t = setTimeout(() => setActive(true), 450);
      return () => clearTimeout(t);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // forceStart: triggered after onboarding completes
  useEffect(() => {
    if (forceStart && steps.length > 0) {
      const t = setTimeout(() => setActive(true), 300);
      return () => clearTimeout(t);
    }
  }, [forceStart, steps.length]);

  const handleClose = (skipped: boolean) => {
    setActive(false);
    onForceStartConsumed?.();
    if (!skipped) {
      localStorage.setItem(storageKey, '1');
      setEverSeen(true);
    }
  };

  if (!steps.length) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setActive(true)}
        title={`Quick guide${pageTitle ? ` — ${pageTitle}` : ''}`}
        className="fixed bottom-20 right-5 z-40 flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white shadow-md text-gray-400 hover:text-indigo-600 hover:border-indigo-300 transition-all"
      >
        <HelpCircle size={16} />
      </button>

      {active && <TourOverlay steps={steps} onClose={handleClose} />}
    </>
  );
}

// ── Page guides ────────────────────────────────────────────────────────────────

export const PAGE_GUIDES: Record<string, { title: string; steps: TourStep[] }> = {
  dashboard: {
    title: 'Dashboard',
    steps: [
      { emoji: '🏠', illu: 'rocket', title: 'Your command centre', description: 'The dashboard shows your key stats, scheduled posts, upcoming tasks, and live activity from your AI agent team.', target: '[data-tour-id="nav-dashboard"]', placement: 'right' },
      { emoji: '📊', illu: 'chart', title: 'Stats at a glance', description: 'The top row shows your total posts, scheduled items, and connected social accounts. Click any card to drill into that section.' },
      { emoji: '🤖', illu: 'spark', title: 'Agent activity feed', description: 'The right column shows what your agents (Nova, Sage, Aria, Flux) are learning and doing for your brand in real time.' },
      { emoji: '💬', illu: 'check', title: 'Chat with Daky', description: 'Click the chat bubble in the bottom-right corner to open your AI marketing butler. Ask anything — content ideas, strategies, analytics.', cta: 'Get started' },
    ],
  },
  posts: {
    title: 'Posts',
    steps: [
      { emoji: '✍️', illu: 'tap', title: 'Create your first post', description: 'Click "New Post" to open the editor. Write your content, add images, and choose which social accounts to publish to.', target: '[data-tour-id="nav-content"]', placement: 'right' },
      { emoji: '📅', illu: 'chart', title: 'Schedule for later', description: 'Instead of publishing immediately, pick a date and time to schedule your post. It will be queued and published automatically.' },
      { emoji: '🔄', illu: 'pulse', title: 'Platform previews', description: 'Each platform (Twitter, LinkedIn, Instagram) has character limits and format rules. The editor shows a live preview per platform.' },
      { emoji: '🤖', illu: 'spark', title: 'AI-assisted writing', description: 'Open the Daky chat and say "Write me a LinkedIn post about X" — the AI will create a draft you can edit and schedule directly.', cta: 'Got it' },
    ],
  },
  tasks: {
    title: 'Tasks',
    steps: [
      { emoji: '📋', illu: 'pulse', title: 'Kanban board', description: 'Tasks are organised by status: Backlog → In Progress → Review → Done. Drag cards between columns to update status.' },
      { emoji: '➕', illu: 'tap', title: 'Create a task', description: 'Click the + button in any column or "New Task" at the top. Give it a title, description, priority, and due date + time.' },
      { emoji: '👤', illu: 'nav', title: 'Assign team members', description: 'Open any task and use the Assignees field to assign it to members. Assignees get alerted 1 day before the due date automatically.' },
      { emoji: '🏷️', illu: 'check', title: 'Labels and priority', description: 'Use labels to tag tasks by type (e.g. "Design", "Copy"). Priority levels (Low/Medium/High/Urgent) appear as coloured indicators.', cta: 'Got it' },
    ],
  },
  memory: {
    title: 'Memory',
    steps: [
      { emoji: '🧠', illu: 'memory', title: 'Your brand memory', description: 'Memory items are facts about your brand that Daky and all 5 agents read before every response. The more you add, the better the advice.' },
      { emoji: '➕', illu: 'tap', title: 'Add a memory item', description: 'Click "Add Memory" and write anything relevant — your niche, target audience, tone of voice, key products, competitors, or campaign goals.' },
      { emoji: '🤖', illu: 'spark', title: 'AI-generated memory', description: 'Click "Generate with AI" to let Daky ask you questions and automatically fill in your brand profile based on your answers.' },
      { emoji: '⚡', illu: 'check', title: 'Agent compilation', description: 'Every time you save a memory item, all 5 agents automatically recompile their skills — so the next chat is already smarter.', cta: 'Got it' },
    ],
  },
  integrations: {
    title: 'Integrations',
    steps: [
      { emoji: '🔌', illu: 'nav', title: 'Connect your socials', description: 'Connect Twitter/X, Instagram, LinkedIn, Facebook, and more. Each connection enables scheduling, publishing, and AI insights for that platform.', target: '[data-tour-id="nav-integrations"]', placement: 'right' },
      { emoji: '🔐', illu: 'tap', title: 'OAuth login', description: "Clicking \"Connect\" opens a secure OAuth flow on the platform's website. You approve access — no passwords are stored." },
      { emoji: '🧠', illu: 'memory', title: 'Auto memory', description: 'On first connection, your profile (handle, follower count, bio) is automatically saved to your Memory so agents know your social presence.' },
      { emoji: '♻️', illu: 'check', title: 'Refresh tokens', description: 'Tokens expire over time. If a platform shows "Reconnect", click it to refresh your token without losing any settings.', cta: 'Got it' },
    ],
  },
  analytics: {
    title: 'Analytics',
    steps: [
      { emoji: '📈', illu: 'chart', title: 'Performance overview', description: 'View publishing trends, engagement metrics, and growth data across all your connected social accounts in one place.', target: '[data-tour-id="nav-analytics"]', placement: 'right' },
      { emoji: '📆', illu: 'tap', title: 'Date range filter', description: 'Use the date picker to compare performance across different time periods — last 7 days, last month, or a custom range.' },
      { emoji: '🤖', illu: 'spark', title: 'Ask Aria', description: 'Open the Daky chat and ask "What do my analytics say?" — Aria, the analytics agent, will interpret your numbers and suggest improvements.', cta: 'Got it' },
    ],
  },
  cards: {
    title: 'Cards',
    steps: [
      { emoji: '🎨', illu: 'tap', title: 'Visual card builder', description: 'Create stunning social media graphics, announcement cards, and promotional visuals using the drag-and-drop canvas editor.', target: '[data-tour-id="nav-content"]', placement: 'right' },
      { emoji: '📐', illu: 'pulse', title: 'Canvas presets', description: 'Choose from preset sizes for Instagram (1080×1080), LinkedIn, Twitter, TikTok, or set a custom canvas size.' },
      { emoji: '🖼️', illu: 'nav', title: 'Add elements', description: 'Use the left panel to add text, shapes, images, and lines. The right panel lets you control position, size, color, and font.' },
      { emoji: '💾', illu: 'check', title: 'Export your design', description: 'Click "Export" to download your card as PNG or JPG at high resolution. Save designs to your library for re-use.', cta: 'Got it' },
    ],
  },
  mailing: {
    title: 'Mailing',
    steps: [
      { emoji: '📧', illu: 'mail', title: 'Email campaigns', description: 'Create and send email campaigns to your subscriber list. Write your content in the rich-text editor or use Daky to generate copy.', target: '[data-tour-id="nav-mailing"]', placement: 'right' },
      { emoji: '👥', illu: 'nav', title: 'Contact management', description: 'Import contacts via CSV or add them manually. Segment your list with tags to target specific groups.' },
      { emoji: '📊', illu: 'chart', title: 'Campaign analytics', description: 'After sending, track open rates, click rates, and unsubscribes directly in the campaign detail view.', cta: 'Got it' },
    ],
  },
  campaign: {
    title: 'Campaigns',
    steps: [
      { emoji: '🎯', illu: 'rocket', title: 'What is a campaign?', description: 'A campaign groups related posts, emails, and tasks under a single goal (e.g. a product launch or seasonal promotion).', target: '[data-tour-id="nav-campaign"]', placement: 'right' },
      { emoji: '➕', illu: 'tap', title: 'Create a campaign', description: 'Click "New Campaign", set a name, goal, start/end date, and add the content pieces you want to track together.' },
      { emoji: '📌', illu: 'pulse', title: 'Track progress', description: 'The campaign overview shows which content is drafted, scheduled, and live — giving you a full picture of your campaign status.', cta: 'Got it' },
    ],
  },
  'project-settings': {
    title: 'Project Settings',
    steps: [
      { emoji: '⚙️', illu: 'nav', title: 'General settings', description: 'The General tab lets you rename the project, change its colour, and update the description. Only owners and admins can make changes.' },
      { emoji: '👥', illu: 'pulse', title: 'Team tab', description: 'Switch to the Team tab to see all org members and their roles. You can invite new people here with a single email.' },
      { emoji: '📬', illu: 'mail', title: 'Invite by email', description: "Enter a colleague's email, choose their role (Viewer / Editor / Admin), and click Invite. They'll receive a link to join." },
      { emoji: '🗑️', illu: 'check', title: 'Danger zone', description: 'The General tab has a Danger Zone at the bottom. Deleting a project removes all its tasks permanently — type the project name to confirm.', cta: 'Got it' },
    ],
  },
  admin: {
    title: 'Admin',
    steps: [
      { emoji: '🧑‍🤝‍🧑', illu: 'nav', title: 'User Management', description: 'View all registered users, their plans, and last active dates. You can promote users to admin or suspend accounts from here.', action: '[data-tour-id="admin-tab-users"]', target: '[data-tour-id="admin-tab-users"]', placement: 'right' },
      { emoji: '💳', illu: 'chart', title: 'Billing & Subscriptions', description: 'See MRR, ARR, active subscriptions, and recent transactions. Drill into individual payments from the Subscriptions tab.', action: '[data-tour-id="admin-tab-billing"]', target: '[data-tour-id="admin-tab-billing"]', placement: 'right' },
      { emoji: '🤖', illu: 'spark', title: 'AI Configuration', description: 'Set your Anthropic or Google Gemini API key, choose the model, and customise the system prompt that Daky uses for all responses.', action: '[data-tour-id="admin-accordion-ai"]', target: '[data-tour-id="admin-tab-ai-config"]', placement: 'right' },
      { emoji: '🎓', illu: 'memory', title: 'Daky Learn', description: 'Add article and video URLs for Daky to extract marketing insights from. Compile them into AI skills that improve all user responses.', action: '[data-tour-id="admin-accordion-ai"]', target: '[data-tour-id="admin-tab-learn"]', placement: 'right' },
      { emoji: '🧠', illu: 'pulse', title: 'Agent Team', description: 'Edit the base system prompt for each of the 5 agents (Daky, Nova, Sage, Aria, Flux). Changes take effect on the next compilation.', action: '[data-tour-id="admin-accordion-ai"]', target: '[data-tour-id="admin-tab-agents"]', placement: 'right', cta: 'Got it' },
    ],
  },
  billing: {
    title: 'Billing',
    steps: [
      { emoji: '💳', illu: 'chart', title: 'Your current plan', description: 'This page shows your active subscription, next billing date, and the features included in your plan.', target: '[data-tour-id="nav-billing"]', placement: 'right' },
      { emoji: '⬆️', illu: 'rocket', title: 'Upgrade', description: 'Click "Upgrade" to move to a higher tier and unlock more posts, agents, team seats, and analytics.' },
      { emoji: '🔄', illu: 'check', title: 'Manage subscription', description: 'Cancel, pause, or change your plan at any time. Changes take effect at the end of your current billing period.', cta: 'Got it' },
    ],
  },
  workspace: {
    title: 'Workspace',
    steps: [
      { emoji: '🏢', illu: 'nav', title: 'Your organisation', description: "The workspace shows your organisation's name, logo, and all member roles. You can rename the org or update its description here." },
      { emoji: '👥', illu: 'pulse', title: 'Member roles', description: 'Owners can do everything. Admins can manage members and projects. Editors can create and edit content. Viewers can only read.' },
      { emoji: '📬', illu: 'mail', title: 'Invitations', description: "Pending invitations appear in the Invitations tab. You can resend or cancel invites that haven't been accepted yet.", cta: 'Got it' },
    ],
  },
};
