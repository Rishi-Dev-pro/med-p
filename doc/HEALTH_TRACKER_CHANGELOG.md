# HEALTH TRACKER — CHANGELOG & ARCHITECTURAL DECISION RECORD
**Authoritative Ledger of Codebase & Architectural Changes**

---

## CHANGELOG ENTRIES

### 2026-10-02 — Phase 12: Device Monitoring & Telemetry Health Dashboard
- **Phase / Task:** PHASE 12 (`TASK-12.1`, `TASK-12.2`)
- **Change:**
  1. Zero Database Schema Modification & Invariant Preservation:
     - Confirmed `Device.lastSeen` (Date, default `null`) and `Device.resetCount` (Number, default `0`) already exist from previous phases.
     - Preserved exact field names and meanings; zero schema additions or modifications.
     - Preserved immutability of historical `SensorReading` records, timestamps, values, and historical `doctorId` snapshots.
  2. IoT Telemetry Ingestion Atomicity & `lastSeen` Update (`src/routes/iotRoutes.js`):
     - `Device.lastSeen = new Date()` is updated strictly upon successful `SensorReading.create`.
     - Zero partial writes: `lastSeen` is never updated on 400 (validation failure), 403 (inactive device), 404 (unknown device or unassigned device), or 500 (database failure).
     - Enhanced Socket.IO `sensor-reading` emission to include `lastSeen: ingestionTime.toISOString()` and emitted to `patient:<id>`, `doctor:<id>`, and `admin:telemetry` rooms.
     - Returned `lastSeen` ISO timestamp in 201 response payload.
  3. Single Centralized Telemetry Health Utility (`src/utils/deviceHealth.js`):
     - Implemented `getDeviceHealth(target, now = new Date(), statusOverride = null)` as the single source of truth.
     - Strict deterministic boundaries:
       - `age < 60s` &rarr; `ONLINE`
       - `60s <= age < 600s` (10 minutes) &rarr; `STALE`
       - `age >= 600s` &rarr; `OFFLINE`
       - `lastSeen === null` &rarr; `OFFLINE` (Last Seen formatted as `"Never"`)
       - `Device.status !== 'ACTIVE'` &rarr; `OFFLINE` (preserves distinct lifecycle status `ACTIVE`/`INACTIVE` vs telemetry health `ONLINE`/`STALE`/`OFFLINE`).
     - Implemented `formatLastSeen(lastSeen, now)` returning human-readable strings ("Just now", "25s ago", "3 minutes ago", "Never").
     - Implemented bounded `calculateObservedFrequency(deviceId, sampleLimit = 10)` calculating average delta between consecutive readings using covered compound index `{ deviceId: 1, timestamp: -1 }`.
  4. Scoped Device Health Diagnostics Endpoint (`GET /api/devices/health`):
     - Implemented `deviceHealthController.getDeviceHealthSummary` in `src/controllers/deviceHealthController.js`.
     - Mounted in `src/routes/apiRoutes.js` guarded by `authenticate`.
     - Strict RBAC:
       - `SUPER_ADMIN`: global inventory visibility.
       - `DOCTOR`: only devices belonging to currently assigned patients (`patient.doctorId === req.user.profileId`); query parameter tampering (`?patientId=`, `?deviceId=`, `?doctorId=`) rejected with 403 Forbidden.
       - `PATIENT`: only their own assigned device; tampering rejected with 403 Forbidden.
     - Never exposes device secrets, `apiKeyHash`, password hashes, or JWTs.
  5. Admin Hardware Inventory Dashboard (`src/views/admin/devices.ejs` & `src/controllers/adminDeviceController.js`):
     - Enriched device inventory table with Telemetry Health (`● ONLINE`, `● STALE`, `● OFFLINE`), Connection Health indicators (green pulse, amber pulse, gray dot), Last Seen human-readable text + time, Reset Count, and Observed Transmission Frequency.
     - Implemented in-place periodic client timer (5s) recalculating status from `data-last-seen` timestamps without page reload.
     - Integrated Socket.IO listener for live status transitions when devices transmit.
     - Guarded duplicate intervals via `window._deviceHealthTimer`.
  6. Doctor Clinical Monitor Dashboard (`src/views/doctor/monitor.ejs` & `src/controllers/doctorController.js`):
     - Displayed device telemetry health badges, Last Seen, and transmission frequency on assigned patient cards.
     - Implemented in-place periodic client timer (5s) and Socket.IO real-time transition to `ONLINE`.
  7. Global Health Indicator Styling & Animations (`src/public/css/global.css`):
     - Added `.telemetry-health-badge`, `.health-badge-online`, `.health-badge-stale`, `.health-badge-offline`, and keyframe pulse animations (`healthPulseGreen`, `healthPulseAmber`).
     - Fully accessible: pairs visual pulse dot with explicit textual status label.
  8. Comprehensive Automated Test Suite (`tests/deviceHealthValidation.test.js`):
     - Implemented 40 automated tests covering all 8 requirement domains in Section 32: valid/invalid ingestion lastSeen updates, exact boundaries (59s, 60s, 61s, 599s, 600s, null, inactive), reset invariant preservation, RBAC authorization, lifecycle status separation, bounded frequency calculation, security tampering, and in-place real-time UI logic.
     - Added `test:health` to `package.json` and master `npm test`.
     - Full regression: 396/396 tests passing across all 13 test suites.
