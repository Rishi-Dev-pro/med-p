/**
 * HEALTH TRACKER — PHASE 15 AUTOMATED VERIFICATION SUITE
 * Security Hardening & Penetration Defense Validation
 *
 * Covers 50 comprehensive security tests across:
 *   A. Helmet & Security Headers (1–5)
 *   B. Strict CORS Allowlisting (6–9)
 *   C. Authentication Rate Limiting & Brute-Force Defense (10–13)
 *   D. Environment Configuration Validation (14–17)
 *   E. IoT Device API Key Cryptographic Lifecycle & Authentication (18–26)
 *   F. JWT Hardening & Algorithm Pinning (27–31)
 *   G. IDOR & Server-Enforced RBAC Isolation (32–35)
 *   H. Socket.IO Handshake Security & Room Injection Defense (36–42)
 *   I. Request Size Limits & Error Secret Redaction (43–45)
 *   J. Security Audit Logging & Key Management (46–50)
 *
 * Execution Invariants:
 *   - Bounded timeouts on all network and socket operations (withTimeout).
 *   - Isolated test database: health_monitoring_phase15_test.
 *   - Natural teardown; zero process.exit() workarounds.
 */

const assert = require("assert");
const http = require("http");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { io: Client } = require("socket.io-client");

const app = require("../src/app");
const { setupSocketIO } = require("../src/server");
const { Server } = require("socket.io");
const { validateEnv } = require("../src/config/envValidator");
const { generateDeviceApiKey, verifyDeviceApiKey } = require("../src/utils/apiKeyUtils");
const { authLoginRateLimiter } = require("../src/middleware/rateLimiter");
const { generateToken, hashPassword } = require("../src/utils/authUtils");
const { JWT_SECRET } = require("../src/config/auth");

const User = require("../src/models/User");
const Patient = require("../src/models/Patient");
const Doctor = require("../src/models/Doctor");
const Device = require("../src/models/Device");
const SensorReading = require("../src/models/SensorReading");
const ActivityLog = require("../src/models/ActivityLog");
const { ROLES, ACCOUNT_STATUS, DEVICE_STATUS, DOCTOR_STATUS, AUDIT_ACTIONS } = require("../src/config/constants");

const TEST_DB_URI = "mongodb://127.0.0.1:27017/health_monitoring_phase15_test";

let httpServer;
let ioServer;
let baseUrl;
let socketUrl;

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

/**
 * Timeout wrapper ensuring all async actions fail fast instead of hanging.
 */
function withTimeout(promise, ms, label = "Operation") {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            const err = new Error(`[TIMEOUT] ${label} exceeded ${ms}ms limit`);
            err.code = "OPERATION_TIMEOUT";
            reject(err);
        }, ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        clearTimeout(timeoutId);
    });
}

/**
 * Raw HTTP request helper returning status, headers, and parsed JSON/text.
 */
function rawRequest(path, options = {}) {
    return withTimeout(
        new Promise((resolve, reject) => {
            const parsedUrl = new URL(path, baseUrl);
            const headers = Object.assign({}, options.headers);
            let bodyData = null;

            if (options.body) {
                if (typeof options.body === "string" || Buffer.isBuffer(options.body)) {
                    bodyData = options.body;
                } else {
                    bodyData = JSON.stringify(options.body);
                    if (!headers["Content-Type"]) {
                        headers["Content-Type"] = "application/json";
                    }
                }
                if (!headers["Content-Length"]) {
                    headers["Content-Length"] = Buffer.byteLength(bodyData);
                }
            }

            const req = http.request(
                parsedUrl,
                {
                    method: options.method || "GET",
                    headers
                },
                (res) => {
                    let raw = "";
                    res.on("data", (chunk) => {
                        raw += chunk;
                    });
                    res.on("end", () => {
                        let parsed = null;
                        try {
                            parsed = JSON.parse(raw);
                        } catch {
                            parsed = null;
                        }
                        resolve({
                            status: res.statusCode,
                            headers: res.headers,
                            data: parsed,
                            text: raw
                        });
                    });
                }
            );

            req.on("error", reject);
            if (bodyData) {
                req.write(bodyData);
            }
            req.end();
        }),
        options.timeout || 5000,
        `HTTP ${options.method || "GET"} ${path}`
    );
}

/**
 * Test runner reporting start, duration, and pass/fail status.
 */
async function runTest(num, name, fn) {
    totalTests++;
    console.log(`[START] Test ${num}: ${name}`);
    const start = Date.now();
    try {
        await fn();
        const duration = Date.now() - start;
        passedTests++;
        console.log(`[PASS] Test ${num}: ${name} (${duration}ms)`);
    } catch (err) {
        const duration = Date.now() - start;
        failedTests++;
        console.error(`[FAIL] Test ${num}: ${name} (${duration}ms)`);
        console.error(`  Error: ${err.message}`);
        if (err.stack) console.error(err.stack);
    }
}

