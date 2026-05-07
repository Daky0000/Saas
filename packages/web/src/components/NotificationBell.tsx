import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  Bot,
  Brain,
  Calendar,
  CheckCheck,
  FileText,
  Plug,
  RefreshCw,
  Send,
  Sparkles,
  Star,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { getApiBaseUrl } from '../utils/apiBase';

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, any>;
  is_read: boolean;
  created_at: string;
};

function tok() {
  return localStorage.getItem('auth_token') ?? '';
}

const TYPE_META: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  welcome:           { icon: Star,      color: 'text-indigo-600', bg: 'bg-indigo-50' },
  social_connected:  { icon: Plug,      color: 'text-emerald-600', bg: 'bg-emerald-50' },
  social_reconnected:{ icon: RefreshCw, color: 'text-blue-600',    bg: 'bg-blue-50' },
  post_scheduled:    { icon: Calendar,  color: 'text-blue-600',    bg: 'bg-blue-50' },
  post_published:    { icon: Send,      color: 'text-indigo-600',  bg: 'bg-indigo-50' },
  draft_created:     { icon: FileText,  color: 'text-slate-600',   bg: 'bg-slate-100' },
  plan_executed:     { icon: Zap,       color: 'text-violet-600',  bg: 'bg-violet-50' },
  memory_saved:      { icon: Brain,     color: 'text-amber-600',   bg: 'bg-amber-50' },
  skill_compiled:    { icon: Sparkles,  color: 'text-emerald-600', bg: 'bg-emerald-50' },
  agent_activity:    { icon: Bot,       color: 'text-purple-600',  bg: 'bg-purple-50' },
};

function getMeta(type: string) {
  return TYPE_META[type] ?? { icon: Bell, color: 'text-slate-500', bg: 'bg-slate-100' };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/notifications`, {
        headers: { Authorization: `Bearer ${tok()}` },
      });
      const d = await r.json();
      if (d.success) {
        setNotifications(d.notifications);
        setUnreadCount(d.unreadCount);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    void fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const markAllRead = async () => {
    await fetch(`${getApiBaseUrl()}/api/notifications/read-all`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tok()}` },
    }).catch(() => undefined);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  const markRead = async (id: string) => {
    await fetch(`${getApiBaseUrl()}/api/notifications/${id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tok()}` },
    }).catch(() => undefined);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n));
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const dismiss = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`${getApiBaseUrl()}/api/notifications/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok()}` },
    }).catch(() => undefined);
    const wasUnread = notifications.find((n) => n.id === id && !n.is_read);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));
  };

  const clearAll = async () => {
    await fetch(`${getApiBaseUrl()}/api/notifications`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok()}` },
    }).catch(() => undefined);
    setNotifications([]);
    setUnreadCount(0);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open && unreadCount > 0) void markAllRead();
        }}
        className="relative flex items-center justify-center w-8 h-8 rounded-xl hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-800"
        aria-label="Notifications"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-black text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute bottom-full left-0 mb-2 w-80 rounded-2xl border border-gray-200 bg-white shadow-2xl z-50 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-black text-gray-900">Notifications</span>
            <div className="flex items-center gap-1">
              {notifications.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="rounded-lg p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                    title="Mark all read"
                  >
                    <CheckCheck size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={clearAll}
                    className="rounded-lg p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    title="Clear all"
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[380px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Bell size={22} className="text-gray-300" />
                <p className="text-xs text-gray-400">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => {
                const { icon: Icon, color, bg } = getMeta(n.type);
                return (
                  <div
                    key={n.id}
                    onClick={() => !n.is_read && void markRead(n.id)}
                    className={`flex items-start gap-3 px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${!n.is_read ? 'bg-indigo-50/40' : ''}`}
                  >
                    <div className={`mt-0.5 shrink-0 flex h-7 w-7 items-center justify-center rounded-xl ${bg}`}>
                      <Icon size={13} className={color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold leading-snug ${n.is_read ? 'text-gray-700' : 'text-gray-900'}`}>
                        {n.title}
                      </p>
                      <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 mt-0.5">
                      {!n.is_read && (
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
                      )}
                      <button
                        type="button"
                        onClick={(e) => void dismiss(n.id, e)}
                        className="rounded p-0.5 text-gray-300 hover:text-red-500 transition-colors"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
