#include <WiFi.h> // Allows the ESP32 to connect to a Wi-Fi network.
#include <PubSubClient.h> // Allows the ESP32 to publish/subscribe using MQTT.
#include <OneWire.h> // Handles communication with DS18B20 sensor.
#include <DallasTemperature.h> // Converts raw sensor data to temperature.
#include <Wire.h> // Handles I2C communication.
#include <BH1750.h> // Allows ESP32 to read light level from BH1750.

const char* ssid = "VM6806430"; // Name of Wi-Fi network.
const char* password = "qjSg9aYjk7ujmkun"; // Password for Wi-Fi network.

const char* mqttServer = "192.168.0.220"; // IP address of computer running Mosquitto MQTT broker.
const int mqttPort = 1883; // Default MQTT port.

WiFiClient wifiClient; // Handles the Wi-Fi connection.
PubSubClient mqttClient(wifiClient); // Handles MQTT communication over Wi-Fi.

const int ONE_WIRE_BUS = 4; // GPIO pin that the sensors data wire is connected to.
OneWire oneWire(ONE_WIRE_BUS); // Object for OneWire communication.
DallasTemperature tempSensor(&oneWire); // Temperature reading object.
unsigned long lastTempPublish = 0; // Stores the last time temperature was published.
const unsigned long tempInterval = 5000; // Temperature publish interval (ms).

BH1750 lightMeter; // BH1750 sensor object.
unsigned long lastLightPublish = 0; // Stores the last time light was published.
const unsigned long lightInterval = 5000; // Light publish interval (ms).


void connectToWiFi() { // Function to connect ESP32 to Wi-Fi network.
  Serial.println("Connecting to Wi-Fi...");
  
  WiFi.begin(ssid, password); // Attempt to connect using given credentials.

  while (WiFi.status() != WL_CONNECTED) { // Check if connection was successful.
    delay(500);
  }


  // Connection information.
  Serial.println("Wi-Fi connected!");
  Serial.print("ESP32 IP address: ");
  Serial.println(WiFi.localIP());
}


void connectToMQTT() { // Function to connect ESP32 to MQTT broker.
  while (!mqttClient.connected()) { // Until connection is successful.
    Serial.println("Connecting to MQTT...");

    if (mqttClient.connect("ESP32_COMBINED_SYSTEM")) { // Unique client ID.
      Serial.println("MQTT Connected!");
    } else {
      Serial.print("Failed! MQTT error code: ");
      Serial.println(mqttClient.state());
      delay(5000); // Wait before retrying.
    }
  }
}


void publishTemperature() { // Function to publish temperature.
  unsigned long currentTime = millis(); // Current time.

  if (currentTime - lastTempPublish >= tempInterval) { // If 5 seconds have passed.
    lastTempPublish = currentTime; // Update the last publish time.
    
    tempSensor.requestTemperatures(); // Take temperature reading.
    float temperatureC = tempSensor.getTempCByIndex(0); // Read temperature in Celsius.

    // Convert float value into a string for MQTT.
    char tempString[16];
    dtostrf(temperatureC, 1, 2, tempString);

    mqttClient.publish("aquarium/temperature", tempString); // Publish temperature to MQTT topic.

    // Print debug information to the Serial Monitor.
    Serial.print("Temperature sent: ");
    Serial.print(tempString);
    Serial.println(" °C");
  }
}


void publishLight() { // Function to publish light level.
  unsigned long currentTime = millis(); // Current time.

  if (currentTime - lastLightPublish >= lightInterval) { // If 5 seconds have passed.
    lastLightPublish = currentTime; // Update the last publish time.

    float lux = lightMeter.readLightLevel(); // Read light level in lux.

    // Convert float value into a string for MQTT.
    char luxString[16];
    dtostrf(lux, 1, 2, luxString);

    mqttClient.publish("aquarium/light", luxString); // Publish light level to MQTT topic.

    // Print debug information to the Serial Monitor.
    Serial.print("Light sent: ");
    Serial.print(luxString);
    Serial.println(" lx");
  }
}


void setup() { // Setup function, runs once at start.
  Serial.begin(115200); // Initiate serial monitor at specified baud rate.
  connectToWiFi(); // Connect to Wi-Fi network.
  mqttClient.setServer(mqttServer, mqttPort); // Specifying which broker to use.

  tempSensor.begin(); // Start the DS18B20 sensor.
  Wire.begin(); // Start I2C communication.
  lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE); // Start the BH1750 sensor.

}


void loop() { // Runs repeatedly after setup funtion.
  if (!mqttClient.connected()) { // If MQTT connection drops, reconnect.
    connectToMQTT();
  }

  mqttClient.loop(); // Keep MQTT connection alive.

  publishTemperature();
  publishLight();
}
