import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart2,
  CheckCircle,
  Edit2,
  ExternalLink,
  Mic,
  MicOff,
  Paperclip,
  Send,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { getApiBaseUrl } from '../utils/apiBase';

// ── Types ────────────────────────────────────────────────────────────────────

type TextMessage = { kind: 'text'; id: string; role: 'user' | 'assistant'; content: string };
type ToolMessage = {
  kind: 'tool';
  id: string;
  name: string;
  label: string;
  status: 'running' | 'done' | 'error';
  result?: any;
  error?: string;
};
type ChoicesMessage = {
  kind: 'choices';
  id: string;
  question: string;
  options: string[];
  pickedOption?: string;
};
type Message = TextMessage | ToolMessage | ChoicesMessage;

type AttachedImg = { id: string; name: string; dataUrl: string };

// ── Choice detection ─────────────────────────────────────────────────────────

function parseChoicesFromText(text: string): { question: string; options: string[] } | null {
  if (!text.trim()) return null;
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return null;

  const options: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^(?:\d+[.)]\s+|[-•*]\s+)(.+)$/);
    if (m && m[1].length < 80) options.unshift(m[1]);
    else break;
  }
  if (options.length < 2 || options.length > 6) return null;

  const questionLines = lines.slice(0, lines.length - options.length);
  const question = questionLines.join(' ').trim();
  const hasQuestion =
    question.endsWith('?') ||
    /\b(which|what|how|would you|do you|pick|choose|select|prefer)\b/i.test(question);
  if (!hasQuestion) return null;
  return { question, options };
}

// ── Sparkle logo icon ─────────────────────────────────────────────────────────

function SparkleAvatar({ size = 32 }: { size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl"
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
      }}
    >
      <Sparkles size={size * 0.52} className="text-white" />
    </div>
  );
}

// ── Waveform animation (during recording) ─────────────────────────────────────

function WaveformBars() {
  return (
    <span className="flex items-end gap-0.5" aria-hidden>
      {[3, 5, 8, 5, 3, 7, 4, 6, 3].map((h, i) => (
        <span
          key={i}
          className="w-0.5 rounded-full bg-indigo-500 animate-pulse"
          style={{ height: `${h}px`, animationDelay: `${i * 0.07}s`, animationDuration: '0.6s' }}
        />
      ))}
    </span>
  );
}

// ── Markdown-lite renderer ────────────────────────────────────────────────────

function renderText(text: string) {
  return text.split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith('**') && p.endsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>,
    );
    return (
      <p key={i} className={i > 0 ? 'mt-1' : ''}>
        {parts}
      </p>
    );
  });
}

// ── Choice chips ─────────────────────────────────────────────────────────────

