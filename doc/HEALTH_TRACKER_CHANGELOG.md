# HEALTH TRACKER — CHANGELOG & ARCHITECTURAL DECISION RECORD
**Authoritative Ledger of Codebase & Architectural Changes**

---

## CHANGELOG ENTRIES

### 2026-10-01 — Phase 6: Patient Registration UI & Real-Time Device Claim Validation
- **Phase / Task:** PHASE 6 (`TASK-6.1`, `TASK-6.2`)
- **Change:**
  1. Enhanced `src/controllers/authController.js`:
     - `getDeviceStatus`: Created server-authoritative endpoint (`GET /api/auth/device-status/:deviceId`) for public registration checking. Evaluates whether a device ID is `UNKNOWN` (404), `INACTIVE` (200, `claimable: false`), `ASSIGNED` (200, `claimable: false`), or `CLAIMABLE` (200, `claimable: true`, `"This device is ready to be assigned."`). Strips all sensitive fields (`apiKeyHash`, internal IDs, passwords, JWT secrets) and normalizes input to uppercase.
     - `register`: Upgraded patient registration pipeline to atomically claim the hardware device using `Device.findOneAndUpdate({ deviceId, status: 'ACTIVE', patientId: null }, { $set: { patientId: candidateId } }, { returnDocument: 'after' })`. Eliminates concurrency race conditions where two simultaneous registrations target the same device. Implemented multi-stage compensation rollback: if user or patient document insertion fails, the device assignment is immediately rolled back to `patientId = null`. Enforces strict role assignment (`ROLES.PATIENT` only), ignores client-supplied `role` and `patientId` payloads, and logs both `PATIENT_REGISTERED` and `DEVICE_ASSIGNED` in `ActivityLog`.
  2. Updated `src/routes/authRoutes.js`:
     - Mounted `GET /device-status/:deviceId` route pointing to `authController.getDeviceStatus`.
  3. Upgraded Patient Registration UI (`src/views/auth/register.ejs` & `src/public/css/auth.css`):
     - Added real-time debounced (350ms) device availability checking against the backend status endpoint.
     - Implemented dynamic status badges: Loading indicator (`"Checking device availability..."`), Success badge (`✓ This device is ready to be assigned.`), Inactive alert (`✗ This device is currently inactive.`), Assigned alert (`✗ This device is already assigned.`), and Unknown alert (`✗ Device not found.`).
     - Added visual input state borders (`input-claimable`, `input-error`) and disabled form submission when device is unavailable or unverified.
     - Preserved burnt-orange/dark aesthetic and added client-side confirmation check.
  4. Implemented dedicated Phase 6 test suite (`tests/patientRegistrationValidation.test.js`):
     - 28 comprehensive automated tests covering: valid patient registration (201 Created), missing name rejection (400), invalid email format rejection (400), duplicate email rejection (400), password mismatch rejection (400), password length validation (400), unknown device rejection (400), inactive device rejection (400), assigned device rejection (400), device status endpoint checking, 1:1 reciprocal assignment verification (`Device.patientId === Patient.patientId` and `Patient.deviceId === Device.deviceId`), one-device-per-patient invariant, assigned device claim prevention, inactive device claim prevention, post-reset reclaim verification, historical telemetry survival after reset, role spoofing defense (`SUPER_ADMIN`/`DOCTOR` injection prevention), patientId spoofing defense, doctor self-registration denial, client arbitrary flag discarding, race condition / simultaneous claim safety, failed registration rollback integrity, device status endpoint accuracy, sensitive field leak prevention (`apiKeyHash`, secrets), malformed device ID safety, and comprehensive state transitions (`CLAIMABLE`, `INACTIVE`, `ASSIGNED`, `UNKNOWN`).
  5. Updated `package.json`:
     - Added `test:claim` script (`node tests/patientRegistrationValidation.test.js`) and wired into master `npm test` pipeline.
