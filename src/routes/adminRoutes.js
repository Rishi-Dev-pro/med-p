const express = require("express");
const { authenticate } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { ROLES } = require("../config/constants");
const adminController = require("../controllers/adminController");
const adminDeviceController = require("../controllers/adminDeviceController");
const adminDoctorController = require("../controllers/adminDoctorController");
const adminPatientController = require("../controllers/adminPatientController");

const router = express.Router();

/**
 * Super Admin Protected HTML & API Routes
 * Health Tracker — Phase 4: Super Admin Portal & Layout
 * Health Tracker — Phase 5: Hardware Device Management & Lifecycle
 * Health Tracker — Phase 7: Doctor Provisioning & Account Lifecycle
 * Health Tracker — Phase 8: Patient <-> Doctor Assignment Engine
 *
 * Every route requires valid JWT authentication and role === 'SUPER_ADMIN'.
 */

// Super Admin Overview / Dashboard
router.get("/", authenticate, requireRole(ROLES.SUPER_ADMIN), adminController.getOverview);
router.get("/overview", authenticate, requireRole(ROLES.SUPER_ADMIN), adminController.getOverview);

// Phase 8 Patient <-> Doctor Assignment Engine Endpoints
router.post("/assignments", authenticate, requireRole(ROLES.SUPER_ADMIN), adminPatientController.assignDoctor);
router.delete("/assignments/:patientId", authenticate, requireRole(ROLES.SUPER_ADMIN), adminPatientController.unassignDoctor);
router.get("/assignments/eligible-doctors", authenticate, requireRole(ROLES.SUPER_ADMIN), adminPatientController.getEligibleDoctors);
router.patch("/patients/:patientId/assign-doctor", authenticate, requireRole(ROLES.SUPER_ADMIN), adminPatientController.assignDoctor);
router.delete("/patients/:patientId/unassign-doctor", authenticate, requireRole(ROLES.SUPER_ADMIN), adminPatientController.unassignDoctor);

// Phase 7 Doctor Management & Lifecycle Endpoints
router.get("/doctors", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDoctorController.getDoctors);
router.post("/doctors", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDoctorController.createDoctor);
router.get("/doctors/:doctorId", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDoctorController.getDoctorById);
router.patch("/doctors/:doctorId/activate", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDoctorController.activateDoctor);
router.patch("/doctors/:doctorId/deactivate", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDoctorController.deactivateDoctor);
router.delete("/doctors/:doctorId", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDoctorController.deleteDoctor);

// Super Admin Management Foundations
router.get("/patients", authenticate, requireRole(ROLES.SUPER_ADMIN), adminPatientController.getPatients);
router.get("/activity", authenticate, requireRole(ROLES.SUPER_ADMIN), adminController.getActivity);
router.all(["/activity", "/activity/:id"], authenticate, requireRole(ROLES.SUPER_ADMIN), (req, res, next) => {
    if (["PUT", "PATCH", "DELETE", "POST"].includes(req.method)) {
        return res.status(405).json({
            success: false,
            message: "Activity log is strictly append-only and immutable. Modification or deletion is prohibited."
        });
    }
    next();
});

// Phase 5 Hardware Device Management & Lifecycle Endpoints
router.get("/devices", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.getDevices);
router.post("/devices", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.createDevice);
router.get("/devices/:deviceId", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.getDeviceById);
router.patch("/devices/:deviceId/activate", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.activateDevice);
router.patch("/devices/:deviceId/deactivate", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.deactivateDevice);
router.post("/devices/:deviceId/reset", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.resetDevice);
router.delete("/devices/:deviceId", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.deleteDevice);
router.post("/devices/:deviceId/assign", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.assignDevice);
router.post("/devices/:deviceId/rotate-key", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.rotateDeviceApiKey);
router.post("/devices/:deviceId/revoke-key", authenticate, requireRole(ROLES.SUPER_ADMIN), adminDeviceController.revokeDeviceApiKey);

// Super Admin Logout (Supports GET and POST)
router.all("/logout", adminController.logout);

// Super Admin Authorization Status (Preserves Phase 3 API Contract)
router.get("/status", authenticate, requireRole(ROLES.SUPER_ADMIN), adminController.getStatus);

module.exports = router;
