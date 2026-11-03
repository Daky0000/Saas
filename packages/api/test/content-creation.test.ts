import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);
// The end-to-end test needs the app's own pool on a real database (the same
// convention as agent-team.test.ts): run with DATABASE_URL=TEST_DATABASE_URL.
const E2E = Boolean(process.env.TEST_DATABASE_URL) && process.env.DATABASE_URL === process.env.TEST_DATABASE_URL;

const ci = await import('../src/server/contentIntelligence.ts');
const sf = await import('../src/server/socialFormats.ts');
const ca = await import('../src/server/chatActions.ts');

// ── Honesty: a reply that claims work no tool did ─────────────────────────────

test('claims: "I created / scheduled / added to your calendar" is caught; promises and plans are not', () => {
  for (const t of [
    "I've created 30 posts for your bakery and added them to your calendar!",
    'Done! All 30 posts are now scheduled.',
    'Your content calendar is ready — check it out.',
    'I have generated the images for each post.',
    'We just scheduled your Instagram reels for next week.',
  ]) assert.ok(ci.claimsCreatedWork(t), t);
  for (const t of [
    "I'll create 30 posts once you press Proceed.",
    "Here's the plan: 30 posts across Instagram and LinkedIn. Press Proceed to create them.",
    'Which offer should this month push?',
    'Posts will be created when you press Proceed.',
    'Nothing has been made yet: press Proceed on the card.',
  ]) assert.ok(!ci.claimsCreatedWork(t), t);
});

test('requests: making posts is told apart from asking about them; answers to the question form continue a request', () => {
  assert.ok(ci.isPostRequest('Create 30 posts for my bakery this month'));
  assert.ok(ci.isPostRequest('Can you make an Instagram carousel about our new menu?'));
  assert.ok(ci.isPostRequest('I need a content calendar for November'));
  assert.ok(!ci.isPostRequest("What's the best time to post on LinkedIn?"));
  assert.ok(!ci.isPostRequest('Show my scheduled posts'));
  assert.ok(!ci.isPostRequest('I want to grow my Instagram'));
  assert.ok(ci.isCreationRequest('Generate an image of our storefront at night'));

  const u = (content: string) => ({ role: 'user' as const, content });
  const a = (content: string) => ({ role: 'assistant' as const, content });
  assert.deepEqual(ci.wantsCreation([u('Create 30 posts for this month')]), { posts: true, any: true });
  assert.equal(ci.wantsCreation([u('Plan my content calendar for November'), a('1. Which offer?'), u('Which offer should this month push? → 1:1 coaching')]).posts, true);
  assert.equal(ci.wantsCreation([u('Create 30 posts'), a('…'), u('What is my best posting time?')]).any, false, 'an unrelated question later is not a request');
  assert.equal(ci.wantsCreation([u('Create 30 posts'), a('…'), u('Yes, go ahead')]).posts, true);
});

test('brief: the original request and the plan the user agreed to reach the planner', () => {
  const plan = 'Pillars: sourdough craft, regulars, seasonal bakes. Week 1: a reel of the 4am bake, a carousel on storing bread… '.repeat(3);
  const brief = ci.creationBrief([
    { role: 'user', content: 'Create a month of posts for Crumb & Co pushing our new rye loaf' },
    { role: 'assistant', content: plan },
    { role: 'user', content: 'Create these posts' },
  ]);
  assert.match(brief, /new rye loaf/);
  assert.match(brief, /Create these posts/);
  assert.match(brief, /Plan discussed in the chat[\s\S]*4am bake/);
});

test('counts and spans are read from plain requests', () => {
  assert.equal(ci.requestedCount('Create 30 posts'), 30);
  assert.equal(ci.requestedCount('thirty Instagram posts please'), 30);
  assert.equal(ci.requestedCount('a month of content'), 30);
  assert.equal(ci.requestedCount('posts for the week'), 7);
  assert.equal(ci.requestedCount('help'), undefined);
  assert.equal(ci.requestedDays('spread over 2 weeks'), 14);
  assert.equal(ci.requestedDays('for this month'), 30);
});

// ── Writing that sounds like the business ─────────────────────────────────────

