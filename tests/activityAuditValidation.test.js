/**
 * Phase 13 — Centralized System Activity & Audit Trail Test Suite
 * Health Tracker — Phase 13 Validation
 *
 * Verifies:
 *  1. ActivityLog Schema fields & structure
 *  2. ActivityLog { timestamp: -1 } index
 *  3. ActivityLog { actorId: 1 } index
 *  4. ActivityLog { actorId: 1, timestamp: -1 } compound index
 *  5. ActivityLog { targetId: 1, timestamp: -1 } compound index
 *  6. ActivityLog allows nullable actorId
 *  7. ActivityLog rejects invalid action enum
 *  8. ActivityLog rejects invalid actorRole enum
 *  9. ActivityLog rejects invalid targetType enum
 * 10. logActivity persists with server-generated timestamp
 * 11. logActivity normalizes uppercase values
 * 12. logActivity tolerates null targetId
 * 13. logActivity supports object configuration parameter
 * 14. logActivity recursively sanitizes secrets and passwords
 * 15. AUTH_LOGIN_SUCCESS logged on successful user login
 * 16. AUTH_LOGIN_FAILED logged on incorrect password (no leak)
 * 17. AUTH_LOGIN_FAILED logged on unknown user (actorRole: UNKNOWN)
 * 18. AUTH_LOGIN_FAILED logged on suspended user login
 * 19. PATIENT_REGISTERED & DEVICE_ASSIGNED logged on patient registration
 * 20. AUTH_LOGOUT logged on user logout
 * 21. DOCTOR_CREATED logged on admin doctor creation (no temp password)
 * 22. DOCTOR_ACTIVATED logged on doctor activation
 * 23. DOCTOR_DEACTIVATED logged on doctor deactivation with patient unassignment
 * 24. DOCTOR_REMOVED logged on doctor deletion
 * 25. PATIENT_ASSIGNED logged on initial doctor assignment
 * 26. PATIENT_REASSIGNED logged on doctor transfer (records prev and new IDs)
 * 27. PATIENT_UNASSIGNED logged on explicit unassignment
 * 28. DEVICE_CREATED logged on device inventory addition
 * 29. DEVICE_ACTIVATED logged on device activation
 * 30. DEVICE_DEACTIVATED logged on device deactivation
 * 31. DEVICE_RESET logged on device reset (records resetCount & prev patient)
 * 32. DEVICE_DELETED logged on device decommissioning
 * 33. GET /api/admin/activity requires authentication (401)
 * 34. GET /api/admin/activity rejects DOCTOR role (403)
 * 35. GET /api/admin/activity rejects PATIENT role (403)
 * 36. Super Admin can query activity with pagination
 * 37. Pagination limit is clamped to max 100
 * 38. Action filtering works (?action=DEVICE_RESET)
 * 39. Actor filtering works (?actorId=...)
 * 40. Immutability: PUT, PATCH, DELETE rejected on /api/admin/activity
 * 41. Real-time Socket.IO: Super Admin receives admin-activity event
 * 42. Socket.IO Authorization: Non-admin socket cannot receive admin-activity
 */

const http = require("http");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const ioClient = require("socket.io-client");
const fs = require("fs");
const path = require("path");

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
const { logActivity, sanitizeDetails } = require("../src/utils/activityLogger");

const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/health_monitoring_phase13_test";

// Safety guard: validate that configured test database URI contains 'test'
if (!TEST_DB_URI.toLowerCase().includes("test")) {
    throw new Error("Refusing to run tests: Configured database URI must contain 'test' to prevent destructive cleanup.");
}

let server;
let baseUrl;
let ioServer;
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

// Test Tokens
let adminToken;
let adminUser;
let doctorToken;
let patientToken;

