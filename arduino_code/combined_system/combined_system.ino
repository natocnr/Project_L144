#include <WiFi.h> // Allows the ESP32 to connect to a Wi-Fi network.
#include <PubSubClient.h> // Allows the ESP32 to publish/subscribe using MQTT.
#include <OneWire.h> // Handles communication with DS18B20 sensor.
#include <DallasTemperature.h> // Converts raw sensor data to temperature.
#include <Wire.h> // Handles I2C communication.
#include <BH1750.h> // Allows ESP32 to read light level from BH1750.
#include <Adafruit_Sensor.h> // Base library used by Adafruit sensors.
#include <Adafruit_BME280.h> // Allows ESP32 to read temperature/humidity/pressure from BME280.

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

Adafruit_BME280 bme; // BME280 sensor object.
bool bme280Ready = false; // True only if BME280 starts correctly.
unsigned long lastEnvPublish = 0; // Stores the last time environment values were published.
const unsigned long envInterval = 5000; // Environment publish interval (ms).

const int FLOAT_PIN = 27; // GPIO pin connected to float switch signal wire.
unsigned long lastLevelPublish = 0; // Stores the last time level was published.
const unsigned long levelInterval = 2000; // Level publish interval (ms).

const int FLOW_PIN = 26; // GPIO pin connected to flow sensor signal.
volatile unsigned long pulseCount = 0; // Pulse counter (updated by interrupt).
unsigned long lastFlowPublish = 0; // Stores the last time flow was calculated/published.
const unsigned long flowInterval = 1000; // Measure pulses for 1 second (1000ms).
const float FLOW_CALIBRATION = 7.5; // For YF-S201: Flow (L/min) = pulsesPerSecond / 7.5


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


void publishEnvironment() { // Function to publish BME280 environment values.
  if (!bme280Ready) {
    Serial.println("BME280 not ready.");
    return; // Do nothing if BME280 did not start.
  }

  unsigned long currentTime = millis(); // Current time.

  if (currentTime - lastEnvPublish >= envInterval) { // If 5 seconds have passed.
    lastEnvPublish = currentTime; // Update the last publish time.

    float envTempC = bme.readTemperature(); // Read temperature in Celsius.
    float envHumidity = bme.readHumidity(); // Read humidity percentage.
    float envPressureHpa = bme.readPressure() / 100.0F; // Read pressure in hPa.

    // Convert float values into strings for MQTT.
    char tempString[16];
    char humidityString[16];
    char pressureString[16];

    dtostrf(envTempC, 1, 2, tempString);
    dtostrf(envHumidity, 1, 2, humidityString);
    dtostrf(envPressureHpa, 1, 2, pressureString);

    // Publish values to MQTT topics.
    mqttClient.publish("aquarium/environment/temperature", tempString);
    mqttClient.publish("aquarium/environment/humidity", humidityString);
    mqttClient.publish("aquarium/environment/pressure", pressureString);

    // Print debug information to the Serial Monitor.
    Serial.print("Env temperature sent: ");
    Serial.print(tempString);
    Serial.println(" °C");

    Serial.print("Env humidity sent: ");
    Serial.print(humidityString);
    Serial.println(" %");

    Serial.print("Env pressure sent: ");
    Serial.print(pressureString);
    Serial.println(" hPa");
  }
}


void publishLevel() { // Function to publish float switch water level state.
  unsigned long currentTime = millis(); // Current time.

  if (currentTime - lastLevelPublish >= levelInterval) { // If 2 seconds have passed.
    lastLevelPublish = currentTime; // Update the last publish time.

    int state = digitalRead(FLOAT_PIN); // Read float switch state.

    if (state == HIGH) {
      mqttClient.publish("aquarium/level", "OPEN"); // Publish OPEN state.
      Serial.println("Level sent: OPEN");
    } else {
      mqttClient.publish("aquarium/level", "CLOSED"); // Publish CLOSED state.
      Serial.println("Level sent: CLOSED");
    }
  }
}


void IRAM_ATTR pulseCounter() { // Runs automatically every time a pulse happens.
  pulseCount++; // Count the pulse.
}


void publishFlow() { // Function to publish water flow rate.
  unsigned long currentTime = millis(); // Current time.

  // Only calculate/publish once per second.
  if (currentTime - lastFlowPublish >= flowInterval) {
    lastFlowPublish = currentTime; // Update the timer.

    // Safely copy pulseCount and reset it for the next 1-second window.
    noInterrupts(); // Pause interrupts for a moment (so pulseCount doesn't change mid-copy).
    unsigned long pulses = pulseCount; // Copy pulses counted in the last second.
    pulseCount = 0; // Reset for next measurement window.
    interrupts(); // Resume interrupts.

    // Convert pulses counted in 1 second into flow rate (L/min).
    float flowRate = pulses / FLOW_CALIBRATION;

    // Convert float to string for MQTT.
    char flowString[16];
    dtostrf(flowRate, 1, 2, flowString);

    // Publish flow.
    mqttClient.publish("aquarium/sensors/flow", flowString);

    // Debug print.
    Serial.print("Flow sent: ");
    Serial.print(flowString);
    Serial.println(" L/min");
  }
}




void setup() { // Setup function, runs once at start.
  Serial.begin(115200); // Initiate serial monitor at specified baud rate.
  connectToWiFi(); // Connect to Wi-Fi network.
  mqttClient.setServer(mqttServer, mqttPort); // Specifying which broker to use.

  tempSensor.begin(); // Start the DS18B20 sensor.
  Wire.begin(); // Start I2C communication.
  lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE); // Start the BH1750 sensor.
  bme280Ready = bme.begin(0x76); // Start the BME280 sensor (0x76 is the address detected in the I2C scanner).
  pinMode(FLOAT_PIN, INPUT_PULLUP); // Float switch input using internal pull-up resistor.

  pinMode(FLOW_PIN, INPUT_PULLUP); // Flow sensor signal input.
  attachInterrupt(digitalPinToInterrupt(FLOW_PIN), pulseCounter, FALLING); // Count pulses.

}


void loop() { // Runs repeatedly after setup funtion.
  if (!mqttClient.connected()) { // If MQTT connection drops, reconnect.
    connectToMQTT();
  }

  mqttClient.loop(); // Keep MQTT connection alive.

  publishTemperature();
  publishLight();
  publishEnvironment();
  publishLevel();
  publishFlow();
}
