/**
 * Super Admin Hardware Device Management Controller
 * Health Tracker — Phase 5: Hardware Device Management & Lifecycle Engine
 */

const mongoose = require("mongoose");
const Device = require("../models/Device");
const Patient = require("../models/Patient");
const SensorReading = require("../models/SensorReading");
const ActivityLog = require("../models/ActivityLog");
const {
    ROLES,
    DEVICE_STATUS,
    AUDIT_ACTIONS,
    ACTOR_ROLES,
    TARGET_TYPES
} = require("../config/constants");
const { isApiRequest } = require("../middleware/authMiddleware");
const { getDeviceHealth, calculateObservedFrequency, batchCalculateObservedFrequency } = require("../utils/deviceHealth");
const { logActivity } = require("../utils/activityLogger");

/**
 * Helper to safely sanitize a device document for API responses.
 * Never leaks apiKeyHash or internal secrets.
 */
const sanitizeDevice = (dev) => {
    if (!dev) return null;
    return {
        deviceId: dev.deviceId,
        type: dev.type || "VITAL_TELEMETRY",
        status: dev.status,
        patientId: dev.patientId,
        resetCount: dev.resetCount || 0,
        lastSeen: dev.lastSeen || null,
        createdAt: dev.createdAt,
        updatedAt: dev.updatedAt
    };
};

/**
 * List all devices with populated patient information
 * GET /api/admin/devices or GET /admin/devices
 */
const getDevices = async (req, res) => {
    try {
        const rawDevices = await Device.find().sort({ deviceId: 1 }).lean();

        // 1. Single batch query for patient names
        const patientIds = [...new Set(rawDevices.map((d) => d.patientId).filter(Boolean))];
        const patients = patientIds.length > 0
            ? await Patient.find({ patientId: { $in: patientIds } }).select("patientId name").lean()
            : [];
        const patientNameMap = new Map(patients.map((p) => [p.patientId, p.name]));

        // 2. Single batch aggregation for transmission frequencies
        const deviceIds = rawDevices.map((d) => d.deviceId);
        const frequencyMap = await batchCalculateObservedFrequency(deviceIds, 10);

        const devices = rawDevices.map((dev) => {
            const healthInfo = getDeviceHealth(dev);
            const freq = frequencyMap.get(dev.deviceId) || {
                frequencySeconds: null,
                formatted: "Insufficient data",
                sampleCount: 0
            };

            return {
                deviceId: dev.deviceId,
                type: dev.type || "VITAL_TELEMETRY",
                status: dev.status,
                health: healthInfo.health,
                ageSeconds: healthInfo.ageSeconds,
                patientId: dev.patientId,
                patientName: dev.patientId ? (patientNameMap.get(dev.patientId) || null) : null,
                resetCount: dev.resetCount || 0,
                lastSeen: dev.lastSeen || null,
                lastSeenFormatted: healthInfo.lastSeenFormatted,
                observedFrequency: freq.formatted,
                frequencySeconds: freq.frequencySeconds,
                createdAt: dev.createdAt,
                updatedAt: dev.updatedAt
            };
        });


        if (isApiRequest(req)) {
            return res.status(200).json({
                success: true,
                count: devices.length,
                devices
            });
        }

        return res.render("admin/devices", {
            user: req.user,
            activePage: "devices",
            devices
        });
    } catch (error) {
        console.error("Failed to load device list:", error.message);
        if (isApiRequest(req)) {
            return res.status(500).json({ success: false, message: "Failed to load device inventory" });
        }
        return res.status(500).send("Internal Server Error: Failed to load device inventory");
    }
};

/**
 * Create a new hardware device
 * POST /api/admin/devices
 * Body: { deviceId, type }
 */
