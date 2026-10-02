/**
 * Super Admin Controller
 * Health Tracker — Phase 4: Super Admin Portal & Layout
 */

const User = require("../models/User");
const Doctor = require("../models/Doctor");
const Patient = require("../models/Patient");
const Device = require("../models/Device");
const SensorReading = require("../models/SensorReading");
const ActivityLog = require("../models/ActivityLog");
const { ROLES, ACCOUNT_STATUS, DEVICE_STATUS, AUDIT_ACTIONS, ACTOR_ROLES, TARGET_TYPES } = require("../config/constants");
const { COOKIE_NAME, getCookieOptions } = require("../config/auth");
const { isApiRequest } = require("../middleware/authMiddleware");

/**
 * Super Admin Overview / Dashboard
 * GET /admin or GET /admin/overview
 */
const getOverview = async (req, res) => {
    try {
        // Aggregate real system metrics from MongoDB
        const [
            totalPatients,
            totalDoctors,
            totalDevices,
            activeDevices,
            inactiveDevices,
            assignedDevices,
            unassignedDevices,
            activeUsers,
            suspendedUsers,
            totalReadings,
            latestReading,
            recentPatients,
            recentDoctors,
            recentDevices
        ] = await Promise.all([
            Patient.countDocuments(),
            Doctor.countDocuments(),
            Device.countDocuments(),
            Device.countDocuments({ status: DEVICE_STATUS.ACTIVE }),
            Device.countDocuments({ status: DEVICE_STATUS.INACTIVE }),
            Device.countDocuments({ patientId: { $ne: null } }),
            Device.countDocuments({ patientId: null }),
            User.countDocuments({ status: ACCOUNT_STATUS.ACTIVE }),
            User.countDocuments({ status: ACCOUNT_STATUS.SUSPENDED }),
            SensorReading.countDocuments(),
            SensorReading.findOne().sort({ timestamp: -1 }).lean(),
            Patient.find().sort({ createdAt: -1 }).limit(5).select("patientId name email doctorId deviceId createdAt").lean(),
            Doctor.find().sort({ createdAt: -1 }).limit(5).select("doctorId name email specialty status createdAt").lean(),
            Device.find().sort({ updatedAt: -1, createdAt: -1 }).limit(5).select("deviceId status patientId resetCount updatedAt createdAt").lean()
        ]);

        // Calculate readings captured today (since start of current calendar day)
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const todayReadings = await SensorReading.countDocuments({ timestamp: { $gte: startOfDay } });

        const metrics = {
            totalPatients,
            totalDoctors,
            totalDevices,
            activeDevices,
            inactiveDevices,
            assignedDevices,
            unassignedDevices,
            activeUsers,
            suspendedUsers,
            totalReadings,
            todayReadings,
            latestReadingTimestamp: latestReading ? latestReading.timestamp : null
        };

        if (isApiRequest(req)) {
            return res.status(200).json({
                success: true,
                metrics,
                recentPatients,
                recentDoctors,
                recentDevices
            });
        }

        return res.render("admin/overview", {
            user: req.user,
            activePage: "overview",
            metrics,
            recentPatients,
            recentDoctors,
            recentDevices,
            latestReading
        });
    } catch (error) {
        console.error("Admin overview error:", error.message);
        if (isApiRequest(req)) {
            return res.status(500).json({ success: false, message: "Failed to load administrative overview" });
        }
        return res.status(500).send("Internal Server Error: Failed to load administrative overview");
    }
};

const adminDoctorController = require("./adminDoctorController");

/**
 * Super Admin Doctors Directory Foundation
 * GET /admin/doctors
 */
const getDoctors = adminDoctorController.getDoctors;

const adminPatientController = require("./adminPatientController");

/**
 * Super Admin Patients Directory Foundation
 * GET /admin/patients
 */
const getPatients = adminPatientController.getPatients;

/**
 * Super Admin Devices Inventory Foundation
 * GET /admin/devices
 */
