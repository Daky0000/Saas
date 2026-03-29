# Dakyworld SaaS Platform — Claude Project Reference

> Paste this entire file into your Claude Project's "Project Knowledge" to give Claude full context about this codebase.

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ Done | Feature is fully implemented, end-to-end, and working in production |
| 🟡 Partial | Core functionality works but missing pieces (noted inline) |
| ❌ Stub | UI/routes exist but actual processing is not implemented |
| 🔲 Planned | Not yet started |

---

## Feature Status Overview

| Feature | Status | Notes |
|---------|--------|-------|
| Auth (login/signup/JWT) | ✅ Done | Email + OAuth, 7d/24h tokens, auto-logout on 401 |
| OAuth account connection | ✅ Done | Facebook, Instagram, X, LinkedIn, Pinterest, TikTok all connect |
| Post scheduling & publishing | ✅ Done | Facebook, Instagram, X, LinkedIn, Pinterest publish; TikTok connect-only |
| Post Automation (recurring posts) | ✅ Done | BullMQ-backed recurring rules per account |
| Batch post operations | ✅ Done | Reschedule, tag, archive, delete, duplicate, export, platform change |
| Card / Graphic Builder | 🟡 Partial | Full builder works; known export JSON bug fixed; preview image not saved to media library |
| Admin card templates | 🟡 Partial | AdminFabricBuilder works; JSON import/export works; silent publish error fixed |
| Media Library | ✅ Done | Upload, search, tag, audit log, bulk delete |
| Integrations page | ✅ Done | Connect/disconnect all platforms + WordPress + Mailchimp |
| WordPress integration | ✅ Done | Connect, publish posts, upload media, webhook support |
| Mailchimp integration | 🟡 Partial | API key connect/disconnect works; actual contact/campaign sync not implemented |
| Mailing (Email CRM) | 🟡 Partial | Contacts, segments, campaigns, automations UI + DB fully built; **actual email sending not implemented** (no SMTP/SendGrid/Resend wired up) |
| Mailing analytics | 🟡 Partial | Analytics endpoint reads `mailing_email_events` table but nothing writes events yet (all rates show 0) |
| Campaign & Funnel Builder | ✅ Done | Full atomic creation, funnels, UTM links, attribution, background jobs |
| UTM click tracking | ✅ Done | `/r/:shortCode` redirect + `POST /api/track/click` event recording |
| Analytics dashboard | ✅ Done | Fixed — real data from `publishing_logs`, KPIs, trend, platform breakdown, top posts |
| Analytics export | ✅ Done | CSV/JSON export endpoint working |
| Dashboard (home) | ✅ Done | KPI overview, recent posts, quick actions |
| Pricing page (public + internal) | ✅ Done | Plans displayed correctly; upgrade CTA present |
| Payments (Hubtel) | 🟡 Partial | Initiate + callback routes exist; requires `HUBTEL_CLIENT_ID/SECRET/MERCHANT_ACCOUNT_NUMBER` env vars — no auto-plan-upgrade after payment |
| Admin: User management | ✅ Done | List, create, edit, delete, status/role change |
| Admin: Cards management | ✅ Done | Template CRUD + JSON import/export |
| Admin: Media management | ✅ Done | Gallery, storage stats, bulk ops |
| Admin: Pages CMS | ✅ Done | Edit public page content via JSONB store |
| Admin: Pricing management | ✅ Done | Plan CRUD, discount/sale toggle |
| Admin: Payment viewer | 🟡 Partial | Table UI exists; data only appears when Hubtel is configured |
| Admin: Platform Settings tab | ❌ Stub | "Coming soon" placeholder in `Admin.tsx:264` |
| Admin: Audit Log tab | ❌ Stub | "Coming soon" placeholder in `Admin.tsx:269` |
| TikTok publishing | ❌ Stub | OAuth connect works; no content publish endpoint implemented |
| Profile / Settings | ✅ Done | Name, avatar, password change |
| Public landing page | ✅ Done | Hero, features, pricing preview, animations |
| Public tools page | ✅ Done | Static tools listing |
| Privacy / Terms pages | ✅ Done | Static legal pages |
| Meta GDPR data deletion | ✅ Done | Data deletion request handling + status page |

---

## What This Project Is

A **multi-feature social media & content management SaaS** built for agencies and creators. Users connect their social accounts, write and schedule posts, manage email campaigns, build marketing campaign funnels, design graphics, and track analytics — all from one dashboard.

