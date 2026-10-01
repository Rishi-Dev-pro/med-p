const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");

const iotRoutes = require("./routes/iotRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const patientRoutes = require("./routes/patientRoutes");
const doctorRoutes = require("./routes/doctorRoutes");
const apiRoutes = require("./routes/apiRoutes");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ==========================================
// EJS CONFIGURATION
// ==========================================

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ==========================================
// STATIC FILES
// ==========================================

app.use(express.static(path.join(__dirname, "public")));

// ==========================================
// HOME & AUTH VIEWS
// ==========================================

app.get("/", (req, res) => {
    res.json({
        message: "IoT Health Monitoring Backend is running!"
    });
});

app.get("/login", (req, res) => {
    res.render("auth/login");
});

app.get("/register", (req, res) => {
    res.render("auth/register");
});

// ==========================================
// ROUTES
// ==========================================

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/admin", adminRoutes);
app.use("/api/iot", iotRoutes);
app.use("/api", apiRoutes);

// Dedicated Multi-Page Dashboard Routes (Phase 9)
app.use("/patient", patientRoutes);
app.use("/doctor", doctorRoutes);

// Legacy dashboard & API routes (Phase 3-8 compatibility)
app.use("/", dashboardRoutes);

module.exports = app;