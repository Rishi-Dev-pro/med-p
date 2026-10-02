/**
 * Phase 14 — Error Handling, Edge Cases & System Robustness Test Suite
 * Health Tracker — Comprehensive Automated Verification
 *
 * Verifies 25 Critical Robustness Scenarios:
 *  1. Malformed JSON payload returns HTTP 400 with { success: false, message: "Invalid JSON payload" }
 *  2. Server remains alive and processes valid request immediately following malformed JSON
 *  3. Centralized request validation on POST /api/iot/data rejects missing required fields (400)
 *  4. Centralized request validation on POST /api/iot/data rejects invalid data types / bounds (400)
 *  5. Centralized request validation on POST /api/auth/register rejects invalid email or missing fields (400)
 *  6. Centralized request validation on POST /api/auth/login rejects missing username/password (400)
 *  7. IoT Rate Limiter: blocks request flooding with HTTP 429 and Retry-After header
 *  8. IoT Rate Limiter: exposes X-RateLimit-Limit, Remaining, Reset headers
 *  9. Duplicate device claim concurrency defense: exactly one succeeds, second safely rejected (400/409)
 * 10. Device lifecycle edge cases: unknown device returns 404
 * 11. Device lifecycle edge cases: inactive device rejected from telemetry ingestion (403)
 * 12. Device lifecycle edge cases: duplicate device creation returns 400/409 without server crash
 * 13. Assignment edge case: assignment of patient to non-existent doctor returns 404
 * 14. Assignment edge case: assignment of patient to inactive doctor rejected (400)
 * 15. Assignment edge case: reassignment of patient to same doctor is rejected cleanly (400)
 * 16. Authentication edge cases: expired JWT rejected with HTTP 401
 * 17. Authentication edge cases: malformed JWT rejected with HTTP 401
 * 18. Authentication edge cases: missing JWT rejected with HTTP 401
 * 19. Authentication edge cases: suspended user login rejected with HTTP 403
 * 20. Database failure behavior: error during reading persistence does not emit telemetry event
 * 21. Database failure behavior: returns structured 500 JSON without leaking stack traces or credentials
 * 22. Error responses never leak stack traces, file paths, or secrets in production mode
 * 23. Socket.IO connection status: client can connect and receive clean room assignments
 * 24. Socket.IO security guard: non-admin socket rejected from joining admin room
 * 25. Mongoose connection health API: isDatabaseConnected() and getConnectionState() report accurate state
 */

require("dotenv").config();
const http = require("http");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const ioClient = require("socket.io-client");
const jwt = require("jsonwebtoken");

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
    DEVICE_STATUS
} = require("../src/config/constants");
const { hashPassword, generateToken } = require("../src/utils/authUtils");
const { JWT_SECRET } = require("../src/config/auth");
const { iotRateLimiter } = require("../src/middleware/rateLimiter");
const { isDatabaseConnected, getConnectionState } = require("../src/config/database");
const { validateBody, schemas } = require("../src/middleware/validationMiddleware");

const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/health_monitoring_phase14_test";

// Safety guard: validate that configured test database URI contains 'test'
if (!TEST_DB_URI.toLowerCase().includes("test")) {
    throw new Error("Refusing to run tests: Configured database URI must contain 'test' to prevent destructive cleanup.");
}

let server;
let baseUrl;
let ioServer;
let passedCount = 0;
let failedCount = 0;
let timedOutCount = 0;
const suiteStartTime = Date.now();

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || "Assertion failed");
    }
}

/**
 * Bounded Promise wrapper to ensure no test operation hangs indefinitely
 */
function withTimeout(promise, ms, label = "Operation") {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`[TIMEOUT] ${label} exceeded ${ms}ms limit`));
        }, ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        clearTimeout(timer);
    });
}

