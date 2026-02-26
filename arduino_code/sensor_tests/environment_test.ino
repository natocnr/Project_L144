#include <WiFi.h> // Allows board to connect to WiFi.
#include <PubSubClient.h> // Allows board to communicate via MQTT.

#include "secrets.h" // Configuration file.

#include <Wire.h> // Handles I2C communication.
#include <Adafruit_Sensor.h> // Adafruit sensor base library.
#include <Adafruit_BME280.h> // Allows board to read BME280 sensor.

const char* ssid = WIFI_SSID; // WiFi ssid.
const char* password = WIFI_PASSWORD; // WiFi password.

const char* mqttServer = MQTT_SERVER; // Computers IPv4 address.
const int mqttPort = MQTT_PORT; // Default MQTT port.

Adafruit_BME280 bme; // BME280 sensor object.

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
    if (mqttClient.connect("ESP32_BME280")) {
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

  // Start the BME280 sensor (0x76 is the address we detected in the scanner).
  if (!bme.begin(0x76)) {
    Serial.println("BME280 failed to start.");
    while (1) {
      delay(1000); // Stop here if sensor is not found.
    }
  }

  Serial.println("BME280 started successfully.");
}

void loop() {
  if (!mqttClient.connected()) { // If connection has dropped, re-connect.
    connectToMQTT();
  }

  mqttClient.loop(); // Keep MQTT connection alive.

  float temperatureC = bme.readTemperature(); // Read temperature in Celsius.
  float humidity = bme.readHumidity(); // Read humidity as percentage.
  float pressureHpa = bme.readPressure() / 100.0F; // Read pressure in hPa.

  char tempString[16];
  char humidityString[16];
  char pressureString[16];

  dtostrf(temperatureC, 1, 2, tempString); // Convert float to string so it can be passed in MQTT.
  dtostrf(humidity, 1, 2, humidityString); // Convert float to string so it can be passed in MQTT.
  dtostrf(pressureHpa, 1, 2, pressureString); // Convert float to string so it can be passed in MQTT.

  mqttClient.publish("aquarium/sensors/environment/temperature", tempString); // Publish temperature to topic.
  mqttClient.publish("aquarium/sensors/environment/humidity", humidityString); // Publish humidity to topic.
  mqttClient.publish("aquarium/sensors/environment/pressure", pressureString); // Publish pressure to topic.

  Serial.print("Temperature sent: ");
  Serial.print(tempString);
  Serial.println(" °C");

  Serial.print("Humidity sent: ");
  Serial.print(humidityString);
  Serial.println(" %");

  Serial.print("Pressure sent: ");
  Serial.print(pressureString);
  Serial.println(" hPa");

  Serial.println("------------------------");

  delay(5000);
}
