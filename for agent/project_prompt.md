# Project Prompt: Contentflow / Dakyworld Hub

You are a full-stack engineer helping on a SaaS called Contentflow (also branded as Dakyworld Hub). It is a social media and content operations platform that lets teams compose posts, design assets, connect integrations, schedule/publish, and analyze performance. This repo contains a main React + Vite app in `src/`, a root Express API in `server.ts`, plus an additional `backend/` and `frontend/` app that cover integrations, automation, analytics, and a slimmer UI.

Product goals
- Central hub for content creation, scheduling, automation, and distribution.
- Integration management (WordPress, Facebook, Instagram, LinkedIn, X, Pinterest, Mailchimp).
- Media library and card design system.
- Analytics and admin tooling.
- OAuth and API-based connections.

Primary user flows
- Authenticate and land on a dashboard.
- Create posts and schedule or automate publishing.
- Configure automation defaults and review the schedule calendar.
- Connect integrations and choose accounts (for example Facebook Pages or Groups).
- Manage media and design assets for branded posts.
- View analytics and performance trends.
- Admin users manage pricing, users, and integrations.

Tech stack
- Frontend: React 18, TypeScript, Vite, Tailwind CSS, lucide-react, Tiptap, Fabric.js.
- Backend: Node/Express, JWT auth, PostgreSQL via `pg`, Redis/BullMQ for queues, cron jobs.
- Additional backend in `backend/` using Express + Prisma/SQLite and platform adapters.
- Build/deploy: Vite build with static output in `dist/` and `docs/`.

How to run (local)
- `npm run dev` to start the Vite frontend in root.
- `npm run dev:api` or `npm start` for the root API in `server.ts`.
- `backend/src/index.ts` starts a separate API if that stack is used.

Repository map (source and config files). Generated and vendor assets are grouped at the end.

Root files
- `.env` - local environment variables (secrets live here).
- `.env.example` - template of required environment variables.
- `.env.local` - local overrides for development.
- `.env.production` - production defaults for the root app.
- `.gitattributes` - Git attributes such as line endings.
- `.gitignore` - Git ignore rules.
- `.nojekyll` - disables Jekyll on GitHub Pages.
- `404.html` - static 404 page used by static hosting.
- `index.html` - root HTML entry (Vite).
- `index.source.html` - source HTML template used for builds.
- `CNAME` - custom domain for GitHub Pages.
- `metadata.json` - deployment metadata for the static site.
- `package.json` - root dependencies and scripts for the main app.
- `package-lock.json` - dependency lockfile.
- `postcss.config.js` - PostCSS configuration.
- `tailwind.config.js` - Tailwind theme and design tokens.
- `vite.config.ts` - Vite configuration for root app.
- `tsconfig.json` - TypeScript config for root app.
- `tsconfig.node.json` - TypeScript config for tooling.
- `tsconfig.node.tsbuildinfo` - incremental build cache for node TS.
- `tsconfig.tsbuildinfo` - incremental build cache for app TS.
- `server.ts` - main Express API server (auth, integrations, posts, automation, calendar, analytics, etc).
- `server-package.json` - server-only package config (if separated).
- `railway.json` - Railway deployment config.
- `setup.sh` - setup helper script.
- `skills-lock.json` - assistant skill lock file.
- `tmp_find_bom.py` - helper to detect BOM in files.
- `tmp_preview_server.cjs` - preview server helper (CommonJS).
- `tmp_preview_server.js` - preview server helper (ESM).
- `backend.err.log` - backend runtime error log.
- `backend.out.log` - backend runtime output log.
- `dev.err.log` - dev server error log.
- `dev.out.log` - dev server output log.
- `devall.err.log` - combined dev error log.
- `devall.out.log` - combined dev output log.
- `static.err.log` - static server error log.
- `static.out.log` - static server output log.
- `openai.chatgpt-26.304.20706-win32-arm64.vsix` - downloaded VSIX extension.
- `CONNECTS_README.md` - integration connection notes.
- `DELIVERY_COMPLETE.md` - delivery completion checklist.
- `DEPLOYMENT_CHECKLIST.md` - deployment checklist.
- `IMPLEMENTATION_SUMMARY.md` - implementation summary notes.
- `OAUTH_SETUP.md` - OAuth configuration notes.
- `QUICK_START.md` - quick start guide.
- `README.md` - root README (high level overview).
- `README_CONNECTS_COMPLETE.md` - integration setup completion notes.
- `ULTIMATE_LUXURY_BLUEPRINT.md` - strategy/brand blueprint doc.
- `tiktoka4r5jGLRrZEzoPZ1c2IkmhGHOYbDXK1E.txt` - TikTok domain verification.
- `tiktokGuHuKYUdxb13mmRk5PkdrDFlLEBosnIF.txt` - TikTok domain verification.