- **Reason:**
  Enable healthcare providers and system administrators to immediately detect hardware outages, stale data transmissions, and offline telemetry units in real time without refreshing pages or polling databases.
- **Files Affected:**
  - `package.json`
  - `src/config/constants.js`
  - `src/controllers/adminDeviceController.js`
  - `src/controllers/deviceHealthController.js`
  - `src/controllers/doctorController.js`
  - `src/public/css/global.css`
  - `src/routes/apiRoutes.js`
  - `src/routes/iotRoutes.js`
  - `src/utils/deviceHealth.js`
  - `src/views/admin/devices.ejs`
  - `src/views/doctor/monitor.ejs`
  - `tests/deviceHealthValidation.test.js`

### 2026-10-02 — Phase 11: Charts & Time-Series Data Visualization
- **Phase / Task:** PHASE 11 (`TASK-11.1`, `TASK-11.2`)
- **Change:**
  1. Zero Database Schema Modification & Telemetry Immutability:
     - Confirmed zero collection additions, zero model mutations, and zero schema changes.
     - Preserved existing compound index `{ patientId: 1, timestamp: -1 }` on `SensorReading`.
     - Read-only historical access; historical `SensorReading.doctorId`, `Patient.doctorId`, and `Device.patientId` remain strictly immutable.
  2. Implemented Recent Readings Endpoint (`GET /api/readings/:patientId/recent`):
     - Added `readingController.getRecentReadings` in `src/controllers/readingController.js`.
     - Lightweight bounded slice: default `limit = 50`, hard-clamped maximum `limit = 100`. Returns 400 Bad Request on invalid/non-positive limit.
     - MongoDB query executes `SensorReading.find({ patientId }).sort({ timestamp: -1 }).limit(limit).select("timestamp value1 value2 -_id").lean()` ensuring index-backed execution without scanning unbounded collections.
     - Documented Chronological Strategy (Approach B): The API queries newest N readings in descending order, then reverses the slice into chronological order (`oldest -> newest`, left-to-right) specifically tailored for charting.
     - Output payload shape: strictly limited to `{ success: true, data: { readings: [{ timestamp, value1, value2 }], limit } }`. Excludes passwords, hashes, tokens, secrets, or unrelated patient records.
  3. API Route & Security Authorization:
     - Mounted `GET /readings/:patientId/recent` in `src/routes/apiRoutes.js` guarded by `authenticate` and `requirePatientOwnership("patientId")`.
     - Patient self-access permitted (`req.user.profileId === targetPatientId`); cross-access returns 403 Forbidden.
     - Doctor access permitted only for currently assigned patients (`patient.doctorId === req.user.profileId`); unassigned/foreign patient queries return 403 Forbidden.
     - Super Admin global inspection permitted.
     - Query parameter spoofing (`?patientId=`, `?doctorId=`) strictly rejected in favor of verified route parameters and verified JWT claims.
  4. Client-Side Sanitization & Bounded Time-Series Manager (`src/public/js/chartSanitizer.js`):
     - Universal UMD module compatible with browser globals and Node.js CommonJS test suites.
     - Strict Security Sanitizer (`sanitizeReading`): validates finite numeric `value1` and `value2`, rejects strings, NaN, Infinity, null, undefined, `<script>`, and pseudo-protocols. Validates ISO-parseable Date timestamps.
     - Bounded Time-Series Engine (`ChartTimeSeriesManager`): maintains a hard-capped 50-point rolling window (`maxPoints = 50`), auto-shifts oldest points on overflow, enforces duplicate event detection (via readingId / composite timestamp+values), and handles out-of-order packets via chronological binary/linear insertion.
  5. Chart.js Library Integration (`src/public/js/chart.min.js`):
     - Self-contained, production-grade Chart.js 4.4.7 UMD bundle stored locally in `src/public/js/chart.min.js`, ensuring 100% offline availability with zero external CDN dependencies.
  6. Patient Overview Chart Integration (`src/views/patient/overview.ejs` & `src/public/js/patientCharts.js`):
     - Embedded responsive line chart section into Patient Overview with custom dark theme (Surface `#1A1815`, Vanilla `#FFF4D6` Heart Rate spline, Burnt Orange `#FC6C26` SpO₂ spline, translucent fills, subtle gridlines).
     - Clean state lifecycle: displays `#chartLoading`, `#chartEmpty`, and `#chartError` overlays without broken DOM rendering.
     - Live Socket.IO telemetry: listens on authenticated `sensor-reading` channel, appends verified points in real-time, shifts oldest points, updates chart smoothly without full page refresh.
  7. Doctor Caseload History Chart Integration (`src/views/doctor/history.ejs` & `src/public/js/doctorCharts.js`):
     - Integrated clinical telemetry chart into Doctor History page.
     - Dynamic Patient Switching: switching patients from `#patientFilter` dropdown safely destroys existing Chart.js instances, resets manager buffers, shows loading state, fetches newly selected patient's recent telemetry, and re-subscribes to patient-specific Socket.IO room (`join-room`).
     - Strict client-side isolation: incoming telemetry packets belonging to other patients are immediately dropped; previous patient data never persists across patient switches.
  8. Comprehensive Automated Verification Suite (`tests/chartVisualizationValidation.test.js`):
     - Implemented 40 automated tests covering API availability, authentication, RBAC authorization, limit clamping, chronological ordering, payload safety, sanitization (NaN/Infinity/XSS rejection), Socket.IO live updates, window bounding, duplicate suppression, out-of-order handling, doctor isolation, patient switching, and historical telemetry data integrity.
     - Added `npm run test:chart` script to `package.json` and integrated into master `npm test` pipeline.
