/**
 * Authentication Controller
 * Health Tracker — Phase 2: Authentication & Identity Foundation
 */

const User = require("../models/User");
const Patient = require("../models/Patient");
const Device = require("../models/Device");
const ActivityLog = require("../models/ActivityLog");
const { ROLES, ACCOUNT_STATUS, DOCTOR_STATUS, DEVICE_STATUS, AUDIT_ACTIONS, ACTOR_ROLES, TARGET_TYPES } = require("../config/constants");
const { hashPassword, comparePassword, generateToken, verifyToken } = require("../utils/authUtils");
const { COOKIE_NAME, getCookieOptions } = require("../config/auth");
const { logActivity } = require("../utils/activityLogger");

/**
 * Register a new Patient
 * POST /api/auth/register
 */
const register = async (req, res) => {
    try {
        const { name, email, password, confirmPassword, deviceId, age } = req.body;

        // 1. Validate required fields
        if (!name || typeof name !== "string" || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: "Patient name is required"
            });
        }

        if (!email || typeof email !== "string" || !email.trim()) {
            return res.status(400).json({
                success: false,
                message: "Email is required"
            });
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const cleanEmail = email.trim().toLowerCase();
        if (!emailRegex.test(cleanEmail)) {
            return res.status(400).json({
                success: false,
                message: "Please provide a valid email address"
            });
        }

        if (!password || typeof password !== "string") {
            return res.status(400).json({
                success: false,
                message: "Password is required"
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters long"
            });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: "Passwords do not match"
            });
        }

        if (!deviceId || typeof deviceId !== "string" || !deviceId.trim()) {
            return res.status(400).json({
                success: false,
                message: "Hardware device ID is required"
            });
        }

        const cleanDeviceId = deviceId.trim().toUpperCase();

        // 2. Validate duplicate email in User & Patient collections
        const existingUser = await User.findOne({ email: cleanEmail });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "Email is already registered"
            });
        }

        const existingPatientEmail = await Patient.findOne({ email: cleanEmail });
        if (existingPatientEmail) {
            return res.status(400).json({
                success: false,
                message: "Email is already registered"
            });
        }

        // 3. Validate hardware device existence, status, and assignment
        const device = await Device.findOne({ deviceId: cleanDeviceId });
        if (!device) {
            return res.status(400).json({
                success: false,
                message: `Device ${cleanDeviceId} is not registered in the system`
            });
        }

        if (device.status !== DEVICE_STATUS.ACTIVE) {
            return res.status(400).json({
                success: false,
                message: `Device ${cleanDeviceId} is not active`
            });
        }

        if (device.patientId !== null) {
            return res.status(400).json({
                success: false,
                message: `Device ${cleanDeviceId} is already assigned to another patient`
            });
        }

        // 4. Generate unique Patient ID (PAT-XXX)
        let count = await Patient.countDocuments();
        let candidateId = `PAT-${String(count + 1).padStart(3, "0")}`;
        while (await Patient.findOne({ patientId: candidateId })) {
            count++;
            candidateId = `PAT-${String(count + 1).padStart(3, "0")}`;
        }

        // 5. Generate unique username from name or email
        let baseUsername = name.trim().toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 20);
        if (!baseUsername || baseUsername === "_") {
            baseUsername = cleanEmail.split("@")[0].replace(/[^a-z0-9]/g, "_");
        }
        let candidateUsername = baseUsername;
        let suffix = 1;
        while (await User.findOne({ username: candidateUsername })) {
            candidateUsername = `${baseUsername}_${suffix++}`;
        }

        // 6. Secure password hashing
        const passwordHash = await hashPassword(password);

        // 7. Atomically claim device (prevents race conditions)
        const claimedDevice = await Device.findOneAndUpdate(
            { deviceId: cleanDeviceId, status: DEVICE_STATUS.ACTIVE, patientId: null },
            { $set: { patientId: candidateId } },
            { returnDocument: "after" }
        );

        if (!claimedDevice) {
            return res.status(400).json({
                success: false,
                message: `Device ${cleanDeviceId} is already assigned to another patient or inactive`
            });
        }

        let user = null;
        let patient = null;

        try {
            // 8. Create User record (strictly hardcoded role ROLES.PATIENT)
            user = await User.create({
                username: candidateUsername,
                email: cleanEmail,
                passwordHash,
                role: ROLES.PATIENT,
                profileId: candidateId,
                status: ACCOUNT_STATUS.ACTIVE
            });

            // 9. Create Patient record (strictly linked to claimed device)
            const patientAge = age !== undefined && !isNaN(Number(age)) ? Math.max(0, Number(age)) : 30;
            patient = await Patient.create({
                patientId: candidateId,
                userId: user._id,
                name: name.trim(),
                email: cleanEmail,
                age: patientAge,
                doctorId: null,
                deviceId: cleanDeviceId
            });
        } catch (creationErr) {
            // Compensation rollback: release the claimed device and clean up any created user
            await Device.updateOne(
                { deviceId: cleanDeviceId, patientId: candidateId },
                { $set: { patientId: null } }
            );
            if (user && user._id) {
                await User.deleteOne({ _id: user._id });
            }
            throw creationErr;
        }

        // 10. Audit logging (non-blocking)
        try {
            const io = req.app && req.app.get ? req.app.get("io") : null;
            await logActivity(
                AUDIT_ACTIONS.PATIENT_REGISTERED,
                ACTOR_ROLES.PATIENT,
                candidateId,
                TARGET_TYPES.PATIENT,
                candidateId,
                {
                    deviceId: cleanDeviceId,
                    email: cleanEmail
                },
                io
            );
            await logActivity(
                AUDIT_ACTIONS.DEVICE_ASSIGNED,
                ACTOR_ROLES.PATIENT,
                candidateId,
                TARGET_TYPES.DEVICE,
                cleanDeviceId,
                {
                    patientId: candidateId
                },
                io
            );
        } catch (auditErr) {
            console.warn("Registration audit log error:", auditErr.message);
        }

        // 11. Generate JWT token & set HTTP-only cookie
        const token = generateToken({
            userId: user._id,
            role: user.role,
            profileId: user.profileId
        });

        res.cookie(COOKIE_NAME, token, getCookieOptions());

        return res.status(201).json({
            success: true,
            message: "Patient registered successfully",
            patient: {
                patientId: patient.patientId,
                name: patient.name,
                email: patient.email,
                deviceId: patient.deviceId
            }
        });
    } catch (error) {
        console.error("Patient registration error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to register patient"
        });
    }
};