const getDevices = async (req, res) => {
    try {
        const rawDevices = await Device.find().sort({ deviceId: 1 }).lean();

        const devices = await Promise.all(
            rawDevices.map(async (dev) => {
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
                    patientId: dev.patientId,
                    patientName,
                    resetCount: dev.resetCount || 0,
                    createdAt: dev.createdAt,
                    updatedAt: dev.updatedAt
                };
            })
        );

        if (isApiRequest(req)) {
            return res.status(200).json({ success: true, count: devices.length, devices });
        }

        return res.render("admin/devices", {
            user: req.user,
            activePage: "devices",
            devices
        });
    } catch (error) {
        console.error("Admin devices error:", error.message);
        if (isApiRequest(req)) {
            return res.status(500).json({ success: false, message: "Failed to load devices" });
        }
        return res.status(500).send("Internal Server Error: Failed to load devices");
    }
};

/**
 * Super Admin Activity Stream & Paginated Audit API
 * GET /admin/activity or GET /api/admin/activity
 * Supports query params: page, limit, action, actorId, actorRole, targetType, targetId, startDate, endDate
 */
const getActivity = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            action,
            actorId,
            actorRole,
            targetType,
            targetId,
            startDate,
            endDate
        } = req.query;

        // 1. Pagination Validation & Sanitization
        let parsedPage = parseInt(page, 10);
        if (isNaN(parsedPage) || parsedPage < 1) {
            parsedPage = 1;
        }

        let parsedLimit = parseInt(limit, 10);
        if (isNaN(parsedLimit) || parsedLimit < 1) {
            parsedLimit = 50;
        }
        // Enforce max limit of 100
        if (parsedLimit > 100) {
            parsedLimit = 100;
        }

        // 2. Build Filter
        const filter = {};

        if (action && typeof action === "string" && action.trim()) {
            filter.action = action.trim().toUpperCase();
        }

        if (actorId && typeof actorId === "string" && actorId.trim()) {
            filter.actorId = actorId.trim();
        }

        if (actorRole && typeof actorRole === "string" && actorRole.trim()) {
            filter.actorRole = actorRole.trim().toUpperCase();
        }

        if (targetType && typeof targetType === "string" && targetType.trim()) {
            filter.targetType = targetType.trim().toUpperCase();
        }

        if (targetId && typeof targetId === "string" && targetId.trim()) {
            filter.targetId = targetId.trim();
        }

        // Optional date range filtering
        if (startDate || endDate) {
            filter.timestamp = {};
            if (startDate) {
                const sDate = new Date(startDate);
                if (!isNaN(sDate.getTime())) {
                    filter.timestamp.$gte = sDate;
                }
            }
            if (endDate) {
                const eDate = new Date(endDate);
                if (!isNaN(eDate.getTime())) {
                    if (typeof endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(endDate.trim())) {
                        eDate.setUTCHours(23, 59, 59, 999);
                    }
                    filter.timestamp.$lte = eDate;
                }
            }
            if (Object.keys(filter.timestamp).length === 0) {
                delete filter.timestamp;
            }
        }

        // 3. Database Execution
        const total = await ActivityLog.countDocuments(filter);
        const pages = Math.ceil(total / parsedLimit) || 1;
        const skip = (parsedPage - 1) * parsedLimit;

        const activities = await ActivityLog.find(filter)
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(parsedLimit)
            .lean();

        // Safe projection ensuring zero secret leakage
        const safeActivities = activities.map((act) => ({
            _id: act._id,
            action: act.action,
            actorRole: act.actorRole,
            actorId: act.actorId,
            targetType: act.targetType,
            targetId: act.targetId,
            details: act.details || {},
            timestamp: act.timestamp
        }));

        if (isApiRequest(req)) {
            return res.status(200).json({
                success: true,
                pagination: {
                    page: parsedPage,
                    limit: parsedLimit,
                    total,
                    pages
                },
                count: safeActivities.length,
                activities: safeActivities
            });
        }

        return res.render("admin/activity", {
            user: req.user,
            activePage: "activity",
            activities: safeActivities,
            pagination: {
                page: parsedPage,
                limit: parsedLimit,
                total,
                pages
            },
            filters: {
                action: action || "",
                actorId: actorId || "",
                actorRole: actorRole || ""
            },
            availableActions: Object.values(AUDIT_ACTIONS)
        });
    } catch (error) {
        console.error("Admin activity error:", error.message);
        if (isApiRequest(req)) {
            return res.status(500).json({ success: false, message: "Failed to load activity stream" });
        }
        return res.status(500).send("Internal Server Error: Failed to load activity stream");
    }
};

