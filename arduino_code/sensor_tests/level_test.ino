#include <WiFi.h> // Allows board to connect to WiFi.
#include <PubSubClient.h> // Allows board to communicate via MQTT.

#include "secrets.h" // Configuration file.

const char* ssid = WIFI_SSID; // WiFi ssid.
const char* password = WIFI_PASSWORD; // WiFi password.

const char* mqttServer = MQTT_SERVER; // Computers IPv4 address.
const int mqttPort = MQTT_PORT; // Default MQTT port.

const int FLOAT_PIN = 27; // GPIO pin connected to float switch.

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

    if (mqttClient.connect("ESP32_FLOAT")) {
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

  pinMode(FLOAT_PIN, INPUT_PULLUP); // Uses internal pull-up resistor (default HIGH).
  Serial.println("Float switch MQTT test started.");
}

void loop() {
  if (!mqttClient.connected()) { // If connection has dropped, re-connect.
    connectToMQTT();
  }

  mqttClient.loop(); // Keep MQTT connection alive.

  int state = digitalRead(FLOAT_PIN); // Read switch state.

  if (state == HIGH) {
    mqttClient.publish("aquarium/sensors/level", "OPEN");
    Serial.println("Level sent: OPEN");
  } else {
    mqttClient.publish("aquarium/sensors/level", "CLOSED");
    Serial.println("Level sent: CLOSED");
  }

  delay(2000);
}
