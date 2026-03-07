import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Box,
  CreditCard,
  ExternalLink,
  Globe,
  LayoutTemplate,
  Mail,
  Search,
  SlidersHorizontal,
  Webhook,
  X,
} from 'lucide-react';

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
}

const CATEGORIES: IntegrationCategory[] = [
  'All integrations',
  'Developer tools',
  'Communication',
  'Productivity',
  'Browser tools',
];

const INTEGRATIONS: IntegrationDefinition[] = [
  {
    id: 'wordpress',
    name: 'WordPress',
    description: 'Publish posts, pages, and media into your WordPress site from one workflow.',
    category: 'Developer tools',
    accentClass: 'bg-[#1d2327] text-white',
    icon: <Globe size={22} />,
    setupTitle: 'Connect WordPress',
    setupDescription: 'Provide the credentials or app password needed to publish to your WordPress site.',
    requirements: ['Site URL', 'Username', 'Password or application password'],
    fields: [
      { id: 'siteUrl', label: 'Site URL', placeholder: 'https://your-site.com', type: 'url', helpText: 'Use the full site URL for the WordPress installation.' },
      { id: 'username', label: 'Username', placeholder: 'Admin username', type: 'text', helpText: 'Use a WordPress username with permission to publish content.' },
      { id: 'applicationPassword', label: 'Application password', placeholder: 'WordPress application password', type: 'password', helpText: 'Preferred over your main login password when available.' },
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'Connect Instagram to publish posts, sync profile data, and manage social workflows.',
    category: 'Communication',
    accentClass: 'bg-gradient-to-br from-pink-500 via-fuchsia-500 to-orange-400 text-white',
    icon: <Globe size={22} />,
    setupTitle: 'Connect Instagram',
    setupDescription: 'Add the Instagram app details required for posting and profile access.',
    requirements: ['App ID', 'App secret', 'Redirect URI'],
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Instagram app ID', type: 'text', helpText: 'Use the Instagram or Meta app identifier for your project.' },
      { id: 'appSecret', label: 'App secret', placeholder: 'Instagram app secret', type: 'password', helpText: 'Keep this value secure and use the production secret when going live.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://your-app.com/auth/instagram/callback', type: 'url', helpText: 'This should match the callback URL configured in your app settings.' },
    ],
  },
  {
    id: 'facebook',
    name: 'Facebook',
    description: 'Connect Facebook pages and posting permissions to your content pipeline.',
    category: 'Communication',
    accentClass: 'bg-[#1877f2] text-white',
    icon: <Globe size={22} />,
    setupTitle: 'Connect Facebook',
    setupDescription: 'Provide the Facebook app details used to authorize page publishing access.',
    requirements: ['App ID', 'App secret', 'Redirect URI'],
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Facebook app ID', type: 'text', helpText: 'Use the Meta app ID tied to your Facebook page workflow.' },
      { id: 'appSecret', label: 'App secret', placeholder: 'Facebook app secret', type: 'password', helpText: 'Required to exchange authorization codes securely.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://your-app.com/auth/facebook/callback', type: 'url', helpText: 'Must match the redirect URI registered in your Facebook app.' },
    ],
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'Connect LinkedIn for company updates, personal posts, and distribution workflows.',
    category: 'Communication',
    accentClass: 'bg-[#0a66c2] text-white',
    icon: <Globe size={22} />,
    setupTitle: 'Connect LinkedIn',
    setupDescription: 'Add the LinkedIn app details required for post publishing and profile access.',
    requirements: ['Client ID', 'Client secret', 'Redirect URI'],
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'LinkedIn client ID', type: 'text', helpText: 'Use the client ID from your LinkedIn developer app.' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'LinkedIn client secret', type: 'password', helpText: 'Used to exchange the OAuth authorization code.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://your-app.com/auth/linkedin/callback', type: 'url', helpText: 'Use the same callback URI configured inside LinkedIn.' },
    ],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    description: 'Connect TikTok to support video publishing flows and creator account access.',
    category: 'Communication',
    accentClass: 'bg-[#111111] text-white',
    icon: <Globe size={22} />,
    setupTitle: 'Connect TikTok',
    setupDescription: 'Provide the TikTok app configuration needed for OAuth and content publishing.',
    requirements: ['Client key', 'Client secret', 'Redirect URI'],
    fields: [
      { id: 'clientKey', label: 'Client key', placeholder: 'TikTok client key', type: 'text', helpText: 'Use the client key issued by TikTok developers.' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'TikTok client secret', type: 'password', helpText: 'Required for exchanging codes and refreshing tokens.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://your-app.com/auth/tiktok/callback', type: 'url', helpText: 'Must match the URI registered in TikTok developer settings.' },
    ],
  },
  {
    id: 'twitter',
    name: 'Twitter / X',
    description: 'Connect Twitter or X for fast distribution, threads, and community engagement flows.',
    category: 'Communication',
    accentClass: 'bg-black text-white',
    icon: <Globe size={22} />,
    setupTitle: 'Connect Twitter / X',
    setupDescription: 'Provide the X app details needed for OAuth, posting, and profile access.',
    requirements: ['Client ID', 'Client secret', 'Redirect URI'],
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'Twitter or X client ID', type: 'text', helpText: 'Use the OAuth 2 client ID from your X developer app.' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'Twitter or X client secret', type: 'password', helpText: 'Required for secure authorization code exchange.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://your-app.com/auth/twitter/callback', type: 'url', helpText: 'This redirect URI must match your X developer setup.' },
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
    setupDescription: 'Provide the Mailchimp credentials used to send campaigns and sync audiences.',
    requirements: ['API key', 'Server prefix', 'Audience ID'],
    fields: [
      { id: 'apiKey', label: 'API key', placeholder: 'Enter your Mailchimp API key', type: 'password', helpText: 'Found under Account > Extras > API keys.' },
      { id: 'serverPrefix', label: 'Server prefix', placeholder: 'us21', type: 'text', helpText: 'Use the data center prefix from your Mailchimp account.' },
      { id: 'audienceId', label: 'Audience ID', placeholder: 'Primary audience ID', type: 'text', helpText: 'Select the audience you want new leads synced into.' },
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
    setupDescription: 'Add the Square credentials needed to handle checkout events and order data.',
    requirements: ['Application ID', 'Access token', 'Location ID'],
    fields: [
      { id: 'applicationId', label: 'Application ID', placeholder: 'Square application ID', type: 'text', helpText: 'Use the application identifier from your Square developer dashboard.' },
      { id: 'accessToken', label: 'Access token', placeholder: 'Production access token', type: 'password', helpText: 'Use a production token if you want live charges and orders.' },
      { id: 'locationId', label: 'Location ID', placeholder: 'Main Square location ID', type: 'text', helpText: 'This tells the system which Square business location to use.' },
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
    setupDescription: 'Set the browser workspace details used for previews and QA automation.',
    requirements: ['Profile name', 'Launch URL', 'Optional extension ID'],
    fields: [
      { id: 'profileName', label: 'Profile name', placeholder: 'Marketing QA', type: 'text', helpText: 'Name the Brave profile your team should open for review.' },
      { id: 'launchUrl', label: 'Launch URL', placeholder: 'https://your-site.com', type: 'url', helpText: 'Open this URL by default when launching the integration.' },
      { id: 'extensionId', label: 'Extension ID', placeholder: 'Optional extension or wallet ID', type: 'text', helpText: 'Only needed if your flow depends on a specific Brave extension or wallet.' },
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
    setupDescription: 'Provide the webhook destination and authentication used by your Zap.',
    requirements: ['Webhook URL', 'Zap name', 'Secret key'],
    fields: [
      { id: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://hooks.zapier.com/...', type: 'url', helpText: 'Paste the Zapier webhook that should receive new events.' },
      { id: 'zapName', label: 'Zap name', placeholder: 'New lead sync', type: 'text', helpText: 'Use a descriptive name so teammates know which automation is connected.' },
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
    setupDescription: 'Map your workspace and personal token so cards or posts can be sent into Linear.',
    requirements: ['API key', 'Team key', 'Project ID or issue label'],
    fields: [
      { id: 'apiKey', label: 'API key', placeholder: 'Linear personal API key', type: 'password', helpText: 'Generate a personal API key in Linear settings.' },
      { id: 'teamKey', label: 'Team key', placeholder: 'ENG', type: 'text', helpText: 'Use the Linear team key where issues should be created.' },
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
    setupDescription: 'Provide the site endpoint and publishing token used for synced content updates.',
    requirements: ['Site ID', 'Publishing token', 'Target collection'],
    fields: [
      { id: 'siteId', label: 'Site ID', placeholder: 'Framer site ID', type: 'text', helpText: 'Use the site or workspace identifier from Framer.' },
      { id: 'publishToken', label: 'Publishing token', placeholder: 'Framer API token', type: 'password', helpText: 'This token allows content pushes into Framer.' },
      { id: 'collection', label: 'Target collection', placeholder: 'Blog posts', type: 'text', helpText: 'Choose the CMS collection or section that should receive updates.' },
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
    setupDescription: 'Configure the model and API credentials used when generating or refining content.',
    requirements: ['API key', 'Model name', 'System prompt'],
    fields: [
      { id: 'apiKey', label: 'API key', placeholder: 'sk-...', type: 'password', helpText: 'Use an API key with access to the model you plan to call.' },
      { id: 'model', label: 'Model', placeholder: 'gpt-5-mini', type: 'text', helpText: 'Choose the model used for your workflow.' },
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
    setupDescription: 'Add the site token and collection details needed for CMS publishing.',
    requirements: ['API token', 'Site ID', 'Collection ID'],
    fields: [
      { id: 'apiToken', label: 'API token', placeholder: 'Webflow API token', type: 'password', helpText: 'Generate a token in Webflow Workspace settings.' },
      { id: 'siteId', label: 'Site ID', placeholder: 'Primary Webflow site ID', type: 'text', helpText: 'Use the site where content should be published.' },
      { id: 'collectionId', label: 'Collection ID', placeholder: 'Blog collection ID', type: 'text', helpText: 'Choose the CMS collection used for new content.' },
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
    setupDescription: 'Add the account keys needed to send payment events into your workflow.',
    requirements: ['Publishable key', 'Secret key', 'Webhook signing secret'],
    fields: [
      { id: 'publishableKey', label: 'Publishable key', placeholder: 'pk_live_...', type: 'text', helpText: 'Use your live key if this should reflect production payments.' },
      { id: 'secretKey', label: 'Secret key', placeholder: 'sk_live_...', type: 'password', helpText: 'This key is used server-side to create and inspect resources.' },
      { id: 'signingSecret', label: 'Webhook secret', placeholder: 'whsec_...', type: 'password', helpText: 'Needed if Stripe events will post back into your backend.' },
    ],
  },
];

const STORAGE_KEY = 'integration-configs';

interface SavedIntegrationConfig {
  enabled: boolean;
  values: Record<string, string>;
}

type SavedConfigMap = Record<string, SavedIntegrationConfig>;

const loadSavedConfigs = (): SavedConfigMap => {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedConfigMap) : {};
  } catch {
    return {};
  }
};

const saveConfigs = (configs: SavedConfigMap) => {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
};

const Integrations = () => {
  const [activeCategory, setActiveCategory] = useState<IntegrationCategory>('All integrations');
  const [query, setQuery] = useState('');
  const [savedConfigs, setSavedConfigs] = useState<SavedConfigMap>(() => loadSavedConfigs());
  const [activeIntegrationId, setActiveIntegrationId] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});

  useEffect(() => {
    saveConfigs(savedConfigs);
  }, [savedConfigs]);

  const activeIntegration = useMemo(
    () => INTEGRATIONS.find((integration) => integration.id === activeIntegrationId) ?? null,
    [activeIntegrationId],
  );

  useEffect(() => {
    if (!activeIntegration) {
      setDraftValues({});
      return;
    }

    setDraftValues(savedConfigs[activeIntegration.id]?.values ?? {});
  }, [activeIntegration, savedConfigs]);

  const filteredIntegrations = useMemo(() => {
    const loweredQuery = query.trim().toLowerCase();

    return INTEGRATIONS.filter((integration) => {
      const matchesCategory =
        activeCategory === 'All integrations' || integration.category === activeCategory;
      const matchesQuery =
        !loweredQuery ||
        `${integration.name} ${integration.description} ${integration.category}`
          .toLowerCase()
          .includes(loweredQuery);

      return matchesCategory && matchesQuery;
    });
  }, [activeCategory, query]);

  const openConfigure = (integrationId: string) => {
    setActiveIntegrationId(integrationId);
  };

  const closeConfigure = () => {
    setActiveIntegrationId(null);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeIntegration) {
      return;
    }

    setSavedConfigs((current) => ({
      ...current,
      [activeIntegration.id]: {
        enabled: true,
        values: draftValues,
      },
    }));
    closeConfigure();
  };

  return (
    <div className="space-y-8">
      <section className="rounded-[32px] border border-slate-200 bg-white px-6 py-6 md:px-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-[2.2rem] font-black tracking-[-0.03em] text-slate-950">Integrations</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500 md:text-base">
              Supercharge your workflow. Connect tools you use and configure the exact credentials or IDs each one needs.
            </p>
          </div>

          <div className="w-full max-w-sm">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm text-slate-800 outline-none transition-colors focus:border-slate-400"
              />
            </label>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2 border-b border-slate-200 pb-1">
          {CATEGORIES.map((category) => {
            const isActive = category === activeCategory;
            return (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                className={`rounded-t-xl px-1 pb-3 pt-2 text-sm font-semibold transition-colors ${
                  isActive ? 'border-b-2 border-violet-600 text-violet-700' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {category}
              </button>
            );
          })}
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredIntegrations.map((integration) => {
            const saved = savedConfigs[integration.id];
            const isEnabled = saved?.enabled ?? false;

            return (
              <article
                key={integration.id}
                className="rounded-[24px] border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${integration.accentClass}`}>
                    {integration.icon}
                  </div>
                  <button
                    type="button"
                    className="rounded-xl p-2 text-slate-300 transition-colors hover:bg-slate-50 hover:text-slate-500"
                    aria-label={`Open ${integration.name} documentation`}
                  >
                    <ExternalLink size={16} />
                  </button>
                </div>

                <div className="mt-4">
                  <h2 className="text-lg font-black text-slate-900">{integration.name}</h2>
                  <p className="mt-2 min-h-[72px] text-sm leading-6 text-slate-500">{integration.description}</p>
                </div>

                <div className="mt-5 flex items-center justify-between gap-4 border-t border-slate-200 pt-4">
                  <button
                    type="button"
                    onClick={() => openConfigure(integration.id)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50"
                  >
                    <SlidersHorizontal size={16} />
                    Configure
                  </button>

                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-semibold ${isEnabled ? 'text-violet-600' : 'text-slate-400'}`}>
                      {isEnabled ? 'Connected' : 'Not connected'}
                    </span>
                    <div
                    aria-hidden="true"
                    className={`relative h-7 w-12 rounded-full transition-colors ${
                      isEnabled ? 'bg-violet-500' : 'bg-slate-200'
                    }`}
                  >
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
                        isEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {activeIntegration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-8">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-[30px] border border-slate-200 bg-white">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Configure integration
                </div>
                <h2 className="mt-2 text-[1.8rem] font-black tracking-[-0.03em] text-slate-950">
                  {activeIntegration.setupTitle}
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                  {activeIntegration.setupDescription}
                </p>
              </div>

              <button
                type="button"
                onClick={closeConfigure}
                className="rounded-2xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close configuration dialog"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid gap-0 lg:grid-cols-[220px_minmax(0,1fr)]">
              <aside className="border-b border-slate-200 bg-slate-50 px-6 py-6 lg:border-b-0 lg:border-r">
                <div className="text-sm font-bold text-slate-900">What you need</div>
                <ul className="mt-4 space-y-3">
                  {activeIntegration.requirements.map((requirement) => (
                    <li key={requirement} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                      {requirement}
                    </li>
                  ))}
                </ul>
              </aside>

              <form onSubmit={handleSubmit} className="max-h-[70vh] overflow-y-auto px-6 py-6">
                <div className="space-y-5">
                  {activeIntegration.fields.map((field) => (
                    <label key={field.id} className="block space-y-2">
                      <span className="text-sm font-semibold text-slate-800">{field.label}</span>
                      {field.type === 'textarea' ? (
                        <textarea
                          value={draftValues[field.id] ?? ''}
                          onChange={(event) =>
                            setDraftValues((current) => ({ ...current, [field.id]: event.target.value }))
                          }
                          placeholder={field.placeholder}
                          rows={4}
                          className="min-h-[120px] w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition-colors focus:border-slate-400"
                        />
                      ) : (
                        <input
                          type={field.type}
                          value={draftValues[field.id] ?? ''}
                          onChange={(event) =>
                            setDraftValues((current) => ({ ...current, [field.id]: event.target.value }))
                          }
                          placeholder={field.placeholder}
                          className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none transition-colors focus:border-slate-400"
                        />
                      )}
                      <p className="text-sm leading-6 text-slate-500">{field.helpText}</p>
                    </label>
                  ))}
                </div>

                <div className="mt-8 flex items-center justify-end gap-3 border-t border-slate-200 pt-5">
                  <button
                    type="button"
                    onClick={closeConfigure}
                    className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                  >
                    Save integration
                  </button>
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
