#pragma once

// Copy this file to config.h and fill in your local 2.4 GHz Wi-Fi credentials.
// config.h is git-ignored so secrets are never committed.

#define WIFI_SSID       "YOUR_24GHZ_WIFI_SSID"
#define WIFI_PASS       "YOUR_WIFI_PASSWORD"

// Hub address (default: fixed IP of your laptop on the 2.4 GHz network)
#define HUB_HOST        "192.168.137.10"
#define HUB_PORT        8000

// Optional mDNS lookup
#define USE_MDNS        0
#define HUB_MDNS_NAME   "glovedrive"

// Timing (ms)
#define GESTURE_INTERVAL_MS 100   // 10 Hz gesture send rate
#define HB_INTERVAL_MS      1000  // 1 Hz heartbeat
#define ALERT_DURATION_MS   300   // Vibration pulse duration on obstacle alert

// Pin map (no boot-strapping conflicts; flex uses ADC1)
#define MPU_SDA_PIN     21
#define MPU_SCL_PIN     22
#define FLEX_PIN        34  // ADC1_CH6 (Wi-Fi safe)
#define VIB_MOTOR_PIN   25  // PWM via transistor/MOSFET + flyback diode

// Calibration thresholds (adjust after testing your flex sensor & MPU-6050)
#define FLEX_LOCK_THRESHOLD   2200  // Raw ADC (0-4095) above which glove locks
#define TILT_THRESHOLD_G      0.35  // Normalized accel threshold (~20 deg tilt)
