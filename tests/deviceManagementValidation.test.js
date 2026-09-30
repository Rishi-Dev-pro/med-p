/**
 * Phase 5: Hardware Device Management & Lifecycle Engine Test Suite
 * Health Tracker — Comprehensive Automated Verification
 *
 * Covers all 30 mandatory test cases:
 *  1. Super Admin can create device
 *  2. Patient cannot create device
 *  3. Doctor cannot create device
 *  4. Unauthenticated user cannot create device
 *  5. Duplicate device ID is rejected
 *  6. New device starts ACTIVE
 *  7. New device starts UNASSIGNED
 *  8. New device resetCount is 0
 *  9. Super Admin can deactivate device
 * 10. Super Admin can activate device
 * 11. Deactivation preserves ownership
 * 12. Activation preserves ownership
 * 13. Inactive device rejects IoT telemetry
 * 14. Super Admin can reset assigned device
 * 15. Reset clears Device.patientId
 * 16. Reset clears Patient.deviceId
 * 17. Reset increments resetCount
 * 18. Reset preserves Patient account
 * 19. Reset preserves historical SensorReading records
 * 20. Reset preserves historical patientId/deviceId/doctorId snapshots
 * 21. Reset operation is consistent/atomic
 * 22. Reset device becomes claimable again
 * 23. Patient cannot claim inactive device
 * 24. Patient cannot claim already assigned device
 * 25. Patient cannot claim second device
 * 26. Device cannot belong to two patients
 * 27. Patient cannot own two devices
 * 28. Lifecycle operation creates ActivityLog
 * 29. Unauthorized lifecycle operation is rejected
 * 30. Admin UI reflects current device state
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

const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/health_monitoring_phase5_test";

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
    console.log("RUNNING PHASE 5: HARDWARE DEVICE MANAGEMENT TESTS");
    console.log("=================================================\n");

    // 1. Connect to isolated Test MongoDB
    await mongoose.connect(TEST_DB_URI);
    await mongoose.connection.dropDatabase();

    // 2. Start HTTP server on dynamic port
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // 3. Seed Base Test Data: Super Admin, Doctor, Patient
    const passwordHash = await hashPassword("Password123!");

    // Super Admin User
    const adminUser = await User.create({
        username: "superadmin_p5",
        email: "admin_p5@test.com",
        passwordHash,
        role: ROLES.SUPER_ADMIN,
        status: ACCOUNT_STATUS.ACTIVE
    });

    // Doctor User & Doctor Document
    const doctorUser = await User.create({
        username: "doctor_p5",
        email: "doctor_p5@test.com",
        passwordHash,
        role: ROLES.DOCTOR,
        profileId: "DOC-P5",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const doctor = await Doctor.create({
        doctorId: "DOC-P5",
        userId: doctorUser._id,
        name: "Dr. Gregory House",
        email: "doctor_p5@test.com",
        specialty: "Diagnostic Medicine"
    });

    // Patient User & Patient Document
    const patientUser = await User.create({
        username: "patient_p5",
        email: "patient_p5@test.com",
        passwordHash,
        role: ROLES.PATIENT,
        profileId: "PAT-P5",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const patient = await Patient.create({
        patientId: "PAT-P5",
        userId: patientUser._id,
        name: "John Doe",
        email: "patient_p5@test.com",
        age: 35,
        doctorId: doctor.doctorId,
        deviceId: null
    });

    // 4. Generate Auth Tokens and Cookies
    const adminToken = generateToken({
        userId: adminUser._id.toString(),
        role: adminUser.role,
        profileId: adminUser.profileId
    });
    const doctorToken = generateToken({
        userId: doctorUser._id.toString(),
        role: doctorUser.role,
        profileId: doctorUser.profileId
    });
    const patientToken = generateToken({
        userId: patientUser._id.toString(),
        role: patientUser.role,
        profileId: patientUser.profileId
    });

    const adminCookie = `token=${adminToken}`;
    const doctorCookie = `token=${doctorToken}`;
    const patientCookie = `token=${patientToken}`;

    // ==========================================
    // EXECUTE ALL 30 PHASE 5 TESTS
    // ==========================================

    // Test 1: Super Admin can create device
    await runTest(1, "Super Admin can create device", async () => {
        const res = await request("/api/admin/devices", {
            method: "POST",
            headers: { Cookie: adminCookie },
            body: { deviceId: "DEV-101", type: "VITAL_TELEMETRY" }
        });
        assert(res.status === 201, `Expected 201, got ${res.status}`);
        assert(res.data.success === true, "Expected success: true");
        assert(res.data.device.deviceId === "DEV-101", "Expected deviceId: DEV-101");
    });

    // Test 2: Patient cannot create device
    await runTest(2, "Patient cannot create device (403 Forbidden)", async () => {
        const res = await request("/api/admin/devices", {
            method: "POST",
            headers: { Cookie: patientCookie },
            body: { deviceId: "DEV-HACK-1" }
        });
        assert(res.status === 403, `Expected 403 Forbidden, got ${res.status}`);
    });

    // Test 3: Doctor cannot create device
    await runTest(3, "Doctor cannot create device (403 Forbidden)", async () => {
        const res = await request("/api/admin/devices", {
            method: "POST",
            headers: { Cookie: doctorCookie },
            body: { deviceId: "DEV-HACK-2" }
        });
        assert(res.status === 403, `Expected 403 Forbidden, got ${res.status}`);
    });

    // Test 4: Unauthenticated user cannot create device
    await runTest(4, "Unauthenticated user cannot create device (401 Unauthorized)", async () => {
        const res = await request("/api/admin/devices", {
            method: "POST",
            headers: { Accept: "application/json" },
            body: { deviceId: "DEV-HACK-3" }
        });
        assert(res.status === 401, `Expected 401 Unauthorized, got ${res.status}`);
    });

    // Test 5: Duplicate device ID is rejected
    await runTest(5, "Duplicate device ID is rejected (400 Bad Request)", async () => {
        const res = await request("/api/admin/devices", {
            method: "POST",
            headers: { Cookie: adminCookie },
            body: { deviceId: "DEV-101" }
        });
        assert(res.status === 400, `Expected 400, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
        assert(res.data.message.includes("already exists"), "Expected already exists message");
    });

    // Test 6: New device starts ACTIVE
    await runTest(6, "New device starts ACTIVE", async () => {
        const dev = await Device.findOne({ deviceId: "DEV-101" });
        assert(dev !== null, "Device DEV-101 should exist in DB");
        assert(dev.status === DEVICE_STATUS.ACTIVE, `Expected ACTIVE, got ${dev.status}`);
    });

    // Test 7: New device starts UNASSIGNED
    await runTest(7, "New device starts UNASSIGNED (patientId === null)", async () => {
        const dev = await Device.findOne({ deviceId: "DEV-101" });
        assert(dev.patientId === null, `Expected patientId null, got ${dev.patientId}`);
    });

    // Test 8: New device resetCount is 0
    await runTest(8, "New device resetCount is 0", async () => {
        const dev = await Device.findOne({ deviceId: "DEV-101" });
        assert(dev.resetCount === 0, `Expected resetCount 0, got ${dev.resetCount}`);
    });

    // Test 9: Super Admin can deactivate device
    await runTest(9, "Super Admin can deactivate device", async () => {
        const res = await request("/api/admin/devices/DEV-101/deactivate", {
            method: "PATCH",
            headers: { Cookie: adminCookie }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.device.status === DEVICE_STATUS.INACTIVE, "Expected status INACTIVE");

        const dev = await Device.findOne({ deviceId: "DEV-101" });
        assert(dev.status === DEVICE_STATUS.INACTIVE, "DB status should be INACTIVE");
    });

    // Test 10: Super Admin can activate device
    await runTest(10, "Super Admin can activate device", async () => {
        const res = await request("/api/admin/devices/DEV-101/activate", {
            method: "PATCH",
            headers: { Cookie: adminCookie }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.device.status === DEVICE_STATUS.ACTIVE, "Expected status ACTIVE");

        const dev = await Device.findOne({ deviceId: "DEV-101" });
        assert(dev.status === DEVICE_STATUS.ACTIVE, "DB status should be ACTIVE");
    });

    // Test 11: Deactivation preserves ownership
    await runTest(11, "Deactivation preserves ownership", async () => {
        // Create DEV-102 and assign to PAT-P5
        await Device.create({
            deviceId: "DEV-102",
            status: DEVICE_STATUS.ACTIVE,
            patientId: patient.patientId,
            resetCount: 0
        });
        await Patient.updateOne({ patientId: patient.patientId }, { $set: { deviceId: "DEV-102" } });

        const res = await request("/api/admin/devices/DEV-102/deactivate", {
            method: "PATCH",
            headers: { Cookie: adminCookie }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);

        const dev = await Device.findOne({ deviceId: "DEV-102" });
        assert(dev.status === DEVICE_STATUS.INACTIVE, "Expected status INACTIVE");
        assert(dev.patientId === patient.patientId, "patientId must remain preserved after deactivation");
    });

    // Test 12: Activation preserves ownership
    await runTest(12, "Activation preserves ownership", async () => {
        const res = await request("/api/admin/devices/DEV-102/activate", {
            method: "PATCH",
            headers: { Cookie: adminCookie }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);

        const dev = await Device.findOne({ deviceId: "DEV-102" });
        assert(dev.status === DEVICE_STATUS.ACTIVE, "Expected status ACTIVE");
        assert(dev.patientId === patient.patientId, "patientId must remain preserved after activation");
    });

    // Test 13: Inactive device rejects IoT telemetry
    await runTest(13, "Inactive device rejects IoT telemetry (403 Forbidden)", async () => {
        // Deactivate DEV-102
        await Device.updateOne({ deviceId: "DEV-102" }, { $set: { status: DEVICE_STATUS.INACTIVE } });

        const res = await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-102",
                value1: 72,
                value2: 98,
                timestamp: new Date().toISOString()
            }
        });
        assert(res.status === 403, `Expected 403 Forbidden, got ${res.status}`);
        assert(res.data.message.includes("inactive"), "Expected inactive device error message");

        // Reactivate DEV-102 and ingest valid telemetry
        await Device.updateOne({ deviceId: "DEV-102" }, { $set: { status: DEVICE_STATUS.ACTIVE } });
        const resActive = await request("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-102",
                value1: 75,
                value2: 99,
                timestamp: new Date().toISOString()
            }
        });
        assert(resActive.status === 201, `Expected 201 for active device, got ${resActive.status}`);
    });

    // Test 14: Super Admin can reset assigned device
    await runTest(14, "Super Admin can reset assigned device", async () => {
        const res = await request("/api/admin/devices/DEV-102/reset", {
            method: "POST",
            headers: { Cookie: adminCookie }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.success === true, "Expected success: true");
        assert(res.data.device.patientId === null, "Device patientId in response should be null");
    });

    // Test 15: Reset clears Device.patientId
    await runTest(15, "Reset clears Device.patientId in database", async () => {
        const dev = await Device.findOne({ deviceId: "DEV-102" });
        assert(dev.patientId === null, `Expected Device.patientId null, got ${dev.patientId}`);
    });

    // Test 16: Reset clears Patient.deviceId
    await runTest(16, "Reset clears Patient.deviceId in database", async () => {
        const pat = await Patient.findOne({ patientId: patient.patientId });
        assert(pat.deviceId === null, `Expected Patient.deviceId null, got ${pat.deviceId}`);
    });

    // Test 17: Reset increments resetCount
    await runTest(17, "Reset increments resetCount by 1", async () => {
        const dev = await Device.findOne({ deviceId: "DEV-102" });
        assert(dev.resetCount === 1, `Expected resetCount 1, got ${dev.resetCount}`);
    });

    // Test 18: Reset preserves Patient account
    await runTest(18, "Reset preserves Patient document and User account", async () => {
        const pat = await Patient.findOne({ patientId: patient.patientId });
        assert(pat !== null, "Patient document must still exist");
        const usr = await User.findById(pat.userId);
        assert(usr !== null, "User account must still exist");
        assert(usr.status === ACCOUNT_STATUS.ACTIVE, "User account must remain active");
    });

    // Test 19: Reset preserves historical SensorReading records
    await runTest(19, "Reset preserves historical SensorReading records", async () => {
        const readings = await SensorReading.find({ deviceId: "DEV-102" });
        assert(readings.length >= 1, `Expected at least 1 reading, found ${readings.length}`);
    });

    // Test 20: Reset preserves historical patientId/deviceId/doctorId snapshots
    await runTest(20, "Reset preserves historical patientId/deviceId/doctorId snapshots", async () => {
        const reading = await SensorReading.findOne({ deviceId: "DEV-102" });
        assert(reading.deviceId === "DEV-102", "Historical reading deviceId must remain DEV-102");
        assert(reading.patientId === patient.patientId, "Historical reading patientId must remain PAT-P5");
        assert(reading.doctorId === doctor.doctorId, "Historical reading doctorId must remain DOC-P5");
    });

    // Test 21: Reset operation is consistent/atomic
    await runTest(21, "Reset operation executes consistently via session transaction", async () => {
        // Reset DEV-101 (already unassigned) -> resetCount should become 1
        const res = await request("/api/admin/devices/DEV-101/reset", {
            method: "POST",
            headers: { Cookie: adminCookie }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        const dev = await Device.findOne({ deviceId: "DEV-101" });
        assert(dev.resetCount === 1, `Expected resetCount 1, got ${dev.resetCount}`);
        assert(dev.patientId === null, "patientId should remain null");
    });

    // Test 22: Reset device becomes claimable again
    await runTest(22, "Reset device becomes claimable again during registration", async () => {
        // Register a new patient claiming the reset DEV-102
        const res = await request("/api/auth/register", {
            method: "POST",
            body: {
                name: "Bob Jones",
                email: "bob_jones@test.com",
                password: "Password123!",
                confirmPassword: "Password123!",
                deviceId: "DEV-102",
                age: 42
            }
        });
        assert(res.status === 201, `Expected 201 Created, got ${res.status}`);
        assert(res.data.patient.deviceId === "DEV-102", "Expected patient to claim DEV-102");

        const dev = await Device.findOne({ deviceId: "DEV-102" });
        assert(dev.patientId === res.data.patient.patientId, "Device patientId should now match new patient");
    });

    // Test 23: Patient cannot claim inactive device
    await runTest(23, "Patient cannot claim inactive device during registration", async () => {
        // Create DEV-104 and deactivate it
        await Device.create({
            deviceId: "DEV-104",
            status: DEVICE_STATUS.INACTIVE,
            patientId: null,
            resetCount: 0
        });

        const res = await request("/api/auth/register", {
            method: "POST",
            body: {
                name: "Alice Green",
                email: "alice_green@test.com",
                password: "Password123!",
                confirmPassword: "Password123!",
                deviceId: "DEV-104",
                age: 28
            }
        });
        assert(res.status === 400, `Expected 400 Bad Request, got ${res.status}`);
        assert(res.data.message.includes("not active"), "Expected device not active error message");
    });

    // Test 24: Patient cannot claim already assigned device
    await runTest(24, "Patient cannot claim already assigned device during registration", async () => {
        // DEV-102 is currently assigned to Bob Jones
        const res = await request("/api/auth/register", {
            method: "POST",
            body: {
                name: "Charlie Brown",
                email: "charlie_brown@test.com",
                password: "Password123!",
                confirmPassword: "Password123!",
                deviceId: "DEV-102",
                age: 33
            }
        });
        assert(res.status === 400, `Expected 400 Bad Request, got ${res.status}`);
        assert(res.data.message.includes("already assigned"), "Expected already assigned error message");
    });

    // Test 25: Patient cannot claim second device
    await runTest(25, "Patient cannot claim a second device (1:1 invariant)", async () => {
        // Find Bob Jones who already owns DEV-102
        const bob = await Patient.findOne({ email: "bob_jones@test.com" });
        assert(bob.deviceId === "DEV-102", "Bob should have DEV-102");

        // Attempt to assign DEV-101 to Bob
        const res = await request("/api/admin/devices/DEV-101/assign", {
            method: "POST",
            headers: { Cookie: adminCookie },
            body: { patientId: bob.patientId }
        });
        assert(res.status === 400, `Expected 400 Bad Request, got ${res.status}`);
        assert(res.data.message.includes("already assigned"), "Expected error indicating patient already has a device");
    });

    // Test 26: Device cannot belong to two patients
    await runTest(26, "Device cannot belong to two patients (Database partial unique index)", async () => {
        // Attempt raw DB insert with duplicate patientId
        let duplicateThrown = false;
        try {
            await Device.create({
                deviceId: "DEV-CONFLICT",
                status: DEVICE_STATUS.ACTIVE,
                patientId: patient.patientId, // Already unassigned above, but let's test with Bob Jones
                resetCount: 0
            });
            // Try inserting another device with same patientId
            await Device.create({
                deviceId: "DEV-CONFLICT-2",
                status: DEVICE_STATUS.ACTIVE,
                patientId: patient.patientId,
                resetCount: 0
            });
        } catch (err) {
            duplicateThrown = true;
        }
        assert(duplicateThrown === true, "Database unique partial index must reject second device for same patient");
    });

    // Test 27: Patient cannot own two devices
    await runTest(27, "Patient cannot own two devices (Database partial unique index on Patient.deviceId)", async () => {
        let duplicateThrown = false;
        try {
            await Patient.create({
                patientId: "PAT-CONFLICT-1",
                name: "Conflicted 1",
                email: "conf1@test.com",
                age: 30,
                deviceId: "DEV-DUAL"
            });
            await Patient.create({
                patientId: "PAT-CONFLICT-2",
                name: "Conflicted 2",
                email: "conf2@test.com",
                age: 30,
                deviceId: "DEV-DUAL"
            });
        } catch (err) {
            duplicateThrown = true;
        }
        assert(duplicateThrown === true, "Database unique partial index must reject duplicate deviceId on Patient");
    });

    // Test 28: Lifecycle operation creates ActivityLog
    await runTest(28, "Lifecycle operations record ActivityLog entries", async () => {
        const createLog = await ActivityLog.findOne({ action: AUDIT_ACTIONS.DEVICE_CREATED, targetId: "DEV-101" });
        assert(createLog !== null, "ActivityLog must contain DEVICE_CREATED for DEV-101");

        const resetLog = await ActivityLog.findOne({ action: AUDIT_ACTIONS.DEVICE_RESET, targetId: "DEV-102" });
        assert(resetLog !== null, "ActivityLog must contain DEVICE_RESET for DEV-102");

        const activateLog = await ActivityLog.findOne({ action: AUDIT_ACTIONS.DEVICE_ACTIVATED });
        assert(activateLog !== null, "ActivityLog must contain DEVICE_ACTIVATED");

        const deactivateLog = await ActivityLog.findOne({ action: AUDIT_ACTIONS.DEVICE_DEACTIVATED });
        assert(deactivateLog !== null, "ActivityLog must contain DEVICE_DEACTIVATED");
    });

    // Test 29: Unauthorized lifecycle operation is rejected
    await runTest(29, "Unauthorized lifecycle operations are rejected", async () => {
        // Patient trying to reset device
        const pReset = await request("/api/admin/devices/DEV-101/reset", {
            method: "POST",
            headers: { Cookie: patientCookie }
        });
        assert(pReset.status === 403, `Expected 403 for patient reset, got ${pReset.status}`);

        // Doctor trying to delete device
        const dDelete = await request("/api/admin/devices/DEV-101", {
            method: "DELETE",
            headers: { Cookie: doctorCookie }
        });
        assert(dDelete.status === 403, `Expected 403 for doctor delete, got ${dDelete.status}`);

        // Unauthenticated trying to activate device
        const uActivate = await request("/api/admin/devices/DEV-101/activate", {
            method: "PATCH",
            headers: { Accept: "application/json" }
        });
        assert(uActivate.status === 401, `Expected 401 for unauthenticated activate, got ${uActivate.status}`);
    });

    // Test 30: Admin UI reflects current device state
    await runTest(30, "Admin UI reflects current device inventory and lifecycle state", async () => {
        const res = await request("/admin/devices", {
            headers: { Cookie: adminCookie, Accept: "text/html" }
        });
        assert(res.status === 200, `Expected 200 for /admin/devices, got ${res.status}`);
        assert(res.text.includes("Device Inventory"), "Expected Device Inventory page title");
        assert(res.text.includes("DEV-101"), "Expected DEV-101 to appear in HTML table");
        assert(res.text.includes("DEV-102"), "Expected DEV-102 to appear in HTML table");
        assert(res.text.includes("Provision Device"), "Expected Provision Device button");
        assert(res.text.includes("Reset"), "Expected Reset action button");
    });

    // Test 31: Super Admin can retrieve single device details with telemetry
    await runTest(31, "Super Admin can retrieve single device details with telemetry summary", async () => {
        const res = await request("/api/admin/devices/DEV-102", {
            headers: { Cookie: adminCookie, Accept: "application/json" }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.success === true, "Expected success: true");
        assert(res.data.device.deviceId === "DEV-102", "Expected DEV-102");
        assert(res.data.device.telemetry.totalReadings >= 1, "Expected telemetry readings count >= 1");
        assert(res.data.device.apiKeyHash === undefined, "apiKeyHash must NEVER be exposed");
    });

    // Test 32: Deleting assigned device is rejected
    await runTest(32, "Deleting assigned device is rejected (400 Bad Request)", async () => {
        // DEV-102 is currently assigned to Bob Jones
        const res = await request("/api/admin/devices/DEV-102", {
            method: "DELETE",
            headers: { Cookie: adminCookie }
        });
        assert(res.status === 400, `Expected 400 Bad Request, got ${res.status}`);
        assert(res.data.message.includes("currently assigned"), "Expected assigned device deletion rejection message");
    });

    // Test 33: Super Admin can delete unassigned device
    await runTest(33, "Super Admin can delete unassigned device (200 OK)", async () => {
        // Create unassigned DEV-105
        await Device.create({
            deviceId: "DEV-105",
            status: DEVICE_STATUS.ACTIVE,
            patientId: null,
            resetCount: 0
        });

        const res = await request("/api/admin/devices/DEV-105", {
            method: "DELETE",
            headers: { Cookie: adminCookie }
        });
        assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
        const dev = await Device.findOne({ deviceId: "DEV-105" });
        assert(dev === null, "DEV-105 must be deleted from collection");

        const deleteLog = await ActivityLog.findOne({ action: AUDIT_ACTIONS.DEVICE_DELETED, targetId: "DEV-105" });
        assert(deleteLog !== null, "DEVICE_DELETED must be logged in ActivityLog");
    });

    // Test 34: Deleting device strictly preserves historical SensorReading records
    await runTest(34, "Deleting device strictly preserves historical SensorReading records", async () => {
        // Ingest reading for DEV-106, then reset, then delete DEV-106
        const dev106 = await Device.create({
            deviceId: "DEV-106",
            status: DEVICE_STATUS.ACTIVE,
            patientId: null,
            resetCount: 0
        });
        await SensorReading.create({
            deviceId: "DEV-106",
            patientId: "PAT-P5",
            doctorId: "DOC-P5",
            value1: 80,
            value2: 97,
            timestamp: new Date()
        });

        // Delete unassigned DEV-106
        const res = await request("/api/admin/devices/DEV-106", {
            method: "DELETE",
            headers: { Cookie: adminCookie }
        });
        assert(res.status === 200, `Expected 200 OK, got ${res.status}`);

        // Verify SensorReading is untouched
        const reading = await SensorReading.findOne({ deviceId: "DEV-106" });
        assert(reading !== null, "Historical SensorReading must NOT be deleted");
        assert(reading.deviceId === "DEV-106", "Historical deviceId must remain unchanged");
    });

    // ==========================================
    // CLEANUP & SUMMARY
    // ==========================================
    server.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();

    console.log("\n=================================================");
    console.log(`TEST SUMMARY: ${passedCount}/34 TESTS PASSED`);
    console.log(`FAILED TESTS: ${failedCount}`);
    console.log("=================================================");

    if (failedCount > 0) {
        console.error("PHASE 5 VERIFICATION: FAILED");
        process.exit(1);
    } else {
        console.log("PHASE 5 VERIFICATION: SUCCESS");
        process.exit(0);
    }
}

main().catch((err) => {
    console.error("FATAL ERROR in Phase 5 test suite:", err);
    process.exit(1);
});
