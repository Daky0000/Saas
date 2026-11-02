import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);

const ca = await import('../src/server/chatActions.ts');

const sf = await import('../src/server/socialFormats.ts');

test('batch: each post is priced with its own media — writing + images + video', () => {
  const e = ca.estimateToolCredits('create_posts_batch', { posts: [
    { platform: 'linkedin', format: 'text', topic: 'a' },
    { platform: 'instagram', format: 'carousel', slides: 4, topic: 'b' },
    { platform: 'instagram', format: 'reel', topic: 'c' },
  ] });
  const expected = sf.SOCIAL_COPY_CREDITS * 3 + 4 * sf.IMAGE_CREDITS + (sf.IMAGE_CREDITS + sf.VIDEO_CREDITS);
  assert.equal(e?.credits, expected);
  assert.match(String(e?.label), /3 posts across 2 platforms/);
  assert.ok(e?.lines.some((l) => /Instagram carousel \(4 slides\)/.test(l)));
});

test('batch: one native post per platform; formats the platform cannot do are corrected', () => {
  const posts = ca.batchPosts({ posts: [{ topic: 'launch', platforms: ['Instagram', 'twitter'], format: 'text' }, { topic: 'tips', platform: 'tiktok', format: 'carousel' }] });
  assert.deepEqual(posts.map((p) => `${p.platform}:${p.format}`), ['instagram:single_image', 'x:text', 'tiktok:video']);
  assert.equal(posts[0].scheduled_at, posts[1].scheduled_at, 'the same idea goes out the same day on both platforms');
});

test('formats: carousels keep 3-10 slides, X captions fit 280 characters', () => {
  assert.equal(sf.clampSlides(1), 3);
  assert.equal(sf.clampSlides(40), 10);
  const text = sf.publishText('x', { caption: 'a'.repeat(300), hashtags: ['launch'] });
  assert.ok(text.length <= 280);
  assert.equal(sf.publishText('instagram', { caption: 'Hello', hashtags: ['one', 'two'] }), 'Hello\n\n#one #two');
  assert.equal(sf.normalizeFormat('instagram', 'text'), 'single_image', 'Instagram is never text-only');
  assert.equal(sf.aspectRatioFor('instagram', 'reel'), '9:16');
});

test('formats: the writer reply is parsed into caption, hashtags and slides', () => {
  const p = sf.parsePiece('Sure! {"title":"T","caption":"Cap","hashtags":["#a","b c"],"slides":[{"headline":"H1","body":""},{"headline":"H2","body":"B"}],"visual_style":"pastel"}', 'carousel', 5);
  assert.equal(p.caption, 'Cap');
  assert.deepEqual(p.hashtags, ['a', 'bc']);
  assert.equal(p.slides.length, 2);
  assert.equal(p.visual_style, 'pastel');
});

test('custom instructions block tells every agent to obey them', () => {
  assert.equal(ca.customInstructionsBlock(''), '');
  assert.match(ca.customInstructionsBlock('Always add an image'), /EVERY task[\s\S]*Always add an image/);
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
