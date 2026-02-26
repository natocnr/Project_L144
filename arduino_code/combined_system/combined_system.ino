// Libraries.
#include <WiFi.h> // Allows the ESP32 to connect to a Wi-Fi network.
#include <PubSubClient.h> // MQTT client, allows ESP32 to publish to topic.

#include "secrets.h" // Configuration file.

#include <OneWire.h> // Communication protocol used by DS18B20, it allows multiple sensors to communicate through one wire or a single GPIO pin.
#include <DallasTemperature.h> // Converts raw sensor data from DS18B20 into readable temperature values.

#include <Wire.h> // Communication protocol (I2C) used by BH1750 and BME280, allows communication through two wires (SDA and SCL).
#include <BH1750.h> // Allows ESP32 to read light intensity from BH1750.
#include <Adafruit_Sensor.h> // Adafruit sensor library.
#include <Adafruit_BME280.h> // Allows ESP32 to read humidity, pressure and temperature from BME280.

// Wi-Fi and MQTT configuration.
const char* ssid = WIFI_SSID; // Network name.
const char* password = WIFI_PASSWORD; // Network password.

const char* mqttServer = MQTT_SERVER; // IP address of computer running MQTT broker.
const int mqttPort = MQTT_PORT; // Default port used by MQTT.

// Pin definitions.
const int ONE_WIRE = 4; // GPIO pin that connects to DS18B20 data wire.
const int FLOAT_PIN = 27; // GPIO pin that connects to float switch signal wire.
const int FLOW_PIN = 26; // GPIO pin that connects to flow sensor signal output.

// Network Clients.
WiFiClient wifiClient; // Handles Wi-Fi connection.
PubSubClient mqttClient(wifiClient); // Handles MQTT communication over Wi-Fi.

// Sensor Objects.
// DS18B20
OneWire oneWire(ONE_WIRE); // OneWire communication object using defined pin.
DallasTemperature tempSensor(&oneWire); // Temperature sensor object.

// BH1750
BH1750 lightMeter; // Light sensor object.

// BME280
Adafruit_BME280 bme; // BME280 sensor object.
bool bme280Ready = false; // Boolean to determine whether sensor has initialised.

// Flow sensor
volatile unsigned long pulseCount = 0; // Stores the number of pulses detected from the flow sensor. Volatile is required because its updated inside an interrupt.
const float flowCalibration = 7.5; // Calibration for YF-S201. Formula: Flow rate (L/min) = pulses per second / 7.5.

// Publish Timing (non-blocking).
unsigned long lastTempPublish = 0;
const unsigned long tempInterval = 5000;

unsigned long lastLightPublish = 0;
const unsigned long lightInterval = 5000;

unsigned long lastEnvPublish = 0;
const unsigned long envInterval = 5000;

unsigned long lastLevelPublish = 0;
const unsigned long levelInterval = 2000;

unsigned long lastFlowPublish = 0;
const unsigned long flowInterval = 1000;  

// Function to connect ESP32 to Wi-Fi.
void connectToWiFi() {
    Serial.println("Connecting to Wi-Fi...");
    
    // Attempt to connect to Wi-Fi using credentials.
    WiFi.begin(ssid, password); 

    // Check if connection was successful.
    while (WiFi.status() != WL_CONNECTED) { 
        delay(500);
    }

    Serial.println("Wi-Fi connected!");
    Serial.print("ESP32 IP address: ");
    Serial.println(WiFi.localIP());
}

// Function to connect ESP32 to MQTT broker.
void connectToMQTT() { 
    // Until connected.
    while (!mqttClient.connected()) {
        Serial.println("Connecting to MQTT...");

        // Attempt to connect with unique client ID and return status.
        if (mqttClient.connect("ESP32_COMBINED_SYSTEM")) {
            Serial.println("MQTT Connected!");
        } else {
            Serial.print("Failed! MQTT error code: ");
            Serial.println(mqttClient.state());
            delay(5000);
        }
    }
}

// Function to publish temperature.
void publishTemperature() { 
    // Time since startup.
    unsigned long currentTime = millis(); 

    // If five or more seconds have passed since last publish.
    if (currentTime - lastTempPublish >= tempInterval) { 
        // Update last publish time.
        lastTempPublish = currentTime; 
        
        // Take temperature reading.
        tempSensor.requestTemperatures(); 
        
        // Read and store temperature in Celsius.
        float temperatureC = tempSensor.getTempCByIndex(0); 

        // Convert float to string for MQTT.
        char tempString[16];
        dtostrf(temperatureC, 1, 2, tempString);

        // Publish temperature to MQTT topic.
        mqttClient.publish("aquarium/sensors/temperature", tempString); 
        
        Serial.print("Temperature sent: ");
        Serial.print(tempString);
        Serial.println(" °C");
    }
}

