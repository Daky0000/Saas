import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Calendar, Users, Bell, ChevronLeft, ChevronRight,
  Repeat, Link2, AlertCircle, Loader2, Check,
} from 'lucide-react';
import RichTextEditor from '../RichTextEditor';
import { API_BASE_URL } from '../../utils/apiBase';

const tok = () => localStorage.getItem('auth_token') ?? '';
const authH = () => ({ Authorization: `Bearer ${tok()}` });
const jsonH = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` });
const api = (path: string) => `${API_BASE_URL}${path}`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Attendee {
  id?: string;
  type: 'company' | 'contact';
  name: string;
  email: string;
}

interface GoogleEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  colorId?: string;
}

interface Props {
  companyId: string;
  companyName: string;
  companyEmail?: string | null;
  defaultAttendees?: Attendee[];
  onCreated: (activity: any) => void;
  onClose: () => void;
}

const RECURRENCE_OPTIONS = [
  { value: '', label: 'Does not repeat' },
  { value: 'RRULE:FREQ=DAILY', label: 'Every day' },
  { value: 'RRULE:FREQ=WEEKLY', label: 'Every week' },
  { value: 'RRULE:FREQ=WEEKLY;INTERVAL=2', label: 'Every 2 weeks' },
  { value: 'RRULE:FREQ=MONTHLY', label: 'Every month' },
];

const REMINDER_OPTIONS = [
  { value: 5, label: '5 min before' },
  { value: 10, label: '10 min before' },
  { value: 30, label: '30 min before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
];

const EVENT_COLORS = ['#4285f4','#0f9d58','#f4b400','#db4437','#9c27b0','#00bcd4','#ff5722','#795548'];

function toLocalDateString(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateTime(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00`);
}

// ── MiniCalendar (week view) ──────────────────────────────────────────────────

