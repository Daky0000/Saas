import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);

const nv = await import('../src/server/nvidiaModels.ts');

const config = (over: Partial<import('../src/server/nvidiaModels.ts').NvidiaConfig> = {}) => ({
  apiKey: 'nvapi-test', source: 'env' as const, enabled: true, ladders: { ...nv.DEFAULT_LADDERS }, ...over,
});

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

test('nvidia chat: climbs the ladder past a 504 and an empty answer, sends the OS wire shape', async () => {
  const seen: any[] = [];
  const replies = [
    json(504, { detail: 'Gateway Timeout' }),
    json(200, { choices: [{ message: { content: '' }, finish_reason: 'length' }] }),
    json(200, { choices: [{ message: { content: 'Hello there' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }),
  ];
  const fetchImpl = (async (_url: string, init: any) => { seen.push(JSON.parse(init.body)); return replies.shift()!; }) as any;
  const r = await nv.nvidiaChat({ system: 's', user: 'u', maxTokens: 400, job: 'text', config: config(), fetchImpl });
  assert.equal(r.text, 'Hello there');
  assert.equal(r.model, 'openai/gpt-oss-120b');
  assert.deepEqual(seen.map((b) => b.model), nv.DEFAULT_LADDERS.text);
  assert.equal(r.attempts.length, 2);
  for (const b of seen) {
    assert.equal(b.reasoning_effort, 'medium', 'reasoning models get low|medium|high only');
    assert.equal(b.max_tokens, 400 + 8000, 'answer plus reasoning headroom');
    assert.equal(b.max_completion_tokens, undefined);
  }
});

test('nvidia chat: no reasoning_effort for a non-reasoning model; fast job uses low effort', async () => {
  const bodies: any[] = [];
  const fetchImpl = (async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return json(200, { choices: [{ message: { content: 'ok' } }] }); }) as any;
  await nv.nvidiaChat({ system: 's', user: 'u', maxTokens: 50, job: 'fast', config: config({ ladders: { ...nv.DEFAULT_LADDERS, fast: ['google/diffusiongemma-26b-a4b-it'] } }), fetchImpl });
  assert.equal(bodies[0].reasoning_effort, undefined);
  assert.equal(bodies[0].max_tokens, 50);
  await nv.nvidiaChat({ system: 's', user: 'u', maxTokens: 50, job: 'fast', config: config(), fetchImpl });
  assert.equal(bodies[1].model, 'openai/gpt-oss-20b');
  assert.equal(bodies[1].reasoning_effort, 'low');
});

test('nvidia chat: a refused key stops the climb (every rung shares the key)', async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; return json(401, { detail: 'Unauthorized' }); }) as any;
  await assert.rejects(nv.nvidiaChat({ system: 's', user: 'u', maxTokens: 10, job: 'text', config: config(), fetchImpl }), /refused the key/);
  assert.equal(calls, 1);
});

test('nvidia image: polls a queued (202) request and returns JPEG bytes', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64');
  const urls: string[] = [];
  const replies = [
    new Response('', { status: 202, headers: { 'nvcf-reqid': 'req-1' } }),
    new Response('', { status: 202, headers: { 'nvcf-reqid': 'req-1' } }),
    json(200, { artifacts: [{ base64: jpeg, finishReason: 'SUCCESS' }] }),
  ];
  const fetchImpl = (async (url: string, init: any) => { urls.push(url); if (init.method === 'POST') assert.deepEqual(Object.keys(JSON.parse(init.body)), ['prompt', 'width', 'height']); return replies.shift()!; }) as any;
  const r = await nv.nvidiaImage({ prompt: 'a mug', width: 1000, height: 700, config: config(), fetchImpl, pollMs: 0 });
  assert.equal(r.model, 'black-forest-labs/flux.2-klein-4b');
  assert.equal(r.mimeType, 'image/jpeg');
  assert.match(urls[0], /\/v2\/nvcf\/pexec\/functions\/f67e96d8-1c4e-422e-a913-90f00e19aa9a$/);
  assert.match(urls[1], /\/v2\/nvcf\/pexec\/status\/req-1$/);
  assert.deepEqual(nv.nvidiaImageSize(1000, 700), { width: 1024, height: 704 });
});

test('nvidia image: a declined prompt (200 with finishReason) is a failure, not an empty success', async () => {
  const fetchImpl = (async () => json(200, { artifacts: [{ base64: '', finishReason: 'CONTENT_FILTERED' }] })) as any;
  await assert.rejects(nv.nvidiaImage({ prompt: 'x', config: config(), fetchImpl }), /declined \(CONTENT_FILTERED\)/);
});

test('model tier maps to the OS ladders', () => {
  assert.equal(nv.jobForModel('claude-haiku-4-5'), 'fast');
  assert.equal(nv.jobForModel('gemini-2.0-flash'), 'fast');
  assert.equal(nv.jobForModel('claude-opus-4-8'), 'text');
});

// Through the real shared call: free first, paid only when every rung failed.
test('callAINonStreaming: answers from NVIDIA when it works; free-only key fails clearly when it does not', async () => {
  process.env.NVIDIA_API_KEY = 'nvapi-test';
  const ai = await import('../src/ai-helpers.ts');
  nv.invalidateNvidiaConfig();
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => json(200, { choices: [{ message: { content: 'free answer' } }] })) as any;
    const text = await ai.callAINonStreaming('anthropic', ai.NVIDIA_FREE_ONLY, ai.FAST_MODEL, 'sys-a', 'user-a', 100, { userId: null, feature: 't', skipCache: true });
    assert.equal(text, 'free answer');

    globalThis.fetch = (async () => json(503, { detail: 'busy' })) as any;
    await assert.rejects(
      ai.callAINonStreaming('anthropic', ai.NVIDIA_FREE_ONLY, ai.FAST_MODEL, 'sys-b', 'user-b', 100, { userId: null, feature: 't', skipCache: true }),
      /no paid AI key/,
    );
    assert.equal(ai.computeAICostUsd('moonshotai/kimi-k3', 10_000, 10_000), 0, 'free models price at zero');
    assert.equal(ai.resolveTextKey({ provider: 'anthropic', encryptedKey: null, googleEncryptedKey: null, nvidiaReady: true }), process.env.ANTHROPIC_API_KEY || ai.NVIDIA_FREE_ONLY);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.NVIDIA_API_KEY;
    nv.invalidateNvidiaConfig();
  }
});
