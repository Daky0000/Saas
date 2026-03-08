import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Box,
  CheckCircle,
  CreditCard,
  ExternalLink,
  Globe,
  LayoutTemplate,
  Link2,
  Link2Off,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Webhook,
  X,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type IntegrationCategory =
  | 'All integrations'
  | 'Developer tools'
  | 'Communication'
  | 'Productivity'
  | 'Browser tools';

type IntegrationFieldType = 'text' | 'password' | 'url' | 'textarea';

interface IntegrationField {
  id: string;
  label: string;
  placeholder: string;
  type: IntegrationFieldType;
  helpText: string;
}

interface IntegrationDefinition {
  id: string;
  name: string;
  description: string;
  category: IntegrationCategory;
  accentClass: string;
  icon: ReactNode;
  setupTitle: string;
  setupDescription: string;
  requirements: string[];
  fields: IntegrationField[];
  /** OAuth platform — connection via platform login, not API keys */
  isOAuth?: boolean;
  /** Requires server-side credential validation */
  hasValidation?: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CATEGORIES: IntegrationCategory[] = [
  'All integrations',
  'Developer tools',
  'Communication',
  'Productivity',
  'Browser tools',
];

// Platforms where we can do live server-side validation of credentials
const VALIDATED_PLATFORM_IDS = new Set(['wordpress', 'mailchimp', 'chatgpt', 'webflow', 'stripe', 'linear', 'square', 'zapier']);

const INTEGRATIONS: IntegrationDefinition[] = [
  {
    id: 'wordpress',
    name: 'WordPress',
    description: 'Publish posts, pages, and media into your WordPress site from one workflow.',
    category: 'Developer tools',
    accentClass: 'bg-[#1d2327] text-white',
    icon: <Globe size={22} />,
    setupTitle: 'Connect WordPress',
    setupDescription: 'Enter your site URL and credentials. We verify the connection in real time.',
    requirements: ['Site URL', 'Username', 'Application password'],
    hasValidation: true,
    fields: [
      { id: 'siteUrl', label: 'Site URL', placeholder: 'https://your-site.com', type: 'url', helpText: 'Full URL of your WordPress installation.' },
      { id: 'username', label: 'Username', placeholder: 'Admin username', type: 'text', helpText: 'A WordPress user with permission to publish.' },
      { id: 'applicationPassword', label: 'Application password', placeholder: 'xxxx xxxx xxxx xxxx xxxx xxxx', type: 'password', helpText: 'Generate one under Users → Profile → Application Passwords.' },
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'Connect Instagram to publish posts, sync profile data, and manage social workflows.',
    category: 'Communication',
    accentClass: 'bg-gradient-to-br from-pink-500 via-fuchsia-500 to-orange-400 text-white',
    icon: <Globe size={22} />,
    isOAuth: true,
    setupTitle: 'Connect Instagram',
    setupDescription: 'Admin: configure app credentials. Users: click "Connect" to authorise via Instagram.',
    requirements: ['App ID', 'App secret', 'Redirect URI'],
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Instagram app ID', type: 'text', helpText: 'Meta app identifier for your project.' },
      { id: 'appSecret', label: 'App secret', placeholder: 'Instagram app secret', type: 'password', helpText: 'Keep secure. Use the production secret when live.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://marketing.dakyworld.com/auth/instagram/callback', type: 'url', helpText: 'Must match the callback URL in your Meta app settings.' },
    ],
  },
  {
    id: 'facebook',
    name: 'Facebook',
    description: 'Connect Facebook pages and posting permissions to your content pipeline.',
    category: 'Communication',
    accentClass: 'bg-[#1877f2] text-white',
    icon: <Globe size={22} />,
    isOAuth: true,
    setupTitle: 'Connect Facebook',
    setupDescription: 'Admin: configure app credentials. Users: click "Connect" to authorise via Facebook.',
    requirements: ['App ID', 'App secret', 'Redirect URI'],
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Facebook app ID', type: 'text', helpText: 'Meta app ID tied to your Facebook page.' },
      { id: 'appSecret', label: 'App secret', placeholder: 'Facebook app secret', type: 'password', helpText: 'Required to exchange authorization codes securely.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://marketing.dakyworld.com/auth/facebook/callback', type: 'url', helpText: 'Must match the redirect URI registered in your Facebook app.' },
    ],
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'Connect LinkedIn for company updates, personal posts, and distribution workflows.',
    category: 'Communication',
    accentClass: 'bg-[#0a66c2] text-white',
    icon: <Globe size={22} />,
    isOAuth: true,
    setupTitle: 'Connect LinkedIn',
    setupDescription: 'Admin: configure app credentials. Users: click "Connect" to authorise via LinkedIn.',
    requirements: ['Client ID', 'Client secret', 'Redirect URI'],
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'LinkedIn client ID', type: 'text', helpText: 'Client ID from your LinkedIn developer app.' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'LinkedIn client secret', type: 'password', helpText: 'Used to exchange the OAuth authorization code.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://marketing.dakyworld.com/auth/linkedin/callback', type: 'url', helpText: 'Same callback URI configured inside LinkedIn.' },
    ],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    description: 'Connect TikTok to support video publishing flows and creator account access.',
    category: 'Communication',
    accentClass: 'bg-[#111111] text-white',
    icon: <Globe size={22} />,
    isOAuth: true,
    setupTitle: 'Connect TikTok',
    setupDescription: 'Admin: configure app credentials. Users: click "Connect" to authorise via TikTok.',
    requirements: ['Client key', 'Client secret', 'Redirect URI'],
    fields: [
      { id: 'clientKey', label: 'Client key', placeholder: 'TikTok client key', type: 'text', helpText: 'Client key issued by TikTok developers.' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'TikTok client secret', type: 'password', helpText: 'Required for exchanging codes and refreshing tokens.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://marketing.dakyworld.com/auth/tiktok/callback', type: 'url', helpText: 'Must match the URI registered in TikTok developer settings.' },
    ],
  },
  {
    id: 'twitter',
    name: 'Twitter / X',
    description: 'Connect Twitter or X for fast distribution, threads, and community engagement flows.',
    category: 'Communication',
    accentClass: 'bg-black text-white',
    icon: <Globe size={22} />,
    isOAuth: true,
    setupTitle: 'Connect Twitter / X',
    setupDescription: 'Admin: configure app credentials. Users: click "Connect" to authorise via X.',
    requirements: ['Client ID', 'Client secret', 'Redirect URI'],
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'Twitter or X client ID', type: 'text', helpText: 'OAuth 2 client ID from your X developer app.' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'Twitter or X client secret', type: 'password', helpText: 'Required for secure authorization code exchange.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://marketing.dakyworld.com/auth/twitter/callback', type: 'url', helpText: 'This redirect URI must match your X developer setup.' },
    ],
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    description: 'Grow your business with an all-in-one marketing, automation, and email toolkit.',
    category: 'Communication',
    accentClass: 'bg-[#f5df4d] text-[#1f1f1f]',
    icon: <Mail size={22} />,
    setupTitle: 'Connect Mailchimp',
    setupDescription: 'Enter your API key and server prefix. We verify the credentials in real time.',
    requirements: ['API key', 'Server prefix', 'Audience ID'],
    hasValidation: true,
    fields: [
      { id: 'apiKey', label: 'API key', placeholder: 'Enter your Mailchimp API key', type: 'password', helpText: 'Found under Account → Extras → API keys.' },
      { id: 'serverPrefix', label: 'Server prefix', placeholder: 'us21', type: 'text', helpText: 'Data center prefix from your Mailchimp account (e.g. us21).' },
      { id: 'audienceId', label: 'Audience ID', placeholder: 'Primary audience ID', type: 'text', helpText: 'The audience new leads should sync into.' },
    ],
  },
  {
    id: 'square',
    name: 'Square',
    description: 'Start selling right out of the box with payments processing and POS solutions.',
    category: 'Productivity',
    accentClass: 'bg-black text-white',
    icon: <Box size={22} />,
    setupTitle: 'Connect Square',
    setupDescription: 'Enter your Square production access token. We verify it in real time.',
    requirements: ['Application ID', 'Access token', 'Location ID'],
    hasValidation: true,
    fields: [
      { id: 'applicationId', label: 'Application ID', placeholder: 'Square application ID', type: 'text', helpText: 'Application identifier from your Square developer dashboard.' },
      { id: 'accessToken', label: 'Access token', placeholder: 'Production access token', type: 'password', helpText: 'Use a production token for live charges.' },
      { id: 'locationId', label: 'Location ID', placeholder: 'Main Square location ID', type: 'text', helpText: 'Which Square business location to use.' },
    ],
  },
  {
    id: 'brave',
    name: 'Brave',
    description: 'Brave is a privacy-first browser powered by the Chromium engine.',
    category: 'Browser tools',
    accentClass: 'bg-[#fff2eb] text-[#dc5a2f]',
    icon: <Globe size={22} />,
    setupTitle: 'Configure Brave',
    setupDescription: 'Set workspace details used for previews and QA automation.',
    requirements: ['Profile name', 'Launch URL', 'Optional extension ID'],
    fields: [
      { id: 'profileName', label: 'Profile name', placeholder: 'Marketing QA', type: 'text', helpText: 'Name of the Brave profile your team should open for review.' },
      { id: 'launchUrl', label: 'Launch URL', placeholder: 'https://your-site.com', type: 'url', helpText: 'URL to open by default when launching.' },
      { id: 'extensionId', label: 'Extension ID', placeholder: 'Optional extension or wallet ID', type: 'text', helpText: 'Only needed if your flow depends on a specific Brave extension.' },
    ],
  },
  {
    id: 'zapier',
    name: 'Zapier',
    description: 'Build custom automations and integrations with other apps you use every day.',
    category: 'Productivity',
    accentClass: 'bg-[#ff6a2a] text-white',
    icon: <Webhook size={22} />,
    setupTitle: 'Connect Zapier',
    setupDescription: 'Paste your Zapier webhook URL. We send a test event to verify it works.',
    requirements: ['Webhook URL', 'Zap name', 'Secret key'],
    hasValidation: true,
    fields: [
      { id: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://hooks.zapier.com/hooks/catch/...', type: 'url', helpText: 'Paste the Zapier webhook that should receive events.' },
      { id: 'zapName', label: 'Zap name', placeholder: 'New lead sync', type: 'text', helpText: 'Descriptive name so teammates know which automation is connected.' },
      { id: 'secretKey', label: 'Secret key', placeholder: 'Optional verification secret', type: 'password', helpText: 'Add this if your Zap validates inbound requests.' },
    ],
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Streamline software projects, sprints, tasks, and bug tracking.',
    category: 'Developer tools',
    accentClass: 'bg-[#4050b5] text-white',
    icon: <SlidersHorizontal size={22} />,
    setupTitle: 'Connect Linear',
    setupDescription: 'Enter your Linear API key. We verify it against the Linear GraphQL API.',
    requirements: ['API key', 'Team key', 'Project ID or issue label'],
    hasValidation: true,
    fields: [
      { id: 'apiKey', label: 'API key', placeholder: 'lin_api_...', type: 'password', helpText: 'Generate a personal API key in Linear Settings → API.' },
      { id: 'teamKey', label: 'Team key', placeholder: 'ENG', type: 'text', helpText: 'Linear team key where issues should be created.' },
      { id: 'projectId', label: 'Project or label', placeholder: 'Launch operations', type: 'text', helpText: 'Optional default project or label for new tickets.' },
    ],
  },
  {
    id: 'framer',
    name: 'Framer',
    description: 'Design websites on a visual canvas and publish polished marketing pages fast.',
    category: 'Developer tools',
    accentClass: 'bg-black text-white',
    icon: <LayoutTemplate size={22} />,
    setupTitle: 'Connect Framer',
    setupDescription: 'Provide the site endpoint and publishing token for synced content updates.',
    requirements: ['Site ID', 'Publishing token', 'Target collection'],
    fields: [
      { id: 'siteId', label: 'Site ID', placeholder: 'Framer site ID', type: 'text', helpText: 'Site or workspace identifier from Framer.' },
      { id: 'publishToken', label: 'Publishing token', placeholder: 'Framer API token', type: 'password', helpText: 'This token allows content pushes into Framer.' },
      { id: 'collection', label: 'Target collection', placeholder: 'Blog posts', type: 'text', helpText: 'CMS collection that should receive updates.' },
    ],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    description: 'A natural language tool for drafting, editing, summarizing, and automation support.',
    category: 'Productivity',
    accentClass: 'bg-black text-white',
    icon: <Bot size={22} />,
    setupTitle: 'Connect ChatGPT',
    setupDescription: 'Enter your OpenAI API key. We verify it in real time against the OpenAI API.',
    requirements: ['API key', 'Model name', 'System prompt'],
    hasValidation: true,
    fields: [
      { id: 'apiKey', label: 'API key', placeholder: 'sk-...', type: 'password', helpText: 'API key from platform.openai.com with access to your chosen model.' },
      { id: 'model', label: 'Model', placeholder: 'gpt-4o-mini', type: 'text', helpText: 'Model used for your workflow (e.g. gpt-4o, gpt-4o-mini).' },
      { id: 'systemPrompt', label: 'System prompt', placeholder: 'You are a brand voice assistant...', type: 'textarea', helpText: 'Optional base prompt used for every generated request.' },
    ],
  },
  {
    id: 'webflow',
    name: 'Webflow',
    description: 'Create professional, custom websites in a complete visual canvas with CMS support.',
    category: 'Developer tools',
    accentClass: 'bg-[#4f67ff] text-white',
    icon: <LayoutTemplate size={22} />,
    setupTitle: 'Connect Webflow',
    setupDescription: 'Enter your Webflow API token. We verify it against the Webflow API.',
    requirements: ['API token', 'Site ID', 'Collection ID'],
    hasValidation: true,
    fields: [
      { id: 'apiToken', label: 'API token', placeholder: 'Webflow API token', type: 'password', helpText: 'Generate in Webflow Workspace Settings → Integrations → API.' },
      { id: 'siteId', label: 'Site ID', placeholder: 'Primary Webflow site ID', type: 'text', helpText: 'Site where content should be published.' },
      { id: 'collectionId', label: 'Collection ID', placeholder: 'Blog collection ID', type: 'text', helpText: 'CMS collection used for new content.' },
    ],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'A payments API for subscriptions, checkout, invoicing, and customer billing.',
    category: 'Productivity',
    accentClass: 'bg-[#6658ff] text-white',
    icon: <CreditCard size={22} />,
    setupTitle: 'Connect Stripe',
    setupDescription: 'Enter your Stripe secret key. We verify it against the Stripe API.',
    requirements: ['Publishable key', 'Secret key', 'Webhook signing secret'],
    hasValidation: true,
    fields: [
      { id: 'publishableKey', label: 'Publishable key', placeholder: 'pk_live_...', type: 'text', helpText: 'Use your live key for production payments.' },
      { id: 'secretKey', label: 'Secret key', placeholder: 'sk_live_...', type: 'password', helpText: 'Used server-side. Never expose this key to the browser.' },
      { id: 'signingSecret', label: 'Webhook secret', placeholder: 'whsec_...', type: 'password', helpText: 'Needed if Stripe events post back into your backend.' },
    ],
  },
];

