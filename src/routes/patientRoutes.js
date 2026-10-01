/**
 * Patient Portal Routes
 * Health Tracker — Phase 9: Multi-Page Dashboard Architecture
 *
 * Dedicated router for patient multi-page layout.
 * Every individual route strictly enforces authentication and PATIENT role.
 */

const express = require("express");
const { authenticate } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { ROLES } = require("../config/constants");
const patientController = require("../controllers/patientController");

const router = express.Router();

// Dedicated Patient Multi-Page Dashboard Routes
router.get("/overview", authenticate, requireRole(ROLES.PATIENT), patientController.getOverview);
router.get("/live", authenticate, requireRole(ROLES.PATIENT), patientController.getLive);
router.get("/history", authenticate, requireRole(ROLES.PATIENT), patientController.getHistory);
router.get("/profile", authenticate, requireRole(ROLES.PATIENT), patientController.getProfile);

// Legacy root redirect: /patient -> /patient/overview
router.get("/", authenticate, requireRole(ROLES.PATIENT), (req, res) => {
    res.redirect("/patient/overview");
});

module.exports = router;