Scripts
- `scripts/check-dummy-data.cjs` - validates or checks dummy data usage.
- `scripts/clean-temp.mjs` - cleans temp artifacts before builds.
- `scripts/dev.mjs` - dev helper.
- `scripts/set-production-api.mjs` - sets production API base for builds.
- `scripts/sync-pages.mjs` - syncs build output to `docs/` for static hosting.
- `scripts/use-source-index.mjs` - ensures correct index template for builds.

Main frontend (root `src/`)
- `src/App.tsx` - SPA shell, routing, auth gating, navigation, and layout.
- `src/index.css` - global styles and Tailwind layers.
- `src/main.tsx` - Vite entry, renders App and imports styles.
- `src/vite-env.d.ts` - Vite TypeScript environment types.

Root components
- `src/components/AdvancedTemplateCard.tsx` - template card UI for previews.
- `src/components/AdvancedTemplateCardModal.tsx` - modal for viewing/editing templates.
- `src/components/CardDesignAssistant.tsx` - assistant UI for card design.
- `src/components/CardPreview.tsx` - card preview rendering.
- `src/components/CardTemplateLibrary.tsx` - template library UI.
- `src/components/DraftManager.tsx` - draft management UI.
- `src/components/ErrorBoundary.tsx` - React error boundary wrapper.
- `src/components/MediaManager.tsx` - media manager UI.
- `src/components/PostEditor.tsx` - post composition editor.
- `src/components/PrebuiltTemplates.tsx` - prebuilt templates listing.
- `src/components/RichTextEditor.tsx` - rich text editor component.
- `src/components/ScheduleManager.tsx` - scheduling controls UI.
- `src/components/SeoScoreBadge.tsx` - SEO score badge UI.
- `src/components/StyleAssetPicker.tsx` - style asset selection UI.

Admin components
- `src/components/admin/AddUserModal.tsx` - admin add-user modal.
- `src/components/admin/AdminAuthProviders.tsx` - manage auth providers.
- `src/components/admin/AdminCardsManagement.tsx` - manage card templates library.
- `src/components/admin/AdminFabricBuilder.tsx` - admin fabric-based card builder.
- `src/components/admin/AdminIntegrations.tsx` - admin integration config UI.
- `src/components/admin/AdminMediaManagement.tsx` - admin media management UI.
- `src/components/admin/AdminPagesManagement.tsx` - admin marketing pages content UI.
- `src/components/admin/BulkActionsToolbar.tsx` - bulk actions toolbar.
- `src/components/admin/CardBuilder.tsx` - admin card builder wrapper.
- `src/components/admin/EditUserModal.tsx` - admin edit-user modal.
- `src/components/admin/Pagination.tsx` - pagination component.
- `src/components/admin/PaymentManagement.tsx` - payments and billing admin UI.
- `src/components/admin/PricingManagement.tsx` - pricing plan admin UI.
- `src/components/admin/UserFilters.tsx` - filters for user list.
- `src/components/admin/UserManagementPage.tsx` - admin user management page.
- `src/components/admin/UserProfilePanel.tsx` - user profile detail panel.
- `src/components/admin/UserRow.tsx` - row display for users.
- `src/components/admin/UserSearch.tsx` - user search UI.
- `src/components/admin/UserTable.tsx` - user table layout.

Calendar components
- `src/components/calendar/ScheduleCalendar.tsx` - schedule calendar UI for automation tab.

Card builder components
- `src/components/cards/CardElement.tsx` - single card element renderer.
- `src/components/cards/CardPreviewCanvas.tsx` - canvas preview for cards.
- `src/components/cards/ColorPicker.tsx` - color picker control.
- `src/components/cards/ColorPickerField.tsx` - form field wrapper for color picker.
- `src/components/cards/colorUtils.ts` - color utility helpers.
- `src/components/cards/EditorTabs.tsx` - tabs for card editor sections.
- `src/components/cards/GradientPickerField.tsx` - gradient picker field.
- `src/components/cards/SettingsPanel.tsx` - card settings panel.
- `src/components/cards/builder/canvasPresets.ts` - canvas size presets.
- `src/components/cards/builder/CardBuilderModal.tsx` - modal for card builder.
- `src/components/cards/builder/ColorPicker.tsx` - builder-specific color picker.
- `src/components/cards/builder/ElementsPanel.tsx` - elements panel in builder.
- `src/components/cards/builder/FloatingToolbar.tsx` - floating toolbar for builder.
- `src/components/cards/builder/ImageUploadModal.tsx` - image upload modal.
- `src/components/cards/builder/LayersPanel.tsx` - layers list panel.
- `src/components/cards/builder/PropertiesPanel.tsx` - properties panel for selected element.

