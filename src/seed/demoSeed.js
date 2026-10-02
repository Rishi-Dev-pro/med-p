/**
 * Health Tracker — Phase 16 Presentation Demo Seed
 * Realistic, deterministic demonstration dataset with synthetic telemetry curves.
 *
 * SAFETY INVARIANT:
 * Refuses execution if NODE_ENV === 'production' or targeting an unsafe database.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const connectDatabase = require("../config/database");

const User = require("../models/User");
const Doctor = require("../models/Doctor");
const Patient = require("../models/Patient");
const Device = require("../models/Device");
const SensorReading = require("../models/SensorReading");
const ActivityLog = require("../models/ActivityLog");
const {
    ROLES,
    ACCOUNT_STATUS,
    DOCTOR_STATUS,
    DEVICE_STATUS,
    AUDIT_ACTIONS,
    ACTOR_ROLES,
    TARGET_TYPES
} = require("../config/constants");
const { hashPassword } = require("../utils/authUtils");
const { generateDeviceApiKey } = require("../utils/apiKeyUtils");

/**
 * Executes deterministic demo seed.
 *
 * @param {Object} [options={}]
 * @param {boolean} [options.clean=true]
 * @returns {Promise<Object>} Seeded entities and telemetry summary
 */
async function runDemoSeed(options = {}) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) {
        throw new Error("DEMO SEED SAFETY GUARD: Execution strictly refused in production environment.");
    }

    if (mongoose.connection.readyState === 0) {
        await connectDatabase();
    }

    const dbName = mongoose.connection.name || "";
    if (dbName.toLowerCase().includes("prod") && !dbName.toLowerCase().includes("test")) {
        throw new Error(`DEMO SEED SAFETY GUARD: Refusing to seed database containing 'prod' in name (${dbName}).`);
    }

    console.log(`[DEMO SEED] Seeding presentation dataset into database: ${dbName}...`);

    if (options.clean !== false) {
        console.log("[DEMO SEED] Purging existing demo collections...");
        await SensorReading.deleteMany({});
        await Device.deleteMany({});
        await Patient.deleteMany({});
        await Doctor.deleteMany({});
        await User.deleteMany({});
        await ActivityLog.deleteMany({});
    }

    const defaultDoctorPassword = await hashPassword("Doctor@123");
    const defaultPatientPassword = await hashPassword("Patient@123");
    const defaultAdminPassword = await hashPassword("Admin@12345");

    // 1. Super Admin
    const adminUser = await User.create({
        username: "admin",
        email: "admin@healthtracker.local",
        passwordHash: defaultAdminPassword,
        role: ROLES.SUPER_ADMIN,
        profileId: null,
        status: ACCOUNT_STATUS.ACTIVE
    });

    // 2. Doctors (Clinical Specialists)
    const doctorUsers = await User.insertMany([
        {
            username: "dr_sharma",
            email: "sharma@healthtracker.local",
            passwordHash: defaultDoctorPassword,
            role: ROLES.DOCTOR,
            profileId: "DOC-001",
            status: ACCOUNT_STATUS.ACTIVE
        },
        {
            username: "dr_roy",
            email: "roy@healthtracker.local",
            passwordHash: defaultDoctorPassword,
            role: ROLES.DOCTOR,
            profileId: "DOC-002",
            status: ACCOUNT_STATUS.ACTIVE
        },
        {
            username: "dr_patel",
            email: "patel@healthtracker.local",
            passwordHash: defaultDoctorPassword,
            role: ROLES.DOCTOR,
            profileId: "DOC-003",
            status: ACCOUNT_STATUS.ACTIVE
        }
    ]);

    const doctors = await Doctor.insertMany([
        {
            doctorId: "DOC-001",
            userId: doctorUsers[0]._id,
            name: "Dr. Ananya Sharma",
            email: "sharma@healthtracker.local",
            phone: "+91 98765 43210",
            specialization: "Cardiology",
            status: DOCTOR_STATUS.ACTIVE
        },
        {
            doctorId: "DOC-002",
            userId: doctorUsers[1]._id,
            name: "Dr. Rajesh Roy",
            email: "roy@healthtracker.local",
            phone: "+91 98765 43211",
            specialization: "Pulmonology",
            status: DOCTOR_STATUS.ACTIVE
        },
        {
            doctorId: "DOC-003",
            userId: doctorUsers[2]._id,
            name: "Dr. Meera Patel",
            email: "patel@healthtracker.local",
            phone: "+91 98765 43212",
            specialization: "Internal Medicine",
            status: DOCTOR_STATUS.ACTIVE
        }
    ]);

    // 3. Devices with Pre-Generated API Keys
    const devKeys = [
        generateDeviceApiKey(),
        generateDeviceApiKey(),
        generateDeviceApiKey(),
        generateDeviceApiKey()
    ];

    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

    const devices = await Device.insertMany([
        {
            deviceId: "DEV-001",
            patientId: "PAT-001",
            status: DEVICE_STATUS.ACTIVE,
            apiKeyHash: devKeys[0].hash,
            apiKeyPrefix: devKeys[0].prefix,
            apiKeyCreatedAt: now,
            apiKeyLastUsedAt: now,
            lastSeen: now, // ONLINE
            resetCount: 0
        },
        {
            deviceId: "DEV-002",
            patientId: "PAT-002",
            status: DEVICE_STATUS.ACTIVE,
            apiKeyHash: devKeys[1].hash,
            apiKeyPrefix: devKeys[1].prefix,
            apiKeyCreatedAt: now,
            apiKeyLastUsedAt: twoMinutesAgo,
            lastSeen: twoMinutesAgo, // STALE (60s-599s)
            resetCount: 0
        },
        {
            deviceId: "DEV-003",
            patientId: null, // Unassigned device
            status: DEVICE_STATUS.ACTIVE,
            apiKeyHash: devKeys[2].hash,
            apiKeyPrefix: devKeys[2].prefix,
            apiKeyCreatedAt: now,
            apiKeyLastUsedAt: tenMinutesAgo,
            lastSeen: tenMinutesAgo, // OFFLINE
            resetCount: 0
        },
        {
            deviceId: "DEV-004",
            patientId: null,
            status: DEVICE_STATUS.INACTIVE, // Inactive spare
            apiKeyHash: devKeys[3].hash,
            apiKeyPrefix: devKeys[3].prefix,
            apiKeyCreatedAt: now,
            resetCount: 0
        }
    ]);

    // 4. Patients
    const patientUsers = await User.insertMany([
        {
            username: "patient_alpha",
            email: "alpha@example.com",
            passwordHash: defaultPatientPassword,
            role: ROLES.PATIENT,
            profileId: "PAT-001",
            status: ACCOUNT_STATUS.ACTIVE
        },
        {
            username: "patient_beta",
            email: "beta@example.com",
            passwordHash: defaultPatientPassword,
            role: ROLES.PATIENT,
            profileId: "PAT-002",
            status: ACCOUNT_STATUS.ACTIVE
        },
        {
            username: "patient_gamma",
            email: "gamma@example.com",
            passwordHash: defaultPatientPassword,
            role: ROLES.PATIENT,
            profileId: "PAT-003",
            status: ACCOUNT_STATUS.ACTIVE
        }
    ]);

    const patients = await Patient.insertMany([
        {
            patientId: "PAT-001",
            userId: patientUsers[0]._id,
            name: "Demo Patient Alpha",
            email: "alpha@example.com",
            age: 48,
            gender: "Male",
            doctorId: "DOC-001", // Assigned to Dr. Sharma
            deviceId: "DEV-001"
        },
        {
            patientId: "PAT-002",
            userId: patientUsers[1]._id,
            name: "Demo Patient Beta",
            email: "beta@example.com",
            age: 62,
            gender: "Female",
            doctorId: "DOC-001", // Also assigned to Dr. Sharma
            deviceId: "DEV-002"
        },
        {
            patientId: "PAT-003",
            userId: patientUsers[2]._id,
            name: "Demo Patient Gamma",
            email: "gamma@example.com",
            age: 35,
            gender: "Other",
            doctorId: null, // Unassigned patient
            deviceId: null  // Awaiting device
        }
    ]);

    // 5. Realistic Synthetic Historical Telemetry Curves (30 readings over past 60 minutes)
    const telemetryReadings = [];
    const baseTimestamp = Date.now() - 60 * 60 * 1000; // 1 hour ago

    for (let i = 0; i < 30; i++) {
        const timeOffset = i * 2 * 60 * 1000; // 2 minutes interval
        const readingTime = new Date(baseTimestamp + timeOffset);

        // Sinusoidal curve with minor variance for Patient Alpha (Heart Rate ~72-84, SpO2 ~97-99)
        const alphaV1 = parseFloat((76 + 6 * Math.sin(i / 3) + (i % 2 === 0 ? 1.2 : -0.8)).toFixed(1));
        const alphaV2 = parseFloat((98 + 1 * Math.cos(i / 4) + (i % 3 === 0 ? 0.4 : -0.2)).toFixed(1));

        telemetryReadings.push({
            deviceId: "DEV-001",
            patientId: "PAT-001",
            doctorId: "DOC-001",
            value1: alphaV1,
            value2: alphaV2,
            timestamp: readingTime
        });

        // Patient Beta (Heart Rate ~80-92, SpO2 ~95-98)
        const betaV1 = parseFloat((85 + 5 * Math.sin(i / 2.5) + (i % 2 === 0 ? 1.5 : -1.1)).toFixed(1));
        const betaV2 = parseFloat((96.5 + 1.2 * Math.cos(i / 3.5)).toFixed(1));

        telemetryReadings.push({
            deviceId: "DEV-002",
            patientId: "PAT-002",
            doctorId: "DOC-001",
            value1: betaV1,
            value2: betaV2,
            timestamp: readingTime
        });
    }

    await SensorReading.insertMany(telemetryReadings);

    // 6. Baseline Audit Trail Events
    await ActivityLog.insertMany([
        {
            action: AUDIT_ACTIONS.SYSTEM_INIT,
            actorRole: ACTOR_ROLES.SYSTEM,
            actorId: "SYSTEM",
            targetType: TARGET_TYPES.SYSTEM,
            targetId: "DEMO_SEED",
            details: { mode: "PRESENTATION_PROTOTYPE", version: "Phase 16" },
            timestamp: new Date(Date.now() - 3600000)
        },
        {
            action: AUDIT_ACTIONS.DOCTOR_CREATED,
            actorRole: ACTOR_ROLES.SUPER_ADMIN,
            actorId: "admin",
            targetType: TARGET_TYPES.DOCTOR,
            targetId: "DOC-001",
            details: { name: "Dr. Ananya Sharma", specialization: "Cardiology" },
            timestamp: new Date(Date.now() - 3500000)
        },
        {
            action: AUDIT_ACTIONS.DEVICE_CREATED,
            actorRole: ACTOR_ROLES.SUPER_ADMIN,
            actorId: "admin",
            targetType: TARGET_TYPES.DEVICE,
            targetId: "DEV-001",
            details: { status: "ACTIVE" },
            timestamp: new Date(Date.now() - 3400000)
        },
        {
            action: AUDIT_ACTIONS.PATIENT_REGISTERED,
            actorRole: ACTOR_ROLES.PATIENT,
            actorId: "patient_alpha",
            targetType: TARGET_TYPES.PATIENT,
            targetId: "PAT-001",
            details: { name: "Demo Patient Alpha", claimedDevice: "DEV-001" },
            timestamp: new Date(Date.now() - 3300000)
        },
        {
            action: AUDIT_ACTIONS.PATIENT_ASSIGNED,
            actorRole: ACTOR_ROLES.SUPER_ADMIN,
            actorId: "admin",
            targetType: TARGET_TYPES.PATIENT,
            targetId: "PAT-001",
            details: { doctorId: "DOC-001" },
            timestamp: new Date(Date.now() - 3200000)
        }
    ]);

    console.log(`[DEMO SEED] Successfully provisioned:`);
    console.log(`  - 1 Super Admin (admin / Admin@12345)`);
    console.log(`  - ${doctors.length} Doctors (dr_sharma, dr_roy, dr_patel)`);
    console.log(`  - ${patients.length} Patients (patient_alpha, patient_beta, patient_gamma)`);
    console.log(`  - ${devices.length} Devices (DEV-001 Online, DEV-002 Stale, DEV-003 Offline, DEV-004 Inactive)`);
    console.log(`  - ${telemetryReadings.length} Biometric Sensor Readings with realistic curves`);
    console.log(`  - 5 System Audit Trail Entries`);

    return {
        admin: adminUser,
        doctors,
        patients,
        devices,
        devKeys,
        readingCount: telemetryReadings.length
    };
}

// Allow direct execution via `node src/seed/demoSeed.js`
if (require.main === module) {
    runDemoSeed()
        .then(() => {
            console.log("[DEMO SEED] Complete.");
            process.exit(0);
        })
        .catch((err) => {
            console.error("[DEMO SEED] Fatal error:", err.message);
            process.exit(1);
        });
}

module.exports = {
    runDemoSeed
};
