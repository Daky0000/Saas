const API_BASE = '/api';

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface UserDesign {
  id: string;
  user_id: string;
  name: string;
  canvas_width: number;
  canvas_height: number;
  canvas_data: object;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

async function request<T>(method: string, path: string, body?: object): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Request failed');
  return data as T;
}

export const designService = {
  async list(): Promise<UserDesign[]> {
    const data = await request<{ success: boolean; designs: UserDesign[] }>('GET', '/designs');
    return data.designs;
  },

  async get(id: string): Promise<UserDesign> {
    const data = await request<{ success: boolean; design: UserDesign }>('GET', `/designs/${id}`);
    return data.design;
  },

  async create(payload: {
    name?: string;
    canvas_width?: number;
    canvas_height?: number;
    canvas_data?: object;
    thumbnail_url?: string | null;
  }): Promise<UserDesign> {
    const data = await request<{ success: boolean; design: UserDesign }>('POST', '/designs', payload);
    return data.design;
  },

  async update(
    id: string,
    payload: Partial<{
      name: string;
      canvas_width: number;
      canvas_height: number;
      canvas_data: object;
      thumbnail_url: string | null;
    }>,
  ): Promise<UserDesign> {
    const data = await request<{ success: boolean; design: UserDesign }>('PUT', `/designs/${id}`, payload);
    return data.design;
  },

  async delete(id: string): Promise<void> {
    await request('DELETE', `/designs/${id}`);
  },
};
