// API server host and port number.
const API_BASE = window.APP_CONFIG.API_BASE;

// How many history documents we fetch for stats, change for testing.
const HISTORY_LIMIT = 1000;

// Select all sensor cards from HTML.
const sensorCards = document.querySelectorAll(".sensor-card");

// Store active chart instances by topic, prevents duplicated charts.
const activeCharts = {};

// Store history results by topic, preventing re-fetching.
const historyCache = {};

// Auto re-fresh intervals.
const LATEST_REFRESH_MS = 5000; // Refresh latest values every 5 seconds.
const DETAILS_REFRESH_MS = 15000; // Refresh detail values every 15 seconds.

// Track which card is currently open (so refresh does not close).
let openTopic = null;

// Track whether we are currently refreshing (prevents overlap).
let isRefreshingLatest = false;
let isRefreshingDetails = false;

// Refresh alerts every 15 seconds.
const ALERTS_REFRESH_MS = 15000; 

// Enable card expansion.
function enableExpansion() {
    // For each card, attach an event listener.
    for (const card of sensorCards) {
        // Visible part of card.
        const row = card.querySelector(".sensor-row");
        
        // Hidden part of card.
        const details = card.querySelector(".sensor-details");

        // Range dropdown in hidden part.
        const rangeSelect = card.querySelector(".sensor-range");

        // Prevents adding same listener multiple times.
        if (rangeSelect) {
            // If the listener has not been added.
            if (rangeSelect.dataset.listenerAdded !== "true") {
                // Change boolean value.
                rangeSelect.dataset.listenerAdded = "true";

                // When changed, run callback function.
                rangeSelect.addEventListener("change", async function () {
                    // Re-compute stats and re-draw chart.
                    await refreshCardDetails(card);
                });
            }
        }

        // Ensure that the hidden part of card remains hidden at first.
        details.style.display = "none";

        // When a card is clicked, run callback function.
        row.addEventListener("click", async function () {
            // Strictly comparing to check if card is expanded.
            const isOpen = details.style.display === "block";

            // Close all cards, ensures that only one card is expanded at any give time.
            closeAllCards();

            // If the card is closed.
            if (!isOpen) {
                // Expand card.
                openCard(details);

                // Record that the card is currently open.
                openTopic = card.dataset.topic;

                // When the card opens, load history and show min/max/count.
                await loadStatsForOneCard(card);

            } else {
                // An already opened card that is clicked will close, so clear it from record.
                openTopic = null;
            }
        });
    }
}

// Closes all cards.
function closeAllCards() {
    // For each card.
    for (const card of sensorCards) {
        // Select card details.
        const details = card.querySelector(".sensor-details");
        
        // Close card details.
        details.style.display = "none";
    }

    // Clear open cards from record.
    openTopic = null;
}

// Expand card.
function openCard(detailsDiv) {
    // Display details of passed card.
    detailsDiv.style.display = "block";
}

// Loads latest values for all cards.
async function loadLatestForAllCards() {
    // For each card.
    for (const card of sensorCards) {
        // Load latest value.
        await loadLatestForOneCard(card);
    }
}

// Loads latest reading for a card and updates UI.
async function loadLatestForOneCard(card) {
    // Read card topic from HTML.
    const topic = card.dataset.topic;
    
    // Read card unit type from HTML, if unit value exists use it otherwise, use empty string.
    const unit = card.dataset.unit || "";

    try {
        // Call the API, return most recent document for specific topic.
        const latestDoc = await getLatest(topic);

        // Update card UI.
        updateCardUI(card, latestDoc, unit);

    } catch (err) {
        // Error message.
        console.warn("Could not load latest for topic:", topic, err.message);

        // Set value to N/A.
        const valueElement = card.querySelector(".sensor-value");
        valueElement.textContent = "N/A";
    }
}

// Calls API.
async function getLatest(topic) {
    // Appropriate URL with encoding for safety.
    const url = API_BASE + "/latest?topic=" + encodeURIComponent(topic);
    
    // Call fetch helper function.
    return await fetchJson(url);
}

// Calls API for recent alerts.
async function getAlerts(limit) {
    // Appropriate URL with encoding for safety.
    const url = API_BASE + "/alerts?limit=" + encodeURIComponent(limit);

    // Call fetch helper function.
    return await fetchJson(url);
}

