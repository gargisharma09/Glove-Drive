#pragma once

// Copy this file to config.h and fill in your local 2.4 GHz Wi-Fi credentials.
// config.h is git-ignored so secrets are never committed.

#define WIFI_SSID       "YOUR_24GHZ_WIFI_SSID"
#define WIFI_PASS       "YOUR_WIFI_PASSWORD"

// Hub address (default: fixed IP of your laptop on the 2.4 GHz network)
#define HUB_HOST        "192.168.137.10"
#define HUB_PORT        8000

// Board model: AI-Thinker ESP32-CAM (most common)
#define CAMERA_MODEL_AI_THINKER

// Camera tuning (start small so control commands never lag)
#define CAM_FRAME_SIZE    FRAMESIZE_QVGA  // 320x240
#define CAM_JPEG_QUALITY  15              // 0-63 (lower = better quality, larger file)
#define FRAME_INTERVAL_MS 200             // 5 fps
