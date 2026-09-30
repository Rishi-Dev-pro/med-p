/**
 * Phase 2: Authentication & Identity Foundation Test Suite
 * Health Tracker — Comprehensive Automated Verification
 */

require("dotenv").config();
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const User = require("../src/models/User");
const Patient = require("../src/models/Patient");
const Device = require("../src/models/Device");
const ActivityLog = require("../src/models/ActivityLog");
const { ROLES, ACCOUNT_STATUS, DEVICE_STATUS } = require("../src/config/constants");
const { hashPassword, comparePassword, generateToken, verifyToken } = require("../src/utils/authUtils");
const { JWT_SECRET, COOKIE_NAME, getCookieOptions } = require("../src/config/auth");
const { authenticate } = require("../src/middleware/authMiddleware");
const seedAdmin = require("../src/seed/seedAdmin");

// Test database URI to preserve main data
const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/health_monitoring_phase2_test";

let server;
let baseUrl;
let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || "Assertion failed");
    }
}

async function runTest(testName, fn) {
    try {
        await fn();
        console.log(`[PASS] ${testName}`);
        passedCount++;
    } catch (err) {
        console.error(`[FAIL] ${testName}`);
        console.error(`       Error: ${err.message}`);
        failedCount++;
    }
}

// Helper: HTTP request wrapper
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

    const cookies = res.headers.get("set-cookie") || "";

    return {
        status: res.status,
        headers: res.headers,
        data,
        cookies
    };
}