test('clichés: generic marketing phrasing and stock openings are found; plain specific copy is clean', () => {
  const found = ci.findCliches('Are you ready to elevate your coffee game? Unlock the secret sauce of our beans.');
  assert.ok(found.some((f) => f.startsWith('generic opening')));
  for (const label of ['elevate your', 'unlock / unleash your potential', 'secret sauce']) assert.ok(found.includes(label), label);
  assert.deepEqual(ci.findCliches('Our rye loaf proves for 18 hours. Saturday batch: 40 loaves, gone by 10am last week.'), []);
  assert.match(ci.voiceRules(), /Never invent facts/);
  assert.match(ci.voiceRules(), /game-changer/);
});

test('platform rules: Instagram keeps at most 5 hashtags, trailing hashtags in a caption are not doubled', () => {
  const text = sf.publishText('instagram', { caption: 'Fresh rye today.', hashtags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'A'] });
  assert.equal(text, 'Fresh rye today.\n\n#a #b #c #d #e');
  assert.equal(sf.publishText('pinterest', { caption: 'Rye loaf recipe', hashtags: ['bread'] }), 'Rye loaf recipe', 'Pinterest ignores hashtags');
  const p = sf.parsePiece('{"caption":"Fresh rye today.\\n\\n#rye #bakery","hashtags":["sourdough"]}', 'single_image', 0);
  assert.equal(p.caption, 'Fresh rye today.');
  assert.deepEqual(p.hashtags, ['sourdough', 'rye', 'bakery']);
  assert.match(sf.writingRules('instagram', 'single_image'), /never more than 5/);
});

// ── Choosing the format ───────────────────────────────────────────────────────

test('formats: chosen from what the post is trying to do, within what the platform supports', () => {
  assert.equal(sf.recommendFormat('instagram', 'Behind the scenes: how we bake our sourdough at 4am'), 'reel');
  assert.equal(sf.recommendFormat('instagram', '5 mistakes people make storing bread'), 'carousel');
  assert.equal(sf.recommendFormat('instagram', 'New autumn menu launches Friday'), 'single_image');
  assert.equal(sf.recommendFormat('linkedin', 'Why we stopped offering discounts — a founder lesson'), 'text');
  assert.equal(sf.recommendFormat('linkedin', 'How to price custom cakes: a step-by-step guide'), 'carousel');
  assert.equal(sf.recommendFormat('x', 'How to store bread'), 'text');
  assert.equal(sf.recommendFormat('tiktok', '5 tips'), 'video');
  assert.equal(sf.normalizeFormat('instagram', undefined, 'A day in the life at the bakery'), 'reel', 'no format given: the brief decides');
  assert.equal(sf.normalizeFormat('instagram', 'carousel', 'A day in the life'), 'carousel', 'a format the platform supports is kept');
});

// ── Planning a series ─────────────────────────────────────────────────────────

test('planner: the prompt carries the brand facts, the count, the platforms and the native mix', () => {
  const prompt = ci.plannerPrompt({
    brief: '30 posts pushing our new rye loaf', count: 30, platforms: ['instagram', 'linkedin'], days: 30, startDate: 'Wednesday 4 November 2026',
    accountStage: 'Brand-new', brandFacts: 'Crumb & Co: a sourdough bakery in Leeds; rye loaf £5.50', recentPosts: ['instagram: Halloween cookies'],
    range: { from: 11, to: 20, dayFrom: 11, dayTo: 20 },
  });
  assert.match(prompt, /Plan posts 11–20 of 30 \(exactly 10 entries\), on days 11–20/);
  assert.match(prompt, /Crumb & Co/);
  assert.match(prompt, /Halloween cookies/);
  assert.match(prompt, /Instagram: 4 carousels/);
  assert.match(prompt, /Never invent facts/);
});