// Function to publish light level.
void publishLight() { 
    // Time since startup.
    unsigned long currentTime = millis();

    // If five or more seconds have passed since last publish.
    if (currentTime - lastLightPublish >= lightInterval) {
        // Update last publish time.
        lastLightPublish = currentTime;

        // Read and store light level in lux.
        float lux = lightMeter.readLightLevel(); 

        // Convert float to string for MQTT.
        char luxString[16];
        dtostrf(lux, 1, 2, luxString);

        // Publish light level to MQTT topic.
        mqttClient.publish("aquarium/sensors/light", luxString); 

        Serial.print("Light sent: ");
        Serial.print(luxString);
        Serial.println(" lx");
    }
}

// Function to publish environment values.
void publishEnvironment() { 
    // If sensor is not ready, do nothing.
    if (!bme280Ready) {
        Serial.println("BME280 not ready.");
        return;
    }

    // Time since startup.
    unsigned long currentTime = millis();

    // If five or more seconds have passed since last publish.
    if (currentTime - lastEnvPublish >= envInterval) {
        // Update the last publish time.
        lastEnvPublish = currentTime; 

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
        mqttClient.publish("aquarium/sensors/environment/temperature", tempString);
        mqttClient.publish("aquarium/sensors/environment/humidity", humidityString);
        mqttClient.publish("aquarium/sensors/environment/pressure", pressureString);

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

// Function to publish float switch water level state.
void publishLevel() {
    // Time since startup.
    unsigned long currentTime = millis();

    // If two or more seconds have passed since last publish.
    if (currentTime - lastLevelPublish >= levelInterval) {
        // Update the last publish time.
        lastLevelPublish = currentTime; 

        // Read and store float switch state.
        int state = digitalRead(FLOAT_PIN); 

        // Publish state to MQTT topic.
        if (state == HIGH) {
            mqttClient.publish("aquarium/sensors/level", "1"); // Publish OPEN state (1).
            Serial.println("Level sent: OPEN");
        } else {
            mqttClient.publish("aquarium/sensors/level", "0"); // Publish CLOSED state (0).
            Serial.println("Level sent: CLOSED");
        }
    }
}

// ISR function used to count pulses.
// Function is stored on Instruction RAM opposed to Flash Memory.
void IRAM_ATTR pulseCounter() {
    // Increase pulse count by one.
    pulseCount++;
}

// Function to publish water flow rate.
void publishFlow() { 
    // Time since startup.
    unsigned long currentTime = millis(); // Current time.

    // // If one or more seconds have passed since last publish (based on formula).
    if (currentTime - lastFlowPublish >= flowInterval) {
        // Update the last publish time.
        lastFlowPublish = currentTime;

        // Pause interrupts momentarily to prevent count increasing during copy.
        noInterrupts();
        
        // Copy and reset pulses.
        unsigned long pulses = pulseCount;
        pulseCount = 0;
        
        // Resume interrupts.
        interrupts();

        // Convert pulses per second to L/min.
        float flowRate = pulses / flowCalibration;

        // Convert float to string for MQTT.
        char flowString[16];
        dtostrf(flowRate, 1, 2, flowString);

        // Publish flow to MQTT topic.
        mqttClient.publish("aquarium/sensors/flow", flowString);

        Serial.print("Flow sent: ");
        Serial.print(flowString);
        Serial.println(" L/min");
    }
}

// Setup function, runs once at startup.
void setup() {
    // Initiate serial monitor at specified baud rate.
    Serial.begin(115200); 
    
    // Connect to Wi-Fi network.
    connectToWiFi(); 
    
    // Specifying which broker to use.
    mqttClient.setServer(mqttServer, mqttPort); 

    // Start DS18B20 temperature sensor.
    tempSensor.begin(); 
    
    // Start I2C communication.
    Wire.begin(); 
    
    // Start the BH1750 sensor.
    lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE); 
    
    // Start the BME280 sensor on specified I2C address.
    bme280Ready = bme.begin(0x76); 
    
    // Specifying input pins and enabling internal pullup resistor.
    pinMode(FLOAT_PIN, INPUT_PULLUP);
    pinMode(FLOW_PIN, INPUT_PULLUP);
    
    // If voltage input to flow pin falls (high -> low) run ISR.
    attachInterrupt(digitalPinToInterrupt(FLOW_PIN), pulseCounter, FALLING);
}

// Function which runs repeatedly after startup.
void loop() { 
    // If MQTT connection drops, reconnect.
    if (!mqttClient.connected()) { 
      connectToMQTT();
    }

    // Keep MQTT connection alive.
    mqttClient.loop(); 

    // Publish functions.
    publishTemperature();
    publishLight();
    publishEnvironment();
    publishLevel();
    publishFlow();
} 