const createDevice = async (req, res) => {
    try {
        const { deviceId, type } = req.body;

        if (!deviceId || typeof deviceId !== "string" || !deviceId.trim()) {
            return res.status(400).json({
                success: false,
                message: "deviceId is required and must be a non-empty string"
            });
        }

        const cleanDeviceId = deviceId.trim().toUpperCase();

        // 1. Prevent duplicate device ID
        const existingDevice = await Device.findOne({ deviceId: cleanDeviceId });
        if (existingDevice) {
            return res.status(400).json({
                success: false,
                message: `Device with ID ${cleanDeviceId} already exists`
            });
        }

        // 2. Create device: status=ACTIVE, patientId=null, resetCount=0
        const device = await Device.create({
            deviceId: cleanDeviceId,
            type: type && typeof type === "string" && type.trim() ? type.trim().toUpperCase() : "VITAL_TELEMETRY",
            status: DEVICE_STATUS.ACTIVE,
            patientId: null,
            resetCount: 0,
            lastSeen: null
        });

        // 3. Log lifecycle audit event
        try {
            const io = req.app && req.app.get ? req.app.get("io") : null;
            await logActivity(
                AUDIT_ACTIONS.DEVICE_CREATED,
                ACTOR_ROLES.SUPER_ADMIN,
                req.user.username || req.user.userId || "SUPER_ADMIN",
                TARGET_TYPES.DEVICE,
                cleanDeviceId,
                {
                    type: device.type,
                    status: device.status,
                    resetCount: device.resetCount
                },
                io
            );
        } catch (auditErr) {
            console.warn("Device creation audit log warning:", auditErr.message);
        }

        return res.status(201).json({
            success: true,
            message: `Device ${cleanDeviceId} created successfully`,
            device: sanitizeDevice(device)
        });
    } catch (error) {
        console.error("Device creation error:", error.message);
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "Duplicate deviceId detected. Device already exists."
            });
        }
        return res.status(500).json({
            success: false,
            message: "Failed to create device"
        });
    }
};

/**
 * Get single device details with telemetry summary and recent activity
 * GET /api/admin/devices/:deviceId
 */
const getDeviceById = async (req, res) => {
    try {
        const { deviceId } = req.params;
        if (!deviceId || typeof deviceId !== "string" || !deviceId.trim()) {
            return res.status(400).json({ success: false, message: "Valid deviceId is required" });
        }

        const cleanDeviceId = deviceId.trim().toUpperCase();
        const rawDevice = await Device.findOne({ deviceId: cleanDeviceId }).select("-apiKeyHash").lean();

        if (!rawDevice) {
            return res.status(404).json({
                success: false,
                message: `Device ${cleanDeviceId} not found`
            });
        }

        // Enrich with assigned patient details if assigned
        let patient = null;
        if (rawDevice.patientId) {
            patient = await Patient.findOne({ patientId: rawDevice.patientId })
                .select("patientId name email age gender doctorId createdAt")
                .lean();
        }

        // Telemetry metrics
        const totalReadings = await SensorReading.countDocuments({ deviceId: cleanDeviceId });
        const latestReading = await SensorReading.findOne({ deviceId: cleanDeviceId }).sort({ timestamp: -1 }).lean();

        // Recent lifecycle and audit events
        const recentActivity = await ActivityLog.find({ targetId: cleanDeviceId })
            .sort({ timestamp: -1 })
            .limit(10)
            .lean();

        const healthInfo = getDeviceHealth(rawDevice);
        const freq = await calculateObservedFrequency(cleanDeviceId, 10);

        const device = {
            ...sanitizeDevice(rawDevice),
            health: healthInfo.health,
            lastSeenFormatted: healthInfo.lastSeenFormatted,
            observedFrequency: freq.formatted,
            patient,
            telemetry: {
                totalReadings,
                latestReading: latestReading
                    ? {
                          readingId: latestReading._id,
                          value1: latestReading.value1,
                          value2: latestReading.value2,
                          patientId: latestReading.patientId,
                          doctorId: latestReading.doctorId,
                          timestamp: latestReading.timestamp
                      }
                    : null
            },
            recentActivity
        };

        if (isApiRequest(req)) {
            return res.status(200).json({
                success: true,
                device
            });
        }

        return res.render("admin/deviceDetail", {
            user: req.user,
            activePage: "devices",
            device
        });
    } catch (error) {
        console.error("Device detail retrieval error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to retrieve device details"
        });
    }
};

/**
 * Activate a hardware device
 * PATCH /api/admin/devices/:deviceId/activate
 * Preserves patient assignment and resetCount
 */
const activateDevice = async (req, res) => {
    try {
        const { deviceId } = req.params;
        if (!deviceId || typeof deviceId !== "string" || !deviceId.trim()) {
            return res.status(400).json({ success: false, message: "Valid deviceId is required" });
        }

        const cleanDeviceId = deviceId.trim().toUpperCase();
        const device = await Device.findOne({ deviceId: cleanDeviceId });

        if (!device) {
            return res.status(404).json({
                success: false,
                message: `Device ${cleanDeviceId} not found`
            });
        }

        const previousStatus = device.status;
        device.status = DEVICE_STATUS.ACTIVE;
        await device.save();

        // Log audit event
        try {
            const io = req.app && req.app.get ? req.app.get("io") : null;
            await logActivity(
                AUDIT_ACTIONS.DEVICE_ACTIVATED,
                ACTOR_ROLES.SUPER_ADMIN,
                req.user.username || req.user.userId || "SUPER_ADMIN",
                TARGET_TYPES.DEVICE,
                cleanDeviceId,
                {
                    previousStatus,
                    status: device.status,
                    patientId: device.patientId
                },
                io
            );
        } catch (auditErr) {
            console.warn("Device activation audit log warning:", auditErr.message);
        }

        return res.status(200).json({
            success: true,
            message: `Device ${cleanDeviceId} activated successfully`,
            device: sanitizeDevice(device)
        });
    } catch (error) {
        console.error("Device activation error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to activate device"
        });
    }
};

