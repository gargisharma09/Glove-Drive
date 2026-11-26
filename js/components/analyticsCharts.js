/**
 * Aegis Rover Command — Local Chart.js Sensor Analytics & Tile Sparklines
 * Uses 300-point ring buffers from telemetryService, updates at ~3 Hz with animations off.
 */
(function () {
  // Custom Chart.js plugin for horizontal threshold lines & Hazard Green/Yellow/Red bands
  const thresholdPlugin = {
    id: 'aegisThresholds',
    beforeDraw(chart, _args, opts) {
      if (!opts) return;
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.y) return;

      // Hazard background bands (Green / Yellow / Red only for Hazard chart)
      if (opts.hazardBands) {
        const y = scales.y;
        const bands = [
          { from: 0, to: 45, color: 'rgba(34, 197, 94, 0.11)' },
          { from: 45, to: 75, color: 'rgba(234, 179, 8, 0.12)' },
          { from: 75, to: 100, color: 'rgba(239, 68, 68, 0.14)' },
        ];
        ctx.save();
        for (const b of bands) {
          const yTop = y.getPixelForValue(b.to);
          const yBot = y.getPixelForValue(b.from);
          ctx.fillStyle = b.color;
          ctx.fillRect(chartArea.left, yTop, chartArea.right - chartArea.left, yBot - yTop);
        }
        ctx.restore();
      }
    },
    afterDraw(chart, _args, opts) {
      if (!opts || !opts.lines) return;
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.y) return;

      ctx.save();
      for (const line of opts.lines) {
        const py = scales.y.getPixelForValue(line.value);
        if (py < chartArea.top || py > chartArea.bottom) continue;
        ctx.strokeStyle = line.color;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(chartArea.left, py);
        ctx.lineTo(chartArea.right, py);
        ctx.stroke();

        ctx.fillStyle = line.color;
        ctx.font = '600 9.5px "JetBrains Mono", monospace';
        ctx.fillText(line.label, chartArea.left + 6, py - 4);
      }
      ctx.restore();
    },
  };

  if (window.Chart) {
    Chart.register(thresholdPlugin);
  }

  class AnalyticsChartsManager {
    constructor() {
      this.charts = {};
      this.lastUpdateMs = 0;
      this.tileSparklines = {};
      this._initCharts();
      this._initTileSparklines();
    }

    _baseOptions() {
      return {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: {
              color: '#94A3B8',
              boxWidth: 10,
              font: { family: "'JetBrains Mono', monospace", size: 10 },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#64748B', maxTicksLimit: 6, font: { family: "'JetBrains Mono', monospace", size: 9 } },
            grid: { color: 'rgba(56, 189, 248, 0.06)' },
          },
          y: {
            ticks: { color: '#94A3B8', font: { family: "'JetBrains Mono', monospace", size: 9 } },
            grid: { color: 'rgba(56, 189, 248, 0.08)' },
          },
        },
      };
    }

    _initCharts() {
      if (!window.Chart) return;
      const cfg = window.AEGIS_CONFIG || { GAS_YELLOW: 350, GAS_RED: 600, OBSTACLE_CM: 75 };

      // 1. Temperature & Humidity (separate axes)
      const tempCtx = document.getElementById('chartTempHumidity');
      if (tempCtx) {
        const opts = this._baseOptions();
        opts.scales = {
          x: opts.scales.x,
          y: {
            type: 'linear',
            position: 'left',
            ticks: { color: '#38BDF8', font: { family: "'JetBrains Mono', monospace", size: 9 } },
            grid: { color: 'rgba(56, 189, 248, 0.08)' },
          },
          y1: {
            type: 'linear',
            position: 'right',
            ticks: { color: '#A855F7', font: { family: "'JetBrains Mono', monospace", size: 9 } },
            grid: { drawOnChartArea: false },
          },
        };
        this.charts.tempHum = new Chart(tempCtx, {
          type: 'line',
          data: {
            labels: [],
            datasets: [
              { label: 'Temp (°C)', data: [], borderColor: '#38BDF8', borderWidth: 1.8, pointRadius: 0, yAxisID: 'y' },
              { label: 'Humidity (%)', data: [], borderColor: '#A855F7', borderWidth: 1.8, pointRadius: 0, yAxisID: 'y1' },
            ],
          },
          options: opts,
        });
      }

      // 2. Gas (MQ-2 raw) with GAS_YELLOW & GAS_RED thresholds
      const gasCtx = document.getElementById('chartGas');
      if (gasCtx) {
        const opts = this._baseOptions();
        opts.plugins.aegisThresholds = {
          lines: [
            { value: cfg.GAS_YELLOW, color: '#818CF8', label: `GAS_YELLOW (${cfg.GAS_YELLOW})` },
            { value: cfg.GAS_RED, color: '#EC4899', label: `GAS_RED (${cfg.GAS_RED})` },
          ],
        };
        opts.scales.y.suggestedMin = 100;
        opts.scales.y.suggestedMax = 700;
        this.charts.gas = new Chart(gasCtx, {
          type: 'line',
          data: {
            labels: [],
            datasets: [
              { label: 'MQ-2 Raw', data: [], borderColor: '#06B6D4', borderWidth: 1.8, pointRadius: 0 },
            ],
          },
          options: opts,
        });
      }

      // 3. Distance (HC-SR04 cm) with OBSTACLE_CM line
      const distCtx = document.getElementById('chartDistance');
      if (distCtx) {
        const opts = this._baseOptions();
        opts.plugins.aegisThresholds = {
          lines: [
            { value: cfg.OBSTACLE_CM, color: '#EC4899', label: `OBSTACLE_CM (${cfg.OBSTACLE_CM} cm)` },
          ],
        };
        opts.scales.y.min = 0;
        opts.scales.y.suggestedMax = 380;
        this.charts.dist = new Chart(distCtx, {
          type: 'line',
          data: {
            labels: [],
            datasets: [
              { label: 'Front (cm)', data: [], borderColor: '#38BDF8', borderWidth: 1.8, pointRadius: 0 },
              { label: 'Rear (cm)', data: [], borderColor: '#818CF8', borderWidth: 1.6, pointRadius: 0 },
            ],
          },
          options: opts,
        });
      }

      // 4. Hazard Index (0-100) with Green / Yellow / Red bands
      const hazCtx = document.getElementById('chartHazard');
      if (hazCtx) {
        const opts = this._baseOptions();
        opts.plugins.aegisThresholds = { hazardBands: true };
        opts.scales.y.min = 0;
        opts.scales.y.max = 100;
        this.charts.hazard = new Chart(hazCtx, {
          type: 'line',
          data: {
            labels: [],
            datasets: [
              { label: 'Hazard Index', data: [], borderColor: '#F1F5F9', borderWidth: 2, pointRadius: 0 },
            ],
          },
          options: opts,
        });
      }

      // 5. Link Health (RSSI dBm + per-node latency ms)
      const linkCtx = document.getElementById('chartLinkHealth');
      if (linkCtx) {
        const opts = this._baseOptions();
        opts.scales = {
          x: opts.scales.x,
          y: {
            type: 'linear',
            position: 'left',
            suggestedMin: -85,
            suggestedMax: -35,
            ticks: { color: '#38BDF8', font: { family: "'JetBrains Mono', monospace", size: 9 } },
            grid: { color: 'rgba(56, 189, 248, 0.08)' },
          },
          y1: {
            type: 'linear',
            position: 'right',
            min: 0,
            suggestedMax: 80,
            ticks: { color: '#818CF8', font: { family: "'JetBrains Mono', monospace", size: 9 } },
            grid: { drawOnChartArea: false },
          },
        };
        this.charts.link = new Chart(linkCtx, {
          type: 'line',
          data: {
            labels: [],
            datasets: [
              { label: 'Wi-Fi RSSI (dBm)', data: [], borderColor: '#38BDF8', borderWidth: 1.8, pointRadius: 0, yAxisID: 'y' },
              { label: 'Car Latency (ms)', data: [], borderColor: '#06B6D4', borderWidth: 1.5, pointRadius: 0, yAxisID: 'y1' },
              { label: 'CAM Latency (ms)', data: [], borderColor: '#A855F7', borderWidth: 1.5, pointRadius: 0, yAxisID: 'y1' },
              { label: 'Glove Latency (ms)', data: [], borderColor: '#818CF8', borderWidth: 1.5, pointRadius: 0, yAxisID: 'y1' },
            ],
          },
          options: opts,
        });
      }

      // 6. Motor PWM (Left & Right, 0-255)
      const pwmCtx = document.getElementById('chartMotorPwm');
      if (pwmCtx) {
        const opts = this._baseOptions();
        opts.scales.y.min = 0;
        opts.scales.y.max = 255;
        this.charts.pwm = new Chart(pwmCtx, {
          type: 'line',
          data: {
            labels: [],
            datasets: [
              { label: 'Left PWM (0-255)', data: [], borderColor: '#06B6D4', borderWidth: 1.8, pointRadius: 0 },
              { label: 'Right PWM (0-255)', data: [], borderColor: '#6366F1', borderWidth: 1.8, pointRadius: 0 },
            ],
          },
          options: opts,
        });
      }
    }

    _initTileSparklines() {
      const ids = ['sparkSpeed', 'sparkRpm', 'sparkVolt', 'sparkRssi'];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) this.tileSparklines[id] = el;
      }
    }

    _drawMiniSpark(canvas, data, minV, maxV, color) {
      if (!canvas || !data || data.length < 2) return;
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const slice = data.slice(-60);
      for (let i = 0; i < slice.length; i++) {
        const x = (i / (slice.length - 1)) * w;
        const norm = (slice[i] - minV) / (maxV - minV || 1);
        const y = h - Math.max(0.08, Math.min(0.92, norm)) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    /**
     * Throttled update (max ~3 times/sec) with animations disabled
     */
    update(state) {
      const now = performance.now();
      if (now - this.lastUpdateMs < 330) return;
      this.lastUpdateMs = now;

      const h = state.history;

      // Update mini tile sparklines on Live Telemetry
      this._drawMiniSpark(this.tileSparklines.sparkSpeed, h.velocity, -2.2, 2.2, '#06B6D4');
      this._drawMiniSpark(this.tileSparklines.sparkRpm, h.rpmAvg, -330, 330, '#38BDF8');
      this._drawMiniSpark(this.tileSparklines.sparkVolt, h.voltage, 11.0, 13.0, '#A855F7');
      this._drawMiniSpark(this.tileSparklines.sparkRssi, h.rssi, -85, -35, '#818CF8');

      // Update Chart.js instances in place
      if (this.charts.tempHum) {
        this.charts.tempHum.data.labels = h.labels;
        this.charts.tempHum.data.datasets[0].data = h.temp;
        this.charts.tempHum.data.datasets[1].data = h.humidity;
        this.charts.tempHum.update('none');
      }
      if (this.charts.gas) {
        this.charts.gas.data.labels = h.labels;
        this.charts.gas.data.datasets[0].data = h.gas;
        this.charts.gas.update('none');
      }
      if (this.charts.dist) {
        this.charts.dist.data.labels = h.labels;
        this.charts.dist.data.datasets[0].data = h.frontDistCm;
        this.charts.dist.data.datasets[1].data = h.rearDistCm;
        this.charts.dist.update('none');
      }
      if (this.charts.hazard) {
        this.charts.hazard.data.labels = h.labels;
        this.charts.hazard.data.datasets[0].data = h.hazard;
        this.charts.hazard.update('none');
      }
      if (this.charts.link) {
        this.charts.link.data.labels = h.labels;
        this.charts.link.data.datasets[0].data = h.rssi;
        this.charts.link.data.datasets[1].data = h.latencyCar;
        this.charts.link.data.datasets[2].data = h.latencyCam;
        this.charts.link.data.datasets[3].data = h.latencyGlove;
        this.charts.link.update('none');
      }
      if (this.charts.pwm) {
        this.charts.pwm.data.labels = h.labels;
        this.charts.pwm.data.datasets[0].data = h.pwmLeft;
        this.charts.pwm.data.datasets[1].data = h.pwmRight;
        this.charts.pwm.update('none');
      }
    }
  }

  window.AnalyticsChartsManager = AnalyticsChartsManager;
})();
