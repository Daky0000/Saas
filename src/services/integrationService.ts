const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com') ? '' : rawApiBaseUrl.replace(/\/$/, '');

const authHeaders = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export type IntegrationType = 'cms' | 'social' | 'marketing' | 'other';

export type IntegrationCatalogItem = {
  slug: string;
  name: string;
  type: IntegrationType;
  adminEnabled: boolean;
  configured: boolean;
  connected: boolean;
  connection: Record<string, any> | null;
};

async function sha256Base64Url(input: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  const bytes = new Uint8Array(digest);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  const b64 = btoa(str);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomString(length = 48) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export const integrationService = {
  async getCatalog(): Promise<{ success: boolean; integrations?: IntegrationCatalogItem[]; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/integrations/catalog`, { headers: authHeaders() });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) return { success: false, error: data.error || 'Failed to load integrations' };
    return { success: true, integrations: data.integrations || [] };
  },

  async disconnectOAuth(platform: string): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/accounts/${encodeURIComponent(platform)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) return { success: false, error: data.error || 'Failed to disconnect' };
    return { success: true };
  },

  async startOAuth(platform: string, returnTo = '/integrations'): Promise<{ success: boolean; error?: string }> {
    const normalized = String(platform || '').trim().toLowerCase();
    const state = randomString(32);

    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;

    if (normalized === 'twitter') {
      codeVerifier = randomString(64);
      codeChallenge = await sha256Base64Url(codeVerifier);
    }

    const stateRes = await fetch(`${API_BASE_URL}/api/oauth/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ state, platform: normalized, returnTo, codeVerifier }),
    });
    const stateData = await stateRes.json().catch(() => ({} as any));
    if (!stateRes.ok) return { success: false, error: stateData.error || 'Failed to start OAuth' };

    const url = new URL(`${API_BASE_URL}/api/oauth/${encodeURIComponent(normalized)}/authorize-url`);
    url.searchParams.set('state', state);
    if (normalized === 'twitter' && codeChallenge) {
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }

    const authRes = await fetch(url.toString(), { headers: authHeaders() });
    const authData = await authRes.json().catch(() => ({} as any));
    if (!authRes.ok) return { success: false, error: authData.error || 'Failed to build authorization URL' };
    if (!authData.url) return { success: false, error: 'Authorization URL missing' };

    window.location.href = authData.url;
    return { success: true };
  },

  async listFacebookPages(): Promise<{ success: boolean; pages?: Array<{ id: string; name: string; picture?: string | null }>; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/v1/social/facebook/pages`, { headers: authHeaders() });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) return { success: false, error: data.error || 'Failed to load pages' };
    return { success: true, pages: data.pages || [] };
  },

  async listInstagramTargets(): Promise<{ success: boolean; targets?: Array<{ pageId: string; pageName: string; instagramId: string | null; instagramUsername: string | null }>; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/instagram/targets`, { headers: authHeaders() });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) return { success: false, error: data.error || 'Failed to load Instagram targets' };
    return { success: true, targets: data.targets || [] };
  },

  async connectInstagram(pageId: string, instagramId: string, instagramUsername?: string | null): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/instagram/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ pageId, instagramId, instagramUsername }),
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) return { success: false, error: data.error || 'Failed to connect Instagram' };
    return { success: true };
  },

  async listPinterestBoards(): Promise<{ success: boolean; boards?: Array<{ id: string; name: string }>; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/pinterest/boards`, { headers: authHeaders() });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) return { success: false, error: data.error || 'Failed to load boards' };
    return { success: true, boards: data.boards || [] };
  },

  async saveSocialTarget(payload: { platform: string; account_type: string; account_id: string; account_name: string }): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/v1/social/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) return { success: false, error: data.error || 'Failed to save target' };
    return { success: true };
  },

  async connectMailchimp(payload: { apiKey: string; serverPrefix: string }): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/integrations/mailchimp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) return { success: false, error: data.error || 'Failed to connect Mailchimp' };
    return { success: true };
  },

  async disconnectMailchimp(): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`${API_BASE_URL}/api/integrations/mailchimp/disconnect`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) return { success: false, error: data.error || 'Failed to disconnect Mailchimp' };
    return { success: true };
  },
};