The product is live at a single Railway-hosted deployment: the same Node process serves the React SPA and all API routes.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Routing | Custom `pushState` SPA (no React Router) — `src/App.tsx` |
| Backend | Express 5 — entire backend is `server.ts` (monolithic) |
| Database | PostgreSQL via `pg` pool |
| Queue | BullMQ + IORedis (graceful no-op when `REDIS_URL` is absent) |
| Auth | JWT (7d email/password, 24h OAuth) + `requireAuth()` middleware |
| Canvas | Fabric.js v5 (card/graphic builder) |
| Charts | Recharts v2 |
| Rich text | Tiptap |
| Image export | html2canvas |
| Deployment | Railway.app — `tsx server.ts` start command |

---

## Repository Layout

```
d:\Saas\
├── server.ts              # Entire Express backend (DB init, all routes, auth, queues)
├── src/
│   ├── App.tsx            # SPA shell: routing, auth gate, global fetch interceptor
│   ├── pages/             # One file per page/feature (see Pages section)
│   ├── components/        # Reusable UI components (see Components section)
│   ├── services/          # API client functions per feature (see Services section)
│   └── utils/
│       └── apiBase.ts     # API_BASE_URL — switches prod vs. dev
├── docs/                  # GitHub Pages build output (mirrors dist/)
├── dist/                  # Vite build output
└── railway.json           # Deploy config
```

---

## Routing System

**No React Router.** The SPA uses `window.history.pushState` managed in `src/App.tsx`.

```typescript
// Page enum
type PageType = 'dashboard' | 'posts' | 'post-automation' | 'cards' |
  'pricing' | 'admin' | 'analytics' | 'profile' | 'media' |
  'integrations' | 'mailing' | 'campaign';

// Path map
PAGE_PATHS = {
  dashboard:       '/dashboard',
  posts:           '/posts',
  'post-automation': '/posts/automation',
  cards:           '/cards',
  pricing:         '/pricing',
  admin:           '/admin/users',
  analytics:       '/analytics',
  profile:         '/profile',
  media:           '/media',
  integrations:    '/integrations',
  mailing:         '/mailing',
  campaign:        '/campaign',
}
```

**Public routes** (no auth required): `/`, `/login`, `/tools`, `/pricing`, `/privacy`, `/terms`

`/pricing` renders `PublicPricing` when unauthenticated, internal `Pricing` when authenticated.

Admin tabs live under `/admin/*` and are only rendered when `authUser.role === 'admin'`.

---

## Pages (`src/pages/`)

| File | Route | Status | What it does |
|------|-------|--------|--------------|
| `Landing.tsx` | `/` | ✅ | Public homepage with hero, features, pricing preview, animations |
| `Auth.tsx` | `/login` | ✅ | Login + signup with email/password and OAuth buttons |
| `Dashboard.tsx` | `/dashboard` | ✅ | Overview KPIs, recent posts, quick-action shortcuts |
| `Posts.tsx` | `/posts` | ✅ | Content calendar — list, schedule, publish, reschedule, batch-action posts |
| `PostAutomation.tsx` | `/posts/automation` | ✅ | Set up recurring post rules (daily/weekly/monthly schedules per account) |
| `Cards.tsx` | `/cards` | 🟡 | Template gallery + Fabric.js builder; preview image not saved to media library |
| `Media.tsx` | `/media` | ✅ | Image library — upload, search, tag, audit usage across posts and designs |
| `Integrations.tsx` | `/integrations` | 🟡 | Connect/disconnect platforms; TikTok + Mailchimp connect only (no sync) |
| `Mailing.tsx` | `/mailing` | 🟡 | Full CRM UI — contacts, segments, campaigns, automations; no email sending engine |
| `Campaign.tsx` | `/campaign` | ✅ | Multi-channel campaign builder, funnels, UTM links, performance charts |
| `Analytics.tsx` | `/analytics` | ✅ | Analytics dashboard — KPIs, trend charts, platform breakdown, top posts, AI insights |
| `Pricing.tsx` | `/pricing` | 🟡 | Shows plans; upgrade button present but no plan enforcement after payment |
| `PublicPricing.tsx` | `/pricing` (unauth) | ✅ | Public-facing pricing page with feature comparison |
| `Profile.tsx` | `/profile` | ✅ | Account settings — name, avatar, password |
| `Admin.tsx` | `/admin/*` | 🟡 | Admin panel; Platform Settings + Audit Log tabs are "coming soon" stubs |
| `Tools.tsx` | `/tools` | ✅ | Public tools/utilities page |
| `PrivacyPolicy.tsx` | `/privacy` | ✅ | Static privacy policy |
| `TermsOfService.tsx` | `/terms` | ✅ | Static terms of service |
| `DataDeletion.tsx` | `/data-deletion` | ✅ | Meta (Facebook) GDPR data deletion status page |
| `OAuthCallback.tsx` | `/oauth/callback` | ✅ | Handles OAuth redirect, exchanges code for token, closes popup |

