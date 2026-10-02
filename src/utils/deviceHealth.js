/**
 * Device Telemetry Health & Diagnostics Utility
 * Health Tracker — Phase 12: Device Monitoring & Telemetry Health Dashboard
 * 
 * Authoritative single source of truth for telemetry health calculations:
 * - ONLINE:  lastSeen < 60 seconds ago (and Device.status is ACTIVE)
 * - STALE:   60 seconds <= lastSeen < 600 seconds (10 minutes) (and Device.status is ACTIVE)
 * - OFFLINE: lastSeen >= 600 seconds OR lastSeen is null OR Device.status is INACTIVE
 */

const SensorReading = require("../models/SensorReading");
const { DEVICE_HEALTH, DEVICE_STATUS } = require("../config/constants");

/**
 * Human-readable relative time representation for lastSeen timestamps.
 * 
 * @param {Date|string|number|null} lastSeen 
 * @param {Date|number} [now=new Date()] 
 * @returns {string} e.g. "Just now", "25s ago", "3 minutes ago", "Never"
 */
function formatLastSeen(lastSeen, now = new Date()) {
    if (!lastSeen) return "Never";

    const lastSeenDate = lastSeen instanceof Date ? lastSeen : new Date(lastSeen);
    if (isNaN(lastSeenDate.getTime())) return "Never";

    const nowDate = now instanceof Date ? now : new Date(now);
    const ageMs = nowDate.getTime() - lastSeenDate.getTime();
    if (ageMs < 0) return "Just now";

    const ageSeconds = Math.floor(ageMs / 1000);

    if (ageSeconds < 5) return "Just now";
    if (ageSeconds < 60) return `${ageSeconds}s ago`;
    if (ageSeconds < 120) return "1 minute ago";
    if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)} minutes ago`;
    if (ageSeconds < 7200) return "1 hour ago";
    if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)} hours ago`;
    if (ageSeconds < 172800) return "1 day ago";
    return `${Math.floor(ageSeconds / 86400)} days ago`;
}

/**
 * Calculate deterministic telemetry health status.
 * Accepts optional reference time `now` for reproducible unit and boundary testing.
 * 
 * @param {Object|Date|string|number|null} target - Device document/POJO or raw lastSeen value
 * @param {Date|number} [now=new Date()] - Reference time (default: current system time)
 * @param {string} [statusOverride=null] - Optional lifecycle status override ('ACTIVE' | 'INACTIVE')
 * @returns {{ health: string, ageSeconds: number|null, lastSeen: string|null, lastSeenFormatted: string }}
 */
function getDeviceHealth(target, now = new Date(), statusOverride = null) {
    const nowDate = now instanceof Date ? now : new Date(now);

    let lastSeen = null;
    let status = DEVICE_STATUS.ACTIVE;

    if (target && typeof target === "object" && !(target instanceof Date)) {
        lastSeen = target.lastSeen !== undefined ? target.lastSeen : null;
        if (target.status !== undefined) {
            status = target.status;
        }
    } else {
        lastSeen = target;
    }

    if (statusOverride !== null && statusOverride !== undefined) {
        status = statusOverride;
    }

    const isActive = String(status).toUpperCase() === DEVICE_STATUS.ACTIVE;

    // Rule: INACTIVE device is ALWAYS OFFLINE regardless of lastSeen
    if (!isActive) {
        const lastSeenDate = lastSeen ? (lastSeen instanceof Date ? lastSeen : new Date(lastSeen)) : null;
        const validDate = lastSeenDate && !isNaN(lastSeenDate.getTime());
        const ageSeconds = validDate ? Math.max(0, Math.floor((nowDate.getTime() - lastSeenDate.getTime()) / 1000)) : null;

        return {
            health: DEVICE_HEALTH.OFFLINE,
            ageSeconds,
            lastSeen: validDate ? lastSeenDate.toISOString() : null,
            lastSeenFormatted: validDate ? formatLastSeen(lastSeenDate, nowDate) : "Never"
        };
    }

    // Rule: Null or uninitialized lastSeen is OFFLINE
    if (!lastSeen) {
        return {
            health: DEVICE_HEALTH.OFFLINE,
            ageSeconds: null,
            lastSeen: null,
            lastSeenFormatted: "Never"
        };
    }

    const lastSeenDate = lastSeen instanceof Date ? lastSeen : new Date(lastSeen);
    if (isNaN(lastSeenDate.getTime())) {
        return {
            health: DEVICE_HEALTH.OFFLINE,
            ageSeconds: null,
            lastSeen: null,
            lastSeenFormatted: "Never"
        };
    }

    const ageMs = nowDate.getTime() - lastSeenDate.getTime();
    const ageSeconds = Math.max(0, Math.floor(ageMs / 1000));
    const lastSeenFormatted = formatLastSeen(lastSeenDate, nowDate);
    const lastSeenIso = lastSeenDate.toISOString();

    // Exact boundary evaluations:
    // age < 60 seconds (ageMs < 60,000) -> ONLINE
    // 60 seconds <= age < 600 seconds (60,000 <= ageMs < 600,000) -> STALE
    // age >= 600 seconds (ageMs >= 600,000) -> OFFLINE
    let health = DEVICE_HEALTH.OFFLINE;
    if (ageMs < 60 * 1000) {
        health = DEVICE_HEALTH.ONLINE;
    } else if (ageMs < 600 * 1000) {
        health = DEVICE_HEALTH.STALE;
    } else {
        health = DEVICE_HEALTH.OFFLINE;
    }

    return {
        health,
        ageSeconds,
        lastSeen: lastSeenIso,
        lastSeenFormatted
    };
}

