// Load and store environment variables from .env into process.env.
require("dotenv").config();

// Load the MongoDB library and extract the MongoClient.
const mongodb = require("mongodb");
const MongoClient = mongodb.MongoClient;

// Safely convert an environment variable to a whole number.
function parseEnv(name, fallback) {
    // Obtain env variable.
    const raw = process.env[name];

    // If it is not valid.
    if (raw === null || raw === undefined) {
        // Use fallback value.
        return fallback;
    }

    // Attempt to convert to number.
    const parsed = Number(raw);

    // If conversion fails.
    if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
        return fallback;
    }

    // Return rounded number.
    return Math.floor(parsed);
}

// Connects to MongoDB Atlas and returns the connected client.
async function connectToMongo() {
    console.log("Connecting to MongoDB Atlas...");

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();

    console.log("MongoDB connected.");
    return client;
}

// Returns the specific collection where RAW sensor readings are stored.
function getRawCollection(mongoClient) {
    const db = mongoClient.db(process.env.MONGO_DB);
    return db.collection(process.env.MONGO_COLLECTION);
}

// Program entry point.
async function main() {
    console.log("Starting TTL setup...");

    // Obtian ttl value in days.
    const ttlDays = parseEnv("RAW_TTL_DAYS", 14);
    
    // Convert to seconds.
    const expireAfterSeconds = ttlDays * 24 * 60 * 60;

    // Declare Mongo client.
    let mongoClient = null;

    try {
        // Connect to Mongo and return client.
        mongoClient = await connectToMongo();
    } catch (err) {
        // Catch any errors.
        console.error("Failed to connect to MongoDB:", err.message);
        process.exit(1);
    }

    // Get specific collection.
    const rawCollection = getRawCollection(mongoClient);

    console.log("Raw collection:", process.env.MONGO_COLLECTION);
    console.log("Raw TTL days:", ttlDays);
    console.log("expireAfterSeconds:", expireAfterSeconds);

    try {
        // Add ttl index, docs will automatically expire if older than 14 days.
        await rawCollection.createIndex({ ts: 1 }, { expireAfterSeconds: expireAfterSeconds });

        console.log("TTL index created.");
    } catch (err) {
        // Catch any errors.
        console.error("Failed to create TTL index:", err.message);
    } finally {
        // Close mongo connection.
        await mongoClient.close();
        console.log("Done.");
    }
}

// Start the program.
main();