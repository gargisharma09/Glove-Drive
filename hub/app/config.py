"""Configurable settings for the GloveDrive Hub."""

from pathlib import Path

# Network
HOST = "0.0.0.0"
PORT = 8000

# Timing & Safety (all configurable)
OFFLINE_TIMEOUT_S = 3.0          # Mark device offline after 3.0s without heartbeat/message
WATCHDOG_INTERVAL_S = 0.5        # How often the hub checks device liveness
DEFAULT_DRIVE_SPEED = 75         # Default PWM speed (0-100) for movement gestures
OBSTACLE_THRESHOLD_CM = 25.0     # Trigger glove vibration alert below this distance
OBSTACLE_VIBRATE_STRENGTH = 85   # Vibration strength (0-100) on obstacle alert

# Camera storage
BASE_DIR = Path(__file__).resolve().parent.parent
LATEST_FRAME_PATH = BASE_DIR / "latest.jpg"
