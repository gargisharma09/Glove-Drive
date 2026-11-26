/**
 * Aegis Rover Command — Dual-Trace Telemetry Sparkline (Velocity + Wi-Fi RSSI)
 */
(function () {
  class TelemetrySparkline {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      this.ctx = this.canvas.getContext('2d');
      this._resize();
      window.addEventListener('resize', () => this._resize());
    }

    _resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(200, Math.floor(rect.width * dpr));
      this.canvas.height = Math.max(40, Math.floor(rect.height * dpr));
      this.dpr = dpr;
      this.w = this.canvas.width / dpr;
      this.h = this.canvas.height / dpr;
    }

    draw(velocityHistory, rssiHistory) {
      const ctx = this.ctx;
      const w = this.w;
      const h = this.h;
      if (!w || !h) return;

      ctx.save();
      ctx.scale(this.dpr, this.dpr);
      ctx.clearRect(0, 0, w, h);

      // Center zero-line for velocity
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // Velocity trace (Electric Cyan)
      this._drawSeries(ctx, velocityHistory, -2.2, 2.2, '#06B6D4', 1.8, w, h);
      // RSSI trace (Cool Periwinkle)
      this._drawSeries(ctx, rssiHistory, -85, -35, '#818CF8', 1.2, w, h);

      ctx.restore();
    }

    _drawSeries(ctx, data, minVal, maxVal, color, lineWidth, w, h) {
      if (!data || data.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * w;
        const norm = (data[i] - minVal) / (maxVal - minVal);
        const y = h - Math.max(0.06, Math.min(0.94, norm)) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  window.TelemetrySparkline = TelemetrySparkline;
})();
