# HEALTH TRACKER — TASK TRACKER
**Authoritative Operational Tracker for Antigravity & Engineering**
*Maintained Continuously | Strict Anti-Hallucination Governance*

---

## OPERATIONAL RULES FOR THIS TRACKER
1. **Never mark DONE without proof:** A task is ONLY marked `DONE` after actual code implementation and verified test execution.
2. **Never assume or extrapolate:** Never mark a task `DONE` because it was planned, discussed, or assumed.
3. **No fabricated results:** Never report a test result or verification without running it and inspecting actual output.
4. **Unverified tasks stay IN_PROGRESS or BLOCKED:** If a verification step fails, times out, or has not been run, the task MUST NOT be marked `DONE`.
5. **No silent skipping:** Tasks must be executed in dependency order. Never skip a task silently.
6. **Permanent history:** Completed tasks remain permanently recorded with their test verification and date.

**Status Legend:**
- `NOT_STARTED`: Work has not begun.
- `IN_PROGRESS`: Currently being actively implemented.
- `BLOCKED`: Cannot proceed due to unmet dependency or external impediment.
- `DONE`: Fully implemented, verified against tests, and committed.

---

## SUMMARY SCOREBOARD

| Metric | Value |
| :--- | :--- |
| **Total Phases** | 20 (Phase 0 to Phase 19) |
| **Total Tracked Tasks** | 46 |
| **Tasks Completed** | 15 |
| **Tasks In Progress** | 0 |
| **Tasks Blocked** | 0 |
| **Tasks Not Started** | 31 |
| **Overall Completion** | 32.6% |

---

## DETAILED TASK TRACKER BY PHASE

### PHASE 0: Architecture & Database Schema Freeze
*Goal:* Reconcile and formalize Mongoose schemas, relationships, constraints, and centralized constants.
*Dependencies:* None

| Task ID | Task Description | Status | Dependencies | Files Affected | Verification / Test Result | Date Completed | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| `TASK-0.1` | Create centralized system constants (Roles: `SUPER_ADMIN`, `DOCTOR`, `PATIENT`; Account status: `ACTIVE`, `SUSPENDED`; Device status: `ACTIVE`, `INACTIVE`; Audit actions) | `DONE` | None | `src/config/constants.js` | `node tests/schemaValidation.test.js` (Test 2 PASS) | 2026-09-30 | Enums frozen with Object.freeze |
| `TASK-0.2` | Implement User schema with authentication credentials, bcrypt hooks, role enum, status enum, and unique partial `profileId` index | `DONE` | `TASK-0.1` | `src/models/User.js` | `node tests/schemaValidation.test.js` (Test 3, 9 PASS) | 2026-09-30 | Unique partial index with partialFilterExpression validated |
| `TASK-0.3` | Formalize Doctor schema (`doctorId` UK, `userId` UK ref User, `name`, `email` UK, `phone`, `specialization`, `status`) | `DONE` | `TASK-0.1`, `TASK-0.2` | `src/models/Doctor.js` | `node tests/schemaValidation.test.js` (Test 4 PASS) | 2026-09-30 | Replaced minimal prototype schema |
| `TASK-0.4` | Formalize Patient schema (`patientId` UK, `userId` UK ref User, `name`, `email` UK, `age`, nullable `doctorId`, unique partial `deviceId` index) | `DONE` | `TASK-0.1`, `TASK-0.2` | `src/models/Patient.js` | `node tests/schemaValidation.test.js` (Test 5, 9 PASS) | 2026-09-30 | Unassigned doctorId & deviceId strictly null; unique partial index |
| `TASK-0.5` | Formalize Device schema (`deviceId` UK, `status`, nullable unique partial `patientId` index, `apiKeyHash`, `resetCount`, nullable `lastSeen`) | `DONE` | `TASK-0.1` | `src/models/Device.js` | `node tests/schemaValidation.test.js` (Test 6, 9 PASS) | 2026-09-30 | Reset invariant, status normalizer & unique partial index validated |
| `TASK-0.6` | Formalize SensorReading schema (immutable telemetry: `deviceId`, `patientId`, nullable `doctorId`, `value1`, `value2`, `timestamp`; compound indexes) | `DONE` | `TASK-0.1` | `src/models/SensorReading.js` | `node tests/schemaValidation.test.js` (Test 7, 9 PASS) | 2026-09-30 | Compound indexes & nullable doctorId validated |
| `TASK-0.7` | Implement ActivityLog schema (`action`, `actorRole`, `actorId`, `targetType`, `targetId`, `details`, `timestamp` with compound indexes) | `DONE` | `TASK-0.1` | `src/models/ActivityLog.js` | `node tests/schemaValidation.test.js` (Test 8, 9 PASS) | 2026-09-30 | Append-only audit collection with compound indexes |
| `TASK-0.8` | Create offline schema verification script to test model instantiation, validation rules, enum rejections, and index constraints | `DONE` | `TASK-0.1` - `TASK-0.7` | `tests/schemaValidation.test.js` | `node tests/schemaValidation.test.js` (10/10 PASS) | 2026-09-30 | Comprehensive offline suite verified |

