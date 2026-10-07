# Dakyworld Hub codebase audit

Audit date: 7 October 2026. Workspace: `D:/Saas`.

## Executive assessment

The application has substantial breadth: publishing, design tools, CRM, email marketing, analytics, AI agents, sales calling, organizations, billing, and integrations. It is not ready for a confident production release in its current state. The highest risks are authorization gaps, unpaid credit grants, database fallback behavior, broken fresh migrations, and incompatible Stripe handling. Adding more product surface before repairing these foundations will increase support cost and financial exposure.

This is an audit of the current working tree, including existing uncommitted changes. It is not limited to the last commit. Application source was not edited. Audit scripts, logs, inventories, and an isolated build were added under this directory.

### Scope and limits

- A structural and pattern scan read 541 source/configuration files. Of these, 509 code/style/schema files contain 174,766 lines. Active API source accounts for 122 files and 53,634 lines; active frontend source accounts for 251 files and 88,402 lines.
- The scan covers active workspaces, backend adapters and legacy code, the alternate frontend, deployment files, scripts, and test infrastructure. Generated output, dependencies, caches, skill directories, temporary repositories, and the archived `Old design` directory were excluded. The source inventory records included paths and SHA-256 hashes.
- Higher-risk paths received manual inspection: authentication, authorization, tenancy, payment handling, credits, migrations, publishing, automation, agent schedules, webhooks, media, integrations, application state, and frontend entry loading.
- Nine findings were reproduced using local memory or injected database/provider doubles. No production exploitation, real payments, external messages, or live database migration was performed by those reproduction checks.
- This was not a manual line-by-line review of every file, a penetration test, a production configuration review, or a browser-based visual audit. Live SQL execution, provider credentials, actual deployment behavior, accessibility measurements, load capacity, and backup restoration remain unverified.
- Existing API tests predominantly validate local doubles or functions. Their success does not establish correctness against PostgreSQL or current provider payloads.

### Verification results

| Check | Result | Meaning |
| --- | --- | --- |
| Frontend TypeScript check | Passed | The active web workspace typechecks. |
| Isolated Vite production build | Passed | The current source bundles; output is in `web-dist/`. |
| API esbuild bundle | Passed | Bundling succeeds; esbuild does not establish TypeScript correctness. |
| API check with committed tsconfig | Failed | TS5110: `module: ESNext` conflicts with `moduleResolution: NodeNext`. |
| API check with CLI overrides | Failed: 645 diagnostics | Correcting module settings exposes type errors and missing symbols. This is not a count of 645 distinct runtime bugs. |
| Default API test runner on local Node 24.14.0 | Failed: 73 passed, 43 failed, 116 reported tests | Unsupported TypeScript syntax prevents some files from loading. |
| API tests with explicit `--import tsx` | Passed: 161/161 | Existing tests pass when TypeScript is loaded correctly. |
| Targeted audit reproductions | 9/9 reproduced | Confirms the specific control-flow failures described below using local doubles. |
| `npm audit` | 50 affected package entries | 5 critical, 28 high, 15 moderate, 2 low. Counts include inherited dependency effects. |
| `npm audit --omit=dev` | 29 affected package entries | 3 critical, 15 high, 10 moderate, 1 low across production dependencies in the monorepo; not the exact Docker runtime dependency set. |

### Priority definitions

- **P0:** Repair immediately before a release or additional paying customers. These findings affect access boundaries, money, durable data, or essential startup/billing behavior.
- **P1:** Repair in the next stabilization cycle. These findings materially affect security, reliability, feature truth, or operations.
- **P2:** Improve after the foundations are stable. These findings affect maintainability, performance, usability, and operational maturity.

## P0: Release blockers

### A01. Credit purchases grant value without collecting payment

**Evidence:** `packages/api/src/server/creditsRoutes.ts:54`. The purchase route resolves a pack and directly calls `grantCredits`. It does not create a checkout, verify a transaction, or require a paid order.

**Impact:** Any authenticated user can repeatedly acquire credits at no payment cost. Idempotency is optional and does not fix the missing payment requirement.

**Reproduction:** Two local requests returned HTTP 200 and increased the balance from 1,000 to 2,000. No payment provider was called.

**Fix:** Create a pending purchase with server-selected price, currency, pack, and user. Grant credits only after authenticated provider confirmation. Enforce a unique provider transaction ID and update the order, balance, and ledger in one transaction.

**Acceptance:** Unpaid, underpaid, replayed, wrong-user, and wrong-currency transactions cannot grant credits. A paid transaction grants exactly once.

### A02. Production database failures silently fall back to temporary local data

**Evidence:** `packages/api/src/db.ts:573`. `dbQuery` catches real PostgreSQL errors and executes the SQL shim. When PostgreSQL is not ready, it also goes straight to the shim. `hasDatabase()` reports true for the shim. Startup catches initialization failures and seeds local users in `server.ts:528`.

**Impact:** A failed write can appear successful while remaining only in process memory, or while the shim does nothing. Responses can contain synthetic values. Different replicas can disagree. The behavior obscures outages and undermines authentication and billing checks.

**Reproduction:** A local `COUNT` query with `WHERE user_id=$1` counted both tenants rather than only the caller. The shim does not preserve SQL semantics or tenant predicates.

