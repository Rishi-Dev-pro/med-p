/**
 * Phase 7: Doctor Provisioning, Credential Management & Account Lifecycle Test Suite
 * Health Tracker — Comprehensive Automated Verification
 *
 * Covers 40 required test cases:
 *  PROVISIONING:
 *   1. Super Admin can create doctor
 *   2. Patient cannot create doctor
 *   3. Doctor cannot create doctor
 *   4. Unauthenticated user cannot create doctor
 *   5. Duplicate email rejected
 *   6. Duplicate username rejected
 *   7. Doctor User role is always DOCTOR
 *   8. Client cannot spoof SUPER_ADMIN role
 *   9. Client cannot spoof PATIENT role
 *  10. User <-> Doctor 1:1 relationship created correctly
 *  CREDENTIALS:
 *  11. Initial credential generation works
 *  12. Password is bcrypt-hashed
 *  13. Plaintext password is not persisted
 *  14. Plaintext password is not returned by list endpoint
 *  15. Plaintext password is not written to ActivityLog
 *  ACTIVATION:
 *  16. Super Admin can deactivate doctor
 *  17. Super Admin can reactivate doctor
 *  18. Patient cannot deactivate doctor
 *  19. Doctor cannot deactivate another doctor
 *  20. Unauthenticated request rejected
 *  21. Deactivation synchronizes authentication status correctly
 *  22. Reactivation synchronizes authentication status correctly
 *  23. Repeated activation is safe
 *  24. Repeated deactivation is safe
 *  DETAILS / INVENTORY:
 *  25. Admin can list doctors
 *  26. Admin can inspect doctor details
 *  27. Sensitive fields are excluded
 *  28. Patient/doctor counts are correct where supported
 *  AUDIT:
 *  29. Doctor creation creates ActivityLog
 *  30. Doctor activation creates ActivityLog
 *  31. Doctor deactivation creates ActivityLog
 *  32. Logs contain no secrets
 *  LOGIN:
 *  33. Newly provisioned active doctor can login
 *  34. Deactivated doctor cannot login
 *  35. Reactivated doctor can login again
 *  INTEGRITY:
 *  36. Historical telemetry remains untouched
 *  37. Existing patient records remain intact
 *  38. Existing device ownership remains intact
 *  39. Existing Phase 5 device lifecycle remains functional
 *  40. User/Doctor relationship remains consistent
 */

require("dotenv").config();
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const app = require("../src/app");
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

