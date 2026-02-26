// Load environment variables from .env into process.env.
require("dotenv").config();

// Import Express for building the HTTP API.
const express = require("express");

// Load the MongoDB library and extract the MongoClient.
const mongodb = require("mongodb");
const MongoClient = mongodb.MongoClient;

// Import CORS, allows frontend to call API.
const cors = require("cors"); 

// Obtain port from environment variables.
function getPort() {
    // Check if port environment variables exists.
    if (process.env.PORT) {
        return Number(process.env.PORT);
    } 
    
    // Otherwise, use port 3000.
    return 3000;
}

// Function to validate environment variables.
function validateEnv() {
    const required = ["MONGO_URI", "MONGO_DB", "MONGO_COLLECTION", "MONGO_AGG_COLLECTION", "MONGO_ALERTS_COLLECTION"];
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

// Returns collection where sensor readings are stored.
function getCollection(mongoClient) {
    // Selects the specific database inside cluster.
    const db = mongoClient.db(process.env.MONGO_DB);

    // Returns the specific collection inside database.
    return db.collection(process.env.MONGO_COLLECTION);
}

// Returns collection where aggregated readings are stored.
function getAggCollection(mongoClient) {
    // Selects the specific database inside cluster.
    const db = mongoClient.db(process.env.MONGO_DB);
    
    // Returns the specific collection inside database.
    return db.collection(process.env.MONGO_AGG_COLLECTION);
}

// Returns collection where alerts are stored.
function getAlertsCollection(mongoClient) {
    // Selects the specific database inside cluster.
    const db = mongoClient.db(process.env.MONGO_DB);
    
    // Returns the specific collection inside database.
    return db.collection(process.env.MONGO_ALERTS_COLLECTION);
}

// Ensures that index exists.
async function ensureIndexes(collection) {
    console.log("Ensuring MongoDB index exists...");
    
    // Sort topics by ascending order and timestamps by descending order.
    // If index dont already exist, it will create them otherwise do nothing.
    await collection.createIndex({ topic: 1, ts: -1 });
    
    console.log("Index ready.");
}

// Ensures that indexes exist for aggregated collection.
async function ensureAggIndexes(aggCollection) {
    console.log("Ensuring MongoDB aggregate indexes exist...");

    // Sort topics by ascending order and bucket starts by descending order.
    await aggCollection.createIndex({ topic: 1, intervalStart: -1 });

    // Prevent duplicates (topic and intervalStart must be unique).
    await aggCollection.createIndex({ topic: 1, intervalStart: 1 }, { unique: true });

    console.log("Aggregate indexes ready.");
}

// Create express app and enable CORS.
function createApp() {
    // Create new express app.
    const app = express();

    // Enable CORS so frontend can call API.
    app.use(cors());

    // Return CORS enables express app.
    return app;
}

// Validates and parses ISO date.
function parseDate(dateParam) {
    // If it is undefined.
    if (dateParam === undefined) {
        // Return nothing.
        return null;
    }

    // Convert string to date.
    const date = new Date(String(dateParam));

    // If conversion failed.
    if (Number.isNaN(date.getTime())) {
        // Return nothing.
        return null;
    }

    // Otherwise, return date.
    return date;
}

// Health route.
function registerHealthRoute(app) {
  app.get("/health", function (req, res) {
    res.json({
      status: "ok",
      service: "aquarium-api",
      ts: new Date().toISOString(),
    });
  });
}

// Adds latest route, returns most recent reading for any given topic.
function registerLatestRoute(app, collection) {
    // Define a GET endpoint at "/latest".
    app.get("/latest", async function (req, res) {
        // Extract "topic" query parameter from the request URL.
        const topic = req.query.topic;

        // Validate topic.
        if (!topic) {
            // Log error and do nothing.
            res.status(400).json({ error: "Missing required query parameter: topic" });
            return;
        }

        try {
            // Query MongoDB to find most recent document.
            // The topic must match and we sort timestamps in descending order.
            const latestDoc = await collection.findOne(
                { topic: topic },
                { sort: { ts: -1 } }
            );

            // If no document was found, return 404 (Not Found).
            if (!latestDoc) {
                res.status(404).json({ error: "No data found for topic", topic: topic });
                
                // Return null.
                return;
            }

            // Return document as JSON.
            res.json(latestDoc);
        } catch (err) {
            // If an error occurs, return 500 (Internal server error.)
            console.error("Error fetching latest reading:", err.message);
            res.status(500).json({ error: "Internal Server error" });
        }
    });
}

// Adds topics route, returns list of all unique topics stored in database.
function registerTopicsRoute(app, collection) {
    // Define a GET endpoint at "/topics".
    app.get("/topics", async function (req, res) {
        try {
            // Query MongoDB to find all unique topic values.
            const topics = await collection.distinct("topic");
            
            // Return list of topics in JSON.
            res.json(topics);
        } catch (err) {
            // If an error occurs, return 500 (Internal server error).
            console.error("Error fetching topics:", err.message);
            res.status(500).json({ error: "Internal server error" });
        }
    });
}

// Returns latest alert events.
function registerAlertsRoute(app, alertsCollection) {
    // Define a GET endpoint at "/alerts".
    app.get("/alerts", async function (req, res) {

        const limit = parseLimit(req.query.limit);
        if (limit === null) {
            res.status(400).json({ error: "Limit must be a positive number." });
            return;
        }

        try {
            const docs = await alertsCollection
                .find({})
                .sort({ ts: -1 })
                .limit(limit)
                .toArray();

            res.json({ data: docs });

        } catch (err) {
            console.error("Error fetching alerts:", err.message);
            res.status(500).json({ error: "Internal server error" });
        }
    });
}

// Parses a limit paramter safely.
function parseLimit(limitParam) {
    // Default parse limit.
    let limit = 50;

    // If a specific limit has been entered.
    if (limitParam !== undefined) {
        // Get input as number.
        const parsed = Number(limitParam);

        // Check whether input is valid.
        if (Number.isNaN(parsed) || parsed <= 0) {
            // Return nothing.
            return null;
        }

        // Change limit to match input.
        limit = parsed;
    }

    // Limit is capped to protect server and database.
    if (limit > 1000) {
        limit = 1000;
    }

    // Return either default or user selected limit.
    return limit;
}

// Adds history route, returns the most recent N readings for any given topic.
function registerHistoryRoute(app, collection) {
    // Define a GET endpoint at "/history".
    app.get("/history", async function (req, res) {
        // Extract "topic" and "limitParam" query parameter from the request URL.
        const topic = req.query.topic;
        const limitParam = req.query.limit;

        // Validate topic.
        if (!topic) {
            // Log error and do nothing.
            res.status(400).json({ error: "Missing required query parameter: topic" });
            return;
        }

        // Validate limit using function.
        const limit = parseLimit(limitParam);
        if (limit === null) {
            res.status(400).json({ error: "Limit must be a positive number." });
            return;
        }

        try {
            const docs = await collection
                .find({ topic: topic }) // Topic must match.
                .sort({ ts: -1 }) // Most recent first.
                .limit(limit) // Number of documents.
                .toArray(); // Return as an array.

            res.json({
                topic: topic, // Topic name.
                count: docs.length, // Number of documents.
                limit: limit, // Set limit.
                data: docs // Array of documents.
            });
        } catch (err) {
            // If an error occurs, return 500 (Internal server error.)
            console.error("Error fetching history:", err.message);
            res.status(500).json({ error: "Internal server error" });
        }
    });
}

// Adds history agg route, returns aggregates for a given topic and time range.
function registerHistoryAggRoute(app, aggCollection) {
    // Define a GET endpoint at "/history-agg".
    app.get("/history-agg", async function (req, res) {
        // Extract "topic" and start/end query parameter from the request URL.
        const topic = req.query.topic;
        const startParam = req.query.start;
        const endParam = req.query.end;

        // Validate topic.
        if (!topic) {
            // Log error and do nothing.
            res.status(400).json({ error: "Missing required query parameter: topic" });
            return;
        }

        // Parse start/end if provided.
        const start = parseDate(startParam);
        const end = parseDate(endParam);

        // If date is invalid.
        if (startParam !== undefined && start === null) {
            // Log error and do nothing.
            res.status(400).json({ error: "Invalid start date. Use ISO format." });
            return;
        }

        if (endParam !== undefined && end === null) {
            // Log error and do nothing.
            res.status(400).json({ error: "Invalid end date. Use ISO format." });
            return;
        }

        // Build query, topic must match topic.
        const query = { topic: topic };

        // If start/end exist, add range filter on intervalStart.
        if (start !== null || end !== null) {
            // Add new field query object.
            query.intervalStart = {}; 
            
            if (start !== null) {
                // Add greater or equal than start.
                query.intervalStart.$gte = start;
            }
            
            if (end !== null) {
                // Add less than or equal to end.
                query.intervalStart.$lt = end;
            }
        }

        try {
            // Obtain documents from query sorted from oldest to newest as an array.
            const docs = await aggCollection.find(query).sort({ intervalStart: 1 }).toArray();

            // Return json response.
            res.json({
                topic: topic, // Topic.
                count: docs.length, // Number of docs.
                start: start ? start.toISOString() : null, // Start if exists.
                end: end ? end.toISOString() : null, // End if exists.
                data: docs // Documents.
            });

        } catch (err) {
            // Catch error.
            console.error("Error fetching aggregated history:", err.message);
            res.status(500).json({ error: "Internal server error" });
        }
    });
}


// Register all routes in one function.
function registerRoutes(app, collection, aggCollection, alertsCollection) {
    registerHealthRoute(app);
    registerLatestRoute(app, collection);
    registerTopicsRoute(app, collection);
    registerHistoryRoute(app, collection);
    registerHistoryAggRoute(app, aggCollection);
    registerAlertsRoute(app, alertsCollection);
}

// Starts Express server on specific port.
function startServer(app, port) {
    app.listen(port, function () {
        console.log(`API server listening on http://localhost:${port}`);
    });
}

// Clean shutdown using a signal interrupt.
function cleanShutdown(mongoClient) {
    // On Ctrl + c, run callback function.
    process.on("SIGINT", async function () {
        console.log("\nShutting down API server...");

        try {
            // Close connection.
            await mongoClient.close();
            console.log("MongoDB connection closed.");
        } finally {
            // Terminate program.
            process.exit(0);
        }
    });
}

// Program entry point.
async function main() {
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

    // Get the MongoDB collection we need for our routes.
    const collection = getCollection(mongoClient);
    const aggCollection = getAggCollection(mongoClient);
    const alertsCollection = getAlertsCollection(mongoClient);

    // Ensure indexes exist.
    await ensureIndexes(collection);
    await ensureAggIndexes(aggCollection);

    // Create Express app and register all routes.
    const app = createApp();
    registerRoutes(app, collection, aggCollection, alertsCollection);

    // Start the server on specific port.
    const port = getPort();
    startServer(app, port);

    // Clean shutdown hook.
    cleanShutdown(mongoClient);
}

// Start the program.
main();