"""Hardware-free simulator for GloveDrive (glove, car, and ESP32-CAM)."""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import time

import httpx
import websockets

# Minimal valid 1x1 JPEG bytes for testing POST /frame without Pillow
TINY_JPEG = bytes.fromhex(
    "ffd8ffe000104a46494600010101004800480000ffdb004300030202030202030303030403"
    "0304050805050404050a070706080c0a0c0c0b0a0b0b0d0e12100d0e110e0b0b1016101113"
    "141515150c0f171816141812141514ffc0000b080001000101011100ffc400140001000000"
    "00000000000000000000000009ffc40014100100000000000000000000000000000000ffda"
    "0008010100003f00d2cf20ffd9"
)


async def run_car(ws_url: str, duration_s: float) -> None:
    async with websockets.connect(ws_url, proxy=None) as ws:
        await ws.send(json.dumps({"t": "hello", "id": "car", "rssi": -54}))
        start = time.monotonic()

        async def recv_loop() -> None:
            async for raw in ws:
                msg = json.loads(raw)
                if msg.get("t") == "drive":
                    print(f"[CAR] RX drive: dir={msg['dir']} speed={msg['speed']} ts={msg['ts']}")
                    await ws.send(json.dumps({"t": "ack", "ts": msg["ts"]}))

        async def send_loop() -> None:
            step = 0
            while (time.monotonic() - start) < duration_s:
                dist_cm = 18.0 if step % 6 == 3 else round(random.uniform(35.0, 120.0), 1)
                sensors = {
                    "t": "sensors",
                    "temp_c": round(random.uniform(24.0, 29.0), 1),
                    "hum_pct": round(random.uniform(45.0, 60.0), 1),
                    "gas_raw": random.randint(250, 350),
                    "dist_cm": dist_cm,
                    "ts": int(time.time() * 1000),
                }
                await ws.send(json.dumps(sensors))
                await ws.send(json.dumps({"t": "hb", "rssi": -54}))
                step += 1
                await asyncio.sleep(0.5)

        recv_task = asyncio.create_task(recv_loop())
        try:
            await send_loop()
        finally:
            recv_task.cancel()


async def run_glove(ws_url: str, duration_s: float) -> None:
    async with websockets.connect(ws_url, proxy=None) as ws:
        await ws.send(json.dumps({"t": "hello", "id": "glove", "rssi": -49}))
        cmds = ["forward", "left", "right", "back", "lock", "forward", "unlock", "stop"]
        start = time.monotonic()

        async def recv_loop() -> None:
            async for raw in ws:
                msg = json.loads(raw)
                if msg.get("t") == "alert":
                    print(f"[GLOVE] RX alert: vibrate={msg['vibrate']} strength={msg['strength']}")

        async def send_loop() -> None:
            idx = 0
            while (time.monotonic() - start) < duration_s:
                cmd = cmds[idx % len(cmds)]
                payload = {"t": "gesture", "cmd": cmd, "ts": int(time.time() * 1000)}
                await ws.send(json.dumps(payload))
                if idx % 5 == 0:
                    await ws.send(json.dumps({"t": "hb", "rssi": -49}))
                idx += 1
                await asyncio.sleep(0.25)

        recv_task = asyncio.create_task(recv_loop())
        try:
            await send_loop()
        finally:
            recv_task.cancel()


async def run_cam(http_url: str, duration_s: float) -> None:
    start = time.monotonic()
    async with httpx.AsyncClient(timeout=2.0) as client:
        while (time.monotonic() - start) < duration_s:
            resp = await client.post(
                f"{http_url}/frame",
                content=TINY_JPEG,
                headers={"Content-Type": "image/jpeg"},
            )
            if resp.status_code != 200:
                print(f"[CAM] POST /frame failed: {resp.status_code}")
            await asyncio.sleep(0.2)


async def main(host: str, port: int, duration_s: float) -> None:
    ws_base = f"ws://{host}:{port}"
    http_base = f"http://{host}:{port}"
    print(f"Starting GloveDrive simulator against {http_base} for {duration_s}s...")

    await asyncio.gather(
        run_car(f"{ws_base}/ws/car", duration_s),
        run_glove(f"{ws_base}/ws/glove", duration_s),
        run_cam(http_base, duration_s),
    )

    async with httpx.AsyncClient(timeout=2.0) as client:
        status = (await client.get(f"{http_base}/status")).json()
        print("\n=== HUB /status ===")
        print(json.dumps(status, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GloveDrive hardware-free simulator")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--duration", type=float, default=5.0)
    args = parser.parse_args()
    asyncio.run(main(args.host, args.port, args.duration))
