const express = require("express");

const Patient = require("../models/Patient");
const Device = require("../models/Device");
const SensorReading = require("../models/SensorReading");
const Doctor = require("../models/Doctor");
const { authenticate } = require("../middleware/authMiddleware");
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


        res.render("doctor/dashboard", {

            doctor,

            patients: patientData

        });

    } catch (error) {

        console.error(
            "Doctor dashboard error:",
            error
        );

        res.status(500).send(
            "Failed to load doctor dashboard"
        );
    }

});


module.exports = router;