**Fix:** Separate explicit demo/test mode from production storage. In production, propagate database errors and return appropriate 503/500 responses. Never use synthetic financial, identity, or tenant data as an outage fallback.

**Acceptance:** Simulated database loss causes visible failures and failed readiness, without temporary writes, seeded identities, or synthetic successful responses.

### A03. Fresh database migration fails on an undefined variable

**Evidence:** `packages/api/src/db-migrations.ts:4840`. `baseChecksum` is declared inside `runDatabaseMigrations`, but used in the separately scoped `createLeadgenTables` function.

**Impact:** The full migration path throws before completing initialization. A previously recorded checksum can skip this path; therefore behavior differs between fresh and existing databases.

**Reproduction:** A database double accepting each query reached `ReferenceError: baseChecksum is not defined` after 566 queries. This confirms the JavaScript failure, not the correctness of those SQL statements.

**Fix:** Keep migration bookkeeping in the owning runner or explicitly pass needed values. Add a fresh-schema migration test against disposable PostgreSQL.

**Acceptance:** A fresh database and an upgraded existing database both initialize successfully and record their actual migration state.

### A04. Task status updates do not bind the task to the authorized project

**Evidence:** `packages/api/src/server/orgRoutes.ts:635` and `:645`. Access is checked against the URL project. The subsequent task lookup and update use only `taskId`, without `project_id`.

**Impact:** An administrator of one project can target another project's task ID. Knowing or obtaining a foreign task ID can bypass the intended organization boundary. The task ID is not a substitute for authorization.

**Reproduction:** With an injected database double, authorization for `owned-project` led to an HTTP 200 write for `other-project-task`. No live cross-tenant request was made.

**Fix:** Scope every lookup and mutation by both the authorized project and task ID. Return 404 for a mismatch. Review nested task operations for the same pattern.

**Acceptance:** IDs from another project or organization cannot be read or mutated through an authorized project URL.

### A05. Known passwords are seeded without a production guard

**Evidence:** `packages/api/src/user-auth.ts:338`. `ensureSeedUsers` creates a named administrator and regular user with hard-coded passwords. The startup chain calls it without checking for a development environment. Credentials are deliberately not repeated in this report.

**Impact:** A fresh installation can create a publicly discoverable administrator credential. Existing installations are exposed if the seeded password has not been changed. The code does not prove the current production password.

**Fix:** Remove known passwords and production demo-user seeding. Bootstrap an administrator through a one-time invitation or controlled setup procedure. Check and rotate affected accounts; invalidate old sessions.

**Acceptance:** Fresh production startup never creates an account with a repository-defined password.

### A06. Stripe subscription synchronization uses fields removed in the selected API generation

