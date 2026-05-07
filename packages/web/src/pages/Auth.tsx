import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AppUser, normalizeUser } from '../utils/userSession';
import { API_BASE_URL } from '../utils/apiBase';

type AuthProps = { onLogin: (user: AppUser) => void };
type AuthResponse = {
  success: boolean; error?: string; token?: string;
  user?: Partial<AppUser> & { id?: string; email?: string };
};

declare global {
  interface Window {
    fbAsyncInit?: () => void;
    FB?: {
      init(p: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
      login(cb: (r: FBLoginResponse) => void, opts?: { scope: string }): void;
      getLoginStatus(cb: (r: FBLoginResponse) => void): void;
      AppEvents: { logPageView(): void };
    };
  }
}
interface FBLoginResponse {
  status: 'connected' | 'not_authorized' | 'unknown';
  authResponse?: { accessToken: string; userID: string };
}
interface SocialProvider { provider: string; clientId: string }

const safeJson = async <T,>(r: Response): Promise<{ data: T | null; rawText: string }> => {
  const rawText = await r.text().catch(() => '');
  try { return { data: JSON.parse(rawText) as T, rawText }; }
  catch { return { data: null, rawText }; }
};

const FB_APP_ID = (import.meta.env.VITE_FACEBOOK_APP_ID as string | undefined) || '';

// ─── Scoped CSS ───────────────────────────────────────────────────────────────
const AUTH_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;450;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

.da-root {
  --da-bg: #FBFBFA;
  --da-bg-2: #F4F4F2;
  --da-bg-3: #ECECE8;
  --da-ink: #0A0A0B;
  --da-ink-2: #2A2A2C;
  --da-ink-3: #5C5C60;
  --da-ink-4: #8C8C90;
  --da-rule: rgba(10,10,11,0.08);
  --da-rule-strong: rgba(10,10,11,0.14);
  --da-accent: #5B6CF9;
  --da-accent-soft: rgba(91,108,249,0.10);
  --da-accent-glow: rgba(91,108,249,0.35);
  --da-green: #10B981;
  --da-ease: cubic-bezier(0.22,1,0.36,1);
  font-family: 'Geist', -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: "ss01","cv11";
}

.da-root * { box-sizing: border-box; }

.da-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--da-bg);
  position: relative;
  overflow: hidden;
}

