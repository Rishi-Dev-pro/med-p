# HEALTH TRACKER — SECURITY HARDENING ARCHITECTURE & CONTROLS
**Phase 15: Application Security Hardening & Penetration Defense Reference**
*Health Tracker IoT Patient Monitoring System | Authoritative Security Documentation*

---

> [!CAUTION]
> **COMPLIANCE DISCLAIMER:**
> This project is an engineering prototype and demonstrator. **This project does NOT claim HIPAA compliance**, FDA clearance, or certification under ISO 27001, SOC 2, or CE Medical Device Directives. It must NOT be used for real primary clinical diagnosis or emergency medical decision-making.

---

## 1. EXECUTIVE SUMMARY & OBJECTIVE

Phase 15 implements production-grade defensive security controls across all application layers, transforming the Health Tracker platform from a feature-complete medical telemetry prototype into a resilient, hardened backend that fails securely rather than silently accepting malformed, unauthorized, or suspicious requests.

All security controls are strictly enforced **server-side**. The client/frontend is treated as untrusted.

---

## 2. HTTP SECURITY HEADERS (HELMET)

The backend integrates `helmet` (v8.3.0) via `src/config/security.js` with tailored configurations designed specifically for the EJS templating engine, Chart.js time-series graphs, and real-time Socket.IO transports:

1. **Content-Security-Policy (CSP):**
   - `default-src`: `["'self'"]`
   - `script-src`: `["'self'", "'unsafe-inline'"]` (Permits EJS inline initializers and Chart.js bundle scripts; `unsafe-eval` is **strictly forbidden**)
   - `style-src`: `["'self'", "'unsafe-inline'"]` (Supports internal design system CSS tokens and dynamic pulse indicators)
   - `img-src`: `["'self'", "data:"]`
   - `connect-src`: `["'self'", "ws:", "wss:"]` (Enables WebSocket connections for real-time telemetry and audit feeds)
   - `font-src`: `["'self'"]`
   - `object-src`: `["'none'"]` (Prevents plugin-based attacks like Flash/Java applets)
   - `frame-ancestors`: `["'none'"]` (Clickjacking defense)
2. **X-Content-Type-Options:** `nosniff` (Prevents MIME-type sniffing).
3. **X-Frame-Options:** `DENY` (Prevents framing/embedding).
4. **Referrer-Policy:** `strict-origin-when-cross-origin`.
5. **HTTP Strict Transport Security (HSTS):**
   - Automatically enabled **only** in production environments (`NODE_ENV === "production"`) with `maxAge: 31536000` (1 year), `includeSubDomains: true`, and `preload: true`.
   - Disabled during local HTTP development so developers are not locked into HTTPS locally.

---

## 3. STRICT CORS POLICY

Per-environment strict origin allowlisting is implemented in `src/config/security.js`:

- **Environment-Driven Origins:** Configured via `CORS_ORIGIN` (comma-separated list, e.g., `https://dashboard.healthtracker.example,https://portal.healthtracker.example`).
- **Development Default:** Defaults safely to `http://localhost:5173` and `http://127.0.0.1:5173` when `CORS_ORIGIN` is not defined in non-production.
- **Zero Wildcards with Credentials:** The application relies on HttpOnly JWT cookies. Using `origin: "*"` with `credentials: true` is strictly prohibited by both CORS specifications and our environment validator.
- **Dynamic Origin Validation:** Requests with unknown or untrusted `Origin` headers are rejected with a CORS error (`403/Forbidden` / `Not allowed by CORS`), which also logs a `CORS_REJECTED` audit event.
- **Same-Origin Requests:** Requests lacking an `Origin` header (such as internal server-rendered EJS requests and server-side HTTP clients) are safely permitted.

---

## 4. AUTHENTICATION BRUTE-FORCE DEFENSE

Dedicated rate-limiting middleware instances are implemented in `src/middleware/rateLimiter.js`:

