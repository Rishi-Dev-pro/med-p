/**
 * Phase 4: Super Admin Portal & Layout Test Suite
 * Health Tracker — Comprehensive Automated Verification
 *
 * Covers all 20 required test cases:
 *  1. Super Admin overview loads (200 OK)
 *  2. Patient cannot access admin overview (403 Forbidden)
 *  3. Doctor cannot access admin overview (403 Forbidden)
 *  4. Unauthenticated admin access is rejected (302 redirect for HTML, 401 for API)
 *  5. Super Admin can access doctors page (200 OK)
 *  6. Super Admin can access patients page (200 OK)
 *  7. Super Admin can access devices page (200 OK)
 *  8. Super Admin can access activity page (200 OK)
 *  9. Admin metrics come from database
 * 10. Patient count is accurate
 * 11. Doctor count is accurate
 * 12. Device count is accurate
 * 13. Active/inactive device metrics are accurate
 * 14. Assigned/unassigned device metrics are accurate
 * 15. Admin pages do not expose password hashes
 * 16. Admin pages do not expose JWTs or server secrets
 * 17. Logout invalidates subsequent admin access
 * 18. Empty collections render safely
 * 19. Navigation routes resolve
 * 20. Existing Phase 3 authorization remains functional
 */

require("dotenv").config();
const http = require("http");
const mongoose = require("mongoose");

const app = require("../src/app");
const User = require("../src/models/User");
const Patient = require("../src/models/Patient");
const Doctor = require("../src/models/Doctor");
const Device = require("../src/models/Device");
const SensorReading = require("../src/models/SensorReading");
const ActivityLog = require("../src/models/ActivityLog");
const { ROLES, ACCOUNT_STATUS, DEVICE_STATUS, AUDIT_ACTIONS, TARGET_TYPES } = require("../src/config/constants");
const { hashPassword, generateToken } = require("../src/utils/authUtils");

