#include <WiFi.h> // Allows board to connect to WiFi.
#include <PubSubClient.h> // Allows board to communicate via MQTT.

#include "secrets.h" // Configuration file.

const char* ssid = WIFI_SSID; // WiFi ssid.
const char* password = WIFI_PASSWORD; // WiFi password.

const char* mqttServer = MQTT_SERVER; // Computers IPv4 address.
const int mqttPort = MQTT_PORT; // Default MQTT port.

const int FLOW_PIN = 26; // GPIO pin connected to flow sensor signal.
volatile int pulseCount = 0; // Pulse counter (used by interrupt).

WiFiClient wifiClient; // Object for Wi-Fi connection.
PubSubClient mqttClient(wifiClient); // Object for MQTT connection.

void IRAM_ATTR pulseCounter() {
  pulseCount++; // Called every time a pulse occurs.
}

void connectToWiFi() {
  Serial.print("Connecting to Wi-Fi");
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("Wi-Fi connected!");
  Serial.print("ESP32 IP address: ");
  Serial.println(WiFi.localIP());
}

void connectToMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("Connecting to MQTT...");

    if (mqttClient.connect("ESP32_FLOW")) {
      Serial.println("MQTT Connected!");
    } else {
      Serial.print("Failed! Error code: ");
      Serial.println(mqttClient.state());
      delay(5000);
    }
  }
}

void setup() { // Runs once at start.
  Serial.begin(115200);
  connectToWiFi();
  mqttClient.setServer(mqttServer, mqttPort);

  pinMode(FLOW_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_PIN), pulseCounter, FALLING);

  Serial.println("Flow sensor MQTT test started.");
}

void loop() {
  if (!mqttClient.connected()) {
    connectToMQTT();
  }

  mqttClient.loop();

  pulseCount = 0;       // Reset counter
  delay(1000);          // Measure pulses for 1 second

  float flowRate = pulseCount / 7.5; // Litres per minute

  char flowString[16];
  dtostrf(flowRate, 1, 2, flowString);

  mqttClient.publish("aquarium/sensors/flow", flowString);

  Serial.print("Flow sent: ");
  Serial.print(flowString);
  Serial.println(" L/min");
}
