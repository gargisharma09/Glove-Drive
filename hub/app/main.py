"""GloveDrive FastAPI Hub.

Bridges the Glove ESP32, Car ESP32, and ESP32-CAM over a local 2.4 GHz Wi-Fi
network without any internet dependency.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse

from .config import (
    DEFAULT_DRIVE_SPEED,
    LATEST_FRAME_PATH,
    OBSTACLE_THRESHOLD_CM,
    OBSTACLE_VIBRATE_STRENGTH,
    OFFLINE_TIMEOUT_S,
    WATCHDOG_INTERVAL_S,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("glovedrive.hub")


@dataclass
class DeviceState:
    name: str
    websocket: WebSocket | None = None
    online: bool = False
    last_seen: float = 0.0
    last_hb: float = 0.0
    rssi: int | None = None
    msg_count: int = 0
    offline_logged: bool = False

    def touch(self, rssi: int | None = None) -> None:
        now = time.monotonic()
        self.last_seen = now
        self.msg_count += 1
        if rssi is not None:
            self.rssi = rssi
        if not self.online:
            self.online = True
            self.offline_logged = False
            logger.info("Device '%s' is ONLINE (rssi=%s)", self.name, self.rssi)

    def to_status(self) -> dict[str, Any]:
        now = time.monotonic()
        last_seen_ago = round(now - self.last_seen, 3) if self.last_seen > 0 else None
        return {
            "online": self.online,
            "connected": self.websocket is not None,
            "last_seen_ago_s": last_seen_ago,
            "rssi_dbm": self.rssi,
            "signal_health": _classify_rssi(self.rssi),
            "msg_count": self.msg_count,
        }


def _classify_rssi(rssi: int | None) -> str:
    if rssi is None:
        return "unknown"
    if rssi >= -60:
        return "excellent"
    if rssi >= -70:
        return "good"
    if rssi >= -80:
        return "fair"
    return "weak"


@dataclass
class HubState:
    started_at: float = field(default_factory=time.monotonic)
    locked: bool = False
    glove: DeviceState = field(default_factory=lambda: DeviceState("glove"))
    car: DeviceState = field(default_factory=lambda: DeviceState("car"))
    last_drive: dict[str, Any] = field(default_factory=lambda: {"dir": "stop", "speed": 0})
    latest_sensors: dict[str, Any] = field(default_factory=dict)
    sensors_last_seen: float = 0.0
    camera_frames: int = 0
    camera_last_seen: float = 0.0
    camera_last_bytes: int = 0
    forward_latencies_ms: deque[float] = field(default_factory=lambda: deque(maxlen=50))
    rtt_latencies_ms: deque[float] = field(default_factory=lambda: deque(maxlen=50))
    pending_acks: dict[int, float] = field(default_factory=dict)
    events: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=50))
    detections: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=20))
    latest_detection: dict[str, Any] | None = None

    def add_event(self, kind: str, message: str, hazard: str = "green") -> None:
        self.events.appendleft(
            {
                "ts": int(time.time() * 1000),
                "kind": kind,
                "message": message,
                "hazard": hazard,
            }
        )


state = HubState()
DASHBOARD_PATH = Path(__file__).resolve().parent / "dashboard.html"


# ---------------------------------------------------------------------------
# Future Extension Hooks (Person Detection & Cloud Upload)
# ---------------------------------------------------------------------------

async def detect_person_hook(frame_bytes: bytes) -> None:
    """Hook for future person-detection inference on incoming JPEG frames."""
    _ = frame_bytes


async def cloud_upload_hook(frame_bytes: bytes) -> None:
    """Hook for future asynchronous cloud upload when internet is available."""
    _ = frame_bytes


async def on_frame_received(frame_bytes: bytes) -> None:
    """Runs post-capture hooks without blocking the control path."""
    await asyncio.gather(
        detect_person_hook(frame_bytes),
        cloud_upload_hook(frame_bytes),
    )


# ---------------------------------------------------------------------------
# Background Watchdog
# ---------------------------------------------------------------------------

async def _send_car_stop(reason: str) -> None:
    state.last_drive = {"dir": "stop", "speed": 0}
    ws = state.car.websocket
    if ws is None:
        return
    payload = {
        "t": "drive",
        "dir": "stop",
        "speed": 0,
        "ts": int(time.time() * 1000),
    }
    try:
        await ws.send_text(json.dumps(payload, separators=(",", ":")))
        logger.info("Sent STOP to car (%s)", reason)
    except Exception as exc:
        logger.warning("Failed to send STOP to car (%s): %s", reason, exc)


async def heartbeat_watchdog() -> None:
    """Marks devices offline if no heartbeat/message arrives within timeout."""
    while True:
        await asyncio.sleep(WATCHDOG_INTERVAL_S)
        now = time.monotonic()
        for dev in (state.glove, state.car):
            if dev.last_seen > 0 and (now - dev.last_seen) > OFFLINE_TIMEOUT_S:
                if dev.online or not dev.offline_logged:
                    dev.online = False
                    dev.offline_logged = True
                    state.add_event("signal_lost", f"{dev.name} signal lost (offline > {OFFLINE_TIMEOUT_S}s)", "yellow")
                    logger.warning(
                        "Device '%s' marked OFFLINE (no message for > %.1fs)",
                        dev.name,
                        OFFLINE_TIMEOUT_S,
                    )
                    if dev.name == "glove" and state.car.online:
                        await _send_car_stop("glove offline")


@asynccontextmanager
async def lifespan(_: FastAPI):
    LATEST_FRAME_PATH.parent.mkdir(parents=True, exist_ok=True)
    task = asyncio.create_task(heartbeat_watchdog())
    logger.info("GloveDrive Hub started (offline_timeout=%.1fs)", OFFLINE_TIMEOUT_S)
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        logger.info("GloveDrive Hub stopped")


app = FastAPI(title="GloveDrive Hub", version="1.0.0", lifespan=lifespan)


# ---------------------------------------------------------------------------
# WebSocket Endpoints
# ---------------------------------------------------------------------------

@app.websocket("/ws/glove")
async def ws_glove(websocket: WebSocket) -> None:
    await websocket.accept()
    state.glove.websocket = websocket
    state.glove.touch()
    logger.info("Glove WebSocket connected")

    try:
        while True:
            raw = await websocket.receive_text()
            rx_mono = time.monotonic()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("Invalid JSON from glove: %s", raw)
                continue

            rssi = msg.get("rssi")
            state.glove.touch(rssi=rssi if isinstance(rssi, int) else None)
            msg_type = msg.get("t")

            if msg_type == "hello":
                logger.info("Glove hello: %s", msg)
                await websocket.send_text(json.dumps({"t": "hb"}))
                continue

            if msg_type == "hb":
                state.glove.last_hb = rx_mono
                await websocket.send_text(json.dumps({"t": "hb"}))
                continue

            if msg_type == "gesture":
                cmd = str(msg.get("cmd", "stop")).lower()
                ts = int(msg.get("ts", int(time.time() * 1000)))

                if cmd == "lock":
                    if not state.locked:
                        state.add_event("lock", "System locked by glove", "green")
                    state.locked = True
                    logger.info("System LOCKED by glove")
                    await _send_car_stop("locked")
                    continue

                if cmd == "unlock":
                    if state.locked:
                        state.add_event("unlock", "System unlocked by glove", "green")
                    state.locked = False
                    logger.info("System UNLOCKED by glove")
                    continue

                if state.locked and cmd != "stop":
                    logger.debug("Ignored gesture '%s' while locked", cmd)
                    await _send_car_stop("locked")
                    continue

                if cmd not in {"forward", "back", "left", "right", "stop"}:
                    logger.warning("Unknown gesture cmd: %s", cmd)
                    continue

                drive_msg = {
                    "t": "drive",
                    "dir": cmd,
                    "speed": 0 if cmd == "stop" else DEFAULT_DRIVE_SPEED,
                    "ts": ts,
                }
                state.last_drive = {"dir": cmd, "speed": drive_msg["speed"]}
                car_ws = state.car.websocket
                if car_ws is not None:
                    try:
                        state.pending_acks[ts] = rx_mono
                        if len(state.pending_acks) > 200:
                            oldest = next(iter(state.pending_acks))
                            state.pending_acks.pop(oldest, None)
                        await car_ws.send_text(json.dumps(drive_msg, separators=(",", ":")))
                        fwd_ms = (time.monotonic() - rx_mono) * 1000.0
                        state.forward_latencies_ms.append(fwd_ms)
                        logger.info(
                            "Glove->Car dir=%s speed=%d hub_fwd=%.2fms",
                            cmd,
                            drive_msg["speed"],
                            fwd_ms,
                        )
                    except Exception as exc:
                        logger.warning("Failed to forward drive to car: %s", exc)
                else:
                    logger.debug("Car not connected; dropped gesture '%s'", cmd)

    except WebSocketDisconnect:
        logger.warning("Glove WebSocket disconnected")
    finally:
        if state.glove.websocket is websocket:
            state.glove.websocket = None
            state.glove.online = False
        await _send_car_stop("glove disconnected")


@app.websocket("/ws/car")
async def ws_car(websocket: WebSocket) -> None:
    await websocket.accept()
    state.car.websocket = websocket
    state.car.touch()
    logger.info("Car WebSocket connected")

    try:
        while True:
            raw = await websocket.receive_text()
            rx_mono = time.monotonic()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("Invalid JSON from car: %s", raw)
                continue

            rssi = msg.get("rssi")
            state.car.touch(rssi=rssi if isinstance(rssi, int) else None)
            msg_type = msg.get("t")

            if msg_type == "hello":
                logger.info("Car hello: %s", msg)
                await websocket.send_text(json.dumps({"t": "hb"}))
                continue

            if msg_type == "hb":
                state.car.last_hb = rx_mono
                await websocket.send_text(json.dumps({"t": "hb"}))
                continue

            if msg_type == "ack":
                ts = msg.get("ts")
                if isinstance(ts, int) and ts in state.pending_acks:
                    t0 = state.pending_acks.pop(ts)
                    rtt_ms = (rx_mono - t0) * 1000.0
                    state.rtt_latencies_ms.append(rtt_ms)
                    logger.info("Measured glove->hub->car RTT: %.2f ms", rtt_ms)
                continue

            if msg_type == "sensors":
                state.sensors_last_seen = rx_mono
                state.latest_sensors = {
                    "temp_c": msg.get("temp_c"),
                    "hum_pct": msg.get("hum_pct"),
                    "gas_raw": msg.get("gas_raw"),
                    "dist_cm": msg.get("dist_cm"),
                    "ts": msg.get("ts"),
                }
                dist_cm = msg.get("dist_cm")
                if isinstance(dist_cm, (int, float)) and 0 < dist_cm < OBSTACLE_THRESHOLD_CM:
                    glove_ws = state.glove.websocket
                    if glove_ws is not None:
                        alert = {
                            "t": "alert",
                            "vibrate": True,
                            "strength": OBSTACLE_VIBRATE_STRENGTH,
                        }
                        try:
                            await glove_ws.send_text(json.dumps(alert, separators=(",", ":")))
                            state.add_event("obstacle", f"Obstacle alert ({dist_cm} cm < {OBSTACLE_THRESHOLD_CM} cm)", "yellow")
                            logger.info(
                                "Obstacle alert sent to glove (dist_cm=%.1f < %.1f)",
                                dist_cm,
                                OBSTACLE_THRESHOLD_CM,
                            )
                        except Exception as exc:
                            logger.warning("Failed to send alert to glove: %s", exc)

    except WebSocketDisconnect:
        logger.warning("Car WebSocket disconnected")
    finally:
        if state.car.websocket is websocket:
            state.car.websocket = None
            state.car.online = False


# ---------------------------------------------------------------------------
# HTTP Endpoints (Camera & Status)
# ---------------------------------------------------------------------------

@app.get("/")
async def get_dashboard() -> Response:
    return FileResponse(DASHBOARD_PATH, media_type="text/html")


@app.post("/frame")
async def post_frame(request: Request) -> JSONResponse:
    frame_bytes = await request.body()
    if not frame_bytes:
        return JSONResponse({"ok": False, "error": "empty frame"}, status_code=400)

    tmp_path = LATEST_FRAME_PATH.with_suffix(".tmp")
    tmp_path.write_bytes(frame_bytes)
    os.replace(tmp_path, LATEST_FRAME_PATH)

    state.camera_frames += 1
    state.camera_last_seen = time.monotonic()
    state.camera_last_bytes = len(frame_bytes)

    asyncio.create_task(on_frame_received(frame_bytes))
    return JSONResponse({"ok": True, "bytes": len(frame_bytes), "frames": state.camera_frames})


@app.get("/latest.jpg")
async def get_latest_frame() -> Response:
    if not LATEST_FRAME_PATH.exists():
        return JSONResponse({"error": "no frame received yet"}, status_code=404)
    return FileResponse(LATEST_FRAME_PATH, media_type="image/jpeg")


@app.get("/status")
async def get_status() -> JSONResponse:
    now = time.monotonic()
    cam_ago = round(now - state.camera_last_seen, 3) if state.camera_last_seen > 0 else None
    cam_online = cam_ago is not None and cam_ago <= OFFLINE_TIMEOUT_S

    fwd_list = list(state.forward_latencies_ms)
    rtt_list = list(state.rtt_latencies_ms)

    return JSONResponse(
        {
            "hub_uptime_s": round(now - state.started_at, 2),
            "locked": state.locked,
            "last_drive": state.last_drive,
            "devices": {
                "glove": state.glove.to_status(),
                "car": state.car.to_status(),
                "camera": {
                    "online": cam_online,
                    "frames_received": state.camera_frames,
                    "last_frame_ago_s": cam_ago,
                    "last_frame_bytes": state.camera_last_bytes,
                },
            },
            "latest_sensors": state.latest_sensors,
            "sensors_last_seen_ago_s": round(now - state.sensors_last_seen, 3)
            if state.sensors_last_seen > 0
            else None,
            "latency_ms": {
                "last_hub_forward_ms": round(fwd_list[-1], 3) if fwd_list else None,
                "avg_hub_forward_ms": round(sum(fwd_list) / len(fwd_list), 3) if fwd_list else None,
                "last_rtt_ms": round(rtt_list[-1], 3) if rtt_list else None,
                "avg_rtt_ms": round(sum(rtt_list) / len(rtt_list), 3) if rtt_list else None,
                "samples": len(rtt_list),
            },
            "latest_detection": state.latest_detection,
            "detections": list(state.detections),
            "events": list(state.events),
        }
    )
