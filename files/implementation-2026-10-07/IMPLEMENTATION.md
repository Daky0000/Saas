# Implementation report — 7 October 2026

## Delivered

Stripe has been removed from active payment code and dependencies. Historical database columns remain to preserve records. Paystack now handles plan purchases and credit packs, with separate test/live keys and an explicit mode selector in Admin → Payments.

Checkout prices come from server-owned plans and packs. Orders are stored before contacting Paystack. Fulfillment verifies reference, owner, payment domain, amount, currency, customer email, transaction identity and paid timestamp. PostgreSQL locking and transactions prevent duplicate entitlements when callbacks and webhooks arrive together. Failed ledger writes roll back fulfillment.

Test checkout is administrator-only. Test entitlements use separate sandbox accounts; they do not modify live credits, invoices or subscriptions. Switching modes preserves both key sets, and verification uses the order's original mode. Disabling the integration blocks new checkouts while allowing existing orders to settle.

Plans purchase prepaid monthly/yearly periods. Renewal requires another checkout. Automatic recurring debits and automatic credit recharge are not implemented; the interface explains this.

## Paystack setup

1. Open Admin → Payments and enter test and live secret/public keys in their respective fields. Saved credentials are encrypted.
2. Set the merchant currency and conversion rate from the application's USD prices into that currency. Use 1 for USD-to-USD pricing; configure an appropriate operator-managed rate for GHS or another currency. Exchange rates are not fetched automatically.
3. Start in test mode. Use an administrator account to purchase a plan and credit pack, then check sandbox balances.
4. Configure the Paystack webhook as `https://YOUR_DOMAIN/api/payments/paystack/webhook`. Set `VITE_APP_URL` to the public frontend URL; checkout returns to `/billing?paystack_reference=...`.
5. Switch to live after keys, currency and webhook are configured. Automated tests use provider fixtures; an actual merchant-account transaction remains an operator verification step.

Environment alternatives: `PAYSTACK_MODE`, `PAYSTACK_TEST_SECRET_KEY`, `PAYSTACK_TEST_PUBLIC_KEY`, `PAYSTACK_LIVE_SECRET_KEY`, `PAYSTACK_LIVE_PUBLIC_KEY`, `PAYSTACK_CURRENCY`, `PAYSTACK_FX_RATE`. Saved fields take precedence. Never commit real keys. Existing Stripe customer subscriptions need reconciliation before migrating paying users; old pending Stripe events no longer synchronize.

## Security and reliability

- Production database failures propagate instead of falling back to the development SQL shim. TLS verifies certificates.
- Production demo credentials are disabled. Disabled accounts and invalidated JWTs are rejected. OAuth uses durable one-time states, verified identities and fragment token returns. Provider secrets are encrypted.
- Project/task access enforces tenant and editor boundaries. CRM references enforce ownership. OS API scopes are enforced.
- Webhook requests use guarded public URLs and signatures. Request idempotency uses atomic PostgreSQL claims and stored responses.
- Approval decisions enforce expiration and prevent overwrites. Raster uploads validate bytes and MIME signatures; new SVG uploads are rejected.
- Credit deductions are conditional and preserve purchased credits across allowance resets.
- Startup waits for initialization. Migrations use an advisory lock, generated source fingerprints and required-table validation; checksum recording follows validation. Fresh-database campaign-table ordering was repaired. Health probes check PostgreSQL.
- Scheduled publication, outbound webhooks and campaign email have durable outbox records and retry/claim handling. Campaign sending reports queued work; provider acceptance is distinguished from delivery.
- Agent failures and unimplemented provider operations no longer fabricate success. Demo inbox data requires explicit nonproduction opt-in.

## Build and frontend

API builds now enforce TypeScript. Missing extracted helpers and invalid contracts were repaired. Node 24 is aligned across engines, Docker and CI. Docker uses reproducible installation and a non-root runtime. Railway health paths are aligned.

Security-sensitive packages were upgraded. Stripe, the vulnerable npm SheetJS package and unused dependencies were removed. Spreadsheet imports use ExcelJS with limits. Fabric was migrated to version 7 promise APIs, Tailwind to version 4 and Vite to version 8. Heavy editor loading is deferred. Hashed assets are immutable and source maps are not publicly served. Account-specific browser state, stale project responses, sidebar markup, deletion dialogs, focus behavior and reduced-motion support were improved.

## Validation

- Full application build passes, including strict API checking and Prisma generation. Separate web TypeScript check passes.
- 176 tests pass, zero failures and zero skips, with real PostgreSQL and mocked external providers.
- The suite also passes against a newly created database, including fresh migrations.
- Payment tests cover sandbox isolation, concurrent fulfillment, ownership, live prepaid renewal, rollback and signed/tampered webhooks.
- Browser checks cover separate keys, mode switching, persistence, sandbox callbacks, mobile overflow and browser exceptions.
- Fabric regression covers text, shapes, undo, redo and PNG export.
- Dependency audit: 2 moderate findings, zero high and zero critical. Remaining findings are the ExcelJS → uuid chain; an unverified transitive major override was avoided.

Evidence is stored beside this report: build/typecheck/test logs, `browser-result.json`, screenshots and `audit-final.json`.

## Remaining work

This stabilization does not complete every recommendation in the original audit.

| Audit findings | Status and remaining work |
| --- | --- |
| A01–A07 | Core release-blocking paths repaired; Stripe replaced with Paystack. |
| A08–A18 | Authentication, ownership, scopes, idempotency, credits, approvals, TLS, OAuth and payment integrity repaired. Extend relationship and concurrency coverage across all features. |
| A19 | Upload validation repaired. Private object storage, signed access and media-origin isolation remain. |
| A20–A22 | Strict build, test runtime and startup initialization repaired. |
| A23 | Migration locks, fingerprints, table validation and bookkeeping repaired. Legacy swallowed DDL errors and exhaustive column/constraint validation need restructuring. |
| A24–A27 | Fabricated success removed. Real social inbox adapters, image-provider bridge, connector synchronization and agent task artifacts remain unavailable. |
| A28 | Canonical automation contracts repaired; broader action end-to-end coverage remains. |
| A29–A30 | Publication outbox and several durable job claims added. Downstream deduplication, dedicated workers and hardening every remaining timer remain. |
| A31–A32 | Durable recipient/outbound jobs and Paystack replay protection added. Live delivery verification and a universal durable inbound webhook inbox remain. |
| A33 | Pricing aligned and quota errors fail closed. Atomic enforcement across every creation endpoint remains. |
| A34–A36 | Types, bundling and some API retry behavior improved. Large-module cleanup, performance profiling and unified API clients remain. |
| A37–A38 | Account boundaries and selected accessibility/mobile defects repaired. Broader race tests, screen-reader review and shared form/dialog primitives remain. |
| A39–A40 | Build, Docker, monitoring redaction and readiness improved. Backup restore drills, operational alerts, job-lag metrics and release/rollback procedures remain unverified. |

MFA/passkeys, account export/deletion and further product additions proposed in the audit are not implemented. No production deployment or external payment was performed.
