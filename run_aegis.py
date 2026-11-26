"""Aegis Rover Command (GloveDrive) — Single-File Launcher.

Runs both the Frontend (root index.html, CSS, JS) and Backend (FastAPI + WebSockets)
continuously from a single command:
    py run_aegis.py
"""

from __future__ import annotations

import socket
import threading
import time
import webbrowser

import uvicorn

# ---------------------------------------------------------------------------
# Frontend & Backend URL Configuration
# ---------------------------------------------------------------------------
HOST = "0.0.0.0"
PORT = 8000

FRONTEND_URL = f"http://127.0.0.1:{PORT}/"
BACKEND_API_URL = f"http://127.0.0.1:{PORT}/status"
BACKEND_WS_DASHBOARD = f"ws://127.0.0.1:{PORT}/ws/dashboard"
BACKEND_WS_GLOVE_PATH = f":{PORT}/ws/glove"
BACKEND_WS_CAR_PATH = f":{PORT}/ws/car"


def _get_lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def _open_browser_when_ready(url: str) -> None:
    time.sleep(1.2)
    try:
        webbrowser.open(url)
    except Exception:
        pass


def main() -> None:
    lan_ip = _get_lan_ip()
    print("=" * 64)
    print("  AEGIS ROVER COMMAND — UNIFIED FRONTEND & BACKEND LAUNCHER")
    print("=" * 64)
    print(f"  Frontend URL        : {FRONTEND_URL}")
    print(f"  LAN Frontend URL    : http://{lan_ip}:{PORT}/")
    print(f"  Backend Status API  : {BACKEND_API_URL}")
    print(f"  Dashboard WebSocket : {BACKEND_WS_DASHBOARD}")
    print(f"  ESP32 Glove WS      : ws://{lan_ip}{BACKEND_WS_GLOVE_PATH}")
    print(f"  ESP32 Car WS        : ws://{lan_ip}{BACKEND_WS_CAR_PATH}")
    print("=" * 64)
    print("  Press CTRL+C to stop both frontend and backend.\n")

    threading.Thread(
        target=_open_browser_when_ready,
        args=(FRONTEND_URL,),
        daemon=True,
    ).start()

    uvicorn.run("hub.app.main:app", host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    main()
