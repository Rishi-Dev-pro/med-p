require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");

const app = require("./app");
const connectDatabase = require("./config/database");

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    await connectDatabase();

    // Create HTTP server
    const httpServer = http.createServer(app);

    // Create Socket.IO server
    const io = new Server(httpServer, {
        cors: {
            origin: "*"
        }
    });

    // Make Socket.IO accessible inside routes
    app.set("io", io);

    // Socket.IO connection
    io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on("join-room", (payload) => {
        if (!payload || typeof payload !== "object") {
            return;
        }

        const { role, userId } = payload;

        if (typeof role !== "string" || typeof userId !== "string" || !role.trim() || !userId.trim()) {
            return;
        }

        const cleanRole = role.trim();
        const cleanUserId = userId.trim();
        let roomName;

        if (cleanRole === "patient") {
            roomName = `patient:${cleanUserId}`;
        } else if (cleanRole === "doctor") {
            roomName = `doctor:${cleanUserId}`;
        } else {
            console.log("Invalid socket role:", cleanRole);
            return;
        }

        socket.join(roomName);

        console.log(
            `Socket ${socket.id} joined room: ${roomName}`
        );
    });

    socket.on("disconnect", () => {
        console.log(`Socket disconnected: ${socket.id}`);
    });
});

    httpServer.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
        console.log("Socket.IO server is ready");
    });
};

startServer();