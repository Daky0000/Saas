import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'x'.repeat(32);

// config.ts validates env at import time, so env must be set before the engine
// (which transitively imports config) is loaded. Static imports would hoist
// above these assignments — hence the dynamic import.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = JWT_SECRET;
process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);
const {
  deriveTriggerType, matchesTrigger, runnableSteps, legacyActionsToSteps,
  delayToMs, personalize,
} = await import('../src/server/automationEngine.ts');

async function loadApp() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.INTEGRATIONS_ENCRYPTION_KEY = 'y'.repeat(32);
  process.env.WORDPRESS_ENCRYPTION_KEY = 'z'.repeat(32);
  const mod = await import('../src/server.ts');
  return mod.default;
}

function authHeader(): string {
  const token = jwt.sign({ userId: 'test-user-1', email: 'test@example.com', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

test('automation: trigger_type is derived from the flow trigger step', () => {
  const steps = [
    { type: 'trigger', config: { trigger: 'email_signup' } },
    { type: 'send_email', config: { subject: 'Welcome' } },
  ];
  assert.equal(deriveTriggerType(steps), 'email_signup');
  assert.equal(deriveTriggerType([{ type: 'trigger', config: {} }]), 'api');
  assert.equal(deriveTriggerType([]), 'api');
  assert.equal(deriveTriggerType(null), 'api');
});

test('automation: matchesTrigger honors stored type, step trigger, and signup alias', () => {
  // New flow-builder row: trigger lives in steps, stored type mirrors it
  const flow = { trigger_type: 'email_signup', steps: [{ type: 'trigger', config: { trigger: 'email_signup' } }] };
  assert.equal(matchesTrigger(flow, 'email_signup'), true);
  assert.equal(matchesTrigger(flow, 'signup'), true); // legacy alias
  assert.equal(matchesTrigger(flow, 'tag_added'), false);

  // Row created before trigger_type derivation: stored as 'api' but steps say otherwise
  const staleRow = { trigger_type: 'api', steps: [{ type: 'trigger', config: { trigger: 'tag_added' } }] };
  assert.equal(matchesTrigger(staleRow, 'tag_added'), true);

  // Legacy automation with no steps at all
  const legacy = { trigger_type: 'signup', steps: null };
  assert.equal(matchesTrigger(legacy, 'email_signup'), true);
});

test('automation: runnableSteps strips the trigger node and falls back to legacy actions', () => {
  const flow = {
    steps: [
      { type: 'trigger', config: { trigger: 'email_signup' } },
      { type: 'send_email', config: { subject: 'Hi' } },
    ],
    actions: null,
  };
  assert.deepEqual(runnableSteps(flow).map((s) => s.type), ['send_email']);

  const legacy = { steps: [], actions: [{ subject: 'Old welcome', content: '<p>hey</p>' }] };
  const converted = runnableSteps(legacy);
  assert.equal(converted.length, 1);
  assert.equal(converted[0].type, 'send_email');
  assert.equal(converted[0].config?.subject, 'Old welcome');

  assert.deepEqual(legacyActionsToSteps(null), []);
});

test('automation: delayToMs converts units and clamps to at least 1', () => {
  assert.equal(delayToMs(5, 'minutes'), 5 * 60_000);
  assert.equal(delayToMs(2, 'hours'), 2 * 3_600_000);
  assert.equal(delayToMs(1, 'weeks'), 604_800_000);
  assert.equal(delayToMs(0, 'days'), 86_400_000); // clamped to 1
  assert.equal(delayToMs('junk', 'unknown-unit'), 86_400_000); // defaults: 1 day
});

test('automation: personalize substitutes contact placeholders', () => {
  const contact = { id: 'c1', email: 'ada@example.com', first_name: 'Ada', last_name: null };
  assert.equal(
    personalize('Hi {{first_name}} {{last_name}} ({{email}})', contact),
    'Hi Ada  (ada@example.com)'
  );
});

test('automation: manual run requires contact_id or email', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/automations/auto_x/run').set('Authorization', authHeader()).send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('automation: manual run requires auth', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/automations/auto_x/run').send({ email: 'a@b.com' });
  assert.equal(res.status, 401);
});

test('resend webhook: accepts events and returns 200', async () => {
  const app = await loadApp();
  const res = await request(app).post('/webhooks/resend').send({
    type: 'email.opened',
    data: { email_id: 'test-resend-id' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.received, true);
});

test('resend webhook: ignores unknown event types without error', async () => {
  const app = await loadApp();
  const res = await request(app).post('/webhooks/resend').send({ type: 'email.delivery_delayed', data: {} });
  assert.equal(res.status, 200);
});

test('public trigger: rejects missing API key', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/v1/trigger').send({ email: 'a@b.com' });
  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
});

test('public trigger: rejects invalid body before auth leaks anything', async () => {
  const app = await loadApp();
  const res = await request(app).post('/api/v1/trigger')
    .set('Authorization', 'Bearer cf_live_deadbeef')
    .send({ email: 'not-an-email' });
  assert.equal(res.status, 400);
});

test('api keys: management requires auth', async () => {
  const app = await loadApp();
  const res = await request(app).get('/api/keys');
  assert.equal(res.status, 401);
});
