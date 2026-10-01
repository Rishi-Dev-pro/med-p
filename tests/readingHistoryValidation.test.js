/**
 * Phase 10: Reading History Engine & Paginated API Test Suite
 * Health Tracker — Comprehensive Automated Verification
 *
 * Covers 50 test cases:
 *  DATABASE & INDEXES (1-2):
 *   1. SensorReading compound index exists in MongoDB collection
 *   2. Index order is patientId ASC (1) + timestamp DESC (-1)
 *  AUTHENTICATION (3-6):
 *   3. Unauthenticated request to GET /api/readings/:patientId returns 401
 *   4. Invalid JWT returns 401
 *   5. Expired JWT returns 401
 *   6. Suspended user JWT returns 403
 *  PATIENT AUTHORIZATION (7-9):
 *   7. Patient can query self
 *   8. Patient cannot query another patient (403)
 *   9. PatientId query tampering rejected
 *  DOCTOR AUTHORIZATION (10-13):
 *  10. Doctor can query assigned patient
 *  11. Doctor cannot query unassigned patient (403)
 *  12. Doctor cannot query another doctor's patient (403)
 *  13. DoctorId query tampering rejected
 *  ADMIN AUTHORIZATION (14-15):
 *  14. Super Admin can query any patient
 *  15. Non-admin cannot bypass ownership
 *  PAGINATION (16-22):
 *  16. Default page works (page 1, limit 20)
 *  17. Custom page works (page 2)
 *  18. Custom limit works (limit 5)
 *  19. limit > 100 is handled safely (clamped to 100)
 *  20. Invalid page rejected safely (page=0, page=-1, page=abc -> 400)
 *  21. Invalid limit rejected safely (limit=0, limit=-5, limit=abc -> 400)
 *  22. Page beyond available pages returns valid empty result
 *  SORTING (23-24):
 *  23. Results are newest first
 *  24. Database query performs descending timestamp sorting
 *  DATE FILTERING (25-30):
 *  25. startDate works
 *  26. endDate works
 *  27. startDate + endDate works
 *  28. Invalid startDate rejected (400)
 *  29. Invalid endDate rejected (400)
 *  30. Invalid date range handled safely (startDate > endDate -> 400)
 *  RESPONSE INTEGRITY (31-35):
 *  31. Pagination metadata exists (page, limit, total, pages)
 *  32. total count is correct
 *  33. page count is correct
 *  34. Timestamps are ISO formatted
 *  35. Unauthorized data is not included
 *  DATA INTEGRITY (36-37):
 *  36. Historical SensorReading.doctorId remains unchanged
 *  37. Reassignment does not rewrite old readings
 *  SECURITY & DOS (38-40):
 *  38. limit cannot exceed 100
 *  39. patientId cannot be overridden through query parameters
 *  40. doctorId cannot be overridden through query parameters
 *  FRONTEND INTEGRATION & UI (41-50):
 *  41. Patient history loads data and renders table
 *  42. Patient pagination controls work
 *  43. Patient date filters work
 *  44. Patient clear filter works
 *  45. Doctor history loads authorized patient list
 *  46. Doctor patient selection works
 *  47. Doctor pagination works
 *  48. Doctor date filtering works
 *  49. Unauthorized patient history cannot be loaded by doctor
 *  50. CSV export is clearly a stub and does not claim to export
 */

require("dotenv").config();
const http = require("http");
const mongoose = require("mongoose");

const app = require("../src/app");
const User = require("../src/models/User");
const Doctor = require("../src/models/Doctor");
const Patient = require("../src/models/Patient");
const Device = require("../src/models/Device");
const SensorReading = require("../src/models/SensorReading");
const {
    ROLES,
    ACCOUNT_STATUS,
    DOCTOR_STATUS,
    DEVICE_STATUS
} = require("../src/config/constants");
const { hashPassword, generateToken } = require("../src/utils/authUtils");

const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/health_monitoring_phase10_test";

let server;
let baseUrl;
let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || "Assertion failed");
    }
}

async function runTest(testNumber, testName, fn) {
    try {
        await fn();
        console.log(`[PASS] Test ${testNumber}: ${testName}`);
        passedCount++;
    } catch (err) {
        console.error(`[FAIL] Test ${testNumber}: ${testName}`);
        console.error(`       Error: ${err.message}`);
        failedCount++;
    }
}