async function setup() {
    console.log("Connecting to test database:", TEST_DB_URI);
    await mongoose.connect(TEST_DB_URI);

    // Validate that the connected database name contains "test" before running destructive cleanup
    const dbName = (mongoose.connection && mongoose.connection.name) || "";
    if (!dbName.toLowerCase().includes("test")) {
        throw new Error(`Refusing destructive cleanup on non-test database: '${dbName}'`);
    }

    // Clean test collections
    await User.deleteMany({});
    await Doctor.deleteMany({});
    await Patient.deleteMany({});
    await Device.deleteMany({});
    await SensorReading.deleteMany({});
    await ActivityLog.deleteMany({});

    // Start HTTP server with Socket.IO
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
            resolve();
        });
    });

    // Seed test users
    const pwdHash = await hashPassword("Password123!");

    adminUser = await User.create({
        username: "admin_tester",
        email: "admin_tester@test.com",
        passwordHash: pwdHash,
        role: ROLES.SUPER_ADMIN,
        status: ACCOUNT_STATUS.ACTIVE,
        profileId: null
    });
    adminToken = generateToken({ userId: adminUser._id, role: ROLES.SUPER_ADMIN, profileId: null });

    const doctorUser = await User.create({
        username: "doctor_tester",
        email: "doctor_tester@test.com",
        passwordHash: pwdHash,
        role: ROLES.DOCTOR,
        status: ACCOUNT_STATUS.ACTIVE,
        profileId: "DOC-T1"
    });
    await Doctor.create({
        doctorId: "DOC-T1",
        userId: doctorUser._id,
        name: "Dr. Tester",
        email: "doctor_tester@test.com",
        specialization: "General Medicine",
        status: DOCTOR_STATUS.ACTIVE
    });
    doctorToken = generateToken({ userId: doctorUser._id, role: ROLES.DOCTOR, profileId: "DOC-T1" });

    const patientUser = await User.create({
        username: "patient_tester",
        email: "patient_tester@test.com",
        passwordHash: pwdHash,
        role: ROLES.PATIENT,
        status: ACCOUNT_STATUS.ACTIVE,
        profileId: "PAT-T1"
    });
    await Patient.create({
        patientId: "PAT-T1",
        userId: patientUser._id,
        name: "Patient Tester",
        email: "patient_tester@test.com",
        age: 30,
        deviceId: null,
        doctorId: null
    });
    patientToken = generateToken({ userId: patientUser._id, role: ROLES.PATIENT, profileId: "PAT-T1" });
}

async function teardown() {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
    if (ioServer) {
        await new Promise((resolve) => ioServer.close(resolve));
    }
    await mongoose.disconnect();
}

