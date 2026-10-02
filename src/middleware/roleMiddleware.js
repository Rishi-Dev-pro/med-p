/**
 * Role-Based Authorization & Ownership Middleware
 * Health Tracker — Phase 3: Role-Based Authorization & Socket Security
 */

const Patient = require("../models/Patient");
const { ROLES } = require("../config/constants");
const { isApiRequest } = require("./authMiddleware");

/**
 * Server-side RBAC middleware.
 * Verifies that the authenticated principal (req.user) possesses one of the allowed roles.
 * Never trusts client-supplied role parameters in body, query, or params.
 * @param  {...string|string[]} roles - Allowed roles (e.g. 'PATIENT', 'DOCTOR', 'SUPER_ADMIN')
 */
const requireRole = (...roles) => {
    // Flatten in case array was passed as single argument
    const allowedRoles = roles.flat();

    return (req, res, next) => {
        if (!req.user) {
            if (!isApiRequest(req)) {
                return res.redirect("/login");
            }
            return res.status(401).json({
                success: false,
                message: "Authentication required"
            });
        }

        // Strictly evaluate req.user.role derived from verified JWT
        if (!allowedRoles.includes(req.user.role)) {
            if (!isApiRequest(req)) {
                return res.status(403).render("error", {
                    statusCode: 403,
                    message: "Forbidden: Insufficient permissions to access this clinical resource.",
                    user: req.user
                });
            }
            return res.status(403).json({
                success: false,
                message: "Forbidden: Insufficient permissions"
            });
        }

        next();
    };
};

/**
 * Patient Ownership Middleware.
 * Enforces that:
 * - A PATIENT can only access their own patientId (req.user.profileId === targetPatientId).
 * - A DOCTOR can access a patient only if that patient is currently assigned to them (patient.doctorId === req.user.profileId).
 * - A SUPER_ADMIN can inspect authorized patient records.
 * @param {string} patientIdParam - Route param key containing target patientId
 */
const requirePatientOwnership = (patientIdParam = "patientId") => {
    return async (req, res, next) => {
        if (!req.user) {
            if (!isApiRequest(req)) {
                return res.redirect("/login");
            }
            return res.status(401).json({
                success: false,
                message: "Authentication required"
            });
        }

        const targetPatientId = req.params[patientIdParam];
        if (!targetPatientId) {
            if (!isApiRequest(req)) {
                return res.status(400).send("Bad request: Missing patient identifier");
            }
            return res.status(400).json({
                success: false,
                message: "Missing patient identifier in route"
            });
        }

        // Case 1: PATIENT accessing resource
        if (req.user.role === ROLES.PATIENT) {
            if (req.user.profileId !== targetPatientId) {
                if (!isApiRequest(req)) {
                    return res.status(403).render("error", {
                        statusCode: 403,
                        message: "Forbidden: You can only access your own patient records.",
                        user: req.user
                    });
                }
                return res.status(403).json({
                    success: false,
                    message: "Forbidden: You can only access your own patient records"
                });
            }
            return next();
        }

        // Case 2: DOCTOR accessing patient resource
        if (req.user.role === ROLES.DOCTOR) {
            const patient = await Patient.findOne({ patientId: targetPatientId });
            if (!patient) {
                if (!isApiRequest(req)) {
                    return res.status(404).render("error", {
                        statusCode: 404,
                        message: "Patient record not found.",
                        user: req.user
                    });
                }
                return res.status(404).json({
                    success: false,
                    message: "Patient not found"
                });
            }

            // Verify current assignment in database
            if (patient.doctorId !== req.user.profileId) {
                if (!isApiRequest(req)) {
                    return res.status(403).render("error", {
                        statusCode: 403,
                        message: "Forbidden: Patient is not assigned to your clinical care.",
                        user: req.user
                    });
                }
                return res.status(403).json({
                    success: false,
                    message: "Forbidden: Patient is not assigned to your clinical care"
                });
            }

            req.targetPatient = patient;
            return next();
        }

        // Case 3: SUPER_ADMIN accessing resource
        if (req.user.role === ROLES.SUPER_ADMIN) {
            return next();
        }

        // Unrecognized or unauthorized role
        if (!isApiRequest(req)) {
            return res.status(403).send("Forbidden: Insufficient permissions");
        }
        return res.status(403).json({
            success: false,
            message: "Forbidden: Insufficient permissions"
        });
    };
};

/**
 * Doctor Ownership Middleware.
 * Enforces that:
 * - A DOCTOR can only access their own doctor portal (req.user.profileId === targetDoctorId).
 * - A SUPER_ADMIN can inspect the doctor portal.
 * - A PATIENT is strictly denied.
 * @param {string} doctorIdParam - Route param key containing target doctorId
 */
const requireDoctorOwnership = (doctorIdParam = "doctorId") => {
    return (req, res, next) => {
        if (!req.user) {
            if (!isApiRequest(req)) {
                return res.redirect("/login");
            }
            return res.status(401).json({
                success: false,
                message: "Authentication required"
            });
        }

        const targetDoctorId = req.params[doctorIdParam];
        if (!targetDoctorId) {
            if (!isApiRequest(req)) {
                return res.status(400).send("Bad request: Missing doctor identifier");
            }
            return res.status(400).json({
                success: false,
                message: "Missing doctor identifier in route"
            });
        }

        // Case 1: DOCTOR accessing resource
        if (req.user.role === ROLES.DOCTOR) {
            if (req.user.profileId !== targetDoctorId) {
                if (!isApiRequest(req)) {
                    return res.status(403).send("Forbidden: You can only access your own doctor portal");
                }
                return res.status(403).json({
                    success: false,
                    message: "Forbidden: You can only access your own doctor portal"
                });
            }
            return next();
        }

        // Case 2: SUPER_ADMIN accessing resource
        if (req.user.role === ROLES.SUPER_ADMIN) {
            return next();
        }

        // Case 3: PATIENT or any other role
        if (!isApiRequest(req)) {
            return res.status(403).send("Forbidden: Access restricted to clinicians and administrators");
        }
        return res.status(403).json({
            success: false,
            message: "Forbidden: Access restricted to clinicians and administrators"
        });
    };
};

module.exports = {
    requireRole,
    requirePatientOwnership,
    requireDoctorOwnership
};
