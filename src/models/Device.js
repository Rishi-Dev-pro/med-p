const mongoose = require("mongoose");
const { DEVICE_STATUS } = require("../config/constants");

const deviceSchema = new mongoose.Schema(
    {
        deviceId: {
            type: String,
            required: [true, "deviceId is required"],
            unique: true,
            trim: true
        },
        type: {
            type: String,
            default: "VITAL_TELEMETRY",
            trim: true
        },
        status: {
            type: String,
            required: [true, "status is required"],
            enum: {
                values: Object.values(DEVICE_STATUS),
                message: "Device status `{VALUE}` is not supported"
            },
            default: DEVICE_STATUS.ACTIVE,
            set: (val) => (typeof val === "string" ? val.toUpperCase() : val)
        },
        patientId: {
            type: String,
            default: null,
            trim: true
        },
        apiKeyHash: {
            type: String,
            default: null,
            select: false
        },
        apiKeyPrefix: {
            type: String,
            default: null,
            trim: true
        },
        apiKeyCreatedAt: {
            type: Date,
            default: null
        },
        apiKeyLastUsedAt: {
            type: Date,
            default: null
        },
        apiKeyRotatedAt: {
            type: Date,
            default: null
        },
        resetCount: {
            type: Number,
            required: true,
            default: 0,
            min: [0, "resetCount cannot be negative"]
        },
        lastSeen: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true
    }
);

// Unique partial index: Enforces at most 1 device per patient; unassigned devices have patientId = null
deviceSchema.index(
    { patientId: 1 },
    {
        unique: true,
        partialFilterExpression: { patientId: { $type: "string" } }
    }
);

// Standard index for fast filtering of active/inactive devices
deviceSchema.index({ status: 1 });

module.exports = mongoose.model("Device", deviceSchema);