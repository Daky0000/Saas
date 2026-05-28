import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, Mail, RefreshCw, Trash2, X } from 'lucide-react';
import { API_BASE_URL } from '../utils/apiBase';

// ── Types ─────────────────────────────────────────────────────────────────────

type SyncStatus = {
  status: 'idle' | 'running' | 'done' | 'error';
  totalFetched: number;
  lastSyncedAt: string | null;
  errorMessage: string | null;
};

type Chat = {
  email: string;
  name: string;
  company: string;
  domain: string;
  messageCount: number;
  unreadCount: number;
  lastMessageAt: string | null;
  lastSnippet: string;
  lastSubject: string;
};

type Message = {
  id: string;
  threadId: string;
  subject: string;
  snippet: string;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  date: string | null;
  isRead: boolean;
  isSent: boolean;
  bodyText: string | null;
};

// ── Utilities ─────────────────────────────────────────────────────────────────

const authHeaders = (): Record<string, string> => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatFullDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function domainInitial(domain: string): string {
  if (!domain) return '?';
  return domain.charAt(0).toUpperCase();
}

const DOMAIN_COLORS: Record<string, string> = {
  'gmail.com': 'bg-red-100 text-red-700',
  'yahoo.com': 'bg-purple-100 text-purple-700',
  'outlook.com': 'bg-blue-100 text-blue-700',
  'hotmail.com': 'bg-blue-100 text-blue-700',
  'icloud.com': 'bg-slate-100 text-slate-700',
};

