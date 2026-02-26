require("dotenv").config();
const mqtt = require("mqtt");

console.log("Connecting to MQTT broker:", process.env.MQTT_URL);

const client = mqtt.connect(process.env.MQTT_URL);

client.on("connect", function () {
    console.log("Connected to MQTT");

    const topic = process.env.MQTT_TOPIC;
    client.subscribe(topic, { qos: 0 }, function (err) {
        if (err) {
            console.error("Subscribe error:", err.message);
            return;
        }
        console.log("Subscribed to:", topic);
        console.log("Waiting for messages...\n");
    });
});

client.on("error", function (err) {
    console.error("MQTT error:", err.message);
});
