/**
 * Authentication Routes
 * Health Tracker — Phase 2: Authentication & Identity Foundation
 */

const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { authenticate } = require("../middleware/authMiddleware");

// Public authentication endpoints
router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/logout", authController.logout);

// Protected identity inspection endpoint
router.get("/me", authenticate, authController.getMe);

module.exports = router;