// Calls API for history.
async function getHistory(topic, limit) {
    // Appropriate URL with encoding for safety.
    const url = API_BASE 
        + "/history?topic=" + encodeURIComponent(topic) 
        + "&limit=" + encodeURIComponent(limit);

    // Call fetch helper function.
    return await fetchJson(url);
}

// Calls API for aggregated history.
async function getHistoryAgg(topic, startIso, endIso) {
    // Appropriate URL with encoding for safety.
    let url = API_BASE
        + "/history-agg?topic=" + encodeURIComponent(topic);

    // If start time has been given.
    if (startIso) {
        url += "&start=" + encodeURIComponent(startIso);
    }

    // If end time has been given.
    if (endIso) {
        url += "&end=" + encodeURIComponent(endIso);
    }

    // Call fetch helper function.
    return await fetchJson(url);
}

// Fetch helper function.
async function fetchJson(url) {
    // Return response object.
    const response = await fetch(url);

    // If status is not ok.
    if (!response.ok) {
        // Return raw text body.
        const text = await response.text();
        
        // Throw and display specific error.
        throw new Error("Request failed: " + response.status + " " + text);
    }

    // Return Json body extracted from reponse object.
    return await response.json();
}

// Decide whether we should use aggregated history for the selected range.
function shouldUseAggregates(rangeMs) {
    // Only use aggregates for 6h and 24h.
    return rangeMs >= (6 * 60 * 60 * 1000);
}

// Get the timestamp for a document depending on mode.
function getDocTimeMs(doc, mode) {
    // If the mode is agg.
    if (mode === "agg") {
        // Aggregate has interval start ts.
        return new Date(doc.intervalStart).getTime();
    }

    // Raw docs just use ts.
    return new Date(doc.ts).getTime();
}

// Get the numeric value to plot depending on mode.
function getDocValueNumber(doc, mode) {
    // If the mode is agg.
    if (mode === "agg") {
        // Plot the avg for aggregates.
        return Number(doc.avg);
    }

    // For raw use parsed value or raw values.
    const value = (doc.value !== undefined) ? doc.value : doc.raw;
    return Number(value);
}

// Update the cards HTML elements with latest reading.
function updateCardUI(card, latestDoc, unit) {
    // Select sensor value HTML element.
    const valueElement = card.querySelector(".sensor-value");
    
    // Select sensor timestamp HTML element.
    const tsElement = card.querySelector(".sensor-ts");

    // If value (parsed) is not undefined, use it otherwise use raw (payload).
    const value = (latestDoc.value !== undefined) ? latestDoc.value : latestDoc.raw;

    // Apply status badge.
    const numValue = Number(value);
    const alert = getAlert(card.dataset.topic, numValue);
    applyAlert(card, alert);

    // Update HTML value and add appropriate unit.
    valueElement.textContent = formatValue(value, unit);

    // Update HTML time stamp.
    if (latestDoc.ts) {
        // Update HTML last updated time stamp.
        tsElement.textContent = new Date(latestDoc.ts).toLocaleString();
    } else {
        // If it does not exist.
        tsElement.textContent = "-";
    }
}

// Load history for one card and compute min/max/count/chart.
async function loadStatsForOneCard(card) {
    // Select topic from HTML.
    const topic = card.dataset.topic;

    try {
        // Determine selected range.
        const rangeMs = getRangeMsFromCard(card);

        // Decide which data source to use.
        const mode = shouldUseAggregates(rangeMs) ? "agg" : "raw";

        // If cache missing or wrong mode, fetch it.
        if (!historyCache[topic] || historyCache[topic].mode !== mode) {

            // Compute start/end for the selected range (used for aggregates).
            const endMs = Date.now();
            const startMs = endMs - rangeMs;

            const startIso = new Date(startMs).toISOString();
            const endIso = new Date(endMs).toISOString();

            if (mode === "raw") {
                // Raw history (capped by backend to 500).
                const historyResponse = await getHistory(topic, HISTORY_LIMIT);
                const docs = Array.isArray(historyResponse.data) ? historyResponse.data : [];
                historyCache[topic] = { mode: "raw", docs: docs };
            } else {
                // Aggregated history (returns buckets).
                const historyResponse = await getHistoryAgg(topic, startIso, endIso);
                const docs = Array.isArray(historyResponse.data) ? historyResponse.data : [];
                historyCache[topic] = { mode: "agg", docs: docs };
            }
        }

        // Update stats and charts using cached docs.
        await refreshCardDetails(card);

    } catch (err) {
        console.warn("Could not load history for topic:", topic, err.message);
        setStatsPlaceholders(card);
    }
}