---

### PHASE 1: IoT Automated Simulator
*Goal:* Create a multi-device headless simulator and align `/api/iot/data` ingestion responses.
*Dependencies:* Phase 0

| Task ID | Task Description | Status | Dependencies | Files Affected | Verification / Test Result | Date Completed | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| `TASK-1.1` | Create multi-device headless IoT simulator CLI script (`tests/iotSimulator.js`) supporting `--devices`, `--interval`, continuous stream, and graceful `SIGINT` | `DONE` | Phase 0 | `tests/iotSimulator.js` | `node tests/iotSimulator.test.js` (10/10 PASS); manual CLI test (2 cycles PASS) | 2026-09-30 | Replaces manual POST tests; pure HTTP fetch |
| `TASK-1.2` | Update `/api/iot/data` to return 201 Created on valid write, 404 on unknown device, 403 on inactive device, and tolerate `doctorId = null` | `DONE` | Phase 0 | `src/routes/iotRoutes.js` | `node tests/iotSimulator.test.js` (Tests 4, 5, 6, 7 PASS) | 2026-09-30 | 201 status code, null doctorId accommodated, socket decoupled from persistence |

---

### PHASE 2: Authentication & Identity Foundation
*Goal:* Implement secure authentication with bcrypt password hashing and JWT cookies.
*Dependencies:* Phase 0

| Task ID | Task Description | Status | Dependencies | Files Affected | Verification / Test Result | Date Completed | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| `TASK-2.1` | Add auth dependencies (`bcryptjs`, `jsonwebtoken`, `cookie-parser`) and environment secrets validation | `DONE` | Phase 0 | `package.json`, `src/config/auth.js`, `.env` | `node tests/authValidation.test.js` (Tests 1, 12, 13, 20 PASS) | 2026-09-30 | Installed and centralized in config/auth.js |
| `TASK-2.2` | Build Auth Controller with `register` (Patient only; validates device claim), `login` (email/username/name + pwd), and `logout` (clears cookie) | `DONE` | `TASK-2.1` | `src/controllers/authController.js`, `src/utils/authUtils.js` | `node tests/authValidation.test.js` (Tests 3-11, 16-18 PASS) | 2026-09-30 | Issues HTTP-Only secure JWT, hashes passwords with bcrypt >= 10 |
| `TASK-2.3` | Implement Auth routes (`POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`) | `DONE` | `TASK-2.2` | `src/routes/authRoutes.js`, `src/app.js` | `node tests/authValidation.test.js` (Tests 3, 8, 15, 16 PASS) | 2026-09-30 | Public auth API endpoints + token verification middleware |
| `TASK-2.4` | Create database seeder for initial Super Admin credentials (`src/seed/seedAdmin.js`) | `DONE` | `TASK-2.2` | `src/seed/seedAdmin.js`, `src/seed/seed.js` | `node tests/authValidation.test.js` (Test 19 PASS) | 2026-09-30 | Role `SUPER_ADMIN` with `profileId: null`, idempotent execution |
| `TASK-2.5` | Build server-rendered authentication views (Login form and Patient registration form with device field) | `DONE` | `TASK-2.3` | `src/views/auth/login.ejs`, `src/views/auth/register.ejs`, `src/public/css/auth.css` | Syntax checked, routes tested via app smoke test | 2026-09-30 | Consistent dark & burnt-orange design language |