| Limiter | Target Routes | Sliding Window | Max Attempts | Behavior on Exceeded |
| :--- | :--- | :--- | :--- | :--- |
| `authLoginRateLimiter` | `POST /api/auth/login` | 15 minutes (`AUTH_RATE_LIMIT_WINDOW_MS`) | 50 attempts (`AUTH_LOGIN_MAX_ATTEMPTS`, defaults to 10 in prod) | HTTP 429 Too Many Requests + `Retry-After` header + `AUTH_RATE_LIMITED` audit event |
| `authRegisterRateLimiter` | `POST /api/auth/register` | 60 minutes (`AUTH_REGISTER_WINDOW_MS`) | 50 attempts (`AUTH_REGISTER_MAX_ATTEMPTS`, defaults to 10 in prod) | HTTP 429 Too Many Requests + `Retry-After` header |
| `iotRateLimiter` | `POST /api/iot/data` | 1 minute (`IOT_RATE_LIMIT_WINDOW_MS`) | 120 requests (`IOT_RATE_LIMIT_MAX_REQUESTS`) | HTTP 429 Too Many Requests + `Retry-After` header |

- **RFC-Standard Headers:** All rate limiters expose `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.
- **IP Proxy Safety:** Express is configured with `app.set("trust proxy", ...)` adhering strictly to `TRUST_PROXY` environment configuration (defaults to `false` in development to prevent client IP spoofing via arbitrary `X-Forwarded-For` headers).

---

## 5. IoT DEVICE API KEY LIFECYCLE & INGESTION AUTHENTICATION

Medical hardware endpoints must be authenticated to prevent rogue telemetry ingestion:

### 5.1 API Key Cryptography
- **Generation:** Generated via `crypto.randomBytes(32).toString("hex")` resulting in a 64-character token with prefix `htk_` (`htk_<64-hex-chars>`).
- **Storage:** **Plaintext keys are NEVER persisted in MongoDB.**
- **Hashing:** Keys are hashed using SHA-256 (`crypto.createHash("sha256").update(rawKey).digest("hex")`).
- **Timing-Safe Verification:** Checked using `crypto.timingSafeEqual` between hashed buffers to eliminate timing side-channel attacks.
- **Device Schema Extensions:**
  - `apiKeyHash`: Select: `false` (never retrieved by default Mongoose queries).
  - `apiKeyPrefix`: First 8 characters stored for diagnostic identification (e.g., `htk_9a8b...`).
  - `apiKeyCreatedAt`, `apiKeyLastUsedAt`, `apiKeyRotatedAt`.

### 5.2 Device API Key Lifecycle Management (Super Admin)
1. **Creation:** Automatically generated when a device is provisioned via `POST /api/admin/devices`. The raw key is returned **once** in the creation response.
2. **Rotation:** Super Admin endpoint `POST /api/admin/devices/:deviceId/rotate-key`. Invalidates previous key immediately, updates hash, records `DEVICE_API_KEY_ROTATED` audit log, and returns new raw key once.
3. **Revocation:** Super Admin endpoint `POST /api/admin/devices/:deviceId/revoke-key`. Clears `apiKeyHash`, records `DEVICE_API_KEY_REVOKED` audit log. Future telemetry is immediately rejected.
4. **Data Isolation:** Resetting an assignment or deactivating a device **never deletes historical `SensorReading` records**.

### 5.3 Ingestion Flow (`POST /api/iot/data`)
1. Extract API key from `Authorization: Bearer <API_KEY>` or `x-api-key` header.
2. If device has `apiKeyHash` or production mode is active:
   - Missing key: `401 Unauthorized`.
   - Invalid key: `401 Unauthorized` (does NOT reveal device existence).
3. If device is found but `status !== "ACTIVE"`:
   - Inactive device: `403 Forbidden`.
4. Update `Device.lastSeen` and `Device.apiKeyLastUsedAt`.
5. Persist telemetry reading to `SensorReading` collection and broadcast to authorized Socket.IO rooms.

---

## 6. ENVIRONMENT CONFIGURATION & FAIL-FAST VALIDATION

Centralized environment validator in `src/config/envValidator.js` executes immediately upon server boot (`src/server.js`):

- **Production Fail-Fast Rules (`NODE_ENV === "production"`):**
  1. `JWT_SECRET` must exist, must be at least 32 characters long, and must NOT match known weak development defaults.
  2. `MONGODB_URI` must be provided and must start with `mongodb://` or `mongodb+srv://`.
  3. `CORS_ORIGIN` must NOT contain wildcard `*` while credentials/cookies are active.
  4. `PORT` must be a valid integer between 1 and 65535.
