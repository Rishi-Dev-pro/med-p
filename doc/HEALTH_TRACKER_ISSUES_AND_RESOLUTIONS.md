# Health Tracker IoT Patient Monitoring System
## Issues, Root-Cause Analysis & Resolution Ledger

**Document:** `doc/HEALTH_TRACKER_ISSUES_AND_RESOLUTIONS.md`  
**Date:** October 3, 2026  
**Status:** Verified & Synchronized with Main Repository  
**Test Verification Baseline:** 548 / 548 Automated Tests Passing (`npm test`)

---

## Executive Summary

This document provides a comprehensive audit trail of all runtime defects, user-reported operational anomalies, root-cause investigations, and engineering resolutions across the Health Tracker platform. It also outlines ongoing system considerations and architectural invariants to ensure production-grade reliability.

---

## 1. Solved Problems & Engineering Resolutions

### Problem 1: Admin Login Redirected to Raw JSON API Message
- **User Symptom:** Logging in with `admin` redirected to `http://localhost:5000/` which printed raw JSON: `{"message": "IoT Health Monitoring Backend is running!"}` instead of the dashboard.
- **Root Cause:**
  1. In `src/views/auth/login.ejs`, the client-side redirect handler only evaluated `DOCTOR` (`/doctor/overview`) and `PATIENT` (`/patient/${data.patientId}`), falling back to `"/"` for any other role.
  2. In `src/app.js`, `GET /` previously returned a static JSON message rather than inspecting the user's authentication cookie and redirecting to their role-specific dashboard.
- **Resolution:**
  - Updated `src/views/auth/login.ejs` to explicitly handle `SUPER_ADMIN` and navigate to `/admin/overview`.
  - Updated `GET /` in `src/app.js` with role-aware cookie inspection:
    - `SUPER_ADMIN` $\to$ `/admin/overview`
    - `DOCTOR` $\to$ `/doctor/overview`
    - `PATIENT` $\to$ `/patient/overview`
    - Unauthenticated $\to$ `/login`
- **Verification:** Verified via automated browser subagent and integration tests. Admin login lands directly on `/admin/overview`.

---

### Problem 2: Hardware Device Modal Cancel & "×" Close Buttons Not Working
- **User Symptom:** When opening "Provision Hardware Device", clicking the "Cancel" or "×" close button did not close the modal.
- **Root Cause:**
  - **Helmet v8 Content Security Policy (CSP)** defaults `scriptSrcAttr` to `'none'`. This silently blocked all inline attribute handlers (`onclick="closeModal('createDeviceModal')"`).
  - Modal helper functions were declared within a closure without explicit assignment to the global `window` scope.
- **Resolution:**
  - Configured `scriptSrcAttr: ["'unsafe-inline'"]` within Helmet CSP directives in `src/config/security.js`.
  - In `src/views/admin/devices.ejs`, explicitly bound `window.openModal = openModal` and `window.closeModal = closeModal`.
  - Added global `Escape` key and backdrop-click dismiss handlers.
- **Verification:** Verified in browser subagent: clicking `Cancel`, clicking `×`, pressing `Escape`, and clicking outside the modal backdrop all dismiss the modal cleanly.

---

### Problem 3: Page Loading Delays / Stalls After 6–7 Tab Transitions
- **User Symptom:** Clicking through overview and other tabs 6–7 times caused subsequent page loads to become slow or unresponsive.
- **Root Cause (Connection Pool Starvation):**
  - Socket.IO clients attempted to connect to `ws://localhost:5000/socket.io/`.
  - In `src/config/security.js`, `getAllowedOrigins()` only included Vite ports `5173` and `3000`. Port `5000` was missing.
  - When accessing the portal directly on port 5000, Socket.IO handshake requests were rejected with `403 Forbidden / CORS origin denied`.
  - The client continuously retried both WebSocket and long-polling fallbacks in a tight loop. Because browsers limit concurrent HTTP connections to a single domain (6 connections in Chrome), the pending polling retries exhausted the connection pool, stalling subsequent page navigations.
- **Resolution:**
  - Added `http://localhost:5000`, `http://127.0.0.1:5000`, and dynamic `http://localhost:${PORT}` to `getAllowedOrigins()` in `src/config/security.js`.
- **Verification:** Socket.IO now connects immediately on the first attempt (`200 OK`, upgraded to WebSocket). Connection starvation eliminated; tab switching is instant.

---

### Problem 4: Adding Hardware Device Not Functional
- **User Symptom:** Submitting the "Provision Hardware Device" modal form failed to register new devices.
- **Root Cause:**
  - The form relied on `onsubmit="handleCreateDevice(event)"`, which was blocked by Helmet CSP attribute restrictions.
  - `handleCreateDevice` was not attached to `window`.