async function main() {
    console.log("=================================================");
    console.log("RUNNING PHASE 2: AUTHENTICATION TEST SUITE");
    console.log("=================================================");

    // Connect to test database
    await mongoose.connect(TEST_DB_URI);
    await User.deleteMany({});
    await Patient.deleteMany({});
    await Device.deleteMany({});
    await ActivityLog.deleteMany({});

    // Start ephemeral server
    await new Promise((resolve) => {
        server = http.createServer(app);
        server.listen(0, "127.0.0.1", () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });

    // -------------------------------------------------------------
    // Test 1: bcrypt password hashing (cost factor >= 10)
    // -------------------------------------------------------------
    await runTest("1. Password Hashing: bcrypt salt rounds >= 10 and secure hash output", async () => {
        const password = "TestPassword@123";
        const hash = await hashPassword(password);
        assert(typeof hash === "string", "Hash should be a string");
        assert(hash.startsWith("$2a$10$") || hash.startsWith("$2b$10$"), "Hash should use cost factor >= 10");
        assert(hash !== password, "Plaintext password must not equal hash");
    });

    // -------------------------------------------------------------
    // Test 2: password comparison (match and non-match)
    // -------------------------------------------------------------
    await runTest("2. Password Comparison: bcrypt.compare verifies correct and rejects wrong password", async () => {
        const password = "ValidSecret@2026";
        const hash = await hashPassword(password);
        const match = await comparePassword(password, hash);
        const nonMatch = await comparePassword("WrongPassword@999", hash);
        assert(match === true, "Valid password must return true");
        assert(nonMatch === false, "Incorrect password must return false");
        assert(await comparePassword("", hash) === false, "Empty password must return false");
    });

    // -------------------------------------------------------------
    // Test 3: Successful patient registration
    // -------------------------------------------------------------
    let createdPatientDeviceId = "DEV-PHASE2-001";
    await runTest("3. Patient Registration: creates User + Patient 1:1, links device, and sets cookie", async () => {
        // Pre-provision device
        await Device.create({
            deviceId: createdPatientDeviceId,
            status: DEVICE_STATUS.ACTIVE,
            patientId: null
        });

        const res = await request("/api/auth/register", {
            method: "POST",
            body: {
                name: "Alice Johnson",
                email: "alice@example.com",
                password: "SecurePassword@123",
                confirmPassword: "SecurePassword@123",
                deviceId: createdPatientDeviceId,
                age: 28
            }
        });

        assert(res.status === 201, `Expected status 201, got ${res.status}`);
        assert(res.data.success === true, "Expected success: true");
        assert(res.data.patient.email === "alice@example.com", "Patient email mismatch");
        assert(res.data.patient.deviceId === createdPatientDeviceId, "Device ID mismatch");
        assert(res.cookies.includes(COOKIE_NAME), "Expected HTTP-only cookie to be set");
        assert(res.cookies.includes("HttpOnly"), "Cookie must contain HttpOnly flag");

        // Verify DB records
        const user = await User.findOne({ email: "alice@example.com" });
        assert(user !== null, "User record must exist");
        assert(user.role === ROLES.PATIENT, "User role must be PATIENT");
        assert(user.profileId === res.data.patient.patientId, "User.profileId must link to patientId");

        const patient = await Patient.findOne({ patientId: res.data.patient.patientId });
        assert(patient !== null, "Patient record must exist");
        assert(patient.userId.toString() === user._id.toString(), "Patient.userId must match User._id");
        assert(patient.doctorId === null, "Patient doctorId must be null for unassigned");

        const device = await Device.findOne({ deviceId: createdPatientDeviceId });
        assert(device.patientId === patient.patientId, "Device.patientId must be linked to patient");
    });

    // -------------------------------------------------------------
    // Test 4: Duplicate email rejection
    // -------------------------------------------------------------
    await runTest("4. Duplicate Email: rejects registration with existing email", async () => {
        const device2 = "DEV-PHASE2-002";
        await Device.create({
            deviceId: device2,
            status: DEVICE_STATUS.ACTIVE,
            patientId: null
        });

        const res = await request("/api/auth/register", {
            method: "POST",
            body: {
                name: "Another Alice",
                email: "alice@example.com", // Duplicate email
                password: "AnotherPassword@123",
                confirmPassword: "AnotherPassword@123",
                deviceId: device2,
                age: 32
            }
        });

        assert(res.status === 400, `Expected status 400, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
        assert(res.data.message.includes("already registered"), "Expected duplicate email error message");
    });

    // -------------------------------------------------------------
    // Test 5: Invalid registration data (short password, bad email, empty fields)
    // -------------------------------------------------------------
    await runTest("5. Invalid Registration Data: validates email format, password length, and required fields", async () => {
        // Missing name
        const res1 = await request("/api/auth/register", {
            method: "POST",
            body: { email: "valid@example.com", password: "Password123", confirmPassword: "Password123", deviceId: "DEV-X" }
        });
        assert(res1.status === 400, "Should reject missing name");

        // Invalid email format
        const res2 = await request("/api/auth/register", {
            method: "POST",
            body: { name: "Bob", email: "invalid-email-no-at", password: "Password123", confirmPassword: "Password123", deviceId: "DEV-X" }
        });
        assert(res2.status === 400, "Should reject invalid email");

        // Password too short (< 6 chars)
        const res3 = await request("/api/auth/register", {
            method: "POST",
            body: { name: "Bob", email: "bob@example.com", password: "123", confirmPassword: "123", deviceId: "DEV-X" }
        });
        assert(res3.status === 400, "Should reject short password");
    });

    // -------------------------------------------------------------
    // Test 6: Password mismatch rejection
    // -------------------------------------------------------------
    await runTest("6. Password Mismatch: rejects registration when password !== confirmPassword", async () => {
        const res = await request("/api/auth/register", {
            method: "POST",
            body: {
                name: "Charlie",
                email: "charlie@example.com",
                password: "Password@123",
                confirmPassword: "DifferentPassword@456",
                deviceId: "DEV-PHASE2-003"
            }
        });
        assert(res.status === 400, "Should return 400 on password mismatch");
        assert(res.data.message.includes("do not match"), "Expected mismatch message");
    });

    // -------------------------------------------------------------
    // Test 7: Invalid device rejection (nonexistent, inactive, already assigned)
    // -------------------------------------------------------------
    await runTest("7. Device Validation: rejects nonexistent, inactive, and already assigned devices", async () => {
        // Nonexistent device
        const res1 = await request("/api/auth/register", {
            method: "POST",
            body: {
                name: "Dan",
                email: "dan@example.com",
                password: "Password@123",
                confirmPassword: "Password@123",
                deviceId: "DEV-NONEXISTENT-999"
            }
        });
        assert(res1.status === 400, "Should reject unregistered device");

        // Inactive device
        await Device.create({
            deviceId: "DEV-INACTIVE-001",
            status: DEVICE_STATUS.INACTIVE,
            patientId: null
        });
        const res2 = await request("/api/auth/register", {
            method: "POST",
            body: {
                name: "Eve",
                email: "eve@example.com",
                password: "Password@123",
                confirmPassword: "Password@123",
                deviceId: "DEV-INACTIVE-001"
            }
        });
        assert(res2.status === 400, "Should reject inactive device");

        // Already assigned device
        const res3 = await request("/api/auth/register", {
            method: "POST",
            body: {
                name: "Frank",
                email: "frank@example.com",
                password: "Password@123",
                confirmPassword: "Password@123",
                deviceId: createdPatientDeviceId // Already claimed in Test 3
            }
        });
        assert(res3.status === 400, "Should reject already assigned device");
    });

    // -------------------------------------------------------------
    // Test 8: Successful login via email, username, and patient name
    // -------------------------------------------------------------
    await runTest("8. Successful Login: authenticates via email, username, and patient name", async () => {
        // Login via email
        const res1 = await request("/api/auth/login", {
            method: "POST",
            body: { identifier: "alice@example.com", password: "SecurePassword@123" }
        });
        assert(res1.status === 200, `Login by email failed with ${res1.status}`);
        assert(res1.data.success === true, "Expected success: true");
        assert(res1.cookies.includes(COOKIE_NAME), "Expected token cookie");

        // Login via username
        const user = await User.findOne({ email: "alice@example.com" });
        const res2 = await request("/api/auth/login", {
            method: "POST",
            body: { identifier: user.username, password: "SecurePassword@123" }
        });
        assert(res2.status === 200, `Login by username failed with ${res2.status}`);

        // Login via patient name
        const res3 = await request("/api/auth/login", {
            method: "POST",
            body: { identifier: "Alice Johnson", password: "SecurePassword@123" }
        });
        assert(res3.status === 200, `Login by patient name failed with ${res3.status}`);
    });

    // -------------------------------------------------------------
    // Test 9: Incorrect password rejection
    // -------------------------------------------------------------
    await runTest("9. Incorrect Password: returns 401 Unauthorized with generic message", async () => {
        const res = await request("/api/auth/login", {
            method: "POST",
            body: { identifier: "alice@example.com", password: "WrongPassword@999" }
        });
        assert(res.status === 401, `Expected 401, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
        assert(res.data.message === "Invalid credentials", "Expected generic invalid credentials message");
    });

    // -------------------------------------------------------------
    // Test 10: Unknown user rejection
    // -------------------------------------------------------------
    await runTest("10. Unknown User: returns 401 Unauthorized for nonexistent accounts", async () => {
        const res = await request("/api/auth/login", {
            method: "POST",
            body: { identifier: "ghost@example.com", password: "AnyPassword123" }
        });
        assert(res.status === 401, `Expected 401, got ${res.status}`);
        assert(res.data.success === false, "Expected success: false");
    });

    // -------------------------------------------------------------
    // Test 11: Suspended user rejection
    // -------------------------------------------------------------
    await runTest("11. Suspended User: rejects authentication with 403 Forbidden", async () => {
        const suspendedUser = await User.create({
            username: "suspended_user",
            email: "suspended@example.com",
            passwordHash: await hashPassword("Password@123"),
            role: ROLES.PATIENT,
            profileId: "PAT-SUSPENDED",
            status: ACCOUNT_STATUS.SUSPENDED
        });

        const res = await request("/api/auth/login", {
            method: "POST",
            body: { identifier: "suspended@example.com", password: "Password@123" }
        });
        assert(res.status === 403, `Expected 403, got ${res.status}`);
        assert(res.data.message.includes("suspended"), "Expected suspension notice");
    });

    // -------------------------------------------------------------
    // Test 12: JWT generation (payload contains minimal claims)
    // -------------------------------------------------------------
    await runTest("12. JWT Generation: token contains only userId, role, profileId", async () => {
        const token = generateToken({
            userId: "64a000000000000000000001",
            role: ROLES.PATIENT,
            profileId: "PAT-001"
        });
        assert(typeof token === "string", "Token must be a string");
        const decoded = jwt.decode(token);
        assert(decoded.userId === "64a000000000000000000001", "userId mismatch");
        assert(decoded.role === ROLES.PATIENT, "role mismatch");
        assert(decoded.profileId === "PAT-001", "profileId mismatch");
        assert(decoded.passwordHash === undefined, "JWT must NEVER contain passwordHash");
        assert(decoded.password === undefined, "JWT must NEVER contain plaintext password");
    });

    // -------------------------------------------------------------
    // Test 13: JWT verification
    // -------------------------------------------------------------
    await runTest("13. JWT Verification: verifyToken succeeds for valid signed token", async () => {
        const testUserId = "64a000000000000000000002";
        const token = generateToken({
            userId: testUserId,
            role: ROLES.DOCTOR,
            profileId: "DOC-001"
        });
        const verified = verifyToken(token);
        assert(verified.userId === testUserId, "Decoded userId mismatch");
        assert(verified.role === ROLES.DOCTOR, "Decoded role mismatch");
    });

    // -------------------------------------------------------------
    // Test 14: Expired / invalid JWT rejection
    // -------------------------------------------------------------
    await runTest("14. Invalid JWT Rejection: verifyToken throws on tampered token", async () => {
        const validToken = generateToken({ userId: "123", role: ROLES.PATIENT });
        const tamperedToken = validToken.slice(0, -6) + "xxxxxx";
        let thrown = false;
        try {
            verifyToken(tamperedToken);
        } catch {
            thrown = true;
        }
        assert(thrown === true, "Tampered token must throw error");
    });

    // -------------------------------------------------------------
    // Test 15: Authentication middleware
    // -------------------------------------------------------------
    await runTest("15. Auth Middleware: attaches req.user and rejects 401 when unauthenticated", async () => {
        // Unauthenticated request
        const resUnauth = await request("/api/auth/me");
        assert(resUnauth.status === 401, "Expected 401 for unauthenticated request");

        // Authenticated request via cookie
        const user = await User.findOne({ email: "alice@example.com" });
        const token = generateToken({ userId: user._id, role: user.role, profileId: user.profileId });

        const resAuth = await request("/api/auth/me", {
            headers: {
                Cookie: `${COOKIE_NAME}=${token}`
            }
        });
        assert(resAuth.status === 200, `Expected 200, got ${resAuth.status}`);
        assert(resAuth.data.user.email === "alice@example.com", "User email mismatch");
        assert(resAuth.data.user.role === ROLES.PATIENT, "User role mismatch");

        // Authenticated request via Bearer header
        const resBearer = await request("/api/auth/me", {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        assert(resBearer.status === 200, `Bearer auth should succeed, got ${resBearer.status}`);
    });

    // -------------------------------------------------------------
    // Test 16: Logout cookie clearing
    // -------------------------------------------------------------
    await runTest("16. Logout: clears authentication cookie without database deletion", async () => {
        const res = await request("/api/auth/logout", { method: "POST" });
        assert(res.status === 200, "Logout must return 200");
        assert(res.data.success === true, "Logout must return success: true");

        // Check Set-Cookie has expiration in the past (cleared)
        const cookieHeader = res.cookies;
        assert(cookieHeader.includes(`${COOKIE_NAME}=;`) || cookieHeader.includes("Expires="), "Cookie must be cleared");

        // Ensure user was not deleted
        const userStillExists = await User.findOne({ email: "alice@example.com" });
        assert(userStillExists !== null, "Logout must NOT delete user");
    });

    // -------------------------------------------------------------
    // Test 17: Password hash never returned in API responses
    // -------------------------------------------------------------
    await runTest("17. Security: password hashes are NEVER exposed in register or login responses", async () => {
        const device3 = "DEV-PHASE2-003";
        await Device.create({ deviceId: device3, status: DEVICE_STATUS.ACTIVE, patientId: null });

        const regRes = await request("/api/auth/register", {
            method: "POST",
            body: {
                name: "George Miller",
                email: "george@example.com",
                password: "SecretPassword@123",
                confirmPassword: "SecretPassword@123",
                deviceId: device3
            }
        });

        const regBodyString = JSON.stringify(regRes.data);
        assert(!regBodyString.includes("passwordHash"), "Register response must NOT contain passwordHash");
        assert(!regBodyString.includes("SecretPassword@123"), "Register response must NOT contain password");

        const loginRes = await request("/api/auth/login", {
            method: "POST",
            body: { identifier: "george@example.com", password: "SecretPassword@123" }
        });

        const loginBodyString = JSON.stringify(loginRes.data);
        assert(!loginBodyString.includes("passwordHash"), "Login response must NOT contain passwordHash");
        assert(!loginBodyString.includes("SecretPassword@123"), "Login response must NOT contain password");
    });

    // -------------------------------------------------------------
    // Test 18: Password hash never logged
    // -------------------------------------------------------------
    await runTest("18. Security: password hashes are never written to logger streams during auth", async () => {
        let loggedText = "";
        const originalLog = console.log;
        console.log = (...args) => {
            loggedText += args.map(String).join(" ") + "\n";
            originalLog(...args);
        };

        try {
            await request("/api/auth/login", {
                method: "POST",
                body: { identifier: "george@example.com", password: "SecretPassword@123" }
            });
        } finally {
            console.log = originalLog;
        }

        assert(!loggedText.includes("SecretPassword@123"), "Logs must never contain plaintext password");
        assert(!loggedText.includes("$2a$10$") && !loggedText.includes("$2b$10$"), "Logs must never contain bcrypt hashes");
    });

    // -------------------------------------------------------------
    // Test 19: Repeated seed does not create duplicate Super Admin (idempotency)
    // -------------------------------------------------------------
    await runTest("19. Seeder Idempotency: seedAdmin creates Super Admin once without duplicates on re-run", async () => {
        // Run seedAdmin once
        const admin1 = await seedAdmin();
        assert(admin1.role === ROLES.SUPER_ADMIN, "Admin role must be SUPER_ADMIN");
        assert(admin1.profileId === null, "Admin profileId must be null");

        // Run seedAdmin second time
        const admin2 = await seedAdmin();
        assert(admin2._id.toString() === admin1._id.toString(), "Re-run must return existing admin");

        // Count total Super Admins
        const adminCount = await User.countDocuments({ role: ROLES.SUPER_ADMIN });
        assert(adminCount === 1, `Expected exactly 1 Super Admin, found ${adminCount}`);
    });

    // -------------------------------------------------------------
    // Test 20: HTTP-only cookie configuration
    // -------------------------------------------------------------
    await runTest("20. Cookie Configuration: httpOnly: true, sameSite: lax, maxAge: 24h, environment-aware secure", async () => {
        const devOptions = getCookieOptions();
        assert(devOptions.httpOnly === true, "Cookie must have httpOnly: true");
        assert(devOptions.sameSite === "lax", "Cookie must have sameSite: lax");
        assert(devOptions.maxAge === 86400000, "Cookie maxAge must be 24 hours (86,400,000 ms)");
        assert(devOptions.secure === false, "Cookie secure must be false in local development");

        // Test production flag
        const oldEnv = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = "production";
            const prodOptions = getCookieOptions();
            assert(prodOptions.secure === true, "Cookie secure must be true in production");
        } finally {
            process.env.NODE_ENV = oldEnv;
        }
    });

    console.log("=================================================");
    console.log(`TEST SUMMARY: ${passedCount}/${passedCount + failedCount} TESTS PASSED`);
    console.log("=================================================");

    // Cleanup and close
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.connection.close();

    if (failedCount > 0) {
        process.exit(1);
    } else {
        console.log("PHASE 2 AUTHENTICATION VERIFICATION: SUCCESS\n");
        process.exit(0);
    }
}

main().catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