// Find card given topic.
function findCardByTopic(topic) {
    // For each card.
    for (const card of sensorCards) {
        // If cards data topic matches passed topic.
        if (card.dataset.topic === topic) {
            // Return card.
            return card;
        }
    }

    // Otherwise, return nothing.
    return null;
}

// Compute count/min/max from the history document.
function computeStats(historyDocs, mode) {
    // Default stats.
    const stats = {
        count: 0, // Number of documents (raw) or total samples (agg).
        min: null, // Minimum value found.
        max: null, // Maximum value found.
        numericCount: 0 // Number of numeric values found.
    };

    // If history is not an array, return defaults.
    if (!Array.isArray(historyDocs)) {
        return stats;
    }

    // If we are using aggregated documents.
    if (mode === "agg") {

        // For each document in array.
        for (const doc of historyDocs) {

            // Add number of raw samples represented in this bucket.
            const bucketCount = Number(doc.count);

            if (Number.isFinite(bucketCount)) {
                stats.count += bucketCount;
            }

            // Convert bucket min and max to numbers.
            const minValue = Number(doc.min);
            const maxValue = Number(doc.max);

            // If minimum is valid.
            if (Number.isFinite(minValue)) {
                stats.numericCount++;

                // Set minimum value.
                if (stats.min === null || minValue < stats.min) {
                    stats.min = minValue;
                }
            }

            // If maximum is valid.
            if (Number.isFinite(maxValue)) {
                // Set maximum value.
                if (stats.max === null || maxValue > stats.max) {
                    stats.max = maxValue;
                }
            }
        }

        // Return stats as JSON.
        return stats;
    }

    // Otherwise, use raw history documents.

    // Number of documents.
    stats.count = historyDocs.length;

    // For each document in array.
    for (const doc of historyDocs) {
        // If value (parsed) is not undefined, use it otherwise use raw (payload).
        const value = (doc.value !== undefined) ? doc.value : doc.raw;

        // Convert to Number.
        const num = Number(value);

        // If conversion fails, skip.
        if (!Number.isFinite(num)) {
            continue;
        }

        // Increase numeric count by one.
        stats.numericCount++;

        // Set minimum value.
        if (stats.min === null || num < stats.min) {
            stats.min = num;
        }

        // Set maximum value.
        if (stats.max === null || num > stats.max) {
            stats.max = num;
        }
    }

    // Return stats as JSON.
    return stats;
}

// Update the min/max/count fields inside the card.
function updateCardStatsUI(card, stats, unit) {
    // Select appropiate HTML elements.
    const countElement = card.querySelector(".sensor-count");
    const minElement = card.querySelector(".sensor-min");
    const maxElement = card.querySelector(".sensor-max");

    if (countElement) {
        // Show total number of samples returned from API.
        countElement.textContent = String(stats.count);
    }

    // If we found numeric values, show min/max.
    if (stats.numericCount > 0) {
        if (minElement) {
            minElement.textContent = formatValue(stats.min, unit);
        }
        
        if (maxElement) {
            maxElement.textContent = formatValue(stats.max, unit);
        }
    } 
    
    // Otherwise, show nothing.
    else {
        if (minElement) {
            minElement.textContent = "-";
        }
        
        if (maxElement) {
            maxElement.textContent = "-";
        }
    }
}

// If stats cannot be loaded, set placeholders.
function setStatsPlaceholders(card) {
    // Select appropiate HTML elements.
    const countElement = card.querySelector(".sensor-count");
    const minElement = card.querySelector(".sensor-min");
    const maxElement = card.querySelector(".sensor-max");

    // Update all HTML elements.
    if (countElement) {
        countElement.textContent = "-";
    }

    if (minElement) {
        minElement.textContent = "-";
    }

    if (maxElement) {
        maxElement.textContent = "-";
    }
}

