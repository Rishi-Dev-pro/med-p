/**
 * Device Health & Telemetry Diagnostics Controller
 * Health Tracker — Phase 12: Device Monitoring & Telemetry Health Dashboard
 */

const Device = require("../models/Device");
const Patient = require("../models/Patient");
const { ROLES } = require("../config/constants");
const { getDeviceHealth, calculateObservedFrequency } = require("../utils/deviceHealth");

/**
 * GET /api/devices/health
 * 
 * Strict RBAC Scoping:
 * - SUPER_ADMIN: Complete hardware inventory health and telemetry diagnostics
 * - DOCTOR: Only devices assigned to patients currently under the authenticated doctor's care
 * - PATIENT: Only the single device assigned to the authenticated patient
 */
const getDeviceHealthSummary = async (req, res) => {
    try {
        const { role, profileId } = req.user;
        const requestedDeviceId = req.query.deviceId ? String(req.query.deviceId).trim().toUpperCase() : null;
        const requestedPatientId = req.query.patientId ? String(req.query.patientId).trim().toUpperCase() : null;
        const requestedDoctorId = req.query.doctorId ? String(req.query.doctorId).trim().toUpperCase() : null;

        let devicesToInspect = [];

        // ==========================================
        // 1. SUPER ADMIN AUTHORIZATION
        // ==========================================
        if (role === ROLES.SUPER_ADMIN) {
            const query = {};
            if (requestedDeviceId) {
                query.deviceId = requestedDeviceId;
            }
            if (requestedPatientId) {
                query.patientId = requestedPatientId;
            }

            devicesToInspect = await Device.find(query)
                .select("-apiKeyHash")
                .sort({ deviceId: 1 })
                .lean();

            if (requestedDeviceId && devicesToInspect.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: `Device ${requestedDeviceId} not found`
                });
            }
        }

        // ==========================================
        // 2. DOCTOR AUTHORIZATION
        // ==========================================
        else if (role === ROLES.DOCTOR) {
            // Guard: Query tampering prevention
            if (requestedDoctorId && requestedDoctorId !== profileId) {
                return res.status(403).json({
                    success: false,
                    message: "Forbidden: Cannot query devices for another doctor"
                });
            }

            // Derive strictly from current Patient.doctorId assignment
            const assignedPatients = await Patient.find({ doctorId: profileId })
                .select("patientId name deviceId")
                .lean();

            const assignedPatientMap = new Map();
            const assignedDeviceIds = [];

            assignedPatients.forEach((p) => {
                assignedPatientMap.set(p.patientId, p);
                if (p.deviceId) {
                    assignedDeviceIds.push(p.deviceId);
                }
            });

            // Guard: If specific patient was requested, verify assignment
            if (requestedPatientId) {
                if (!assignedPatientMap.has(requestedPatientId)) {
                    return res.status(403).json({
                        success: false,
                        message: "Forbidden: Patient is not assigned to your clinical care"
                    });
                }
            }

            // Guard: If specific device was requested, verify it belongs to assigned patient
            if (requestedDeviceId) {
                if (!assignedDeviceIds.includes(requestedDeviceId)) {
                    return res.status(403).json({
                        success: false,
                        message: "Forbidden: Device is not assigned to any patient under your care"
                    });
                }
            }

            let targetDeviceIds = assignedDeviceIds;
            if (requestedDeviceId) {
                targetDeviceIds = [requestedDeviceId];
            } else if (requestedPatientId) {
                const targetPatient = assignedPatientMap.get(requestedPatientId);
                targetDeviceIds = targetPatient && targetPatient.deviceId ? [targetPatient.deviceId] : [];
            }

            if (targetDeviceIds.length > 0) {
                devicesToInspect = await Device.find({ deviceId: { $in: targetDeviceIds } })
                    .select("-apiKeyHash")
                    .sort({ deviceId: 1 })
                    .lean();
            } else {
                devicesToInspect = [];
            }
        }

        // ==========================================
        // 3. PATIENT AUTHORIZATION
        // ==========================================
        else if (role === ROLES.PATIENT) {
            // Guard: Query tampering prevention
            if (requestedPatientId && requestedPatientId !== profileId) {
                return res.status(403).json({
                    success: false,
                    message: "Forbidden: Cannot inspect another patient's device health"
                });
            }

            const patient = await Patient.findOne({ patientId: profileId })
                .select("patientId name deviceId")
                .lean();

            if (requestedDeviceId && (!patient || requestedDeviceId !== patient.deviceId)) {
                return res.status(403).json({
                    success: false,
                    message: "Forbidden: Device does not belong to you"
                });
            }

            if (!patient || !patient.deviceId) {
                return res.status(200).json({
                    success: true,
                    count: 0,
                    devices: []
                });
            }

            devicesToInspect = await Device.find({ deviceId: patient.deviceId })
                .select("-apiKeyHash")
                .lean();
        } else {
            return res.status(403).json({
                success: false,
                message: "Forbidden: Role not authorized for device health inspection"
            });
        }

        // ==========================================
        // HYDRATE HEALTH & FREQUENCY METRICS
        // ==========================================
        const hydratedDevices = await Promise.all(
            devicesToInspect.map(async (dev) => {
                const healthInfo = getDeviceHealth(dev);
                const frequency = await calculateObservedFrequency(dev.deviceId, 10);

                let patientName = null;
                if (dev.patientId) {
                    const pat = await Patient.findOne({ patientId: dev.patientId }).select("name").lean();
                    if (pat) {
                        patientName = pat.name;
                    }
                }

                return {
                    deviceId: dev.deviceId,
                    type: dev.type || "VITAL_TELEMETRY",
                    status: dev.status,
                    health: healthInfo.health,
                    ageSeconds: healthInfo.ageSeconds,
                    lastSeen: healthInfo.lastSeen,
                    lastSeenFormatted: healthInfo.lastSeenFormatted,
                    resetCount: dev.resetCount || 0,
                    patientId: dev.patientId || null,
                    patientName,
                    observedFrequency: frequency.formatted,
                    frequencySeconds: frequency.frequencySeconds,
                    sampleCount: frequency.sampleCount
                };
            })
        );

        return res.status(200).json({
            success: true,
            count: hydratedDevices.length,
            devices: hydratedDevices
        });
    } catch (error) {
        console.error("Device health retrieval error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to retrieve device telemetry health"
        });
    }
};

module.exports = {
    getDeviceHealthSummary
};
