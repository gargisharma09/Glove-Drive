# Network Setup Guide (Step 1)

GloveDrive runs entirely on a **local 2.4 GHz Wi-Fi network** (no internet required).

## 1. Access Point Requirements
- **Band:** **2.4 GHz only** (ESP32 and ESP32-CAM do not have 5 GHz radios).
- **Client Isolation:** Must be **OFF** so ESP32 devices can reach the laptop on port `8000`.
- **Recommended AP:** Travel router with DHCP reservation, or a phone hotspot set to 2.4 GHz.

## 2. Laptop Fixed IP & Hub Port
1. Connect your laptop to the 2.4 GHz Wi-Fi network.
2. Check your laptop's IPv4 address:
   - **Windows:** `ipconfig` (look for `IPv4 Address` under Wireless LAN adapter Wi-Fi, e.g. `192.168.137.10` or `192.168.43.10`).
   - **Linux / macOS:** `ip addr` or `ifconfig`.
3. (Recommended) Set a static IP or DHCP reservation on your router for the laptop (e.g., `192.168.4.10` or `192.168.137.10`) so `config.h` never needs to change.
4. The Hub listens on `0.0.0.0:8000`.

## 3. Windows Firewall Rule
Open **PowerShell as Administrator** and run:

```powershell
netsh advfirewall firewall add rule name="GloveDrive Hub 8000" dir=in action=allow protocol=TCP localport=8000
```

To verify or remove later:
```powershell
netsh advfirewall firewall show rule name="GloveDrive Hub 8000"
# Remove:
# netsh advfirewall firewall delete rule name="GloveDrive Hub 8000"
```

## 4. Verify Connectivity (Laptop <-> ESP32)
1. Flash `firmware/car/car.ino` (with `MOTOR_DRY_RUN 1`) or a basic Wi-Fi sketch to one ESP32.
2. Open Serial Monitor at `115200` baud and note the ESP32's IP address (e.g. `192.168.137.42`).
3. From the laptop, ping the ESP32:
   ```powershell
   ping 192.168.137.42
   ```
4. Start the hub (`uvicorn hub.app.main:app --host 0.0.0.0 --port 8000`) and confirm in Serial Monitor that the ESP32 connects to `ws://<laptop-ip>:8000/ws/car`.
5. Check `http://127.0.0.1:8000/status` in your browser to see the device online with its RSSI signal strength.
