/**
 * Socket.IO Connection & Reconnection Status Manager
 * Health Tracker — Phase 14: Error Handling, Edge Cases & System Robustness
 *
 * Provides a user-friendly, accessible live connection status indicator.
 * Displays informative state transitions (CONNECTED, RECONNECTING, DISCONNECTED, ERROR)
 * without exposing internal error objects or network details.
 */

(function () {
    "use strict";

    const STATES = {
        CONNECTED: {
            text: "Live telemetry connected",
            class: "status-connected",
            bg: "rgba(16, 185, 129, 0.15)",
            border: "rgba(16, 185, 129, 0.4)",
            color: "#34D399",
            icon: "●",
            autoHide: true
        },
        RECONNECTING: {
            text: "Reconnecting to live telemetry...",
            class: "status-reconnecting",
            bg: "rgba(245, 158, 11, 0.15)",
            border: "rgba(245, 158, 11, 0.4)",
            color: "#FBBF24",
            icon: "◌",
            autoHide: false
        },
        DISCONNECTED: {
            text: "Live telemetry disconnected",
            class: "status-disconnected",
            bg: "rgba(224, 90, 71, 0.15)",
            border: "rgba(224, 90, 71, 0.4)",
            color: "#E05A47",
            icon: "○",
            autoHide: false
        },
        ERROR: {
            text: "Live telemetry connection error. Retrying...",
            class: "status-error",
            bg: "rgba(224, 90, 71, 0.15)",
            border: "rgba(224, 90, 71, 0.4)",
            color: "#E05A47",
            icon: "⚠",
            autoHide: false
        }
    };

    let bannerElement = null;
    let hideTimer = null;

    function getOrCreateBanner() {
        if (bannerElement && document.body.contains(bannerElement)) {
            return bannerElement;
        }

        bannerElement = document.createElement("div");
        bannerElement.id = "socket-connection-banner";
        bannerElement.setAttribute("role", "status");
        bannerElement.setAttribute("aria-live", "polite");

        // Styling in dark/burnt-orange medical aesthetic
        bannerElement.style.cssText = `
            position: fixed;
            top: 14px;
            right: 20px;
            z-index: 9999;
            display: none;
            align-items: center;
            gap: 8px;
            padding: 7px 14px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            letter-spacing: 0.2px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.35);
            transition: all 0.3s ease;
            backdrop-filter: blur(8px);
        `;

        document.body.appendChild(bannerElement);
        return bannerElement;
    }

    function setStatus(stateKey) {
        const state = STATES[stateKey];
        if (!state) return;

        const banner = getOrCreateBanner();
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }

        banner.style.background = state.bg;
        banner.style.border = `1px solid ${state.border}`;
        banner.style.color = state.color;
        banner.innerHTML = `<span style="font-size: 10px;">${state.icon}</span> <span>${state.text}</span>`;
        banner.style.display = "flex";
        banner.style.opacity = "1";

        if (state.autoHide) {
            hideTimer = setTimeout(() => {
                banner.style.opacity = "0";
                setTimeout(() => {
                    if (banner.style.opacity === "0") {
                        banner.style.display = "none";
                    }
                }, 300);
            }, 3000);
        }
    }

    /**
     * Attaches status banner lifecycle handlers to a Socket.IO instance
     *
     * @param {Object} socket - Socket.IO client instance
     */
    function attachSocketStatus(socket) {
        if (!socket) return;

        // When connected
        socket.on("connect", () => {
            setStatus("CONNECTED");
        });

        // When disconnected
        socket.on("disconnect", (reason) => {
            if (reason === "io server disconnect") {
                setStatus("DISCONNECTED");
            } else {
                setStatus("RECONNECTING");
            }
        });

        // Reconnection lifecycle events on socket.io manager
        if (socket.io) {
            socket.io.on("reconnect_attempt", () => {
                setStatus("RECONNECTING");
            });

            socket.io.on("reconnect", () => {
                setStatus("CONNECTED");
            });

            socket.io.on("reconnect_error", () => {
                setStatus("RECONNECTING");
            });

            socket.io.on("reconnect_failed", () => {
                setStatus("DISCONNECTED");
            });
        }

        // Connection error
        socket.on("connect_error", () => {
            setStatus("ERROR");
        });
    }

    // Expose globally for application use
    window.attachSocketStatus = attachSocketStatus;
    window.setSocketStatus = setStatus;
})();
