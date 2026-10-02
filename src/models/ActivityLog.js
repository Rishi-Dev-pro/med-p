const mongoose = require("mongoose");
const { AUDIT_ACTIONS, ACTOR_ROLES, TARGET_TYPES } = require("../config/constants");

const activityLogSchema = new mongoose.Schema(
    {
        action: {
            type: String,
            required: [true, "action is required"],
            enum: {
                values: Object.values(AUDIT_ACTIONS),
                message: "Action `{VALUE}` is not a recognized audit action"
            }
        },
        actorRole: {
            type: String,
            required: [true, "actorRole is required"],
            enum: {
                values: Object.values(ACTOR_ROLES),
                message: "Actor role `{VALUE}` is not supported"
            }
        },
        actorId: {
            type: String,
            default: null,
            trim: true
        },
        targetType: {
            type: String,
            required: [true, "targetType is required"],
            enum: {
                values: Object.values(TARGET_TYPES),
                message: "Target type `{VALUE}` is not supported"
            }
        },
        targetId: {
            type: String,
            default: null,
            trim: true
        },
        details: {
            type: mongoose.Schema.Types.Mixed,
            default: () => ({})
        },
        timestamp: {
            type: Date,
            required: true,
            default: Date.now
        }
    },
    {
        timestamps: false // Activity log is strictly append-only with explicit timestamp
    }
);

// Indexes required for fast chronological querying by actor, target entity, and timestamp stream
activityLogSchema.index({ timestamp: -1 });
activityLogSchema.index({ actorId: 1 });
activityLogSchema.index({ actorId: 1, timestamp: -1 });
activityLogSchema.index({ targetId: 1, timestamp: -1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema);
