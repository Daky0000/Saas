import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);

const ca = await import('../src/server/chatActions.ts');

test('batch: every post is priced at the flat rate', () => {
  const e = ca.estimateToolCredits('create_posts_batch', { posts: [{ topic: 'a' }, { topic: 'b' }, { topic: 'c' }] });
  assert.equal(e?.credits, 3 * ca.BATCH_POST_CREDITS);
  assert.match(String(e?.label), /3 posts/);
});

test('batch: posts without a usable date go one a day from tomorrow 09:00 UTC; empty briefs are dropped', () => {
  const now = new Date('2026-11-02T15:00:00Z');
  const posts = ca.batchPosts({ posts: [{ topic: 'one' }, { topic: '' }, { topic: 'two', scheduled_at: '2020-01-01T00:00:00Z' }, { topic: 'three', scheduled_at: '2026-12-01T10:00:00Z' }] }, now);
  assert.deepEqual(posts.map((p) => p.topic), ['one', 'two', 'three']);
  assert.equal(posts[0].scheduled_at, '2026-11-03T09:00:00.000Z');
  assert.equal(posts[1].scheduled_at, '2026-11-05T09:00:00.000Z', 'a past date falls back to its slot');
  assert.equal(posts[2].scheduled_at, '2026-12-01T10:00:00.000Z');
});

test('batch: capped at the maximum', () => {
  const posts = ca.batchPosts({ posts: Array.from({ length: 50 }, (_, i) => ({ topic: `t${i}` })) });
  assert.equal(posts.length, ca.BATCH_MAX_POSTS);
});

test('spending tools are priced; free tools and non-run Magnific actions are not', () => {
  assert.equal(ca.estimateToolCredits('magnific_lip_sync', {})?.credits, 30);
  assert.equal(ca.estimateToolCredits('magnific_edit_image', { type: 'remove-background' })?.credits, 1);
  assert.equal(ca.estimateToolCredits('magnific_one_generate', { mode: 'draft' })?.credits, 4);
  assert.equal(ca.estimateToolCredits('create_draft', { title: 'x' }), null);
  assert.equal(ca.estimateToolCredits('magnific_space_or_flow', { action: 'simulate_cost' }), null);
  assert.equal(ca.estimateToolCredits('magnific_space_or_flow', { action: 'run_flow' })?.credits, 10);
});

test('saved sessions drop pasted image data', () => {
  const out = ca.sanitizeSessionMessages([{ kind: 'text', images: [{ id: '1', name: 'a.png', dataUrl: 'data:image/png;base64,AAAA' }] }]) as any[];
  assert.equal(out[0].images[0].dataUrl, '');
  assert.equal(out[0].images[0].name, 'a.png');
});
