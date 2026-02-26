// Load and store environment variables from .env into process.env.
require("dotenv").config();

// Load the MongoDB library and extract the MongoClient.
const mongodb = require("mongodb");
const MongoClient = mongodb.MongoClient;

// Parse environment variables.
function parseEnv(name, fallback) {
    // Obtain environment variable given name.
    const raw = process.env[name];

    // If environment variable is not set.
    if (raw === null || raw === undefined) {
        // Just use fallback number.
        return fallback;
    }

    // Attempt to convert to number.
    const parsed = Number(raw);

    // If conversion failed.
    if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
        return fallback;
    }

    // Return rounded number.
    return Math.floor(parsed);
}

// Function to validate environment variables.
function validateEnv() {
    const required = ["MONGO_URI", "MONGO_DB", "MONGO_COLLECTION", "MONGO_AGG_COLLECTION"];
    for (const key of required) {
        if (!process.env[key]) {
            console.error(`Missing required environment variable: ${key}`);
            process.exit(1);
        }
    }
}

// Convert date down to nearest bucket boundary (14:37 becomes 14:30).
function getBucketStartTime(dateObj, bucketMinutes) {
    // Convert bucket size from minutes to MS.
    const bucketMs = bucketMinutes * 60 * 1000;
    
    // Epoch time.
    const ms = dateObj.getTime();
    
    // Get start of bucket in epoch time.
    const flooredMs = Math.floor(ms / bucketMs) * bucketMs;
    
    // Convert epoch time back to date format.
    return new Date(flooredMs);
}

