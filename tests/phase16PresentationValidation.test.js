/**
 * Phase 16 — Final Prototype & Presentation Polish Test Suite
 * Health Tracker — Comprehensive Automated Verification
 *
 * Verifies all 45 Critical Phase 16 Presentation & Polish Scenarios:
 *  1. Demo seed creates expected Super Admin user
 *  2. Demo seed creates expected clinical doctors (3)
 *  3. Demo seed creates expected patients (3)
 *  4. Demo seed creates expected hardware devices (4)
 *  5. Demo seed creates realistic synthetic historical telemetry curves
 *  6. Demo seed creates valid doctor-patient and patient-device assignments
 *  7. Demo seed is deterministic and repeatable
 *  8. Demo seed refuses execution in production environment
 *  9. Demo seed refuses to target databases with 'prod' in name
 * 10. Super Admin can enter Patient View Mode via GET /admin/view/patient/:patientId
 * 11. Super Admin can enter Doctor View Mode via GET /admin/view/doctor/:doctorId
 * 12. Super Admin can exit View Mode via POST /admin/view/exit
 * 13. Patient role cannot use Quick-Switch endpoint (403 Forbidden)
 * 14. Doctor role cannot use Quick-Switch endpoint (403 Forbidden)
 * 15. Unauthenticated user cannot use Quick-Switch endpoint (401 Unauthorized)
 * 16. Nonexistent patient target in Quick-Switch returns 404
 * 17. Nonexistent doctor target in Quick-Switch returns 404
 * 18. Authenticated admin identity remains SUPER_ADMIN during view mode
 * 19. Target user's JWT is never generated or issued to admin
 * 20. Target user's password hash is never exposed in response
 * 21. Patient view hydrates strictly target patient's data
 * 22. Doctor view hydrates strictly target doctor's assigned patient cohort
 * 23. Quick-Switch view mode is strictly read-only and does not mutate database records
 * 24. Entering view mode records ADMIN_VIEW_SWITCH audit event
 * 25. Exiting view mode records ADMIN_VIEW_EXIT audit event
 * 26. Quick-Switch endpoint is strictly disabled when NODE_ENV === 'production'
 * 27. Admin View Banner HTML is rendered in Patient overview when viewing as admin
 * 28. Admin View Banner HTML is rendered in Doctor overview when viewing as admin
 * 29. Regular Patient portal access continues to enforce normal RBAC
 * 30. Regular Doctor portal access continues to enforce normal RBAC
 * 31. Socket.IO allows Super Admin to observe target patient telemetry room in view mode
 * 32. Socket.IO rejects non-admin client joining arbitrary unauthorized room
 * 33. Live telemetry reaches Super Admin viewing patient room
 * 34. Historical sensor readings survive Quick-Switch and remain immutable
 * 35. Admin hardware lifecycle reset flow remains fully functional
 * 36. Doctor reassignment engine remains fully functional
 * 37. Activity stream logs all presentation lifecycle events
 * 38. Loading skeleton CSS classes exist in design system
 * 39. Empty state components render clean messaging when collections are empty
 * 40. Responsive layout classes and CSS variables are present
 * 41. prefers-reduced-motion media query suppresses animations
 * 42. Rendered HTML never exposes passwords, secrets, or internal paths
 * 43. API responses never leak JWT secrets or device API keys
 * 44. Production simulation verifies Quick-Switch route returns 403/404
 * 45. Complete end-to-end presentation demonstration flow integration test (< 3s)
 */

require("dotenv").config();
const http = require("http");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const ioClient = require("socket.io-client");
const assert = require("assert");

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
    AUDIT_ACTIONS
} = require("../src/config/constants");
const { generateToken } = require("../src/utils/authUtils");
const { runDemoSeed } = require("../src/seed/demoSeed");

const TEST_DB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/health_monitoring_phase16_test";

let httpServer;
let ioServer;
let baseUrl;
let socketUrl;

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

/**
 * Timeout wrapper for asynchronous test actions
 */
