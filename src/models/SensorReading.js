const mongoose = require("mongoose");

const sensorReadingSchema = new mongoose.Schema(
    {
        deviceId: {
            type: String,
            required: true,
            trim: true
        },

        patientId: {
            type: String,
            required: true,
            trim: true
        },

        doctorId: {
            type: String,
            required: true,
            trim: true
        },

        value1: {
            type: Number,
            required: true
        },

        value2: {
            type: Number,
            required: true
        },

        timestamp: {
            type: Date,
            required: true
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("SensorReading", sensorReadingSchema);