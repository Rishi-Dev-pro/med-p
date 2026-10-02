require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");

const app = require("./app");
const connectDatabase = require("./config/database");
const { verifyToken } = require("./utils/authUtils");
const User = require("./models/User");
const Patient = require("./models/Patient");
const { ACCOUNT_STATUS, ROLES } = require("./config/constants");

const PORT = process.env.PORT || 5000;

const { setActivityLoggerIO } = require("./utils/activityLogger");

/**
 * Configure Socket.IO authentication and room authorization
 * @param {Server} io 
 */
function setupSocketIO(io) {
    if (io) {
        setActivityLoggerIO(io);
    }
    // 1. Socket.IO Handshake Authentication Middleware
    io.use(async (socket, next) => {
        try {
            let token = null;

            // Priority 1: Handshake auth payload (used by socket.io-client auth: { token })
            if (socket.handshake.auth && socket.handshake.auth.token) {
                token = socket.handshake.auth.token;
            }

            // Priority 2: HTTP-only cookies in handshake headers
            if (!token && socket.handshake.headers && socket.handshake.headers.cookie) {
                const cookieHeader = socket.handshake.headers.cookie;
                const match = cookieHeader.match(/(?:^|;\s*)(?:token|jwt)=([^;]+)/);
                if (match) {
                    token = decodeURIComponent(match[1]);
                }
            }

            // Priority 3: Authorization: Bearer <token> in handshake headers
            if (!token && socket.handshake.headers && socket.handshake.headers.authorization) {
                const parts = socket.handshake.headers.authorization.split(" ");
                if (parts.length === 2 && parts[0] === "Bearer") {
                    token = parts[1];
                }
            }

            if (!token) {
                const err = new Error("Authentication required");
                err.data = { status: 401, code: "AUTH_REQUIRED" };
                return next(err);
            }

            // Cryptographic JWT verification
            let decoded;
            try {
                decoded = verifyToken(token);
            } catch (jwtErr) {
                const err = new Error("Invalid or expired authentication token");
                err.data = { status: 401, code: "INVALID_TOKEN" };
                return next(err);
            }

            // Database user verification and status check
            const user = await User.findById(decoded.userId).select("-passwordHash");
            if (!user) {
                const err = new Error("User account no longer exists");
                err.data = { status: 401, code: "USER_NOT_FOUND" };
                return next(err);
            }

            if (user.status !== ACCOUNT_STATUS.ACTIVE) {
                const err = new Error("Account is suspended. Authentication rejected.");
                err.data = { status: 403, code: "ACCOUNT_SUSPENDED" };
                return next(err);
            }

            // Attach verified identity to socket
            socket.user = {
                userId: user._id.toString(),
                username: user.username,
                email: user.email,
                role: user.role,
                profileId: user.profileId,
                status: user.status
            };

            next();
        } catch (error) {
            console.error("Socket authentication error:", error.message);
            const err = new Error("Internal authentication error");
            err.data = { status: 500 };
            next(err);
        }
    });

    // 2. Connection and Room Authorization
    io.on("connection", (socket) => {
        const { user } = socket;
        console.log(`Socket connected: ${socket.id} (User: ${user.username}, Role: ${user.role}, Profile: ${user.profileId})`);

        // Automatically join authorized default room based on verified identity
        if (user.role === ROLES.PATIENT && user.profileId) {
            const patientRoom = `patient:${user.profileId}`;
            socket.join(patientRoom);
            console.log(`Socket ${socket.id} joined room: ${patientRoom}`);
        } else if (user.role === ROLES.DOCTOR && user.profileId) {
            const doctorRoom = `doctor:${user.profileId}`;
            socket.join(doctorRoom);
            console.log(`Socket ${socket.id} joined room: ${doctorRoom}`);
        } else if (user.role === ROLES.SUPER_ADMIN) {
            socket.join("admin:telemetry");
            socket.join("admin:activity");
            console.log(`Socket ${socket.id} joined rooms: admin:telemetry, admin:activity`);
        }

        // Room joining listener - strictly enforces authorization and ignores spoofed client payloads
        socket.on("join-room", async (payload, callback) => {
            const cb = typeof callback === "function" ? callback : () => {};

            if (!payload || typeof payload !== "object") {
                cb({ success: false, message: "Invalid payload" });
                return;
            }

            const requestedTarget = payload.userId || payload.patientId || payload.doctorId || payload.room;

            // Case A: PATIENT - Can only join their own room
            if (user.role === ROLES.PATIENT) {
                if (requestedTarget && requestedTarget !== user.profileId) {
                    socket.emit("room-error", { message: "Forbidden: Cannot join another patient's room" });
                    cb({ success: false, message: "Forbidden: Cannot join another patient's room" });
                    return;
                }

                const roomName = `patient:${user.profileId}`;
                socket.join(roomName);
                cb({ success: true, room: roomName });
                return;
            }

            // Case B: DOCTOR - Can join their own room or rooms of assigned patients
            if (user.role === ROLES.DOCTOR) {
                if (!requestedTarget || requestedTarget === user.profileId) {
                    const roomName = `doctor:${user.profileId}`;
                    socket.join(roomName);
                    cb({ success: true, room: roomName });
                    return;
                }

                // If doctor requests a specific patient room, verify assignment in database
                try {
                    const patient = await Patient.findOne({ patientId: requestedTarget });
                    if (!patient || patient.doctorId !== user.profileId) {
                        socket.emit("room-error", { message: "Forbidden: Patient is not assigned to your clinical care" });
                        cb({ success: false, message: "Forbidden: Patient is not assigned to your clinical care" });
                        return;
                    }

                    const patientRoom = `patient:${patient.patientId}`;
                    socket.join(patientRoom);
                    cb({ success: true, room: patientRoom });
                    return;
                } catch (dbErr) {
                    cb({ success: false, message: "Error verifying patient assignment" });
                    return;
                }
            }

            // Case C: SUPER_ADMIN
            if (user.role === ROLES.SUPER_ADMIN) {
                const roomName = requestedTarget ? `admin:${requestedTarget}` : "admin:telemetry";
                socket.join(roomName);
                cb({ success: true, room: roomName });
                return;
            }

            socket.emit("room-error", { message: "Forbidden: Insufficient permissions" });
            cb({ success: false, message: "Forbidden" });
        });

        socket.on("disconnect", () => {
            console.log(`Socket disconnected: ${socket.id}`);
        });
    });
}

/**
 * Start HTTP & Socket.IO server
 */
const startServer = async () => {
    await connectDatabase();

    // Create HTTP server
    const httpServer = http.createServer(app);

    // Create Socket.IO server
    const io = new Server(httpServer, {
        cors: {
            origin: process.env.CORS_ORIGIN || "*",
            credentials: true
        }
    });

    // Set up Socket.IO authentication and handlers
    setupSocketIO(io);

    // Make Socket.IO accessible inside routes
    app.set("io", io);

    httpServer.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
        console.log("Socket.IO server is ready");
    });

    return { httpServer, io };
};

if (require.main === module) {
    startServer();
}

module.exports = {
    startServer,
    setupSocketIO
};