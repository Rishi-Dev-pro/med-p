/**
 * Patient Portal Multi-Page Controller
 * Health Tracker — Phase 9: Multi-Page Dashboard Architecture
 */

const Patient = require("../models/Patient");
const Device = require("../models/Device");
const SensorReading = require("../models/SensorReading");
const Doctor = require("../models/Doctor");
const { isApiRequest } = require("../middleware/authMiddleware");

/**
 * Patient Overview Dashboard
 * GET /patient/overview
 */
const getOverview = async (req, res) => {
    try {
        const patientId = req.user.profileId;
        const patient = await Patient.findOne({ patientId }).lean();
        if (!patient) {
            if (isApiRequest(req)) return res.status(404).json({ success: false, message: "Patient profile not found" });
            return res.status(404).send("Patient profile not found");
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

        if (isApiRequest(req)) {
            return res.status(200).json({
                success: true,
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
            activePage: "overview"
        });
    } catch (error) {
        console.error("Patient overview error:", error.message);
        if (isApiRequest(req)) return res.status(500).json({ success: false, message: "Failed to load overview" });
        return res.status(500).send("Internal Server Error: Failed to load overview");
    }
};

/**
 * Patient Live Telemetry Monitor
 * GET /patient/live
 */
const getLive = async (req, res) => {
    try {
        const patientId = req.user.profileId;
        const patient = await Patient.findOne({ patientId }).lean();
        if (!patient) {
            if (isApiRequest(req)) return res.status(404).json({ success: false, message: "Patient profile not found" });
            return res.status(404).send("Patient profile not found");
        }

        const device = patient.deviceId
            ? await Device.findOne({ deviceId: patient.deviceId }).lean()
            : null;

        const latestReading = await SensorReading.findOne({ patientId: patient.patientId })
            .sort({ timestamp: -1 })
            .lean();

        if (isApiRequest(req)) {
            return res.status(200).json({
                success: true,
                patient,
                device,
                latestReading
            });
        }

        return res.render("patient/live", {
            user: req.user,
            patient,
            device,
            latestReading,
            activePage: "live"
        });
    } catch (error) {
        console.error("Patient live telemetry error:", error.message);
        if (isApiRequest(req)) return res.status(500).json({ success: false, message: "Failed to load live telemetry" });
        return res.status(500).send("Internal Server Error: Failed to load live telemetry");
    }
};

/**
 * Patient Reading History
 * GET /patient/history
 */
const getHistory = async (req, res) => {
    try {
        const patientId = req.user.profileId;
        const patient = await Patient.findOne({ patientId }).lean();
        if (!patient) {
            if (isApiRequest(req)) return res.status(404).json({ success: false, message: "Patient profile not found" });
            return res.status(404).send("Patient profile not found");
        }

        // Pagination
        let page = 1;
        if (req.query.page !== undefined) {
            const parsedPage = Number(req.query.page);
            if (Number.isInteger(parsedPage) && parsedPage > 0) {
                page = parsedPage;
            }
        }

        let limit = 20;
        if (req.query.limit !== undefined) {
            const parsedLimit = Number(req.query.limit);
            if (Number.isInteger(parsedLimit) && parsedLimit > 0) {
                limit = Math.min(parsedLimit, 100);
            }
        }

        // Date filtering
        const filter = { patientId: patient.patientId };
        const dateQuery = {};

        if (req.query.startDate) {
            const startDateStr = String(req.query.startDate).trim();
            const startDate = /^\d{4}-\d{2}-\d{2}$/.test(startDateStr)
                ? new Date(`${startDateStr}T00:00:00.000Z`)
                : new Date(startDateStr);
            if (!isNaN(startDate.getTime())) {
                dateQuery.$gte = startDate;
            }
        }

        if (req.query.endDate) {
            const endDateStr = String(req.query.endDate).trim();
            const endDate = /^\d{4}-\d{2}-\d{2}$/.test(endDateStr)
                ? new Date(`${endDateStr}T23:59:59.999Z`)
                : new Date(endDateStr);
            if (!isNaN(endDate.getTime())) {
                dateQuery.$lte = endDate;
            }
        }

        if (Object.keys(dateQuery).length > 0) {
            filter.timestamp = dateQuery;
        }

        const skip = (page - 1) * limit;

        const [readings, total] = await Promise.all([
            SensorReading.find(filter)
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            SensorReading.countDocuments(filter)
        ]);

        const pages = total === 0 ? 0 : Math.ceil(total / limit);

        if (isApiRequest(req)) {
            return res.status(200).json({
                success: true,
                patientId: patient.patientId,
                readings,
                pagination: {
                    page,
                    limit,
                    total,
                    pages
                }
            });
        }

        return res.render("patient/history", {
            user: req.user,
            patient,
            readings,
            pagination: {
                page,
                limit,
                total,
                pages
            },
            startDate: req.query.startDate || "",
            endDate: req.query.endDate || "",
            activePage: "history"
        });
    } catch (error) {
        console.error("Patient history error:", error.message);
        if (isApiRequest(req)) return res.status(500).json({ success: false, message: "Failed to load history" });
        return res.status(500).send("Internal Server Error: Failed to load history");
    }
};

/**
 * Patient Profile
 * GET /patient/profile
 */
const getProfile = async (req, res) => {
    try {
        const patientId = req.user.profileId;
        const patient = await Patient.findOne({ patientId }).lean();
        if (!patient) {
            if (isApiRequest(req)) return res.status(404).json({ success: false, message: "Patient profile not found" });
            return res.status(404).send("Patient profile not found");
        }

        const device = patient.deviceId
            ? await Device.findOne({ deviceId: patient.deviceId }).lean()
            : null;

        const doctor = patient.doctorId
            ? await Doctor.findOne({ doctorId: patient.doctorId }).select("doctorId name specialization email phone").lean()
            : null;

        const userSummary = {
            username: req.user.username,
            email: req.user.email,
            role: req.user.role,
            status: req.user.status
        };

        if (isApiRequest(req)) {
            return res.status(200).json({
                success: true,
                patient,
                doctor,
                device,
                user: userSummary
            });
        }

        return res.render("patient/profile", {
            user: req.user,
            patient,
            doctor,
            device,
            userSummary,
            activePage: "profile"
        });
    } catch (error) {
        console.error("Patient profile error:", error.message);
        if (isApiRequest(req)) return res.status(500).json({ success: false, message: "Failed to load profile" });
        return res.status(500).send("Internal Server Error: Failed to load profile");
    }
};

module.exports = {
    getOverview,
    getLive,
    getHistory,
    getProfile
};
