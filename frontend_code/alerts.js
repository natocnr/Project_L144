// Determine alert state for a reading.
function getAlert(topic, numValue) {
    // Object for alert status and message.
    const alert = {
        level: "ok",
        message: ""
    };

    // Ensure that numValue is a valid number.
    if (!Number.isFinite(numValue)) {
        return alert;
    }

    // Water level.
    if (topic === "aquarium/sensors/level") {
        // If water level is LOW.
        if (numValue === 0) {
            alert.level = "critical";
            alert.message = "Warning! Water level is low.";
        }
        return alert;
    }

    // Water flow.
    if (topic === "aquarium/sensors/flow") {
        // If there is no flow.
        if (numValue === 0) {
            alert.level = "critical";
            alert.message = "Warning! No water flow detected.";
        }
        return alert;
    }

    // Water temperature.
    if (topic === "aquarium/sensors/temperature") {
        if (numValue <= 20 || numValue >= 32) {
            alert.level = "critical";
            alert.message = "Warning! Possible heater malfunction.";
            return alert;
        }

        if (numValue <= 24 || numValue >= 29) {
            alert.level = "warn";
            alert.message = "Warning! Abnormal water temperature.";
            return alert;
        }

        return alert;
    }

    // Room temperature.
    if (topic === "aquarium/sensors/environment/temperature") {
        if (numValue >= 32) {
            alert.level = "warn";
            alert.message = "Warning! High ambient temperature.";
            return alert;
        }

        return alert;
    }

    return alert;
}


// Apply alert state to card UI.
function applyAlert(card, alert) {
    // Select card badge.
    const badge = card.querySelector(".alert-badge");

    // If there is no badge.
    if (!badge) {
        return;
    }

    // Remove all existing classes.
    card.classList.remove("alert-ok", "alert-warn", "alert-critical");
    badge.classList.remove("alert-ok", "alert-warn", "alert-critical");

    if (alert.level === "critical") {
        card.classList.add("alert-critical");
        badge.classList.add("alert-critical");
        badge.textContent = "CRITICAL";
        return;
    }

    if (alert.level === "warn") {
        card.classList.add("alert-warn");
        badge.classList.add("alert-warn");
        badge.textContent = "WARN";
        return;
    }

    card.classList.add("alert-ok");
    badge.classList.add("alert-ok");
    badge.textContent = "OK";
}