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

---

## Dashboard Reliability Checklist

Run these checks against `http://<hub-ip>:8000/` before a live demo:

1. **Hub Stopped**
   - Stop `uvicorn` (`Ctrl+C`) while the dashboard is open.
   - **Expected:** Header badge switches to `Hub Unreachable` with the error message underneath, and polling backs off cleanly (`0.25s` → `5.0s`). Restarting `uvicorn` auto-reconnects without refreshing.
2. **Device Dropped**
   - Disconnect the car or stop `simulator/simulate.py`.
   - **Expected:** Device status flips to `OFFLINE` after `3.0s`, sensor tiles flip to `Stale` after `5.0s`, and the Event Timeline logs `signal lost`.
3. **Page Refresh**
   - Press `Ctrl+R` / `F5` while devices are connected or idle.
   - **Expected:** Latest known state from `/status` loads immediately on `DOMContentLoaded`, then resumes live updates.
4. **Slow Network**
   - Throttle network in browser DevTools (`Slow 3G`) or test over a weak Wi-Fi link.
   - **Expected:** Polling does not pile up overlapping requests (`setTimeout` schedules the next poll only after the previous one completes).
5. **30 Minutes Running**
   - Leave the dashboard open for 30 minutes with live or simulated data.
   - **Expected:** Sensor sparklines stay bounded (`<= 120` points / last 5 min), event/detection lists stay capped (`50` / `20`), and memory stays flat.
6. **Phone View**
   - Open `http://<laptop-ip>:8000/` on a phone connected to the same 2.4 GHz Wi-Fi.
   - **Expected:** Responsive 1-column layout stacks cleanly with readable text and working **Demo Mode** toggle.
