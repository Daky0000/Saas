# Independent credit purchases

## Delivered behavior

All active signed-in users can buy credits without a paid subscription. Plan-only tools and quotas remain restricted by the user's plan. The database catalog seeds Mini (250 credits / USD 3), Starter (1,000 / USD 12), Growth (5,000 / USD 49), and Power (20,000 / USD 149). Administrators can edit, reorder, create, and disable packs in Admin → Payments. The legacy `agency` identifier resolves to Power; historical orders remain unchanged.

The new `/credits` page shows exact Paystack currency pricing, allowance and purchased balances, refund reservations, purchase history, downloadable receipts, paginated activity, saved cards, and recharge settings. Billing and insufficient-credit dialogs link to it. Disabled recharge controls and conflicting hardcoded Billing prices were removed.

Purchased credits do not expire. Accounting locks the wallet, spends monthly allowance first and then purchase lots oldest-first, and records allocations and ledger changes atomically. Monthly resets retain purchased credits and record the actual positive or negative change. New accounts receive their initial allowance even when their first action is purchasing a pack. Blocked accounts cannot spend.

## Payment integrity and recovery

Checkout requires a current catalog version and an idempotency key. The browser retains the purchase intent across failed requests. Server-side orders snapshot pack quantity, name, USD price, conversion rate, payable amount, currency, mode, source, and card-saving consent. A mode switch invalidates the old quote. Provider metadata cannot override entitlements.

Signed webhooks are stored durably before acknowledgement. Workers process events with leases and retries. Callback verification, events, and reconciliation share the existing transactional Paystack fulfillment service. One order creates one credit lot and one receipt. Initialization timeouts and ambiguous automatic charges retain a stored reference; reconciliation never creates a replacement charge.

Test wallets, lots, events, authorizations, jobs, and refunds are separated by mode. Sandbox activity never writes live balances or invoices. Test checkout is administrator-only. Regular users can still revoke their live recharge agreement and remove saved live cards when the platform switches to test mode.

## Automatic recharge

Recharge is off per user until explicit consent. Users choose an owned reusable saved card, pack, positive threshold below the pack quantity, and 1–10 purchases per calendar month. Defaults are 50 credits and three purchases. The UI displays the exact charge and maximum monthly spend. Calendar-month accounting uses PostgreSQL's configured timezone; use UTC consistently in production.

There is at most one unresolved automatic charge per user/mode and one charge attempt per rolling 24 hours. Successful and unresolved submissions count against the monthly limit. Definitively failed submissions release the monthly reservation, while the cooldown still applies. Workers recheck account status, balance, consent, authorization expiry, mode, current pricing, limits, and integration availability before submitting a stored order reference.

Expired cards and declines pause recharge and notify the user. Pack quantity/price changes and currency/conversion changes require renewed consent. Removing a card disables its agreement. Disabling recharge prevents new submissions; an already-submitted charge can still settle.

