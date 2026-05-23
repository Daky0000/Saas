import rateLimit from 'express-rate-limit';
import type { Store, Options, IncrementResponse } from 'express-rate-limit';
import IORedis from 'ioredis';

// ── Redis-backed store for express-rate-limit ──────────────────────────────
// Falls back to the default in-memory store if Redis is not configured.
// When Redis is unavailable on startup we fail open (in-memory) rather than
// blocking auth requests.

function buildRedisStore(redis: InstanceType<typeof IORedis>, prefix: string, windowMs: number): Store {
  return {
    async increment(key: string): Promise<IncrementResponse> {
      const redisKey = `${prefix}:${key}`;
      const pipeline = redis.pipeline();
      pipeline.incr(redisKey);
      pipeline.pttl(redisKey);
      const results = await pipeline.exec();
      const totalHits = (results?.[0]?.[1] as number) ?? 1;
      const ttl = (results?.[1]?.[1] as number) ?? -1;
      if (ttl < 0) await redis.pexpire(redisKey, windowMs);
      const resetTime = new Date(Date.now() + (ttl > 0 ? ttl : windowMs));
      return { totalHits, resetTime };
    },
    async decrement(key: string): Promise<void> {
      await redis.decr(`${prefix}:${key}`);
    },
    async resetKey(key: string): Promise<void> {
      await redis.del(`${prefix}:${key}`);
    },
  };
}

function makeStore(prefix: string, windowMs: number): Partial<Options> {
  const redisUrl = process.env.REDIS_URL || process.env.BULLMQ_REDIS_URL || '';
  if (!redisUrl) return {};
  try {
    const redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: true });
    redis.connect().catch(() => undefined);
    return { store: buildRedisStore(redis, prefix, windowMs) };
  } catch {
    return {};
  }
}

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const PWD_WINDOW_MS = 60 * 60 * 1000;

export const authLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts, please try again later' },
  skipSuccessfulRequests: false,
  ...makeStore('rl:auth', AUTH_WINDOW_MS),
});

export const passwordLimiter = rateLimit({
  windowMs: PWD_WINDOW_MS,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many password change attempts, please try again in an hour' },
  ...makeStore('rl:pwd', PWD_WINDOW_MS),
});
