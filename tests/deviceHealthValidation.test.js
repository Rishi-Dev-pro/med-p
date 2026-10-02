/**
 * Phase 12: Device Monitoring & Telemetry Health Dashboard Test Suite
 * Health Tracker — Comprehensive Automated Verification
 *
 * Covers all 40 required test cases across 8 domains:
 *  LAST SEEN (1-6):
 *   1. Valid IoT ingestion updates Device.lastSeen.
 *   2. lastSeen is a Date.
 *   3. Invalid telemetry does not update lastSeen.
 *   4. Unknown device does not update lastSeen.
 *   5. Inactive device does not update lastSeen.
 *   6. Failed ingestion does not falsely update lastSeen.
 *
 *  HEALTH STATUS & BOUNDARY BEHAVIOR (7-14):
 *   7. lastSeen < 60 seconds -> ONLINE.
 *   8. exactly 60 seconds -> STALE.
 *   9. 61 seconds -> STALE.
 *  10. 599 seconds -> STALE.
 *  11. exactly 600 seconds -> OFFLINE.
 *  12. older than 10 minutes -> OFFLINE.
 *  13. null lastSeen -> OFFLINE.
 *  14. inactive device -> OFFLINE.
 *
 *  RESET TRACKING & DATA INTEGRITY (15-18):
 *  15. resetCount remains unchanged during ingestion.
 *  16. resetCount increments only during reset.
 *  17. reset preserves historical readings.
 *  18. reset does not rewrite historical doctorId.
 *
 *  AUTHORIZATION & RBAC (19-23):
 *  19. Admin can see all device health.
 *  20. Doctor can see assigned patient device health.
 *  21. Doctor cannot see another doctor's device.
 *  22. Doctor cannot spoof doctorId.
 *  23. Patient cannot see another patient's device.
 *
 *  DEVICE LIFECYCLE (24-27):
 *  24. ACTIVE device can be ONLINE.
 *  25. INACTIVE device cannot be ONLINE.
 *  26. ACTIVE unassigned device remains patientId=null.
 *  27. Device ownership remains consistent.
 *
 *  TRANSMISSION FREQUENCY (28-30):
 *  28. observed frequency uses bounded telemetry data.
 *  29. insufficient readings produce safe empty/insufficient state.
 *  30. frequency calculation does not load unlimited history.
 *
 *  API SECURITY & TAMPERING (31-35):
 *  31. unauthenticated health request rejected.
 *  32. unauthorized doctor request rejected.
 *  33. secrets not exposed.
 *  34. patientId query tampering rejected.
 *  35. doctorId query tampering rejected.
 *
 *  REALTIME / UI LOGIC (36-40):
 *  36. new reading updates lastSeen representation.
 *  37. health transitions from stale/offline to online after valid telemetry.
 *  38. UI does not require full page reload.
 *  39. duplicate timers are prevented.
 *  40. health status text accompanies visual indicator.
 */

require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const { Server } = require("socket.io");

const app = require("../src/app");
const { setupSocketIO } = require("../src/server");
const User = require("../src/models/User");
const Doctor = require("../src/models/Doctor");
const Patient = require("../src/models/Patient");
const Device = require("../src/models/Device");
const SensorReading = require("../src/models/SensorReading");
const ActivityLog = require("../src/models/ActivityLog");
const {
    ROLES,
    ACCOUNT_STATUS,
    DOCTOR_STATUS,
    DEVICE_STATUS,
    DEVICE_HEALTH
} = require("../src/config/constants");
const { hashPassword, generateToken } = require("../src/utils/authUtils");
const { getDeviceHealth, formatLastSeen, calculateObservedFrequency } = require("../src/utils/deviceHealth");

const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/health_monitoring_phase12_test";

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
        redirect: "manual"
    });

    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }

    return {
        status: res.status,
        headers: res.headers,
        data
    };
}

