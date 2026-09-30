const socket = io();

const doctorId =
    window.location.pathname.replace(/\/+$/, "").split("/").pop();

const patientGrid =
    document.getElementById("patientGrid");

const activityFeed =
    document.getElementById("activityFeed");

const totalPatients =
    document.getElementById("totalPatients");

const activeDevices =
    document.getElementById("activeDevices");

const liveReadings =
    document.getElementById("liveReadings");

const systemStatus =
    document.getElementById("systemStatus");

const systemStatusSub =
    document.getElementById("systemStatusSub");

const patients = new Map();

let readingCount = 0;


// ==========================================
// INITIAL DATA FROM MONGODB
// ==========================================

function loadInitialPatients() {

    const initialPatients =
        window.initialPatients || [];


    initialPatients.forEach((entry) => {

        const patient =
            entry.patient;

        const device =
            entry.device;

        const latestReading =
            entry.latestReading;


        patients.set(
            patient.patientId,
            {

                patientId:
                    patient.patientId,

                patientName:
                    patient.name,

                deviceId:
                    device
                        ? device.deviceId
                        : null,

                value1:
                    latestReading
                        ? latestReading.value1
                        : "--",

                value2:
                    latestReading
                        ? latestReading.value2
                        : "--",

                timestamp:
                    latestReading
                        ? latestReading.timestamp
                        : null

            }
        );

    });


    renderPatients();

}


// ==========================================
// SOCKET CONNECTION
// ==========================================

socket.on("connect", () => {

    if (systemStatus) systemStatus.textContent = "LIVE";
    if (systemStatusSub) systemStatusSub.textContent = "Socket.IO connected";

    console.log(
        "Doctor dashboard connected:",
        socket.id
    );


    socket.emit("join-room", {

        role: "doctor",

        userId: doctorId

    });

});

socket.on("disconnect", () => {
    if (systemStatus) systemStatus.textContent = "DISCONNECTED";
    if (systemStatusSub) systemStatusSub.textContent = "Connection lost";
});

socket.on("connect_error", (err) => {
    if (systemStatus) systemStatus.textContent = "OFFLINE";
    if (systemStatusSub) systemStatusSub.textContent = "Auth failed: " + (err.message || "Unauthorized");
    window.location.href = "/login";
});


// ==========================================
// NEW SENSOR READING
// ==========================================

socket.on("sensor-reading", (data) => {

    console.log(
        "Doctor received:",
        data
    );


    readingCount++;

    liveReadings.textContent =
        readingCount;


    const existing = patients.get(data.patientId) || {};

    patients.set(
        data.patientId,
        {
            ...existing,
            patientId:
                data.patientId,

            patientName:
                data.patientName ||
                existing.patientName ||
                data.patientId,

            deviceId:
                data.deviceId !== undefined ?
                data.deviceId :
                existing.deviceId,

            value1:
                data.value1 !== undefined ?
                data.value1 :
                existing.value1,

            value2:
                data.value2 !== undefined ?
                data.value2 :
                existing.value2,

            timestamp:
                data.timestamp ||
                existing.timestamp
        }
    );


    renderPatients();

    addActivity(data);

});


// ==========================================
// RENDER PATIENTS
// ==========================================

function renderPatients() {

    patientGrid.innerHTML = "";


    if (patients.size === 0) {

        patientGrid.innerHTML = `

            <div class="empty-state">

                <div class="empty-icon">
                    +
                </div>

                <h3>
                    No patients found
                </h3>

                <p>
                    Patients assigned to you
                    will appear here.
                </p>

            </div>

        `;

        totalPatients.textContent = "0";

        activeDevices.textContent = "0";

        return;

    }


    totalPatients.textContent =
        patients.size;


    let deviceCount = 0;


    patients.forEach((data) => {

        if (data.deviceId) {
            deviceCount++;
        }


        const card =
            document.createElement("article");


        card.className =
            "patient-card";


        const patientInitial =
            data.patientName
                ? data.patientName
                    .charAt(0)
                    .toUpperCase()
                : "?";


        const timestamp =
            data.timestamp
                ? formatTime(
                    data.timestamp
                )
                : "No reading";


        card.innerHTML = `

            <div class="patient-header">

                <div class="patient-identity">

                    <div class="patient-avatar"></div>

                    <div>

                        <div class="patient-name"></div>

                        <div class="patient-id"></div>

                    </div>

                </div>


                <div class="patient-live">

                    <span class="status-dot"></span>

                    LIVE

                </div>

            </div>


            <div class="reading-grid">

                <div class="reading-box">

                    <span>
                        VALUE 01
                    </span>

                    <strong class="val-1"></strong>

                </div>


                <div class="reading-box">

                    <span>
                        VALUE 02
                    </span>

                    <strong class="val-2"></strong>

                </div>

            </div>


            <div class="patient-device">

                <span class="device-label"></span>

                <span class="time-label"></span>

            </div>

        `;

        card.querySelector(".patient-avatar").textContent = patientInitial;
        card.querySelector(".patient-name").textContent = data.patientName || "Unknown Patient";
        card.querySelector(".patient-id").textContent = data.patientId || "";
        card.querySelector(".val-1").textContent = data.value1 !== undefined ? data.value1 : "--";
        card.querySelector(".val-2").textContent = data.value2 !== undefined ? data.value2 : "--";
        card.querySelector(".device-label").textContent = `Device: ${data.deviceId || "Not connected"}`;
        card.querySelector(".time-label").textContent = timestamp;

        patientGrid.appendChild(card);

    });


    activeDevices.textContent =
        deviceCount;

}


// ==========================================
// ACTIVITY FEED
// ==========================================

function addActivity(data) {

    const empty =
        activityFeed.querySelector(
            ".activity-empty"
        );


    if (empty) {
        empty.remove();
    }


    const item =
        document.createElement("div");


    item.className =
        "activity-item";


    item.innerHTML = `

        <div class="activity-icon">
            ↗
        </div>

        <div>

            <div class="activity-title"></div>

            <div class="activity-description"></div>

        </div>


        <div class="activity-time"></div>

    `;

    const name = data.patientName || data.patientId || "Patient";
    item.querySelector(".activity-title").textContent = `${name} sent a new reading`;
    item.querySelector(".activity-description").textContent = `Device ${data.deviceId || "unknown"} · ${data.value1} / ${data.value2}`;
    item.querySelector(".activity-time").textContent = formatTime(data.timestamp);

    activityFeed.prepend(item);


    while (
        activityFeed.children.length > 8
    ) {

        activityFeed.lastElementChild.remove();

    }

}


// ==========================================
// TIME
// ==========================================

function formatTime(timestamp) {

    return new Date(
        timestamp
    ).toLocaleTimeString(
        [],
        {
            hour: "2-digit",
            minute: "2-digit"
        }
    );

}


// ==========================================
// START
// ==========================================

loadInitialPatients();