function domainColor(domain: string): string {
  return DOMAIN_COLORS[domain] || 'bg-indigo-100 text-indigo-700';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MessageBubble({ msg, onLoadBody }: {
  msg: Message;
  onLoadBody: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loadingBody, setLoadingBody] = useState(false);
  const isMine = msg.isSent;

  const handleExpand = async () => {
    if (!expanded && !msg.bodyText) {
      setLoadingBody(true);
      await onLoadBody(msg.id);
      setLoadingBody(false);
    }
    setExpanded((v) => !v);
  };

  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
          isMine
            ? 'rounded-tr-sm bg-[#5b6cf9] text-white'
            : 'rounded-tl-sm border border-slate-200 bg-white text-slate-900'
        }`}
      >
        {/* Subject */}
        {msg.subject && msg.subject !== '(No subject)' && (
          <div className={`mb-1 text-[11px] font-bold uppercase tracking-wide ${isMine ? 'text-indigo-200' : 'text-slate-400'}`}>
            {msg.subject}
          </div>
        )}

        {/* Body or snippet */}
        <div className="leading-relaxed">
          {expanded && msg.bodyText ? (
            <pre className={`whitespace-pre-wrap font-sans text-sm ${isMine ? 'text-white' : 'text-slate-800'}`}>
              {msg.bodyText.slice(0, 8000)}
              {msg.bodyText.length > 8000 && '…'}
            </pre>
          ) : (
            <span className={isMine ? 'text-indigo-100' : 'text-slate-600'}>
              {msg.snippet || '(empty)'}
            </span>
          )}
        </div>

        {/* Expand/collapse toggle */}
        <button
          type="button"
          onClick={handleExpand}
          className={`mt-2 flex items-center gap-1 text-[11px] font-semibold ${isMine ? 'text-indigo-200 hover:text-white' : 'text-slate-400 hover:text-slate-700'}`}
        >
          {loadingBody ? (
            <Loader2 size={11} className="animate-spin" />
          ) : expanded ? (
            <ChevronUp size={11} />
          ) : (
            <ChevronDown size={11} />
          )}
          {loadingBody ? 'Loading…' : expanded ? 'Collapse' : 'Read full message'}
        </button>

        {/* Timestamp */}
        <div className={`mt-1.5 text-right text-[10px] ${isMine ? 'text-indigo-300' : 'text-slate-400'}`}>
          {formatFullDate(msg.date)}
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function GmailInbox() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    status: 'idle', totalFetched: 0, lastSyncedAt: null, errorMessage: null,
  });
  const [chats, setChats] = useState<Chat[]>([]);
  const [filteredChats, setFilteredChats] = useState<Chat[]>([]);
  const [search, setSearch] = useState('');
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── API helpers ─────────────────────────────────────────────────────────────

  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/gmail/sync/status`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (data.success !== false) setSyncStatus(data);
    } catch {
      // ignore
    }
  }, []);

  const fetchChats = useCallback(async () => {
    setLoadingChats(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/gmail/chats`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.chats)) {
        setChats(data.chats);
        setFilteredChats(data.chats);
      }
    } finally {
      setLoadingChats(false);
    }
  }, []);

  const fetchMessages = useCallback(async (chat: Chat) => {
    setLoadingMessages(true);
    setMessages([]);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/gmail/chats/${encodeURIComponent(chat.email)}/messages`,
        { headers: authHeaders() }
      );
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.messages)) setMessages(data.messages);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const loadBody = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/gmail/messages/${encodeURIComponent(id)}/body`, {
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success && data.body) {
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, bodyText: data.body } : m))
        );
      }
    } catch {
      // ignore
    }
  }, []);

  const startSync = async () => {
    await fetch(`${API_BASE_URL}/api/gmail/sync`, {
      method: 'POST',
      headers: authHeaders(),
    });
    await fetchSyncStatus();
  };

  const resetInbox = async () => {
    await fetch(`${API_BASE_URL}/api/gmail/messages`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    setChats([]);
    setFilteredChats([]);
    setSelectedChat(null);
    setMessages([]);
    setSyncStatus({ status: 'idle', totalFetched: 0, lastSyncedAt: null, errorMessage: null });
    setConfirmReset(false);
  };

  // ── Polling ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    void fetchSyncStatus();
  }, [fetchSyncStatus]);

  useEffect(() => {
    if (syncStatus.status === 'running') {
      pollRef.current = setTimeout(async () => {
        await fetchSyncStatus();
      }, 2000);
    } else {
      if (pollRef.current) clearTimeout(pollRef.current);
      if (syncStatus.status === 'done' && syncStatus.totalFetched > 0) {
        void fetchChats();
      }
    }
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [syncStatus, fetchSyncStatus, fetchChats]);

  // Load chats on mount if already synced
  useEffect(() => {
    if (syncStatus.status === 'done') void fetchChats();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Search filter ────────────────────────────────────────────────────────────

  useEffect(() => {
    const q = search.toLowerCase().trim();
    if (!q) { setFilteredChats(chats); return; }
    setFilteredChats(
      chats.filter(
        (c) =>
          c.email.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.company.toLowerCase().includes(q) ||
          c.lastSubject.toLowerCase().includes(q)
      )
    );
  }, [search, chats]);

  // ── Auto-scroll on new messages ──────────────────────────────────────────────

  useEffect(() => {
    if (messages.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  // ── Chat selection ────────────────────────────────────────────────────────────

  const openChat = (chat: Chat) => {
    setSelectedChat(chat);
    void fetchMessages(chat);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const isSyncing = syncStatus.status === 'running';
  const hasSynced = syncStatus.status === 'done' || syncStatus.totalFetched > 0;

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col overflow-hidden">
      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <Mail size={20} className="text-red-500" />
          <div>
            <h1 className="text-base font-black tracking-tight text-slate-950">Gmail Inbox</h1>
            <p className="text-[11px] text-slate-400">
              {syncStatus.status === 'running' && `Syncing… ${syncStatus.totalFetched} messages`}
              {syncStatus.status === 'done' && `${syncStatus.totalFetched.toLocaleString()} messages synced`}
              {syncStatus.status === 'error' && (
                <span className="text-red-500">{syncStatus.errorMessage || 'Sync failed'}</span>
              )}
              {syncStatus.status === 'idle' && 'Not synced yet'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasSynced && (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
            >
              <Trash2 size={12} />
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={() => void startSync()}
            disabled={isSyncing}
            className="flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {isSyncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {isSyncing ? 'Syncing…' : hasSynced ? 'Re-sync' : 'Sync Gmail'}
          </button>
        </div>
      </div>

      {/* ── Progress bar during sync ─────────────────────────────────────────── */}
      {isSyncing && (
        <div className="h-0.5 shrink-0 bg-slate-100">
          <div className="h-full animate-pulse bg-[#5b6cf9]" style={{ width: `${Math.min((syncStatus.totalFetched / 2000) * 100, 100)}%` }} />
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      {!hasSynced && !isSyncing ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
            <Mail size={32} className="text-red-400" />
          </div>
          <div>
            <p className="text-lg font-black text-slate-900">Your Gmail inbox awaits</p>
            <p className="mt-1 max-w-xs text-sm text-slate-500">
              Click "Sync Gmail" to import up to 2,000 emails and group them by contact.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void startSync()}
            className="flex items-center gap-2 rounded-xl bg-[#5b6cf9] px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-600"
          >
            <RefreshCw size={14} />
            Sync Gmail Now
          </button>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* ── Chat list (left panel) ─────────────────────────────────────── */}
          <div className={`flex flex-col border-r border-slate-200 bg-white ${selectedChat ? 'hidden md:flex md:w-80 lg:w-96' : 'flex-1 md:w-80 lg:w-96'}`}>
            {/* Search */}
            <div className="border-b border-slate-100 px-3 py-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search contacts…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-slate-400"
              />
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {loadingChats && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={20} className="animate-spin text-slate-400" />
                </div>
              )}
              {!loadingChats && isSyncing && syncStatus.totalFetched === 0 && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={20} className="animate-spin text-slate-400" />
                  <span className="ml-2 text-sm text-slate-400">Syncing…</span>
                </div>
              )}
              {!loadingChats && filteredChats.length === 0 && !isSyncing && (
                <div className="py-8 text-center text-sm text-slate-400">
                  {search ? 'No matching contacts' : 'No emails synced yet'}
                </div>
              )}
              {filteredChats.map((chat) => (
                <button
                  key={chat.email}
                  type="button"
                  onClick={() => openChat(chat)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                    selectedChat?.email === chat.email ? 'bg-indigo-50 hover:bg-indigo-50' : ''
                  }`}
                >
                  {/* Avatar */}
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-black ${domainColor(chat.domain)}`}
                  >
                    {domainInitial(chat.domain)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className={`truncate text-sm font-semibold ${chat.unreadCount > 0 ? 'text-slate-950' : 'text-slate-700'}`}>
                        {chat.name}
                      </span>
                      <span className="shrink-0 text-[10px] text-slate-400">
                        {relativeTime(chat.lastMessageAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-xs text-slate-400">{chat.email}</span>
                      {chat.unreadCount > 0 && (
                        <span className="ml-1 flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full bg-[#5b6cf9] px-1 text-[10px] font-bold text-white">
                          {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{chat.lastSnippet || chat.lastSubject}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {chat.company}{chat.messageCount > 1 ? ` · ${chat.messageCount} messages` : ''}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ── Conversation panel (right) ─────────────────────────────────── */}
          {selectedChat ? (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Chat header */}
              <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
                <button
                  type="button"
                  onClick={() => setSelectedChat(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white md:hidden"
                >
                  <ArrowLeft size={14} />
                </button>
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-black ${domainColor(selectedChat.domain)}`}
                >
                  {domainInitial(selectedChat.domain)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-black text-slate-950">{selectedChat.name}</p>
                  <p className="truncate text-xs text-slate-400">
                    {selectedChat.email} · {selectedChat.company}
                    {selectedChat.messageCount > 1 && ` · ${selectedChat.messageCount} messages`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedChat(null)}
                  className="hidden h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white md:flex"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-5 py-4">
                {loadingMessages && (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={20} className="animate-spin text-slate-400" />
                  </div>
                )}
                {!loadingMessages && messages.length === 0 && (
                  <div className="py-12 text-center text-sm text-slate-400">No messages found</div>
                )}
                {messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    onLoadBody={loadBody}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>
          ) : (
            <div className="hidden flex-1 flex-col items-center justify-center gap-3 bg-slate-50 md:flex">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
                <Mail size={24} className="text-slate-400" />
              </div>
              <p className="text-sm font-semibold text-slate-500">Select a contact to read the conversation</p>
            </div>
          )}
        </div>
      )}

      {/* ── Reset confirmation modal ─────────────────────────────────────────── */}
      {confirmReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-black text-slate-950">Clear Gmail data?</h3>
            <p className="mt-2 text-sm text-slate-500">
              This removes all {syncStatus.totalFetched.toLocaleString()} synced messages from ContentFlow.
              Your actual Gmail account is not affected.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void resetInbox()}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
