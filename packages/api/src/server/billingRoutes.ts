import express from 'express';
import type Stripe from 'stripe';
import type { Router, Request, Response } from 'express';
import { logger } from '../logger.ts';

type AuthResult = { userId: string; email?: string } | null;
type RequireAuthFn = (req: Request, res: Response) => AuthResult;
type DbQueryFn = <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }>;

type BillingDeps = {
  requireAuth: RequireAuthFn;
  hasDatabase: () => boolean;
  dbQuery: DbQueryFn;
  stripe: Stripe | null;
  getOrCreateStripeCustomer: (userId: string, email: string, name: string | null) => Promise<string>;
};

/**
 * Registers all billing routes and returns the Express Router.
 * Mount at canonical + compat paths:
 *   app.use('/api/v1/billing', billingRouter);
 *   app.use('/api/billing', deprecate(), billingRouter);
 */
export function registerBillingRoutes({
  requireAuth,
  hasDatabase,
  dbQuery,
  stripe,
  getOrCreateStripeCustomer,
}: BillingDeps): Router {
  const router = express.Router();

  // GET /subscription — current plan + usage + subscription status
  router.get('/subscription', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, subscription: null, plan: null, usage: null });
    try {
      const { rows: subRows } = await dbQuery(
        `SELECT s.*, p.name AS plan_name, p.price, p.billing_period, p.features, p.post_limit, p.user_limit
         FROM subscriptions s
         LEFT JOIN pricing_plans p ON p.id = s.plan_id
         WHERE s.user_id = $1`,
        [auth.userId],
      );
      const { rows: userRows } = await dbQuery(
        `SELECT u.id, u.stripe_customer_id, p.name AS plan_name, p.price, p.billing_period, p.features, p.post_limit, p.user_limit, p.id AS plan_id
         FROM users u LEFT JOIN pricing_plans p ON p.id = u.plan_id WHERE u.id=$1`,
        [auth.userId],
      );
      const user = (userRows as any[])[0];
      const sub = (subRows as any[])[0] || null;

      const { rows: usageRows } = await dbQuery(
        `SELECT COUNT(*)::int AS posts_this_period FROM social_posts WHERE user_id=$1 AND created_at >= date_trunc('month', NOW())`,
        [auth.userId],
      ).catch(() => ({ rows: [{ posts_this_period: 0 }] }));

      const postLimit = sub?.post_limit ?? user?.post_limit ?? null;
      const usage = {
        posts_this_period: (usageRows as any[])[0]?.posts_this_period ?? 0,
        posts_limit: postLimit,
      };

      res.json({
        success: true,
        subscription: sub,
        plan: sub
          ? { id: sub.plan_id, name: sub.plan_name, price: sub.price, billing_period: sub.billing_period, features: sub.features, post_limit: sub.post_limit, user_limit: sub.user_limit }
          : (user?.plan_id ? { id: user.plan_id, name: user.plan_name, price: user.price, billing_period: user.billing_period, features: user.features, post_limit: user.post_limit, user_limit: user.user_limit } : null),
        usage,
        stripeConfigured: Boolean(stripe),
      });
    } catch (_e) {
      res.status(500).json({ success: false, error: 'Failed to load subscription' });
    }
  });

  // GET /invoices
  router.get('/invoices', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, invoices: [] });
    try {
      const { rows } = await dbQuery(
        `SELECT id, stripe_invoice_id, invoice_number, status, total_cents, currency, hosted_invoice_url, invoice_pdf, paid_at, period_start, period_end, created_at
         FROM billing_invoices WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
        [auth.userId],
      );
      res.json({ success: true, invoices: rows });
    } catch (_e) {
      res.status(500).json({ success: false, error: 'Failed to load invoices' });
    }
  });

  // POST /checkout — create Stripe Checkout session for a plan
  router.post('/checkout', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!stripe) return res.status(503).json({ success: false, error: 'Stripe is not configured on this server.' });
    const { planId, period = 'monthly' } = req.body as { planId: string; period?: 'monthly' | 'yearly' };
    if (!planId) return res.status(400).json({ success: false, error: 'planId is required' });
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { rows: planRows } = await dbQuery(
        `SELECT * FROM pricing_plans WHERE id=$1 AND is_active=true`,
        [planId],
      );
      if (!(planRows as any[]).length) return res.status(404).json({ success: false, error: 'Plan not found' });
      const plan = (planRows as any[])[0];
      const stripePriceId = period === 'yearly' ? (plan.stripe_annual_price_id || plan.stripe_price_id) : plan.stripe_price_id;
      if (!stripePriceId) return res.status(400).json({ success: false, error: 'This plan is not yet configured for Stripe payments. Please contact support.' });

      const { rows: userRows } = await dbQuery(`SELECT email, full_name FROM users WHERE id=$1`, [auth.userId]);
      if (!(userRows as any[]).length) return res.status(404).json({ success: false, error: 'User not found' });
      const userRow = (userRows as any[])[0];

      const stripeCustomerId = await getOrCreateStripeCustomer(auth.userId, userRow.email, userRow.full_name);
      const appUrl = process.env.FRONTEND_ORIGIN || 'https://marketing.dakyworld.com';

      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode: 'subscription',
        line_items: [{ price: stripePriceId, quantity: 1 }],
        success_url: `${appUrl}/billing?session_id={CHECKOUT_SESSION_ID}&success=1`,
        cancel_url: `${appUrl}/pricing`,
        metadata: { user_id: auth.userId, plan_id: planId },
        subscription_data: { metadata: { user_id: auth.userId, plan_id: planId } },
        allow_promotion_codes: true,
      });

      res.json({ success: true, url: session.url });
    } catch (e: any) {
      logger.error({ err: e }, 'stripe_checkout_error');
      res.status(500).json({ success: false, error: e.message || 'Failed to create checkout session' });
    }
  });

  // POST /portal — open Stripe Customer Portal
  router.post('/portal', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!stripe) return res.status(503).json({ success: false, error: 'Stripe is not configured.' });
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const { rows: userRows } = await dbQuery(
        `SELECT email, full_name, stripe_customer_id FROM users WHERE id=$1`,
        [auth.userId],
      );
      if (!(userRows as any[]).length) return res.status(404).json({ success: false, error: 'User not found' });
      const userRow = (userRows as any[])[0];
      const stripeCustomerId = userRow.stripe_customer_id || await getOrCreateStripeCustomer(auth.userId, userRow.email, userRow.full_name);
      const appUrl = process.env.FRONTEND_ORIGIN || 'https://marketing.dakyworld.com';
      const session = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: `${appUrl}/billing`,
      });
      res.json({ success: true, url: session.url });
    } catch (e: any) {
      logger.error({ err: e }, 'stripe_portal_error');
      res.status(500).json({ success: false, error: e.message || 'Failed to open billing portal' });
    }
  });

  // POST /cancel — cancel subscription at period end
  router.post('/cancel', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!stripe || !hasDatabase()) return res.status(503).json({ success: false, error: 'Stripe not configured' });
    try {
      const { rows } = await dbQuery(
        `SELECT stripe_subscription_id FROM subscriptions WHERE user_id=$1 AND status='active'`,
        [auth.userId],
      );
      if (!(rows as any[]).length || !(rows as any[])[0].stripe_subscription_id) {
        return res.status(404).json({ success: false, error: 'No active subscription' });
      }
      await stripe.subscriptions.update((rows as any[])[0].stripe_subscription_id, { cancel_at_period_end: true });
      await dbQuery(`UPDATE subscriptions SET cancel_at_period_end=true, updated_at=NOW() WHERE user_id=$1`, [auth.userId]);
      res.json({ success: true, message: 'Subscription will be canceled at the end of the billing period.' });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message || 'Failed to cancel subscription' });
    }
  });

  // POST /reactivate — undo cancel
  router.post('/reactivate', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!stripe || !hasDatabase()) return res.status(503).json({ success: false, error: 'Stripe not configured' });
    try {
      const { rows } = await dbQuery(
        `SELECT stripe_subscription_id FROM subscriptions WHERE user_id=$1`,
        [auth.userId],
      );
      if (!(rows as any[]).length || !(rows as any[])[0].stripe_subscription_id) {
        return res.status(404).json({ success: false, error: 'No subscription found' });
      }
      await stripe.subscriptions.update((rows as any[])[0].stripe_subscription_id, { cancel_at_period_end: false });
      await dbQuery(`UPDATE subscriptions SET cancel_at_period_end=false, updated_at=NOW() WHERE user_id=$1`, [auth.userId]);
      res.json({ success: true, message: 'Subscription reactivated.' });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message || 'Failed to reactivate subscription' });
    }
  });

  return router;
}
