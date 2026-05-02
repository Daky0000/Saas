import { API_BASE_URL } from '../utils/apiBase';

function getToken() { return localStorage.getItem('auth_token') || ''; }
function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}
async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try { return JSON.parse(text) as T; } catch { throw new Error(`Server error (${res.status})`); }
}

const BASE = `${API_BASE_URL}/api/campaign`;

export type CampaignGoal = 'awareness' | 'leads' | 'sales' | 'traffic' | 'engagement';
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';

export type Campaign = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  goal: CampaignGoal;
  status: CampaignStatus;
  start_date: string | null;
  end_date: string | null;
  budget: number | null;
  currency: string;
  target_url: string;
  tags: string[];
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // computed
  channel_count?: number;
  funnel_count?: number;
  link_count?: number;
  total_clicks?: number;
  total_conversions?: number;
};

export type CampaignChannel = {
  id: string;
  campaign_id: string;
  user_id: string;
  channel_type: string;
  social_account_id: string | null;
  config: Record<string, unknown>;
  status: string;
  created_at: string;
  // joined
  account_name?: string;
  handle?: string;
  profile_image?: string;
  followers?: number;
};

export type Funnel = {
  id: string;
  campaign_id: string;
  user_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  step_count?: number;
  event_count?: number;
};

export type FunnelStep = {
  id: string;
  funnel_id: string;
  user_id: string;
  name: string;
  step_order: number;
  step_type: 'page_view' | 'click' | 'form_submit' | 'purchase' | 'custom';
  target_url: string;
  goal_count: number;
  created_at: string;
  event_count?: number;
};

export type UtmLink = {
  id: string;
  campaign_id: string;
  user_id: string;
  label: string;
  base_url: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  short_code: string;
  full_url: string;
  clicks: number;
  conversions: number;
  created_at: string;
};

export type CampaignMetrics = {
  totalClicks: number;
  totalConversions: number;
  conversionRate: number;
  clicksBySource: Array<{ utm_source: string; utm_medium: string; clicks: number; conversions: number }>;
  eventTimeline: Array<{ event_type: string; day: string; cnt: number }>;
  channels: Array<{ channel_type: string; status: string }>;
  funnels: Array<{ id: string; name: string; total_events: number }>;
};

