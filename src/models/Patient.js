const mongoose = require("mongoose");

const patientSchema = new mongoose.Schema(
    {
        patientId: {
            type: String,
            required: [true, "patientId is required"],
            unique: true,
            trim: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "userId reference to User is required"],
            unique: true
        },
        name: {
            type: String,
            required: [true, "Patient name is required"],
            trim: true
        },
        email: {
            type: String,
            required: [true, "Patient email is required"],
            unique: true,
            trim: true,
            lowercase: true
        },
        age: {
            type: Number,
            required: [true, "Patient age is required"],
            min: [0, "Age cannot be negative"]
        },
        doctorId: {
            type: String,
            default: null,
            trim: true
        },
        deviceId: {
            type: String,
            default: null,
            trim: true
        },
        registeredAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        timestamps: true
    }
);

// Standard index for filtering patients by assigned doctor (allows null)
patientSchema.index({ doctorId: 1 });

// Sparse unique index: Enforces at most 1 patient assigned per device; unassigned patients have deviceId = null
patientSchema.index({ deviceId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Patient", patientSchema);