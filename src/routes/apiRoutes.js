/**
 * API Routes
 * Health Tracker — Phase 10: Reading History Engine & Paginated API
 */

const express = require("express");
const router = express.Router();
const readingController = require("../controllers/readingController");
const { authenticate } = require("../middleware/authMiddleware");
const { requirePatientOwnership } = require("../middleware/roleMiddleware");

// GET /api/readings/:patientId
router.get(
    "/readings/:patientId",
    authenticate,
    requirePatientOwnership("patientId"),
    readingController.getReadings
);

module.exports = router;
