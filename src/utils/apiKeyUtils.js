/**
 * IoT Device API Key Cryptographic Utilities
 * Health Tracker — Phase 15: Security Hardening & Penetration Defense
 *
 * Provides cryptographically secure random API key generation,
 * SHA-256 hashing, and timing-safe verification.
 * Raw API keys are NEVER persisted to the database.
 */

const crypto = require("crypto");

const API_KEY_PREFIX = "htk_";

/**
 * Generates a cryptographically strong random API key for an IoT device.
 * Format: htk_<64 hex characters>
 *
 * @returns {{ rawKey: string, hash: string, prefix: string }}
 */
function generateDeviceApiKey() {
    const randomBytes = crypto.randomBytes(32).toString("hex");
    const rawKey = `${API_KEY_PREFIX}${randomBytes}`;
    const hash = hashDeviceApiKey(rawKey);
    const prefix = rawKey.substring(0, 8); // e.g. "htk_a1b2"

    return {
        rawKey,
        hash,
        prefix
    };
}

/**
 * Computes the SHA-256 hash of a candidate API key.
 *
 * @param {string} rawKey - Plaintext API key
 * @returns {string} Hex-encoded SHA-256 hash
 */
function hashDeviceApiKey(rawKey) {
    if (!rawKey || typeof rawKey !== "string") {
        throw new Error("API key must be a non-empty string");
    }
    return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Timing-safe comparison of a candidate key against a stored SHA-256 hash.
 * Prevents timing side-channel attacks during credential verification.
 *
 * @param {string} candidateKey - Candidate plaintext API key
 * @param {string} storedHash - Stored hex SHA-256 hash
 * @returns {boolean} True if matched
 */
function verifyDeviceApiKey(candidateKey, storedHash) {
    if (!candidateKey || !storedHash || typeof candidateKey !== "string" || typeof storedHash !== "string") {
        return false;
    }

    try {
        const candidateHash = hashDeviceApiKey(candidateKey);
        const candidateBuffer = Buffer.from(candidateHash, "hex");
        const storedBuffer = Buffer.from(storedHash, "hex");

        if (candidateBuffer.length !== storedBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(candidateBuffer, storedBuffer);
    } catch {
        return false;
    }
}

module.exports = {
    generateDeviceApiKey,
    hashDeviceApiKey,
    verifyDeviceApiKey,
    API_KEY_PREFIX
};