- **Reason:**
  Empower patients and clinicians with immediate visual comprehension of biometric trends over time, combining historical baseline slices with smooth, real-time Socket.IO telemetry streaming while maintaining military-grade data isolation and input sanitization.
- **Files Affected:**
  - `package.json`
  - `src/controllers/readingController.js`
  - `src/routes/apiRoutes.js`
  - `src/public/js/chart.min.js`
  - `src/public/js/chartSanitizer.js`
  - `src/public/js/patientCharts.js`
  - `src/public/js/doctorCharts.js`
  - `src/views/patient/overview.ejs`
  - `src/views/doctor/history.ejs`
  - `tests/chartVisualizationValidation.test.js`

### 2026-10-02 — Phase 10: Reading History Engine & Paginated API
- **Phase / Task:** PHASE 10 (`TASK-10.1`, `TASK-10.2`)
- **Change:**
  1. Compound Index & Database Verification:
     - Verified compound index `{ patientId: 1, timestamp: -1 }` on `SensorReading` collection in MongoDB for high-performance, index-backed chronological retrieval (newest first).
     - Confirmed zero database schema modifications, zero telemetry rewriting, and absolute immutability of historical `SensorReading.doctorId` snapshots.
  2. Created `src/controllers/readingController.js`:
     - `getReadings`: High-performance paginated REST endpoint (`GET /api/readings/:patientId`).
     - Safe pagination: supports `page` (positive integer, default: 1) and `limit` (positive integer, default: 20, hard-clamped to max 100 for DOS prevention). Returns 400 Bad Request on invalid, non-integer, or non-positive `page`/`limit` inputs.
     - Date range filtering: supports `startDate` and `endDate` with automatic boundary parsing (date-only `YYYY-MM-DD` normalized to full UTC day boundaries). Rejects invalid date formats and inverted date ranges (`startDate > endDate`) with 400 Bad Request.
     - Database query: executes bounded `SensorReading.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).lean()` and `SensorReading.countDocuments(filter)` in parallel via `Promise.all`.
     - Output payload: returns machine-readable ISO 8601 timestamps and comprehensive pagination metadata (`page`, `limit`, `total`, `pages`).
  3. Created `src/routes/apiRoutes.js`:
     - Mounted `GET /readings/:patientId` with `authenticate` and `requirePatientOwnership("patientId")`.
     - Reuses existing authentication and role middleware without duplicate authorization logic.
     - Rigorous RBAC: Patients can only query self; Doctors can only query currently assigned patients (`patient.doctorId === req.user.profileId`); Super Admins can query any patient.
     - Tampering defense: `?patientId=` or `?doctorId=` query parameter injections are strictly ignored; identity is resolved exclusively from verified JWT context (`req.user.profileId`).
  4. Updated `src/app.js`:
     - Mounted `app.use("/api", apiRoutes)` to expose `/api/readings/:patientId`.
  5. Enhanced Patient History UI (`src/views/patient/history.ejs` & `src/controllers/patientController.js`):
     - Added server-side pagination and date filtering hydration in `patientController.getHistory`.
     - Added date range picker inputs (`From`, `To`, `Apply Filter`, `Clear Filter`).
     - Added full pagination controls (`Previous Page`, `Page X of Y`, `Next Page`, total records count).
     - Added explicit CSV export stub button (`📥 Export CSV (Stub)`) alerting users that CSV export is scheduled for future telemetry enhancements, preventing unbounded data exports.
  6. Enhanced Doctor History UI (`src/views/doctor/history.ejs` & `src/controllers/doctorController.js`):
     - Added server-side pagination and date filtering hydration in `doctorController.getHistory`.
     - Added assigned patient dropdown selector, strictly populating only patients currently assigned to the authenticated physician.
     - Added date range pickers and pagination controls for clinical audit review.
     - Added explicit CSV export stub button.
  7. Comprehensive Automated Test Suite (`tests/readingHistoryValidation.test.js`):
     - Created 50 automated tests covering:
       - Database compound index existence & ordering `{ patientId: 1, timestamp: -1 }` (Tests 1-2).
       - Authentication rejection: missing, invalid, expired, or suspended tokens (Tests 3-6).
       - Patient authorization, isolation & tampering defense (Tests 7-9).
       - Doctor authorization, unassigned/cross-doctor patient rejection & tampering defense (Tests 10-13).
       - Super Admin access & non-admin privilege escalation defense (Tests 14-15).
       - Pagination: default, custom page, custom limit, limit > 100 clamping, invalid inputs, out-of-range empty page (Tests 16-22).
       - Sorting: newest-first descending timestamp validation (Tests 23-24).
       - Date filtering: startDate, endDate, range, invalid format rejection, inverted range rejection (Tests 25-30).
       - Response format: pagination metadata, total, page count, ISO timestamps, isolation (Tests 31-35).
       - Data integrity: historical doctorId snapshot immutability & reassignment safety (Tests 36-37).
       - Security & DOS: limit bounding, query parameter poisoning immunity (Tests 38-40).
       - Frontend integration & UI: patient history table, pagination, date filtering, clear filter, doctor patient selector, doctor pagination, doctor date filtering, unauthorized patient isolation, CSV export stub (Tests 41-50).
  8. Updated `package.json`:
     - Added `test:history` script (`node tests/readingHistoryValidation.test.js`) and integrated into master `npm test` runner.