Landing components
- `src/components/landing/PublicFooter.tsx` - public site footer.
- `src/components/landing/PublicNav.tsx` - public site navigation.

Media components
- `src/components/media/MediaLibraryModal.tsx` - media library modal.

Data and hooks
- `src/data/cardTemplates.ts` - local card template dataset.
- `src/data/sampleFabricTemplates.ts` - sample fabric templates data.
- `src/hooks/useTemplateEditor.tsx` - template editor provider and hook.

Pages
- `src/pages/Admin.tsx` - admin portal shell.
- `src/pages/Analytics.tsx` - analytics dashboard.
- `src/pages/Auth.tsx` - authentication page.
- `src/pages/Cards.tsx` - card design page.
- `src/pages/Dashboard.tsx` - main dashboard for users.
- `src/pages/DataDeletion.tsx` - data deletion request page.
- `src/pages/Integrations.tsx` - integrations catalog, OAuth flows, and account selection.
- `src/pages/Landing.tsx` - public landing page.
- `src/pages/Media.tsx` - media library page.
- `src/pages/OAuthCallback.tsx` - OAuth return handling.
- `src/pages/PostAutomation.tsx` - automation defaults plus tabs for calendar and social templates.
- `src/pages/Posts.tsx` - posts list and entry to editor.
- `src/pages/Pricing.tsx` - pricing page for logged-in users.
- `src/pages/PrivacyPolicy.tsx` - privacy policy content.
- `src/pages/Profile.tsx` - profile settings and account details.
- `src/pages/PublicPricing.tsx` - pricing page for visitors.
- `src/pages/TermsOfService.tsx` - terms of service content.
- `src/pages/Tools.tsx` - public tools page.

Services
- `src/services/adminUserService.ts` - admin user API calls.
- `src/services/blogService.ts` - blog or CMS content API calls.
- `src/services/calendarService.ts` - schedule calendar API calls.
- `src/services/cardTemplateService.ts` - card template API calls.
- `src/services/designService.ts` - design asset API calls.
- `src/services/integrationService.ts` - integrations catalog and OAuth helper calls.
- `src/services/mediaService.ts` - media upload/list API calls.
- `src/services/pageContentService.ts` - page content API calls.
- `src/services/pricingService.ts` - pricing API calls.
- `src/services/socialPostService.ts` - social post scheduling API calls.
- `src/services/wordpressService.ts` - WordPress integration API calls.

Types and utilities
- `src/types/admin.ts` - admin-related TypeScript types.
- `src/types/cardTemplate.ts` - card template TypeScript types.
- `src/types/pricing.ts` - pricing TypeScript types.
- `src/utils/apiBase.ts` - API base URL resolution.
- `src/utils/imageCompression.ts` - client-side image compression.
- `src/utils/userSession.ts` - session storage helpers and user normalization.

