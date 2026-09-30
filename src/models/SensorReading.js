const mongoose = require("mongoose");

const sensorReadingSchema = new mongoose.Schema(
    {
        deviceId: {
            type: String,
            required: [true, "deviceId is required"],
            trim: true,
            index: true
        },
        patientId: {
            type: String,
            required: [true, "patientId is required"],
            trim: true,
            index: true
        },
        doctorId: {
            type: String,
            default: null,
            trim: true,
            index: true
        },
        value1: {
            type: Number,
            required: [true, "value1 is required"]
        },
        value2: {
            type: Number,
            required: [true, "value2 is required"]
        },
        timestamp: {
            type: Date,
            required: [true, "timestamp is required"],
            index: true
        }
    },
    {
        timestamps: { createdAt: true, updatedAt: false } // Telemetry readings are append-only/immutable
    }
);

// Compound indexes required by Master Roadmap for performant paginated history and inspection
sensorReadingSchema.index({ patientId: 1, timestamp: -1 });
sensorReadingSchema.index({ deviceId: 1, timestamp: -1 });
sensorReadingSchema.index({ doctorId: 1, timestamp: -1 });

module.exports = mongoose.model("SensorReading", sensorReadingSchema);