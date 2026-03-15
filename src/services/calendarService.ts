import { API_BASE_URL } from '../utils/apiBase';

function getToken() {
  return localStorage.getItem('auth_token') || '';
}

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}

async function parseApiResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const errorMessage = json?.error || json?.message || text || 'Request failed';
    throw new Error(typeof errorMessage === 'string' ? errorMessage : 'Request failed');
  }
  if (text && json === null) {
    throw new Error('Invalid server response');
  }
  return (json ?? {}) as T;
}

export interface CalendarPost {
  id: string;
  user_id: string;
  title: string;
  content: string;
  platform: string;
  status: string;
  scheduledAt: string | null;
  createdAt: string;
  media?: any;
  platformResponse?: any;
  errorLog?: string;
}

export async function fetchCalendarPosts(params: {
  start_date: string;
  end_date: string;
  platform?: string;
}): Promise<CalendarPost[]> {
  const qs = new URLSearchParams();
  qs.set('start_date', params.start_date);
  qs.set('end_date', params.end_date);
  if (params.platform) qs.set('platform', params.platform);

  const res = await fetch(`${API_BASE_URL}/api/calendar/posts?${qs.toString()}`, {
    headers: authHeaders(),
  });
  const data = await parseApiResponse<{ posts?: CalendarPost[] }>(res);
  return data.posts ?? [];
}

export async function fetchUnscheduledPosts(): Promise<CalendarPost[]> {
  const res = await fetch(`${API_BASE_URL}/api/posts/unscheduled`, {
    headers: authHeaders(),
  });
  const data = await parseApiResponse<{ posts?: CalendarPost[] }>(res);
  return data.posts ?? [];
}

export async function updatePostSchedule(id: string, scheduledAt: string | null) {
  const res = await fetch(`${API_BASE_URL}/api/posts/${encodeURIComponent(id)}/schedule`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ scheduled_at: scheduledAt }),
  });
  const data = await parseApiResponse<{ post?: CalendarPost }>(res);
  return data.post!;
}

export async function createPost(payload: Partial<CalendarPost>) {
  const res = await fetch(`${API_BASE_URL}/api/posts`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await parseApiResponse<{ post?: CalendarPost }>(res);
  return data.post!;
}
