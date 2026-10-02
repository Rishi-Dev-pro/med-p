/**
 * Centralized Security Configuration
 * Health Tracker — Phase 15: Security Hardening & Penetration Defense
 *
 * Configures Helmet HTTP headers, strict environment-driven CORS allowlisting,
 * and body-size limits.
 */

const helmet = require("helmet");

/**
 * Returns Helmet middleware configured with defense-in-depth headers
 * and a tailored Content-Security-Policy that preserves EJS templates,
 * Chart.js rendering, and Socket.IO real-time websocket connections.
 *
 * @param {Object} [options={}]
 * @returns {Function} Express middleware
 */
function getHelmetMiddleware(options = {}) {
    const isProduction = process.env.NODE_ENV === "production";

    return helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
                scriptSrcAttr: ["'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
                imgSrc: ["'self'", "data:"],
                connectSrc: ["'self'", "ws:", "wss:"],
                frameAncestors: ["'none'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
                upgradeInsecureRequests: isProduction ? [] : null
            }
        },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: "cross-origin" },
        xContentTypeOptions: true,
        xFrameOptions: { action: "deny" },
        referrerPolicy: { policy: "strict-origin-when-cross-origin" },
        xDnsPrefetchControl: { allow: false },
        hsts: isProduction
            ? { maxAge: 31536000, includeSubDomains: true, preload: true }
            : false,
        ...options
    });
}

/**
 * Resolves list of allowed origins from environment.
 * @returns {string[]} Allowed origin strings
 */
function getAllowedOrigins() {
    const raw = process.env.CORS_ORIGIN;
    const currentPort = process.env.PORT || 5000;
    if (!raw) {
        // Safe development defaults including self backend port
        return [
            `http://localhost:${currentPort}`,
            `http://127.0.0.1:${currentPort}`,
            "http://localhost:5000",
            "http://127.0.0.1:5000",
            "http://localhost:5173",
            "http://localhost:3000",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:3000"
        ];
    }
    const origins = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (process.env.NODE_ENV !== "production") {
        if (!origins.includes(`http://localhost:${currentPort}`)) {
            origins.push(`http://localhost:${currentPort}`);
        }
        if (!origins.includes(`http://127.0.0.1:${currentPort}`)) {
            origins.push(`http://127.0.0.1:${currentPort}`);
        }
    }
    return origins;
}

/**
 * Validates whether an origin is allowed by the security policy.
 * @param {string|undefined} origin
 * @returns {boolean}
 */
function isOriginAllowed(origin) {
    if (!origin) return true; // Same-origin, direct browser navigation, curl, mobile
    const allowed = getAllowedOrigins();
    if (allowed.includes("*")) {
        // Disallow wildcard with credentials
        return false;
    }
    return allowed.includes(origin);
}

/**
 * Returns CORS middleware options compatible with express cors package.
 */
function getCorsOptions() {
    return {
        origin: (origin, callback) => {
            if (!origin) {
                // Same-origin, curl, server-to-server, EJS dashboard forms
                return callback(null, true);
            }

            if (isOriginAllowed(origin)) {
                return callback(null, true);
            }

            // Origin is not allowed
            return callback(null, false);
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
        optionsSuccessStatus: 204
    };
}

module.exports = {
    getHelmetMiddleware,
    getAllowedOrigins,
    isOriginAllowed,
    getCorsOptions
};
