/**
 * API Routes
 * Health Tracker — Phase 10: Reading History Engine & Paginated API
 */

const express = require("express");
const router = express.Router();
const readingController = require("../controllers/readingController");
const { authenticate } = require("../middleware/authMiddleware");
const { requirePatientOwnership, requireRole } = require("../middleware/roleMiddleware");
const { ROLES } = require("../config/constants");
const deviceHealthController = require("../controllers/deviceHealthController");
const adminController = require("../controllers/adminController");

// Reject mutations on immutable ActivityLog
const rejectActivityMutation = (req, res) => {
    return res.status(405).json({
        success: false,
        message: "Activity log is strictly append-only and immutable. Modification or deletion is prohibited."
    });
};

// GET /api/admin/activity (Phase 13: Centralized System Activity & Audit Trail)
router.get(
    "/admin/activity",
    authenticate,
    requireRole(ROLES.SUPER_ADMIN),
    adminController.getActivity
);

// Immutability defense: reject any attempt to modify or delete activity records
router.put(["/admin/activity", "/admin/activity/:id"], authenticate, requireRole(ROLES.SUPER_ADMIN), rejectActivityMutation);
router.patch(["/admin/activity", "/admin/activity/:id"], authenticate, requireRole(ROLES.SUPER_ADMIN), rejectActivityMutation);
router.delete(["/admin/activity", "/admin/activity/:id"], authenticate, requireRole(ROLES.SUPER_ADMIN), rejectActivityMutation);

// GET /api/devices/health (Phase 12: Device Telemetry Health Diagnostics)
router.get(
    "/devices/health",
    authenticate,
    deviceHealthController.getDeviceHealthSummary
);

// GET /api/readings/:patientId/recent (Phase 11: Charts & Time-Series Data Visualization)
router.get(
    "/readings/:patientId/recent",
    authenticate,
    requirePatientOwnership("patientId"),
    readingController.getRecentReadings
);

// GET /api/readings/:patientId (Phase 10: Paginated Reading History)
router.get(
    "/readings/:patientId",
    authenticate,
    requirePatientOwnership("patientId"),
    readingController.getReadings
);

module.exports = router;
