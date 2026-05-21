import { ExternalLink, HelpCircle, Mail, MessageCircle, X } from 'lucide-react';

type Props = { onClose: () => void };

const DOCS = [
  { label: 'Getting started', href: 'https://docs.dakyworld.com/getting-started' },
  { label: 'Scheduling posts', href: 'https://docs.dakyworld.com/posts' },
  { label: 'Marketing automations', href: 'https://docs.dakyworld.com/automations' },
  { label: 'Billing & plans', href: 'https://docs.dakyworld.com/billing' },
];

export default function HelpModal({ onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <HelpCircle size={16} />
            </div>
            <h2 className="text-[15px] font-bold text-gray-900">Help & Support</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Docs */}
          <div>
            <p className="mb-2.5 text-[11px] font-bold uppercase tracking-widest text-gray-400">Documentation</p>
            <div className="space-y-1">
              {DOCS.map((d) => (
                <a
                  key={d.label}
                  href={d.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-xl px-3.5 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 hover:text-indigo-600 transition-colors group"
                >
                  {d.label}
                  <ExternalLink size={12} className="text-gray-300 group-hover:text-indigo-400 transition-colors" />
                </a>
              ))}
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          {/* Contact */}
          <div>
            <p className="mb-2.5 text-[11px] font-bold uppercase tracking-widest text-gray-400">Contact us</p>
            <div className="space-y-1">
              <a
                href="mailto:support@dakyworld.com"
                className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 hover:text-indigo-600 transition-colors"
              >
                <Mail size={14} className="text-gray-400 shrink-0" />
                support@dakyworld.com
              </a>
              <a
                href="https://dakyworld.com/chat"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 hover:text-indigo-600 transition-colors"
              >
                <MessageCircle size={14} className="text-gray-400 shrink-0" />
                Live chat
              </a>
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          <p className="text-center text-[11px] text-gray-400">
            Dakyworld Hub &mdash; response time within 24h
          </p>
        </div>
      </div>
    </div>
  );
}
