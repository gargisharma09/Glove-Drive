# Acceptance Tests

Run these checks once all hardware is assembled to validate GloveDrive before demo/deployment:

1. **Hotspot Loss & Recovery**
   - Turn off the 2.4 GHz hotspot/router while driving.
   - **Expected:** Car stops motors within `DRIVE_TIMEOUT_MS` (`500 ms`). When the hotspot returns, glove, car, and camera automatically reconnect without rebooting.
2. **Hub Crash / Shutdown**
   - Close `uvicorn` (`Ctrl+C`) on the laptop while sending `forward`.
   - **Expected:** Car detects WebSocket disconnect / drive timeout and stops motors immediately.
3. **Range / Weak Signal**
   - Walk the car away until Wi-Fi drops or packets stall.
   - **Expected:** Car triggers the safety stop before control is lost entirely.
4. **Status & RSSI**
   - Open `http://<hub-ip>:8000/status`.
   - **Expected:** `glove` and `car` show `online: true` with sensible RSSI values (e.g. `-40` to `-80 dBm`), and `camera` shows recent frames.
5. **Measured Latency**
   - Tilt the glove and check `/status` (`latency_ms`) and hub console logs.
   - **Expected:** Real measured `glove -> hub -> car` latency is logged (typically `5–30 ms` on a local 2.4 GHz network).
6. **Camera Isolation**
   - Stream `POST /frame` at `5 fps` (`FRAMESIZE_QVGA`) while driving.
   - **Expected:** Control commands remain responsive with no noticeable lag.