---

## Components (`src/components/`)

### Top-level standalone components
- `PostEditor.tsx` — Full rich-text post editor with platform preview, SEO score, media attach, schedule picker
- `RichTextEditor.tsx` — Tiptap-based editor wrapper (used in PostEditor and blog posts)
- `MediaManager.tsx` — Reusable media picker/uploader modal
- `DraftManager.tsx` — Draft save/restore UI
- `SeoScoreBadge.tsx` — Real-time SEO score indicator
- `StyleAssetPicker.tsx` — Font and style selector
- `PlatformLogo.tsx` — Platform icon renderer (Facebook, Instagram, etc.)
- `ErrorBoundary.tsx` — React error boundary wrapper

### `admin/`
- `UserManagementPage.tsx` + `UserTable.tsx` + `UserRow.tsx` + `UserSearch.tsx` + `UserFilters.tsx` + `Pagination.tsx` — Full admin user management UI
- `AddUserModal.tsx` + `EditUserModal.tsx` + `UserProfilePanel.tsx` — User CRUD modals
- `AdminCardsManagement.tsx` — Admin card template management with JSON import/export
- `AdminFabricBuilder.tsx` — Admin-side Fabric.js canvas builder for creating templates
- `AdminIntegrations.tsx` — Admin OAuth credentials management
- `AdminMediaManagement.tsx` — Admin media library with bulk ops and storage stats
- `AdminPagesManagement.tsx` — CMS for editing public page content
- `PricingManagement.tsx` — Admin pricing plan CRUD
- `PaymentManagement.tsx` — Admin payment transaction viewer
- `BulkActionsToolbar.tsx` — Reusable multi-select action toolbar

### `cards/` — Card/Graphic Builder
- `builder/CardBuilderModal.tsx` — Full-screen Fabric.js builder modal (main entry point)
- `builder/ElementsPanel.tsx` — Left sidebar: add text, shapes, images
- `builder/PropertiesPanel.tsx` — Right sidebar: position, size, font, color, stroke
- `builder/canvasPresets.ts` — Canvas size presets (Instagram, Facebook, Twitter, LinkedIn, TikTok, Custom)
- `CardElement.tsx` / `CardPreviewCanvas.tsx` — Card display components
- `ColorPicker.tsx` / `ColorPickerField.tsx` / `GradientPickerField.tsx` — Color UI

### `posts/`
- `PlatformPreviewTabs.tsx` + `PlatformMockup.tsx` — Live preview of post per platform
- `SuggestionsPanel.tsx` — AI-style content suggestions
- `ConstraintsSummary.tsx` — Per-platform character/media limits summary
- `batch/` — Batch reschedule, tag, archive, delete, duplicate, platform-change, export modals
- `mockups/` — Per-platform UI mockups (Facebook, Instagram, Twitter, LinkedIn)

### `analytics/`
- `KpiCard.tsx` — Single metric card with trend %
- `TrendChart.tsx` — Line/area chart for metrics over time
- `PlatformBreakdown.tsx` — Donut or bar chart per platform
- `TopPostsTable.tsx` — Ranked post performance table
- `InsightsPanel.tsx` — AI-generated insights panel
- `analyticsUtils.ts` — Date formatting, metric normalization helpers

### `landing/`
- `PublicNav.tsx` — Shared nav for all public pages
- `PublicFooter.tsx` — Shared footer for all public pages

### `calendar/` — Post Calendar View
- Calendar grid component for scheduling view in Posts page

### `media/` — Media Library Sub-components
- Upload zone, grid view, detail panel, audit log viewer

---

## Services (`src/services/`)

Each service is a typed API client calling the Express backend.

