/**
 * Centralized Express Error Handling Middleware
 * Health Tracker — Phase 14: Error Handling, Edge Cases & System Robustness
 *
 * Catches all synchronous and asynchronous route errors:
 *  - Malformed JSON payloads (SyntaxError)
 *  - Mongoose validation errors
 *  - Mongoose CastError (invalid ObjectIds)
 *  - MongoDB duplicate key errors (code 11000)
 *  - Explicit application-level errors (AppError)
 *  - Unhandled 500 internal server errors
 *
 * Invariant: Never leaks stack traces, file paths, database connection strings,
 * credentials, JWTs, or environment secrets to clients in production.
 */

const { isApiRequest } = require("./authMiddleware");

/**
 * Custom Application Error class for controlled operational errors
 */
class AppError extends Error {
    constructor(message, statusCode = 500, errors = null) {
        super(message);
        this.name = "AppError";
        this.statusCode = statusCode;
        this.status = statusCode;
        this.isOperational = true;
        if (errors) {
            this.errors = errors;
        }
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Central Express Error Handler (4 arguments required for Express to recognize as error middleware)
 */
const errorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
    let statusCode = err.statusCode || err.status || 500;
    let message = err.message || "Internal server error";
    let errors = err.errors || undefined;

    // 1. Malformed JSON parsing error from express.json()
    if (err instanceof SyntaxError && (err.status === 400 || err.statusCode === 400) && "body" in err) {
        statusCode = 400;
        message = "Invalid JSON payload";
        errors = undefined;
    }

    // 2. Mongoose Schema Validation Error
    else if (err.name === "ValidationError") {
        statusCode = 400;
        message = "Validation failed";
        errors = {};
        if (err.errors) {
            for (const [field, fieldErr] of Object.entries(err.errors)) {
                errors[field] = fieldErr.message;
            }
        }
    }

    // 3. Mongoose CastError (e.g. invalid MongoDB ObjectId or primitive casting failure)
    else if (err.name === "CastError") {
        statusCode = 400;
        message = "Invalid resource identifier";
        errors = undefined;
    }

    // 4. MongoDB Duplicate Key Error (Code 11000)
    else if (err.code === 11000) {
        statusCode = 409;
        message = "Duplicate resource conflict";
        errors = undefined;
    }

    // 5. JSON Web Token Verification Errors
    else if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
        statusCode = 401;
        message = err.name === "TokenExpiredError" ? "Authentication token has expired" : "Invalid authentication token";
        errors = undefined;
    }

    // 6. Production Safety Filter for Unhandled Server Errors (500)
    const isProduction = process.env.NODE_ENV === "production";
    if (statusCode >= 500 && isProduction) {
        // Strip internal stack and error details in production to prevent information disclosure
        message = "Internal server error";
        errors = undefined;
    }

    // Log the error securely on server console (without leaking secrets)
    if (statusCode >= 500) {
        console.error(`[ErrorHandler] ${req.method} ${req.originalUrl} (${statusCode}):`, err.message);
    } else {
        console.warn(`[ErrorHandler] ${req.method} ${req.originalUrl} (${statusCode}):`, message);
    }

    // 7. Structured JSON response for API and AJAX requests
    if (isApiRequest(req)) {
        const responsePayload = {
            success: false,
            message
        };

        if (errors && Object.keys(errors).length > 0) {
            responsePayload.errors = errors;
        }

        // Include debug stack trace only if explicitly in development and non-operational
        if (!isProduction && process.env.NODE_ENV === "development" && statusCode >= 500) {
            responsePayload.stack = err.stack;
        }

        return res.status(statusCode).json(responsePayload);
    }

    // 8. User-friendly HTML response for browser page navigation
    res.status(statusCode);
    try {
        return res.render("error", {
            statusCode,
            message,
            user: req.user || null
        });
    } catch (renderErr) {
        // Fallback if error.ejs view is missing or template rendering fails
        return res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Error ${statusCode} — HealthTrack</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0B0F17; color: #F8FAFC; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
                    .card { background: #161F2E; border: 1px solid rgba(255,255,255,0.08); padding: 32px; border-radius: 12px; max-width: 480px; text-align: center; }
                    h1 { color: #E05A47; margin: 0 0 12px; font-size: 28px; }
                    p { color: #94A3B8; margin-bottom: 24px; font-size: 15px; }
                    a { display: inline-block; background: #E05A47; color: #FFF; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>${statusCode} Error</h1>
                    <p>${message}</p>
                    <a href="/">Return to Dashboard</a>
                </div>
            </body>
            </html>
        `);
    }
};

module.exports = {
    errorHandler,
    AppError
};