Secondary backend (root `backend/`)
- `backend/.env` - environment variables for the backend app.
- `backend/.env.example` - backend env template.
- `backend/app.js` - Express app entry with user/admin routes and webhooks.
- `backend/database.sqlite` - local SQLite database for dev.
- `backend/railway.toml` - Railway config for backend service.
- `backend/controllers/adminController.js` - admin routes and actions.
- `backend/controllers/userController.js` - user routes and actions.
- `backend/controllers/webhooks.js` - webhook handlers.
- `backend/models/AuditLog.js` - audit log model.
- `backend/models/ConnectedAccount.js` - connected account model.
- `backend/models/Post.js` - post model.
- `backend/models/User.js` - user model.
- `backend/platforms/facebook_pages.js` - Facebook Pages integration (JS).
- `backend/platforms/facebook_pages.ts` - Facebook Pages integration (TS).
- `backend/platforms/index.js` - platform registry (JS).
- `backend/platforms/index.ts` - platform registry (TS).
- `backend/platforms/instagram_business.js` - Instagram business integration (JS).
- `backend/platforms/instagram_business.ts` - Instagram business integration (TS).
- `backend/platforms/interface.js` - platform interface (JS).
- `backend/platforms/linkedin.js` - LinkedIn integration (JS).
- `backend/platforms/linkedin.ts` - LinkedIn integration (TS).
- `backend/platforms/twitter_x.js` - X/Twitter integration (JS).
- `backend/platforms/twitter_x.ts` - X/Twitter integration (TS).
- `backend/platforms/types.ts` - shared integration types.
- `backend/prisma/schema.prisma` - Prisma database schema.
- `backend/scheduler/scheduler.js` - job scheduler and queues.
- `backend/scripts/seed-users.js` - seeds sample users.
- `backend/src/index.ts` - TypeScript backend entry.
- `backend/src/middleware/auth.middleware.ts` - auth middleware.
- `backend/src/routes/analytics.routes.ts` - analytics endpoints.
- `backend/src/routes/auth.routes.ts` - auth endpoints.
- `backend/src/routes/automation.routes.ts` - automation endpoints.
- `backend/src/routes/integrations.routes.ts` - integrations endpoints.
- `backend/src/routes/my-integrations.routes.ts` - user integrations endpoints.
- `backend/src/routes/oauth.routes.ts` - OAuth endpoints.
- `backend/src/routes/posts.routes.ts` - post endpoints.
- `backend/src/services/analytics-sync.service.ts` - analytics sync jobs.
- `backend/src/services/analytics.service.ts` - analytics service.
- `backend/src/services/auth.service.ts` - auth logic.
- `backend/src/services/integration.service.ts` - integrations logic.
- `backend/src/services/oauth.service.ts` - OAuth flow logic.
- `backend/src/services/post.service.ts` - post service logic.
- `backend/src/services/automation/post-automation.service.ts` - automation logic for posts.
- `backend/src/services/automation/queue.ts` - automation queue definitions.
- `backend/src/services/automation/scheduler.ts` - automation scheduler.
- `backend/src/services/platform-adapters/facebook.adapter.ts` - Facebook adapter.
- `backend/src/services/platform-adapters/instagram.adapter.ts` - Instagram adapter.
- `backend/src/services/platform-adapters/linkedin.adapter.ts` - LinkedIn adapter.
- `backend/src/services/platform-adapters/pinterest.adapter.ts` - Pinterest adapter.
- `backend/src/services/platform-adapters/twitter.adapter.ts` - Twitter adapter.
- `backend/src/services/platform-adapters/wordpress.adapter.ts` - WordPress adapter.
- `backend/src/utils/encryption.ts` - encryption helpers.
- `backend/src/utils/integration-log.ts` - integration logging helpers.
- `backend/src/utils/platform-helpers.ts` - platform helper utilities.
- `backend/src/utils/seed-default-users.ts` - seeds default users on boot.
- `backend/utils/encrypt.js` - encryption utilities (legacy JS).
- `backend/utils/index.js` - backend utility exports.
- `backend/utils/notify.js` - notification helpers.

