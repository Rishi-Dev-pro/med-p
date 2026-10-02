/**
 * Chart Data Sanitizer & Bounded Time-Series Manager
 * Health Tracker — Phase 11: Charts & Time-Series Data Visualization
 *
 * Implements strict security sanitization, duplicate protection,
 * out-of-order handling, and a bounded 50-point rolling window.
 * Compatible with CommonJS (Node.js tests) and Browser globals.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.ChartSanitizer = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    /**
     * Strict security validator for incoming telemetry points.
     * Prevents XSS, script injection, NaN, Infinity, and malformed timestamps.
     *
     * @param {Object} raw - Untrusted telemetry payload
     * @returns {Object|null} Sanitized reading object or null if invalid
     */
    function sanitizeReading(raw) {
        if (!raw || typeof raw !== "object") {
            return null;
        }

        const { value1, value2, timestamp } = raw;

        // 1. Validate value1: strictly finite number (reject strings, NaN, Infinity, null, undefined)
        if (typeof value1 !== "number" || !Number.isFinite(value1) || Number.isNaN(value1)) {
            return null;
        }

        // 2. Validate value2: strictly finite number (reject strings, NaN, Infinity, null, undefined)
        if (typeof value2 !== "number" || !Number.isFinite(value2) || Number.isNaN(value2)) {
            return null;
        }

        // 3. Validate timestamp: must be parseable into a valid Date
        if (
            timestamp === null ||
            timestamp === undefined ||
            (typeof timestamp !== "string" && typeof timestamp !== "number" && !(timestamp instanceof Date)) ||
            (typeof timestamp === "string" && timestamp.trim() === "")
        ) {
            return null;
        }

        const parsedDate = new Date(timestamp);
        if (Number.isNaN(parsedDate.getTime())) {
            return null;
        }

        const sanitized = {
            value1: Number(value1),
            value2: Number(value2),
            timestamp: parsedDate.toISOString()
        };

        if (raw.readingId !== undefined && raw.readingId !== null) {
            // Strip any malicious script/HTML characters from readingId
            sanitized.readingId = String(raw.readingId).replace(/[<>"'&]/g, "");
        }

        return sanitized;
    }

    /**
     * Format an ISO timestamp safely into a human-readable local time string.
     * Never returns unsanitized input.
     *
     * @param {string|Date} isoString
     * @returns {string} Formatted HH:MM:SS string
     */
    function formatChartTime(isoString) {
        const d = new Date(isoString);
        if (Number.isNaN(d.getTime())) return "--:--:--";
        return d.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
    }

    /**
     * Bounded Time-Series Data Manager
     * Maintains an array of at most maxPoints readings, strictly chronological.
     */
    class ChartTimeSeriesManager {
        constructor(maxPoints = 50) {
            this.maxPoints = Math.max(1, maxPoints);
            this.readings = [];
            this.seenKeys = new Set();
        }

        _makeKey(reading) {
            if (reading.readingId) {
                return `id_${reading.readingId}`;
            }
            const timeVal = new Date(reading.timestamp).getTime();
            return `t_${timeVal}_${reading.value1}_${reading.value2}`;
        }

        reset() {
            this.readings = [];
            this.seenKeys.clear();
        }

        /**
         * Load historical readings array (chronological order)
         * @param {Array} rawArray
         * @returns {Array} Array of sanitized, bounded points
         */
        loadInitial(rawArray) {
            this.reset();
            if (!Array.isArray(rawArray)) return [];

            for (const item of rawArray) {
                this.addReading(item);
            }
            return this.getPoints();
        }

        /**
         * Add a new reading to the rolling window.
         * Enforces:
         *  - Security sanitization
         *  - Duplicate protection
         *  - Chronological ordering (oldest -> newest, left to right)
         *  - Hard limit of maxPoints (default 50)
         *
         * @param {Object} rawReading
         * @returns {Object|null} Sanitized reading or null if rejected/duplicate
         */
        addReading(rawReading) {
            const sanitized = sanitizeReading(rawReading);
            if (!sanitized) {
                return null;
            }

            const key = this._makeKey(sanitized);
            if (this.seenKeys.has(key)) {
                return null; // Duplicate safely ignored
            }

            this.seenKeys.add(key);

            const newTime = new Date(sanitized.timestamp).getTime();
            let insertIndex = this.readings.length;

            // Handle potential out-of-order readings: insert in strict timestamp order
            if (
                this.readings.length > 0 &&
                newTime < new Date(this.readings[this.readings.length - 1].timestamp).getTime()
            ) {
                insertIndex = 0;
                while (
                    insertIndex < this.readings.length &&
                    new Date(this.readings[insertIndex].timestamp).getTime() <= newTime
                ) {
                    insertIndex++;
                }
            }

            this.readings.splice(insertIndex, 0, sanitized);

            // Bounded window: Remove oldest points if length exceeds maxPoints
            while (this.readings.length > this.maxPoints) {
                const oldest = this.readings.shift();
                const oldestKey = this._makeKey(oldest);
                this.seenKeys.delete(oldestKey);
            }

            return sanitized;
        }

        getPoints() {
            return [...this.readings];
        }

        getLabels() {
            return this.readings.map((r) => formatChartTime(r.timestamp));
        }

        getValue1Series() {
            return this.readings.map((r) => r.value1);
        }

        getValue2Series() {
            return this.readings.map((r) => r.value2);
        }

        getCount() {
            return this.readings.length;
        }

        getLatest() {
            return this.readings.length > 0 ? this.readings[this.readings.length - 1] : null;
        }
    }

    return {
        sanitizeReading,
        formatChartTime,
        ChartTimeSeriesManager
    };
}));
