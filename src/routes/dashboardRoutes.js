const express = require("express");

const Patient = require("../models/Patient");
const Device = require("../models/Device");
const SensorReading = require("../models/SensorReading");
const Doctor = require("../models/Doctor");
const { authenticate, isApiRequest } = require("../middleware/authMiddleware");
const { requirePatientOwnership, requireDoctorOwnership } = require("../middleware/roleMiddleware");

const router = express.Router();


// ==========================================
// PATIENT DASHBOARD
// ==========================================

router.get("/patient/:patientId", authenticate, requirePatientOwnership("patientId"), async (req, res) => {

    try {

        const patientId = req.params.patientId;

        const patient = await Patient.findOne({
            patientId
        });

        if (!patient) {
            return res.status(404).send("Patient not found");
        }


        const device = await Device.findOne({
            patientId,
            status: "active"
        });


        const readingDoc =
            await SensorReading
                .findOne({ patientId })
                .sort({ timestamp: -1 });

        const latestReading = readingDoc
            ? {
                value1: readingDoc.value1,
                value2: readingDoc.value2,
                timestamp: readingDoc.timestamp
            }
            : null;


        const doctor = await Doctor.findOne({
            doctorId: patient.doctorId
        });


        res.render("patient/dashboard", {

            patient,
            doctor,
            device,
            latestReading

        });

    } catch (error) {

        console.error(
            "Patient dashboard error:",
            error
        );

        res.status(500).send(
            "Failed to load patient dashboard"
        );
    }

});


// ==========================================
// DOCTOR DASHBOARD
// ==========================================

router.get("/doctor/:doctorId", authenticate, requireDoctorOwnership("doctorId"), async (req, res) => {

    try {

        const doctorId = req.params.doctorId;


        const doctor = await Doctor.findOne({
            doctorId
        });


        if (!doctor) {
            return res.status(404).send(
                "Doctor not found"
            );
        }


        // Find all patients assigned
        // to this doctor

        const patients = await Patient.find({
            doctorId
        });


        // Build dashboard patient data

        const patientData = await Promise.all(

            patients.map(async (patient) => {

                const device =
                    await Device.findOne({
                        patientId: patient.patientId,
                        status: "active"
                    });


                const latestReading =
                    await SensorReading
                        .findOne({
                            patientId:
                                patient.patientId
                        })
                        .sort({
                            timestamp: -1
                        });


                return {
                    patient: {
                        patientId: patient.patientId,
                        name: patient.name,
                        age: patient.age
                    },
                    device: device ? {
                        deviceId: device.deviceId,
                        status: device.status
                    } : null,
                    latestReading: latestReading ? {
                        value1: latestReading.value1,
                        value2: latestReading.value2,
                        timestamp: latestReading.timestamp
                    } : null
                };
            })
        );


        if (isApiRequest(req)) {
            return res.status(200).json({
                success: true,
                doctorId: doctor.doctorId,
                doctor: {
                    doctorId: doctor.doctorId,
                    name: doctor.name,
                    specialization: doctor.specialization
                },
                patients: patientData
            });
        }

        res.render("doctor/dashboard", {
            doctor,
            patients: patientData
        });

    } catch (error) {
        console.error("Doctor dashboard error:", error);
        if (isApiRequest(req)) {
            return res.status(500).json({ success: false, message: "Failed to load doctor dashboard" });
        }
        res.status(500).send("Failed to load doctor dashboard");
    }
});

/**
 * Doctor-side Patient Visibility API Endpoint
 * GET /api/doctor/:doctorId/patients
 * Strictly restricts results to patients where Patient.doctorId === doctorId.
 */
router.get("/api/doctor/:doctorId/patients", authenticate, requireDoctorOwnership("doctorId"), async (req, res) => {
    try {
        const doctorId = req.params.doctorId;
        const doctor = await Doctor.findOne({ doctorId });
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found" });
        }

        const patients = await Patient.find({ doctorId }).sort({ patientId: 1 }).lean();
        const patientData = patients.map((p) => ({
            patientId: p.patientId,
            name: p.name,
            email: p.email,
            age: p.age,
            gender: p.gender,
            deviceId: p.deviceId || null,
            doctorId: p.doctorId,
            createdAt: p.createdAt
        }));

        return res.status(200).json({
            success: true,
            count: patientData.length,
            patients: patientData
        });
    } catch (error) {
        console.error("Doctor patients list error:", error);
        return res.status(500).json({ success: false, message: "Failed to retrieve doctor's patients" });
    }
});


module.exports = router;