import { useMemo } from 'react';
import { ExternalLink, ShieldCheck, Wrench, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

type DocLink = { label: string; href: string; note?: string };

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-[32px] border border-slate-200 bg-white p-6 md:p-8">
    <h2 className="text-xl font-black tracking-[-0.02em] text-slate-950">{title}</h2>
    <div className="mt-4 space-y-4 text-sm leading-6 text-slate-600">{children}</div>
  </section>
);

const LinkList = ({ links }: { links: DocLink[] }) => (
  <div className="grid gap-2 sm:grid-cols-2">
    {links.map((l) => (
      <a
        key={l.href}
        href={l.href}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 hover:bg-white transition-colors"
      >
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900">{l.label}</div>
          {l.note && <div className="mt-0.5 text-xs text-slate-500">{l.note}</div>}
        </div>
        <ExternalLink size={16} className="mt-0.5 shrink-0 text-slate-400 group-hover:text-slate-700" />
      </a>
    ))}
  </div>
);

const InlineCode = ({ children }: { children: string }) => (
  <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[12px] text-slate-800">
    {children}
  </span>
);

const Bullet = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
  <div className="flex items-start gap-3">
    <div className="mt-0.5 shrink-0 text-slate-400">{icon}</div>
    <div className="min-w-0">{children}</div>
  </div>
);

