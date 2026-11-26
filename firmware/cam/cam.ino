/*
 * GloveDrive - ESP32-CAM Firmware
 * Board: AI-Thinker ESP32-CAM
 *
 * IMPORTANT: Use a stable 5V / 2A power supply on the 5V pin.
 * Weak USB power causes "Brownout detector was triggered" resets.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include "esp_camera.h"
#include "config.h"

#ifdef CAMERA_MODEL_AI_THINKER
  #define PWDN_GPIO_NUM     32
  #define RESET_GPIO_NUM    -1
  #define XCLK_GPIO_NUM      0
  #define SIOD_GPIO_NUM     26
  #define SIOC_GPIO_NUM     27
  #define Y9_GPIO_NUM       35
  #define Y8_GPIO_NUM       34
  #define Y7_GPIO_NUM       39
  #define Y6_GPIO_NUM       36
  #define Y5_GPIO_NUM       21
  #define Y4_GPIO_NUM       19
  #define Y3_GPIO_NUM       18
  #define Y2_GPIO_NUM        5
  #define VSYNC_GPIO_NUM    25
  #define HREF_GPIO_NUM     23
  #define PCLK_GPIO_NUM     22
#endif

unsigned long wifiLastAttemptMs = 0;
unsigned long wifiBackoffMs = 1000;
const unsigned long WIFI_BACKOFF_MAX_MS = 30000;
bool wifiWasConnected = false;

unsigned long lastFrameMs = 0;
unsigned long frameCount = 0;
unsigned long skippedCount = 0;

bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = CAM_FRAME_SIZE;
  config.jpeg_quality = CAM_JPEG_QUALITY;
  config.fb_count = 1;  // Single buffer: skip frames instead of queuing stale ones

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAM] Init failed: 0x%x\n", err);
    return false;
  }
  Serial.println("[CAM] Camera initialized (QVGA)");
  return true;
}

void maintainWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiWasConnected) {
      wifiWasConnected = true;
      wifiBackoffMs = 1000;
      Serial.printf("[WIFI] Connected! IP=%s RSSI=%d dBm\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
    }
    return;
  }

  if (wifiWasConnected) {
    wifiWasConnected = false;
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
  Serial.println("\n=== GloveDrive ESP32-CAM Boot ===");

  if (!initCamera()) {
    Serial.println("[CAM] Check power supply (5V 2A) and ribbon cable.");
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
}

void loop() {
  maintainWiFi();

  unsigned long now = millis();
  if (WiFi.status() != WL_CONNECTED || (now - lastFrameMs < FRAME_INTERVAL_MS)) {
    return;
  }
  lastFrameMs = now;

  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    skippedCount++;
    return;
  }

  HTTPClient http;
  String url = String("http://") + HUB_HOST + ":" + HUB_PORT + "/frame";
  http.begin(url);
  http.setTimeout(1000);
  http.addHeader("Content-Type", "image/jpeg");

  int code = http.POST(fb->buf, fb->len);
  if (code == 200) {
    frameCount++;
    if (frameCount % 25 == 0) {
      Serial.printf("[CAM] Sent %lu frames (skipped=%lu, last=%u bytes, RSSI=%d)\n",
                    frameCount, skippedCount, (unsigned)fb->len, WiFi.RSSI());
    }
  } else {
    skippedCount++;
    Serial.printf("[CAM] POST /frame failed: code=%d\n", code);
  }

  http.end();
  esp_camera_fb_return(fb);
}
