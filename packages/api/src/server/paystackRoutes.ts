import express from 'express';
import type { Router, Request, Response } from 'express';
import axios from 'axios';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { logger } from '../logger.ts';

// Paystack REST API (paystack.com/docs). All requests carry
// `Authorization: Bearer <secret key>`; amounts are in subunits
// (pesewas/kobo/cents). Base overridable for tests / API moves.
const PAYSTACK_BASE = process.env.PAYSTACK_API_BASE || 'https://api.paystack.co';

type AuthResult = { userId: string; role?: string } | null;

interface PaystackDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
}

export interface PaystackConfig {
  secretKey: string;
  publicKey: string;
  currency: string;
  fxRate: number;
}

export async function getPaystackConfig(
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>
): Promise<PaystackConfig | null> {
  const cfg = await getPlatformConfig('paystack').catch(() => ({} as Record<string, string>));
  const secretKey = cfg.secretKey || process.env.PAYSTACK_SECRET_KEY || '';
  if (!secretKey) return null;
  return {
    secretKey,
    publicKey: cfg.publicKey || process.env.PAYSTACK_PUBLIC_KEY || '',
    currency: (cfg.currency || 'GHS').toUpperCase(),
    // Plan prices are stored in USD-ish units; fxRate converts to the charge
    // currency at checkout (e.g. 15.5 to charge GHS for a $ price). 1 = face value.
    fxRate: Number(cfg.fxRate) > 0 ? Number(cfg.fxRate) : 1,
  };
}

