require("dotenv").config();

const mongoose = require("mongoose");
const connectDatabase = require("../config/database");

const User = require("../models/User");
const Doctor = require("../models/Doctor");
const Patient = require("../models/Patient");
const Device = require("../models/Device");
const SensorReading = require("../models/SensorReading");
const ActivityLog = require("../models/ActivityLog");
const { ROLES, ACCOUNT_STATUS, DOCTOR_STATUS, DEVICE_STATUS } = require("../config/constants");

const seedDatabase = async () => {
    try {
        // Connect to MongoDB
        await connectDatabase();

        console.log("Starting database seed with frozen schema compliance...");

        // Clear existing prototype data
        await SensorReading.deleteMany({});
        await Device.deleteMany({});
        await Patient.deleteMany({});
        await Doctor.deleteMany({});
        await User.deleteMany({});
        await ActivityLog.deleteMany({});

        console.log("Existing prototype data cleared.");

        // -------------------------
        // Users for Doctors
        // -------------------------
        const userDoc1 = await User.create({
            username: "dr_sharma",
            email: "sharma@example.com",
            passwordHash: "$2a$10$demoHashedPasswordPlaceHolder001",
            role: ROLES.DOCTOR,
            profileId: "DOC-001",
            status: ACCOUNT_STATUS.ACTIVE
        });

        const userDoc2 = await User.create({
            username: "dr_roy",
            email: "roy@example.com",
            passwordHash: "$2a$10$demoHashedPasswordPlaceHolder002",
            role: ROLES.DOCTOR,
            profileId: "DOC-002",
            status: ACCOUNT_STATUS.ACTIVE
        });

        // -------------------------
        // Users for Patients
        // -------------------------
        const userPat1 = await User.create({
            username: "patient_one",
            email: "pat1@example.com",
            passwordHash: "$2a$10$demoHashedPasswordPlaceHolder003",
            role: ROLES.PATIENT,
            profileId: "PAT-001",
            status: ACCOUNT_STATUS.ACTIVE
        });

        const userPat2 = await User.create({
            username: "patient_two",
            email: "pat2@example.com",
            passwordHash: "$2a$10$demoHashedPasswordPlaceHolder004",
            role: ROLES.PATIENT,
            profileId: "PAT-002",
            status: ACCOUNT_STATUS.ACTIVE
        });

        console.log("Users created successfully.");

        // -------------------------
        // Doctors
        // -------------------------
        const doctors = await Doctor.insertMany([
            {
                doctorId: "DOC-001",
                userId: userDoc1._id,
                name: "Dr. Sharma",
                email: "sharma@example.com",
                specialization: "General Medicine",
                status: DOCTOR_STATUS.ACTIVE
            },
            {
                doctorId: "DOC-002",
                userId: userDoc2._id,
                name: "Dr. Roy",
                email: "roy@example.com",
                specialization: "Cardiology",
                status: DOCTOR_STATUS.ACTIVE
            }
        ]);

        console.log(`${doctors.length} doctors created.`);

        // -------------------------
        // Patients
        // -------------------------
        const patients = await Patient.insertMany([
            {
                patientId: "PAT-001",
                userId: userPat1._id,
                name: "Patient One",
                email: "pat1@example.com",
                age: 25,
                doctorId: "DOC-001",
                deviceId: "DEV-001"
            },
            {
                patientId: "PAT-002",
                userId: userPat2._id,
                name: "Patient Two",
                email: "pat2@example.com",
                age: 30,
                doctorId: "DOC-002",
                deviceId: "DEV-002"
            }
        ]);

        console.log(`${patients.length} patients created.`);

        // -------------------------
        // Devices
        // -------------------------
        const devices = await Device.insertMany([
            {
                deviceId: "DEV-001",
                patientId: "PAT-001",
                status: DEVICE_STATUS.ACTIVE,
                resetCount: 0
            },
            {
                deviceId: "DEV-002",
                patientId: "PAT-002",
                status: DEVICE_STATUS.ACTIVE,
                resetCount: 0
            }
        ]);

        console.log(`${devices.length} devices created.`);

        console.log("Database seed completed successfully with full relational integrity.");

        process.exit(0);

    } catch (error) {
        console.error("Database seed failed:");
        console.error(error);

        process.exit(1);
    }
};

seedDatabase();