/**
 * Deactivate a hardware device
 * PATCH /api/admin/devices/:deviceId/deactivate
 * Preserves patient assignment and resetCount
 */
const deactivateDevice = async (req, res) => {
    try {
        const { deviceId } = req.params;
        if (!deviceId || typeof deviceId !== "string" || !deviceId.trim()) {
            return res.status(400).json({ success: false, message: "Valid deviceId is required" });
        }

        const cleanDeviceId = deviceId.trim().toUpperCase();
        const device = await Device.findOne({ deviceId: cleanDeviceId });

        if (!device) {
            return res.status(404).json({
                success: false,
                message: `Device ${cleanDeviceId} not found`
            });
        }

        const previousStatus = device.status;
        device.status = DEVICE_STATUS.INACTIVE;
        await device.save();

        // Log audit event
        try {
            const io = req.app && req.app.get ? req.app.get("io") : null;
            await logActivity(
                AUDIT_ACTIONS.DEVICE_DEACTIVATED,
                ACTOR_ROLES.SUPER_ADMIN,
                req.user.username || req.user.userId || "SUPER_ADMIN",
                TARGET_TYPES.DEVICE,
                cleanDeviceId,
                {
                    previousStatus,
                    status: device.status,
                    patientId: device.patientId
                },
                io
            );
        } catch (auditErr) {
            console.warn("Device deactivation audit log warning:", auditErr.message);
        }

        return res.status(200).json({
            success: true,
            message: `Device ${cleanDeviceId} deactivated successfully`,
            device: sanitizeDevice(device)
        });
    } catch (error) {
        console.error("Device deactivation error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to deactivate device"
        });
    }
};

/**
 * Atomic Device Reset Operation
 * POST /api/admin/devices/:deviceId/reset
 * - Unbinds current Patient: Device.patientId = null, Patient.deviceId = null
 * - Increments Device.resetCount by 1
 * - Preserves historical SensorReading records
 * - Preserves Patient account and document
 * - Appends DEVICE_RESET to ActivityLog
 * - Uses MongoDB transaction where supported, with compensation rollback in standalone mode
 */
