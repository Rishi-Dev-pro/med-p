/**
 * Authentication Routes
 * Health Tracker — Phase 2: Authentication & Identity Foundation
 */

const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { authenticate } = require("../middleware/authMiddleware");

const { authLoginRateLimiter, authRegisterRateLimiter } = require("../middleware/rateLimiter");

// Public authentication endpoints
router.post("/register", authRegisterRateLimiter, authController.register);
router.post("/login", authLoginRateLimiter, authController.login);
router.post("/logout", authController.logout);
router.get("/device-status/:deviceId", authController.getDeviceStatus);

// Protected identity inspection endpoint
router.get("/me", authenticate, authController.getMe);

module.exports = router;
