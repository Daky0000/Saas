import { createHmac, timingSafeEqual } from 'crypto';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { Router } from 'express';
import axios from 'axios';
import type { Pool } from 'pg';
import type Stripe from 'stripe';
import { config } from '../config.ts';
import { logger } from '../logger.ts';

export interface WebhookDeps {
  stripe: Stripe | null;
  getStripeWebhookSecret: () => string;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
  pool: Pool | null;
  requireAuth: (req: Request, res: Response) => { userId: string } | null;
  markSocialAccountNeedsReapproval: (params: { platformId: string; accountId?: string | null; userId?: string | null; reason?: string; disconnect?: boolean }) => Promise<void>;
  logIntegrationEvent: (params: { userId: string | null; integrationSlug: string | null; eventType: string; status: 'success' | 'failed' | 'info'; response?: any }) => Promise<void>;
  decryptIntegrationSecret: (encrypted: string) => string;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  fireAutomationTrigger: (userId: string, triggerType: string, contact: { id?: string | null; email?: string }) => Promise<void>;
  recalcLeadScore: (pool: Pool | null, userId: string, contactId: string) => Promise<number | null>;
}

// ─── Local helpers ─────────────────────────────────────────────────────────────

async function syncStripeSubscription(
  userId: string,
  sub: Stripe.Subscription,
  dbQuery: WebhookDeps['dbQuery'],
): Promise<void> {
  const priceId = sub.items.data[0]?.price?.id;
  const periodStart = new Date(sub.current_period_start * 1000).toISOString();
  const periodEnd = new Date(sub.current_period_end * 1000).toISOString();
  const { rows: plans } = await dbQuery(
    `SELECT id FROM pricing_plans WHERE stripe_price_id=$1 OR stripe_annual_price_id=$1 LIMIT 1`,
    [priceId]
  );
  const planId = plans[0]?.id || null;
  await dbQuery(
    `INSERT INTO subscriptions (id, user_id, plan_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_start, current_period_end, cancel_at_period_end, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       plan_id=EXCLUDED.plan_id, stripe_subscription_id=EXCLUDED.stripe_subscription_id,
       stripe_price_id=EXCLUDED.stripe_price_id, status=EXCLUDED.status,
       current_period_start=EXCLUDED.current_period_start, current_period_end=EXCLUDED.current_period_end,
       cancel_at_period_end=EXCLUDED.cancel_at_period_end, updated_at=NOW()`,
    [randomUUID(), userId, planId, sub.customer, sub.id, priceId, sub.status, periodStart, periodEnd, sub.cancel_at_period_end]
  );
  if (planId) await dbQuery(`UPDATE users SET plan_id=$1, stripe_customer_id=$2 WHERE id=$3`, [planId, sub.customer, userId]);
}

async function upsertBillingInvoice(
  inv: Stripe.Invoice,
  dbQuery: WebhookDeps['dbQuery'],
): Promise<void> {
  const userId: string | null = (inv.metadata as any)?.user_id || null;
  if (!userId) return;
  const { rows: subRows } = await dbQuery(
    `SELECT id FROM subscriptions WHERE stripe_subscription_id=$1 LIMIT 1`,
    [typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id]
  );
  const subId = subRows[0]?.id || null;
  await dbQuery(
    `INSERT INTO billing_invoices (id, user_id, subscription_id, stripe_invoice_id, invoice_number, status, subtotal_cents, tax_cents, total_cents, currency, hosted_invoice_url, invoice_pdf, period_start, period_end, paid_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (stripe_invoice_id) DO UPDATE SET
       status=EXCLUDED.status, paid_at=EXCLUDED.paid_at, hosted_invoice_url=EXCLUDED.hosted_invoice_url, invoice_pdf=EXCLUDED.invoice_pdf`,
    [
      randomUUID(), userId, subId, inv.id, inv.number, inv.status,
      inv.subtotal || 0, inv.tax || 0, inv.total || 0, inv.currency || 'usd',
      inv.hosted_invoice_url || null, inv.invoice_pdf || null,
      inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
      inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
      inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000).toISOString() : null,
    ]
  ).catch(() => undefined);
}