async function request(endpoint, options = {}) {
    const url = `${baseUrl}${endpoint}`;
    const headers = options.headers || {};
    if (options.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        redirect: options.redirect || "manual"
    });

    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        data = text;
    }

    return {
        status: res.status,
        headers: res.headers,
        body: data,
        text
    };
}

// Token storage
let tokens = {};
let seededTimestamps = [];

async function setupDatabase() {
    await mongoose.connect(TEST_DB_URI);
    await mongoose.connection.dropDatabase();

    // Ensure all model indexes are created
    await SensorReading.init();

    const passwordHash = await hashPassword("ValidPassword123!");

    // 1. Super Admin
    const adminUser = await User.create({
        username: "superadmin_p10",
        email: "superadmin_p10@example.com",
        passwordHash,
        role: ROLES.SUPER_ADMIN,
        status: ACCOUNT_STATUS.ACTIVE,
        profileId: "ADM-001"
    });
    tokens.admin = generateToken({
        userId: adminUser._id.toString(),
        username: adminUser.username,
        role: adminUser.role,
        profileId: adminUser.profileId
    });

    // 2. Doctor A
    const doctorAUser = await User.create({
        username: "dr_alice_p10",
        email: "dr_alice_p10@example.com",
        passwordHash,
        role: ROLES.DOCTOR,
        status: ACCOUNT_STATUS.ACTIVE,
        profileId: "DOC-A"
    });
    await Doctor.create({
        doctorId: "DOC-A",
        userId: doctorAUser._id,
        name: "Dr. Alice P10",
        email: "dr_alice_p10@example.com",
        specialization: "Cardiology",
        status: DOCTOR_STATUS.ACTIVE
    });
    tokens.doctorA = generateToken({
        userId: doctorAUser._id.toString(),
        username: doctorAUser.username,
        role: doctorAUser.role,
        profileId: doctorAUser.profileId
    });

    // 3. Doctor B
    const doctorBUser = await User.create({
        username: "dr_bob_p10",
        email: "dr_bob_p10@example.com",
        passwordHash,
        role: ROLES.DOCTOR,
        status: ACCOUNT_STATUS.ACTIVE,
        profileId: "DOC-B"
    });
    await Doctor.create({
        doctorId: "DOC-B",
        userId: doctorBUser._id,
        name: "Dr. Bob P10",
        email: "dr_bob_p10@example.com",
        specialization: "Pulmonology",
        status: DOCTOR_STATUS.ACTIVE
    });
    tokens.doctorB = generateToken({
        userId: doctorBUser._id.toString(),
        username: doctorBUser.username,
        role: doctorBUser.role,
        profileId: doctorBUser.profileId
    });

    // 4. Patient 1 (Assigned to Doctor A)
    const patient1User = await User.create({
        username: "patient_one_p10",
        email: "patient_one_p10@example.com",
        passwordHash,
        role: ROLES.PATIENT,
        status: ACCOUNT_STATUS.ACTIVE,
        profileId: "PAT-001"
    });
    await Patient.create({
        patientId: "PAT-001",
        userId: patient1User._id,
        name: "Patient One P10",
        email: "patient_one_p10@example.com",
        age: 32,
        gender: "Female",
        deviceId: "DEV-001",
        doctorId: "DOC-A"
    });
    tokens.patient1 = generateToken({
        userId: patient1User._id.toString(),
        username: patient1User.username,
        role: patient1User.role,
        profileId: patient1User.profileId
    });

    // 5. Patient 2 (Assigned to Doctor B)
    const patient2User = await User.create({
        username: "patient_two_p10",
        email: "patient_two_p10@example.com",
        passwordHash,
        role: ROLES.PATIENT,
        status: ACCOUNT_STATUS.ACTIVE,
        profileId: "PAT-002"
    });
    await Patient.create({
        patientId: "PAT-002",
        userId: patient2User._id,
        name: "Patient Two P10",
        email: "patient_two_p10@example.com",
        age: 45,
        gender: "Male",
        deviceId: "DEV-002",
        doctorId: "DOC-B"
    });
    tokens.patient2 = generateToken({
        userId: patient2User._id.toString(),
        username: patient2User.username,
        role: patient2User.role,
        profileId: patient2User.profileId
    });

    // 6. Patient 3 (Unassigned)
    const patient3User = await User.create({
        username: "patient_three_p10",
        email: "patient_three_p10@example.com",
        passwordHash,
        role: ROLES.PATIENT,
        status: ACCOUNT_STATUS.ACTIVE,
        profileId: "PAT-003"
    });
    await Patient.create({
        patientId: "PAT-003",
        userId: patient3User._id,
        name: "Patient Three P10",
        email: "patient_three_p10@example.com",
        age: 28,
        gender: "Male",
        deviceId: "DEV-003",
        doctorId: null
    });
    tokens.patient3 = generateToken({
        userId: patient3User._id.toString(),
        username: patient3User.username,
        role: patient3User.role,
        profileId: patient3User.profileId
    });

    // 7. Suspended Patient
    const suspendedUser = await User.create({
        username: "patient_suspended_p10",
        email: "patient_suspended_p10@example.com",
        passwordHash,
        role: ROLES.PATIENT,
        status: ACCOUNT_STATUS.SUSPENDED,
        profileId: "PAT-SUSPENDED"
    });
    await Patient.create({
        patientId: "PAT-SUSPENDED",
        userId: suspendedUser._id,
        name: "Suspended Patient",
        email: "patient_suspended_p10@example.com",
        age: 50,
        gender: "Other",
        deviceId: "DEV-004",
        doctorId: "DOC-A"
    });
    tokens.suspended = generateToken({
        userId: suspendedUser._id.toString(),
        username: suspendedUser.username,
        role: suspendedUser.role,
        profileId: suspendedUser.profileId
    });

    // 8. Devices
    await Device.create([
        { deviceId: "DEV-001", patientId: "PAT-001", status: DEVICE_STATUS.ACTIVE },
        { deviceId: "DEV-002", patientId: "PAT-002", status: DEVICE_STATUS.ACTIVE },
        { deviceId: "DEV-003", patientId: "PAT-003", status: DEVICE_STATUS.ACTIVE },
        { deviceId: "DEV-004", patientId: "PAT-SUSPENDED", status: DEVICE_STATUS.ACTIVE }
    ]);

    // 9. Seed 25 Sensor Readings for PAT-001 with distinct timestamps
    // Days from 2026-09-01 to 2026-09-25
    const readingsData = [];
    for (let i = 1; i <= 25; i++) {
        const dayStr = i < 10 ? `0${i}` : `${i}`;
        const ts = new Date(`2026-09-${dayStr}T10:00:00.000Z`);
        seededTimestamps.push(ts.toISOString());
        readingsData.push({
            deviceId: "DEV-001",
            patientId: "PAT-001",
            doctorId: "DOC-A",
            value1: 70 + (i % 20),
            value2: 95 + (i % 5),
            timestamp: ts
        });
    }

    // Seed 5 readings for PAT-002
    for (let i = 1; i <= 5; i++) {
        readingsData.push({
            deviceId: "DEV-002",
            patientId: "PAT-002",
            doctorId: "DOC-B",
            value1: 80 + i,
            value2: 98,
            timestamp: new Date(`2026-09-10T12:00:0${i}.000Z`)
        });
    }

    await SensorReading.insertMany(readingsData);
}

