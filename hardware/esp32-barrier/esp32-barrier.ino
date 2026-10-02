#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
const char* WIFI_SSID="YOUR_WIFI"; const char* WIFI_PASSWORD="YOUR_PASSWORD";
const char* API_BASE="https://YOUR-BACKEND.example.com/api"; const char* DEVICE_ID="barrier-in-1";
const int SERVO_PIN=13, OPEN_ANGLE=90, CLOSED_ANGLE=0; Servo servo; String lastState="closed"; unsigned long lastPoll=0;
void report(String state){HTTPClient h;h.begin(String(API_BASE)+"/iot/barriers/status");h.addHeader("Content-Type","application/json");String body=String("{\"deviceId\":\"")+DEVICE_ID+"\",\"state\":\""+state+"\"}";h.POST(body);h.end();}
void setup(){Serial.begin(115200);servo.attach(SERVO_PIN);servo.write(CLOSED_ANGLE);WiFi.begin(WIFI_SSID,WIFI_PASSWORD);while(WiFi.status()!=WL_CONNECTED)delay(300);}
void loop(){/* Add a secure command-poll endpoint before production deployment. */delay(1000);}