**Evidence:** `packages/api/src/server.ts:164` selects `2025-05-28.basil` with an `as any` cast. `server/webhookRoutes.ts:39` reads top-level `sub.current_period_start` and `sub.current_period_end`. Stripe moved these fields to subscription items in Basil. See [Stripe's migration notice](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end).

**Impact:** A Basil-shaped subscription produces an invalid date and prevents subscription synchronization. The surrounding webhook handler catches the error and still returns HTTP 200, so the provider receives a successful acknowledgment.

**Reproduction:** A local Stripe-shaped fixture containing item-level billing periods returned HTTP 200 while performing zero subscription writes.

**Fix:** Align the SDK, requested API version, webhook endpoint version, and parsing code. Read item-level periods using an explicit business rule for multi-item subscriptions. Validate real provider fixtures.

**Acceptance:** Checkout and subscription updates using the configured API version correctly update entitlements and periods; processing failures are retried.

### A07. OS API key scopes are read but never enforced

**Evidence:** `packages/api/src/server/dakyworldOsRoutes.ts:97`. Authentication returns scopes, but routes do not require a scope before invoking agents, generating content, or managing webhooks. Non-array scopes default to broad permissions.

**Impact:** An integration key intended only for analytics can perform writes and consume resources. Least-privilege integration access is ineffective.

**Reproduction:** An API key with only `analytics:read` created a webhook with HTTP 201.

**Fix:** Enforce explicit scopes on every OS route. Deny malformed or missing scopes. Restrict the global OS secret's user impersonation capability and remove the implicit administrator target.

**Acceptance:** Each scope has allowed and denied endpoint tests. A read-only key cannot mutate data or generate paid output.

## P1: Security and data integrity

### A08. Suspended and banned accounts remain eligible for login and authenticated operations

**Evidence:** `server/authRoutes.ts:171` checks the password and lockout but does not reject account status. `user-auth.ts:669` verifies only the JWT. The global session guard in `server.ts:374` checks token version, not status, and permits missing users or tokens without a version. Social login signs tokens without `tokenVersion`.

**Impact:** Administrative suspension does not consistently revoke access. Deleted users and older/social tokens can bypass parts of session revocation.

**Fix:** Centralize an authenticated principal check that enforces account existence, allowed status, and session version. Use the same token signing path for all login methods. Fail closed when the identity store is unavailable. `requireAdmin` must also enforce account status.

**Acceptance:** Password login, social login, existing JWTs, and administrator endpoints reject disabled accounts. Logout-all revokes every supported token type.

### A09. Viewers can edit task details

**Evidence:** `server/orgRoutes.ts:25` checks membership without a minimum role. `:601` uses this helper for task updates without an editor requirement. Some other operations have additional checks, so the problem is inconsistent enforcement rather than every task endpoint being unrestricted.

**Reproduction:** A viewer successfully changed task details with HTTP 200 using an injected database double.

**Fix:** Define a per-operation authorization matrix. Require editor or stronger permission for mutations, and validate assignees, supervisors, labels, and linked companies against the same organization.

**Acceptance:** Viewers retain read access but cannot edit, create, reorder, or delete protected task data.

### A10. CRM foreign references do not prove tenant ownership

**Evidence:** `server/crmDealsRoutes.ts:232` accepts `stage_id`, `contact_id`, and `company_id` directly. Read paths join those tables by ID without an additional tenant predicate.

**Impact:** A caller supplying another tenant's related ID may link foreign data into an owned deal and expose joined names or contact information. This was verified in source, not exploited against a database.

**Fix:** Validate each foreign reference under the caller's tenant before writing; reinforce with composite keys where practical. Scope joins explicitly. Apply the same rule to task relationships and other nested resources.

### A11. OS webhook tests bypass the existing SSRF guard

**Evidence:** `server/dakyworldOsRoutes.ts:489` accepts any `http(s)` URL. `:526` calls ordinary `axios.post`. The separate outbound webhook implementation already uses `safeAxios`.

**Impact:** An authenticated caller can make the server request loopback, private-network, or metadata addresses. Redirects can broaden exposure. No internal address was contacted during this audit.

**Fix:** Use the shared safe HTTP client for both registration validation and dispatch, including redirect and connection-time checks. Define egress policy and response/body limits consistently.

### A12. Idempotency does not prevent simultaneous duplicate execution

**Evidence:** `middleware/rateLimiter.ts:156`. The middleware checks a process-local map, then caches only the completed JSON response. There is no atomic claim for an in-flight operation, durable record, or request-body hash.

**Reproduction:** Two concurrent requests with the same key executed twice. Another replica or restart would also have a separate/empty map.

**Additional gap:** The broad middleware mount in `server.ts:995` occurs after most routes; it cannot protect routes already handled. Some individual routes mount it directly.

**Fix:** Claim keys atomically in PostgreSQL or Redis, bind them to authenticated user and request hash, retain in-progress/completed states, and reject conflicting bodies. Use durable provider IDs for money regardless of middleware.

### A13. Credit accounting can spend beyond balance and discard purchased value

**Evidence:** `ai-helpers.ts:239` subtracts with `GREATEST(0, credits - amount)`, without requiring sufficient balance. Ledger insertion is separate and may fail silently. `:208` replaces the entire balance at monthly reset, including top-up credits described as never expiring. `:217` selects only credits and reset date but reads auto-recharge fields from the result.

**Impact:** Paid provider work can exceed available credits; ledger and balance can diverge; purchased credits can disappear at reset. Auto-recharge settings read back as disabled in real PostgreSQL. If that selection is fixed alone, the current auto-recharge path grants credits without collecting payment.

**Fix:** Separate purchased and recurring credit buckets. Reserve credits atomically before provider work, settle/refund afterward, and commit balance plus ledger together. Implement paid auto-recharge with payment confirmation and failure handling.

### A14. Approval links ignore expiration and allow decisions to be overwritten

**Evidence:** `server/clientApprovalRoutes.ts:266` and `:290` select by token only. Neither checks `expires_at`; decision writes do not require a pending state.

**Reproduction:** A link expired in 2000 still accepted an approval with HTTP 200.

**Fix:** Enforce expiry on both read and write. Use an atomic state transition or version check, add explicit revocation, retain decision history, and rate-limit public access. Bind approval to a specific resource version before publishing.

### A15. Database TLS certificate verification is disabled

**Evidence:** `db.ts:548` sets `rejectUnauthorized: false` for remote database URLs. The local/remote decision searches the full URL for localhost text rather than parsing its hostname.

**Impact:** Encryption alone does not authenticate the database peer. A URL containing localhost text outside the hostname can also affect the TLS decision.

**Fix:** Parse the connection URL, use provider-supported CA verification, and make any development exception explicit. Verify deployment connectivity with the actual certificate chain.

### A16. Social login has schema, identity, and token handling defects

**Evidence:** `server/socialAuthRoutes.ts:157` inserts `users.name`, whereas the canonical schema uses `full_name`. `:139` falls back to synthetic email addresses. Existing accounts are joined by returned email without a provider-specific verified-email policy. `:166` signs JWTs directly without a token version and redirects them in a query parameter. OAuth state is stored in an in-process map.

**Impact:** New social signups can fail against the real schema; account linking lacks a clearly enforced verified identity rule; token exposure and revocation behavior differ from password login; replicas/restarts can lose OAuth state.

**Fix:** Store provider subject identities explicitly, verify email claims, require deliberate linking where needed, use the canonical user creation/token signing code, and use a one-time code or secure cookie handoff. Store state in a shared, expiring store.

### A17. Auth provider client secrets are stored as plaintext configuration

**Evidence:** `server/socialAuthRoutes.ts:275` writes the provided configuration directly with `JSON.stringify`. Other platform configuration paths already have encryption helpers.

**Impact:** Database readers or backups can expose provider secrets in cleartext. This is inconsistent with the protection used for integration credentials.

**Fix:** Encrypt designated auth-provider fields, mask admin reads, distinguish secret replacement from unchanged values, and implement a rotation procedure.

### A18. Stripe webhook persistence and retry semantics are unsafe

**Evidence:** `server/webhookRoutes.ts:142` performs a read-before-process event check; successful processing and event recording are separate. Errors are logged and acknowledged with HTTP 200. Invoice attribution relies on invoice-level `metadata.user_id`, while checkout sets subscription metadata. Billing routers receive the current `stripe` variable by value before the asynchronous configuration refresh.

**Impact:** Events can be acknowledged without durable changes. Concurrent duplicates can race. Some subscription invoices may not be attributed. Stripe enabled later from database configuration may remain unavailable in already-created routers.

**Fix:** Use a durable event inbox with unique event ID and processing state; retry transient failures; resolve user/subscription from stored customer and subscription mappings; reconcile periodically. Inject a getter or service rather than a snapshot of mutable provider state.

### A19. Media uploads trust client metadata and serve user-controlled MIME on the application origin

**Evidence:** `server/mediaRoutes.ts:562` validates declared `file_type` and `file_size`, not the actual bytes. `:535` derives response MIME from the stored data URL. SVG uploads are accepted and public media reads are addressed by ID.

**Impact:** Declared size/type can differ from content. User-controlled active content or HTML-like MIME can be served on the trusted app origin. Public delivery may be intended for social images, but private media needs an explicit policy. A working XSS exploit was not demonstrated.

**Fix:** Validate decoded bytes and content type, enforce actual size/dimension limits, sanitize or rasterize SVG, and serve uploads from an isolated media origin. Use signed URLs for private assets.

## P1: Reliability and feature completeness

### A20. Backend build does not enforce type safety, and extracted modules contain missing runtime symbols

**Evidence:** `packages/api/package.json` builds with esbuild only. The committed tsconfig cannot run as configured; correcting it exposes 645 diagnostics, including 108 `TS2304` missing-name diagnostics. Examples in `distributionRoutes.ts` include queue variables, encryption helpers, token constants, and static-serving names that are neither declared nor passed through dependencies.

**Impact:** Builds and shallow route tests can pass while untested publishing, queue, or token-refresh paths throw `ReferenceError`.

**Fix:** Correct the API tsconfig, add typechecking to local build and CI, and repair missing module dependencies. Prioritize missing symbols and incompatible interfaces before cosmetic typing improvements. Keep the narrowly scoped leads typecheck, but add a full API gate.

### A21. Test command and runtime policy are inconsistent

**Evidence:** CI and Docker use Node 20; package engines require 20.x; the local runtime is 24.14.0. Tests import `.ts` files but the command does not install a TypeScript loader. The command also uses `--test-isolation=none`, a feature from the newer test runner generation. Node 20 is now EOL according to the [official release table](https://nodejs.org/en/about/previous-releases).

**Fix:** Standardize on a supported Node 24 LTS patch and matching Node types. Use an explicit `tsx` loader or compile tests. Pin the runtime in local tooling, CI, and container images. Reconsider disabled isolation and shared process environment.

### A22. API starts accepting traffic before database initialization completes

**Evidence:** `server.ts:519` launches initialization without awaiting it. `:1037` separately calls `app.listen`. `/ping`, `/health`, and `/api/health` return success regardless of database readiness. Railway JSON and TOML disagree on the health path. `/api/health` exposes the raw initialization error publicly.

**Impact:** Deployment health can pass while migrations, users, or provider configuration are unavailable. Startup jobs can execute before prerequisites are ready. Error details can leak infrastructure information.

**Fix:** Await required initialization before listening or explicitly gate application traffic. Separate liveness and readiness. Return 503 on failed readiness; redact public errors. Use one authoritative deploy configuration.

### A23. Migration tracking does not establish actual schema integrity

**Evidence:** `db-migrations.ts:13` hashes a version label, not migration content. Hundreds of DDL operations suppress errors. Incremental upgrade statements suppress errors too. The full base runner contains almost 5,000 lines and runs during application startup.

**Impact:** A reported migration state can hide missing columns/tables or incomplete upgrades. Concurrent deploys can race. Code can change without invalidating the version-label checksum.

**Fix:** Use immutable, numbered migration files with content checksums, explicit failure, and a migration lock. Run migrations as a controlled deployment step. Validate schema compatibility and both clean/upgrade paths against PostgreSQL.

### A24. Agent schedules fabricate completed work on failure

**Evidence:** `server/clientApprovalRoutes.ts:66` catches model failure and substitutes invented campaign findings, including a specific conversion claim. It catches artifact persistence errors, records `completed`, and notifies the user anyway. The implemented artifact branch handles post drafts; `create_task` is advertised but has no matching creation branch.

**Impact:** Customers can receive unsupported research claims and completion notifications for work that did not happen. Missing AI keys or credits become apparent success.

**Fix:** Represent failed/degraded runs honestly, preserve provider errors, retry eligible failures, and validate artifact persistence before completion. Implement or disable unsupported output actions. Keep illustrative output only in clearly labeled demo mode.

### A25. Social inbox currently stores demo conversations and local replies

**Evidence:** `server/socialInboxRoutes.ts:144` automatically seeds fictional threads for each empty inbox. The reply route at `:208` inserts an outbound message into PostgreSQL and updates the thread, but never calls a social network provider.

**Impact:** The inbox appears populated with real prospects, and a successful reply response does not mean the recipient received a message. An AI fallback also claims a link was sent without performing that action.

**Fix:** Disable automatic demo seeding outside demo mode. Implement verified inbound webhooks/polling and provider-specific reply adapters. Store queued/sent/failed/delivered states and provider message IDs. Hide or label unsupported networks.

### A26. OS image generation returns a templated SVG instead of provider generation

**Evidence:** `server/dakyworldOsRoutes.ts:436` uses `generateLuxuryBrandPosterDataUrl`, places prompt text in an SVG template, charges two credits, and reports the requested model.

**Impact:** API output misrepresents the operation performed and the model used. This can undermine trust and create disputes over credits.

**Fix:** Call a real configured generation provider, or expose this operation as a deterministic poster renderer with explicit naming and pricing. Report actual provider, model, generation status, and failure.

### A27. Connector synchronization is not implemented

**Evidence:** `server/connectorSyncRoutes.ts:34` has a no-op due-job processor; manual execution returns 501. This is an honest failure response, but the surrounding scheduling UI cannot provide actual synchronization.

**Fix:** Build prioritized provider adapters with cursors, mapping validation, conflict policy, retry, and ownership checks. Disable scheduling for unavailable adapters and show capability status in the UI.

### A28. New automation actions use columns inconsistent with canonical tables

**Evidence:** `server/automationEngine.ts:625` inserts CRM deals using `stage` and `notes`, while `db-migrations.ts:3945` defines `stage_id` and `description`. Automatic project discovery queries `org_projects` and `org_members`, whereas the canonical organization routes use `projects` and `organization_memberships`. These queries and inserts swallow failures.

**Impact:** Automation flows can advance while creating no deal or task. Doubles that accept arbitrary SQL do not detect the mismatch.

**Fix:** Reuse domain services for task/deal creation, validate foreign ownership, return a persisted result, and fail the step when creation fails. Add real database tests for these actions.

### A29. Scheduled publishing can lose downstream distribution

**Evidence:** `scheduler.ts:102` changes a scheduled blog post to `published` before queuing social automation. Downstream errors are suppressed and a published notification still follows.

**Impact:** If queueing fails after the state transition, the next scan no longer selects that scheduled post. Local publication and successful social delivery become confused.

**Fix:** Write the publication transition and a durable outbox event in one transaction. Let workers deliver to each platform, retry, and reconcile. Track local publication and each destination separately.

### A30. Timers need durable claims, overlap protection, and shutdown handling

**Evidence:** `server.ts:1040` starts many independent `setInterval` jobs in the API process. `clientApprovalRoutes.ts:156` selects due schedules before running them without claiming rows. No server shutdown handler appears in the active entry point. Task reminders select only a narrow two-minute window.

**Impact:** Multiple replicas or overlapping ticks can duplicate agent work. Restarts can miss reminder windows. Deploy shutdown can interrupt jobs or database writes. Some existing processors do have deduplication, so the remedy should be applied per job rather than assuming every timer is unsafe.

**Fix:** Move background work to dedicated workers. Claim due jobs atomically with leases or `FOR UPDATE SKIP LOCKED`; give effects unique IDs. Process all overdue pending reminders. Drain workers and close HTTP, Redis, Prisma, and PostgreSQL connections on shutdown.

### A31. Marketing email sending confuses provider acceptance with delivery

**Evidence:** `server/mailingRoutes.ts:568` sends recipients sequentially inside a request, inserts a `delivered` event immediately after API acceptance, and marks the campaign `sent` even when individual sends fail. Unsubscribe URLs depend on `API_URL`, defaulting to a relative path. Some sending paths bypass the unified mailer.

**Impact:** Large campaigns outlive requests; retries can duplicate sends; delivery reports are inflated; missing base URL can break unsubscribe links; provider selection is inconsistent.

**Fix:** Queue recipient-level sends with unique keys and limits. Separate accepted, sent, delivered, bounced, and complained states. Use a validated public URL for unsubscribe links and a shared mailer policy. Retry failed recipients explicitly.

### A32. Webhook delivery and replay handling are incomplete

**Evidence:** `middleware/planQuotaMiddleware.ts:160` dispatches hooks synchronously with an eight-second timeout per target. The OS bridge has a separate signing format whose timestamp is not included in the HMAC input. The custom Svix verifier in `webhookRoutes.ts` verifies the MAC but not timestamp age; the Resend path does not enforce a unique event receipt before inserting effects.

**Impact:** User requests can be held by slow webhook targets; transient delivery failures have no durable retry. Signed event replays can duplicate effects. Consumers face two incompatible signature conventions.

**Fix:** Use one timestamp-bound signing scheme, a durable webhook outbox, bounded retries, delivery IDs, replay windows, secret rotation, and dead-letter/replay controls. Validate redirects and targets through the shared egress policy.

### A33. Plan quotas differ from pricing and are only partially wired

**Evidence:** `middleware/planQuotaMiddleware.ts` defines account and automation quotas, but route references only show checks for approvals, outbound hooks, and agent schedules. The guard factory is unused. Counts fail open on database errors. Free and Pro social account limits are 3 and 50 here, versus 2 and 8 in seeded pricing text.

**Impact:** Customers receive inconsistent limits; database errors or concurrent creation can bypass caps. Checking active count only at creation can also miss later activation flows.

**Fix:** Store structured entitlements by immutable plan ID. Share them across pricing, UI, API, and billing. Enforce them atomically at all relevant mutation/activation points. Return a degraded-service error when usage cannot be measured reliably.

## P2: Architecture, frontend, and operations

### A34. Large files, legacy surfaces, and loose contracts slow safe changes

**Evidence:** `MarketingContacts.tsx` is 2,559 lines; `Posts.tsx` is 2,231; `AITeam.tsx` is 2,118; `distributionRoutes.ts` is 2,823. The alternate `frontend/` has 34 files and 6,337 lines. Backend legacy/adapters contain 51 files and 20,559 lines; some adapters are actively imported and cannot simply be deleted. The scan found 2,403 occurrences of the token `any` and 700 exact `.catch(() => undefined)` patterns; these are indicators, not individually confirmed defects.

**Fix:** Document the active entry points and adapter dependency graph. Archive genuinely dead surfaces after import/build checks. Extract tested domain services, repositories, schema validators, and focused page components. Use shared or generated API contracts. Replace silent errors on durable writes with explicit results.

### A35. Frontend initial loading defeats part of route splitting

**Evidence:** The built entry HTML preloads chart, editor, and PDF chunks alongside the main entry: 1,767,369 bytes of JavaScript before compression, approximately 1.77 MB. Those four reported gzip sizes total approximately 481 KB. All output JavaScript totals 4,964,435 bytes across 177 files, but that total is not all loaded initially. Lazy routes and manual chunks already exist.

**Fix:** Investigate shared/import cycles and eager dependencies pulling those libraries into entry preload. Load PDF export and heavy editors only when needed. Set entry/route bundle budgets. Use immutable cache headers for hashed assets: `server.ts:402` currently forces no-store on all static files. Keep HTML separately revalidated.

**Acceptance:** Landing/auth routes avoid editor/PDF/chart downloads unless needed. Measure actual network, main-thread time, and Core Web Vitals after the change.

### A36. API clients retry across environments and have inconsistent timeout/error behavior

**Evidence:** `web/src/utils/apiRequest.ts:31` retries the same request against configured base, current origin, then a hard-coded production domain. It is used for authenticated integration reads and writes. `services/apiClient.ts` has no default timeout; `utils/apiFetch.ts` has a timeout; many pages call `fetch` directly. Active frontend source contains 474 fetch-call matches.

**Impact:** A local/staging failure can forward tokens or mutations to production. An ambiguous network failure can repeat a mutation. Users receive inconsistent authorization, quota, timeout, and parsing behavior.

**Fix:** Resolve one environment-specific base and fail visibly if it is wrong. Centralize safe JSON parsing, deadlines, cancellation, typed errors, and authentication handling. Retry only operations proven safe or covered by durable idempotency.

### A37. Browser state needs account boundaries and request race handling

**Evidence:** `App.tsx:1208` clears core auth keys on logout but not the general workspace/onboarding preferences. `WorkspaceContext.tsx` stores workspace IDs under a global key and updates results without cancellation when organizations change. `dw_onboarded` is also a global shortcut. Seven-day bearer tokens are stored in localStorage.

**Impact:** Shared browsers can inherit another account's preferences; a slow old request can replace the current organization's projects. JavaScript-accessible long-lived tokens increase the impact of any XSS.

**Fix:** Namespace state by account, clear sensitive state at logout, cancel or version workspace requests, and scope query keys by user/organization/project. Consider short-lived access tokens with a secure HttpOnly refresh/session mechanism and appropriate CSRF protection for cookie-authenticated writes.

### A38. Accessibility and responsive behavior need a shared component foundation

**Evidence:** `components/posts/batch/DeleteConfirmModal.tsx` has no dialog role, accessible title binding, focus trap, Escape handling, focus restoration, or in-flight submission lock. `App.tsx:625` and similar locations use clickable spans with `role="button"` but no keyboard focus/activation. Source scanning found no reduced-motion preference handling; `index.css:67` defines continuous marquee/float animations. Many mobile controls use compact dimensions.

**Impact:** Keyboard and screen-reader users cannot reliably operate some controls. Destructive dialogs can be submitted repeatedly. Motion-sensitive users have no explicit alternative. Small touch controls need testing, not assumptions about desktop behavior.

**Fix:** Build accessible Dialog, Menu, Tabs, FormField, and Button primitives. Use actual buttons; provide keyboard behavior and visible focus; respect reduced motion; add pending/error feedback and adequate touch targets. Test keyboard-only use, screen readers, 200% zoom, and 320/375/768-pixel layouts.

**Source-only frontend score:** Accessibility 1/4, performance 2/4, responsive design 2/4, theming 1/4, implementation integrity 1/4: **7/20, provisional**. This is a triage score, not measured WCAG certification or a visual judgment. The app has responsive classes and lazy routes, but repeated missing semantics, eager heavy assets, hard-coded styling, and misleading completed states prevent a stronger rating. The detector's only finding was an overused font; that aesthetic preference was not treated as a technical defect.

### A39. Deployment and maintenance workflows need consolidation

**Evidence:** Docker installs with `npm install` instead of `npm ci` and has no explicit non-root user. No root `.dockerignore` was found. The root build still mirrors generated frontend output to GitHub Pages locations through `scripts/sync-pages.mjs`, although Railway serves the frontend. Railway JSON/TOML overlap. CI lacks a full API typecheck, frontend tests, and a dependency security gate. Browser compatibility data reports eight months of staleness.

**Fix:** Use reproducible lockfile installs, a restricted runtime user, a small Docker context excluding env files/caches/artifacts, and one supported deployment path. Add runtime pinning, security/update automation, required status checks, and targeted browser tests. Simplify build scripts so normal builds do not rewrite deployment mirrors unnecessarily.

### A40. Observability and backup verification need operational evidence

**Evidence:** Request IDs, Pino, Sentry hooks, admin readiness checks, and an encrypted nightly database backup workflow exist. The logger forwards raw error arguments to Sentry before Pino redaction. Backup configuration, successful runs, restoration, and alerting were not verified. Health is currently static; no job-lag/queue/failure metrics were found in the inspected runtime paths.

**Fix:** Redact before sending data to any monitoring sink. Add request latency/error rates, database pool pressure, job lag, webhook retries, provider failures, credit reconciliation, and backup age alerts. Upload protected source maps for actionable frontend errors. Schedule scratch-database restore drills and document recovery ownership, retention, and recovery objectives. Verify behavior rather than relying on workflow presence.

## Dependency upgrades

The saved audit JSON is the authoritative snapshot for this checkout. Advisory counts are not counts of reachable exploits. Production/runtime reachability and build-only exposure must be evaluated separately.

1. **Runtime first:** Move Node 20 to a maintained Node 24 LTS patch, align `@types/node`, CI, engines, and Docker. [Official Node release status](https://nodejs.org/en/about/previous-releases).
2. **Patch security-sensitive direct packages:** The installed graph reports issues affecting Axios, the MCP SDK, DOMPurify, jsPDF, Nodemailer, and router dependencies. Upgrade to patched compatible versions, then run route, sanitization, editor, PDF, and integration tests.
3. **Replace or deliberately source maintained spreadsheet parsing:** `xlsx@0.18.5` is used on imported spreadsheets and has no npm-audit fix in the current package channel. See the [SheetJS prototype pollution advisory](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6). Evaluate a maintained parser/distribution with provenance; isolate parsing, cap file complexity, and check export formula injection.
4. **Upgrade Vite, Vitest, and affected tooling:** Keep the framework/plugin versions compatible. Vitest's critical UI-server advisory is conditional on that server being exposed; this project currently uses Node's test runner, so the audit does not establish a live Vitest exploit. [Vitest advisory](https://github.com/advisories/GHSA-5xrq-8626-4rwp).
5. **Trace transitive critical entries:** `proxy-addr` and `tar` are flagged in the production monorepo graph. Determine parent paths and whether they exist in the actual API container. Upgrade or eliminate their parents rather than assuming every entry is remotely exploitable.
6. **Reduce unnecessary packages:** Both Bull and BullMQ are installed. Validate whether legacy Bull, old deployment tools, and obsolete workspaces remain necessary. Remove unused packages only after dependency tracing.
7. **Plan larger ecosystem changes after stabilization:** Prisma 5, Fabric 5, React 18, Tailwind 3, and the old Google generative SDK warrant compatibility/maintenance review. Do not combine security remediation with an untested major rewrite. React or Tailwind major migration alone will not fix the confirmed authorization or data-integrity defects.

Do not run `npm audit fix --force` blindly. Some proposed resolutions are major migrations or downgrades, and several advisories depend on how a library is used.

## Improvements and additions worth building

These are recommendations, not claims that every related capability is absent.

### Foundation additions

- **A shared authorization policy:** Principal, account status, tenant, organization role, project permission, and API scope in one enforceable flow. Add positive and negative tests for every resource family.
- **A real PostgreSQL integration environment:** Disposable database and Redis services, clean migration/upgrade fixtures, and provider-shaped webhook payloads. Preserve unit doubles for speed, but prove SQL and transactions separately.
- **A billing and credit reconciliation service:** Immutable orders/ledger, separate credit buckets, reservations, confirmed paid top-ups, renewal/cancellation handling, and operator repair tools.
- **A durable job and event system:** Outbox, worker leases, retry policy, dead-letter queue, job history, duplicate suppression, and safe replay. Build on existing BullMQ and database structures.
- **A capability registry:** Distinguish advertised, configured, connected, authorized, operational, and unavailable integrations. Feed both API responses and the UI from this truth.
- **A security settings surface:** MFA/passkeys for administrators, device/session management, key scopes/expiry/rotation, and security activity. Logout-all already exists but needs the fixes above.

### Product additions after stabilization

- **End-to-end approval publishing:** Resource versions, reviewer identity, expiry/revocation, immutable decisions, and publication gated on the approved version. The current approval-link feature is only a starting point.
- **A genuine social inbox:** Prioritize supported Meta channels, prove provider ingestion and reply delivery, then add assignment, collision prevention, SLA queues, and saved replies. Do not show demo prospects as actual contacts.
- **An automation run inspector:** Step inputs/results, failure reason, retry/resume, dry run, budget estimate, and explicit human approval for consequential actions.
- **A provider connection health center:** Expiring credentials, missing scopes, permission errors, reconnect steps, last successful sync, job lag, and degraded status. Existing token monitoring is a foundation, but missing-symbol paths must be repaired.
- **Workspace-consistent collaboration:** Decide which assets belong to users versus organizations. Apply the choice across CRM, posts, inbox, media, agents, and billing rather than showing a workspace selector above user-only data.
- **Data portability and deletion:** Self-service export/deletion, provider revocation, retention policies, and documented backup behavior. Existing provider/admin deletion pieces do not establish a complete self-service lifecycle.
- **Reusable reporting and attribution:** Saved filters, actual-delivery analytics, campaign conversion attribution, scheduled client reports, and reliable export. Fix data truth and tenant scope first.
- **A documented UI system:** Tokens, accessible primitives, typography, forms, loading/error/empty states, mobile behavior, and reduced motion. Capture PRODUCT.md and DESIGN.md from actual product decisions.

## Repair roadmap

### Wave 1: Stop access and financial failures

Repair A01–A07 together with A08–A15. Temporarily gate unsafe credit purchases and unfinished chargeable operations. Remove seeded credentials, restore strict production database behavior, fix migration scope, bind task operations to projects, enforce scopes, and align Stripe parsing. Validate these with a disposable database and real-shaped fixtures.

**Exit gate:** No unpaid grants; no cross-project writes; disabled accounts denied; no production shim fallback; clean database boot works; billing changes survive provider retries.

### Wave 2: Make CI and background operations trustworthy

Standardize Node and the test loader. Make full API typechecking required. Fix missing runtime symbols, schema-mismatched automation actions, readiness, webhook persistence, credit transactions, and durable scheduling. Add tests that fail for the reproduced defects before implementing fixes.

**Exit gate:** Reproducible build, green full typecheck, real database migration tests, negative authorization tests, durable job retries, and graceful deploy shutdown.

### Wave 3: Finish the features already exposed

Replace fabricated agent outcomes and inbox content. Implement actual reply adapters, approve/version publishing, and prioritized connector sync. Label or disable capabilities that remain unavailable. Repair campaign delivery tracking and unsubscribe links.

**Exit gate:** Every successful user-facing operation corresponds to a durable result or real provider acknowledgment, with truthful status and recoverable failures.

### Wave 4: Improve speed, usability, and operational maturity

Remove entry preloads for unused heavy libraries, cache hashed assets, consolidate API clients, fix account-state boundaries, and adopt accessible primitives. Consolidate deployment scripts, reduce verified dead code, add monitoring and restore drills, then add new product capabilities.

**Frontend workflow:** `$impeccable harden`, `$impeccable adapt`, `$impeccable optimize`, `$impeccable document`, and finally `$impeccable polish`. Repeat `$impeccable audit` after changes, including live desktop/mobile checks. These commands can be applied one at a time or together.

## Strengths to preserve

- The workspace separation and route factories provide a workable path toward modular services.
- Frontend strict TypeScript and route lazy loading already work.
- Unit coverage is meaningful in several sales-policy, timing, signature, validation, and tenancy areas; 161 tests pass with a correct loader.
- Existing SSRF protection validates public URLs and connection-time DNS. Reuse and harden it consistently.
- Integration secret encryption, request IDs, logging, Sentry integration, and offsite encrypted database backups already exist.
- The vendored leads module deliberately injects tenant context and rejects operations it cannot scope. Preserve that fail-closed intent while adding database-backed relation tests.
- Connector sync returns 501 rather than claiming to complete imaginary work. Apply that honest capability behavior elsewhere.

## Audit artifacts

- `source-inventory.json`: included file inventory, hashes, line counts, and structural/pattern scan totals.
- `dependency-audit.json` and `dependency-audit-production.json`: full npm advisory snapshots.
- `api-typecheck.txt`, `api-typecheck-corrected-options.txt`, and `web-typecheck.txt`: compiler evidence.
- `default-tests.txt` and `tests-with-tsx.txt`: runner failure and successful test output.
- `reproduced-findings.json`: nine local reproduction results.
- `verify-findings.mjs`: isolated reproduction harness; run with `node --import tsx files/audit-2026-10-07/verify-findings.mjs` from the repository root.
- `scan.mjs`: reproducible structural scan.
- `web-build.txt` and `web-dist/`: isolated frontend build and output.
- `api-bundle.mjs`: isolated API bundle.
- `frontend-detector.json`: bounded frontend detector output; aesthetic warnings were not counted as confirmed defects.

This report identifies 40 grouped findings: 7 P0, 26 P1, and 7 P2. Dependency advisories and proposed additions are tracked separately. The count represents grouped problems, not every affected endpoint or individual diagnostic.