- **Reason:**
  Establish a reliable, server-authoritative, race-condition-safe patient onboarding experience with real-time UI feedback while upholding strict database invariants, security boundaries, and zero secret leakage.
- **Files Affected:**
  - `src/controllers/authController.js`
  - `src/routes/authRoutes.js`
  - `src/views/auth/register.ejs`
  - `src/public/css/auth.css`
  - `package.json`
  - `tests/patientRegistrationValidation.test.js`
  - `doc/HEALTH_TRACKER_TASK_TRACKER.md`
  - `doc/HEALTH_TRACKER_PROGRESS.md`
  - `doc/HEALTH_TRACKER_CHANGELOG.md`
- **Verification:**
  - `node tests/patientRegistrationValidation.test.js`: 28/28 tests passed.
  - `node tests/schemaValidation.test.js`: 10/10 tests passed (Phase 0 regression).
  - `node tests/iotSimulator.test.js`: 10/10 tests passed (Phase 1 regression).
  - `node tests/authValidation.test.js`: 20/20 tests passed (Phase 2 regression).
  - `node tests/rbacValidation.test.js`: 24/24 tests passed (Phase 3 regression).
  - `node tests/adminPortalValidation.test.js`: 20/20 tests passed (Phase 4 regression).
  - `node tests/deviceManagementValidation.test.js`: 34/34 tests passed (Phase 5 regression).
  - `npm test`: 146/146 total tests passed with zero failures across all 7 test suites.

### 2026-10-01 — Phase 5: Hardware Device Management & Lifecycle Engine
- **Phase / Task:** PHASE 5 (`TASK-5.1`, `TASK-5.2`, `TASK-5.3`)
- **Change:**
  1. Implemented `src/controllers/adminDeviceController.js`:
     - `createDevice`: Provisions new hardware devices (`status: ACTIVE`, `patientId: null`, `resetCount: 0`). Rejects duplicate device IDs cleanly with 400 Bad Request. Sanitizes outputs to ensure `apiKeyHash` is never exposed. Logs `DEVICE_CREATED` in `ActivityLog`.
     - `getDevices`: Lists all registered devices with populated patient information (`name`, `patientId`), lifecycle status, and reset count. Supports both JSON API and EJS view rendering.
     - `getDeviceById`: Retrieves detailed hardware specifications, current assignment, telemetry metrics (`totalReadings`, `latestReading`), and recent audit events for a single device.
     - `activateDevice` & `deactivateDevice`: Toggles device operational status (`ACTIVE` / `INACTIVE`). Strictly preserves patient ownership (`patientId`) and `resetCount`. Logs `DEVICE_ACTIVATED` / `DEVICE_DEACTIVATED` in `ActivityLog`.
     - `resetDevice`: Executes safe, atomic-style device reset. Unlinks patient (`Device.patientId = null`, `Patient.deviceId = null`), increments `Device.resetCount` by 1, strictly preserves all historical `SensorReading` records and Patient account, and logs `DEVICE_RESET` in `ActivityLog`. Uses MongoDB session transactions where supported by the cluster, with compensation rollback in standalone development environments.
     - `deleteDevice`: Decommissions and permanently deletes hardware unit only when unassigned (`patientId === null`). Rejects deletion of assigned devices with 400 Bad Request. Strictly preserves all historical telemetry records previously captured by the device. Logs `DEVICE_DELETED` in `ActivityLog`.
     - `assignDevice`: Enforces 1:1 reciprocal assignment invariants (`Device -> max 1 Patient`, `Patient -> max 1 Device`). Validates active status, unassigned state, and updates both records atomically. Logs `DEVICE_ASSIGNED`.
  2. Updated `src/routes/adminRoutes.js`:
     - Mounted all Phase 5 device management routes under `/api/admin/devices` and `/admin/devices`.
     - Guarded all mutation endpoints with `authenticate` and `requireRole(ROLES.SUPER_ADMIN)`.
  3. Upgraded `src/models/Device.js`:
     - Added explicit `type` field (default `"VITAL_TELEMETRY"`).
     - Preserved unique partial index on `patientId` (`partialFilterExpression: { patientId: { $type: "string" } }`) and standard index on `status`.
  4. Upgraded Super Admin UI (`src/views/admin/devices.ejs` & `src/public/css/admin.css`):
     - Interactive Device Provisioning modal with validation and uppercase normalizer.
     - Table displaying Device ID, Type, separate Lifecycle Status pill (`ACTIVE`/`INACTIVE`), Binding Status pill (`ASSIGNED`/`UNASSIGNED`), Assigned Patient, Reset Count, and Last Activity.
     - Action buttons: Activate / Deactivate toggles, Reset confirmation modal (detailing unlinking effect and telemetry preservation), and Decommission modal (with safety lock preventing deletion of assigned devices).
     - Created detailed hardware inspector view at `src/views/admin/deviceDetail.ejs`.
  5. Implemented comprehensive test suite `tests/deviceManagementValidation.test.js`:
     - Covered all 34 automated test cases including creation, RBAC checks (Patient/Doctor/Unauthenticated rejection), duplicate rejection, default states, activation/deactivation ownership preservation, IoT telemetry rejection when inactive, atomic reset unlinking, reading/account preservation, 1:1 invariants, ActivityLog audit recording, details retrieval, and safe delete validation.
  6. Updated `package.json`:
     - Added `test:device` script and wired into `npm test` runner.