// ── Config ─────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'integration-configs';

interface SavedIntegrationConfig {
  enabled: boolean;
  values: Record<string, string>;
}

type SavedConfigMap = Record<string, SavedIntegrationConfig>;

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com') ? '' : rawApiBaseUrl.replace(/\/$/, '');

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
};

const isAdminUser = (): boolean => {
  try {
    const raw = localStorage.getItem('auth_user');
    if (!raw) return false;
    return (JSON.parse(raw) as { role?: string })?.role === 'admin';
  } catch { return false; }
};

const PRODUCTION_REDIRECT_URIS: Record<string, string> = {
  instagram: 'https://marketing.dakyworld.com/auth/instagram/callback',
  facebook: 'https://marketing.dakyworld.com/auth/facebook/callback',
  linkedin: 'https://marketing.dakyworld.com/auth/linkedin/callback',
  twitter: 'https://marketing.dakyworld.com/auth/twitter/callback',
  tiktok: 'https://marketing.dakyworld.com/auth/tiktok/callback',
};

const loadSavedConfigs = (): SavedConfigMap => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedConfigMap) : {};
  } catch { return {}; }
};

const saveLocalConfigs = (configs: SavedConfigMap) => {
  if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
};

// ── Component ─────────────────────────────────────────────────────────────────