---

### PHASE 3: Role-Based Authorization (RBAC) & Socket Authentication
*Goal:* Enforce server-side role boundaries across HTTP routes and WebSocket connections.
*Dependencies:* Phase 2

| Task ID | Task Description | Status | Dependencies | Files Affected | Verification / Test Result | Date Completed | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| `TASK-3.1` | Implement server-side auth middleware: `verifyToken`, `requireRole`, and ownership validation | `NOT_STARTED` | Phase 2 | `src/middleware/authMiddleware.js`, `src/middleware/roleMiddleware.js` | None (Not yet executed) | - | Derives claims strictly from JWT |
| `TASK-3.2` | Implement Socket.IO handshake JWT authentication middleware and room-join authorization (`patient:<id>`, `doctor:<id>`) | `NOT_STARTED` | Phase 2 | `src/server.js` | None (Not yet executed) | - | Eliminates unauthenticated room subscriptions |
| `TASK-3.3` | Update client-side Socket scripts to attach auth token and handle connection rejection | `NOT_STARTED` | `TASK-3.2` | `src/public/js/patient.js`, `src/public/js/doctor.js` | None (Not yet executed) | - | Secure handshake from browser |

---

### PHASE 4: Super Admin Foundation & Core Dashboard
*Goal:* Build primary Super Admin dashboard and overview metrics page.
*Dependencies:* Phase 3

| Task ID | Task Description | Status | Dependencies | Files Affected | Verification / Test Result | Date Completed | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| `TASK-4.1` | Build Admin Controller and routes guarded by `requireRole(['SUPER_ADMIN'])` | `NOT_STARTED` | Phase 3 | `src/controllers/adminController.js`, `src/routes/adminRoutes.js`, `src/app.js` | None (Not yet executed) | - | Admin routing skeleton |
| `TASK-4.2` | Implement `/admin/overview` metric aggregator (counts of doctors, patients, active/inactive devices, daily reading volume) | `NOT_STARTED` | `TASK-4.1` | `src/controllers/adminController.js` | None (Not yet executed) | - | Hydrates admin stats from MongoDB |
| `TASK-4.3` | Create Super Admin base layout and overview EJS template | `NOT_STARTED` | `TASK-4.2` | `src/views/admin/layout.ejs`, `src/views/admin/overview.ejs`, `src/public/css/admin.css` | None (Not yet executed) | - | Dark burnt-orange theme |

---

### PHASE 5: Hardware Device Management
*Goal:* Complete hardware inventory lifecycle for Super Admin (Create, List, Activate, Deactivate, Reset, Delete).
*Dependencies:* Phase 4

| Task ID | Task Description | Status | Dependencies | Files Affected | Verification / Test Result | Date Completed | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| `TASK-5.1` | Implement Device Inventory API (`GET /admin/devices`, `POST /admin/devices`, `PATCH /admin/devices/:deviceId/activate`, `PATCH .../deactivate`, `DELETE ...`) | `NOT_STARTED` | Phase 4 | `src/controllers/adminDeviceController.js`, `src/routes/adminRoutes.js` | None (Not yet executed) | - | Only unassigned devices can be deleted |
| `TASK-5.2` | Implement atomic device reset operation (`POST /admin/devices/:deviceId/reset`): unbind patient, set `patientId=null`, increment `resetCount`, preserve readings, audit log | `NOT_STARTED` | `TASK-5.1` | `src/controllers/adminDeviceController.js` | None (Not yet executed) | - | Critical hardware lifecycle invariant |
| `TASK-5.3` | Build Device Management UI with inventory table, status badges, action buttons, and reset confirmation modal | `NOT_STARTED` | `TASK-5.1`, `TASK-5.2` | `src/views/admin/devices.ejs` | None (Not yet executed) | - | Admin hardware operations console |

---

### PHASE 6: Patient Registration & Device Claiming Pipeline
*Goal:* Wire public patient registration flow to claim active unassigned hardware device atomically.
*Dependencies:* Phase 2, Phase 5

