require("dotenv").config();

console.log("MQTT_TOPIC:", process.env.MQTT_TOPIC);
console.log("MQTT_URL:", process.env.MQTT_URL);
console.log("MONGO_DB:", process.env.MONGO_DB);