/**
 * Aegis Rover Command — Supabase Cloud Sync Service
 *
 * Uses Supabase REST API (/rest/v1/) from the browser with the Project URL
 * and public Anon Key (stored in localStorage, never the DB password).
 */
(function () {
  const DEFAULT_URL = 'https://oolkffdgbmtzepdgdhst.supabase.co';
  const STORAGE_URL_KEY = 'aegis_supabase_url';
  const STORAGE_KEY_KEY = 'aegis_supabase_anon_key';

  class SupabaseService {
    constructor() {
      this.url = localStorage.getItem(STORAGE_URL_KEY) || DEFAULT_URL;
      this.anonKey = localStorage.getItem(STORAGE_KEY_KEY) || '';
      this.enabled = Boolean(this.url && this.anonKey);
      this.lastSyncStatus = this.enabled ? 'READY' : 'AWAITING_ANON_KEY';
      this.syncedCount = 0;
      this.lastError = null;
      this._inFlight = false;
    }

    configure(url, anonKey) {
      this.url = (url || DEFAULT_URL).trim().replace(/\/+$/, '');
      this.anonKey = (anonKey || '').trim();
      localStorage.setItem(STORAGE_URL_KEY, this.url);
      localStorage.setItem(STORAGE_KEY_KEY, this.anonKey);
      this.enabled = Boolean(this.url && this.anonKey);
      this.lastError = null;
      this.lastSyncStatus = this.enabled ? 'CONNECTED' : 'AWAITING_ANON_KEY';
      return this.enabled;
    }

    async _post(table, payload, prefer = 'return=minimal') {
      if (!this.enabled) return { ok: false, skipped: true };
      const res = await fetch(`${this.url}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
          apikey: this.anonKey,
          Authorization: `Bearer ${this.anonKey}`,
          'Content-Type': 'application/json',
          Prefer: prefer,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => res.statusText);
        throw new Error(`${res.status} ${txt}`);
      }
      return { ok: true };
    }

    async testConnection() {
      if (!this.enabled) throw new Error('Anon key not configured');
      const res = await fetch(`${this.url}/rest/v1/telemetry_logs?select=id&limit=1`, {
        headers: {
          apikey: this.anonKey,
          Authorization: `Bearer ${this.anonKey}`,
        },
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => res.statusText);
        throw new Error(`${res.status} ${txt}`);
      }
      this.lastSyncStatus = 'CONNECTED';
      this.lastError = null;
      return true;
    }

    async syncTelemetrySnapshot(state) {
      if (!this.enabled || this._inFlight) return false;
      this._inFlight = true;
      try {
        const car = state.car;
        await this._post('telemetry_logs', {
          device_id: 'GLOVEDRIVE-ESP32-01',
          mode: state.mode,
          command: car.command,
          control_lock: state.controlLock,
          direction: car.direction,
          velocity_cm_s: Math.round(car.velocity * 100),
          steering_deg: Number(car.steeringAngle.toFixed(1)),
          pwm_left: car.pwmLeft,
          pwm_right: car.pwmRight,
          rpm_left: car.rpmLeft,
          rpm_right: car.rpmRight,
          battery_v: car.batteryVoltage,
          rssi_dbm: car.rssi,
          front_dist_cm: car.frontDist,
          rear_dist_cm: car.rearDist,
          temp_c: car.tempC,
          humidity_pct: car.humidity,
          gas_raw: car.gasRaw,
          hazard_score: state.vision.hazardScore,
          person_detected: state.vision.personDetected,
          emergency_stop: state.emergencyStop,
        });

        await this._post('vision_snapshots', {
          device_id: 'GLOVEDRIVE-ESP32-01',
          fps: state.vision.fps,
          person_detected: state.vision.personDetected,
          confidence: state.vision.confidence,
          hazard_score: state.vision.hazardScore,
        });

        this.syncedCount += 1;
        this.lastSyncStatus = 'SYNCED';
        this.lastError = null;
        return true;
      } catch (err) {
        this.lastSyncStatus = 'SYNC_ERR';
        this.lastError = err.message;
        return false;
      } finally {
        this._inFlight = false;
      }
    }

    async syncAlert(source, message, state) {
      if (!this.enabled) return false;
      try {
        await this._post('safety_alerts', {
          device_id: 'GLOVEDRIVE-ESP32-01',
          source,
          severity: source === 'ALERT' ? 'HIGH' : 'ELEVATED',
          message,
          command: state.car.command,
          hazard_score: state.vision.hazardScore,
          emergency_stop: state.emergencyStop,
        });
        return true;
      } catch (err) {
        this.lastError = err.message;
        return false;
      }
    }
  }

  window.supabaseService = new SupabaseService();
})();
