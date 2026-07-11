import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import Stripe from 'stripe';

const WEBHOOK_SECRET = 'whsec_test_secret';

type DbCall = { sql: string; params: any[] };

function makeDb(opts?: { duplicateEvent?: boolean }) {
  const calls: DbCall[] = [];
  const dbQuery = async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('FROM billing_events WHERE stripe_event_id')) {
      return { rows: opts?.duplicateEvent ? [{ id: 'evt-existing' }] : [] };
    }
    if (sql.includes('FROM pricing_plans')) return { rows: [{ id: 'plan-basic' }] };
    if (sql.includes('FROM subscriptions WHERE stripe_subscription_id')) return { rows: [{ id: 'sub-row-1' }] };
    return { rows: [] };
  };
  return { dbQuery, calls };
}

async function buildApp(opts?: { duplicateEvent?: boolean }) {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
  process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);
  const { registerWebhookRoutes } = await import('../src/server/webhookRoutes.ts');

  const stripe = new Stripe('sk_test_dummy', { apiVersion: '2025-05-28.basil' as any });
  const db = makeDb(opts);
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
  app.use(registerWebhookRoutes({
    stripe,
    getStripeWebhookSecret: () => WEBHOOK_SECRET,
    hasDatabase: () => true,
    dbQuery: db.dbQuery,
    pool: null,
    requireAuth: () => null,
    markSocialAccountNeedsReapproval: async () => undefined,
    logIntegrationEvent: async () => undefined,
    decryptIntegrationSecret: (s: string) => s,
    getPlatformConfig: async () => ({}),
    fireAutomationTrigger: async () => undefined,
    recalcLeadScore: async () => null,
  }));
  return { app, stripe, db };
}

function signedHeader(stripe: Stripe, payload: string): string {
  return stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
}

test('stripe webhook: missing signature is rejected with 400', async () => {
  const { app } = await buildApp();
  const res = await request(app)
    .post('/webhooks/stripe')
    .set('content-type', 'application/json')
    .send(JSON.stringify({ id: 'evt_x', type: 'checkout.session.completed' }));
  assert.equal(res.status, 400);
});

test('stripe webhook: invalid signature is rejected with 400', async () => {
  const { app, db } = await buildApp();
  const res = await request(app)
    .post('/webhooks/stripe')
    .set('stripe-signature', 't=1,v1=deadbeef')
    .set('content-type', 'application/json')
    .send(JSON.stringify({ id: 'evt_x', type: 'checkout.session.completed' }));
  assert.equal(res.status, 400);
  assert.equal(db.calls.length, 0, 'nothing may touch the DB on a forged event');
});

test('stripe webhook: checkout.session.completed upserts subscription + user plan', async () => {
  const { app, stripe, db } = await buildApp();
  (stripe.subscriptions as any).retrieve = async () => ({
    id: 'sub_123',
    customer: 'cus_123',
    status: 'active',
    cancel_at_period_end: false,
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_592_000,
    items: { data: [{ price: { id: 'price_123' } }] },
    metadata: { user_id: 'user-1' },
  });
  const payload = JSON.stringify({
    id: 'evt_checkout_1',
    type: 'checkout.session.completed',
    data: { object: { mode: 'subscription', subscription: 'sub_123', metadata: { user_id: 'user-1' } } },
  });
  const res = await request(app)
    .post('/webhooks/stripe')
    .set('stripe-signature', signedHeader(stripe, payload))
    .set('content-type', 'application/json')
    .send(payload);
  assert.equal(res.status, 200);
  assert.equal(res.body.received, true);

  const subInsert = db.calls.find((c) => c.sql.includes('INSERT INTO subscriptions'));
  assert.ok(subInsert, 'subscription row must be upserted');
  assert.ok(subInsert!.params.includes('user-1'));
  assert.ok(subInsert!.params.includes('plan-basic'));
  assert.ok(subInsert!.params.includes('sub_123'));
  assert.ok(subInsert!.params.includes('active'));

  const userUpdate = db.calls.find((c) => c.sql.includes('UPDATE users SET plan_id'));
  assert.ok(userUpdate, 'user plan must be updated');
  assert.deepEqual(userUpdate!.params, ['plan-basic', 'cus_123', 'user-1']);
});

test('stripe webhook: duplicate event id is not processed twice', async () => {
  const { app, stripe, db } = await buildApp({ duplicateEvent: true });
  const payload = JSON.stringify({
    id: 'evt_checkout_1',
    type: 'checkout.session.completed',
    data: { object: { mode: 'subscription', subscription: 'sub_123', metadata: { user_id: 'user-1' } } },
  });
  const res = await request(app)
    .post('/webhooks/stripe')
    .set('stripe-signature', signedHeader(stripe, payload))
    .set('content-type', 'application/json')
    .send(payload);
  assert.equal(res.status, 200);
  assert.equal(res.body.received, true);
  assert.ok(!db.calls.some((c) => c.sql.includes('INSERT INTO subscriptions')), 'replayed event must be a no-op');
});

test('stripe webhook: invoice.payment_failed marks subscription past_due', async () => {
  const { app, stripe, db } = await buildApp();
  const payload = JSON.stringify({
    id: 'evt_invoice_1',
    type: 'invoice.payment_failed',
    data: {
      object: {
        id: 'in_1', metadata: { user_id: 'user-1' }, subscription: 'sub_123',
        number: 'INV-1', status: 'open', subtotal: 1000, tax: 0, total: 1000, currency: 'usd',
        period_start: 1_700_000_000, period_end: 1_702_592_000, status_transitions: {},
      },
    },
  });
  const res = await request(app)
    .post('/webhooks/stripe')
    .set('stripe-signature', signedHeader(stripe, payload))
    .set('content-type', 'application/json')
    .send(payload);
  assert.equal(res.status, 200);
  const pastDue = db.calls.find((c) => c.sql.includes(`SET status='past_due'`));
  assert.ok(pastDue, 'subscription must be marked past_due');
  assert.deepEqual(pastDue!.params, ['sub_123']);
});
