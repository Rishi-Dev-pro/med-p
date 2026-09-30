const express = require("express");
const { authenticate } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { ROLES } = require("../config/constants");
const adminController = require("../controllers/adminController");
const adminDeviceController = require("../controllers/adminDeviceController");

const router = express.Router();

/**
 * Super Admin Protected HTML & API Routes
 * Health Tracker — Phase 4: Super Admin Portal & Layout
 * Health Tracker — Phase 5: Hardware Device Management & Lifecycle
 *
 * Every route requires valid JWT authentication and role === 'SUPER_ADMIN'.
 */

// Super Admin Overview / Dashboard
router.get("/", authenticate, requireRole(ROLES.SUPER_ADMIN), adminController.getOverview);
router.get("/overview", authenticate, requireRole(ROLES.SUPER_ADMIN), adminController.getOverview);

// Super Admin Management Foundations
router.get("/doctors", authenticate, requireRole(ROLES.SUPER_ADMIN), adminController.getDoctors);
router.get("/patients", authenticate, requireRole(ROLES.SUPER_ADMIN), adminController.getPatients);
router.get("/activity", authenticate, requireRole(ROLES.SUPER_ADMIN), adminController.getActivity);

// Phase 5 Hardware Device Management & Lifecycle Endpoints
router.get("/devices", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.getDevices);
router.post("/devices", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.createDevice);
router.get("/devices/:deviceId", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.getDeviceById);
router.patch("/devices/:deviceId/activate", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.activateDevice);
router.patch("/devices/:deviceId/deactivate", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.deactivateDevice);
router.post("/devices/:deviceId/reset", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.resetDevice);
router.delete("/devices/:deviceId", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.deleteDevice);
router.post("/devices/:deviceId/assign", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.assignDevice);

// Super Admin Logout (Supports GET and POST)
router.all("/logout", adminController.logout);

// Super Admin Authorization Status (Preserves Phase 3 API Contract)
router.get("/status", authenticate, requireRole(ROLES.SUPER_ADMIN), adminController.getStatus);

module.exports = router;
