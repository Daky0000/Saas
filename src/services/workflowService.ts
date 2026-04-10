import { API_BASE_URL } from '../utils/apiBase';

function getToken() {
  return localStorage.getItem('auth_token') || '';
}

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Server error (${res.status})`);
  }
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || `Request failed (${res.status})`);
  }
  return json as T;
}

export type WorkflowField = {
  name: string;
  type: 'select' | 'multiselect' | 'number' | 'text' | 'time' | 'json';
  options?: string[];
  placeholder?: string;
  label?: string;
};

export type WorkflowTrigger = {
  id: string;
  name: string;
  description: string;
  fields: WorkflowField[];
};

export type WorkflowAction = {
  id: string;
  name: string;
  description: string;
  fields: WorkflowField[];
};

export type WorkflowCondition = {
  field: string;
  operator: string;
  value: any;
  sort_order?: number;
};

export type WorkflowActionStep = {
  action_type: string;
  action_config: Record<string, any>;
  delay_seconds?: number;
  sort_order?: number;
};

export type Workflow = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  trigger_type: string;
  trigger_config: Record<string, any>;
  condition_mode: 'AND' | 'OR';
  enabled: boolean;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  condition_count?: number;
  action_count?: number;
  total_runs?: number;
  last_run_status?: string | null;
  conditions?: WorkflowCondition[];
  actions?: WorkflowActionStep[];
};

export type WorkflowRun = {
  id: string;
  workflow_id: string;
  user_id: string;
  trigger_type: string | null;
  trigger_event_id: string | null;
  trigger_data: any;
  status: string;
  error_message: string | null;
  triggered_at: string;
  completed_at: string | null;
  duration_seconds?: number;
  steps_completed?: number;
  steps_failed?: number;
};

export type WorkflowRunStep = {
  action_type: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  result: any;
  error: string | null;
};

const BASE = `${API_BASE_URL}/api/workflows`;

export const workflowService = {
  async listTriggers(): Promise<WorkflowTrigger[]> {
    const res = await fetch(`${BASE}/triggers`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; triggers: WorkflowTrigger[] }>(res);
    return data.triggers ?? [];
  },

  async listActions(): Promise<WorkflowAction[]> {
    const res = await fetch(`${BASE}/actions`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; actions: WorkflowAction[] }>(res);
    return data.actions ?? [];
  },

  async listWorkflows(): Promise<Workflow[]> {
    const res = await fetch(BASE, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; workflows: Workflow[] }>(res);
    return data.workflows ?? [];
  },

  async getWorkflow(id: string): Promise<Workflow> {
    const res = await fetch(`${BASE}/${encodeURIComponent(id)}`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; workflow: Workflow }>(res);
    return data.workflow;
  },

  async createWorkflow(payload: Omit<Workflow, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'last_run_at'> & { conditions: WorkflowCondition[]; actions: WorkflowActionStep[] }): Promise<Workflow> {
    const res = await fetch(BASE, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; workflow: Workflow }>(res);
    return data.workflow;
  },

  async updateWorkflow(id: string, payload: Partial<Workflow> & { conditions: WorkflowCondition[]; actions: WorkflowActionStep[] }): Promise<Workflow> {
    const res = await fetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; workflow: Workflow }>(res);
    return data.workflow;
  },

  async deleteWorkflow(id: string): Promise<void> {
    await fetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
  },

  async setEnabled(id: string, enabled?: boolean): Promise<boolean> {
    const res = await fetch(`${BASE}/${encodeURIComponent(id)}/enable`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(typeof enabled === 'boolean' ? { enabled } : {}) });
    const data = await parseJson<{ success: boolean; enabled: boolean }>(res);
    return Boolean(data.enabled);
  },

  async testWorkflow(id: string, trigger_data?: any): Promise<{ workflow_run_id?: string; status?: string; steps?: any[]; skipped?: boolean; reason?: string }> {
    const res = await fetch(`${BASE}/${encodeURIComponent(id)}/test`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(trigger_data ? { trigger_data } : {}) });
    return parseJson(res);
  },

  async listRuns(id: string): Promise<{ runs: WorkflowRun[]; total: number }> {
    const res = await fetch(`${BASE}/${encodeURIComponent(id)}/runs`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; runs: WorkflowRun[]; total: number }>(res);
    return { runs: data.runs ?? [], total: Number(data.total ?? 0) };
  },

  async getRun(id: string, runId: string): Promise<{ run: WorkflowRun; steps: WorkflowRunStep[] }> {
    const res = await fetch(`${BASE}/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; run: WorkflowRun; steps: WorkflowRunStep[] }>(res);
    return { run: data.run, steps: data.steps ?? [] };
  },
};