/**
 * Calculate observed transmission frequency using bounded recent readings.
 * Never loads unlimited collection history; queries up to `sampleLimit` newest records.
 * 
 * @param {string} deviceId - Hardware device identifier
 * @param {number} [sampleLimit=10] - Bounded sample size (default: 10)
 * @returns {Promise<{ frequencySeconds: number|null, formatted: string, sampleCount: number }>}
 */
async function calculateObservedFrequency(deviceId, sampleLimit = 10) {
    if (!deviceId || typeof deviceId !== "string" || !deviceId.trim()) {
        return {
            frequencySeconds: null,
            formatted: "Insufficient data",
            sampleCount: 0
        };
    }

    const cleanDeviceId = deviceId.trim();

    // Covered query using compound index { deviceId: 1, timestamp: -1 }
    const readings = await SensorReading.find({ deviceId: cleanDeviceId })
        .select("timestamp")
        .sort({ timestamp: -1 })
        .limit(Math.min(sampleLimit, 50))
        .lean();

    if (!readings || readings.length < 2) {
        return {
            frequencySeconds: null,
            formatted: "Insufficient data",
            sampleCount: readings ? readings.length : 0
        };
    }

    // Readings are sorted descending: [reading_0 (latest), reading_1, ..., reading_N (oldest)]
    let totalDeltaSeconds = 0;
    let deltaCount = 0;

    for (let i = 0; i < readings.length - 1; i++) {
        const newerTime = new Date(readings[i].timestamp).getTime();
        const olderTime = new Date(readings[i + 1].timestamp).getTime();
        const deltaSeconds = (newerTime - olderTime) / 1000;

        if (deltaSeconds > 0) {
            totalDeltaSeconds += deltaSeconds;
            deltaCount++;
        }
    }

    if (deltaCount === 0) {
        return {
            frequencySeconds: null,
            formatted: "Insufficient data",
            sampleCount: readings.length
        };
    }

    const avgSeconds = Math.round((totalDeltaSeconds / deltaCount) * 10) / 10;
    const formatted = avgSeconds < 60 ? `~${avgSeconds}s` : `~${Math.round(avgSeconds / 60)}m`;

    return {
        frequencySeconds: avgSeconds,
        formatted,
        sampleCount: readings.length
    };
}

/**
 * Batch calculate observed transmission frequencies for multiple devices.
 * Uses a single aggregation pipeline instead of N individual database queries.
 * 
 * @param {string[]} deviceIds - Array of device identifiers
 * @param {number} [sampleLimit=10] - Number of readings per device to inspect
 * @returns {Promise<Map<string, { frequencySeconds: number|null, formatted: string, sampleCount: number }>>}
 */
async function batchCalculateObservedFrequency(deviceIds, sampleLimit = 10) {
    const freqMap = new Map();
    if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
        return freqMap;
    }

    const cleanIds = [...new Set(deviceIds.filter(Boolean).map((id) => String(id).trim()))];
    if (cleanIds.length === 0) {
        return freqMap;
    }

    // Single aggregation query over compound index { deviceId: 1, timestamp: -1 }
    const aggregated = await SensorReading.aggregate([
        { $match: { deviceId: { $in: cleanIds } } },
        { $sort: { timestamp: -1 } },
        {
            $group: {
                _id: "$deviceId",
                timestamps: { $push: "$timestamp" }
            }
        },
        {
            $project: {
                deviceId: "$_id",
                recentTimestamps: { $slice: ["$timestamps", Math.min(sampleLimit, 50)] }
            }
        }
    ]);

    const aggregatedMap = new Map(aggregated.map((a) => [a.deviceId, a.recentTimestamps]));

    for (const devId of cleanIds) {
        const timestamps = aggregatedMap.get(devId) || [];
        if (timestamps.length < 2) {
            freqMap.set(devId, {
                frequencySeconds: null,
                formatted: "Insufficient data",
                sampleCount: timestamps.length
            });
            continue;
        }

        let totalDeltaSeconds = 0;
        let deltaCount = 0;

        for (let i = 0; i < timestamps.length - 1; i++) {
            const newer = new Date(timestamps[i]).getTime();
            const older = new Date(timestamps[i + 1]).getTime();
            const delta = (newer - older) / 1000;
            if (delta > 0) {
                totalDeltaSeconds += delta;
                deltaCount++;
            }
        }

        if (deltaCount === 0) {
            freqMap.set(devId, {
                frequencySeconds: null,
                formatted: "Insufficient data",
                sampleCount: timestamps.length
            });
            continue;
        }

        const avgSeconds = Math.round((totalDeltaSeconds / deltaCount) * 10) / 10;
        const formatted = avgSeconds < 60 ? `~${avgSeconds}s` : `~${Math.round(avgSeconds / 60)}m`;

        freqMap.set(devId, {
            frequencySeconds: avgSeconds,
            formatted,
            sampleCount: timestamps.length
        });
    }

    return freqMap;
}

module.exports = {
    getDeviceHealth,
    formatLastSeen,
    calculateObservedFrequency,
    batchCalculateObservedFrequency
};
