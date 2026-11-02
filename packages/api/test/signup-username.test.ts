import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);

const { allocateUsername } = await import('../src/server/authRoutes.ts');
const RULE = /^[a-zA-Z0-9_-]{3,32}$/;

test('signup username: the email local part when free', async () => {
  assert.equal(await allocateUsername('Dan.Smith@gmail.com', async () => false), 'dan_smith');
});

test('signup username: a taken local part gets a suffix instead of refusing the sign-up', async () => {
  const taken = new Set(['dan']);
  const u = await allocateUsername('dan@company.com', async (x) => taken.has(x));
  assert.match(u, /^dan_\d{4}$/);
  assert.match(u, RULE);
});

test('signup username: short or symbol-only local parts still satisfy the username rule', async () => {
  for (const email of ['a@x.com', 'ab@x.com', '+++@x.com', '_._@x.com']) {
    const u = await allocateUsername(email, async () => false);
    assert.match(u, RULE, `${email} → ${u}`);
  }
});

test('signup username: falls back to a random name when every suffix is taken', async () => {
  const u = await allocateUsername('info@x.com', async (x) => x.startsWith('info'));
  assert.match(u, /^user_[a-f0-9]{10}$/);
});
