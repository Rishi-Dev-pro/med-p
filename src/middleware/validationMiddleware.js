/**
 * Centralized Request Validation Middleware & Schemas
 * Health Tracker — Phase 14: Error Handling, Edge Cases & System Robustness
 *
 * Provides schema validation before request payloads reach controller business logic.
 * Standardizes validation failure responses to HTTP 400 with safe field-level errors.
 *
 * Invariant: Never leaks passwords, password hashes, tokens, cookies, or secrets
 * in validation error messages or response payloads.
 */

const { DEVICE_STATUS, ROLES, AUDIT_ACTIONS } = require("../config/constants");

/**
 * Validates an email address format
 */
function isValidEmail(email) {
    if (typeof email !== "string") return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email.trim().toLowerCase());
}

/**
 * Validates that a value is a finite number
 */
function isFiniteNumber(val) {
    return typeof val === "number" && Number.isFinite(val);
}

/**
 * Validates that a value parses into a valid Date
 */
function isValidDate(val) {
    if (val === null || val === undefined || val === "") return false;
    const d = new Date(val);
    return !Number.isNaN(d.getTime());
}

/**
 * Predefined Validation Schemas for Core System Boundaries
 */
const schemas = {
    // 1. IoT Ingestion Payload
    iotData: {
        deviceId: {
            required: true,
            type: "string",
            minLength: 1,
            maxLength: 50,
            message: "deviceId must be a non-empty string with maximum 50 characters"
        },
        value1: {
            required: true,
            validator: isFiniteNumber,
            message: "value1 must be a valid finite number"
        },
        value2: {
            required: true,
            validator: isFiniteNumber,
            message: "value2 must be a valid finite number"
        },
        timestamp: {
            required: true,
            validator: isValidDate,
            message: "timestamp must be a valid date or timestamp"
        }
    },

    // 2. Patient Registration Payload
    register: {
        name: {
            required: true,
            type: "string",
            minLength: 1,
            maxLength: 100,
            message: "Full name is required (max 100 characters)"
        },
        email: {
            required: true,
            validator: isValidEmail,
            message: "Please provide a valid email address"
        },
        password: {
            required: true,
            type: "string",
            minLength: 6,
            message: "Password must be at least 6 characters long"
        },
        confirmPassword: {
            required: true,
            type: "string",
            custom: (val, body) => val === body.password,
            message: "Passwords do not match"
        },
        deviceId: {
            required: true,
            type: "string",
            minLength: 1,
            maxLength: 50,
            message: "Hardware device ID is required"
        },
        age: {
            required: false,
            validator: (v) => v === undefined || v === null || (isFiniteNumber(v) && v >= 0 && v <= 130),
            message: "Age must be a valid number between 0 and 130"
        }
    },

    // 3. User Login Payload
    login: {
        identifier: {
            required: true,
            type: "string",
            minLength: 1,
            message: "Email, username, or name is required"
        },
        password: {
            required: true,
            type: "string",
            minLength: 1,
            message: "Password is required"
        }
    },

    // 4. Hardware Device Creation
    createDevice: {
        deviceId: {
            required: true,
            type: "string",
            minLength: 1,
            maxLength: 50,
            message: "Valid deviceId is required (1-50 characters)"
        },
        type: {
            required: false,
            type: "string",
            maxLength: 50,
            message: "Device type must be a string up to 50 characters"
        },
        status: {
            required: false,
            type: "string",
            validator: (v) => !v || Object.values(DEVICE_STATUS).includes(v.toUpperCase()),
            message: "Status must be ACTIVE or INACTIVE"
        }
    },

    // 5. Patient-Doctor Assignment
    assignment: {
        patientId: {
            required: true,
            type: "string",
            minLength: 1,
            maxLength: 50,
            message: "patientId is required"
        },
        doctorId: {
            required: true,
            type: "string",
            minLength: 1,
            maxLength: 50,
            message: "doctorId is required"
        }
    },

    // 6. Device ID Param Validation
    deviceIdParam: {
        deviceId: {
            required: true,
            type: "string",
            minLength: 1,
            maxLength: 50,
            message: "Valid deviceId parameter is required"
        }
    },

    // 7. Patient ID Param Validation
    patientIdParam: {
        patientId: {
            required: true,
            type: "string",
            minLength: 1,
            maxLength: 50,
            message: "Valid patientId parameter is required"
        }
    },

    // 8. Reading History Query Params
    readingQuery: {
        page: {
            required: false,
            validator: (v) => v === undefined || (!isNaN(parseInt(v, 10)) && parseInt(v, 10) >= 1),
            message: "page must be a positive integer"
        },
        limit: {
            required: false,
            validator: (v) => v === undefined || (!isNaN(parseInt(v, 10)) && parseInt(v, 10) >= 1),
            message: "limit must be a positive integer"
        },
        startDate: {
            required: false,
            validator: (v) => v === undefined || isValidDate(v),
            message: "startDate must be a valid date"
        },
        endDate: {
            required: false,
            validator: (v) => v === undefined || isValidDate(v),
            message: "endDate must be a valid date"
        }
    },

    // 9. Admin Activity Query Params
    activityQuery: {
        page: {
            required: false,
            validator: (v) => v === undefined || (!isNaN(parseInt(v, 10)) && parseInt(v, 10) >= 1),
            message: "page must be a positive integer"
        },
        limit: {
            required: false,
            validator: (v) => v === undefined || (!isNaN(parseInt(v, 10)) && parseInt(v, 10) >= 1),
            message: "limit must be a positive integer"
        },
        startDate: {
            required: false,
            validator: (v) => v === undefined || isValidDate(v),
            message: "startDate must be a valid date"
        },
        endDate: {
            required: false,
            validator: (v) => v === undefined || isValidDate(v),
            message: "endDate must be a valid date"
        }
    }
};

