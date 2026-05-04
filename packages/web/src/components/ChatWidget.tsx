import { useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '../utils/apiBase';

// ── Types ────────────────────────────────────────────────────────────────────

type TextMessage = { kind: 'text'; id: string; role: 'user' | 'assistant'; content: string };
type ToolMessage = { kind: 'tool'; id: string; name: string; label: string; status: 'running' | 'done' | 'error'; result?: any; error?: string };
type Message = TextMessage | ToolMessage;

// ── Icons ────────────────────────────────────────────────────────────────────

const SparkleIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    <defs>
      <linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#a855f7" />
        <stop offset="100%" stopColor="#22d3ee" />
      </linearGradient>
    </defs>
    <path d="M36 6 L38.5 18 L48 20 L38.5 22 L36 34 L33.5 22 L24 20 L33.5 18 Z" fill="url(#sg)" />
    <path d="M13 26 L14.5 32 L20 33.5 L14.5 35 L13 41 L11.5 35 L6 33.5 L11.5 32 Z" fill="url(#sg)" />
    <path d="M10 10 L11 14 L15 15 L11 16 L10 20 L9 16 L5 15 L9 14 Z" fill="#a855f7" opacity="0.7" />
  </svg>
);

// ── Tool action card ─────────────────────────────────────────────────────────

