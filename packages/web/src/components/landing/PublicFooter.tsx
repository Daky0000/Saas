export default function PublicFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-[#0a0a0b] text-white">
      {/* Main footer */}
      <div className="max-w-[1160px] mx-auto px-5 sm:px-8 pt-16 pb-12">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-5 mb-12">
          {/* Brand */}
          <div className="col-span-2 sm:col-span-2 pr-8">
            <a href="/" className="inline-flex items-center gap-2 mb-5 group">
              <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-[#5b6cf9]">
                <div className="absolute inset-[4px] rounded-sm bg-white/30" />
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="relative z-10">
                  <path d="M2 5h6M5 2l3 3-3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <span className="text-[15px] font-black tracking-[-0.04em] text-white">
                Dakyworld<span className="text-[#818cf8]">Hub</span>
              </span>
            </a>
            <p className="text-[14px] text-[#9ca3af] leading-relaxed mb-6 max-w-[240px]">
              The AI content platform that knows your brand, learns from every post, and publishes across six channels.
            </p>
            {/* Social links */}
            <div className="flex items-center gap-3">
              {[
                { label: 'X', href: '#', icon: 'M4.5 4L7 7 4 11H5.2L7.6 7.7 9.7 11H12L9.3 7.1 12 4H10.8L8.7 7 6.8 4Z' },
                { label: 'LinkedIn', href: '#', icon: 'M2 4.5C2 3.67 2.67 3 3.5 3S5 3.67 5 4.5 4.33 6 3.5 6 2 5.33 2 4.5ZM2.1 7H4.9V14H2.1V7ZM6.3 7H9V8.2C9.4 7.5 10.2 6.8 11.4 6.8 13.9 6.8 14.4 8.4 14.4 10.5V14H11.6V11C11.6 10 11.6 8.8 10.3 8.8 9 8.8 8.8 9.8 8.8 10.9V14H6V7Z' },
                { label: 'Instagram', href: '#', icon: 'M8 3C5.2 3 3 5.2 3 8S5.2 13 8 13 13 10.8 13 8 10.8 3 8 3ZM8 11.5C6 11.5 4.5 10 4.5 8S6 4.5 8 4.5 11.5 6 11.5 8 10 11.5 8 11.5ZM11.5 4C11.5 4.6 12 5 12.5 5S13.5 4.6 13.5 4 13 3 12.5 3 11.5 3.4 11.5 4Z' },
              ].map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  aria-label={s.label}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 hover:bg-[#5b6cf9]/30 transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-[#9ca3af]">
                    <path d={s.icon} />
                  </svg>
                </a>
              ))}
            </div>
          </div>

          {/* Product */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6b7280] mb-4">Product</p>
            <ul className="space-y-3">
              {[
                { label: 'Features', href: '/#features' },
                { label: 'Pricing', href: '/pricing' },
                { label: 'Tools', href: '/tools' },
                { label: 'AI Studio', href: '/#studio' },
                { label: 'Changelog', href: '#' },
              ].map((item) => (
                <li key={item.label}>
                  <a href={item.href} className="text-[14px] text-[#9ca3af] hover:text-white transition-colors">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6b7280] mb-4">Company</p>
            <ul className="space-y-3">
              {['About', 'Blog', 'Careers', 'Contact', 'Press kit'].map((item) => (
                <li key={item}>
                  <a href="#" className="text-[14px] text-[#9ca3af] hover:text-white transition-colors">{item}</a>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6b7280] mb-4">Legal</p>
            <ul className="space-y-3">
              {[
                { label: 'Privacy Policy', href: '/privacy' },
                { label: 'Terms of Service', href: '/terms' },
                { label: 'Cookie Policy', href: '#' },
                { label: 'Security', href: '#' },
              ].map((item) => (
                <li key={item.label}>
                  <a href={item.href} className="text-[14px] text-[#9ca3af] hover:text-white transition-colors">{item.label}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-8 border-t border-white/10">
          <p className="text-[13px] text-[#6b7280] order-2 sm:order-1">
            © {year} Dakyworld. All rights reserved.
          </p>
          <div className="flex items-center gap-1.5 order-1 sm:order-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[12px] text-[#6b7280]">All systems operational</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
