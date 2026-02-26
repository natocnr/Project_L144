#include <WiFi.h> // Allows board to connect to WiFi.
#include <PubSubClient.h> // Allows board to communicate via MQTT.

#include <Wire.h> // Handles I2C communication.
#include <BH1750.h> // Allows board to read lux from BH1750 sensor.

#include "secrets.h" // Configuration file.

const char* ssid = WIFI_SSID; // WiFi ssid.
const char* password = WIFI_PASSWORD; // WiFi password.

const char* mqttServer = MQTT_SERVER; // Computers IPv4 address.
const int mqttPort = MQTT_PORT; // Default MQTT port.

BH1750 lightMeter; // Light sensor object.

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

    // Different client ID to avoid clashing with other sketches.
    if (mqttClient.connect("ESP32_BH1750")) {
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

  Wire.begin(); // Start I2C communication (SDA=21, SCL=22 by default on ESP32).

  // Start the BH1750 sensor.
  if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
    Serial.println("BH1750 started successfully.");
  } else {
    Serial.println("BH1750 failed to start.");
  }
}

void loop() {
  if (!mqttClient.connected()) { // If connection has dropped, re-connect.
    connectToMQTT();
  }

  mqttClient.loop(); // Keep MQTT connection alive.

  float lux = lightMeter.readLightLevel(); // Read current light level in lux.

  char luxString[16];
  dtostrf(lux, 1, 2, luxString); // Convert float to string so it can be passed in MQTT.

  mqttClient.publish("aquarium/sensors/light", luxString); // Publish light level to topic.
  Serial.print("Light sent: ");
  Serial.print(luxString);
  Serial.println(" lx");

  delay(5000);
}
