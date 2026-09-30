# HEALTH TRACKER — CHANGELOG & ARCHITECTURAL DECISION RECORD
**Authoritative Ledger of Codebase & Architectural Changes**

---

## CHANGELOG ENTRIES

### 2026-09-30 — Phase 1: IoT Automated Simulator
- **Phase / Task:** PHASE 1 (`TASK-1.1`, `TASK-1.2`)
- **Change:**
  1. Created headless multi-device IoT telemetry simulator (`tests/iotSimulator.js`) with CLI flag parsing (`--devices`, `--interval`, `--url`, `--count`, `--help`), random-walk synthetic telemetry generation within safe bounds (value1: 55-105, value2: 92-100), ISO timestamping, real HTTP ingestion via `POST /api/iot/data`, robust connection error/timeout handling, and clean graceful shutdown on `SIGINT` / `SIGTERM`.
  2. Updated IoT ingestion route (`src/routes/iotRoutes.js`):
     - Return HTTP 201 Created on successful telemetry ingestion (conforming to Master Roadmap specification).
     - Return HTTP 404 Not Found for unregistered devices.
     - Return HTTP 403 Forbidden for inactive devices (`device.status !== 'ACTIVE'`).
     - Accommodate unassigned patients (`patient.doctorId === null`) without error, recording `SensorReading.doctorId = null` and omitting doctor-room socket emission.
     - Decouple database persistence from real-time Socket.IO emission with an `if (io)` guard so telemetry storage succeeds even if Socket.IO is uninitialized.
  3. Created automated verification test suite (`tests/iotSimulator.test.js`) containing 10 tests across CLI parsing, synthetic telemetry range validation, HTTP ingestion status codes (201, 404, 403), server offline resilience, multi-device concurrent simulation, and graceful shutdown.
- **Reason:**
  Replace repetitive manual Thunder Client testing with an automated headless multi-device telemetry generator that exercises the real HTTP ingestion pipeline and validates Phase 0 schema compliance under real network conditions.
- **Files Affected:**
  - `tests/iotSimulator.js`
  - `src/routes/iotRoutes.js`
  - `tests/iotSimulator.test.js`
  - `doc/HEALTH_TRACKER_TASK_TRACKER.md`
  - `doc/HEALTH_TRACKER_PROGRESS.md`
  - `doc/HEALTH_TRACKER_CHANGELOG.md`
- **Verification:**
  - `node tests/iotSimulator.test.js`: 10/10 tests passed.
  - `node tests/iotSimulator.js --devices DEV-001,DEV-002 --interval 100 --count 2`: successfully handled offline backend and cleanly exited with code 0.

### 2026-09-30 — Phase 0: Final Tracker Audit & Index Refinement
- **Phase / Task:** PHASE 0 (`TASK-0.1` through `TASK-0.8`)
- **Change:**
  1. Audited all 8 Phase 0 tasks against current code and the Master Development Roadmap.
  2. Applied official ROADMAP CHANGE 001: Upgraded `Patient.deviceId`, `Device.patientId`, and `User.profileId` unique indexes to unique partial indexes (`partialFilterExpression: { <field>: { $type: "string" } }`) so multiple unassigned entities storing `null` are permitted in MongoDB without duplicate key conflicts.
  3. Applied official ROADMAP CHANGE 002: Updated roadmap status verification rules to use uppercase `'ACTIVE'` (or `DEVICE_STATUS.ACTIVE` / `DOCTOR_STATUS.ACTIVE`).
  4. Executed Phase 0 schema verification suite (`tests/schemaValidation.test.js`): 10/10 passed offline.
- **Reason:**
  Ensure 100% adherence to MongoDB relational invariants and confirm full Phase 0 completion before any Phase 1 execution.
- **Files Affected:**
  - `doc/HEALTH_TRACKER_MASTER_ROADMAP.md`
  - `src/models/User.js`
  - `src/models/Patient.js`
  - `src/models/Device.js`
  - `tests/schemaValidation.test.js`
  - `doc/HEALTH_TRACKER_TASK_TRACKER.md`
  - `doc/HEALTH_TRACKER_PROGRESS.md`
  - `doc/HEALTH_TRACKER_CHANGELOG.md`
- **Verification:**
  - `node tests/schemaValidation.test.js`: 10/10 tests passed offline.