Only Paystack authorizations marked reusable are retained, encrypted with the original transaction email. No full card details or authorization secrets are returned to the browser. Manual mobile-money purchases do not imply automatic-charge support. See [Paystack recurring charges](https://paystack.com/docs/payments/recurring-charges/).

## Refunds and account review

Administrators can request a full original-amount refund only for a verified, completely unused purchase. The lot is reserved before the provider request. Pending, processing, unknown, and needs-attention refunds keep credits unavailable. Confirmed failure releases the reservation; confirmed processing completion reverses credits and receipt status once. Refund requests and administrative changes are audited.

Refund outcomes are reconciled through Paystack rather than trusting webhook amounts alone. Partial external reversals and disputes freeze affected credits for review. An external processed refund after usage blocks spending without creating a negative balance. Admin monitoring lists incidents. Its reconciliation operation can write off only remaining credits after a confirmed external refund, or unblock a reconciled balance after a failed reversal; every resolution requires an audit reason. Unresolved provider disputes and partial reversals remain blocked until provider/account reconciliation is completed; the application does not decide dispute outcomes or initiate partial refunds.

Legacy purchased balances are backfilled into non-expiring lots. Their historical usage cannot be inferred safely, so legacy lots are not automatically refundable. Existing ledger history is copied into the mode-aware activity store. Balance/lot/ledger mismatches create incidents and block spending for review rather than silently discarding balances.

See [Paystack refunds](https://paystack.com/docs/payments/refunds/). Submitting a refund does not mean the customer has received funds.

## Interfaces

- Existing `/api/credits/packs`, `/balance`, `/purchase`, `/history`, and `/auto-recharge` now use the database catalog and transactional accounting. Existing balance and reset fields remain for compatibility.
- New `/api/credits/purchases` and `/receipts/:reference` are owner-scoped. History endpoints use opaque cursors and 25-row pages.
- New `/api/credits/payment-methods` lists masked cards; `DELETE /:id` removes a card and disables its agreement.
- Admin `/api/admin/credit-packs` supports listing/creation and `PUT /:id` editing, including active status and display order.
- Admin `/api/admin/credit-purchases` lists mode-filtered purchases; `POST /:reference/refund` requests a full refund with a reason.
- Admin `/api/admin/credits/monitoring` exposes operational counts and unresolved incidents. `POST /incidents/:id/resolve` supports audited reconciliation.
- The existing Paystack verification and webhook URLs are retained. Credit checkout returns to `/credits?paystack_reference=...`; plan checkout still returns to Billing.

## Rollout configuration

Migrations run after the existing payment migrations at startup. They are additive and repeatable; catalog seeding does not overwrite administrator edits. Initial backfills are conservative and retain original purchase records.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CREDITS_MANUAL_TEST_ENABLED` | true | New sandbox checkouts |
| `CREDITS_MANUAL_LIVE_ENABLED` | true | New live checkouts |
| `CREDITS_RECHARGE_TEST_ENABLED` | false | Sandbox automatic charges |
| `CREDITS_RECHARGE_LIVE_ENABLED` | false | Live automatic charges |
| `CREDITS_REFUNDS_TEST_ENABLED` | false | New sandbox refund requests |
| `CREDITS_REFUNDS_LIVE_ENABLED` | false | New live refund requests |

Configure Paystack keys, merchant currency, conversion rate and `VITE_APP_URL` as before. Keep the webhook at `/api/payments/paystack/webhook`. First enable test flags and exercise checkout, reusable-card charging, webhook replays, and refund status changes in the merchant's sandbox. Then perform an operator-controlled live purchase, recharge, and refund before enabling live recharge/refunds for customers. No actual merchant transaction was performed during implementation.

Rollback sets the new-operation flags to false. Existing orders, webhook processing, and reconciliation continue so accepted payments are not stranded. The worker runs immediately after startup and every five minutes, with durable claims protecting multiple instances.

Admin monitoring and structured `credit_operations_attention` logs expose stale payments, unresolved recharges, failed events, old refund reservations, and accounting incidents. Connect these logs to the production alert destination; no external alerting account was configured by this change.

## Validation

- Real PostgreSQL suite passes with mocked Paystack calls, including fresh-schema migrations and upgrade paths.
- Tests cover Free-user eligibility, invalid/stale inputs, account and reference boundaries, exactly-once fulfillment, FIFO spending, negative reset deltas, purchased rollover, concurrency, card consent, expiration, limits, cooldown, mode switches, FX changes, original authorization email, timeout recovery, refunds, external reversals, and administrative reconciliation.
- Full application build and Docker build pass with strict TypeScript checks.
- Browser checks pass on desktop and mobile: four packs, currency amounts, explicit recharge consent, pending verification, sandbox completion, receipt download, checkout error recovery, reused idempotency keys, pack editing, refund requests, overflow and browser errors.

Evidence is stored beside this report in `credits-tests-final.txt`, `credits-tests-fresh.txt`, `credits-build.txt`, `credits-docker-build.txt`, `credits-browser-result.json`, and screenshots. Production deployment retains the staged recharge/refund gates until merchant-account verification is complete.