- **Reason:**
  Deliver complete hardware device lifecycle management and administration for Super Admins while enforcing database invariants, telemetry immutability, and 1:1 ownership.
- **Files Affected:**
  - `src/controllers/adminDeviceController.js`
  - `src/routes/adminRoutes.js`
  - `src/models/Device.js`
  - `src/views/admin/devices.ejs`
  - `src/views/admin/deviceDetail.ejs`
  - `src/public/css/admin.css`
  - `package.json`
  - `tests/deviceManagementValidation.test.js`
  - `doc/HEALTH_TRACKER_TASK_TRACKER.md`
  - `doc/HEALTH_TRACKER_PROGRESS.md`
  - `doc/HEALTH_TRACKER_CHANGELOG.md`
- **Verification:**
  - `node tests/deviceManagementValidation.test.js`: 34/34 tests passed.
  - `node tests/schemaValidation.test.js`: 10/10 tests passed (regression).
  - `node tests/iotSimulator.test.js`: 10/10 tests passed (regression).
  - `node tests/authValidation.test.js`: 20/20 tests passed (regression).
  - `node tests/rbacValidation.test.js`: 24/24 tests passed (regression).
  - `node tests/adminPortalValidation.test.js`: 20/20 tests passed (regression).
  - `npm test`: 118/118 total tests passed with zero failures across all suites.

