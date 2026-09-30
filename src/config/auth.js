/**
 * Centralized Authentication Configuration
 * Health Tracker — Phase 2: Authentication & Identity Foundation
 */

const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_health_tracker_key_2026";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "24h";
const BCRYPT_SALT_ROUNDS = 10;
const COOKIE_NAME = "token";

/**
 * Returns environment-aware secure cookie options.
 * httpOnly prevents client-side script access.
 * secure is enabled strictly in production (HTTPS).
 * sameSite 'lax' permits top-level navigation while mitigating CSRF.
 */
const getCookieOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000 // 24 hours in milliseconds
});

module.exports = {
    JWT_SECRET,
    JWT_EXPIRES_IN,
    BCRYPT_SALT_ROUNDS,
    COOKIE_NAME,
    getCookieOptions
};
