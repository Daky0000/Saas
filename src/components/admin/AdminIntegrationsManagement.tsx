import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Box,
  CheckCircle,
  CreditCard,
  FlaskConical,
  LayoutTemplate,
  Loader2,
  Power,
  SlidersHorizontal,
  Webhook,
  X,
  Search,
  AlertCircle,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
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
const MailchimpIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M20.522 11.026c.064-.189.098-.393.098-.607 0-1.034-.78-1.88-1.757-1.88-.193 0-.38.033-.555.093C17.778 7.074 16.07 6 14.137 6c-2.257 0-4.137 1.56-4.52 3.63a1.88 1.88 0 00-.417-.047c-1.07 0-1.95.91-1.95 2.04 0 .2.03.394.085.576C6.218 12.63 5.5 13.723 5.5 15c0 1.93 1.52 3.5 3.39 3.5h7.22c1.87 0 3.39-1.57 3.39-3.5 0-1.458-.843-2.718-2.072-3.276a3.97 3.97 0 00.094-.698zm-6.385 4.724a.5.5 0 01-.5.5H11.5a.5.5 0 110-1h2.137a.5.5 0 01.5.5zm2.363-2a.5.5 0 01-.5.5H9.5a.5.5 0 110-1h6.5a.5.5 0 01.5.5z" />
  </svg>
);

// ── Icon map ────────────────────────────────────────────────────────────────────