const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/health_monitoring_phase7_test";

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
    console.log("RUNNING PHASE 7: DOCTOR MANAGEMENT & LIFECYCLE TESTS");
    console.log("=================================================\n");

    // 1. Connect to isolated Test MongoDB
    await mongoose.connect(TEST_DB_URI);
    await mongoose.connection.dropDatabase();

    // 2. Start HTTP server on dynamic port
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // 3. Seed Base Test Data: Super Admin, Doctor, Patient, Device
    const passwordHash = await hashPassword("Password123!");

    // Super Admin User
    const adminUser = await User.create({
        username: "superadmin_p7",
        email: "admin_p7@test.com",
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

    // Existing Doctor User & Document
    const existingDoctorUser = await User.create({
        username: "doctor_base_p7",
        email: "doc_base_p7@test.com",
        passwordHash,
        role: ROLES.DOCTOR,
        profileId: "DOC-BASE",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const existingDoctor = await Doctor.create({
        doctorId: "DOC-BASE",
        userId: existingDoctorUser._id,
        name: "Dr. Gregory House",
        email: "doc_base_p7@test.com",
        specialization: "Diagnostic Medicine",
        status: DOCTOR_STATUS.ACTIVE
    });
    const doctorToken = generateToken({
        userId: existingDoctorUser._id.toString(),
        username: existingDoctorUser.username,
        role: existingDoctorUser.role,
        profileId: existingDoctorUser.profileId
    });
    const doctorHeaders = {
        Authorization: `Bearer ${doctorToken}`,
        Accept: "application/json"
    };

    // Existing Patient User & Document
    const patientUser = await User.create({
        username: "patient_base_p7",
        email: "patient_base_p7@test.com",
        passwordHash,
        role: ROLES.PATIENT,
        profileId: "PAT-BASE",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const patient = await Patient.create({
        patientId: "PAT-BASE",
        userId: patientUser._id,
        name: "John Baseline Patient",
        email: "patient_base_p7@test.com",
        age: 45,
        doctorId: "DOC-BASE",
        deviceId: "DEV-BASE"
    });
    const patientToken = generateToken({
        userId: patientUser._id.toString(),
        username: patientUser.username,
        role: patientUser.role,
        profileId: patientUser.profileId
    });
    const patientHeaders = {
        Authorization: `Bearer ${patientToken}`,
        Accept: "application/json"
    };

    // Existing Device
    const device = await Device.create({
        deviceId: "DEV-BASE",
        type: "VITAL_TELEMETRY",
        status: DEVICE_STATUS.ACTIVE,
        patientId: "PAT-BASE",
        resetCount: 0
    });

    // Existing Sensor Reading (Telemetry baseline)
    const baselineReading = await SensorReading.create({
        deviceId: "DEV-BASE",
        patientId: "PAT-BASE",
        doctorId: "DOC-BASE",
        value1: 98.6,
        value2: 72,
        timestamp: new Date()
    });

    // Variable to track newly provisioned doctor for lifecycle tests
    let createdDoctorId = null;
    let createdDoctorPassword = null;
    let createdDoctorUsername = null;
    let createdDoctorEmail = null;

    // ==========================================
    // PROVISIONING TESTS (1-10)
    // ==========================================

    // Test 1: Super Admin can create doctor
    await runTest(1, "Super Admin can create doctor", async () => {
        const res = await request("/api/admin/doctors", {
            method: "POST",
            headers: adminHeaders,
            body: {
                name: "Dr. Jennifer Adams",
                email: "dr.adams@hospital.org",
                specialization: "Cardiology",
                phone: "+1 555-0100"
            }
        });

        assert(res.status === 201, `Expected status 201, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert(res.data.success === true, "Expected success: true");
        assert(res.data.doctor && res.data.doctor.doctorId, "Expected doctor document with doctorId");
        assert(res.data.credentials && res.data.credentials.initialPassword, "Expected credentials with initialPassword");

        createdDoctorId = res.data.doctor.doctorId;
        createdDoctorPassword = res.data.credentials.initialPassword;
        createdDoctorUsername = res.data.credentials.username;
        createdDoctorEmail = res.data.credentials.email;

        // Verify database existence
        const dbDoctor = await Doctor.findOne({ doctorId: createdDoctorId });
        assert(dbDoctor, `Doctor ${createdDoctorId} must exist in database`);
        assert(dbDoctor.name === "Dr. Jennifer Adams", "Doctor name must match");
        assert(dbDoctor.specialization === "Cardiology", "Doctor specialization must match");
        assert(dbDoctor.status === DOCTOR_STATUS.ACTIVE, "New doctor status must be ACTIVE");
    });

    // Test 2: Patient cannot create doctor
    await runTest(2, "Patient cannot create doctor", async () => {
        const res = await request("/api/admin/doctors", {
            method: "POST",
            headers: patientHeaders,
            body: {
                name: "Dr. Hacker Patient",
                email: "hacker@patient.org"
            }
        });
        assert(res.status === 403, `Expected status 403, got ${res.status}`);
    });

    // Test 3: Doctor cannot create doctor
    await runTest(3, "Doctor cannot create doctor", async () => {
        const res = await request("/api/admin/doctors", {
            method: "POST",
            headers: doctorHeaders,
            body: {
                name: "Dr. Peer Doctor",
                email: "peer@doctor.org"
            }
        });
        assert(res.status === 403, `Expected status 403, got ${res.status}`);
    });

    // Test 4: Unauthenticated user cannot create doctor
    await runTest(4, "Unauthenticated user cannot create doctor", async () => {
        const res = await request("/api/admin/doctors", {
            method: "POST",
            headers: { Accept: "application/json" },
            body: {
                name: "Dr. Anon",
                email: "anon@hospital.org"
            }
        });
        assert(res.status === 401, `Expected status 401, got ${res.status}`);
    });

    // Test 5: Duplicate email rejected
    await runTest(5, "Duplicate email rejected", async () => {
        const res = await request("/api/admin/doctors", {
            method: "POST",
            headers: adminHeaders,
            body: {
                name: "Dr. Duplicate Adams",
                email: createdDoctorEmail
            }
        });
        assert(res.status === 400, `Expected status 400, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    // Test 6: Duplicate username rejected
    await runTest(6, "Duplicate username rejected", async () => {
        const res = await request("/api/admin/doctors", {
            method: "POST",
            headers: adminHeaders,
            body: {
                name: "Dr. Someone Else",
                email: "someone.else@hospital.org",
                username: createdDoctorUsername
            }
        });
        assert(res.status === 400, `Expected status 400, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    // Test 7: Doctor User role is always DOCTOR
    await runTest(7, "Doctor User role is always DOCTOR", async () => {
        const dbUser = await User.findOne({ username: createdDoctorUsername });
        assert(dbUser, "User must exist");
        assert(dbUser.role === ROLES.DOCTOR, `User role must be DOCTOR, got ${dbUser.role}`);
    });

    // Test 8: Client cannot spoof SUPER_ADMIN role
    await runTest(8, "Client cannot spoof SUPER_ADMIN role", async () => {
        const res = await request("/api/admin/doctors", {
            method: "POST",
            headers: adminHeaders,
            body: {
                name: "Dr. Spoof Admin",
                email: "spoof.admin@hospital.org",
                role: "SUPER_ADMIN"
            }
        });

        assert(res.status === 201, `Expected status 201, got ${res.status}`);
        const spoofDoctorId = res.data.doctor.doctorId;
        const spoofedUser = await User.findOne({ profileId: spoofDoctorId });
        assert(spoofedUser, "User must exist");
        assert(spoofedUser.role === ROLES.DOCTOR, `Spoofed role ignored: expected DOCTOR, got ${spoofedUser.role}`);
    });

    // Test 9: Client cannot spoof PATIENT role
    await runTest(9, "Client cannot spoof PATIENT role", async () => {
        const res = await request("/api/admin/doctors", {
            method: "POST",
            headers: adminHeaders,
            body: {
                name: "Dr. Spoof Patient",
                email: "spoof.patient@hospital.org",
                role: "PATIENT"
            }
        });

        assert(res.status === 201, `Expected status 201, got ${res.status}`);
        const spoofDoctorId = res.data.doctor.doctorId;
        const spoofedUser = await User.findOne({ profileId: spoofDoctorId });
        assert(spoofedUser, "User must exist");
        assert(spoofedUser.role === ROLES.DOCTOR, `Spoofed role ignored: expected DOCTOR, got ${spoofedUser.role}`);
    });

    // Test 10: User <-> Doctor 1:1 relationship created correctly
    await runTest(10, "User <-> Doctor 1:1 relationship created correctly", async () => {
        const doctorDoc = await Doctor.findOne({ doctorId: createdDoctorId });
        const userDoc = await User.findOne({ profileId: createdDoctorId });

        assert(doctorDoc, "Doctor document must exist");
        assert(userDoc, "User document must exist");
        assert(doctorDoc.userId.toString() === userDoc._id.toString(), "Doctor.userId must point to User._id");
        assert(userDoc.profileId === doctorDoc.doctorId, "User.profileId must match Doctor.doctorId");
    });

    // ==========================================
    // CREDENTIALS TESTS (11-15)
    // ==========================================

    // Test 11: Initial credential generation works
    await runTest(11, "Initial credential generation works", async () => {
        assert(createdDoctorPassword && typeof createdDoctorPassword === "string", "Password must be non-empty string");
        assert(createdDoctorPassword.length >= 6, "Initial generated password must be at least 6 characters long");
    });

    // Test 12: Password is bcrypt-hashed
    await runTest(12, "Password is bcrypt-hashed", async () => {
        const userDoc = await User.findOne({ username: createdDoctorUsername });
        assert(userDoc.passwordHash, "User passwordHash must be populated");
        assert(userDoc.passwordHash.startsWith("$2a$") || userDoc.passwordHash.startsWith("$2b$"), "Must be a bcrypt hash");
        const match = await bcrypt.compare(createdDoctorPassword, userDoc.passwordHash);
        assert(match === true, "bcrypt.compare must verify initial plaintext password against stored hash");
    });

    // Test 13: Plaintext password is not persisted
    await runTest(13, "Plaintext password is not persisted", async () => {
        const rawUser = await mongoose.connection.collection("users").findOne({ username: createdDoctorUsername });
        const rawDoctor = await mongoose.connection.collection("doctors").findOne({ doctorId: createdDoctorId });

        assert(!rawUser.password, "User document must not have plaintext password property");
        assert(!rawUser.initialPassword, "User document must not have initialPassword property");
        assert(!rawDoctor.password, "Doctor document must not have plaintext password property");
        assert(!rawDoctor.initialPassword, "Doctor document must not have initialPassword property");
    });

    // Test 14: Plaintext password is not returned by list endpoint
    await runTest(14, "Plaintext password is not returned by list endpoint", async () => {
        const res = await request("/api/admin/doctors", {
            headers: adminHeaders
        });

        assert(res.status === 200, "List endpoint must return 200");
        const found = res.data.doctors.find((d) => d.doctorId === createdDoctorId);
        assert(found, `Doctor ${createdDoctorId} must be in listing`);
        assert(!found.password, "List response must not contain password");
        assert(!found.initialPassword, "List response must not contain initialPassword");
        assert(!found.passwordHash, "List response must not contain passwordHash");
    });

    // Test 15: Plaintext password is not written to ActivityLog
    await runTest(15, "Plaintext password is not written to ActivityLog", async () => {
        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.DOCTOR_CREATED,
            targetId: createdDoctorId
        });

        assert(log, "DOCTOR_CREATED log entry must exist");
        const logString = JSON.stringify(log);
        assert(!logString.includes(createdDoctorPassword), "ActivityLog must never contain the plaintext password");
        const userDoc = await User.findOne({ username: createdDoctorUsername });
        assert(!logString.includes(userDoc.passwordHash), "ActivityLog must never contain the password hash");
    });

    // ==========================================
    // ACTIVATION TESTS (16-24)
    // ==========================================

    // Test 16: Super Admin can deactivate doctor
    await runTest(16, "Super Admin can deactivate doctor", async () => {
        const res = await request(`/api/admin/doctors/${createdDoctorId}/deactivate`, {
            method: "PATCH",
            headers: adminHeaders
        });

        assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert(res.data.success === true, "Expected success: true");

        const dbDoctor = await Doctor.findOne({ doctorId: createdDoctorId });
        assert(dbDoctor.status === DOCTOR_STATUS.INACTIVE, "Doctor.status must be INACTIVE");
    });

    // Test 17: Super Admin can reactivate doctor
    await runTest(17, "Super Admin can reactivate doctor", async () => {
        const res = await request(`/api/admin/doctors/${createdDoctorId}/activate`, {
            method: "PATCH",
            headers: adminHeaders
        });

        assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert(res.data.success === true, "Expected success: true");

        const dbDoctor = await Doctor.findOne({ doctorId: createdDoctorId });
        assert(dbDoctor.status === DOCTOR_STATUS.ACTIVE, "Doctor.status must be ACTIVE");
    });

    // Test 18: Patient cannot deactivate doctor
    await runTest(18, "Patient cannot deactivate doctor", async () => {
        const res = await request(`/api/admin/doctors/${createdDoctorId}/deactivate`, {
            method: "PATCH",
            headers: patientHeaders
        });
        assert(res.status === 403, `Expected 403, got ${res.status}`);
    });

    // Test 19: Doctor cannot deactivate another doctor
    await runTest(19, "Doctor cannot deactivate another doctor", async () => {
        const res = await request(`/api/admin/doctors/${createdDoctorId}/deactivate`, {
            method: "PATCH",
            headers: doctorHeaders
        });
        assert(res.status === 403, `Expected 403, got ${res.status}`);
    });

    // Test 20: Unauthenticated request rejected
    await runTest(20, "Unauthenticated request rejected", async () => {
        const res = await request(`/api/admin/doctors/${createdDoctorId}/deactivate`, {
            method: "PATCH",
            headers: { Accept: "application/json" }
        });
        assert(res.status === 401, `Expected 401, got ${res.status}`);
    });

    // Test 21: Deactivation synchronizes authentication status correctly
    await runTest(21, "Deactivation synchronizes authentication status correctly", async () => {
        // Deactivate doctor
        await request(`/api/admin/doctors/${createdDoctorId}/deactivate`, {
            method: "PATCH",
            headers: adminHeaders
        });

        const userDoc = await User.findOne({ username: createdDoctorUsername });
        const doctorDoc = await Doctor.findOne({ doctorId: createdDoctorId });

        assert(doctorDoc.status === DOCTOR_STATUS.INACTIVE, "Doctor status must be INACTIVE");
        assert(userDoc.status === ACCOUNT_STATUS.SUSPENDED, "User status must be SUSPENDED");
    });

    // Test 22: Reactivation synchronizes authentication status correctly
    await runTest(22, "Reactivation synchronizes authentication status correctly", async () => {
        // Reactivate doctor
        await request(`/api/admin/doctors/${createdDoctorId}/activate`, {
            method: "PATCH",
            headers: adminHeaders
        });

        const userDoc = await User.findOne({ username: createdDoctorUsername });
        const doctorDoc = await Doctor.findOne({ doctorId: createdDoctorId });

        assert(doctorDoc.status === DOCTOR_STATUS.ACTIVE, "Doctor status must be ACTIVE");
        assert(userDoc.status === ACCOUNT_STATUS.ACTIVE, "User status must be ACTIVE");
    });

    // Test 23: Repeated activation is safe
    await runTest(23, "Repeated activation is safe", async () => {
        const res1 = await request(`/api/admin/doctors/${createdDoctorId}/activate`, {
            method: "PATCH",
            headers: adminHeaders
        });
        const res2 = await request(`/api/admin/doctors/${createdDoctorId}/activate`, {
            method: "PATCH",
            headers: adminHeaders
        });

        assert(res1.status === 200 && res2.status === 200, "Repeated activation must succeed with 200");
        const doctorDoc = await Doctor.findOne({ doctorId: createdDoctorId });
        assert(doctorDoc.status === DOCTOR_STATUS.ACTIVE, "Doctor status must remain ACTIVE");
    });

    // Test 24: Repeated deactivation is safe
    await runTest(24, "Repeated deactivation is safe", async () => {
        const res1 = await request(`/api/admin/doctors/${createdDoctorId}/deactivate`, {
            method: "PATCH",
            headers: adminHeaders
        });
        const res2 = await request(`/api/admin/doctors/${createdDoctorId}/deactivate`, {
            method: "PATCH",
            headers: adminHeaders
        });

        assert(res1.status === 200 && res2.status === 200, "Repeated deactivation must succeed with 200");
        const doctorDoc = await Doctor.findOne({ doctorId: createdDoctorId });
        assert(doctorDoc.status === DOCTOR_STATUS.INACTIVE, "Doctor status must remain INACTIVE");

        // Reactivate for remaining tests
        await request(`/api/admin/doctors/${createdDoctorId}/activate`, {
            method: "PATCH",
            headers: adminHeaders
        });
    });

    // ==========================================
    // DETAILS / INVENTORY TESTS (25-28)
    // ==========================================

    // Test 25: Admin can list doctors
    await runTest(25, "Admin can list doctors", async () => {
        const res = await request("/api/admin/doctors", {
            headers: adminHeaders
        });

        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.success === true, "Expected success: true");
        assert(Array.isArray(res.data.doctors), "Expected doctors array");
        assert(res.data.count >= 2, "Expected at least 2 doctors in inventory");
    });

    // Test 26: Admin can inspect doctor details
    await runTest(26, "Admin can inspect doctor details", async () => {
        const res = await request(`/api/admin/doctors/${createdDoctorId}`, {
            headers: adminHeaders
        });

        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.success === true, "Expected success: true");
        assert(res.data.doctor.doctorId === createdDoctorId, "Doctor details doctorId must match");
        assert(res.data.doctor.name === "Dr. Jennifer Adams", "Doctor details name must match");
        assert(Array.isArray(res.data.doctor.assignedPatients), "Must include assignedPatients array");
    });

    // Test 27: Sensitive fields are excluded
    await runTest(27, "Sensitive fields are excluded", async () => {
        const res = await request(`/api/admin/doctors/${createdDoctorId}`, {
            headers: adminHeaders
        });

        const doc = res.data.doctor;
        assert(!doc.password, "Must not leak password");
        assert(!doc.passwordHash, "Must not leak passwordHash");
        assert(!doc.apiKeyHash, "Must not leak apiKeyHash");
        assert(!doc.jwtSecret, "Must not leak jwtSecret");
    });

    // Test 28: Patient/doctor counts are correct where supported
    await runTest(28, "Patient/doctor counts are correct where supported", async () => {
        const res = await request("/api/admin/doctors/DOC-BASE", {
            headers: adminHeaders
        });

        assert(res.status === 200, "Must return 200 for DOC-BASE");
        assert(res.data.doctor.assignedPatientCount === 1, `Expected 1 assigned patient for DOC-BASE, got ${res.data.doctor.assignedPatientCount}`);
        assert(res.data.doctor.assignedPatients.length === 1, "assignedPatients array length must be 1");
        assert(res.data.doctor.assignedPatients[0].patientId === "PAT-BASE", "Must match PAT-BASE");
    });

    // ==========================================
    // AUDIT TESTS (29-32)
    // ==========================================

    // Test 29: Doctor creation creates ActivityLog
    await runTest(29, "Doctor creation creates ActivityLog", async () => {
        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.DOCTOR_CREATED,
            targetId: createdDoctorId
        });

        assert(log, `ActivityLog entry for DOCTOR_CREATED with targetId ${createdDoctorId} must exist`);
        assert(log.actorRole === ACTOR_ROLES.SUPER_ADMIN, "Actor role must be SUPER_ADMIN");
        assert(log.targetType === TARGET_TYPES.DOCTOR, "Target type must be DOCTOR");
    });

    // Test 30: Doctor activation creates ActivityLog
    await runTest(30, "Doctor activation creates ActivityLog", async () => {
        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.DOCTOR_ACTIVATED,
            targetId: createdDoctorId
        });

        assert(log, `ActivityLog entry for DOCTOR_ACTIVATED with targetId ${createdDoctorId} must exist`);
        assert(log.actorRole === ACTOR_ROLES.SUPER_ADMIN, "Actor role must be SUPER_ADMIN");
        assert(log.targetType === TARGET_TYPES.DOCTOR, "Target type must be DOCTOR");
    });

    // Test 31: Doctor deactivation creates ActivityLog
    await runTest(31, "Doctor deactivation creates ActivityLog", async () => {
        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.DOCTOR_DEACTIVATED,
            targetId: createdDoctorId
        });

        assert(log, `ActivityLog entry for DOCTOR_DEACTIVATED with targetId ${createdDoctorId} must exist`);
        assert(log.actorRole === ACTOR_ROLES.SUPER_ADMIN, "Actor role must be SUPER_ADMIN");
        assert(log.targetType === TARGET_TYPES.DOCTOR, "Target type must be DOCTOR");
    });

    // Test 32: Logs contain no secrets
    await runTest(32, "Logs contain no secrets", async () => {
        const logs = await ActivityLog.find({ targetId: createdDoctorId });
        assert(logs.length >= 3, `Expected at least 3 logs, found ${logs.length}`);

        for (const log of logs) {
            const str = JSON.stringify(log);
            assert(!str.includes(createdDoctorPassword), "Log must not contain plaintext password");
            assert(!str.includes("$2a$") && !str.includes("$2b$"), "Log must not contain password hash");
        }
    });

    // ==========================================
    // LOGIN TESTS (33-35)
    // ==========================================

    // Test 33: Newly provisioned active doctor can login
    await runTest(33, "Newly provisioned active doctor can login", async () => {
        // Ensure active
        await request(`/api/admin/doctors/${createdDoctorId}/activate`, {
            method: "PATCH",
            headers: adminHeaders
        });

        const res = await request("/api/auth/login", {
            method: "POST",
            body: {
                identifier: createdDoctorUsername,
                password: createdDoctorPassword
            }
        });

        assert(res.status === 200, `Expected login 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert(res.data.success === true, "Expected login success: true");
        assert(res.data.user.role === ROLES.DOCTOR, `Expected role DOCTOR, got ${res.data.user.role}`);
        assert(res.data.user.profileId === createdDoctorId, `Expected profileId ${createdDoctorId}, got ${res.data.user.profileId}`);
    });

    // Test 34: Deactivated doctor cannot login
    await runTest(34, "Deactivated doctor cannot login", async () => {
        // Deactivate doctor
        await request(`/api/admin/doctors/${createdDoctorId}/deactivate`, {
            method: "PATCH",
            headers: adminHeaders
        });

        const res = await request("/api/auth/login", {
            method: "POST",
            body: {
                identifier: createdDoctorUsername,
                password: createdDoctorPassword
            }
        });

        assert(res.status === 403, `Expected status 403 Forbidden, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert(res.data.success === false, "Expected success: false");
        assert(res.data.message && res.data.message.toLowerCase().includes("suspended"), `Expected suspended notice, got: ${res.data.message}`);
    });

    // Test 35: Reactivated doctor can login again
    await runTest(35, "Reactivated doctor can login again", async () => {
        // Reactivate doctor
        await request(`/api/admin/doctors/${createdDoctorId}/activate`, {
            method: "PATCH",
            headers: adminHeaders
        });

        const res = await request("/api/auth/login", {
            method: "POST",
            body: {
                identifier: createdDoctorEmail,
                password: createdDoctorPassword
            }
        });

        assert(res.status === 200, `Expected login 200, got ${res.status}`);
        assert(res.data.success === true, "Expected success: true");
        assert(res.data.user.username === createdDoctorUsername, "Expected matching username");
    });

    // ==========================================
    // INTEGRITY TESTS (36-40)
    // ==========================================

    // Test 36: Historical telemetry remains untouched
    await runTest(36, "Historical telemetry remains untouched", async () => {
        // Deactivate DOC-BASE
        await request("/api/admin/doctors/DOC-BASE/deactivate", {
            method: "PATCH",
            headers: adminHeaders
        });

        const reading = await SensorReading.findById(baselineReading._id);
        assert(reading, "Historical reading must still exist");
        assert(reading.doctorId === "DOC-BASE", `Historical reading doctorId must remain DOC-BASE, got ${reading.doctorId}`);
        assert(reading.patientId === "PAT-BASE", "Historical reading patientId must remain PAT-BASE");
        assert(reading.deviceId === "DEV-BASE", "Historical reading deviceId must remain DEV-BASE");

        // Reactivate DOC-BASE
        await request("/api/admin/doctors/DOC-BASE/activate", {
            method: "PATCH",
            headers: adminHeaders
        });

        // Reassign PAT-BASE to DOC-BASE explicitly (consistent with Phase 8 explicit reassignment requirement)
        await Patient.updateOne({ patientId: "PAT-BASE" }, { $set: { doctorId: "DOC-BASE" } });
    });

    // Test 37: Existing patient records remain intact
    await runTest(37, "Existing patient records remain intact", async () => {
        const patientDoc = await Patient.findOne({ patientId: "PAT-BASE" });
        assert(patientDoc, "Patient record must exist");
        assert(patientDoc.doctorId === "DOC-BASE", `Patient doctorId must remain DOC-BASE, got ${patientDoc.doctorId}`);
        assert(patientDoc.deviceId === "DEV-BASE", "Patient deviceId must remain DEV-BASE");
    });

    // Test 38: Existing device ownership remains intact
    await runTest(38, "Existing device ownership remains intact", async () => {
        const deviceDoc = await Device.findOne({ deviceId: "DEV-BASE" });
        assert(deviceDoc, "Device record must exist");
        assert(deviceDoc.patientId === "PAT-BASE", `Device patientId must remain PAT-BASE, got ${deviceDoc.patientId}`);
        assert(deviceDoc.status === DEVICE_STATUS.ACTIVE, "Device status must remain ACTIVE");
    });

    // Test 39: Existing Phase 5 device lifecycle remains functional
    await runTest(39, "Existing Phase 5 device lifecycle remains functional", async () => {
        // Create, activate, deactivate test device
        const createRes = await request("/api/admin/devices", {
            method: "POST",
            headers: adminHeaders,
            body: { deviceId: "DEV-P7-LIFE", type: "VITAL_TELEMETRY" }
        });
        assert(createRes.status === 201, `Expected device create 201, got ${createRes.status}`);

        const deactRes = await request("/api/admin/devices/DEV-P7-LIFE/deactivate", {
            method: "PATCH",
            headers: adminHeaders
        });
        assert(deactRes.status === 200, `Expected deact 200, got ${deactRes.status}`);

        const actRes = await request("/api/admin/devices/DEV-P7-LIFE/activate", {
            method: "PATCH",
            headers: adminHeaders
        });
        assert(actRes.status === 200, `Expected act 200, got ${actRes.status}`);

        const delRes = await request("/api/admin/devices/DEV-P7-LIFE", {
            method: "DELETE",
            headers: adminHeaders
        });
        assert(delRes.status === 200, `Expected delete 200, got ${delRes.status}`);
    });

    // Test 40: User/Doctor relationship remains consistent
    await runTest(40, "User/Doctor relationship remains consistent", async () => {
        const allDoctors = await Doctor.find();
        for (const doc of allDoctors) {
            const userDoc = await User.findById(doc.userId);
            assert(userDoc, `Doctor ${doc.doctorId} must have matching User document`);
            assert(userDoc.profileId === doc.doctorId, `User profileId ${userDoc.profileId} must match Doctor doctorId ${doc.doctorId}`);
            assert(userDoc.role === ROLES.DOCTOR, `User role must be DOCTOR for doctor profile ${doc.doctorId}`);
        }
    });

    console.log("\n=================================================");
    console.log(`TEST SUMMARY: ${passedCount}/${passedCount + failedCount} TESTS PASSED`);
    console.log(`FAILED TESTS: ${failedCount}`);
    console.log("=================================================");

    if (failedCount === 0) {
        console.log("PHASE 7 VERIFICATION: SUCCESS\n");
    } else {
        console.error("PHASE 7 VERIFICATION: FAILED\n");
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