// Concatenate unit to value.
function formatValue(value, unit) {
    // If value is undefined or null.
    if (value === undefined || value === null) {
        return "-";
    }

    // For water level.
    if (unit === "level") {
        // If value is 1.
        if (value === 1) {
            // Return HIGH.
            return "HIGH";
        }

        // Otherwise, return LOW.
        return "LOW";
    }

    // If unit is not applicable.
    if (unit === "") {
        return String(value);
    }
    
    // Otherwise, return value and unit.
    return String(value) + " " + unit;
}

// Renders the chart.
function renderChartForCard(card, historyDocs, mode) {
    // Select HTML topic and chart.
    const topic = card.dataset.topic;
    const canvas = card.querySelector(".sensor-chart");

    // If there is no HTML canvas.
    if (!canvas) {
        return;
    }

    // If a chart for the topic exists.
    if (activeCharts[topic]) {
        // Delete it.
        activeCharts[topic].destroy();
    }

    // History docs are pre-filtered with range change.
    const filteredDocs = historyDocs;

    // Label and value holders.
    const labels = [];
    const values = [];

    let orderedDocs;

    if (mode === "raw") {
        // Raw comes newest to oldest, so reverse it.
        orderedDocs = filteredDocs.slice().reverse();
    } else {
        // Aggregates already come oldest to newest.
        orderedDocs = filteredDocs;
    }

    // For each document in reversed order.
    for (const doc of orderedDocs) {
        const num = getDocValueNumber(doc, mode);

        if (!Number.isFinite(num)) {
            continue;
        }

        const time = new Date(getDocTimeMs(doc, mode));
        labels.push(time.toLocaleTimeString());
        values.push(num);
    }

    // Create new chart object at canvas.
    const chart = new Chart(canvas, {
        // Line chart.
        type: "line",
        
        data: {
            labels: labels, // X-axis.
            datasets: [{ // Y-axis.
                label: "Sensor Data", // Legend name.
                data: values, // Numeric values.
                tension: 0.2 // Curve of line.
            }]
        },

        options: {
            responsive: true, // Chart re-sizes when screen size changes.
            maintainAspectRatio: false // Fill container height.
        }
    });

    // Store chart instance.
    activeCharts[topic] = chart;
}

// Converts dropdown selection to MS.
function getRangeMsFromCard(card) {
    // Select range from HTML.
    const rangeSelect = card.querySelector(".sensor-range");

    // If range is missing.
    if (!rangeSelect) {
        // Defualt to 24 hours.
        return 24 * 60 * 60 * 1000;
    }

    // Selected range.
    const value = rangeSelect.value;

    // 10 minutes.
    if (value === "10m") {
        return 10 * 60 * 1000;
    }

    // 1 hour.
    if (value === "1h") {
        return 1 * 60 * 60 * 1000;
    }

    // 6 hours.
    if (value === "6h") {
        return 6 * 60 * 60 * 1000;
    }

    // 24 hours.
    if (value === "24h") {
        return 24 * 60 * 60 * 1000;
    }

    // Default to 24 hours.
    return 24 * 60 * 60 * 1000;
}

// Filter history docs to the last "rangeMs".
function filterByRange(historyDocs, rangeMs, mode) {
    // Epoch time.
    const now = Date.now();

    // For each element in doc.
    return historyDocs.filter(doc => {
        // Get time stamp of doc.
        const timestamp = getDocTimeMs(doc, mode);
        
        // Only keep docs published less then the range.
        return (now - timestamp) <= rangeMs;
    });
}

// Refresh details based on cache.
async function refreshCardDetails(card) {
    // Select topic and unit.
    const topic = card.dataset.topic;
    const unit = card.dataset.unit || "";

    // Determine selected range and desired mode.
    const rangeMs = getRangeMsFromCard(card);
    const mode = shouldUseAggregates(rangeMs) ? "agg" : "raw";

    // If history is not cached yet or cache is wrong mode, load it.
    if (!historyCache[topic] || historyCache[topic].mode !== mode) {
        await loadStatsForOneCard(card);
        return;
    }

    const allDocs = historyCache[topic].docs;

    // Filter docs by range using correct time field.
    const filteredDocs = filterByRange(allDocs, rangeMs, mode);

    // Compute stats (raw vs agg).
    const stats = computeStats(filteredDocs, mode);

    updateCardStatsUI(card, stats, unit);

    renderChartForCard(card, filteredDocs, mode);
}


