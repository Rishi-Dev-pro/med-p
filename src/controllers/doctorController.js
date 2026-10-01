/**
 * Doctor Portal Multi-Page Controller
 * Health Tracker — Phase 9: Multi-Page Dashboard Architecture
 */

const Doctor = require("../models/Doctor");
const Patient = require("../models/Patient");
const Device = require("../models/Device");
const SensorReading = require("../models/SensorReading");
const { isApiRequest } = require("../middleware/authMiddleware");

/**
 * Doctor Overview Dashboard
 * GET /doctor/overview
 */
const getOverview = async (req, res) => {
    try {
        const doctorId = req.user.profileId;
        const doctor = await Doctor.findOne({ doctorId }).lean();
        if (!doctor) {
            if (isApiRequest(req)) return res.status(404).json({ success: false, message: "Doctor profile not found" });
            return res.status(404).send("Doctor profile not found");
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

        if (isApiRequest(req)) {
            return res.status(200).json({
                success: true,
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
            activePage: "overview"
        });
    } catch (error) {
        console.error("Doctor overview error:", error.message);
        if (isApiRequest(req)) return res.status(500).json({ success: false, message: "Failed to load doctor overview" });
        return res.status(500).send("Internal Server Error: Failed to load doctor overview");
    }
};

/**
 * Doctor Assigned Patients Directory
 * GET /doctor/patients
 */
const getPatients = async (req, res) => {
    try {
        const doctorId = req.user.profileId;
        const doctor = await Doctor.findOne({ doctorId }).lean();
        if (!doctor) {
            if (isApiRequest(req)) return res.status(404).json({ success: false, message: "Doctor profile not found" });
            return res.status(404).send("Doctor profile not found");
        }

        // Server-side strict isolation: ONLY patients currently assigned to this doctor
        const patients = await Patient.find({ doctorId: doctor.doctorId })
            .sort({ patientId: 1 })
            .lean();

        const patientData = await Promise.all(
            patients.map(async (p) => {
                const device = p.deviceId
                    ? await Device.findOne({ deviceId: p.deviceId }).select("deviceId status type").lean()
                    : null;

                const latestReading = await SensorReading.findOne({ patientId: p.patientId })
                    .sort({ timestamp: -1 })
                    .lean();

                return {
                    patientId: p.patientId,
                    name: p.name,
                    email: p.email,
                    age: p.age,
                    gender: p.gender,
                    deviceId: p.deviceId || null,
                    device,
                    latestReading,
                    createdAt: p.createdAt
                };
            })
        );

        if (isApiRequest(req)) {
            return res.status(200).json({
                success: true,
                count: patientData.length,
                patients: patientData
            });
        }

        return res.render("doctor/patients", {
            user: req.user,
            doctor,
            patients: patientData,
            activePage: "patients"
        });
    } catch (error) {
        console.error("Doctor patients roster error:", error.message);
        if (isApiRequest(req)) return res.status(500).json({ success: false, message: "Failed to load patients roster" });
        return res.status(500).send("Internal Server Error: Failed to load patients roster");
    }
};

/**
 * Doctor Real-Time Telemetry Monitor
 * GET /doctor/monitor
 */
const getMonitor = async (req, res) => {
    try {
        const doctorId = req.user.profileId;
        const doctor = await Doctor.findOne({ doctorId }).lean();
        if (!doctor) {
            if (isApiRequest(req)) return res.status(404).json({ success: false, message: "Doctor profile not found" });
            return res.status(404).send("Doctor profile not found");
        }

        const patients = await Patient.find({ doctorId: doctor.doctorId })
            .select("patientId name age gender deviceId")
            .sort({ patientId: 1 })
            .lean();

        const patientCards = await Promise.all(
            patients.map(async (p) => {
                const device = p.deviceId
                    ? await Device.findOne({ deviceId: p.deviceId }).select("deviceId status").lean()
                    : null;

                const latestReading = await SensorReading.findOne({ patientId: p.patientId })
                    .sort({ timestamp: -1 })
                    .lean();

                return {
                    patientId: p.patientId,
                    name: p.name,
                    age: p.age,
                    device,
                    latestReading
                };
            })
        );

        if (isApiRequest(req)) {
            return res.status(200).json({
                success: true,
                doctor,
                count: patientCards.length,
                patients: patientCards
            });
        }

        return res.render("doctor/monitor", {
            user: req.user,
            doctor,
            patients: patientCards,
            activePage: "monitor"
        });
    } catch (error) {
        console.error("Doctor monitor error:", error.message);
        if (isApiRequest(req)) return res.status(500).json({ success: false, message: "Failed to load live monitor" });
        return res.status(500).send("Internal Server Error: Failed to load live monitor");
    }
};

/**
 * Doctor Historical Telemetry
 * GET /doctor/history
 */
const getHistory = async (req, res) => {
    try {
        const doctorId = req.user.profileId;
        const doctor = await Doctor.findOne({ doctorId }).lean();
        if (!doctor) {
            if (isApiRequest(req)) return res.status(404).json({ success: false, message: "Doctor profile not found" });
            return res.status(404).send("Doctor profile not found");
        }

        const assignedPatients = await Patient.find({ doctorId: doctor.doctorId })
            .select("patientId name age deviceId")
            .sort({ patientId: 1 })
            .lean();

        const assignedPatientIds = assignedPatients.map((p) => p.patientId);

        // Optional filter by patientId (guarded strictly to assigned patients)
        let filterPatientId = req.query.patientId;
        if (filterPatientId && !assignedPatientIds.includes(filterPatientId)) {
            // Cannot inspect unassigned or other doctor's patient telemetry
            filterPatientId = null;
        }

        let query = {};
        if (filterPatientId) {
            query.patientId = filterPatientId;
        } else if (assignedPatientIds.length > 0) {
            query.patientId = { $in: assignedPatientIds };
        } else {
            query.patientId = "NONE"; // no patients assigned
        }

        const readings = await SensorReading.find(query)
            .sort({ timestamp: -1 })
            .limit(40)
            .lean();

        if (isApiRequest(req)) {
            return res.status(200).json({
                success: true,
                doctor,
                selectedPatientId: filterPatientId || "ALL",
                assignedPatients,
                count: readings.length,
                readings
            });
        }

        return res.render("doctor/history", {
            user: req.user,
            doctor,
            assignedPatients,
            selectedPatientId: filterPatientId || "ALL",
            readings,
            activePage: "history"
        });
    } catch (error) {
        console.error("Doctor history error:", error.message);
        if (isApiRequest(req)) return res.status(500).json({ success: false, message: "Failed to load telemetry history" });
        return res.status(500).send("Internal Server Error: Failed to load telemetry history");
    }
};

module.exports = {
    getOverview,
    getPatients,
    getMonitor,
    getHistory
};