- **Reason:**
  Provide high-performance, secure, bounded, and indexed historical telemetry retrieval for clinical review, trend evaluation, and doctor caseload monitoring.
- **Files Affected:**
  - `package.json`
  - `src/app.js`
  - `src/controllers/readingController.js`
  - `src/controllers/patientController.js`
  - `src/controllers/doctorController.js`
  - `src/routes/apiRoutes.js`
  - `src/views/patient/history.ejs`
  - `src/views/doctor/history.ejs`
  - `tests/readingHistoryValidation.test.js`

### 2026-10-02 — Phase 9: Multi-Page Dashboard Architecture
- **Phase / Task:** PHASE 9 (`TASK-9.1`, `TASK-9.2`, `TASK-9.3`)
- **Change:**
  1. Created `src/controllers/patientController.js`:
     - Implemented dedicated page hydration controllers for Patient portal views:
       - `getOverview`: Hydrates patient profile, assigned doctor information, bound hardware device, and latest telemetry snapshot (`SensorReading.findOne({ patientId }).sort({ timestamp: -1 })`). Does not query entire historical telemetry.
       - `getLive`: Hydrates essential metadata for real-time telemetry streaming (active device, authenticated patient profile, JWT session info for client-side Socket.IO connection). Telemetry stream is consumed directly from Socket.IO room `patient:<patientId>`.
       - `getHistory`: Hydrates initial historical telemetry table (page-specific query with limit). Does not mutate or rewrite historical sensor readings.
       - `getProfile`: Hydrates sanitized patient demographic and clinical profile (profileId, name, age, gender, assigned doctor, assigned device, user email/status). Never exposes password hashes, secrets, JWTs, or internal credentials.
     - Dual-mode support: Renders modular EJS views when requested by browser (`Accept: text/html`) and returns clean structured JSON when requested via API (`Accept: application/json`).
     - Derived identity: Patient identity is strictly resolved from authenticated JWT context (`req.user.profileId`), completely ignoring any URL query parameter tampering (`?patientId=`).
  2. Created `src/controllers/doctorController.js`:
     - Implemented dedicated page hydration controllers for Doctor portal views:
       - `getOverview`: Hydrates doctor profile, assigned patient count (`Patient.countDocuments({ doctorId })`), active patient/device list, and latest telemetry summaries for assigned patients.
       - `getPatients`: Hydrates roster of patients strictly assigned to the authenticated doctor (`Patient.find({ doctorId })`), including patient device status and assigned timestamp. Doctors cannot inspect unassigned patients or patients of other clinicians.
       - `getMonitor`: Hydrates multi-patient live monitor page initialization data with assigned patient list. Real-time telemetry is consumed securely via authorized Socket.IO room `doctor:<doctorId>`.
       - `getHistory`: Hydrates clinical reading history strictly filtered by assigned patient IDs (`patientId: { $in: assignedPatientIds }`).
     - Derived identity: Doctor identity is strictly resolved from authenticated JWT context (`req.user.profileId`), preventing `?doctorId=` tampering.
  3. Created `src/routes/patientRoutes.js`:
     - Mounted dedicated endpoints:
       - `GET /overview` -> `patientController.getOverview`
       - `GET /live` -> `patientController.getLive`
       - `GET /history` -> `patientController.getHistory`
       - `GET /profile` -> `patientController.getProfile`
       - `GET /` -> Redirects (302) to `/patient/overview`
     - Enforced `authenticate` and `requireRole(ROLES.PATIENT)` on every single route to eliminate route leakage.
  4. Created `src/routes/doctorRoutes.js`:
     - Mounted dedicated endpoints:
       - `GET /overview` -> `doctorController.getOverview`
       - `GET /patients` -> `doctorController.getPatients`
       - `GET /monitor` -> `doctorController.getMonitor`
       - `GET /history` -> `doctorController.getHistory`
       - `GET /` -> Redirects (302) to `/doctor/overview`
     - Enforced `authenticate` and `requireRole(ROLES.DOCTOR)` on every single route.
  5. Updated `src/app.js`:
     - Mounted `app.use("/patient", patientRoutes)` and `app.use("/doctor", doctorRoutes)` before `app.use("/", dashboardRoutes)`.
     - Preserved existing parameterized routes (`/patient/:patientId`, `/doctor/:doctorId`, `/api/doctor/:doctorId/patients`) in `dashboardRoutes.js` for 100% backward compatibility with Phase 3 and Phase 8 test suites.
     - Preserved Admin multi-page routing (`/admin/overview`, `/admin/doctors`, `/admin/patients`, `/admin/devices`, `/admin/activity`) established in Phase 4.
  6. Created Modular EJS Views & Partials:
     - Patient Views (`src/views/patient/`):
       - `partials/sidebar.ejs`: Patient navigation menu (Overview, Live Data, History, Profile) with dynamic `activePage` highlighting and profile info.
       - `partials/topbar.ejs`: Top navigation header with portal title, active route indicator, user badge, and logout action.
       - `overview.ejs`, `live.ejs`, `history.ejs`, `profile.ejs`: Bookmarkable, deep-linkable views with responsive layouts.
     - Doctor Views (`src/views/doctor/`):
       - `partials/sidebar.ejs`: Doctor navigation menu (Overview, Patients, Live Monitor, History) with dynamic `activePage` highlighting.
       - `partials/topbar.ejs`: Top navigation header with doctor credentials, active page pill, and logout action.
       - `overview.ejs`, `patients.ejs`, `monitor.ejs`, `history.ejs`: Bookmarkable, deep-linkable clinical views.
  7. Updated Patient CSS (`src/public/css/patient.css`):
     - Added design system tokens and responsive styles for sidebar/topbar navigation, live status pulse animation, and mobile navigation wrapping.
  8. Created Dedicated Phase 9 Test Suite (`tests/multiPageDashboard.test.js`):
     - 40 automated tests covering:
       - Route existence (Tests 1-13): Patient (4), Doctor (4), Admin (5).
       - Authentication rejection (Tests 14-16): Unauthenticated access to Patient, Doctor, and Admin routes rejected with 401 Unauthorized / redirect.
       - Cross-role authorization rejection (Tests 17-20): Patient denied Doctor/Admin routes; Doctor denied Patient/Admin routes.
       - Identity derivation & tampering immunity (Tests 21-24): Patient and Doctor identity strictly derived from JWT context; `?patientId=` and `?doctorId=` query parameter spoofing rejected/ignored.
       - Navigation URLs & active state (Tests 25-28): Verified HTML contains correct navigation URLs and `active` class on current page link.
       - Direct URL access & legacy route redirection (Tests 29-30): Verified `/patient/history` direct URL access and `/patient` redirect to `/patient/overview`.
       - Data isolation (Tests 31-32): Patient history isolates telemetry to authenticated patient; Doctor patients view isolates roster to assigned patients only.
       - Super Admin protection & Socket.IO preservation (Tests 33-34): Admin pages require `SUPER_ADMIN` role; Socket.IO handshake JWT authentication intact.
       - Page-specific hydration efficiency (Tests 35-37): Patient profile, doctor patients, and admin devices hydrate only required view-specific data.
       - Legacy route backward compatibility (Tests 38-40): Verified `/patient/:patientId` and `/doctor/:doctorId` remain functional.
  9. Updated `package.json`:
     - Added `test:dashboard` script (`node tests/multiPageDashboard.test.js`) and incorporated into master `npm test` pipeline.
