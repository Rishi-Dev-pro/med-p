/**
 * Reading History Controller
 * Health Tracker — Phase 10: Reading History Engine & Paginated API
 */

const SensorReading = require("../models/SensorReading");
const Patient = require("../models/Patient");

/**
 * GET /api/readings/:patientId
 * Paginated historical telemetry API for a given patient.
 *
 * Query parameters:
 *  - page: positive integer (default: 1)
 *  - limit: positive integer (default: 20, max: 100)
 *  - startDate: ISO date / YYYY-MM-DD
 *  - endDate: ISO date / YYYY-MM-DD
 */
const getReadings = async (req, res) => {
    try {
        const { patientId } = req.params;

        // 1. Verify patient exists in the database
        const patient = await Patient.findOne({ patientId }).lean();
        if (!patient) {
            return res.status(404).json({
                success: false,
                message: "Patient not found"
            });
        }

        // 2. Validate and parse pagination parameters
        let page = 1;
        if (req.query.page !== undefined) {
            const pageStr = String(req.query.page).trim();
            const parsedPage = Number(pageStr);
            if (!Number.isInteger(parsedPage) || parsedPage <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid page parameter: must be a positive integer"
                });
            }
            page = parsedPage;
        }

        let limit = 20;
        if (req.query.limit !== undefined) {
            const limitStr = String(req.query.limit).trim();
            const parsedLimit = Number(limitStr);
            if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid limit parameter: must be a positive integer"
                });
            }
            // Enforce hard maximum limit of 100 (safe DOS bounding)
            limit = Math.min(parsedLimit, 100);
        }

        // 3. Validate and parse date filters
        const filter = { patientId };
        const dateQuery = {};

        if (req.query.startDate) {
            const startDateStr = String(req.query.startDate).trim();
            let startDate;
            if (/^\d{4}-\d{2}-\d{2}$/.test(startDateStr)) {
                startDate = new Date(`${startDateStr}T00:00:00.000Z`);
            } else {
                startDate = new Date(startDateStr);
            }

            if (isNaN(startDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid startDate format"
                });
            }
            dateQuery.$gte = startDate;
        }

        if (req.query.endDate) {
            const endDateStr = String(req.query.endDate).trim();
            let endDate;
            if (/^\d{4}-\d{2}-\d{2}$/.test(endDateStr)) {
                endDate = new Date(`${endDateStr}T23:59:59.999Z`);
            } else {
                endDate = new Date(endDateStr);
            }

            if (isNaN(endDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid endDate format"
                });
            }
            dateQuery.$lte = endDate;
        }

        if (dateQuery.$gte && dateQuery.$lte && dateQuery.$gte > dateQuery.$lte) {
            return res.status(400).json({
                success: false,
                message: "Invalid date range: startDate cannot be after endDate"
            });
        }

        if (Object.keys(dateQuery).length > 0) {
            filter.timestamp = dateQuery;
        }

        // 4. Execute bounded, index-supported pagination query
        const skip = (page - 1) * limit;

        const [readings, total] = await Promise.all([
            SensorReading.find(filter)
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            SensorReading.countDocuments(filter)
        ]);

        const pages = total === 0 ? 0 : Math.ceil(total / limit);

        // 5. Format machine-readable ISO timestamps and sanitized payload
        const formattedReadings = readings.map((r) => ({
            patientId: r.patientId,
            deviceId: r.deviceId,
            doctorId: r.doctorId,
            value1: r.value1,
            value2: r.value2,
            timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : new Date(r.timestamp).toISOString()
        }));

        return res.status(200).json({
            success: true,
            data: {
                readings: formattedReadings,
                pagination: {
                    page,
                    limit,
                    total,
                    pages
                }
            }
        });
    } catch (error) {
        console.error("Error in readingController.getReadings:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to retrieve readings"
        });
    }
};

/**
 * GET /api/readings/:patientId/recent
 * Lightweight historical telemetry slice for chart initialization.
 *
 * Query parameters:
 *  - limit: positive integer (default: 50, max: 100)
 */
const getRecentReadings = async (req, res) => {
    try {
        const { patientId } = req.params;

        // 1. Verify patient exists in the database
        const patient = await Patient.findOne({ patientId }).lean();
        if (!patient) {
            return res.status(404).json({
                success: false,
                message: "Patient not found"
            });
        }

        // 2. Validate and parse limit parameter (default: 50, max: 100)
        let limit = 50;
        if (req.query.limit !== undefined) {
            const limitStr = String(req.query.limit).trim();
            const parsedLimit = Number(limitStr);
            if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid limit parameter: must be a positive integer"
                });
            }
            // Enforce hard maximum limit of 100 (safe DOS bounding)
            limit = Math.min(parsedLimit, 100);
        }

        // 3. Query newest N readings using compound index { patientId: 1, timestamp: -1 }
        const rawReadings = await SensorReading.find({ patientId })
            .sort({ timestamp: -1 })
            .limit(limit)
            .select("timestamp value1 value2 -_id")
            .lean();

        // 4. Format machine-readable ISO timestamps and chronological order (oldest -> newest) for charting
        const readings = rawReadings.map((r) => ({
            timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : new Date(r.timestamp).toISOString(),
            value1: r.value1,
            value2: r.value2
        }));

        // Approach B: Reverse into chronological order (oldest to newest, left-to-right)
        readings.reverse();

        return res.status(200).json({
            success: true,
            data: {
                readings,
                limit
            }
        });
    } catch (error) {
        console.error("Error in readingController.getRecentReadings:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to retrieve recent readings"
        });
    }
};

module.exports = {
    getReadings,
    getRecentReadings
};