// Refresh latest values.
async function refreshLatestLoop() {
    // If latest values are currently refreshing.
    if (isRefreshingLatest) {
        // Do nothing.
        return;
    }

    // Set boolean value to true.
    isRefreshingLatest = true;

    try {
        // Load latesst values.
        await loadLatestForAllCards();
    } catch (err) {
        // Catch any errors.
        console.warn("Auto-refresh latest failed:", err.message);
    } finally {
        // Revert boolean value.
        isRefreshingLatest = false;
    }
}


// Refresh the currently open card details.
async function refreshOpenCardDetailsLoop() {
    // If no card is open.
    if (!openTopic) {
        // Do nothing
        return;
    }

    // If details are currently refreshing.
    if (isRefreshingDetails) {
        // Do nothing.
        return;
    }

    // Set boolean value to true.
    isRefreshingDetails = true;

    try {
        // Find which card is open.
        const card = findCardByTopic(openTopic);

        // Safety check.
        if (!card) {
            // Delete value in openTopic.
            openTopic = null;
            
            // Do nothing.
            return;
        }

        // Force refresh history for this topic (avoid using cached data).
        delete historyCache[openTopic];
        await loadStatsForOneCard(card);

    } catch (err) {
        // Catch any errors.
        console.warn("Auto-refresh details failed:", err.message);
    } finally {
        // Revert boolean value.
        isRefreshingDetails = false;
    }
}

// Builds a single alert row element.
function createAlertRow(alertDoc) {

    const row = document.createElement("div");
    row.classList.add("alert-row");

    // Severity styling
    if (alertDoc.severity === "warn") {
        row.classList.add("warn");
    }

    if (alertDoc.severity === "critical") {
        row.classList.add("critical");
    }

    const tsText = alertDoc.ts ? new Date(alertDoc.ts).toLocaleString() : "-";
    const topicText = alertDoc.topic || "-";
    const eventText = alertDoc.event ? alertDoc.event.toUpperCase() : "-";
    const sevText = alertDoc.severity ? alertDoc.severity.toUpperCase() : "-";
    const msgText = alertDoc.message || "";

    row.innerHTML =
        "<div><b>" + sevText + "</b> | " + eventText + " | " + msgText + "</div>" +
        "<div class='alert-meta'>" + tsText + " • " + topicText + "</div>";

    return row;
}


// Loads alerts and updates UI.
async function loadRecentAlerts() {

    const container = document.getElementById("alertsList");

    if (!container) {
        return;
    }

    try {
        const response = await getAlerts(20);
        const alerts = Array.isArray(response.data) ? response.data : [];

        // Clear existing UI
        container.innerHTML = "";

        // If none
        if (alerts.length === 0) {
            const empty = document.createElement("div");
            empty.classList.add("alerts-empty");
            empty.textContent = "No recent alerts.";
            container.appendChild(empty);
            return;
        }

        // Add each alert
        for (const alertDoc of alerts) {
            container.appendChild(createAlertRow(alertDoc));
        }

    } catch (err) {
        console.warn("Failed to load alerts:", err.message);
    }
}

// Main entry point to program.
async function main() {
    // Enable card expansion.
    enableExpansion();
    
    // Update each cards value.
    await loadLatestForAllCards();

    // Load alerts once on startup.
    await loadRecentAlerts();

    // Auto-refresh latest values every 5 seconds.
    setInterval(refreshLatestLoop, LATEST_REFRESH_MS);

    // Auto-refresh open card details every 15 seconds.
    setInterval(refreshOpenCardDetailsLoop, DETAILS_REFRESH_MS);

    // Refresh alerts every 15 seconds.
    setInterval(loadRecentAlerts, ALERTS_REFRESH_MS);
}

// Start the program.
main();