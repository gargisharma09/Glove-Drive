/**
 * Aegis Rover Command — ESP32-CAM & Vision AI Viewport
 * Renders simulated depth-vision in SIMULATION mode, and live /latest.jpg
 * JPEG frames from the FastAPI Hub in LIVE HARDWARE WEBSOCKET mode.
 */
(function () {
  class VisionFeedCanvas {
    constructor(canvasId, service) {
      this.canvas = document.getElementById(canvasId);
      this.ctx = this.canvas.getContext('2d');
      this.service = service;

      // Live ESP32-CAM frame loader (/latest.jpg)
      this.liveImg = new Image();
      this.liveFrameReady = false;
      this.lastFetchMs = 0;
      this._fetching = false;

      this.liveImg.onload = () => {
        this.liveFrameReady = true;
        this._fetching = false;
      };
      this.liveImg.onerror = () => {
        this.liveFrameReady = false;
        this._fetching = false;
      };

      this._resize();
      window.addEventListener('resize', () => this._resize());
      requestAnimationFrame((t) => this._render(t));
    }

    _resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(240, Math.floor(rect.width * dpr));
      this.canvas.height = Math.max(160, Math.floor(rect.height * dpr));
      this.dpr = dpr;
      this.w = this.canvas.width / dpr;
      this.h = this.canvas.height / dpr;
    }

    _pollLiveFrame(now) {
      if (this._fetching || now - this.lastFetchMs < 200) return;
      this.lastFetchMs = now;
      this._fetching = true;
      const base =
        window.location.protocol === 'http:' || window.location.protocol === 'https:'
          ? ''
          : 'http://127.0.0.1:8000';
      this.liveImg.src = `${base}/latest.jpg?t=${Date.now()}`;
    }

    _render(now) {
      const ctx = this.ctx;
      const w = this.w;
      const h = this.h;
      const state = this.service.state;
      const vision = state.vision;
      const isAlert = vision.hazardScore >= 75;
      const isLiveMode = state.mode === 'WEBSOCKET';

      if (isLiveMode) {
        this._pollLiveFrame(now);
      }

      ctx.save();
      ctx.scale(this.dpr, this.dpr);
      ctx.clearRect(0, 0, w, h);

      if (isLiveMode && this.liveFrameReady && this.liveImg.naturalWidth > 0) {
        // Draw live ESP32-CAM JPEG frame (cover-fit)
        const iw = this.liveImg.naturalWidth;
        const ih = this.liveImg.naturalHeight;
        const scale = Math.max(w / iw, h / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        ctx.drawImage(this.liveImg, (w - dw) / 2, (h - dh) / 2, dw, dh);
      } else {
        // Tactical depth-camera backdrop (Simulation or Waiting for ESP32-CAM)
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#070C18');
        bg.addColorStop(0.58, '#0D1729');
        bg.addColorStop(1, '#05080F');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        // Perspective corridor floor lines
        const horizonY = h * 0.56;
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
        ctx.lineWidth = 1;
        for (let i = -4; i <= 4; i++) {
          ctx.beginPath();
          ctx.moveTo(w / 2 + i * 16, horizonY);
          ctx.lineTo(w / 2 + i * 75, h);
          ctx.stroke();
        }
        for (let r = 1; r <= 4; r++) {
          const y = horizonY + (r / 4) * (h - horizonY);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }

        if (isLiveMode && !this.liveFrameReady) {
          ctx.fillStyle = 'rgba(129, 140, 248, 0.9)';
          ctx.font = '600 11px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('WAITING FOR ESP32-CAM FRAME (/latest.jpg)', w / 2, h / 2);
          ctx.textAlign = 'left';
        } else if (vision.personDetected) {
          // Simulated moving pedestrian silhouette
          const walkX = w * 0.5 + Math.sin(now * 0.0011) * (w * 0.22);
          const scale = 0.85 + Math.cos(now * 0.0008) * 0.12;
          const personW = 36 * scale;
          const personH = 92 * scale;
          const personY = horizonY - personH * 0.28;

          ctx.fillStyle = isAlert ? 'rgba(236, 72, 153, 0.26)' : 'rgba(99, 102, 241, 0.30)';
          ctx.beginPath();
          ctx.arc(walkX, personY + 12 * scale, 9 * scale, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.roundRect(walkX - 11 * scale, personY + 23 * scale, 22 * scale, 36 * scale, 6);
          ctx.fill();
          ctx.fillRect(walkX - 9 * scale, personY + 59 * scale, 7 * scale, 28 * scale);
          ctx.fillRect(walkX + 2 * scale, personY + 59 * scale, 7 * scale, 28 * scale);

          if (vision.showBbox) {
            const bx = walkX - personW * 0.65;
            const by = personY - 4;
            const bw = personW * 1.3;
            const bh = personH + 6;
            const boxColor = isAlert ? '#EC4899' : '#06B6D4';

            ctx.strokeStyle = boxColor;
            ctx.lineWidth = 1.8;
            ctx.strokeRect(bx, by, bw, bh);

            const c = 8;
            ctx.lineWidth = 2.6;
            ctx.beginPath();
            ctx.moveTo(bx, by + c); ctx.lineTo(bx, by); ctx.lineTo(bx + c, by);
            ctx.moveTo(bx + bw - c, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + c);
            ctx.moveTo(bx, by + bh - c); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + c, by + bh);
            ctx.moveTo(bx + bw - c, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - c);
            ctx.stroke();

            ctx.fillStyle = boxColor;
            ctx.fillRect(bx, by - 16, 104, 15);
            ctx.fillStyle = '#05080F';
            ctx.font = '700 9px "JetBrains Mono", monospace';
            ctx.fillText(`PERSON ${vision.confidence.toFixed(1)}%`, bx + 4, by - 5);
          }
        }
      }

      // Subtle CRT/Sensor scanlines
      ctx.fillStyle = 'rgba(6, 182, 212, 0.03)';
      for (let y = 0; y < h; y += 4) {
        ctx.fillRect(0, y, w, 1);
      }

      // Camera HUD Overlay
      ctx.fillStyle = 'rgba(241, 245, 249, 0.85)';
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillText(isLiveMode ? 'CAM_01 // LIVE /latest.jpg' : 'CAM_01 // SIMULATED', 10, 16);
      ctx.fillStyle = isAlert ? '#EC4899' : '#38BDF8';
      ctx.fillText(`HAZARD: ${vision.hazardScore}/100`, w - 102, 16);

      ctx.restore();
      requestAnimationFrame((t) => this._render(t));
    }
  }

  window.VisionFeedCanvas = VisionFeedCanvas;
})();
