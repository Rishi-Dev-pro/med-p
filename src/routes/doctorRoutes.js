/**
 * Doctor Portal Routes
 * Health Tracker — Phase 9: Multi-Page Dashboard Architecture
 *
 * Dedicated router for doctor multi-page layout.
 * Every individual route strictly enforces authentication and DOCTOR role.
 */

const express = require("express");
const { authenticate } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { ROLES } = require("../config/constants");
const doctorController = require("../controllers/doctorController");

const router = express.Router();

// Dedicated Doctor Multi-Page Dashboard Routes
router.get("/overview", authenticate, requireRole(ROLES.DOCTOR), doctorController.getOverview);
router.get("/patients", authenticate, requireRole(ROLES.DOCTOR), doctorController.getPatients);
router.get("/monitor", authenticate, requireRole(ROLES.DOCTOR), doctorController.getMonitor);
router.get("/history", authenticate, requireRole(ROLES.DOCTOR), doctorController.getHistory);

// Legacy root redirect: /doctor -> /doctor/overview
router.get("/", authenticate, requireRole(ROLES.DOCTOR), (req, res) => {
    res.redirect("/doctor/overview");
});

module.exports = router;