Secondary frontend (root `frontend/`)
- `frontend/.env.example` - env template for the secondary frontend.
- `frontend/vite.config.ts` - Vite config for the secondary frontend.
- `frontend/src/App.tsx` - router-based app shell.
- `frontend/src/index.css` - global styles.
- `frontend/src/main.tsx` - entry point.
- `frontend/src/components/Analytics/DateRangeSelector.tsx` - analytics date range picker.
- `frontend/src/components/Analytics/EngagementChart.tsx` - engagement chart.
- `frontend/src/components/Analytics/MetricTrend.tsx` - metric trend card.
- `frontend/src/components/Analytics/PlatformComparison.tsx` - platform comparison chart.
- `frontend/src/components/Analytics/SummaryCard.tsx` - summary KPI card.
- `frontend/src/components/Analytics/TopPostsTable.tsx` - top posts table.
- `frontend/src/components/Automation/AccountSelector.tsx` - choose accounts for automation.
- `frontend/src/components/Automation/AutomationRules.tsx` - automation rules UI.
- `frontend/src/components/Automation/ScheduleSelector.tsx` - scheduling selector UI.
- `frontend/src/components/Posts/AutomationTab.tsx` - automation tab in posts.
- `frontend/src/components/Posts/PlatformSelectionPanel.tsx` - select platforms for a post.
- `frontend/src/components/Posts/PlatformSelector.tsx` - platform picker UI.
- `frontend/src/components/Posts/PostPreview.tsx` - post preview.
- `frontend/src/components/Posts/RescheduleDialog.tsx` - reschedule modal.
- `frontend/src/components/Posts/RescheduleDropdown.tsx` - reschedule dropdown.
- `frontend/src/components/Posts/ScheduleSelector.tsx` - schedule selector in posts.
- `frontend/src/components/ui/Modal.tsx` - modal component.
- `frontend/src/components/ui/Toast.tsx` - toast notification.
- `frontend/src/hooks/useAnalytics.ts` - analytics hook.
- `frontend/src/hooks/useAutomation.ts` - automation hook.
- `frontend/src/hooks/useIntegrations.ts` - integrations hook.
- `frontend/src/hooks/usePosts.ts` - posts hook.
- `frontend/src/pages/AnalyticsPage.tsx` - analytics page.
- `frontend/src/pages/IntegrationsPage.tsx` - integrations page.
- `frontend/src/pages/LoginPage.tsx` - login page.
- `frontend/src/pages/PostEditorPage.tsx` - post editor page.
- `frontend/src/pages/PostsPage.tsx` - posts list page.
- `frontend/src/pages/SignupPage.tsx` - signup page.
- `frontend/src/store/authStore.ts` - auth state store.
- `frontend/src/utils/api.ts` - API client helpers.
- `frontend/dist/index.html` - built HTML (generated).
- `frontend/dist/assets/index-BLGV1CPg.js` - built JS asset (generated).
- `frontend/dist/assets/index-BSpDEtsj.css` - built CSS asset (generated).

Static assets and outputs
- `assets/app.css` - built CSS bundle (generated).
- `assets/app.js` - built JS bundle (generated).
- `assets/index.es-UFuAKNwD.js` - built ES module asset (generated).
- `assets/purify.es-CFh60W_8.js` - built library asset (generated).
- `docs/.nojekyll` - GitHub Pages config.
- `docs/404.html` - static 404 page for docs site.
- `docs/index.html` - static index for docs site.
- `docs/tiktoka4r5jGLRrZEzoPZ1c2IkmhGHOYbDXK1E.txt` - domain verification.
- `docs/tiktokGuHuKYUdxb13mmRk5PkdrDFlLEBosnIF.txt` - domain verification.
- `docs/assets/app.css` - built CSS for docs site.
- `docs/assets/app.js` - built JS for docs site.
- `docs/assets/index.es-UFuAKNwD.js` - built ES module for docs site.
- `docs/assets/purify.es-CFh60W_8.js` - built library asset for docs site.
- `dist/` - Vite build output for root app (generated).
- `node_modules/` - installed dependencies (generated).
- `.vite/` - Vite cache (generated).

Public and data files
- `public/tiktoka4r5jGLRrZEzoPZ1c2IkmhGHOYbDXK1E.txt` - domain verification.
- `public/tiktokGuHuKYUdxb13mmRk5PkdrDFlLEBosnIF.txt` - domain verification.
- `files/ice_edits.json` - data file used by tooling or content edits.
- `files/silver_path_memories.json` - data file used by tooling or content edits.
- `files/smart_edits.json` - data file used by tooling or content edits.

Project tooling and metadata
- `.github/workflows/deploy.yml` - GitHub Actions deploy workflow.
- `.vscode/launch.json` - VS Code launch config.
- `.vscode/settings.json` - VS Code settings.
- `.vscode/tasks.json` - VS Code tasks.
- `.cursor/commands/wp.md` - Cursor editor command notes.
- `.project/complete_drafts.txt` - project local notes.
- `.project/dictionary.sqlite` - local dictionary database.
- `.project/indexes.sqlite` - local index database.
- `.project/localProjectSettings.json` - local project settings.
- `.agent/` - agent tooling metadata (not part of app runtime).
- `.agents/` - agent tooling metadata (not part of app runtime).
- `.claude/` - assistant tooling metadata (not part of app runtime).
- `tmp_skills/` - temporary skill cache (not part of app runtime).
- `tmp_skills_disabled/` - disabled skill cache (not part of app runtime).
- `Old design/` - legacy design artifacts (non-production reference).

If you add or change features, update the relevant service in `src/services/`, the UI pages/components in `src/pages/` or `src/components/`, and the API routes in `server.ts` (or `backend/src/` if using that stack). Keep styling in Tailwind and reuse existing UI patterns.
