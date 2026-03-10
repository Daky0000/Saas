import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Box,
  CheckCircle,
  CreditCard,
  ExternalLink,
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

// ── Platform SVG Icons ──────────────────────────────────────────────────────────

const WordPressIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zM3.5 12c0-1.232.252-2.405.701-3.472L7.942 19.65A8.511 8.511 0 013.5 12zm8.5 8.5a8.51 8.51 0 01-2.42-.351l2.57-7.47 2.633 7.214a.85.85 0 00.064.123A8.507 8.507 0 0112 20.5zm1.172-12.452c.512-.027.973-.081.973-.081.459-.054.405-.729-.054-.702 0 0-1.376.108-2.265.108-.835 0-2.238-.108-2.238-.108-.459-.027-.513.675-.054.702 0 0 .433.054.891.081l1.323 3.624-1.858 5.573-3.091-9.197c.513-.027.974-.081.974-.081.459-.054.405-.729-.054-.702 0 0-1.376.108-2.265.108l-.513-.014A8.506 8.506 0 0112 3.5c2.286 0 4.37.899 5.921 2.366l-.082-.005c-.835 0-1.427.729-1.427 1.512 0 .702.405 1.296.837 1.997.324.567.702 1.296.702 2.347 0 .729-.28 1.573-.648 2.751l-.851 2.841-3.28-9.761zm3.093 11.82l2.614-7.556c.487-1.219.65-2.194.65-3.063 0-.314-.02-.607-.059-.884A8.507 8.507 0 0120.5 12a8.51 8.51 0 01-4.235 7.368z" />
  </svg>
);
const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
  </svg>
);
const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);
const LinkedInIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
  </svg>
);
const TikTokIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.79 1.54V6.79a4.85 4.85 0 01-1.02-.1z" />
  </svg>
);
const TwitterXIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);
const ThreadsIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.868 1.206 8.617.024 12.19 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 013.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.583-1.279-.878-2.29-.885-1.096.007-1.978.354-2.628.99l-1.43-1.54c.97-.945 2.353-1.466 3.865-1.474 3.39.014 5.271 2.108 5.575 5.756l.013.217c1.116.747 1.934 1.76 2.387 2.775.797 1.83.857 4.538-.969 6.354C18.97 22.838 16.577 23.978 12.19 24h-.004z" />
  </svg>
);

