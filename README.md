# GloveDrive — Gesture-Controlled Search-and-Rescue Robot (Wi-Fi Layer)

GloveDrive is a local-network, gesture-controlled search-and-rescue robot prototype. All communication runs over a single **2.4 GHz** Wi-Fi network (phone hotspot or travel router) with **no internet dependency**. Devices talk **only** to the laptop hub—never directly to each other.

## Repository Structure

```text
GloveDrive/
├── firmware/
│   ├── glove/              # ESP32 glove: MPU-6050 tilt, flex sensor, vibration motor
│   │   ├── glove.ino
│   │   └── config.example.h
│   ├── car/                # ESP32 car: L298N motors, HC-SR04, MQ-2, DHT11 + safety timeout
│   │   ├── car.ino
│   │   └── config.example.h
│   └── cam/                # ESP32-CAM: HTTP POST JPEG frames to /frame
│       ├── cam.ino
│       └── config.example.h
├── hub/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── config.py       # Configurable timeouts, thresholds, and ports
│   │   └── main.py         # FastAPI server (/ws/glove, /ws/car, /frame, /status, /latest.jpg)
│   └── requirements.txt
├── simulator/
│   ├── simulate.py         # Hardware-free simulator for glove, car, and camera
│   └── requirements.txt
├── docs/
│   ├── NETWORK_SETUP.md    # Step-by-step Wi-Fi, static IP, firewall, and ping checks
│   ├── WIRING_AND_PINS.md  # Fixed pin map, voltage dividers, and strapping pin warnings
│   └── ACCEPTANCE_TESTS.md # Bench & field reliability tests
└── .gitignore              # Ignores all config.h files so Wi-Fi credentials are never committed
```

---

## Quick Start (No Hardware Required)

You can test the entire hub and message pipeline right now using the built-in simulator.

### 1. Install Hub & Simulator Dependencies (Python 3.11+)

```bash
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# Linux / macOS:
# source .venv/bin/activate

pip install -r hub/requirements.txt -r simulator/requirements.txt
```

### 2. Start the FastAPI Hub

```bash
uvicorn hub.app.main:app --host 0.0.0.0 --port 8000
```

### 3. Run the Simulator (in a second terminal)

```bash
python simulator/simulate.py --host 127.0.0.1 --port 8000
```

### 4. Inspect Dashboard, Status & Camera Frame

- **Live Web Dashboard:** `http://127.0.0.1:8000/` (includes **Demo Mode** toggle for offline replay, hazard banner, 16:9 camera feed, sensor sparklines, detection feed, event timeline, and mission summary)
- **Hub status JSON:** `http://127.0.0.1:8000/status`
- **Latest camera frame:** `http://127.0.0.1:8000/latest.jpg`

> [!NOTE]
> **Dashboard Hazard Thresholds:**
> Edit `THRESHOLDS` in [hub/app/dashboard.html](hub/app/dashboard.html) to replace the placeholders (`GAS_YELLOW`, `GAS_RED`, `TEMP_YELLOW`, `TEMP_RED`) with your calibrated sensor values.

---

## Message Formats (JSON Protocol)

All teammates must follow these exact message schemas:

| Direction | Transport | JSON Payload | Description |
| :--- | :--- | :--- | :--- |
| Glove → Hub | `WS /ws/glove` | `{"t":"gesture","cmd":"forward\|back\|left\|right\|stop\|lock\|unlock","ts":123456}` | Gesture command + sender timestamp (ms) |
| Hub → Car | `WS /ws/car` | `{"t":"drive","dir":"forward\|back\|left\|right\|stop","speed":0-100,"ts":123456}` | Motor drive command + timestamp (ms) |
| Car → Hub | `WS /ws/car` | `{"t":"sensors","temp_c":26.4,"hum_pct":52.0,"gas_raw":310,"dist_cm":42.5,"ts":123456}` | Telemetry from DHT11, MQ-2, HC-SR04 |
| Hub → Glove | `WS /ws/glove` | `{"t":"alert","vibrate":true,"strength":0-100}` | Haptic alert (e.g. obstacle < threshold) |
| Both | `WS` | `{"t":"hello","id":"glove\|car"}` | Sent immediately on WebSocket connect |
| Both | `WS` | `{"t":"hb"}` (optional `"rssi":-55`) | Heartbeat every `1000 ms` |
| Camera → Hub | `POST /frame` | Raw `image/jpeg` body | Single JPEG frame per HTTP POST |

---

## Hardware & Firmware Setup

1. **Read the wiring guide:** [docs/WIRING_AND_PINS.md](docs/WIRING_AND_PINS.md) — includes voltage divider requirements for HC-SR04 (`5V`) and MQ-2 (`5V` analog out -> ADC1).
2. **Read the network guide:** [docs/NETWORK_SETUP.md](docs/NETWORK_SETUP.md) — 2.4 GHz setup, fixed IP, and Windows Firewall rule.
3. **Configure each device:** Copy `config.example.h` to `config.h` inside `firmware/glove/`, `firmware/car/`, and `firmware/cam/`, then fill in your Wi-Fi SSID, password, and laptop IP. (`config.h` is git-ignored.)
4. **Install Arduino libraries** (Arduino IDE Library Manager or PlatformIO):
   - `WebSockets` by Markus Sattler (`Links2004/WebSockets`)
   - `ArduinoJson` by Benoit Blanchon (v6 or v7)
   - `DHT sensor library` by Adafruit (+ `Adafruit Unified Sensor`)
   - `MPU6050` by Electronic Cats (or `Adafruit MPU6050` — `glove.ino` uses standard Wire I2C registers directly or `MPU6050` library; see `firmware/glove/glove.ino` header)
5. **Car dry-run first:** In `firmware/car/config.h`, keep `#define MOTOR_DRY_RUN 1` for your first test so the car logs motor actions to Serial without spinning wheels. Set to `0` once verified.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
| :--- | :--- | :--- |
| ESP32 never sees the Wi-Fi network | Hotspot/router is on **5 GHz** | ESP32 only supports **2.4 GHz**. Switch phone hotspot to 2.4 GHz ("Maximize Compatibility" on iOS, "2.4 GHz band" on Android). |
| ESP32 connects to Wi-Fi, but cannot reach laptop IP | **AP / Client Isolation** enabled on router | Disable "AP Isolation" / "Client Isolation" in travel router settings, or use a phone hotspot. |
| `ping` works, but WebSocket / `/frame` fails | **Windows Firewall** blocking port `8000` | Run as Administrator: `netsh advfirewall firewall add rule name="GloveDrive Hub 8000" dir=in action=allow protocol=TCP localport=8000` |
| Connection refused or timeout | **Wrong Hub IP** in `config.h` | Run `ipconfig` (Windows) or `ip addr` (Linux) on the laptop and update `HUB_HOST` in `config.h`. |
| ESP32-CAM keeps resetting (`Brownout detector was triggered`) | **Weak USB power** | Use a dedicated 5V 2A power supply on the `5V`/`GND` pins and a short, thick USB cable. |
| MQ-2 or flex sensor always reads `0` or `4095` while Wi-Fi is on | Used an **ADC2** pin | Move analog sensor to an **ADC1** pin (`GPIO32–39`). ADC2 is disabled when Wi-Fi is active. |
| Car keeps driving after laptop disconnects | Safety timeout disabled or too high | Ensure `DRIVE_TIMEOUT_MS` is `500` (ms) in `firmware/car/config.h` and `car.ino` stops motors on `WStype_DISCONNECTED`. |
