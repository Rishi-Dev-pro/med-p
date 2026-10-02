/**
 * Centralized Activity Logger
 * Health Tracker — Phase 13: Centralized System Activity & Audit Trail
 *
 * Implements centralized, server-authoritative audit logging for security events,
 * administrative modifications, patient/doctor assignment changes, and hardware lifecycles.
 */

const ActivityLog = require("../models/ActivityLog");
const { AUDIT_ACTIONS, ACTOR_ROLES, TARGET_TYPES } = require("../config/constants");

let _ioInstance = null;

/**
 * Configure global Socket.IO instance for real-time audit broadcasting
 * @param {import("socket.io").Server} io
 */
function setActivityLoggerIO(io) {
    _ioInstance = io;
}

/**
 * Sensitive field patterns that must NEVER be written to ActivityLog
 */
const SENSITIVE_KEY_REGEX = /password|hash|token|jwt|cookie|secret|apikey|api_key|authorization|bearer/i;

/**
 * Recursively sanitize details payload to remove sensitive authentication or credential material
 * @param {any} value
 * @returns {any} Sanitized value
 */
function sanitizeDetails(value) {
    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value !== "object") {
        return value;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeDetails(item));
    }

    const sanitized = {};
    for (const [key, val] of Object.entries(value)) {
        if (SENSITIVE_KEY_REGEX.test(key)) {
            // Strip or redact sensitive material
            continue;
        }

        if (typeof val === "object" && val !== null) {
            sanitized[key] = sanitizeDetails(val);
        } else {
            sanitized[key] = val;
        }
    }

    return sanitized;
}

/**
 * Log an audit activity event to MongoDB and broadcast to authorized Super Admin listeners.
 * 
 * Supports both positional parameters:
 *   logActivity(action, actorRole, actorId, targetType, targetId, details, io, options)
 * and object argument:
 *   logActivity({ action, actorRole, actorId, targetType, targetId, details, io, session })
 * 
 * @returns {Promise<import("mongoose").Document|null>} The created ActivityLog record
 */
async function logActivity(
    actionOrConfig,
    actorRoleArg,
    actorIdArg,
    targetTypeArg,
    targetIdArg,
    detailsArg,
    ioArg,
    optionsArg = {}
) {
    let action;
    let actorRole;
    let actorId;
    let targetType;
    let targetId;
    let details;
    let io;
    let session = null;

    if (typeof actionOrConfig === "object" && actionOrConfig !== null && !Array.isArray(actionOrConfig)) {
        action = actionOrConfig.action;
        actorRole = actionOrConfig.actorRole;
        actorId = actionOrConfig.actorId;
        targetType = actionOrConfig.targetType;
        targetId = actionOrConfig.targetId;
        details = actionOrConfig.details;
        io = actionOrConfig.io || ioArg;
        session = actionOrConfig.session || (optionsArg && optionsArg.session) || null;
    } else {
        action = actionOrConfig;
        actorRole = actorRoleArg;
        actorId = actorIdArg;
        targetType = targetTypeArg;
        targetId = targetIdArg;
        details = detailsArg;
        io = ioArg;
        session = optionsArg && optionsArg.session ? optionsArg.session : null;
    }

    // 1. Action Normalization & Validation
    const normalizedAction = typeof action === "string" ? action.trim().toUpperCase() : "";
    const validActions = Object.values(AUDIT_ACTIONS);
    if (!validActions.includes(normalizedAction)) {
        console.warn(`[ActivityLogger] Unknown or invalid audit action: '${action}'. Log ignored.`);
        return null;
    }

    // 2. Actor Role Normalization
    let normalizedActorRole = typeof actorRole === "string" ? actorRole.trim().toUpperCase() : "";
    const validRoles = Object.values(ACTOR_ROLES);
    if (!validRoles.includes(normalizedActorRole)) {
        normalizedActorRole = ACTOR_ROLES.SYSTEM;
    }

    // 3. Actor ID Normalization
    const normalizedActorId = actorId && typeof actorId === "string" && actorId.trim()
        ? actorId.trim()
        : (actorId ? String(actorId) : null);

    // 4. Target Type Normalization
    let normalizedTargetType = typeof targetType === "string" ? targetType.trim().toUpperCase() : "";
    const validTargets = Object.values(TARGET_TYPES);
    if (!validTargets.includes(normalizedTargetType)) {
        normalizedTargetType = TARGET_TYPES.SYSTEM;
    }

    // 5. Target ID Normalization (tolerates null)
    const normalizedTargetId = targetId && typeof targetId === "string" && targetId.trim()
        ? targetId.trim()
        : (targetId ? String(targetId) : null);

    // 6. Details Sanitization (removes passwords, tokens, hashes, cookies, API keys)
    const safeDetails = sanitizeDetails(details || {});

    // 7. Server-generated timestamp
    const timestamp = new Date();

    const entryData = {
        action: normalizedAction,
        actorRole: normalizedActorRole,
        actorId: normalizedActorId,
        targetType: normalizedTargetType,
        targetId: normalizedTargetId,
        details: safeDetails,
        timestamp
    };

    // 8. Persist to MongoDB
    let createdRecord;
    try {
        if (session) {
            const records = await ActivityLog.create([entryData], { session });
            createdRecord = records[0];
        } else {
            createdRecord = await ActivityLog.create(entryData);
        }
    } catch (dbErr) {
        console.error("[ActivityLogger] Failed to persist ActivityLog to database:", dbErr.message);
        throw dbErr;
    }

    // 9. Real-Time Broadcast via Socket.IO
    // Strictly after successful persistence; never emit on failure
    try {
        const activeIo = io || _ioInstance;
        if (activeIo) {
            const broadcastPayload = {
                _id: createdRecord._id.toString(),
                action: createdRecord.action,
                actorRole: createdRecord.actorRole,
                actorId: createdRecord.actorId,
                targetType: createdRecord.targetType,
                targetId: createdRecord.targetId,
                details: createdRecord.details,
                timestamp: createdRecord.timestamp.toISOString()
            };

            // Emit to authorized super admin rooms
            activeIo.to("admin:activity").emit("admin-activity", broadcastPayload);
            activeIo.to("admin:telemetry").emit("admin-activity", broadcastPayload);
        }
    } catch (socketErr) {
        console.warn("[ActivityLogger] Socket.IO broadcast warning:", socketErr.message);
    }

    return createdRecord;
}

module.exports = {
    logActivity,
    setActivityLoggerIO,
    sanitizeDetails
};
