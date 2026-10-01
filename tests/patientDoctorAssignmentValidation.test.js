/**
 * Phase 8: Patient <-> Doctor Assignment Engine & Clinical Relationship Management Test Suite
 * Health Tracker — Comprehensive Automated Verification
 *
 * Covers all 40 required test cases:
 *  BASIC ASSIGNMENT (1-8):
 *   1. Super Admin can assign patient to doctor
 *   2. Patient cannot assign themselves
 *   3. Doctor cannot assign patient
 *   4. Unauthenticated user cannot assign
 *   5. Invalid patient rejected
 *   6. Invalid doctor rejected
 *   7. Inactive doctor rejected
 *   8. Assignment creates correct Patient.doctorId
 *  UNASSIGNMENT (9-13):
 *   9. Super Admin can unassign patient
 *  10. Patient remains intact after unassignment
 *  11. Device ownership remains intact
 *  12. doctorId becomes null
 *  13. Unassigned patient is not visible to doctors
 *  REASSIGNMENT (14-19):
 *  14. Patient can move from Doctor A to Doctor B
 *  15. Doctor B must be ACTIVE
 *  16. Doctor A no longer sees patient
 *  17. Doctor B sees patient
 *  18. Device ownership unchanged
 *  19. Historical SensorReading remains unchanged
 *  DOCTOR LIFECYCLE (20-23):
 *  20. Deactivating doctor handles current assignments correctly
 *  21. Patients do not get automatically assigned elsewhere
 *  22. Reactivating doctor does not automatically restore assignments
 *  23. Admin can explicitly reassign after reactivation
 *  SECURITY (24-28):
 *  24. Role spoofing rejected
 *  25. patientId spoofing rejected
 *  26. doctorId spoofing rejected
 *  27. Patient cannot manipulate assignment endpoint
 *  28. Doctor cannot manipulate assignment endpoint
 *  SOCKET / TELEMETRY (29-33):
 *  29. Newly assigned doctor receives future telemetry
 *  30. Previous doctor stops receiving future telemetry
 *  31. Patient continues receiving own telemetry
 *  32. Unassigned patient telemetry has doctorId = null
 *  33. Historical telemetry is never rewritten
 *  AUDIT (34-37):
 *  34. Assignment creates ActivityLog
 *  35. Reassignment creates ActivityLog
 *  36. Unassignment creates ActivityLog
 *  37. Doctor-deactivation assignment changes are logged
 *  INTEGRITY (38-40):
 *  38. Patient/Doctor references remain valid
 *  39. Multiple patients can be assigned to one doctor
 *  40. One patient cannot have multiple current doctors
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
const ActivityLog = require("../src/models/ActivityLog");
const {
    ROLES,
    ACCOUNT_STATUS,
    DOCTOR_STATUS,
    DEVICE_STATUS,
    AUDIT_ACTIONS,
    ACTOR_ROLES,
    TARGET_TYPES
} = require("../src/config/constants");
const { hashPassword, generateToken } = require("../src/utils/authUtils");

const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/health_monitoring_phase8_test";

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
        data,
        text
    };
}

// Socket client helper
function connectSocket(token) {
    return new Promise((resolve) => {
        const socket = ioClient(socketUrl, {
            transports: ["websocket"],
            forceNew: true,
            reconnection: false,
            timeout: 4000,
            auth: { token }
        });

        socket.on("connect", () => {
            resolve(socket);
        });

        socket.on("connect_error", (err) => {
            resolve({ error: err, socket });
        });
    });
}

async function main() {
    console.log("=================================================");
    console.log("RUNNING PHASE 8: PATIENT <-> DOCTOR ASSIGNMENT TESTS");
    console.log("=================================================\n");

    // 1. Connect to isolated Test MongoDB
    await mongoose.connect(TEST_DB_URI);
    await mongoose.connection.dropDatabase();

    // 2. Start HTTP & Socket.IO server on dynamic port
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

    // 3. Seed Base Test Data: Super Admin, Doctor A, Doctor B, Patient 1, Patient 2, Devices
    const passwordHash = await hashPassword("Password123!");

    // Super Admin
    const adminUser = await User.create({
        username: "superadmin_p8",
        email: "admin_p8@test.com",
        passwordHash,
        role: ROLES.SUPER_ADMIN,
        status: ACCOUNT_STATUS.ACTIVE
    });
    const adminToken = generateToken({
        userId: adminUser._id.toString(),
        username: adminUser.username,
        role: adminUser.role
    });
    const adminHeaders = {
        Authorization: `Bearer ${adminToken}`,
        Accept: "application/json"
    };

    // Doctor A (Active)
    const doctorAUser = await User.create({
        username: "dr_alice_p8",
        email: "alice_p8@test.com",
        passwordHash,
        role: ROLES.DOCTOR,
        profileId: "DOC-A",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const doctorA = await Doctor.create({
        doctorId: "DOC-A",
        userId: doctorAUser._id,
        name: "Dr. Alice Smith",
        email: "alice_p8@test.com",
        specialization: "Cardiology",
        status: DOCTOR_STATUS.ACTIVE
    });
    const doctorAToken = generateToken({
        userId: doctorAUser._id.toString(),
        username: doctorAUser.username,
        role: doctorAUser.role,
        profileId: doctorAUser.profileId
    });
    const doctorAHeaders = {
        Authorization: `Bearer ${doctorAToken}`,
        Accept: "application/json"
    };

    // Doctor B (Active)
    const doctorBUser = await User.create({
        username: "dr_bob_p8",
        email: "bob_p8@test.com",
        passwordHash,
        role: ROLES.DOCTOR,
        profileId: "DOC-B",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const doctorB = await Doctor.create({
        doctorId: "DOC-B",
        userId: doctorBUser._id,
        name: "Dr. Bob Jones",
        email: "bob_p8@test.com",
        specialization: "Neurology",
        status: DOCTOR_STATUS.ACTIVE
    });
    const doctorBToken = generateToken({
        userId: doctorBUser._id.toString(),
        username: doctorBUser.username,
        role: doctorBUser.role,
        profileId: doctorBUser.profileId
    });
    const doctorBHeaders = {
        Authorization: `Bearer ${doctorBToken}`,
        Accept: "application/json"
    };

    // Doctor C (Inactive Doctor for Invariant Testing)
    const doctorCUser = await User.create({
        username: "dr_inactive_p8",
        email: "inactive_p8@test.com",
        passwordHash,
        role: ROLES.DOCTOR,
        profileId: "DOC-C",
        status: ACCOUNT_STATUS.SUSPENDED
    });
    const doctorC = await Doctor.create({
        doctorId: "DOC-C",
        userId: doctorCUser._id,
        name: "Dr. Charlie Brown",
        email: "inactive_p8@test.com",
        specialization: "Pediatrics",
        status: DOCTOR_STATUS.INACTIVE
    });

    // Patient 1 (Unassigned initially)
    const patient1User = await User.create({
        username: "patient_one_p8",
        email: "pat1_p8@test.com",
        passwordHash,
        role: ROLES.PATIENT,
        profileId: "PAT-001",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const patient1 = await Patient.create({
        patientId: "PAT-001",
        userId: patient1User._id,
        name: "John Doe",
        email: "pat1_p8@test.com",
        age: 35,
        gender: "Male",
        doctorId: null,
        deviceId: "DEV-001"
    });
    const patient1Token = generateToken({
        userId: patient1User._id.toString(),
        username: patient1User.username,
        role: patient1User.role,
        profileId: patient1User.profileId
    });
    const patient1Headers = {
        Authorization: `Bearer ${patient1Token}`,
        Accept: "application/json"
    };

    // Patient 2 (Unassigned initially)
    const patient2User = await User.create({
        username: "patient_two_p8",
        email: "pat2_p8@test.com",
        passwordHash,
        role: ROLES.PATIENT,
        profileId: "PAT-002",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const patient2 = await Patient.create({
        patientId: "PAT-002",
        userId: patient2User._id,
        name: "Jane Smith",
        email: "pat2_p8@test.com",
        age: 29,
        gender: "Female",
        doctorId: null,
        deviceId: "DEV-002"
    });

    // Device 1 & Device 2
    await Device.create({
        deviceId: "DEV-001",
        patientId: "PAT-001",
        status: DEVICE_STATUS.ACTIVE
    });
    await Device.create({
        deviceId: "DEV-002",
        patientId: "PAT-002",
        status: DEVICE_STATUS.ACTIVE
    });

    // Baseline historical reading for PAT-001 under Doctor A (simulated past assignment)
    const baselinePastReading = await SensorReading.create({
        deviceId: "DEV-001",
        patientId: "PAT-001",
        doctorId: "DOC-A",
        value1: 72,
        value2: 120,
        timestamp: new Date(Date.now() - 3600000)
    });

    // ==========================================
    // 1. BASIC ASSIGNMENT (Tests 1-8)
    // ==========================================

    // Test 1: Super Admin can assign patient to doctor
    await runTest(1, "Super Admin can assign patient to doctor", async () => {
        const res = await request("/api/admin/assignments", {
            method: "POST",
            headers: adminHeaders,
            body: {
                patientId: "PAT-001",
                doctorId: "DOC-A"
            }
        });

        assert(res.status === 200, `Expected status 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert(res.data.success === true, "Expected success: true");
        assert(res.data.assignment.patientId === "PAT-001", "Expected assignment patientId PAT-001");
        assert(res.data.assignment.doctorId === "DOC-A", "Expected assignment doctorId DOC-A");
        assert(res.data.assignment.assignmentStatus === "ASSIGNED", "Expected assignmentStatus ASSIGNED");
    });

    // Test 2: Patient cannot assign themselves
    await runTest(2, "Patient cannot assign themselves", async () => {
        const res = await request("/api/admin/assignments", {
            method: "POST",
            headers: patient1Headers,
            body: {
                patientId: "PAT-001",
                doctorId: "DOC-B"
            }
        });

        assert(res.status === 403, `Expected status 403, got ${res.status}`);
    });

    // Test 3: Doctor cannot assign patient
    await runTest(3, "Doctor cannot assign patient", async () => {
        const res = await request("/api/admin/assignments", {
            method: "POST",
            headers: doctorAHeaders,
            body: {
                patientId: "PAT-002",
                doctorId: "DOC-A"
            }
        });

        assert(res.status === 403, `Expected status 403, got ${res.status}`);
    });

    // Test 4: Unauthenticated user cannot assign
    await runTest(4, "Unauthenticated user cannot assign", async () => {
        const res = await request("/api/admin/assignments", {
            method: "POST",
            headers: { Accept: "application/json" },
            body: {
                patientId: "PAT-001",
                doctorId: "DOC-A"
            }
        });

        assert(res.status === 401, `Expected status 401, got ${res.status}`);
    });

    // Test 5: Invalid patient rejected
    await runTest(5, "Invalid patient rejected", async () => {
        const res = await request("/api/admin/assignments", {
            method: "POST",
            headers: adminHeaders,
            body: {
                patientId: "PAT-NONEXISTENT",
                doctorId: "DOC-A"
            }
        });

        assert(res.status === 404, `Expected status 404, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    // Test 6: Invalid doctor rejected
    await runTest(6, "Invalid doctor rejected", async () => {
        const res = await request("/api/admin/assignments", {
            method: "POST",
            headers: adminHeaders,
            body: {
                patientId: "PAT-001",
                doctorId: "DOC-NONEXISTENT"
            }
        });

        assert(res.status === 404, `Expected status 404, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    // Test 7: Inactive doctor rejected
    await runTest(7, "Inactive doctor rejected", async () => {
        const res = await request("/api/admin/assignments", {
            method: "POST",
            headers: adminHeaders,
            body: {
                patientId: "PAT-001",
                doctorId: "DOC-C"
            }
        });

        assert(res.status === 400, `Expected status 400, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
        assert(res.data.message.includes("inactive"), "Expected inactive message");
    });

    // Test 8: Assignment creates correct Patient.doctorId
    await runTest(8, "Assignment creates correct Patient.doctorId", async () => {
        const pat = await Patient.findOne({ patientId: "PAT-001" });
        assert(pat, "Patient must exist in DB");
        assert(pat.doctorId === "DOC-A", `Patient doctorId in DB must be DOC-A, got ${pat.doctorId}`);
    });

    // ==========================================
    // 2. UNASSIGNMENT (Tests 9-13)
    // ==========================================

    // Test 9: Super Admin can unassign patient
    await runTest(9, "Super Admin can unassign patient", async () => {
        const res = await request("/api/admin/assignments/PAT-001", {
            method: "DELETE",
            headers: adminHeaders
        });

        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        assert(res.data.success === true, "Expected success: true");
        assert(res.data.assignment.doctorId === null, "Expected doctorId null");
        assert(res.data.assignment.assignmentStatus === "UNASSIGNED", "Expected assignmentStatus UNASSIGNED");
    });

    // Test 10: Patient remains intact after unassignment
    await runTest(10, "Patient remains intact after unassignment", async () => {
        const pat = await Patient.findOne({ patientId: "PAT-001" });
        assert(pat, "Patient record must still exist");
        assert(pat.name === "John Doe", "Patient name must remain intact");
        assert(pat.email === "pat1_p8@test.com", "Patient email must remain intact");
        assert(pat.age === 35, "Patient age must remain intact");
    });

    // Test 11: Device ownership remains intact
    await runTest(11, "Device ownership remains intact", async () => {
        const pat = await Patient.findOne({ patientId: "PAT-001" });
        assert(pat.deviceId === "DEV-001", `Patient deviceId must remain DEV-001, got ${pat.deviceId}`);

        const dev = await Device.findOne({ deviceId: "DEV-001" });
        assert(dev.patientId === "PAT-001", `Device patientId must remain PAT-001, got ${dev.patientId}`);
    });

    // Test 12: doctorId becomes null
    await runTest(12, "doctorId becomes null", async () => {
        const pat = await Patient.findOne({ patientId: "PAT-001" });
        assert(pat.doctorId === null, `Patient doctorId must be null, got ${pat.doctorId}`);
    });

    // Test 13: Unassigned patient is not visible to doctors
    await runTest(13, "Unassigned patient is not visible to doctors", async () => {
        const res = await request("/api/doctor/DOC-A/patients", {
            method: "GET",
            headers: doctorAHeaders
        });

        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        const patientIds = (res.data.patients || []).map((p) => p.patientId);
        assert(!patientIds.includes("PAT-001"), "Doctor A must NOT see unassigned patient PAT-001");
    });

    // ==========================================
    // 3. REASSIGNMENT (Tests 14-19)
    // ==========================================

    // Test 14: Patient can move from Doctor A to Doctor B
    await runTest(14, "Patient can move from Doctor A to Doctor B", async () => {
        // First assign to Doctor A
        await request("/api/admin/assignments", {
            method: "POST",
            headers: adminHeaders,
            body: { patientId: "PAT-001", doctorId: "DOC-A" }
        });

        // Reassign to Doctor B
        const res = await request("/api/admin/assignments", {
            method: "POST",
            headers: adminHeaders,
            body: { patientId: "PAT-001", doctorId: "DOC-B" }
        });

        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        assert(res.data.assignment.doctorId === "DOC-B", "Expected current doctor DOC-B");
        assert(res.data.assignment.previousDoctorId === "DOC-A", "Expected previousDoctorId DOC-A");
    });

    // Test 15: Doctor B must be ACTIVE
    await runTest(15, "Doctor B must be ACTIVE", async () => {
        const res = await request("/api/admin/assignments", {
            method: "POST",
            headers: adminHeaders,
            body: { patientId: "PAT-001", doctorId: "DOC-C" }
        });

        assert(res.status === 400, `Expected status 400 for inactive doctor, got ${res.status}`);
        const pat = await Patient.findOne({ patientId: "PAT-001" });
        assert(pat.doctorId === "DOC-B", "Patient doctorId must remain DOC-B after rejected reassignment");
    });

    // Test 16: Doctor A no longer sees patient
    await runTest(16, "Doctor A no longer sees patient", async () => {
        const res = await request("/api/doctor/DOC-A/patients", {
            method: "GET",
            headers: doctorAHeaders
        });

        assert(res.status === 200, `Expected 200, got ${res.status}`);
        const patientIds = (res.data.patients || []).map((p) => p.patientId);
        assert(!patientIds.includes("PAT-001"), "Doctor A must NOT see reassigned patient PAT-001");
    });

    // Test 17: Doctor B sees patient
    await runTest(17, "Doctor B sees patient", async () => {
        const res = await request("/api/doctor/DOC-B/patients", {
            method: "GET",
            headers: doctorBHeaders
        });

        assert(res.status === 200, `Expected 200, got ${res.status}`);
        const patientIds = (res.data.patients || []).map((p) => p.patientId);
        assert(patientIds.includes("PAT-001"), "Doctor B must see assigned patient PAT-001");
    });

    // Test 18: Device ownership unchanged
    await runTest(18, "Device ownership unchanged", async () => {
        const pat = await Patient.findOne({ patientId: "PAT-001" });
        assert(pat.deviceId === "DEV-001", "Device binding must remain DEV-001");
    });

    // Test 19: Historical SensorReading remains unchanged
    await runTest(19, "Historical SensorReading remains unchanged", async () => {
        const historical = await SensorReading.findById(baselinePastReading._id);
        assert(historical, "Historical reading must exist");
        assert(historical.doctorId === "DOC-A", `Historical reading must retain original doctorId DOC-A, got ${historical.doctorId}`);
        assert(historical.patientId === "PAT-001", "Historical reading patientId must remain PAT-001");
    });

    // ==========================================
    // 4. DOCTOR LIFECYCLE (Tests 20-23)
    // ==========================================

    // Test 20: Deactivating doctor handles current assignments correctly
    await runTest(20, "Deactivating doctor handles current assignments correctly", async () => {
        // Patient 1 is currently assigned to Doctor B
        const deactRes = await request("/api/admin/doctors/DOC-B/deactivate", {
            method: "PATCH",
            headers: adminHeaders
        });

        assert(deactRes.status === 200, `Expected status 200 on doctor deactivation, got ${deactRes.status}`);

        const pat1 = await Patient.findOne({ patientId: "PAT-001" });
        assert(pat1.doctorId === null, `Patient doctorId must become null upon doctor deactivation, got ${pat1.doctorId}`);
    });

    // Test 21: Patients do not get automatically assigned elsewhere
    await runTest(21, "Patients do not get automatically assigned elsewhere", async () => {
        const pat1 = await Patient.findOne({ patientId: "PAT-001" });
        assert(pat1.doctorId === null, `Patient doctorId must remain null, never auto-assigned, got ${pat1.doctorId}`);
    });

    // Test 22: Reactivating doctor does not automatically restore assignments
    await runTest(22, "Reactivating doctor does not automatically restore assignments", async () => {
        const reactRes = await request("/api/admin/doctors/DOC-B/activate", {
            method: "PATCH",
            headers: adminHeaders
        });

        assert(reactRes.status === 200, `Expected status 200 on doctor activation, got ${reactRes.status}`);

        const pat1 = await Patient.findOne({ patientId: "PAT-001" });
        assert(pat1.doctorId === null, `Patient doctorId must NOT automatically restore, must remain null, got ${pat1.doctorId}`);
    });

    // Test 23: Admin can explicitly reassign after reactivation
    await runTest(23, "Admin can explicitly reassign after reactivation", async () => {
        const res = await request("/api/admin/assignments", {
            method: "POST",
            headers: adminHeaders,
            body: {
                patientId: "PAT-001",
                doctorId: "DOC-B"
            }
        });

        assert(res.status === 200, `Expected status 200 on explicit reassign, got ${res.status}`);
        const pat1 = await Patient.findOne({ patientId: "PAT-001" });
        assert(pat1.doctorId === "DOC-B", `Patient doctorId must now be DOC-B, got ${pat1.doctorId}`);
    });

    // ==========================================
    // 5. SECURITY (Tests 24-28)
    // ==========================================

    // Test 24: Role spoofing rejected
    await runTest(24, "Role spoofing rejected", async () => {
        const res = await request("/api/admin/assignments", {
            method: "POST",
            headers: patient1Headers,
            body: {
                patientId: "PAT-001",
                doctorId: "DOC-A",
                role: ROLES.SUPER_ADMIN
            }
        });

        assert(res.status === 403, `Expected status 403 for role spoofing, got ${res.status}`);
    });

    // Test 25: patientId spoofing rejected
    await runTest(25, "patientId spoofing rejected", async () => {
        // Patient 1 tries to access dashboard or doctor patient list
        const res = await request("/api/doctor/DOC-A/patients", {
            method: "GET",
            headers: patient1Headers
        });

        assert(res.status === 403, `Expected status 403 when patient calls doctor route, got ${res.status}`);
    });

    // Test 26: doctorId spoofing rejected
    await runTest(26, "doctorId spoofing rejected", async () => {
        // Doctor A tries to access Doctor B's patients list
        const res = await request("/api/doctor/DOC-B/patients", {
            method: "GET",
            headers: doctorAHeaders
        });

        assert(res.status === 403, `Expected status 403 when doctor accesses another doctor route, got ${res.status}`);
    });

    // Test 27: Patient cannot manipulate assignment endpoint
    await runTest(27, "Patient cannot manipulate assignment endpoint", async () => {
        const res = await request("/api/admin/assignments/PAT-001", {
            method: "DELETE",
            headers: patient1Headers
        });

        assert(res.status === 403, `Expected status 403 when patient calls DELETE assignment, got ${res.status}`);
    });

    // Test 28: Doctor cannot manipulate assignment endpoint
    await runTest(28, "Doctor cannot manipulate assignment endpoint", async () => {
        const res = await request("/api/admin/assignments/PAT-001", {
            method: "DELETE",
            headers: doctorBHeaders
        });

        assert(res.status === 403, `Expected status 403 when doctor calls DELETE assignment, got ${res.status}`);
    });

    // ==========================================
    // 6. SOCKET / TELEMETRY (Tests 29-33)
    // ==========================================

    // Connect socket clients for Doctor A, Doctor B, and Patient 1
    const doctorASocket = await connectSocket(doctorAToken);
    const doctorBSocket = await connectSocket(doctorBToken);
    const patient1Socket = await connectSocket(patient1Token);

    assert(doctorASocket && !doctorASocket.error, "Doctor A socket should connect");
    assert(doctorBSocket && !doctorBSocket.error, "Doctor B socket should connect");
    assert(patient1Socket && !patient1Socket.error, "Patient 1 socket should connect");

    // Test 29: Newly assigned doctor receives future telemetry
    await runTest(29, "Newly assigned doctor receives future telemetry", async () => {
        // Patient 1 is currently assigned to Doctor B
        let docBReceived = false;
        doctorBSocket.on("sensor-reading", (data) => {
            if (data.patientId === "PAT-001") {
                docBReceived = true;
            }
        });

        // Ingest IoT reading for DEV-001 (PAT-001)
        const iotRes = await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-001",
                value1: 80,
                value2: 125,
                timestamp: new Date().toISOString()
            }
        });

        assert(iotRes.status === 201, `Expected IoT ingest 201, got ${iotRes.status}`);

        // Wait brief delay for socket emission
        await new Promise((r) => setTimeout(r, 150));
        assert(docBReceived === true, "Doctor B must receive sensor reading for assigned patient");
    });

    // Test 30: Previous doctor stops receiving future telemetry
    await runTest(30, "Previous doctor stops receiving future telemetry", async () => {
        let docAReceived = false;
        doctorASocket.on("sensor-reading", (data) => {
            if (data.patientId === "PAT-001") {
                docAReceived = true;
            }
        });

        // Ingest another IoT reading
        await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-001",
                value1: 82,
                value2: 128,
                timestamp: new Date().toISOString()
            }
        });

        await new Promise((r) => setTimeout(r, 150));
        assert(docAReceived === false, "Previous Doctor A must NOT receive future telemetry for reassigned patient");
    });

    // Test 31: Patient continues receiving own telemetry
    await runTest(31, "Patient continues receiving own telemetry", async () => {
        let patReceived = false;
        patient1Socket.on("sensor-reading", (data) => {
            if (data.patientId === "PAT-001") {
                patReceived = true;
            }
        });

        await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-001",
                value1: 85,
                value2: 130,
                timestamp: new Date().toISOString()
            }
        });

        await new Promise((r) => setTimeout(r, 150));
        assert(patReceived === true, "Patient must continue receiving own telemetry");
    });

    // Test 32: Unassigned patient telemetry has doctorId = null
    await runTest(32, "Unassigned patient telemetry has doctorId = null", async () => {
        // Patient 2 is unassigned
        const iotRes = await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-002",
                value1: 68,
                value2: 110,
                timestamp: new Date().toISOString()
            }
        });

        assert(iotRes.status === 201, `Expected 201, got ${iotRes.status}`);

        const reading = await SensorReading.findOne({ patientId: "PAT-002" }).sort({ timestamp: -1 });
        assert(reading, "Reading must be stored");
        assert(reading.doctorId === null, `Unassigned patient reading doctorId must be null, got ${reading.doctorId}`);
    });

    // Test 33: Historical telemetry is never rewritten
    await runTest(33, "Historical telemetry is never rewritten", async () => {
        // Reassign Patient 1 to Doctor A
        await request("/api/admin/assignments", {
            method: "POST",
            headers: adminHeaders,
            body: { patientId: "PAT-001", doctorId: "DOC-A" }
        });

        // The baseline reading created at start under DOC-A must STILL be DOC-A
        const originalPast = await SensorReading.findById(baselinePastReading._id);
        assert(originalPast.doctorId === "DOC-A", "Baseline reading must remain DOC-A");

        // The reading created during Test 29 (under DOC-B) must STILL be DOC-B
        const readingsUnderDocB = await SensorReading.find({ patientId: "PAT-001", doctorId: "DOC-B" });
        assert(readingsUnderDocB.length > 0, "Past readings under DOC-B must preserve doctorId = DOC-B");
    });

    // Disconnect test sockets
    doctorASocket.disconnect();
    doctorBSocket.disconnect();
    patient1Socket.disconnect();

    // ==========================================
    // 7. AUDIT (Tests 34-37)
    // ==========================================

    // Test 34: Assignment creates ActivityLog
    await runTest(34, "Assignment creates ActivityLog", async () => {
        // Assign unassigned Patient 2 to Doctor A
        await request("/api/admin/assignments", {
            method: "POST",
            headers: adminHeaders,
            body: { patientId: "PAT-002", doctorId: "DOC-A" }
        });

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.PATIENT_ASSIGNED,
            targetId: "PAT-002"
        }).sort({ timestamp: -1 });

        assert(log, "ActivityLog with PATIENT_ASSIGNED must exist");
        assert(log.actorRole === ACTOR_ROLES.SUPER_ADMIN, "actorRole must be SUPER_ADMIN");
        assert(log.details.newDoctorId === "DOC-A", "Log details must record newDoctorId DOC-A");
        assert(log.details.previousDoctorId === null, "Log details must record previousDoctorId null");
    });

    // Test 35: Reassignment creates ActivityLog
    await runTest(35, "Reassignment creates ActivityLog", async () => {
        // Reassign Patient 2 from Doctor A to Doctor B
        await request("/api/admin/assignments", {
            method: "POST",
            headers: adminHeaders,
            body: { patientId: "PAT-002", doctorId: "DOC-B" }
        });

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.PATIENT_REASSIGNED,
            targetId: "PAT-002"
        }).sort({ timestamp: -1 });

        assert(log, "ActivityLog with PATIENT_REASSIGNED must exist");
        assert(log.details.previousDoctorId === "DOC-A", "Log must record previousDoctorId DOC-A");
        assert(log.details.newDoctorId === "DOC-B", "Log must record newDoctorId DOC-B");
    });

    // Test 36: Unassignment creates ActivityLog
    await runTest(36, "Unassignment creates ActivityLog", async () => {
        // Unassign Patient 2
        await request("/api/admin/assignments/PAT-002", {
            method: "DELETE",
            headers: adminHeaders
        });

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.PATIENT_UNASSIGNED,
            targetId: "PAT-002",
            "details.reason": { $ne: "DOCTOR_DEACTIVATED" }
        }).sort({ timestamp: -1 });

        assert(log, "ActivityLog with PATIENT_UNASSIGNED must exist");
        assert(log.details.previousDoctorId === "DOC-B", "Log must record previousDoctorId DOC-B");
        assert(log.details.newDoctorId === null, "Log must record newDoctorId null");
    });

    // Test 37: Doctor-deactivation assignment changes are logged
    await runTest(37, "Doctor-deactivation assignment changes are logged", async () => {
        // Assign Patient 2 to Doctor A, then deactivate Doctor A
        await request("/api/admin/assignments", {
            method: "POST",
            headers: adminHeaders,
            body: { patientId: "PAT-002", doctorId: "DOC-A" }
        });

        await request("/api/admin/doctors/DOC-A/deactivate", {
            method: "PATCH",
            headers: adminHeaders
        });

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.PATIENT_UNASSIGNED,
            targetId: "PAT-002",
            "details.reason": "DOCTOR_DEACTIVATED"
        });

        assert(log, "ActivityLog with PATIENT_UNASSIGNED (reason: DOCTOR_DEACTIVATED) must exist");
        assert(log.details.previousDoctorId === "DOC-A", "Log details must record previousDoctorId DOC-A");
    });

    // ==========================================
    // 8. INTEGRITY (Tests 38-40)
    // ==========================================

    // Test 38: Patient/Doctor references remain valid
    await runTest(38, "Patient/Doctor references remain valid", async () => {
        // Reactivate Doctor A and assign PAT-001 and PAT-002
        await request("/api/admin/doctors/DOC-A/activate", {
            method: "PATCH",
            headers: adminHeaders
        });
        await request("/api/admin/assignments", {
            method: "POST",
            headers: adminHeaders,
            body: { patientId: "PAT-001", doctorId: "DOC-A" }
        });

        const patient = await Patient.findOne({ patientId: "PAT-001" });
        assert(patient.doctorId, "Patient must have doctorId");
        const doc = await Doctor.findOne({ doctorId: patient.doctorId });
        assert(doc, `Referenced doctor ${patient.doctorId} must exist in Doctor collection`);
    });

    // Test 39: Multiple patients can be assigned to one doctor
    await runTest(39, "Multiple patients can be assigned to one doctor", async () => {
        await request("/api/admin/assignments", {
            method: "POST",
            headers: adminHeaders,
            body: { patientId: "PAT-002", doctorId: "DOC-A" }
        });

        const assignedPatients = await Patient.find({ doctorId: "DOC-A" });
        assert(assignedPatients.length >= 2, `Doctor DOC-A must have at least 2 patients, got ${assignedPatients.length}`);
    });

    // Test 40: One patient cannot have multiple current doctors
    await runTest(40, "One patient cannot have multiple current doctors", async () => {
        const patient = await Patient.findOne({ patientId: "PAT-001" });
        assert(typeof patient.doctorId === "string" || patient.doctorId === null, "Patient doctorId must be single string or null");
        assert(!Array.isArray(patient.doctorId), "Patient doctorId cannot be an array");

        // Schema verification: doctorId is a single string field
        const schemaType = Patient.schema.path("doctorId").instance;
        assert(schemaType === "String", `Patient.doctorId schema type must be String, got ${schemaType}`);
    });

    console.log("\n=================================================");
    console.log(`TEST SUMMARY: ${passedCount}/${passedCount + failedCount} TESTS PASSED`);
    console.log(`FAILED TESTS: ${failedCount}`);
    console.log("=================================================");

    if (failedCount === 0) {
        console.log("PHASE 8 VERIFICATION: SUCCESS\n");
    } else {
        console.error("PHASE 8 VERIFICATION: FAILED\n");
    }

    // Teardown
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.connection.close();
    process.exit(failedCount === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error("Fatal test runner error:", err);
    process.exit(1);
});