| File | What it wraps |
|------|--------------|
| `blogService.ts` | Blog posts CRUD, batch operations (reschedule/tag/archive/delete/duplicate/export), categories, tags |
| `blogAnalyticsService.ts` | Analytics dashboard, refresh, export — calls `/api/blog/analytics/*` |
| `socialPostService.ts` | Social post scheduling, publishing, automation settings, publishing logs |
| `calendarService.ts` | Calendar view data — scheduled posts by date range |
| `campaignService.ts` | Campaign CRUD, channels, funnels, funnel steps, UTM links, metrics, `createCampaignAtomic()` |
| `mailingService.ts` | Email contacts, segments, campaigns, automations, analytics |
| `mediaService.ts` | Image upload, library management, bulk delete, audit log |
| `integrationService.ts` | Social account connections, OAuth flow initiation, disconnect |
| `cardTemplateService.ts` | Card template CRUD, JSON import/export |
| `designService.ts` | User design (canvas) save/load/delete |
| `wordpressService.ts` | WordPress connect/disconnect, post publish, categories, tags, media upload |
| `pricingService.ts` | Pricing plan listing and admin CRUD |
| `adminUserService.ts` | Admin user management (list, create, update, delete, status/role change) |
| `pageContentService.ts` | CMS page content get/update |
| `linkMetadataService.ts` | Fetch Open Graph metadata from URLs |

---

## Backend API Route Groups (server.ts)

All routes in one file. `requireAuth()` middleware guards all authenticated routes.

| Route Group | Endpoints | Description |
|-------------|-----------|-------------|
| `/api/auth/*` | register, login, me, profile | JWT auth, user profile |
| `/api/oauth/*` + `/oauth/callback/*` | state, callback per platform | OAuth 2.0 flow for all social platforms |
| `/api/social-accounts` | list, delete | Connected social accounts registry |
| `/api/blog/posts/*` | CRUD, duplicate, batch ops, export | Main content/post management |
| `/api/blog/analytics/*` | dashboard, refresh, export | Content performance analytics |
| `/api/blog/categories/*` + `/api/blog/tags/*` | CRUD | Post taxonomy |
| `/api/social/*` | publish, logs, automation, targets | Social publishing engine |
| `/api/distribution/*` | publish multi-platform, status | Simultaneous multi-channel publish |
| `/api/media/*` | upload, list, update, delete, bulk, audit | Media library |
| `/api/wordpress/*` | connect, publish, media, webhook | WordPress integration |
| `/api/integrations/*` + `/api/user-integrations/*` | connect, disconnect, status | Third-party tool integrations |
| `/api/mailing/*` | contacts, segments, campaigns, automations, analytics | Email marketing |
| `/api/campaign/*` | campaigns, channels, funnels, steps, UTM links, metrics | Campaign & funnel builder |
| `/api/track/*` + `/r/:shortCode` | click track, event track, short link redirect | UTM attribution tracking |
| `/api/pricing/*` | plans list, admin CRUD | SaaS pricing tiers |
| `/api/link-metadata` | fetch OG data | URL preview metadata |
| `/api/user-settings/*` | get/put | Key-value user preferences |
| `/api/users/*` | list, CRUD, status, role | Admin user management |
| `/api/admin/media/*` | list, stats, delete, category | Admin media management |
| `/api/meta/*` + `/webhooks/meta` | data deletion, deauth, webhook | Meta (Facebook) compliance |
| `/api/page-content/*` | get, update | Public page CMS |
| `/health` + `/api/health` | — | Health checks |

---

## Database Tables (Key Ones)

| Table | Purpose |
|-------|---------|
| `users` | Accounts — email, password hash, username, role (user/admin), avatar, cover |
| `social_accounts` | Connected platform accounts — tokens, platform type, profile vs page, handle |
| `oauth_states` | Temp OAuth state tokens (15 min TTL) |
| `user_integrations` | WordPress credentials, Mailchimp API key, etc. |
| `blog_posts` | Content posts — title, body, SEO fields, status, scheduled_at, featured image |
| `blog_categories` / `blog_tags` / `blog_post_tags` | Post taxonomy |
| `social_post_settings` | Per-post social publishing config (accounts, schedule, template) |
| `social_post_targets` | Which social accounts to publish each post to |
| `publishing_logs` | Publishing attempt audit trail — status, error, posted_at |
| `social_metrics` | Per-post platform metrics (likes, clicks, impressions) |
| `account_metrics` | Per-account daily metrics snapshots |
| `insights_cache` | Cached AI-generated analytics insights |
| `campaigns` | Marketing campaigns — goal, budget, dates, status, attribution model |
| `campaign_channels` | Which social channels a campaign targets |
| `funnels` / `funnel_steps` | Conversion funnel definitions |
| `funnel_events` | Raw funnel event tracking |
| `utm_links` | Generated UTM tracking URLs with short codes + click/conversion counts |
| `campaign_jobs` | Background job records per campaign (analytics_init, attribution_init) |
| `campaign_attribution` | Click → conversion attribution events |
| `mailing_contacts` | Email subscriber list — email, name, consent, tags |
| `mailing_segments` | Contact segments with filter rules |
| `mailing_campaigns` | Email campaigns — subject, content, segment, status, sent_at |
| `mailing_automations` | Triggered email sequences |
| `media_images` | Uploaded images — S3/local path, dimensions, alt, tags |
| `card_templates` | Admin-created design templates (Fabric.js JSON) |
| `user_designs` | User-saved canvas designs (Fabric.js JSON) |
| `pricing_plans` | SaaS tiers — price, period, features array, sale status |
| `payment_transactions` | Hubtel payment records (GHS currency) |
| `page_content` | JSONB CMS content for public pages |
| `data_deletion_requests` | Meta GDPR data deletion tracking |

