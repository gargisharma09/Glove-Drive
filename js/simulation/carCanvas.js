/**
 * Aegis Rover Command — 2.5D Digital Twin Vehicle Canvas (60fps)
 * Strict Palette: Cyan (#06B6D4), Sky (#38BDF8), Indigo (#6366F1),
 * Periwinkle (#818CF8), Magenta (#EC4899). Zero green/red/yellow/orange.
 */
(function () {
  class CarSimulationCanvas {
    constructor(canvasId, service) {
      this.canvas = document.getElementById(canvasId);
      this.ctx = this.canvas.getContext('2d');
      this.service = service;
      this.treadPhase = 0;
      this.trailParticles = [];
      this.lastTime = performance.now();

      this._resize();
      window.addEventListener('resize', () => this._resize());
      requestAnimationFrame((now) => this._render(now));
    }

    _resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(320, Math.floor(rect.width * dpr));
      this.canvas.height = Math.max(260, Math.floor(rect.height * dpr));
      this.dpr = dpr;
      this.w = this.canvas.width / dpr;
      this.h = this.canvas.height / dpr;
    }

    _render(now) {
      const dt = Math.min((now - this.lastTime) / 1000, 0.05);
      this.lastTime = now;

      const state = this.service.state;
      const car = state.car;
      const ctx = this.ctx;
      const w = this.w;
      const h = this.h;
      const pxPerMeter = 52;

      // Advance wheel tread phase proportional to velocity
      this.treadPhase += car.velocity * dt * 28;

      ctx.save();
      ctx.scale(this.dpr, this.dpr);
      ctx.clearRect(0, 0, w, h);

      // Background subtle radial glow
      const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, Math.max(w, h) * 0.65);
      if (state.emergencyStop) {
        bgGrad.addColorStop(0, 'rgba(236, 72, 153, 0.10)');
      } else if (car.direction === 'REVERSE') {
        bgGrad.addColorStop(0, 'rgba(99, 102, 241, 0.11)');
      } else {
        bgGrad.addColorStop(0, 'rgba(6, 182, 212, 0.10)');
      }
      bgGrad.addColorStop(1, 'rgba(5, 8, 15, 0)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // 1. Scrolling Tactical World Grid (camera-follow centered on rover)
      this._drawWorldGrid(ctx, w, h, car, pxPerMeter);

      // 2. Arena Boundaries & Simulated Obstacles
      this._drawObstaclesAndBounds(ctx, w, h, car, pxPerMeter, now);

      // 3. Cyan Propulsion Trails (when moving forward)
      this._updateAndDrawTrails(ctx, w, h, car, dt, pxPerMeter);

      // 4. Draw Rover in Center (rotated to car.heading)
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(car.heading);

      // Dynamic Ultrasonic / LiDAR Distance Arcs (Front & Rear)
      this._drawSonarArcs(ctx, car, now, pxPerMeter);

      // Forward Motion Effects: Flow Chevrons + Velocity Vector
      if (car.direction === 'FORWARD' && !state.emergencyStop) {
        this._drawForwardFlow(ctx, car, now);
      }

      // Reverse Motion Effects: Automotive Backup Camera Trajectory Guide Arcs + Rear Waves
      if (car.direction === 'REVERSE' && !state.emergencyStop) {
        this._drawReverseTrajectory(ctx, car, now);
      }

      // 2.5D Rover Chassis, Wheels, Steering & Sensor Array
      this._drawRoverChassis(ctx, car, state.emergencyStop, now);

      // Emergency Brake Lock Ring
      if (state.emergencyStop) {
        this._drawEstopLock(ctx, now);
      }

      ctx.restore();
      ctx.restore();

      requestAnimationFrame((t) => this._render(t));
    }

    _drawWorldGrid(ctx, w, h, car, scale) {
      const step = scale * 0.8;
      const offsetX = ((-car.x * scale) % step + step) % step;
      const offsetY = ((-car.y * scale) % step + step) % step;

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = offsetX; x < w; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = offsetY; y < h; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      // Origin crosshair
      const ox = w / 2 - car.x * scale;
      const oy = h / 2 - car.y * scale;
      if (ox > -40 && ox < w + 40 && oy > -40 && oy < h + 40) {
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.28)';
        ctx.beginPath();
        ctx.moveTo(ox - 12, oy);
        ctx.lineTo(ox + 12, oy);
        ctx.moveTo(ox, oy - 12);
        ctx.lineTo(ox, oy + 12);
        ctx.stroke();
      }
    }

    _drawObstaclesAndBounds(ctx, w, h, car, scale, now) {
      const cx = w / 2;
      const cy = h / 2;

      // Arena perimeter (+/- 4.6m)
      const boundPx = 4.6 * scale;
      const bx = cx - car.x * scale - boundPx;
      const by = cy - car.y * scale - boundPx;
      ctx.save();
      ctx.strokeStyle = 'rgba(129, 140, 248, 0.25)';
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx, by, boundPx * 2, boundPx * 2);
      ctx.restore();

      // Obstacles
      for (const obs of this.service.obstacles) {
        const sx = cx + (obs.x - car.x) * scale;
        const sy = cy + (obs.y - car.y) * scale;
        const rPx = obs.r * scale;

        if (sx < -60 || sx > w + 60 || sy < -60 || sy > h + 60) continue;

        ctx.save();
        ctx.fillStyle = 'rgba(99, 102, 241, 0.14)';
        ctx.strokeStyle = 'rgba(129, 140, 248, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Subtle pulse ring
        const pulse = (Math.sin(now * 0.004) + 1) * 0.5;
        ctx.strokeStyle = `rgba(168, 85, 247, ${0.15 + pulse * 0.2})`;
        ctx.beginPath();
        ctx.arc(sx, sy, rPx + 4 + pulse * 4, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
        ctx.font = '600 9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(obs.label, sx, sy + 3);
        ctx.restore();
      }
    }

    _updateAndDrawTrails(ctx, w, h, car, dt, scale) {
      if (car.direction === 'FORWARD' && Math.abs(car.velocity) > 0.25) {
        // Spawn propulsion trail particles behind rear wheels
        const rearOffset = 34;
        const wheelSpread = 24;
        for (const side of [-1, 1]) {
          const lx = side * wheelSpread;
          const ly = rearOffset;
          const wx = car.x + (lx * Math.cos(car.heading) - ly * Math.sin(car.heading)) / scale;
          const wy = car.y + (lx * Math.sin(car.heading) + ly * Math.cos(car.heading)) / scale;
          this.trailParticles.push({ x: wx, y: wy, life: 1.0 });
        }
      }

      for (let i = this.trailParticles.length - 1; i >= 0; i--) {
        const p = this.trailParticles[i];
        p.life -= dt * 2.2;
        if (p.life <= 0) {
          this.trailParticles.splice(i, 1);
          continue;
        }
        const sx = w / 2 + (p.x - car.x) * scale;
        const sy = h / 2 + (p.y - car.y) * scale;
        ctx.fillStyle = `rgba(6, 182, 212, ${p.life * 0.5})`;
        ctx.beginPath();
        ctx.arc(sx, sy, 2.5 * p.life, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    _drawSonarArcs(ctx, car, now, scale) {
      const obstacleCm = (window.AEGIS_CONFIG && window.AEGIS_CONFIG.OBSTACLE_CM) || 75;
      // Front Sonar Arc (car.frontDist is in cm)
      const frontPx = Math.min(130, 38 + (car.frontDist / 100) * 26);
      const frontColor =
        car.frontDist < obstacleCm
          ? '236, 72, 153' // Luminous Magenta
          : car.frontDist < 140
          ? '129, 140, 248' // Cool Periwinkle
          : '56, 189, 248'; // Sky Blue

      for (let i = 0; i < 3; i++) {
        const wave = ((now * 0.0022 + i * 0.33) % 1);
        const r = 38 + wave * (frontPx - 38);
        ctx.strokeStyle = `rgba(${frontColor}, ${(1 - wave) * 0.55})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, -18, r, -Math.PI * 0.72, -Math.PI * 0.28);
        ctx.stroke();
      }

      // Rear Sonar Arc (car.rearDist is in cm)
      const rearPx = Math.min(125, 38 + (car.rearDist / 100) * 24);
      const rearColor =
        car.rearDist < obstacleCm
          ? '236, 72, 153'
          : car.direction === 'REVERSE'
          ? '99, 102, 241'
          : '129, 140, 248';

      const rings = car.direction === 'REVERSE' ? 4 : 2;
      for (let i = 0; i < rings; i++) {
        const wave = ((now * 0.0024 + i * (1 / rings)) % 1);
        const r = 38 + wave * (rearPx - 38);
        ctx.strokeStyle = `rgba(${rearColor}, ${(1 - wave) * (car.direction === 'REVERSE' ? 0.7 : 0.35)})`;
        ctx.lineWidth = car.direction === 'REVERSE' ? 2.2 : 1.5;
        ctx.beginPath();
        ctx.arc(0, 18, r, Math.PI * 0.28, Math.PI * 0.72);
        ctx.stroke();
      }
    }

    _drawForwardFlow(ctx, car, now) {
      const speedNorm = Math.min(1, Math.abs(car.velocity) / 1.8);
      const flowOffset = (now * 0.09) % 24;

      // Animated directional flow chevrons ahead of chassis
      for (let i = 0; i < 3; i++) {
        const y = -58 - i * 22 - flowOffset;
        const alpha = (1 - i * 0.28) * (0.35 + speedNorm * 0.65);
        ctx.strokeStyle = `rgba(6, 182, 212, ${alpha})`;
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-14, y + 8);
        ctx.lineTo(0, y);
        ctx.lineTo(14, y + 8);
        ctx.stroke();
      }

      // Positive velocity vector arrow
      const vecLen = 28 + speedNorm * 42;
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -44);
      ctx.lineTo(0, -44 - vecLen);
      ctx.stroke();
    }

    _drawReverseTrajectory(ctx, car, now) {
      // Automotive backup-camera curved trajectory guide arcs behind chassis
      const steerFactor = (car.steeringAngle / 30) * 42;
      const pulse = 0.65 + Math.sin(now * 0.008) * 0.25;

      ctx.save();
      ctx.lineWidth = 2.5;
      ctx.setLineDash([7, 5]);
      ctx.strokeStyle = `rgba(99, 102, 241, ${pulse})`;

      // Left & Right guide rails
      for (const side of [-22, 22]) {
        ctx.beginPath();
        ctx.moveTo(side, 44);
        ctx.quadraticCurveTo(side + steerFactor * 0.35, 95, side + steerFactor, 138);
        ctx.stroke();
      }

      // Distance cross-bars
      ctx.setLineDash([]);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(129, 140, 248, 0.55)';
      for (const d of [0.35, 0.7, 1.0]) {
        const y = 44 + d * 94;
        const shift = steerFactor * (d * d * 0.75 + d * 0.25);
        ctx.beginPath();
        ctx.moveTo(-20 + shift, y);
        ctx.lineTo(20 + shift, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawRoverChassis(ctx, car, isEstop, now) {
      // 2.5D Drop shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.beginPath();
      ctx.roundRect(-27, -41, 58, 86, 12);
      ctx.fill();

      // 4 Wheels (front wheels pivot with steeringAngle)
      const steerRad = (car.steeringAngle * Math.PI) / 180;
      const wheelPositions = [
        { x: -27, y: -24, steer: steerRad },
        { x: 27, y: -24, steer: steerRad },
        { x: -27, y: 24, steer: 0 },
        { x: 27, y: 24, steer: 0 },
      ];

      for (const wp of wheelPositions) {
        ctx.save();
        ctx.translate(wp.x, wp.y);
        ctx.rotate(wp.steer);

        // Tire body
        ctx.fillStyle = '#0F172A';
        ctx.strokeStyle = isEstop
          ? '#EC4899'
          : car.direction === 'REVERSE'
          ? '#818CF8'
          : '#38BDF8';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.roundRect(-6, -12, 12, 24, 3);
        ctx.fill();
        ctx.stroke();

        // Animated spinning wheel treads
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
        ctx.lineWidth = 1.2;
        const offset = ((this.treadPhase % 6) + 6) % 6;
        for (let ty = -9 + offset; ty <= 9; ty += 6) {
          ctx.beginPath();
          ctx.moveTo(-4, ty);
          ctx.lineTo(4, ty);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Main 2.5D Chassis Body
      const bodyGrad = ctx.createLinearGradient(-22, -40, 22, 40);
      bodyGrad.addColorStop(0, '#1E293B');
      bodyGrad.addColorStop(1, '#0F172A');
      ctx.fillStyle = bodyGrad;
      ctx.strokeStyle = isEstop
        ? '#EC4899'
        : car.direction === 'REVERSE'
        ? '#6366F1'
        : '#06B6D4';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.roundRect(-22, -40, 44, 80, 10);
      ctx.fill();
      ctx.stroke();

      // Inner Canopy / ESP32 Compute Deck
      ctx.fillStyle = 'rgba(9, 13, 22, 0.85)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(-14, -22, 28, 44, 6);
      ctx.fill();
      ctx.stroke();

      // Forward Headlight Beams
      const beamAlpha = car.direction === 'REVERSE' ? 0.12 : 0.35;
      ctx.fillStyle = `rgba(56, 189, 248, ${beamAlpha})`;
      ctx.beginPath();
      ctx.moveTo(-14, -40);
      ctx.lineTo(-28, -74);
      ctx.lineTo(-4, -74);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(14, -40);
      ctx.lineTo(4, -74);
      ctx.lineTo(28, -74);
      ctx.closePath();
      ctx.fill();

      // Rear Tail/Reverse Indicator Strip
      ctx.fillStyle = isEstop
        ? '#EC4899'
        : car.direction === 'REVERSE'
        ? '#818CF8'
        : 'rgba(99, 102, 241, 0.45)';
      ctx.fillRect(-15, 36, 30, 3.5);

      // Center ESP32 Core Status LED
      ctx.fillStyle = isEstop ? '#EC4899' : '#06B6D4';
      ctx.beginPath();
      ctx.arc(0, 0, 4 + Math.sin(now * 0.006) * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    _drawEstopLock(ctx, now) {
      const pulse = 0.55 + Math.sin(now * 0.01) * 0.35;
      ctx.save();
      ctx.strokeStyle = `rgba(236, 72, 153, ${pulse})`;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, 58, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  window.CarSimulationCanvas = CarSimulationCanvas;
})();
