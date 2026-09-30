/**
 * Super Admin Database Seeder
 * Health Tracker — Phase 2: Authentication & Identity Foundation
 */

require("dotenv").config();
const connectDatabase = require("../config/database");
const User = require("../models/User");
const ActivityLog = require("../models/ActivityLog");
const { ROLES, ACCOUNT_STATUS, AUDIT_ACTIONS, ACTOR_ROLES, TARGET_TYPES } = require("../config/constants");
const { hashPassword } = require("../utils/authUtils");

const seedAdmin = async () => {
    try {
        await connectDatabase();

        console.log("Checking for existing Super Admin account...");

        const adminEmail = process.env.ADMIN_EMAIL || "admin@healthtracker.local";
        const adminUsername = process.env.ADMIN_USERNAME || "admin";
        const adminPlaintextPassword = process.env.ADMIN_PASSWORD || "Admin@12345";

        const existingAdmin = await User.findOne({
            $or: [
                { role: ROLES.SUPER_ADMIN },
                { email: adminEmail.toLowerCase() },
                { username: adminUsername }
            ]
        });

        if (existingAdmin) {
            console.log(`Super Admin already exists (Username: ${existingAdmin.username}, Email: ${existingAdmin.email}). Skipping creation.`);
            return existingAdmin;
        }

        const passwordHash = await hashPassword(adminPlaintextPassword);

        const adminUser = await User.create({
            username: adminUsername,
            email: adminEmail.toLowerCase(),
            passwordHash,
            role: ROLES.SUPER_ADMIN,
            profileId: null, // Admin accounts have profileId: null per frozen schema
            status: ACCOUNT_STATUS.ACTIVE
        });

        console.log("Super Admin seeded successfully:");
        console.log(`- Username: ${adminUser.username}`);
        console.log(`- Email   : ${adminUser.email}`);
        console.log(`- Role    : ${adminUser.role}`);
        console.log(`- Status  : ${adminUser.status}`);
        console.log(`- ID      : ${adminUser._id}`);

        try {
            await ActivityLog.create({
                action: AUDIT_ACTIONS.SUPER_ADMIN_CREATED || "SUPER_ADMIN_CREATED",
                actorRole: ACTOR_ROLES.SYSTEM,
                actorId: "SYSTEM",
                targetType: TARGET_TYPES.USER,
                targetId: adminUser._id.toString(),
                details: { username: adminUser.username, email: adminUser.email }
            });
        } catch (auditErr) {
            // Non-critical audit notice
        }

        return adminUser;
    } catch (error) {
        console.error("Super Admin seed failed:", error);
        throw error;
    }
};

// Allow standalone CLI execution or module require
if (require.main === module) {
    seedAdmin()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = seedAdmin;
