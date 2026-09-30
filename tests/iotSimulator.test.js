/**
 * HEALTH TRACKER — PHASE 1: IoT SIMULATOR COMPREHENSIVE TEST SUITE
 * Validates CLI parsing, payload generation, HTTP ingestion, error handling,
 * and graceful shutdown.
 */

const assert = require("assert");
const http = require("http");
const express = require("express");

const {
    parseArgs,
    generateTelemetryPayload,
    transmitTelemetry,
    startSimulator
} = require("./iotSimulator");

console.log("=================================================");
console.log("RUNNING PHASE 1: IoT SIMULATOR TEST SUITE");
console.log("=================================================\n");

let passed = 0;
let total = 0;

async function test(name, fn) {
    total++;
    try {
        await fn();
        console.log(`[PASS] ${name}`);
        passed++;
    } catch (err) {
        console.error(`[FAIL] ${name}`);
        console.error(`       ${err.message}`);
        process.exitCode = 1;
    }
}

async function runAllTests() {
    // ---------------------------------------------------------
    // 1. CLI Argument Parsing
    // ---------------------------------------------------------
    await test("1. CLI Argument Parsing: default options", () => {
        const args = parseArgs([]);
        assert.deepStrictEqual(args.devices, ["DEV-001", "DEV-002"]);
        assert.strictEqual(args.interval, 2000);
        assert.strictEqual(args.count, Infinity);
        assert.ok(args.url.includes("/api/iot/data"));
    });

    await test("2. CLI Argument Parsing: custom --devices, --interval, --count", () => {
        const custom = parseArgs([
            "--devices", "DEV-100,DEV-101,DEV-102",
            "--interval", "1500",
            "--count", "5",
            "--url", "http://127.0.0.1:8080/ingest"
        ]);
        assert.deepStrictEqual(custom.devices, ["DEV-100", "DEV-101", "DEV-102"]);
        assert.strictEqual(custom.interval, 1500);
        assert.strictEqual(custom.count, 5);
        assert.strictEqual(custom.url, "http://127.0.0.1:8080/ingest");
    });

    // ---------------------------------------------------------
    // 2. Telemetry Payload Generation
    // ---------------------------------------------------------
    await test("3. Telemetry Payload: correct structure, numeric bounds, ISO timestamp", () => {
        const payload = generateTelemetryPayload("DEV-001");
        assert.strictEqual(payload.deviceId, "DEV-001");
        assert.strictEqual(typeof payload.value1, "number");
        assert.strictEqual(typeof payload.value2, "number");
        assert.ok(Number.isFinite(payload.value1));
        assert.ok(Number.isFinite(payload.value2));
        assert.ok(payload.value1 >= 50 && payload.value1 <= 120, "value1 within physiological simulation bounds");
        assert.ok(payload.value2 >= 90 && payload.value2 <= 100, "value2 within SpO2 simulation bounds");
        assert.ok(!Number.isNaN(new Date(payload.timestamp).getTime()), "Valid ISO timestamp string");
    });

    await test("4. Telemetry Payload: dynamic variation between readings", () => {
        const p1 = generateTelemetryPayload("DEV-VAR");
        const p2 = generateTelemetryPayload("DEV-VAR");
        const p3 = generateTelemetryPayload("DEV-VAR");
        // Check that at least one reading is not strictly identical
        const hasVariation = (p1.value1 !== p2.value1) || (p2.value1 !== p3.value1) ||
                             (p1.value2 !== p2.value2) || (p2.value2 !== p3.value2);
        assert.ok(hasVariation, "Simulated telemetry readings must vary across cycles");
    });

    // ---------------------------------------------------------
    // 3. HTTP Server Ingestion & Error Code Handling
    // ---------------------------------------------------------
    const mockApp = express();
    mockApp.use(express.json());

    // Mock endpoint replicating /api/iot/data contracts
    mockApp.post("/api/iot/data", (req, res) => {
        const { deviceId, value1, value2, timestamp } = req.body;

        if (!deviceId || value1 === undefined || value2 === undefined || !timestamp) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        if (deviceId === "DEV-INACTIVE") {
            return res.status(403).json({ success: false, message: "Device is inactive" });
        }

        if (deviceId === "DEV-UNKNOWN") {
            return res.status(404).json({ success: false, message: "Device not registered" });
        }

        return res.status(201).json({
            success: true,
            message: "Sensor reading recorded successfully",
            data: {
                deviceId,
                reading: { value1, value2, timestamp }
            }
        });
    });

    let mockServer;
    const testPort = 58991;
    const testUrl = `http://127.0.0.1:${testPort}/api/iot/data`;

    await test("5. HTTP Ingestion: successful 201 Created transmission", async () => {
        await new Promise((resolve) => {
            mockServer = mockApp.listen(testPort, "127.0.0.1", resolve);
        });

        const payload = generateTelemetryPayload("DEV-001");
        const result = await transmitTelemetry(testUrl, payload);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.status, 201);
    });

    await test("6. HTTP Ingestion: 404 response for unknown device", async () => {
        const payload = generateTelemetryPayload("DEV-UNKNOWN");
        const result = await transmitTelemetry(testUrl, payload);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.status, 404);
        assert.strictEqual(result.error, "Device not registered");
    });

    await test("7. HTTP Ingestion: 403 response for inactive device", async () => {
        const payload = generateTelemetryPayload("DEV-INACTIVE");
        const result = await transmitTelemetry(testUrl, payload);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.status, 403);
        assert.strictEqual(result.error, "Device is inactive");
    });

    // ---------------------------------------------------------
    // 4. Server Unavailable Resilience
    // ---------------------------------------------------------
    await test("8. Network Resilience: handles offline/unavailable server without crashing", async () => {
        const offlineUrl = "http://127.0.0.1:59999/api/iot/data";
        const payload = generateTelemetryPayload("DEV-001");
        const result = await transmitTelemetry(offlineUrl, payload);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.status, 0);
        assert.ok(result.error.includes("Connection Refused") || result.error.includes("unavailable"));
    });

    // ---------------------------------------------------------
    // 5. Multi-Device Simulation Run & Graceful Shutdown
    // ---------------------------------------------------------
    await test("9. Multi-Device Simulation: executes cycles across multiple devices and stops cleanly", async () => {
        await new Promise((resolve) => {
            startSimulator({
                devices: ["DEV-001", "DEV-002", "DEV-003"],
                interval: 50,
                url: testUrl,
                count: 2, // Run 2 cycles (6 requests total)
                onStop: ({ cycleCount, totalSent, totalSuccess }) => {
                    assert.strictEqual(cycleCount, 2);
                    assert.strictEqual(totalSent, 6);
                    assert.strictEqual(totalSuccess, 6);
                    resolve();
                }
            });
        });
    });

    await test("10. Graceful Shutdown: sim.stop() stops timer and triggers callback", async () => {
        await new Promise((resolve) => {
            const sim = startSimulator({
                devices: ["DEV-001"],
                interval: 1000,
                url: testUrl,
                count: Infinity,
                onStop: () => {
                    resolve();
                }
            });

            // Stop simulator after 20ms
            setTimeout(() => {
                sim.stop("Manual test termination");
            }, 20);
        });
    });

    // Close mock HTTP server
    if (mockServer) {
        mockServer.close();
    }

    console.log("\n=================================================");
    console.log(`TEST SUMMARY: ${passed}/${total} TESTS PASSED`);
    console.log("=================================================");

    if (passed === total) {
        console.log("PHASE 1 IoT SIMULATOR VERIFICATION: SUCCESS");
        process.exit(0);
    } else {
        console.error("PHASE 1 IoT SIMULATOR VERIFICATION: FAILED");
        process.exit(1);
    }
}

runAllTests().catch((err) => {
    console.error("Test suite unhandled rejection:", err);
    process.exit(1);
});