const Integrations = () => {
  const [activeCategory, setActiveCategory] = useState<IntegrationCategory>('All integrations');
  const [query, setQuery] = useState('');
  const [savedConfigs, setSavedConfigs] = useState<SavedConfigMap>(() => loadSavedConfigs());
  const [activeIntegrationId, setActiveIntegrationId] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  // OAuth state: map of platformId → { configured: bool, connected: bool, handle: string, loading: bool }
  const [oauthStatus, setOauthStatus] = useState<Record<string, { configured: boolean; connected: boolean; handle?: string; loading: boolean }>>({});
  const [oauthConnecting, setOauthConnecting] = useState<string | null>(null);
  // Admin-enabled integration IDs — null means not yet loaded, undefined means loading failed (show all)
  const [enabledIds, setEnabledIds] = useState<Set<string> | null>(null);
  const isAdmin = isAdminUser();

  // ── Load backend admin configs ─────────────────────────────────────────────
  const loadBackendConfigs = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json() as { success: boolean; configs: Array<{ platform: string; config: Record<string, string>; enabled: boolean }> };
      if (!data.success) return;
      setSavedConfigs((prev) => {
        const next = { ...prev };
        for (const row of data.configs) {
          next[row.platform] = { enabled: row.enabled, values: row.config };
        }
        saveLocalConfigs(next);
        return next;
      });
    } catch { /* ignore */ }
  }, [isAdmin]);

  // ── Load OAuth platform status (configured + connected) ────────────────────
  const loadOAuthStatus = useCallback(async () => {
    const platforms = ['instagram', 'facebook', 'linkedin', 'twitter', 'tiktok'];

    // Mark all as loading
    setOauthStatus((prev) => {
      const next = { ...prev };
      for (const p of platforms) next[p] = { ...next[p], loading: true, configured: next[p]?.configured ?? false, connected: next[p]?.connected ?? false };
      return next;
    });

    // Fetch connected accounts
    let connectedPlatforms: Record<string, string> = {};
    try {
      const res = await fetch(`${API_BASE_URL}/api/accounts`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json() as { success: boolean; data: Array<{ platform: string; handle?: string; connected: boolean }> };
        if (data.success) {
          for (const acc of data.data) {
            if (acc.connected) connectedPlatforms[acc.platform.toLowerCase()] = acc.handle || '';
          }
        }
      }
    } catch { /* ignore */ }

    // Fetch configured status for each platform
    const results: Record<string, { configured: boolean; connected: boolean; handle?: string; loading: boolean }> = {};
    await Promise.all(platforms.map(async (p) => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/oauth/${p}/configured`, { headers: authHeaders() });
        const data = res.ok ? await res.json() as { configured: boolean } : { configured: false };
        results[p] = {
          configured: data.configured,
          connected: Boolean(connectedPlatforms[p] !== undefined),
          handle: connectedPlatforms[p] || undefined,
          loading: false,
        };
      } catch {
        results[p] = { configured: false, connected: false, loading: false };
      }
    }));
    setOauthStatus(results);
  }, []);

  // ── Load admin-enabled integration list ────────────────────────────────────
  const loadEnabledIds = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/integrations/enabled`, { headers: authHeaders() });
      if (!res.ok) { setEnabledIds(null); return; }
      const data = await res.json() as { success: boolean; enabled: string[] };
      if (data.success) {
        setEnabledIds(new Set(data.enabled));
      } else {
        setEnabledIds(null);
      }
    } catch {
      // If endpoint unreachable, show all integrations (graceful degradation)
      setEnabledIds(null);
    }
  }, []);

  useEffect(() => {
    void loadBackendConfigs();
    void loadOAuthStatus();
    void loadEnabledIds();
  }, [loadBackendConfigs, loadOAuthStatus, loadEnabledIds]);

  // ── Handle OAuth callback result ───────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === 'true') {
      setSaveSuccess('Account connected successfully!');
      window.history.replaceState({}, '', window.location.pathname);
      void loadOAuthStatus();
    } else if (params.get('error')) {
      setSaveError(decodeURIComponent(params.get('error') || 'Connection failed'));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [loadOAuthStatus]);

  const activeIntegration = useMemo(
    () => INTEGRATIONS.find((i) => i.id === activeIntegrationId) ?? null,
    [activeIntegrationId],
  );

  useEffect(() => {
    if (!activeIntegration) setDraftValues({});
  }, [activeIntegration]);

  const filteredIntegrations = useMemo(() => {
    const q = query.trim().toLowerCase();
    return INTEGRATIONS.filter((i) => {
      // Non-admin users only see integrations admin has enabled.
      // If enabledIds is null (still loading or endpoint failed), admins see all; users see all as fallback.
      if (!isAdmin && enabledIds !== null && !enabledIds.has(i.id)) return false;
      const matchesCategory = activeCategory === 'All integrations' || i.category === activeCategory;
      const matchesQuery = !q || `${i.name} ${i.description} ${i.category}`.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [activeCategory, query, isAdmin, enabledIds]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const getConnectionStatus = (integration: IntegrationDefinition): boolean => {
    if (integration.isOAuth) return oauthStatus[integration.id]?.connected ?? false;
    return savedConfigs[integration.id]?.enabled ?? false;
  };

  const openConfigure = (id: string) => {
    setActiveIntegrationId(id);
    setSaveError(null);
    setSaveSuccess(null);
    const saved = savedConfigs[id]?.values ?? {};
    const prefilled = { ...saved };
    const prodUri = PRODUCTION_REDIRECT_URIS[id];
    if (prodUri && !prefilled.redirectUri) prefilled.redirectUri = prodUri;
    setDraftValues(prefilled);
  };

  const closeConfigure = () => {
    setActiveIntegrationId(null);
    setSaveError(null);
    setSaveSuccess(null);
  };

  // ── OAuth connect via backend-configured credentials ───────────────────────
  const handleOAuthConnect = async (platformId: string) => {
    setOauthConnecting(platformId);
    setSaveError(null);
    try {
      const state = crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
      // Register state on backend
      await fetch(`${API_BASE_URL}/api/oauth/state`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ state, platform: platformId }),
      });
      sessionStorage.setItem('oauth_state', state);
      sessionStorage.setItem('oauth_platform', platformId);

      // Get auth URL from backend (uses DB credentials)
      const res = await fetch(`${API_BASE_URL}/api/oauth/${platformId}/authorize-url?state=${state}`, { headers: authHeaders() });
      const data = await res.json() as { success: boolean; url?: string; error?: string };
      if (!data.success || !data.url) throw new Error(data.error || 'Failed to get authorization URL');
      window.location.href = data.url;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to initiate OAuth');
      setOauthConnecting(null);
    }
  };

  // ── Disconnect OAuth account ───────────────────────────────────────────────
  const handleOAuthDisconnect = async (platformId: string) => {
    try {
      // Capitalize to match platform name stored in DB
      const platformName = platformId.charAt(0).toUpperCase() + platformId.slice(1);
      await fetch(`${API_BASE_URL}/api/accounts/${platformName}`, { method: 'DELETE', headers: authHeaders() });
      setOauthStatus((prev) => ({ ...prev, [platformId]: { ...prev[platformId], connected: false, handle: undefined } }));
    } catch { /* ignore */ }
  };

  // ── Save integration (admin OAuth config or API key integrations) ──────────
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeIntegration) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      // Admin configuring OAuth platform app credentials → save to backend
      if (isAdmin && activeIntegration.isOAuth) {
        const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/${activeIntegration.id}`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({ config: draftValues, enabled: true }),
        });
        const data = await res.json() as { success: boolean; error?: string };
        if (!data.success) throw new Error(data.error || 'Failed to save');
        // Reload OAuth status since credentials changed
        void loadOAuthStatus();
      }
      // Non-OAuth integrations: validate credentials server-side (if supported)
      else if (VALIDATED_PLATFORM_IDS.has(activeIntegration.id)) {
        const res = await fetch(`${API_BASE_URL}/api/integrations/validate`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ platform: activeIntegration.id, credentials: draftValues }),
        });
        const data = await res.json() as { success: boolean; error?: string };
        if (!data.success) throw new Error(data.error || 'Credential validation failed');
      }

      // Save to local state
      setSavedConfigs((current) => {
        const next = { ...current, [activeIntegration.id]: { enabled: true, values: draftValues } };
        saveLocalConfigs(next);
        return next;
      });
      setSaveSuccess(activeIntegration.hasValidation ? 'Connected and verified successfully!' : 'Configuration saved.');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Global success/error banner */}
      {(saveSuccess || saveError) && !activeIntegrationId && (
        <div className={`flex items-center gap-3 rounded-2xl px-5 py-3 text-sm font-medium ${saveSuccess ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {saveSuccess ? <CheckCircle size={16} /> : <X size={16} />}
          <span>{saveSuccess || saveError}</span>
          <button type="button" onClick={() => { setSaveSuccess(null); setSaveError(null); }} className="ml-auto text-current opacity-60 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      <section className="rounded-[32px] border border-slate-200 bg-white px-6 py-6 md:px-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-[2.2rem] font-black tracking-[-0.03em] text-slate-950">Integrations</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500 md:text-base">
              Connect your tools. Social platforms use real OAuth logins. API integrations verify credentials in real time.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void loadOAuthStatus()} title="Refresh status" className="rounded-xl border border-slate-200 p-2.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors">
              <RefreshCw size={16} />
            </button>
            <div className="w-full max-w-sm">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm text-slate-800 outline-none transition-colors focus:border-slate-400" />
              </label>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2 border-b border-slate-200 pb-1">
          {CATEGORIES.map((cat) => (
            <button key={cat} type="button" onClick={() => setActiveCategory(cat)}
              className={`rounded-t-xl px-1 pb-3 pt-2 text-sm font-semibold transition-colors ${cat === activeCategory ? 'border-b-2 border-violet-600 text-violet-700' : 'text-slate-500 hover:text-slate-900'}`}>
              {cat}
            </button>
          ))}
        </div>

        {/* Empty state for non-admin when no integrations enabled */}
        {!isAdmin && enabledIds !== null && filteredIntegrations.length === 0 && (
          <div className="mt-6 flex flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 py-16 text-center">
            <SlidersHorizontal size={32} className="text-slate-300" />
            <p className="mt-4 font-semibold text-slate-500">No integrations available</p>
            <p className="mt-1 text-sm text-slate-400">Your admin hasn't enabled any integrations yet.</p>
          </div>
        )}

        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredIntegrations.map((integration) => {
            const isConnected = getConnectionStatus(integration);
            const oAuth = oauthStatus[integration.id];
            const isOAuthConfigured = oAuth?.configured ?? false;
            const isConnecting = oauthConnecting === integration.id;

            return (
              <article key={integration.id} className="rounded-[24px] border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300">
                <div className="flex items-start justify-between gap-4">
                  <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${integration.accentClass}`}>
                    {integration.icon}
                  </div>
                  <button type="button" className="rounded-xl p-2 text-slate-300 transition-colors hover:bg-slate-50 hover:text-slate-500" aria-label={`Open ${integration.name} docs`}>
                    <ExternalLink size={16} />
                  </button>
                </div>

                <div className="mt-4">
                  <h2 className="text-lg font-black text-slate-900">{integration.name}</h2>
                  <p className="mt-2 min-h-[72px] text-sm leading-6 text-slate-500">{integration.description}</p>
                </div>

                <div className="mt-5 border-t border-slate-200 pt-4 space-y-3">
                  {/* Status row */}
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-semibold ${isConnected ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {isConnected
                        ? `Connected${oAuth?.handle ? ` · ${oAuth.handle}` : ''}`
                        : integration.isOAuth
                          ? (oAuth?.loading ? 'Checking…' : isOAuthConfigured ? 'Not connected' : 'Setup required')
                          : 'Not connected'}
                    </span>
                    <div aria-hidden="true" className={`relative h-7 w-12 flex-shrink-0 rounded-full transition-colors ${isConnected ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${isConnected ? 'translate-x-6' : 'translate-x-1'}`} />
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-2">
                    {/* OAuth platforms */}
                    {integration.isOAuth && !isAdmin ? (
                      <>
                        {/* While status is loading (oAuth is undefined = not fetched yet, or loading=true), show spinner */}
                        {(!oAuth || oAuth.loading) ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                            <Loader2 size={13} className="animate-spin" /> Checking…
                          </span>
                        ) : isConnected ? (
                          <button type="button" onClick={() => void handleOAuthDisconnect(integration.id)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                            <Link2Off size={13} /> Disconnect
                          </button>
                        ) : isOAuthConfigured ? (
                          <button type="button" onClick={() => void handleOAuthConnect(integration.id)} disabled={isConnecting}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-60 transition-colors">
                            {isConnecting ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                            {isConnecting ? 'Connecting…' : `Connect with ${integration.name}`}
                          </button>
                        ) : (
                          <span className="text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-2 font-medium">
                            Admin needs to configure this platform first
                          </span>
                        )}
                      </>
                    ) : (
                      // Admin on OAuth platform, or any user on API integrations
                      <>
                        {integration.isOAuth && isAdmin && isOAuthConfigured && !isConnected && (
                          <button type="button" onClick={() => void handleOAuthConnect(integration.id)} disabled={isConnecting}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-60 transition-colors">
                            {isConnecting ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                            {isConnecting ? 'Connecting…' : 'Test OAuth'}
                          </button>
                        )}
                        {integration.isOAuth && isAdmin && isConnected && (
                          <button type="button" onClick={() => void handleOAuthDisconnect(integration.id)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                            <Link2Off size={13} /> Disconnect
                          </button>
                        )}
                        <button type="button" onClick={() => openConfigure(integration.id)}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50">
                          <SlidersHorizontal size={16} />
                          {integration.isOAuth ? 'Configure App' : isConnected ? 'Reconfigure' : 'Configure'}
                        </button>
                        {!integration.isOAuth && isConnected && (
                          <button type="button" onClick={() => {
                            setSavedConfigs((prev) => {
                              const next = { ...prev, [integration.id]: { ...prev[integration.id], enabled: false } };
                              saveLocalConfigs(next);
                              return next;
                            });
                          }} className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors">
                            <Link2Off size={13} /> Disconnect
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Configure modal */}
      {activeIntegration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-8">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-[30px] border border-slate-200 bg-white">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                  {activeIntegration.isOAuth && isAdmin ? 'Admin — App Credentials' : 'Configure integration'}
                </div>
                <h2 className="mt-2 text-[1.8rem] font-black tracking-[-0.03em] text-slate-950">
                  {activeIntegration.setupTitle}
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                  {activeIntegration.setupDescription}
                </p>
              </div>
              <button type="button" onClick={closeConfigure} className="rounded-2xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <div className="grid gap-0 lg:grid-cols-[220px_minmax(0,1fr)]">
              <aside className="border-b border-slate-200 bg-slate-50 px-6 py-6 lg:border-b-0 lg:border-r">
                <div className="text-sm font-bold text-slate-900">What you need</div>
                <ul className="mt-4 space-y-3">
                  {activeIntegration.requirements.map((req) => (
                    <li key={req} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">{req}</li>
                  ))}
                </ul>
                {activeIntegration.hasValidation && (
                  <p className="mt-4 text-xs text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2">
                    Credentials are verified in real time before saving.
                  </p>
                )}
              </aside>

              <form onSubmit={handleSubmit} className="max-h-[70vh] overflow-y-auto px-6 py-6">
                <div className="space-y-5">
                  {activeIntegration.fields.map((field) => (
                    <label key={field.id} className="block space-y-2">
                      <span className="text-sm font-semibold text-slate-800">{field.label}</span>
                      {field.type === 'textarea' ? (
                        <textarea value={draftValues[field.id] ?? ''} onChange={(e) => setDraftValues((c) => ({ ...c, [field.id]: e.target.value }))}
                          placeholder={field.placeholder} rows={4}
                          className="min-h-[120px] w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition-colors focus:border-slate-400" />
                      ) : (
                        <input type={field.type} value={draftValues[field.id] ?? ''} onChange={(e) => setDraftValues((c) => ({ ...c, [field.id]: e.target.value }))}
                          placeholder={field.placeholder}
                          className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none transition-colors focus:border-slate-400" />
                      )}
                      <p className="text-sm leading-6 text-slate-500">{field.helpText}</p>
                    </label>
                  ))}
                </div>

                <div className="mt-8 space-y-4 border-t border-slate-200 pt-5">
                  {isAdmin && activeIntegration.isOAuth && (
                    <p className="rounded-xl bg-violet-50 px-4 py-2.5 text-xs text-violet-700">
                      <strong>Admin:</strong> These app credentials are saved to the backend and used when users click "Connect".
                    </p>
                  )}
                  {saveError && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-xs text-red-600">{saveError}</p>}
                  {saveSuccess && (
                    <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-xs text-emerald-700">
                      <CheckCircle size={14} /> {saveSuccess}
                    </p>
                  )}
                  <div className="flex items-center justify-end gap-3">
                    <button type="button" onClick={closeConfigure} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">
                      Cancel
                    </button>
                    <button type="submit" disabled={isSaving}
                      className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60">
                      {isSaving && <Loader2 size={14} className="animate-spin" />}
                      {isSaving ? (activeIntegration.hasValidation ? 'Verifying…' : 'Saving…') : 'Save integration'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Integrations;
