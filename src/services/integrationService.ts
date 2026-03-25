import { API_BASE_URL } from '../utils/apiBase';

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

const isVisibleIntegration = (item: IntegrationCatalogItem) =>
  item.slug === 'wordpress' || item.slug === 'mailchimp' || (item.adminEnabled && item.configured);

const FALLBACK_CATALOG: Array<{ slug: string; name: string; type: IntegrationType }> = [
  { slug: 'wordpress', name: 'WordPress', type: 'cms' },
  { slug: 'facebook', name: 'Facebook', type: 'social' },
  { slug: 'instagram', name: 'Instagram', type: 'social' },
  { slug: 'linkedin', name: 'LinkedIn', type: 'social' },
  { slug: 'twitter', name: 'X (Twitter)', type: 'social' },
  { slug: 'pinterest', name: 'Pinterest', type: 'social' },
  { slug: 'mailchimp', name: 'Mailchimp', type: 'marketing' },
];

const normalizePlatform = (value: string) => {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'x' || v.includes('twitter')) return 'twitter';
  if (v.includes('facebook')) return 'facebook';
  if (v.includes('instagram')) return 'instagram';
  if (v.includes('linkedin')) return 'linkedin';
  if (v.includes('pinterest')) return 'pinterest';
  if (v.includes('wordpress')) return 'wordpress';
  if (v.includes('mailchimp')) return 'mailchimp';
  if (v.includes('threads')) return 'threads';
  if (v.includes('tiktok')) return 'tiktok';
  return v;
};

const fallbackCatalog = async (): Promise<{ success: boolean; integrations?: IntegrationCatalogItem[]; error?: string }> => {
  try {
    const [enabledRes, accountsRes, wpRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/integrations/enabled`, { headers: authHeaders() }),
      fetch(`${API_BASE_URL}/api/accounts`, { headers: authHeaders() }),
      fetch(`${API_BASE_URL}/api/wordpress/status`, { headers: authHeaders() }),
    ]);

    const enabledData = await enabledRes.json().catch(() => ({} as any));
    const accountsData = await accountsRes.json().catch(() => ({} as any));
    const wpData = await wpRes.json().catch(() => ({} as any));

    const enabled = Array.isArray(enabledData.enabled) ? enabledData.enabled.map(normalizePlatform) : [];
    const enabledSet = new Set(enabled.filter(Boolean));
    const accounts = Array.isArray(accountsData.data) ? accountsData.data : [];
    const connectedSet = new Set(
      accounts
        .filter((acc: any) => acc?.connected !== false)
        .map((acc: any) => normalizePlatform(acc.platform))
        .filter(Boolean)
    );

    const wpConnected = Boolean(wpData?.connected);

    const integrations: IntegrationCatalogItem[] = FALLBACK_CATALOG.map((item) => {
      const isUserManaged = item.slug === 'wordpress' || item.slug === 'mailchimp';
      const adminEnabled = isUserManaged ? true : enabledSet.has(item.slug);
      const configured = isUserManaged ? true : enabledSet.has(item.slug);
      const connected =
        item.slug === 'wordpress'
          ? wpConnected
          : item.slug === 'mailchimp'
            ? false
            : connectedSet.has(item.slug);
      const connection =
        item.slug === 'wordpress' && wpConnected
          ? { siteUrl: wpData?.siteUrl || null, connectedAt: null }
          : null;
      return { ...item, adminEnabled, configured, connected, connection };
    }).filter(isVisibleIntegration);

    return { success: true, integrations };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to load integrations' };
  }
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
    if (res.status === 404) {
      return fallbackCatalog();
    }
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) return { success: false, error: data.error || 'Failed to load integrations' };
    const integrations = Array.isArray(data.integrations) ? data.integrations.filter(isVisibleIntegration) : [];
    return { success: true, integrations };
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

  async listFacebookPages(): Promise<{
    success: boolean;
    pages?: Array<{ id: string; name: string; picture?: string | null; can_publish?: boolean }>;
    missingPermissions?: string[];
    error?: string;
  }> {
    const res = await fetch(`${API_BASE_URL}/api/v1/social/facebook/pages`, { headers: authHeaders() });
    if (res.status === 404) {
      const legacyRes = await fetch(`${API_BASE_URL}/api/facebook/targets`, { headers: authHeaders() });
      const legacyData = await legacyRes.json().catch(() => ({} as any));
      if (!legacyRes.ok) {
        return { success: false, error: legacyData.error || `Failed to load pages (${legacyRes.status})` };
      }
      return { success: true, pages: legacyData.pages || [], missingPermissions: legacyData.missingPermissions || [] };
    }
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) return { success: false, error: data.error || `Failed to load pages (${res.status})` };
    return { success: true, pages: data.pages || [], missingPermissions: data.missingPermissions || [] };
  },

  async listFacebookTargets(): Promise<{
    success: boolean;
    pages?: Array<{ id: string; name: string; picture?: string | null; can_publish?: boolean }>;
    groups?: Array<{ id: string; name: string }>;
    missingPermissions?: string[];
    warnings?: string[];
    error?: string;
  }> {
    const res = await fetch(`${API_BASE_URL}/api/v1/social/facebook/targets`, { headers: authHeaders() });
    if (res.status === 404) {
      const legacyRes = await fetch(`${API_BASE_URL}/api/facebook/targets`, { headers: authHeaders() });
      const legacyData = await legacyRes.json().catch(() => ({} as any));
      if (!legacyRes.ok) {
        return { success: false, error: legacyData.error || `Failed to load targets (${legacyRes.status})` };
      }
      return {
        success: true,
        pages: legacyData.pages || [],
        groups: legacyData.groups || [],
        warnings: legacyData.warnings ? [legacyData.warnings].flat() : legacyData.warning ? [legacyData.warning] : [],
      };
    }
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) return { success: false, error: data.error || `Failed to load targets (${res.status})` };
    return {
      success: true,
      pages: data.pages || [],
      groups: data.groups || [],
      missingPermissions: data.missingPermissions || [],
      warnings: data.warnings || [],
    };
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

  async listLinkedInTargets(): Promise<{
    success: boolean;
    targets?: Array<{ id: string; name: string; accountType: 'profile' | 'page'; saved?: boolean }>;
    warning?: string | null;
    error?: string;
  }> {
    const res = await fetch(`${API_BASE_URL}/api/linkedin/targets`, { headers: authHeaders() });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) return { success: false, error: data.error || 'Failed to load LinkedIn targets' };
    return { success: true, targets: data.targets || [], warning: data.warning || null };
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
