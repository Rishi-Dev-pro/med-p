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
const { ROLES, ACCOUNT_STATUS, DEVICE_STATUS } = require("../config/constants");
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

/**
 * Super Admin Patients Directory Foundation
 * GET /admin/patients
 */
const getPatients = async (req, res) => {
    try {
        const rawPatients = await Patient.find().sort({ patientId: 1 }).lean();

        // Enrich with doctor name and account status
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
                    doctorId: pat.doctorId,
                    doctorName,
                    deviceId: pat.deviceId,
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
 * Super Admin Activity Stream Foundation
 * GET /admin/activity
 */
const getActivity = async (req, res) => {
    try {
        const activities = await ActivityLog.find()
            .sort({ timestamp: -1 })
            .limit(50)
            .lean();

        if (isApiRequest(req)) {
            return res.status(200).json({ success: true, count: activities.length, activities });
        }

        return res.render("admin/activity", {
            user: req.user,
            activePage: "activity",
            activities
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

module.exports = {
    getOverview,
    getDoctors,
    getPatients,
    getDevices,
    getActivity,
    logout,
    getStatus
};
