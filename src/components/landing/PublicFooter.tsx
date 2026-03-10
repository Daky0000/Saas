export default function PublicFooter() {
  return (
    <footer className="border-t border-[#e5e7eb] bg-[#fafafa]">
      <div className="max-w-[1200px] mx-auto px-6 py-14">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 mb-12">
          {/* Product */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#9ca3af] mb-4">Product</div>
            <ul className="space-y-2.5">
              {[{label:'Home',href:'/'},{label:'Tools',href:'/tools'},{label:'Pricing',href:'/pricing'},{label:'Changelog',href:'#'}].map((item) => (
                <li key={item.label}>
                  <a href={item.href} className="text-[14px] text-[#6b7280] hover:text-[#0f0f11] transition-colors">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#9ca3af] mb-4">Company</div>
            <ul className="space-y-2.5">
              {['About', 'Blog', 'Careers', 'Contact'].map((item) => (
                <li key={item}>
                  <a href="#" className="text-[14px] text-[#6b7280] hover:text-[#0f0f11] transition-colors">{item}</a>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#9ca3af] mb-4">Legal</div>
            <ul className="space-y-2.5">
              {[{label:'Privacy',href:'/privacy'},{label:'Terms',href:'/terms'},{label:'Security',href:'#'}].map((item) => (
                <li key={item.label}>
                  <a href={item.href} className="text-[14px] text-[#6b7280] hover:text-[#0f0f11] transition-colors">{item.label}</a>
                </li>
              ))}
            </ul>
          </div>

          {/* Connect */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#9ca3af] mb-4">Connect</div>
            <ul className="space-y-2.5">
              {['Twitter / X', 'LinkedIn', 'GitHub', 'Discord'].map((item) => (
                <li key={item}>
                  <a href="#" className="text-[14px] text-[#6b7280] hover:text-[#0f0f11] transition-colors">{item}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-8 border-t border-[#e5e7eb]">
          <a href="/" className="flex items-center gap-2">
            <span className="text-[15px] font-black tracking-[-0.04em] text-[#0f0f11]">Dakyworld</span>
            <span className="h-1.5 w-1.5 rounded-full bg-[#5b6cf9]" />
          </a>
          <span className="text-[13px] text-[#9ca3af]">
            © {new Date().getFullYear()} Dakyworld. All rights reserved.
          </span>
        </div>
      </div>
    </footer>
  );
}
