/**
 * Super Admin Doctor Provisioning & Account Lifecycle Controller
 * Health Tracker — Phase 7: Doctor Provisioning, Credential Management & Account Lifecycle
 */

const crypto = require("crypto");
const mongoose = require("mongoose");
const Doctor = require("../models/Doctor");
const User = require("../models/User");
const Patient = require("../models/Patient");
const ActivityLog = require("../models/ActivityLog");
const {
    ROLES,
    ACCOUNT_STATUS,
    DOCTOR_STATUS,
    AUDIT_ACTIONS,
    ACTOR_ROLES,
    TARGET_TYPES
} = require("../config/constants");
const { hashPassword } = require("../utils/authUtils");
const { isApiRequest } = require("../middleware/authMiddleware");

/**
 * Sanitizes doctor information for safe exposure.
 * Strictly excludes passwordHash, plaintext password, JWT secrets, and API keys.
 */
const sanitizeDoctor = (doctorDoc, userDoc = null, patientCount = 0) => {
    if (!doctorDoc) return null;
    return {
        doctorId: doctorDoc.doctorId,
        name: doctorDoc.name,
        email: doctorDoc.email,
        username: userDoc ? userDoc.username : (doctorDoc.username || null),
        phone: doctorDoc.phone || null,
        specialization: doctorDoc.specialization || "General Medicine",
        specialty: doctorDoc.specialization || doctorDoc.specialty || "General Medicine",
        status: doctorDoc.status || DOCTOR_STATUS.ACTIVE,
        accountStatus: userDoc ? userDoc.status : ACCOUNT_STATUS.ACTIVE,
        assignedPatientCount: patientCount,
        createdAt: doctorDoc.createdAt,
        updatedAt: doctorDoc.updatedAt
    };
};

/**
 * Generate a cryptographically secure initial temporary password.
 * Format: Doc_<randomHex>!
 */
const generateSecureTemporaryPassword = () => {
    const randomHex = crypto.randomBytes(4).toString("hex");
    return `Doc_${randomHex}!9`;
};

/**
 * List all doctors in the clinical directory
 * GET /api/admin/doctors or GET /admin/doctors
 */
const getDoctors = async (req, res) => {
    try {
        const rawDoctors = await Doctor.find().sort({ doctorId: 1 }).lean();

        // Enrich with assigned patient counts and linked user account status
        const doctors = await Promise.all(
            rawDoctors.map(async (doc) => {
                const assignedPatientCount = await Patient.countDocuments({ doctorId: doc.doctorId });
                let accountStatus = ACCOUNT_STATUS.ACTIVE;
                let username = null;

                if (doc.userId) {
                    const linkedUser = await User.findById(doc.userId).select("username status").lean();
                    if (linkedUser) {
                        accountStatus = linkedUser.status;
                        username = linkedUser.username;
                    }
                }

                return {
                    doctorId: doc.doctorId,
                    name: doc.name,
                    email: doc.email,
                    username,
                    phone: doc.phone || null,
                    specialization: doc.specialization || "General Medicine",
                    specialty: doc.specialization || "General Medicine",
                    status: doc.status || DOCTOR_STATUS.ACTIVE,
                    accountStatus,
                    assignedPatientCount,
                    createdAt: doc.createdAt,
                    updatedAt: doc.updatedAt
                };
            })
        );

        if (isApiRequest(req)) {
            return res.status(200).json({
                success: true,
                count: doctors.length,
                doctors
            });
        }

        return res.render("admin/doctors", {
            user: req.user,
            activePage: "doctors",
            doctors
        });
    } catch (error) {
        console.error("Admin getDoctors error:", error.message);
        if (isApiRequest(req)) {
            return res.status(500).json({ success: false, message: "Failed to load doctors" });
        }
        return res.status(500).send("Internal Server Error: Failed to load doctors");
    }
};

/**
 * Super Admin Doctor Provisioning API
 * POST /api/admin/doctors
 *
 * Body: { name, email, username?, phone?, specialization?, specialty?, password?, doctorId? }
 *
 * Enforces:
 * 1. Super Admin authentication & role authorization
 * 2. Name validation (required non-empty string)
 * 3. Email normalization and format validation
 * 4. Duplicate email rejection (across User & Doctor)
 * 5. Username normalization and uniqueness
 * 6. Hardcoded role: DOCTOR (rejects client role spoofing)
 * 7. Secure credential provisioning (bcrypt hashed, plaintext never stored)
 * 8. 1:1 invariant User <-> Doctor
 * 9. ActivityLog event: DOCTOR_CREATED (no secrets logged)
 */
