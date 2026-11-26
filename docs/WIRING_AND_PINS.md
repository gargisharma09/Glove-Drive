# Wiring & Pin Map

## 1. Car ESP32 Pin Map

| Component | Signal | ESP32 Pin | Notes / Safety |
| :--- | :--- | :--- | :--- |
| **L298N** (FIXED) | `ENA` (PWM) | `GPIO25` | Left motor speed |
| **L298N** (FIXED) | `IN1` | `GPIO26` | Left motor dir A |
| **L298N** (FIXED) | `IN2` | `GPIO27` | Left motor dir B |
| **L298N** (FIXED) | `IN3` | `GPIO18` | Right motor dir A |
| **L298N** (FIXED) | `IN4` | `GPIO19` | Right motor dir B |
| **L298N** (FIXED) | `ENB` (PWM) | `GPIO33` | Right motor speed |
| **HC-SR04** (FIXED) | `TRIG` | `GPIO13` | 3.3V output triggers HC-SR04 reliably |
| **HC-SR04** (FIXED) | `ECHO` | `GPIO14` | **MUST use 1kΩ / 2kΩ voltage divider** (5V → 3.33V) |
| **HC-SR04** (FIXED) | `VCC` | `5V` | Common GND with ESP32 |
| **MQ-2 Gas** | `AOUT` | `GPIO34` | **ADC1_CH6** (safe with Wi-Fi). **MUST use voltage divider** (5V → ≤3.3V, e.g., 1kΩ + 2kΩ) |
| **DHT11** | `DATA` | `GPIO4` | Safe digital GPIO; add 10kΩ pull-up to 3.3V if bare sensor |

> [!WARNING]
> **Voltage Divider Required for HC-SR04 ECHO and MQ-2 AOUT:**
> ESP32 GPIO pins are **3.3V only** (not 5V tolerant).
> Wire `5V Signal ──[ 1kΩ ]──┬── ESP32 GPIO` and `GPIO ──[ 2kΩ ]── GND` to scale 5V down to 3.33V.

> [!IMPORTANT]
> **Wi-Fi & ADC Rule:**
> Always use **ADC1** (`GPIO32–39`) for analog sensors (`MQ-2`, flex sensor). **ADC2** pins stop working whenever Wi-Fi is active.

---

## 2. Glove ESP32 Pin Map

| Component | Signal | ESP32 Pin | Notes / Safety |
| :--- | :--- | :--- | :--- |
| **MPU-6050** | `SDA` | `GPIO21` | Standard ESP32 I2C SDA |
| **MPU-6050** | `SCL` | `GPIO22` | Standard ESP32 I2C SCL |
| **Flex Sensor** | `ADC` | `GPIO34` | **ADC1_CH6** (input-only, Wi-Fi safe). Use voltage divider with 10kΩ–47kΩ resistor to 3.3V |
| **Vibration Motor** | `PWM` | `GPIO25` | Drive via NPN transistor / MOSFET + flyback diode (do not power motor directly from GPIO) |

---

## 3. Boot-Strapping Pin Warnings (ESP32)
Avoid connecting external pull-ups/pull-downs or active sensors to ESP32 boot-strapping pins:
- `GPIO0` (boot mode)
- `GPIO2` (must be floating/low at boot; onboard LED)
- `GPIO5` (SDIO timing)
- `GPIO12` (flash voltage — pulling HIGH at boot can prevent booting!)
- `GPIO15` (boot log / SDIO)

None of the selected pins above (`4, 13, 14, 18, 19, 21, 22, 25, 26, 27, 33, 34`) are boot-strapping pins, and none conflict with the fixed L298N / HC-SR04 map.

---

## 4. ESP32-CAM (`AI-Thinker`) Notes
- Default model in `firmware/cam/config.example.h`: `AI-Thinker ESP32-CAM`.
- Power via **5V** pin from a stable **5V / 2A** supply to avoid `Brownout detector was triggered` resets during Wi-Fi + camera capture.
- To flash: connect `GPIO0` to `GND` while pressing Reset, upload, then disconnect `GPIO0` from `GND` and press Reset.
