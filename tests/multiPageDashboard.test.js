/**
 * Phase 9: Multi-Page Dashboard Architecture Test Suite
 * Health Tracker — Comprehensive Automated Verification
 *
 * Covers 40 test cases:
 *  ROUTE EXISTENCE (1-13):
 *   1. Patient overview route exists (GET /patient/overview)
 *   2. Patient live route exists (GET /patient/live)
 *   3. Patient history route exists (GET /patient/history)
 *   4. Patient profile route exists (GET /patient/profile)
 *   5. Doctor overview route exists (GET /doctor/overview)
 *   6. Doctor patients route exists (GET /doctor/patients)
 *   7. Doctor monitor route exists (GET /doctor/monitor)
 *   8. Doctor history route exists (GET /doctor/history)
 *   9. Admin overview route exists (GET /admin/overview)
 *  10. Admin doctors route exists (GET /admin/doctors)
 *  11. Admin patients route exists (GET /admin/patients)
 *  12. Admin devices route exists (GET /admin/devices)
 *  13. Admin activity route exists (GET /admin/activity)
 *  UNAUTHENTICATED ACCESS (14-16):
 *  14. Unauthenticated patient page rejected
 *  15. Unauthenticated doctor page rejected
 *  16. Unauthenticated admin page rejected
 *  CROSS-ROLE ACCESS (17-20):
 *  17. Patient cannot access doctor pages
 *  18. Patient cannot access admin pages
 *  19. Doctor cannot access patient pages
 *  20. Doctor cannot access admin pages
 *  IDENTITY & SPOOFING DEFENSE (21-24):
 *  21. Patient identity comes from authenticated context
 *  22. Doctor identity comes from authenticated context
 *  23. Client-supplied patientId cannot bypass patient ownership
 *  24. Client-supplied doctorId cannot bypass doctor ownership
 *  NAVIGATION INTEGRITY (25-30):
 *  25. Patient navigation URLs are correct
 *  26. Doctor navigation URLs are correct
 *  27. Admin navigation URLs are correct
 *  28. Active navigation state is correctly highlighted
 *  29. Direct URL access works directly
 *  30. Legacy dashboard routes safely redirect
 *  DATA ISOLATION & AUDIT (31-33):
 *  31. Patient history does not expose another patient's data
 *  32. Doctor patient page does not expose another doctor's patients
 *  33. Admin pages remain strictly SUPER_ADMIN-only
 *  REAL-TIME & API PARITY (34-40):
 *  34. Socket.IO functionality remains operational
 *  35. Doctor history filters only assigned patients
 *  36. Doctor history with foreign patient ID parameter is safely ignored
 *  37. Patient profile strictly excludes sensitive credentials and secrets
 *  38. HTML requests return text/html with valid multi-page shell
 *  39. JSON API requests return JSON payload with success: true
 *  40. Legacy Phase 3 parameterized routes (/patient/:patientId, /doctor/:doctorId) remain functional
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

const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/health_monitoring_phase9_test";

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
        redirect: options.redirect || "manual"
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

async function main() {
    console.log("=================================================");
    console.log("RUNNING PHASE 9: MULTI-PAGE DASHBOARD ARCHITECTURE TESTS");
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

    // 3. Seed Base Test Data: Super Admin, Doctor 1, Doctor 2, Patient 1, Patient 2
    const passwordHash = await hashPassword("Password123!");

    // Super Admin
    const adminUser = await User.create({
        username: "superadmin_p9",
        email: "admin_p9@test.com",
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
        Accept: "text/html"
    };
    const adminApiHeaders = {
        Authorization: `Bearer ${adminToken}`,
        Accept: "application/json"
    };

    // Doctor A (DOC-001)
    const doctorAUser = await User.create({
        username: "dr_alice_p9",
        email: "alice_p9@test.com",
        passwordHash,
        role: ROLES.DOCTOR,
        profileId: "DOC-001",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const doctorA = await Doctor.create({
        doctorId: "DOC-001",
        userId: doctorAUser._id,
        name: "Dr. Alice Smith",
        email: "alice_p9@test.com",
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
        Accept: "text/html"
    };
    const doctorAApiHeaders = {
        Authorization: `Bearer ${doctorAToken}`,
        Accept: "application/json"
    };

    // Doctor B (DOC-002)
    const doctorBUser = await User.create({
        username: "dr_bob_p9",
        email: "bob_p9@test.com",
        passwordHash,
        role: ROLES.DOCTOR,
        profileId: "DOC-002",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const doctorB = await Doctor.create({
        doctorId: "DOC-002",
        userId: doctorBUser._id,
        name: "Dr. Bob Jones",
        email: "bob_p9@test.com",
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
        Accept: "text/html"
    };

    // Patient 1 (PAT-001) - assigned to Doctor A
    const patient1User = await User.create({
        username: "patient_one_p9",
        email: "pat1_p9@test.com",
        passwordHash,
        role: ROLES.PATIENT,
        profileId: "PAT-001",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const patient1 = await Patient.create({
        patientId: "PAT-001",
        userId: patient1User._id,
        name: "John Doe",
        email: "pat1_p9@test.com",
        age: 35,
        gender: "Male",
        doctorId: "DOC-001",
        deviceId: "DEV-P9-01"
    });
    const patient1Token = generateToken({
        userId: patient1User._id.toString(),
        username: patient1User.username,
        role: patient1User.role,
        profileId: patient1User.profileId
    });
    const patient1Headers = {
        Authorization: `Bearer ${patient1Token}`,
        Accept: "text/html"
    };
    const patient1ApiHeaders = {
        Authorization: `Bearer ${patient1Token}`,
        Accept: "application/json"
    };

    // Patient 2 (PAT-002) - assigned to Doctor B
    const patient2User = await User.create({
        username: "patient_two_p9",
        email: "pat2_p9@test.com",
        passwordHash,
        role: ROLES.PATIENT,
        profileId: "PAT-002",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const patient2 = await Patient.create({
        patientId: "PAT-002",
        userId: patient2User._id,
        name: "Jane Roe",
        email: "pat2_p9@test.com",
        age: 28,
        gender: "Female",
        doctorId: "DOC-002",
        deviceId: "DEV-P9-02"
    });
    const patient2Token = generateToken({
        userId: patient2User._id.toString(),
        username: patient2User.username,
        role: patient2User.role,
        profileId: patient2User.profileId
    });
    const patient2Headers = {
        Authorization: `Bearer ${patient2Token}`,
        Accept: "text/html"
    };

    // Devices & Telemetry
    await Device.create({
        deviceId: "DEV-P9-01",
        patientId: "PAT-001",
        status: DEVICE_STATUS.ACTIVE
    });
    await Device.create({
        deviceId: "DEV-P9-02",
        patientId: "PAT-002",
        status: DEVICE_STATUS.ACTIVE
    });

    // Seed readings for PAT-001
    await SensorReading.create({
        deviceId: "DEV-P9-01",
        patientId: "PAT-001",
        doctorId: "DOC-001",
        value1: 75,
        value2: 98,
        timestamp: new Date()
    });

    // Seed readings for PAT-002
    await SensorReading.create({
        deviceId: "DEV-P9-02",
        patientId: "PAT-002",
        doctorId: "DOC-002",
        value1: 82,
        value2: 95,
        timestamp: new Date()
    });

    // ==========================================
    // 1. ROUTE EXISTENCE (Tests 1-13)
    // ==========================================

    await runTest(1, "Patient overview route exists (GET /patient/overview)", async () => {
        const res = await request("/patient/overview", { headers: patient1Headers });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.text.includes("Patient Overview") || res.text.includes("PATIENT DASHBOARD"), "Must contain overview content");
    });

    await runTest(2, "Patient live route exists (GET /patient/live)", async () => {
        const res = await request("/patient/live", { headers: patient1Headers });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.text.includes("Live Telemetry"), "Must contain live telemetry content");
    });

    await runTest(3, "Patient history route exists (GET /patient/history)", async () => {
        const res = await request("/patient/history", { headers: patient1Headers });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.text.includes("Reading History") || res.text.includes("Biometric Reading History"), "Must contain history content");
    });

    await runTest(4, "Patient profile route exists (GET /patient/profile)", async () => {
        const res = await request("/patient/profile", { headers: patient1Headers });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.text.includes("Patient Profile"), "Must contain profile content");
    });

    await runTest(5, "Doctor overview route exists (GET /doctor/overview)", async () => {
        const res = await request("/doctor/overview", { headers: doctorAHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.text.includes("Doctor Overview") || res.text.includes("Clinical Practice Overview"), "Must contain doctor overview content");
    });

    await runTest(6, "Doctor patients route exists (GET /doctor/patients)", async () => {
        const res = await request("/doctor/patients", { headers: doctorAHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.text.includes("Assigned Patients") || res.text.includes("Active Clinical Cohort"), "Must contain doctor patients content");
    });

    await runTest(7, "Doctor monitor route exists (GET /doctor/monitor)", async () => {
        const res = await request("/doctor/monitor", { headers: doctorAHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.text.includes("Live Monitor") || res.text.includes("Real-Time Telemetry Monitor"), "Must contain monitor content");
    });

    await runTest(8, "Doctor history route exists (GET /doctor/history)", async () => {
        const res = await request("/doctor/history", { headers: doctorAHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.text.includes("Clinical History") || res.text.includes("Historical Telemetry Archives"), "Must contain doctor history content");
    });

    await runTest(9, "Admin overview route exists (GET /admin/overview)", async () => {
        const res = await request("/admin/overview", { headers: adminHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
    });

    await runTest(10, "Admin doctors route exists (GET /admin/doctors)", async () => {
        const res = await request("/admin/doctors", { headers: adminHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
    });

    await runTest(11, "Admin patients route exists (GET /admin/patients)", async () => {
        const res = await request("/admin/patients", { headers: adminHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
    });

    await runTest(12, "Admin devices route exists (GET /admin/devices)", async () => {
        const res = await request("/admin/devices", { headers: adminHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
    });

    await runTest(13, "Admin activity route exists (GET /admin/activity)", async () => {
        const res = await request("/admin/activity", { headers: adminHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
    });

    // ==========================================
    // 2. UNAUTHENTICATED ACCESS (Tests 14-16)
    // ==========================================

    await runTest(14, "Unauthenticated patient page rejected", async () => {
        const res = await request("/patient/overview", { headers: { Accept: "application/json" } });
        assert(res.status === 401, `Expected 401 for API, got ${res.status}`);

        const htmlRes = await request("/patient/overview", { headers: { Accept: "text/html" } });
        assert(htmlRes.status === 302, `Expected 302 redirect for HTML, got ${htmlRes.status}`);
        assert(htmlRes.headers.get("location") === "/login", "Must redirect to /login");
    });

    await runTest(15, "Unauthenticated doctor page rejected", async () => {
        const res = await request("/doctor/overview", { headers: { Accept: "application/json" } });
        assert(res.status === 401, `Expected 401 for API, got ${res.status}`);

        const htmlRes = await request("/doctor/overview", { headers: { Accept: "text/html" } });
        assert(htmlRes.status === 302, `Expected 302 redirect for HTML, got ${htmlRes.status}`);
        assert(htmlRes.headers.get("location") === "/login", "Must redirect to /login");
    });

    await runTest(16, "Unauthenticated admin page rejected", async () => {
        const res = await request("/admin/overview", { headers: { Accept: "application/json" } });
        assert(res.status === 401, `Expected 401 for API, got ${res.status}`);

        const htmlRes = await request("/admin/overview", { headers: { Accept: "text/html" } });
        assert(htmlRes.status === 302, `Expected 302 redirect for HTML, got ${htmlRes.status}`);
        assert(htmlRes.headers.get("location") === "/login", "Must redirect to /login");
    });

    // ==========================================
    // 3. CROSS-ROLE ACCESS (Tests 17-20)
    // ==========================================

    await runTest(17, "Patient cannot access doctor pages", async () => {
        const res = await request("/doctor/overview", { headers: patient1Headers });
        assert(res.status === 403, `Expected 403, got ${res.status}`);
    });

    await runTest(18, "Patient cannot access admin pages", async () => {
        const res = await request("/admin/overview", { headers: patient1Headers });
        assert(res.status === 403, `Expected 403, got ${res.status}`);
    });

    await runTest(19, "Doctor cannot access patient pages", async () => {
        const res = await request("/patient/overview", { headers: doctorAHeaders });
        assert(res.status === 403, `Expected 403, got ${res.status}`);
    });

    await runTest(20, "Doctor cannot access admin pages", async () => {
        const res = await request("/admin/overview", { headers: doctorAHeaders });
        assert(res.status === 403, `Expected 403, got ${res.status}`);
    });

    // ==========================================
    // 4. IDENTITY & SPOOFING DEFENSE (Tests 21-24)
    // ==========================================

    await runTest(21, "Patient identity comes from authenticated context", async () => {
        const res = await request("/patient/overview", { headers: patient1ApiHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.patient.patientId === "PAT-001", `Expected PAT-001, got ${res.data.patient.patientId}`);
    });

    await runTest(22, "Doctor identity comes from authenticated context", async () => {
        const res = await request("/doctor/overview", { headers: doctorAApiHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.doctor.doctorId === "DOC-001", `Expected DOC-001, got ${res.data.doctor.doctorId}`);
    });

    await runTest(23, "Client-supplied patientId cannot bypass patient ownership", async () => {
        const res = await request("/patient/overview?patientId=PAT-002", { headers: patient1ApiHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.patient.patientId === "PAT-001", "Must load authenticated PAT-001, never query param");
    });

    await runTest(24, "Client-supplied doctorId cannot bypass doctor ownership", async () => {
        const res = await request("/doctor/overview?doctorId=DOC-002", { headers: doctorAApiHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.doctor.doctorId === "DOC-001", "Must load authenticated DOC-001, never query param");
    });

    // ==========================================
    // 5. NAVIGATION INTEGRITY (Tests 25-30)
    // ==========================================

    await runTest(25, "Patient navigation URLs are correct", async () => {
        const res = await request("/patient/overview", { headers: patient1Headers });
        assert(res.text.includes('href="/patient/overview"'), "Must link /patient/overview");
        assert(res.text.includes('href="/patient/live"'), "Must link /patient/live");
        assert(res.text.includes('href="/patient/history"'), "Must link /patient/history");
        assert(res.text.includes('href="/patient/profile"'), "Must link /patient/profile");
    });

    await runTest(26, "Doctor navigation URLs are correct", async () => {
        const res = await request("/doctor/overview", { headers: doctorAHeaders });
        assert(res.text.includes('href="/doctor/overview"'), "Must link /doctor/overview");
        assert(res.text.includes('href="/doctor/patients"'), "Must link /doctor/patients");
        assert(res.text.includes('href="/doctor/monitor"'), "Must link /doctor/monitor");
        assert(res.text.includes('href="/doctor/history"'), "Must link /doctor/history");
    });

    await runTest(27, "Admin navigation URLs are correct", async () => {
        const res = await request("/admin/overview", { headers: adminHeaders });
        assert(res.text.includes('href="/admin/overview"'), "Must link /admin/overview");
        assert(res.text.includes('href="/admin/doctors"'), "Must link /admin/doctors");
        assert(res.text.includes('href="/admin/patients"'), "Must link /admin/patients");
        assert(res.text.includes('href="/admin/devices"'), "Must link /admin/devices");
        assert(res.text.includes('href="/admin/activity"'), "Must link /admin/activity");
    });

    await runTest(28, "Active navigation state is correctly highlighted", async () => {
        const resLive = await request("/patient/live", { headers: patient1Headers });
        assert(resLive.text.includes('href="/patient/live" class="active"'), "Live link must be active");

        const resHistory = await request("/doctor/history", { headers: doctorAHeaders });
        assert(resHistory.text.includes('href="/doctor/history" class="active"'), "Doctor history must be active");
    });

    await runTest(29, "Direct URL access works directly", async () => {
        const res = await request("/patient/profile", { headers: patient1Headers });
        assert(res.status === 200, `Expected 200 on direct access, got ${res.status}`);
        assert(res.text.includes("Patient Profile"), "Direct page content rendered");
    });

    await runTest(30, "Legacy dashboard routes safely redirect", async () => {
        const patRoot = await request("/patient", { headers: patient1Headers });
        assert(patRoot.status === 302, `Expected 302, got ${patRoot.status}`);
        assert(patRoot.headers.get("location") === "/patient/overview", "Must redirect /patient -> /patient/overview");

        const docRoot = await request("/doctor", { headers: doctorAHeaders });
        assert(docRoot.status === 302, `Expected 302, got ${docRoot.status}`);
        assert(docRoot.headers.get("location") === "/doctor/overview", "Must redirect /doctor -> /doctor/overview");
    });

    // ==========================================
    // 6. DATA ISOLATION & AUDIT (Tests 31-33)
    // ==========================================

    await runTest(31, "Patient history does not expose another patient's data", async () => {
        const res = await request("/patient/history", { headers: patient1ApiHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        for (const r of res.data.readings) {
            assert(r.patientId === "PAT-001", `Expected PAT-001, found foreign patientId ${r.patientId}`);
        }
    });

    await runTest(32, "Doctor patient page does not expose another doctor's patients", async () => {
        const res = await request("/doctor/patients", { headers: doctorAApiHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        const patientIds = res.data.patients.map((p) => p.patientId);
        assert(patientIds.includes("PAT-001"), "Doctor A must see assigned PAT-001");
        assert(!patientIds.includes("PAT-002"), "Doctor A must NOT see Doctor B's patient PAT-002");
    });

    await runTest(33, "Admin pages remain strictly SUPER_ADMIN-only", async () => {
        const resPat = await request("/admin/overview", { headers: patient1ApiHeaders });
        assert(resPat.status === 403, `Expected 403 for patient, got ${resPat.status}`);

        const resDoc = await request("/admin/overview", { headers: doctorAApiHeaders });
        assert(resDoc.status === 403, `Expected 403 for doctor, got ${resDoc.status}`);

        const resAdmin = await request("/admin/overview", { headers: adminApiHeaders });
        assert(resAdmin.status === 200, `Expected 200 for super admin, got ${resAdmin.status}`);
    });

    // ==========================================
    // 7. REAL-TIME & API PARITY (Tests 34-40)
    // ==========================================

    await runTest(34, "Socket.IO functionality remains operational", async () => {
        const socket = ioClient(socketUrl, {
            transports: ["websocket"],
            forceNew: true,
            auth: { token: patient1Token }
        });

        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Socket timeout")), 3000);
            socket.on("connect", () => {
                clearTimeout(timer);
                socket.disconnect();
                resolve();
            });
            socket.on("connect_error", (e) => {
                clearTimeout(timer);
                reject(e);
            });
        });
    });

    await runTest(35, "Doctor history filters only assigned patients", async () => {
        const res = await request("/doctor/history?patientId=PAT-001", { headers: doctorAApiHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.selectedPatientId === "PAT-001", "Selected patient should be PAT-001");
        for (const r of res.data.readings) {
            assert(r.patientId === "PAT-001", "Reading must belong to PAT-001");
        }
    });

    await runTest(36, "Doctor history with foreign patient ID parameter is safely ignored", async () => {
        const res = await request("/doctor/history?patientId=PAT-002", { headers: doctorAApiHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.selectedPatientId === "ALL", "Foreign patientId must be discarded, defaulting to ALL assigned patients");
        for (const r of res.data.readings) {
            assert(r.patientId !== "PAT-002", "Foreign patient readings must never be returned");
        }
    });

    await runTest(37, "Patient profile strictly excludes sensitive credentials and secrets", async () => {
        const res = await request("/patient/profile", { headers: patient1ApiHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.user.passwordHash === undefined, "passwordHash must never be exposed");
        assert(res.data.user.password === undefined, "password must never be exposed");
        assert(res.data.user.token === undefined, "token must never be exposed");
    });

    await runTest(38, "HTML requests return text/html with valid multi-page shell", async () => {
        const res = await request("/patient/overview", { headers: patient1Headers });
        assert(res.headers.get("content-type").includes("text/html"), "Content-type must be text/html");
        assert(res.text.includes("<!DOCTYPE html>"), "Must be valid HTML document");
        assert(res.text.includes("class=\"app-shell\""), "Must contain app-shell layout container");
    });

    await runTest(39, "JSON API requests return JSON payload with success: true", async () => {
        const res = await request("/patient/overview", { headers: patient1ApiHeaders });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.success === true, "JSON API response must have success: true");
    });

    await runTest(40, "Legacy Phase 3 parameterized routes (/patient/:patientId, /doctor/:doctorId) remain functional", async () => {
        const patLegacy = await request("/patient/PAT-001", { headers: patient1Headers });
        assert(patLegacy.status === 200, `Expected legacy patient route 200, got ${patLegacy.status}`);

        const docLegacy = await request("/doctor/DOC-001", { headers: doctorAHeaders });
        assert(docLegacy.status === 200, `Expected legacy doctor route 200, got ${docLegacy.status}`);
    });

    console.log("\n=================================================");
    console.log(`TEST SUMMARY: ${passedCount}/${passedCount + failedCount} TESTS PASSED`);
    console.log(`FAILED TESTS: ${failedCount}`);
    console.log("=================================================");

    if (failedCount === 0) {
        console.log("PHASE 9 VERIFICATION: SUCCESS\n");
    } else {
        console.error("PHASE 9 VERIFICATION: FAILED\n");
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
