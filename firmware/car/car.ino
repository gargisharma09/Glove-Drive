/*
 * GloveDrive - Car ESP32 Firmware
 * Libraries required (Arduino Library Manager):
 *   - WebSockets by Markus Sattler (Links2004)
 *   - ArduinoJson by Benoit Blanchon (v6 or v7)
 *   - DHT sensor library by Adafruit (+ Adafruit Unified Sensor)
 */

#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include "config.h"

#define DHTTYPE DHT11
DHT dht(DHT_PIN, DHTTYPE);
WebSocketsClient webSocket;

// Connection & backoff state (non-blocking)
unsigned long wifiLastAttemptMs = 0;
unsigned long wifiBackoffMs = 1000;
const unsigned long WIFI_BACKOFF_MAX_MS = 30000;
bool wifiWasConnected = false;

bool wsConnected = false;
unsigned long lastHbMs = 0;
unsigned long lastSensorMs = 0;
unsigned long lastDriveMs = 0;
bool motorsActive = false;

unsigned long rxCount = 0;
unsigned long txCount = 0;
String resolvedHost = HUB_HOST;

void stopMotors(const char* reason) {
  if (motorsActive) {
    Serial.printf("[SAFETY] Stopping motors (%s)\n", reason);
  }
  motorsActive = false;
#if !MOTOR_DRY_RUN
  analogWrite(ENA_PIN, 0);
  analogWrite(ENB_PIN, 0);
  digitalWrite(IN1_PIN, LOW);
  digitalWrite(IN2_PIN, LOW);
  digitalWrite(IN3_PIN, LOW);
  digitalWrite(IN4_PIN, LOW);
#endif
}

void applyDrive(const char* dir, int speedPct) {
  int pwm = constrain(map(speedPct, 0, 100, 0, 255), 0, 255);
  lastDriveMs = millis();

  if (strcmp(dir, "stop") == 0 || pwm == 0) {
    stopMotors("drive=stop");
    return;
  }

  motorsActive = true;
#if MOTOR_DRY_RUN
  Serial.printf("[DRY_RUN] dir=%s speed=%d%% (pwm=%d)\n", dir, speedPct, pwm);
#else
  if (strcmp(dir, "forward") == 0) {
    digitalWrite(IN1_PIN, HIGH); digitalWrite(IN2_PIN, LOW);
    digitalWrite(IN3_PIN, HIGH); digitalWrite(IN4_PIN, LOW);
  } else if (strcmp(dir, "back") == 0) {
    digitalWrite(IN1_PIN, LOW); digitalWrite(IN2_PIN, HIGH);
    digitalWrite(IN3_PIN, LOW); digitalWrite(IN4_PIN, HIGH);
  } else if (strcmp(dir, "left") == 0) {
    digitalWrite(IN1_PIN, LOW); digitalWrite(IN2_PIN, HIGH);
    digitalWrite(IN3_PIN, HIGH); digitalWrite(IN4_PIN, LOW);
  } else if (strcmp(dir, "right") == 0) {
    digitalWrite(IN1_PIN, HIGH); digitalWrite(IN2_PIN, LOW);
    digitalWrite(IN3_PIN, LOW); digitalWrite(IN4_PIN, HIGH);
  } else {
    stopMotors("unknown dir");
    return;
  }
  analogWrite(ENA_PIN, pwm);
  analogWrite(ENB_PIN, pwm);
#endif
}

float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 25000UL);
  if (duration == 0) return -1.0f;
  return (duration * 0.0343f) / 2.0f;
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
      stopMotors("ws disconnected");
      break;

    case WStype_CONNECTED: {
      wsConnected = true;
      Serial.printf("[WS] Connected to %s:%d/ws/car\n", resolvedHost.c_str(), HUB_PORT);
      StaticJsonDocument<128> hello;
      hello["t"] = "hello";
      hello["id"] = "car";
      hello["rssi"] = WiFi.RSSI();
      sendJson(hello);
      break;
    }

    case WStype_TEXT: {
      rxCount++;
      StaticJsonDocument<256> doc;
      DeserializationError err = deserializeJson(doc, payload, length);
      if (err) {
        Serial.printf("[WS] JSON parse error: %s\n", err.c_str());
        return;
      }
      const char* t = doc["t"] | "";
      if (strcmp(t, "drive") == 0) {
        const char* dir = doc["dir"] | "stop";
        int speed = doc["speed"] | 0;
        long long ts = doc["ts"] | 0;
        applyDrive(dir, speed);

        StaticJsonDocument<96> ack;
        ack["t"] = "ack";
        ack["ts"] = ts;
        sendJson(ack);
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
      if (MDNS.begin("glovedrive-car")) {
        IPAddress ip = MDNS.queryHost(HUB_MDNS_NAME);
        if (ip != INADDR_NONE) {
          resolvedHost = ip.toString();
          Serial.printf("[MDNS] Resolved %s.local -> %s\n", HUB_MDNS_NAME, resolvedHost.c_str());
        }
      }
#endif
      webSocket.begin(resolvedHost.c_str(), HUB_PORT, "/ws/car");
      webSocket.onEvent(onWsEvent);
      webSocket.setReconnectInterval(2000);
    }
    return;
  }

  if (wifiWasConnected) {
    wifiWasConnected = false;
    wsConnected = false;
    stopMotors("wifi lost");
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
  Serial.println("\n=== GloveDrive Car Boot ===");

  pinMode(ENA_PIN, OUTPUT);
  pinMode(ENB_PIN, OUTPUT);
  pinMode(IN1_PIN, OUTPUT);
  pinMode(IN2_PIN, OUTPUT);
  pinMode(IN3_PIN, OUTPUT);
  pinMode(IN4_PIN, OUTPUT);
  stopMotors("boot");

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  dht.begin();

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
}

void loop() {
  maintainWiFi();

  if (WiFi.status() == WL_CONNECTED) {
    webSocket.loop();
  }

  unsigned long now = millis();

  // Hardware-level safety timeout: stop motors if hub/glove stops sending
  if (motorsActive && (now - lastDriveMs > DRIVE_TIMEOUT_MS)) {
    stopMotors("drive timeout");
  }

  if (wsConnected && (now - lastHbMs >= HB_INTERVAL_MS)) {
    lastHbMs = now;
    StaticJsonDocument<96> hb;
    hb["t"] = "hb";
    hb["rssi"] = WiFi.RSSI();
    sendJson(hb);
  }

  if (wsConnected && (now - lastSensorMs >= SENSOR_INTERVAL_MS)) {
    lastSensorMs = now;
    float tempC = dht.readTemperature();
    float humPct = dht.readHumidity();
    int gasRaw = analogRead(MQ2_PIN);
    float distCm = readDistanceCm();

    StaticJsonDocument<192> s;
    s["t"] = "sensors";
    s["temp_c"] = isnan(tempC) ? -1.0 : round(tempC * 10.0) / 10.0;
    s["hum_pct"] = isnan(humPct) ? -1.0 : round(humPct * 10.0) / 10.0;
    s["gas_raw"] = gasRaw;
    s["dist_cm"] = round(distCm * 10.0) / 10.0;
    s["ts"] = (unsigned long)now;
    sendJson(s);

    Serial.printf("[SENSORS] T=%.1fC H=%.1f%% Gas=%d Dist=%.1fcm RSSI=%d tx=%lu rx=%lu\n",
                  tempC, humPct, gasRaw, distCm, WiFi.RSSI(), txCount, rxCount);
  }
}