test('planner: replies are cleaned — unknown platforms spread, impossible formats fixed, days kept in range', () => {
  const raw = `Here you go: {"pillars":["Craft","Regulars"],"posts":[
    {"day":3,"platform":"instagram","format":"carousel","slides":40,"pillar":"Craft","topic":"5 ways to keep rye fresh","hook":"Your rye goes stale for one reason."},
    {"day":99,"platform":"myspace","format":"text","topic":"Behind the scenes of the 4am bake"},
    {"day":2,"platform":"tiktok","format":"carousel","topic":"Shaping a loaf"},
    {"day":1,"platform":"linkedin","topic":""}
  ]}`;
  const plan = ci.parsePlan(raw, { platforms: ['instagram', 'tiktok'], days: 10, max: 10 });
  assert.deepEqual(plan.pillars, ['Craft', 'Regulars']);
  assert.equal(plan.posts.length, 3, 'an entry without a topic is dropped');
  assert.equal(plan.posts[0].slides, 10);
  assert.equal(plan.posts[1].platform, 'instagram', 'an unknown platform goes to an allowed one');
  assert.equal(plan.posts[1].format, 'reel', 'behind-the-scenes on Instagram is a reel');
  assert.ok(plan.posts[1].day >= 1 && plan.posts[1].day <= 10);
  assert.equal(plan.posts[2].format, 'video');
});

test('planner: 30 posts are asked 10 at a time, covering every post and day once', () => {
  const chunks = ci.planChunks(30, 30);
  assert.deepEqual(chunks.map((c) => [c.from, c.to]), [[1, 10], [11, 20], [21, 30]]);
  assert.equal(chunks[0].dayFrom, 1);
  assert.equal(chunks[2].dayTo, 30);
  assert.deepEqual(ci.planChunks(4, 2), [{ from: 1, to: 4, dayFrom: 1, dayTo: 2 }]);
});

test('planner: a lopsided format mix is rebalanced from each topic — unless the user set format rules', () => {
  const mk = (topic: string) => ({ day: 1, platform: 'instagram' as const, format: 'single_image' as const, pillar: '', topic, hook: '', visual: '' });
  const topics = ['Behind the scenes of the 4am bake', '5 mistakes storing bread', 'Our rye loaf', 'How to slice sourdough', 'A day in the life of our baker', 'New menu'];
  const balanced = ci.rebalanceFormats(topics.map(mk), false);
  assert.deepEqual(balanced.map((p) => p.format), ['reel', 'carousel', 'single_image', 'carousel', 'reel', 'single_image']);
  assert.ok(balanced.filter((p) => p.format === 'carousel').every((p) => p.slides === 5));
  assert.ok(ci.rebalanceFormats(topics.map(mk), true).every((p) => p.format === 'single_image'), 'locked by the user');
  assert.ok(ci.mentionsFormats('Always use images, never video'));
});

test('series: planned days spread across the month, one time per platform slot, LinkedIn off weekends; pillar and hook kept', () => {
  const now = new Date('2026-11-02T15:00:00Z'); // Monday
  const posts = Array.from({ length: 30 }, (_, i) => ({
    platform: (['instagram', 'linkedin', 'facebook'] as const)[i % 3], format: 'single_image', topic: `Post ${i}`,
    day: 1 + Math.floor(i / 3), pillar: 'Craft', hook: `Hook ${i}`,
  }));
  const out = ca.batchPosts({ timezone: 'Europe/London', posts }, now);
  assert.equal(out.length, 30);
  const keys = out.map((p) => `${p.platform}:${p.scheduled_at}`);
  assert.equal(new Set(keys).size, 30, 'no two posts on one platform at the same time');
  assert.ok(out.every((p) => new Date(p.scheduled_at).getTime() > now.getTime()));
  assert.ok(new Set(out.map((p) => p.scheduled_at.slice(0, 10))).size >= 10, 'spread over the planned days');
  assert.ok(out.filter((p) => p.platform === 'linkedin').every((p) => ![0, 6].includes(new Date(p.scheduled_at).getUTCDay())));
  assert.equal(out[4].pillar, 'Craft');
  assert.equal(out[4].hook, 'Hook 4');
  // The same instant twice on one platform (no planned day) moves later.
  const twin = ca.batchPosts({ posts: [{ platform: 'instagram', topic: 'a' }, { platform: 'instagram', topic: 'b' }] }, now);
  assert.notEqual(twin[0].scheduled_at, twin[1].scheduled_at);
});

