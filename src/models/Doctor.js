const mongoose = require("mongoose");
const { DOCTOR_STATUS } = require("../config/constants");

const doctorSchema = new mongoose.Schema(
    {
        doctorId: {
            type: String,
            required: [true, "doctorId is required"],
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
            required: [true, "Doctor name is required"],
            trim: true
        },
        email: {
            type: String,
            required: [true, "Doctor email is required"],
            unique: true,
            trim: true,
            lowercase: true
        },
        phone: {
            type: String,
            trim: true,
            default: null
        },
        specialization: {
            type: String,
            trim: true,
            default: null
        },
        status: {
            type: String,
            required: [true, "Doctor status is required"],
            enum: {
                values: Object.values(DOCTOR_STATUS),
                message: "Doctor status `{VALUE}` is not supported"
            },
            default: DOCTOR_STATUS.ACTIVE
        }
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true }
    }
);

// Virtual for backwards compatibility with legacy or alternate views using 'specialty'
doctorSchema.virtual("specialty").get(function () {
    return this.specialization || "General Medicine";
});

module.exports = mongoose.model("Doctor", doctorSchema);