const createDoctor = async (req, res) => {
    let createdUser = null;
    try {
        const {
            name,
            email,
            username,
            phone,
            specialization,
            specialty,
            password,
            doctorId: customDoctorId
        } = req.body;

        // 1. Validate name
        if (!name || typeof name !== "string" || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: "Doctor name is required and must be a non-empty string"
            });
        }
        const cleanName = name.trim();

        // 2. Validate email
        if (!email || typeof email !== "string" || !email.trim()) {
            return res.status(400).json({
                success: false,
                message: "Doctor email is required"
            });
        }
        const cleanEmail = email.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanEmail)) {
            return res.status(400).json({
                success: false,
                message: "Please provide a valid email address"
            });
        }

        // 3. Reject duplicate email in User & Doctor collections
        const existingUserByEmail = await User.findOne({ email: cleanEmail });
        if (existingUserByEmail) {
            return res.status(400).json({
                success: false,
                message: "Email is already registered"
            });
        }
        const existingDoctorByEmail = await Doctor.findOne({ email: cleanEmail });
        if (existingDoctorByEmail) {
            return res.status(400).json({
                success: false,
                message: "Doctor with this email already exists"
            });
        }

        // 4. Resolve & validate username
        let finalUsername = null;
        if (username && typeof username === "string" && username.trim()) {
            const candidateUsername = username.trim().toLowerCase();
            if (candidateUsername.length < 3) {
                return res.status(400).json({
                    success: false,
                    message: "Username must be at least 3 characters long"
                });
            }
            if (!/^[a-z0-9_]+$/.test(candidateUsername)) {
                return res.status(400).json({
                    success: false,
                    message: "Username may only contain lowercase letters, numbers, and underscores"
                });
            }
            const existingUserByUsername = await User.findOne({ username: candidateUsername });
            if (existingUserByUsername) {
                return res.status(400).json({
                    success: false,
                    message: "Username is already taken"
                });
            }
            finalUsername = candidateUsername;
        } else {
            // Auto-generate unique username from doctor's name
            let baseUsername = `dr_${cleanName.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 20)}`;
            if (!baseUsername || baseUsername === "dr_") {
                baseUsername = `dr_${cleanEmail.split("@")[0].replace(/[^a-z0-9]/g, "_")}`;
            }
            let candidateUsername = baseUsername;
            let suffix = 1;
            while (await User.findOne({ username: candidateUsername })) {
                candidateUsername = `${baseUsername}_${suffix++}`;
            }
            finalUsername = candidateUsername;
        }

        // 5. Resolve doctorId (DOC-XXX)
        let finalDoctorId = null;
        if (customDoctorId && typeof customDoctorId === "string" && customDoctorId.trim()) {
            const cleanCustomId = customDoctorId.trim().toUpperCase();
            const existingDoctorById = await Doctor.findOne({ doctorId: cleanCustomId });
            if (existingDoctorById) {
                return res.status(400).json({
                    success: false,
                    message: `Doctor with ID ${cleanCustomId} already exists`
                });
            }
            finalDoctorId = cleanCustomId;
        } else {
            let count = await Doctor.countDocuments();
            let candidateId = `DOC-${String(count + 1).padStart(3, "0")}`;
            while (await Doctor.findOne({ doctorId: candidateId })) {
                count++;
                candidateId = `DOC-${String(count + 1).padStart(3, "0")}`;
            }
            finalDoctorId = candidateId;
        }

        // 6. Resolve password & hash with bcrypt
        let initialPassword = null;
        if (password && typeof password === "string") {
            if (password.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: "Password must be at least 6 characters long"
                });
            }
            initialPassword = password;
        } else {
            initialPassword = generateSecureTemporaryPassword();
        }

        const passwordHash = await hashPassword(initialPassword);

        // 7. Resolve metadata fields
        const cleanSpecialization = (specialization || specialty || "General Medicine").trim();
        const cleanPhone = phone && typeof phone === "string" && phone.trim() ? phone.trim() : null;

        // 8. Create User (Strictly enforce role DOCTOR regardless of any client role param)
        createdUser = await User.create({
            username: finalUsername,
            email: cleanEmail,
            passwordHash,
            role: ROLES.DOCTOR,
            profileId: finalDoctorId,
            status: ACCOUNT_STATUS.ACTIVE
        });

        // 9. Create Doctor Profile (1:1 with User)
        let createdDoctor = null;
        try {
            createdDoctor = await Doctor.create({
                doctorId: finalDoctorId,
                userId: createdUser._id,
                name: cleanName,
                email: cleanEmail,
                phone: cleanPhone,
                specialization: cleanSpecialization,
                status: DOCTOR_STATUS.ACTIVE
            });
        } catch (doctorCreationError) {
            // Rollback User creation if Doctor profile creation fails
            if (createdUser && createdUser._id) {
                await User.deleteOne({ _id: createdUser._id });
            }
            throw doctorCreationError;
        }

        // 10. Audit logging (NEVER log password or passwordHash)
        try {
            await ActivityLog.create({
                action: AUDIT_ACTIONS.DOCTOR_CREATED,
                actorRole: ACTOR_ROLES.SUPER_ADMIN,
                actorId: req.user.username || req.user.userId || "SUPER_ADMIN",
                targetType: TARGET_TYPES.DOCTOR,
                targetId: finalDoctorId,
                details: {
                    doctorId: finalDoctorId,
                    name: cleanName,
                    email: cleanEmail,
                    specialization: cleanSpecialization
                },
                timestamp: new Date()
            });
        } catch (auditErr) {
            console.warn("Doctor creation audit log warning:", auditErr.message);
        }

        // 11. Controlled response: return initial credentials only in this provisioning response
        return res.status(201).json({
            success: true,
            message: `Doctor ${finalDoctorId} provisioned successfully`,
            doctor: sanitizeDoctor(createdDoctor, createdUser, 0),
            credentials: {
                username: createdUser.username,
                email: createdUser.email,
                initialPassword
            }
        });
    } catch (error) {
        console.error("Doctor provisioning error:", error);
        if (createdUser && createdUser._id) {
            try {
                await User.deleteOne({ _id: createdUser._id });
            } catch (rollbackErr) {
                console.error("Rollback error:", rollbackErr.message);
            }
        }
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "Duplicate key violation. Email, username, or doctorId already exists."
            });
        }
        return res.status(500).json({
            success: false,
            message: "Failed to provision doctor account"
        });
    }
};