// ── End to end: the chat corrects a false "30 posts created", then Proceed makes them ──

test('E2E: a free model that claims "30 posts created" is corrected; the plan is priced; Proceed puts 30 posts on the calendar', { skip: !E2E, timeout: 120_000 }, async () => {
  const express = (await import('express')).default;
  const request = (await import('supertest')).default;
  const { pool, setDbReady } = await import('../src/db.ts');
  setDbReady(true);
  // The free tier is "on" for this test only.
  const nvidia = await import('../src/server/nvidiaModels.ts');
  const priorKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = 'nvapi-test';
  nvidia.invalidateNvidiaConfig();
  await (await import('../src/db-migrations.ts')).runDatabaseMigrations(pool);
  await (await import('../src/payment-migrations.ts')).runPaymentMigrations(pool);
  const helpers = await import('../src/ai-helpers.ts');
  const { registerAIChatRoutes } = await import('../src/server/aiChatRoutes.ts');

  const userId = randomUUID();
  await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')`, [userId, `${userId}@example.com`]);
  await helpers.ensureCreditAccount(userId);
  await helpers.grantCredits(userId, 5000, 'test_grant');
  await pool.query(`INSERT INTO user_memories (user_id, category, title, content) VALUES ($1,'business','What we sell','Crumb & Co, a sourdough bakery in Leeds. Rye loaf £5.50, Saturday croissants, bread classes on Sundays.')`, [userId]);

  // The free model: the chat agent claims work it never did; the planner and writer answer as asked.
  const seen = { chat: 0, plan: 0, write: 0, polish: 0 };
  const realFetch = globalThis.fetch;
  const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = (async (url: any, init: any) => {
    if (!String(url).includes('/chat/completions')) return realFetch(url, init);
    const body = JSON.parse(init.body);
    const system = String(body.messages[0]?.content || '');
    const user = String(body.messages[body.messages.length - 1]?.content || '');
    if (body.tools) { seen.chat++; return reply("I've created 30 posts for Crumb & Co and added them to your calendar, with images!"); }
    if (system.startsWith(ci.PLANNER_SYSTEM)) {
      seen.plan++;
      const m = user.match(/Plan posts (\d+)–(\d+) of (\d+)/);
      const [from, to] = m ? [Number(m[1]), Number(m[2])] : [1, 30];
      const platforms = ['instagram', 'facebook', 'linkedin'];
      const topics = ['Behind the scenes of the 4am rye bake', '5 ways to keep your rye loaf fresh', 'Saturday croissants are back', 'Why we only bake 40 loaves a day — a founder lesson'];
      const posts = Array.from({ length: to - from + 1 }, (_, k) => ({ day: from + k, platform: platforms[(from + k) % 3], pillar: 'Craft', topic: `${topics[(from + k) % 4]} (#${from + k})`, hook: 'Our rye proves for 18 hours.', visual: 'The rye loaf on the Leeds counter' }));
      return reply(JSON.stringify({ pillars: ['Craft', 'Regulars', 'Classes'], posts }));
    }
    if (/^Rewrite this/.test(user)) { seen.polish++; return reply(JSON.stringify({ title: 'Rye', caption: 'Our rye proves for 18 hours. Saturday batch is 40 loaves.', hashtags: ['leedsbakery'] })); }
    seen.write++;
    // The first post comes back full of clichés: it must be rewritten before it is saved.
    const caption = seen.write === 1 ? 'Unlock the secret sauce of rye! Elevate your breakfast.' : `Our rye proves for 18 hours (${seen.write}).`;
    return reply(JSON.stringify({ title: `Post ${seen.write}`, caption, hashtags: ['leedsbakery', 'sourdough'], image_prompt: 'rye loaf on a counter', slides: [{ headline: 'One', body: '' }, { headline: 'Two', body: 'b' }, { headline: 'Three', body: 'c' }] }));
  }) as typeof fetch;

  try {
    const app = express();
    app.use(express.json());
    app.use('/api', registerAIChatRoutes({
      requireAuth: () => ({ userId, role: 'user' }),
      getAIConfig: async () => ({ model: 'claude-haiku-4-5', provider: 'anthropic', encryptedKey: null, googleEncryptedKey: null, systemPrompt: null, nvidiaReady: true }),
      resolveActiveKey: () => '',
      callAINonStreaming: helpers.callAINonStreaming,
      GEMINI_MODELS: [],
      pool: pool as any,
      dbQuery: (sql: string, params?: unknown[]) => pool.query(sql, params as any[]) as any,
      createNotification: async () => undefined,
      checkTaskActions: async () => [],
      getUserConnectedAccounts: async () => [],
      AGENT_DEFS: {},
    }));

    // A long campaign request goes straight to the chat (which has tools), never the tool-less team plan.
    const orch = await request(app).post('/api/ai/orchestrate').send({ messages: [{ role: 'user', content: 'Create 30 posts for our campaign strategy this month on Instagram, Facebook and LinkedIn to launch the rye loaf' }] });
    assert.equal(orch.body.type, 'direct');

    const chat = await request(app).post('/api/ai/chat').send({ messages: [{ role: 'user', content: 'Create 30 posts for Crumb & Co for this month' }], timezone: 'Europe/London' });
    const events = chat.text.split('\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]')).map((l) => JSON.parse(l.slice(6)));
    assert.ok(events.some((e) => e.type === 'text_reset'), 'the false claim is wiped from the chat');
    const estimate = events.find((e) => e.type === 'estimate');
    assert.ok(estimate, 'a real plan and estimate are shown instead');
    assert.equal(estimate.tool, 'create_posts_batch');
    assert.equal(estimate.plan.length, 30);
    assert.deepEqual(new Set(estimate.plan.map((p: any) => p.platform)), new Set(['instagram', 'facebook', 'linkedin']), 'no accounts connected: the default three');
    assert.ok(new Set(estimate.plan.map((p: any) => p.format)).size >= 3, 'a mix of formats, not one for everything');
    assert.ok(estimate.plan.every((p: any) => p.topic.includes('rye') || p.topic.includes('croissants') || p.topic.includes('loaves')));
    const lastReset = events.map((e) => e.type).lastIndexOf('text_reset');
    const finalText = events.slice(lastReset + 1).filter((e) => e.type === 'text').map((e) => e.text).join('');
    assert.match(finalText, /Nothing has been made yet/);
    assert.match(finalText, /Proceed/);
    assert.ok(!ci.claimsCreatedWork(finalText), finalText);
    assert.equal(seen.plan, 3, 'planned 10 at a time');
    const before = await pool.query(`SELECT COUNT(*)::int AS n FROM blog_posts WHERE user_id=$1`, [userId]);
    assert.equal(before.rows[0].n, 0, 'nothing is made before Proceed');

    const run = await request(app).post(`/api/ai/chat/actions/${estimate.action_id}/run`).send({});
    assert.equal(run.status, 200, run.text.slice(0, 300));
    const { rows } = await pool.query(`SELECT title, content, status, scheduled_at, social_platform, post_format, source FROM blog_posts WHERE user_id=$1 ORDER BY scheduled_at`, [userId]);
    assert.equal(rows.length, 30, 'all 30 posts are on the calendar');
    assert.ok(rows.every((r: any) => r.status === 'scheduled' && r.source === 'chat' && r.social_platform && new Date(r.scheduled_at).getTime() > Date.now()));
    assert.equal(new Set(rows.map((r: any) => `${r.social_platform}:${new Date(r.scheduled_at).toISOString()}`)).size, 30);
    assert.ok(seen.polish >= 1, 'the cliché-filled draft was rewritten');
    assert.ok(rows.every((r: any) => !/Unlock|secret sauce|Elevate your/.test(r.content)), 'no cliché reached the calendar');
    const action = await pool.query(`SELECT status FROM chat_pending_actions WHERE id=$1`, [estimate.action_id]);
    assert.equal(action.rows[0].status, 'done');
  } finally {
    globalThis.fetch = realFetch;
    if (priorKey === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = priorKey;
    nvidia.invalidateNvidiaConfig();
  }
});