function paystackHeaders(secretKey: string) {
  return { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' };
}

async function initializeTransaction(cfg: PaystackConfig, params: {
  email: string;
  amountSubunits: number;
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: boolean; authorizationUrl?: string; accessCode?: string; error?: string; raw?: any }> {
  try {
    const r = await axios.post(
      `${PAYSTACK_BASE}/transaction/initialize`,
      {
        email: params.email,
        amount: params.amountSubunits,
        currency: cfg.currency,
        reference: params.reference,
        ...(params.callbackUrl ? { callback_url: params.callbackUrl } : {}),
        ...(params.metadata ? { metadata: params.metadata } : {}),
      },
      { headers: paystackHeaders(cfg.secretKey), validateStatus: () => true, timeout: 20000 }
    );
    if (r.status >= 400 || !r.data?.status) {
      return { ok: false, error: r.data?.message || `Paystack returned HTTP ${r.status}`, raw: r.data };
    }
    return {
      ok: true,
      authorizationUrl: r.data?.data?.authorization_url,
      accessCode: r.data?.data?.access_code,
      raw: r.data,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Paystack request failed' };
  }
}

// success | failed | abandoned | ongoing | ... → our payment_transactions vocabulary
function mapPaystackStatus(status: string): 'successful' | 'pending' | 'failed' {
  const s = String(status || '').toLowerCase();
  if (s === 'success') return 'successful';
  if (['failed', 'reversed'].includes(s)) return 'failed';
  return 'pending';
}

/**
 * Plan checkout via Paystack — injected into the billing /checkout route so
 * paid plans work while Stripe activation is pending. Returns null when
 * Paystack is not configured (caller falls through to its own error).
 */
export function buildPaystackPlanCheckout({ dbQuery, getPlatformConfig }: Pick<PaystackDeps, 'dbQuery' | 'getPlatformConfig'>) {
  return async function paystackPlanCheckout(params: {
    userId: string;
    email: string;
    customerName: string | null;
    plan: { id: string; name: string; price: number; billing_period: string };
    appUrl: string;
  }): Promise<{ url: string } | null> {
    const cfg = await getPaystackConfig(getPlatformConfig);
    if (!cfg) return null;
    const { userId, email, customerName, plan, appUrl } = params;
    const reference = randomUUID();
    const chargeUnits = Math.round(plan.price * cfg.fxRate * 100) / 100;
    const amountSubunits = Math.round(chargeUnits * 100);
    if (amountSubunits <= 0) throw new Error('Plan price must be greater than zero for Paystack checkout');

    const init = await initializeTransaction(cfg, {
      email,
      amountSubunits,
      reference,
      callbackUrl: `${appUrl}/billing?paystack_reference=${reference}&success=1`,
      metadata: { user_id: userId, plan_id: plan.id, plan_name: plan.name, kind: 'plan_checkout' },
    });
    if (!init.ok || !init.authorizationUrl) throw new Error(init.error || 'Failed to initialize Paystack transaction');

    await dbQuery(
      `INSERT INTO payment_transactions
         (id, amount, currency, description, status, provider, client_reference, customer_name, customer_email, checkout_url, metadata)
       VALUES ($1,$2,$3,$4,'pending','paystack',$5,$6,$7,$8,$9)`,
      [
        randomUUID(), chargeUnits, cfg.currency, `${plan.name} plan`, reference,
        customerName, email, init.authorizationUrl,
        JSON.stringify({ plan_id: plan.id, user_id: userId, paystack: init.raw?.data ?? null }),
      ]
    ).catch((e) => logger.error('paystack txn insert failed:', e));

    return { url: init.authorizationUrl };
  };
}

export function registerPaystackRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, getPlatformConfig }: PaystackDeps): Router {
  const router = express.Router();

  // Activate the purchased plan once Paystack confirms payment. Used by both
  // the webhook (authoritative) and verify (covers missed webhooks).
  async function activatePlanFromCharge(data: any): Promise<void> {
    const meta = typeof data?.metadata === 'string'
      ? JSON.parse(data.metadata || '{}')
      : (data?.metadata ?? {});
    const userId = meta.user_id;
    const planId = meta.plan_id;
    if (!userId || !planId) return;

    const { rows: planRows } = await dbQuery<{ id: string; billing_period: string }>(
      `SELECT id, billing_period FROM pricing_plans WHERE id=$1`, [planId]
    );
    if (!planRows.length) return;
    const interval = planRows[0].billing_period === 'yearly' ? '1 year' : '1 month';

    await dbQuery(`UPDATE users SET plan_id=$1 WHERE id=$2`, [planId, userId]);
    await dbQuery(
      `INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_start, current_period_end, updated_at)
       VALUES ($1,$2,$3,'active',NOW(),NOW() + INTERVAL '${interval}',NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET plan_id=EXCLUDED.plan_id, status='active',
             current_period_start=NOW(), current_period_end=NOW() + INTERVAL '${interval}',
             cancel_at_period_end=false, canceled_at=NULL, updated_at=NOW()`,
      [randomUUID(), userId, planId]
    );
    await dbQuery(
      `INSERT INTO billing_invoices (id, user_id, status, subtotal_cents, total_cents, currency, paid_at)
       VALUES ($1,$2,'paid',$3,$3,$4,NOW())`,
      [randomUUID(), userId, Number(data?.amount) || 0, String(data?.currency || 'GHS').toLowerCase()]
    ).catch(() => undefined);
    logger.info({ userId, planId }, 'paystack_plan_activated');
  }

  // Shared by webhook + verify: sync a charge result onto payment_transactions
  async function recordChargeResult(data: any): Promise<void> {
    const reference = data?.reference;
    if (!reference) return;
    const status = mapPaystackStatus(data?.status);
    const { rows: txnRows } = await dbQuery<{ amount: string }>(
      `UPDATE payment_transactions
       SET status=$1, provider_reference=$2, updated_at=NOW(),
           metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
       WHERE client_reference=$4 AND provider='paystack'
       RETURNING amount`,
      [status, data?.id ? String(data.id) : null, JSON.stringify({ paystackResult: { status: data?.status, paid_at: data?.paid_at, channel: data?.channel } }), reference]
    );
    if (status !== 'successful') return;
    // Per the docs: verify the paid amount matches what we asked for before
    // delivering value (amounts compare in subunits).
    const expectedSubunits = txnRows.length ? Math.round(Number(txnRows[0].amount) * 100) : null;
    if (expectedSubunits !== null && Number(data?.amount) !== expectedSubunits) {
      logger.warn({ reference, expectedSubunits, paid: data?.amount }, 'paystack_amount_mismatch_no_activation');
      return;
    }
    await activatePlanFromCharge(data);
  }

  // POST /api/payments/paystack/initiate — one-off charge (amount in currency units)
  router.post('/payments/paystack/initiate', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
      const { amount, description } = req.body as { amount?: number; description?: string };
      if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, error: 'A positive amount is required' });

      const cfg = await getPaystackConfig(getPlatformConfig);
      if (!cfg) return res.status(503).json({ success: false, error: 'Paystack is not configured. Add your secret key in Admin > Payments.' });

      const { rows: userRows } = await dbQuery<{ email: string; full_name: string | null }>(
        `SELECT email, full_name FROM users WHERE id=$1`, [auth.userId]
      );
      if (!userRows.length) return res.status(404).json({ success: false, error: 'User not found' });

      const reference = randomUUID();
      const appUrl = process.env.FRONTEND_ORIGIN || 'https://marketing.dakyworld.com';
      const init = await initializeTransaction(cfg, {
        email: userRows[0].email,
        amountSubunits: Math.round(Number(amount) * 100),
        reference,
        callbackUrl: `${appUrl}/payments/success?provider=paystack&reference=${reference}`,
        metadata: { user_id: auth.userId, kind: 'one_off' },
      });
      if (!init.ok || !init.authorizationUrl) {
        return res.status(502).json({ success: false, error: init.error || 'Failed to initialize Paystack transaction' });
      }

      await dbQuery(
        `INSERT INTO payment_transactions
           (id, amount, currency, description, status, provider, client_reference, customer_name, customer_email, checkout_url, metadata)
         VALUES ($1,$2,$3,$4,'pending','paystack',$5,$6,$7,$8,$9)`,
        [
          randomUUID(), Number(amount), cfg.currency, description || 'Payment', reference,
          userRows[0].full_name, userRows[0].email, init.authorizationUrl,
          JSON.stringify({ user_id: auth.userId, paystack: init.raw?.data ?? null }),
        ]
      );
      return res.json({ success: true, checkoutUrl: init.authorizationUrl, reference });
    } catch (error: any) {
      logger.error('Paystack initiate error:', error?.response?.data || error);
      return res.status(502).json({ success: false, error: 'Failed to initiate payment' });
    }
  });

  // GET /api/payments/paystack/verify/:reference — poll a charge and sync state
  router.get('/payments/paystack/verify/:reference', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const { reference } = req.params;
      const cfg = await getPaystackConfig(getPlatformConfig);
      if (!cfg) return res.status(503).json({ success: false, error: 'Paystack is not configured' });

      const r = await axios.get(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: paystackHeaders(cfg.secretKey), validateStatus: () => true, timeout: 20000,
      });
      if (r.status >= 400 || !r.data?.status) {
        return res.status(404).json({ success: false, error: r.data?.message || 'Transaction not found' });
      }
      const data = r.data?.data;
      if (hasDatabase()) await recordChargeResult(data).catch((e) => logger.error('paystack verify sync failed:', e));
      return res.json({ success: true, status: mapPaystackStatus(data?.status), paystackStatus: data?.status });
    } catch (error) {
      logger.error('Paystack verify error:', error);
      return res.status(500).json({ success: false, error: 'Failed to verify payment' });
    }
  });

  // POST /api/payments/paystack/webhook — signature: HMAC-SHA512 of raw body
  // with the secret key, sent in x-paystack-signature. Must answer 200 fast.
  router.post('/payments/paystack/webhook', async (req: Request, res: Response) => {
    try {
      const cfg = await getPaystackConfig(getPlatformConfig);
      if (!cfg) return res.status(503).json({ received: false });

      const signature = String(req.headers['x-paystack-signature'] || '');
      const raw = (req as any).rawBody as Buffer | undefined;
      if (!signature || !raw) return res.status(400).json({ received: false });
      const expected = createHmac('sha512', cfg.secretKey).update(raw).digest('hex');
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        logger.warn('paystack_webhook_bad_signature');
        return res.status(401).json({ received: false });
      }

      const event = req.body as { event?: string; data?: any };
      if (event?.event === 'charge.success' && hasDatabase()) {
        await recordChargeResult(event.data).catch((e) => logger.error('paystack webhook sync failed:', e));
      } else {
        logger.info({ event: event?.event }, 'paystack_webhook_ignored');
      }
      return res.status(200).json({ received: true });
    } catch (error) {
      logger.error('Paystack webhook error:', error);
      // 200 so Paystack does not retry a permanently-failing payload forever
      return res.status(200).json({ received: true });
    }
  });

  // POST /api/admin/paystack/test — validate the secret key against the live API
  router.post('/admin/paystack/test', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const cfg = await getPaystackConfig(getPlatformConfig);
    if (!cfg) return res.status(400).json({ success: false, error: 'No Paystack secret key configured' });
    try {
      const r = await axios.get(`${PAYSTACK_BASE}/transaction?perPage=1`, {
        headers: paystackHeaders(cfg.secretKey), validateStatus: () => true, timeout: 15000,
      });
      if (r.status === 401) return res.json({ success: false, error: 'Invalid secret key (Paystack returned 401)' });
      if (r.status >= 400 || !r.data?.status) {
        return res.json({ success: false, error: r.data?.message || `Paystack returned HTTP ${r.status}` });
      }
      const mode = cfg.secretKey.startsWith('sk_live') ? 'live' : 'test';
      return res.json({ success: true, mode, currency: cfg.currency, totalTransactions: r.data?.meta?.total ?? null });
    } catch (error: any) {
      return res.status(502).json({ success: false, error: error?.message || 'Connection to Paystack failed' });
    }
  });

  return router;
}
