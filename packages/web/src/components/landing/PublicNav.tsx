import { useState, useEffect } from 'react';

type PublicNavProps = {
  onLoginClick: () => void;
  activePath?: string;
};

const NAV_LINKS = [
  { label: 'Features', href: '/#features' },
  { label: 'Tools', href: '/tools' },
  { label: 'Pricing', href: '/pricing' },
  { label: "What's New", href: '/changelog', badge: true },
];

export default function PublicNav({ onLoginClick, activePath = '/' }: PublicNavProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled || mobileOpen
          ? 'bg-white/95 backdrop-blur-xl border-b border-[#e5e7eb]/80 shadow-[0_1px_12px_rgba(0,0,0,0.06)]'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-[1160px] mx-auto px-5 sm:px-8 h-[64px] flex items-center justify-between gap-6">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2 shrink-0 group">
          <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-[#5b6cf9] shadow-md shadow-indigo-200/60 group-hover:shadow-indigo-300/80 transition-shadow">
            <div className="absolute inset-[4px] rounded-sm bg-white/30" />
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="relative z-10">
              <path d="M2 5h6M5 2l3 3-3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-[15px] font-black tracking-[-0.04em] text-[#0a0a0b] group-hover:text-[#5b6cf9] transition-colors">
            Dakyworld
            <span className="text-[#5b6cf9]">Hub</span>
          </span>
        </a>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-0.5">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className={`relative inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[14px] font-medium transition-all duration-150 ${
                activePath === link.href.replace('/#features','/')
                  ? 'text-[#5b6cf9] bg-[#eef0fe]'
                  : 'text-[#6b7280] hover:text-[#0a0a0b] hover:bg-[#f3f4f6]'
              }`}
            >
              {link.label}
              {(link as any).badge && (
                <span className="rounded-full bg-[#5b6cf9] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-white leading-none">New</span>
              )}
            </a>
          ))}
        </nav>

        {/* Desktop CTAs */}
        <div className="hidden md:flex items-center gap-2">
          <button
            type="button"
            onClick={onLoginClick}
            className="px-4 py-2 text-[14px] font-medium text-[#6b7280] hover:text-[#0a0a0b] transition-colors rounded-lg hover:bg-[#f3f4f6]"
          >
            Log in
          </button>
          <button
            type="button"
            onClick={onLoginClick}
            className="flex items-center gap-1.5 bg-[#5b6cf9] hover:bg-[#4f5de6] text-white text-[14px] font-semibold px-4 py-2 rounded-lg transition-all duration-150 shadow-sm shadow-indigo-300/50 hover:shadow-indigo-300/80 hover:-translate-y-px"
          >
            Get started free
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          className="md:hidden flex h-9 w-9 items-center justify-center rounded-lg text-[#6b7280] hover:text-[#0a0a0b] hover:bg-[#f3f4f6] transition-colors"
          onClick={() => setMobileOpen((p) => !p)}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            {mobileOpen ? (
              <>
                <line x1="3" y1="3" x2="15" y2="15" />
                <line x1="15" y1="3" x2="3" y2="15" />
              </>
            ) : (
              <>
                <line x1="3" y1="5" x2="15" y2="5" />
                <line x1="3" y1="9" x2="15" y2="9" />
                <line x1="3" y1="13" x2="15" y2="13" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile slide-down menu */}
      <div
        className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out bg-white border-t border-[#e5e7eb] ${
          mobileOpen ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="max-w-[1160px] mx-auto px-5 pt-4 pb-6 flex flex-col gap-1">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="flex items-center justify-between px-4 py-3 rounded-xl text-[15px] font-medium text-[#374151] hover:text-[#5b6cf9] hover:bg-[#f5f6ff] transition-colors"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 7h8M8 4l3 3-3 3"/>
              </svg>
            </a>
          ))}
          <div className="mt-4 pt-4 border-t border-[#e5e7eb] flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => { setMobileOpen(false); onLoginClick(); }}
              className="w-full px-4 py-3 text-[15px] font-semibold text-[#374151] border border-[#e5e7eb] rounded-xl hover:bg-[#f9fafb] transition-colors"
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => { setMobileOpen(false); onLoginClick(); }}
              className="w-full bg-[#5b6cf9] text-white text-[15px] font-semibold px-4 py-3 rounded-xl transition-colors hover:bg-[#4f5de6] shadow-md shadow-indigo-200/60"
            >
              Get started free →
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