- **Redacted Diagnostics:** `getSanitizedConfig()` provides safe configuration inspection without printing connection strings, passwords, or secrets.
- **Template Security:** `.env.example` contains only descriptive placeholders. `.env` is strictly tracked in `.gitignore`.

---

## 7. JWT & SESSION HARDENING

- **Algorithm Pinning:** Pinned strictly to `HS256` in `jwt.sign` and `jwt.verify(..., { algorithms: ["HS256"] })`. Arbitrary or `none` algorithms are rejected immediately.
- **Cookie Security:**
  - `httpOnly: true` (prevents XSS token exfiltration).
  - `sameSite: "lax"` (mitigates CSRF).
  - `secure: true` in production (enforces HTTPS transmission).
  - Standard expiration (24h default).
- **Minimal Claims:** JWT payloads contain strictly `userId`, `role`, and `profileId`. Plaintext passwords, PHI, and API keys are strictly excluded.

---

## 8. SOCKET.IO ACCESS CONTROL & PENETRATION RESILIENCE

Real-time WebSocket connections undergo strict server-side authentication and authorization:

1. **Handshake Guard:** Every socket connection must provide a valid JWT via cookie or `auth.token`. Connections without tokens or with expired/tampered tokens are disconnected immediately with `AUTH_REQUIRED` or `INVALID_TOKEN`.
2. **Account Suspension Guard:** Accounts marked `SUSPENDED` are refused handshake authorization (`ACCOUNT_SUSPENDED`).
3. **Room Authorization:**
   - Patients can ONLY join `patient:<their-profileId>`.
   - Doctors can ONLY join `doctor:<their-profileId>` and assigned patient rooms.
   - Non-admins attempting to join `admin:overview` or `admin:activity` are rejected.
4. **Identity Spoofing Immunity:** Client-supplied identity in `socket.emit("join-room", ...)` is ignored; room membership is bound strictly to `socket.user` attached during handshake authentication.

---

## 9. IDOR & OBJECT-LEVEL AUTHORIZATION

All resource endpoints verify subject-to-resource ownership:
- `GET /api/readings/:patientId`: Patient A cannot read Patient B's data (`403 Forbidden`).
- Doctor Access: Doctor A cannot read readings for patients not currently assigned to Doctor A (`403 Forbidden`).
- Super Admin Access: Normal users (Patients and Doctors) receive `403 Forbidden` on all `/api/admin/*` administrative routes.

---

## 10. REQUEST SIZE & ERROR RESPONSE HARDENING

- **Body Size Caps:** JSON and URL-encoded bodies are strictly capped at `100kb` (`express.json({ limit: "100kb" })`).
- **Oversized Payloads:** Payloads exceeding limits return `413 Payload Too Large`.
- **Malformed Payloads:** Malformed JSON returns structured `400 Bad Request` (`{ success: false, error: "Invalid JSON payload" }`).
- **Production Sanitization:** In `NODE_ENV === "production"`, error handlers return generic messages and completely suppress stack traces, file paths, and database connection strings.

---

## 11. SECURITY AUDIT LOGGING

Security-relevant actions are permanently logged to the append-only `ActivityLog` collection:
- `AUTH_LOGIN_SUCCESS` / `AUTH_LOGIN_FAILED`
- `AUTH_RATE_LIMITED`
- `DEVICE_API_KEY_CREATED` / `DEVICE_API_KEY_ROTATED` / `DEVICE_API_KEY_REVOKED`
- `CORS_REJECTED`
- `SECURITY_VALIDATION_FAILED`

All audit payloads pass through recursive credential redaction (`src/utils/activityLogger.js`) ensuring raw passwords, JWTs, cookie headers, and API keys are never recorded in audit storage.
