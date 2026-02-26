// Allow the use of email file.
const emailService = require("./emailService");

// Determine alert state for a reading.
function getAlert(topic, numValue) {
    // Default alert object.
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
        if (numValue === 0) {
            alert.level = "critical";
            alert.message = "Warning! Water level is low.";
        }
        return alert;
    }

    // Water flow.
    if (topic === "aquarium/sensors/flow") {
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

// Returns true if topic should use sustained breach filtering.
function shouldUseSustainedFilter(topic) {
    // For now, only temperature uses sbf.
    return (
        topic === "aquarium/sensors/temperature" ||
        topic === "aquarium/sensors/environment/temperature"
    );
}

// How many consecutive breaches needed before activation.
function getRequiredBreaches(topic) {
    // Default number of 3, can be changed more more specific cases.
    return 3;
}


// Get current state for a topic.
async function getState(stateCol, key) {
    // Find first doc which matches topic.
    const state = await stateCol.findOne({ key: key });

    // If a doc was found.
    if (state) {
        // Return doc.
        return state;
    }

    // Default state if missing.
    return {
        key: key,
        isActive: false,
        level: "ok",
        message: "",
        lastValue: null,
        lastChangedAt: null,
        lastNotifiedAt: null,
        breachCount: 0,
        requiredBreaches: 3
    };
}


// Insert an alert event into alerts collection.
async function insertAlertEvent(alertsCol, eventDoc) {
    await alertsCol.insertOne(eventDoc);
}


// Save state. ???
async function saveState(stateCol, key, update) {
    await stateCol.updateOne(
        { key: key },
        { $set: update },
        { upsert: true }
    );
}

// Evaluate an dalert and detect transitions.
async function processAlert(db, topic, numValue, readingDoc, emailTransporter) {
    // Select collections.
    const alertsCol = db.collection(process.env.MONGO_ALERTS_COLLECTION);
    const stateCol = db.collection(process.env.MONGO_ALERT_STATE_COLLECTION);

    // Topic acts as key.
    const key = topic;
    const now = new Date();

    // Get alert object.
    const alert = getAlert(topic, numValue);
    
    // Get previous state.
    const prevState = await getState(stateCol, key);

    // Sustained breach filtering (only for temp topics).
    if (shouldUseSustainedFilter(topic)) {
        // Defualt number of 3.
        const requiredBreaches = getRequiredBreaches(topic);

        // If reading is OK, reset counter.
        if (alert.level === "ok") {
            // Reset counter even if inactive.
            if (prevState.breachCount && prevState.breachCount !== 0) {
                await saveState(stateCol, key, {
                    key: key,
                    breachCount: 0,
                    requiredBreaches: requiredBreaches
                });
            }

        } else {
            // Reading is breaching warn/critical.
            const newCount = Number(prevState.breachCount || 0) + 1;

            // Save updated counter.
            await saveState(stateCol, key, {
                key: key,
                breachCount: newCount,
                requiredBreaches: requiredBreaches
            });

            // If we have not reached threshold yet, do NOT activate.
            if (!prevState.isActive && newCount < requiredBreaches) {
                console.log("BREACH COUNT", topic, newCount + "/" + requiredBreaches, "-> waiting to activate");
                return;
            }
        }
    }

    // Transition: OK -> WARN/CRITICAL.
    if (!prevState.isActive && alert.level !== "ok") {
        // Have not notified.
        let notified = false;

        // Send email.
        if (emailTransporter) {
            // Sender and receiver.
            const to = process.env.ALERT_EMAIL_TO;
            const from = process.env.ALERT_EMAIL_FROM;

            if (to && from) {
                const subject = "[Aquarium Alert] " + alert.level.toUpperCase() + " - " + topic;

                const body =
                    alert.message + "\n\n" +
                    "Topic: " + topic + "\n" +
                    "Severity: " + alert.level + "\n" +
                    "Value: " + String(numValue) + "\n" +
                    "Time: " + now.toISOString() + "\n";

                try {
                    await emailService.sendAlertEmail(emailTransporter, to, from, subject, body);
                    notified = true;
                    console.log("EMAIL SENT", topic, alert.level);
                } catch (err) {
                    console.error("Email send failed:", err.message);
                }
            } else {
                console.warn("Missing ALERT_EMAIL_TO or ALERT_EMAIL_FROM.");
            }
        }

        // Insert activation event
        await insertAlertEvent(alertsCol, {
            ts: now,
            event: "activated",
            topic: topic,
            severity: alert.level,
            message: alert.message,
            value: numValue,
            readingTs: readingDoc.ts,
            notified: notified
        });

        // Update state
        await saveState(stateCol, key, {
            key: key,
            isActive: true,
            level: alert.level,
            message: alert.message,
            lastValue: numValue,
            lastChangedAt: now,
            lastNotifiedAt: notified ? now : null,
            breachCount: 0
        });

        console.log("ALERT ACTIVATED", topic, "->", alert.level, numValue);
        return;
    }

    // WARN/CRITICAL to OK.
    if (prevState.isActive && alert.level === "ok") {
        // Insert deactivation alert.
        await insertAlertEvent(alertsCol, {
            ts: now,
            event: "cleared",
            topic: topic,
            severity: prevState.level,
            message: "Alert cleared",
            value: numValue,
            readingTs: readingDoc.ts,
            notified: false
        });

        // Update state.
        await saveState(stateCol, key, {
            key: key,
            isActive: false,
            level: "ok",
            message: "",
            lastValue: numValue,
            lastChangedAt: now,
            lastNotifiedAt: prevState.lastNotifiedAt || null,
            breachCount: 0
        });

        console.log("ALERT CLEARED", topic, "-> OK", numValue);
        return;
    }

    // No transition..
    await saveState(stateCol, key, {
        key: key,
        lastValue: numValue
    });
}

// Allow other files to use functions.
module.exports = { getAlert, processAlert };