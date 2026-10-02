/**
 * Doctor Caseload Telemetry Chart Controller
 * Health Tracker — Phase 11: Charts & Time-Series Data Visualization
 *
 * Implements authorized patient selection/switching, historical chart initialization
 * from GET /api/readings/:patientId/recent, realtime telemetry updates over Socket.IO,
 * bounded 50-point rolling window, and strict patient isolation.
 */
document.addEventListener("DOMContentLoaded", () => {
    const chartContainer = document.getElementById("doctorChartContainer");
    const canvas = document.getElementById("doctorTelemetryChart");
    const patientSelector = document.getElementById("patientFilter");
    const loadingEl = document.getElementById("doctorChartLoading");
    const emptyEl = document.getElementById("doctorChartEmpty");
    const errorEl = document.getElementById("doctorChartError");
    const promptEl = document.getElementById("doctorChartPrompt");
    const syncBadge = document.getElementById("doctorChartSyncBadge");
    const activePatientLabel = document.getElementById("doctorChartActivePatient");

    if (!chartContainer || !canvas) {
        return; // Not on clinical history page
    }

    const doctorId = chartContainer.getAttribute("data-doctor-id");
    const manager = new window.ChartSanitizer.ChartTimeSeriesManager(50);
    let chartInstance = null;
    let currentPatientId = null;
    let socket = null;
    let selectionRequestId = 0;
    let isSwitchingPatient = false;
    let pendingDoctorReadings = [];

    function showState(state, message) {
        if (loadingEl) loadingEl.style.display = state === "loading" ? "flex" : "none";
        if (emptyEl) emptyEl.style.display = state === "empty" ? "flex" : "none";
        if (promptEl) promptEl.style.display = state === "prompt" ? "flex" : "none";
        if (errorEl) {
            errorEl.style.display = state === "error" ? "flex" : "none";
            if (message) {
                const msgSpan = errorEl.querySelector(".error-message");
                if (msgSpan) msgSpan.textContent = message;
            }
        }
        if (canvas) canvas.style.display = state === "ready" ? "block" : "none";
    }

    function destroyChart() {
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
    }

    /**
     * Render or refresh Chart.js
     */
    function renderChart() {
        const labels = manager.getLabels();
        const data1 = manager.getValue1Series();
        const data2 = manager.getValue2Series();

        if (chartInstance) {
            chartInstance.data.labels = labels;
            chartInstance.data.datasets[0].data = data1;
            chartInstance.data.datasets[1].data = data2;
            chartInstance.update();
            return;
        }

        const ctx = canvas.getContext("2d");
        chartInstance = new Chart(ctx, {
            type: "line",
            data: {
                labels: labels,
                datasets: [
                    {
                        label: "Heart Rate (Value 01)",
                        data: data1,
                        borderColor: "#FFF4D6",
                        backgroundColor: "rgba(255, 244, 214, 0.08)",
                        borderWidth: 2,
                        pointBackgroundColor: "#FFF4D6",
                        pointBorderColor: "#11100E",
                        pointRadius: 3,
                        pointHoverRadius: 6,
                        tension: 0.35,
                        fill: true,
                        yAxisID: "y"
                    },
                    {
                        label: "Blood Oxygen (Value 02)",
                        data: data2,
                        borderColor: "#FC6C26",
                        backgroundColor: "rgba(252, 108, 38, 0.08)",
                        borderWidth: 2,
                        pointBackgroundColor: "#FC6C26",
                        pointBorderColor: "#11100E",
                        pointRadius: 3,
                        pointHoverRadius: 6,
                        tension: 0.35,
                        fill: true,
                        yAxisID: "y1"
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 350,
                    easing: "easeOutQuart"
                },
                interaction: {
                    mode: "index",
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                        align: "end",
                        labels: {
                            color: "#FFF4D6",
                            boxWidth: 12,
                            boxHeight: 12,
                            font: {
                                size: 12,
                                family: "inherit"
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: "#1A1815",
                        titleColor: "#FFF4D6",
                        bodyColor: "#FFF4D6",
                        borderColor: "rgba(252, 108, 38, 0.4)",
                        borderWidth: 1,
                        padding: 10,
                        boxPadding: 4,
                        usePointStyle: true,
                        callbacks: {
                            label: function (context) {
                                const unit = context.datasetIndex === 0 ? " bpm" : " %";
                                return `${context.dataset.label}: ${context.parsed.y}${unit}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: "rgba(168, 163, 154, 0.12)",
                            drawBorder: false
                        },
                        ticks: {
                            color: "#A8A39A",
                            font: { size: 10 },
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 8
                        }
                    },
                    y: {
                        type: "linear",
                        display: true,
                        position: "left",
                        title: {
                            display: true,
                            text: "Heart Rate (bpm)",
                            color: "#FFF4D6",
                            font: { size: 11, weight: "600" }
                        },
                        grid: {
                            color: "rgba(168, 163, 154, 0.12)",
                            drawBorder: false
                        },
                        ticks: {
                            color: "#A8A39A",
                            font: { size: 10 }
                        }
                    },
                    y1: {
                        type: "linear",
                        display: true,
                        position: "right",
                        title: {
                            display: true,
                            text: "SpO₂ (%)",
                            color: "#FC6C26",
                            font: { size: 11, weight: "600" }
                        },
                        grid: {
                            drawOnChartArea: false,
                            drawBorder: false
                        },
                        ticks: {
                            color: "#FC6C26",
                            font: { size: 10 }
                        },
                        suggestedMin: 80,
                        suggestedMax: 100
                    }
                }
            }
        });
    }

    /**
     * Switch authorized patient context safely.
     * Destroys previous chart instance, clears state, fetches new patient readings,
     * and subscribes to authorized Socket.IO stream.
     */
    async function switchPatient(patientId) {
        const requestId = ++selectionRequestId;

        // Step 1: Safely destroy previous chart and flush old patient data
        destroyChart();
        manager.reset();
        currentPatientId = patientId ? patientId.trim() : null;
        pendingDoctorReadings = [];

        if (activePatientLabel) {
            activePatientLabel.textContent = currentPatientId ? `Monitoring: ${currentPatientId}` : "No Patient Selected";
        }

        if (!currentPatientId) {
            isSwitchingPatient = false;
            showState("prompt");
            return;
        }

        // Step 2: Show loading state
        isSwitchingPatient = true;
        showState("loading");

        // Step 3: Request socket room subscription for new patient
        if (socket && socket.connected) {
            socket.emit("join-room", {
                role: "doctor",
                patientId: currentPatientId
            });
        }

        // Step 4: Fetch historical recent readings for newly selected patient
        try {
            const response = await fetch(`/api/readings/${encodeURIComponent(currentPatientId)}/recent?limit=50`, {
                headers: { "Accept": "application/json" }
            });

            // Discard superseded responses immediately
            if (requestId !== selectionRequestId) {
                return;
            }

            if (!response.ok) {
                isSwitchingPatient = false;
                pendingDoctorReadings = [];
                if (response.status === 403) {
                    showState("error", "Access denied: Patient is not assigned to your clinical care");
                    return;
                }
                if (response.status === 404) {
                    showState("error", "Patient record not found");
                    return;
                }
                throw new Error(`HTTP ${response.status}`);
            }

            const json = await response.json();

            // Discard superseded responses immediately
            if (requestId !== selectionRequestId) {
                return;
            }

            const rawReadings = (json.data && json.data.readings) ? json.data.readings : [];
            manager.loadInitial(rawReadings);

            // Replay any live telemetry buffered for this patient while fetch was in-flight
            isSwitchingPatient = false;
            for (const pending of pendingDoctorReadings) {
                manager.addReading(pending);
            }
            pendingDoctorReadings = [];

            if (manager.getCount() === 0) {
                showState("empty");
            } else {
                showState("ready");
                renderChart();
            }
        } catch (err) {
            if (requestId !== selectionRequestId) {
                return;
            }
            isSwitchingPatient = false;
            pendingDoctorReadings = [];
            console.error("Failed to load patient recent telemetry:", err);
            showState("error", "Unable to load telemetry history.");
        }
    }

    /**
     * Initialize Socket.IO connection
     */
    function initSocket() {
        if (typeof io === "undefined") {
            console.warn("Socket.IO client library not available");
            return;
        }

        socket = io({
            transports: ["websocket", "polling"],
            withCredentials: true
        });

        socket.on("connect", () => {
            if (syncBadge) {
                syncBadge.textContent = "● Live Telemetry";
                syncBadge.style.color = "#69D48B";
            }

            // If a patient is currently active, subscribe to that patient's stream
            if (currentPatientId) {
                socket.emit("join-room", {
                    role: "doctor",
                    patientId: currentPatientId
                });
            }
        });

        socket.on("disconnect", () => {
            if (syncBadge) {
                syncBadge.textContent = "○ Disconnected";
                syncBadge.style.color = "#A8A39A";
            }
        });

        socket.on("connect_error", () => {
            if (syncBadge) {
                syncBadge.textContent = "⚠ Reconnecting...";
                syncBadge.style.color = "#FC6C26";
            }
        });

        socket.on("sensor-reading", (data) => {
            if (!data) return;

            // Strict client-side isolation: ONLY process telemetry for the currently selected patient
            if (!currentPatientId || data.patientId !== currentPatientId) {
                return;
            }

            if (isSwitchingPatient) {
                pendingDoctorReadings.push(data);
                return;
            }

            const added = manager.addReading(data);
            if (added) {
                if (emptyEl && emptyEl.style.display !== "none") {
                    showState("ready");
                }
                renderChart();
            }
        });
    }

    // Attach listener to patient selection dropdown
    if (patientSelector) {
        patientSelector.addEventListener("change", (e) => {
            switchPatient(e.target.value);
        });
    }

    // Initialize socket connection
    initSocket();

    // Check initial patient selection from DOM
    const initialPatientId = chartContainer.getAttribute("data-selected-patient") || (patientSelector ? patientSelector.value : null);
    switchPatient(initialPatientId);
});