.da-bg-orbs { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.da-bg-orbs .da-o1 { position: absolute; width: 520px; height: 520px; left: -10%; top: -20%; border-radius: 50%; filter: blur(100px); background: radial-gradient(circle, rgba(91,108,249,0.25), transparent 65%); }
.da-bg-orbs .da-o2 { position: absolute; width: 480px; height: 480px; right: -8%; bottom: -22%; border-radius: 50%; filter: blur(100px); background: radial-gradient(circle, rgba(181,192,255,0.45), transparent 65%); }

.da-card {
  position: relative; z-index: 1;
  width: 100%; max-width: 1040px; min-height: 600px;
  background: #fff;
  border: 1px solid var(--da-rule);
  border-radius: 28px;
  box-shadow: 0 1px 0 rgba(255,255,255,0.6) inset, 0 30px 80px -30px rgba(10,10,11,0.18), 0 12px 30px -12px rgba(10,10,11,0.10);
  display: grid;
  grid-template-columns: 1fr 1.05fr;
  overflow: hidden;
}

/* Visual pane */
.da-visual {
  position: relative;
  margin: 14px;
  border-radius: 20px;
  overflow: hidden;
  background:
    radial-gradient(120% 80% at 80% 90%, rgba(255,255,255,0.55), transparent 55%),
    radial-gradient(80% 60% at 30% 30%, #C9D2FF 0%, transparent 60%),
    radial-gradient(120% 90% at 20% 70%, #5B6CF9 0%, #7E5BF9 35%, #9D7BFF 60%, #D5DDFF 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 32px;
  isolation: isolate;
}
.da-visual::before {
  content: "";
  position: absolute; inset: 0;
  background: radial-gradient(circle at 70% 25%, rgba(255,255,255,0.38), transparent 35%), radial-gradient(circle at 25% 80%, rgba(91,108,249,0.45), transparent 50%);
  mix-blend-mode: screen;
  pointer-events: none;
}
.da-visual::after {
  content: "";
  position: absolute; inset: 0;
  background-image: linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: radial-gradient(circle at 60% 40%, transparent 30%, black 80%);
  -webkit-mask-image: radial-gradient(circle at 60% 40%, transparent 30%, black 80%);
  pointer-events: none; opacity: 0.5;
}
.da-vp-mark { width: 44px; height: 44px; position: relative; z-index: 1; }
.da-vp-mark svg { width: 100%; height: 100%; filter: drop-shadow(0 2px 12px rgba(255,255,255,0.4)); }

.da-floats { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
.da-float {
  position: absolute;
  background: rgba(255,255,255,0.95);
  border: 1px solid rgba(255,255,255,0.6);
  border-radius: 12px; padding: 10px 12px;
  box-shadow: 0 12px 32px -12px rgba(20,20,40,0.35);
  backdrop-filter: blur(12px);
  color: var(--da-ink);
  animation: daFloat 6s ease-in-out infinite;
}
.da-f1 { top: 32%; right: 8%; width: 200px; animation-delay: 0s; }
.da-f2 { top: 56%; left: 10%; width: 180px; animation-delay: -2.5s; }
@keyframes daFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
.da-float .da-fh { display: flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono',monospace; font-size: 10px; color: var(--da-ink-3); text-transform: uppercase; letter-spacing: 0.04em; }
.da-float .da-fh .da-pdot { width: 14px; height: 14px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; color: white; font-size: 8px; font-weight: 700; }
.da-float .da-fb { font-size: 11.5px; color: var(--da-ink); margin-top: 6px; line-height: 1.4; font-weight: 450; }
.da-float .da-fm { font-family: 'JetBrains Mono',monospace; font-size: 9.5px; color: var(--da-ink-4); margin-top: 6px; display: flex; gap: 6px; }
.da-float .da-pill { background: var(--da-bg-2); border-radius: 4px; padding: 1px 5px; }

.da-vp-foot { position: relative; z-index: 1; max-width: 380px; }
.da-vp-eyebrow { font-family: 'JetBrains Mono',monospace; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(255,255,255,0.78); display: inline-flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.da-vp-eyebrow::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #fff; box-shadow: 0 0 12px rgba(255,255,255,0.7); }
.da-vp-h { font-size: clamp(24px,2.6vw,32px); font-weight: 500; letter-spacing: -0.025em; line-height: 1.15; color: #fff; margin: 0; }
.da-vp-h em { font-style: normal; color: rgba(255,255,255,0.78); }
.da-vp-meta { display: flex; gap: 18px; margin-top: 20px; flex-wrap: wrap; font-family: 'JetBrains Mono',monospace; font-size: 11px; color: rgba(255,255,255,0.7); }
.da-vp-meta span { display: inline-flex; align-items: center; gap: 6px; }
.da-vp-check { width: 14px; height: 14px; border-radius: 50%; background: rgba(255,255,255,0.2); color: #fff; display: inline-flex; align-items: center; justify-content: center; }

/* Form pane */
.da-form-pane { padding: clamp(32px,5vw,60px); display: flex; flex-direction: column; justify-content: center; gap: 20px; position: relative; overflow-y: auto; max-height: 100%; }
.da-mark { width: 28px; height: 28px; color: var(--da-accent); }
.da-mark svg { width: 100%; height: 100%; }

.da-back { position: absolute; top: 20px; right: 20px; font-size: 12.5px; color: var(--da-ink-3); text-decoration: none; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 8px; transition: all 160ms; background: transparent; border: none; cursor: pointer; font-family: inherit; }
.da-back:hover { background: var(--da-bg-2); color: var(--da-ink); }

.da-tabs { display: inline-flex; gap: 4px; padding: 4px; background: var(--da-bg-2); border: 1px solid var(--da-rule); border-radius: 10px; width: fit-content; }
.da-tab { padding: 7px 14px; border: 0; background: transparent; font-family: inherit; font-size: 12.5px; font-weight: 500; color: var(--da-ink-3); border-radius: 7px; cursor: pointer; transition: all 200ms var(--da-ease); }
.da-tab:hover { color: var(--da-ink); }
.da-tab.active { background: #fff; color: var(--da-ink); box-shadow: 0 1px 2px rgba(10,10,11,0.06), 0 0 0 1px var(--da-rule); }

.da-form-h { font-size: clamp(26px,3vw,34px); font-weight: 500; letter-spacing: -0.025em; line-height: 1.1; margin: 0; color: var(--da-ink); }
.da-form-sub { color: var(--da-ink-3); font-size: 14.5px; margin: 0; max-width: 380px; line-height: 1.55; }

.da-field-group { display: flex; flex-direction: column; gap: 12px; }
.da-field { display: flex; flex-direction: column; gap: 5px; }
.da-field label { font-size: 13px; font-weight: 500; color: var(--da-ink-2); letter-spacing: -0.005em; }
.da-input-wrap { position: relative; display: flex; align-items: center; }
.da-input-wrap input { width: 100%; height: 44px; padding: 0 14px; border: 1px solid var(--da-rule-strong); border-radius: 10px; background: #fff; font-family: inherit; font-size: 14px; color: var(--da-ink); transition: border-color 180ms, box-shadow 180ms; outline: none; }
.da-input-wrap input::placeholder { color: var(--da-ink-4); }
.da-input-wrap input:hover { border-color: var(--da-ink-4); }
.da-input-wrap input:focus { border-color: var(--da-accent); box-shadow: 0 0 0 4px var(--da-accent-soft); }
.da-input-wrap.has-icon input { padding-right: 42px; }
.da-eye-btn { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 28px; height: 28px; border: 0; background: transparent; border-radius: 6px; color: var(--da-ink-4); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: color 160ms, background 160ms; }
.da-eye-btn:hover { color: var(--da-ink); background: var(--da-bg-2); }

.da-pwd-bars { display: flex; gap: 4px; margin-top: 6px; }
.da-pwd-bar { flex: 1; height: 3px; background: var(--da-bg-3); border-radius: 2px; transition: background 240ms; }
.da-pwd-bar.s1 { background: #EF4444; }
.da-pwd-bar.s2 { background: #F59E0B; }
.da-pwd-bar.s3 { background: var(--da-accent); }
.da-pwd-bar.s4 { background: var(--da-green); }
.da-pwd-hint { margin-top: 4px; font-size: 11.5px; color: var(--da-ink-4); font-family: 'JetBrains Mono',monospace; }

.da-row-between { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.da-checkbox { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: var(--da-ink-2); user-select: none; }
.da-checkbox input { display: none; }
.da-box { width: 16px; height: 16px; border: 1px solid var(--da-rule-strong); border-radius: 4px; background: #fff; display: inline-flex; align-items: center; justify-content: center; transition: all 160ms; flex-shrink: 0; }
.da-checkbox input:checked ~ .da-box { background: var(--da-ink); border-color: var(--da-ink); color: #fff; }
.da-box svg { opacity: 0; transition: opacity 160ms; }
.da-checkbox input:checked ~ .da-box svg { opacity: 1; }
.da-link { font-size: 13px; color: var(--da-ink-3); text-decoration: none; transition: color 160ms; }
.da-link:hover { color: var(--da-accent); }
.da-link-accent { color: var(--da-ink-2); text-decoration: underline; text-decoration-color: var(--da-rule-strong); }
.da-link-accent:hover { color: var(--da-accent); }

.da-submit {
  width: 100%; height: 48px; border-radius: 12px; border: 0;
  background: var(--da-accent); color: white; font-family: inherit;
  font-size: 14.5px; font-weight: 500; letter-spacing: -0.005em;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  transition: transform 180ms var(--da-ease), box-shadow 200ms, background 200ms;
  box-shadow: 0 8px 20px -8px var(--da-accent-glow), inset 0 1px 0 rgba(255,255,255,0.15);
}
.da-submit:hover { box-shadow: 0 14px 32px -10px var(--da-accent-glow), inset 0 1px 0 rgba(255,255,255,0.2); filter: brightness(1.06); }
.da-submit:active { transform: scale(0.985); }
.da-submit .da-arrow { transition: transform 220ms var(--da-ease); }
.da-submit:hover .da-arrow { transform: translateX(3px); }
.da-submit:disabled { pointer-events: none; opacity: 0.82; }
.da-spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff; border-radius: 50%; animation: daSpin 0.8s linear infinite; }
@keyframes daSpin { to { transform: rotate(360deg); } }

.da-divider { display: flex; align-items: center; gap: 12px; color: var(--da-ink-4); font-size: 11.5px; font-family: 'JetBrains Mono',monospace; text-transform: uppercase; letter-spacing: 0.04em; }
.da-divider::before,.da-divider::after { content: ""; flex: 1; height: 1px; background: var(--da-rule); }

.da-oauth-row { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; }
.da-oauth-btn { height: 42px; border-radius: 10px; border: 1px solid var(--da-rule-strong); background: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-family: inherit; font-size: 13px; font-weight: 500; color: var(--da-ink); transition: all 180ms var(--da-ease); }
.da-oauth-btn:hover { border-color: var(--da-ink-2); background: var(--da-bg-2); transform: translateY(-1px); }
.da-oauth-btn:disabled { opacity: 0.6; pointer-events: none; }
.da-oauth-btn svg { width: 15px; height: 15px; }

.da-switch { text-align: center; font-size: 13.5px; color: var(--da-ink-3); }
.da-switch button { color: var(--da-accent); background: none; border: none; font-weight: 500; cursor: pointer; font-family: inherit; font-size: inherit; }
.da-switch button:hover { text-decoration: underline; }

.da-err { font-size: 12.5px; color: #B91C1C; background: #FEE2E2; border: 1px solid #FECACA; border-radius: 8px; padding: 8px 12px; display: flex; align-items: center; gap: 8px; animation: daIn 240ms var(--da-ease); }

.da-form-state { animation: daIn 360ms var(--da-ease); }
@keyframes daIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }

.da-success { text-align: center; padding: 40px 20px; animation: daIn 400ms var(--da-ease); }
.da-tick { width: 56px; height: 56px; margin: 0 auto 18px; border-radius: 50%; background: var(--da-accent-soft); color: var(--da-accent); display: flex; align-items: center; justify-content: center; animation: daTick 600ms var(--da-ease); }
@keyframes daTick { 0%{transform:scale(0)} 60%{transform:scale(1.2)} 100%{transform:scale(1)} }
.da-success h2 { font-size: 26px; font-weight: 500; letter-spacing: -0.02em; margin: 0 0 8px; color: var(--da-ink); }
.da-success p { color: var(--da-ink-3); margin: 0 auto; max-width: 320px; font-size: 14px; line-height: 1.6; }

@media (max-width: 880px) {
  .da-card { grid-template-columns: 1fr; }
  .da-visual { display: none; }
}
`;

const STRENGTH_LABEL = ['', 'Weak', 'Fair', 'Good', 'Strong'];
function pwdScore(p: string) {
  if (!p) return 0;
  let s = 0;
  if (p.length >= 6) s++;
  if (p.length >= 10) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(4, s) as 0 | 1 | 2 | 3 | 4;
}

function AsteriskMark({ color = '#fff' }: { color?: string }) {
  return (
    <svg viewBox="0 0 44 44" fill="none">
      <g stroke={color} strokeWidth="5.5" strokeLinecap="round">
        <line x1="22" y1="6" x2="22" y2="38"/>
        <line x1="8.5" y1="13" x2="35.5" y2="31"/>
        <line x1="35.5" y1="13" x2="8.5" y2="31"/>
      </g>
    </svg>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return open
    ? <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2 L14 14 M5.5 5.5 C4 6.5 2.5 8 2.5 8 C2.5 8 5 12 8 12 C9 12 9.9 11.7 10.7 11.2 M11 6 C12.5 7 13.5 8 13.5 8 C13.5 8 11 12 8 12" stroke="currentColor" strokeLinecap="round"/></svg>
    : <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2.5 8 C2.5 8 5 4 8 4 C11 4 13.5 8 13.5 8 C13.5 8 11 12 8 12 C5 12 2.5 8 2.5 8 Z" stroke="currentColor"/><circle cx="8" cy="8" r="2" stroke="currentColor"/></svg>;
}

function CheckSvg() {
  return <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5 L3.5 6.5 L7.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function VisualPane({ mode }: { mode: 'login' | 'signup' }) {
  const copy = {
    signup: { eb: 'Welcome to Daky', h: <>Get access to your <em>AI content strategist</em> — always on, always learning.</> },
    login: { eb: 'Welcome back', h: <>Pick up where you left off — your <em>content brain</em> kept everything warm.</> },
  }[mode];
  return (
    <div className="da-visual">
      <div className="da-vp-mark"><AsteriskMark /></div>
      <div className="da-floats">
        <div className="da-float da-f1">
          <div className="da-fh"><span className="da-pdot" style={{ background: 'linear-gradient(135deg,#FEDA77,#F58529,#DD2A7B)' }}>IG</span>Instagram · scheduled</div>
          <div className="da-fb">"Q2 just dropped — here's what 50K creators learned about hooks…"</div>
          <div className="da-fm"><span className="da-pill">9:14 AM</span><span className="da-pill">+3 tags</span></div>
        </div>
        <div className="da-float da-f2">
          <div className="da-fh"><span className="da-pdot" style={{ background: '#0A66C2' }}>in</span>LinkedIn · draft</div>
          <div className="da-fb">"We spent 6 months testing pricing pages…"</div>
          <div className="da-fm"><span className="da-pill">Tue 7:30</span></div>
        </div>
      </div>
      <div className="da-vp-foot">
        <div className="da-vp-eyebrow">{copy.eb}</div>
        <h2 className="da-vp-h">{copy.h}</h2>
        <div className="da-vp-meta">
          <span><span className="da-vp-check"><CheckSvg /></span> 6 platforms</span>
          <span><span className="da-vp-check"><CheckSvg /></span> AI that learns</span>
          <span><span className="da-vp-check"><CheckSvg /></span> Free forever</span>
        </div>
      </div>
    </div>
  );
}

function Auth({ onLogin }: AuthProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [socialProviders, setSocialProviders] = useState<SocialProvider[]>([]);
  const [fbReady, setFbReady] = useState(false);
  const [fbLoginLoading, setFbLoginLoading] = useState(false);
  const [fbStatus, setFbStatus] = useState<'connected' | 'not_authorized' | 'unknown' | null>(null);
  const fbCachedToken = useRef<string | null>(null);
  const fbInitialized = useRef(false);

  // Login state
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPwd, setShowLoginPwd] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Signup state
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [showSignupPwd, setShowSignupPwd] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(true);

  const pwdStrength = useMemo(() => pwdScore(signupPassword), [signupPassword]);

  const switchMode = (m: 'login' | 'signup') => { setMode(m); setErrorMessage(null); };

  // ── Facebook SDK ────────────────────────────────────────────────────────────
  const exchangeFbToken = (accessToken: string) => {
    fetch(`${API_BASE_URL}/api/auth/facebook/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    })
      .then(r => r.json())
      .then((data: AuthResponse & { user?: { id: string; email: string; name?: string; role?: string } }) => {
        if (data.success && data.token && data.user) {
          localStorage.setItem('auth_token', data.token);
          onLogin(normalizeUser({ id: data.user.id, email: data.user.email, name: data.user.name ?? null, username: null, phone: null, country: null, role: data.user.role === 'admin' ? 'admin' : 'user' }));
        } else { setErrorMessage(data.error || 'Facebook login failed'); }
      })
      .catch(() => setErrorMessage('Facebook authentication failed.'))
      .finally(() => setFbLoginLoading(false));
  };

  useEffect(() => {
    if (!FB_APP_ID || fbInitialized.current) return;
    fbInitialized.current = true;
    window.fbAsyncInit = function () {
      window.FB!.init({ appId: FB_APP_ID, cookie: true, xfbml: true, version: 'v18.0' });
      window.FB!.AppEvents.logPageView();
      window.FB!.getLoginStatus(r => {
        setFbStatus(r.status); setFbReady(true);
        if (r.status === 'connected' && r.authResponse) fbCachedToken.current = r.authResponse.accessToken;
      });
    };
    (function (d, s, id) {
      if (d.getElementById(id)) { if (window.FB) setFbReady(true); return; }
      const js = d.createElement(s) as HTMLScriptElement;
      const fjs = d.getElementsByTagName(s)[0];
      js.id = id; js.src = 'https://connect.facebook.net/en_US/sdk.js';
      fjs.parentNode?.insertBefore(js, fjs);
    }(document, 'script', 'facebook-jssdk'));
  }, []);

  const handleFacebookLogin = () => {
    if (!window.FB || !fbReady) return;
    setFbLoginLoading(true); setErrorMessage(null);
    if (fbStatus === 'connected' && fbCachedToken.current) { exchangeFbToken(fbCachedToken.current); return; }
    window.FB.login(r => {
      if (r.status === 'connected' && r.authResponse) {
        fbCachedToken.current = r.authResponse.accessToken;
        setFbStatus('connected'); exchangeFbToken(r.authResponse.accessToken);
      } else { setFbLoginLoading(false); }
    }, { scope: 'email,public_profile' });
  };

  // ── Social providers ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/auth/providers`)
      .then(r => r.json())
      .then((d: { success: boolean; providers: SocialProvider[] }) => { if (d.success) setSocialProviders(d.providers); })
      .catch(() => {});
  }, []);

  // ── OAuth callback token ────────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('auth_token');
    const authError = params.get('auth_error');
    if (token) {
      window.history.replaceState({}, '', window.location.pathname);
      try {
        const p = JSON.parse(atob(token.split('.')[1])) as { userId: string; email: string; role: string };
        localStorage.setItem('auth_token', token);
        onLogin(normalizeUser({ id: p.userId, email: p.email, name: p.email.split('@')[0], username: null, phone: null, country: null, role: p.role === 'admin' ? 'admin' : 'user' }));
      } catch { setErrorMessage('Social login failed — invalid token'); }
    } else if (authError) {
      window.history.replaceState({}, '', window.location.pathname);
      setErrorMessage(decodeURIComponent(authError));
    }
  }, [onLogin]);

  const handleSocialLogin = (provider: string) => { window.location.href = `${API_BASE_URL}/api/auth/${provider}/start`; };

  // ── Login submit ────────────────────────────────────────────────────────────
  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault(); setErrorMessage(null);
    if (!loginIdentifier.trim()) { setErrorMessage('Please enter your email or username.'); return; }
    if (!loginPassword.trim()) { setErrorMessage('Please enter your password.'); return; }
    setIsSubmitting(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: loginIdentifier.trim(), password: loginPassword }),
      });
      const { data: d, rawText } = await safeJson<AuthResponse>(r);
      if (!d) throw new Error(`Server error (${r.status}): ${rawText.slice(0, 200) || 'empty'}`);
      if (!r.ok || !d.success || !d.token || !d.user?.id || !d.user?.email) throw new Error(d.error || 'Authentication failed');
      localStorage.setItem('auth_token', d.token);
      if (rememberMe) localStorage.setItem('remember_login', loginIdentifier.trim());
      onLogin(normalizeUser({ id: d.user.id, email: d.user.email, name: d.user.name ?? null, username: d.user.username ?? null, phone: d.user.phone ?? null, country: d.user.country ?? null, role: d.user.role === 'admin' ? 'admin' : 'user' }));
    } catch (err) {
      setErrorMessage(err instanceof TypeError ? `Backend unavailable (${API_BASE_URL})` : err instanceof Error ? err.message : 'Unable to authenticate');
    } finally { setIsSubmitting(false); }
  };

  // ── Signup submit ───────────────────────────────────────────────────────────
  const handleSignupSubmit = async (e: FormEvent) => {
    e.preventDefault(); setErrorMessage(null);
    if (!signupName.trim() || !signupEmail.trim() || !signupPassword.trim()) { setErrorMessage('Please fill in all fields.'); return; }
    if (!signupEmail.includes('@')) { setErrorMessage('Please enter a valid email address.'); return; }
    if (signupPassword.length < 6) { setErrorMessage('Password must be at least 6 characters.'); return; }
    if (!acceptTerms) { setErrorMessage('Please accept the Terms and Privacy Policy to continue.'); return; }
    setIsSubmitting(true);
    try {
      const username = signupEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const r = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: signupName.trim(), username, email: signupEmail.trim(), password: signupPassword }),
      });
      const { data: d, rawText } = await safeJson<AuthResponse>(r);
      if (!d) throw new Error(`Server error (${r.status}): ${rawText.slice(0, 200) || 'empty'}`);
      if (!r.ok || !d.success || !d.token || !d.user?.id || !d.user?.email) throw new Error(d.error || 'Account creation failed');
      localStorage.setItem('auth_token', d.token);
      onLogin(normalizeUser({ id: d.user.id, email: d.user.email, name: d.user.name ?? null, username: d.user.username ?? null, phone: d.user.phone ?? null, country: d.user.country ?? null, role: 'user' }));
    } catch (err) {
      setErrorMessage(err instanceof TypeError ? `Backend unavailable (${API_BASE_URL})` : err instanceof Error ? err.message : 'Unable to create account');
    } finally { setIsSubmitting(false); }
  };

  const hasOAuth = socialProviders.length > 0 || !!FB_APP_ID;

  return (
    <div className="da-root">
      <style dangerouslySetInnerHTML={{ __html: AUTH_CSS }} />
      <div className="da-page">
        <div className="da-bg-orbs"><div className="da-o1" /><div className="da-o2" /></div>
        <div className="da-card">
          <VisualPane mode={mode} />
          <div className="da-form-pane">
            <button className="da-back" onClick={() => window.history.back()}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8 2 L4 6 L8 10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Back to home
            </button>

            <div className="da-tabs">
              <button className={`da-tab ${mode === 'signup' ? 'active' : ''}`} onClick={() => switchMode('signup')}>Create account</button>
              <button className={`da-tab ${mode === 'login' ? 'active' : ''}`} onClick={() => switchMode('login')}>Sign in</button>
            </div>

            {mode === 'signup' ? (
              <form className="da-form-state" onSubmit={handleSignupSubmit} noValidate>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span className="da-mark"><AsteriskMark color="var(--da-accent)" /></span>
                </div>
                <h1 className="da-form-h">Create an account</h1>
                <p className="da-form-sub" style={{ marginTop: 8 }}>Generate, schedule, and learn from a month of content — across six channels, in one place.</p>

                {errorMessage && (
                  <div className="da-err">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor"/><path d="M7 4 V8 M7 10 V10.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    {errorMessage}
                  </div>
                )}

                <div className="da-field-group" style={{ marginTop: 20 }}>
                  <div className="da-field">
                    <label htmlFor="su-name">Your name</label>
                    <div className="da-input-wrap">
                      <input id="su-name" type="text" placeholder="Alex Jordan" value={signupName} onChange={e => setSignupName(e.target.value)} autoComplete="name" />
                    </div>
                  </div>
                  <div className="da-field">
                    <label htmlFor="su-email">Your email</label>
                    <div className="da-input-wrap">
                      <input id="su-email" type="email" placeholder="you@company.com" value={signupEmail} onChange={e => setSignupEmail(e.target.value)} autoComplete="email" />
                    </div>
                  </div>
                  <div className="da-field">
                    <label htmlFor="su-password">Password</label>
                    <div className="da-input-wrap has-icon">
                      <input id="su-password" type={showSignupPwd ? 'text' : 'password'} placeholder="At least 6 characters" value={signupPassword} onChange={e => setSignupPassword(e.target.value)} autoComplete="new-password" />
                      <button type="button" className="da-eye-btn" onClick={() => setShowSignupPwd(v => !v)}><EyeIcon open={showSignupPwd} /></button>
                    </div>
                    {signupPassword && (
                      <>
                        <div className="da-pwd-bars">
                          {([1,2,3,4] as const).map(i => <span key={i} className={`da-pwd-bar ${pwdStrength >= i ? `s${pwdStrength}` : ''}`} />)}
                        </div>
                        <div className="da-pwd-hint">{STRENGTH_LABEL[pwdStrength]} · 8+ chars with number &amp; symbol = strong</div>
                      </>
                    )}
                  </div>
                  <label className="da-checkbox" style={{ marginTop: 2 }}>
                    <input type="checkbox" checked={acceptTerms} onChange={e => setAcceptTerms(e.target.checked)} />
                    <span className="da-box"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5 L4 7 L8 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg></span>
                    <span>I agree to the <a href="/terms" className="da-link da-link-accent">Terms</a> and <a href="/privacy" className="da-link da-link-accent">Privacy Policy</a></span>
                  </label>
                  <button type="submit" className="da-submit" disabled={isSubmitting} style={{ marginTop: 4 }}>
                    {isSubmitting ? <><span className="da-spinner" /> Creating workspace…</> : <>Get started <span className="da-arrow">→</span></>}
                  </button>
                </div>

                {hasOAuth && (
                  <>
                    <div className="da-divider" style={{ marginTop: 20 }}>or continue with</div>
                    <div className="da-oauth-row" style={{ marginTop: 12 }}>
                      {socialProviders.filter(p => p.provider === 'google').length > 0 && (
                        <button type="button" className="da-oauth-btn" onClick={() => handleSocialLogin('google')}>
                          <svg viewBox="0 0 18 18" fill="none"><path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.63z" fill="#4285F4"/><path d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.99v2.33A9 9 0 0 0 9 18z" fill="#34A853"/><path d="M3.97 10.71A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.17.29-1.71V4.96H.99A9 9 0 0 0 0 9c0 1.45.35 2.83.99 4.04l2.98-2.33z" fill="#FBBC05"/><path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.97 8.97 0 0 0 9 0 9 9 0 0 0 .99 4.96l2.98 2.33C4.68 5.16 6.66 3.58 9 3.58z" fill="#EA4335"/></svg>
                          Google
                        </button>
                      )}
                      {socialProviders.filter(p => p.provider === 'github').length > 0 && (
                        <button type="button" className="da-oauth-btn" onClick={() => handleSocialLogin('github')}>
                          <svg viewBox="0 0 14 14" fill="currentColor"><path d="M7 0a7 7 0 0 0-2.21 13.64c.35.06.48-.15.48-.34v-1.2c-1.95.42-2.36-.94-2.36-.94-.32-.81-.78-1.03-.78-1.03-.64-.43.05-.43.05-.43.7.05 1.07.72 1.07.72.62 1.07 1.64.76 2.04.58.06-.45.24-.76.44-.94-1.56-.18-3.2-.78-3.2-3.47 0-.77.27-1.4.72-1.89-.07-.18-.31-.9.07-1.88 0 0 .59-.19 1.93.72A6.7 6.7 0 0 1 7 3.36c.6 0 1.2.08 1.76.24 1.34-.91 1.93-.72 1.93-.72.38.98.14 1.7.07 1.88.45.49.71 1.12.71 1.89 0 2.7-1.65 3.29-3.22 3.46.25.22.48.65.48 1.32v1.96c0 .19.13.41.49.34A7 7 0 0 0 7 0z"/></svg>
                          GitHub
                        </button>
                      )}
                      {FB_APP_ID && (
                        <button type="button" className="da-oauth-btn" onClick={handleFacebookLogin} disabled={!fbReady || fbLoginLoading}>
                          <svg viewBox="0 0 14 14" fill="#1877F2"><path d="M14 7a7 7 0 1 0-8.09 6.92V9.02H4.13V7h1.78V5.46c0-1.76 1.05-2.74 2.66-2.74.77 0 1.57.14 1.57.14V4.6h-.88c-.87 0-1.14.54-1.14 1.1V7h1.94l-.31 2.02h-1.63v4.9A7 7 0 0 0 14 7"/></svg>
                          Facebook
                        </button>
                      )}
                    </div>
                  </>
                )}

                <div className="da-switch" style={{ marginTop: 20 }}>
                  Already have an account?{' '}
                  <button type="button" onClick={() => switchMode('login')}>Sign in</button>
                </div>
              </form>
            ) : (
              <form className="da-form-state" onSubmit={handleLoginSubmit} noValidate>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span className="da-mark"><AsteriskMark color="var(--da-accent)" /></span>
                </div>
                <h1 className="da-form-h">Welcome back</h1>
                <p className="da-form-sub" style={{ marginTop: 8 }}>Sign in to your workspace. Your drafts, calendar, and learning loop are right where you left them.</p>

                {errorMessage && (
                  <div className="da-err">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor"/><path d="M7 4 V8 M7 10 V10.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    {errorMessage}
                  </div>
                )}

                <div className="da-field-group" style={{ marginTop: 20 }}>
                  <div className="da-field">
                    <label htmlFor="li-email">Email or username</label>
                    <div className="da-input-wrap">
                      <input id="li-email" type="text" placeholder="you@company.com" value={loginIdentifier} onChange={e => setLoginIdentifier(e.target.value)} autoComplete="email" />
                    </div>
                  </div>
                  <div className="da-field">
                    <label htmlFor="li-password">Password</label>
                    <div className="da-input-wrap has-icon">
                      <input id="li-password" type={showLoginPwd ? 'text' : 'password'} placeholder="••••••••••" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} autoComplete="current-password" />
                      <button type="button" className="da-eye-btn" onClick={() => setShowLoginPwd(v => !v)}><EyeIcon open={showLoginPwd} /></button>
                    </div>
                  </div>
                  <div className="da-row-between" style={{ marginTop: 2 }}>
                    <label className="da-checkbox">
                      <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
                      <span className="da-box"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5 L4 7 L8 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg></span>
                      <span>Keep me signed in</span>
                    </label>
                    <a href="#" className="da-link">Forgot password?</a>
                  </div>
                  <button type="submit" className="da-submit" disabled={isSubmitting} style={{ marginTop: 4 }}>
                    {isSubmitting ? <><span className="da-spinner" /> Signing in…</> : <>Sign in <span className="da-arrow">→</span></>}
                  </button>
                </div>

                {hasOAuth && (
                  <>
                    <div className="da-divider" style={{ marginTop: 20 }}>or continue with</div>
                    <div className="da-oauth-row" style={{ marginTop: 12 }}>
                      {socialProviders.filter(p => p.provider === 'google').length > 0 && (
                        <button type="button" className="da-oauth-btn" onClick={() => handleSocialLogin('google')}>
                          <svg viewBox="0 0 18 18" fill="none"><path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.63z" fill="#4285F4"/><path d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.99v2.33A9 9 0 0 0 9 18z" fill="#34A853"/><path d="M3.97 10.71A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.17.29-1.71V4.96H.99A9 9 0 0 0 0 9c0 1.45.35 2.83.99 4.04l2.98-2.33z" fill="#FBBC05"/><path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.97 8.97 0 0 0 9 0 9 9 0 0 0 .99 4.96l2.98 2.33C4.68 5.16 6.66 3.58 9 3.58z" fill="#EA4335"/></svg>
                          Google
                        </button>
                      )}
                      {socialProviders.filter(p => p.provider === 'github').length > 0 && (
                        <button type="button" className="da-oauth-btn" onClick={() => handleSocialLogin('github')}>
                          <svg viewBox="0 0 14 14" fill="currentColor"><path d="M7 0a7 7 0 0 0-2.21 13.64c.35.06.48-.15.48-.34v-1.2c-1.95.42-2.36-.94-2.36-.94-.32-.81-.78-1.03-.78-1.03-.64-.43.05-.43.05-.43.7.05 1.07.72 1.07.72.62 1.07 1.64.76 2.04.58.06-.45.24-.76.44-.94-1.56-.18-3.2-.78-3.2-3.47 0-.77.27-1.4.72-1.89-.07-.18-.31-.9.07-1.88 0 0 .59-.19 1.93.72A6.7 6.7 0 0 1 7 3.36c.6 0 1.2.08 1.76.24 1.34-.91 1.93-.72 1.93-.72.38.98.14 1.7.07 1.88.45.49.71 1.12.71 1.89 0 2.7-1.65 3.29-3.22 3.46.25.22.48.65.48 1.32v1.96c0 .19.13.41.49.34A7 7 0 0 0 7 0z"/></svg>
                          GitHub
                        </button>
                      )}
                      {FB_APP_ID && (
                        <button type="button" className="da-oauth-btn" onClick={handleFacebookLogin} disabled={!fbReady || fbLoginLoading}>
                          <svg viewBox="0 0 14 14" fill="#1877F2"><path d="M14 7a7 7 0 1 0-8.09 6.92V9.02H4.13V7h1.78V5.46c0-1.76 1.05-2.74 2.66-2.74.77 0 1.57.14 1.57.14V4.6h-.88c-.87 0-1.14.54-1.14 1.1V7h1.94l-.31 2.02h-1.63v4.9A7 7 0 0 0 14 7"/></svg>
                          {fbLoginLoading ? 'Connecting…' : 'Facebook'}
                        </button>
                      )}
                    </div>
                  </>
                )}

                <div className="da-switch" style={{ marginTop: 20 }}>
                  Don't have an account?{' '}
                  <button type="button" onClick={() => switchMode('signup')}>Sign up</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Auth;