- **Reason:**
  Transition the application from monolithic / anchor-based single-page dashboards to bookmarkable, server-rendered multi-page architectures with real URLs, browser history support, view-specific hydration, and strict per-route RBAC.
- **Files Affected:**
  - `package.json`
  - `src/app.js`
  - `src/controllers/patientController.js`
  - `src/controllers/doctorController.js`
  - `src/routes/patientRoutes.js`
  - `src/routes/doctorRoutes.js`
  - `src/public/css/patient.css`
  - `src/views/patient/partials/sidebar.ejs`
  - `src/views/patient/partials/topbar.ejs`
  - `src/views/patient/overview.ejs`
  - `src/views/patient/live.ejs`
  - `src/views/patient/history.ejs`
  - `src/views/patient/profile.ejs`
  - `src/views/doctor/partials/sidebar.ejs`
  - `src/views/doctor/partials/topbar.ejs`
  - `src/views/doctor/overview.ejs`
  - `src/views/doctor/patients.ejs`
  - `src/views/doctor/monitor.ejs`
  - `src/views/doctor/history.ejs`
  - `tests/multiPageDashboard.test.js`

### 2026-10-02 — Phase 8: Patient ↔ Doctor Assignment Engine & Clinical Relationship Management
- **Phase / Task:** PHASE 8 (`TASK-8.1`, `TASK-8.2`)
- **Change:**
  1. Created `src/controllers/adminPatientController.js`:
     - `getPatients`: Super Admin patient inventory endpoint (`GET /api/admin/patients`, `GET /admin/patients`). Enriches patient profiles with assigned doctor name, account status, and assignment status badge (`ASSIGNED` vs `UNASSIGNED`). Supports both JSON API and EJS view rendering without exposing sensitive credentials or secrets.
     - `getEligibleDoctors`: Returns active doctors who can receive clinical assignments (`GET /api/admin/assignments/eligible-doctors`). Filters by `status: DOCTOR_STATUS.ACTIVE` and computes real-time `assignedPatientCount` for assignment selection modals.
     - `assignDoctor`: Super Admin assignment operation (`POST /api/admin/assignments`, `PATCH /api/admin/patients/:patientId/assign-doctor`). Validates that patient exists, doctor exists, and doctor is clinically `ACTIVE` (`Doctor.status === DOCTOR_STATUS.ACTIVE`). Rejects inactive or suspended doctors with 400 Bad Request. Disallows fake placeholder doctor IDs ("UNASSIGNED" or "NULL"). Performs atomic single-document update on `Patient.doctorId`. Automatically differentiates between initial assignment (`PATIENT_ASSIGNED`) and reassignment (`PATIENT_REASSIGNED`) in `ActivityLog`. Evicts prior doctor socket connections from `patient:<patientId>` real-time rooms.
     - `unassignDoctor`: Super Admin unassignment operation (`DELETE /api/admin/assignments/:patientId`, `DELETE /api/admin/patients/:patientId/unassign-doctor`). Sets `Patient.doctorId = null`. Preserves patient record, linked user account, hardware device binding (`Patient.deviceId`, `Device.patientId`), and all historical `SensorReading` snapshots. Records `PATIENT_UNASSIGNED` in `ActivityLog`. Evicts doctor sockets from patient real-time room.
  2. Updated `src/config/constants.js`:
     - Added `PATIENT_ASSIGNED: "PATIENT_ASSIGNED"` and `PATIENT_UNASSIGNED: "PATIENT_UNASSIGNED"` to `AUDIT_ACTIONS` enum.
  3. Updated `src/controllers/adminDoctorController.js`:
     - Enhanced `deactivateDoctor`: When a doctor is deactivated, active patients currently assigned to that doctor are unassigned (`Patient.updateMany({ doctorId }, { $set: { doctorId: null } })`) with individual `PATIENT_UNASSIGNED` audit logs (reason: `DOCTOR_DEACTIVATED`), strictly preventing patients from remaining assigned to an inactive clinician. Patients are NEVER automatically reassigned elsewhere.
     - Verified `activateDoctor`: When a previously deactivated doctor is reactivated, previous assignments are NOT automatically restored; patients remain unassigned until explicitly reassigned by Super Admin.
  4. Updated `src/controllers/adminController.js`:
     - Delegated `getPatients` to `adminPatientController.getPatients`.
  5. Updated `src/routes/adminRoutes.js`:
     - Mounted Phase 8 endpoints:
       - `POST /assignments` -> `adminPatientController.assignDoctor`
       - `DELETE /assignments/:patientId` -> `adminPatientController.unassignDoctor`
       - `GET /assignments/eligible-doctors` -> `adminPatientController.getEligibleDoctors`
       - `PATCH /patients/:patientId/assign-doctor` -> `adminPatientController.assignDoctor`
       - `DELETE /patients/:patientId/unassign-doctor` -> `adminPatientController.unassignDoctor`
     - Protected all endpoints with `authenticate` and `requireRole(ROLES.SUPER_ADMIN)`.
  6. Updated `src/routes/dashboardRoutes.js`:
     - Enhanced Doctor Dashboard endpoint (`GET /doctor/:doctorId`) to support JSON API responses when requested via `Accept: application/json`.
     - Added Doctor Patients API endpoint (`GET /api/doctor/:doctorId/patients`) guarded by `authenticate` and `requireDoctorOwnership("doctorId")`, ensuring physicians can only see patients currently assigned to them and cannot see unassigned patients or patients of other doctors.
  7. Upgraded Admin Patient UI (`src/views/admin/patients.ejs`):
     - Added KPI summary cards for Total Patients, Assigned, Unassigned, and Device Bound.
     - Integrated `ASSIGNED` vs `UNASSIGNED` visual badges with physician names and doctor IDs.
     - Built interactive Assign / Reassign Physician Modal with live-loaded active doctor dropdown and assignment confirmation details.
     - Built Unassign Confirmation Modal with clinical invariant warnings explaining that device binding and telemetry remain untouched.
  8. Implemented Comprehensive Phase 8 Test Suite (`tests/patientDoctorAssignmentValidation.test.js`):
     - 40 automated tests covering:
       - Basic Assignment (Tests 1-8): Super Admin assignment, patient rejection, doctor rejection, unauthenticated rejection, invalid patient, invalid doctor, inactive doctor rejection, and correct `Patient.doctorId` database persistence.
       - Unassignment (Tests 9-13): Super Admin unassignment, patient record preservation, device ownership preservation, `doctorId` set to `null`, and invisibility to doctors.
       - Reassignment (Tests 14-19): Moving patient from Doctor A to Doctor B, Doctor B active check, Doctor A visibility removal, Doctor B visibility grant, device ownership unchanged, and historical `SensorReading.doctorId` snapshot immutability.
       - Doctor Lifecycle (Tests 20-23): Doctor deactivation unassigns patients (`doctorId = null`), prevents automatic reassignment, ensures reactivation does not automatically restore assignments, and permits explicit reassignments.
       - Security (Tests 24-28): Role spoofing defense, patientId spoofing defense, doctorId spoofing defense, patient assignment manipulation defense, and doctor assignment manipulation defense.
       - Socket / Telemetry (Tests 29-33): Newly assigned doctor receives future telemetry (`doctor:<doctorId>`), previous doctor stops receiving future telemetry, patient continues receiving own telemetry (`patient:<patientId>`), unassigned patient telemetry stores `doctorId = null`, and historical telemetry records are never modified.
       - Audit (Tests 34-37): Audit logs created for assignment (`PATIENT_ASSIGNED`), reassignment (`PATIENT_REASSIGNED`), unassignment (`PATIENT_UNASSIGNED`), and doctor deactivation unassignment.
       - Integrity (Tests 38-40): Valid Patient/Doctor DB references, 1 Doctor to many Patients cardinality, and 1 Patient to at most 1 current Doctor cardinality.
  9. Updated `package.json`:
     - Added `test:assignment` script (`node tests/patientDoctorAssignmentValidation.test.js`) and added it to master `npm test` pipeline.