/**
 * Admin Logout
 * GET or POST /admin/logout
 */
const logout = async (req, res) => {
    try {
        const cookieOptions = getCookieOptions();
        res.clearCookie(COOKIE_NAME, cookieOptions);
        res.clearCookie("jwt", cookieOptions);

        if (!isApiRequest(req)) {
            return res.redirect("/login");
        }

        return res.status(200).json({
            success: true,
            message: "Logged out successfully"
        });
    } catch (error) {
        console.error("Admin logout error:", error.message);
        if (!isApiRequest(req)) {
            return res.redirect("/login");
        }
        return res.status(500).json({ success: false, message: "Failed to log out" });
    }
};

/**
 * Super Admin API Status Foundation (Preserves Phase 3 test contract)
 * GET /api/admin/status
 */
const getStatus = (req, res) => {
    return res.status(200).json({
        success: true,
        message: "Admin authorization verified",
        admin: {
            userId: req.user.userId,
            username: req.user.username,
            role: req.user.role
        }
    });
};

/**
 * Super Admin Quick-Switch / View Mode: View Patient Dashboard
 * GET /admin/view/patient/:patientId
 * Read-only simulation context with persistent admin banner.
 * Strictly forbidden in production (NODE_ENV === "production").
 */
const viewPatient = async (req, res) => {
    if (process.env.NODE_ENV === "production") {
        if (isApiRequest(req)) {
            return res.status(403).json({ success: false, message: "Quick-Switch view mode is disabled in production." });
        }
        return res.status(404).render("error", {
            errorTitle: "404 Not Found",
            errorMessage: "The requested route does not exist."
        });
    }

    try {
        const { patientId } = req.params;
        const patient = await Patient.findOne({ patientId }).lean();
        if (!patient) {
            if (isApiRequest(req)) {
                return res.status(404).json({ success: false, message: "Patient target not found" });
            }
            return res.status(404).render("error", {
                errorTitle: "Patient Not Found",
                errorMessage: `No patient registered with identifier ${patientId}`
            });
        }

        const device = patient.deviceId
            ? await Device.findOne({ deviceId: patient.deviceId }).lean()
            : null;

        const doctor = patient.doctorId
            ? await Doctor.findOne({ doctorId: patient.doctorId }).select("doctorId name specialization email phone").lean()
            : null;

        const latestReading = await SensorReading.findOne({ patientId: patient.patientId })
            .sort({ timestamp: -1 })
            .lean();

        // Audit Quick-Switch entry
        const { logActivity } = require("../utils/activityLogger");
        await logActivity({
            action: AUDIT_ACTIONS.ADMIN_VIEW_SWITCH,
            actorRole: ACTOR_ROLES.SUPER_ADMIN,
            actorId: req.user.username || "admin",
            targetType: TARGET_TYPES.PATIENT,
            targetId: patient.patientId,
            details: { mode: "PATIENT", targetName: patient.name }
        });

        const adminViewContext = {
            mode: "PATIENT",
            targetId: patient.patientId,
            targetName: patient.name
        };

        if (isApiRequest(req)) {
            return res.status(200).json({
                success: true,
                adminViewContext,
                authenticatedAdmin: {
                    userId: req.user.userId,
                    username: req.user.username,
                    role: req.user.role
                },
                patient,
                doctor,
                device,
                latestReading
            });
        }

        return res.render("patient/overview", {
            user: req.user,
            patient,
            doctor,
            device,
            latestReading,
            activePage: "overview",
            adminViewContext
        });
    } catch (error) {
        console.error("Admin view patient error:", error.message);
        if (isApiRequest(req)) return res.status(500).json({ success: false, message: "Failed to load patient view" });
        return res.status(500).render("error", { errorTitle: "Server Error", errorMessage: "Failed to render patient view mode" });
    }
};

/**
 * Super Admin Quick-Switch / View Mode: View Doctor Dashboard
 * GET /admin/view/doctor/:doctorId
 * Read-only simulation context with persistent admin banner.
 * Strictly forbidden in production (NODE_ENV === "production").
 */
