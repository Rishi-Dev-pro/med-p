/**
 * Authentication Middleware
 * Health Tracker — Phase 2: Authentication & Identity Foundation
 */

const { verifyToken } = require("../utils/authUtils");
const User = require("../models/User");
const { ACCOUNT_STATUS } = require("../config/constants");

/**
 * Middleware to authenticate requests via HTTP-Only cookie or Authorization header.
 * Attaches verified user to req.user.
 */
const authenticate = async (req, res, next) => {
    try {
        let token = null;

        // 1. Read token from HTTP-only cookies
        if (req.cookies) {
            token = req.cookies.token || req.cookies.jwt;
        }

        // 2. Fallback to Authorization: Bearer <token> header
        if (!token && req.headers && req.headers.authorization) {
            const parts = req.headers.authorization.split(" ");
            if (parts.length === 2 && parts[0] === "Bearer") {
                token = parts[1];
            }
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Authentication required. No token provided."
            });
        }

        // 3. Verify token cryptographically
        let decoded;
        try {
            decoded = verifyToken(token);
        } catch (err) {
            return res.status(401).json({
                success: false,
                message: "Invalid or expired authentication token."
            });
        }

        // 4. Verify user exists in database and account is active
        const user = await User.findById(decoded.userId).select("-passwordHash");
        if (!user) {
            return res.status(401).json({
                success: false,
                message: "User account no longer exists."
            });
        }

        if (user.status !== ACCOUNT_STATUS.ACTIVE) {
            return res.status(401).json({
                success: false,
                message: "Account is suspended. Authentication rejected."
            });
        }

        // 5. Attach authenticated principal to req.user
        req.user = {
            userId: user._id.toString(),
            username: user.username,
            email: user.email,
            role: user.role,
            profileId: user.profileId,
            status: user.status
        };

        next();
    } catch (error) {
        console.error("Auth middleware error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Internal authentication error"
        });
    }
};

module.exports = {
    authenticate
};
