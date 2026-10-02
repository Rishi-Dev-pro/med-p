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
    const initialWindowMs = options.windowMs || 60 * 1000;
    const getWindowMs = () => (limiter.windowMs !== undefined ? limiter.windowMs : initialWindowMs);
    const getMax = () => (limiter.max !== undefined ? limiter.max : (options.max !== undefined ? options.max : 120));
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
    }, Math.max(initialWindowMs, 10000));

    if (sweepInterval.unref) {
        sweepInterval.unref(); // Prevent timer from keeping the Node.js process alive
    }

    const limiter = (req, res, next) => {
        const key = keyGenerator(req);
        const now = Date.now();
        const currentWindowMs = getWindowMs();
        const currentMax = getMax();

        let record = hits.get(key);
        if (!record || now >= record.resetTime) {
            record = { count: 1, resetTime: now + currentWindowMs };
            hits.set(key, record);
        } else {
            record.count += 1;
        }

        const remaining = Math.max(0, currentMax - record.count);
        const resetSeconds = Math.ceil(Math.max(0, record.resetTime - now) / 1000);

        // Standard rate-limiting headers
        res.setHeader("X-RateLimit-Limit", currentMax);
        res.setHeader("X-RateLimit-Remaining", remaining);
        res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetTime / 1000));

        if (record.count > currentMax) {
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
    windowMs: Number(process.env.IOT_RATE_LIMIT_WINDOW_MS) || 60 * 1000,
    max: Number(process.env.IOT_RATE_LIMIT_MAX_REQUESTS) || 120,
    message: "Too many telemetry requests. Please slow down."
});

// Dedicated authentication login rate limiter (brute force protection)
const authLoginRateLimiter = createRateLimiter({
    windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS) || 50,
    message: "Too many authentication attempts. Please try again later."
});

// Dedicated registration rate limiter
const authRegisterRateLimiter = createRateLimiter({
    windowMs: Number(process.env.AUTH_REGISTER_WINDOW_MS) || 60 * 60 * 1000,
    max: Number(process.env.AUTH_REGISTER_MAX_ATTEMPTS) || 50,
    message: "Too many account registration attempts. Please try again later."
});

module.exports = {
    createRateLimiter,
    iotRateLimiter,
    authLoginRateLimiter,
    authRegisterRateLimiter
};