function getPlatformIcon(id: string): ReactNode {
  switch (id) {
    case 'wordpress': return <WordPressIcon />;
    case 'instagram': return <InstagramIcon />;
    case 'facebook':  return <FacebookIcon />;
    case 'linkedin':  return <LinkedInIcon />;
    case 'tiktok':    return <TikTokIcon />;
    case 'twitter':   return <TwitterXIcon />;
    case 'threads':   return <ThreadsIcon />;
    case 'mailchimp': return <Mail size={22} />;
    case 'chatgpt':   return <Bot size={22} />;
    case 'stripe':    return <CreditCard size={22} />;
    case 'square':    return <Box size={22} />;
    case 'zapier':    return <Webhook size={22} />;
    case 'framer':
    case 'webflow':   return <LayoutTemplate size={22} />;
    default:          return <SlidersHorizontal size={22} />;
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

type IntegrationCategory =
  | 'All integrations'
  | 'Social media'
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
  /** Linked documentation URL rendered inline in the help text */
  docUrl?: string;
  /** Visible anchor text for the doc link */
  docLabel?: string;
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
  'Social media',
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
    icon: getPlatformIcon('wordpress'),
    setupTitle: 'Connect WordPress',
    setupDescription: 'Enter your site URL and credentials. We verify the connection in real time.',
    requirements: ['Site URL', 'Username', 'Application password'],
    hasValidation: true,
    fields: [
      { id: 'siteUrl', label: 'Site URL', placeholder: 'https://your-site.com', type: 'url', helpText: 'Full URL of your WordPress installation.', docUrl: 'https://developer.wordpress.org/rest-api/', docLabel: 'WordPress REST API docs' },
      { id: 'username', label: 'Username', placeholder: 'Admin username', type: 'text', helpText: 'A WordPress user with permission to publish.' },
      { id: 'applicationPassword', label: 'Application password', placeholder: 'xxxx xxxx xxxx xxxx xxxx xxxx', type: 'password', helpText: 'Generate one under Users → Profile → Application Passwords.', docUrl: 'https://wordpress.org/support/article/application-passwords/', docLabel: 'How to generate' },
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'Connect Instagram to publish image posts, carousels, and manage social workflows.',
    category: 'Social media',
    accentClass: 'bg-gradient-to-br from-pink-500 via-fuchsia-500 to-orange-400 text-white',
    icon: getPlatformIcon('instagram'),
    isOAuth: true,
    setupTitle: 'Connect Instagram',
    setupDescription: 'Admin: configure app credentials. Users: click "Connect" to authorise via Instagram.',
    requirements: ['App ID', 'App secret', 'Redirect URI'],
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Instagram app ID', type: 'text', helpText: 'App identifier from the Meta developer console.', docUrl: 'https://developers.facebook.com/apps/', docLabel: 'Meta developers' },
      { id: 'appSecret', label: 'App secret', placeholder: 'Instagram app secret', type: 'password', helpText: 'Keep secure. Use the production secret when live.', docUrl: 'https://developers.facebook.com/docs/instagram-api/', docLabel: 'Instagram API docs' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://marketing.dakyworld.com/auth/instagram/callback', type: 'url', helpText: 'Must match the callback URL in your Meta app settings.', docUrl: 'https://developers.facebook.com/docs/instagram-api/getting-started', docLabel: 'Getting started guide' },
    ],
  },
  {
    id: 'facebook',
    name: 'Facebook',
    description: 'Connect Facebook pages and posting permissions to your content pipeline.',
    category: 'Social media',
    accentClass: 'bg-[#1877f2] text-white',
    icon: getPlatformIcon('facebook'),
    isOAuth: true,
    setupTitle: 'Connect Facebook',
    setupDescription: 'Admin: configure app credentials. Users: click "Connect" to authorise via Facebook.',
    requirements: ['App ID', 'App secret', 'Redirect URI'],
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Facebook app ID', type: 'text', helpText: 'Create an app and copy the App ID from the Meta developer console.', docUrl: 'https://developers.facebook.com/apps/', docLabel: 'Meta developers' },
      { id: 'appSecret', label: 'App secret', placeholder: 'Facebook app secret', type: 'password', helpText: 'Required to exchange authorization codes securely.', docUrl: 'https://developers.facebook.com/docs/graph-api/overview/', docLabel: 'Graph API docs' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://marketing.dakyworld.com/auth/facebook/callback', type: 'url', helpText: 'Register this URI under Facebook Login → Valid OAuth Redirect URIs.', docUrl: 'https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/', docLabel: 'OAuth flow guide' },
    ],
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'Connect LinkedIn for company updates, personal posts, and distribution workflows.',
    category: 'Social media',
    accentClass: 'bg-[#0a66c2] text-white',
    icon: getPlatformIcon('linkedin'),
    isOAuth: true,
    setupTitle: 'Connect LinkedIn',
    setupDescription: 'Admin: configure app credentials. Users: click "Connect" to authorise via LinkedIn.',
    requirements: ['Client ID', 'Client secret', 'Redirect URI'],
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'LinkedIn client ID', type: 'text', helpText: 'Client ID shown on your LinkedIn app overview page.', docUrl: 'https://www.linkedin.com/developers/apps', docLabel: 'LinkedIn developer apps' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'LinkedIn client secret', type: 'password', helpText: 'Used to exchange the OAuth authorization code.', docUrl: 'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow', docLabel: 'Authorization code flow' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://marketing.dakyworld.com/auth/linkedin/callback', type: 'url', helpText: 'Add this URI under Auth → Authorized Redirect URLs for your app.', docUrl: 'https://www.linkedin.com/developers/apps', docLabel: 'LinkedIn developer apps' },
    ],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    description: 'Connect TikTok to support video publishing flows and creator account access.',
    category: 'Social media',
    accentClass: 'bg-[#111111] text-white',
    icon: getPlatformIcon('tiktok'),
    isOAuth: true,
    setupTitle: 'Connect TikTok',
    setupDescription: 'Admin: configure app credentials. Users: click "Connect" to authorise via TikTok.',
    requirements: ['Client key', 'Client secret', 'Redirect URI'],
    fields: [
      { id: 'clientKey', label: 'Client key', placeholder: 'TikTok client key', type: 'text', helpText: 'Client key issued by the TikTok developer portal.', docUrl: 'https://developers.tiktok.com/', docLabel: 'TikTok developers' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'TikTok client secret', type: 'password', helpText: 'Required for exchanging codes and refreshing tokens.', docUrl: 'https://developers.tiktok.com/doc/login-kit-web/', docLabel: 'Login Kit docs' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://marketing.dakyworld.com/auth/tiktok/callback', type: 'url', helpText: 'Register this URI under your TikTok app → Manage app.', docUrl: 'https://developers.tiktok.com/doc/login-kit-web/', docLabel: 'TikTok OAuth setup' },
    ],
  },
  {
    id: 'twitter',
    name: 'Twitter / X',
    description: 'Connect Twitter or X for fast distribution, tweets, and community engagement flows.',
    category: 'Social media',
    accentClass: 'bg-black text-white',
    icon: getPlatformIcon('twitter'),
    isOAuth: true,
    setupTitle: 'Connect Twitter / X',
    setupDescription: 'Admin: configure app credentials. Users: click "Connect" to authorise via X.',
    requirements: ['Client ID', 'Client secret', 'Redirect URI'],
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'Twitter or X client ID', type: 'text', helpText: 'OAuth 2.0 Client ID from your X developer app settings.', docUrl: 'https://developer.x.com/en/portal/dashboard', docLabel: 'X developer portal' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'Twitter or X client secret', type: 'password', helpText: 'Required for secure authorization code exchange.', docUrl: 'https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code', docLabel: 'OAuth 2.0 guide' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://marketing.dakyworld.com/auth/twitter/callback', type: 'url', helpText: 'Add this under App Settings → User authentication settings.', docUrl: 'https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code', docLabel: 'X OAuth setup' },
    ],
  },
  {
    id: 'threads',
    name: 'Threads',
    description: 'Connect Threads by Instagram to publish text posts and grow conversations.',
    category: 'Social media',
    accentClass: 'bg-black text-white',
    icon: getPlatformIcon('threads'),
    isOAuth: true,
    setupTitle: 'Connect Threads',
    setupDescription: 'Threads uses the same Meta app as Instagram. Enable the Threads API in your Meta app, then users can connect.',
    requirements: ['Meta App ID', 'App secret', 'Redirect URI'],
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Meta App ID', type: 'text', helpText: 'Same Meta app as Instagram — enable the Threads API product inside it.', docUrl: 'https://developers.facebook.com/docs/threads/', docLabel: 'Threads API docs' },
      { id: 'appSecret', label: 'App secret', placeholder: 'Meta app secret', type: 'password', helpText: 'Same Meta app secret used for Instagram.', docUrl: 'https://developers.facebook.com/docs/threads/get-started/', docLabel: 'Getting started guide' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://yourdomain.com/auth/threads/callback', type: 'url', helpText: 'Register this URI in your Meta app under the Threads API product.', docUrl: 'https://developers.facebook.com/docs/threads/get-started/', docLabel: 'Threads OAuth setup' },
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
      { id: 'apiKey', label: 'API key', placeholder: 'Enter your Mailchimp API key', type: 'password', helpText: 'Found under Account → Extras → API keys.', docUrl: 'https://mailchimp.com/help/about-api-keys/', docLabel: 'Mailchimp API key guide' },
      { id: 'serverPrefix', label: 'Server prefix', placeholder: 'us21', type: 'text', helpText: 'Data center prefix from your Mailchimp account (e.g. us21).', docUrl: 'https://mailchimp.com/developer/marketing/docs/fundamentals/', docLabel: 'Mailchimp API fundamentals' },
      { id: 'audienceId', label: 'Audience ID', placeholder: 'Primary audience ID', type: 'text', helpText: 'The audience new leads should sync into.', docUrl: 'https://mailchimp.com/help/find-audience-id/', docLabel: 'How to find Audience ID' },
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
      { id: 'applicationId', label: 'Application ID', placeholder: 'Square application ID', type: 'text', helpText: 'Application ID from your Square developer dashboard.', docUrl: 'https://developer.squareup.com/apps', docLabel: 'Square developer apps' },
      { id: 'accessToken', label: 'Access token', placeholder: 'Production access token', type: 'password', helpText: 'Use a production token for live charges.', docUrl: 'https://developer.squareup.com/docs/build-basics/access-tokens', docLabel: 'Access token guide' },
      { id: 'locationId', label: 'Location ID', placeholder: 'Main Square location ID', type: 'text', helpText: 'Which Square business location to process payments for.', docUrl: 'https://developer.squareup.com/docs/locations-api', docLabel: 'Locations API docs' },
    ],
  },
  {
    id: 'brave',
    name: 'Brave',
    description: 'Brave is a privacy-first browser powered by the Chromium engine.',
    category: 'Browser tools',
    accentClass: 'bg-[#fff2eb] text-[#dc5a2f]',
    icon: getPlatformIcon('brave'),
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
      { id: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://hooks.zapier.com/hooks/catch/...', type: 'url', helpText: 'Paste the Zapier catch-hook URL that should receive events.', docUrl: 'https://zapier.com/help/create/code-webhooks/trigger-zaps-from-webhooks', docLabel: 'Zapier webhook guide' },
      { id: 'zapName', label: 'Zap name', placeholder: 'New lead sync', type: 'text', helpText: 'Descriptive name so teammates know which automation is connected.' },
      { id: 'secretKey', label: 'Secret key', placeholder: 'Optional verification secret', type: 'password', helpText: 'Add this if your Zap validates inbound request signatures.' },
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
      { id: 'apiKey', label: 'API key', placeholder: 'lin_api_...', type: 'password', helpText: 'Generate a personal API key in Linear Settings → API.', docUrl: 'https://linear.app/settings/api', docLabel: 'Linear API settings' },
      { id: 'teamKey', label: 'Team key', placeholder: 'ENG', type: 'text', helpText: 'Abbreviation of the Linear team where issues will be created.', docUrl: 'https://developers.linear.app/docs/graphql/working-with-the-graphql-api', docLabel: 'Linear API docs' },
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
      { id: 'siteId', label: 'Site ID', placeholder: 'Framer site ID', type: 'text', helpText: 'Site or workspace identifier found in Framer project settings.', docUrl: 'https://www.framer.com/developers/', docLabel: 'Framer developers' },
      { id: 'publishToken', label: 'Publishing token', placeholder: 'Framer API token', type: 'password', helpText: 'This token allows content pushes into Framer CMS.', docUrl: 'https://www.framer.com/developers/', docLabel: 'Framer API docs' },
      { id: 'collection', label: 'Target collection', placeholder: 'Blog posts', type: 'text', helpText: 'CMS collection that should receive new content.' },
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
      { id: 'apiKey', label: 'API key', placeholder: 'sk-...', type: 'password', helpText: 'Generate an API key in the OpenAI developer platform.', docUrl: 'https://platform.openai.com/api-keys', docLabel: 'OpenAI API keys' },
      { id: 'model', label: 'Model', placeholder: 'gpt-4o-mini', type: 'text', helpText: 'Model used for your workflow (e.g. gpt-4o, gpt-4o-mini).', docUrl: 'https://platform.openai.com/docs/models', docLabel: 'Available models' },
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
      { id: 'apiToken', label: 'API token', placeholder: 'Webflow API token', type: 'password', helpText: 'Generate under Workspace Settings → Integrations → API access.', docUrl: 'https://developers.webflow.com/', docLabel: 'Webflow developer docs' },
      { id: 'siteId', label: 'Site ID', placeholder: 'Primary Webflow site ID', type: 'text', helpText: 'Site where content should be published.', docUrl: 'https://developers.webflow.com/reference/list-sites', docLabel: 'List sites reference' },
      { id: 'collectionId', label: 'Collection ID', placeholder: 'Blog collection ID', type: 'text', helpText: 'CMS collection that will receive new content.', docUrl: 'https://developers.webflow.com/reference/list-collections', docLabel: 'List collections reference' },
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
      { id: 'publishableKey', label: 'Publishable key', placeholder: 'pk_live_...', type: 'text', helpText: 'Use your live key for production payments.', docUrl: 'https://dashboard.stripe.com/apikeys', docLabel: 'Stripe API keys' },
      { id: 'secretKey', label: 'Secret key', placeholder: 'sk_live_...', type: 'password', helpText: 'Used server-side only — never expose this to the browser.', docUrl: 'https://stripe.com/docs/keys', docLabel: 'API key best practices' },
      { id: 'signingSecret', label: 'Webhook secret', placeholder: 'whsec_...', type: 'password', helpText: 'Needed to verify Stripe events sent to your webhook endpoint.', docUrl: 'https://dashboard.stripe.com/webhooks', docLabel: 'Stripe webhooks' },
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
  threads: 'https://marketing.dakyworld.com/auth/threads/callback',
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
    const platforms = ['instagram', 'facebook', 'linkedin', 'twitter', 'tiktok', 'threads'];

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
      if (!res.ok) { setEnabledIds(new Set()); return; }
      const data = await res.json() as { success: boolean; enabled: string[] };
      if (data.success) {
        setEnabledIds(new Set(data.enabled));
      } else {
        setEnabledIds(new Set());
      }
    } catch {
      // If we can't confirm what's enabled/configured, show none.
      setEnabledIds(new Set());
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
      if (!isAdmin) {
        // Hide any integration that admin has not enabled (or we can't confirm yet).
        if (!enabledIds || !enabledIds.has(i.id)) return false;
        if (i.isOAuth) {
          // Only show OAuth integrations confirmed configured by admin (hide while loading or unconfigured).
          const status = oauthStatus[i.id];
          if (!status || status.loading || !status.configured) return false;
        }
      }
      const matchesCategory = activeCategory === 'All integrations' || i.category === activeCategory;
      const matchesQuery = !q || `${i.name} ${i.description} ${i.category}`.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [activeCategory, query, isAdmin, enabledIds, oauthStatus]);

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
                        ) : (
                          <button type="button" onClick={() => void handleOAuthConnect(integration.id)} disabled={isConnecting}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-60 transition-colors">
                            {isConnecting ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                            {isConnecting ? 'Connecting…' : `Connect with ${integration.name}`}
                          </button>
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
                      <p className="text-sm leading-6 text-slate-500">
                        {field.helpText}
                        {field.docUrl && (
                          <> — <a href={field.docUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-violet-600 underline-offset-2 hover:underline">{field.docLabel}</a></>
                        )}
                      </p>
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
