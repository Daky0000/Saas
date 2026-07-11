# Launch Checklist

Items the code cannot verify for you. Work through these before opening the
platform to real customers. The API also logs `launch_check:` warnings at boot
in production for the config gaps it *can* detect (see
`runProductionReadinessChecks` in `packages/api/src/server.ts`).

## 1. Error monitoring (Sentry)

- [ ] Create a Sentry project (or self-hosted equivalent) for the API and one for the web app.
- [ ] Set `SENTRY_DSN` in the Railway API service environment.
- [ ] Set `VITE_SENTRY_DSN` in the web build environment (it's baked in at build time).
- [ ] Trigger a test error after deploy and confirm it arrives.
- Both integrations are complete no-ops when the DSN is unset — nothing breaks if you defer this, you're just flying blind.

## 2. Stripe — live mode

- [ ] Swap test keys for live keys (Admin → Platform Settings → stripe, or `STRIPE_SECRET_KEY` env fallback).
- [ ] Create a **live-mode** webhook endpoint in the Stripe dashboard pointing at `https://<api-domain>/webhooks/stripe` with events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`.
- [ ] Store the live webhook signing secret (platform config `webhookSecret` or `STRIPE_WEBHOOK_SECRET`).
- [ ] Ensure every pricing plan row has live `stripe_price_id` / `stripe_annual_price_id` values (test-mode price IDs do not exist in live mode).
- [ ] Run one real end-to-end purchase: checkout → subscription active → invoice recorded → cancel → plan removed.

## 3. Email deliverability

- [ ] Verify the sending domain in Resend (SPF + DKIM DNS records) — unverified domains land in spam or get rejected.
- [ ] Add a DMARC record (`p=none` minimum) for the sending domain.
- [ ] Configure the Resend webhook (`https://<api-domain>/webhooks/resend`) **with its signing secret** — unsigned engagement events are discarded in production by design.
- [ ] Send a test campaign to Gmail/Outlook addresses and check inbox placement + the unsubscribe link.

## 4. Social platform app reviews

Publishing only works for real users once each platform's app is approved for
production scopes. For each platform you market:

- [ ] **Meta (Facebook/Instagram/Threads)**: App Review passed for publishing scopes; app switched to Live mode; webhook verify token + app secret set (`META_WEBHOOK_VERIFY_TOKEN`, `FACEBOOK_APP_SECRET`).
- [ ] **TikTok**: audit passed. Note: text-only posts land in the user's TikTok **drafts** (API limitation) — the UI says so; don't market it as direct publishing.
- [ ] **LinkedIn**: Marketing Developer Platform access approved.
- [ ] **Twitter/X**: paid API tier active; `TWITTER_MONTHLY_WRITE_LIMIT` set to match it.
- [ ] **Pinterest**: trial → standard API access granted.
- [ ] Test one real post per approved platform with a non-admin account.

## 5. Database

- [ ] Confirm Railway Postgres automated backups are enabled; note the retention window.
- [ ] Do one restore drill (restore to a scratch instance, check row counts).
- [ ] Confirm `ENABLE_TEST_USER_CREDITS` is **unset** in production (the "User One" 1M-credit grant is off by default; the flag exists for dev/test only).
- [ ] If a test "User One" account exists in the production DB with granted credits, zero it out or delete the account.

## 6. Feature surface honesty

- [ ] Connector sync (CRM/ecommerce data sync jobs) has **no provider adapters yet** — manual runs return 501 with an explanatory message and the scheduler is a no-op. Don't list data sync as a live feature on pricing/marketing pages until adapters ship.
- [ ] Platforms without a publish implementation fail with "publishing is not implemented yet" — only market the platforms in section 4 you've actually approved and tested.

## 7. Final smoke test (production, non-admin account)

- [ ] Sign up → verify email flow → log in.
- [ ] Forgot password → reset link works.
- [ ] Buy a plan (live Stripe) → credits/plan reflected.
- [ ] Connect one social account → publish one post.
- [ ] Send one mailing campaign → open/click shows up in analytics.
- [ ] Generate one AI content piece → credits deducted correctly.