export const campaignService = {
  // Campaigns
  async listCampaigns(): Promise<Campaign[]> {
    const res = await fetch(`${BASE}/campaigns`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; campaigns: Campaign[] }>(res);
    return data.campaigns ?? [];
  },

  async createCampaign(payload: Partial<Campaign>): Promise<Campaign> {
    const res = await fetch(`${BASE}/campaigns`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; campaign: Campaign; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to create campaign');
    return data.campaign;
  },

  async updateCampaign(id: string, payload: Partial<Campaign>): Promise<Campaign> {
    const res = await fetch(`${BASE}/campaigns/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; campaign: Campaign; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to update campaign');
    return data.campaign;
  },

  async deleteCampaign(id: string): Promise<void> {
    await fetch(`${BASE}/campaigns/${id}`, { method: 'DELETE', headers: authHeaders() });
  },

  // Channels
  async listChannels(campaignId: string): Promise<CampaignChannel[]> {
    const res = await fetch(`${BASE}/campaigns/${campaignId}/channels`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; channels: CampaignChannel[] }>(res);
    return data.channels ?? [];
  },

  async addChannel(campaignId: string, payload: Partial<CampaignChannel>): Promise<CampaignChannel> {
    const res = await fetch(`${BASE}/campaigns/${campaignId}/channels`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; channel: CampaignChannel; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to add channel');
    return data.channel;
  },

  async removeChannel(channelId: string): Promise<void> {
    await fetch(`${BASE}/channels/${channelId}`, { method: 'DELETE', headers: authHeaders() });
  },

  // Funnels
  async listFunnels(campaignId: string): Promise<Funnel[]> {
    const res = await fetch(`${BASE}/campaigns/${campaignId}/funnels`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; funnels: Funnel[] }>(res);
    return data.funnels ?? [];
  },

  async createFunnel(campaignId: string, payload: { name: string; description?: string; steps?: Partial<FunnelStep>[] }): Promise<Funnel> {
    const res = await fetch(`${BASE}/campaigns/${campaignId}/funnels`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; funnel: Funnel; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to create funnel');
    return data.funnel;
  },

  async getFunnel(funnelId: string): Promise<{ funnel: Funnel; steps: FunnelStep[] }> {
    const res = await fetch(`${BASE}/funnels/${funnelId}`, { headers: authHeaders() });
    return parseJson<{ success: boolean; funnel: Funnel; steps: FunnelStep[] }>(res);
  },

  async deleteFunnel(funnelId: string): Promise<void> {
    await fetch(`${BASE}/funnels/${funnelId}`, { method: 'DELETE', headers: authHeaders() });
  },

  async getFunnelSteps(funnelId: string): Promise<FunnelStep[]> {
    const res = await fetch(`${BASE}/funnels/${funnelId}/steps`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; steps: FunnelStep[] }>(res);
    return data.steps ?? [];
  },

  async updateFunnelSteps(funnelId: string, steps: Partial<FunnelStep>[]): Promise<FunnelStep[]> {
    const res = await fetch(`${BASE}/funnels/${funnelId}/steps`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ steps }) });
    const data = await parseJson<{ success: boolean; steps: FunnelStep[]; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to update steps');
    return data.steps;
  },

  // UTM Links
  async listUtmLinks(campaignId: string): Promise<UtmLink[]> {
    const res = await fetch(`${BASE}/campaigns/${campaignId}/utmlinks`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; links: UtmLink[] }>(res);
    return data.links ?? [];
  },

  async createUtmLink(campaignId: string, payload: Partial<UtmLink>): Promise<UtmLink> {
    const res = await fetch(`${BASE}/campaigns/${campaignId}/utmlinks`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; link: UtmLink; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to create UTM link');
    return data.link;
  },

  async deleteUtmLink(linkId: string): Promise<void> {
    await fetch(`${BASE}/utmlinks/${linkId}`, { method: 'DELETE', headers: authHeaders() });
  },

  // Metrics
  async getCampaignMetrics(campaignId: string): Promise<{ campaign: Campaign; metrics: CampaignMetrics }> {
    const res = await fetch(`${BASE}/campaigns/${campaignId}/metrics`, { headers: authHeaders() });
    return parseJson(res);
  },

  // Atomic creation (transaction-backed)
  async createCampaignAtomic(payload: {
    name: string;
    description?: string;
    goal: CampaignGoal;
    target_url?: string;
    start_date?: string;
    end_date?: string;
    budget?: number;
    channels?: string[];
    utm_links?: Array<{ label: string; utm_source: string; utm_medium: string }>;
    mailing_subject?: string;
    attribution_model?: string;
  }): Promise<{
    campaign: Campaign;
    channels: CampaignChannel[];
    funnel: Funnel;
    funnel_steps: FunnelStep[];
    utm_links: UtmLink[];
    mailing_campaign: unknown | null;
    job_ids: string[];
    summary: { channels_created: number; utm_links_created: number; funnel_steps: number; jobs_queued: number };
  }> {
    const res = await fetch(`${BASE}/campaigns/create`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await parseJson<{ success: boolean; error?: string; validationErrors?: string[] } & {
      campaign: Campaign; channels: CampaignChannel[]; funnel: Funnel; funnel_steps: FunnelStep[];
      utm_links: UtmLink[]; mailing_campaign: unknown | null; job_ids: string[];
      summary: { channels_created: number; utm_links_created: number; funnel_steps: number; jobs_queued: number };
    }>(res);
    if (!data.success) {
      const msg = data.validationErrors?.length ? data.validationErrors.join('; ') : (data.error || 'Failed to create campaign');
      throw new Error(msg);
    }
    return data;
  },
};