| Task ID | Task Description | Status | Dependencies | Files Affected | Verification / Test Result | Date Completed | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| `TASK-6.1` | Implement atomic device verification and claim pipeline during patient registration | `NOT_STARTED` | Phase 2, Phase 5 | `src/controllers/authController.js` | None (Not yet executed) | - | Enforces 1:1 reciprocal assignment |
| `TASK-6.2` | Update registration UI with client validation, device availability feedback, and error handling | `NOT_STARTED` | `TASK-6.1` | `src/views/auth/register.ejs` | None (Not yet executed) | - | Clear error when device is already claimed |

---

### PHASE 7: Doctor Management (Admin Provisioning & Lifecycle)
*Goal:* Enable Super Admin to provision, view, suspend, reactivate, and remove doctors.
*Dependencies:* Phase 4

| Task ID | Task Description | Status | Dependencies | Files Affected | Verification / Test Result | Date Completed | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| `TASK-7.1` | Implement Doctor management endpoints (`GET /admin/doctors`, `POST /admin/doctors` with User account creation) | `NOT_STARTED` | Phase 4 | `src/controllers/adminDoctorController.js`, `src/routes/adminRoutes.js` | None (Not yet executed) | - | Super Admin provisions clinical accounts |
| `TASK-7.2` | Implement Doctor status toggle with atomic `User.status` (`ACTIVE`/`SUSPENDED`) synchronization | `NOT_STARTED` | `TASK-7.1` | `src/controllers/adminDoctorController.js` | None (Not yet executed) | - | Blocks login immediately on suspension |
| `TASK-7.3` | Implement Doctor removal logic: unassign affected patients (`doctorId = null`), preserve historical readings, suspend User, append audit log | `NOT_STARTED` | `TASK-7.1` | `src/controllers/adminDoctorController.js` | None (Not yet executed) | - | Never cascades deletion to patients or readings |
| `TASK-7.4` | Build Doctor Management UI with directory, credential generation modal, and deactivation toggles | `NOT_STARTED` | `TASK-7.1` - `TASK-7.3` | `src/views/admin/doctors.ejs` | None (Not yet executed) | - | Admin clinical staff management |

---

### PHASE 8: Patient ↔ Doctor Assignment Engine
*Goal:* Provide Super Admin with granular control to assign and reassign patients to doctors while preserving telemetry history.
*Dependencies:* Phase 7

| Task ID | Task Description | Status | Dependencies | Files Affected | Verification / Test Result | Date Completed | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| `TASK-8.1` | Implement patient reassignment endpoint (`PATCH /admin/patients/:patientId/assign-doctor`) validating target doctor status | `NOT_STARTED` | Phase 7 | `src/controllers/adminPatientController.js`, `src/routes/adminRoutes.js` | None (Not yet executed) | - | Updates `Patient.doctorId` for future readings |
| `TASK-8.2` | Build Patient Management UI with patient directory, assignment controls, and doctor reassignment modal | `NOT_STARTED` | `TASK-8.1` | `src/views/admin/patients.ejs` | None (Not yet executed) | - | Displays unassigned patients clearly |

---

### PHASE 9: Multi-Page Dashboard Architecture
*Goal:* Split prototype anchor dashboards into dedicated, server-rendered multi-page structures.
*Dependencies:* Phase 3, Phase 4, Phase 8

| Task ID | Task Description | Status | Dependencies | Files Affected | Verification / Test Result | Date Completed | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| `TASK-9.1` | Refactor patient dashboard into multi-page sub-router (`/patient/overview`, `/live`, `/history`, `/profile`) with RBAC hydration | `NOT_STARTED` | Phase 3 | `src/routes/patientRoutes.js`, `src/views/patient/*.ejs` | None (Not yet executed) | - | Replaces single anchor view |
| `TASK-9.2` | Refactor doctor dashboard into multi-page sub-router (`/doctor/overview`, `/patients`, `/monitor`, `/history`) with RBAC hydration | `NOT_STARTED` | Phase 3, Phase 8 | `src/routes/doctorRoutes.js`, `src/views/doctor/*.ejs` | None (Not yet executed) | - | Replaces single anchor view |
| `TASK-9.3` | Unify multi-page navigation headers and active state highlighting | `NOT_STARTED` | `TASK-9.1`, `TASK-9.2` | `src/views/partials/*.ejs`, `src/public/css/*.css` | None (Not yet executed) | - | Shared layout ergonomics |