const resetDevice = async (req, res) => {
    let session = null;
    try {
        const { deviceId } = req.params;
        if (!deviceId || typeof deviceId !== "string" || !deviceId.trim()) {
            return res.status(400).json({ success: false, message: "Valid deviceId is required" });
        }

        const cleanDeviceId = deviceId.trim().toUpperCase();
        const device = await Device.findOne({ deviceId: cleanDeviceId });

        if (!device) {
            return res.status(404).json({
                success: false,
                message: `Device ${cleanDeviceId} not found`
            });
        }

        const formerPatientId = device.patientId;
        let updatedDevice = null;
        let transactionSucceeded = false;

        // 1. Attempt native MongoDB multi-document transaction first
        try {
            session = await mongoose.startSession();
            await session.withTransaction(async () => {
                const devInTx = await Device.findOne({ deviceId: cleanDeviceId }).session(session);
                if (!devInTx) {
                    throw new Error("Device disappeared during transaction");
                }

                devInTx.patientId = null;
                devInTx.resetCount = (devInTx.resetCount || 0) + 1;
                await devInTx.save({ session });

                if (formerPatientId) {
                    await Patient.updateOne(
                        { patientId: formerPatientId },
                        { $set: { deviceId: null } },
                        { session }
                    );
                }

                const io = req.app && req.app.get ? req.app.get("io") : null;
                await logActivity(
                    AUDIT_ACTIONS.DEVICE_RESET,
                    ACTOR_ROLES.SUPER_ADMIN,
                    req.user.username || req.user.userId || "SUPER_ADMIN",
                    TARGET_TYPES.DEVICE,
                    cleanDeviceId,
                    {
                        previousPatientId: formerPatientId,
                        resetCount: devInTx.resetCount,
                        status: devInTx.status,
                        atomicity: "TRANSACTION"
                    },
                    io,
                    { session }
                );

                updatedDevice = devInTx;
            });
            transactionSucceeded = true;
        } catch (txErr) {
            if (
                txErr.message &&
                (txErr.message.includes("Transaction numbers are only allowed on a replica set member or mongos") ||
                 txErr.message.includes("does not support retryable writes"))
            ) {
                // Standalone MongoDB environment detected
                transactionSucceeded = false;
            } else {
                throw txErr;
            }
        } finally {
            if (session) {
                await session.endSession();
                session = null;
            }
        }

        // 2. Coordinated update with compensation rollback for standalone environments
        if (!transactionSucceeded) {
            const originalPatientId = device.patientId;
            const originalResetCount = device.resetCount;

            device.patientId = null;
            device.resetCount = (device.resetCount || 0) + 1;
            await device.save();

            if (formerPatientId) {
                try {
                    await Patient.updateOne(
                        { patientId: formerPatientId },
                        { $set: { deviceId: null } }
                    );
                } catch (patientErr) {
                    // Compensation rollback to preserve invariant consistency
                    await Device.updateOne(
                        { deviceId: cleanDeviceId },
                        { $set: { patientId: originalPatientId, resetCount: originalResetCount } }
                    );
                    throw patientErr;
                }
            }

            try {
                const io = req.app && req.app.get ? req.app.get("io") : null;
                await logActivity(
                    AUDIT_ACTIONS.DEVICE_RESET,
                    ACTOR_ROLES.SUPER_ADMIN,
                    req.user.username || req.user.userId || "SUPER_ADMIN",
                    TARGET_TYPES.DEVICE,
                    cleanDeviceId,
                    {
                        previousPatientId: formerPatientId,
                        resetCount: device.resetCount,
                        status: device.status,
                        atomicity: "COORDINATED_COMPENSATION"
                    },
                    io
                );
            } catch (auditErr) {
                console.warn("Reset audit log error:", auditErr.message);
            }

            updatedDevice = device;
        }

        return res.status(200).json({
            success: true,
            message: `Device ${cleanDeviceId} reset successfully. Patient unlinked, history preserved.`,
            device: sanitizeDevice(updatedDevice),
            unlinkedPatientId: formerPatientId
        });
    } catch (error) {
        console.error("Device reset error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to reset device"
        });
    }
};

/**
 * Delete / Decommission a Hardware Device
 * DELETE /api/admin/devices/:deviceId
 * Permitted only if unassigned: patientId === null
 * Preserves historical SensorReading records (never deletes telemetry)
 */