/**
 * Get Doctor Details
 * GET /api/admin/doctors/:doctorId or GET /admin/doctors/:doctorId
 *
 * Returns:
 * - Doctor profile
 * - User account status
 * - Assigned patients (read-only)
 * - Assigned patient count
 * - Recent ActivityLog history
 * Strictly excludes passwordHash and secrets.
 */
const getDoctorById = async (req, res) => {
    try {
        const { doctorId } = req.params;
        if (!doctorId || typeof doctorId !== "string" || !doctorId.trim()) {
            return res.status(400).json({ success: false, message: "Valid doctorId is required" });
        }

        const cleanDoctorId = doctorId.trim().toUpperCase();
        const doctor = await Doctor.findOne({ doctorId: cleanDoctorId }).lean();

        if (!doctor) {
            if (isApiRequest(req)) {
                return res.status(404).json({
                    success: false,
                    message: `Doctor ${cleanDoctorId} not found`
                });
            }
            return res.status(404).send("Doctor not found");
        }

        // Linked User account info
        let linkedUser = null;
        if (doctor.userId) {
            linkedUser = await User.findById(doctor.userId)
                .select("username email role status createdAt")
                .lean();
        }

        // Assigned patients (Read-Only)
        const assignedPatients = await Patient.find({ doctorId: cleanDoctorId })
            .select("patientId name email age gender deviceId createdAt")
            .lean();

        // Recent audit activity
        const recentActivity = await ActivityLog.find({ targetId: cleanDoctorId })
            .sort({ timestamp: -1 })
            .limit(10)
            .lean();

        const doctorDetail = {
            doctorId: doctor.doctorId,
            name: doctor.name,
            email: doctor.email,
            username: linkedUser ? linkedUser.username : null,
            phone: doctor.phone || null,
            specialization: doctor.specialization || "General Medicine",
            specialty: doctor.specialization || "General Medicine",
            status: doctor.status || DOCTOR_STATUS.ACTIVE,
            accountStatus: linkedUser ? linkedUser.status : ACCOUNT_STATUS.ACTIVE,
            assignedPatientCount: assignedPatients.length,
            assignedPatients,
            recentActivity,
            createdAt: doctor.createdAt,
            updatedAt: doctor.updatedAt
        };

        if (isApiRequest(req)) {
            return res.status(200).json({
                success: true,
                doctor: doctorDetail
            });
        }

        return res.render("admin/doctorDetail", {
            user: req.user,
            activePage: "doctors",
            doctor: doctorDetail
        });
    } catch (error) {
        console.error("Get doctor by ID error:", error.message);
        if (isApiRequest(req)) {
            return res.status(500).json({ success: false, message: "Failed to retrieve doctor details" });
        }
        return res.status(500).send("Internal Server Error: Failed to retrieve doctor details");
    }
};

