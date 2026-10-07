/**
 * Lightweight, in-memory rate limiter middleware for abuse and brute-force protection.
 */
class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60 * 1000; // 1 minute default
    this.max = options.max || 60; // max requests per window
    this.message = options.message || 'Too many requests. Please try again later.';
    this.hits = new Map(); // key -> [timestamp, timestamp, ...]

    // Periodic cleanup of stale buckets
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, timestamps] of this.hits.entries()) {
        const valid = timestamps.filter(t => now - t < this.windowMs);
        if (valid.length === 0) {
          this.hits.delete(key);
        } else {
          this.hits.set(key, valid);
        }
      }
    }, Math.max(this.windowMs, 30000));

    if (cleanupInterval.unref) cleanupInterval.unref();
  }

  middleware(keyExtractor) {
    return (req, res, next) => {
      const key = keyExtractor ? keyExtractor(req) : (req.ip || req.connection.remoteAddress || 'unknown_ip');
      const now = Date.now();
      
      let timestamps = this.hits.get(key) || [];
      timestamps = timestamps.filter(t => now - t < this.windowMs);

      if (timestamps.length >= this.max) {
        return res.status(429).json({
          success: false,
          error: this.message,
          retryAfterSeconds: Math.ceil((this.windowMs - (now - timestamps[0])) / 1000)
        });
      }

      timestamps.push(now);
      this.hits.set(key, timestamps);
      next();
    };
  }

  reset() {
    this.hits.clear();
  }
}

const pairingAttemptLimiter = new RateLimiter({
  windowMs: 60 * 1000,
  max: 15,
  message: 'Too many agent pairing attempts. Please wait 1 minute before trying again.'
});

const pairingCodeLimiter = new RateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: 'Too many pairing codes generated. Please wait a few minutes.'
});

const authLimiter = new RateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many login requests. Please try again in 1 minute.'
});

module.exports = {
  RateLimiter,
  pairingAttemptLimiter: pairingAttemptLimiter.middleware(req => `pair_${req.ip || 'ip'}`),
  pairingCodeLimiter: pairingCodeLimiter.middleware(req => `paircode_${req.user?.id || req.ip || 'usr'}`),
  authLimiter: authLimiter.middleware(req => `auth_${req.ip || 'ip'}`)
};