---

### PHASE 10: Reading History Engine & Paginated API
*Goal:* High-performance paginated REST endpoint and tabular UI for historical telemetry.
*Dependencies:* Phase 9

| Task ID | Task Description | Status | Dependencies | Files Affected | Verification / Test Result | Date Completed | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| `TASK-10.1` | Implement paginated telemetry endpoint (`GET /api/readings/:patientId`) with query params (`page`, `limit`, `startDate`, `endDate`) and RBAC checks | `NOT_STARTED` | Phase 9 | `src/controllers/readingController.js`, `src/routes/apiRoutes.js` | None (Not yet executed) | - | Enforces compound index `{ patientId: 1, timestamp: -1 }` |
| `TASK-10.2` | Build Reading History table view with pagination controls and date range filters for patient and doctor views | `NOT_STARTED` | `TASK-10.1` | `src/views/patient/history.ejs`, `src/views/doctor/history.ejs` | None (Not yet executed) | - | Clinical chronological inspection |

---

### PHASE 11: Charts & Time-Series Data Visualization
*Goal:* Interactive visual line charts rendering `Value 1` and `Value 2` over time, hydrated by MongoDB and updated live via Socket.IO.
*Dependencies:* Phase 10

| Task ID | Task Description | Status | Dependencies | Files Affected | Verification / Test Result | Date Completed | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| `TASK-11.1` | Implement recent readings endpoint for chart hydration (`GET /api/readings/:patientId/recent?limit=50`) | `NOT_STARTED` | Phase 10 | `src/controllers/readingController.js` | None (Not yet executed) | - | Initial state fetch for visualizers |
| `TASK-11.2` | Integrate Chart.js visualizer with initial MongoDB hydration and live Socket.IO `sensor-reading` point appending | `NOT_STARTED` | `TASK-11.1` | `src/public/js/patientCharts.js`, `src/public/js/doctorCharts.js`, `src/views/patient/overview.ejs` | None (Not yet executed) | - | Smooth real-time line charts |

---

### PHASE 12: Device Monitoring & Telemetry Health Dashboard
*Goal:* Introduce telemetry health diagnostics: Last Seen, Online/Offline status, and Reset Tracking.
*Dependencies:* Phase 5, Phase 9

| Task ID | Task Description | Status | Dependencies | Files Affected | Verification / Test Result | Date Completed | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| `TASK-12.1` | Update IoT ingestion to set `Device.lastSeen = new Date()` and compute connection health status (`Online`, `Stale`, `Offline`) | `NOT_STARTED` | Phase 5, Phase 9 | `src/routes/iotRoutes.js`, `src/services/deviceHealthService.js` | None (Not yet executed) | - | Time-window threshold evaluation |
| `TASK-12.2` | Display health pulse indicators (Green / Amber / Gray) across Admin hardware inventory and Doctor live monitor | `NOT_STARTED` | `TASK-12.1` | `src/views/admin/devices.ejs`, `src/views/doctor/monitor.ejs` | None (Not yet executed) | - | Immediate device outage detection |

---

### PHASE 13: Centralized System Activity & Audit Trail
*Goal:* Build an immutable system activity log capturing security events, administrative modifications, and hardware state changes.
*Dependencies:* Phase 4, Phase 8

| Task ID | Task Description | Status | Dependencies | Files Affected | Verification / Test Result | Date Completed | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| `TASK-13.1` | Implement centralized audit logging utility `logActivity(...)` | `NOT_STARTED` | Phase 4, Phase 8 | `src/utils/activityLogger.js` | None (Not yet executed) | - | Non-blocking audit logger |
| `TASK-13.2` | Instrument Auth, Doctor, Patient, and Device controllers with audit event capture | `NOT_STARTED` | `TASK-13.1` | `src/controllers/*.js` | None (Not yet executed) | - | Captures all administrative actions |
| `TASK-13.3` | Implement `/admin/activity` route and chronological audit log feed view | `NOT_STARTED` | `TASK-13.1` | `src/controllers/adminController.js`, `src/views/admin/activity.ejs` | None (Not yet executed) | - | HIPAA-style compliance trail |

