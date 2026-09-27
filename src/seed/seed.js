require("dotenv").config();

const connectDatabase = require("../config/database");

const Doctor = require("../models/Doctor");
const Patient = require("../models/Patient");
const Device = require("../models/Device");
const SensorReading = require("../models/SensorReading");

const seedDatabase = async () => {
    try {
        // Connect to MongoDB
        await connectDatabase();

        console.log("Starting database seed...");

        // Clear existing prototype data
        await SensorReading.deleteMany({});
        await Device.deleteMany({});
        await Patient.deleteMany({});
        await Doctor.deleteMany({});

        console.log("Existing prototype data cleared.");

        // -------------------------
        // Doctors
        // -------------------------

        const doctors = await Doctor.insertMany([
            {
                doctorId: "DOC-001",
                name: "Dr. Sharma"
            },
            {
                doctorId: "DOC-002",
                name: "Dr. Roy"
            }
        ]);

        console.log(`${doctors.length} doctors created.`);

        // -------------------------
        // Patients
        // -------------------------

        const patients = await Patient.insertMany([
            {
                patientId: "PAT-001",
                name: "Patient One",
                age: 25,
                doctorId: "DOC-001"
            },
            {
                patientId: "PAT-002",
                name: "Patient Two",
                age: 30,
                doctorId: "DOC-002"
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
                status: "active"
            },
            {
                deviceId: "DEV-002",
                patientId: "PAT-002",
                status: "active"
            }
        ]);

        console.log(`${devices.length} devices created.`);

        console.log("Database seed completed successfully.");

        process.exit(0);

    } catch (error) {
        console.error("Database seed failed:");
        console.error(error);

        process.exit(1);
    }
};

seedDatabase();