---

## Feature Deep-Dives

### Card / Graphic Builder — 🟡 Partial
- Full-screen Fabric.js v5 canvas — launched from `Cards.tsx`
- Supports: IText, Rectangle, Ellipse, Line, Image upload
- Properties panel: x/y/w/h, rotation, opacity, font family/size/weight, fill, stroke
- Undo/redo: JSON snapshot stack (max 60 states)
- Keyboard shortcuts: Ctrl+Z/Y (undo/redo), Ctrl+S (save), Ctrl+D (duplicate), Delete, Arrow nudge
- Export: PNG/JPG via `canvas.toDataURL` with resolution multiplier
- Saves to `user_designs` via `designService`
- Admin version (`AdminFabricBuilder`) creates public `card_templates`
- JSON import/export format: `[{ name, description, designData: { fabricVersion: true, ... } }]`
- **Known gap**: Preview image uploaded in `AdminFabricBuilder` is NOT saved to the media library (`mediaService.upload()` not called after resize)

### Post Scheduling & Publishing — ✅ Done
- Posts created in `PostEditor` with Tiptap rich text + platform previews
- Each post can target multiple social accounts simultaneously
- Scheduling via `publishing_logs` + BullMQ `social-publish` queue
- Batch operations: reschedule, tag, archive, delete, duplicate, platform-change, CSV/JSON export
- WordPress integration: publish blog posts to self-hosted WP sites via REST API
- Automation rules: recurring posts on daily/weekly/monthly schedules
- **Platform support**: Facebook ✅, Instagram ✅, X/Twitter ✅, LinkedIn ✅, Pinterest ✅ (requires board selected), TikTok ❌ (OAuth only, no publish)

### Campaign & Funnel Builder — ✅ Done
- Multi-channel campaign wizard (4 steps: Goal → Channels → UTM Links → Review)
- Atomic creation: `POST /api/campaign/campaigns/create` — single PostgreSQL transaction (campaign + channels + 4-step AIDA funnel + UTM links + jobs)
- Launch shows 6-step animated progress indicator in the wizard
- Funnels: default 4 steps (Impression → Click → Lead → Conversion), customizable
- UTM links: auto-generated per channel, short code redirect at `/r/:shortCode`
- Attribution: first-touch / last-touch models tracked in `campaign_attribution`
- Metrics tab: click-through rates, conversion rates, funnel drop-off bar chart
- **Known gap**: Campaign Metrics tab shows aggregated DB counts but no real-time platform data sync

### Email Marketing (Mailing) — 🟡 Partial
- Contacts with tags, consent tracking, import CSV/export — **✅ working**
- Segments with filter rules — **✅ working** (rules stored as JSONB; filter is manual, not auto-applied)
- Campaigns: subject, HTML content, segment targeting, status (draft/scheduled/sent) — **✅ DB + UI done**
- Automations: trigger-based email sequences — **✅ DB + UI done**
- Analytics: reads `mailing_email_events` table for open/click/bounce rates — **✅ endpoint done**
- **Critical gap: No email sending engine.** No SMTP, SendGrid, Resend, or SES is wired up. Campaigns can be created and scheduled but emails are never actually sent. The `mailing_email_events` table is never written to, so all analytics rates show 0.

### Analytics — ✅ Done
- Blog/content analytics via `blogAnalyticsService` → `/api/blog/analytics/dashboard`
- KPIs: total posts, published, reach, impressions, engagement
- Trend chart (7/14/30 day), platform breakdown, top posts by performance
- AI-generated insights panel (`InsightsPanel` component)
- Export to CSV/JSON via `/api/blog/analytics/export`
- `social_metrics` + `account_metrics` tables store per-post platform metrics
- `insights_cache` stores generated insights with TTL
- **Note**: Was broken (500 error) due to missing `posted_at` column — fixed in commit `5a4f8684`

