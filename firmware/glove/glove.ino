/*
 * GloveDrive - Glove ESP32 Firmware
 * Libraries required (Arduino Library Manager):
 *   - WebSockets by Markus Sattler (Links2004)
 *   - ArduinoJson by Benoit Blanchon (v6 or v7)
 * (Uses built-in Wire.h for MPU-6050 I2C reads)
 */

#include <WiFi.h>
#include <ESPmDNS.h>
#include <Wire.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include "config.h"

const uint8_t MPU_ADDR = 0x68;
WebSocketsClient webSocket;

// Connection & backoff state
unsigned long wifiLastAttemptMs = 0;
unsigned long wifiBackoffMs = 1000;
const unsigned long WIFI_BACKOFF_MAX_MS = 30000;
bool wifiWasConnected = false;

bool wsConnected = false;
unsigned long lastHbMs = 0;
unsigned long lastGestureMs = 0;
unsigned long alertUntilMs = 0;
bool wasLocked = false;

unsigned long rxCount = 0;
unsigned long txCount = 0;
String resolvedHost = HUB_HOST;

void initMPU6050() {
  Wire.begin(MPU_SDA_PIN, MPU_SCL_PIN);
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);  // PWR_MGMT_1
  Wire.write(0);     // Wake up MPU-6050
  Wire.endTransmission(true);
}

void readAccelG(float& ax, float& ay) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);  // ACCEL_XOUT_H
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, (uint8_t)4, (uint8_t)true);
  if (Wire.available() >= 4) {
    int16_t rawX = (Wire.read() << 8) | Wire.read();
    int16_t rawY = (Wire.read() << 8) | Wire.read();
    ax = rawX / 16384.0f;
    ay = rawY / 16384.0f;
  } else {
    ax = 0.0f;
    ay = 0.0f;
  }
}

const char* detectGesture(bool& lockChanged) {
  lockChanged = false;
  int flexVal = analogRead(FLEX_PIN);
  bool lockedNow = (flexVal >= FLEX_LOCK_THRESHOLD);

  if (lockedNow != wasLocked) {
    wasLocked = lockedNow;
    lockChanged = true;
    return lockedNow ? "lock" : "unlock";
  }

  if (lockedNow) {
    return "stop";
  }

  float ax = 0.0f, ay = 0.0f;
  readAccelG(ax, ay);

  if (ay > TILT_THRESHOLD_G)  return "forward";
  if (ay < -TILT_THRESHOLD_G) return "back";
  if (ax > TILT_THRESHOLD_G)  return "right";
  if (ax < -TILT_THRESHOLD_G) return "left";
  return "stop";
}

void sendJson(JsonDocument& doc) {
  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(out);
  txCount++;
}

void onWsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      if (wsConnected) {
        Serial.println("[WS] Disconnected from hub");
      }
      wsConnected = false;
      break;

    case WStype_CONNECTED: {
      wsConnected = true;
      Serial.printf("[WS] Connected to %s:%d/ws/glove\n", resolvedHost.c_str(), HUB_PORT);
      StaticJsonDocument<128> hello;
      hello["t"] = "hello";
      hello["id"] = "glove";
      hello["rssi"] = WiFi.RSSI();
      sendJson(hello);
      break;
    }

    case WStype_TEXT: {
      rxCount++;
      StaticJsonDocument<192> doc;
      if (deserializeJson(doc, payload, length)) return;
      const char* t = doc["t"] | "";
      if (strcmp(t, "alert") == 0 && (doc["vibrate"] | false)) {
        int strength = constrain((int)(doc["strength"] | 80), 0, 100);
        int pwm = map(strength, 0, 100, 0, 255);
        analogWrite(VIB_MOTOR_PIN, pwm);
        alertUntilMs = millis() + ALERT_DURATION_MS;
        Serial.printf("[ALERT] Vibrate strength=%d%%\n", strength);
      }
      break;
    }

    default:
      break;
  }
}

void maintainWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiWasConnected) {
      wifiWasConnected = true;
      wifiBackoffMs = 1000;
      Serial.printf("[WIFI] Connected! IP=%s RSSI=%d dBm\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
#if USE_MDNS
      if (MDNS.begin("glovedrive-glove")) {
        IPAddress ip = MDNS.queryHost(HUB_MDNS_NAME);
        if (ip != INADDR_NONE) {
          resolvedHost = ip.toString();
        }
      }
#endif
      webSocket.begin(resolvedHost.c_str(), HUB_PORT, "/ws/glove");
      webSocket.onEvent(onWsEvent);
      webSocket.setReconnectInterval(2000);
    }
    return;
  }

  if (wifiWasConnected) {
    wifiWasConnected = false;
    wsConnected = false;
    Serial.println("[WIFI] Disconnected! Starting reconnect backoff...");
  }

  unsigned long now = millis();
  if (now - wifiLastAttemptMs >= wifiBackoffMs) {
    wifiLastAttemptMs = now;
    Serial.printf("[WIFI] Connecting to %s (backoff=%lu ms)...\n", WIFI_SSID, wifiBackoffMs);
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    wifiBackoffMs = min(wifiBackoffMs * 2, WIFI_BACKOFF_MAX_MS);
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== GloveDrive Glove Boot ===");

  pinMode(VIB_MOTOR_PIN, OUTPUT);
  analogWrite(VIB_MOTOR_PIN, 0);
  initMPU6050();

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
}

void loop() {
  maintainWiFi();

  if (WiFi.status() == WL_CONNECTED) {
    webSocket.loop();
  }

  unsigned long now = millis();

  // Turn off vibration motor once alert pulse completes
  if (alertUntilMs > 0 && now >= alertUntilMs) {
    analogWrite(VIB_MOTOR_PIN, 0);
    alertUntilMs = 0;
  }

  if (wsConnected && (now - lastHbMs >= HB_INTERVAL_MS)) {
    lastHbMs = now;
    StaticJsonDocument<96> hb;
    hb["t"] = "hb";
    hb["rssi"] = WiFi.RSSI();
    sendJson(hb);
  }

  if (wsConnected && (now - lastGestureMs >= GESTURE_INTERVAL_MS)) {
    lastGestureMs = now;
    bool lockChanged = false;
    const char* cmd = detectGesture(lockChanged);

    StaticJsonDocument<128> g;
    g["t"] = "gesture";
    g["cmd"] = cmd;
    g["ts"] = (unsigned long)now;
    sendJson(g);

    if (lockChanged) {
      Serial.printf("[GLOVE] State -> %s\n", cmd);
    }
  }
}
