/**
 * Super Admin Patient Assignment Engine & Clinical Relationship Controller
 * Health Tracker — Phase 8: Patient <-> Doctor Assignment Engine
 */

const Patient = require("../models/Patient");
const Doctor = require("../models/Doctor");
const User = require("../models/User");
const ActivityLog = require("../models/ActivityLog");
const {
    ROLES,
    ACCOUNT_STATUS,
    DOCTOR_STATUS,
    AUDIT_ACTIONS,
    ACTOR_ROLES,
    TARGET_TYPES
} = require("../config/constants");
const { isApiRequest } = require("../middleware/authMiddleware");

/**
 * Super Admin Patient Inventory with Assignment Status
 * GET /api/admin/patients or GET /admin/patients
 */
const getPatients = async (req, res) => {
    try {
        const rawPatients = await Patient.find().sort({ patientId: 1 }).lean();

        // Enrich with doctor name, account status, and assignment status
        const patients = await Promise.all(
            rawPatients.map(async (pat) => {
                let doctorName = null;
                if (pat.doctorId) {
                    const doc = await Doctor.findOne({ doctorId: pat.doctorId }).select("name").lean();
                    if (doc) {
                        doctorName = doc.name;
                    }
                }

                let accountStatus = ACCOUNT_STATUS.ACTIVE;
                if (pat.userId) {
                    const linkedUser = await User.findById(pat.userId).select("status").lean();
                    if (linkedUser) {
                        accountStatus = linkedUser.status;
                    }
                }

                return {
                    patientId: pat.patientId,
                    name: pat.name,
                    email: pat.email,
                    age: pat.age,
                    gender: pat.gender,
                    doctorId: pat.doctorId || null,
                    doctorName,
                    assignmentStatus: pat.doctorId ? "ASSIGNED" : "UNASSIGNED",
                    deviceId: pat.deviceId || null,
                    accountStatus,
                    createdAt: pat.createdAt
                };
            })
        );

        if (isApiRequest(req)) {
            return res.status(200).json({ success: true, count: patients.length, patients });
        }

        return res.render("admin/patients", {
            user: req.user,
            activePage: "patients",
            patients
        });
    } catch (error) {
        console.error("Admin patients error:", error.message);
        if (isApiRequest(req)) {
            return res.status(500).json({ success: false, message: "Failed to load patients" });
        }
        return res.status(500).send("Internal Server Error: Failed to load patients");
    }
};

/**
 * Get Eligible Active Doctors for Patient Assignment Dropdown
 * GET /api/admin/assignments/eligible-doctors
 */
const getEligibleDoctors = async (req, res) => {
    try {
        const activeDoctors = await Doctor.find({ status: DOCTOR_STATUS.ACTIVE })
            .select("doctorId name email specialization phone status")
            .sort({ name: 1 })
            .lean();

        const doctors = await Promise.all(
            activeDoctors.map(async (doc) => {
                const assignedCount = await Patient.countDocuments({ doctorId: doc.doctorId });
                return {
                    doctorId: doc.doctorId,
                    name: doc.name,
                    email: doc.email,
                    specialization: doc.specialization || "General Medicine",
                    assignedPatientCount: assignedCount,
                    status: doc.status
                };
            })
        );

        return res.status(200).json({
            success: true,
            count: doctors.length,
            doctors
        });
    } catch (error) {
        console.error("Get eligible doctors error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to load eligible doctors"
        });
    }
};

/**
 * Assign or Reassign Patient to Doctor
 * POST /api/admin/assignments
 * PATCH /api/admin/patients/:patientId/assign-doctor
 *
 * Payload: { patientId: "...", doctorId: "..." }
 * Invariants:
 * 1. Patient exists.
 * 2. Doctor exists and is ACTIVE.
 * 3. doctorId cannot be "UNASSIGNED" or malformed string.
 * 4. Atomic update of Patient.doctorId.
 * 5. Audit log generated (PATIENT_ASSIGNED or PATIENT_REASSIGNED).
 * 6. Historical telemetry snapshots remain untouched.
 */
