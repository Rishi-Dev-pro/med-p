/**
 * HEALTH TRACKER — HEADLESS MULTI-DEVICE IoT TELEMETRY SIMULATOR
 * Automated continuous telemetry generator for real HTTP ingestion pipeline.
 *
 * Usage:
 *   node tests/iotSimulator.js --devices DEV-001,DEV-002 --interval 2000
 *
 * CLI Options:
 *   --devices   Comma-separated list of device IDs (default: DEV-001,DEV-002)
 *   --interval  Milliseconds between telemetry transmission cycles (default: 2000)
 *   --url       Target ingestion URL (default: http://localhost:5000/api/iot/data)
 *   --count     Maximum transmission cycles before exiting (default: Infinity)
 *   --help, -h  Display this usage message
 *
 * DISCLAIMER:
 * Generated telemetry values are purely synthetic numbers designed for pipeline
 * and throughput testing. They do NOT represent real clinical or diagnostic measurements.
 */

const http = require("http");

// Parse Command Line Arguments
function parseArgs(argv = process.argv.slice(2)) {
    const args = {
        devices: ["DEV-001", "DEV-002"],
        interval: 2000,
        url: process.env.IOT_INGESTION_URL || "http://localhost:5000/api/iot/data",
        count: Infinity
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === "--help" || arg === "-h") {
            console.log(`
Health Tracker IoT Telemetry Simulator
Usage: node tests/iotSimulator.js [options]

Options:
  --devices   Comma-separated device identifiers (e.g. --devices DEV-001,DEV-002)
  --interval  Milliseconds between transmission cycles (default: 2000)
  --url       Ingestion endpoint (default: http://localhost:5000/api/iot/data)
  --count     Number of cycles to run before auto-stopping (default: Infinity)
  --help, -h  Show this help screen
`);
            process.exit(0);
        }

        if (arg === "--devices" && argv[i + 1]) {
            args.devices = argv[i + 1].split(",").map((d) => d.trim()).filter(Boolean);
            i++;
        } else if (arg.startsWith("--devices=")) {
            args.devices = arg.split("=")[1].split(",").map((d) => d.trim()).filter(Boolean);
        } else if (arg === "--interval" && argv[i + 1]) {
            const parsed = parseInt(argv[i + 1], 10);
            if (!Number.isNaN(parsed) && parsed > 0) args.interval = parsed;
            i++;
        } else if (arg.startsWith("--interval=")) {
            const parsed = parseInt(arg.split("=")[1], 10);
            if (!Number.isNaN(parsed) && parsed > 0) args.interval = parsed;
        } else if (arg === "--url" && argv[i + 1]) {
            args.url = argv[i + 1].trim();
            i++;
        } else if (arg.startsWith("--url=")) {
            args.url = arg.split("=")[1].trim();
        } else if (arg === "--count" && argv[i + 1]) {
            const parsed = parseInt(argv[i + 1], 10);
            if (!Number.isNaN(parsed) && parsed > 0) args.count = parsed;
            i++;
        } else if (arg.startsWith("--count=")) {
            const parsed = parseInt(arg.split("=")[1], 10);
            if (!Number.isNaN(parsed) && parsed > 0) args.count = parsed;
        }
    }

    return args;
}

// Stateful Device Generator (smooth random walk within safe bounds)
const deviceState = new Map();

function generateTelemetryPayload(deviceId) {
    if (!deviceState.has(deviceId)) {
        // Initialize base states per device
        deviceState.set(deviceId, {
            value1: 70 + Math.random() * 15, // Baseline ~70-85
            value2: 96 + Math.random() * 3   // Baseline ~96-99
        });
    }

    const state = deviceState.get(deviceId);

    // Smooth random walk: delta ±1.5 for val1, ±0.5 for val2
    const delta1 = (Math.random() - 0.48) * 3;
    const delta2 = (Math.random() - 0.49) * 1;

    state.value1 = Math.min(105, Math.max(55, state.value1 + delta1));
    state.value2 = Math.min(100, Math.max(92, state.value2 + delta2));

    return {
        deviceId,
        value1: Math.round(state.value1 * 10) / 10,
        value2: Math.round(state.value2 * 10) / 10,
        timestamp: new Date().toISOString()
    };
}