/**
 * Activate a Doctor Account
 * PATCH /api/admin/doctors/:doctorId/activate
 *
 * Sets Doctor.status = ACTIVE and User.status = ACTIVE.
 * Idempotent: repeated activation is safe.
 * Creates ActivityLog entry DOCTOR_ACTIVATED.
 */
const activateDoctor = async (req, res) => {
    try {
        const { doctorId } = req.params;
        if (!doctorId || typeof doctorId !== "string" || !doctorId.trim()) {
            return res.status(400).json({ success: false, message: "Valid doctorId is required" });
        }

        const cleanDoctorId = doctorId.trim().toUpperCase();
        const doctor = await Doctor.findOne({ doctorId: cleanDoctorId });

        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: `Doctor ${cleanDoctorId} not found`
            });
        }

        const previousDoctorStatus = doctor.status;
        doctor.status = DOCTOR_STATUS.ACTIVE;
        await doctor.save();

        let updatedUser = null;
        if (doctor.userId) {
            updatedUser = await User.findById(doctor.userId);
            if (updatedUser) {
                updatedUser.status = ACCOUNT_STATUS.ACTIVE;
                await updatedUser.save();
            }
        }

        // Audit log
        try {
            await ActivityLog.create({
                action: AUDIT_ACTIONS.DOCTOR_ACTIVATED,
                actorRole: ACTOR_ROLES.SUPER_ADMIN,
                actorId: req.user.username || req.user.userId || "SUPER_ADMIN",
                targetType: TARGET_TYPES.DOCTOR,
                targetId: cleanDoctorId,
                details: {
                    previousDoctorStatus,
                    status: DOCTOR_STATUS.ACTIVE,
                    accountStatus: ACCOUNT_STATUS.ACTIVE
                },
                timestamp: new Date()
            });
        } catch (auditErr) {
            console.warn("Doctor activation audit log warning:", auditErr.message);
        }

        return res.status(200).json({
            success: true,
            message: `Doctor ${cleanDoctorId} activated successfully`,
            doctor: {
                doctorId: doctor.doctorId,
                status: doctor.status,
                accountStatus: updatedUser ? updatedUser.status : ACCOUNT_STATUS.ACTIVE
            }
        });
    } catch (error) {
        console.error("Doctor activation error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to activate doctor"
        });
    }
};

/**
 * Deactivate a Doctor Account
 * PATCH /api/admin/doctors/:doctorId/deactivate
 *
 * Sets Doctor.status = INACTIVE and User.status = SUSPENDED.
 * Idempotent: repeated deactivation is safe.
 * Preserves patient relationships and historical telemetry intact.
 * Creates ActivityLog entry DOCTOR_DEACTIVATED.
 */
