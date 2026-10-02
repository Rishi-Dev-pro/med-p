/**
 * Patient Dashboard Chart Controller
 * Health Tracker — Phase 11: Charts & Time-Series Data Visualization
 *
 * Handles historical chart initialization from GET /api/readings/:patientId/recent,
 * real-time telemetry streaming via Socket.IO, security sanitization, and bounded windowing.
 */
document.addEventListener("DOMContentLoaded", () => {
    const chartContainer = document.getElementById("patientChartContainer");
    const canvas = document.getElementById("patientTelemetryChart");
    const loadingEl = document.getElementById("chartLoading");
    const emptyEl = document.getElementById("chartEmpty");
    const errorEl = document.getElementById("chartError");
    const syncBadge = document.getElementById("chartSyncBadge");
    const latestValue1El = document.getElementById("chartLatestValue1");
    const latestValue2El = document.getElementById("chartLatestValue2");

    if (!chartContainer || !canvas) {
        return; // Page does not have chart component
    }

    const patientId = chartContainer.getAttribute("data-patient-id");
    if (!patientId) {
        showState("error", "Missing patient identifier");
        return;
    }

    // Initialize 50-point bounded time-series manager
    const manager = new window.ChartSanitizer.ChartTimeSeriesManager(50);
    let chartInstance = null;
    let isInitialLoading = true;
    let pendingReadings = [];

    function showState(state, message) {
        if (loadingEl) loadingEl.style.display = state === "loading" ? "flex" : "none";
        if (emptyEl) emptyEl.style.display = state === "empty" ? "flex" : "none";
        if (errorEl) {
            errorEl.style.display = state === "error" ? "flex" : "none";
            if (message) {
                const msgSpan = errorEl.querySelector(".error-message");
                if (msgSpan) msgSpan.textContent = message;
            }
        }
        if (canvas) canvas.style.display = (state === "ready") ? "block" : "none";
    }

    function updateSummaryCards(latest) {
        if (!latest) return;
        if (latestValue1El) latestValue1El.textContent = latest.value1;
        if (latestValue2El) latestValue2El.textContent = latest.value2;
    }

    /**
     * Build or update Chart.js line chart
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
            updateSummaryCards(manager.getLatest());
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

        updateSummaryCards(manager.getLatest());
    }

    /**
     * Fetch recent readings from GET /api/readings/:patientId/recent
     */
    async function loadRecentReadings() {
        showState("loading");
        isInitialLoading = true;
        pendingReadings = [];
        try {
            const response = await fetch(`/api/readings/${encodeURIComponent(patientId)}/recent?limit=50`, {
                headers: { "Accept": "application/json" }
            });

            if (!response.ok) {
                isInitialLoading = false;
                pendingReadings = [];
                if (response.status === 401 || response.status === 403) {
                    showState("error", "Access denied: Unauthorized to view telemetry");
                    return;
                }
                throw new Error(`Server returned HTTP ${response.status}`);
            }

            const json = await response.json();
            const rawReadings = (json.data && json.data.readings) ? json.data.readings : [];

            manager.loadInitial(rawReadings);

            // Replay any live readings buffered during initial HTTP load
            isInitialLoading = false;
            for (const pending of pendingReadings) {
                manager.addReading(pending);
            }
            pendingReadings = [];

            if (manager.getCount() === 0) {
                showState("empty");
            } else {
                showState("ready");
                renderChart();
            }
        } catch (err) {
            isInitialLoading = false;
            pendingReadings = [];
            console.error("Failed to load historical telemetry:", err);
            showState("error", "Unable to load telemetry history.");
        }
    }

    /**
     * Setup Real-time Telemetry via Socket.IO
     */
    function setupSocket() {
        if (typeof io === "undefined") {
            console.warn("Socket.IO client library not loaded");
            return;
        }

        const socket = io({
            transports: ["websocket", "polling"],
            withCredentials: true
        });

        socket.on("connect", () => {
            if (syncBadge) {
                syncBadge.textContent = "● Live Telemetry";
                syncBadge.style.color = "#69D48B";
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

            // Strict client-side check: only process telemetry matching this patient
            if (data.patientId && data.patientId !== patientId) {
                return;
            }

            if (isInitialLoading) {
                pendingReadings.push(data);
                return;
            }

            const added = manager.addReading(data);
            if (added) {
                // If previously empty, switch to ready state
                if (emptyEl && emptyEl.style.display !== "none") {
                    showState("ready");
                }
                renderChart();
            }
        });
    }

    // Initialize chart workflow
    loadRecentReadings();
    setupSocket();
});