/**
 * Login for Patients, Doctors, and Super Admins
 * POST /api/auth/login
 * Supports identifier = email, username, or registered patient name
 */
const login = async (req, res) => {
    try {
        const { identifier, password } = req.body;

        if (!identifier || typeof identifier !== "string" || !identifier.trim()) {
            return res.status(400).json({
                success: false,
                message: "Email, username, or name is required"
            });
        }

        if (!password || typeof password !== "string") {
            return res.status(400).json({
                success: false,
                message: "Password is required"
            });
        }

        const cleanIdentifier = identifier.trim();

        // 1. Look up User by email or username
        let user = await User.findOne({
            $or: [
                { email: cleanIdentifier.toLowerCase() },
                { username: cleanIdentifier }
            ]
        });

        // 2. If not found, check if a Patient has this exact name
        if (!user) {
            const patient = await Patient.findOne({
                name: cleanIdentifier
            });
            if (patient && patient.userId) {
                user = await User.findById(patient.userId);
            }
        }

        // 3. User not found -> generic credentials rejection
        if (!user) {
            try {
                const io = req.app && req.app.get ? req.app.get("io") : null;
                await logActivity(
                    AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
                    ACTOR_ROLES.UNKNOWN,
                    null,
                    TARGET_TYPES.USER,
                    null,
                    {
                        method: cleanIdentifier.includes("@") ? "email" : "username",
                        reason: "USER_NOT_FOUND"
                    },
                    io
                );
            } catch (auditErr) {
                console.warn("Login failure audit log warning:", auditErr.message);
            }

            return res.status(401).json({
                success: false,
                message: "Invalid credentials"
            });
        }

        // 4. Verify account status permits authentication
        if (user.status !== ACCOUNT_STATUS.ACTIVE) {
            try {
                const io = req.app && req.app.get ? req.app.get("io") : null;
                await logActivity(
                    AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
                    user.role || ACTOR_ROLES.UNKNOWN,
                    user._id.toString(),
                    TARGET_TYPES.USER,
                    user._id.toString(),
                    {
                        username: user.username,
                        reason: "ACCOUNT_SUSPENDED"
                    },
                    io
                );
            } catch (auditErr) {
                console.warn("Login suspension audit log warning:", auditErr.message);
            }

            return res.status(403).json({
                success: false,
                message: "Account is suspended. Authentication rejected."
            });
        }

        // 4b. Verify Doctor-specific clinical profile status
        if (user.role === ROLES.DOCTOR && user.profileId) {
            const Doctor = require("../models/Doctor");
            const doctorProfile = await Doctor.findOne({ doctorId: user.profileId }).select("status").lean();
            if (doctorProfile && doctorProfile.status !== DOCTOR_STATUS.ACTIVE) {
                try {
                    const io = req.app && req.app.get ? req.app.get("io") : null;
                    await logActivity(
                        AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
                        ACTOR_ROLES.DOCTOR,
                        user.profileId,
                        TARGET_TYPES.DOCTOR,
                        user.profileId,
                        {
                            doctorId: user.profileId,
                            reason: "DOCTOR_INACTIVE"
                        },
                        io
                    );
                } catch (auditErr) {
                    console.warn("Doctor login suspension audit log warning:", auditErr.message);
                }

                return res.status(403).json({
                    success: false,
                    message: "Account is suspended. Authentication rejected."
                });
            }
        }

        // 5. Verify password using bcrypt
        const isMatch = await comparePassword(password, user.passwordHash);
        if (!isMatch) {
            try {
                const io = req.app && req.app.get ? req.app.get("io") : null;
                await logActivity(
                    AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
                    user.role || ACTOR_ROLES.UNKNOWN,
                    user._id.toString(),
                    TARGET_TYPES.USER,
                    user._id.toString(),
                    {
                        username: user.username,
                        reason: "INVALID_PASSWORD"
                    },
                    io
                );
            } catch (auditErr) {
                console.warn("Login failure audit log warning:", auditErr.message);
            }

            return res.status(401).json({
                success: false,
                message: "Invalid credentials"
            });
        }

        // 5b. Audit logging for successful login
        try {
            const io = req.app && req.app.get ? req.app.get("io") : null;
            await logActivity(
                AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS,
                user.role,
                user.profileId || user._id.toString(),
                TARGET_TYPES.USER,
                user._id.toString(),
                {
                    username: user.username,
                    role: user.role,
                    profileId: user.profileId
                },
                io
            );
        } catch (auditErr) {
            console.warn("Login success audit log warning:", auditErr.message);
        }

        // 6. Generate JWT token containing minimal identity
        const token = generateToken({
            userId: user._id,
            role: user.role,
            profileId: user.profileId
        });

        // 7. Store in HTTP-only cookie
        res.cookie(COOKIE_NAME, token, getCookieOptions());

        return res.status(200).json({
            success: true,
            message: "Login successful",
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                profileId: user.profileId
            }
        });
    } catch (error) {
        console.error("Login error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal authentication error"
        });
    }
};