// Single Device Ingestion Transmitter
async function transmitTelemetry(url, payload) {
    const jsonBody = JSON.stringify(payload);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: jsonBody,
            signal: AbortSignal.timeout(4000)
        });

        let responseBody = {};
        try {
            responseBody = await response.json();
        } catch (_) {
            // Non-JSON response
        }

        if (response.ok) {
            console.log(`[${payload.deviceId}] SENT → ${response.status} (v1: ${payload.value1}, v2: ${payload.value2})`);
            return { success: true, status: response.status };
        } else {
            const msg = responseBody.message || response.statusText || "Request failed";
            console.log(`[${payload.deviceId}] ERROR → ${response.status} (${msg})`);
            return { success: false, status: response.status, error: msg };
        }
    } catch (err) {
        let errMessage = err.message;
        if (err.cause && err.cause.code === "ECONNREFUSED") {
            errMessage = "Connection Refused (backend server unavailable)";
        } else if (err.name === "TimeoutError") {
            errMessage = "Request Timeout (server took > 4000ms)";
        }
        console.log(`[${payload.deviceId}] ERROR → ${errMessage}`);
        return { success: false, status: 0, error: errMessage };
    }
}

// Multi-Device Simulation Engine
function startSimulator(options = {}) {
    const config = Object.assign(parseArgs([]), options);
    let cycleCount = 0;
    let totalSent = 0;
    let totalSuccess = 0;
    let totalFailed = 0;
    let isRunning = true;
    let timer = null;

    console.log("=================================================");
    console.log("HEALTH TRACKER — IoT TELEMETRY SIMULATOR");
    console.log("=================================================");
    console.log(`Target Endpoint : ${config.url}`);
    console.log(`Active Devices  : ${config.devices.join(", ")}`);
    console.log(`Cycle Interval  : ${config.interval} ms`);
    console.log(`Cycle Limit     : ${config.count === Infinity ? "Continuous (Ctrl+C to stop)" : config.count}`);
    console.log("-------------------------------------------------");
    console.log("NOTICE: Values are synthetic and for testing only.");
    console.log("-------------------------------------------------\n");

    async function runCycle() {
        if (!isRunning) return;
        cycleCount++;

        const promises = config.devices.map(async (deviceId) => {
            const payload = generateTelemetryPayload(deviceId);
            totalSent++;
            const res = await transmitTelemetry(config.url, payload);
            if (res.success) {
                totalSuccess++;
            } else {
                totalFailed++;
            }
        });

        await Promise.all(promises);

        if (cycleCount >= config.count) {
            shutdown("Cycle limit reached");
        } else if (isRunning) {
            timer = setTimeout(runCycle, config.interval);
        }
    }

    function shutdown(reason = "SIGINT received") {
        if (!isRunning) return;
        isRunning = false;
        if (timer) clearTimeout(timer);

        console.log("\n-------------------------------------------------");
        console.log(`Simulator shutting down cleanly (${reason})...`);
        console.log(`Total Cycles : ${cycleCount}`);
        console.log(`Total Sent   : ${totalSent}`);
        console.log(`Successful   : ${totalSuccess}`);
        console.log(`Failed       : ${totalFailed}`);
        console.log("=================================================");

        if (options.onStop) {
            options.onStop({ cycleCount, totalSent, totalSuccess, totalFailed });
        }
    }

    // Run first cycle immediately
    runCycle();

    return {
        stop: shutdown
    };
}

// Direct Execution Entrypoint
if (require.main === module) {
    const cliConfig = parseArgs(process.argv.slice(2));

    const sim = startSimulator(cliConfig);

    process.on("SIGINT", () => {
        sim.stop("Ctrl+C / SIGINT");
        process.exit(0);
    });

    process.on("SIGTERM", () => {
        sim.stop("SIGTERM");
        process.exit(0);
    });
}

module.exports = {
    parseArgs,
    generateTelemetryPayload,
    transmitTelemetry,
    startSimulator
};
