import { useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '../utils/apiBase';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

const SparkleIcon = ({ size = 24, className = '' }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    fill="none"
    className={className}
  >
    <defs>
      <linearGradient id="sparkle-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#a855f7" />
        <stop offset="100%" stopColor="#22d3ee" />
      </linearGradient>
    </defs>
    {/* Large star */}
    <path
      d="M36 6 L38.5 18 L48 20 L38.5 22 L36 34 L33.5 22 L24 20 L33.5 18 Z"
      fill="url(#sparkle-grad)"
    />
    {/* Small star */}
    <path
      d="M13 26 L14.5 32 L20 33.5 L14.5 35 L13 41 L11.5 35 L6 33.5 L11.5 32 Z"
      fill="url(#sparkle-grad)"
    />
    {/* Tiny star */}
    <path
      d="M10 10 L11 14 L15 15 L11 16 L10 20 L9 16 L5 15 L9 14 Z"
      fill="#a855f7"
      opacity="0.7"
    />
  </svg>
);

function renderContent(text: string) {
  // Bold (**text**)
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>
  );
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: "Hi! I'm your ContentFlow AI assistant. Ask me anything about content creation, social media strategy, analytics, or how to use any feature. 🚀",
      }]);
    }
  }, [open, messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text };
    const assistantId = crypto.randomUUID();

    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '' }]);
    setInput('');
    setLoading(true);

    const token = localStorage.getItem('auth_token');
    const history = [...messages, userMsg].map(({ role, content }) => ({ role, content }));

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const res = await fetch(`${getApiBaseUrl()}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: history }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any)?.error || 'Request failed');
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;
          try {
            const chunk = JSON.parse(payload) as { text?: string; error?: string };
            if (chunk.error) throw new Error(chunk.error);
            if (chunk.text) {
              setMessages((prev) =>
                prev.map((m) => m.id === assistantId ? { ...m, content: m.content + chunk.text } : m)
              );
            }
          } catch { /* malformed chunk */ }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: err?.message || 'Something went wrong. Please try again.' }
            : m
        )
      );
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-110 active:scale-95"
        style={{ background: 'linear-gradient(135deg, #a855f7 0%, #22d3ee 100%)' }}
        aria-label="Open AI assistant"
      >
        <SparkleIcon size={28} />
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-24 right-6 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          style={{ height: '480px' }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-4 py-3"
            style={{ background: 'linear-gradient(135deg, #a855f7 0%, #22d3ee 100%)' }}
          >
            <SparkleIcon size={20} />
            <div className="flex-1">
              <div className="text-sm font-bold text-white">ContentFlow AI</div>
              <div className="text-xs text-white/70">Ask me anything</div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 hover:bg-white/20 hover:text-white"
            >
              ✕
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="mr-2 mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full" style={{ background: 'linear-gradient(135deg, #a855f7 0%, #22d3ee 100%)' }}>
                    <SparkleIcon size={14} />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'rounded-br-sm bg-slate-900 text-white'
                      : 'rounded-bl-sm bg-slate-100 text-slate-800'
                  }`}
                >
                  {msg.content
                    ? msg.content.split('\n').map((line, i) => (
                        <p key={i} className={i > 0 ? 'mt-1' : ''}>{renderContent(line)}</p>
                      ))
                    : <span className="inline-block h-4 w-4 animate-pulse rounded bg-slate-300" />}
                </div>
              </div>
            ))}
            {loading && messages[messages.length - 1]?.content === '' && (
              <div className="flex justify-start">
                <div className="mr-2 mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full" style={{ background: 'linear-gradient(135deg, #a855f7 0%, #22d3ee 100%)' }}>
                  <SparkleIcon size={14} />
                </div>
                <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2">
                  <span className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Suggestions (only on welcome) */}
          {messages.length === 1 && (
            <div className="px-4 pb-2 flex flex-wrap gap-1.5">
              {['Write a caption for Instagram', 'Tips for growing on TikTok', 'How do I schedule posts?'].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setInput(s); inputRef.current?.focus(); }}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="border-t border-slate-100 px-3 py-3 flex gap-2 items-end">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={loading}
              placeholder="Ask anything…"
              className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400 disabled:opacity-50"
              style={{ maxHeight: '96px', overflowY: 'auto' }}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!input.trim() || loading}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-white disabled:opacity-40 transition-opacity"
              style={{ background: 'linear-gradient(135deg, #a855f7 0%, #22d3ee 100%)' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13" /><path d="M22 2L15 22l-4-9-9-4 20-7z" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
