const mongoose = require("mongoose");
const { ROLES, ACCOUNT_STATUS } = require("../config/constants");

const userSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: [true, "username is required"],
            unique: true,
            trim: true
        },
        email: {
            type: String,
            required: [true, "email is required"],
            unique: true,
            trim: true,
            lowercase: true
        },
        passwordHash: {
            type: String,
            required: [true, "passwordHash is required"]
        },
        role: {
            type: String,
            required: [true, "role is required"],
            enum: {
                values: Object.values(ROLES),
                message: "Role `{VALUE}` is not supported"
            }
        },
        profileId: {
            type: String,
            default: null,
            trim: true
        },
        status: {
            type: String,
            required: [true, "status is required"],
            enum: {
                values: Object.values(ACCOUNT_STATUS),
                message: "Account status `{VALUE}` is not supported"
            },
            default: ACCOUNT_STATUS.ACTIVE
        }
    },
    {
        timestamps: true
    }
);

// Unique partial index on profileId: multiple SUPER_ADMIN users can have profileId: null,
// while doctorId / patientId must be globally unique across users.
userSchema.index(
    { profileId: 1 },
    {
        unique: true,
        partialFilterExpression: { profileId: { $type: "string" } }
    }
);

// Method to verify candidate password against stored hash
userSchema.methods.comparePassword = async function (candidatePassword) {
    if (!this.passwordHash) return false;
    const bcrypt = require("bcryptjs");
    return bcrypt.compare(candidatePassword, this.passwordHash);
};

module.exports = mongoose.model("User", userSchema);