function MiniCalendar({
  events,
  loading,
  weekOffset,
  onPrevWeek,
  onNextWeek,
  hideWeekends,
  onToggleWeekends,
}: {
  events: GoogleEvent[];
  loading: boolean;
  weekOffset: number;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  currentStart?: string;
  currentEnd?: string;
  hideWeekends: boolean;
  onToggleWeekends: () => void;
}) {
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay() + 1 + weekOffset * 7); // Monday

  const days = hideWeekends
    ? [0, 1, 2, 3, 4].map(i => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d; })
    : [0, 1, 2, 3, 4, 5, 6].map(i => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d; });

  const weekLabel = (() => {
    const s = days[0];
    const e = days[days.length - 1];
    const monthSame = s.getMonth() === e.getMonth();
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return monthSame
      ? `${s.toLocaleDateString('en-US', { month: 'short' })} ${s.getDate()} - ${e.getDate()}, ${s.getFullYear()}`
      : `${fmt(s)} - ${fmt(e)}, ${s.getFullYear()}`;
  })();

  // Hours to show: 7am to 10pm
  const HOUR_START = 7;
  const HOUR_END = 22;
  const HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => i + HOUR_START);
  const TOTAL_MINUTES = (HOUR_END - HOUR_START) * 60;
  const PX_PER_MIN = 1.5;

  function getEventStyle(ev: GoogleEvent, day: Date) {
    const startStr = ev.start.dateTime;
    const endStr = ev.end.dateTime;
    if (!startStr || !endStr) return null;
    const s = new Date(startStr);
    const e = new Date(endStr);
    if (s.toDateString() !== day.toDateString()) return null;
    const startMins = (s.getHours() - HOUR_START) * 60 + s.getMinutes();
    const durationMins = Math.max(30, (e.getTime() - s.getTime()) / 60000);
    const top = Math.max(0, startMins) * PX_PER_MIN;
    const height = Math.min(durationMins, TOTAL_MINUTES - Math.max(0, startMins)) * PX_PER_MIN;
    return { top, height };
  }

  return (
    <div className="flex flex-col h-full">
      {/* Calendar header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <button onClick={onPrevWeek} className="p-1 rounded hover:bg-gray-100 text-gray-400"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-semibold text-gray-700">{weekLabel}</span>
          <button onClick={onNextWeek} className="p-1 rounded hover:bg-gray-100 text-gray-400"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" checked={hideWeekends} onChange={() => onToggleWeekends()} className="rounded text-[#5b6cf9]" />
            Hide weekends
          </label>
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
        </div>
      </div>

      {/* Day columns header */}
      <div className="flex-shrink-0 border-b border-gray-100">
        <div className="flex">
          <div className="w-10 flex-shrink-0" />
          {days.map(d => {
            const isToday = d.toDateString() === today.toDateString();
            return (
              <div key={d.toISOString()} className="flex-1 py-2 text-center border-l border-gray-100 first:border-l-0">
                <p className="text-[10px] font-medium text-gray-400 uppercase">{d.toLocaleDateString('en-US', { weekday: 'short' })}</p>
                <div className={`w-6 h-6 mx-auto rounded-full flex items-center justify-center text-xs font-semibold mt-0.5 ${isToday ? 'bg-[#5b6cf9] text-white' : 'text-gray-700'}`}>
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Time grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex" style={{ minHeight: `${TOTAL_MINUTES * PX_PER_MIN}px` }}>
          {/* Hour labels */}
          <div className="w-10 flex-shrink-0 relative">
            {HOURS.map(h => (
              <div key={h} className="absolute text-[9px] text-gray-400 text-right pr-1.5 leading-none" style={{ top: `${(h - HOUR_START) * 60 * PX_PER_MIN - 4}px`, right: 0, width: '100%' }}>
                {h === 12 ? '12pm' : h > 12 ? `${h - 12}pm` : `${h}am`}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map(day => {
            const dayEvents = events.filter(ev => {
              const startDt = ev.start.dateTime || ev.start.date;
              if (!startDt) return false;
              return new Date(startDt).toDateString() === day.toDateString();
            });

            return (
              <div key={day.toISOString()} className="flex-1 relative border-l border-gray-100 first:border-l-0" style={{ height: `${TOTAL_MINUTES * PX_PER_MIN}px` }}>
                {/* Hour lines */}
                {HOURS.map(h => (
                  <div key={h} className="absolute w-full border-t border-gray-50" style={{ top: `${(h - HOUR_START) * 60 * PX_PER_MIN}px` }} />
                ))}

                {/* Events */}
                {dayEvents.map(ev => {
                  const style = getEventStyle(ev, day);
                  if (!style) return null;
                  const color = EVENT_COLORS[(parseInt(ev.colorId || '0') || 0) % EVENT_COLORS.length] || '#4285f4';
                  const startStr = ev.start.dateTime;
                  const timeLabel = startStr ? new Date(startStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false }) : '';
                  return (
                    <div
                      key={ev.id}
                      className="absolute left-0.5 right-0.5 rounded overflow-hidden px-1 py-0.5 text-white text-[9px] leading-tight"
                      style={{ top: `${style.top}px`, height: `${style.height}px`, background: color, zIndex: 1 }}
                      title={ev.summary}
                    >
                      <div className="font-medium truncate">{ev.summary}</div>
                      <div className="opacity-80">{timeLabel}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export default function ScheduleMeetingModal({ companyId, companyName, companyEmail, defaultAttendees, onCreated, onClose }: Props) {
  const today = new Date();

  // Form state
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(toLocalDateString(today));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('09:30');
  const [recurrence, setRecurrence] = useState('');
  const [attendees, setAttendees] = useState<Attendee[]>(() => {
    const base: Attendee[] = [{ type: 'company', name: companyName, email: companyEmail || '' }];
    if (defaultAttendees) return [...base, ...defaultAttendees.filter(a => a.email !== companyEmail)];
    return base;
  });
  const [attendeeQuery, setAttendeeQuery] = useState('');
  const [attendeeResults, setAttendeeResults] = useState<Attendee[]>([]);
  const [attendeeSearching, setAttendeeSearching] = useState(false);
  const [showAttendeeDropdown, setShowAttendeeDropdown] = useState(false);
  const [reminders, setReminders] = useState<number[]>([30]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calendar state
  const [calConnected, setCalConnected] = useState<boolean | null>(null);
  const [calEvents, setCalEvents] = useState<GoogleEvent[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [hideWeekends, setHideWeekends] = useState(true);
  const [connectingCal, setConnectingCal] = useState(false);

  const attendeeRef = useRef<HTMLDivElement>(null);

  // Check Google Calendar status
  useEffect(() => {
    fetch(api('/api/calendar/google/status'), { headers: authH() })
      .then(r => r.ok ? r.json() : { connected: false })
      .then(d => setCalConnected(d.connected))
      .catch(() => setCalConnected(false));
  }, []);

  // Fetch calendar events when connected or week changes
  const fetchCalEvents = useCallback(async () => {
    if (!calConnected) return;
    setCalLoading(true);
    try {
      const base = new Date();
      const weekStart = new Date(base);
      weekStart.setDate(base.getDate() - base.getDay() + 1 + weekOffset * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      const r = await fetch(api(`/api/calendar/events?start=${weekStart.toISOString()}&end=${weekEnd.toISOString()}`), { headers: authH() });
      const data = r.ok ? await r.json() : { events: [] };
      setCalEvents(Array.isArray(data.events) ? data.events : []);
    } finally {
      setCalLoading(false);
    }
  }, [calConnected, weekOffset]);

  useEffect(() => { void fetchCalEvents(); }, [fetchCalEvents]);

  // Attendee search
  useEffect(() => {
    if (!attendeeQuery.trim()) { setAttendeeResults([]); return; }
    const t = setTimeout(async () => {
      setAttendeeSearching(true);
      try {
        const r = await fetch(api(`/api/mailing/contacts?search=${encodeURIComponent(attendeeQuery)}&limit=10`), { headers: authH() });
        const d = r.ok ? await r.json() : { contacts: [] };
        const contacts: Attendee[] = (d.contacts || []).map((c: any) => ({
          id: c.id, type: 'contact' as const,
          name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
          email: c.email,
        }));
        setAttendeeResults(contacts.filter(a => !attendees.some(ex => ex.email === a.email)));
      } finally { setAttendeeSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [attendeeQuery, attendees]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (attendeeRef.current && !attendeeRef.current.contains(e.target as Node)) {
        setShowAttendeeDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addAttendee = (a: Attendee) => {
    setAttendees(prev => [...prev, a]);
    setAttendeeQuery('');
    setAttendeeResults([]);
    setShowAttendeeDropdown(false);
  };

  const removeAttendee = (email: string) => {
    setAttendees(prev => prev.filter(a => a.email !== email));
  };

  const toggleReminder = (mins: number) => {
    setReminders(prev => prev.includes(mins) ? prev.filter(m => m !== mins) : [...prev, mins]);
  };

  const connectGoogleCalendar = async () => {
    setConnectingCal(true);
    try {
      const r = await fetch(api('/api/calendar/google/connect-url'), { method: 'POST', headers: jsonH() });
      const d = await r.json();
      if (!d.url) { setError(d.error || 'Failed to get OAuth URL'); return; }

      // Open OAuth in a popup so the modal stays open
      const popup = window.open(d.url, 'gcal_oauth', 'width=600,height=700,left=200,top=100');

      // Listen for postMessage from popup after OAuth completes
      const onMessage = (ev: MessageEvent) => {
        if (ev.data?.type === 'calendar_connected') {
          window.removeEventListener('message', onMessage);
          clearInterval(pollTimer);
          setCalConnected(true);
          void fetchCalEvents();
        }
      };
      window.addEventListener('message', onMessage);

      // Fallback poll: if popup closes without postMessage (user cancelled), re-check status
      const pollTimer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(pollTimer);
          window.removeEventListener('message', onMessage);
          fetch(api('/api/calendar/google/status'), { headers: authH() })
            .then(r => r.ok ? r.json() : { connected: false })
            .then(d => {
              if (d.connected) { setCalConnected(true); void fetchCalEvents(); }
            })
            .catch(() => {});
        }
      }, 1000);
    } catch {
      setError('Failed to initiate Google Calendar connection');
    } finally { setConnectingCal(false); }
  };

  const handleSave = async () => {
    if (!title.trim()) { setError('Meeting title is required'); return; }
    setSaving(true); setError(null);
    try {
      const startDt = parseDateTime(startDate, startTime);
      const endDt = parseDateTime(startDate, endTime);
      if (endDt <= startDt) { setError('End time must be after start time'); return; }

      const attendeesWithEmail = attendees.filter(a => a.email);

      // Create CRM activity
      const actRes = await fetch(api('/api/crm/activities'), {
        method: 'POST',
        headers: jsonH(),
        body: JSON.stringify({
          type: 'meeting',
          title: title.trim(),
          body: notes || null,
          company_id: companyId,
          scheduled_at: startDt.toISOString(),
          end_time: endDt.toISOString(),
          recurrence: recurrence || null,
          attendees: attendeesWithEmail,
          reminder_minutes: reminders.length > 0 ? reminders : null,
        }),
      });
      if (!actRes.ok) {
        const d = await actRes.json();
        setError(d.error || 'Failed to save meeting');
        return;
      }
      const activity = await actRes.json();

      // Create Google Calendar event if connected
      if (calConnected) {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const gcRes = await fetch(api('/api/calendar/events'), {
          method: 'POST',
          headers: jsonH(),
          body: JSON.stringify({
            summary: title.trim(),
            description: notes ? notes.replace(/<[^>]*>/g, '') : '',
            start: { dateTime: startDt.toISOString(), timeZone: tz },
            end: { dateTime: endDt.toISOString(), timeZone: tz },
            attendees: attendeesWithEmail,
            recurrence: recurrence ? [recurrence] : undefined,
            reminders: reminders.length > 0
              ? { useDefault: false, overrides: reminders.map(m => ({ method: 'popup', minutes: m })) }
              : { useDefault: true },
          }),
        });
        if (gcRes.ok) {
          const gcData = await gcRes.json();
          if (gcData.event?.id) {
            await fetch(api(`/api/crm/activities/${activity.id}`), {
              method: 'PATCH',
              headers: jsonH(),
              body: JSON.stringify({ google_event_id: gcData.event.id }),
            }).catch(() => {});
          }
          // Refresh calendar view to show the new event
          void fetchCalEvents();
        }
      }

      onCreated({ ...activity, end_time: endDt.toISOString(), attendees: attendeesWithEmail });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl flex overflow-hidden" style={{ width: '900px', maxWidth: '95vw', height: '620px', maxHeight: '90vh' }}>

        {/* ── Left: Form ────────────────────────────────────────────────────── */}
        <div className="flex flex-col w-96 flex-shrink-0 border-r border-gray-100">
          {/* Header */}
          <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="text-[15px] font-bold text-gray-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#5b6cf9]" /> Schedule Meeting
            </h2>
            <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><X className="w-4 h-4" /></button>
          </div>

          {/* Form body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-600">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            {/* Title */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Title *</label>
              <input
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9]"
                placeholder="Meeting title…"
                value={title}
                onChange={e => setTitle(e.target.value)}
                autoFocus
              />
            </div>

            {/* Date + Times */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Start date</label>
              <input
                type="date"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9]"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Start time</label>
                <input
                  type="time"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9]"
                  value={startTime}
                  onChange={e => {
                    setStartTime(e.target.value);
                    if (e.target.value >= endTime) {
                      const [h, m] = e.target.value.split(':').map(Number);
                      const newEnd = `${String(h + (m >= 30 ? 1 : 0)).padStart(2, '0')}:${m < 30 ? String(m + 30).padStart(2, '0') : '00'}`;
                      setEndTime(newEnd);
                    }
                  }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">End time</label>
                <input
                  type="time"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9]"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                />
              </div>
            </div>

            {/* Recurrence */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1.5">
                <Repeat className="w-3 h-3" /> Repeat
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9] bg-white"
                value={recurrence}
                onChange={e => setRecurrence(e.target.value)}
              >
                {RECURRENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Attendees */}
            <div ref={attendeeRef} className="relative">
              <label className="block text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1.5">
                <Users className="w-3 h-3" /> Attendees
              </label>
              {/* Chips */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                {attendees.map(a => (
                  <div key={a.email} className="flex items-center gap-1 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5 text-xs text-indigo-700">
                    <span className="max-w-[120px] truncate">{a.name || a.email}</span>
                    {a.type !== 'company' && (
                      <button onClick={() => removeAttendee(a.email)} className="ml-0.5 text-indigo-400 hover:text-indigo-700">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                    {a.type === 'company' && <span className="ml-0.5 text-indigo-400 text-[10px]">(company)</span>}
                  </div>
                ))}
              </div>
              {/* Search input */}
              <div className="relative">
                <input
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b6cf9]/20 focus:border-[#5b6cf9]"
                  placeholder="Search contacts to add…"
                  value={attendeeQuery}
                  onChange={e => { setAttendeeQuery(e.target.value); setShowAttendeeDropdown(true); }}
                  onFocus={() => setShowAttendeeDropdown(true)}
                />
                {attendeeSearching && <Loader2 className="absolute right-2.5 top-2.5 w-4 h-4 animate-spin text-gray-400" />}
              </div>
              {/* Dropdown */}
              {showAttendeeDropdown && attendeeResults.length > 0 && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden max-h-40 overflow-y-auto">
                  {attendeeResults.map(a => (
                    <button
                      key={a.email}
                      type="button"
                      onMouseDown={() => addAttendee(a)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left"
                    >
                      <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                        {(a.name || a.email)[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{a.name}</p>
                        <p className="text-[10px] text-gray-400 truncate">{a.email}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Reminders */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
                <Bell className="w-3 h-3" /> Reminders
              </label>
              <div className="flex flex-wrap gap-1.5">
                {REMINDER_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggleReminder(o.value)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${reminders.includes(o.value) ? 'bg-[#5b6cf9] text-white border-[#5b6cf9]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#5b6cf9] hover:text-[#5b6cf9]'}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
              <RichTextEditor value={notes} onChange={setNotes} />
            </div>
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 border-t border-gray-100 px-5 py-3 flex items-center justify-between gap-2">
            {calConnected === false && (
              <div className="flex items-center gap-1.5 text-xs text-amber-600">
                <AlertCircle className="w-3 h-3 flex-shrink-0" />
                <span>No Google Calendar</span>
              </div>
            )}
            {calConnected === true && (
              <div className="flex items-center gap-1 text-xs text-green-600">
                <Check className="w-3 h-3" /> Calendar synced
              </div>
            )}
            {calConnected === null && <div />}
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl border border-gray-200">
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving || !title.trim()}
                className="px-5 py-2 bg-[#5b6cf9] text-white text-sm font-bold rounded-xl hover:bg-[#4a5be8] disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Schedule meeting'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Right: Calendar ────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-50/50">
          {calConnected === false ? (
            <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
                <Calendar className="w-7 h-7 text-[#5b6cf9]" />
              </div>
              <h3 className="text-sm font-bold text-gray-800 mb-1">Sync your Google Calendar</h3>
              <p className="text-xs text-gray-500 mb-5 max-w-xs leading-relaxed">
                Connect Google Calendar to see your schedule and automatically add meetings to your calendar.
              </p>
              <button
                onClick={() => void connectGoogleCalendar()}
                disabled={connectingCal}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#5b6cf9] text-white text-sm font-semibold rounded-xl hover:bg-[#4a5be8] disabled:opacity-60 transition-colors"
              >
                {connectingCal ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                Connect Google Calendar
              </button>
              <p className="text-[10px] text-gray-400 mt-3">You can still schedule meetings without connecting</p>
            </div>
          ) : (
            <MiniCalendar
              events={calEvents}
              loading={calLoading}
              weekOffset={weekOffset}
              onPrevWeek={() => setWeekOffset(w => w - 1)}
              onNextWeek={() => setWeekOffset(w => w + 1)}
              currentStart={startDate}
              currentEnd={endTime}
              hideWeekends={hideWeekends}
              onToggleWeekends={() => setHideWeekends(h => !h)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
