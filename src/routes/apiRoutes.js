/**
 * API Routes
 * Health Tracker — Phase 10: Reading History Engine & Paginated API
 */

const express = require("express");
const router = express.Router();
const readingController = require("../controllers/readingController");
const { authenticate } = require("../middleware/authMiddleware");
const { requirePatientOwnership } = require("../middleware/roleMiddleware");

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
