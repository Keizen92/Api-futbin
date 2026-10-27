export function createRateLimiter({ perMinute, windowMs = 60_000 }) {
  const buckets = new Map();
  const refillPerMs = perMinute / windowMs;

  function consume(key) {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: perMinute, updatedAt: now };
      buckets.set(key, bucket);
    }

    bucket.tokens = Math.min(
      perMinute,
      bucket.tokens + (now - bucket.updatedAt) * refillPerMs,
    );
    bucket.updatedAt = now;

    if (bucket.tokens < 1) {
      const retryAfterMs = Math.ceil((1 - bucket.tokens) / refillPerMs);
      return {
        allowed: false,
        limit: perMinute,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1_000)),
      };
    }

    bucket.tokens -= 1;
    return {
      allowed: true,
      limit: perMinute,
      remaining: Math.floor(bucket.tokens),
      retryAfterSeconds: Math.ceil(windowMs / 1_000),
    };
  }

  function cleanup(olderThanMs = 15 * 60_000) {
    const cutoff = Date.now() - olderThanMs;
    for (const [key, bucket] of buckets) {
      if (bucket.updatedAt < cutoff) buckets.delete(key);
    }
  }

  return { consume, cleanup, size: () => buckets.size };
}
