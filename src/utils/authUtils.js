/**
 * Authentication Utilities
 * Health Tracker — Phase 2: Authentication & Identity Foundation
 */

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { JWT_SECRET, JWT_EXPIRES_IN, BCRYPT_SALT_ROUNDS } = require("../config/auth");

/**
 * Hash a plaintext password with bcrypt cost factor >= 10.
 * @param {string} password - Plaintext password
 * @returns {Promise<string>} - Hashed password
 */
const hashPassword = async (password) => {
    if (!password || typeof password !== "string") {
        throw new Error("Password must be a non-empty string");
    }
    const salt = await bcrypt.genSalt(BCRYPT_SALT_ROUNDS);
    return bcrypt.hash(password, salt);
};

/**
 * Verify a candidate password against a stored bcrypt hash.
 * @param {string} candidatePassword - Plaintext candidate password
 * @param {string} hash - Stored bcrypt hash
 * @returns {Promise<boolean>} - True if matched
 */
const comparePassword = async (candidatePassword, hash) => {
    if (!candidatePassword || !hash) {
        return false;
    }
    return bcrypt.compare(candidatePassword, hash);
};

/**
 * Generate a signed JWT containing minimal identity information.
 * Never stores passwords, password hashes, or PHI.
 * @param {object} payload - Identity payload { userId, role, profileId }
 * @returns {string} - Signed JWT
 */
const generateToken = (payload) => {
    const claims = {
        userId: String(payload.userId),
        role: payload.role,
        profileId: payload.profileId || null
    };

    return jwt.sign(claims, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN
    });
};

/**
 * Cryptographically verify a JWT token.
 * @param {string} token - Signed JWT string
 * @returns {object} - Decoded claims
 */
const verifyToken = (token) => {
    if (!token || typeof token !== "string") {
        throw new Error("Token must be a valid string");
    }
    return jwt.verify(token, JWT_SECRET);
};

module.exports = {
    hashPassword,
    comparePassword,
    generateToken,
    verifyToken
};