function getPlatformIcon(id: string): ReactNode {
  switch (id) {
    case 'wordpress': return <WordPressIcon />;
    case 'instagram': return <InstagramIcon />;
    case 'facebook':  return <FacebookIcon />;
    case 'linkedin':  return <LinkedInIcon />;
    case 'tiktok':    return <TikTokIcon />;
    case 'twitter':   return <TwitterXIcon />;
    case 'threads':   return <ThreadsIcon />;
    case 'mailchimp': return <MailchimpIcon />;
    case 'apify':     return <FlaskConical size={20} />;
    case 'manus':     return <Bot size={20} />;
    case 'chatgpt':   return <Bot size={20} />;
    case 'stripe':    return <CreditCard size={20} />;
    case 'square':    return <Box size={20} />;
    case 'zapier':    return <Webhook size={20} />;
    case 'framer':
    case 'webflow':   return <LayoutTemplate size={20} />;
    default:          return <SlidersHorizontal size={20} />;
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface IntegrationStep {
  text: string;
  /** A URL or code snippet to display as a copyable pill below the text */
  code?: string;
  /** Linkable doc URL shown as an inline "docs" badge */
  docUrl?: string;
}

interface IntegrationField {
  id: string;
  label: string;
  placeholder: string;
  type: 'text' | 'password' | 'url' | 'textarea';
  helpText: string;
  docUrl?: string;
  docLabel?: string;
  /** Env-variable name read by the server for this field */
  envVar?: string;
}

interface IntegrationDef {
  id: string;
  name: string;
  description: string;
  category: string;
  accentClass: string;
  fields: IntegrationField[];
  isOAuth?: boolean;
  /** Step-by-step setup guide shown in the configure modal */
  steps: IntegrationStep[];
  /** Required OAuth scopes or permissions (for informational display) */
  requiredScopes?: string[];
}

interface PlatformRow {
  platform: string;
  config: Record<string, string>;
  enabled: boolean;
}

// ── App URL helper (substituted into step instructions) ────────────────────────
const APP_URL = ((import.meta.env.VITE_APP_URL as string | undefined) ?? 'https://yourdomain.com').replace(/\/$/, '');

// ── All integrations the admin can manage ──────────────────────────────────────

const ALL_INTEGRATIONS: IntegrationDef[] = [
  {
    id: 'wordpress',
    name: 'WordPress',
    description: 'Publish posts, pages, and media into WordPress sites.',
    category: 'Developer tools',
    accentClass: 'bg-[#1d2327] text-white',
    steps: [
      { text: 'Log in to the WordPress admin dashboard of the site you want to connect.' },
      { text: 'Go to Users → Profile (or open any user that has at least Editor or Administrator role).' },
      { text: 'Scroll down to the "Application Passwords" section at the bottom of the profile page.' },
      { text: 'In the "New Application Password Name" field, enter a name such as "Dakyworld API", then click Add New Application Password.' },
      { text: 'WordPress will display a one-time password in the format: xxxx xxxx xxxx xxxx xxxx xxxx. Copy it immediately — it cannot be retrieved again.' },
      { text: 'Make sure the WordPress REST API is publicly accessible. Visit the URL below in a browser and confirm you see a JSON response:', code: 'https://your-site.com/wp-json/wp/v2/' },
      { text: 'Paste the Site URL, Username, and Application Password in the fields below, then save. The system will validate the connection by calling the REST API.', docUrl: 'https://wordpress.org/support/article/application-passwords/', },
    ],
    fields: [
      { id: 'siteUrl', label: 'Site URL', placeholder: 'https://your-site.com', type: 'url', helpText: 'Full URL of the WordPress installation — no trailing slash.', envVar: 'WORDPRESS_SITE_URL', docUrl: 'https://developer.wordpress.org/rest-api/', docLabel: 'REST API docs' },
      { id: 'username', label: 'Username', placeholder: 'Admin username', type: 'text', helpText: 'A WordPress user account with at minimum Editor role.', envVar: 'WORDPRESS_USERNAME' },
      { id: 'applicationPassword', label: 'Application password', placeholder: 'xxxx xxxx xxxx xxxx xxxx xxxx', type: 'password', helpText: 'Generated under Users → Profile → Application Passwords.', envVar: 'WORDPRESS_APP_PASSWORD', docUrl: 'https://wordpress.org/support/article/application-passwords/', docLabel: 'How to generate' },
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'OAuth — users connect their Instagram via your Meta app.',
    category: 'Social media',
    accentClass: 'bg-gradient-to-br from-pink-500 via-fuchsia-500 to-orange-400 text-white',
    isOAuth: true,
    requiredScopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement'],
    steps: [
      { text: 'Go to Meta for Developers and log in with your Facebook account.', docUrl: 'https://developers.facebook.com/apps/' },
      { text: 'Click "Create App" → choose "Business" as the app type → fill in the details and create.' },
      { text: 'Inside your app, click "Add Product" and add both "Instagram Graph API" and "Facebook Login".' },
      { text: 'Under Facebook Login → Settings, add the following Redirect URI to "Valid OAuth Redirect URIs":', code: `${APP_URL}/auth/instagram/callback` },
      { text: 'Go to App Settings → Basic. Copy the App ID and App Secret (click "Show" to reveal the secret).' },
      { text: 'Add the following OAuth scopes under App Review → Permissions and Features and request access: instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement.' },
      { text: 'Switch App Mode to "Live" when you are ready for real users (Development mode limits connections to app testers only).' },
      { text: 'Paste the App ID, App Secret, and the Redirect URI below, then save.', docUrl: 'https://developers.facebook.com/docs/instagram-api/getting-started' },
    ],
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Meta App ID', type: 'text', helpText: 'App identifier from the Meta developer console — Settings → Basic.', envVar: 'VITE_INSTAGRAM_APP_ID', docUrl: 'https://developers.facebook.com/apps/', docLabel: 'Meta developers' },
      { id: 'appSecret', label: 'App secret', placeholder: 'Meta app secret', type: 'password', helpText: 'Keep secure — only ever used server-side. Never expose in the browser.', envVar: 'INSTAGRAM_APP_SECRET', docUrl: 'https://developers.facebook.com/docs/instagram-api/', docLabel: 'Instagram API docs' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: `${APP_URL}/auth/instagram/callback`, type: 'url', helpText: 'Must exactly match the URI registered in your Meta app.', envVar: 'VITE_INSTAGRAM_REDIRECT_URI', docUrl: 'https://developers.facebook.com/docs/instagram-api/getting-started', docLabel: 'Getting started guide' },
    ],
  },
  {
    id: 'facebook',
    name: 'Facebook',
    description: 'OAuth — users connect their Facebook pages via your Meta app.',
    category: 'Social media',
    accentClass: 'bg-[#1877f2] text-white',
    isOAuth: true,
    requiredScopes: ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list', 'publish_to_groups'],
    steps: [
      { text: 'Go to Meta for Developers and open an existing app or create a new Business app.', docUrl: 'https://developers.facebook.com/apps/' },
      { text: 'Add the "Facebook Login" product to your app.' },
      { text: 'Under Facebook Login → Settings, add the following to "Valid OAuth Redirect URIs":', code: `${APP_URL}/auth/facebook/callback` },
      { text: 'Go to App Settings → Basic. Copy the App ID and App Secret.' },
      { text: 'Under App Review → Permissions and Features, request these scopes: pages_manage_posts, pages_read_engagement, pages_show_list.' },
      { text: 'Switch your app Mode to "Live" so external users can connect (not just testers).' },
      { text: 'Paste App ID, App Secret, and the Redirect URI below, then save.', docUrl: 'https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/' },
    ],
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Facebook App ID', type: 'text', helpText: 'Create an app and copy the App ID from the Meta developer console.', envVar: 'VITE_FACEBOOK_APP_ID', docUrl: 'https://developers.facebook.com/apps/', docLabel: 'Meta developers' },
      { id: 'appSecret', label: 'App secret', placeholder: 'Facebook app secret', type: 'password', helpText: 'Required to exchange authorization codes securely. Server-side only.', envVar: 'FACEBOOK_APP_SECRET', docUrl: 'https://developers.facebook.com/docs/graph-api/overview/', docLabel: 'Graph API docs' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: `${APP_URL}/auth/facebook/callback`, type: 'url', helpText: 'Register this URI under Facebook Login → Valid OAuth Redirect URIs.', envVar: 'VITE_FACEBOOK_REDIRECT_URI', docUrl: 'https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/', docLabel: 'OAuth flow guide' },
    ],
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'OAuth — users connect their LinkedIn via your developer app.',
    category: 'Social media',
    accentClass: 'bg-[#0a66c2] text-white',
    isOAuth: true,
    requiredScopes: ['w_member_social', 'r_liteprofile', 'r_emailaddress'],
    steps: [
      { text: 'Go to the LinkedIn Developer Portal and sign in.', docUrl: 'https://www.linkedin.com/developers/apps' },
      { text: 'Click "Create app", fill in app details (name, LinkedIn page, logo), and create.' },
      { text: 'On the Auth tab, copy the Client ID. Then generate and copy the Client Secret.' },
      { text: 'Under the Auth tab → OAuth 2.0 settings → "Authorized redirect URLs for your app", add:', code: `${APP_URL}/auth/linkedin/callback` },
      { text: 'Go to the Products tab and request access to: "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect". Both are usually approved immediately.' },
      { text: 'Ensure the scopes openid, profile, email, w_member_social are listed under Auth → OAuth 2.0 scopes.' },
      { text: 'Paste Client ID, Client Secret, and Redirect URI below, then save.', docUrl: 'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow' },
    ],
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'LinkedIn Client ID', type: 'text', helpText: 'Client ID shown on your LinkedIn app overview / Auth page.', envVar: 'VITE_LINKEDIN_CLIENT_ID', docUrl: 'https://www.linkedin.com/developers/apps', docLabel: 'LinkedIn developer apps' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'LinkedIn client secret', type: 'password', helpText: 'Used to exchange the OAuth authorization code. Keep server-side only.', envVar: 'LINKEDIN_CLIENT_SECRET', docUrl: 'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow', docLabel: 'Authorization code flow' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: `${APP_URL}/auth/linkedin/callback`, type: 'url', helpText: 'Add this URI under Auth → Authorized Redirect URLs for your app.', envVar: 'VITE_LINKEDIN_REDIRECT_URI', docUrl: 'https://www.linkedin.com/developers/apps', docLabel: 'LinkedIn developer apps' },
    ],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    description: 'OAuth — users connect their TikTok creator accounts.',
    category: 'Social media',
    accentClass: 'bg-[#111111] text-white',
    isOAuth: true,
    requiredScopes: ['user.info.basic', 'video.upload', 'video.publish'],
    steps: [
      { text: 'Go to the TikTok for Developers portal and log in.', docUrl: 'https://developers.tiktok.com/' },
      { text: 'Click "Manage apps" → "Connect an app" → create a new app for Web.' },
      { text: 'Under the app settings, enable the following products: "Login Kit" and "Content Posting API".' },
      { text: 'Under Login Kit → Redirect domain, add your domain. Then under "Redirect URI for Login Kit", add:', code: `${APP_URL}/auth/tiktok/callback` },
      { text: 'Copy the Client key (used as Client ID) and Client Secret from the app dashboard.' },
      { text: 'Request the scopes: user.info.basic, video.upload, video.publish. Submit for review if required (needed for external users).' },
      { text: 'Paste Client Key, Client Secret, and Redirect URI below, then save.', docUrl: 'https://developers.tiktok.com/doc/login-kit-web/' },
    ],
    fields: [
      { id: 'clientKey', label: 'Client key', placeholder: 'TikTok client key', type: 'text', helpText: 'Client key (equivalent to Client ID) issued by the TikTok developer portal.', envVar: 'VITE_TIKTOK_CLIENT_ID', docUrl: 'https://developers.tiktok.com/', docLabel: 'TikTok developers' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'TikTok client secret', type: 'password', helpText: 'Required for exchanging codes and refreshing tokens. Server-side only.', envVar: 'TIKTOK_CLIENT_SECRET', docUrl: 'https://developers.tiktok.com/doc/login-kit-web/', docLabel: 'Login Kit docs' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: `${APP_URL}/auth/tiktok/callback`, type: 'url', helpText: 'Register this URI under your TikTok app → Login Kit → Redirect URI.', envVar: 'VITE_TIKTOK_REDIRECT_URI', docUrl: 'https://developers.tiktok.com/doc/login-kit-web/', docLabel: 'TikTok OAuth setup' },
    ],
  },
  {
    id: 'twitter',
    name: 'Twitter / X',
    description: 'OAuth — users connect their X accounts via your developer app.',
    category: 'Social media',
    accentClass: 'bg-black text-white',
    isOAuth: true,
    requiredScopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    steps: [
      { text: 'Go to the X Developer Portal and sign in with your X account.', docUrl: 'https://developer.x.com/en/portal/dashboard' },
      { text: 'Create a new Project and inside it create a new App. Give it a descriptive name.' },
      { text: 'Under your app → Settings → User authentication settings, click "Set up".' },
      { text: 'Set App permissions to "Read and Write". Set Type of App to "Web App, Automated App or Bot".' },
      { text: 'In "Callback URI / Redirect URL", add:', code: `${APP_URL}/auth/twitter/callback` },
      { text: 'In "Website URL", enter your app domain:', code: APP_URL },
      { text: 'Go to Keys and Tokens tab → OAuth 2.0 Client ID and Client Secret. Copy both values.' },
      { text: 'Ensure scopes tweet.read, tweet.write, users.read, offline.access are listed in your app settings.' },
      { text: 'Paste Client ID, Client Secret, and Redirect URI below, then save.', docUrl: 'https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code' },
    ],
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'X OAuth 2.0 client ID', type: 'text', helpText: 'OAuth 2.0 Client ID from your X developer app → Keys and Tokens.', envVar: 'VITE_TWITTER_CLIENT_ID', docUrl: 'https://developer.x.com/en/portal/dashboard', docLabel: 'X developer portal' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'X client secret', type: 'password', helpText: 'Required for secure authorization code exchange. Server-side only.', envVar: 'TWITTER_CLIENT_SECRET', docUrl: 'https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code', docLabel: 'OAuth 2.0 guide' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: `${APP_URL}/auth/twitter/callback`, type: 'url', helpText: 'Add this under App Settings → User authentication settings → Callback URI.', envVar: 'VITE_TWITTER_REDIRECT_URI', docUrl: 'https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code', docLabel: 'X OAuth setup' },
    ],
  },
  {
    id: 'threads',
    name: 'Threads',
    description: 'OAuth — users connect their Threads accounts via your Meta app.',
    category: 'Social media',
    accentClass: 'bg-black text-white',
    isOAuth: true,
    requiredScopes: ['threads_basic', 'threads_content_publish'],
    steps: [
      { text: 'Threads uses the same Meta App as Instagram. Open your existing Meta app at Meta for Developers (or create one if you haven\'t already).', docUrl: 'https://developers.facebook.com/apps/' },
      { text: 'Inside your Meta app, click "Add Product" and search for "Threads API". Add it to your app.' },
      { text: 'Under Threads API → Settings, in the "Redirect Callback URLs" field, add:', code: `${APP_URL}/auth/threads/callback` },
      { text: 'Under Threads API → Permissions, add: threads_basic and threads_content_publish.' },
      { text: 'Go to App Settings → Basic. Use the same App ID and App Secret as your Instagram configuration (it is the same Meta app).' },
      { text: 'Switch your app Mode to "Live" so external Threads users can connect.' },
      { text: 'Paste App ID, App Secret, and the Threads Redirect URI below, then save.', docUrl: 'https://developers.facebook.com/docs/threads/get-started/' },
    ],
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Meta App ID', type: 'text', helpText: 'Same Meta app as Instagram — enable Threads API product inside it.', envVar: 'VITE_INSTAGRAM_APP_ID', docUrl: 'https://developers.facebook.com/docs/threads/', docLabel: 'Threads API docs' },
      { id: 'appSecret', label: 'App secret', placeholder: 'Meta app secret', type: 'password', helpText: 'Same Meta app secret used for Instagram. Server-side only.', envVar: 'INSTAGRAM_APP_SECRET', docUrl: 'https://developers.facebook.com/docs/threads/get-started/', docLabel: 'Getting started guide' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: `${APP_URL}/auth/threads/callback`, type: 'url', helpText: 'Register this specific URI in the Threads API product settings.', envVar: 'VITE_THREADS_REDIRECT_URI', docUrl: 'https://developers.facebook.com/docs/threads/get-started/', docLabel: 'Threads OAuth setup' },
    ],
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    description: 'Email marketing — send campaigns to audience lists.',
    category: 'Communication',
    accentClass: 'bg-[#f5df4d] text-[#1f1f1f]',
    steps: [
      { text: 'Log in to your Mailchimp account at mailchimp.com.' },
      { text: 'Click your profile icon (bottom-left) → Account & billing → Extras → API keys.', docUrl: 'https://mailchimp.com/help/about-api-keys/' },
      { text: 'Click "Create A Key". Give it a label like "Dakyworld Integration". Copy the generated API key immediately.' },
      { text: 'Find your Server Prefix: it is the data center code at the end of your Mailchimp dashboard URL. Example: if you see us21.admin.mailchimp.com, your prefix is us21.' },
      { text: 'Find your Audience ID: go to Audience → Manage Audience → Settings → Audience name and defaults. The Audience ID is shown in that page.' },
      { text: 'Paste all three values (API key, server prefix, audience ID) in the fields below, then save.', docUrl: 'https://mailchimp.com/developer/marketing/docs/fundamentals/' },
    ],
    fields: [
      { id: 'apiKey', label: 'API key', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxx-us21', type: 'password', helpText: 'Found under Account → Extras → API keys. Ends with -us21 or similar prefix.', envVar: 'MAILCHIMP_API_KEY', docUrl: 'https://mailchimp.com/help/about-api-keys/', docLabel: 'API key guide' },
      { id: 'serverPrefix', label: 'Server prefix', placeholder: 'us21', type: 'text', helpText: 'Data center prefix from your Mailchimp dashboard URL (e.g. us21, us6).', envVar: 'MAILCHIMP_SERVER_PREFIX', docUrl: 'https://mailchimp.com/developer/marketing/docs/fundamentals/', docLabel: 'API fundamentals' },
      { id: 'audienceId', label: 'Audience ID', placeholder: 'a1b2c3d4e5', type: 'text', helpText: 'Found under Audience → Manage Audience → Settings → Audience name and defaults.', envVar: 'MAILCHIMP_AUDIENCE_ID', docUrl: 'https://mailchimp.com/help/find-audience-id/', docLabel: 'How to find Audience ID' },
    ],
  },
  {
    id: 'square',
    name: 'Square',
    description: 'Payments processing and POS solutions.',
    category: 'Productivity',
    accentClass: 'bg-black text-white',
    steps: [
      { text: 'Go to the Square Developer Dashboard and sign in.', docUrl: 'https://developer.squareup.com/apps' },
      { text: 'Click "Create your first application" (or open an existing one). Give it a name like "Dakyworld".' },
      { text: 'On the app overview page, copy the Application ID.' },
      { text: 'Go to the OAuth section → Production tab. Generate and copy the Production Access Token. (Use Sandbox for testing only.)' },
      { text: 'To find your Location ID, go to the Locations API in the developer docs, or open Square Dashboard → Account & Settings → Business information → Locations. The Location ID appears in the URL or via the Locations API.', docUrl: 'https://developer.squareup.com/docs/locations-api' },
      { text: 'Paste Application ID, Access Token, and Location ID below, then save.', docUrl: 'https://developer.squareup.com/docs/build-basics/access-tokens' },
    ],
    fields: [
      { id: 'applicationId', label: 'Application ID', placeholder: 'sq0idp-...', type: 'text', helpText: 'Application ID from the Square developer dashboard overview page.', envVar: 'SQUARE_APPLICATION_ID', docUrl: 'https://developer.squareup.com/apps', docLabel: 'Square developer apps' },
      { id: 'accessToken', label: 'Access token', placeholder: 'EAAAl...', type: 'password', helpText: 'Use a production access token for live charges. Server-side only.', envVar: 'SQUARE_ACCESS_TOKEN', docUrl: 'https://developer.squareup.com/docs/build-basics/access-tokens', docLabel: 'Access token guide' },
      { id: 'locationId', label: 'Location ID', placeholder: 'LXXXXXXXXXXXXXXXXXX', type: 'text', helpText: 'Which Square business location to process payments for.', envVar: 'SQUARE_LOCATION_ID', docUrl: 'https://developer.squareup.com/docs/locations-api', docLabel: 'Locations API docs' },
    ],
  },
  {
    id: 'zapier',
    name: 'Zapier',
    description: 'Build custom automations and trigger zaps from events.',
    category: 'Productivity',
    accentClass: 'bg-[#ff6a2a] text-white',
    steps: [
      { text: 'Log in to Zapier and click "Create Zap" from the dashboard.', docUrl: 'https://zapier.com/app/zaps' },
      { text: 'For the Trigger step, search for and select "Webhooks by Zapier".' },
      { text: 'Choose "Catch Hook" as the trigger event and click Continue.' },
      { text: 'Zapier will generate a unique webhook URL. Copy it — it looks like:', code: 'https://hooks.zapier.com/hooks/catch/123456/abcdef/' },
      { text: 'Give your Zap a descriptive name at the top (e.g. "New Post Published").' },
      { text: 'Optionally, add a secret key if you want to validate that events come from your platform only.' },
      { text: 'Paste the webhook URL and Zap name below and save. Then return to Zapier to configure the Action steps and turn the Zap on.', docUrl: 'https://zapier.com/help/create/code-webhooks/trigger-zaps-from-webhooks' },
    ],
    fields: [
      { id: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://hooks.zapier.com/hooks/catch/...', type: 'url', helpText: 'Paste the Zapier catch-hook URL that should receive events.', envVar: 'ZAPIER_WEBHOOK_URL', docUrl: 'https://zapier.com/help/create/code-webhooks/trigger-zaps-from-webhooks', docLabel: 'Zapier webhook guide' },
      { id: 'zapName', label: 'Zap name', placeholder: 'New lead sync', type: 'text', helpText: 'Descriptive name so teammates know which automation is connected.', envVar: 'ZAPIER_ZAP_NAME' },
      { id: 'secretKey', label: 'Secret key', placeholder: 'Optional verification secret', type: 'password', helpText: 'Add this if your Zap validates inbound request signatures.', envVar: 'ZAPIER_SECRET_KEY' },
    ],
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Streamline software projects, sprints, tasks, and bug tracking.',
    category: 'Developer tools',
    accentClass: 'bg-[#4050b5] text-white',
    steps: [
      { text: 'Log in to Linear and go to Settings → API.', docUrl: 'https://linear.app/settings/api' },
      { text: 'Click "Create key" and give it a descriptive label like "Dakyworld Integration".' },
      { text: 'Copy the generated API key — it starts with lin_api_ and is only shown once.' },
      { text: 'To find your Team Key, go to Settings → Teams. The Team Key is the short identifier shown next to the team name (e.g. ENG, PROD, MKT).' },
      { text: 'Optionally, find a Project ID by opening the project in Linear — it appears in the URL as a UUID.' },
      { text: 'Paste the API key, Team Key, and optionally Project ID below, then save.', docUrl: 'https://developers.linear.app/docs/graphql/working-with-the-graphql-api' },
    ],
    fields: [
      { id: 'apiKey', label: 'API key', placeholder: 'lin_api_...', type: 'password', helpText: 'Generate a personal API key in Linear Settings → API.', envVar: 'LINEAR_API_KEY', docUrl: 'https://linear.app/settings/api', docLabel: 'Linear API settings' },
      { id: 'teamKey', label: 'Team key', placeholder: 'ENG', type: 'text', helpText: 'Short identifier of the Linear team where issues will be created (e.g. ENG).', envVar: 'LINEAR_TEAM_KEY', docUrl: 'https://developers.linear.app/docs/graphql/working-with-the-graphql-api', docLabel: 'Linear API docs' },
      { id: 'projectId', label: 'Project or label', placeholder: 'Launch operations', type: 'text', helpText: 'Optional default project name or label for new tickets.', envVar: 'LINEAR_PROJECT_ID' },
    ],
  },
  {
    id: 'framer',
    name: 'Framer',
    description: 'Design and publish polished marketing pages with CMS.',
    category: 'Developer tools',
    accentClass: 'bg-black text-white',
    steps: [
      { text: 'Log in to Framer and open the project (site) you want to connect.', docUrl: 'https://www.framer.com/developers/' },
      { text: 'Go to Site Settings. The Site ID is visible in the URL bar or within the Settings panel.' },
      { text: 'Open Site Settings → Integrations (or General) and generate a Publishing Token. Copy it.' },
      { text: 'Note the exact name of the CMS Collection that should receive new content (e.g. "Blog Posts", "Articles").' },
      { text: 'Paste Site ID, Publishing Token, and Collection name below, then save.', docUrl: 'https://www.framer.com/developers/' },
    ],
    fields: [
      { id: 'siteId', label: 'Site ID', placeholder: 'Framer site ID', type: 'text', helpText: 'Site or workspace identifier found in Framer project settings URL.', envVar: 'FRAMER_SITE_ID', docUrl: 'https://www.framer.com/developers/', docLabel: 'Framer developers' },
      { id: 'publishToken', label: 'Publishing token', placeholder: 'framer_...', type: 'password', helpText: 'Allows content pushes into Framer CMS. Generated in Site Settings.', envVar: 'FRAMER_PUBLISH_TOKEN', docUrl: 'https://www.framer.com/developers/', docLabel: 'Framer API docs' },
      { id: 'collection', label: 'Target collection', placeholder: 'Blog posts', type: 'text', helpText: 'CMS collection name that should receive new content.', envVar: 'FRAMER_COLLECTION' },
    ],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT / OpenAI',
    description: 'AI drafting, editing, summarizing, and automation support.',
    category: 'Productivity',
    accentClass: 'bg-black text-white',
    steps: [
      { text: 'Go to the OpenAI Platform and sign in (or create an account).', docUrl: 'https://platform.openai.com/' },
      { text: 'Navigate to API Keys at:', code: 'https://platform.openai.com/api-keys' },
      { text: 'Click "Create new secret key". Give it a name like "Dakyworld" and copy it immediately — it will not be shown again.' },
      { text: 'Choose a model appropriate for your use case. Recommended: gpt-4o-mini for speed and cost efficiency, gpt-4o for best quality.', docUrl: 'https://platform.openai.com/docs/models' },
      { text: 'Optionally write a System Prompt to give the AI a consistent brand voice, tone, or persona for all requests.' },
      { text: 'Ensure your OpenAI account has a valid payment method and sufficient credits under Billing → Overview.' },
      { text: 'Paste API key, model name, and optional system prompt below, then save.' },
    ],
    fields: [
      { id: 'apiKey', label: 'API key', placeholder: 'sk-proj-...', type: 'password', helpText: 'Generate at platform.openai.com/api-keys. Only shown once — save it securely.', envVar: 'OPENAI_API_KEY', docUrl: 'https://platform.openai.com/api-keys', docLabel: 'OpenAI API keys' },
      { id: 'model', label: 'Model', placeholder: 'gpt-4o-mini', type: 'text', helpText: 'Model used for all AI requests (gpt-4o-mini is recommended for cost efficiency).', envVar: 'OPENAI_MODEL', docUrl: 'https://platform.openai.com/docs/models', docLabel: 'Available models' },
      { id: 'systemPrompt', label: 'System prompt', placeholder: 'You are a brand voice assistant...', type: 'textarea', helpText: 'Optional base prompt applied to every AI request for consistent brand tone.', envVar: 'OPENAI_SYSTEM_PROMPT' },
    ],
  },
  {
    id: 'webflow',
    name: 'Webflow',
    description: 'Visual canvas website builder with CMS support.',
    category: 'Developer tools',
    accentClass: 'bg-[#4f67ff] text-white',
    steps: [
      { text: 'Log in to Webflow and go to Workspace Settings → Integrations.', docUrl: 'https://developers.webflow.com/' },
      { text: 'Under "API access", click "Generate API token". Copy the token.' },
      { text: 'To find your Site ID: open your Webflow project → go to Project Settings → General. The Site ID is shown there, or you can retrieve it using the API:', code: 'GET https://api.webflow.com/sites' },
      { text: 'To find your CMS Collection ID: open the Webflow Designer → CMS → click your collection. The Collection ID appears in the browser URL.' },
      { text: 'Alternatively use the API to list collections for a site:', code: 'GET https://api.webflow.com/sites/{site_id}/collections' },
      { text: 'Paste API Token, Site ID, and Collection ID below, then save.', docUrl: 'https://developers.webflow.com/reference/list-collections' },
    ],
    fields: [
      { id: 'apiToken', label: 'API token', placeholder: 'Webflow API token', type: 'password', helpText: 'Generate under Workspace Settings → Integrations → API access.', envVar: 'WEBFLOW_API_TOKEN', docUrl: 'https://developers.webflow.com/', docLabel: 'Webflow developer docs' },
      { id: 'siteId', label: 'Site ID', placeholder: '64a1b2c3d4e5f6a7b8c9d0e1', type: 'text', helpText: 'Found in Project Settings → General, or via the Webflow API list-sites endpoint.', envVar: 'WEBFLOW_SITE_ID', docUrl: 'https://developers.webflow.com/reference/list-sites', docLabel: 'List sites reference' },
      { id: 'collectionId', label: 'Collection ID', placeholder: '64a1b2c3d4e5f6a7b8c9d0e2', type: 'text', helpText: 'CMS collection that will receive new content. Find it in the Webflow Designer URL.', envVar: 'WEBFLOW_COLLECTION_ID', docUrl: 'https://developers.webflow.com/reference/list-collections', docLabel: 'List collections reference' },
    ],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Payments API for subscriptions, checkout, and billing.',
    category: 'Productivity',
    accentClass: 'bg-[#6658ff] text-white',
    steps: [
      { text: 'Log in to Stripe Dashboard and go to Developers → API Keys.', docUrl: 'https://dashboard.stripe.com/apikeys' },
      { text: 'Copy the Publishable Key (pk_live_...) — this is safe to use client-side.' },
      { text: 'Reveal and copy the Secret Key (sk_live_...). This is server-side only and must never be exposed publicly.' },
      { text: 'Use test keys (pk_test_... / sk_test_...) during development and switch to live keys only for production.' },
      { text: 'Go to Developers → Webhooks → Add endpoint. Set the endpoint URL to:', code: `${APP_URL}/api/webhooks/stripe` },
      { text: 'Select the events your platform needs to listen for, for example: payment_intent.succeeded, customer.subscription.created, invoice.payment_failed.' },
      { text: 'After creating the webhook, click "Reveal" next to the Signing secret (whsec_...) and copy it. This is used to verify that events come from Stripe.', docUrl: 'https://dashboard.stripe.com/webhooks' },
      { text: 'Paste Publishable Key, Secret Key, and Webhook Signing Secret below, then save.' },
    ],
    fields: [
      { id: 'publishableKey', label: 'Publishable key', placeholder: 'pk_live_...', type: 'text', helpText: 'Safe for client-side use. Use pk_live_ for production, pk_test_ for testing.', envVar: 'VITE_STRIPE_PUBLISHABLE_KEY', docUrl: 'https://dashboard.stripe.com/apikeys', docLabel: 'Stripe API keys' },
      { id: 'secretKey', label: 'Secret key', placeholder: 'sk_live_...', type: 'password', helpText: 'Server-side only — never expose this in the browser or commit to git.', envVar: 'STRIPE_SECRET_KEY', docUrl: 'https://stripe.com/docs/keys', docLabel: 'API key best practices' },
      { id: 'signingSecret', label: 'Webhook signing secret', placeholder: 'whsec_...', type: 'password', helpText: 'Verifies that webhook events are genuinely from Stripe.', envVar: 'STRIPE_SIGNING_SECRET', docUrl: 'https://dashboard.stripe.com/webhooks', docLabel: 'Stripe webhooks' },
    ],
  },
  {
    id: 'apify',
    name: 'Apify',
    description: 'API token based integration for Apify actors and automations.',
    category: 'Developer tools',
    accentClass: 'bg-[#0f172a] text-white',
    steps: [
      { text: 'Log in to Apify Console and open Settings → Integrations to generate an API token.', docUrl: 'https://docs.apify.com/platform/integrations/api' },
      { text: 'Enable this integration so it appears for users in the Integrations page.' },
      { text: 'Users will paste their Apify API token when configuring the integration.' },
    ],
    fields: [
      { id: 'note', label: 'Note', placeholder: 'Apify is user-configured', type: 'text', helpText: 'No admin credentials are required. Enable the integration to show it to users.' },
    ],
  },
  {
    id: 'manus',
    name: 'Manus',
    description: 'API key based integration for Manus tasks and content automation.',
    category: 'Productivity',
    accentClass: 'bg-[#111827] text-white',
    steps: [
      { text: 'Create a Manus API key in your Manus account.' },
      { text: 'Enable this integration so it appears for users in the Integrations page.' },
      { text: 'Users will paste their API key when configuring the integration.' },
    ],
    fields: [
      { id: 'note', label: 'Note', placeholder: 'Manus is user-configured', type: 'text', helpText: 'No admin credentials are required. Enable the integration to show it to users.' },
    ],
  },
];

