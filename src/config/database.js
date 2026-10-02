/**
 * MongoDB / Mongoose Connection & Graceful Reconnection Manager
 * Health Tracker — Phase 14: Error Handling, Edge Cases & System Robustness
 *
 * Implements robust lifecycle event listeners, connection health diagnostics,
 * and resilient reconnection handling.
 *
 * Invariant: Never logs plain-text connection strings, database credentials,
 * or cluster authentication secrets.
 */

const mongoose = require("mongoose");

let isListenersRegistered = false;

/**
 * Registers lifecycle listeners on mongoose.connection once
 */
function registerConnectionListeners() {
    if (isListenersRegistered) return;
    isListenersRegistered = true;

    mongoose.connection.on("connected", () => {
        const dbName = mongoose.connection.name || "default";
        console.log(`[MongoDB] Connected successfully to database: '${dbName}'`);
    });

    mongoose.connection.on("error", (err) => {
        // Safe logging without credentials or connection strings
        console.error("[MongoDB] Connection error occurred:", err.message);
    });

    mongoose.connection.on("disconnected", () => {
        console.warn("[MongoDB] Disconnected from database. Awaiting reconnection...");
    });

    mongoose.connection.on("reconnected", () => {
        console.log("[MongoDB] Reconnected to database successfully.");
    });
}

/**
 * Connect to MongoDB with resilient timeout configurations
 *
 * @param {string} [uri] - Optional MongoDB URI (defaults to process.env.MONGODB_URI)
 * @param {Object} [options] - Additional Mongoose connection options
 * @returns {Promise<mongoose.Connection>}
 */
const connectDatabase = async (uri, options = {}) => {
    // If already connected or connecting, return active connection
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    registerConnectionListeners();

    const targetUri = uri || process.env.MONGODB_URI;

    if (!targetUri) {
        const err = new Error("MONGODB_URI environment variable is not defined");
        console.error("[MongoDB] Connection failure:", err.message);
        if (process.env.NODE_ENV !== "test") {
            process.exit(1);
        }
        throw err;
    }

    const connectionOptions = {
        serverSelectionTimeoutMS: 5000, // Fail fast if MongoDB is unreachable
        socketTimeoutMS: 45000,
        ...options
    };

    try {
        await mongoose.connect(targetUri, connectionOptions);
        return mongoose.connection;
    } catch (error) {
        console.error("[MongoDB] Initial connection failed:", error.message);
        if (process.env.NODE_ENV !== "test") {
            process.exit(1);
        }
        throw error;
    }
};

/**
 * Inspects whether the database is currently connected and operational
 *
 * @returns {boolean} True if readyState === 1 (connected)
 */
function isDatabaseConnected() {
    return mongoose.connection && mongoose.connection.readyState === 1;
}

/**
 * Returns human-readable state of MongoDB connection
 *
 * @returns {"disconnected"|"connected"|"connecting"|"disconnecting"|"uninitialized"}
 */
function getConnectionState() {
    if (!mongoose.connection) return { state: "uninitialized", numericState: -1 };
    const states = {
        0: "disconnected",
        1: "connected",
        2: "connecting",
        3: "disconnecting"
    };
    const readyState = mongoose.connection.readyState;
    return {
        state: states[readyState] || "unknown",
        numericState: readyState
    };
}

module.exports = connectDatabase;
module.exports.isDatabaseConnected = isDatabaseConnected;
module.exports.getConnectionState = getConnectionState;
module.exports.connectDatabase = connectDatabase;