const deleteDevice = async (req, res) => {
    try {
        const { deviceId } = req.params;
        if (!deviceId || typeof deviceId !== "string" || !deviceId.trim()) {
            return res.status(400).json({ success: false, message: "Valid deviceId is required" });
        }

        const cleanDeviceId = deviceId.trim().toUpperCase();
        const device = await Device.findOne({ deviceId: cleanDeviceId });

        if (!device) {
            return res.status(404).json({
                success: false,
                message: `Device ${cleanDeviceId} not found`
            });
        }

        // Rule: Only unassigned devices can be deleted
        if (device.patientId !== null) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete device ${cleanDeviceId}: device is currently assigned to patient ${device.patientId}. Reset the device before deleting.`
            });
        }

        // Delete device document
        await Device.deleteOne({ deviceId: cleanDeviceId });

        // Log audit event
        try {
            const io = req.app && req.app.get ? req.app.get("io") : null;
            await logActivity(
                AUDIT_ACTIONS.DEVICE_DELETED,
                ACTOR_ROLES.SUPER_ADMIN,
                req.user.username || req.user.userId || "SUPER_ADMIN",
                TARGET_TYPES.DEVICE,
                cleanDeviceId,
                {
                    lastStatus: device.status,
                    resetCount: device.resetCount,
                    type: device.type
                },
                io
            );
        } catch (auditErr) {
            console.warn("Device deletion audit log warning:", auditErr.message);
        }

        return res.status(200).json({
            success: true,
            message: `Device ${cleanDeviceId} deleted successfully. Historical telemetry records preserved.`
        });
    } catch (error) {
        console.error("Device deletion error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to delete device"
        });
    }
};

/**
 * Assign Device to Patient (Task 5.5 Invariant Enforcement)
 * POST /api/admin/devices/:deviceId/assign
 * Body: { patientId }
 * Enforces:
 * 1. Device exists
 * 2. Device is ACTIVE
 * 3. Device is unassigned (patientId === null)
 * 4. Patient exists
 * 5. Patient has no current device (deviceId === null)
 * 6. Performs atomic assignment with rollback protection
 */
const assignDevice = async (req, res) => {
    let session = null;
    try {
        const { deviceId } = req.params;
        const { patientId } = req.body;

        if (!deviceId || typeof deviceId !== "string" || !deviceId.trim()) {
            return res.status(400).json({ success: false, message: "Valid deviceId is required" });
        }

        if (!patientId || typeof patientId !== "string" || !patientId.trim()) {
            return res.status(400).json({ success: false, message: "patientId is required" });
        }

        const cleanDeviceId = deviceId.trim().toUpperCase();
        const cleanPatientId = patientId.trim().toUpperCase();

        // 1. Verify device exists
        const device = await Device.findOne({ deviceId: cleanDeviceId });
        if (!device) {
            return res.status(404).json({ success: false, message: `Device ${cleanDeviceId} not found` });
        }

        // 2. Verify device is ACTIVE
        if (device.status !== DEVICE_STATUS.ACTIVE) {
            return res.status(400).json({
                success: false,
                message: `Device ${cleanDeviceId} is inactive and cannot be assigned`
            });
        }

        // 3. Verify device is not already assigned
        if (device.patientId !== null) {
            return res.status(400).json({
                success: false,
                message: `Device ${cleanDeviceId} is already assigned to patient ${device.patientId}`
            });
        }

        // 4. Verify patient exists
        const patient = await Patient.findOne({ patientId: cleanPatientId });
        if (!patient) {
            return res.status(404).json({
                success: false,
                message: `Patient ${cleanPatientId} not found`
            });
        }

        // 5. Verify patient does not already have another device
        if (patient.deviceId !== null) {
            return res.status(400).json({
                success: false,
                message: `Patient ${cleanPatientId} is already assigned to device ${patient.deviceId}`
            });
        }

        // 6. Perform assignment
        let transactionSucceeded = false;
        try {
            session = await mongoose.startSession();
            await session.withTransaction(async () => {
                device.patientId = cleanPatientId;
                await device.save({ session });

                patient.deviceId = cleanDeviceId;
                await patient.save({ session });

                const io = req.app && req.app.get ? req.app.get("io") : null;
                await logActivity(
                    AUDIT_ACTIONS.DEVICE_ASSIGNED,
                    ACTOR_ROLES.SUPER_ADMIN,
                    req.user.username || req.user.userId || "SUPER_ADMIN",
                    TARGET_TYPES.DEVICE,
                    cleanDeviceId,
                    {
                        patientId: cleanPatientId,
                        atomicity: "TRANSACTION"
                    },
                    io,
                    { session }
                );
            });
            transactionSucceeded = true;
        } catch (txErr) {
            if (
                txErr.message &&
                (txErr.message.includes("Transaction numbers are only allowed on a replica set member or mongos") ||
                 txErr.message.includes("does not support retryable writes"))
            ) {
                transactionSucceeded = false;
            } else {
                throw txErr;
            }
        } finally {
            if (session) {
                await session.endSession();
                session = null;
            }
        }

        if (!transactionSucceeded) {
            device.patientId = cleanPatientId;
            await device.save();

            try {
                patient.deviceId = cleanDeviceId;
                await patient.save();
            } catch (patErr) {
                // Rollback device assignment
                await Device.updateOne({ deviceId: cleanDeviceId }, { $set: { patientId: null } });
                throw patErr;
            }

            try {
                const io = req.app && req.app.get ? req.app.get("io") : null;
                await logActivity(
                    AUDIT_ACTIONS.DEVICE_ASSIGNED,
                    ACTOR_ROLES.SUPER_ADMIN,
                    req.user.username || req.user.userId || "SUPER_ADMIN",
                    TARGET_TYPES.DEVICE,
                    cleanDeviceId,
                    {
                        patientId: cleanPatientId,
                        atomicity: "COORDINATED_COMPENSATION"
                    },
                    io
                );
            } catch (auditErr) {
                console.warn("Assignment audit log warning:", auditErr.message);
            }
        }

        return res.status(200).json({
            success: true,
            message: `Device ${cleanDeviceId} successfully assigned to patient ${cleanPatientId}`,
            device: sanitizeDevice(device),
            patient: {
                patientId: patient.patientId,
                name: patient.name,
                deviceId: patient.deviceId
            }
        });
    } catch (error) {
        console.error("Device assignment error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to assign device"
        });
    }
};

module.exports = {
    getDevices,
    createDevice,
    getDeviceById,
    activateDevice,
    deactivateDevice,
    resetDevice,
    deleteDevice,
    assignDevice
};
