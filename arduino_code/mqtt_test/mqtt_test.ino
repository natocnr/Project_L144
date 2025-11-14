#include <WiFi.h> // Allows board to connect to WiFi.
#include <PubSubClient.h>     // Allows board to communicate via MQTT.

const char* ssid = "VM6806430"; // WiFi ssid.
const char* password = "qjSg9aYjk7ujmkun"; // WiFi password.

const char* mqttServer = "192.168.0.220"; //Computers IPv4 address.
const int mqttPort = 1883; // Default MQTT port.

WiFiClient wifiClient; // Object for Wi-Fi connection.
PubSubClient mqttClient(wifiClient); // Object for MQTT connection.

void connectToWiFi() {
  Serial.print("Connecting to Wi-Fi");
  WiFi.begin(ssid, password); // Initiate the WiFi connection with given credentials.

  // If not connected.
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  // If connected.
  Serial.println();
  Serial.println("Wi-Fi connected!");
  Serial.print("ESP32 IP address: ");
  Serial.println(WiFi.localIP());
}

void connectToMQTT() {
  // Until MQTT has connected.
  while (!mqttClient.connected()) {
    Serial.print("Connecting to MQTT...");

    if (mqttClient.connect("ESP32")) {
      Serial.println("MQTT Connected!");
    } else {
      Serial.println("Failed! Error code: ");
      Serial.print(mqttClient.state());
      delay(5000);
    }
  }
}

void setup() { // Runs once at start.
  Serial.begin(115200); // Start serial monitor at 115200 bauds.
  connectToWiFi(); // Connect to WiFi.
  mqttClient.setServer(mqttServer, mqttPort); // Stating which MQTT broker to use.
}

void loop() {
  if (!mqttClient.connected()) { // If connection has dropped, re-connect.
    connectToMQTT();
  }

  mqttClient.loop(); // Keep MQTT connection alive.

  mqttClient.publish("aquarium/temperature", "Hello from ESP32!"); // Send test message to the topic "aquarium/temperature".
  Serial.println("Message sent to MQTT broker!");

  delay(5000);
}