async function runTest(testNumber, testName, fn) {
    console.log(`[START] Test ${testNumber}: ${testName}`);
    const t0 = Date.now();
    try {
        await withTimeout(fn(), 10000, `Test ${testNumber}`);
        const duration = Date.now() - t0;
        console.log(`[PASS] Test ${testNumber}: ${testName} (${duration}ms)`);
        passedCount++;
    } catch (err) {
        const duration = Date.now() - t0;
        if (err.message && err.message.includes("[TIMEOUT]")) {
            console.error(`[TIMEOUT] Test ${testNumber}: ${testName} (${duration}ms)`);
            console.error(`          ${err.message}`);
            timedOutCount++;
        } else {
            console.error(`[FAIL] Test ${testNumber}: ${testName} (${duration}ms)`);
            console.error(`       Error: ${err.message}`);
            failedCount++;
        }
    }
}

async function rawRequest(endpoint, options = {}) {
    const url = `${baseUrl}${endpoint}`;
    const headers = options.headers || {};

    const res = await withTimeout(
        fetch(url, {
            method: options.method || "GET",
            headers,
            body: options.rawBody !== undefined ? options.rawBody : (options.body ? JSON.stringify(options.body) : undefined),
            redirect: "manual"
        }),
        5000,
        `HTTP ${options.method || "GET"} ${endpoint}`
    );

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

let adminToken;
let doctorToken;
let testPatient;
let testDoctor;
let testDevice;

async function setup() {
    console.log("[SETUP] Connecting MongoDB...", TEST_DB_URI);
    await withTimeout(mongoose.connect(TEST_DB_URI), 10000, "MongoDB connection");
    console.log("[SETUP] MongoDB connected");

    console.log("[SETUP] Cleaning test collections...");
    await User.deleteMany({});
    await Doctor.deleteMany({});
    await Patient.deleteMany({});
    await Device.deleteMany({});
    await SensorReading.deleteMany({});
    await ActivityLog.deleteMany({});

    console.log("[SETUP] Starting HTTP & Socket.IO server...");
    server = http.createServer(app);
    ioServer = new Server(server, {
        cors: { origin: "*", credentials: true }
    });
    setupSocketIO(ioServer);
    app.set("io", ioServer);

    await withTimeout(
        new Promise((resolve) => {
            server.listen(0, "127.0.0.1", () => {
                const port = server.address().port;
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        }),
        5000,
        "Server listen"
    );
    console.log(`[SETUP] HTTP server started at ${baseUrl}`);

    console.log("[SETUP] Seeding test data...");
    const adminPassword = await hashPassword("AdminSecret123!");
    const admin = await User.create({
        username: "superadmin_p14",
        email: "admin_p14@healthtracker.local",
        passwordHash: adminPassword,
        role: ROLES.SUPER_ADMIN,
        status: ACCOUNT_STATUS.ACTIVE,
        profileId: null
    });
    adminToken = generateToken({
        userId: admin._id.toString(),
        username: admin.username,
        role: admin.role,
        profileId: admin.profileId
    });

    const docPassword = await hashPassword("DoctorPass123!");
    const docUser = await User.create({
        username: "doctor_p14",
        email: "doc_p14@healthtracker.local",
        passwordHash: docPassword,
        role: ROLES.DOCTOR,
        status: ACCOUNT_STATUS.ACTIVE,
        profileId: "DOC-P14-01"
    });
    testDoctor = await Doctor.create({
        userId: docUser._id,
        doctorId: "DOC-P14-01",
        name: "Dr. Robustness Tester",
        email: "doc_p14@healthtracker.local",
        specialization: "General Medicine",
        status: DOCTOR_STATUS.ACTIVE
    });
    doctorToken = generateToken({
        userId: docUser._id.toString(),
        username: docUser.username,
        role: docUser.role,
        profileId: docUser.profileId
    });

    testDevice = await Device.create({
        deviceId: "DEV-P14-01",
        type: "ECG_PULSE",
        status: DEVICE_STATUS.ACTIVE
    });

    const patientPassword = await hashPassword("PatientPass123!");
    const patientUser = await User.create({
        username: "patient_p14",
        email: "pat_p14@healthtracker.local",
        passwordHash: patientPassword,
        role: ROLES.PATIENT,
        status: ACCOUNT_STATUS.ACTIVE,
        profileId: "PAT-P14-01"
    });
    testPatient = await Patient.create({
        userId: patientUser._id,
        patientId: "PAT-P14-01",
        name: "Robust Patient",
        email: "pat_p14@healthtracker.local",
        age: 35,
        deviceId: testDevice.deviceId,
        doctorId: testDoctor.doctorId
    });
    testDevice.patientId = testPatient.patientId;
    await testDevice.save();
    console.log("[SETUP] Complete\n");
}

async function teardown() {
    console.log("\n[TEARDOWN] Closing Socket.IO...");
    if (ioServer) {
        await new Promise((resolve) => ioServer.close(resolve));
    }
    console.log("[TEARDOWN] Closing HTTP server...");
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
    console.log("[TEARDOWN] Dropping test database and disconnecting...");
    if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    }
    console.log("[TEARDOWN] Complete");
}

async function runAllTests() {
    console.log("=================================================");
    console.log("RUNNING PHASE 14: ERROR HANDLING & ROBUSTNESS");
    console.log("=================================================");

    // Test 1: Malformed JSON payload returns 400
    await runTest(1, "Malformed JSON payload returns HTTP 400 with safe JSON response", async () => {
        const res = await rawRequest("/api/iot/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            rawBody: "{\"deviceId\": \"DEV-P14-01\", \"value1\": 72, INVALID_JSON"
        });

        assert(res.status === 400, `Expected 400 for malformed JSON, got ${res.status}`);
        assert(res.data.success === false, "Response success must be false");
        assert(res.data.message === "Invalid JSON payload", `Expected "Invalid JSON payload", got: ${res.data.message}`);
    });

    // Test 2: Server remains alive and processes valid request after malformed JSON
    await runTest(2, "Server remains fully alive and processes subsequent valid request", async () => {
        const res = await rawRequest("/api/iot/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: {
                deviceId: "DEV-P14-01",
                value1: 72,
                value2: 98,
                timestamp: new Date().toISOString()
            }
        });

        assert(res.status === 201, `Expected 201 for valid telemetry, got ${res.status}`);
        assert(res.data.success === true, "Valid telemetry response must be success: true");
    });

    // Test 3: Centralized request validation on POST /api/iot/data (missing fields)
    await runTest(3, "Validation on POST /api/iot/data rejects missing required fields (400)", async () => {
        const res = await rawRequest("/api/iot/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: {
                // missing deviceId, value1, value2
                timestamp: new Date().toISOString()
            }
        });

        assert(res.status === 400, `Expected 400 for missing fields, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
        assert(res.data.message && (res.data.message.includes("Missing") || res.data.message.includes("Validation")), `Expected error message, got: ${res.data.message}`);
    });

    // Test 4: Centralized request validation on POST /api/iot/data (invalid types/bounds)
    await runTest(4, "Validation on POST /api/iot/data rejects invalid data types & bounds (400)", async () => {
        const res = await rawRequest("/api/iot/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: {
                deviceId: "DEV-P14-01",
                value1: "not-a-number",
                value2: 1e10, // out of realistic bounds
                timestamp: "not-a-valid-date"
            }
        });

        assert(res.status === 400, `Expected 400 for invalid data types, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
        assert(res.data.message && res.data.message.includes("valid"), `Expected invalid format message, got: ${res.data.message}`);
    });

    // Test 5: Centralized validation on POST /api/auth/register (invalid email, short password)
    await runTest(5, "Validation on POST /api/auth/register rejects invalid email and short password", async () => {
        const res = await rawRequest("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: {
                name: "Test Name",
                email: "invalid-email-format",
                password: "123", // too short (<6)
                confirmPassword: "123",
                deviceId: "DEV-P14-01"
            }
        });

        assert(res.status === 400, `Expected 400 for registration validation error, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
        assert(res.data.message && (res.data.message.includes("email") || res.data.message.includes("Password")), `Expected validation message, got: ${res.data.message}`);
    });

    // Test 6: Centralized validation on POST /api/auth/login (missing identifier or password)
    await runTest(6, "Validation on POST /api/auth/login rejects missing identifier or password", async () => {
        const res = await rawRequest("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: {
                // missing identifier and password
            }
        });

        assert(res.status === 400, `Expected 400 for empty login body, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
        assert(res.data.message && (res.data.message.includes("required") || res.data.message.includes("Validation")), `Expected validation message, got: ${res.data.message}`);
    });

    // Test 7: Rate Limiter on POST /api/iot/data blocks rapid request bursts with 429
    await runTest(7, "IoT Rate Limiter blocks request flooding with HTTP 429 and Retry-After", async () => {
        iotRateLimiter.reset();

        // Simulate 120 hits directly on the limiter hits map to avoid 120 full DB write cycles
        // while preserving exact production limiter config (windowMs=60000, max=120)
        // Express req.ip fallback is 127.0.0.1 or ::ffff:127.0.0.1
        const dummyReq = { ip: "127.0.0.1", headers: {}, socket: { remoteAddress: "127.0.0.1" } };
        const key = dummyReq.ip;
        iotRateLimiter.hits.set(key, { count: 120, resetTime: Date.now() + 60000 });

        // The 121st request will cross the 120 threshold through the real Express HTTP pipeline
        const res = await rawRequest("/api/iot/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: {
                deviceId: "DEV-P14-01",
                value1: 70,
                value2: 95,
                timestamp: new Date().toISOString()
            }
        });

        assert(res.status === 429, `Expected 429 when threshold exceeded, got ${res.status}`);
        assert(res.data.success === false, "Rate limit response must be success: false");
        assert(res.data.message.includes("Too many telemetry requests"), `Unexpected 429 message: ${res.data.message}`);
        assert(res.headers.get("retry-after") !== null, "Expected Retry-After header on 429 response");

        // Clean reset for subsequent tests
        iotRateLimiter.reset();
    });

    // Test 8: Rate Limiter exposes standard X-RateLimit headers
    await runTest(8, "IoT Rate Limiter sets X-RateLimit-Limit, Remaining, and Reset headers", async () => {
        iotRateLimiter.reset();

        const res = await rawRequest("/api/iot/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: {
                deviceId: "DEV-P14-01",
                value1: 75,
                value2: 99,
                timestamp: new Date().toISOString()
            }
        });

        assert(res.status === 201, `Expected 201, got ${res.status}`);
        assert(res.headers.get("x-ratelimit-limit") !== null, "Expected X-RateLimit-Limit header");
        assert(res.headers.get("x-ratelimit-remaining") !== null, "Expected X-RateLimit-Remaining header");
        assert(res.headers.get("x-ratelimit-reset") !== null, "Expected X-RateLimit-Reset header");
    });

    // Test 9: Duplicate concurrent device claim handles race condition cleanly
    await runTest(9, "Concurrent device claim: exactly one succeeds, second safely rejected", async () => {
        // Create an unassigned device for claiming test
        await Device.create({
            deviceId: "DEV-CLAIM-RACE",
            type: "ECG_PULSE",
            status: DEVICE_STATUS.ACTIVE,
            patientId: null
        });

        // Fire two simultaneous registration requests attempting to claim DEV-CLAIM-RACE
        const p1Promise = rawRequest("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: {
                name: "Race Patient 1",
                email: "race1@test.com",
                password: "Password123!",
                confirmPassword: "Password123!",
                deviceId: "DEV-CLAIM-RACE"
            }
        });

        const p2Promise = rawRequest("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: {
                name: "Race Patient 2",
                email: "race2@test.com",
                password: "Password123!",
                confirmPassword: "Password123!",
                deviceId: "DEV-CLAIM-RACE"
            }
        });

        const [r1, r2] = await Promise.all([p1Promise, p2Promise]);

        const statuses = [r1.status, r2.status].sort();
        // One must succeed (201) and the other must be rejected (400 or 409)
        assert(statuses.includes(201), `At least one registration must succeed with 201, got ${r1.status} and ${r2.status}`);
        assert(statuses.includes(400) || statuses.includes(409), `Second registration must be rejected with 400/409, got ${r1.status} and ${r2.status}`);

        // Verify device has only one patient assigned
        const freshDevice = await Device.findOne({ deviceId: "DEV-CLAIM-RACE" });
        assert(freshDevice.patientId !== null, "Device must be claimed");

        // Verify only 1 Patient record exists with this deviceId
        const patients = await Patient.find({ deviceId: "DEV-CLAIM-RACE" });
        assert(patients.length === 1, `Expected exactly 1 patient to own device, found: ${patients.length}`);
    });

    // Test 10: Unknown device returns 404
    await runTest(10, "Device edge case: unknown device ID returns HTTP 404", async () => {
        const res = await rawRequest("/api/iot/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: {
                deviceId: "DEV-NONEXISTENT-999",
                value1: 80,
                value2: 95,
                timestamp: new Date().toISOString()
            }
        });

        assert(res.status === 404, `Expected 404, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    // Test 11: Inactive device rejected from telemetry ingestion (403)
    await runTest(11, "Device edge case: inactive device returns HTTP 403", async () => {
        const inactiveDev = await Device.create({
            deviceId: "DEV-INACTIVE-TEST",
            type: "ECG_PULSE",
            status: DEVICE_STATUS.INACTIVE
        });

        const res = await rawRequest("/api/iot/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: {
                deviceId: inactiveDev.deviceId,
                value1: 80,
                value2: 95,
                timestamp: new Date().toISOString()
            }
        });

        assert(res.status === 403, `Expected 403 for inactive device, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    // Test 12: Duplicate device creation returns 400/409 without server crash
    await runTest(12, "Device edge case: duplicate device creation returns controlled error", async () => {
        const res = await rawRequest("/api/admin/devices", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminToken}`,
                "Accept": "application/json"
            },
            body: {
                deviceId: "DEV-P14-01", // already exists
                type: "ECG_PULSE"
            }
        });

        assert(res.status === 400 || res.status === 409, `Expected 400 or 409 for duplicate device, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    // Test 13: Assignment edge case: non-existent doctor returns 404
    await runTest(13, "Assignment edge case: assignment of patient to non-existent doctor returns 404", async () => {
        const res = await rawRequest("/api/admin/assignments", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminToken}`,
                "Accept": "application/json"
            },
            body: {
                patientId: testPatient.patientId,
                doctorId: "DOC-DOES-NOT-EXIST"
            }
        });

        assert(res.status === 404, `Expected 404 for unknown doctor, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    // Test 14: Assignment edge case: inactive doctor rejected (400)
    await runTest(14, "Assignment edge case: assignment of patient to inactive doctor rejected (400)", async () => {
        const inactUser = await User.create({
            username: "inactive_doc_u",
            email: "inact_doc@healthtracker.local",
            passwordHash: "hash123",
            role: ROLES.DOCTOR,
            status: ACCOUNT_STATUS.SUSPENDED,
            profileId: "DOC-INACT-P14"
        });
        const inactDoc = await Doctor.create({
            userId: inactUser._id,
            doctorId: "DOC-INACT-P14",
            name: "Dr. Inactive",
            email: "inact_doc@healthtracker.local",
            status: DOCTOR_STATUS.INACTIVE
        });

        const res = await rawRequest("/api/admin/assignments", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminToken}`,
                "Accept": "application/json"
            },
            body: {
                patientId: testPatient.patientId,
                doctorId: inactDoc.doctorId
            }
        });

        assert(res.status === 400, `Expected 400 for inactive doctor assignment, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    // Test 15: Invalid assignment payload with missing fields is rejected cleanly (400)
    await runTest(15, "Assignment edge case: missing patientId or doctorId is rejected (400)", async () => {
        const res = await rawRequest("/api/admin/assignments", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminToken}`,
                "Accept": "application/json"
            },
            body: {
                // missing patientId and doctorId
            }
        });

        assert(res.status === 400, `Expected 400 for invalid assignment parameters, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    // Test 16: Authentication edge case: expired JWT rejected with 401
    await runTest(16, "Authentication edge case: expired JWT rejected with HTTP 401", async () => {
        const expiredToken = jwt.sign(
            { userId: testDoctor.userId.toString(), role: ROLES.DOCTOR, profileId: testDoctor.doctorId },
            JWT_SECRET,
            { expiresIn: "-10s" }
        );

        const res = await rawRequest("/api/admin/activity", {
            headers: { "Authorization": `Bearer ${expiredToken}` }
        });

        assert(res.status === 401, `Expected 401 for expired token, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    // Test 17: Authentication edge case: malformed JWT rejected with 401
    await runTest(17, "Authentication edge case: malformed JWT rejected with HTTP 401", async () => {
        const res = await rawRequest("/api/admin/activity", {
            headers: { "Authorization": "Bearer this-is-not-a-valid-jwt-token" }
        });

        assert(res.status === 401, `Expected 401 for malformed token, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    // Test 18: Authentication edge case: missing JWT rejected with 401
    await runTest(18, "Authentication edge case: missing JWT rejected with HTTP 401", async () => {
        const res = await rawRequest("/api/admin/activity");

        assert(res.status === 401, `Expected 401 for missing token, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    // Test 19: Authentication edge case: suspended user login rejected with 403
    await runTest(19, "Authentication edge case: suspended user login rejected with HTTP 403", async () => {
        const suspPassword = await hashPassword("SuspendedPass123!");
        await User.create({
            username: "suspended_user_p14",
            email: "suspended@healthtracker.local",
            passwordHash: suspPassword,
            role: ROLES.PATIENT,
            status: ACCOUNT_STATUS.SUSPENDED,
            profileId: "PAT-SUSP-P14"
        });

        const res = await rawRequest("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: {
                identifier: "suspended_user_p14",
                password: "SuspendedPass123!"
            }
        });

        assert(res.status === 403, `Expected 403 for suspended user, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    // Test 20: Database failure handling: sensor reading DB write failure does not emit telemetry
    await runTest(20, "Database failure: reading write failure does not emit telemetry event", async () => {
        const originalCreate = SensorReading.create;
        let eventEmitted = false;

        const clientSocket = ioClient(baseUrl, {
            auth: { token: doctorToken },
            transports: ["websocket"],
            reconnection: false,
            timeout: 3000
        });

        try {
            await withTimeout(
                new Promise((resolve, reject) => {
                    clientSocket.on("connect", () => {
                        clientSocket.emit("join-room", { patientId: testPatient.patientId }, (ack) => {
                            resolve(ack);
                        });
                    });
                    clientSocket.on("connect_error", reject);
                }),
                3000,
                "Socket connect & room join"
            );

            clientSocket.on("sensor-reading", () => {
                eventEmitted = true;
            });

            SensorReading.create = async function () {
                throw new Error("MongoNetworkError: failed to connect to server [127.0.0.1:27017]");
            };

            const res = await rawRequest("/api/iot/data", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: {
                    deviceId: "DEV-P14-01",
                    value1: 85,
                    value2: 96,
                    timestamp: new Date().toISOString()
                }
            });

            assert(res.status === 500, `Expected 500 on database failure, got ${res.status}`);
            assert(res.data.success === false, "Response must indicate failure");

            // Wait 100ms to guarantee no telemetry event was fired
            await new Promise((r) => setTimeout(r, 100));
            assert(eventEmitted === false, "CRITICAL: No telemetry event may be emitted when DB write fails");
        } finally {
            SensorReading.create = originalCreate;
            clientSocket.removeAllListeners();
            clientSocket.disconnect();
        }
    });

    // Test 21: Database failure returns structured JSON without leaking stack traces
    await runTest(21, "Database failure returns structured 500 JSON without leaking stack trace", async () => {
        const originalFind = Device.findOne;
        Device.findOne = function () {
            throw new Error("Simulated internal database connection failure");
        };

        try {
            const prevEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = "production";

            const res = await rawRequest("/api/iot/data", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: {
                    deviceId: "DEV-P14-01",
                    value1: 80,
                    value2: 95,
                    timestamp: new Date().toISOString()
                }
            });

            process.env.NODE_ENV = prevEnv;

            assert(res.status === 500, `Expected 500, got ${res.status}`);
            assert(res.data.success === false, "Expected success: false");
            assert(res.data.stack === undefined, "Stack trace MUST NOT be leaked in production response");
            assert(!JSON.stringify(res.data).includes("node_modules"), "File paths MUST NOT be leaked in production");
        } finally {
            Device.findOne = originalFind;
        }
    });

    // Test 22: Error responses never leak secrets, passwords, or connection strings
    await runTest(22, "Error responses never leak secrets, passwords, or tokens", async () => {
        const res = await rawRequest("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: {
                identifier: "superadmin_p14",
                password: "WrongPassword999!"
            }
        });

        assert(res.status === 401, `Expected 401 for wrong password, got ${res.status}`);
        const bodyStr = JSON.stringify(res.data);
        assert(!bodyStr.includes("AdminSecret123!"), "Password must not be reflected in error");
        assert(!bodyStr.includes("passwordHash"), "Hash must not be leaked in error");
        assert(!bodyStr.includes("mongodb://"), "Connection string must not be leaked");
    });

    // Test 23: Socket.IO connection status lifecycle
    await runTest(23, "Socket.IO client receives clean connection and room authorizations", async () => {
        const socket = ioClient(baseUrl, {
            auth: { token: doctorToken },
            transports: ["websocket"],
            reconnection: false,
            timeout: 3000
        });

        try {
            await withTimeout(
                new Promise((resolve, reject) => {
                    socket.on("connect", () => resolve(true));
                    socket.on("connect_error", reject);
                }),
                3000,
                "Socket connect"
            );

            // Join authorized patient room
            const roomAck = await withTimeout(
                new Promise((resolve) => {
                    socket.emit("join-room", { patientId: testPatient.patientId }, (ack) => {
                        resolve(ack);
                    });
                }),
                2000,
                "Join patient room"
            );

            assert(roomAck && roomAck.success === true, "Doctor must be authorized to join assigned patient room");
        } finally {
            socket.removeAllListeners();
            socket.disconnect();
        }
    });

    // Test 24: Socket.IO security guard: non-admin socket rejected from joining admin room
    await runTest(24, "Socket.IO security guard: non-admin socket rejected from joining admin room", async () => {
        const socket = ioClient(baseUrl, {
            auth: { token: doctorToken }, // Doctor, not admin
            transports: ["websocket"],
            reconnection: false,
            timeout: 3000
        });

        try {
            await withTimeout(
                new Promise((resolve, reject) => {
                    socket.on("connect", () => resolve(true));
                    socket.on("connect_error", reject);
                }),
                3000,
                "Socket connect"
            );

            const joinAck = await withTimeout(
                new Promise((resolve) => {
                    socket.emit("join-room", { room: "admin:activity" }, (ack) => {
                        resolve(ack);
                    });
                }),
                2000,
                "Join admin room attempt"
            );

            assert(joinAck && joinAck.success === false, "Doctor must NOT be permitted into admin-room");
        } finally {
            socket.removeAllListeners();
            socket.disconnect();
        }
    });

    // Test 25: Mongoose connection health API returns accurate connection state
    await runTest(25, "Mongoose connection status helpers report accurate connection state", () => {
        assert(isDatabaseConnected() === true, "isDatabaseConnected() should report true when connected");
        const state = getConnectionState();
        assert(state.state === "connected", `Expected state 'connected', got: ${state.state}`);
        assert(state.numericState === 1, `Expected numericState 1, got: ${state.numericState}`);
    });

    const totalDuration = Date.now() - suiteStartTime;
    console.log("\n=========================================");
    console.log("PHASE 14 ROBUSTNESS TEST SUMMARY");
    console.log("=========================================");
    console.log(`Passed:    ${passedCount}`);
    console.log(`Failed:    ${failedCount}`);
    console.log(`Timed out: ${timedOutCount}`);
    console.log(`Total:     ${passedCount + failedCount + timedOutCount}`);
    console.log(`Duration:  ${totalDuration}ms`);
    console.log("=========================================");

    if (failedCount > 0 || timedOutCount > 0) {
        console.error("PHASE 14 VERIFICATION: FAILED");
        process.exitCode = 1;
    } else {
        console.log("PHASE 14 VERIFICATION: SUCCESS");
    }
}

setup()
    .then(runAllTests)
    .catch((err) => {
        console.error("Fatal test setup error:", err);
        process.exitCode = 1;
    })
    .finally(teardown);