/**
 * Validates a target object against a schema definition
 *
 * @param {Object} schema - Schema definition
 * @param {Object} data - Input data object (req.body, req.query, or req.params)
 * @returns {{ isValid: boolean, errors: Object }}
 */
function validateSchema(schema, data = {}) {
    const errors = {};

    for (const [field, rule] of Object.entries(schema)) {
        const val = data[field];

        // 1. Required Check
        if (rule.required) {
            if (val === undefined || val === null) {
                errors[field] = rule.message || `${field} is required`;
                continue;
            }
            if (rule.type === "string" && (typeof val !== "string" || val.trim() === "")) {
                errors[field] = rule.message || `${field} must be a non-empty string`;
                continue;
            }
        } else {
            // Optional field: skip further checks if omitted
            if (val === undefined || val === null || val === "") {
                continue;
            }
        }

        // 2. Type Check
        if (rule.type && typeof val !== rule.type) {
            errors[field] = rule.message || `${field} must be of type ${rule.type}`;
            continue;
        }

        // 3. String Length Constraints
        if (typeof val === "string") {
            const trimmed = val.trim();
            if (rule.minLength && trimmed.length < rule.minLength) {
                errors[field] = rule.message || `${field} must be at least ${rule.minLength} characters`;
                continue;
            }
            if (rule.maxLength && trimmed.length > rule.maxLength) {
                errors[field] = rule.message || `${field} cannot exceed ${rule.maxLength} characters`;
                continue;
            }
        }

        // 4. Custom Validator
        if (typeof rule.validator === "function") {
            if (!rule.validator(val, data)) {
                errors[field] = rule.message || `${field} is invalid`;
                continue;
            }
        }

        // 5. Custom Cross-Field Validator
        if (typeof rule.custom === "function") {
            if (!rule.custom(val, data)) {
                errors[field] = rule.message || `${field} is invalid`;
                continue;
            }
        }
    }

    return {
        isValid: Object.keys(errors).length === 0,
        errors
    };
}

/**
 * Creates an Express middleware that validates req[source] against the given schema.
 *
 * @param {Object|string} schemaOrName - Schema definition object or name from predefined schemas
 * @param {"body"|"query"|"params"} source - Property of req to validate (default: "body")
 * @returns {Function} Express middleware
 */
function validate(schemaOrName, source = "body") {
    const schema = typeof schemaOrName === "string" ? schemas[schemaOrName] : schemaOrName;

    if (!schema) {
        throw new Error(`Validation schema '${schemaOrName}' not found`);
    }

    return (req, res, next) => {
        const data = req[source] || {};
        const { isValid, errors } = validateSchema(schema, data);

        if (!isValid) {
            // Pick first error message for user-friendly summary if appropriate
            const firstErrorMessage = Object.values(errors)[0] || "Validation failed";

            return res.status(400).json({
                success: false,
                message: firstErrorMessage,
                errors
            });
        }

        next();
    };
}

const validateBody = (schemaOrName) => validate(schemaOrName, "body");
const validateQuery = (schemaOrName) => validate(schemaOrName, "query");
const validateParams = (schemaOrName) => validate(schemaOrName, "params");

module.exports = {
    schemas,
    validate,
    validateBody,
    validateQuery,
    validateParams,
    validateSchema
};