### 2026-09-30 — Phase 0: Architecture & Database Schema Freeze
- **Phase / Task:** PHASE 0 (`TASK-0.1` through `TASK-0.8`)
- **Change:**
  1. Created `src/config/constants.js` defining frozen enums: `ROLES`, `ACCOUNT_STATUS`, `DOCTOR_STATUS`, `DEVICE_STATUS`, `TARGET_TYPES`, `ACTOR_ROLES`, `AUDIT_ACTIONS`.
  2. Implemented `src/models/User.js` with credentials, role, status enums, and sparse unique `profileId`.
  3. Formalized `src/models/Doctor.js` with 1:1 `userId` ref to User, `email`, `phone`, `specialization`, and `status`.
  4. Formalized `src/models/Patient.js` with 1:1 `userId` ref to User, `email`, `age`, nullable indexed `doctorId`, and nullable sparse unique `deviceId`.
  5. Formalized `src/models/Device.js` with nullable sparse unique `patientId`, `status` normalizer, `resetCount` (default 0), and `lastSeen`.
  6. Formalized `src/models/SensorReading.js` with append-only semantics, nullable `doctorId`, and compound indexes (`{ patientId: 1, timestamp: -1 }`, `{ deviceId: 1, timestamp: -1 }`, `{ doctorId: 1, timestamp: -1 }`).
  7. Implemented `src/models/ActivityLog.js` with audit action enums, actor/target types, and compound indexes (`{ actorId: 1, timestamp: -1 }`, `{ targetId: 1, timestamp: -1 }`).
  8. Created offline schema test suite `tests/schemaValidation.test.js` validating all models, indexes, nullability, and enums.
  9. Updated `src/seed/seed.js` to create valid `User` records with reciprocal 1:1 relationships.
- **Reason:**
  Establish authoritative, immutable schema invariants and relational constraints across identities, clinical profiles, hardware devices, and telemetry before implementing Phase 1 simulator or Phase 2 authentication.
- **Files Affected:**
  - `src/config/constants.js`
  - `src/models/User.js`
  - `src/models/Doctor.js`
  - `src/models/Patient.js`
  - `src/models/Device.js`
  - `src/models/SensorReading.js`
  - `src/models/ActivityLog.js`
  - `src/seed/seed.js`
  - `tests/schemaValidation.test.js`
  - `doc/HEALTH_TRACKER_TASK_TRACKER.md`
  - `doc/HEALTH_TRACKER_PROGRESS.md`
  - `doc/HEALTH_TRACKER_CHANGELOG.md`
- **Verification:**
  - `node tests/schemaValidation.test.js`: 10/10 tests passed offline.
  - Syntax checked all models and constants with `node --check`.

### 2026-09-30 — Project Control Documents Setup
- **Phase / Task:** SETUP
- **Change:** 
  1. Created `/doc` directory to house all authoritative project management and governance documents.
  2. Preserved the frozen authoritative master development roadmap at `doc/HEALTH_TRACKER_MASTER_ROADMAP.md` (verified identical via SHA-256).
  3. Created the continuous, strictly anti-hallucination task tracker at `doc/HEALTH_TRACKER_TASK_TRACKER.md` tracking all 46 tasks across 20 phases.
  4. Created the executive project progress dashboard at `doc/HEALTH_TRACKER_PROGRESS.md` detailing current state, milestone progress, and codebase discrepancies.
  5. Created this changelog at `doc/HEALTH_TRACKER_CHANGELOG.md`.
- **Reason:** 
  Establish strict governance, task dependency tracking, and anti-hallucination controls before modifying any application source code or beginning Phase 0.
- **Files Affected:**
  - `doc/HEALTH_TRACKER_MASTER_ROADMAP.md`
  - `doc/HEALTH_TRACKER_TASK_TRACKER.md`
  - `doc/HEALTH_TRACKER_PROGRESS.md`
  - `doc/HEALTH_TRACKER_CHANGELOG.md`
- **Verification:**
  - `HEALTH_TRACKER_MASTER_ROADMAP.md` SHA-256 checksum verified (`6A0F8CD359F76C1A5ADC49677C28BBA7AC458723195C4CB8D9168FA8B6D0B9AF`).
  - Audited existing repository files (`src/models/`, `src/routes/`, `src/app.js`, `src/server.js`, `src/seed/`, `tests/`) to verify actual repository baseline.
  - Verified no application source files (`src/*`, `package.json`, etc.) were modified or committed in this setup step.
  - Git commit staged only `doc/` files and pushed to remote `origin/main`.