const viewDoctor = async (req, res) => {
    if (process.env.NODE_ENV === "production") {
        if (isApiRequest(req)) {
            return res.status(403).json({ success: false, message: "Quick-Switch view mode is disabled in production." });
        }
        return res.status(404).render("error", {
            errorTitle: "404 Not Found",
            errorMessage: "The requested route does not exist."
        });
    }

    try {
        const { doctorId } = req.params;
        const doctor = await Doctor.findOne({ doctorId }).lean();
        if (!doctor) {
            if (isApiRequest(req)) {
                return res.status(404).json({ success: false, message: "Doctor target not found" });
            }
            return res.status(404).render("error", {
                errorTitle: "Doctor Not Found",
                errorMessage: `No doctor provisioned with identifier ${doctorId}`
            });
        }

        // Hydrate only doctor's assigned patients
        const patients = await Patient.find({ doctorId: doctor.doctorId })
            .select("patientId name age gender deviceId")
            .sort({ patientId: 1 })
            .lean();

        const activeDevicesCount = patients.filter((p) => Boolean(p.deviceId)).length;
        const assignedPatientIds = patients.map((p) => p.patientId);

        let latestReadings = [];
        if (assignedPatientIds.length > 0) {
            latestReadings = await SensorReading.find({ patientId: { $in: assignedPatientIds } })
                .sort({ timestamp: -1 })
                .limit(5)
                .lean();
        }

        const metrics = {
            totalPatients: patients.length,
            activeDevices: activeDevicesCount,
            recentTelemetryCount: latestReadings.length
        };

        // Audit Quick-Switch entry
        const { logActivity } = require("../utils/activityLogger");
        await logActivity({
            action: AUDIT_ACTIONS.ADMIN_VIEW_SWITCH,
            actorRole: ACTOR_ROLES.SUPER_ADMIN,
            actorId: req.user.username || "admin",
            targetType: TARGET_TYPES.DOCTOR,
            targetId: doctor.doctorId,
            details: { mode: "DOCTOR", targetName: doctor.name }
        });

        const adminViewContext = {
            mode: "DOCTOR",
            targetId: doctor.doctorId,
            targetName: doctor.name
        };

        if (isApiRequest(req)) {
            return res.status(200).json({
                success: true,
                adminViewContext,
                authenticatedAdmin: {
                    userId: req.user.userId,
                    username: req.user.username,
                    role: req.user.role
                },
                doctor,
                metrics,
                patients,
                latestReadings
            });
        }

        return res.render("doctor/overview", {
            user: req.user,
            doctor,
            metrics,
            patients,
            latestReadings,
            activePage: "overview",
            adminViewContext
        });
    } catch (error) {
        console.error("Admin view doctor error:", error.message);
        if (isApiRequest(req)) return res.status(500).json({ success: false, message: "Failed to load doctor view" });
        return res.status(500).render("error", { errorTitle: "Server Error", errorMessage: "Failed to render doctor view mode" });
    }
};

/**
 * Super Admin Quick-Switch Exit endpoint
 * POST /admin/view/exit
 * Logs audit event and returns navigation URL back to admin overview
 */
const exitViewMode = async (req, res) => {
    try {
        const { logActivity } = require("../utils/activityLogger");
        await logActivity({
            action: AUDIT_ACTIONS.ADMIN_VIEW_EXIT,
            actorRole: ACTOR_ROLES.SUPER_ADMIN,
            actorId: req.user.username || "admin",
            targetType: TARGET_TYPES.SYSTEM,
            targetId: "ADMIN_OVERVIEW",
            details: { exitedAt: new Date().toISOString() }
        });

        if (isApiRequest(req)) {
            return res.status(200).json({ success: true, redirectUrl: "/admin/overview" });
        }
        return res.redirect("/admin/overview");
    } catch (error) {
        console.error("Admin exit view error:", error.message);
        return res.redirect("/admin/overview");
    }
};

module.exports = {
    getOverview,
    getDoctors,
    getPatients,
    getDevices,
    getActivity,
    logout,
    getStatus,
    viewPatient,
    viewDoctor,
    exitViewMode
};
