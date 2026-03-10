import { useState, useEffect } from 'react';
import { Menu, X } from 'lucide-react';

type PublicNavProps = {
  onLoginClick: () => void;
  activePath?: string;
};

const NAV_LINKS = [
  { label: 'Home', href: '/' },
  { label: 'Tools', href: '/tools' },
  { label: 'Pricing', href: '/pricing' },
];

export default function PublicNav({ onLoginClick, activePath = '/' }: PublicNavProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 ${
        scrolled
          ? 'bg-white/90 backdrop-blur-xl border-b border-[#e5e7eb]/80 shadow-sm'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-[1200px] mx-auto px-6 h-[60px] flex items-center justify-between gap-8">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2 shrink-0">
          <span className="text-[15px] font-black tracking-[-0.04em] text-[#0f0f11]">
            Dakyworld
          </span>
          <span className="h-1.5 w-1.5 rounded-full bg-[#5b6cf9]" />
        </a>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-0.5">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className={`px-3 py-1.5 rounded-md text-[14px] font-medium transition-colors ${
                activePath === link.href
                  ? 'text-[#0f0f11]'
                  : 'text-[#6b7280] hover:text-[#0f0f11] hover:bg-[#f3f4f6]'
              }`}
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Desktop CTAs */}
        <div className="hidden md:flex items-center gap-2">
          <button
            type="button"
            onClick={onLoginClick}
            className="px-3.5 py-1.5 text-[14px] font-medium text-[#6b7280] hover:text-[#0f0f11] transition-colors rounded-md hover:bg-[#f3f4f6]"
          >
            Log in
          </button>
          <button
            type="button"
            onClick={onLoginClick}
            className="flex items-center gap-1.5 bg-[#5b6cf9] hover:bg-[#4f63f7] active:bg-[#4558e8] text-white text-[14px] font-semibold px-4 py-1.5 rounded-lg transition-all duration-150 shadow-sm shadow-blue-200/60"
          >
            Get started
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="opacity-80">
              <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          className="md:hidden flex h-8 w-8 items-center justify-center rounded-md text-[#6b7280] hover:text-[#0f0f11] hover:bg-[#f3f4f6] transition-colors"
          onClick={() => setMobileOpen((p) => !p)}
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[#e5e7eb] bg-white">
          <div className="max-w-[1200px] mx-auto px-6 py-4 flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className={`px-3 py-2.5 rounded-md text-[14px] font-medium transition-colors ${
                  activePath === link.href
                    ? 'text-[#0f0f11] bg-[#f3f4f6]'
                    : 'text-[#6b7280] hover:text-[#0f0f11] hover:bg-[#f3f4f6]'
                }`}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <div className="mt-3 pt-3 border-t border-[#e5e7eb] flex flex-col gap-2">
              <button
                type="button"
                onClick={() => { setMobileOpen(false); onLoginClick(); }}
                className="px-4 py-2.5 text-[14px] font-medium text-[#6b7280] border border-[#e5e7eb] rounded-lg hover:bg-[#f3f4f6] transition-colors"
              >
                Log in
              </button>
              <button
                type="button"
                onClick={() => { setMobileOpen(false); onLoginClick(); }}
                className="bg-[#5b6cf9] text-white text-[14px] font-semibold px-4 py-2.5 rounded-lg transition-colors hover:bg-[#4f63f7]"
              >
                Get started
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
