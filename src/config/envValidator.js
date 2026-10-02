/**
 * Centralized Environment Configuration Validator
 * Health Tracker — Phase 15: Security Hardening & Penetration Defense
 *
 * Enforces fail-fast startup behavior if critical secrets or production
 * configurations are missing, weak, or insecure.
 * NEVER prints credentials, database strings, or secrets to stdout/stderr.
 */

/**
 * Known default or weak development secrets that MUST NOT be used in production.
 */
const INSECURE_JWT_SECRETS = new Set([
    "dev_jwt_secret_health_tracker_key_2026",
    "secret",
    "jwt_secret",
    "changeme",
    "password",
    "123456",
    "supersecret"
]);

/**
 * Validates the runtime environment configuration.
 *
 * @param {Object} [env=process.env] - Environment variables object
 * @returns {{ valid: boolean, errors: string[] }}
 * @throws {Error} In production or strict mode if critical errors exist
 */
function validateEnv(env = process.env) {
    const errors = [];
    const isProduction = env.NODE_ENV === "production";
    const isTest = env.NODE_ENV === "test";

    // 1. PORT validation
    if (env.PORT !== undefined && env.PORT !== "") {
        const port = Number(env.PORT);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            errors.push("PORT must be a valid integer between 1 and 65535.");
        }
    }

    // 2. MONGODB_URI validation
    if (!env.MONGODB_URI) {
        if (isProduction) {
            errors.push("MONGODB_URI is required in production.");
        }
    } else {
        if (
            !env.MONGODB_URI.startsWith("mongodb://") &&
            !env.MONGODB_URI.startsWith("mongodb+srv://")
        ) {
            errors.push("MONGODB_URI must start with 'mongodb://' or 'mongodb+srv://'.");
        }
    }

    // 3. JWT_SECRET validation
    const secret = env.JWT_SECRET || "";
    if (isProduction) {
        if (!secret) {
            errors.push("JWT_SECRET is strictly required in production.");
        } else if (INSECURE_JWT_SECRETS.has(secret) || secret.length < 32) {
            errors.push("JWT_SECRET in production must be a cryptographically strong secret of at least 32 characters, and cannot be a default development key.");
        }
    }

    // 4. CORS_ORIGIN validation
    if (env.CORS_ORIGIN) {
        const origins = env.CORS_ORIGIN.split(",").map((s) => s.trim());
        if (isProduction && origins.includes("*")) {
            errors.push("Wildcard CORS_ORIGIN ('*') is strictly forbidden in production when credentialed authentication (cookies/JWT) is enabled.");
        }
    }

    // 5. Rate limit numeric validations
    if (env.AUTH_RATE_LIMIT_WINDOW_MS) {
        const windowMs = Number(env.AUTH_RATE_LIMIT_WINDOW_MS);
        if (!Number.isFinite(windowMs) || windowMs <= 0) {
            errors.push("AUTH_RATE_LIMIT_WINDOW_MS must be a positive number.");
        }
    }
    if (env.AUTH_LOGIN_MAX_ATTEMPTS) {
        const max = Number(env.AUTH_LOGIN_MAX_ATTEMPTS);
        if (!Number.isInteger(max) || max <= 0) {
            errors.push("AUTH_LOGIN_MAX_ATTEMPTS must be a positive integer.");
        }
    }

    if (errors.length > 0) {
        const errorMessage = `Environment Configuration Validation Failed:\n  - ${errors.join("\n  - ")}`;
        if (isProduction || env.STRICT_ENV_VALIDATION === "true") {
            throw new Error(errorMessage);
        } else if (!isTest) {
            console.warn(`[WARN] ${errorMessage}`);
        }
        return { valid: false, errors };
    }

    return { valid: true, errors: [] };
}

/**
 * Returns safe, redacted configuration summary for diagnostics.
 * Never exposes secrets, keys, or passwords.
 *
 * @param {Object} [env=process.env]
 * @returns {Object} Redacted config
 */
function getSanitizedConfig(env = process.env) {
    return {
        NODE_ENV: env.NODE_ENV || "development",
        PORT: env.PORT || 5000,
        MONGODB_URI: env.MONGODB_URI ? "[CONFIGURED - URI REDACTED]" : "[NOT SET]",
        JWT_SECRET: env.JWT_SECRET ? `[CONFIGURED - ${env.JWT_SECRET.length} CHARS]` : "[NOT SET]",
        CORS_ORIGIN: env.CORS_ORIGIN || "[DEFAULT LOCALHOST]",
        REQUIRE_DEVICE_API_KEY: env.REQUIRE_DEVICE_API_KEY === "true" || env.NODE_ENV === "production"
    };
}

module.exports = {
    validateEnv,
    getSanitizedConfig,
    INSECURE_JWT_SECRETS
};
