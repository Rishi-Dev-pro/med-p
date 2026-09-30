/**
 * Phase 3: Role-Based Authorization & Socket.IO Authentication Test Suite
 * Health Tracker — Comprehensive Automated Verification
 *
 * Covers all 24 required test cases:
 *  1. Missing JWT → 401
 *  2. Invalid JWT → 401
 *  3. Expired JWT → 401
 *  4. Suspended user → denied (403)
 *  5. PATIENT role accepted by patient-only route
 *  6. DOCTOR role rejected from patient-only route (or non-assigned patient route)
 *  7. SUPER_ADMIN role accepted by admin-protected route
 *  8. PATIENT cannot access another patient's data
 *  9. PATIENT can access own data
 * 10. DOCTOR can access assigned patient
 * 11. DOCTOR cannot access unassigned patient
 * 12. Client-supplied role cannot override JWT role
 * 13. Client-supplied userId cannot override JWT identity
 * 14. Client-supplied patientId cannot bypass ownership
 * 15. Socket connection with valid JWT succeeds
 * 16. Socket connection without JWT fails
 * 17. Socket connection with invalid JWT fails
 * 18. Socket connection with suspended user fails
 * 19. Patient cannot join another patient's room
 * 20. Doctor cannot receive unassigned patient's realtime telemetry
 * 21. Patient receives own realtime telemetry
 * 22. Doctor receives assigned patient's realtime telemetry
 * 23. Historical doctorId remains unchanged
 * 24. Reassignment stops future telemetry for previous doctor
 */

require("dotenv").config();
const http = require("http");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const ioClient = require("socket.io-client");

const app = require("../src/app");
const User = require("../src/models/User");
const Patient = require("../src/models/Patient");
const Doctor = require("../src/models/Doctor");
const Device = require("../src/models/Device");
const SensorReading = require("../src/models/SensorReading");
const ActivityLog = require("../src/models/ActivityLog");
const { ROLES, ACCOUNT_STATUS, DEVICE_STATUS } = require("../src/config/constants");
const { hashPassword, generateToken } = require("../src/utils/authUtils");
const { JWT_SECRET } = require("../src/config/auth");
const { setupSocketIO } = require("../src/server");

const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/health_monitoring_phase3_test";

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

// HTTP request helper
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

// Socket helper for async connection
function connectSocket(options = {}) {
    return new Promise((resolve, reject) => {
        const socket = ioClient(socketUrl, {
            transports: ["websocket"],
            forceNew: true,
            reconnection: false,
            timeout: 3000,
            ...options
        });

        socket.on("connect", () => {
            resolve(socket);
        });

        socket.on("connect_error", (err) => {
            // resolve with error or socket so test can assert failure
            resolve({ error: err, socket });
        });
    });
}

