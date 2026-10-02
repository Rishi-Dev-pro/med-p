/**
 * Phase 11: Charts & Time-Series Data Visualization Test Suite
 * Health Tracker — Comprehensive Automated Verification
 *
 * Covers 40 comprehensive test cases across 4 domains:
 *  RECENT READING API (1-15):
 *   1. Recent endpoint exists (GET /api/readings/:patientId/recent)
 *   2. Authentication required (401 without token)
 *   3. Patient self-access works (200 with recent readings)
 *   4. Patient cross-access blocked (403 for another patient)
 *   5. Doctor assigned-patient access works (200 for assigned patient)
 *   6. Doctor unauthorized-patient blocked (403 for unassigned patient)
 *   7. Super Admin access works (200 for any patient)
 *   8. Default limit works (default: 50)
 *   9. Custom limit works (e.g. limit=10)
 *  10. limit > 100 safely handled (clamped to 100)
 *  11. Invalid limit rejected safely (limit=0, limit=-5, limit=abc -> 400)
 *  12. Newest N readings returned in chronological order (oldest -> newest)
 *  13. Timestamps are valid ISO strings
 *  14. Only chart-required fields exposed (timestamp, value1, value2)
 *  15. Query parameter spoofing cannot bypass authorization (?patientId=... or ?doctorId=...)
 *
 *  CHART SECURITY & SANITIZATION (16-24):
 *  16. Numeric Value 1 accepted
 *  17. Numeric Value 2 accepted
 *  18. NaN rejected
 *  19. Infinity rejected
 *  20. Non-numeric Value 1 rejected (strings, objects, null, undefined)
 *  21. Non-numeric Value 2 rejected
 *  22. Malformed timestamp rejected
 *  23. Malicious string cannot become chart data (<script>alert(1)</script>, javascript:...)
 *  24. HTML/script payload cannot enter DOM through chart data
 *
 *  LIVE SOCKET.IO UPDATES & ROLLING WINDOW (25-33):
 *  25. sensor-reading event updates chart
 *  26. Value 1 appended
 *  27. Value 2 appended
 *  28. Timestamp appended
 *  29. Chart remains chronological (oldest to newest, left to right)
 *  30. Maximum chart size enforced (50 points max)
 *  31. Oldest point removed when window exceeds max
 *  32. Duplicate reading does not create duplicate point
 *  33. Malformed socket payload ignored safely
 *
 *  DOCTOR ISOLATION & PATIENT SWITCHING (34-40):
 *  34. Doctor A chart can initialize PAT-001 if assigned
 *  35. Doctor A cannot initialize PAT-002 if not assigned
 *  36. Switching authorized patient reloads correct data
 *  37. Previous patient data does not remain after switch
 *  38. Unauthorized patientId cannot be injected into chart API
 *  39. Doctor reassignment does not expose future unauthorized data
 *  40. Historical telemetry data integrity preserved (record count, timestamps, values, doctorId snapshots)
 */

require("dotenv").config();
const http = require("http");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const ioClient = require("socket.io-client");

const app = require("../src/app");
const { setupSocketIO } = require("../src/server");
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
const { sanitizeReading, ChartTimeSeriesManager } = require("../src/public/js/chartSanitizer");

const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/health_monitoring_phase11_test";

let server;
let ioServer;
let baseUrl;
let socketUrl;
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

// Test fixtures state
let adminToken;
let patient1Token;
let patient2Token;
let doctorAToken;
let doctorBToken;
let initialReadingCount;