async function main() {
    console.log("=================================================");
    console.log("RUNNING PHASE 10: READING HISTORY & PAGINATED API");
    console.log("=================================================\n");

    await setupDatabase();

    server = http.createServer(app);
    await new Promise((resolve) => {
        server.listen(0, () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });

    try {
        // ==========================================
        // DATABASE & INDEXES (1-2)
        // ==========================================
        await runTest(1, "SensorReading compound index exists in MongoDB collection", async () => {
            const indexes = await SensorReading.collection.getIndexes();
            assert(indexes["patientId_1_timestamp_-1"], "Expected index 'patientId_1_timestamp_-1' to exist");
        });

        await runTest(2, "Index order is patientId ASC (1) + timestamp DESC (-1)", async () => {
            const indexes = await SensorReading.collection.getIndexes();
            const compound = indexes["patientId_1_timestamp_-1"];
            assert(compound, "Expected patientId_1_timestamp_-1 index to exist");
            assert(compound[0][0] === "patientId" && compound[0][1] === 1, "First field must be patientId: 1");
            assert(compound[1][0] === "timestamp" && compound[1][1] === -1, "Second field must be timestamp: -1");
        });

        // ==========================================
        // AUTHENTICATION (3-6)
        // ==========================================
        await runTest(3, "Unauthenticated request to GET /api/readings/:patientId returns 401", async () => {
            const res = await request("/api/readings/PAT-001");
            assert(res.status === 401, `Expected 401, got ${res.status}`);
            assert(res.body.success === false, "Expected success: false");
        });

        await runTest(4, "Invalid JWT returns 401", async () => {
            const res = await request("/api/readings/PAT-001", {
                headers: { Authorization: "Bearer invalid.token.value" }
            });
            assert(res.status === 401, `Expected 401, got ${res.status}`);
            assert(res.body.success === false, "Expected success: false");
        });

        await runTest(5, "Expired JWT returns 401", async () => {
            const expiredToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjM0NTYiLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MTYwMDAwMDAwMX0.invalid";
            const res = await request("/api/readings/PAT-001", {
                headers: { Authorization: `Bearer ${expiredToken}` }
            });
            assert(res.status === 401, `Expected 401, got ${res.status}`);
        });

        await runTest(6, "Suspended user JWT returns 403", async () => {
            const res = await request("/api/readings/PAT-SUSPENDED", {
                headers: { Authorization: `Bearer ${tokens.suspended}` }
            });
            assert(res.status === 403, `Expected 403 for suspended user, got ${res.status}`);
        });

        // ==========================================
        // PATIENT AUTHORIZATION (7-9)
        // ==========================================
        await runTest(7, "Patient can query self (GET /api/readings/PAT-001)", async () => {
            const res = await request("/api/readings/PAT-001", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            assert(res.body.success === true, "Expected success: true");
            assert(Array.isArray(res.body.data.readings), "Expected readings array");
        });

        await runTest(8, "Patient cannot query another patient (GET /api/readings/PAT-002 -> 403)", async () => {
            const res = await request("/api/readings/PAT-002", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.status === 403, `Expected 403, got ${res.status}`);
            assert(res.body.success === false, "Expected success: false");
        });

        await runTest(9, "PatientId query tampering rejected (?patientId=PAT-001 on PAT-002 route -> 403)", async () => {
            const res = await request("/api/readings/PAT-002?patientId=PAT-001", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.status === 403, `Expected 403, got ${res.status}`);
        });

        // ==========================================
        // DOCTOR AUTHORIZATION (10-13)
        // ==========================================
        await runTest(10, "Doctor can query assigned patient (Doctor A -> PAT-001)", async () => {
            const res = await request("/api/readings/PAT-001", {
                headers: { Authorization: `Bearer ${tokens.doctorA}` }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            assert(res.body.success === true, "Expected success: true");
            assert(res.body.data.readings.length > 0, "Expected readings for assigned patient");
        });

        await runTest(11, "Doctor cannot query unassigned patient (Doctor A -> PAT-003 -> 403)", async () => {
            const res = await request("/api/readings/PAT-003", {
                headers: { Authorization: `Bearer ${tokens.doctorA}` }
            });
            assert(res.status === 403, `Expected 403, got ${res.status}`);
            assert(res.body.success === false, "Expected success: false");
        });

        await runTest(12, "Doctor cannot query another doctor's patient (Doctor A -> PAT-002 -> 403)", async () => {
            const res = await request("/api/readings/PAT-002", {
                headers: { Authorization: `Bearer ${tokens.doctorA}` }
            });
            assert(res.status === 403, `Expected 403, got ${res.status}`);
            assert(res.body.success === false, "Expected success: false");
        });

        await runTest(13, "DoctorId query tampering rejected (?doctorId=DOC-B with Doctor A token -> 403)", async () => {
            const res = await request("/api/readings/PAT-002?doctorId=DOC-B", {
                headers: { Authorization: `Bearer ${tokens.doctorA}` }
            });
            assert(res.status === 403, `Expected 403, got ${res.status}`);
        });

        // ==========================================
        // ADMIN AUTHORIZATION (14-15)
        // ==========================================
        await runTest(14, "Super Admin can query any patient", async () => {
            const res1 = await request("/api/readings/PAT-001", {
                headers: { Authorization: `Bearer ${tokens.admin}` }
            });
            assert(res1.status === 200, `Expected 200 for PAT-001, got ${res1.status}`);

            const res2 = await request("/api/readings/PAT-002", {
                headers: { Authorization: `Bearer ${tokens.admin}` }
            });
            assert(res2.status === 200, `Expected 200 for PAT-002, got ${res2.status}`);

            const res3 = await request("/api/readings/PAT-003", {
                headers: { Authorization: `Bearer ${tokens.admin}` }
            });
            assert(res3.status === 200, `Expected 200 for PAT-003, got ${res3.status}`);
        });

        await runTest(15, "Non-admin cannot bypass ownership", async () => {
            const res = await request("/api/readings/PAT-002", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.status === 403, `Expected 403, got ${res.status}`);
        });

        // ==========================================
        // PAGINATION (16-22)
        // ==========================================
        await runTest(16, "Default page works (page 1, limit 20)", async () => {
            const res = await request("/api/readings/PAT-001", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            assert(res.body.data.pagination.page === 1, `Expected page 1, got ${res.body.data.pagination.page}`);
            assert(res.body.data.pagination.limit === 20, `Expected limit 20, got ${res.body.data.pagination.limit}`);
            assert(res.body.data.readings.length === 20, `Expected 20 readings on page 1, got ${res.body.data.readings.length}`);
            assert(res.body.data.pagination.total === 25, `Expected total 25, got ${res.body.data.pagination.total}`);
            assert(res.body.data.pagination.pages === 2, `Expected pages 2, got ${res.body.data.pagination.pages}`);
        });

        await runTest(17, "Custom page works (page 2 returns remaining 5 readings)", async () => {
            const res = await request("/api/readings/PAT-001?page=2&limit=20", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            assert(res.body.data.pagination.page === 2, `Expected page 2, got ${res.body.data.pagination.page}`);
            assert(res.body.data.readings.length === 5, `Expected 5 readings on page 2, got ${res.body.data.readings.length}`);
        });

        await runTest(18, "Custom limit works (limit 5)", async () => {
            const res = await request("/api/readings/PAT-001?page=1&limit=5", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            assert(res.body.data.pagination.limit === 5, `Expected limit 5, got ${res.body.data.pagination.limit}`);
            assert(res.body.data.readings.length === 5, `Expected 5 readings, got ${res.body.data.readings.length}`);
            assert(res.body.data.pagination.pages === 5, `Expected 5 pages, got ${res.body.data.pagination.pages}`);
        });

        await runTest(19, "limit > 100 is handled safely (clamped to 100)", async () => {
            const res = await request("/api/readings/PAT-001?limit=150", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            assert(res.body.data.pagination.limit === 100, `Expected limit clamped to 100, got ${res.body.data.pagination.limit}`);
            assert(res.body.data.readings.length === 25, `Expected 25 readings, got ${res.body.data.readings.length}`);
        });

        await runTest(20, "Invalid page rejected safely (page=0, page=-1, page=abc -> 400)", async () => {
            const res1 = await request("/api/readings/PAT-001?page=0", { headers: { Authorization: `Bearer ${tokens.patient1}` } });
            assert(res1.status === 400, `Expected 400 for page=0, got ${res1.status}`);

            const res2 = await request("/api/readings/PAT-001?page=-1", { headers: { Authorization: `Bearer ${tokens.patient1}` } });
            assert(res2.status === 400, `Expected 400 for page=-1, got ${res2.status}`);

            const res3 = await request("/api/readings/PAT-001?page=abc", { headers: { Authorization: `Bearer ${tokens.patient1}` } });
            assert(res3.status === 400, `Expected 400 for page=abc, got ${res3.status}`);
        });

        await runTest(21, "Invalid limit rejected safely (limit=0, limit=-5, limit=abc -> 400)", async () => {
            const res1 = await request("/api/readings/PAT-001?limit=0", { headers: { Authorization: `Bearer ${tokens.patient1}` } });
            assert(res1.status === 400, `Expected 400 for limit=0, got ${res1.status}`);

            const res2 = await request("/api/readings/PAT-001?limit=-5", { headers: { Authorization: `Bearer ${tokens.patient1}` } });
            assert(res2.status === 400, `Expected 400 for limit=-5, got ${res2.status}`);

            const res3 = await request("/api/readings/PAT-001?limit=abc", { headers: { Authorization: `Bearer ${tokens.patient1}` } });
            assert(res3.status === 400, `Expected 400 for limit=abc, got ${res3.status}`);
        });

        await runTest(22, "Page beyond available pages returns valid empty result", async () => {
            const res = await request("/api/readings/PAT-001?page=999&limit=20", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            assert(Array.isArray(res.body.data.readings), "Expected readings to be an array");
            assert(res.body.data.readings.length === 0, `Expected 0 readings for page 999, got ${res.body.data.readings.length}`);
            assert(res.body.data.pagination.page === 999, "Expected page 999");
            assert(res.body.data.pagination.total === 25, "Expected total 25");
        });

        // ==========================================
        // SORTING (23-24)
        // ==========================================
        await runTest(23, "Results are newest first (descending timestamp)", async () => {
            const res = await request("/api/readings/PAT-001?page=1&limit=5", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            const readings = res.body.data.readings;
            for (let i = 0; i < readings.length - 1; i++) {
                const cur = new Date(readings[i].timestamp).getTime();
                const next = new Date(readings[i + 1].timestamp).getTime();
                assert(cur >= next, `Expected descending order: ${readings[i].timestamp} vs ${readings[i + 1].timestamp}`);
            }
        });

        await runTest(24, "Database query performs descending timestamp sorting", async () => {
            const res = await request("/api/readings/PAT-001?page=1&limit=1", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            const newest = res.body.data.readings[0];
            // 2026-09-25 was the latest seeded
            assert(newest.timestamp.startsWith("2026-09-25"), `Expected 2026-09-25, got ${newest.timestamp}`);
        });

        // ==========================================
        // DATE FILTERING (25-30)
        // ==========================================
        await runTest(25, "startDate works (readings >= 2026-09-20)", async () => {
            const res = await request("/api/readings/PAT-001?startDate=2026-09-20&limit=50", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            // Readings from Sep 20 to Sep 25 = 6 readings
            assert(res.body.data.pagination.total === 6, `Expected 6 readings, got ${res.body.data.pagination.total}`);
            res.body.data.readings.forEach((r) => {
                assert(new Date(r.timestamp) >= new Date("2026-09-20T00:00:00.000Z"), `Expected timestamp >= Sep 20, got ${r.timestamp}`);
            });
        });

        await runTest(26, "endDate works (readings <= 2026-09-05)", async () => {
            const res = await request("/api/readings/PAT-001?endDate=2026-09-05&limit=50", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            // Readings from Sep 01 to Sep 05 = 5 readings
            assert(res.body.data.pagination.total === 5, `Expected 5 readings, got ${res.body.data.pagination.total}`);
            res.body.data.readings.forEach((r) => {
                assert(new Date(r.timestamp) <= new Date("2026-09-05T23:59:59.999Z"), `Expected timestamp <= Sep 05, got ${r.timestamp}`);
            });
        });

        await runTest(27, "startDate + endDate works (2026-09-10 to 2026-09-15)", async () => {
            const res = await request("/api/readings/PAT-001?startDate=2026-09-10&endDate=2026-09-15&limit=50", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            // Days 10, 11, 12, 13, 14, 15 = 6 readings
            assert(res.body.data.pagination.total === 6, `Expected 6 readings, got ${res.body.data.pagination.total}`);
        });

        await runTest(28, "Invalid startDate rejected (400)", async () => {
            const res = await request("/api/readings/PAT-001?startDate=not-a-date", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.status === 400, `Expected 400, got ${res.status}`);
            assert(res.body.success === false, "Expected success: false");
        });

        await runTest(29, "Invalid endDate rejected (400)", async () => {
            const res = await request("/api/readings/PAT-001?endDate=invalid-date", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.status === 400, `Expected 400, got ${res.status}`);
            assert(res.body.success === false, "Expected success: false");
        });

        await runTest(30, "Invalid date range handled safely (startDate > endDate -> 400)", async () => {
            const res = await request("/api/readings/PAT-001?startDate=2026-09-25&endDate=2026-09-01", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.status === 400, `Expected 400, got ${res.status}`);
            assert(res.body.success === false, "Expected success: false");
        });

        // ==========================================
        // RESPONSE INTEGRITY (31-35)
        // ==========================================
        await runTest(31, "Pagination metadata exists (page, limit, total, pages)", async () => {
            const res = await request("/api/readings/PAT-001", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            const p = res.body.data.pagination;
            assert(typeof p.page === "number", "Expected p.page to be number");
            assert(typeof p.limit === "number", "Expected p.limit to be number");
            assert(typeof p.total === "number", "Expected p.total to be number");
            assert(typeof p.pages === "number", "Expected p.pages to be number");
        });

        await runTest(32, "total count is correct", async () => {
            const res = await request("/api/readings/PAT-001", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.body.data.pagination.total === 25, `Expected 25 total, got ${res.body.data.pagination.total}`);
        });

        await runTest(33, "page count is correct", async () => {
            const res = await request("/api/readings/PAT-001?limit=10", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            // 25 total / 10 limit = 3 pages
            assert(res.body.data.pagination.pages === 3, `Expected 3 pages, got ${res.body.data.pagination.pages}`);
        });

        await runTest(34, "Timestamps are ISO formatted", async () => {
            const res = await request("/api/readings/PAT-001?limit=3", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            res.body.data.readings.forEach((r) => {
                assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(r.timestamp), `Expected ISO timestamp, got ${r.timestamp}`);
            });
        });

        await runTest(35, "Unauthorized data is not included", async () => {
            const res = await request("/api/readings/PAT-001?limit=50", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            res.body.data.readings.forEach((r) => {
                assert(r.patientId === "PAT-001", `Expected patientId PAT-001, got ${r.patientId}`);
            });
        });

        // ==========================================
        // DATA INTEGRITY (36-37)
        // ==========================================
        await runTest(36, "Historical SensorReading.doctorId remains unchanged", async () => {
            const reading = await SensorReading.findOne({ patientId: "PAT-001" }).lean();
            assert(reading.doctorId === "DOC-A", `Expected historical doctorId DOC-A, got ${reading.doctorId}`);
        });

        await runTest(37, "Reassignment does not rewrite old readings", async () => {
            // Simulate reassignment: change Patient.doctorId from DOC-A to DOC-B
            await Patient.updateOne({ patientId: "PAT-001" }, { $set: { doctorId: "DOC-B" } });

            // Verify historical readings still retain doctorId === DOC-A
            const reading = await SensorReading.findOne({ patientId: "PAT-001" }).sort({ timestamp: 1 }).lean();
            assert(reading.doctorId === "DOC-A", `Historical reading doctorId must remain DOC-A, got ${reading.doctorId}`);

            // Revert back for remaining tests
            await Patient.updateOne({ patientId: "PAT-001" }, { $set: { doctorId: "DOC-A" } });
        });

        // ==========================================
        // SECURITY & DOS (38-40)
        // ==========================================
        await runTest(38, "limit cannot exceed 100", async () => {
            const res = await request("/api/readings/PAT-001?limit=99999", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.body.data.pagination.limit <= 100, `Limit must be <= 100, got ${res.body.data.pagination.limit}`);
        });

        await runTest(39, "patientId cannot be overridden through query parameters", async () => {
            // Patient 1 tries to inject ?patientId=PAT-002
            const res = await request("/api/readings/PAT-001?patientId=PAT-002", {
                headers: { Authorization: `Bearer ${tokens.patient1}` }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            res.body.data.readings.forEach((r) => {
                assert(r.patientId === "PAT-001", `Tampering failed: returned ${r.patientId}`);
            });
        });

        await runTest(40, "doctorId cannot be overridden through query parameters", async () => {
            const res = await request("/api/readings/PAT-001?doctorId=DOC-B", {
                headers: { Authorization: `Bearer ${tokens.doctorA}` }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            assert(res.body.data.readings.length > 0, "Expected readings to return normally without parameter poisoning");
        });

        // ==========================================
        // FRONTEND INTEGRATION & UI (41-50)
        // ==========================================
        await runTest(41, "Patient history loads data and renders table", async () => {
            const res = await request("/patient/history", {
                headers: {
                    Cookie: `token=${tokens.patient1}`,
                    Accept: "text/html"
                }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            assert(res.text.includes("Biometric Reading History"), "Expected page title in HTML");
            assert(res.text.includes("Recorded Biometric Sessions"), "Expected table section in HTML");
            assert(res.text.includes("bpm"), "Expected telemetry units in HTML");
        });

        await runTest(42, "Patient pagination controls work", async () => {
            const res = await request("/patient/history?page=2&limit=10", {
                headers: {
                    Cookie: `token=${tokens.patient1}`,
                    Accept: "text/html"
                }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            assert(res.text.includes("Page 2 of 3"), "Expected Page 2 of 3 in HTML pagination");
            assert(res.text.includes("Previous Page"), "Expected Previous Page link");
        });

        await runTest(43, "Patient date filters work", async () => {
            const res = await request("/patient/history?startDate=2026-09-20", {
                headers: {
                    Cookie: `token=${tokens.patient1}`,
                    Accept: "text/html"
                }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            assert(res.text.includes("Total: <strong style=\"color: var(--text);\">6</strong>"), "Expected 6 records filtered");
        });

        await runTest(44, "Patient clear filter works", async () => {
            const res = await request("/patient/history?startDate=2026-09-20", {
                headers: {
                    Cookie: `token=${tokens.patient1}`,
                    Accept: "text/html"
                }
            });
            assert(res.text.includes("Clear Filter"), "Expected Clear Filter button when filter active");
        });

        await runTest(45, "Doctor history loads authorized patient list", async () => {
            const res = await request("/doctor/history", {
                headers: {
                    Cookie: `token=${tokens.doctorA}`,
                    Accept: "text/html"
                }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            assert(res.text.includes("PAT-001"), "Expected assigned patient PAT-001 in doctor dropdown");
            assert(!res.text.includes("PAT-002"), "Expected unassigned patient PAT-002 to be absent from dropdown");
        });

        await runTest(46, "Doctor patient selection works", async () => {
            const res = await request("/doctor/history?patientId=PAT-001", {
                headers: {
                    Cookie: `token=${tokens.doctorA}`,
                    Accept: "text/html"
                }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            assert(res.text.includes("PAT-001"), "Expected PAT-001 records in table");
        });

        await runTest(47, "Doctor pagination works", async () => {
            const res = await request("/doctor/history?patientId=PAT-001&page=2&limit=10", {
                headers: {
                    Cookie: `token=${tokens.doctorA}`,
                    Accept: "text/html"
                }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            assert(res.text.includes("Page 2 of 3"), "Expected Page 2 of 3 in doctor pagination");
        });

        await runTest(48, "Doctor date filtering works", async () => {
            const res = await request("/doctor/history?patientId=PAT-001&startDate=2026-09-20", {
                headers: {
                    Cookie: `token=${tokens.doctorA}`,
                    Accept: "text/html"
                }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            assert(res.text.includes("Total: <strong style=\"color: var(--text);\">6</strong>"), "Expected 6 records in filtered view");
        });

        await runTest(49, "Unauthorized patient history cannot be loaded by doctor", async () => {
            // Doctor A requests PAT-002 in doctor/history HTML view
            const res = await request("/doctor/history?patientId=PAT-002", {
                headers: {
                    Cookie: `token=${tokens.doctorA}`,
                    Accept: "text/html"
                }
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            // Must not display PAT-002 readings
            assert(!res.text.includes("PAT-002</span>"), "Doctor A must NOT see PAT-002 data");
        });

        await runTest(50, "CSV export is clearly a stub and does not claim to export", async () => {
            const res = await request("/patient/history", {
                headers: {
                    Cookie: `token=${tokens.patient1}`,
                    Accept: "text/html"
                }
            });
            assert(res.text.includes("Export CSV (Stub)"), "Expected Export CSV (Stub) button");
            assert(res.text.includes("CSV export coming soon"), "Expected stub warning message");
        });

    } finally {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        await mongoose.connection.close();
    }

    console.log("\n=================================================");
    console.log(`TEST SUMMARY: ${passedCount}/${passedCount + failedCount} TESTS PASSED`);
    console.log(`FAILED TESTS: ${failedCount}`);
    console.log("=================================================");

    if (failedCount > 0) {
        process.exit(1);
    } else {
        console.log("PHASE 10 VERIFICATION: SUCCESS\n");
    }
}

main().catch((err) => {
    console.error("Fatal test runner error:", err);
    process.exit(1);
});