- **Reason:**
  Establish authoritative clinical relationship management between patients and doctors with strict 1:N cardinality, active-doctor invariants, server-side RBAC protection, Socket.IO real-time routing adaptation, and zero telemetry corruption.
- **Files Affected:**
  - `src/config/constants.js`
  - `src/controllers/adminPatientController.js`
  - `src/controllers/adminDoctorController.js`
  - `src/controllers/adminController.js`
  - `src/routes/adminRoutes.js`
  - `src/routes/dashboardRoutes.js`
  - `src/views/admin/patients.ejs`
  - `package.json`
  - `tests/doctorManagementValidation.test.js`
  - `tests/patientDoctorAssignmentValidation.test.js`
  - `doc/HEALTH_TRACKER_TASK_TRACKER.md`
  - `doc/HEALTH_TRACKER_PROGRESS.md`
  - `doc/HEALTH_TRACKER_CHANGELOG.md`
- **Verification:**
  - `node tests/patientDoctorAssignmentValidation.test.js`: 40/40 tests passed.
  - `npm test`: 226/226 tests passed across all 9 test suites (Phase 0: 10, Phase 1: 10, Phase 2: 20, Phase 3: 24, Phase 4: 20, Phase 5: 34, Phase 6: 28, Phase 7: 40, Phase 8: 40). Zero regressions.