- **Resolution:**
  - Fixed CSP `scriptSrcAttr`.
  - Attached `window.handleCreateDevice = handleCreateDevice` in `src/views/admin/devices.ejs`.
- **Verification:** Provisioned test device `DEV-UI-VERIFY` via browser subagent. Form submitted, modal closed, device rendered in table as `ACTIVE + UNASSIGNED`.

---

### Problem 5: Repeated WebSocket Errors in Browser Console
- **User Symptom:** Console was flooded with:  
  `WebSocket connection to 'ws://localhost:5000/socket.io/?EIO=4&transport=websocket' failed`
- **Root Cause:**
  - CORS origin mismatch on the Socket.IO server for requests originating from `http://localhost:5000`.
- **Resolution:**
  - Synchronized Socket.IO allowed origins with `getAllowedOrigins()` in `src/config/security.js`.
- **Verification:** Browser console inspected during full navigation flow; zero WebSocket or CORS errors reported.

---

### Problem 6: Quick-Switch Admin View Mode Redirecting to Blank/Error Page
- **User Symptom:** In Quick-Switch view mode (viewing patient or doctor as admin), clicking secondary sidebar links redirected to a blank plain-text page: `Forbidden: Insufficient role permissions`.
- **User Requirement:** When in Quick-Switch view mode, clicking restricted navigation links should show a toast notification explaining that the section is private, rather than navigating away to an error page.
- **Resolution:**
  1. Updated `src/views/admin/partials/adminViewBanner.ejs`:
     - Included `/js/toast.js` and styling.
     - Implemented restricted sidebar link interception: non-overview links are dimmed and intercept `click` events to trigger:  
       `"Private Section: '<Name>' is restricted in Quick-Switch View Mode. Click 'Return to Admin' to manage accounts."`
  2. Updated `src/middleware/roleMiddleware.js`:
     - Replaced raw plain-text `res.status(403).send(...)` with styled `res.status(403).render("error", ...)` for any direct browser URL entries.
- **Verification:** Tested in browser subagent. Clicking restricted patient links in Admin View Mode triggers a warning toast and prevents navigation away from the dashboard.

---

### Problem 7: Doctor Deactivate Button Not Functional
- **User Symptom:** Clicking "Deactivate" on doctor rows in `/admin/doctors` produced no action.
- **Root Cause:**
  - Inline `onclick="openStatusModal(...)"` was blocked by CSP.
  - `openStatusModal` and `executeStatusChange` were not exposed to `window`.
- **Resolution:**
  - Attached all doctor lifecycle methods to `window` in `src/views/admin/doctors.ejs`.
  - Added Escape key and backdrop click dismiss handlers.
- **Verification:** Browser subagent clicked "Deactivate" on `DOC-001` (Dr. Sharma): the confirmation modal opened with all safety notices and patient invariant summaries, and canceled cleanly.

---

### Problem 8: Provision Doctor Button Not Functional
- **User Symptom:** Clicking "+ Provision Doctor" on `/admin/doctors` did not open the modal or allow account creation.
- **Root Cause:**
  - Inline attribute blocking and missing global bindings for doctor modal controllers.
- **Resolution:**
  - Refactored `src/views/admin/doctors.ejs` modal controllers and bound `window.openModal`, `window.closeModal`, and `window.handleCreateDoctor`.
- **Verification:** Verified modal opens, resets cleanly, and dismisses on Cancel / backdrop click.

---

### Problem 9: Direct URL Navigation to `/login` or `/register` While Already Authenticated
- **User Symptom:** When logged in as Super Admin, changing the browser URL to `/register` or `/login` opened the authentication form instead of maintaining the active session.
- **Root Cause:**
  - Routes `GET /login` and `GET /register` rendered the EJS views unconditionally without checking for existing JWT cookies.
- **Resolution:**
  - Added session role verification in `src/app.js`:
    ```javascript
    app.get("/login", (req, res) => {
        const role = getAuthRole(req);
        if (role === ROLES.SUPER_ADMIN) return res.redirect("/admin/overview");
        if (role === ROLES.DOCTOR) return res.redirect("/doctor/overview");
        if (role === ROLES.PATIENT) return res.redirect("/patient/overview");
        res.render("auth/login");
    });
    ```
- **Verification:** Verified in browser: navigating to `/login` or `/register` with an active admin cookie immediately redirects to `/admin/overview`.

---

