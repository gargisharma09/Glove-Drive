/**
 * Aegis Rover Command — Telemetry & WebSocket State Service
 *
 * Cleanly separates hardware WebSocket ingestion from the 60fps physics simulator.
 * Real ESP32 JSON payloads matching:
 *   { command, velocity, direction, sensors, hazardScore, personDetected }
 * can be routed directly into `telemetryService.ingestPayload(data)`.
 */
(function () {
  const MAX_HISTORY = 300;
  const MAX_LOGS = 40;

  // Config placeholders for Sensor Analytics thresholds
  window.AEGIS_CONFIG = {
    GAS_YELLOW: 350,
    GAS_RED: 600,
    OBSTACLE_CM: 75,
  };

  function pushRing(arr, val) {
    arr.push(val);
    if (arr.length > MAX_HISTORY) arr.shift();
  }

  function nowTime() {
    const d = new Date();
    return d.toTimeString().slice(0, 8);
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  class TelemetryService {
    constructor() {
      this.listeners = new Set();
      this.ws = null;
      this.lastTick = performance.now();
      this.syncTimer = 0;
      this.voiceTimeoutIds = [];
      this.autoDriveTimer = null;

      this.manualInput = {
        forward: false,
        backward: false,
        left: false,
        right: false,
      };

      // Simulated obstacles in the 2.5D arena (meters from center)
      this.obstacles = [
        { x: 0, y: -3.4, r: 0.45, label: 'BARRIER_N' },
        { x: 2.6, y: -1.8, r: 0.38, label: 'PYLON_NE' },
        { x: -2.4, y: 1.9, r: 0.42, label: 'CRATE_SW' },
        { x: 1.8, y: 3.1, r: 0.40, label: 'WALL_SE' },
      ];

      this.state = {
        mode: 'SIMULATION', // 'SIMULATION' | 'WEBSOCKET'
        wsState: 'SIMULATED', // 'SIMULATED' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED'
        wsUrl: 'ws://192.168.4.1:81/ws',
        controlLock: 'MANUAL_SIM_OVERRIDE', // 'GLOVE_PRIORITY' | 'AI_VOICE_INTENT' | 'MANUAL_SIM_OVERRIDE'
        emergencyStop: false,
        voiceStopShortcut: false,

        car: {
          x: 0,
          y: 0,
          heading: 0, // radians, 0 = facing North (up)
          velocity: 0, // m/s (+ forward, - reverse)
          targetVelocity: 0,
          steeringAngle: 0, // degrees (-32 to +32)
          targetSteering: 0,
          direction: 'IDLE', // 'FORWARD' | 'REVERSE' | 'IDLE'
          command: 'IDLE',
          pwm: 0,
          pwmLeft: 0,
          pwmRight: 0,
          rpmLeft: 0,
          rpmRight: 0,
          batteryVoltage: 12.42,
          rssi: -54,
          frontDist: 285,
          rearDist: 340,
          tempC: 26.4,
          humidity: 48.2,
          gasRaw: 215,
        },

        glove: {
          gesture: 'NEUTRAL',
          connected: true,
          latencyMs: 14,
          packetRate: 50,
        },

        voice: {
          transcript: 'Awaiting voice command...',
          intent: 'NONE',
          validatorStatus: 'VALIDATED_SAFE',
          activeStage: null, // 'SPEECH' | 'AI_AGENT' | 'VALIDATOR' | 'ROUTER' | 'CAR'
        },

        vision: {
          fps: 24,
          personDetected: true,
          confidence: 94.2,
          showBbox: true,
          hazardScore: 28,
          manualHazardOverride: false,
        },

        nodes: {
          glove: {
            id: 'glove',
            title: 'ESP32 Glove',
            proto: 'BLE 5.0',
            status: 'NOMINAL',
            latencyMs: 14,
            packetRate: 50,
            signal: '-48 dBm',
            ip: 'BLE // AA:4C:91:08',
            detail: 'IMU Tilt + Flex Sensor Stream',
          },
          hub: {
            id: 'hub',
            title: 'Speech → AI → Validator',
            proto: 'Laptop Hub',
            status: 'NOMINAL',
            latencyMs: 38,
            packetRate: 12,
            signal: 'LOCALHOST',
            ip: '127.0.0.1:5000',
            detail: 'Whisper STT + Intent LLM + Safety Bounds',
          },
          router: {
            id: 'router',
            title: 'Control Router',
            proto: 'Unified Path',
            status: 'NOMINAL',
            latencyMs: 4,
            packetRate: 60,
            signal: 'INTERNAL',
            ip: '192.168.4.2',
            detail: 'Priority Arbiter & Wi-Fi Command Dispatcher',
          },
          car: {
            id: 'car',
            title: 'ESP32 Car',
            proto: 'Wi-Fi UDP/WS',
            status: 'NOMINAL',
            latencyMs: 19,
            packetRate: 60,
            signal: '-54 dBm',
            ip: '192.168.4.1',
            detail: 'Dual H-Bridge PWM + Ultrasonic Sonar Array',
          },
          cam: {
            id: 'cam',
            title: 'ESP32-CAM → Vision',
            proto: 'MJPEG + AI',
            status: 'NOMINAL',
            latencyMs: 42,
            packetRate: 24,
            signal: '-59 dBm',
            ip: '192.168.4.12',
            detail: 'YOLOv8-Nano Person Detection & Hazard Index',
          },
          cloud: {
            id: 'cloud',
            title: 'Sync Queue → Cloud',
            proto: 'HTTPS / WSS',
            status: 'NOMINAL',
            latencyMs: 68,
            packetRate: 4,
            signal: 'TLS 1.3',
            ip: 'cloud.aegis-rover.io',
            detail: 'Telemetry Snapshots & Vision Frame Bucket',
          },
        },
        startedAt: Date.now(),

        logs: [
          { time: nowTime(), source: 'ROUTER', message: 'Unified Control Router initialized in SIMULATION mode.' },
          { time: nowTime(), source: 'GLOVE', message: 'ESP32 BLE Glove paired (14ms latency, 50Hz).' },
          { time: nowTime(), source: 'VALIDATOR', message: 'Safety envelope armed: max_v=220 cm/s, min_sonar=45 cm.' },
        ],

        syncQueue: [
          { id: 'FRM-4092', type: 'VISION_FRAME', sizeKb: 48, status: 'SYNCING', timestamp: nowTime() },
          { id: 'TLM-8814', type: 'TELEMETRY_BATCH', sizeKb: 12, status: 'QUEUED', timestamp: nowTime() },
          { id: 'HAZ-0193', type: 'HAZARD_SNAPSHOT', sizeKb: 64, status: 'QUEUED', timestamp: nowTime() },
        ],

        history: {
          labels: new Array(MAX_HISTORY).fill(''),
          velocity: new Array(MAX_HISTORY).fill(0),
          rssi: new Array(MAX_HISTORY).fill(-54),
          voltage: new Array(MAX_HISTORY).fill(12.42),
          rpmAvg: new Array(MAX_HISTORY).fill(0),
          temp: new Array(MAX_HISTORY).fill(26.4),
          humidity: new Array(MAX_HISTORY).fill(48.2),
          gas: new Array(MAX_HISTORY).fill(215),
          frontDistCm: new Array(MAX_HISTORY).fill(285),
          rearDistCm: new Array(MAX_HISTORY).fill(340),
          hazard: new Array(MAX_HISTORY).fill(28),
          latencyCar: new Array(MAX_HISTORY).fill(19),
          latencyCam: new Array(MAX_HISTORY).fill(42),
          latencyGlove: new Array(MAX_HISTORY).fill(14),
          pwmLeft: new Array(MAX_HISTORY).fill(0),
          pwmRight: new Array(MAX_HISTORY).fill(0),
        },
      };

      this._startLoop();
    }

    subscribe(fn) {
      this.listeners.add(fn);
      fn(this.state);
      return () => this.listeners.delete(fn);
    }

    notify() {
      for (const fn of this.listeners) {
        fn(this.state);
      }
    }

    addLog(source, message) {
      this.state.logs.unshift({ time: nowTime(), source, message });
      if (this.state.logs.length > MAX_LOGS) {
        this.state.logs.length = MAX_LOGS;
      }
      if ((source === 'ALERT' || source === 'VALIDATOR') && window.supabaseService && window.supabaseService.enabled) {
        window.supabaseService.syncAlert(source, message, this.state);
      }
    }

    setMode(mode) {
      this.state.mode = mode;
      if (mode === 'SIMULATION') {
        this.disconnectWebSocket();
        this.state.wsState = 'SIMULATED';
        this.addLog('ROUTER', 'Switched to INTERACTIVE SIMULATION MODE.');
      } else {
        this.connectWebSocket(this.state.wsUrl);
      }
      this.notify();
    }

    connectWebSocket(url) {
      this.state.wsUrl = url || this.state.wsUrl;
      this.disconnectWebSocket();
      this.state.mode = 'WEBSOCKET';
      this.state.wsState = 'CONNECTING';
      this.addLog('ROUTER', `Connecting WebSocket to ${this.state.wsUrl}...`);
      this.notify();

      try {
        const ws = new WebSocket(this.state.wsUrl);
        this.ws = ws;

        ws.onopen = () => {
          this.state.wsState = 'CONNECTED';
          this.addLog('ROUTER', `Live Hardware WebSocket connected (${this.state.wsUrl}).`);
          this.notify();
        };

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            this.ingestPayload(payload);
          } catch (err) {
            this.addLog('ALERT', `Malformed WS JSON payload: ${err.message}`);
            this.notify();
          }
        };

        ws.onerror = () => {
          this.state.wsState = 'DISCONNECTED';
          this.addLog('ALERT', `WebSocket error on ${this.state.wsUrl}. Check ESP32/Hub bridge.`);
          this.notify();
        };

        ws.onclose = () => {
          if (this.state.mode === 'WEBSOCKET') {
            this.state.wsState = 'DISCONNECTED';
            this.addLog('ROUTER', 'WebSocket link closed.');
            this.notify();
          }
        };
      } catch (err) {
        this.state.wsState = 'DISCONNECTED';
        this.addLog('ALERT', `WebSocket init failed: ${err.message}`);
        this.notify();
      }
    }

    disconnectWebSocket() {
      if (this.ws) {
        try {
          this.ws.close();
        } catch (_) {}
        this.ws = null;
      }
    }

    /**
     * Plug-and-play ingestion for real ESP32 JSON payloads:
     * { command, velocity, direction, sensors, hazardScore, personDetected }
     */
    ingestPayload(payload) {
      if (!payload || typeof payload !== 'object') return;
      const car = this.state.car;

      if (typeof payload.command === 'string') {
        car.command = payload.command;
      }
      if (typeof payload.velocity === 'number') {
        car.velocity = payload.velocity;
        car.targetVelocity = payload.velocity;
      }
      if (typeof payload.direction === 'string') {
        car.direction = payload.direction;
      } else {
        car.direction = car.velocity > 0.05 ? 'FORWARD' : car.velocity < -0.05 ? 'REVERSE' : 'IDLE';
      }
      if (payload.sensors && typeof payload.sensors === 'object') {
        if (typeof payload.sensors.frontDist === 'number') {
          car.frontDist = payload.sensors.frontDist < 10 ? Math.round(payload.sensors.frontDist * 100) : Math.round(payload.sensors.frontDist);
        }
        if (typeof payload.sensors.rearDist === 'number') {
          car.rearDist = payload.sensors.rearDist < 10 ? Math.round(payload.sensors.rearDist * 100) : Math.round(payload.sensors.rearDist);
        }
        if (typeof payload.sensors.rssi === 'number') car.rssi = payload.sensors.rssi;
        if (typeof payload.sensors.batteryVoltage === 'number') car.batteryVoltage = payload.sensors.batteryVoltage;
        if (typeof payload.sensors.steeringAngle === 'number') car.steeringAngle = payload.sensors.steeringAngle;
        if (typeof payload.sensors.tempC === 'number') car.tempC = payload.sensors.tempC;
        if (typeof payload.sensors.humidity === 'number') car.humidity = payload.sensors.humidity;
        if (typeof payload.sensors.gasRaw === 'number') car.gasRaw = payload.sensors.gasRaw;
      }
      if (typeof payload.hazardScore === 'number') {
        this.state.vision.hazardScore = clamp(Math.round(payload.hazardScore), 0, 100);
      }
      if (typeof payload.personDetected === 'boolean') {
        this.state.vision.personDetected = payload.personDetected;
      }

      car.pwm = Math.round(clamp(Math.abs(car.velocity) / 2.2, 0, 1) * 100);
      const baseRpm = Math.round(car.velocity * 145);
      car.rpmLeft = baseRpm;
      car.rpmRight = baseRpm;
      car.pwmLeft = Math.round(clamp(Math.abs(car.rpmLeft) / 330, 0, 1) * 255);
      car.pwmRight = Math.round(clamp(Math.abs(car.rpmRight) / 330, 0, 1) * 255);

      this.addLog('ROUTER', `RX Payload: CMD=${car.command} V=${Math.round(car.velocity * 100)}cm/s HAZ=${this.state.vision.hazardScore}`);
      this.notify();
    }

    setManualDrive(key, isPressed) {
      if (this.state.emergencyStop && isPressed) {
        this.addLog('ALERT', 'Drive blocked: Emergency Stop lock is engaged. Reset pose/lock first.');
        this.notify();
        return;
      }
      this.manualInput[key] = isPressed;
      if (isPressed) {
        this.state.controlLock = 'MANUAL_SIM_OVERRIDE';
      }
    }

    triggerGloveGesture(gesture) {
      this.state.glove.gesture = gesture;
      this.state.controlLock = 'GLOVE_PRIORITY';

      if (gesture === 'FIST_STOP') {
        this.addLog('GLOVE', 'BLE Gesture: FIST_STOP -> Instant brake override.');
        this.triggerEmergencyStop('GLOVE_FIST_STOP');
        return;
      }

      if (this.state.emergencyStop) {
        this.state.emergencyStop = false;
        this.state.voiceStopShortcut = false;
      }

      const car = this.state.car;
      if (gesture === 'TILT_FORWARD') {
        car.targetVelocity = 1.65;
        car.targetSteering = 0;
        car.command = 'GLOVE_FWD';
      } else if (gesture === 'TILT_BACK') {
        car.targetVelocity = -1.10;
        car.targetSteering = 0;
        car.command = 'GLOVE_REV';
      } else if (gesture === 'TILT_LEFT') {
        car.targetVelocity = 1.15;
        car.targetSteering = -24;
        car.command = 'GLOVE_STEER_L';
      } else if (gesture === 'TILT_RIGHT') {
        car.targetVelocity = 1.15;
        car.targetSteering = 24;
        car.command = 'GLOVE_STEER_R';
      } else {
        car.targetVelocity = 0;
        car.targetSteering = 0;
        car.command = 'GLOVE_NEUTRAL';
      }

      this.addLog('GLOVE', `BLE Gesture: ${gesture} -> Router CMD=${car.command}`);
      this.notify();
    }

    /**
     * Triggers full Speech -> AI Agent -> Validator -> Control Router -> Car Motion pipeline
     */
    submitVoiceCommand(rawText) {
      const text = (rawText || '').trim();
      if (!text) return;

      // Clear any previous staged timeouts
      this.voiceTimeoutIds.forEach(clearTimeout);
      this.voiceTimeoutIds = [];
      if (this.autoDriveTimer) {
        clearTimeout(this.autoDriveTimer);
        this.autoDriveTimer = null;
      }

      const lower = text.toLowerCase();
      this.state.voice.transcript = `"${text}"`;
      this.state.voice.activeStage = 'SPEECH';
      this.addLog('AI_AGENT', `Speech STT: ${this.state.voice.transcript}`);
      this.notify();

      // Immediate VOICE STOP SHORTCUT detection
      if (lower === 'stop' || lower.includes('halt') || lower.includes('emergency') || lower.includes('freeze')) {
        this.state.voiceStopShortcut = true;
        this.state.voice.intent = 'VOICE_STOP_SHORTCUT';
        this.state.voice.validatorStatus = 'OVERRIDE_BYPASS';
        this.state.voice.activeStage = 'ROUTER';
        this.addLog('ALERT', 'VOICE STOP SHORTCUT triggered! Bypassing queue -> Instant E-Stop.');
        this.triggerEmergencyStop('VOICE_STOP_SHORTCUT');
        return;
      }

      // Stage 2: AI Agent Intent Parsing
      this.voiceTimeoutIds.push(setTimeout(() => {
        let intent = 'MOVE_FORWARD(200 cm)';
        let targetV = 1.5;
        let targetSteer = 0;
        let cmd = 'AI_FWD_200CM';
        let durationMs = 1800;

        if (lower.includes('back') || lower.includes('reverse')) {
          intent = 'MOVE_REVERSE(100 cm)';
          targetV = -1.05;
          cmd = 'AI_REV_100CM';
          durationMs = 1600;
        } else if (lower.includes('left')) {
          intent = 'STEER_LEFT(30deg)';
          targetV = 1.1;
          targetSteer = -26;
          cmd = 'AI_TURN_L';
          durationMs = 1500;
        } else if (lower.includes('right')) {
          intent = 'STEER_RIGHT(30deg)';
          targetV = 1.1;
          targetSteer = 26;
          cmd = 'AI_TURN_R';
          durationMs = 1500;
        }

        this.state.voice.intent = intent;
        this.state.voice.activeStage = 'AI_AGENT';
        this.addLog('AI_AGENT', `Parsed Intent: ${intent}`);
        this.notify();

        // Stage 3: Safety Validator
        this.voiceTimeoutIds.push(setTimeout(() => {
          this.state.voice.validatorStatus = 'PASS // WITHIN_LIMITS';
          this.state.voice.activeStage = 'VALIDATOR';
          this.addLog('VALIDATOR', `Safety check passed: v=${Math.round(targetV * 100)} cm/s, sonar clear.`);
          this.notify();

          // Stage 4: Control Router -> Car Motion
          this.voiceTimeoutIds.push(setTimeout(() => {
            this.state.emergencyStop = false;
            this.state.voiceStopShortcut = false;
            this.state.controlLock = 'AI_VOICE_INTENT';
            this.state.voice.activeStage = 'ROUTER';
            this.state.car.targetVelocity = targetV;
            this.state.car.targetSteering = targetSteer;
            this.state.car.command = cmd;
            this.addLog('ROUTER', `Dispatched Wi-Fi CMD=${cmd} to ESP32 Car.`);
            this.notify();

            this.autoDriveTimer = setTimeout(() => {
              if (this.state.controlLock === 'AI_VOICE_INTENT') {
                this.state.car.targetVelocity = 0;
                this.state.car.targetSteering = 0;
                this.state.car.command = 'AI_TARGET_REACHED';
                this.state.voice.activeStage = null;
                this.addLog('ROUTER', `AI maneuver ${cmd} complete. Holding position.`);
                this.notify();
              }
            }, durationMs);
          }, 320));
        }, 320));
      }, 280));
    }

    triggerEmergencyStop(source = 'MANUAL_ESTOP') {
      this.state.emergencyStop = true;
      this.manualInput = { forward: false, backward: false, left: false, right: false };
      this.state.car.targetVelocity = 0;
      this.state.car.velocity = 0;
      this.state.car.targetSteering = 0;
      this.state.car.pwm = 0;
      this.state.car.rpmLeft = 0;
      this.state.car.rpmRight = 0;
      this.state.car.direction = 'IDLE';
      this.state.car.command = `ESTOP_${source}`;
      this.addLog('ALERT', `EMERGENCY STOP ENGAGED (${source}) — Motors locked.`);
      this.notify();
    }

    resetCarPose() {
      this.state.emergencyStop = false;
      this.state.voiceStopShortcut = false;
      this.state.voice.activeStage = null;
      this.state.glove.gesture = 'NEUTRAL';
      this.state.controlLock = 'MANUAL_SIM_OVERRIDE';
      this.state.car.x = 0;
      this.state.car.y = 0;
      this.state.car.heading = 0;
      this.state.car.velocity = 0;
      this.state.car.targetVelocity = 0;
      this.state.car.steeringAngle = 0;
      this.state.car.targetSteering = 0;
      this.state.car.command = 'POSE_RESET';
      this.addLog('ROUTER', 'Emergency lock cleared & rover pose reset to origin.');
      this.notify();
    }

    togglePersonBbox() {
      this.state.vision.showBbox = !this.state.vision.showBbox;
      this.notify();
    }

    setSimulatedHazard(score) {
      this.state.vision.hazardScore = clamp(Math.round(score), 0, 100);
      this.state.vision.manualHazardOverride = true;
      this.notify();
    }

    _computeSonarDistance(car, dirSign) {
      // Cast ray from front (+1) or rear (-1) bumper against arena walls & obstacles
      const maxRange = 4.0;
      const angle = car.heading + (dirSign < 0 ? Math.PI : 0);
      const dx = Math.sin(angle);
      const dy = -Math.cos(angle);
      let minDist = maxRange;

      // Arena bounds (+/- 4.6m)
      const bound = 4.6;
      if (Math.abs(dx) > 0.001) {
        const tx = ((dx > 0 ? bound : -bound) - car.x) / dx;
        if (tx > 0.2 && tx < minDist) minDist = tx;
      }
      if (Math.abs(dy) > 0.001) {
        const ty = ((dy > 0 ? bound : -bound) - car.y) / dy;
        if (ty > 0.2 && ty < minDist) minDist = ty;
      }

      // Obstacles
      for (const obs of this.obstacles) {
        const ox = obs.x - car.x;
        const oy = obs.y - car.y;
        const proj = ox * dx + oy * dy;
        if (proj > 0) {
          const perpSq = ox * ox + oy * oy - proj * proj;
          if (perpSq < obs.r * obs.r) {
            const hit = proj - Math.sqrt(obs.r * obs.r - perpSq);
            if (hit > 0.2 && hit < minDist) minDist = hit;
          }
        }
      }
      return clamp(minDist - 0.35, 0.25, 3.8);
    }

    _startLoop() {
      const tick = (now) => {
        const dt = Math.min((now - this.lastTick) / 1000, 0.05);
        this.lastTick = now;

        const car = this.state.car;

        if (this.state.mode === 'SIMULATION' && !this.state.emergencyStop) {
          // Manual WASD / Button overrides
          const hasManualKey =
            this.manualInput.forward ||
            this.manualInput.backward ||
            this.manualInput.left ||
            this.manualInput.right;

          if (hasManualKey) {
            this.state.controlLock = 'MANUAL_SIM_OVERRIDE';
            if (this.manualInput.forward && !this.manualInput.backward) {
              car.targetVelocity = 1.85;
              car.command = 'MANUAL_FWD';
            } else if (this.manualInput.backward && !this.manualInput.forward) {
              car.targetVelocity = -1.25;
              car.command = 'MANUAL_REV';
            } else {
              car.targetVelocity = 0;
            }

            if (this.manualInput.left && !this.manualInput.right) {
              car.targetSteering = -28;
            } else if (this.manualInput.right && !this.manualInput.left) {
              car.targetSteering = 28;
            } else {
              car.targetSteering = 0;
            }
          } else if (this.state.controlLock === 'MANUAL_SIM_OVERRIDE') {
            car.targetVelocity = 0;
            car.targetSteering = 0;
            if (Math.abs(car.velocity) < 0.04) {
              car.command = 'IDLE';
            }
          }

          // Smooth acceleration / deceleration
          const accelRate = car.targetVelocity === 0 ? 4.8 : 3.2;
          car.velocity += (car.targetVelocity - car.velocity) * Math.min(1, accelRate * dt);
          if (Math.abs(car.velocity) < 0.015 && car.targetVelocity === 0) {
            car.velocity = 0;
          }

          // Smooth steering
          car.steeringAngle += (car.targetSteering - car.steeringAngle) * Math.min(1, 8.5 * dt);

          // Bicycle-model kinematics
          const steerRad = (car.steeringAngle * Math.PI) / 180;
          if (Math.abs(car.velocity) > 0.02) {
            const turnRate = (car.velocity / 0.85) * Math.tan(steerRad);
            car.heading += turnRate * dt;
            car.x = clamp(car.x + Math.sin(car.heading) * car.velocity * dt, -4.1, 4.1);
            car.y = clamp(car.y - Math.cos(car.heading) * car.velocity * dt, -4.1, 4.1);
          }

          car.direction = car.velocity > 0.05 ? 'FORWARD' : car.velocity < -0.05 ? 'REVERSE' : 'IDLE';
          car.pwm = Math.round(clamp(Math.abs(car.velocity) / 2.0, 0, 1) * 100);

          const baseRpm = car.velocity * 150;
          const diff = (car.steeringAngle / 30) * 35;
          car.rpmLeft = Math.round(baseRpm + (car.velocity >= 0 ? diff : -diff));
          car.rpmRight = Math.round(baseRpm - (car.velocity >= 0 ? diff : -diff));
          car.pwmLeft = Math.round(clamp(Math.abs(car.rpmLeft) / 330, 0, 1) * 255);
          car.pwmRight = Math.round(clamp(Math.abs(car.rpmRight) / 330, 0, 1) * 255);

          // Dynamic ultrasonic sensors in centimeters (cm)
          car.frontDist = Math.round(this._computeSonarDistance(car, 1) * 100);
          car.rearDist = Math.round(this._computeSonarDistance(car, -1) * 100);

          // Realistic telemetry micro-jitter
          car.rssi = Math.round(-54 + Math.sin(now * 0.0018) * 3 + (Math.random() - 0.5) * 2);
          car.batteryVoltage = Number((12.42 - Math.abs(car.velocity) * 0.08 + Math.sin(now * 0.001) * 0.02).toFixed(2));
          car.tempC = Number((26.4 + Math.sin(now * 0.0005) * 1.1 + Math.abs(car.velocity) * 0.35).toFixed(1));
          car.humidity = Number((48.2 + Math.cos(now * 0.0004) * 2.4).toFixed(1));
          car.gasRaw = Math.round(215 + Math.sin(now * 0.0009) * 35 + Math.abs(car.velocity) * 18);
        }

        // Update 300-point ring buffers every ~160ms
        this.syncTimer += dt;
        if (this.syncTimer >= 0.16) {
          this.syncTimer = 0;
          const h = this.state.history;
          pushRing(h.labels, nowTime());
          pushRing(h.velocity, car.velocity);
          pushRing(h.rssi, car.rssi);
          pushRing(h.voltage, car.batteryVoltage);
          pushRing(h.rpmAvg, Math.round((car.rpmLeft + car.rpmRight) / 2));
          pushRing(h.temp, car.tempC);
          pushRing(h.humidity, car.humidity);
          pushRing(h.gas, car.gasRaw);
          pushRing(h.frontDistCm, car.frontDist);
          pushRing(h.rearDistCm, car.rearDist);
          pushRing(h.hazard, this.state.vision.hazardScore);
          pushRing(h.latencyCar, this.state.nodes.car.latencyMs);
          pushRing(h.latencyCam, this.state.nodes.cam.latencyMs);
          pushRing(h.latencyGlove, this.state.nodes.glove.latencyMs);
          pushRing(h.pwmLeft, car.pwmLeft);
          pushRing(h.pwmRight, car.pwmRight);

          // Update node health statuses dynamically
          const haz = this.state.vision.hazardScore;
          this.state.nodes.cam.status = haz >= 75 ? 'ALERT' : haz >= 45 ? 'ELEVATED' : 'NOMINAL';
          this.state.nodes.car.status = this.state.emergencyStop ? 'ALERT' : 'NOMINAL';
          this.state.nodes.glove.latencyMs = 12 + Math.round(Math.random() * 5);
          this.state.nodes.car.latencyMs = 17 + Math.round(Math.random() * 6);
          this.state.nodes.cam.latencyMs = 39 + Math.round(Math.random() * 7);

          // Rotate cloud sync queue & flush to Supabase every ~3 seconds
          this.cloudFlushCounter = (this.cloudFlushCounter || 0) + 1;
          if (this.cloudFlushCounter >= 18) {
            this.cloudFlushCounter = 0;
            const sb = window.supabaseService;
            const q = this.state.syncQueue;
            const idNum = 4093 + Math.floor(Math.random() * 899);
            const types = ['TELEMETRY_BATCH', 'VISION_FRAME', 'HAZARD_SNAPSHOT'];
            const t = types[Math.floor(Math.random() * types.length)];
            const entry = {
              id: `${t.slice(0, 3)}-${idNum}`,
              type: t,
              sizeKb: t === 'TELEMETRY_BATCH' ? 14 : 52,
              status: sb && sb.enabled ? 'SYNCING' : 'QUEUED',
              timestamp: nowTime(),
            };
            q.unshift(entry);
            if (q.length > 6) q.length = 6;

            if (sb && sb.enabled) {
              sb.syncTelemetrySnapshot(this.state).then((ok) => {
                entry.status = ok ? 'SYNCED' : 'QUEUED';
                this.state.nodes.cloud.status = ok ? 'NOMINAL' : 'ELEVATED';
                this.notify();
              });
            }
          }

          this.notify();
        }

        requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
    }
  }

  window.telemetryService = new TelemetryService();
})();