### 2026-10-02 — Phase 7: Doctor Provisioning, Credential Management & Account Lifecycle
- **Phase / Task:** PHASE 7 (`TASK-7.1`, `TASK-7.2`, `TASK-7.3`, `TASK-7.4`)
- **Change:**
  1. Created `src/controllers/adminDoctorController.js`:
     - `createDoctor`: Super Admin-only physician provisioning API (`POST /api/admin/doctors`). Validates name, normalizes email and username, rejects duplicate email across User and Doctor, rejects duplicate username, forces User role to `ROLES.DOCTOR` (client role spoofing discarded), generates secure random initial password or accepts optional admin password (>= 6 chars), hashes password with `bcryptjs` (salt rounds >= 10), creates User and Doctor profile with 1:1 invariant, compensation rollback on partial failures, logs `DOCTOR_CREATED` in `ActivityLog` (never logs plaintext password or password hash), returns single-use credentials payload only in the 201 response.
     - `getDoctors`: Lists all physicians with enriched data (`doctorId`, `name`, `email`, `username`, `phone`, `specialization`, `specialty`, `status`, `accountStatus`, `assignedPatientCount`, `createdAt`). Strictly strips passwordHash, plaintext passwords, and secrets. Supports both JSON API and HTML view rendering.
     - `getDoctorById`: Retrieves detailed physician profile, linked User account status, assigned patient count, read-only list of assigned patients (`patientId`, `name`, `email`, `age`, `gender`, `deviceId`), and recent `ActivityLog` audit stream. Strictly excludes credentials and secrets.
     - `activateDoctor`: PATCH endpoint (`PATCH /api/admin/doctors/:doctorId/activate`). Sets `Doctor.status = 'ACTIVE'` and linked `User.status = 'ACTIVE'`. Idempotent for already active accounts. Logs `DOCTOR_ACTIVATED` in `ActivityLog`.
     - `deactivateDoctor`: PATCH endpoint (`PATCH /api/admin/doctors/:doctorId/deactivate`). Sets `Doctor.status = 'INACTIVE'` and linked `User.status = 'SUSPENDED'`. Immediately blocks login authentication and WebSocket connections while preserving existing patient relationships and historical telemetry intact. Idempotent for already inactive accounts. Logs `DOCTOR_DEACTIVATED` in `ActivityLog`.
     - `deleteDoctor`: DELETE endpoint (`DELETE /api/admin/doctors/:doctorId`). Permitted only for unassigned doctors (`assignedPatientCount === 0`); rejects with 400 Bad Request if doctor has assigned patients (directing to reassign or deactivate). Atomically removes Doctor profile and linked User account to eliminate dangling references, preserves historical `SensorReading` records, and logs `DOCTOR_REMOVED` in `ActivityLog`.
  2. Updated `src/config/constants.js`:
     - Added `DOCTOR_ACTIVATED: "DOCTOR_ACTIVATED"` and `DOCTOR_DEACTIVATED: "DOCTOR_DEACTIVATED"` to `AUDIT_ACTIONS` enum.
  3. Enhanced `src/models/Doctor.js`:
     - Added virtual `specialty` getter and setter for seamless backwards compatibility across legacy and alternate views.
  4. Updated `src/controllers/adminController.js`:
     - Delegated `getDoctors` to `adminDoctorController.getDoctors`.
  5. Updated `src/routes/adminRoutes.js`:
     - Mounted `POST /doctors`, `GET /doctors`, `GET /doctors/:doctorId`, `PATCH /doctors/:doctorId/activate`, `PATCH /doctors/:doctorId/deactivate`, and `DELETE /doctors/:doctorId`.
     - All routes guarded by `authenticate` and `requireRole(ROLES.SUPER_ADMIN)`.
  6. Updated `src/controllers/authController.js`:
     - Enhanced login authentication to verify doctor profile status in addition to user account status, preventing deactivated or suspended doctors from authenticating.
  7. Upgraded Admin UI (`src/views/admin/doctors.ejs` & `src/views/admin/doctorDetail.ejs`):
     - Transformed `/admin/doctors` from a read-only registry into an interactive Doctor Management Console.
     - Added Provision Doctor modal with field validation, specialty selector, and optional custom password field.
     - Added one-time Credentials Presentation modal with clean display of doctor ID, name, email, username, temporary password, and "Copy Password" button.
     - Added confirmation modal for Activate / Deactivate actions detailing the authentication consequences.
     - Built dedicated Doctor Detail view (`src/views/admin/doctorDetail.ejs`) displaying physician profile, clinical status, read-only assigned patient inventory, and audit trail.
  8. Implemented Comprehensive Phase 7 Test Suite (`tests/doctorManagementValidation.test.js`):
     - 40 automated tests covering: provisioning by Super Admin (201), patient rejection (403), doctor rejection (403), unauthenticated rejection (401), duplicate email rejection (400), duplicate username rejection (400), immutable DOCTOR role enforcement, SUPER_ADMIN spoofing defense, PATIENT spoofing defense, User <-> Doctor 1:1 relationship integrity, credential generation, bcrypt hashing verification, plaintext non-persistence, exclusion from list APIs, exclusion from ActivityLog, deactivation by Super Admin, reactivation by Super Admin, unauthorized deactivation rejection, authentication synchronization (`User.status` to `SUSPENDED` / `ACTIVE`), idempotent activation/deactivation, listing and details inspection, secret exclusion, patient count correctness, audit logging (`DOCTOR_CREATED`, `DOCTOR_ACTIVATED`, `DOCTOR_DEACTIVATED`, with zero leaked secrets), doctor login compatibility (active succeeds, deactivated returns 403 suspension notice, reactivated succeeds again), telemetry preservation, patient record preservation, device ownership preservation, Phase 5 device lifecycle compatibility, and User/Doctor invariant consistency.
  9. Updated `package.json`:
     - Added `test:doctor` script (`node tests/doctorManagementValidation.test.js`) and incorporated it into the master `npm test` script.