---

### PHASE 14: Error Handling, Edge Cases & System Robustness
*Goal:* Harden platform against edge cases: duplicate claims, malformed payloads, rapid bursts, and database reconnections.
*Dependencies:* Phases 0–13

| Task ID | Task Description | Status | Dependencies | Files Affected | Verification / Test Result | Date Completed | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| `TASK-14.1` | Implement centralized Express error handler middleware and standard error response formatting | `NOT_STARTED` | All prior | `src/middleware/errorHandler.js`, `src/app.js` | None (Not yet executed) | - | Consistent JSON/HTML errors |
| `TASK-14.2` | Implement incoming payload validation schemas (Joi / express-validator) and IoT rate limiting | `NOT_STARTED` | All prior | `src/middleware/validationMiddleware.js`, `src/routes/iotRoutes.js` | None (Not yet executed) | - | Prevents invalid ingestion packets |
| `TASK-14.3` | Add client-side Socket.IO reconnecting banner and graceful degradation UI feedback | `NOT_STARTED` | All prior | `src/public/js/socketStatus.js` | None (Not yet executed) | - | User feedback on disconnect |

---

### PHASE 15: Security Hardening & Penetration Defense
*Goal:* Production-grade application security defenses.
*Dependencies:* Phase 14

| Task ID | Task Description | Status | Dependencies | Files Affected | Verification / Test Result | Date Completed | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| `TASK-15.1` | Configure Helmet security headers, CORS strict whitelist, and auth endpoint rate limiters | `NOT_STARTED` | Phase 14 | `src/server.js`, `src/config/security.js`, `src/middleware/rateLimiter.js` | None (Not yet executed) | - | Prevents brute force and injection |
| `TASK-15.2` | Implement environment variable schema validation on server startup and IoT device API key verification | `NOT_STARTED` | Phase 14 | `src/config/envValidator.js`, `src/routes/iotRoutes.js` | None (Not yet executed) | - | Blocks boot if secrets missing |

---

### PHASE 16: Final Prototype & Presentation Polish
*Goal:* Visual aesthetics, micro-interactions, responsive states, and seamless Super Admin demonstration flow.
*Dependencies:* Phases 0–15

| Task ID | Task Description | Status | Dependencies | Files Affected | Verification / Test Result | Date Completed | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| `TASK-16.1` | Create comprehensive presentation seed script (`src/seed/demoSeed.js`) with realistic doctors, patients, devices, and historical telemetry curves | `NOT_STARTED` | Phases 0–15 | `src/seed/demoSeed.js` | None (Not yet executed) | - | One-command complete demo state |
| `TASK-16.2` | Polish burnt-orange UI, glassmorphic cards, loading skeletons, responsive layouts, and demo quick-switch tool | `NOT_STARTED` | Phases 0–15 | `src/public/css/*.css`, `src/views/**/*.ejs` | None (Not yet executed) | - | Wow factor presentation finish |

---

### FUTURE PHASES (Ecosystem Expansion)

| Phase ID | Phase Name | Task ID | Task Description | Status | Dependencies | Files Affected | Notes |
| :--- | :--- | :--- | :--- | :---: | :--- | :--- | :--- |
| **Phase 17** | Modern Frontend (React) | `TASK-17.1` | Initialize React + TypeScript SPA with JSON REST API parity and Socket client | `NOT_STARTED` | Phase 16 | `frontend/` | Preserves all backend invariants |
| **Phase 18** | Mobile App (React Native) | `TASK-18.1` | Patient mobile telemetry app with biometric auth and push alert thresholds | `NOT_STARTED` | Phase 17 | `mobile/` | iOS & Android |
| **Phase 19** | Physical Hardware & MQTT | `TASK-19.1` | Aedes/Mosquitto MQTT broker integration and ESP32 physical sensor firmware | `NOT_STARTED` | Phase 15, 16 | `src/mqtt/`, `firmware/` | Hardware medical IoT deployment |