// Returns the start and the end time of previous bucket.
function getLastCompletedBucket(now, bucketMinutes) {
    // Get nearest bucket boundary.
    const currentBucketStart = getBucketStartTime(now, bucketMinutes);
    
    // End of previous bucket.
    const end = currentBucketStart;
    
    // Start of previous bucket.
    const start = new Date(end.getTime() - bucketMinutes * 60 * 1000);
    
    // Return start and end as object.
    return { start, end };
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

// Returns the specific collection where RAW sensor readings are stored.
function getRawCollection(mongoClient) {
    // Selects the specific database inside cluster.
    const db = mongoClient.db(process.env.MONGO_DB);

    // Returns the RAW collection inside database.
    return db.collection(process.env.MONGO_COLLECTION);
}

// Returns the specific collection where AGGREGATED readings are stored.
function getAggCollection(mongoClient) {
    // Selects the specific database inside cluster.
    const db = mongoClient.db(process.env.MONGO_DB);

    // Returns the AGG collection inside database.
    return db.collection(process.env.MONGO_AGG_COLLECTION);
}

// Ensure indexes are created.
async function ensureIndexes(rawCollection, aggCollection) {
    // Sort RAW by ascending topics and decsending timestamps.
    await rawCollection.createIndex({ topic: 1, ts: -1 });

    // Sort AGG by ascending topics and descending start intervals.
    await aggCollection.createIndex({ topic: 1, intervalStart: -1 });

    // Each topic and start interval must be unique, prevents duplicates.
    await aggCollection.createIndex({ topic: 1, intervalStart: 1 }, { unique: true });
}

// MongoDB aggregate document structure.
function createAggregateDocument(topic, start, end, stats) {
    return {
        topic: topic, // MQTT topic.
        intervalStart: start, // Start of bucket.
        intervalEnd: end, // End of bucket.
        avg: stats.avg, // Average value in bucket.
        min: stats.min, // Minimum value in bucket.
        max: stats.max, // Maximum value in bucket.
        count: stats.count, // Number of doc in bucket.
        ts: new Date(), // Timestamp.
    };
}

// Runs aggregation for last completed bucket.
async function runAggregationOnce(rawCollection, aggCollection, bucketMinutes) {
    // Current time.
    const now = new Date();
    
    // Previous bucket timeframe.
    const window = getLastCompletedBucket(now, bucketMinutes);

    console.log("Aggregating window:", window.start.toISOString(), "->", window.end.toISOString());

    const matchStage = {
        // Filter documents.
        $match: {
            // Where ts is greater or equal to start and less than end.
            ts: { $gte: window.start, $lt: window.end },
            
            // Value is numeric.
            value: { $type: "number" },
        }
    };

    const groupStage = {
        // Group documents.
        $group: {
            _id: "$topic", // By topic.
            avg: { $avg: "$value" }, // Compute average value in group.
            min: { $min: "$value" }, // Compute minimum value in group.
            max: { $max: "$value" }, // Compute maximum value in group.
            count: { $sum: 1 }, // Number of docs in group.
        }
    };

    // Ordered list of steps combined.
    const pipeline = [matchStage, groupStage];

    // Empty array to store results.
    let results = [];
    
    try {
        // Aggregate is a more powerful find(), returns a cursor (pointer).
        const cursor = rawCollection.aggregate(pipeline);
        
        // Convert the cursor to an array.
        results = await cursor.toArray();

        } catch (err) {
            // Catch any errors.
            console.error(err);
            return;
    }

    // If nothing found.
    if (results.length === 0) {
        // Do nothing.
        console.log("No numeric raw data found for this window. Skipping.\n");
        return;
    }

    // For each row (topic).
    for (const row of results) {
        // Obtain topic.
        const topic = row._id;

        // Create document.
        const doc = createAggregateDocument(topic, window.start, window.end, {
            // Stats object.
            avg: row.avg,
            min: row.min,
            max: row.max,
            count: row.count,
        });

        try {
            // Update one doc.
            await aggCollection.updateOne(
                // Filter by topic and start time.
                { topic: topic, intervalStart: window.start },
                
                // Match and update all fields in doc.
                { $set: doc },
                
                // Update if found, insert if not.
                { upsert: true }
            );

            console.log("AGG UPSERT", topic, "count=", row.count, "avg=", Number(row.avg).toFixed(3));

        } catch (err) {
            // Catch any errors.
            console.error("MongoDB aggregate upsert failed:", err.message);
        }
    }

    console.log("Aggregation complete.\n");
}

// Starts a repeating timer to aggregate at an interval.
function startScheduler(rawCollection, aggCollection, bucketMinutes, runEverySeconds) {
    // Run callback function.
    const timer = setInterval(async function () {
        try {
            // Run aggregation.
            await runAggregationOnce(rawCollection, aggCollection, bucketMinutes);
        } catch (err) {
            // Catch any errors.
            console.error("Aggregation run failed:", err.message);
        }
    }, 
    
    // Run every five minutes.
    runEverySeconds * 1000);

    return timer;
}

// Clean shutdown function.
function cleanShutdown(mongoClient, timerHandle) {
    // On SIGINT (interrupt signal), run the callback function.
    process.on("SIGINT", async function () {
        try {
            // Stop scheduler.
            if (timerHandle) {
                clearInterval(timerHandle);
            }

            // Attempt to disconnect from MongoDb.
            await mongoClient.close();

            console.log("Shutdown complete.");
        } finally {
            // Terminate program.
            process.exit(0);
        }
    });
}

// Program entry point.
async function main() {
    console.log("Starting MongoDB aggregation service...");

    // Ensure environment variables exist.
    validateEnv();

    // Read config from env with fallbacks.
    const bucketMinutes = parseEnv("AGG_BUCKET_MINUTES", 30);
    const runEverySeconds = parseEnv("AGG_RUN_EVERY_SECONDS", 300);

    // Declare MongoDB client variable.
    let mongoClient = null;

    try {
        // Attempt to connect to MongoDB and obtain client.
        mongoClient = await connectToMongo();
    } catch (err) {
        // Catch any errors and terminate program.
        console.error("Failed to connect to MongoDB:", err.message);
        process.exit(1);
    }

    // Get the collections.
    const rawCollection = getRawCollection(mongoClient);
    const aggCollection = getAggCollection(mongoClient);

    console.log("MongoDB raw collection ready:", process.env.MONGO_COLLECTION);
    console.log("MongoDB agg collection ready:", process.env.MONGO_AGG_COLLECTION);

    try {
        // Ensure indexes exist.
        await ensureIndexes(rawCollection, aggCollection);
        console.log("Indexes ensured.");
    } catch (err) {
        // Catch any errors.
        console.error("Failed to ensure indexes:", err.message);
    }

    try {
        // Run once immediately at startup.
        await runAggregationOnce(rawCollection, aggCollection, bucketMinutes);
    } catch (err) {
        // Catch any errors.
        console.error("Aggregation run failed:", err.message);
    }

    // Start the scheduler.
    const timerHandle = startScheduler(
        rawCollection,
        aggCollection,
        bucketMinutes,
        runEverySeconds
    );

    console.log("Aggregator running. Bucket:", bucketMinutes, "minutes. Tick every:", runEverySeconds, "seconds.\n");

    // Clean shutdown.
    cleanShutdown(mongoClient, timerHandle);
}

// Start program by calling main.
main();