const assignDoctor = async (req, res) => {
    try {
        const rawPatientId = req.params.patientId || (req.body && req.body.patientId);
        const rawDoctorId = req.body && req.body.doctorId;

        // 1. Validate required fields
        if (!rawPatientId || typeof rawPatientId !== "string" || !rawPatientId.trim()) {
            return res.status(400).json({
                success: false,
                message: "Valid patientId is required"
            });
        }

        if (!rawDoctorId || typeof rawDoctorId !== "string" || !rawDoctorId.trim()) {
            return res.status(400).json({
                success: false,
                message: "Valid doctorId is required"
            });
        }

        const cleanPatientId = rawPatientId.trim().toUpperCase();
        const cleanDoctorId = rawDoctorId.trim().toUpperCase();

        // Prevent fake placeholder doctor IDs
        if (cleanDoctorId === "UNASSIGNED" || cleanDoctorId === "NULL") {
            return res.status(400).json({
                success: false,
                message: "Invalid doctorId placeholder. Use unassign endpoint to clear doctor assignment."
            });
        }

        // 2. Verify Patient exists
        const patient = await Patient.findOne({ patientId: cleanPatientId });
        if (!patient) {
            return res.status(404).json({
                success: false,
                message: `Patient ${cleanPatientId} not found`
            });
        }

        // 3. Verify Doctor exists and is clinically ACTIVE
        const doctor = await Doctor.findOne({ doctorId: cleanDoctorId });
        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: `Doctor ${cleanDoctorId} not found`
            });
        }

        if (doctor.status !== DOCTOR_STATUS.ACTIVE) {
            return res.status(400).json({
                success: false,
                message: `Cannot assign to inactive or suspended doctor ${cleanDoctorId}`
            });
        }

        // 4. Check previous assignment state
        const previousDoctorId = patient.doctorId || null;
        const isReassignment = Boolean(previousDoctorId && previousDoctorId !== cleanDoctorId);

        // 5. Update assignment
        patient.doctorId = cleanDoctorId;
        await patient.save();

        // 6. Audit Logging
        const auditAction = isReassignment ? AUDIT_ACTIONS.PATIENT_REASSIGNED : AUDIT_ACTIONS.PATIENT_ASSIGNED;
        try {
            await ActivityLog.create({
                action: auditAction,
                actorRole: ACTOR_ROLES.SUPER_ADMIN,
                actorId: req.user ? (req.user.username || req.user.userId || "SUPER_ADMIN") : "SUPER_ADMIN",
                targetType: TARGET_TYPES.PATIENT,
                targetId: cleanPatientId,
                details: {
                    patientId: cleanPatientId,
                    previousDoctorId,
                    newDoctorId: cleanDoctorId,
                    doctorName: doctor.name
                },
                timestamp: new Date()
            });
        } catch (auditErr) {
            console.warn("Patient assignment audit log warning:", auditErr.message);
        }

        // 7. Refresh real-time socket authorization rooms
        const io = req.app && req.app.get ? req.app.get("io") : null;
        if (io) {
            try {
                const sockets = await io.in(`patient:${cleanPatientId}`).fetchSockets();
                for (const s of sockets) {
                    if (s.user && s.user.role === ROLES.DOCTOR && s.user.profileId !== cleanDoctorId) {
                        s.leave(`patient:${cleanPatientId}`);
                    }
                }
            } catch (sockErr) {
                // socket room management is non-blocking
            }
        }

        return res.status(200).json({
            success: true,
            message: isReassignment
                ? `Patient ${cleanPatientId} reassigned from ${previousDoctorId} to ${cleanDoctorId} (${doctor.name})`
                : `Patient ${cleanPatientId} assigned to ${cleanDoctorId} (${doctor.name})`,
            assignment: {
                patientId: cleanPatientId,
                doctorId: cleanDoctorId,
                doctorName: doctor.name,
                previousDoctorId,
                assignmentStatus: "ASSIGNED"
            }
        });
    } catch (error) {
        console.error("Assign doctor error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to assign doctor to patient"
        });
    }
};

/**
 * Unassign Patient from Current Doctor
 * DELETE /api/admin/assignments/:patientId
 * DELETE /api/admin/patients/:patientId/unassign-doctor
 *
 * Invariants:
 * 1. Patient exists.
 * 2. Sets Patient.doctorId = null.
 * 3. Patient record, user account, device linkage, and historical telemetry remain intact.
 * 4. Audit log generated (PATIENT_UNASSIGNED).
 * 5. Previous doctor room access revoked for patient room.
 */
const unassignDoctor = async (req, res) => {
    try {
        const rawPatientId = req.params.patientId || (req.body && req.body.patientId);

        if (!rawPatientId || typeof rawPatientId !== "string" || !rawPatientId.trim()) {
            return res.status(400).json({
                success: false,
                message: "Valid patientId is required"
            });
        }

        const cleanPatientId = rawPatientId.trim().toUpperCase();

        const patient = await Patient.findOne({ patientId: cleanPatientId });
        if (!patient) {
            return res.status(404).json({
                success: false,
                message: `Patient ${cleanPatientId} not found`
            });
        }

        const previousDoctorId = patient.doctorId || null;

        // Perform atomic unassignment
        patient.doctorId = null;
        await patient.save();

        // Audit Logging
        try {
            await ActivityLog.create({
                action: AUDIT_ACTIONS.PATIENT_UNASSIGNED,
                actorRole: ACTOR_ROLES.SUPER_ADMIN,
                actorId: req.user ? (req.user.username || req.user.userId || "SUPER_ADMIN") : "SUPER_ADMIN",
                targetType: TARGET_TYPES.PATIENT,
                targetId: cleanPatientId,
                details: {
                    patientId: cleanPatientId,
                    previousDoctorId,
                    newDoctorId: null
                },
                timestamp: new Date()
            });
        } catch (auditErr) {
            console.warn("Patient unassignment audit log warning:", auditErr.message);
        }

        // Real-time socket room eviction: any doctor in patient room leaves
        const io = req.app && req.app.get ? req.app.get("io") : null;
        if (io) {
            try {
                const sockets = await io.in(`patient:${cleanPatientId}`).fetchSockets();
                for (const s of sockets) {
                    if (s.user && s.user.role === ROLES.DOCTOR) {
                        s.leave(`patient:${cleanPatientId}`);
                    }
                }
            } catch (sockErr) {
                // socket room management is non-blocking
            }
        }

        return res.status(200).json({
            success: true,
            message: `Patient ${cleanPatientId} unassigned successfully`,
            assignment: {
                patientId: cleanPatientId,
                doctorId: null,
                previousDoctorId,
                assignmentStatus: "UNASSIGNED"
            }
        });
    } catch (error) {
        console.error("Unassign doctor error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to unassign doctor from patient"
        });
    }
};

module.exports = {
    getPatients,
    getEligibleDoctors,
    assignDoctor,
    unassignDoctor
};