- **Reason:**
  Establish secure, Super Admin-governed physician provisioning, temporary credential issuance, and account lifecycle controls without public doctor self-registration, preserving existing clinical data and Phase 8 boundaries.
- **Files Affected:**
  - `src/config/constants.js`
  - `src/models/Doctor.js`
  - `src/controllers/adminDoctorController.js`
  - `src/controllers/adminController.js`
  - `src/controllers/authController.js`
  - `src/routes/adminRoutes.js`
  - `src/views/admin/doctors.ejs`
  - `src/views/admin/doctorDetail.ejs`
  - `package.json`
  - `tests/doctorManagementValidation.test.js`
  - `doc/HEALTH_TRACKER_TASK_TRACKER.md`
  - `doc/HEALTH_TRACKER_PROGRESS.md`
  - `doc/HEALTH_TRACKER_CHANGELOG.md`
- **Verification:**
  - `node tests/doctorManagementValidation.test.js`: 40/40 tests passed.
  - `node tests/schemaValidation.test.js`: 10/10 tests passed (Phase 0 regression).
  - `node tests/iotSimulator.test.js`: 10/10 tests passed (Phase 1 regression).
  - `node tests/authValidation.test.js`: 20/20 tests passed (Phase 2 regression).
  - `node tests/rbacValidation.test.js`: 24/24 tests passed (Phase 3 regression).
  - `node tests/adminPortalValidation.test.js`: 20/20 tests passed (Phase 4 regression).
  - `node tests/deviceManagementValidation.test.js`: 34/34 tests passed (Phase 5 regression).
  - `node tests/patientRegistrationValidation.test.js`: 28/28 tests passed (Phase 6 regression).
  - `npm test`: 186/186 total tests passed with zero failures across all 8 test suites.

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
