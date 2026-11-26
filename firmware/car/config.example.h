#pragma once

// Copy this file to config.h and fill in your local 2.4 GHz Wi-Fi credentials.
// config.h is git-ignored so secrets are never committed.

#define WIFI_SSID       "YOUR_24GHZ_WIFI_SSID"
#define WIFI_PASS       "YOUR_WIFI_PASSWORD"

// Hub address (default: fixed IP of your laptop on the 2.4 GHz network)
#define HUB_HOST        "192.168.137.10"
#define HUB_PORT        8000

// Optional mDNS lookup (set to 1 to resolve HUB_MDNS_NAME instead of HUB_HOST)
#define USE_MDNS        0
#define HUB_MDNS_NAME   "glovedrive"

// Timing (ms)
#define SENSOR_INTERVAL_MS  500   // 2 Hz sensor telemetry
#define HB_INTERVAL_MS      1000  // 1 Hz heartbeat
#define DRIVE_TIMEOUT_MS    500   // Safety stop if no drive msg within 500 ms

// Set to 1 to print motor commands to Serial without spinning motors (dry run)
// Set to 0 when ready to drive motors
#define MOTOR_DRY_RUN   1

// FIXED PIN MAP (do not change)
#define ENA_PIN   25
#define IN1_PIN   26
#define IN2_PIN   27
#define IN3_PIN   18
#define IN4_PIN   19
#define ENB_PIN   33

#define TRIG_PIN  13
#define ECHO_PIN  14  // Connect via 1k/2k voltage divider (5V -> 3.33V)

// Additional sensors (ADC1 / safe GPIOs, no boot-strapping conflicts)
#define MQ2_PIN   34  // ADC1_CH6 (Wi-Fi safe). Use voltage divider from 5V AOUT!
#define DHT_PIN   4   // DHT11 data pin