async function runAllTests() {
    console.log("=================================================");
    console.log("RUNNING PHASE 13: CENTRALIZED SYSTEM AUDIT TRAIL");
    console.log("=================================================");

    // ------------------------------------------------------------
    // 1. MODEL & INDEX BEHAVIOR (1-9)
    // ------------------------------------------------------------

    await runTest(1, "ActivityLog schema fields & structure", async () => {
        const log = new ActivityLog({
            action: AUDIT_ACTIONS.DEVICE_RESET,
            actorRole: ACTOR_ROLES.SUPER_ADMIN,
            actorId: "admin",
            targetType: TARGET_TYPES.DEVICE,
            targetId: "DEV-001",
            details: { resetCount: 1 }
        });
        const err = log.validateSync();
        assert(!err, "Valid ActivityLog document must pass validation");
        assert(log.details.resetCount === 1, "Details should store arbitrary JSON metadata");
    });

    await runTest(2, "ActivityLog { timestamp: -1 } index is declared", async () => {
        const indexes = ActivityLog.schema.indexes();
        const hasTimestampIndex = indexes.some(([fields]) => fields.timestamp === -1 && Object.keys(fields).length === 1);
        assert(hasTimestampIndex, "ActivityLog must declare { timestamp: -1 } index");
    });

    await runTest(3, "ActivityLog { actorId: 1 } index is declared", async () => {
        const indexes = ActivityLog.schema.indexes();
        const hasActorIndex = indexes.some(([fields]) => fields.actorId === 1 && Object.keys(fields).length === 1);
        assert(hasActorIndex, "ActivityLog must declare { actorId: 1 } index");
    });

    await runTest(4, "ActivityLog { actorId: 1, timestamp: -1 } compound index is declared", async () => {
        const indexes = ActivityLog.schema.indexes();
        const hasCompound = indexes.some(([fields]) => fields.actorId === 1 && fields.timestamp === -1);
        assert(hasCompound, "ActivityLog must declare compound index on { actorId: 1, timestamp: -1 }");
    });

    await runTest(5, "ActivityLog { targetId: 1, timestamp: -1 } compound index is declared", async () => {
        const indexes = ActivityLog.schema.indexes();
        const hasCompound = indexes.some(([fields]) => fields.targetId === 1 && fields.timestamp === -1);
        assert(hasCompound, "ActivityLog must declare compound index on { targetId: 1, timestamp: -1 }");
    });

    await runTest(6, "ActivityLog allows nullable actorId for system/unknown events", async () => {
        const log = new ActivityLog({
            action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
            actorRole: ACTOR_ROLES.UNKNOWN,
            actorId: null,
            targetType: TARGET_TYPES.USER,
            targetId: null,
            details: { method: "username" }
        });
        const err = log.validateSync();
        assert(!err, "ActivityLog with null actorId must pass validation");
    });

    await runTest(7, "ActivityLog rejects invalid action enum", async () => {
        const badLog = new ActivityLog({
            action: "ILLEGAL_MUTATION_EVENT",
            actorRole: ACTOR_ROLES.SUPER_ADMIN,
            targetType: TARGET_TYPES.DEVICE
        });
        const err = badLog.validateSync();
        assert(err && err.errors.action, "Invalid action enum must fail validation");
    });

    await runTest(8, "ActivityLog rejects invalid actorRole enum", async () => {
        const badLog = new ActivityLog({
            action: AUDIT_ACTIONS.DEVICE_RESET,
            actorRole: "UNAUTHORIZED_PIRATE",
            targetType: TARGET_TYPES.DEVICE
        });
        const err = badLog.validateSync();
        assert(err && err.errors.actorRole, "Invalid actorRole enum must fail validation");
    });

    await runTest(9, "ActivityLog rejects invalid targetType enum", async () => {
        const badLog = new ActivityLog({
            action: AUDIT_ACTIONS.DEVICE_RESET,
            actorRole: ACTOR_ROLES.SUPER_ADMIN,
            targetType: "NONEXISTENT_SUBSYSTEM"
        });
        const err = badLog.validateSync();
        assert(err && err.errors.targetType, "Invalid targetType enum must fail validation");
    });

    // ------------------------------------------------------------
    // 2. CENTRALIZED LOGGER BEHAVIOR (10-14)
    // ------------------------------------------------------------

    await runTest(10, "logActivity persists with server-generated timestamp", async () => {
        const before = new Date(Date.now() - 1000);
        const record = await logActivity(
            AUDIT_ACTIONS.DEVICE_RESET,
            ACTOR_ROLES.SUPER_ADMIN,
            "admin_tester",
            TARGET_TYPES.DEVICE,
            "DEV-TST-1",
            { note: "Test logActivity" }
        );
        const after = new Date(Date.now() + 1000);

        assert(record && record._id, "logActivity must return persisted document");
        assert(record.timestamp >= before && record.timestamp <= after, "Timestamp must be server-generated");
    });

    await runTest(11, "logActivity normalizes uppercase values", async () => {
        const record = await logActivity(
            "device_created",
            "super_admin",
            "admin_tester",
            "device",
            "DEV-UPPER"
        );
        assert(record.action === "DEVICE_CREATED", "Action must be normalized to uppercase");
        assert(record.actorRole === "SUPER_ADMIN", "ActorRole must be normalized to uppercase");
        assert(record.targetType === "DEVICE", "TargetType must be normalized to uppercase");
    });

    await runTest(12, "logActivity tolerates null targetId", async () => {
        const record = await logActivity(
            AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
            ACTOR_ROLES.UNKNOWN,
            null,
            TARGET_TYPES.USER,
            null,
            { reason: "test null target" }
        );
        assert(record.targetId === null, "TargetId should remain null");
    });

    await runTest(13, "logActivity supports object configuration parameter", async () => {
        const record = await logActivity({
            action: AUDIT_ACTIONS.DEVICE_ACTIVATED,
            actorRole: ACTOR_ROLES.SUPER_ADMIN,
            actorId: "admin",
            targetType: TARGET_TYPES.DEVICE,
            targetId: "DEV-OBJ",
            details: { configStyle: true }
        });
        assert(record && record.action === AUDIT_ACTIONS.DEVICE_ACTIVATED, "Must support object parameter format");
    });

    await runTest(14, "logActivity recursively sanitizes secrets and passwords", async () => {
        const dirtyDetails = {
            username: "hacker",
            password: "PlainPassword123!",
            passwordHash: "$2a$10$abcdefgh...",
            token: "eyJh...",
            jwt: "secret.jwt",
            apiKey: "super-secret-key",
            nested: {
                cookie: "session=xyz",
                safeValue: "kept"
            }
        };

        const cleaned = sanitizeDetails(dirtyDetails);
        assert(cleaned.password === undefined, "password must be stripped");
        assert(cleaned.passwordHash === undefined, "passwordHash must be stripped");
        assert(cleaned.token === undefined, "token must be stripped");
        assert(cleaned.jwt === undefined, "jwt must be stripped");
        assert(cleaned.apiKey === undefined, "apiKey must be stripped");
        assert(cleaned.nested.cookie === undefined, "nested cookie must be stripped");
        assert(cleaned.nested.safeValue === "kept", "safe values must be preserved");

        const record = await logActivity(
            AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
            ACTOR_ROLES.UNKNOWN,
            null,
            TARGET_TYPES.USER,
            null,
            dirtyDetails
        );
        const recordStr = JSON.stringify(record.details);
        assert(!recordStr.includes("PlainPassword123!"), "Password must never appear in ActivityLog");
        assert(!recordStr.includes("super-secret-key"), "API key must never appear in ActivityLog");
    });

    // ------------------------------------------------------------
    // 3. AUTHENTICATION EVENTS (15-20)
    // ------------------------------------------------------------

    await runTest(15, "AUTH_LOGIN_SUCCESS logged on successful user login", async () => {
        const res = await request("/api/auth/login", {
            method: "POST",
            body: { identifier: "admin_tester", password: "Password123!" }
        });
        assert(res.status === 200, "Login must succeed");

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS,
            "details.username": "admin_tester"
        }).sort({ timestamp: -1 });

        assert(log, "AUTH_LOGIN_SUCCESS ActivityLog must exist");
        assert(log.actorRole === ROLES.SUPER_ADMIN, "Actor role must be SUPER_ADMIN");
    });

    await runTest(16, "AUTH_LOGIN_FAILED logged on incorrect password (no leak)", async () => {
        const res = await request("/api/auth/login", {
            method: "POST",
            body: { identifier: "admin_tester", password: "WrongSecretPassword!" }
        });
        assert(res.status === 401, "Login must be rejected with 401");

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
            "details.username": "admin_tester",
            "details.reason": "INVALID_PASSWORD"
        }).sort({ timestamp: -1 });

        assert(log, "AUTH_LOGIN_FAILED ActivityLog must exist for bad password");
        const logStr = JSON.stringify(log);
        assert(!logStr.includes("WrongSecretPassword!"), "Bad password must never be logged");
    });

    await runTest(17, "AUTH_LOGIN_FAILED logged on unknown user (actorRole: UNKNOWN)", async () => {
        const res = await request("/api/auth/login", {
            method: "POST",
            body: { identifier: "nonexistent_stranger@hospital.com", password: "Password123!" }
        });
        assert(res.status === 401, "Must return 401");

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
            actorRole: ACTOR_ROLES.UNKNOWN,
            "details.reason": "USER_NOT_FOUND"
        }).sort({ timestamp: -1 });

        assert(log, "AUTH_LOGIN_FAILED with actorRole: UNKNOWN must exist");
    });

    await runTest(18, "AUTH_LOGIN_FAILED logged on suspended user login", async () => {
        const suspendedUser = await User.create({
            username: "suspended_user",
            email: "suspended@test.com",
            passwordHash: await hashPassword("Password123!"),
            role: ROLES.PATIENT,
            status: ACCOUNT_STATUS.SUSPENDED,
            profileId: null
        });

        const res = await request("/api/auth/login", {
            method: "POST",
            body: { identifier: "suspended_user", password: "Password123!" }
        });
        assert(res.status === 403, "Suspended user must be rejected with 403");

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
            targetId: suspendedUser._id.toString(),
            "details.reason": "ACCOUNT_SUSPENDED"
        }).sort({ timestamp: -1 });

        assert(log, "AUTH_LOGIN_FAILED for suspended user must exist");
    });

    await runTest(19, "PATIENT_REGISTERED & DEVICE_ASSIGNED logged on patient registration", async () => {
        // Register an unassigned device first
        await Device.create({
            deviceId: "DEV-REG-1",
            status: DEVICE_STATUS.ACTIVE,
            patientId: null
        });

        const res = await request("/api/auth/register", {
            method: "POST",
            body: {
                name: "New Registered Patient",
                email: "new_patient_reg@test.com",
                password: "Password123!",
                confirmPassword: "Password123!",
                deviceId: "DEV-REG-1",
                age: 28
            }
        });
        assert(res.status === 201, `Registration should return 201, got ${res.status}`);

        const regLog = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.PATIENT_REGISTERED,
            "details.email": "new_patient_reg@test.com"
        });
        assert(regLog, "PATIENT_REGISTERED audit log must exist");

        const devLog = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.DEVICE_ASSIGNED,
            targetId: "DEV-REG-1"
        });
        assert(devLog, "DEVICE_ASSIGNED audit log must exist");
    });

    await runTest(20, "AUTH_LOGOUT logged on user logout", async () => {
        const res = await request("/api/auth/logout", {
            method: "POST",
            headers: { Cookie: `token=${adminToken}` }
        });
        assert(res.status === 200, "Logout must succeed");

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.AUTH_LOGOUT
        }).sort({ timestamp: -1 });

        assert(log, "AUTH_LOGOUT audit log must exist");
    });

    // ------------------------------------------------------------
    // 4. DOCTOR MANAGEMENT EVENTS (21-24)
    // ------------------------------------------------------------

    let createdDoctorId;

    await runTest(21, "DOCTOR_CREATED logged on admin doctor creation (no temp password)", async () => {
        const res = await request("/admin/doctors", {
            method: "POST",
            headers: { Cookie: `token=${adminToken}` },
            body: {
                name: "Dr. Audit Sample",
                email: "dr_audit_sample@test.com",
                specialization: "Cardiology"
            }
        });
        assert(res.status === 201, "Doctor creation must return 201");
        createdDoctorId = res.data.doctor.doctorId;

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.DOCTOR_CREATED,
            targetId: createdDoctorId
        });
        assert(log, "DOCTOR_CREATED audit log must exist");
        assert(log.actorRole === ROLES.SUPER_ADMIN, "Actor role must be SUPER_ADMIN");

        const generatedPassword = res.data && res.data.credentials ? res.data.credentials.initialPassword : null;
        assert(generatedPassword, "Credentials must contain initialPassword");
        const logStr = JSON.stringify(log);
        assert(!logStr.includes(generatedPassword), "Initial password must never appear in ActivityLog");
    });

    await runTest(22, "DOCTOR_ACTIVATED logged on doctor activation", async () => {
        // First deactivate
        await request(`/admin/doctors/${createdDoctorId}/deactivate`, {
            method: "PATCH",
            headers: { Cookie: `token=${adminToken}` }
        });

        // Now activate
        const res = await request(`/admin/doctors/${createdDoctorId}/activate`, {
            method: "PATCH",
            headers: { Cookie: `token=${adminToken}` }
        });
        assert(res.status === 200, "Activation must return 200");

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.DOCTOR_ACTIVATED,
            targetId: createdDoctorId
        }).sort({ timestamp: -1 });

        assert(log, "DOCTOR_ACTIVATED audit log must exist");
    });

    await runTest(23, "DOCTOR_DEACTIVATED logged on doctor deactivation with patient unassignment", async () => {
        // Assign patient to doctor
        await Patient.updateOne({ patientId: "PAT-T1" }, { $set: { doctorId: createdDoctorId } });

        const res = await request(`/admin/doctors/${createdDoctorId}/deactivate`, {
            method: "PATCH",
            headers: { Cookie: `token=${adminToken}` }
        });
        assert(res.status === 200, "Deactivation must return 200");

        const docLog = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.DOCTOR_DEACTIVATED,
            targetId: createdDoctorId
        }).sort({ timestamp: -1 });
        assert(docLog, "DOCTOR_DEACTIVATED audit log must exist");

        const patLog = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.PATIENT_UNASSIGNED,
            targetId: "PAT-T1",
            "details.reason": "DOCTOR_DEACTIVATED"
        });
        assert(patLog, "PATIENT_UNASSIGNED audit log with DOCTOR_DEACTIVATED reason must exist");
    });

    await runTest(24, "DOCTOR_REMOVED logged on doctor deletion", async () => {
        const res = await request(`/admin/doctors/${createdDoctorId}`, {
            method: "DELETE",
            headers: { Cookie: `token=${adminToken}` }
        });
        assert(res.status === 200, "Doctor deletion must return 200");

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.DOCTOR_REMOVED,
            targetId: createdDoctorId
        });
        assert(log, "DOCTOR_REMOVED audit log must exist");
    });

    // ------------------------------------------------------------
    // 5. PATIENT ASSIGNMENT EVENTS (25-27)
    // ------------------------------------------------------------

    await runTest(25, "PATIENT_ASSIGNED logged on initial doctor assignment", async () => {
        const res = await request(`/admin/patients/PAT-T1/assign-doctor`, {
            method: "PATCH",
            headers: { Cookie: `token=${adminToken}` },
            body: { doctorId: "DOC-T1" }
        });
        assert(res.status === 200, `Assignment should return 200, got ${res.status}`);

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.PATIENT_ASSIGNED,
            targetId: "PAT-T1",
            "details.newDoctorId": "DOC-T1"
        }).sort({ timestamp: -1 });
        assert(log, "PATIENT_ASSIGNED audit log must exist");
    });

    await runTest(26, "PATIENT_REASSIGNED logged on doctor transfer", async () => {
        // Provision a second doctor
        const docUser2 = await User.create({
            username: "doctor_tester2",
            email: "doctor_tester2@test.com",
            passwordHash: await hashPassword("Password123!"),
            role: ROLES.DOCTOR,
            status: ACCOUNT_STATUS.ACTIVE,
            profileId: "DOC-T2"
        });
        await Doctor.create({
            doctorId: "DOC-T2",
            userId: docUser2._id,
            name: "Dr. Reassign",
            email: "doctor_tester2@test.com",
            specialization: "Neurology",
            status: DOCTOR_STATUS.ACTIVE
        });

        const res = await request(`/admin/patients/PAT-T1/assign-doctor`, {
            method: "PATCH",
            headers: { Cookie: `token=${adminToken}` },
            body: { doctorId: "DOC-T2" }
        });
        assert(res.status === 200, "Reassignment should return 200");

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.PATIENT_REASSIGNED,
            targetId: "PAT-T1",
            "details.previousDoctorId": "DOC-T1",
            "details.newDoctorId": "DOC-T2"
        });
        assert(log, "PATIENT_REASSIGNED audit log must record previous and new doctor IDs");
    });

    await runTest(27, "PATIENT_UNASSIGNED logged on explicit unassignment", async () => {
        const res = await request(`/admin/patients/PAT-T1/unassign-doctor`, {
            method: "DELETE",
            headers: { Cookie: `token=${adminToken}` }
        });
        assert(res.status === 200, "Unassignment should return 200");

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.PATIENT_UNASSIGNED,
            targetId: "PAT-T1",
            "details.previousDoctorId": "DOC-T2"
        }).sort({ timestamp: -1 });
        assert(log, "PATIENT_UNASSIGNED audit log must exist");
    });

    // ------------------------------------------------------------
    // 6. DEVICE LIFECYCLE EVENTS (28-32)
    // ------------------------------------------------------------

    await runTest(28, "DEVICE_CREATED logged on device inventory addition", async () => {
        const res = await request("/admin/devices", {
            method: "POST",
            headers: { Cookie: `token=${adminToken}` },
            body: { deviceId: "DEV-AUDIT-1", type: "VITAL_TELEMETRY" }
        });
        assert(res.status === 201, "Device creation should return 201");

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.DEVICE_CREATED,
            targetId: "DEV-AUDIT-1"
        });
        assert(log, "DEVICE_CREATED audit log must exist");
    });

    await runTest(29, "DEVICE_ACTIVATED logged on device activation", async () => {
        // Deactivate first
        await request("/admin/devices/DEV-AUDIT-1/deactivate", {
            method: "PATCH",
            headers: { Cookie: `token=${adminToken}` }
        });

        // Activate
        const res = await request("/admin/devices/DEV-AUDIT-1/activate", {
            method: "PATCH",
            headers: { Cookie: `token=${adminToken}` }
        });
        assert(res.status === 200, "Device activation should return 200");

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.DEVICE_ACTIVATED,
            targetId: "DEV-AUDIT-1"
        }).sort({ timestamp: -1 });
        assert(log, "DEVICE_ACTIVATED audit log must exist");
    });

    await runTest(30, "DEVICE_DEACTIVATED logged on device deactivation", async () => {
        const res = await request("/admin/devices/DEV-AUDIT-1/deactivate", {
            method: "PATCH",
            headers: { Cookie: `token=${adminToken}` }
        });
        assert(res.status === 200, "Device deactivation should return 200");

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.DEVICE_DEACTIVATED,
            targetId: "DEV-AUDIT-1"
        }).sort({ timestamp: -1 });
        assert(log, "DEVICE_DEACTIVATED audit log must exist");
    });

    await runTest(31, "DEVICE_RESET logged on device reset (records resetCount & prev patient)", async () => {
        // Activate device and assign to PAT-T1
        await Device.updateOne({ deviceId: "DEV-AUDIT-1" }, { $set: { status: DEVICE_STATUS.ACTIVE, patientId: "PAT-T1" } });
        await Patient.updateOne({ patientId: "PAT-T1" }, { $set: { deviceId: "DEV-AUDIT-1" } });

        const res = await request("/admin/devices/DEV-AUDIT-1/reset", {
            method: "POST",
            headers: { Cookie: `token=${adminToken}` }
        });
        assert(res.status === 200, "Device reset should return 200");

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.DEVICE_RESET,
            targetId: "DEV-AUDIT-1"
        }).sort({ timestamp: -1 });

        assert(log, "DEVICE_RESET audit log must exist");
        assert(log.details.previousPatientId === "PAT-T1", "Must record previousPatientId");
        assert(log.details.resetCount === 1, "Must record resetCount");
    });

    await runTest(32, "DEVICE_DELETED logged on device decommissioning", async () => {
        const res = await request("/admin/devices/DEV-AUDIT-1", {
            method: "DELETE",
            headers: { Cookie: `token=${adminToken}` }
        });
        assert(res.status === 200, "Device deletion should return 200");

        const log = await ActivityLog.findOne({
            action: AUDIT_ACTIONS.DEVICE_DELETED,
            targetId: "DEV-AUDIT-1"
        });
        assert(log, "DEVICE_DELETED audit log must exist");
    });

    // ------------------------------------------------------------
    // 7. ADMIN API AUTHORIZATION & IMMUTABILITY (33-40)
    // ------------------------------------------------------------

    await runTest(33, "GET /api/admin/activity requires authentication (401)", async () => {
        const res = await request("/api/admin/activity");
        assert(res.status === 401, `Expected 401 without token, got ${res.status}`);
    });

    await runTest(34, "GET /api/admin/activity rejects DOCTOR role (403)", async () => {
        const res = await request("/api/admin/activity", {
            headers: { Cookie: `token=${doctorToken}` }
        });
        assert(res.status === 403, `Expected 403 for DOCTOR, got ${res.status}`);
    });

    await runTest(35, "GET /api/admin/activity rejects PATIENT role (403)", async () => {
        const res = await request("/api/admin/activity", {
            headers: { Cookie: `token=${patientToken}` }
        });
        assert(res.status === 403, `Expected 403 for PATIENT, got ${res.status}`);
    });

    await runTest(36, "Super Admin can query activity with pagination", async () => {
        const res = await request("/api/admin/activity?page=1&limit=10", {
            headers: { Cookie: `token=${adminToken}` }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.success === true, "Response must indicate success");
        assert(res.data.pagination, "Response must include pagination metadata");
        assert(res.data.pagination.page === 1, "Page must be 1");
        assert(res.data.pagination.limit === 10, "Limit must be 10");
        assert(res.data.pagination.total > 0, "Total count must be > 0");
        assert(Array.isArray(res.data.activities), "Activities must be an array");
    });

    await runTest(37, "Pagination limit is clamped to max 100", async () => {
        const res = await request("/api/admin/activity?limit=500", {
            headers: { Cookie: `token=${adminToken}` }
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data.pagination.limit === 100, `Limit must be clamped to 100, got ${res.data.pagination.limit}`);
    });

    await runTest(38, "Action filtering works (?action=DEVICE_RESET)", async () => {
        const res = await request("/api/admin/activity?action=DEVICE_RESET", {
            headers: { Cookie: `token=${adminToken}` }
        });
        assert(res.status === 200, "Should return 200");
        assert(res.data.activities.length > 0, "Should find at least 1 DEVICE_RESET event");
        const allMatch = res.data.activities.every(a => a.action === "DEVICE_RESET");
        assert(allMatch, "All returned activities must match the action filter");
    });

    await runTest(39, "Actor filtering works (?actorId=...)", async () => {
        const res = await request(`/api/admin/activity?actorId=${adminUser._id.toString()}`, {
            headers: { Cookie: `token=${adminToken}` }
        });
        assert(res.status === 200, "Should return 200");
        assert(res.data.activities.length > 0, "Should find activities by admin user ID");
        const allMatch = res.data.activities.every(a => a.actorId === adminUser._id.toString());
        assert(allMatch, "All returned activities must match the actorId filter");
    });

    await runTest(40, "Immutability: PUT, PATCH, DELETE rejected on /api/admin/activity", async () => {
        const putRes = await request("/api/admin/activity/any-id", {
            method: "PUT",
            headers: { Cookie: `token=${adminToken}` },
            body: { action: "HACKED" }
        });
        assert(putRes.status === 405 || putRes.status === 404, `PUT must be rejected with 405/404, got ${putRes.status}`);

        const patchRes = await request("/api/admin/activity/any-id", {
            method: "PATCH",
            headers: { Cookie: `token=${adminToken}` },
            body: { action: "HACKED" }
        });
        assert(patchRes.status === 405 || patchRes.status === 404, `PATCH must be rejected with 405/404, got ${patchRes.status}`);

        const delRes = await request("/api/admin/activity/any-id", {
            method: "DELETE",
            headers: { Cookie: `token=${adminToken}` }
        });
        assert(delRes.status === 405 || delRes.status === 404, `DELETE must be rejected with 405/404, got ${delRes.status}`);
    });

    // ------------------------------------------------------------
    // 8. REAL-TIME ACTIVITY FEED (41-42)
    // ------------------------------------------------------------

    await runTest(41, "Real-time Socket.IO: Super Admin receives admin-activity event", async () => {
        const adminSocket = ioClient(baseUrl, {
            auth: { token: adminToken },
            transports: ["websocket"]
        });

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Admin socket connection timeout")), 3000);
            adminSocket.on("connect", () => {
                clearTimeout(timeout);
                resolve();
            });
        });

        let receivedActivity = null;
        adminSocket.on("admin-activity", (payload) => {
            if (payload && payload.action === "DEVICE_RESET" && payload.targetId === "DEV-SOCKET-TEST") {
                receivedActivity = payload;
            }
        });

        // Trigger an activity log
        await logActivity(
            AUDIT_ACTIONS.DEVICE_RESET,
            ACTOR_ROLES.SUPER_ADMIN,
            "admin_tester",
            TARGET_TYPES.DEVICE,
            "DEV-SOCKET-TEST",
            { testSocket: true },
            ioServer
        );

        // Wait for real-time delivery
        await new Promise((resolve) => setTimeout(resolve, 500));

        assert(receivedActivity !== null, "Admin socket must receive live admin-activity broadcast");
        assert(receivedActivity.action === "DEVICE_RESET", "Received payload must have correct action");
        assert(receivedActivity.targetId === "DEV-SOCKET-TEST", "Received payload must have correct targetId");

        adminSocket.disconnect();
    });

    await runTest(42, "Socket.IO Authorization: Patient or Doctor cannot receive admin-activity", async () => {
        const doctorSocket = ioClient(baseUrl, {
            auth: { token: doctorToken },
            transports: ["websocket"]
        });

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Doctor socket connection timeout")), 3000);
            doctorSocket.on("connect", () => {
                clearTimeout(timeout);
                resolve();
            });
        });

        let doctorReceivedAdminEvent = false;
        doctorSocket.on("admin-activity", () => {
            doctorReceivedAdminEvent = true;
        });

        // Attempt to illegally join admin:activity room
        doctorSocket.emit("join-room", { room: "admin:activity" }, () => {});

        // Trigger another admin activity
        await logActivity(
            AUDIT_ACTIONS.DEVICE_CREATED,
            ACTOR_ROLES.SUPER_ADMIN,
            "admin_tester",
            TARGET_TYPES.DEVICE,
            "DEV-SECRET-ADMIN",
            { confidential: true },
            ioServer
        );

        await new Promise((resolve) => setTimeout(resolve, 500));

        assert(doctorReceivedAdminEvent === false, "Doctor socket must NOT receive admin-activity events");
        doctorSocket.disconnect();
    });

    console.log("=================================================");
    console.log(`TEST SUMMARY: ${passedCount}/42 TESTS PASSED`);
    console.log(`FAILED TESTS: ${failedCount}`);
    console.log("=================================================");

    if (failedCount > 0) {
        throw new Error(`${failedCount} test(s) failed in Phase 13 validation.`);
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