### Problem 10: Repeated Redirection Loop to Login Page
- **User Symptom:** After logging in, clicking login or navigating repeatedly redirected back to `/login`.
- **Root Cause:**
  - Interplay between legacy fallback redirects pointing to `"/"`, and `"/"` failing to recognise cookies, creating an oscillation between unauthenticated endpoints.
- **Resolution:**
  - Unified cookie-based authentication validation across `/`, `/login`, and `/register`.
- **Verification:** Verified session persistence across browser refreshes, tab navigations, and direct URL entries.

---

## 2. Identified Edge Cases & Current Operational Considerations

The following items are not bugs, but critical architectural considerations and operational policies identified during the comprehensive codebase review:

| # | Consideration / Edge Case | Architecture / Security Policy | Current Behavior & Guidance |
|---|---|---|---|
| **C1** | **Direct URL Access in Quick-Switch Mode** | Role-Based Access Control (RBAC) | If an admin in Quick-Switch view mode bypasses the UI and manually types `/patient/data` into the URL bar, the server enforces strict RBAC and renders a 403 error page. The UI intercepts all clicks with toasts; server-side enforcement remains strict to prevent privilege escalation. |
| **C2** | **Stale Cookies Following Seed Reset** | Token Invalidation | Running `npm run seed:demo` generates fresh user IDs. If a browser has a JWT cookie from a prior database state, the authentication middleware safely rejects the invalid token and redirects to `/login`. Users should log in anew after a database re-seed. |
| **C3** | **Production Guard for Demo Seed and Quick-Switch** | Security Hardening (Phase 15/16) | `src/seed/demoSeed.js` and `/admin/view/*` are strictly disabled when `NODE_ENV === "production"` or when the database name contains `"prod"`. This is an intentional security control. |
| **C4** | **Cross-Site Embedding (iFrames)** | CSRF & Cookie Security | Cookies are set with `SameSite: 'lax'` to prevent cross-site request forgery. The application cannot be embedded in third-party cross-origin iframes without explicit CORS / cookie reconfiguration. |
| **C5** | **Socket Reconnection Backoff** | Resilient Telemetry | If the backend server restarts while a browser tab is open, the Socket.IO client will automatically reconnect with exponential backoff once the server is back online. |

---

## 3. Test Suite & Verification Matrix

All 16 phases and verification suites pass with zero failures:

```
Test Suites:
  - tests/api.test.js                             [PASS] (Phase 1-3 baseline)
  - tests/adminLayoutMetrics.test.js              [PASS] (Phase 4 super admin portal)
  - tests/hardwareManagement.test.js              [PASS] (Phase 5 device lifecycle)
  - tests/deviceRegistrationIntegration.test.js   [PASS] (Phase 6 device claiming)
  - tests/doctorProvisioning.test.js              [PASS] (Phase 7 doctor accounts)
  - tests/patientDoctorAssignment.test.js         [PASS] (Phase 8 clinical assignments)
  - tests/multiPageDashboard.test.js              [PASS] (Phase 9 multi-page dashboards)
  - tests/patientTelemetryDashboard.test.js       [PASS] (Phase 10 telemetry charts)
  - tests/clinicalCohortReview.test.js            [PASS] (Phase 11 doctor cohort portal)
  - tests/realtimeDiagnostics.test.js             [PASS] (Phase 12 health diagnostics)
  - tests/productionReadiness.test.js             [PASS] (Phase 13 production readiness)
  - tests/errorRobustnessValidation.test.js       [PASS] (Phase 14 centralized errors)
  - tests/phase15SecurityHardening.test.js        [PASS] (Phase 15 security penetration)
  - tests/phase16PresentationValidation.test.js   [PASS] (Phase 16 presentation polish)

TOTAL AUTOMATED TESTS: 548 / 548 PASSED (0 FAILED)
```

---

## 4. Quick Testing Credentials

| Role | Username / Identifier | Password | Default Portal URL |
|---|---|---|---|
| **Super Admin** | `admin` | `Admin@12345` | `http://localhost:5000/admin/overview` |
| **Physician (Cardiology)** | `dr_sharma` | `Doctor@12345` | `http://localhost:5000/doctor/overview` |
| **Physician (Medicine)** | `dr_roy` | `Doctor@12345` | `http://localhost:5000/doctor/overview` |
| **Physician (Pulmonology)** | `dr_patel` | `Doctor@12345` | `http://localhost:5000/doctor/overview` |
| **Patient (Alpha)** | `patient_alpha` | `Patient@12345` | `http://localhost:5000/patient/overview` |
| **Patient (Beta)** | `patient_beta` | `Patient@12345` | `http://localhost:5000/patient/overview` |
| **Patient (Gamma)** | `patient_gamma` | `Patient@12345` | `http://localhost:5000/patient/overview` |
