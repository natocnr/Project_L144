#include <WiFi.h> // Allows board to connect to WiFi.
#include <PubSubClient.h>     // Allows board to communicate via MQTT.

#include "secrets.h" // Configuration file.

#include <OneWire.h> // Hnadles communication with sensor.
#include <DallasTemperature.h> // Converts raw sensore data to temperature.

const char* ssid = WIFI_SSID; // WiFi ssid.
const char* password = WIFI_PASSWORD; // WiFi password.

const char* mqttServer = MQTT_SERVER; //Computers IPv4 address.
const int mqttPort = MQTT_PORT; // Default MQTT port.

const int ONE_WIRE_BUS = 4;   // GPIO pin that the sensors data wire is connected to.
OneWire oneWire(ONE_WIRE_BUS); // Object for OneWire communication.
DallasTemperature sensors(&oneWire); // Temperature reading obeject.

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

  sensors.begin();   // Start the DS18B20 sensor.
}

void loop() {
  if (!mqttClient.connected()) { // If connection has dropped, re-connect.
    connectToMQTT();
  }

  mqttClient.loop(); // Keep MQTT connection alive.

  sensors.requestTemperatures(); // Ask sensor to read temperature.
  float temperatureC = sensors.getTempCByIndex(0); // Store reading in Celsius.

  char tempString[8];
  dtostrf(temperatureC, 1, 2, tempString); // Convert float to string so it can be passed in MQTT.

  mqttClient.publish("aquarium/temperature", tempString);  // Publish temperature to topic.
  Serial.print("Temperature sent: ");
  Serial.print(tempString);
  Serial.println(" °C");

  delay(5000);
}