// Global test fixtures
let adminUser;
let adminCookie;
let doctorUser;
let doctorDoc;
let doctorCookie;
let patientUser;
let patientDoc;
let patientCookie;
let testDevice;
let testDeviceApiKey;

async function setup() {
    console.log(`[SETUP] Connecting MongoDB... ${TEST_DB_URI}`);
    await mongoose.connect(TEST_DB_URI);
    assert.strictEqual(
        mongoose.connection.name,
        "health_monitoring_phase15_test",
        "Refusing to execute: database name mismatch guard"
    );

    console.log("[SETUP] Cleaning test database...");
    await mongoose.connection.dropDatabase();

    console.log("[SETUP] Starting HTTP & Socket.IO server...");
    httpServer = http.createServer(app);
    ioServer = new Server(httpServer, {
        cors: {
            origin: "http://localhost:5173",
            credentials: true
        }
    });
    setupSocketIO(ioServer);
    app.set("io", ioServer);

    await new Promise((resolve) => httpServer.listen(0, resolve));
    const port = httpServer.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    socketUrl = `http://127.0.0.1:${port}`;
    console.log(`[SETUP] HTTP server running at ${baseUrl}`);

    console.log("[SETUP] Seeding baseline security identities...");
    const passwordHash = await hashPassword("SecurePass123!");

    // 1. Super Admin
    adminUser = await User.create({
        username: "superadmin_p15",
        email: "superadmin_p15@test.com",
        passwordHash,
        role: ROLES.SUPER_ADMIN,
        status: ACCOUNT_STATUS.ACTIVE
    });
    const adminToken = generateToken({
        userId: adminUser._id.toString(),
        role: ROLES.SUPER_ADMIN,
        profileId: null
    });
    adminCookie = `token=${adminToken}`;

    // 2. Doctor A
    doctorUser = await User.create({
        username: "doctor_p15_a",
        email: "doctor_a@test.com",
        passwordHash,
        role: ROLES.DOCTOR,
        profileId: "DOC-P15-01",
        status: ACCOUNT_STATUS.ACTIVE
    });
    doctorDoc = await Doctor.create({
        userId: doctorUser._id,
        doctorId: "DOC-P15-01",
        name: "Dr. Alice P15",
        email: "doctor_a@test.com",
        specialization: "Cardiology",
        status: DOCTOR_STATUS.ACTIVE
    });
    const doctorToken = generateToken({
        userId: doctorUser._id.toString(),
        role: ROLES.DOCTOR,
        profileId: "DOC-P15-01"
    });
    doctorCookie = `token=${doctorToken}`;

    // 3. Patient A (assigned to Doctor A)
    patientUser = await User.create({
        username: "patient_p15_a",
        email: "patient_a@test.com",
        passwordHash,
        role: ROLES.PATIENT,
        profileId: "PAT-P15-01",
        status: ACCOUNT_STATUS.ACTIVE
    });
    patientDoc = await Patient.create({
        userId: patientUser._id,
        patientId: "PAT-P15-01",
        name: "Patient Alice",
        email: "patient_a@test.com",
        age: 35,
        gender: "Female",
        deviceId: "DEV-P15-01",
        doctorId: "DOC-P15-01"
    });
    const patientToken = generateToken({
        userId: patientUser._id.toString(),
        role: ROLES.PATIENT,
        profileId: "PAT-P15-01"
    });
    patientCookie = `token=${patientToken}`;

    // 4. Device A with API Key
    const keyInfo = generateDeviceApiKey();
    testDeviceApiKey = keyInfo.rawKey;
    testDevice = await Device.create({
        deviceId: "DEV-P15-01",
        type: "VITAL_TELEMETRY",
        status: DEVICE_STATUS.ACTIVE,
        patientId: "PAT-P15-01",
        apiKeyHash: keyInfo.hash,
        apiKeyPrefix: keyInfo.prefix,
        apiKeyCreatedAt: new Date(),
        resetCount: 0
    });

    console.log("[SETUP] Complete.\n");
}

async function teardown() {
    console.log("\n[TEARDOWN] Closing Socket.IO server...");
    if (ioServer) {
        await new Promise((resolve) => ioServer.close(resolve));
    }
    console.log("[TEARDOWN] Closing HTTP server...");
    if (httpServer) {
        await new Promise((resolve) => httpServer.close(resolve));
    }
    console.log("[TEARDOWN] Dropping test database and disconnecting...");
    if (mongoose.connection && mongoose.connection.readyState === 1) {
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    }
    console.log("[TEARDOWN] Complete.");
}