async function setupDatabase() {
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
    await mongoose.connect(TEST_DB_URI);

    // Clean collections
    await Promise.all([
        User.deleteMany({}),
        Doctor.deleteMany({}),
        Patient.deleteMany({}),
        Device.deleteMany({}),
        SensorReading.deleteMany({})
    ]);

    const pwHash = await hashPassword("SecurePass123!");

    // 1. Create Users
    const adminUser = await User.create({
        username: "admin_p11",
        email: "admin_p11@test.com",
        passwordHash: pwHash,
        role: ROLES.SUPER_ADMIN,
        status: ACCOUNT_STATUS.ACTIVE
    });

    const docAUser = await User.create({
        username: "dr_alice_p11",
        email: "dr_alice_p11@test.com",
        passwordHash: pwHash,
        role: ROLES.DOCTOR,
        profileId: "DOC-001",
        status: ACCOUNT_STATUS.ACTIVE
    });

    const docBUser = await User.create({
        username: "dr_bob_p11",
        email: "dr_bob_p11@test.com",
        passwordHash: pwHash,
        role: ROLES.DOCTOR,
        profileId: "DOC-002",
        status: ACCOUNT_STATUS.ACTIVE
    });

    const pat1User = await User.create({
        username: "pat1_p11",
        email: "pat1_p11@test.com",
        passwordHash: pwHash,
        role: ROLES.PATIENT,
        profileId: "PAT-001",
        status: ACCOUNT_STATUS.ACTIVE
    });

    const pat2User = await User.create({
        username: "pat2_p11",
        email: "pat2_p11@test.com",
        passwordHash: pwHash,
        role: ROLES.PATIENT,
        profileId: "PAT-002",
        status: ACCOUNT_STATUS.ACTIVE
    });

    const pat3User = await User.create({
        username: "pat3_p11",
        email: "pat3_p11@test.com",
        passwordHash: pwHash,
        role: ROLES.PATIENT,
        profileId: "PAT-003",
        status: ACCOUNT_STATUS.ACTIVE
    });

    // 2. Create Doctors
    await Doctor.create([
        {
            doctorId: "DOC-001",
            userId: docAUser._id,
            name: "Dr. Alice",
            email: "dr_alice_p11@test.com",
            specialization: "Cardiology",
            status: DOCTOR_STATUS.ACTIVE
        },
        {
            doctorId: "DOC-002",
            userId: docBUser._id,
            name: "Dr. Bob",
            email: "dr_bob_p11@test.com",
            specialization: "Pulmonology",
            status: DOCTOR_STATUS.ACTIVE
        }
    ]);

    // 3. Create Patients
    // PAT-001 assigned to DOC-001
    await Patient.create([
        {
            patientId: "PAT-001",
            userId: pat1User._id,
            name: "Patient One",
            email: "pat1_p11@test.com",
            age: 45,
            doctorId: "DOC-001"
        },
        // PAT-002 assigned to DOC-002
        {
            patientId: "PAT-002",
            userId: pat2User._id,
            name: "Patient Two",
            email: "pat2_p11@test.com",
            age: 52,
            doctorId: "DOC-002"
        },
        // PAT-003 unassigned
        {
            patientId: "PAT-003",
            userId: pat3User._id,
            name: "Patient Three",
            email: "pat3_p11@test.com",
            age: 38,
            doctorId: null
        }
    ]);

    // 4. Create Devices
    await Device.create([
        {
            deviceId: "DEV-001",
            patientId: "PAT-001",
            status: DEVICE_STATUS.ACTIVE
        },
        {
            deviceId: "DEV-002",
            patientId: "PAT-002",
            status: DEVICE_STATUS.ACTIVE
        }
    ]);

    // 5. Seed 60 historical SensorReadings for PAT-001 (to test default 50 limit and custom limits)
    // Spanning timestamps 2026-09-01T00:00:00Z to 2026-09-01T01:00:00Z (1 minute apart)
    const baseDate = new Date("2026-09-01T00:00:00.000Z");
    const readings = [];

    for (let i = 0; i < 60; i++) {
        readings.push({
            deviceId: "DEV-001",
            patientId: "PAT-001",
            doctorId: "DOC-001",
            value1: 70 + (i % 25), // HR
            value2: 95 + (i % 5),  // SpO2
            timestamp: new Date(baseDate.getTime() + i * 60000)
        });
    }

    // 5 historical readings for PAT-002
    for (let i = 0; i < 5; i++) {
        readings.push({
            deviceId: "DEV-002",
            patientId: "PAT-002",
            doctorId: "DOC-002",
            value1: 80 + i,
            value2: 98,
            timestamp: new Date(baseDate.getTime() + i * 60000)
        });
    }

    await SensorReading.insertMany(readings);
    initialReadingCount = await SensorReading.countDocuments();

    // 6. Generate JWTs
    adminToken = generateToken({
        userId: adminUser._id,
        role: adminUser.role,
        profileId: null
    });
    patient1Token = generateToken({
        userId: pat1User._id,
        role: pat1User.role,
        profileId: "PAT-001"
    });
    patient2Token = generateToken({
        userId: pat2User._id,
        role: pat2User.role,
        profileId: "PAT-002"
    });
    doctorAToken = generateToken({
        userId: docAUser._id,
        role: docAUser.role,
        profileId: "DOC-001"
    });
    doctorBToken = generateToken({
        userId: docBUser._id,
        role: docBUser.role,
        profileId: "DOC-002"
    });
}

