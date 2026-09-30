const express = require("express");
const { authenticate } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { ROLES } = require("../config/constants");

const router = express.Router();

/**
 * Super Admin Authorization Foundation Route
 * Health Tracker — Phase 3
 * Accessible exclusively to users possessing the SUPER_ADMIN role verified via JWT.
 */
router.get("/status", authenticate, requireRole(ROLES.SUPER_ADMIN), (req, res) => {
    return res.status(200).json({
        success: true,
        message: "Admin authorization verified",
        admin: {
            userId: req.user.userId,
            username: req.user.username,
            role: req.user.role
        }
    });
});

module.exports = router;