export default function Instructions() {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://yourdomain.com';

  const callbackUrls = useMemo(() => ({
    facebook: `${origin}/auth/facebook/callback`,
    instagram: `${origin}/auth/instagram/callback`,
    threads: `${origin}/auth/threads/callback`,
  }), [origin]);

  const metaDocs: DocLink[] = [
    { label: 'Meta for Developers', href: 'https://developers.facebook.com/', note: 'Official documentation hub.' },
    { label: 'Facebook Login', href: 'https://developers.facebook.com/docs/facebook-login/', note: 'OAuth setup and permissions.' },
    { label: 'Instagram Basic Display', href: 'https://developers.facebook.com/docs/instagram-basic-display-api/', note: 'Instagram OAuth + user media scopes.' },
    { label: 'Instagram API (Graph)', href: 'https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api', note: 'Official Meta Postman workspace (Graph endpoints).' },
    { label: 'Threads API (Postman)', href: 'https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api', note: 'Official Meta Postman workspace (OAuth + publish).' },
    { label: 'Access Token Debugger', href: 'https://developers.facebook.com/tools/debug/accesstoken/', note: 'See token type, scopes, expiry.' },
    { label: 'App Review', href: 'https://developers.facebook.com/docs/app-review/', note: 'Request Advanced Access for permissions.' },
  ];

  return (
    <div className="space-y-6 pb-8">
      <div className="rounded-[32px] border border-slate-200 bg-white px-6 py-6 md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-[2.2rem] font-black tracking-[-0.03em] text-slate-950">Instructions</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500 md:text-base">
              Step-by-step Meta setup from a fresh start. Follow this to configure Facebook, Instagram, and Threads so users can connect accounts from Integrations and Automation.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <div className="font-bold text-slate-800">Your callback URLs</div>
            <div className="mt-2 space-y-1">
              <div>Facebook: <InlineCode>{callbackUrls.facebook}</InlineCode></div>
              <div>Instagram: <InlineCode>{callbackUrls.instagram}</InlineCode></div>
              <div>Threads: <InlineCode>{callbackUrls.threads}</InlineCode></div>
            </div>
          </div>
        </div>
      </div>

      <Section title="1) What You Need Before You Start">
        <Bullet icon={<CheckCircle2 size={16} />}>
          A public domain with HTTPS (Meta requires valid redirect URIs). Use the same domain as your app is running on.
        </Bullet>
        <Bullet icon={<CheckCircle2 size={16} />}>
          A Meta Developer account and access to Meta Business Manager (recommended if you will request advanced permissions).
        </Bullet>
        <Bullet icon={<ShieldCheck size={16} />}>
          A Privacy Policy URL and Terms URL on your site. Meta frequently requires these when moving apps to Live mode and for App Review.
        </Bullet>
        <Bullet icon={<CheckCircle2 size={16} />}>
          A working production URL for your app (Meta redirects to <InlineCode>/auth/&lt;provider&gt;/callback</InlineCode>, then we exchange the code on the backend).
        </Bullet>
        <Bullet icon={<AlertTriangle size={16} />}>
          If you are using a new Meta app: keep it in Development mode while testing with test users/admin roles. Switch to Live mode only after you are ready.
        </Bullet>
      </Section>

      <Section title="2) Decide What You’re Enabling (So You Request the Right Access)">
        <Bullet icon={<Info size={16} />}>
          Meta permissions are strict. Only enable what you plan to use, then request Advanced Access for those permissions during App Review.
        </Bullet>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-black text-slate-900">Facebook Pages</div>
            <div className="mt-1 text-sm text-slate-600">Connect a Facebook user and publish/manage content on Pages they manage.</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-black text-slate-900">Instagram</div>
            <div className="mt-1 text-sm text-slate-600">Connect via Instagram OAuth (Basic Display) to read profile + user media.</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-black text-slate-900">Threads</div>
            <div className="mt-1 text-sm text-slate-600">Connect a Threads user to publish on their behalf (requires Threads use case).</div>
          </div>
        </div>
      </Section>

      <Section title="3) Create Your Meta App (Fresh Start)">
        <Bullet icon={<Info size={16} />}>
          In Meta for Developers, create a new app for your workspace. Give it a clear name like <InlineCode>ContentFlow</InlineCode> or <InlineCode>Dakyworld Hub</InlineCode>.
        </Bullet>
        <Bullet icon={<Wrench size={16} />}>
          If you want Threads, create the app with the <strong>Threads use case</strong> (Meta requires this for Threads OAuth and API access).
        </Bullet>
        <Bullet icon={<Wrench size={16} />}>
          Add products for the platforms you want:
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"><strong>Facebook Login</strong><div className="text-xs text-slate-500">Required for Facebook OAuth.</div></div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"><strong>Instagram Basic Display</strong><div className="text-xs text-slate-500">Instagram OAuth (user_profile + user_media).</div></div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"><strong>Threads API</strong><div className="text-xs text-slate-500">Threads OAuth + publish permissions.</div></div>
          </div>
        </Bullet>
        <Bullet icon={<ShieldCheck size={16} />}>
          In <strong>App settings → Basic</strong> (names vary slightly by UI), fill out:
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-sm font-bold text-slate-900">App domains</div>
              <div className="mt-1 text-xs text-slate-500">Add your domain (no protocol), e.g. <InlineCode>yourdomain.com</InlineCode></div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-sm font-bold text-slate-900">Privacy Policy + Terms</div>
              <div className="mt-1 text-xs text-slate-500">Use your site’s URLs (required for Live/App Review).</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:col-span-2">
              <div className="text-sm font-bold text-slate-900">Contact email</div>
              <div className="mt-1 text-xs text-slate-500">Use an address you can receive Meta review emails on.</div>
            </div>
          </div>
        </Bullet>
      </Section>

      <Section title="4) Configure OAuth Redirect URIs (Critical)">
        <Bullet icon={<AlertTriangle size={16} />}>
          The Redirect URI in Meta must match <strong>exactly</strong> what you saved in the Admin Integrations configuration for each platform (character-for-character).
        </Bullet>
        <Bullet icon={<CheckCircle2 size={16} />}>
          Use these callback URLs (shown at the top of this page) and register them in the relevant product settings:
          <div className="mt-2 space-y-2 text-sm text-slate-600">
            <div><strong>Facebook</strong>: Facebook Login → Settings → <em>Valid OAuth Redirect URIs</em></div>
            <div><strong>Instagram</strong>: Instagram Basic Display → Settings → <em>Valid OAuth Redirect URIs</em></div>
            <div><strong>Threads</strong>: Threads API → Settings → <em>Redirect Callback URLs</em></div>
          </div>
        </Bullet>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-xs font-bold text-slate-800">Tip</div>
          <div className="mt-1 text-sm text-slate-600">
            If you change domains later, you must update the redirect URI in Meta and in the Admin Integrations config to the new domain.
          </div>
        </div>
      </Section>

      <Section title="5) Configure This App (Inside Your Admin Dashboard)">
        <Bullet icon={<CheckCircle2 size={16} />}>
          Open <strong>Integrations</strong> as an admin and click <strong>Configure App</strong> for:
          <div className="mt-2 text-sm text-slate-600">Facebook, Instagram, Threads</div>
        </Bullet>
        <Bullet icon={<Wrench size={16} />}>
          Paste the following from Meta into each integration:
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-sm font-bold text-slate-900">App ID / Client ID</div>
              <div className="mt-1 text-xs text-slate-500">From your Meta app dashboard.</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-sm font-bold text-slate-900">App Secret / Client Secret</div>
              <div className="mt-1 text-xs text-slate-500">Keep this private. Do not paste into posts/content.</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:col-span-2">
              <div className="text-sm font-bold text-slate-900">Redirect URI</div>
              <div className="mt-1 text-xs text-slate-500">Must match what you configured in Meta (see section 3).</div>
            </div>
          </div>
        </Bullet>
        <Bullet icon={<AlertTriangle size={16} />}>
          If you previously configured wrong values, use the <strong>Reset config</strong> button (admin-only) in the Integrations configure modal, then re-enter clean credentials.
        </Bullet>
      </Section>

      <Section title="6) Development vs Live Mode (Testing Properly)">
        <Bullet icon={<Info size={16} />}>
          In Development mode, only users with a role on the Meta app (Admins/Developers/Testers) can authenticate successfully.
        </Bullet>
        <Bullet icon={<CheckCircle2 size={16} />}>
          For testing, add your own Meta account as an app Admin/Tester and connect from our Integrations page. Once stable, switch your Meta app to Live mode to allow normal user accounts to connect.
        </Bullet>
        <Bullet icon={<AlertTriangle size={16} />}>
          Some permissions require App Review and (sometimes) Business Verification before they work for general users.
        </Bullet>
      </Section>

      <Section title="7) Permissions Checklist (What You’ll Commonly Need)">
        <Bullet icon={<Info size={16} />}>
          You may see “Standard Access” and “Advanced Access”. For production, publishing-related permissions usually require Advanced Access + review.
        </Bullet>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-black text-slate-900">Facebook Pages</div>
            <div className="mt-2 space-y-1 text-sm text-slate-600">
              <div><InlineCode>pages_manage_posts</InlineCode></div>
              <div><InlineCode>pages_read_engagement</InlineCode></div>
              <div><InlineCode>pages_show_list</InlineCode></div>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-black text-slate-900">Instagram Basic Display</div>
            <div className="mt-2 space-y-1 text-sm text-slate-600">
              <div><InlineCode>user_profile</InlineCode></div>
              <div><InlineCode>user_media</InlineCode></div>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-black text-slate-900">Threads</div>
            <div className="mt-2 space-y-1 text-sm text-slate-600">
              <div><InlineCode>threads_basic</InlineCode></div>
              <div><InlineCode>threads_content_publish</InlineCode></div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="8) Common Errors and What They Mean">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-black text-slate-900">“Redirect URI mismatch”</div>
            <div className="mt-1 text-sm text-slate-600">
              The callback URL saved in Meta does not exactly match what the app is using. Re-check section 3.
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-black text-slate-900">“Platform credentials not configured by admin”</div>
            <div className="mt-1 text-sm text-slate-600">
              Admin has not saved App ID/Secret/Redirect URI for that platform. Configure it under Integrations.
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-black text-slate-900">Login works for you but not for other users</div>
            <div className="mt-1 text-sm text-slate-600">
              Your Meta app is likely still in Development mode, or required permissions are not approved for public use.
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-black text-slate-900">“Invalid server response … &lt;!DOCTYPE html&gt;”</div>
            <div className="mt-1 text-sm text-slate-600">
              The backend returned an HTML error page. Check server logs and confirm API routes are reachable (and not being redirected by hosting).
            </div>
          </div>
        </div>
      </Section>

      <Section title="Meta Documentation Links">
        <p className="text-sm text-slate-500">
          Official links for reference. Use them while configuring your Meta app.
        </p>
        <LinkList links={metaDocs} />
      </Section>
    </div>
  );
}