// Resend signs webhooks with Svix: base64 HMAC-SHA256 of "{id}.{timestamp}.{body}"
// keyed by the base64 portion of the whsec_… secret. The signature header may
// contain several space-separated "v1,<sig>" entries.
function verifySvixSignature(req: Request, secret: string): boolean {
  const raw = (req as any).rawBody as Buffer | undefined;
  const svixId = String(req.headers['svix-id'] || '');
  const svixTimestamp = String(req.headers['svix-timestamp'] || '');
  const svixSignature = String(req.headers['svix-signature'] || '');
  if (!raw || !svixId || !svixTimestamp || !svixSignature) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const expected = createHmac('sha256', key).update(`${svixId}.${svixTimestamp}.${raw.toString('utf8')}`).digest('base64');
  return svixSignature.split(' ').some((part) => {
    const sig = part.includes(',') ? part.split(',')[1] : part;
    if (!sig || sig.length !== expected.length) return false;
    try { return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
  });
}

function verifyMetaWebhookSignature(req: Request, appSecret: string): boolean {
  if (!appSecret) return config.nodeEnv !== 'production';
  const signature = String(req.headers['x-hub-signature-256'] || req.headers['x-hub-signature'] || '').trim();
  if (!signature) return false;
  const raw = (req as any).rawBody as Buffer | undefined;
  if (!raw) return false;
  const provided = signature.includes('=') ? signature.split('=')[1] : signature;
  const expected = createHmac('sha256', appSecret).update(raw).digest('hex');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function registerWebhookRoutes(deps: WebhookDeps): Router {
  const {
    stripe, getStripeWebhookSecret, hasDatabase, dbQuery, pool,
    requireAuth, markSocialAccountNeedsReapproval, logIntegrationEvent, decryptIntegrationSecret,
  } = deps;

  const router = Router();

  // POST /webhooks/stripe
  router.post('/webhooks/stripe', async (req: Request, res: Response) => {
    if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
    const sig = req.headers['stripe-signature'] as string;
    const rawBody = (req as any).rawBody as Buffer;
    if (!sig || !rawBody) return res.status(400).json({ error: 'Missing signature or body' });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, getStripeWebhookSecret());
    } catch (err: any) {
      logger.error('Stripe webhook signature error:', err.message);
      return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    if (hasDatabase()) {
      const { rows: existing } = await dbQuery(
        `SELECT id FROM billing_events WHERE stripe_event_id = $1`,
        [event.id]
      ).catch(() => ({ rows: [] }));
      if (existing.length) { res.json({ received: true }); return; }
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.mode === 'subscription' && session.subscription) {
            const sub = await stripe.subscriptions.retrieve(session.subscription as string, {
              expand: ['items.data.price.product'],
            });
            const userId = session.metadata?.user_id;
            if (userId && hasDatabase()) await syncStripeSubscription(userId, sub, dbQuery);
          }
          break;
        }
        case 'customer.subscription.updated': {
          const sub = event.data.object as Stripe.Subscription;
          const userId = sub.metadata?.user_id;
          if (userId && hasDatabase()) await syncStripeSubscription(userId, sub, dbQuery);
          break;
        }
        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription;
          const userId = sub.metadata?.user_id;
          if (userId && hasDatabase()) {
            await dbQuery(
              `UPDATE subscriptions SET status='canceled', canceled_at=NOW(), updated_at=NOW() WHERE stripe_subscription_id=$1`,
              [sub.id]
            );
            await dbQuery(`UPDATE users SET plan_id=NULL WHERE id=$1`, [userId]);
          }
          break;
        }
        case 'invoice.payment_succeeded': {
          const inv = event.data.object as Stripe.Invoice;
          if (hasDatabase()) await upsertBillingInvoice(inv, dbQuery);
          break;
        }
        case 'invoice.payment_failed': {
          const inv = event.data.object as Stripe.Invoice;
          if (hasDatabase()) {
            await upsertBillingInvoice(inv, dbQuery);
            const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id;
            if (subId) {
              await dbQuery(
                `UPDATE subscriptions SET status='past_due', updated_at=NOW() WHERE stripe_subscription_id=$1`,
                [subId]
              );
            }
          }
          break;
        }
        default:
          break;
      }

      if (hasDatabase()) {
        const userId = (event.data.object as any).metadata?.user_id || null;
        await dbQuery(
          `INSERT INTO billing_events (id, user_id, event_type, stripe_event_id, data) VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), userId, event.type, event.id, JSON.stringify(event.data.object)]
        ).catch(() => undefined);
      }
    } catch (e) {
      logger.error('Stripe webhook handler error:', e);
    }

    res.json({ received: true });
  });

  // POST /webhooks/resend — email engagement events (opens, clicks, bounces).
  // Correlated back to user/campaign/contact via the resend_id stored in
  // mailing_email_events metadata at send time. Configure this URL + signing
  // secret in the Resend dashboard (secret: platform_configs resend.webhookSecret
  // or RESEND_WEBHOOK_SECRET env var).
  router.post('/webhooks/resend', async (req: Request, res: Response) => {
    res.status(200).json({ received: true });
    try {
      if (!pool) return;
      const cfg = await deps.getPlatformConfig('resend').catch(() => ({} as Record<string, string>));
      const secret = String(cfg.webhookSecret || process.env.RESEND_WEBHOOK_SECRET || '').trim();
      if (secret) {
        if (!verifySvixSignature(req, secret)) {
          logger.warn('Resend webhook: invalid signature — discarding');
          return;
        }
      } else {
        logger.warn('Resend webhook: no signing secret configured — processing unverified event');
      }

      const type = String(req.body?.type || '');
      const eventMap: Record<string, string> = {
        'email.opened': 'open',
        'email.clicked': 'click',
        'email.bounced': 'bounced',
        'email.complained': 'complained',
      };
      const eventType = eventMap[type];
      if (!eventType) return; // delivered/delayed/etc — already tracked at send time

      const resendId = String(req.body?.data?.email_id || '').trim();
      if (!resendId) return;
      const { rows: origin } = await pool.query(
        `SELECT user_id, campaign_id, contact_id FROM mailing_email_events
         WHERE event_type='delivered' AND metadata->>'resend_id'=$1 LIMIT 1`,
        [resendId]
      );
      if (!origin.length) return; // sent before correlation existed, or not ours
      const { user_id: userId, campaign_id: campaignId, contact_id: contactId } = origin[0];

      // Opens fire repeatedly (every image load) — record only the first per email.
      if (eventType === 'open') {
        const { rows: dup } = await pool.query(
          `SELECT 1 FROM mailing_email_events WHERE event_type='open' AND metadata->>'resend_id'=$1 LIMIT 1`,
          [resendId]
        );
        if (dup.length) return;
      }

      const link = eventType === 'click' ? String(req.body?.data?.click?.link || '') : null;
      await pool.query(
        `INSERT INTO mailing_email_events (id, user_id, campaign_id, contact_id, event_type, metadata, created_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())`,
        [randomUUID(), userId, campaignId, contactId, eventType, JSON.stringify({ resend_id: resendId, ...(link ? { link } : {}) })]
      );

      if (contactId) {
        const { rows: contactRows } = await pool.query(
          `SELECT email FROM mailing_contacts WHERE id=$1 AND user_id=$2`, [contactId, userId]
        );
        const contact = { id: contactId, email: contactRows[0]?.email };

        if (eventType === 'open') {
          await deps.fireAutomationTrigger(userId, 'email_opened', contact);
        } else if (eventType === 'click') {
          await deps.fireAutomationTrigger(userId, 'link_click', contact);
        } else {
          // Bounce/complaint → suppress so campaigns and automations stop emailing them
          await pool.query(
            `UPDATE mailing_contacts SET subscribed=false, unsubscribed_at=NOW(),
             custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('suppression_reason', $1::text),
             updated_at=NOW() WHERE id=$2 AND user_id=$3`,
            [eventType, contactId, userId]
          );
          await deps.recalcLeadScore(pool, userId, contactId);
        }
      }
    } catch (err) {
      logger.error({ err }, 'resend_webhook_error');
    }
  });

  // GET /webhooks/meta + GET /api/v1/webhooks/facebook — Meta webhook verification
  const metaVerify = (req: Request, res: Response) => {
    const mode = String(req.query['hub.mode'] || '').trim();
    const token = String(req.query['hub.verify_token'] || '').trim();
    const challenge = String(req.query['hub.challenge'] || '').trim();
    const verifyToken = config.metaWebhookVerifyToken;
    if (mode === 'subscribe' && verifyToken && token === verifyToken) return res.status(200).send(challenge);
    return res.status(403).send('Forbidden');
  };
  router.get('/webhooks/meta', metaVerify);
  router.get('/api/v1/webhooks/facebook', metaVerify);

  // POST /webhooks/meta
  router.post('/webhooks/meta', async (req: Request, res: Response) => {
    res.status(200).json({ ok: true });
    try {
      const appSecret = config.facebookAppSecret;
      if (!verifyMetaWebhookSignature(req, appSecret)) {
        logger.warn('Meta webhook: invalid or missing signature — discarding');
        return;
      }

      const payload = req.body || {};
      const objectType = String(payload?.object || '').toLowerCase();
      const eventType = String(payload?.event?.type || payload?.type || '').toLowerCase();
      const eventUserId = String(payload?.event?.user_id || payload?.user_id || payload?.event?.userId || '').trim();
      const eventPlatform = objectType === 'instagram' ? 'instagram' : 'facebook';

      if (eventUserId && (eventType === 'permissions_revoked' || eventType === 'deauthorized' || eventType === 'user_deauthorized')) {
        await markSocialAccountNeedsReapproval({ platformId: eventPlatform, accountId: eventUserId, reason: eventType, disconnect: true });
        return;
      }

      if (Array.isArray(payload?.entry)) {
        for (const entry of payload.entry) {
          const entryId = String(entry?.id || '').trim();
          const changes = Array.isArray(entry?.changes) ? entry.changes : [];
          const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];

          for (const change of changes) {
            const field = String(change?.field || '').toLowerCase();
            const value = change?.value || {};

            const isDeauth = field === 'permissions' && (value?.verb === 'remove' || value?.verb === 'revoke' || value?.is_enabled === false);
            if (isDeauth && entryId) {
              await markSocialAccountNeedsReapproval({ platformId: eventPlatform, accountId: entryId, reason: 'permissions_revoked', disconnect: true });
              continue;
            }

            if (field === 'feed' && pool) {
              const verb = String(value?.verb || '').toLowerCase();
              const itemType = String(value?.item || '').toLowerCase();
              const postId = String(value?.post_id || value?.video_id || '').trim();
              const commentId = String(value?.comment_id || '').trim();
              if (postId) {
                await logIntegrationEvent({ userId: null, integrationSlug: 'facebook', eventType: `page_feed_${itemType}_${verb}`, status: 'success', response: { pageId: entryId, postId, commentId: commentId || null, raw: value } }).catch(() => undefined);
              }
            }
            if (field === 'mention' && pool) {
              await logIntegrationEvent({ userId: null, integrationSlug: 'facebook', eventType: 'page_mention', status: 'success', response: { pageId: entryId, raw: value } }).catch(() => undefined);
            }
            if (field === 'ratings' && pool) {
              await logIntegrationEvent({ userId: null, integrationSlug: 'facebook', eventType: 'page_rating', status: 'success', response: { pageId: entryId, raw: value } }).catch(() => undefined);
            }
          }

          for (const msg of messaging) {
            if (msg?.message && pool) {
              await logIntegrationEvent({ userId: null, integrationSlug: 'facebook', eventType: 'page_message', status: 'success', response: { pageId: entryId, senderId: String(msg?.sender?.id || ''), raw: msg } }).catch(() => undefined);
            }
          }
        }
      }
    } catch (err) {
      logger.error('Meta webhook processing error:', err);
    }
  });

  // POST /api/v1/webhooks/facebook — alias for Meta POST
  router.post('/api/v1/webhooks/facebook', async (req: Request, res: Response) => {
    res.status(200).json({ ok: true });
    try {
      const appSecret = config.facebookAppSecret;
      if (!verifyMetaWebhookSignature(req, appSecret)) {
        logger.warn('Facebook v1 webhook: invalid or missing signature — discarding');
        return;
      }
      const payload = req.body || {};
      if (Array.isArray(payload?.entry)) {
        for (const entry of payload.entry) {
          const entryId = String(entry?.id || '').trim();
          const changes = Array.isArray(entry?.changes) ? entry.changes : [];
          for (const change of changes) {
            const field = String(change?.field || '').toLowerCase();
            const value = change?.value || {};
            const isDeauth = field === 'permissions' && (value?.verb === 'remove' || value?.verb === 'revoke' || value?.is_enabled === false);
            if (isDeauth && entryId) {
              await markSocialAccountNeedsReapproval({ platformId: 'facebook', accountId: entryId, reason: 'permissions_revoked', disconnect: true });
            }
          }
        }
      }
    } catch (err) {
      logger.error('Facebook v1 webhook error:', err);
    }
  });

  // POST /api/v1/social/facebook/webhook-subscribe
  router.post('/api/v1/social/facebook/webhook-subscribe', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!pool) return res.status(503).json({ success: false, error: 'Database not configured' });

      const pageId = String(req.body?.page_id || '').trim();
      if (!pageId) return res.status(400).json({ success: false, error: 'page_id is required' });

      const pageResult = await pool.query(
        `SELECT access_token, access_token_encrypted
         FROM social_accounts
         WHERE user_id=$1 AND platform='facebook' AND account_type='page' AND account_id=$2 AND connected=true
         LIMIT 1`,
        [auth.userId, pageId]
      );
      const row: any = pageResult.rows[0] || {};
      let pageToken = '';
      if (row.access_token_encrypted) {
        try { pageToken = decryptIntegrationSecret(String(row.access_token_encrypted)); } catch (_err) { /* ignore */ }
      }
      if (!pageToken) pageToken = String(row.access_token || '').trim();
      if (!pageToken) return res.status(400).json({ success: false, error: 'Page token not available — save the page first' });

      const subscribeResp = await axios.post(
        `https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/subscribed_apps`,
        new URLSearchParams({ subscribed_fields: 'feed,mention,ratings,messages', access_token: pageToken }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true, timeout: 15000 }
      );
      const subData: any = subscribeResp.data || {};
      if (subscribeResp.status >= 400) {
        const msg = subData?.error?.message || `Facebook subscription failed (${subscribeResp.status})`;
        return res.status(400).json({ success: false, error: msg });
      }

      await logIntegrationEvent({ userId: auth.userId, integrationSlug: 'facebook', eventType: 'webhook_subscribe', status: 'success', response: { pageId, fields: 'feed,mention,ratings,messages' } });
      return res.json({ success: true, pageId, subscribed: subData?.success ?? true });
    } catch (err) {
      logger.error('v1 facebook webhook-subscribe error:', err);
      return res.status(500).json({ success: false, error: 'Failed to subscribe page to webhooks' });
    }
  });

  return router;
}