const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/health_monitoring_phase4_test";

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
    console.log("RUNNING PHASE 4: SUPER ADMIN PORTAL TEST SUITE");
    console.log("=================================================");

    // 1. Connect to isolated test DB and clean up
    await mongoose.connect(TEST_DB_URI);
    await User.deleteMany({});
    await Patient.deleteMany({});
    await Doctor.deleteMany({});
    await Device.deleteMany({});
    await SensorReading.deleteMany({});
    await ActivityLog.deleteMany({});

    // 2. Start HTTP server on ephemeral port
    server = http.createServer(app);
    await new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });

    // 3. Seed deterministic entities
    const rawPassword = "AdminSecurePass@123";
    const passwordHash = await hashPassword(rawPassword);

    // Super Admin
    const adminUser = await User.create({
        username: "super_admin_test",
        email: "admin_test@healthtracker.org",
        passwordHash,
        role: ROLES.SUPER_ADMIN,
        profileId: null,
        status: ACCOUNT_STATUS.ACTIVE
    });

    // Doctor
    const docUser = await User.create({
        username: "dr_test_smith",
        email: "smith@hospital.org",
        passwordHash,
        role: ROLES.DOCTOR,
        profileId: "DOC-001",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const doctor = await Doctor.create({
        userId: docUser._id,
        doctorId: "DOC-001",
        name: "Dr. Alice Smith",
        specialty: "Cardiology",
        email: "smith@hospital.org",
        status: "ACTIVE"
    });

    // Patients (2 patients: 1 assigned to DOC-001, 1 unassigned)
    const patUser1 = await User.create({
        username: "pat_test_1",
        email: "pat1@patients.org",
        passwordHash,
        role: ROLES.PATIENT,
        profileId: "PAT-001",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const pat1 = await Patient.create({
        userId: patUser1._id,
        patientId: "PAT-001",
        name: "Charlie Brown",
        email: "pat1@patients.org",
        age: 40,
        gender: "male",
        doctorId: "DOC-001",
        deviceId: "DEV-001"
    });

    const patUser2 = await User.create({
        username: "pat_test_2",
        email: "pat2@patients.org",
        passwordHash,
        role: ROLES.PATIENT,
        profileId: "PAT-002",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const pat2 = await Patient.create({
        userId: patUser2._id,
        patientId: "PAT-002",
        name: "Dana White",
        email: "pat2@patients.org",
        age: 28,
        gender: "female",
        doctorId: null,
        deviceId: null
    });

    // Suspended User
    const suspendedUser = await User.create({
        username: "user_suspended",
        email: "suspended@healthtracker.org",
        passwordHash,
        role: ROLES.PATIENT,
        profileId: null,
        status: ACCOUNT_STATUS.SUSPENDED
    });

    // Devices (3 devices: 2 active [1 assigned, 1 unassigned], 1 inactive unassigned)
    await Device.create({
        deviceId: "DEV-001",
        patientId: "PAT-001",
        status: DEVICE_STATUS.ACTIVE,
        type: "ECG_PULSE",
        resetCount: 1
    });
    await Device.create({
        deviceId: "DEV-002",
        patientId: null,
        status: DEVICE_STATUS.ACTIVE,
        type: "PULSE_OX",
        resetCount: 0
    });
    await Device.create({
        deviceId: "DEV-003",
        patientId: null,
        status: DEVICE_STATUS.INACTIVE,
        type: "ECG_PULSE",
        resetCount: 0
    });

    // Sensor Readings (2 readings)
    await SensorReading.create({
        deviceId: "DEV-001",
        patientId: "PAT-001",
        doctorId: "DOC-001",
        value1: 75,
        value2: 98,
        timestamp: new Date()
    });
    await SensorReading.create({
        deviceId: "DEV-001",
        patientId: "PAT-001",
        doctorId: "DOC-001",
        value1: 76,
        value2: 99,
        timestamp: new Date()
    });

    // Activity Log
    await ActivityLog.create({
        action: AUDIT_ACTIONS.SYSTEM_INIT,
        actorId: adminUser._id.toString(),
        actorRole: "SUPER_ADMIN",
        targetId: "SYSTEM",
        targetType: TARGET_TYPES.SYSTEM,
        details: { mode: "automated_test" },
        timestamp: new Date()
    });

    // Generate tokens
    const adminToken = generateToken({
        userId: adminUser._id.toString(),
        username: adminUser.username,
        role: adminUser.role,
        profileId: adminUser.profileId
    });
    const doctorToken = generateToken({
        userId: docUser._id.toString(),
        username: docUser.username,
        role: docUser.role,
        profileId: docUser.profileId
    });
    const patientToken = generateToken({
        userId: patUser1._id.toString(),
        username: patUser1.username,
        role: patUser1.role,
        profileId: patUser1.profileId
    });

    const adminCookie = `token=${adminToken}`;
    const doctorCookie = `token=${doctorToken}`;
    const patientCookie = `token=${patientToken}`;

    // ==========================================
    // EXECUTE 20 TESTS
    // ==========================================

    // Test 1: Super Admin overview loads (200 OK)
    await runTest(1, "Super Admin overview loads (200 OK)", async () => {
        const res = await request("/admin/overview", {
            headers: { Cookie: adminCookie, Accept: "text/html" }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.text.includes("System Overview"), "Expected overview title in HTML");
        assert(res.text.includes("Super Admin Portal"), "Expected branding in HTML");
    });

    // Test 2: Patient cannot access admin overview (403 Forbidden)
    await runTest(2, "Patient cannot access admin overview (403 Forbidden)", async () => {
        const res = await request("/admin/overview", {
            headers: { Cookie: patientCookie, Accept: "text/html" }
        });
        assert(res.status === 403, `Expected 403, got ${res.status}`);
    });

    // Test 3: Doctor cannot access admin overview (403 Forbidden)
    await runTest(3, "Doctor cannot access admin overview (403 Forbidden)", async () => {
        const res = await request("/admin/overview", {
            headers: { Cookie: doctorCookie, Accept: "text/html" }
        });
        assert(res.status === 403, `Expected 403, got ${res.status}`);
    });

    // Test 4: Unauthenticated admin access is rejected
    await runTest(4, "Unauthenticated admin access redirects HTML to /login and returns 401 for API", async () => {
        // HTML browser request -> 302 redirect to /login
        const htmlRes = await request("/admin/overview", {
            headers: { Accept: "text/html" }
        });
        assert(htmlRes.status === 302, `Expected 302 redirect for HTML, got ${htmlRes.status}`);
        assert(htmlRes.headers.get("location") === "/login", "Expected redirect to /login");

        // API request -> 401 Unauthorized JSON
        const apiRes = await request("/admin/overview", {
            headers: { Accept: "application/json" }
        });
        assert(apiRes.status === 401, `Expected 401 for API, got ${apiRes.status}`);
    });

    // Test 5: Super Admin can access doctors page (200 OK)
    await runTest(5, "Super Admin can access doctors directory page", async () => {
        const res = await request("/admin/doctors", {
            headers: { Cookie: adminCookie, Accept: "text/html" }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.text.includes("Doctors Directory"), "Expected Doctors Directory title");
        assert(res.text.includes("Dr. Alice Smith"), "Expected doctor Alice in table");
    });

    // Test 6: Super Admin can access patients page (200 OK)
    await runTest(6, "Super Admin can access patients directory page", async () => {
        const res = await request("/admin/patients", {
            headers: { Cookie: adminCookie, Accept: "text/html" }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.text.includes("Patient Registry"), "Expected Patient Registry title");
        assert(res.text.includes("Charlie Brown"), "Expected patient Charlie in table");
    });

    // Test 7: Super Admin can access devices page (200 OK)
    await runTest(7, "Super Admin can access devices inventory page", async () => {
        const res = await request("/admin/devices", {
            headers: { Cookie: adminCookie, Accept: "text/html" }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.text.includes("Device Inventory"), "Expected Device Inventory title");
        assert(res.text.includes("DEV-001"), "Expected DEV-001 in table");
    });

    // Test 8: Super Admin can access activity page (200 OK)
    await runTest(8, "Super Admin can access activity stream page", async () => {
        const res = await request("/admin/activity", {
            headers: { Cookie: adminCookie, Accept: "text/html" }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.text.includes("System Activity & Audit Trail"), "Expected Activity title");
        assert(res.text.includes("SYSTEM_INIT"), "Expected logged test action");
    });

    // Test 9: Admin metrics come from database
    await runTest(9, "Admin metrics endpoint returns live database aggregations", async () => {
        const res = await request("/admin/overview", {
            headers: { Cookie: adminCookie, Accept: "application/json" }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.success === true, "Expected success: true");
        assert(typeof res.data.metrics === "object", "Expected metrics object");
    });

    // Test 10: Patient count is accurate
    await runTest(10, "Patient count matches database count exactly", async () => {
        const res = await request("/admin/overview", {
            headers: { Cookie: adminCookie, Accept: "application/json" }
        });
        assert(res.data.metrics.totalPatients === 2, `Expected 2 patients, got ${res.data.metrics.totalPatients}`);
    });

    // Test 11: Doctor count is accurate
    await runTest(11, "Doctor count matches database count exactly", async () => {
        const res = await request("/admin/overview", {
            headers: { Cookie: adminCookie, Accept: "application/json" }
        });
        assert(res.data.metrics.totalDoctors === 1, `Expected 1 doctor, got ${res.data.metrics.totalDoctors}`);
    });

    // Test 12: Device count is accurate
    await runTest(12, "Device count matches database count exactly", async () => {
        const res = await request("/admin/overview", {
            headers: { Cookie: adminCookie, Accept: "application/json" }
        });
        assert(res.data.metrics.totalDevices === 3, `Expected 3 devices, got ${res.data.metrics.totalDevices}`);
    });

    // Test 13: Active/inactive device metrics are accurate
    await runTest(13, "Active and inactive device counts match database exactly", async () => {
        const res = await request("/admin/overview", {
            headers: { Cookie: adminCookie, Accept: "application/json" }
        });
        assert(res.data.metrics.activeDevices === 2, `Expected 2 active devices, got ${res.data.metrics.activeDevices}`);
        assert(res.data.metrics.inactiveDevices === 1, `Expected 1 inactive device, got ${res.data.metrics.inactiveDevices}`);
    });

    // Test 14: Assigned/unassigned device metrics are accurate
    await runTest(14, "Assigned and unassigned device counts match database exactly", async () => {
        const res = await request("/admin/overview", {
            headers: { Cookie: adminCookie, Accept: "application/json" }
        });
        assert(res.data.metrics.assignedDevices === 1, `Expected 1 assigned device, got ${res.data.metrics.assignedDevices}`);
        assert(res.data.metrics.unassignedDevices === 2, `Expected 2 unassigned devices, got ${res.data.metrics.unassignedDevices}`);
    });

    // Test 15: Admin pages do not expose password hashes
    await runTest(15, "Admin pages do not leak password hashes in rendered HTML or JSON", async () => {
        const pages = ["/admin/overview", "/admin/doctors", "/admin/patients", "/admin/devices", "/admin/activity"];
        for (const p of pages) {
            const res = await request(p, {
                headers: { Cookie: adminCookie, Accept: "text/html" }
            });
            assert(!res.text.includes(passwordHash), `Page ${p} leaked passwordHash!`);
            assert(!res.text.includes(rawPassword), `Page ${p} leaked rawPassword!`);
        }
    });

    // Test 16: Admin pages do not expose JWTs or server secrets
    await runTest(16, "Admin pages do not leak JWT tokens or JWT_SECRET", async () => {
        const secret = process.env.JWT_SECRET || "default_health_tracker_secret_key_super_secure_phase2";
        const pages = ["/admin/overview", "/admin/doctors", "/admin/patients", "/admin/devices", "/admin/activity"];
        for (const p of pages) {
            const res = await request(p, {
                headers: { Cookie: adminCookie, Accept: "text/html" }
            });
            assert(!res.text.includes(secret), `Page ${p} leaked JWT secret!`);
            assert(!res.text.includes(adminToken), `Page ${p} leaked admin JWT token in HTML body!`);
        }
    });

    // Test 17: Logout invalidates subsequent admin access
    await runTest(17, "Logout clears cookies and subsequent admin access is denied", async () => {
        // Perform logout via /admin/logout
        const logoutRes = await request("/admin/logout", {
            headers: { Cookie: adminCookie }
        });
        assert(logoutRes.status === 302, `Expected 302 redirect on logout, got ${logoutRes.status}`);

        // Check Set-Cookie headers for cleared cookies
        const setCookie = logoutRes.headers.get("set-cookie") || "";
        assert(setCookie.includes("token=;"), "Expected token cookie to be cleared");

        // Subsequent access with cleared cookie headers redirects to /login
        const subsequentRes = await request("/admin/overview", {
            headers: { Cookie: "token=", Accept: "text/html" }
        });
        assert(subsequentRes.status === 302, "Expected 302 redirect to /login after logout");
    });

    // Test 18: Empty collections render safely
    await runTest(18, "Empty collections render clean empty states without crashing", async () => {
        // Temporarily clear records
        await Doctor.deleteMany({});
        await Patient.deleteMany({});
        await Device.deleteMany({});
        await ActivityLog.deleteMany({});

        const docRes = await request("/admin/doctors", {
            headers: { Cookie: adminCookie, Accept: "text/html" }
        });
        assert(docRes.status === 200, "Doctors page failed on empty collection");
        assert(docRes.text.includes("No physicians registered"), "Expected empty state for doctors");

        const patRes = await request("/admin/patients", {
            headers: { Cookie: adminCookie, Accept: "text/html" }
        });
        assert(patRes.status === 200, "Patients page failed on empty collection");
        assert(patRes.text.includes("No patients found"), "Expected empty state for patients");

        const devRes = await request("/admin/devices", {
            headers: { Cookie: adminCookie, Accept: "text/html" }
        });
        assert(devRes.status === 200, "Devices page failed on empty collection");
        assert(devRes.text.includes("No devices found"), "Expected empty state for devices");

        const actRes = await request("/admin/activity", {
            headers: { Cookie: adminCookie, Accept: "text/html" }
        });
        assert(actRes.status === 200, "Activity page failed on empty collection");
        assert(actRes.text.includes("No activity records logged yet"), "Expected empty state for activity");
    });

    // Test 19: Navigation routes resolve
    await runTest(19, "All sidebar navigation routes resolve to active pages", async () => {
        const routes = ["/admin", "/admin/overview", "/admin/doctors", "/admin/patients", "/admin/devices", "/admin/activity"];
        for (const r of routes) {
            const res = await request(r, {
                headers: { Cookie: adminCookie, Accept: "text/html" }
            });
            assert(res.status === 200, `Expected 200 for route ${r}, got ${res.status}`);
        }
    });

    // Test 20: Existing Phase 3 authorization remains functional
    await runTest(20, "Existing Phase 3 authorization and API contracts remain functional", async () => {
        // /api/admin/status succeeds for SUPER_ADMIN
        const adminStatusRes = await request("/api/admin/status", {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert(adminStatusRes.status === 200, `Expected 200, got ${adminStatusRes.status}`);
        assert(adminStatusRes.data.success === true, "Expected success: true");

        // /api/admin/status rejects PATIENT
        const patientStatusRes = await request("/api/admin/status", {
            headers: { Authorization: `Bearer ${patientToken}` }
        });
        assert(patientStatusRes.status === 403, `Expected 403, got ${patientStatusRes.status}`);
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