function ToolCard({ msg }: { msg: ToolMessage }) {
  const isCreate = msg.name === 'create_draft';
  const isSchedule = msg.name === 'schedule_post';
  const isAction = isCreate || isSchedule;

  const postTitle = msg.result?.post?.title;
  const scheduledAt = msg.result?.post?.scheduled_at;

  if (msg.status === 'running') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-purple-100 bg-purple-50 px-3 py-2 text-xs text-purple-700">
        <span className="flex gap-0.5">
          {[0,1,2].map(i => (
            <span key={i} className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />
          ))}
        </span>
        {msg.label}
      </div>
    );
  }

  if (msg.status === 'error') {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
        ✗ {msg.error || 'Action failed'}
      </div>
    );
  }

  // Done
  if (msg.name === 'get_recent_posts') {
    const posts: any[] = msg.result?.posts ?? [];
    return (
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden text-xs">
        <div className="border-b border-slate-100 px-3 py-2 font-semibold text-slate-700">
          {posts.length} post{posts.length !== 1 ? 's' : ''} found
        </div>
        {posts.length === 0 ? (
          <p className="px-3 py-2 text-slate-400">No posts yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {posts.slice(0, 5).map((p: any) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate text-slate-800 font-medium">{p.title || 'Untitled'}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold capitalize ${
                  p.status === 'published' ? 'bg-emerald-50 text-emerald-700' :
                  p.status === 'scheduled' ? 'bg-blue-50 text-blue-700' :
                  'bg-slate-100 text-slate-500'
                }`}>{p.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (msg.name === 'get_connected_platforms') {
    const platforms: any[] = msg.result?.connected ?? [];
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
        <span className="font-semibold text-slate-700">Connected: </span>
        {platforms.length === 0
          ? <span className="text-slate-400">None connected</span>
          : platforms.map((p: any) => (
              <span key={p.platform} className="mr-1.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 capitalize text-slate-700">{p.platform}</span>
            ))
        }
      </div>
    );
  }

  if (isAction && postTitle) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-emerald-600">✓</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-emerald-800">
              {isCreate ? 'Draft created' : 'Post scheduled'}
            </p>
            <p className="truncate text-xs text-emerald-700">"{postTitle}"</p>
            {isSchedule && scheduledAt && (
              <p className="text-xs text-emerald-600 mt-0.5">
                {new Date(scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            )}
          </div>
          <a href="/posts" className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">
            View
          </a>
        </div>
      </div>
    );
  }

  return null;
}

// ── Markdown-lite renderer ────────────────────────────────────────────────────

function renderText(text: string) {
  return text.split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith('**') && p.endsWith('**') ? <strong key={j}>{p.slice(2,-2)}</strong> : <span key={j}>{p}</span>
    );
    return <p key={i} className={i > 0 ? 'mt-1' : ''}>{parts}</p>;
  });
}

// ── Main Widget ───────────────────────────────────────────────────────────────

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
        kind: 'text', id: 'welcome', role: 'assistant',
        content: "Hi! I'm Daky, your ContentFlow AI assistant. I can draft posts, schedule content, generate SEO articles, and help with social media strategy. What would you like to do?",
      }]);
    }
  }, [open, messages.length]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 100); }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: TextMessage = { kind: 'text', id: crypto.randomUUID(), role: 'user', content: text };
    const assistantId = crypto.randomUUID();

    setMessages(prev => [...prev, userMsg, { kind: 'text', id: assistantId, role: 'assistant', content: '' }]);
    setInput('');
    setLoading(true);

    const token = localStorage.getItem('auth_token');
    // Build history from text messages only (tools are display-only)
    const history = [...messages, userMsg]
      .filter((m): m is TextMessage => m.kind === 'text')
      .map(({ role, content }) => ({ role, content }));

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const res = await fetch(`${getApiBaseUrl()}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: history, page: window.location.pathname }),
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
            const ev = JSON.parse(payload) as any;

            if (ev.error) throw new Error(ev.error);

            if (ev.type === 'text' && ev.text) {
              setMessages(prev =>
                prev.map(m => m.id === assistantId && m.kind === 'text'
                  ? { ...m, content: m.content + ev.text } : m)
              );
            } else if (ev.type === 'tool_start') {
              const toolId = `tool-${ev.name}-${Date.now()}`;
              setMessages(prev => [
                ...prev.filter(m => !(m.kind === 'text' && m.id === assistantId && m.content === '')),
                { kind: 'tool', id: toolId, name: ev.name, label: ev.label, status: 'running' },
                { kind: 'text', id: assistantId, role: 'assistant', content: '' },
              ]);
            } else if (ev.type === 'tool_done') {
              setMessages(prev =>
                prev.map(m =>
                  m.kind === 'tool' && m.name === ev.name && m.status === 'running'
                    ? { ...m, status: ev.success ? 'done' : 'error', result: ev.result, error: ev.error }
                    : m
                )
              );
            }
          } catch (parseErr: any) {
            if (parseErr?.name !== 'SyntaxError') throw parseErr;
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setMessages(prev =>
        prev.map(m => m.id === assistantId && m.kind === 'text'
          ? { ...m, content: err?.message || 'Something went wrong. Please try again.' } : m)
      );
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  const SUGGESTIONS = [
    'Generate an SEO article about content marketing',
    'Draft a LinkedIn post about productivity',
    'Schedule a post for tomorrow at 9am',
    'Which platforms am I connected to?',
  ];

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition-transform hover:scale-110 active:scale-95"
        style={{ background: 'linear-gradient(135deg,#a855f7 0%,#22d3ee 100%)' }}
        aria-label="Open AI assistant"
      >
        <SparkleIcon size={28} />
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-24 right-6 z-50 flex w-[370px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          style={{ height: '500px' }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ background: 'linear-gradient(135deg,#a855f7 0%,#22d3ee 100%)' }}>
            <SparkleIcon size={20} />
            <div className="flex-1">
              <div className="text-sm font-bold text-white">Daky</div>
              <div className="text-xs text-white/70">Your ContentFlow AI assistant</div>
            </div>
            <button type="button" onClick={() => setOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 hover:bg-white/20">✕</button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
            {messages.map(msg => (
              <div key={msg.id}>
                {msg.kind === 'tool' ? (
                  <div className="pl-9">
                    <ToolCard msg={msg} />
                  </div>
                ) : (
                  <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'assistant' && (
                      <div className="mr-2 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                        style={{ background: 'linear-gradient(135deg,#a855f7 0%,#22d3ee 100%)' }}>
                        <SparkleIcon size={14} />
                      </div>
                    )}
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'rounded-br-sm bg-slate-900 text-white'
                        : 'rounded-bl-sm bg-slate-100 text-slate-800'
                    }`}>
                      {msg.content
                        ? renderText(msg.content)
                        : <span className="inline-block h-4 w-4 animate-pulse rounded bg-slate-300" />}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {loading && messages[messages.length - 1]?.kind === 'text' && (messages[messages.length - 1] as TextMessage).content === '' && (
              <div className="flex justify-start">
                <div className="mr-2 mt-1 h-7 w-7 shrink-0 rounded-full flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg,#a855f7 0%,#22d3ee 100%)' }}>
                  <SparkleIcon size={14} />
                </div>
                <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2">
                  <span className="flex gap-1">
                    {[0,1,2].map(i => (
                      <span key={i} className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />
                    ))}
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Quick suggestions */}
          {messages.length <= 1 && (
            <div className="px-4 pb-2 shrink-0 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map(s => (
                <button key={s} type="button"
                  onClick={() => { setInput(s); inputRef.current?.focus(); }}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100">
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="shrink-0 border-t border-slate-100 px-3 py-3 flex gap-2 items-end">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={loading}
              placeholder="Ask Daky to draft, schedule, or generate content…"
              className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400 disabled:opacity-50"
              style={{ maxHeight: 96, overflowY: 'auto' }}
            />
            <button type="button" onClick={() => void send()}
              disabled={!input.trim() || loading}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white disabled:opacity-40 transition-opacity"
              style={{ background: 'linear-gradient(135deg,#a855f7 0%,#22d3ee 100%)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