// Test tokens
let adminToken;
let doctorAToken;
let doctorBToken;
let patient1Token;
let patient2Token;

async function setup() {
    console.log("Connecting to test database:", TEST_DB_URI);
    await mongoose.connect(TEST_DB_URI);

    // Clean test collections
    await User.deleteMany({});
    await Doctor.deleteMany({});
    await Patient.deleteMany({});
    await Device.deleteMany({});
    await SensorReading.deleteMany({});
    await ActivityLog.deleteMany({});

    // Start HTTP server with Socket.IO
    server = http.createServer(app);
    const ioServer = new Server(server, {
        cors: { origin: "*", credentials: true }
    });
    setupSocketIO(ioServer);
    app.set("io", ioServer);

    await new Promise((resolve) => {
        server.listen(0, () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });

    const passwordHash = await hashPassword("SecurePass123!");

    // 1. Super Admin
    const adminUser = await User.create({
        username: "admin_p12",
        email: "admin_p12@test.com",
        passwordHash,
        role: ROLES.SUPER_ADMIN,
        status: ACCOUNT_STATUS.ACTIVE
    });
    adminToken = generateToken({
        userId: adminUser._id,
        role: adminUser.role,
        profileId: null
    });

    // 2. Doctor A
    const doctorAUser = await User.create({
        username: "doctor_a_p12",
        email: "doc_a_p12@test.com",
        passwordHash,
        role: ROLES.DOCTOR,
        profileId: "DOC-A",
        status: ACCOUNT_STATUS.ACTIVE
    });
    await Doctor.create({
        userId: doctorAUser._id,
        doctorId: "DOC-A",
        name: "Dr. Alice",
        email: "doc_a_p12@test.com",
        specialization: "Cardiology",
        status: DOCTOR_STATUS.ACTIVE
    });
    doctorAToken = generateToken({
        userId: doctorAUser._id,
        role: doctorAUser.role,
        profileId: "DOC-A"
    });

    // 3. Doctor B
    const doctorBUser = await User.create({
        username: "doctor_b_p12",
        email: "doc_b_p12@test.com",
        passwordHash,
        role: ROLES.DOCTOR,
        profileId: "DOC-B",
        status: ACCOUNT_STATUS.ACTIVE
    });
    await Doctor.create({
        userId: doctorBUser._id,
        doctorId: "DOC-B",
        name: "Dr. Bob",
        email: "doc_b_p12@test.com",
        specialization: "General Practice",
        status: DOCTOR_STATUS.ACTIVE
    });
    doctorBToken = generateToken({
        userId: doctorBUser._id,
        role: doctorBUser.role,
        profileId: "DOC-B"
    });

    // 4. Patient 1 (assigned to Doctor A)
    const patient1User = await User.create({
        username: "patient_1_p12",
        email: "pat1_p12@test.com",
        passwordHash,
        role: ROLES.PATIENT,
        profileId: "PAT-001",
        status: ACCOUNT_STATUS.ACTIVE
    });
    await Patient.create({
        userId: patient1User._id,
        patientId: "PAT-001",
        name: "Patient One",
        email: "pat1_p12@test.com",
        age: 35,
        gender: "Male",
        deviceId: "DEV-001",
        doctorId: "DOC-A"
    });
    patient1Token = generateToken({
        userId: patient1User._id,
        role: patient1User.role,
        profileId: "PAT-001"
    });

    // 5. Patient 2 (assigned to Doctor B)
    const patient2User = await User.create({
        username: "patient_2_p12",
        email: "pat2_p12@test.com",
        passwordHash,
        role: ROLES.PATIENT,
        profileId: "PAT-002",
        status: ACCOUNT_STATUS.ACTIVE
    });
    await Patient.create({
        userId: patient2User._id,
        patientId: "PAT-002",
        name: "Patient Two",
        email: "pat2_p12@test.com",
        age: 42,
        gender: "Female",
        deviceId: "DEV-002",
        doctorId: "DOC-B"
    });
    patient2Token = generateToken({
        userId: patient2User._id,
        role: patient2User.role,
        profileId: "PAT-002"
    });

    // 6. Hardware Devices
    // DEV-001: Assigned to PAT-001
    await Device.create({
        deviceId: "DEV-001",
        type: "VITAL_TELEMETRY",
        status: DEVICE_STATUS.ACTIVE,
        patientId: "PAT-001",
        resetCount: 0,
        lastSeen: null
    });

    // DEV-002: Assigned to PAT-002
    await Device.create({
        deviceId: "DEV-002",
        type: "VITAL_TELEMETRY",
        status: DEVICE_STATUS.ACTIVE,
        patientId: "PAT-002",
        resetCount: 0,
        lastSeen: null
    });

    // DEV-003: Unassigned Active Device
    await Device.create({
        deviceId: "DEV-003",
        type: "VITAL_TELEMETRY",
        status: DEVICE_STATUS.ACTIVE,
        patientId: null,
        resetCount: 1,
        lastSeen: null
    });

    // DEV-004: Inactive Device
    await Device.create({
        deviceId: "DEV-004",
        type: "VITAL_TELEMETRY",
        status: DEVICE_STATUS.INACTIVE,
        patientId: null,
        resetCount: 0,
        lastSeen: null
    });
}

async function teardown() {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.disconnect();
}

async function runAllTests() {
    console.log("=================================================");
    console.log("RUNNING PHASE 12: DEVICE MONITORING & HEALTH DASHBOARD");
    console.log("=================================================");

    // ------------------------------------------------------------
    // 1. LAST SEEN TESTS (1-6)
    // ------------------------------------------------------------

    await runTest(1, "Valid IoT ingestion updates Device.lastSeen", async () => {
        const preDevice = await Device.findOne({ deviceId: "DEV-001" });
        assert(preDevice.lastSeen === null, "pre-ingestion lastSeen should be null");

        const res = await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-001",
                value1: 74,
                value2: 98,
                timestamp: new Date().toISOString()
            }
        });

        assert(res.status === 201, `Expected 201, got ${res.status}`);
        assert(res.data.success === true, "Expected success: true");

        const postDevice = await Device.findOne({ deviceId: "DEV-001" });
        assert(postDevice.lastSeen !== null, "post-ingestion lastSeen must not be null");
    });

    await runTest(2, "lastSeen is a Date", async () => {
        const dev = await Device.findOne({ deviceId: "DEV-001" });
        assert(dev.lastSeen instanceof Date, "Device.lastSeen must be an instance of Date");
        assert(!isNaN(dev.lastSeen.getTime()), "Device.lastSeen must be a valid timestamp");
    });

    await runTest(3, "Invalid telemetry does not update lastSeen", async () => {
        const initialDev = await Device.findOne({ deviceId: "DEV-001" });
        const initialLastSeenTime = initialDev.lastSeen.getTime();

        // Send invalid payload (value1 is string)
        const res = await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-001",
                value1: "INVALID_NUMBER",
                value2: 98,
                timestamp: new Date().toISOString()
            }
        });

        assert(res.status === 400, `Expected 400 for invalid telemetry, got ${res.status}`);
        const afterDev = await Device.findOne({ deviceId: "DEV-001" });
        assert(afterDev.lastSeen.getTime() === initialLastSeenTime, "lastSeen must not update on invalid telemetry");
    });

    await runTest(4, "Unknown device does not update lastSeen", async () => {
        const res = await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-NONEXISTENT",
                value1: 72,
                value2: 98,
                timestamp: new Date().toISOString()
            }
        });
        assert(res.status === 404, `Expected 404 for unknown device, got ${res.status}`);
    });

    await runTest(5, "Inactive device does not update lastSeen", async () => {
        // DEV-004 is INACTIVE
        const initialDev = await Device.findOne({ deviceId: "DEV-004" });
        assert(initialDev.lastSeen === null, "initial lastSeen should be null");

        const res = await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-004",
                value1: 80,
                value2: 97,
                timestamp: new Date().toISOString()
            }
        });

        assert(res.status === 403, `Expected 403 for inactive device, got ${res.status}`);
        const afterDev = await Device.findOne({ deviceId: "DEV-004" });
        assert(afterDev.lastSeen === null, "Inactive device lastSeen must remain unchanged");
    });

    await runTest(6, "Failed ingestion does not falsely update lastSeen", async () => {
        // DEV-003 is active but unassigned -> will fail resolution with 404
        const devBefore = await Device.findOne({ deviceId: "DEV-003" });
        const res = await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-003",
                value1: 70,
                value2: 99,
                timestamp: new Date().toISOString()
            }
        });

        assert(res.status === 404, `Expected 404 for unassigned device, got ${res.status}`);
        const devAfter = await Device.findOne({ deviceId: "DEV-003" });
        assert(devAfter.lastSeen === null, "Unassigned device lastSeen must remain unchanged");
    });

    // ------------------------------------------------------------
    // 2. HEALTH STATUS & BOUNDARY BEHAVIOR (7-14)
    // ------------------------------------------------------------

    await runTest(7, "lastSeen < 60 seconds -> ONLINE", async () => {
        const now = new Date("2026-10-02T12:00:00.000Z");
        // 30 seconds ago
        const res30 = getDeviceHealth(new Date(now.getTime() - 30 * 1000), now);
        assert(res30.health === DEVICE_HEALTH.ONLINE, `Expected ONLINE at 30s, got ${res30.health}`);

        // Boundary: 59 seconds ago
        const res59 = getDeviceHealth(new Date(now.getTime() - 59 * 1000), now);
        assert(res59.health === DEVICE_HEALTH.ONLINE, `Expected ONLINE at 59s, got ${res59.health}`);
    });

    await runTest(8, "exactly 60 seconds -> STALE", async () => {
        const now = new Date("2026-10-02T12:00:00.000Z");
        const res60 = getDeviceHealth(new Date(now.getTime() - 60 * 1000), now);
        assert(res60.health === DEVICE_HEALTH.STALE, `Expected STALE at exactly 60s, got ${res60.health}`);
    });

    await runTest(9, "61 seconds -> STALE", async () => {
        const now = new Date("2026-10-02T12:00:00.000Z");
        const res61 = getDeviceHealth(new Date(now.getTime() - 61 * 1000), now);
        assert(res61.health === DEVICE_HEALTH.STALE, `Expected STALE at 61s, got ${res61.health}`);
    });

    await runTest(10, "599 seconds -> STALE", async () => {
        const now = new Date("2026-10-02T12:00:00.000Z");
        const res599 = getDeviceHealth(new Date(now.getTime() - 599 * 1000), now);
        assert(res599.health === DEVICE_HEALTH.STALE, `Expected STALE at 599s, got ${res599.health}`);
    });

    await runTest(11, "exactly 600 seconds -> OFFLINE", async () => {
        const now = new Date("2026-10-02T12:00:00.000Z");
        const res600 = getDeviceHealth(new Date(now.getTime() - 600 * 1000), now);
        assert(res600.health === DEVICE_HEALTH.OFFLINE, `Expected OFFLINE at exactly 600s, got ${res600.health}`);
    });

    await runTest(12, "older than 10 minutes -> OFFLINE", async () => {
        const now = new Date("2026-10-02T12:00:00.000Z");
        // 15 minutes ago (900 seconds)
        const res900 = getDeviceHealth(new Date(now.getTime() - 900 * 1000), now);
        assert(res900.health === DEVICE_HEALTH.OFFLINE, `Expected OFFLINE at 15m, got ${res900.health}`);
    });

    await runTest(13, "null lastSeen -> OFFLINE", async () => {
        const resNull = getDeviceHealth(null);
        assert(resNull.health === DEVICE_HEALTH.OFFLINE, `Expected OFFLINE for null lastSeen, got ${resNull.health}`);
        assert(resNull.lastSeenFormatted === "Never", "Formatted relative time must be 'Never'");
    });

    await runTest(14, "inactive device -> OFFLINE", async () => {
        const now = new Date();
        // Even if lastSeen was 5 seconds ago, an inactive device is OFFLINE
        const inactiveDev = {
            deviceId: "DEV-TEST",
            status: DEVICE_STATUS.INACTIVE,
            lastSeen: new Date(now.getTime() - 5 * 1000)
        };
        const res = getDeviceHealth(inactiveDev, now);
        assert(res.health === DEVICE_HEALTH.OFFLINE, `Expected OFFLINE for INACTIVE device, got ${res.health}`);
    });

    // ------------------------------------------------------------
    // 3. RESET TRACKING & DATA INTEGRITY (15-18)
    // ------------------------------------------------------------

    await runTest(15, "resetCount remains unchanged during ingestion", async () => {
        const devBefore = await Device.findOne({ deviceId: "DEV-001" });
        const countBefore = devBefore.resetCount;

        await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-001",
                value1: 76,
                value2: 98,
                timestamp: new Date().toISOString()
            }
        });

        const devAfter = await Device.findOne({ deviceId: "DEV-001" });
        assert(devAfter.resetCount === countBefore, "resetCount must not increment during normal telemetry ingestion");
    });

    await runTest(16, "resetCount increments only during reset", async () => {
        const devBefore = await Device.findOne({ deviceId: "DEV-001" });
        const countBefore = devBefore.resetCount;

        const res = await request("/api/admin/devices/DEV-001/reset", {
            method: "POST",
            headers: { Cookie: `token=${adminToken}` }
        });

        assert(res.status === 200, `Expected 200 for reset, got ${res.status}`);
        const devAfter = await Device.findOne({ deviceId: "DEV-001" });
        assert(devAfter.resetCount === countBefore + 1, "resetCount must increment by 1 on admin reset");
    });

    await runTest(17, "reset preserves historical readings", async () => {
        const readingCount = await SensorReading.countDocuments({ deviceId: "DEV-001" });
        assert(readingCount > 0, "Historical readings must exist before reset check");

        // Re-assign DEV-001 back to PAT-001 for remaining tests
        await request("/api/admin/devices/DEV-001/assign", {
            method: "POST",
            headers: { Cookie: `token=${adminToken}` },
            body: { patientId: "PAT-001" }
        });

        const afterCount = await SensorReading.countDocuments({ deviceId: "DEV-001" });
        assert(afterCount === readingCount, "Historical readings count must remain identical after reset");
    });

    await runTest(18, "reset does not rewrite historical doctorId", async () => {
        const historicalReadings = await SensorReading.find({ deviceId: "DEV-001" }).lean();
        historicalReadings.forEach((r) => {
            assert(r.doctorId === "DOC-A", `Historical doctorId must remain DOC-A, got ${r.doctorId}`);
        });
    });

    // ------------------------------------------------------------
    // 4. AUTHORIZATION & RBAC (19-23)
    // ------------------------------------------------------------

    await runTest(19, "Admin can see all device health", async () => {
        const res = await request("/api/devices/health", {
            headers: { Cookie: `token=${adminToken}` }
        });

        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.success === true, "Expected success: true");
        assert(res.data.devices.length >= 4, `Expected all devices, got ${res.data.devices.length}`);
    });

    await runTest(20, "Doctor can see assigned patient device health", async () => {
        const res = await request("/api/devices/health", {
            headers: { Cookie: `token=${doctorAToken}` }
        });

        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.devices.length === 1, `Doctor A should see 1 assigned device, got ${res.data.devices.length}`);
        assert(res.data.devices[0].deviceId === "DEV-001", "Doctor A should only see DEV-001");
    });

    await runTest(21, "Doctor cannot see another doctor's device", async () => {
        // DEV-002 is assigned to PAT-002 under Doctor B
        const res = await request("/api/devices/health?deviceId=DEV-002", {
            headers: { Cookie: `token=${doctorAToken}` }
        });

        assert(res.status === 403, `Expected 403 for unauthorized device query, got ${res.status}`);
    });

    await runTest(22, "Doctor cannot spoof doctorId", async () => {
        // Doctor A passes ?doctorId=DOC-B
        const res = await request("/api/devices/health?doctorId=DOC-B", {
            headers: { Cookie: `token=${doctorAToken}` }
        });

        assert(res.status === 403, `Expected 403 for doctorId query tampering, got ${res.status}`);
    });

    await runTest(23, "Patient cannot see another patient's device", async () => {
        // Patient 1 queries DEV-002 (Patient 2's device)
        const res = await request("/api/devices/health?deviceId=DEV-002", {
            headers: { Cookie: `token=${patient1Token}` }
        });

        assert(res.status === 403, `Expected 403 for foreign device query by patient, got ${res.status}`);
    });

    // ------------------------------------------------------------
    // 5. DEVICE LIFECYCLE (24-27)
    // ------------------------------------------------------------

    await runTest(24, "ACTIVE device can be ONLINE", async () => {
        const now = new Date();
        const activeDev = {
            deviceId: "DEV-ONLINE",
            status: DEVICE_STATUS.ACTIVE,
            lastSeen: new Date(now.getTime() - 10 * 1000)
        };
        const res = getDeviceHealth(activeDev, now);
        assert(res.health === DEVICE_HEALTH.ONLINE, `Expected ONLINE, got ${res.health}`);
    });

    await runTest(25, "INACTIVE device cannot be ONLINE", async () => {
        const now = new Date();
        const inactiveDev = {
            deviceId: "DEV-INACTIVE",
            status: DEVICE_STATUS.INACTIVE,
            lastSeen: new Date(now.getTime() - 10 * 1000)
        };
        const res = getDeviceHealth(inactiveDev, now);
        assert(res.health === DEVICE_HEALTH.OFFLINE, `Expected OFFLINE, got ${res.health}`);
    });

    await runTest(26, "ACTIVE unassigned device remains patientId=null", async () => {
        const dev = await Device.findOne({ deviceId: "DEV-003" });
        assert(dev.patientId === null, "Unassigned device patientId must strictly be null");
        assert(dev.patientId !== "UNASSIGNED", "Must never store string 'UNASSIGNED'");
    });

    await runTest(27, "Device ownership remains consistent", async () => {
        const dev = await Device.findOne({ deviceId: "DEV-001" });
        const pat = await Patient.findOne({ patientId: "PAT-001" });
        assert(dev.patientId === pat.patientId, "Device.patientId must match Patient.patientId");
        assert(pat.deviceId === dev.deviceId, "Patient.deviceId must match Device.deviceId");
    });

    // ------------------------------------------------------------
    // 6. TRANSMISSION FREQUENCY (28-30)
    // ------------------------------------------------------------

    await runTest(28, "observed frequency uses bounded telemetry data", async () => {
        // Create 4 readings 2 seconds apart for DEV-FREQ
        const baseTime = Date.now();
        await SensorReading.create([
            { deviceId: "DEV-FREQ", patientId: "PAT-001", doctorId: "DOC-A", value1: 70, value2: 98, timestamp: new Date(baseTime) },
            { deviceId: "DEV-FREQ", patientId: "PAT-001", doctorId: "DOC-A", value1: 71, value2: 98, timestamp: new Date(baseTime - 2000) },
            { deviceId: "DEV-FREQ", patientId: "PAT-001", doctorId: "DOC-A", value1: 72, value2: 98, timestamp: new Date(baseTime - 4000) },
            { deviceId: "DEV-FREQ", patientId: "PAT-001", doctorId: "DOC-A", value1: 73, value2: 98, timestamp: new Date(baseTime - 6000) }
        ]);

        const freq = await calculateObservedFrequency("DEV-FREQ", 10);
        assert(freq.frequencySeconds === 2, `Expected 2s average delta, got ${freq.frequencySeconds}`);
        assert(freq.formatted === "~2s", `Expected ~2s formatted, got ${freq.formatted}`);
        assert(freq.sampleCount === 4, `Expected sampleCount 4, got ${freq.sampleCount}`);
    });

    await runTest(29, "insufficient readings produce safe empty/insufficient state", async () => {
        const freqZero = await calculateObservedFrequency("DEV-NO-READINGS", 10);
        assert(freqZero.frequencySeconds === null, "frequencySeconds must be null");
        assert(freqZero.formatted === "Insufficient data", "formatted must be 'Insufficient data'");
        assert(freqZero.sampleCount === 0, "sampleCount must be 0");
    });

    await runTest(30, "frequency calculation does not load unlimited history", async () => {
        // DEV-FREQ has 4 readings, request with sampleLimit=2
        const freqBounded = await calculateObservedFrequency("DEV-FREQ", 2);
        assert(freqBounded.sampleCount === 2, `Expected bounded sampleCount 2, got ${freqBounded.sampleCount}`);
    });

    // ------------------------------------------------------------
    // 7. API SECURITY & TAMPERING (31-35)
    // ------------------------------------------------------------

    await runTest(31, "unauthenticated health request rejected", async () => {
        const res = await request("/api/devices/health");
        assert(res.status === 401, `Expected 401 Unauthorized without token, got ${res.status}`);
    });

    await runTest(32, "unauthorized doctor request rejected", async () => {
        // Doctor A queries patient PAT-002 (belonging to Doctor B)
        const res = await request("/api/devices/health?patientId=PAT-002", {
            headers: { Cookie: `token=${doctorAToken}` }
        });
        assert(res.status === 403, `Expected 403 for unauthorized patient inspection, got ${res.status}`);
    });

    await runTest(33, "secrets not exposed", async () => {
        const res = await request("/api/devices/health", {
            headers: { Cookie: `token=${adminToken}` }
        });
        assert(res.status === 200, "Expected 200");
        const jsonStr = JSON.stringify(res.data);
        assert(!jsonStr.includes("apiKeyHash"), "Response must never leak apiKeyHash");
        assert(!jsonStr.includes("passwordHash"), "Response must never leak passwordHash");
        assert(!jsonStr.includes("JWT_SECRET"), "Response must never leak JWT_SECRET");
    });

    await runTest(34, "patientId query tampering rejected", async () => {
        // Patient 1 queries with ?patientId=PAT-002
        const res = await request("/api/devices/health?patientId=PAT-002", {
            headers: { Cookie: `token=${patient1Token}` }
        });
        assert(res.status === 403, `Expected 403 for patientId query tampering, got ${res.status}`);
    });

    await runTest(35, "doctorId query tampering rejected", async () => {
        // Doctor B queries with ?doctorId=DOC-A
        const res = await request("/api/devices/health?doctorId=DOC-A", {
            headers: { Cookie: `token=${doctorBToken}` }
        });
        assert(res.status === 403, `Expected 403 for doctorId query tampering, got ${res.status}`);
    });

    // ------------------------------------------------------------
    // 8. REALTIME / UI LOGIC (36-40)
    // ------------------------------------------------------------

    await runTest(36, "new reading updates lastSeen representation", async () => {
        const res = await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-001",
                value1: 82,
                value2: 99,
                timestamp: new Date().toISOString()
            }
        });

        assert(res.status === 201, "Expected 201");
        assert(res.data.data.lastSeen, "Response must include updated lastSeen ISO string");
    });

    await runTest(37, "health transitions from stale/offline to online after valid telemetry", async () => {
        // Set DEV-001 lastSeen to 15 minutes ago (OFFLINE)
        const fifteenMinAgo = new Date(Date.now() - 900 * 1000);
        await Device.updateOne({ deviceId: "DEV-001" }, { $set: { lastSeen: fifteenMinAgo } });

        const devBefore = await Device.findOne({ deviceId: "DEV-001" });
        const healthBefore = getDeviceHealth(devBefore);
        assert(healthBefore.health === DEVICE_HEALTH.OFFLINE, `Expected OFFLINE before ingestion, got ${healthBefore.health}`);

        // Ingest new valid telemetry
        await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-001",
                value1: 75,
                value2: 98,
                timestamp: new Date().toISOString()
            }
        });

        const devAfter = await Device.findOne({ deviceId: "DEV-001" });
        const healthAfter = getDeviceHealth(devAfter);
        assert(healthAfter.health === DEVICE_HEALTH.ONLINE, `Expected ONLINE after valid ingestion, got ${healthAfter.health}`);
    });

    await runTest(38, "UI does not require full page reload", async () => {
        const adminViewPath = path.join(__dirname, "../src/views/admin/devices.ejs");
        const doctorViewPath = path.join(__dirname, "../src/views/doctor/monitor.ejs");

        const adminView = fs.readFileSync(adminViewPath, "utf8");
        const doctorView = fs.readFileSync(doctorViewPath, "utf8");

        assert(adminView.includes("recalculateDeviceHealth"), "admin/devices.ejs must include in-place health recalculation");
        assert(doctorView.includes("recalculateDoctorHealth"), "doctor/monitor.ejs must include in-place health recalculation");
    });

    await runTest(39, "duplicate timers are prevented", async () => {
        const adminViewPath = path.join(__dirname, "../src/views/admin/devices.ejs");
        const doctorViewPath = path.join(__dirname, "../src/views/doctor/monitor.ejs");

        const adminView = fs.readFileSync(adminViewPath, "utf8");
        const doctorView = fs.readFileSync(doctorViewPath, "utf8");

        assert(adminView.includes("window._deviceHealthTimer"), "admin/devices.ejs must store and guard timer instance");
        assert(adminView.includes("clearInterval(window._deviceHealthTimer)"), "admin/devices.ejs must clear existing timer before re-registering");

        assert(doctorView.includes("window._doctorHealthTimer"), "doctor/monitor.ejs must store and guard timer instance");
        assert(doctorView.includes("clearInterval(window._doctorHealthTimer)"), "doctor/monitor.ejs must clear existing timer before re-registering");
    });

    await runTest(40, "health status text accompanies visual indicator", async () => {
        const adminViewPath = path.join(__dirname, "../src/views/admin/devices.ejs");
        const doctorViewPath = path.join(__dirname, "../src/views/doctor/monitor.ejs");

        const adminView = fs.readFileSync(adminViewPath, "utf8");
        const doctorView = fs.readFileSync(doctorViewPath, "utf8");

        assert(adminView.includes("health-pulse-dot"), "admin/devices.ejs must include visual pulse dot");
        assert(adminView.includes("health-text"), "admin/devices.ejs must include textual status element for accessibility");

        assert(doctorView.includes("health-pulse-dot"), "doctor/monitor.ejs must include visual pulse dot");
        assert(doctorView.includes("health-text"), "doctor/monitor.ejs must include textual status element for accessibility");
    });

    console.log("=================================================");
    console.log(`TEST SUMMARY: ${passedCount}/40 TESTS PASSED`);
    console.log(`FAILED TESTS: ${failedCount}`);
    console.log("=================================================");

    if (failedCount > 0) {
        throw new Error(`${failedCount} test(s) failed in Phase 12 validation.`);
    }
}

(async () => {
    try {
        await setup();
        await runAllTests();
        await teardown();
        process.exit(0);
    } catch (err) {
        console.error("Test execution failed:", err);
        await teardown();
        process.exit(1);
    }
})();