### Admin Panel — 🟡 Partial
- User management (list, create, edit, deactivate, role change) — **✅**
- Card template management (Fabric.js admin builder + JSON import/export) — **✅**
- Media management with storage stats — **✅**
- Public pages CMS (edit Landing, Tools, Pricing page content) — **✅**
- Pricing plan management — **✅**
- Payment transaction viewer (data only shows when Hubtel is configured) — **🟡**
- OAuth integration credentials manager — **✅**
- Platform Settings tab — **❌ "coming soon" stub**
- Audit Log tab — **❌ "coming soon" stub** (the `audit_logs` table exists but is not read/displayed)

### Integrations — 🟡 Partial
- Facebook: OAuth, pages, publish, webhooks, page insights — **✅**
- Instagram: OAuth, business accounts, media publish, engagement metrics — **✅**
- X (Twitter): OAuth 2.0 + PKCE, tweet creation, media upload, analytics — **✅** (media.write scope intentionally excluded)
- LinkedIn: OAuth, personal + org profiles, post analytics, token refresh — **✅**
- Pinterest: OAuth, boards list, pin creation (requires board selected) — **✅**
- TikTok: OAuth connect + domain verification file — **🟡** (connect only, no content publishing)
- WordPress: REST API + XML-RPC, post/media/webhook management — **✅**
- Mailchimp: API key auth, connect/disconnect — **🟡** (connection stored but no contact/campaign sync actually implemented)

### Payments — 🟡 Partial
- Hubtel payment initiation (`POST /api/payments/hubtel/initiate`) — **✅ endpoint built**
- Hubtel callback + status check — **✅ endpoint built**
- Requires env vars: `HUBTEL_CLIENT_ID`, `HUBTEL_CLIENT_SECRET`, `HUBTEL_MERCHANT_ACCOUNT_NUMBER`
- **Gap**: After a successful payment, there is no logic to upgrade the user's plan or grant features. `inMemoryPaymentTransactions` used as fallback when DB insert fails.
- **Gap**: No subscription management — plans are informational only, no plan enforcement on features

---

## Auth & Token Management

- JWT stored in `localStorage` as `auth_token`
- Token lifetime: 7 days (email/password), 24 hours (OAuth)
- `JWT_SECRET` generated once via `render.yaml` `generateValue: true`, persists across deploys
- `force_auth_reset_v{N}` versioned key in localStorage — bump `N` on deploys that change JWT behavior to force re-login
- Global `fetch` interceptor in `App.tsx` auto-logs out on any `/api/` 401 response
- Admin access: `requireAuth()` + `role === 'admin'` check per admin route

---

## Branding

- Primary color: `#5b6cf9` (blue-indigo)
- Font: Inter, `font-black` for headings
- Design language: Linear.app-inspired — clean, light theme, rounded corners, minimal shadows
- All public pages share `PublicNav` + `PublicFooter`

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis for BullMQ (optional — queues degrade gracefully without it) |
| `JWT_SECRET` | JWT signing key |
| `INTEGRATIONS_ENCRYPTION_KEY` | AES key for encrypting stored OAuth tokens |
| `VITE_API_BASE_URL` | Frontend API base URL (points to same Railway service) |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Facebook/Meta OAuth app |
| `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` | Instagram OAuth app |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth app |
| `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` | X/Twitter OAuth 2.0 app |
| `PINTEREST_APP_ID` / `PINTEREST_APP_SECRET` | Pinterest OAuth app |
| `META_WEBHOOK_VERIFY_TOKEN` | Facebook webhook verification token |
| `PORT` | Server port (default 5000) |

---

## Key Conventions

- **DB migrations are additive-only**: `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS` — no destructive migrations
- **Single-file backend**: all routes, DB init, and queues live in `server.ts` — when adding features, append to this file
- **Service pattern**: frontend never calls `fetch` directly — all API calls go through a service in `src/services/`
- **No React Router**: to navigate, call `window.history.pushState({}, '', PAGE_PATHS.x)` then dispatch a `popstate` event, or use the `navigate()` helper in `App.tsx`
- **BullMQ graceful degradation**: queue operations check if Redis is available; if not, they run inline synchronously
- **Atomic transactions**: multi-step creation flows use `BEGIN/COMMIT/ROLLBACK` PostgreSQL client transactions to avoid orphaned data