// ── Category list ───────────────────────────────────────────────────────────────

const ADMIN_CATEGORIES = ['All', 'Social media', 'Communication', 'Developer tools', 'Productivity'] as const;
type AdminCategory = (typeof ADMIN_CATEGORIES)[number];

// ── Config ─────────────────────────────────────────────────────────────────────

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com') ? '' : rawApiBaseUrl.replace(/\/$/, '');

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
};

// ── Copyable code pill ─────────────────────────────────────────────────────────

function CodePill({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <code className="flex-1 truncate text-[11px] font-mono text-slate-700">{value}</code>
      <button
        type="button"
        onClick={copy}
        title="Copy"
        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold text-slate-500 transition hover:bg-slate-200"
      >
        {copied ? <CheckCircle size={11} className="text-emerald-500" /> : <Copy size={11} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

// ── Setup guide panel ──────────────────────────────────────────────────────────

function SetupGuide({ def }: { def: IntegrationDef }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <BookOpen size={14} className="text-blue-600" />
          <span className="text-sm font-bold text-blue-800">Setup guide</span>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-600">
            {def.steps.length} steps
          </span>
        </div>
        {open ? <ChevronUp size={14} className="text-blue-500" /> : <ChevronDown size={14} className="text-blue-500" />}
      </button>

      {open && (
        <div className="border-t border-blue-100 px-4 pb-4">
          {/* Required scopes */}
          {def.requiredScopes && def.requiredScopes.length > 0 && (
            <div className="mt-3 mb-4">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-blue-600">Required permissions / scopes</p>
              <div className="flex flex-wrap gap-1">
                {def.requiredScopes.map((s) => (
                  <span key={s} className="rounded-md border border-blue-200 bg-white px-2 py-0.5 font-mono text-[10px] text-blue-700">{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Steps */}
          <ol className="mt-3 space-y-3">
            {def.steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-200 text-[10px] font-black text-blue-800">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs leading-5 text-slate-700">
                    {step.text}
                    {step.docUrl && (
                      <>
                        {' '}
                        <a
                          href={step.docUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 font-semibold text-blue-600 underline-offset-2 hover:underline"
                        >
                          Docs <ExternalLink size={10} />
                        </a>
                      </>
                    )}
                  </p>
                  {step.code && <CodePill value={step.code} />}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

const AdminIntegrationsManagement = () => {
  const [platformRows, setPlatformRows] = useState<Record<string, PlatformRow>>({});
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<AdminCategory>('All');

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json() as { success: boolean; configs: PlatformRow[] };
      if (data.success) {
        const map: Record<string, PlatformRow> = {};
        for (const row of data.configs) map[row.platform] = row;
        setPlatformRows(map);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { void fetchConfigs(); }, [fetchConfigs]);

  const handleToggle = async (integrationId: string, currentEnabled: boolean) => {
    setToggling(integrationId);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/${integrationId}/toggle`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      const data = await res.json() as { success: boolean; enabled: boolean };
      if (data.success) {
        setPlatformRows((prev) => ({
          ...prev,
          [integrationId]: { ...(prev[integrationId] ?? { platform: integrationId, config: {} }), enabled: data.enabled },
        }));
      }
    } catch { /* ignore */ }
    setToggling(null);
  };

  const handleTest = async (integrationId: string) => {
    setTesting(integrationId);
    setTestResults((prev) => { const next = { ...prev }; delete next[integrationId]; return next; });
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/${integrationId}/test`, { headers: authHeaders() });
      const data = await res.json() as { success: boolean; message?: string; error?: string };
      setTestResults((prev) => ({
        ...prev,
        [integrationId]: { ok: data.success, message: data.message || data.error || (data.success ? 'OK' : 'Failed') },
      }));
    } catch {
      setTestResults((prev) => ({ ...prev, [integrationId]: { ok: false, message: 'Request failed' } }));
    }
    setTesting(null);
  };

  const openConfigure = (id: string) => {
    const existing = platformRows[id]?.config ?? {};
    setDraftValues(existing);
    setActiveId(id);
    setSaveError(null);
    setSaveSuccess(null);
  };

  const handleSave = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeId) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const wasEnabled = platformRows[activeId]?.enabled ?? false;
      const hasCredentials = Object.values(draftValues).some((v) => v.trim().length > 0);
      const shouldEnable = wasEnabled || hasCredentials;
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/${activeId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ config: draftValues, enabled: shouldEnable }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (!data.success) throw new Error(data.error || 'Save failed');
      setPlatformRows((prev) => ({
        ...prev,
        [activeId]: { platform: activeId, config: draftValues, enabled: shouldEnable },
      }));
      setTestResults((prev) => { const next = { ...prev }; delete next[activeId]; return next; });
      setSaveSuccess(`Configuration saved${shouldEnable && !wasEnabled ? ' and enabled for users' : ''}.`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
    setSaving(false);
  };

  const activeDef = useMemo(() => ALL_INTEGRATIONS.find((i) => i.id === activeId) ?? null, [activeId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ALL_INTEGRATIONS.filter((i) => {
      if (activeCategory !== 'All' && i.category !== activeCategory) return false;
      if (!q) return true;
      return `${i.name} ${i.description} ${i.category}`.toLowerCase().includes(q);
    });
  }, [search, activeCategory]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-[24px] border border-slate-200 bg-white px-6 py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-[-0.03em] text-slate-950">Integration Management</h2>
            <p className="mt-1 text-sm text-slate-500">
              Configure credentials and control which integrations users can connect to.
              Only <strong>enabled</strong> integrations appear in the user dashboard.
            </p>
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search integrations…"
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-slate-400"
            />
          </div>
        </div>

        {/* Category tabs */}
        <div className="mt-4 flex flex-wrap gap-2">
          {ADMIN_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeCategory === cat
                  ? 'bg-slate-950 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((integration) => {
            const row = platformRows[integration.id];
            const isEnabled = row?.enabled ?? false;
            const isConfigured = row !== undefined && Object.keys(row.config).length > 0;
            const isToggling = toggling === integration.id;
            const isTesting = testing === integration.id;
            const testResult = testResults[integration.id];

            return (
              <div
                key={integration.id}
                className={`rounded-[20px] border bg-white p-4 transition-all ${isEnabled ? 'border-emerald-200 shadow-sm' : 'border-slate-200'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${integration.accentClass}`}>
                    {getPlatformIcon(integration.id)}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleToggle(integration.id, isEnabled)}
                    disabled={isToggling}
                    title={isEnabled ? 'Disable for users' : 'Enable for users'}
                    className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                      isEnabled
                        ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {isToggling ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
                    {isEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                <div className="mt-3">
                  <div className="flex items-center gap-2">
                    <h3 className="font-black text-slate-900">{integration.name}</h3>
                    {integration.isOAuth && (
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">OAuth</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{integration.description}</p>
                  <div className="mt-1 text-[11px] font-medium text-slate-400">{integration.category}</div>
                </div>

                {testResult && (
                  <div className={`mt-3 flex items-start gap-1.5 rounded-xl px-3 py-2 text-[11px] font-medium ${testResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                    {testResult.ok ? <CheckCircle size={12} className="mt-px flex-shrink-0" /> : <AlertCircle size={12} className="mt-px flex-shrink-0" />}
                    {testResult.message}
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <span className={`text-xs font-semibold ${isConfigured ? 'text-emerald-600' : 'text-amber-500'}`}>
                    {isConfigured ? 'Configured' : 'Not configured'}
                  </span>
                  <div className="flex items-center gap-2">
                    {isConfigured && (
                      <button
                        type="button"
                        onClick={() => void handleTest(integration.id)}
                        disabled={isTesting}
                        title="Test connection"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                      >
                        {isTesting ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
                        Test
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openConfigure(integration.id)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <SlidersHorizontal size={12} />
                      {isConfigured ? 'Reconfigure' : 'Configure'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Configure modal */}
      {activeDef && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-8">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-[28px] border border-slate-200 bg-white flex flex-col">

            {/* Modal header */}
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${activeDef.accentClass}`}>
                  {getPlatformIcon(activeDef.id)}
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Admin Configuration</div>
                  <h3 className="mt-0.5 text-xl font-black tracking-[-0.03em] text-slate-950">{activeDef.name}</h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setActiveId(null); setSaveError(null); setSaveSuccess(null); }}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={18} />
              </button>
            </div>

            {/* OAuth notice */}
            {activeDef.isOAuth && (
              <div className="shrink-0 border-b border-slate-100 bg-violet-50 px-6 py-3">
                <p className="text-xs text-violet-700">
                  These credentials are used when users click "Connect {activeDef.name}" — they authorise via OAuth using your registered app.
                </p>
              </div>
            )}

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* Setup guide */}
              <SetupGuide def={activeDef} />

              {/* Form fields */}
              <form id="integration-form" onSubmit={handleSave}>
                <p className="mt-5 mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Credentials</p>
                <div className="space-y-4">
                  {activeDef.fields.map((field) => (
                    <label key={field.id} className="block space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-800">{field.label}</span>
                        {field.envVar && (
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                            {field.envVar}
                          </span>
                        )}
                      </div>
                      {field.type === 'textarea' ? (
                        <textarea
                          value={draftValues[field.id] ?? ''}
                          onChange={(e) => setDraftValues((c) => ({ ...c, [field.id]: e.target.value }))}
                          placeholder={field.placeholder}
                          rows={3}
                          className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-slate-400"
                        />
                      ) : (
                        <input
                          type={field.type}
                          value={draftValues[field.id] ?? ''}
                          onChange={(e) => setDraftValues((c) => ({ ...c, [field.id]: e.target.value }))}
                          placeholder={field.placeholder}
                          className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-slate-400"
                        />
                      )}
                      <p className="text-xs text-slate-400">
                        {field.helpText}
                        {field.docUrl && (
                          <> — <a href={field.docUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-violet-600 underline-offset-2 hover:underline">{field.docLabel}</a></>
                        )}
                      </p>
                    </label>
                  ))}
                </div>
              </form>
            </div>

            {/* Footer */}
            <div className="shrink-0 space-y-3 border-t border-slate-200 px-6 py-4">
              {saveError && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-xs text-red-600">{saveError}</p>}
              {saveSuccess && (
                <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-xs text-emerald-700">
                  <CheckCircle size={13} /> {saveSuccess}
                </p>
              )}
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setActiveId(null); setSaveError(null); setSaveSuccess(null); }}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="integration-form"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {saving && <Loader2 size={13} className="animate-spin" />}
                  {saving ? 'Saving…' : 'Save configuration'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminIntegrationsManagement;