### 2026-09-30 — Phase 4: Super Admin Portal & Layout
- **Phase / Task:** PHASE 4 (`TASK-4.1`, `TASK-4.2`, `TASK-4.3`)
- **Change:**
  1. Implemented `src/controllers/adminController.js`:
     - `getOverview`: Aggregates live system metrics from MongoDB (total patients, total doctors, total devices, active/inactive devices, assigned/unassigned devices, active/suspended users, total readings, today's readings, latest reading timestamp) alongside recent patients, doctors, and devices.
     - `getDoctors`: Generates read-only clinical registry with doctor ID, name, email, specialization, status, assigned patient counts, and account status.
     - `getPatients`: Generates read-only patient registry with patient ID, name, email, demographics, current doctor, linked device, and account status.
     - `getDevices`: Generates read-only hardware inventory with device ID, type, status, assigned patient, and reset count.
     - `getActivity`: Generates system activity event log stream with graceful empty-state handling.
     - `logout`: Clears authentication cookies and redirects browser requests to `/login`.
     - `getStatus`: Preserves Phase 3 API authorization status contract.
  2. Updated `src/routes/adminRoutes.js` and `src/app.js`:
     - Mounted `/admin` and `/api/admin` routes guarded by `authenticate` and `requireRole(ROLES.SUPER_ADMIN)`.
     - Enforced strict denial for `PATIENT` and `DOCTOR` roles (403 Forbidden) and unauthenticated sessions (302 redirect for HTML / 401 for API).
  3. Created reusable Super Admin EJS layout and views:
     - `src/views/admin/partials/sidebar.ejs`: Branding, navigation links (Overview, Doctors, Patients, Devices, Activity), active state indicator, admin profile card, and logout button.
     - `src/views/admin/partials/topbar.ejs`: Page title and subtitle, online indicator, admin identity badge, and topbar logout link.
     - `src/views/admin/overview.ejs`: Summary metric cards and recent records tables.
     - `src/views/admin/doctors.ejs`: Read-only doctors table with Phase 7 foundation banner.
     - `src/views/admin/patients.ejs`: Read-only patients table with Phase 8 foundation banner.
     - `src/views/admin/devices.ejs`: Read-only devices table with Phase 5 foundation banner.
     - `src/views/admin/activity.ejs`: Audit log table with Phase 13 foundation banner and zero-record empty states.
  4. Created `src/public/css/admin.css`:
     - Adheres strictly to project design language: Background `#11100E`, Surface `#1A1815`, Surface Light `#24211D`, Vanilla `#FFF4D6`, Burnt Orange `#FC6C26`, Muted `#A8A39A`.
     - Responsive grid and sidebar layouts supporting desktop, laptop, tablet, and mobile displays without horizontal overflow.
  5. Implemented comprehensive automated test suite `tests/adminPortalValidation.test.js`:
     - Verified all 20 required criteria: overview loads, role access restrictions (PATIENT/DOCTOR 403), unauthenticated redirect/401, subpage access, metric accuracy, secret non-leakage, logout invalidation, empty state resilience, and navigation resolution.
  6. Added `test:admin` to `package.json` and wired into `npm test`.
- **Reason:**
  Establish a fully functional, presentation-ready Super Admin portal with reusable layouts, live MongoDB metric aggregation, and read-only management foundations while preserving strict role boundaries.
- **Files Affected:**
  - `src/controllers/adminController.js`
  - `src/routes/adminRoutes.js`
  - `src/app.js`
  - `src/views/admin/partials/sidebar.ejs`
  - `src/views/admin/partials/topbar.ejs`
  - `src/views/admin/overview.ejs`
  - `src/views/admin/doctors.ejs`
  - `src/views/admin/patients.ejs`
  - `src/views/admin/devices.ejs`
  - `src/views/admin/activity.ejs`
  - `src/public/css/admin.css`
  - `package.json`
  - `tests/adminPortalValidation.test.js`
  - `doc/HEALTH_TRACKER_TASK_TRACKER.md`
  - `doc/HEALTH_TRACKER_PROGRESS.md`
  - `doc/HEALTH_TRACKER_CHANGELOG.md`
- **Verification:**
  - `node tests/adminPortalValidation.test.js`: 20/20 tests passed.
  - `node tests/schemaValidation.test.js`: 10/10 tests passed (regression).
  - `node tests/iotSimulator.test.js`: 10/10 tests passed (regression).
  - `node tests/authValidation.test.js`: 20/20 tests passed (regression).
  - `node tests/rbacValidation.test.js`: 24/24 tests passed (regression).
  - `npm test`: 84/84 total tests passed across all 5 suites.

### 2026-09-30 — Phase 3: Role-Based Authorization (RBAC) & Socket Authentication
- **Phase / Task:** PHASE 3 (`TASK-3.1`, `TASK-3.2`, `TASK-3.3`)
- **Change:**
  1. Implemented server-side RBAC and ownership middleware (`src/middleware/roleMiddleware.js`):
     - `requireRole(...roles)`: Strictly verifies authenticated role from verified JWT (`req.user.role`); rejects client-supplied roles in query, body, or params with 403 Forbidden.
     - `requirePatientOwnership(patientIdParam)`: Enforces that patients can only access their own profile ID (`req.user.profileId === targetPatientId`); doctors can only access patients currently assigned to them in MongoDB (`patient.doctorId === req.user.profileId`); super admins are permitted; redirects unauthenticated HTML requests to `/login` and returns 401/403 for API requests.
     - `requireDoctorOwnership(doctorIdParam)`: Enforces that doctors can only access their own dashboard (`req.user.profileId === targetDoctorId`); super admins are permitted; patients are strictly denied with 403.
  2. Protected dashboard routes (`src/routes/dashboardRoutes.js`):
     - `GET /patient/:patientId` guarded with `authenticate, requirePatientOwnership("patientId")`.
     - `GET /doctor/:doctorId` guarded with `authenticate, requireDoctorOwnership("doctorId")`.
  3. Created Super Admin foundation route (`src/routes/adminRoutes.js` mounted at `/api/admin`):
     - `GET /api/admin/status` guarded with `authenticate, requireRole(ROLES.SUPER_ADMIN)` establishing the administrative authorization foundation.
  4. Updated authentication middleware (`src/middleware/authMiddleware.js`):
     - Added `isApiRequest(req)` helper to redirect unauthenticated browser HTML page requests to `/login` while returning JSON 401/403 for API requests.
  5. Implemented Socket.IO cryptographic handshake authentication (`src/server.js`):
     - Extracted token from `socket.handshake.auth.token`, HTTP-only cookies (`socket.handshake.headers.cookie`), or `Authorization: Bearer <token>`.
     - Cryptographically verified JWT signature and expiration.
     - Verified user existence in MongoDB and rejected non-ACTIVE accounts (`status !== 'ACTIVE'`) with 403 / `ACCOUNT_SUSPENDED`.
     - Attached verified principal identity to `socket.user` (`userId`, `role`, `profileId`, `status`).
  6. Implemented server-authorized Socket.IO room joining (`src/server.js`):
     - Automatically auto-joins sockets to their verified rooms on connection (`patient:<profileId>` for patients, `doctor:<profileId>` for doctors, `admin:telemetry` for super admins).
     - Filtered and validated `join-room` events: clients cannot spoof roles or target IDs; patients cannot join another patient's room; doctors can only join assigned patient rooms verified against current database state.
     - Preserved historical telemetry immutability while ensuring reassigned patients immediately route new telemetry to their new doctor's room.
  7. Updated client-side socket scripts (`src/public/js/patient.js`, `src/public/js/doctor.js`):
     - Added `connect_error` listener redirecting to `/login` on authentication failure.
  8. Created dedicated Phase 3 test suite (`tests/rbacValidation.test.js`) covering all 24 required test scenarios with 100% pass rate.
  9. Added `test:rbac` to `package.json` and updated `npm test` script.
- **Reason:**
  Establish complete server-side role-based authorization and cryptographic Socket.IO handshake authentication, strictly decoupling authentication from authorization and closing cross-patient/cross-doctor data and telemetry leakage vectors.
- **Files Affected:**
  - `src/middleware/authMiddleware.js`
  - `src/middleware/roleMiddleware.js`
  - `src/routes/dashboardRoutes.js`
  - `src/routes/adminRoutes.js`
  - `src/app.js`
  - `src/server.js`
  - `src/public/js/patient.js`
  - `src/public/js/doctor.js`
  - `package.json`
  - `tests/rbacValidation.test.js`
  - `doc/HEALTH_TRACKER_TASK_TRACKER.md`
  - `doc/HEALTH_TRACKER_PROGRESS.md`
  - `doc/HEALTH_TRACKER_CHANGELOG.md`
- **Verification:**
  - `node tests/rbacValidation.test.js`: 24/24 tests passed.
  - `node tests/authValidation.test.js`: 20/20 tests passed (regression).
  - `node tests/schemaValidation.test.js`: 10/10 tests passed (regression).
  - `node tests/iotSimulator.test.js`: 10/10 tests passed (regression).
  - `npm test`: 64/64 total tests passed across all 4 suites.

### 2026-09-30 — Phase 2: Authentication & Identity Foundation
- **Phase / Task:** PHASE 2 (`TASK-2.1` through `TASK-2.5`)
- **Change:**
  1. Installed authentication dependencies (`bcryptjs`, `jsonwebtoken`, `cookie-parser`) and established centralized auth configuration (`src/config/auth.js`) with environment variable validation for `JWT_SECRET`, `JWT_EXPIRES_IN`, salt rounds (>= 10), and environment-aware HTTP-only cookie settings.
  2. Implemented password hashing and JWT utility suite (`src/utils/authUtils.js`) providing `hashPassword`, `comparePassword`, `generateToken`, and `verifyToken`.
  3. Added `comparePassword` instance method to `src/models/User.js`.
  4. Implemented `authController.js` and `authRoutes.js` (`POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`):
     - `register`: Restricted strictly to Patient role; validates name, email format, password confirmation, minimum length, duplicate email in User & Patient collections, hardware device existence, `status === 'ACTIVE'`, and `patientId === null`; creates User + Patient records maintaining the 1:1 relational invariant, sets `doctorId = null`, binds device, and sets HTTP-only cookie.
     - `login`: Supports login via email, username, or registered patient name; validates account status (`status === 'ACTIVE'`), compares bcrypt password hash, generates minimal JWT payload (`userId`, `role`, `profileId`), and sets secure HTTP-only cookie.
     - `logout`: Clears authentication cookies without deleting database records or releasing devices.
  5. Implemented reusable authentication middleware (`src/middleware/authMiddleware.js`) extracting tokens from HTTP-only cookies (or Authorization header), verifying signature, and attaching active `req.user`.
  6. Created server-rendered EJS views for login (`/login`) and patient registration (`/register`) matching the project's dark and burnt-orange UI theme.
  7. Created idempotent Super Admin seeder (`src/seed/seedAdmin.js`) and updated main database seeder (`src/seed/seed.js`) with bcrypt password hashes.
  8. Created comprehensive automated test suite (`tests/authValidation.test.js`) validating all 20 required authentication criteria.
- **Reason:**
  Establish secure, cryptographic identity management, session handling, and credential protection for patient enrollment and platform sign-in before building role-based authorization in Phase 3.
- **Files Affected:**
  - `package.json`, `package-lock.json`
  - `.env`
  - `src/config/auth.js`
  - `src/config/database.js`
  - `src/models/User.js`
  - `src/utils/authUtils.js`
  - `src/middleware/authMiddleware.js`
  - `src/controllers/authController.js`
  - `src/routes/authRoutes.js`
  - `src/views/auth/login.ejs`
  - `src/views/auth/register.ejs`
  - `src/public/css/auth.css`
  - `src/app.js`
  - `src/seed/seedAdmin.js`
  - `src/seed/seed.js`
  - `tests/authValidation.test.js`
  - `doc/HEALTH_TRACKER_TASK_TRACKER.md`
  - `doc/HEALTH_TRACKER_PROGRESS.md`
  - `doc/HEALTH_TRACKER_CHANGELOG.md`
- **Verification:**
  - `node tests/authValidation.test.js`: 20/20 tests passed.
  - `node tests/schemaValidation.test.js`: 10/10 tests passed (regression).
  - `node tests/iotSimulator.test.js`: 10/10 tests passed (regression).
  - `node src/seed/seed.js`: seeded successfully with relational integrity.

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
