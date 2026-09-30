const socket = io();

const patientId = window.location.pathname.replace(/\/+$/, "").split("/").pop();

const value1Element = document.getElementById("value1");
const value2Element = document.getElementById("value2");
const connectionStatus = document.getElementById("connectionStatus");
const lastUpdate = document.getElementById("lastUpdate");

// ==========================================
// INITIAL DATA FROM MONGODB
// ==========================================

const initialReading = window.initialReading || null;

if (initialReading) {
    value1Element.textContent = initialReading.value1;
    value2Element.textContent = initialReading.value2;
    lastUpdate.textContent =
        new Date(initialReading.timestamp).toLocaleString();
}

socket.on("connect", () => {

    console.log("Patient dashboard connected:", socket.id);

    connectionStatus.textContent = "Live";

    socket.emit("join-room", {
        role: "patient",
        userId: patientId
    });
});

socket.on("disconnect", () => {

    connectionStatus.textContent = "Disconnected";
});

socket.on("sensor-reading", (data) => {

    if (data.patientId !== patientId) {
        return;
    }

    console.log("Patient received:", data);

    value1Element.textContent = data.value1;

    value2Element.textContent = data.value2;

    lastUpdate.textContent =
        new Date(data.timestamp).toLocaleString();
});