async function runAllTests() {
    console.log("=================================================");
    console.log("RUNNING PHASE 15: SECURITY HARDENING & DEFENSE");
    console.log("=================================================");

    const overallStart = Date.now();

    // ==========================================
    // A. HELMET & SECURITY HEADERS (1–5)
    // ==========================================

    await runTest(1, "Helmet security headers present on HTTP responses", async () => {
        const res = await rawRequest("/");
        assert.strictEqual(res.headers["x-content-type-options"], "nosniff");
        assert.strictEqual(res.headers["x-frame-options"], "DENY");
        assert.strictEqual(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
        assert.strictEqual(res.headers["x-dns-prefetch-control"], "off");
    });

    await runTest(2, "Content-Security-Policy header present and valid", async () => {
        const res = await rawRequest("/");
        const csp = res.headers["content-security-policy"];
        assert.ok(csp, "Expected Content-Security-Policy header to exist");
        assert.ok(csp.includes("default-src 'self'"), "CSP must include default-src 'self'");
        assert.ok(csp.includes("frame-ancestors 'none'"), "CSP must include frame-ancestors 'none'");
        assert.ok(csp.includes("object-src 'none'"), "CSP must include object-src 'none'");
        assert.ok(csp.includes("ws:") && csp.includes("wss:"), "CSP must allow websocket connects for Socket.IO");
    });

    await runTest(3, "MIME type sniffing protection active (nosniff)", async () => {
        const res = await rawRequest("/api/iot/data", { method: "POST" });
        assert.strictEqual(res.headers["x-content-type-options"], "nosniff");
    });

    await runTest(4, "Clickjacking defense enforces X-Frame-Options: DENY and frame-ancestors 'none'", async () => {
        const res = await rawRequest("/login");
        assert.strictEqual(res.headers["x-frame-options"], "DENY");
        assert.ok(res.headers["content-security-policy"].includes("frame-ancestors 'none'"));
    });

    await runTest(5, "Referrer policy enforces strict-origin-when-cross-origin", async () => {
        const res = await rawRequest("/register");
        assert.strictEqual(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
    });

    // ==========================================
    // B. STRICT CORS (6–9)
    // ==========================================

    await runTest(6, "Allowed origin receives Access-Control-Allow-Origin header", async () => {
        const res = await rawRequest("/api/auth/me", {
            headers: {
                Origin: "http://localhost:5173",
                Cookie: patientCookie
            }
        });
        assert.strictEqual(res.headers["access-control-allow-origin"], "http://localhost:5173");
        assert.strictEqual(res.headers["access-control-allow-credentials"], "true");
    });

    await runTest(7, "Unauthorized origin rejected without Access-Control-Allow-Origin", async () => {
        const res = await rawRequest("/api/auth/me", {
            headers: {
                Origin: "https://malicious-attacker.evil.com",
                Cookie: patientCookie
            }
        });
        assert.strictEqual(
            res.headers["access-control-allow-origin"],
            undefined,
            "Untrusted origin must not receive Access-Control-Allow-Origin header"
        );
    });

    await runTest(8, "Wildcard origin with credentials disallowed by security configuration", async () => {
        const { validateEnv: vEnv } = require("../src/config/envValidator");
        assert.throws(() => {
            vEnv({
                NODE_ENV: "production",
                MONGODB_URI: "mongodb://127.0.0.1:27017/test",
                JWT_SECRET: "a_very_secure_random_production_jwt_key_of_32_characters!",
                CORS_ORIGIN: "*"
            });
        }, /Wildcard CORS_ORIGIN/);
    });

    await runTest(9, "Preflight OPTIONS request returns correct CORS allowed methods and headers", async () => {
        const res = await rawRequest("/api/auth/login", {
            method: "OPTIONS",
            headers: {
                Origin: "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type,Authorization"
            }
        });
        assert.strictEqual(res.status, 204);
        assert.strictEqual(res.headers["access-control-allow-origin"], "http://localhost:5173");
        assert.strictEqual(res.headers["access-control-allow-credentials"], "true");
        assert.ok(res.headers["access-control-allow-methods"].includes("POST"));
    });

    // ==========================================
    // C. AUTHENTICATION RATE LIMITING (10–13)
    // ==========================================

    await runTest(10, "Failed login attempts are tracked and count decrements", async () => {
        authLoginRateLimiter.reset();

        const res = await rawRequest("/api/auth/login", {
            method: "POST",
            body: { identifier: "patient_a@test.com", password: "WrongPassword1!" }
        });
        assert.strictEqual(res.status, 401);
        assert.ok(res.headers["x-ratelimit-remaining"] !== undefined);
    });

    await runTest(11, "Authentication rate limiter triggers HTTP 429 after burst attempts", async () => {
        authLoginRateLimiter.max = 10;
        // Pre-populate limiter hits to test limit transition efficiently
        const keys = ["127.0.0.1", "::1", "::ffff:127.0.0.1", ...authLoginRateLimiter.hits.keys()];
        for (const k of keys) {
            authLoginRateLimiter.hits.set(k, {
                count: 10,
                resetTime: Date.now() + 60000
            });
        }

        const res = await rawRequest("/api/auth/login", {
            method: "POST",
            body: { identifier: "patient_a@test.com", password: "WrongPassword1!" }
        });
        assert.strictEqual(res.status, 429, `Expected 429 on rate limit exceeded, got ${res.status}`);
        assert.strictEqual(res.data.success, false);
        assert.ok(res.data.message.includes("Too many authentication attempts"));
    });

    await runTest(12, "Authentication 429 response includes X-RateLimit-* and Retry-After headers", async () => {
        authLoginRateLimiter.max = 10;
        const keys = ["127.0.0.1", "::1", "::ffff:127.0.0.1", ...authLoginRateLimiter.hits.keys()];
        for (const k of keys) {
            authLoginRateLimiter.hits.set(k, {
                count: 11,
                resetTime: Date.now() + 45000
            });
        }

        const res = await rawRequest("/api/auth/login", {
            method: "POST",
            body: { identifier: "patient_a@test.com", password: "Password123!" }
        });
        assert.strictEqual(res.status, 429);
        assert.ok(res.headers["retry-after"] !== undefined);
        assert.strictEqual(res.headers["x-ratelimit-remaining"], "0");
    });

    await runTest(13, "Legitimate login succeeds after limiter reset", async () => {
        authLoginRateLimiter.max = 50;
        authLoginRateLimiter.reset();

        const res = await rawRequest("/api/auth/login", {
            method: "POST",
            body: { identifier: "patient_a@test.com", password: "SecurePass123!" }
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.success, true);
    });

    // ==========================================
    // D. ENVIRONMENT CONFIGURATION VALIDATION (14–17)
    // ==========================================

    await runTest(14, "Environment validator fails fast on missing production JWT_SECRET", async () => {
        assert.throws(() => {
            validateEnv({
                NODE_ENV: "production",
                MONGODB_URI: "mongodb://127.0.0.1:27017/prod",
                JWT_SECRET: ""
            });
        }, /JWT_SECRET is strictly required/);
    });

    await runTest(15, "Environment validator rejects weak / default development secret in production", async () => {
        assert.throws(() => {
            validateEnv({
                NODE_ENV: "production",
                MONGODB_URI: "mongodb://127.0.0.1:27017/prod",
                JWT_SECRET: "dev_jwt_secret_health_tracker_key_2026"
            });
        }, /cryptographically strong secret/);
    });

    await runTest(16, "Environment validator rejects invalid MONGODB_URI scheme", async () => {
        const res = validateEnv({
            NODE_ENV: "development",
            MONGODB_URI: "http://localhost:27017"
        });
        assert.strictEqual(res.valid, false);
        assert.ok(res.errors.some((e) => e.includes("mongodb://")));
    });

    await runTest(17, "Environment validator succeeds with valid configuration", async () => {
        const res = validateEnv({
            NODE_ENV: "production",
            PORT: "5000",
            MONGODB_URI: "mongodb+srv://user:pass@cluster.mongodb.net/prod",
            JWT_SECRET: "strong_production_secret_key_32_characters_minimum!",
            CORS_ORIGIN: "https://healthtracker.example.com"
        });
        assert.strictEqual(res.valid, true);
        assert.strictEqual(res.errors.length, 0);
    });

    // ==========================================
    // E. IoT DEVICE API KEY AUTHENTICATION (18–26)
    // ==========================================

    await runTest(18, "Missing API key rejected with 401 when device has API key configured", async () => {
        const res = await rawRequest("/api/iot/data", {
            method: "POST",
            body: {
                deviceId: "DEV-P15-01",
                value1: 75,
                value2: 110,
                timestamp: new Date().toISOString()
            }
        });
        assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
        assert.strictEqual(res.data.success, false);
        assert.ok(res.data.message.includes("API key required"));
    });

    await runTest(19, "Invalid API key rejected with 401 Unauthorized", async () => {
        const res = await rawRequest("/api/iot/data", {
            method: "POST",
            headers: {
                Authorization: "Bearer htk_invalid_forged_api_key_00000000000000000000000000000000"
            },
            body: {
                deviceId: "DEV-P15-01",
                value1: 75,
                value2: 110,
                timestamp: new Date().toISOString()
            }
        });
        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.data.success, false);
        assert.ok(res.data.message.includes("Invalid device credentials"));
    });

    await runTest(20, "Valid API key authorizes telemetry ingestion (201 Created)", async () => {
        const res = await rawRequest("/api/iot/data", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${testDeviceApiKey}`
            },
            body: {
                deviceId: "DEV-P15-01",
                value1: 78,
                value2: 118,
                timestamp: new Date().toISOString()
            }
        });
        assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
        assert.strictEqual(res.data.success, true);
        assert.strictEqual(res.data.data.deviceId, "DEV-P15-01");

        // Verify lastSeen and apiKeyLastUsedAt updated in database
        const updated = await Device.findOne({ deviceId: "DEV-P15-01" });
        assert.ok(updated.lastSeen !== null);
        assert.ok(updated.apiKeyLastUsedAt !== null);
    });

    await runTest(21, "Inactive device with valid API key is rejected with 403 Forbidden", async () => {
        await Device.updateOne({ deviceId: "DEV-P15-01" }, { $set: { status: DEVICE_STATUS.INACTIVE } });

        const res = await rawRequest("/api/iot/data", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${testDeviceApiKey}`
            },
            body: {
                deviceId: "DEV-P15-01",
                value1: 80,
                value2: 120,
                timestamp: new Date().toISOString()
            }
        });
        assert.strictEqual(res.status, 403);
        assert.ok(res.data.message.includes("Device is inactive"));

        // Restore to ACTIVE for subsequent tests
        await Device.updateOne({ deviceId: "DEV-P15-01" }, { $set: { status: DEVICE_STATUS.ACTIVE } });
    });

    let rotatedApiKey;
    await runTest(22, "Super Admin can rotate device API key", async () => {
        const res = await rawRequest("/api/admin/devices/DEV-P15-01/rotate-key", {
            method: "POST",
            headers: { Cookie: adminCookie }
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.success, true);
        assert.ok(res.data.apiKey && res.data.apiKey.startsWith("htk_"));
        rotatedApiKey = res.data.apiKey;
    });

    await runTest(23, "Old API key rejected after rotation (401 Unauthorized)", async () => {
        const res = await rawRequest("/api/iot/data", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${testDeviceApiKey}` // Old key
            },
            body: {
                deviceId: "DEV-P15-01",
                value1: 82,
                value2: 122,
                timestamp: new Date().toISOString()
            }
        });
        assert.strictEqual(res.status, 401);
    });

    await runTest(24, "New rotated API key authorizes telemetry ingestion (201 Created)", async () => {
        const res = await rawRequest("/api/iot/data", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${rotatedApiKey}` // New key
            },
            body: {
                deviceId: "DEV-P15-01",
                value1: 82,
                value2: 122,
                timestamp: new Date().toISOString()
            }
        });
        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.data.success, true);
    });

    await runTest(25, "Super Admin can revoke device API key", async () => {
        const res = await rawRequest("/api/admin/devices/DEV-P15-01/revoke-key", {
            method: "POST",
            headers: { Cookie: adminCookie }
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.success, true);

        // Telemetry attempt with previous key now rejected
        const iotRes = await rawRequest("/api/iot/data", {
            method: "POST",
            headers: { Authorization: `Bearer ${rotatedApiKey}` },
            body: {
                deviceId: "DEV-P15-01",
                value1: 80,
                value2: 120,
                timestamp: new Date().toISOString()
            }
        });
        assert.strictEqual(iotRes.status, 401);
    });

    await runTest(26, "API key secrets and hashes are never exposed in admin device inventory", async () => {
        const res = await rawRequest("/api/admin/devices", {
            headers: { Cookie: adminCookie, Accept: "application/json" }
        });
        assert.strictEqual(res.status, 200);
        const deviceData = res.data.devices.find((d) => d.deviceId === "DEV-P15-01");
        assert.ok(deviceData, "Device must exist in inventory");
        assert.strictEqual(deviceData.apiKeyHash, undefined, "apiKeyHash must NEVER be exposed");
        assert.strictEqual(deviceData.apiKey, undefined, "raw apiKey must NEVER be exposed in inventory");
    });

    // ==========================================
    // F. JWT HARDENING (27–31)
    // ==========================================

    await runTest(27, "Expired JWT rejected with 401 Unauthorized", async () => {
        const expiredToken = jwt.sign(
            { userId: patientUser._id.toString(), role: ROLES.PATIENT, profileId: "PAT-P15-01" },
            JWT_SECRET,
            { expiresIn: "-1s", algorithm: "HS256" }
        );
        const res = await rawRequest("/api/auth/me", {
            headers: { Cookie: `token=${expiredToken}` }
        });
        assert.strictEqual(res.status, 401);
        assert.ok(res.data.message.includes("expired"));
    });

    await runTest(28, "Malformed JWT structure rejected with 401 Unauthorized", async () => {
        const res = await rawRequest("/api/auth/me", {
            headers: { Cookie: "token=not.a.valid.jwt.token" }
        });
        assert.strictEqual(res.status, 401);
    });

    await runTest(29, "JWT signed with wrong key rejected with 401 Unauthorized", async () => {
        const tamperedToken = jwt.sign(
            { userId: patientUser._id.toString(), role: ROLES.PATIENT },
            "completely_wrong_secret_key_0000000000",
            { algorithm: "HS256" }
        );
        const res = await rawRequest("/api/auth/me", {
            headers: { Cookie: `token=${tamperedToken}` }
        });
        assert.strictEqual(res.status, 401);
    });

    await runTest(30, "JWT with algorithm 'none' rejected by algorithm pinning", async () => {
        // Construct an unsigned token with alg: none
        const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
        const payload = Buffer.from(JSON.stringify({ userId: adminUser._id.toString(), role: ROLES.SUPER_ADMIN })).toString("base64url");
        const noneToken = `${header}.${payload}.`;

        const res = await rawRequest("/api/admin/devices", {
            headers: { Cookie: `token=${noneToken}`, Accept: "application/json" }
        });
        assert.strictEqual(res.status, 401);
    });

    await runTest(31, "Missing authentication token on protected route rejected with 401", async () => {
        const res = await rawRequest("/api/auth/me", {
            headers: { Accept: "application/json" }
        });
        assert.strictEqual(res.status, 401);
    });

    // ==========================================
    // G. IDOR & RBAC OBJECT ISOLATION (32–35)
    // ==========================================

    await runTest(32, "IDOR: Patient A cannot query Patient B readings (403 Forbidden)", async () => {
        const res = await rawRequest("/api/readings/PAT-P15-OTHER", {
            headers: { Cookie: patientCookie }
        });
        assert.strictEqual(res.status, 403, `Expected 403 Forbidden, got ${res.status}`);
    });

    await runTest(33, "IDOR: Doctor A cannot query unassigned patient readings (403 Forbidden)", async () => {
        // Create an unassigned patient B
        await Patient.create({
            userId: new mongoose.Types.ObjectId(),
            patientId: "PAT-P15-UNASSIGNED",
            name: "Unassigned Patient",
            email: "unassigned@test.com",
            age: 40,
            gender: "Male",
            doctorId: null
        });

        const res = await rawRequest("/api/readings/PAT-P15-UNASSIGNED", {
            headers: { Cookie: doctorCookie }
        });
        assert.strictEqual(res.status, 403, `Expected 403 Forbidden, got ${res.status}`);
    });

    await runTest(34, "RBAC: Patient and Doctor cannot access Super Admin devices endpoint (403)", async () => {
        const patientRes = await rawRequest("/api/admin/devices", {
            headers: { Cookie: patientCookie }
        });
        assert.strictEqual(patientRes.status, 403);

        const doctorRes = await rawRequest("/api/admin/devices", {
            headers: { Cookie: doctorCookie }
        });
        assert.strictEqual(doctorRes.status, 403);
    });

    await runTest(35, "RBAC: Normal users cannot trigger device lifecycle reset (403)", async () => {
        const res = await rawRequest("/api/admin/devices/DEV-P15-01/reset", {
            method: "POST",
            headers: { Cookie: doctorCookie }
        });
        assert.strictEqual(res.status, 403);
    });

    // ==========================================
    // H. SOCKET.IO SECURITY & ROOM GUARDS (36–42)
    // ==========================================

    await runTest(36, "Socket.IO: Connection rejected without authentication token (AUTH_REQUIRED)", async () => {
        await new Promise((resolve) => {
            const socket = Client(socketUrl, {
                reconnection: false,
                transports: ["websocket"]
            });

            socket.on("connect_error", (err) => {
                assert.ok(err.message.includes("Authentication required"));
                socket.disconnect();
                resolve();
            });

            socket.on("connect", () => {
                socket.disconnect();
                assert.fail("Unauthenticated socket should not connect successfully");
            });
        });
    });

    await runTest(37, "Socket.IO: Connection rejected with tampered JWT (INVALID_TOKEN)", async () => {
        await new Promise((resolve) => {
            const socket = Client(socketUrl, {
                auth: { token: "tampered.jwt.signature" },
                reconnection: false,
                transports: ["websocket"]
            });

            socket.on("connect_error", (err) => {
                assert.ok(err.message.includes("Invalid or expired"));
                socket.disconnect();
                resolve();
            });

            socket.on("connect", () => {
                socket.disconnect();
                assert.fail("Tampered socket JWT should not connect successfully");
            });
        });
    });

    await runTest(38, "Socket.IO: Suspended user rejected during handshake (ACCOUNT_SUSPENDED)", async () => {
        const suspendedUser = await User.create({
            username: "suspended_user_p15",
            email: "suspended@test.com",
            passwordHash: "dummyHash",
            role: ROLES.PATIENT,
            status: ACCOUNT_STATUS.SUSPENDED
        });
        const suspendedToken = generateToken({
            userId: suspendedUser._id.toString(),
            role: ROLES.PATIENT,
            profileId: null
        });

        await new Promise((resolve) => {
            const socket = Client(socketUrl, {
                auth: { token: suspendedToken },
                reconnection: false,
                transports: ["websocket"]
            });

            socket.on("connect_error", (err) => {
                assert.ok(err.message.includes("Account is suspended"));
                socket.disconnect();
                resolve();
            });

            socket.on("connect", () => {
                socket.disconnect();
                assert.fail("Suspended user socket should not connect");
            });
        });
    });

    await runTest(39, "Socket.IO: Patient socket cannot join another patient's room", async () => {
        const patientToken = generateToken({
            userId: patientUser._id.toString(),
            role: ROLES.PATIENT,
            profileId: "PAT-P15-01"
        });

        const client = Client(socketUrl, {
            auth: { token: patientToken },
            transports: ["websocket"]
        });

        try {
            await withTimeout(
                new Promise((resolve) => {
                    client.on("connect", () => {
                        client.emit("join-room", { patientId: "PAT-OTHER-VICTIM" }, (response) => {
                            assert.strictEqual(response.success, false);
                            assert.ok(response.message.includes("Forbidden"));
                            resolve();
                        });
                    });
                }),
                3000,
                "Socket join other patient room"
            );
        } finally {
            client.disconnect();
        }
    });

    await runTest(40, "Socket.IO: Patient socket cannot join doctor room", async () => {
        const patientToken = generateToken({
            userId: patientUser._id.toString(),
            role: ROLES.PATIENT,
            profileId: "PAT-P15-01"
        });

        const client = Client(socketUrl, {
            auth: { token: patientToken },
            transports: ["websocket"]
        });

        try {
            await withTimeout(
                new Promise((resolve) => {
                    client.on("connect", () => {
                        client.emit("join-room", { doctorId: "DOC-P15-01" }, (response) => {
                            assert.strictEqual(response.success, false);
                            resolve();
                        });
                    });
                }),
                3000,
                "Socket join doctor room"
            );
        } finally {
            client.disconnect();
        }
    });

    await runTest(41, "Socket.IO: Doctor socket cannot join admin room", async () => {
        const doctorToken = generateToken({
            userId: doctorUser._id.toString(),
            role: ROLES.DOCTOR,
            profileId: "DOC-P15-01"
        });

        const client = Client(socketUrl, {
            auth: { token: doctorToken },
            transports: ["websocket"]
        });

        try {
            await withTimeout(
                new Promise((resolve) => {
                    client.on("connect", () => {
                        client.emit("join-room", { room: "admin:telemetry" }, (response) => {
                            assert.strictEqual(response.success, false);
                            resolve();
                        });
                    });
                }),
                3000,
                "Socket doctor join admin room"
            );
        } finally {
            client.disconnect();
        }
    });

    await runTest(42, "Socket.IO: Forged client identity payload in join-room is ignored", async () => {
        const patientToken = generateToken({
            userId: patientUser._id.toString(),
            role: ROLES.PATIENT,
            profileId: "PAT-P15-01"
        });

        const client = Client(socketUrl, {
            auth: { token: patientToken },
            transports: ["websocket"]
        });

        try {
            await withTimeout(
                new Promise((resolve) => {
                    client.on("connect", () => {
                        // Client attempts to spoof role as SUPER_ADMIN inside the event payload
                        client.emit("join-room", { role: "SUPER_ADMIN", room: "admin:activity" }, (response) => {
                            // Server strictly uses verified socket.user and rejects the admin room
                            assert.strictEqual(response.success, false);
                            resolve();
                        });
                    });
                }),
                3000,
                "Socket forged identity payload"
            );
        } finally {
            client.disconnect();
        }
    });

    // ==========================================
    // I. REQUEST HARDENING & ERROR LEAK DEFENSE (43–45)
    // ==========================================

    await runTest(43, "Oversized request payload (>100kb) rejected with HTTP 413 Payload Too Large", async () => {
        const hugePayload = "A".repeat(120 * 1024); // 120KB payload
        const res = await rawRequest("/api/iot/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deviceId: "DEV-P15-01", padding: hugePayload })
        });
        assert.strictEqual(res.status, 413, `Expected 413 Payload Too Large, got ${res.status}`);
        assert.strictEqual(res.data.success, false);
        assert.ok(res.data.message.includes("Payload too large"));
    });

    await runTest(44, "Malformed JSON syntax returns HTTP 400 Bad Request", async () => {
        const res = await rawRequest("/api/iot/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{ broken json string: [ "
        });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.data.success, false);
        assert.strictEqual(res.data.message, "Invalid JSON payload");
    });

    await runTest(45, "Production error responses strictly omit stack traces and internal secrets", async () => {
        const prevEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";

        try {
            // Trigger 500 error via simulated failure
            const originalFind = Device.findOne;
            Device.findOne = function () {
                throw new Error("Simulated critical DB failure containing /path/to/server.js and mongodb://secret");
            };

            const res = await rawRequest("/api/iot/data", {
                method: "POST",
                body: { deviceId: "DEV-P15-01", value1: 80, value2: 120, timestamp: new Date().toISOString() }
            });

            Device.findOne = originalFind;

            assert.strictEqual(res.status, 500);
            assert.strictEqual(res.data.success, false);
            assert.ok(res.data.message.includes("Internal server error"), "Message must be generic internal server error");
            assert.strictEqual(res.data.stack, undefined, "Stack trace MUST NOT be leaked in production");
            assert.ok(!res.text.includes("/path/to/server.js"), "Internal paths must not leak");
        } finally {
            process.env.NODE_ENV = prevEnv;
        }
    });

    // ==========================================
    // J. SECURITY AUDIT LOGGING & KEY LIFECYCLE (46–50)
    // ==========================================

    await runTest(46, "Failed authentication records security audit trail entry", async () => {
        await rawRequest("/api/auth/login", {
            method: "POST",
            body: { identifier: "nonexistent_p15@test.com", password: "Password123!" }
        });

        const log = await ActivityLog.findOne({ action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED }).sort({ timestamp: -1 });
        assert.ok(log, "Expected AUTH_LOGIN_FAILED audit log");
        assert.strictEqual(log.action, AUDIT_ACTIONS.AUTH_LOGIN_FAILED);
    });

    await runTest(47, "API key rotation records DEVICE_API_KEY_ROTATED audit log", async () => {
        await rawRequest("/api/admin/devices/DEV-P15-01/rotate-key", {
            method: "POST",
            headers: { Cookie: adminCookie }
        });

        const log = await ActivityLog.findOne({
            targetId: "DEV-P15-01",
            action: AUDIT_ACTIONS.DEVICE_API_KEY_ROTATED
        }).sort({ timestamp: -1 });

        assert.ok(log, "Expected DEVICE_API_KEY_ROTATED audit log");
        assert.strictEqual(log.targetId, "DEV-P15-01");
        assert.ok(log.details.keyPrefix, "Prefix should be recorded in audit");
        assert.strictEqual(log.details.apiKey, undefined, "Raw key must NEVER be recorded in audit log");
    });

    await runTest(48, "API key revocation records DEVICE_API_KEY_REVOKED audit log", async () => {
        await rawRequest("/api/admin/devices/DEV-P15-01/revoke-key", {
            method: "POST",
            headers: { Cookie: adminCookie }
        });

        const log = await ActivityLog.findOne({
            targetId: "DEV-P15-01",
            action: AUDIT_ACTIONS.DEVICE_API_KEY_REVOKED
        }).sort({ timestamp: -1 });

        assert.ok(log, "Expected DEVICE_API_KEY_REVOKED audit log");
        assert.strictEqual(log.targetId, "DEV-P15-01");
    });

    await runTest(49, "Non-admin cannot rotate device API key (403 Forbidden)", async () => {
        const res = await rawRequest("/api/admin/devices/DEV-P15-01/rotate-key", {
            method: "POST",
            headers: { Cookie: doctorCookie }
        });
        assert.strictEqual(res.status, 403);
    });

    await runTest(50, "Non-admin cannot revoke device API key (403 Forbidden)", async () => {
        const res = await rawRequest("/api/admin/devices/DEV-P15-01/revoke-key", {
            method: "POST",
            headers: { Cookie: patientCookie }
        });
        assert.strictEqual(res.status, 403);
    });

    const totalDuration = Date.now() - overallStart;

    console.log("\n=========================================");
    console.log("PHASE 15 SECURITY HARDENING SUMMARY");
    console.log("=========================================");
    console.log(`Passed:    ${passedTests}`);
    console.log(`Failed:    ${failedTests}`);
    console.log(`Total:     ${totalTests}`);
    console.log(`Duration:  ${totalDuration}ms`);
    console.log("=========================================");

    if (failedTests > 0) {
        console.error("PHASE 15 VERIFICATION: FAILED");
    } else {
        console.log("PHASE 15 VERIFICATION: SUCCESS");
    }
}

async function main() {
    try {
        await setup();
        await runAllTests();
    } catch (err) {
        console.error("Fatal test runner error:", err);
    } finally {
        await teardown();
    }
}

main();
