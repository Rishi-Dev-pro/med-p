/**
 * HEALTH TRACKER — PHASE 0 OFFLINE SCHEMA VERIFICATION SUITE
 * Validates models, schema constraints, indexes, nullability, enums, and app startup offline.
 */

const assert = require("assert");
const mongoose = require("mongoose");

const {
    ROLES,
    ACCOUNT_STATUS,
    DOCTOR_STATUS,
    DEVICE_STATUS,
    TARGET_TYPES,
    ACTOR_ROLES,
    AUDIT_ACTIONS
} = require("../src/config/constants");

const User = require("../src/models/User");
const Doctor = require("../src/models/Doctor");
const Patient = require("../src/models/Patient");
const Device = require("../src/models/Device");
const SensorReading = require("../src/models/SensorReading");
const ActivityLog = require("../src/models/ActivityLog");

console.log("=================================================");
console.log("STARTING PHASE 0 SCHEMA VERIFICATION TEST SUITE");
console.log("=================================================\n");

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`[PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`[FAIL] ${name}`);
        console.error(`       Error: ${err.message}`);
        process.exitCode = 1;
    }
}

// -------------------------------------------------------------
// 1. Model Loading & Circular Dependency Check
// -------------------------------------------------------------
runTest("1. Models load successfully without circular dependencies", () => {
    assert.strictEqual(typeof User, "function", "User model should be a function/constructor");
    assert.strictEqual(typeof Doctor, "function", "Doctor model should be a function/constructor");
    assert.strictEqual(typeof Patient, "function", "Patient model should be a function/constructor");
    assert.strictEqual(typeof Device, "function", "Device model should be a function/constructor");
    assert.strictEqual(typeof SensorReading, "function", "SensorReading model should be a function/constructor");
    assert.strictEqual(typeof ActivityLog, "function", "ActivityLog model should be a function/constructor");
});

// -------------------------------------------------------------
// 2. Constants & Enum Completeness
// -------------------------------------------------------------
runTest("2. Centralized constants define all required values", () => {
    assert.deepStrictEqual(Object.values(ROLES).sort(), ["DOCTOR", "PATIENT", "SUPER_ADMIN"].sort());
    assert.deepStrictEqual(Object.values(ACCOUNT_STATUS).sort(), ["ACTIVE", "SUSPENDED"].sort());
    assert.deepStrictEqual(Object.values(DOCTOR_STATUS).sort(), ["ACTIVE", "INACTIVE"].sort());
    assert.deepStrictEqual(Object.values(DEVICE_STATUS).sort(), ["ACTIVE", "INACTIVE"].sort());
    assert.ok(AUDIT_ACTIONS.PATIENT_REGISTERED, "PATIENT_REGISTERED action must exist");
    assert.ok(AUDIT_ACTIONS.DEVICE_RESET, "DEVICE_RESET action must exist");
    assert.ok(AUDIT_ACTIONS.DOCTOR_REMOVED, "DOCTOR_REMOVED action must exist");
    assert.ok(TARGET_TYPES.DEVICE && TARGET_TYPES.PATIENT && TARGET_TYPES.DOCTOR);
});

// -------------------------------------------------------------
// 3. User Schema Validation & Enums
// -------------------------------------------------------------
runTest("3. User schema: valid instantiation, required fields, and role/status enums", () => {
    const validUser = new User({
        username: "superadmin",
        email: "admin@example.com",
        passwordHash: "$2a$10$fakehashstring1234567890",
        role: ROLES.SUPER_ADMIN,
        profileId: null,
        status: ACCOUNT_STATUS.ACTIVE
    });
    const validationError = validUser.validateSync();
    assert.strictEqual(validationError, undefined, "Valid user should produce no validation error");

    // Test invalid role
    const invalidRoleUser = new User({
        username: "baduser",
        email: "bad@example.com",
        passwordHash: "hash",
        role: "NURSE",
        status: ACCOUNT_STATUS.ACTIVE
    });
    const roleError = invalidRoleUser.validateSync();
    assert.ok(roleError && roleError.errors.role, "Invalid role should fail validation");

    // Test missing passwordHash
    const noPwdUser = new User({
        username: "nopwd",
        email: "nopwd@example.com",
        role: ROLES.PATIENT
    });
    const pwdError = noPwdUser.validateSync();
    assert.ok(pwdError && pwdError.errors.passwordHash, "Missing passwordHash should fail validation");
});

// -------------------------------------------------------------
// 4. Doctor Schema Validation & User Reference
// -------------------------------------------------------------
runTest("4. Doctor schema: required fields, status enum, and userId reference", () => {
    const fakeUserId = new mongoose.Types.ObjectId();
    const validDoctor = new Doctor({
        doctorId: "DOC-001",
        userId: fakeUserId,
        name: "Dr. Sharma",
        email: "sharma@example.com",
        specialization: "Cardiology",
        status: DOCTOR_STATUS.ACTIVE
    });
    assert.strictEqual(validDoctor.validateSync(), undefined, "Valid doctor should produce no validation error");

    const missingDoctor = new Doctor({});
    const docErrors = missingDoctor.validateSync().errors;
    assert.ok(docErrors.doctorId, "doctorId must be required");
    assert.ok(docErrors.userId, "userId must be required");
    assert.ok(docErrors.name, "name must be required");
    assert.ok(docErrors.email, "email must be required");
});

// -------------------------------------------------------------
// 5. Patient Schema & Strict Null Invariant for Unassigned Links
// -------------------------------------------------------------
runTest("5. Patient schema: unassigned doctorId and deviceId default to null", () => {
    const fakeUserId = new mongoose.Types.ObjectId();
    const patient = new Patient({
        patientId: "PAT-001",
        userId: fakeUserId,
        name: "Test Patient",
        email: "patient@example.com",
        age: 30
    });

    assert.strictEqual(patient.doctorId, null, "Unassigned doctorId must default to null");
    assert.strictEqual(patient.deviceId, null, "Unassigned deviceId must default to null");
    assert.strictEqual(patient.validateSync(), undefined, "Patient with null relations should pass validation");

    // Test negative age rejection
    const invalidPatient = new Patient({
        patientId: "PAT-002",
        userId: fakeUserId,
        name: "Invalid Patient",
        email: "inv@example.com",
        age: -5
    });
    const ageError = invalidPatient.validateSync();
    assert.ok(ageError && ageError.errors.age, "Negative age must be rejected");
});

// -------------------------------------------------------------
// 6. Device Schema & Reset Invariants
// -------------------------------------------------------------
runTest("6. Device schema: null patientId default, resetCount min 0, status normalizer", () => {
    const device = new Device({
        deviceId: "DEV-001",
        status: "active" // lower case normalized by setter
    });

    assert.strictEqual(device.patientId, null, "Unassigned device patientId must default to null");
    assert.strictEqual(device.resetCount, 0, "Initial resetCount must default to 0");
    assert.strictEqual(device.status, "ACTIVE", "Device status must be normalized to uppercase");
    assert.strictEqual(device.validateSync(), undefined, "Device with null patientId must pass validation");

    // Negative reset count rejection
    const badDevice = new Device({
        deviceId: "DEV-BAD",
        resetCount: -1
    });
    const resetError = badDevice.validateSync();
    assert.ok(resetError && resetError.errors.resetCount, "Negative resetCount must be rejected");
});

// -------------------------------------------------------------
// 7. SensorReading Schema & Immutability / Nullable Doctor
// -------------------------------------------------------------
runTest("7. SensorReading schema: doctorId is nullable for unassigned patient readings", () => {
    const readingWithoutDoctor = new SensorReading({
        deviceId: "DEV-001",
        patientId: "PAT-001",
        doctorId: null,
        value1: 98.6,
        value2: 72,
        timestamp: new Date()
    });

    assert.strictEqual(readingWithoutDoctor.doctorId, null, "doctorId can be null for reading");
    assert.strictEqual(readingWithoutDoctor.validateSync(), undefined, "Reading with doctorId=null must be valid");

    // Missing value check
    const badReading = new SensorReading({
        deviceId: "DEV-001",
        patientId: "PAT-001",
        value1: 98.6
    });
    const readingErrors = badReading.validateSync().errors;
    assert.ok(readingErrors.value2, "value2 must be required");
    assert.ok(readingErrors.timestamp, "timestamp must be required");
});

// -------------------------------------------------------------
// 8. ActivityLog Schema & Audit Structure
// -------------------------------------------------------------
runTest("8. ActivityLog schema: action enum, actorRole, targetType, and details json", () => {
    const log = new ActivityLog({
        action: AUDIT_ACTIONS.DEVICE_RESET,
        actorRole: ACTOR_ROLES.SUPER_ADMIN,
        actorId: "ADM-001",
        targetType: TARGET_TYPES.DEVICE,
        targetId: "DEV-001",
        details: { previousPatientId: "PAT-001", resetCount: 1 }
    });

    assert.strictEqual(log.validateSync(), undefined, "Valid activity log must pass validation");
    assert.strictEqual(log.details.previousPatientId, "PAT-001");

    // Invalid action rejection
    const invalidLog = new ActivityLog({
        action: "INVALID_HACK_ACTION",
        actorRole: "UNKNOWN_ROLE",
        actorId: "HACKER",
        targetType: "SERVER"
    });
    const logErrors = invalidLog.validateSync().errors;
    assert.ok(logErrors.action, "Invalid action enum must fail validation");
    assert.ok(logErrors.actorRole, "Invalid actorRole enum must fail validation");
    assert.ok(logErrors.targetType, "Invalid targetType enum must fail validation");
});

// -------------------------------------------------------------
// 9. Index Declaration Verification
// -------------------------------------------------------------
runTest("9. Indexes: sparse unique and compound indexes are declared correctly", () => {
    // Helper to find index in schema.indexes()
    function hasIndex(indexes, fieldsObj, optionsObj = {}) {
        return indexes.some(([fields, options]) => {
            const fieldsMatch = JSON.stringify(fields) === JSON.stringify(fieldsObj);
            if (!fieldsMatch) return false;
            for (const [key, val] of Object.entries(optionsObj)) {
                if (options[key] !== val) return false;
            }
            return true;
        });
    }

    const userIndexes = User.schema.indexes();
    assert.ok(
        hasIndex(userIndexes, { profileId: 1 }, { unique: true, sparse: true }),
        "User schema must declare sparse unique index on profileId"
    );

    const patientIndexes = Patient.schema.indexes();
    assert.ok(
        hasIndex(patientIndexes, { deviceId: 1 }, { unique: true, sparse: true }),
        "Patient schema must declare sparse unique index on deviceId"
    );
    assert.ok(
        hasIndex(patientIndexes, { doctorId: 1 }),
        "Patient schema must declare index on doctorId"
    );

    const deviceIndexes = Device.schema.indexes();
    assert.ok(
        hasIndex(deviceIndexes, { patientId: 1 }, { unique: true, sparse: true }),
        "Device schema must declare sparse unique index on patientId"
    );

    const readingIndexes = SensorReading.schema.indexes();
    assert.ok(
        hasIndex(readingIndexes, { patientId: 1, timestamp: -1 }),
        "SensorReading must declare compound index on { patientId: 1, timestamp: -1 }"
    );
    assert.ok(
        hasIndex(readingIndexes, { deviceId: 1, timestamp: -1 }),
        "SensorReading must declare compound index on { deviceId: 1, timestamp: -1 }"
    );
    assert.ok(
        hasIndex(readingIndexes, { doctorId: 1, timestamp: -1 }),
        "SensorReading must declare compound index on { doctorId: 1, timestamp: -1 }"
    );

    const activityIndexes = ActivityLog.schema.indexes();
    assert.ok(
        hasIndex(activityIndexes, { actorId: 1, timestamp: -1 }),
        "ActivityLog must declare compound index on { actorId: 1, timestamp: -1 }"
    );
    assert.ok(
        hasIndex(activityIndexes, { targetId: 1, timestamp: -1 }),
        "ActivityLog must declare compound index on { targetId: 1, timestamp: -1 }"
    );
});

// -------------------------------------------------------------
// 10. Existing Application Boot Check
// -------------------------------------------------------------
runTest("10. Existing application loads without throwing syntax/dependency errors", () => {
    const app = require("../src/app");
    assert.strictEqual(typeof app, "function", "Express app must export an application function");
});

console.log("\n=================================================");
console.log(`TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log("=================================================");

if (passedTests === totalTests) {
    console.log("PHASE 0 ARCHITECTURAL & SCHEMA VERIFICATION: SUCCESS");
    process.exit(0);
} else {
    console.error("PHASE 0 ARCHITECTURAL & SCHEMA VERIFICATION: FAILED");
    process.exit(1);
}