async function main() {
    console.log("=================================================");
    console.log("RUNNING PHASE 3: RBAC & SOCKET.IO AUTH TEST SUITE");
    console.log("=================================================");

    // 1. Connect to test DB and reset collections
    await mongoose.connect(TEST_DB_URI);
    await User.deleteMany({});
    await Patient.deleteMany({});
    await Doctor.deleteMany({});
    await Device.deleteMany({});
    await SensorReading.deleteMany({});
    await ActivityLog.deleteMany({});

    // 2. Start HTTP & Socket.IO server
    server = http.createServer(app);
    ioServer = new Server(server, {
        cors: { origin: "*", credentials: true }
    });
    setupSocketIO(ioServer);
    app.set("io", ioServer);

    await new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            socketUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });

    // 3. Seed test principals
    const passwordHash = await hashPassword("SecurePassword123!");

    // Doctors
    const docUser1 = await User.create({
        username: "dr_alice",
        email: "alice@hospital.org",
        passwordHash,
        role: ROLES.DOCTOR,
        profileId: "DOC-001",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const doc1 = await Doctor.create({
        userId: docUser1._id,
        doctorId: "DOC-001",
        name: "Dr. Alice Smith",
        specialty: "Cardiology",
        email: "alice@hospital.org"
    });

    const docUser2 = await User.create({
        username: "dr_bob",
        email: "bob@hospital.org",
        passwordHash,
        role: ROLES.DOCTOR,
        profileId: "DOC-002",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const doc2 = await Doctor.create({
        userId: docUser2._id,
        doctorId: "DOC-002",
        name: "Dr. Bob Jones",
        specialty: "Neurology",
        email: "bob@hospital.org"
    });

    // Patients
    const patUser1 = await User.create({
        username: "pat_charlie",
        email: "charlie@patients.org",
        passwordHash,
        role: ROLES.PATIENT,
        profileId: "PAT-001",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const pat1 = await Patient.create({
        userId: patUser1._id,
        patientId: "PAT-001",
        name: "Charlie Brown",
        email: "charlie@patients.org",
        age: 45,
        gender: "male",
        doctorId: "DOC-001"
    });

    const patUser2 = await User.create({
        username: "pat_dana",
        email: "dana@patients.org",
        passwordHash,
        role: ROLES.PATIENT,
        profileId: "PAT-002",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const pat2 = await Patient.create({
        userId: patUser2._id,
        patientId: "PAT-002",
        name: "Dana White",
        email: "dana@patients.org",
        age: 32,
        gender: "female",
        doctorId: "DOC-002"
    });

    // Suspended Patient
    const suspendedUser = await User.create({
        username: "pat_suspended",
        email: "edward@patients.org",
        passwordHash,
        role: ROLES.PATIENT,
        profileId: "PAT-003",
        status: ACCOUNT_STATUS.SUSPENDED
    });
    const pat3 = await Patient.create({
        userId: suspendedUser._id,
        patientId: "PAT-003",
        name: "Edward Norton",
        email: "edward@patients.org",
        age: 50,
        gender: "male",
        doctorId: null
    });

    // Super Admin
    const adminUser = await User.create({
        username: "super_admin",
        email: "admin@healthtracker.org",
        passwordHash,
        role: ROLES.SUPER_ADMIN,
        profileId: null,
        status: ACCOUNT_STATUS.ACTIVE
    });

    // Active Devices
    await Device.create({
        deviceId: "DEV-001",
        patientId: "PAT-001",
        type: "ECG_PULSE",
        status: DEVICE_STATUS.ACTIVE
    });
    await Device.create({
        deviceId: "DEV-002",
        patientId: "PAT-002",
        type: "ECG_PULSE",
        status: DEVICE_STATUS.ACTIVE
    });

    // Pre-generate tokens
    const tokenPat1 = generateToken({ userId: patUser1._id.toString(), username: patUser1.username, role: patUser1.role, profileId: patUser1.profileId });
    const tokenPat2 = generateToken({ userId: patUser2._id.toString(), username: patUser2.username, role: patUser2.role, profileId: patUser2.profileId });
    const tokenDoc1 = generateToken({ userId: docUser1._id.toString(), username: docUser1.username, role: docUser1.role, profileId: docUser1.profileId });
    const tokenDoc2 = generateToken({ userId: docUser2._id.toString(), username: docUser2.username, role: docUser2.role, profileId: docUser2.profileId });
    const tokenAdmin = generateToken({ userId: adminUser._id.toString(), username: adminUser.username, role: adminUser.role, profileId: adminUser.profileId });
    const tokenSuspended = generateToken({ userId: suspendedUser._id.toString(), username: suspendedUser.username, role: suspendedUser.role, profileId: suspendedUser.profileId });

    // ==========================================
    // EXECUTE 24 TESTS
    // ==========================================

    // Test 1: Missing JWT → 401
    await runTest(1, "Missing JWT returns 401 on protected API route", async () => {
        const res = await request("/api/admin/status");
        assert(res.status === 401, `Expected 401, got ${res.status}`);
        assert(res.data.message === "Authentication required", "Expected auth required message");
    });

    // Test 2: Invalid JWT → 401
    await runTest(2, "Invalid JWT returns 401", async () => {
        const res = await request("/api/admin/status", {
            headers: { Authorization: "Bearer bogus.invalid.token" }
        });
        assert(res.status === 401, `Expected 401, got ${res.status}`);
    });

    // Test 3: Expired JWT → 401
    await runTest(3, "Expired JWT returns 401", async () => {
        const expiredToken = jwt.sign(
            { userId: patUser1._id.toString(), username: "pat_charlie", role: ROLES.PATIENT, profileId: "PAT-001" },
            JWT_SECRET,
            { expiresIn: "-1s" }
        );
        const res = await request("/patient/PAT-001", {
            headers: {
                Authorization: `Bearer ${expiredToken}`,
                Accept: "application/json"
            }
        });
        assert(res.status === 401, `Expected 401, got ${res.status}`);
    });

    // Test 4: Suspended user → denied (403)
    await runTest(4, "Suspended user token is denied with 403", async () => {
        const res = await request("/patient/PAT-003", {
            headers: {
                Authorization: `Bearer ${tokenSuspended}`,
                Accept: "application/json"
            }
        });
        assert(res.status === 403, `Expected 403, got ${res.status}`);
    });

    // Test 5: PATIENT role accepted by patient-only route
    await runTest(5, "PATIENT role accepted on own patient dashboard route", async () => {
        const res = await request("/patient/PAT-001", {
            headers: {
                Cookie: `token=${tokenPat1}`,
                Accept: "text/html"
            }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
    });

    // Test 6: DOCTOR role rejected from patient-only route (when not assigned)
    await runTest(6, "DOCTOR role rejected from unassigned patient route", async () => {
        // Doc2 is not assigned to PAT-001
        const res = await request("/patient/PAT-001", {
            headers: {
                Authorization: `Bearer ${tokenDoc2}`,
                Accept: "application/json"
            }
        });
        assert(res.status === 403, `Expected 403, got ${res.status}`);
    });

    // Test 7: SUPER_ADMIN role accepted by admin-protected route
    await runTest(7, "SUPER_ADMIN role accepted by admin-protected route", async () => {
        const res = await request("/api/admin/status", {
            headers: {
                Authorization: `Bearer ${tokenAdmin}`
            }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.admin.role === ROLES.SUPER_ADMIN, "Expected SUPER_ADMIN role in response");
    });

    // Test 8: PATIENT cannot access another patient's data
    await runTest(8, "PATIENT cannot access another patient's dashboard", async () => {
        // Charlie (PAT-001) tries to access Dana (PAT-002)
        const res = await request("/patient/PAT-002", {
            headers: {
                Authorization: `Bearer ${tokenPat1}`,
                Accept: "application/json"
            }
        });
        assert(res.status === 403, `Expected 403, got ${res.status}`);
    });

    // Test 9: PATIENT can access own data
    await runTest(9, "PATIENT can access own dashboard data", async () => {
        const res = await request("/patient/PAT-001", {
            headers: {
                Authorization: `Bearer ${tokenPat1}`
            }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
    });

    // Test 10: DOCTOR can access assigned patient
    await runTest(10, "DOCTOR can access assigned patient dashboard", async () => {
        // Doc1 (Dr. Alice) is assigned to PAT-001
        const res = await request("/patient/PAT-001", {
            headers: {
                Authorization: `Bearer ${tokenDoc1}`
            }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
    });

    // Test 11: DOCTOR cannot access unassigned patient
    await runTest(11, "DOCTOR cannot access unassigned patient dashboard", async () => {
        // Doc1 (Dr. Alice) is NOT assigned to PAT-002 (assigned to Doc2)
        const res = await request("/patient/PAT-002", {
            headers: {
                Authorization: `Bearer ${tokenDoc1}`,
                Accept: "application/json"
            }
        });
        assert(res.status === 403, `Expected 403, got ${res.status}`);
    });

    // Test 12: Client-supplied role cannot override JWT role
    await runTest(12, "Client-supplied role in query/body cannot override JWT role", async () => {
        const res = await request("/api/admin/status?role=SUPER_ADMIN", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${tokenPat1}`
            }
        });
        assert(res.status === 403, `Expected 403 Forbidden, got ${res.status}`);
    });

    // Test 13: Client-supplied userId cannot override JWT identity
    await runTest(13, "Client-supplied userId in body/query cannot override JWT identity", async () => {
        const res = await request(`/patient/PAT-002?userId=${patUser2._id.toString()}`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${tokenPat1}`,
                Accept: "application/json"
            }
        });
        assert(res.status === 403, `Expected 403 Forbidden, got ${res.status}`);
    });

    // Test 14: Client-supplied patientId cannot bypass ownership
    await runTest(14, "Client-supplied patientId in request cannot bypass ownership check", async () => {
        const res = await request("/patient/PAT-002", {
            headers: {
                Authorization: `Bearer ${tokenPat1}`,
                Accept: "application/json"
            }
        });
        assert(res.status === 403, `Expected 403 Forbidden, got ${res.status}`);
    });

    // Test 15: Socket connection with valid JWT succeeds
    await runTest(15, "Socket connection with valid JWT succeeds", async () => {
        const result = await connectSocket({
            auth: { token: tokenPat1 }
        });
        assert(!result.error, `Socket connection failed: ${result.error?.message}`);
        assert(result.connected === true, "Expected socket to be connected");
        result.disconnect();
    });

    // Test 16: Socket connection without JWT fails
    await runTest(16, "Socket connection without JWT fails with authentication error", async () => {
        const result = await connectSocket({});
        assert(result.error, "Expected connect_error when JWT is missing");
        assert(result.error.message.includes("Authentication required"), `Unexpected message: ${result.error.message}`);
        if (result.socket) result.socket.disconnect();
    });

    // Test 17: Socket connection with invalid JWT fails
    await runTest(17, "Socket connection with invalid JWT fails", async () => {
        const result = await connectSocket({
            auth: { token: "forged.or.invalid.token" }
        });
        assert(result.error, "Expected connect_error when JWT is invalid");
        if (result.socket) result.socket.disconnect();
    });

    // Test 18: Socket connection with suspended user fails
    await runTest(18, "Socket connection with suspended user fails", async () => {
        const result = await connectSocket({
            auth: { token: tokenSuspended }
        });
        assert(result.error, "Expected connect_error when user is suspended");
        assert(result.error.message.includes("suspended"), `Expected suspended error, got: ${result.error.message}`);
        if (result.socket) result.socket.disconnect();
    });

    // Test 19: Patient cannot join another patient's room
    await runTest(19, "Patient cannot join another patient's room via join-room", async () => {
        const socketPat1 = await connectSocket({ auth: { token: tokenPat1 } });
        assert(!socketPat1.error, "Socket 1 connection failed");

        const joinResponse = await new Promise((resolve) => {
            socketPat1.emit("join-room", { role: "patient", userId: "PAT-002" }, (ack) => {
                resolve(ack);
            });
            // Fallback timeout in case server doesn't ack
            setTimeout(() => resolve({ success: false, timeout: true }), 1000);
        });

        assert(joinResponse.success === false, "Server allowed patient to join another patient's room");
        socketPat1.disconnect();
    });

    // Test 20: Doctor cannot receive unassigned patient's realtime telemetry
    await runTest(20, "Doctor cannot receive unassigned patient's realtime telemetry", async () => {
        // Doc1 connects
        const socketDoc1 = await connectSocket({ auth: { token: tokenDoc1 } });
        assert(!socketDoc1.error, "Doctor 1 connection failed");

        let doc1ReceivedReadings = [];
        socketDoc1.on("sensor-reading", (data) => {
            doc1ReceivedReadings.push(data);
        });

        // Telemetry arrives for DEV-002 (PAT-002, assigned to DOC-002)
        await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-002",
                value1: 120,
                value2: 80,
                timestamp: new Date().toISOString()
            }
        });

        // Wait brief interval to check for leaked emissions
        await new Promise((resolve) => setTimeout(resolve, 300));

        assert(doc1ReceivedReadings.length === 0, `Doc1 received unassigned telemetry: ${JSON.stringify(doc1ReceivedReadings)}`);
        socketDoc1.disconnect();
    });

    // Test 21: Patient receives own realtime telemetry
    await runTest(21, "Patient receives own realtime telemetry", async () => {
        const socketPat1 = await connectSocket({ auth: { token: tokenPat1 } });
        assert(!socketPat1.error, "Patient 1 connection failed");

        const receivedPromise = new Promise((resolve) => {
            socketPat1.on("sensor-reading", (data) => {
                resolve(data);
            });
        });

        // Ingest telemetry for PAT-001 (DEV-001)
        await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-001",
                value1: 72,
                value2: 98,
                timestamp: new Date().toISOString()
            }
        });

        const receivedData = await Promise.race([
            receivedPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout waiting for telemetry")), 2000))
        ]);

        assert(receivedData.patientId === "PAT-001", `Expected patientId PAT-001, got ${receivedData.patientId}`);
        assert(receivedData.value1 === 72, `Expected value1 72, got ${receivedData.value1}`);
        socketPat1.disconnect();
    });

    // Test 22: Doctor receives assigned patient's realtime telemetry
    await runTest(22, "Doctor receives assigned patient's realtime telemetry", async () => {
        const socketDoc1 = await connectSocket({ auth: { token: tokenDoc1 } });
        assert(!socketDoc1.error, "Doctor 1 connection failed");

        const receivedPromise = new Promise((resolve) => {
            socketDoc1.on("sensor-reading", (data) => {
                resolve(data);
            });
        });

        // Ingest telemetry for PAT-001 (assigned to DOC-001)
        await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-001",
                value1: 75,
                value2: 99,
                timestamp: new Date().toISOString()
            }
        });

        const receivedData = await Promise.race([
            receivedPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout waiting for telemetry")), 2000))
        ]);

        assert(receivedData.patientId === "PAT-001", `Expected patientId PAT-001, got ${receivedData.patientId}`);
        assert(receivedData.doctorId === "DOC-001", `Expected doctorId DOC-001, got ${receivedData.doctorId}`);
        socketDoc1.disconnect();
    });

    // Test 23: Historical doctorId remains unchanged
    await runTest(23, "Historical doctorId in SensorReading remains unchanged after reassignment", async () => {
        // Query the latest sensor reading created for PAT-001 while assigned to DOC-001
        const historicalDoc = await SensorReading.findOne({ patientId: "PAT-001" }).sort({ timestamp: -1 });
        assert(historicalDoc !== null, "Historical reading should exist");
        assert(historicalDoc.doctorId === "DOC-001", `Expected historical doctorId DOC-001, got ${historicalDoc.doctorId}`);

        // Reassign PAT-001 from DOC-001 to DOC-002
        await Patient.updateOne({ patientId: "PAT-001" }, { $set: { doctorId: "DOC-002" } });

        // Verify historical record is still DOC-001
        const recheckedDoc = await SensorReading.findById(historicalDoc._id);
        assert(recheckedDoc.doctorId === "DOC-001", "Historical doctorId was modified after reassignment!");
    });

    // Test 24: Reassignment stops future telemetry for previous doctor
    await runTest(24, "Reassignment stops future telemetry delivery to previous doctor", async () => {
        // Connect both doc1 and doc2
        const socketDoc1 = await connectSocket({ auth: { token: tokenDoc1 } });
        const socketDoc2 = await connectSocket({ auth: { token: tokenDoc2 } });

        let doc1Received = [];
        let doc2Received = [];

        socketDoc1.on("sensor-reading", (data) => doc1Received.push(data));
        socketDoc2.on("sensor-reading", (data) => doc2Received.push(data));

        // Send telemetry for PAT-001 (now assigned to DOC-002)
        await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-001",
                value1: 88,
                value2: 95,
                timestamp: new Date().toISOString()
            }
        });

        // Wait brief moment for socket propagation
        await new Promise((resolve) => setTimeout(resolve, 400));

        assert(doc1Received.length === 0, `Previous doctor DOC-001 received telemetry after reassignment: ${JSON.stringify(doc1Received)}`);
        assert(doc2Received.length === 1, `New doctor DOC-002 did not receive telemetry: received ${doc2Received.length}`);
        assert(doc2Received[0].doctorId === "DOC-002", `Expected doctorId DOC-002, got ${doc2Received[0].doctorId}`);

        socketDoc1.disconnect();
        socketDoc2.disconnect();
    });

    // ==========================================
    // CLEANUP & SUMMARY
    // ==========================================
    server.close();
    await mongoose.connection.close();

    console.log("=================================================");
    console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED out of ${passedCount + failedCount}`);
    console.log("=================================================");

    if (failedCount > 0) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error("Test runner crashed:", err);
    process.exit(1);
});
