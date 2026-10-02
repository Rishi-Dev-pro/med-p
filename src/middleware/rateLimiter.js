/**
 * In-Memory Rate Limiter Middleware
 * Health Tracker — Phase 14: Error Handling, Edge Cases & System Robustness
 *
 * Specifically protects ingestion endpoints against accidental simulator flooding
 * and denial-of-service request storms without introducing external Redis/database dependencies.
 */

/**
 * Creates an Express rate-limiting middleware instance.
 *
 * @param {Object} options
 * @param {number} options.windowMs - Sliding window duration in milliseconds (default: 60,000ms = 1m)
 * @param {number} options.max - Maximum allowed requests within the window (default: 120)
 * @param {string} options.message - Error message returned on 429 rate limit exceeded
 * @param {Function} options.keyGenerator - Custom key extractor (default: client IP address)
 * @returns {Function} Express middleware with .reset() and .hits map
 */
function createRateLimiter(options = {}) {
    const windowMs = options.windowMs || 60 * 1000;
    const max = options.max !== undefined ? options.max : 120;
    const message = options.message || "Too many telemetry requests. Please slow down.";
    const keyGenerator = options.keyGenerator || ((req) => {
        return req.ip ||
            (req.headers["x-forwarded-for"] && req.headers["x-forwarded-for"].split(",")[0].trim()) ||
            (req.socket && req.socket.remoteAddress) ||
            "default_client";
    });

    // In-memory hit storage: Map<clientKey, { count: number, resetTime: number }>
    const hits = new Map();

    // Periodic sweep to remove expired entries and bound memory growth
    const sweepInterval = setInterval(() => {
        const now = Date.now();
        for (const [key, record] of hits.entries()) {
            if (now >= record.resetTime) {
                hits.delete(key);
            }
        }
    }, Math.max(windowMs, 10000));

    if (sweepInterval.unref) {
        sweepInterval.unref(); // Prevent timer from keeping the Node.js process alive
    }

    const limiter = (req, res, next) => {
        const key = keyGenerator(req);
        const now = Date.now();

        let record = hits.get(key);
        if (!record || now >= record.resetTime) {
            record = { count: 1, resetTime: now + windowMs };
            hits.set(key, record);
        } else {
            record.count += 1;
        }

        const remaining = Math.max(0, max - record.count);
        const resetSeconds = Math.ceil(Math.max(0, record.resetTime - now) / 1000);

        // Standard rate-limiting headers
        res.setHeader("X-RateLimit-Limit", max);
        res.setHeader("X-RateLimit-Remaining", remaining);
        res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetTime / 1000));

        if (record.count > max) {
            res.setHeader("Retry-After", resetSeconds);
            return res.status(429).json({
                success: false,
                message
            });
        }

        next();
    };

    // Helper for automated testing to reset hit records
    limiter.reset = () => {
        hits.clear();
    };

    limiter.hits = hits;
    return limiter;
}

// Default IoT ingestion rate limiter: 120 requests per minute per IP
const iotRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 120,
    message: "Too many telemetry requests. Please slow down."
});

module.exports = {
    createRateLimiter,
    iotRateLimiter
};
