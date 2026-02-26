// Load and store environment variables from .env into process.env.
require("dotenv").config();

// Allow the use of alert and email files.
const alertEngine = require("./alertEngine");
const emailService = require("./emailService");

// Library to connect and subscribe to MQTT broker.
const mqtt = require("mqtt");

// Load the MongoDB library and extract the MongoClient.
const mongodb = require("mongodb");
const MongoClient = mongodb.MongoClient;

// Attempts to convert the MQTT payload to appropriate data type.
function parseValue(rawString) {
    // Prevents termination if MQTT does not publish a valid payload.
    if (rawString === null || rawString === undefined) {
        return null;
    }

    // Remove whitespace from payload.
    const trimmed = rawString.trim();

    // Invalid payload.
    if (trimmed.length === 0) {
        return null;
    }

    // Attempt to parse payload as number.
    const parsedNumber = Number(trimmed);

    // If it successfully parsed, return the payload as a number.
    if (!Number.isNaN(parsedNumber)) {
        return parsedNumber;
    }

    // If it did not parse, return as a string.
    return trimmed;
}

// Function to validate environment variables.
function validateEnv() {
    const required = ["MONGO_URI", "MONGO_DB", "MONGO_COLLECTION", "MQTT_URL", "MQTT_TOPIC", "MONGO_ALERTS_COLLECTION", "MONGO_ALERT_STATE_COLLECTION"];
    for (const key of required) {
        if (!process.env[key]) {
            console.error(`Missing required environment variable: ${key}`);
            process.exit(1);
        }
    }
}

// Connects to MongoDB Atlas and returns the connected client.
async function connectToMongo() {
    console.log("Connecting to MongoDB Atlas...");

    // Create client object using connection string.
    const client = new MongoClient(process.env.MONGO_URI);
    
    // Test client by attempting to connect to the cluster.
    await client.connect();

    console.log("MongoDB connected.");

    // Return the client.
    return client;
}

// Returns the specific collection where sensor readings are stored.
function getCollection(mongoClient) {
    // Selects the specific database inside cluster.
    const db = mongoClient.db(process.env.MONGO_DB);

    // Returns the specific collection inside database.
    return db.collection(process.env.MONGO_COLLECTION);
}

// Connects to MQTT broker, subscribes and returns client.
function connectToMqtt() {
    console.log("Connecting to MQTT broker:", process.env.MQTT_URL);

    // Create client object using broker URL.
    const client = mqtt.connect(process.env.MQTT_URL);

    // On connect (predefined event name in MQTT library), run the callback function.
    client.on("connect", function () {
        console.log("MQTT connected.");

        // Select the MQTT topic.
        const topic = process.env.MQTT_TOPIC;

        // Choose quality of service (speed/reliability balance).
        const qos = Number(process.env.MQTT_QOS);

        // Attempt to subscribe to topic, callback function to error check.
        client.subscribe(topic, { qos }, function (err) {
            // If there was an error, log it return null to exit function.
            if (err) {
                console.error("MQTT subscribe error:", err.message);
                return;
            }

            // Successfully subscribed to topic.
            console.log("Subscribed to:", topic);
            console.log("Collector running. Waiting for MQTT messages...\n");
        });
    });

    // On error, run the callback function.
    client.on("error", function (err) {
        console.error("MQTT error:", err.message);
    });

    // Return the client.
    return client;
}

// MongoDB document structure.
function createDocument(topic, parsedValue, raw) {
    return {
        source: "ESP32", // The source of the reading.
        topic: topic, // MQTT topic name.
        value: parsedValue, // Parsed number or string.
        raw: raw, // MQTT payload.
        ts: new Date(), // Server timestamp.
    };
}

// Handles messages and inserts into collection.
function registerMessageHandler(mqttClient, collection, db, emailTransporter) {
    // On message, run the async callback function.
    mqttClient.on("message", async function (topic, payload) {
        // Convert payload bytes to a string.
        const raw = payload.toString("utf8");

        // Parse to number if possible.
        const parsedValue = parseValue(raw);

        // Create the document.
        const doc = createDocument(topic, parsedValue, raw);

        // Attempt to insert document into collection.
        try {
            await collection.insertOne(doc);
            console.log("INSERTED", topic, "->", parsedValue);

            const numValue = Number.isFinite(parsedValue) ? parsedValue : Number(parsedValue);
            await alertEngine.processAlert(db, topic, numValue, doc, emailTransporter);
        } catch (err) {
            console.error("MongoDB insert failed:", err.message);
        }
  });
}

// Clean shutdown function.
function cleanShutdown(mqttClient, mongoClient) {
    // On SIGINT (interrupt signal), run the callback function.
    process.on("SIGINT", async function () {
        try {
            // Attempt to disconnect from broker.
            mqttClient.end(true);

            // Attempt to disconnect from MongoDB.
            await mongoClient.close();

            console.log("Shutdown complete.");
        } finally {
            // Terminate program.
            process.exit(0);
        }
    });
}

// Funtion to create alert based indexes.
async function ensureAlertIndexes(db) {
    // Obtain alert based collections.
    const alertsCol = db.collection(process.env.MONGO_ALERTS_COLLECTION);
    const stateCol = db.collection(process.env.MONGO_ALERT_STATE_COLLECTION);

    // Apply appropiate indexes.
    await alertsCol.createIndex({ topic: 1, ts: -1 });
    await stateCol.createIndex({ key: 1 }, { unique: true });

    console.log("Alert indexes ensured.");
}

// Program entry point.
async function main() {
    console.log("Starting MQTT to MongoDB collector...");

    // Ensure environment variables are present.
    validateEnv();

    // Declare MongoDB client varaible.
    let mongoClient = null;

    try {
        // Attempt to connect to MongoDB and obtain client.
        mongoClient = await connectToMongo();
    } catch (err) {
        // Catch any errors and terminate program.
        console.error("Failed to connect to MongoDB:", err.message);
        process.exit(1);
    }

    // Declare transporter for email.
    let emailTransporter = null;

    try {
        // Create email transporter using nodemailer.
        emailTransporter = emailService.createTransportFromEnv();
        console.log("Email transporter ready.");
    } catch (err) {
        // Catch any errors.
        console.warn("Email disabled:", err.message);
    }

    // Select database.
    const db = mongoClient.db(process.env.MONGO_DB);

    // Get the MongoDB collection we need to insert to.
    const collection = getCollection(mongoClient);
    console.log("MongoDB collection ready:", process.env.MONGO_COLLECTION);

    // Apply indexes to alert collections.
    await ensureAlertIndexes(db);

    // Connect to MQTT and return client.
    const mqttClient = connectToMqtt();

    // Start message handler.
    registerMessageHandler(mqttClient, collection, db, emailTransporter);

    // Clean shutdown.
    cleanShutdown(mqttClient, mongoClient);
}

// Start program by calling main.
main();