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
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-white/95 backdrop-blur-md border-b border-zinc-200 shadow-sm'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Logo */}
        <a href="/" className="text-xl font-black tracking-[-0.04em] text-zinc-900">
          Dakyworld<span className="text-[#e6332a]">.</span>
        </a>

        {/* Desktop links */}
        <nav className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className={`text-sm font-semibold transition-colors ${
                activePath === link.href
                  ? 'text-[#e6332a]'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center gap-3">
          <button
            type="button"
            onClick={onLoginClick}
            className="text-sm font-semibold text-zinc-600 hover:text-zinc-900 transition-colors"
          >
            Log in
          </button>
          <button
            type="button"
            onClick={onLoginClick}
            className="bg-[#e6332a] hover:bg-[#cc2921] text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-colors"
          >
            Get started
          </button>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          className="md:hidden text-zinc-600 hover:text-zinc-900"
          onClick={() => setMobileOpen((p) => !p)}
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-white border-t border-zinc-100 px-6 py-4 flex flex-col gap-4">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className={`text-sm font-semibold transition-colors ${
                activePath === link.href ? 'text-[#e6332a]' : 'text-zinc-600 hover:text-zinc-900'
              }`}
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <button
            type="button"
            onClick={() => { setMobileOpen(false); onLoginClick(); }}
            className="bg-[#e6332a] text-white text-sm font-bold px-5 py-3 rounded-xl"
          >
            Get started
          </button>
        </div>
      )}
    </header>
  );
}
