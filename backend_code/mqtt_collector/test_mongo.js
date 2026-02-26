require("dotenv").config();
const { MongoClient } = require("mongodb");

async function main() {
    const uri = process.env.MONGO_URI;
    const dbName = process.env.MONGO_DB;
    const collectionName = process.env.MONGO_COLLECTION;

    console.log("Connecting to MongoDB Atlas...");

    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log("Connected");

        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        const doc = {
            type: "test_connection",
            note: "MongoDB Atlas connection OK",
            ts: new Date()
        };

        const result = await collection.insertOne(doc);
        console.log("Inserted test document with _id:", result.insertedId);
    } catch (err) {
        console.error("MongoDB error:", err.message);
    } finally {
        await client.close();
        console.log("Connection closed");
    }
}

main();