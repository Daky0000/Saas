import { API_BASE_URL } from '../utils/apiBase';

const BASE = `${API_BASE_URL}/api/leads`;

function getToken() { return localStorage.getItem('auth_token') || ''; }
function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}
async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try { return JSON.parse(text) as T; } catch { throw new Error(`Server error (${res.status})`); }
}

export type LeadGroup = {
  id: string;
  name: string;
  fields: string[];
  lead_count: number;
  created_at: string;
};

export type Lead = {
  id: string;
  group_id: string;
  data: Record<string, string>;
  created_at: string;
};

export const leadService = {
  async listGroups(): Promise<LeadGroup[]> {
    const res = await fetch(`${BASE}/groups`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; groups: LeadGroup[] }>(res);
    return data.groups ?? [];
  },

  async createGroup(name: string): Promise<LeadGroup> {
    const res = await fetch(`${BASE}/groups`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name }) });
    const data = await parseJson<{ success: boolean; group: LeadGroup; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed');
    return data.group;
  },

  async deleteGroup(id: string): Promise<void> {
    await fetch(`${BASE}/groups/${id}`, { method: 'DELETE', headers: authHeaders() });
  },

  async getGroupLeads(id: string): Promise<{ group: LeadGroup; leads: Lead[] }> {
    const res = await fetch(`${BASE}/groups/${id}/leads`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; group: LeadGroup; leads: Lead[]; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed');
    return { group: data.group, leads: data.leads };
  },

  async addLead(groupId: string, data: Record<string, string>): Promise<Lead> {
    const res = await fetch(`${BASE}/groups/${groupId}/leads`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ data }) });
    const json = await parseJson<{ success: boolean; lead: Lead; error?: string }>(res);
    if (!json.success) throw new Error(json.error || 'Failed');
    return json.lead;
  },

  async importLeads(groupId: string, leads: Record<string, string>[]): Promise<number> {
    const res = await fetch(`${BASE}/groups/${groupId}/import`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ leads }) });
    const data = await parseJson<{ success: boolean; imported: number; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Import failed');
    return data.imported;
  },

  async deleteLead(id: string): Promise<void> {
    await fetch(`${BASE}/${id}`, { method: 'DELETE', headers: authHeaders() });
  },
};
