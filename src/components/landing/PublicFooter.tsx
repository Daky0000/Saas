export default function PublicFooter() {
  return (
    <footer className="border-t border-zinc-200 bg-white px-6 py-10">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-400">
        <a href="/" className="font-black text-sm text-zinc-700 tracking-[-0.03em]">
          Dakyworld<span className="text-[#e6332a]">.</span>
        </a>
        <div className="flex items-center gap-6">
          <a href="/" className="hover:text-zinc-700 transition-colors">Home</a>
          <a href="/tools" className="hover:text-zinc-700 transition-colors">Tools</a>
          <a href="/pricing" className="hover:text-zinc-700 transition-colors">Pricing</a>
          <a href="/privacy" className="hover:text-zinc-700 transition-colors">Privacy</a>
          <a href="/terms" className="hover:text-zinc-700 transition-colors">Terms</a>
        </div>
        <span>© {new Date().getFullYear()} Dakyworld. All rights reserved.</span>
      </div>
    </footer>
  );
}