/**
 * Logout
 * POST /api/auth/logout
 * Clears HTTP-only authentication cookie
 */
const logout = async (req, res) => {
    try {
        let authUser = req.user;
        if (!authUser && req.cookies) {
            const rawToken = req.cookies[COOKIE_NAME] || req.cookies["jwt"];
            if (rawToken) {
                try {
                    authUser = verifyToken(rawToken);
                } catch {}
            }
        }

        if (authUser) {
            try {
                const io = req.app && req.app.get ? req.app.get("io") : null;
                await logActivity(
                    AUDIT_ACTIONS.AUTH_LOGOUT,
                    authUser.role || ACTOR_ROLES.UNKNOWN,
                    authUser.profileId || authUser.userId || authUser.id,
                    TARGET_TYPES.USER,
                    authUser.userId || authUser.id || null,
                    {
                        role: authUser.role,
                        profileId: authUser.profileId
                    },
                    io
                );
            } catch (auditErr) {
                console.warn("Logout audit log warning:", auditErr.message);
            }
        }

        const cookieOptions = getCookieOptions();
        res.clearCookie(COOKIE_NAME, cookieOptions);
        res.clearCookie("jwt", cookieOptions);

        return res.status(200).json({
            success: true,
            message: "Logged out successfully"
        });
    } catch (error) {
        console.error("Logout error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to log out"
        });
    }
};

/**
 * Current user identity endpoint
 * GET /api/auth/me
 */
const getMe = async (req, res) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: "Not authenticated"
        });
    }
    return res.status(200).json({
        success: true,
        user: req.user
    });
};

/**
 * Real-Time Device Claim Validation Endpoint
 * GET /api/auth/device-status/:deviceId
 *
 * Checks if a device ID is:
 * 1. UNKNOWN
 * 2. INACTIVE
 * 3. ASSIGNED
 * 4. CLAIMABLE (ACTIVE + UNASSIGNED)
 *
 * Never leaks apiKeyHash, secrets, patient data, or telemetry.
 */
const getDeviceStatus = async (req, res) => {
    try {
        const { deviceId } = req.params;
        if (!deviceId || typeof deviceId !== "string" || !deviceId.trim()) {
            return res.status(400).json({
                success: false,
                claimable: false,
                status: "INVALID",
                message: "Valid deviceId parameter is required"
            });
        }

        const cleanDeviceId = deviceId.trim().toUpperCase();

        if (cleanDeviceId.length > 50) {
            return res.status(400).json({
                success: false,
                claimable: false,
                status: "INVALID",
                message: "Invalid deviceId format"
            });
        }

        const device = await Device.findOne({ deviceId: cleanDeviceId }).select("-apiKeyHash").lean();

        if (!device) {
            return res.status(404).json({
                success: false,
                claimable: false,
                status: "UNKNOWN",
                deviceId: cleanDeviceId,
                message: "Device not found."
            });
        }

        if (device.status !== DEVICE_STATUS.ACTIVE) {
            return res.status(200).json({
                success: true,
                claimable: false,
                status: "INACTIVE",
                deviceId: cleanDeviceId,
                message: "This device is currently inactive."
            });
        }

        if (device.patientId !== null) {
            return res.status(200).json({
                success: true,
                claimable: false,
                status: "ASSIGNED",
                deviceId: cleanDeviceId,
                message: "This device is already assigned."
            });
        }

        return res.status(200).json({
            success: true,
            claimable: true,
            status: "CLAIMABLE",
            deviceId: cleanDeviceId,
            message: "This device is ready to be assigned."
        });
    } catch (error) {
        console.error("Device status check error:", error.message);
        return res.status(500).json({
            success: false,
            claimable: false,
            message: "Server error validating device status"
        });
    }
};

module.exports = {
    register,
    login,
    logout,
    getMe,
    getDeviceStatus
};