function ChoiceChips({
  options,
  picked,
  onPick,
}: {
  options: string[];
  picked?: string;
  onPick: (opt: string | null) => void;
}) {
  const all = [...options, 'Custom'];
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {all.map((opt) => {
        const isCustom = opt === 'Custom';
        const isPicked = picked === opt;
        return (
          <button
            key={opt}
            type="button"
            disabled={!!picked && !isPicked}
            onClick={() => onPick(isCustom ? null : opt)}
            className={`rounded-full px-3 py-1 text-xs font-semibold border transition-all ${
              isPicked
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : isCustom
                ? 'border-slate-300 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40'
                : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-40'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ── Poll preview card ─────────────────────────────────────────────────────────

function PollCard({ title }: { title?: string }) {
  const [voted, setVoted] = useState<number | null>(null);
  const options = ['Option A', 'Option B', 'Option C'];
  const votes = [42, 35, 23];
  const total = votes.reduce((a, b) => a + b, 0);
  return (
    <div className="rounded-xl border border-indigo-100 bg-white overflow-hidden shadow-sm text-xs">
      <div className="px-3 py-2 border-b border-indigo-50 bg-indigo-50 flex items-center gap-2">
        <BarChart2 size={13} className="text-indigo-500" />
        <span className="font-semibold text-indigo-700">{title ?? 'Poll Preview'}</span>
      </div>
      <div className="px-3 py-2 space-y-2">
        {options.map((opt, i) => {
          const pct = Math.round((votes[i] / total) * 100);
          return (
            <button
              key={i}
              type="button"
              onClick={() => setVoted(i)}
              className={`w-full rounded-lg overflow-hidden border text-left transition-all ${
                voted === i ? 'border-indigo-400' : 'border-slate-200 hover:border-indigo-200'
              }`}
            >
              <div className="relative px-2.5 py-1.5">
                <div
                  className="absolute inset-0 rounded-lg"
                  style={{
                    width: `${pct}%`,
                    background: voted === i ? 'rgba(99,102,241,0.15)' : 'rgba(148,163,184,0.1)',
                  }}
                />
                <div className="relative flex items-center justify-between">
                  <span className={voted === i ? 'font-semibold text-indigo-700' : 'text-slate-700'}>{opt}</span>
                  <span className="text-slate-400">{pct}%</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="px-3 pb-3 flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-lg bg-indigo-600 py-1.5 text-center text-xs font-semibold text-white hover:bg-indigo-700"
        >
          Create Poll
        </button>
        <button
          type="button"
          className="flex-1 rounded-lg border border-slate-200 py-1.5 text-center text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Share with Team
        </button>
      </div>
    </div>
  );
}

// ── Inline post preview card ──────────────────────────────────────────────────

function PostPreviewCard({ content, title }: { content: string; title?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm text-xs">
      <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <span className="font-semibold text-slate-700">Post Preview</span>
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-600 font-medium">Draft</span>
      </div>
      {title && <p className="px-3 pt-2 font-semibold text-slate-800">{title}</p>}
      <p className="px-3 py-2 text-slate-700 leading-relaxed whitespace-pre-wrap">{content}</p>
      <div className="px-3 pb-3 flex gap-2">
        <a
          href="/posts"
          className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <Edit2 size={11} />
          Edit
        </a>
        <a
          href="/posts"
          className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
        >
          Post
        </a>
      </div>
    </div>
  );
}

function PostDraftedCard({ title, multiple }: { title?: string; multiple?: boolean }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <CheckCircle size={15} className="text-emerald-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-emerald-800">{multiple ? 'Posts Drafted' : 'Post Drafted'}</p>
          {title && <p className="truncate text-xs text-emerald-700">"{title}"</p>}
        </div>
        <a
          href="/posts"
          className="shrink-0 flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
        >
          {multiple ? 'Visit Posts' : 'View Post'}
          <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}

// ── Tool action card ─────────────────────────────────────────────────────────

function ToolCard({ msg }: { msg: ToolMessage }) {
  if (msg.status === 'running') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-purple-100 bg-purple-50 px-3 py-2 text-xs text-purple-700">
        <span className="flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
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
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 font-semibold capitalize ${
                    p.status === 'published'
                      ? 'bg-emerald-50 text-emerald-700'
                      : p.status === 'scheduled'
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {p.status}
                </span>
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
        {platforms.length === 0 ? (
          <span className="text-slate-400">None connected</span>
        ) : (
          platforms.map((p: any) => (
            <span
              key={p.platform}
              className="mr-1.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 capitalize text-slate-700"
            >
              {p.platform}
            </span>
          ))
        )}
      </div>
    );
  }

  if (msg.name === 'create_draft') {
    const post = msg.result?.post;
    const posts: any[] = msg.result?.posts ?? (post ? [post] : []);
    const isMultiple = posts.length > 1;
    const content = post?.content ?? '';
    const title = post?.title;

    if (!isMultiple && content && content.length < 400) {
      return <PostPreviewCard content={content} title={title} />;
    }
    return <PostDraftedCard title={isMultiple ? undefined : title} multiple={isMultiple} />;
  }

  if (msg.name === 'schedule_post') {
    const post = msg.result?.post;
    const scheduledAt = post?.scheduled_at;
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <CheckCircle size={15} className="text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-emerald-800">Post scheduled</p>
            {post?.title && <p className="truncate text-xs text-emerald-700">"{post.title}"</p>}
            {scheduledAt && (
              <p className="text-xs text-emerald-600 mt-0.5">
                {new Date(scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            )}
          </div>
          <a
            href="/posts"
            className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            View
          </a>
        </div>
      </div>
    );
  }

  if (msg.name === 'create_poll' || msg.label?.toLowerCase().includes('poll')) {
    return <PollCard title={msg.result?.poll?.title} />;
  }

  return null;
}

// ── Suggestion cards ──────────────────────────────────────────────────────────

const SUGGESTIONS = [
  {
    icon: '📢',
    title: 'Draft a social post',
    subtitle: 'Engaging content in seconds.',
    prompt: 'Draft an engaging social media post for my brand',
  },
  {
    icon: '🎤',
    title: 'Transcribe audio',
    subtitle: 'Voice to structured notes.',
    prompt: 'Help me transcribe and structure audio notes',
  },
  {
    icon: '📊',
    title: 'Create a poll',
    subtitle: 'Gather data quickly.',
    prompt: 'Create a poll to gather feedback from my audience',
  },
] as const;

// ── Main Widget ───────────────────────────────────────────────────────────────

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImg[]>([]);

  // Recording state: 'idle' | 'recording' | 'pending' (transcript ready, awaiting send/cancel)
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'pending'>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // ── Send ───────────────────────────────────────────────────────────────────

  const send = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? input).trim();
      if (!text || loading) return;

      const userMsg: TextMessage = { kind: 'text', id: crypto.randomUUID(), role: 'user', content: text };
      const assistantId = crypto.randomUUID();

      setMessages((prev) => [
        ...prev,
        userMsg,
        { kind: 'text', id: assistantId, role: 'assistant', content: '' },
      ]);
      setInput('');
      setAttachedImages([]);
      setRecordingState('idle');
      setLoading(true);

      const token = localStorage.getItem('auth_token');
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
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId && m.kind === 'text' ? { ...m, content: m.content + ev.text } : m,
                  ),
                );
              } else if (ev.type === 'tool_start') {
                const toolId = `tool-${ev.name}-${Date.now()}`;
                setMessages((prev) => [
                  ...prev.filter((m) => !(m.kind === 'text' && m.id === assistantId && m.content === '')),
                  { kind: 'tool', id: toolId, name: ev.name, label: ev.label, status: 'running' },
                  { kind: 'text', id: assistantId, role: 'assistant', content: '' },
                ]);
              } else if (ev.type === 'tool_done') {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.kind === 'tool' && m.name === ev.name && m.status === 'running'
                      ? { ...m, status: ev.success ? 'done' : 'error', result: ev.result, error: ev.error }
                      : m,
                  ),
                );
              }
            } catch (parseErr: any) {
              if (parseErr?.name !== 'SyntaxError') throw parseErr;
            }
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && m.kind === 'text'
              ? { ...m, content: err?.message || 'Something went wrong.' }
              : m,
          ),
        );
      } finally {
        setLoading(false);
        abortRef.current = null;
        // Detect question+choices in the final assistant text
        setTimeout(() => {
          setMessages((prev) => {
            const lastAssistant = [...prev]
              .reverse()
              .find((m): m is TextMessage => m.kind === 'text' && m.role === 'assistant' && !!m.content);
            if (!lastAssistant) return prev;
            const choices = parseChoicesFromText(lastAssistant.content);
            if (!choices) return prev;
            const choicesId = `choices-${lastAssistant.id}`;
            if (prev.some((m) => m.id === choicesId)) return prev;
            return [
              ...prev,
              { kind: 'choices', id: choicesId, question: choices.question, options: choices.options },
            ];
          });
        }, 60);
      }
    },
    [input, loading, messages],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  // ── Choice pick ────────────────────────────────────────────────────────────

  const pickChoice = (choicesId: string, opt: string | null) => {
    if (opt === null) {
      // Custom — just focus input
      inputRef.current?.focus();
      return;
    }
    // Mark as picked and send
    setMessages((prev) =>
      prev.map((m) => (m.id === choicesId && m.kind === 'choices' ? { ...m, pickedOption: opt } : m)),
    );
    void send(opt);
  };

  // ── Audio recording ────────────────────────────────────────────────────────

  const startRecording = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += t;
        else interim += t;
      }
      setInput((finalTranscript + interim).trim());
    };

    recognition.onend = () => {
      stopRecording();
    };
    recognition.onerror = () => {
      stopRecording();
    };

    recognitionRef.current = recognition;
    recognition.start();
    setRecordingState('recording');
    setRecordingSeconds(0);
    timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecordingSeconds(0);
    // Don't auto-send — let user review transcript
    setRecordingState('pending');
  };

  const cancelVoice = () => {
    setInput('');
    setRecordingState('idle');
  };

  const sendVoice = () => {
    const transcript = input.trim();
    if (transcript) void send(transcript);
    else setRecordingState('idle');
  };

  const toggleRecording = () => {
    if (recordingState === 'recording') stopRecording();
    else startRecording();
  };

  const fmtTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  // ── File attach ────────────────────────────────────────────────────────────

  const onFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          setAttachedImages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), name: file.name, dataUrl: ev.target?.result as string },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        setInput((prev) => (prev ? `${prev} [File: ${file.name}]` : `[File: ${file.name}]`));
      }
    }
    e.target.value = '';
  };

  const hasMessages = messages.length > 0;

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 flex items-center justify-center rounded-2xl shadow-xl transition-all hover:scale-105 active:scale-95 focus:outline-none"
        style={{
          width: 52,
          height: 52,
          background: 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
        }}
        aria-label="Open Daky AI assistant"
      >
        <Sparkles size={22} className="text-white" />
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-24 right-6 z-50 flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          style={{ width: 380, height: 600, maxWidth: 'calc(100vw - 1.5rem)' }}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-4 py-3">
            <SparkleAvatar size={34} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-900">Daky</div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                ACTIVE
              </div>
            </div>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Settings"
            >
              <Settings size={15} />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {!hasMessages ? (
              <div className="flex flex-col items-center px-5 pt-7 pb-4">
                <div
                  className="flex h-14 w-14 items-center justify-center rounded-2xl mb-4"
                  style={{ background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)' }}
                >
                  <Sparkles size={28} className="text-indigo-500" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 mb-1.5">How can I help you?</h2>
                <p className="text-center text-sm text-slate-500 leading-relaxed mb-6">
                  I'm Daky, your AI companion for writing, content, and brainstorming.
                </p>
                <div className="w-full mb-1">
                  <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">Suggested</span>
                </div>
                <div className="w-full space-y-2 mt-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.title}
                      type="button"
                      onClick={() => {
                        setInput(s.prompt);
                        inputRef.current?.focus();
                      }}
                      className="flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-3 text-left hover:border-indigo-200 hover:bg-indigo-50 transition-colors"
                    >
                      <span className="text-xl shrink-0">{s.icon}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800">{s.title}</p>
                        <p className="text-[11px] text-slate-400">{s.subtitle}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="px-4 py-3 space-y-3">
                {messages.map((msg) => (
                  <div key={msg.id}>
                    {msg.kind === 'tool' ? (
                      <div className="pl-9">
                        <ToolCard msg={msg} />
                      </div>
                    ) : msg.kind === 'choices' ? (
                      <div className="pl-9">
                        <ChoiceChips
                          options={msg.options}
                          picked={msg.pickedOption}
                          onPick={(opt) => pickChoice(msg.id, opt)}
                        />
                      </div>
                    ) : (
                      <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}>
                        {msg.role === 'assistant' && <SparkleAvatar size={28} />}
                        <div
                          className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                            msg.role === 'user'
                              ? 'rounded-br-sm bg-indigo-600 text-white'
                              : 'rounded-bl-sm bg-slate-100 text-slate-800'
                          }`}
                        >
                          {/* Attached image thumbnails in user bubble */}
                          {msg.role === 'user' && msg.content.startsWith('[img:') ? null : null}
                          {msg.content ? (
                            renderText(msg.content)
                          ) : (
                            <span className="inline-block h-4 w-8 animate-pulse rounded bg-slate-300" />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {loading &&
                  messages.length > 0 &&
                  messages[messages.length - 1]?.kind === 'text' &&
                  (messages[messages.length - 1] as TextMessage).content === '' && (
                    <div className="flex items-start gap-2">
                      <SparkleAvatar size={28} />
                      <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3.5 py-2.5">
                        <span className="flex gap-1 items-center">
                          {[0, 1, 2].map((i) => (
                            <span
                              key={i}
                              className="h-2 w-2 rounded-full bg-slate-400 animate-bounce"
                              style={{ animationDelay: `${i * 0.15}s` }}
                            />
                          ))}
                        </span>
                      </div>
                    </div>
                  )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Input bar */}
          <div className="shrink-0 border-t border-slate-100 px-3 py-3">
            {recordingState === 'recording' ? (
              /* Active recording */
              <div className="flex items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-2.5">
                <WaveformBars />
                <span className="flex-1 text-xs font-semibold text-indigo-600 tabular-nums">
                  {fmtTime(recordingSeconds)}
                </span>
                <button
                  type="button"
                  onClick={toggleRecording}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-white"
                  aria-label="Stop recording"
                >
                  <MicOff size={13} />
                </button>
              </div>
            ) : recordingState === 'pending' ? (
              /* Transcript ready — review & decide */
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                  <Mic size={13} className="text-indigo-500 shrink-0" />
                  <p className="flex-1 text-xs text-indigo-800 leading-snug line-clamp-2">
                    {input || '(no transcript)'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={cancelVoice}
                    className="flex-1 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={sendVoice}
                    disabled={!input.trim()}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                  >
                    <Send size={12} />
                    Send Audio
                  </button>
                </div>
              </div>
            ) : (
              /* Normal input */
              <div className="space-y-2">
                {/* Attached image chips */}
                {attachedImages.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {attachedImages.map((img) => (
                      <div key={img.id} className="group relative">
                        <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
                          <img
                            src={img.dataUrl}
                            alt={img.name}
                            className="h-9 w-9 object-cover transition-all"
                          />
                          <button
                            type="button"
                            onClick={() => setAttachedImages((p) => p.filter((x) => x.id !== img.id))}
                            className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-white text-[9px] opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            ×
                          </button>
                        </div>
                        {/* Hover preview */}
                        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 group-hover:block">
                          <img
                            src={img.dataUrl}
                            alt={img.name}
                            className="max-h-40 max-w-52 rounded-xl border border-slate-200 shadow-xl object-contain bg-white p-1"
                          />
                          <p className="mt-1 text-center text-[10px] text-slate-500 truncate max-w-52">{img.name}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-end gap-1.5">
                  {/* Attach */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    aria-label="Attach file"
                  >
                    <Paperclip size={16} />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    accept="image/*,*"
                    onChange={onFileAttach}
                  />

                  {/* Text area */}
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    disabled={loading}
                    placeholder="Ask Daky anything..."
                    className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300 disabled:opacity-50"
                    style={{ maxHeight: 96, overflowY: 'auto' }}
                  />

                  {/* Mic */}
                  <button
                    type="button"
                    onClick={toggleRecording}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-indigo-500"
                    aria-label="Start voice input"
                  >
                    <Mic size={16} />
                  </button>

                  {/* Send */}
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={!input.trim() || loading}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm transition-opacity hover:bg-indigo-700 disabled:opacity-40"
                    aria-label="Send message"
                  >
                    <Send size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
