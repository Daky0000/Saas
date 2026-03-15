import { DragEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Plus,
  CircleDot,
  Clock,
  ArrowUpRight,
} from 'lucide-react';
import {
  CalendarPost,
  fetchCalendarPosts,
  fetchUnscheduledPosts,
  updatePostSchedule,
  createPost,
} from '../services/calendarService';

const PLATFORM_OPTIONS = ['all', 'facebook', 'instagram', 'twitter', 'linkedin', 'tiktok'];

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = (day + 6) % 7; // Monday = 0
  copy.setDate(copy.getDate() - diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDay(date: Date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
}

function formatMonthHeader(start: Date, end: Date) {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startText = start.toLocaleDateString('en-US', opts);
  const endText = end.toLocaleDateString('en-US', opts);
  return `${startText} — ${endText}`;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending: 'bg-slate-100 text-slate-700',
    scheduled: 'bg-blue-100 text-blue-700',
    published: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-red-100 text-red-700',
  };
  return map[status] ?? 'bg-gray-100 text-gray-700';
}

function formatShortPlatform(platform: string) {
  return platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Unknown';
}

function toIsoAt9am(date: Date) {
  const dt = new Date(date);
  dt.setHours(9, 0, 0, 0);
  return dt.toISOString();
}

type Props = {
  onEditPost: (id: string | null) => void;
};

export default function Calendar({ onEditPost }: Props) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [platform, setPlatform] = useState('all');
  const [calendarPosts, setCalendarPosts] = useState<CalendarPost[]>([]);
  const [unscheduled, setUnscheduled] = useState<CalendarPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickPlatform, setQuickPlatform] = useState('facebook');

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [calendar, unscheduledPosts] = await Promise.all([
        fetchCalendarPosts({
          start_date: weekStart.toISOString(),
          end_date: weekEnd.toISOString(),
          platform: platform !== 'all' ? platform : undefined,
        }),
        fetchUnscheduledPosts(),
      ]);
      setCalendarPosts(calendar);
      setUnscheduled(unscheduledPosts);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [platform, weekEnd, weekStart]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleWeekShift = (deltaWeeks: number) => {
    setWeekStart((prev) => addDays(prev, deltaWeeks * 7));
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>, targetDate: Date) => {
    event.preventDefault();
    const payload = event.dataTransfer.getData('application/json');
    if (!payload) return;

    const dropped = JSON.parse(payload) as { id: string };
    const post = [...calendarPosts, ...unscheduled].find((p) => p.id === dropped.id);
    if (!post) return;

    const scheduledAt = toIsoAt9am(targetDate);
    try {
      const updated = await updatePostSchedule(post.id, scheduledAt);
      // Update UI
      setCalendarPosts((prev) => {
        const trimmed = prev.filter((p) => p.id !== updated.id);
        return [...trimmed, updated];
      });
      setUnscheduled((prev) => prev.filter((p) => p.id !== updated.id));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>, post: CalendarPost) => {
    event.dataTransfer.setData('application/json', JSON.stringify({ id: post.id }));
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleCreateQuick = async () => {
    if (!quickTitle.trim()) return;
    try {
      const created = await createPost({
        title: quickTitle.trim(),
        platform: quickPlatform,
        status: 'pending',
        scheduledAt: null,
      });
      setQuickTitle('');
      setUnscheduled((prev) => [created, ...prev]);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const postsByDay = useMemo(() => {
    const map: Record<string, CalendarPost[]> = {};
    for (const day of days) {
      const key = day.toDateString();
      map[key] = [];
    }
    for (const post of calendarPosts) {
      if (!post.scheduledAt) continue;
      const date = new Date(post.scheduledAt);
      const key = date.toDateString();
      if (!map[key]) continue;
      map[key].push(post);
    }
    return map;
  }, [calendarPosts, days]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Content Calendar</h1>
          <p className="text-sm text-slate-600">Drag posts onto a date to schedule them. Drag between days to reschedule.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleWeekShift(-1)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <ChevronLeft size={16} /> Previous
          </button>
          <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800">
            <CalendarDays size={16} />
            {formatMonthHeader(weekStart, weekEnd)}
          </div>
          <button
            type="button"
            onClick={() => handleWeekShift(1)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Next <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_0.9fr]">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-3">
              <label className="text-sm font-semibold text-slate-700">Platform</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                {PLATFORM_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === 'all' ? 'All platforms' : formatShortPlatform(opt)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onEditPost(null)}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Plus size={16} /> New Post
              </button>
            </div>
          </div>

          {loading && (
            <div className="p-8 text-center text-sm text-slate-500">
              <div className="inline-flex items-center gap-2">
                <Clock className="animate-spin" size={16} /> Loading calendar…
              </div>
            </div>
          )}

          {error && (
            <div className="p-4 text-sm text-red-700">{error}</div>
          )}

          <div className="grid grid-cols-7 gap-px bg-slate-200">
            {days.map((day) => {
              const key = day.toDateString();
              const dayPosts = postsByDay[key] ?? [];
              return (
                <div
                  key={key}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleDrop(event, day)}
                  className="min-h-[220px] bg-white p-3"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-slate-500">{formatDay(day)}</div>
                    </div>
                    <div className="text-xs font-semibold text-slate-500">
                      {day.getDate() === new Date().getDate() && day.getMonth() === new Date().getMonth()
                        ? 'Today'
                        : ''}
                    </div>
                  </div>
                  <div className="mt-2 space-y-2">
                    {dayPosts.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
                        Drag a post here to schedule
                      </div>
                    ) : (
                      dayPosts
                        .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''))
                        .map((post) => (
                          <div
                            key={post.id}
                            draggable
                            onDragStart={(event) => handleDragStart(event, post)}
                            onDoubleClick={() => onEditPost(post.id)}
                            className="group relative cursor-grab rounded-lg border border-slate-200 bg-white p-2 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="text-sm font-semibold text-slate-900 line-clamp-2">
                                {post.title || 'Untitled post'}
                              </div>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadge(post.status)}`}>
                                {post.status}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                              <span>{formatShortPlatform(post.platform)}</span>
                              <span className="flex items-center gap-1">
                                <Clock size={12} />
                                {new Date(post.scheduledAt || '').toLocaleTimeString('en-US', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            <div className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100">
                              <ArrowUpRight size={14} className="text-slate-400" />
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Unscheduled</h2>
            <span className="text-xs text-slate-500">Drag to calendar</span>
          </div>

          <div className="mt-3 space-y-3">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quick create</label>
              <input
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                placeholder="Post title"
                className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <select
                value={quickPlatform}
                onChange={(e) => setQuickPlatform(e.target.value)}
                className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                {PLATFORM_OPTIONS.filter((p) => p !== 'all').map((opt) => (
                  <option key={opt} value={opt}>
                    {formatShortPlatform(opt)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleCreateQuick}
                className="inline-flex w-full items-center justify-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Plus size={16} /> Create Draft
              </button>
            </div>

            <div className="space-y-2">
              {unscheduled.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">
                  No unscheduled posts.
                </div>
              ) : (
                unscheduled.map((post) => (
                  <div
                    key={post.id}
                    draggable
                    onDragStart={(event) => handleDragStart(event, post)}
                    onDoubleClick={() => onEditPost(post.id)}
                    className="group flex cursor-grab items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-slate-900 line-clamp-2">
                        {post.title || 'Untitled post'}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">{formatShortPlatform(post.platform)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge(post.status)}`}>
                          {post.status}
                        </span>
                      </div>
                    </div>
                    <div className="opacity-0 transition group-hover:opacity-100">
                      <CircleDot size={16} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