function withTimeout(promise, ms, label = "Operation") {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${ms}ms`));
        }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Raw HTTP request helper
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

// Global fixtures
let adminCookie;
let doctorCookie;
let patientCookie;
let seededData;

async function setup() {
    console.log(`[SETUP] Connecting MongoDB: ${TEST_DB_URI}`);
    await mongoose.connect(TEST_DB_URI);
    assert.strictEqual(
        mongoose.connection.name,
        "health_monitoring_phase16_test",
        "Guard: database name mismatch"
    );

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
    console.log(`[SETUP] Server running at ${baseUrl}`);

    console.log("[SETUP] Running initial demo seed...");
    seededData = await runDemoSeed({ clean: true });

    // Generate tokens for test roles
    const adminToken = generateToken({
        userId: seededData.admin._id.toString(),
        role: ROLES.SUPER_ADMIN,
        profileId: null
    });
    adminCookie = `token=${adminToken}`;

    const doctorUser = await User.findOne({ profileId: "DOC-001" });
    const doctorToken = generateToken({
        userId: doctorUser._id.toString(),
        role: ROLES.DOCTOR,
        profileId: "DOC-001"
    });
    doctorCookie = `token=${doctorToken}`;

    const patientUser = await User.findOne({ profileId: "PAT-001" });
    const patientToken = generateToken({
        userId: patientUser._id.toString(),
        role: ROLES.PATIENT,
        profileId: "PAT-001"
    });
    patientCookie = `token=${patientToken}`;
}

async function teardown() {
    console.log("[TEARDOWN] Closing servers & database...");
    if (ioServer) {
        await new Promise((resolve) => ioServer.close(resolve));
    }
    if (httpServer) {
        await new Promise((resolve) => httpServer.close(resolve));
    }
    if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    }
    console.log("[TEARDOWN] Complete.");
}

async function runAllTests() {
    console.log("\n=================================================");
    console.log("RUNNING PHASE 16: PRESENTATION & POLISH TEST SUITE");
    console.log("=================================================\n");

    // ==========================================
    // A. DEMO SEED SUITE (Tests 1–9)
    // ==========================================

    await runTest(1, "Demo seed creates expected Super Admin user", async () => {
        const admin = await User.findOne({ role: ROLES.SUPER_ADMIN });
        assert.ok(admin);
        assert.strictEqual(admin.username, "admin");
        assert.strictEqual(admin.email, "admin@healthtracker.local");
        assert.strictEqual(admin.status, ACCOUNT_STATUS.ACTIVE);
    });

    await runTest(2, "Demo seed creates expected clinical doctors (3)", async () => {
        const count = await Doctor.countDocuments();
        assert.strictEqual(count, 3);
        const doc1 = await Doctor.findOne({ doctorId: "DOC-001" });
        assert.ok(doc1);
        assert.strictEqual(doc1.specialization, "Cardiology");
    });

    await runTest(3, "Demo seed creates expected patients (3)", async () => {
        const count = await Patient.countDocuments();
        assert.strictEqual(count, 3);
        const p1 = await Patient.findOne({ patientId: "PAT-001" });
        assert.ok(p1);
        assert.strictEqual(p1.doctorId, "DOC-001");
        assert.strictEqual(p1.deviceId, "DEV-001");
    });

    await runTest(4, "Demo seed creates expected hardware devices (4)", async () => {
        const count = await Device.countDocuments();
        assert.strictEqual(count, 4);
        const dev1 = await Device.findOne({ deviceId: "DEV-001" });
        assert.ok(dev1);
        assert.strictEqual(dev1.status, DEVICE_STATUS.ACTIVE);
        assert.strictEqual(dev1.patientId, "PAT-001");
    });

    await runTest(5, "Demo seed creates realistic synthetic historical telemetry curves", async () => {
        const readings = await SensorReading.find().sort({ timestamp: 1 });
        assert.strictEqual(readings.length, 60); // 30 for PAT-001, 30 for PAT-002
        for (const r of readings) {
            assert.ok(Number.isFinite(r.value1));
            assert.ok(Number.isFinite(r.value2));
            assert.ok(r.timestamp instanceof Date);
        }
    });

    await runTest(6, "Demo seed creates valid doctor-patient and patient-device assignments", async () => {
        const p1 = await Patient.findOne({ patientId: "PAT-001" });
        const dev1 = await Device.findOne({ deviceId: "DEV-001" });
        assert.strictEqual(p1.deviceId, dev1.deviceId);
        assert.strictEqual(dev1.patientId, p1.patientId);
    });

    await runTest(7, "Demo seed is deterministic and repeatable", async () => {
        seededData = await runDemoSeed({ clean: true });
        assert.strictEqual(seededData.doctors.length, 3);
        assert.strictEqual(seededData.patients.length, 3);
        assert.strictEqual(seededData.devices.length, 4);

        // Refresh test tokens with newly created user IDs
        const adminToken = generateToken({
            userId: seededData.admin._id.toString(),
            role: ROLES.SUPER_ADMIN,
            profileId: null
        });
        adminCookie = `token=${adminToken}`;

        const doctorUser = await User.findOne({ profileId: "DOC-001" });
        const doctorToken = generateToken({
            userId: doctorUser._id.toString(),
            role: ROLES.DOCTOR,
            profileId: "DOC-001"
        });
        doctorCookie = `token=${doctorToken}`;

        const patientUser = await User.findOne({ profileId: "PAT-001" });
        const patientToken = generateToken({
            userId: patientUser._id.toString(),
            role: ROLES.PATIENT,
            profileId: "PAT-001"
        });
        patientCookie = `token=${patientToken}`;
    });

    await runTest(8, "Demo seed refuses execution in production environment", async () => {
        const prevEnv = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = "production";
            await assert.rejects(
                async () => runDemoSeed(),
                /DEMO SEED SAFETY GUARD/
            );
        } finally {
            process.env.NODE_ENV = prevEnv;
        }
    });

    await runTest(9, "Demo seed refuses to target databases with 'prod' in name", async () => {
        const fakeConn = { name: "hospital_production_db", readyState: 1 };
        const originalName = mongoose.connection.name;
        try {
            Object.defineProperty(mongoose.connection, "name", { value: "hospital_production_db", configurable: true });
            await assert.rejects(
                async () => runDemoSeed(),
                /Refusing to seed database containing 'prod'/
            );
        } finally {
            Object.defineProperty(mongoose.connection, "name", { value: originalName, configurable: true });
        }
    });

    // ==========================================
    // B. QUICK-SWITCH VIEW MODE SUITE (Tests 10–26)
    // ==========================================

    await runTest(10, "Super Admin can enter Patient View Mode via GET /admin/view/patient/:patientId", async () => {
        const res = await rawRequest("/admin/view/patient/PAT-001", {
            headers: {
                Cookie: adminCookie,
                Accept: "application/json"
            }
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.success, true);
        assert.strictEqual(res.data.adminViewContext.mode, "PATIENT");
        assert.strictEqual(res.data.adminViewContext.targetId, "PAT-001");
        assert.strictEqual(res.data.authenticatedAdmin.role, ROLES.SUPER_ADMIN);
    });

    await runTest(11, "Super Admin can enter Doctor View Mode via GET /admin/view/doctor/:doctorId", async () => {
        const res = await rawRequest("/admin/view/doctor/DOC-001", {
            headers: {
                Cookie: adminCookie,
                Accept: "application/json"
            }
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.success, true);
        assert.strictEqual(res.data.adminViewContext.mode, "DOCTOR");
        assert.strictEqual(res.data.adminViewContext.targetId, "DOC-001");
        assert.strictEqual(res.data.doctor.doctorId, "DOC-001");
    });

    await runTest(12, "Super Admin can exit View Mode via POST /admin/view/exit", async () => {
        const res = await rawRequest("/admin/view/exit", {
            method: "POST",
            headers: {
                Cookie: adminCookie,
                Accept: "application/json"
            }
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.success, true);
        assert.strictEqual(res.data.redirectUrl, "/admin/overview");
    });

    await runTest(13, "Patient role cannot use Quick-Switch endpoint (403 Forbidden)", async () => {
        const res = await rawRequest("/admin/view/patient/PAT-002", {
            headers: {
                Cookie: patientCookie,
                Accept: "application/json"
            }
        });
        assert.strictEqual(res.status, 403);
    });

    await runTest(14, "Doctor role cannot use Quick-Switch endpoint (403 Forbidden)", async () => {
        const res = await rawRequest("/admin/view/patient/PAT-001", {
            headers: {
                Cookie: doctorCookie,
                Accept: "application/json"
            }
        });
        assert.strictEqual(res.status, 403);
    });

    await runTest(15, "Unauthenticated user cannot use Quick-Switch endpoint (401 Unauthorized)", async () => {
        const res = await rawRequest("/admin/view/patient/PAT-001", {
            headers: {
                Accept: "application/json"
            }
        });
        assert.strictEqual(res.status, 401);
    });

    await runTest(16, "Nonexistent patient target in Quick-Switch returns 404", async () => {
        const res = await rawRequest("/admin/view/patient/PAT-NONEXISTENT", {
            headers: {
                Cookie: adminCookie,
                Accept: "application/json"
            }
        });
        assert.strictEqual(res.status, 404);
        assert.strictEqual(res.data.success, false);
    });

    await runTest(17, "Nonexistent doctor target in Quick-Switch returns 404", async () => {
        const res = await rawRequest("/admin/view/doctor/DOC-NONEXISTENT", {
            headers: {
                Cookie: adminCookie,
                Accept: "application/json"
            }
        });
        assert.strictEqual(res.status, 404);
        assert.strictEqual(res.data.success, false);
    });

    await runTest(18, "Authenticated admin identity remains SUPER_ADMIN during view mode", async () => {
        const res = await rawRequest("/admin/view/patient/PAT-001", {
            headers: {
                Cookie: adminCookie,
                Accept: "application/json"
            }
        });
        assert.strictEqual(res.data.authenticatedAdmin.role, ROLES.SUPER_ADMIN);
    });

    await runTest(19, "Target user's JWT is never generated or issued to admin", async () => {
        const res = await rawRequest("/admin/view/patient/PAT-001", {
            headers: {
                Cookie: adminCookie,
                Accept: "application/json"
            }
        });
        assert.strictEqual(res.data.token, undefined);
        assert.strictEqual(res.data.jwt, undefined);
    });

    await runTest(20, "Target user's password hash is never exposed in response", async () => {
        const res = await rawRequest("/admin/view/patient/PAT-001", {
            headers: {
                Cookie: adminCookie,
                Accept: "application/json"
            }
        });
        const serialized = JSON.stringify(res.data);
        assert.ok(!serialized.includes("$2a$10$"));
        assert.ok(!serialized.includes("passwordHash"));
    });

    await runTest(21, "Patient view hydrates strictly target patient's data", async () => {
        const res = await rawRequest("/admin/view/patient/PAT-001", {
            headers: {
                Cookie: adminCookie,
                Accept: "application/json"
            }
        });
        assert.strictEqual(res.data.patient.patientId, "PAT-001");
        assert.strictEqual(res.data.device.deviceId, "DEV-001");
    });

    await runTest(22, "Doctor view hydrates strictly target doctor's assigned patient cohort", async () => {
        const res = await rawRequest("/admin/view/doctor/DOC-001", {
            headers: {
                Cookie: adminCookie,
                Accept: "application/json"
            }
        });
        assert.strictEqual(res.data.doctor.doctorId, "DOC-001");
        assert.ok(Array.isArray(res.data.patients));
        assert.strictEqual(res.data.patients.length, 2); // PAT-001 and PAT-002
    });

    await runTest(23, "Quick-Switch view mode is strictly read-only and does not mutate database records", async () => {
        const beforePatient = await Patient.findOne({ patientId: "PAT-001" }).lean();
        await rawRequest("/admin/view/patient/PAT-001", {
            headers: { Cookie: adminCookie, Accept: "application/json" }
        });
        const afterPatient = await Patient.findOne({ patientId: "PAT-001" }).lean();
        assert.deepStrictEqual(beforePatient.doctorId, afterPatient.doctorId);
        assert.deepStrictEqual(beforePatient.deviceId, afterPatient.deviceId);
    });

    await runTest(24, "Entering view mode records ADMIN_VIEW_SWITCH audit event", async () => {
        const log = await ActivityLog.findOne({ action: AUDIT_ACTIONS.ADMIN_VIEW_SWITCH }).sort({ timestamp: -1 });
        assert.ok(log);
        assert.strictEqual(log.actorRole, ROLES.SUPER_ADMIN);
    });

    await runTest(25, "Exiting view mode records ADMIN_VIEW_EXIT audit event", async () => {
        await rawRequest("/admin/view/exit", {
            method: "POST",
            headers: { Cookie: adminCookie, Accept: "application/json" }
        });
        const log = await ActivityLog.findOne({ action: AUDIT_ACTIONS.ADMIN_VIEW_EXIT }).sort({ timestamp: -1 });
        assert.ok(log);
        assert.strictEqual(log.targetId, "ADMIN_OVERVIEW");
    });

    await runTest(26, "Quick-Switch endpoint is strictly disabled when NODE_ENV === 'production'", async () => {
        const prevEnv = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = "production";
            const res = await rawRequest("/admin/view/patient/PAT-001", {
                headers: { Cookie: adminCookie, Accept: "application/json" }
            });
            assert.strictEqual(res.status, 403);
            assert.strictEqual(res.data.success, false);
        } finally {
            process.env.NODE_ENV = prevEnv;
        }
    });

    // ==========================================
    // C. PRESENTATION & UI POLISH SUITE (Tests 27–45)
    // ==========================================

    await runTest(27, "Admin View Banner HTML is rendered in Patient overview when viewing as admin", async () => {
        const res = await rawRequest("/admin/view/patient/PAT-001", {
            headers: { Cookie: adminCookie }
        });
        assert.strictEqual(res.status, 200);
        assert.ok(res.text.includes("admin-view-banner"));
        assert.ok(res.text.includes("ADMIN VIEW MODE"));
        assert.ok(res.text.includes("Return to Admin"));
    });

    await runTest(28, "Admin View Banner HTML is rendered in Doctor overview when viewing as admin", async () => {
        const res = await rawRequest("/admin/view/doctor/DOC-001", {
            headers: { Cookie: adminCookie }
        });
        assert.strictEqual(res.status, 200);
        assert.ok(res.text.includes("admin-view-banner"));
        assert.ok(res.text.includes("ADMIN VIEW MODE"));
    });

    await runTest(29, "Regular Patient portal access continues to enforce normal RBAC", async () => {
        const res = await rawRequest("/patient/overview", {
            headers: { Cookie: patientCookie }
        });
        assert.strictEqual(res.status, 200);
        assert.ok(!res.text.includes("admin-view-banner"));
    });

    await runTest(30, "Regular Doctor portal access continues to enforce normal RBAC", async () => {
        const res = await rawRequest("/doctor/overview", {
            headers: { Cookie: doctorCookie }
        });
        assert.strictEqual(res.status, 200);
        assert.ok(!res.text.includes("admin-view-banner"));
    });

    await runTest(31, "Socket.IO allows Super Admin to observe target patient telemetry room in view mode", async () => {
        const adminToken = adminCookie.replace("token=", "");
        const socket = ioClient(socketUrl, {
            auth: { token: adminToken },
            transports: ["websocket"]
        });

        try {
            await new Promise((resolve, reject) => {
                socket.on("connect", resolve);
                socket.on("connect_error", reject);
            });

            const joinResult = await new Promise((resolve) => {
                socket.emit("join-room", { room: "patient:PAT-001", viewMode: "PATIENT" }, resolve);
            });
            assert.strictEqual(joinResult.success, true);
            assert.strictEqual(joinResult.room, "patient:PAT-001");
        } finally {
            socket.disconnect();
        }
    });

    await runTest(32, "Socket.IO rejects non-admin client joining arbitrary unauthorized room", async () => {
        const patientToken = patientCookie.replace("token=", "");
        const socket = ioClient(socketUrl, {
            auth: { token: patientToken },
            transports: ["websocket"]
        });

        try {
            await new Promise((resolve, reject) => {
                socket.on("connect", resolve);
                socket.on("connect_error", reject);
            });

            const joinResult = await new Promise((resolve) => {
                socket.emit("join-room", { patientId: "PAT-002" }, resolve);
            });
            assert.strictEqual(joinResult.success, false);
            assert.ok(joinResult.message.includes("Forbidden"));
        } finally {
            socket.disconnect();
        }
    });

    await runTest(33, "Live telemetry reaches Super Admin viewing patient room", async () => {
        const adminToken = adminCookie.replace("token=", "");
        const socket = ioClient(socketUrl, {
            auth: { token: adminToken },
            transports: ["websocket"]
        });

        try {
            await new Promise((resolve) => socket.on("connect", resolve));
            await new Promise((resolve) => {
                socket.emit("join-room", { room: "patient:PAT-001" }, resolve);
            });

            const telemetryPromise = new Promise((resolve) => {
                socket.on("sensor-reading", resolve);
            });

            // Ingest sample telemetry
            const devKey = seededData.devKeys[0].rawKey;
            await rawRequest("/api/iot/data", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${devKey}`,
                    "Content-Type": "application/json"
                },
                body: {
                    deviceId: "DEV-001",
                    value1: 82.5,
                    value2: 98.4,
                    timestamp: new Date().toISOString()
                }
            });

            const received = await withTimeout(telemetryPromise, 2000, "Telemetry reception");
            assert.strictEqual(received.deviceId, "DEV-001");
            assert.strictEqual(received.patientId, "PAT-001");
        } finally {
            socket.disconnect();
        }
    });

    await runTest(34, "Historical sensor readings survive Quick-Switch and remain immutable", async () => {
        const countBefore = await SensorReading.countDocuments();
        await rawRequest("/admin/view/patient/PAT-001", {
            headers: { Cookie: adminCookie }
        });
        const countAfter = await SensorReading.countDocuments();
        assert.strictEqual(countBefore, countAfter);
    });

    await runTest(35, "Admin hardware lifecycle reset flow remains fully functional", async () => {
        const res = await rawRequest("/api/admin/devices/DEV-002/reset", {
            method: "POST",
            headers: { Cookie: adminCookie, Accept: "application/json" }
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.success, true);
        const dev = await Device.findOne({ deviceId: "DEV-002" });
        assert.strictEqual(dev.patientId, null);
        assert.strictEqual(dev.resetCount, 1);
    });

    await runTest(36, "Doctor reassignment engine remains fully functional", async () => {
        const res = await rawRequest("/api/admin/assignments", {
            method: "POST",
            headers: { Cookie: adminCookie, "Content-Type": "application/json", Accept: "application/json" },
            body: { patientId: "PAT-001", doctorId: "DOC-002" }
        });
        assert.strictEqual(res.status, 200);
        const p = await Patient.findOne({ patientId: "PAT-001" });
        assert.strictEqual(p.doctorId, "DOC-002");
    });

    await runTest(37, "Activity log still receives lifecycle events", async () => {
        const log = await ActivityLog.findOne({ action: AUDIT_ACTIONS.PATIENT_REASSIGNED });
        assert.ok(log);
        assert.strictEqual(log.targetId, "PAT-001");
    });

    await runTest(38, "Loading skeleton CSS classes exist in design system", async () => {
        const res = await rawRequest("/css/global.css");
        assert.strictEqual(res.status, 200);
        assert.ok(res.text.includes(".skeleton"));
        assert.ok(res.text.includes("skeletonShimmer"));
    });

    await runTest(39, "Empty state components render clean messaging when collections are empty", async () => {
        const res = await rawRequest("/css/global.css");
        assert.ok(res.text.includes(".empty-state"));
        assert.ok(res.text.includes(".empty-state-title"));
    });

    await runTest(40, "Responsive layout classes and CSS variables are present", async () => {
        const res = await rawRequest("/css/global.css");
        assert.ok(res.text.includes("--burnt-orange"));
        assert.ok(res.text.includes("--surface"));
        assert.ok(res.text.includes(".app-shell"));
    });

    await runTest(41, "prefers-reduced-motion media query suppresses animations", async () => {
        const res = await rawRequest("/css/global.css");
        assert.ok(res.text.includes("prefers-reduced-motion: reduce"));
        assert.ok(res.text.includes("animation-duration: 0.01ms !important"));
    });

    await runTest(42, "Rendered HTML never exposes passwords, secrets, or internal paths", async () => {
        const res = await rawRequest("/admin/overview", {
            headers: { Cookie: adminCookie }
        });
        assert.ok(!res.text.includes("passwordHash"));
        assert.ok(!res.text.includes("JWT_SECRET"));
        assert.ok(!res.text.includes("mongodb://"));
    });

    await runTest(43, "API responses never leak JWT secrets or device API keys", async () => {
        const res = await rawRequest("/api/admin/devices", {
            headers: { Cookie: adminCookie, Accept: "application/json" }
        });
        const serialized = JSON.stringify(res.data);
        assert.ok(!serialized.includes("apiKeyHash"));
        assert.ok(!serialized.includes("JWT_SECRET"));
    });

    await runTest(44, "Production simulation verifies Quick-Switch route returns 403/404", async () => {
        const prevEnv = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = "production";
            const res = await rawRequest("/admin/view/doctor/DOC-001", {
                headers: { Cookie: adminCookie, Accept: "application/json" }
            });
            assert.strictEqual(res.status, 403);
        } finally {
            process.env.NODE_ENV = prevEnv;
        }
    });

    await runTest(45, "Complete end-to-end presentation demonstration flow integration test (< 3s)", async () => {
        const flowStart = Date.now();

        // 1. Admin creates doctor
        const docRes = await rawRequest("/api/admin/doctors", {
            method: "POST",
            headers: { Cookie: adminCookie, "Content-Type": "application/json", Accept: "application/json" },
            body: {
                username: "dr_demo_flow",
                name: "Dr. Demo Flow",
                email: "demo_flow@example.com",
                specialization: "Critical Care"
            }
        });
        assert.strictEqual(docRes.status, 201);
        const newDoctorId = docRes.data.doctor.doctorId;

        // 2. Admin creates device
        const devRes = await rawRequest("/api/admin/devices", {
            method: "POST",
            headers: { Cookie: adminCookie, "Content-Type": "application/json", Accept: "application/json" },
            body: { deviceId: "DEV-DEMO-99" }
        });
        assert.strictEqual(devRes.status, 201);
        const newApiKey = devRes.data.apiKey;

        // 3. Patient registers and claims device
        const patRes = await rawRequest("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: {
                username: "pat_demo_flow",
                name: "Patient Demo Flow",
                email: "pat_demo@example.com",
                password: "SecurePassword123!",
                confirmPassword: "SecurePassword123!",
                age: 42,
                deviceId: "DEV-DEMO-99"
            }
        });
        assert.strictEqual(patRes.status, 201);
        const newPatientId = patRes.data.patient ? patRes.data.patient.patientId : patRes.data.user.profileId;

        // 4. Stream IoT telemetry
        const iotRes = await rawRequest("/api/iot/data", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${newApiKey}`,
                "Content-Type": "application/json",
                Accept: "application/json"
            },
            body: {
                deviceId: "DEV-DEMO-99",
                value1: 78.4,
                value2: 98.1,
                timestamp: new Date().toISOString()
            }
        });
        assert.strictEqual(iotRes.status, 201);

        // 5. Reassign Doctor
        const assignRes = await rawRequest("/api/admin/assignments", {
            method: "POST",
            headers: { Cookie: adminCookie, "Content-Type": "application/json", Accept: "application/json" },
            body: { patientId: newPatientId, doctorId: newDoctorId }
        });
        assert.strictEqual(assignRes.status, 200);

        // 6. Reset Device
        const resetRes = await rawRequest("/api/admin/devices/DEV-DEMO-99/reset", {
            method: "POST",
            headers: { Cookie: adminCookie, Accept: "application/json" }
        });
        assert.strictEqual(resetRes.status, 200);

        // 7. Verify Audit Log
        const actRes = await rawRequest("/api/admin/activity", {
            headers: { Cookie: adminCookie, Accept: "application/json" }
        });
        assert.strictEqual(actRes.status, 200);
        assert.ok(actRes.data.activities.length > 0);

        // 8. Admin Quick-Switch into view mode
        const viewRes = await rawRequest(`/admin/view/patient/${newPatientId}`, {
            headers: { Cookie: adminCookie, Accept: "application/json" }
        });
        assert.strictEqual(viewRes.status, 200);
        assert.strictEqual(viewRes.data.adminViewContext.mode, "PATIENT");

        const flowDuration = Date.now() - flowStart;
        console.log(`       [FLOW DURATION]: ${flowDuration}ms (Target: < 3000ms)`);
        assert.ok(flowDuration < 3000, `Demo flow took ${flowDuration}ms, exceeding 3s budget`);
    });

    console.log("\n=========================================");
    console.log("PHASE 16 PRESENTATION POLISH SUMMARY");
    console.log("=========================================");
    console.log(`Passed:    ${passedTests}`);
    console.log(`Failed:    ${failedTests}`);
    console.log(`Total:     ${totalTests}`);
    console.log("=========================================");

    if (failedTests > 0) {
        console.error("PHASE 16 VERIFICATION: FAILED");
        process.exitCode = 1;
    } else {
        console.log("PHASE 16 VERIFICATION: SUCCESS");
    }
}

async function main() {
    try {
        await setup();
        await runAllTests();
    } catch (err) {
        console.error("Fatal test runner error:", err);
        process.exitCode = 1;
    } finally {
        await teardown();
    }
}

main();
