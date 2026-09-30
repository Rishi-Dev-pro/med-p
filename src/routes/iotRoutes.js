const express = require("express");

const Device = require("../models/Device");
const Patient = require("../models/Patient");
const Doctor = require("../models/Doctor");
const SensorReading = require("../models/SensorReading");

const router = express.Router();

router.post("/data", async (req, res) => {
    const { deviceId, value1, value2, timestamp } = req.body;

    // ==========================================
    // STAGE 4 — DATA VALIDATION
    // ==========================================

    // 1. Required field check
    if (
        deviceId === undefined ||
        value1 === undefined ||
        value2 === undefined ||
        timestamp === undefined
    ) {
        return res.status(400).json({
            success: false,
            message: "Missing required IoT data fields"
        });
    }

    // 2. Type validation
    if (typeof deviceId !== "string" || deviceId.trim() === "") {
        return res.status(400).json({
            success: false,
            message: "deviceId must be a non-empty string"
        });
    }

    if (typeof value1 !== "number" || !Number.isFinite(value1)) {
        return res.status(400).json({
            success: false,
            message: "value1 must be a valid number"
        });
    }

    if (typeof value2 !== "number" || !Number.isFinite(value2)) {
        return res.status(400).json({
            success: false,
            message: "value2 must be a valid number"
        });
    }

    // 3. Timestamp validation
    if (
        timestamp === null ||
        (typeof timestamp !== "string" && typeof timestamp !== "number") ||
        (typeof timestamp === "number" && !Number.isFinite(timestamp)) ||
        (typeof timestamp === "string" && timestamp.trim() === "")
    ) {
        return res.status(400).json({
            success: false,
            message: "timestamp must be a valid date/time"
        });
    }

    const parsedTimestamp = new Date(timestamp);

    if (Number.isNaN(parsedTimestamp.getTime())) {
        return res.status(400).json({
            success: false,
            message: "timestamp must be a valid date/time"
        });
    }

    // ==========================================
    // STAGE 5 & 6 — DEVICE, PATIENT & DOCTOR RESOLUTION
    // ==========================================

    const cleanDeviceId = deviceId.trim();
    let device;
    let patient;
    let doctor;

    try {
        device = await Device.findOne({
            deviceId: cleanDeviceId
        });

        if (!device) {
            return res.status(404).json({
                success: false,
                message: "Device not registered"
            });
        }

        if (device.status !== "ACTIVE" && device.status !== "active") {
            return res.status(403).json({
                success: false,
                message: "Device is inactive"
            });
        }

        if (!device.patientId) {
            return res.status(404).json({
                success: false,
                message: "Device is not assigned to any patient"
            });
        }

        patient = await Patient.findOne({
            patientId: device.patientId
        });

        if (!patient) {
            return res.status(404).json({
                success: false,
                message: "Patient associated with this device was not found"
            });
        }

        if (patient.doctorId) {
            doctor = await Doctor.findOne({
                doctorId: patient.doctorId
            });
        }
    } catch (dbError) {
        console.error("Database resolution error:", dbError.message);
        return res.status(500).json({
            success: false,
            message: "Internal server error during resolution"
        });
    }

    // ==========================================
    // STAGE 7 — STORE SENSOR READING
    // ==========================================

    let sensorReading;
    try {
        sensorReading = await SensorReading.create({
            deviceId: device.deviceId,
            patientId: patient.patientId,
            doctorId: doctor ? doctor.doctorId : null,
            value1,
            value2,
            timestamp: parsedTimestamp
        });
    } catch (storageError) {
        console.error("Failed to store sensor reading:", storageError.message);
        return res.status(500).json({
            success: false,
            message: "Failed to store sensor reading"
        });
    }

    // ==========================================
    // STAGE 8 — REAL-TIME DELIVERY (NON-BLOCKING)
    // ==========================================

    const io = req.app.get("io");
    if (io) {
        try {
            const realtimeData = {
                readingId: sensorReading._id,
                deviceId: sensorReading.deviceId,
                patientId: sensorReading.patientId,
                patientName: patient.name,
                doctorId: doctor ? doctor.doctorId : null,
                value1: sensorReading.value1,
                value2: sensorReading.value2,
                timestamp: sensorReading.timestamp
            };

            io.to(`patient:${patient.patientId}`).emit(
                "sensor-reading",
                realtimeData
            );

            if (doctor) {
                io.to(`doctor:${doctor.doctorId}`).emit(
                    "sensor-reading",
                    realtimeData
                );
            }

            console.log("Real-time sensor reading delivered via Socket.IO.");
        } catch (socketError) {
            console.warn("Socket.IO delivery notice:", socketError.message);
        }
    }

    // ==========================================
    // RESOLUTION SUCCESSFUL (201 CREATED)
    // ==========================================

    console.log("Telemetry ingested successfully:", {
        deviceId: device.deviceId,
        patientId: patient.patientId,
        doctorId: doctor ? doctor.doctorId : null
    });

    return res.status(201).json({
        success: true,
        message: "Sensor reading recorded successfully",
        data: {
            deviceId: device.deviceId,

            patient: {
                patientId: patient.patientId,
                name: patient.name,
                age: patient.age
            },

            doctor: doctor ? {
                doctorId: doctor.doctorId,
                name: doctor.name
            } : null,

            reading: {
                readingId: sensorReading._id,
                value1,
                value2,
                timestamp: parsedTimestamp.toISOString()
            }
        }
    });
});

module.exports = router;