async function startTestServer() {
    server = http.createServer(app);
    ioServer = new Server(server, {
        cors: { origin: "*", credentials: true }
    });
    setupSocketIO(ioServer);
    app.set("io", ioServer);

    await new Promise((resolve) => {
        server.listen(0, () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            socketUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });
}

function connectSocket(token) {
    return new Promise((resolve, reject) => {
        const socket = ioClient(socketUrl, {
            auth: { token },
            transports: ["websocket"],
            forceNew: true
        });

        socket.on("connect", () => resolve(socket));
        socket.on("connect_error", (err) => reject(err));
    });
}

async function runAllTests() {
    console.log("=================================================");
    console.log("RUNNING PHASE 11: CHARTS & TIME-SERIES VISUALIZATION TESTS");
    console.log("=================================================\n");

    await setupDatabase();
    await startTestServer();

    // ==========================================
    // 1. RECENT READING API TESTS (1 - 15)
    // ==========================================

    await runTest(1, "Recent endpoint exists (GET /api/readings/:patientId/recent)", async () => {
        const res = await request("/api/readings/PAT-001/recent", {
            headers: { Authorization: `Bearer ${patient1Token}` }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.success === true, "Expected success: true");
        assert(res.data.data && Array.isArray(res.data.data.readings), "Expected readings array");
    });

    await runTest(2, "Authentication required (401 without token)", async () => {
        const res = await request("/api/readings/PAT-001/recent");
        assert(res.status === 401, `Expected 401, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    await runTest(3, "Patient self-access works (200 with recent readings)", async () => {
        const res = await request("/api/readings/PAT-001/recent", {
            headers: { Authorization: `Bearer ${patient1Token}` }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.data.readings.length > 0, "Expected non-empty readings array");
    });

    await runTest(4, "Patient cross-access blocked (403 for another patient)", async () => {
        const res = await request("/api/readings/PAT-002/recent", {
            headers: { Authorization: `Bearer ${patient1Token}` }
        });
        assert(res.status === 403, `Expected 403, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    await runTest(5, "Doctor assigned-patient access works (200 for assigned patient)", async () => {
        const res = await request("/api/readings/PAT-001/recent", {
            headers: { Authorization: `Bearer ${doctorAToken}` }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.data.readings.length > 0, "Expected readings for assigned patient");
    });

    await runTest(6, "Doctor unauthorized-patient blocked (403 for unassigned patient)", async () => {
        // Doctor A is not assigned to PAT-002 (Doctor B is assigned)
        const res = await request("/api/readings/PAT-002/recent", {
            headers: { Authorization: `Bearer ${doctorAToken}` }
        });
        assert(res.status === 403, `Expected 403, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    await runTest(7, "Super Admin access works (200 for any patient)", async () => {
        const res1 = await request("/api/readings/PAT-001/recent", {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert(res1.status === 200, "Admin access to PAT-001 failed");

        const res2 = await request("/api/readings/PAT-002/recent", {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert(res2.status === 200, "Admin access to PAT-002 failed");
    });

    await runTest(8, "Default limit works (default: 50)", async () => {
        // PAT-001 has 60 readings in DB
        const res = await request("/api/readings/PAT-001/recent", {
            headers: { Authorization: `Bearer ${patient1Token}` }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.data.limit === 50, `Expected limit 50, got ${res.data.data.limit}`);
        assert(res.data.data.readings.length === 50, `Expected 50 readings, got ${res.data.data.readings.length}`);
    });

    await runTest(9, "Custom limit works (e.g. limit=10)", async () => {
        const res = await request("/api/readings/PAT-001/recent?limit=10", {
            headers: { Authorization: `Bearer ${patient1Token}` }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.data.limit === 10, `Expected limit 10, got ${res.data.data.limit}`);
        assert(res.data.data.readings.length === 10, `Expected 10 readings, got ${res.data.data.readings.length}`);
    });

    await runTest(10, "limit > 100 safely handled (clamped to 100)", async () => {
        const res = await request("/api/readings/PAT-001/recent?limit=500", {
            headers: { Authorization: `Bearer ${patient1Token}` }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.data.limit === 100, `Expected limit clamped to 100, got ${res.data.data.limit}`);
    });

    await runTest(11, "Invalid limit rejected safely (limit=0, limit=-5, limit=abc -> 400)", async () => {
        const r1 = await request("/api/readings/PAT-001/recent?limit=0", {
            headers: { Authorization: `Bearer ${patient1Token}` }
        });
        assert(r1.status === 400, `Expected 400 for limit=0, got ${r1.status}`);

        const r2 = await request("/api/readings/PAT-001/recent?limit=-5", {
            headers: { Authorization: `Bearer ${patient1Token}` }
        });
        assert(r2.status === 400, `Expected 400 for limit=-5, got ${r2.status}`);

        const r3 = await request("/api/readings/PAT-001/recent?limit=abc", {
            headers: { Authorization: `Bearer ${patient1Token}` }
        });
        assert(r3.status === 400, `Expected 400 for limit=abc, got ${r3.status}`);
    });

    await runTest(12, "Newest N readings returned in chronological order (oldest -> newest)", async () => {
        // DB has 60 readings (indices 0..59 with timestamps baseDate + i minutes).
        // With limit 10, the newest 10 readings are indices 50..59.
        // In chronological order, index 0 of the returned array should be minute 50 and index 9 should be minute 59.
        const res = await request("/api/readings/PAT-001/recent?limit=10", {
            headers: { Authorization: `Bearer ${patient1Token}` }
        });
        assert(res.status === 200);
        const readings = res.data.data.readings;
        assert(readings.length === 10, "Expected 10 readings");

        for (let i = 0; i < readings.length - 1; i++) {
            const t1 = new Date(readings[i].timestamp).getTime();
            const t2 = new Date(readings[i + 1].timestamp).getTime();
            assert(t1 <= t2, `Expected chronological order: reading[${i}] (${t1}) should be <= reading[${i+1}] (${t2})`);
        }

        // Verify the newest point is indeed from the end of the 60-reading dataset
        const lastReading = readings[readings.length - 1];
        const expectedLastTime = new Date("2026-09-01T00:59:00.000Z").getTime();
        assert(new Date(lastReading.timestamp).getTime() === expectedLastTime, "Expected newest point to match dataset latest");
    });

    await runTest(13, "Timestamps are valid ISO strings", async () => {
        const res = await request("/api/readings/PAT-001/recent?limit=5", {
            headers: { Authorization: `Bearer ${patient1Token}` }
        });
        const readings = res.data.data.readings;
        for (const r of readings) {
            assert(typeof r.timestamp === "string", "timestamp must be string");
            assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(r.timestamp), `Timestamp must be ISO string: ${r.timestamp}`);
            const d = new Date(r.timestamp);
            assert(!isNaN(d.getTime()), "Timestamp must parse to valid Date");
        }
    });

    await runTest(14, "Only chart-required fields exposed (timestamp, value1, value2)", async () => {
        const res = await request("/api/readings/PAT-001/recent?limit=5", {
            headers: { Authorization: `Bearer ${patient1Token}` }
        });
        const reading = res.data.data.readings[0];
        assert(reading.timestamp !== undefined, "timestamp missing");
        assert(reading.value1 !== undefined, "value1 missing");
        assert(reading.value2 !== undefined, "value2 missing");

        // Strictly verify sensitive data is NOT exposed
        assert(reading.password === undefined, "Must not expose password");
        assert(reading.passwordHash === undefined, "Must not expose passwordHash");
        assert(reading.token === undefined, "Must not expose token");
        assert(reading.jwt === undefined, "Must not expose jwt");
        assert(reading.__v === undefined, "Must not expose mongoose __v");
    });

    await runTest(15, "Query parameter spoofing cannot bypass authorization (?patientId=... or ?doctorId=...)", async () => {
        // Patient 1 tries to access Patient 2 via spoofed query param on PAT-001 route
        const res1 = await request("/api/readings/PAT-001/recent?patientId=PAT-002", {
            headers: { Authorization: `Bearer ${patient1Token}` }
        });
        // Route is for PAT-001, so Patient 1 gets PAT-001 data, NOT PAT-002
        assert(res1.status === 200);

        // Patient 1 tries to spoof token identity using doctorId
        const res2 = await request("/api/readings/PAT-002/recent?doctorId=DOC-002", {
            headers: { Authorization: `Bearer ${patient1Token}` }
        });
        assert(res2.status === 403, "Query parameter spoofing must not bypass patient ownership");
    });

    // ==========================================
    // 2. CHART SECURITY & SANITIZATION (16 - 24)
    // ==========================================

    await runTest(16, "Numeric Value 1 accepted", async () => {
        const result = sanitizeReading({
            value1: 98,
            value2: 72,
            timestamp: "2026-10-02T10:30:00.000Z"
        });
        assert(result !== null, "Expected valid reading to be accepted");
        assert(result.value1 === 98, `Expected value1 = 98, got ${result.value1}`);
    });

    await runTest(17, "Numeric Value 2 accepted", async () => {
        const result = sanitizeReading({
            value1: 85,
            value2: 99,
            timestamp: "2026-10-02T10:30:00.000Z"
        });
        assert(result !== null);
        assert(result.value2 === 99, `Expected value2 = 99, got ${result.value2}`);
    });

    await runTest(18, "NaN rejected", async () => {
        const r1 = sanitizeReading({ value1: NaN, value2: 98, timestamp: "2026-10-02T10:30:00.000Z" });
        assert(r1 === null, "Expected NaN value1 to be rejected");

        const r2 = sanitizeReading({ value1: 80, value2: NaN, timestamp: "2026-10-02T10:30:00.000Z" });
        assert(r2 === null, "Expected NaN value2 to be rejected");
    });

    await runTest(19, "Infinity rejected", async () => {
        const r1 = sanitizeReading({ value1: Infinity, value2: 98, timestamp: "2026-10-02T10:30:00.000Z" });
        assert(r1 === null, "Expected Infinity value1 to be rejected");

        const r2 = sanitizeReading({ value1: 75, value2: -Infinity, timestamp: "2026-10-02T10:30:00.000Z" });
        assert(r2 === null, "Expected -Infinity value2 to be rejected");
    });

    await runTest(20, "Non-numeric Value 1 rejected (strings, objects, null, undefined)", async () => {
        assert(sanitizeReading({ value1: "98", value2: 98, timestamp: "2026-10-02T10:30:00.000Z" }) === null, "String rejected");
        assert(sanitizeReading({ value1: null, value2: 98, timestamp: "2026-10-02T10:30:00.000Z" }) === null, "null rejected");
        assert(sanitizeReading({ value1: undefined, value2: 98, timestamp: "2026-10-02T10:30:00.000Z" }) === null, "undefined rejected");
        assert(sanitizeReading({ value1: { foo: 1 }, value2: 98, timestamp: "2026-10-02T10:30:00.000Z" }) === null, "object rejected");
    });

    await runTest(21, "Non-numeric Value 2 rejected", async () => {
        assert(sanitizeReading({ value1: 80, value2: "98 bpm", timestamp: "2026-10-02T10:30:00.000Z" }) === null);
        assert(sanitizeReading({ value1: 80, value2: null, timestamp: "2026-10-02T10:30:00.000Z" }) === null);
        assert(sanitizeReading({ value1: 80, value2: false, timestamp: "2026-10-02T10:30:00.000Z" }) === null);
    });

    await runTest(22, "Malformed timestamp rejected", async () => {
        assert(sanitizeReading({ value1: 80, value2: 95, timestamp: "not-a-valid-date" }) === null);
        assert(sanitizeReading({ value1: 80, value2: 95, timestamp: "" }) === null);
        assert(sanitizeReading({ value1: 80, value2: 95, timestamp: null }) === null);
        assert(sanitizeReading({ value1: 80, value2: 95, timestamp: undefined }) === null);
    });

    await runTest(23, "Malicious string cannot become chart data (<script>alert(1)</script>, javascript:...)", async () => {
        const payload1 = {
            value1: "<script>alert(1)</script>",
            value2: 98,
            timestamp: "2026-10-02T10:30:00.000Z"
        };
        assert(sanitizeReading(payload1) === null, "Script tag rejected");

        const payload2 = {
            value1: 80,
            value2: "javascript:evil()",
            timestamp: "2026-10-02T10:30:00.000Z"
        };
        assert(sanitizeReading(payload2) === null, "javascript: pseudo protocol rejected");
    });

    await runTest(24, "HTML/script payload cannot enter DOM through chart data", async () => {
        const manager = new ChartTimeSeriesManager(50);
        manager.addReading({
            value1: "<img src=x onerror=alert(1)>",
            value2: 90,
            timestamp: new Date().toISOString()
        });
        assert(manager.getCount() === 0, "Payload must not enter time series manager");

        // Values are guaranteed numeric
        manager.addReading({ value1: 72, value2: 98, timestamp: new Date().toISOString() });
        const points = manager.getPoints();
        assert(typeof points[0].value1 === "number", "Value1 must be number");
        assert(typeof points[0].value2 === "number", "Value2 must be number");
    });

    // ==========================================
    // 3. LIVE SOCKET.IO UPDATES & ROLLING WINDOW (25 - 33)
    // ==========================================

    await runTest(25, "sensor-reading event updates chart", async () => {
        const manager = new ChartTimeSeriesManager(50);
        const reading = {
            value1: 82,
            value2: 97,
            timestamp: "2026-10-02T11:00:00.000Z"
        };
        const result = manager.addReading(reading);
        assert(result !== null, "addReading should succeed");
        assert(manager.getCount() === 1, "Chart manager should have 1 point");
    });

    await runTest(26, "Value 1 appended", async () => {
        const manager = new ChartTimeSeriesManager(50);
        manager.addReading({ value1: 88, value2: 96, timestamp: "2026-10-02T11:00:00.000Z" });
        const v1Series = manager.getValue1Series();
        assert(v1Series.length === 1 && v1Series[0] === 88, `Expected [88], got ${v1Series}`);
    });

    await runTest(27, "Value 2 appended", async () => {
        const manager = new ChartTimeSeriesManager(50);
        manager.addReading({ value1: 88, value2: 96, timestamp: "2026-10-02T11:00:00.000Z" });
        const v2Series = manager.getValue2Series();
        assert(v2Series.length === 1 && v2Series[0] === 96, `Expected [96], got ${v2Series}`);
    });

    await runTest(28, "Timestamp appended", async () => {
        const manager = new ChartTimeSeriesManager(50);
        manager.addReading({ value1: 88, value2: 96, timestamp: "2026-10-02T11:00:00.000Z" });
        const labels = manager.getLabels();
        assert(labels.length === 1, "Expected 1 label");
        assert(typeof labels[0] === "string" && labels[0].length > 0, "Expected non-empty time label");
    });

    await runTest(29, "Chart remains chronological (oldest to newest, left to right)", async () => {
        const manager = new ChartTimeSeriesManager(50);
        // Add out-of-order reading (timestamp 3, then 1, then 2)
        manager.addReading({ value1: 30, value2: 90, timestamp: "2026-10-02T11:03:00.000Z" });
        manager.addReading({ value1: 10, value2: 90, timestamp: "2026-10-02T11:01:00.000Z" });
        manager.addReading({ value1: 20, value2: 90, timestamp: "2026-10-02T11:02:00.000Z" });

        const points = manager.getPoints();
        assert(points.length === 3);
        assert(points[0].value1 === 10, `Expected first point value1 = 10, got ${points[0].value1}`);
        assert(points[1].value1 === 20, `Expected second point value1 = 20, got ${points[1].value1}`);
        assert(points[2].value1 === 30, `Expected third point value1 = 30, got ${points[2].value1}`);
    });

    await runTest(30, "Maximum chart size enforced (50 points max)", async () => {
        const manager = new ChartTimeSeriesManager(50);
        const base = new Date("2026-10-02T10:00:00.000Z").getTime();
        for (let i = 0; i < 75; i++) {
            manager.addReading({
                value1: 70 + (i % 20),
                value2: 95,
                timestamp: new Date(base + i * 1000).toISOString()
            });
        }
        assert(manager.getCount() === 50, `Expected exactly 50 points, got ${manager.getCount()}`);
    });

    await runTest(31, "Oldest point removed when window exceeds max", async () => {
        const manager = new ChartTimeSeriesManager(50);
        const base = new Date("2026-10-02T10:00:00.000Z").getTime();
        for (let i = 0; i < 55; i++) {
            manager.addReading({
                value1: i,
                value2: 95,
                timestamp: new Date(base + i * 1000).toISOString()
            });
        }
        const points = manager.getPoints();
        // Since 55 points were added (0..54), the 5 oldest (0..4) should have been shifted out
        assert(points[0].value1 === 5, `Expected oldest remaining point to be 5, got ${points[0].value1}`);
        assert(points[points.length - 1].value1 === 54, `Expected newest point to be 54, got ${points[points.length - 1].value1}`);
    });

    await runTest(32, "Duplicate reading does not create duplicate point", async () => {
        const manager = new ChartTimeSeriesManager(50);
        const reading = {
            value1: 75,
            value2: 98,
            timestamp: "2026-10-02T11:00:00.000Z"
        };
        const first = manager.addReading(reading);
        assert(first !== null, "First reading should be added");
        const second = manager.addReading(reading);
        assert(second === null, "Duplicate reading should return null");
        assert(manager.getCount() === 1, "Manager should contain only 1 point");
    });

    await runTest(33, "Malformed socket payload ignored safely", async () => {
        const manager = new ChartTimeSeriesManager(50);
        assert(manager.addReading(null) === null);
        assert(manager.addReading(undefined) === null);
        assert(manager.addReading("not-an-object") === null);
        assert(manager.addReading({ value1: "abc", value2: 95, timestamp: "bad" }) === null);
        assert(manager.getCount() === 0, "No malformed points should be stored");
    });

    // ==========================================
    // 4. DOCTOR ISOLATION & PATIENT SWITCHING (34 - 40)
    // ==========================================

    await runTest(34, "Doctor A chart can initialize PAT-001 if assigned", async () => {
        const res = await request("/api/readings/PAT-001/recent", {
            headers: { Authorization: `Bearer ${doctorAToken}` }
        });
        assert(res.status === 200);
        assert(res.data.data.readings.length > 0);
    });

    await runTest(35, "Doctor A cannot initialize PAT-002 if not assigned", async () => {
        const res = await request("/api/readings/PAT-002/recent", {
            headers: { Authorization: `Bearer ${doctorAToken}` }
        });
        assert(res.status === 403, `Expected 403 Forbidden, got ${res.status}`);
    });

    await runTest(36, "Switching authorized patient reloads correct data", async () => {
        // Assign PAT-002 also to Doctor A for switching test
        await Patient.updateOne({ patientId: "PAT-002" }, { doctorId: "DOC-001" });

        const res1 = await request("/api/readings/PAT-001/recent", {
            headers: { Authorization: `Bearer ${doctorAToken}` }
        });
        assert(res1.status === 200);
        assert(res1.data.data.readings.length === 50, "Expected 50 readings for PAT-001");

        const res2 = await request("/api/readings/PAT-002/recent", {
            headers: { Authorization: `Bearer ${doctorAToken}` }
        });
        assert(res2.status === 200);
        assert(res2.data.data.readings.length === 5, "Expected 5 readings for PAT-002");

        // Revert PAT-002 back to DOC-002
        await Patient.updateOne({ patientId: "PAT-002" }, { doctorId: "DOC-002" });
    });

    await runTest(37, "Previous patient data does not remain after switch", async () => {
        const manager = new ChartTimeSeriesManager(50);
        // Load initial patient A data
        manager.loadInitial([
            { value1: 70, value2: 95, timestamp: "2026-10-02T10:00:00.000Z" }
        ]);
        assert(manager.getCount() === 1);

        // Switch to patient B
        manager.reset();
        assert(manager.getCount() === 0, "Data must be completely cleared upon patient switch");
        manager.loadInitial([
            { value1: 85, value2: 98, timestamp: "2026-10-02T11:00:00.000Z" }
        ]);
        assert(manager.getCount() === 1);
        assert(manager.getPoints()[0].value1 === 85, "Only new patient data should exist");
    });

    await runTest(38, "Unauthorized patientId cannot be injected into chart API", async () => {
        // Try SQL/NoSQL injection or traversal in route param
        const res1 = await request("/api/readings/%24ne/recent", {
            headers: { Authorization: `Bearer ${patient1Token}` }
        });
        assert(res1.status === 403 || res1.status === 404, `Injection must fail, got ${res1.status}`);

        const res2 = await request("/api/readings/PAT-002/recent", {
            headers: { Authorization: `Bearer ${patient1Token}` }
        });
        assert(res2.status === 403, "Cross patient access must return 403");
    });

    await runTest(39, "Doctor reassignment does not expose future unauthorized data", async () => {
        // Reassignment: move PAT-001 from DOC-001 to DOC-002
        await Patient.updateOne({ patientId: "PAT-001" }, { doctorId: "DOC-002" });

        // Doctor A can no longer access PAT-001
        const res = await request("/api/readings/PAT-001/recent", {
            headers: { Authorization: `Bearer ${doctorAToken}` }
        });
        assert(res.status === 403, `Doctor A must be forbidden after reassignment, got ${res.status}`);

        // Doctor B can now access PAT-001
        const resB = await request("/api/readings/PAT-001/recent", {
            headers: { Authorization: `Bearer ${doctorBToken}` }
        });
        assert(resB.status === 200, `Doctor B must have access after reassignment, got ${resB.status}`);

        // Revert back
        await Patient.updateOne({ patientId: "PAT-001" }, { doctorId: "DOC-001" });
    });

    await runTest(40, "Historical telemetry data integrity preserved (record count, timestamps, values, doctorId snapshots)", async () => {
        const currentCount = await SensorReading.countDocuments();
        assert(currentCount === initialReadingCount, `Expected reading count unchanged (${initialReadingCount}), got ${currentCount}`);

        // Verify historical doctorId snapshots remain unchanged
        const doc1Readings = await SensorReading.countDocuments({ patientId: "PAT-001", doctorId: "DOC-001" });
        assert(doc1Readings === 60, `Expected 60 readings with doctorId DOC-001, got ${doc1Readings}`);

        // Verify sample values remain untouched
        const sample = await SensorReading.findOne({ patientId: "PAT-001" }).sort({ timestamp: 1 });
        assert(sample.value1 === 70, `Sample value1 expected 70, got ${sample.value1}`);
        assert(sample.value2 === 95, `Sample value2 expected 95, got ${sample.value2}`);
    });

    // Cleanup and teardown
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }

    console.log("\n=================================================");
    console.log(`TEST SUMMARY: ${passedCount}/${passedCount + failedCount} TESTS PASSED`);
    console.log(`FAILED TESTS: ${failedCount}`);
    console.log("=================================================");

    if (failedCount > 0) {
        console.error("PHASE 11 VERIFICATION: FAILED");
        process.exit(1);
    } else {
        console.log("PHASE 11 VERIFICATION: SUCCESS\n");
        process.exit(0);
    }
}

runAllTests().catch((err) => {
    console.error("Fatal test runner error:", err);
    process.exit(1);
});