const deactivateDoctor = async (req, res) => {
    try {
        const { doctorId } = req.params;
        if (!doctorId || typeof doctorId !== "string" || !doctorId.trim()) {
            return res.status(400).json({ success: false, message: "Valid doctorId is required" });
        }

        const cleanDoctorId = doctorId.trim().toUpperCase();
        const doctor = await Doctor.findOne({ doctorId: cleanDoctorId });

        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: `Doctor ${cleanDoctorId} not found`
            });
        }

        const previousDoctorStatus = doctor.status;
        doctor.status = DOCTOR_STATUS.INACTIVE;
        await doctor.save();

        let updatedUser = null;
        if (doctor.userId) {
            updatedUser = await User.findById(doctor.userId);
            if (updatedUser) {
                updatedUser.status = ACCOUNT_STATUS.SUSPENDED;
                await updatedUser.save();
            }
        }

        // Phase 8: Unassign all patients currently assigned to this deactivated doctor
        const assignedPatients = await Patient.find({ doctorId: cleanDoctorId });
        if (assignedPatients.length > 0) {
            await Patient.updateMany({ doctorId: cleanDoctorId }, { $set: { doctorId: null } });
            for (const pat of assignedPatients) {
                try {
                    await ActivityLog.create({
                        action: AUDIT_ACTIONS.PATIENT_UNASSIGNED,
                        actorRole: ACTOR_ROLES.SUPER_ADMIN,
                        actorId: req.user ? (req.user.username || req.user.userId || "SUPER_ADMIN") : "SUPER_ADMIN",
                        targetType: TARGET_TYPES.PATIENT,
                        targetId: pat.patientId,
                        details: {
                            reason: "DOCTOR_DEACTIVATED",
                            previousDoctorId: cleanDoctorId,
                            newDoctorId: null
                        },
                        timestamp: new Date()
                    });
                } catch (patAuditErr) {
                    console.warn("Patient deactivation unassignment audit log warning:", patAuditErr.message);
                }
            }

            // Real-time socket room eviction for deactivated doctor
            const io = req.app && req.app.get ? req.app.get("io") : null;
            if (io) {
                for (const pat of assignedPatients) {
                    try {
                        const sockets = await io.in(`patient:${pat.patientId}`).fetchSockets();
                        for (const s of sockets) {
                            if (s.user && s.user.role === ROLES.DOCTOR && s.user.profileId === cleanDoctorId) {
                                s.leave(`patient:${pat.patientId}`);
                            }
                        }
                    } catch (sockErr) {
                        // socket room eviction is non-blocking
                    }
                }
            }
        }

        // Audit log
        try {
            await ActivityLog.create({
                action: AUDIT_ACTIONS.DOCTOR_DEACTIVATED,
                actorRole: ACTOR_ROLES.SUPER_ADMIN,
                actorId: req.user.username || req.user.userId || "SUPER_ADMIN",
                targetType: TARGET_TYPES.DOCTOR,
                targetId: cleanDoctorId,
                details: {
                    previousDoctorStatus,
                    status: DOCTOR_STATUS.INACTIVE,
                    accountStatus: ACCOUNT_STATUS.SUSPENDED,
                    unassignedPatientCount: assignedPatients.length
                },
                timestamp: new Date()
            });
        } catch (auditErr) {
            console.warn("Doctor deactivation audit log warning:", auditErr.message);
        }

        return res.status(200).json({
            success: true,
            message: `Doctor ${cleanDoctorId} deactivated successfully`,
            doctor: {
                doctorId: doctor.doctorId,
                status: doctor.status,
                accountStatus: updatedUser ? updatedUser.status : ACCOUNT_STATUS.SUSPENDED
            }
        });
    } catch (error) {
        console.error("Doctor deactivation error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to deactivate doctor"
        });
    }
};

/**
 * Safely delete an unassigned Doctor
 * DELETE /api/admin/doctors/:doctorId
 *
 * Rules:
 * 1. Only permitted if assigned patient count === 0
 * 2. If patients are assigned, rejects with 400 (reassign first or deactivate)
 * 3. Atomically removes Doctor and linked User to prevent dangling references
 * 4. Preserves historical telemetry records in SensorReading
 * 5. Appends DOCTOR_REMOVED to ActivityLog
 */
const deleteDoctor = async (req, res) => {
    try {
        const { doctorId } = req.params;
        if (!doctorId || typeof doctorId !== "string" || !doctorId.trim()) {
            return res.status(400).json({ success: false, message: "Valid doctorId is required" });
        }

        const cleanDoctorId = doctorId.trim().toUpperCase();
        const doctor = await Doctor.findOne({ doctorId: cleanDoctorId });

        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: `Doctor ${cleanDoctorId} not found`
            });
        }

        // Rule: Only unassigned doctors can be deleted
        const assignedPatientCount = await Patient.countDocuments({ doctorId: cleanDoctorId });
        if (assignedPatientCount > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete doctor ${cleanDoctorId}: doctor currently has ${assignedPatientCount} assigned patient(s). Reassign patients first or deactivate the account.`
            });
        }

        // Delete linked user and doctor profile
        if (doctor.userId) {
            await User.deleteOne({ _id: doctor.userId });
        }
        await Doctor.deleteOne({ doctorId: cleanDoctorId });

        // Audit log
        try {
            await ActivityLog.create({
                action: AUDIT_ACTIONS.DOCTOR_REMOVED,
                actorRole: ACTOR_ROLES.SUPER_ADMIN,
                actorId: req.user.username || req.user.userId || "SUPER_ADMIN",
                targetType: TARGET_TYPES.DOCTOR,
                targetId: cleanDoctorId,
                details: {
                    name: doctor.name,
                    email: doctor.email,
                    lastStatus: doctor.status
                },
                timestamp: new Date()
            });
        } catch (auditErr) {
            console.warn("Doctor deletion audit log warning:", auditErr.message);
        }

        return res.status(200).json({
            success: true,
            message: `Doctor ${cleanDoctorId} removed successfully. Historical telemetry preserved.`
        });
    } catch (error) {
        console.error("Doctor deletion error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to delete doctor"
        });
    }
};

module.exports = {
    getDoctors,
    createDoctor,
    getDoctorById,
    activateDoctor,
    deactivateDoctor,
    deleteDoctor
};
