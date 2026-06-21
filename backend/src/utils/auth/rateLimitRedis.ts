/**
 * Shared Redis client + rate-limit store factory.
 *
 * v1.70 — addresses issue #6 (in-memory rate limiter bypassable in
 * multi-instance deployments). The pre-built limiters in
 * `rateLimit.ts` (loginLimiter, registerLimiter, etc.) all call
 * `getRedisRateLimitStore()` at module load. When REDIS_TCP_URL is
 * set, the returned store is a `rate-limit-redis` RedisStore backed
 * by a fresh `ioredis` connection. When unset, `undefined` is returned
 * and express-rate-limit falls back to its in-memory Map — which
 * keeps dev / test environments working without Redis.
 *
 * Connection handling mirrors `utils/jobs/documentQueue.ts`:
 *  - URL parsing handles rediss:// (Upstash) → enable TLS
 *  - Uses REDIS_TCP_URL env var (consistent with BullMQ usage)
 *  - maxRetriesPerRequest: null (required by rate-limit-redis)
 *
 * Note: a fresh IORedis is created per call. That's intentional —
 * rate-limit-redis manages its own connection internally; we just
 * need a client that responds to the redis-compatible command API.
 * The cost is one extra TCP connection per process, which is
 * negligible compared to the BullMQ + Upstash REST clients we
 * already open.
 */

import IORedis from 'ioredis';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import type { Store } from 'express-rate-limit';
import { logger } from '../http/logger.js';

let _store: Store | undefined;
let _initialized = false;

function buildRedisClient(): IORedis | null {
  const url = process.env.REDIS_TCP_URL;
  if (!url) return null;
  try {
    const u = new URL(url);
    return new IORedis({
      host: u.hostname,
      port: Number(u.port) || 6379,
      password: u.password || undefined,
      username: u.username || undefined,
      maxRetriesPerRequest: null as unknown as number,
      // Upstash requires TLS on the TCP endpoint
      ...(url.startsWith('rediss://') ? { tls: {} as Record<string, unknown> } : {}),
      // Don't block process startup if Redis is briefly unreachable —
      // the connection retries in the background.
      lazyConnect: true,
    });
  } catch (err) {
    logger.warn(`[rateLimitRedis] Failed to build IORedis client: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Returns a rate-limit-redis RedisStore when REDIS_TCP_URL is set,
 * or undefined to signal express-rate-limit to use its default
 * in-memory Map. Memoized so all limiters share one connection.
 */
export function getRedisRateLimitStore(): Store | undefined {
  if (_initialized) return _store;
  _initialized = true;
  const client = buildRedisClient();
  if (!client) {
    logger.info('[rateLimitRedis] REDIS_TCP_URL not set — using in-memory rate limiter store (single-instance only)');
    return undefined;
  }
  try {
    _store = new RedisStore({
      // sendCommand is the bridge rate-limit-redis uses to talk to
      // any Redis-compatible client. The signature expects
      // Promise<RedisReply>; cast the ioredis return value through unknown.
      sendCommand: (...args: string[]): Promise<RedisReply> =>
        client.call(...(args as [string, ...string[]])) as unknown as Promise<RedisReply>,
      prefix: 'rl:',  // namespace in Redis — keeps our keys separate from BullMQ/Upstash usage
    });
    logger.info('[rateLimitRedis] Using Redis-backed rate limiter store');
    return _store;
  } catch (err) {
    logger.warn(`[rateLimitRedis] Failed to construct RedisStore, falling back to in-memory: ${(err as Error).message}`);
    return undefined;
  }
}