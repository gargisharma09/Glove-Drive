/**
 * Aegis Rover Command — Main UI Controller
 */
(function () {
  const service = window.telemetryService;
  const icons = window.AegisIcons;

  // Inject header & sidebar icons
  document.getElementById('brandIcon').innerHTML = icons.radar;
  document.getElementById('estopIcon').innerHTML = icons.octagonAlert;
  document.getElementById('voiceSendIcon').innerHTML = icons.send;
  document.getElementById('navIconTelemetry').innerHTML = icons.navTelemetry;
  document.getElementById('navIconAnalytics').innerHTML = icons.navAnalytics;
  document.getElementById('navIconSafety').innerHTML = icons.navSafety;
  document.getElementById('navIconDevice').innerHTML = icons.navDevice;

  // Initialize Canvases & Analytics Charts
  new window.CarSimulationCanvas('carSimCanvas', service);
  new window.VisionFeedCanvas('visionCanvas', service);
  const sparkline = new window.TelemetrySparkline('telemetrySparkline');
  const analyticsCharts = new window.AnalyticsChartsManager();

  let selectedNodeId = null;
  let currentPage = 'telemetry';

  // Client-side Hash Routing (no page reload, keeps WebSocket alive)
  const validPages = ['telemetry', 'analytics', 'safety', 'device'];
  function applyRoute() {
    const rawHash = (window.location.hash || '#telemetry').replace('#', '').toLowerCase();
    currentPage = validPages.includes(rawHash) ? rawHash : 'telemetry';

    document.querySelectorAll('.page-view').forEach((el) => {
      el.classList.toggle('hidden', el.id !== `page-${currentPage}`);
    });
    document.querySelectorAll('#sidebarNav .nav-item').forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-page') === currentPage);
    });
  }
  window.addEventListener('hashchange', applyRoute);
  applyRoute();

  // DOM References
  const pipelineContainer = document.getElementById('pipelineNodesContainer');
  const nodeInspector = document.getElementById('nodeInspector');
  const inspectorTitle = document.getElementById('inspectorTitle');
  const inspectorDesc = document.getElementById('inspectorDesc');
  const inspectorMetrics = document.getElementById('inspectorMetrics');
  const simDataBadge = document.getElementById('simDataBadge');
  const targetUnitDot = document.getElementById('targetUnitDot');

  const btnModeSim = document.getElementById('btnModeSim');
  const btnModeWs = document.getElementById('btnModeWs');
  const wsStatusText = document.getElementById('wsStatusText');
  const wsDot = document.getElementById('wsDot');
  const btnGlobalEstop = document.getElementById('btnGlobalEstop');
  const estopLabel = document.getElementById('estopLabel');

  const activeLockBadge = document.getElementById('activeLockBadge');
  const voiceStopIndicator = document.getElementById('voiceStopIndicator');
  const arbiterLog = document.getElementById('arbiterLog');

  const metricSpeed = document.getElementById('metricSpeed');
  const metricDirection = document.getElementById('metricDirection');
  const metricRpm = document.getElementById('metricRpm');
  const metricSteer = document.getElementById('metricSteer');
  const metricVoltage = document.getElementById('metricVoltage');
  const metricRssi = document.getElementById('metricRssi');
  const metricLinkQual = document.getElementById('metricLinkQual');
  const pwmBadge = document.getElementById('pwmBadge');

  const simCommandBadge = document.getElementById('simCommandBadge');
  const hudMotionState = document.getElementById('hudMotionState');
  const hudStateDot = document.getElementById('hudStateDot');
  const hudStateText = document.getElementById('hudStateText');
  const hudCoords = document.getElementById('hudCoords');
  const hudFrontDist = document.getElementById('hudFrontDist');
  const hudRearDist = document.getElementById('hudRearDist');

  const btnToggleBbox = document.getElementById('btnToggleBbox');
  const personConfBadge = document.getElementById('personConfBadge');
  const hazardArc = document.getElementById('hazardArc');
  const hazardScoreText = document.getElementById('hazardScoreText');
  const hazardTierBadge = document.getElementById('hazardTierBadge');
  const hazardSlider = document.getElementById('hazardSlider');
  const syncQueueBadge = document.getElementById('syncQueueBadge');
  const syncQueueList = document.getElementById('syncQueueList');

  const wsModal = document.getElementById('wsModal');
  const wsUrlInput = document.getElementById('wsUrlInput');

  // Node icon mapping
  const nodeIcons = {
    glove: icons.hand,
    hub: icons.mic,
    router: icons.cpu,
    car: icons.car,
    cam: icons.eye,
    cloud: icons.cloud,
  };

  function getNodeLiveValue(id, state) {
    switch (id) {
      case 'glove': return state.glove.gesture;
      case 'hub': return state.voice.activeStage ? `STAGE: ${state.voice.activeStage}` : state.voice.intent;
      case 'router': return state.controlLock;
      case 'car': return `${Math.round(state.car.velocity * 100)} cm/s // ${state.car.rssi}dBm`;
      case 'cam': return `${state.vision.fps} FPS // HAZ ${state.vision.hazardScore}`;
      case 'cloud': return `${state.syncQueue.filter((q) => q.status !== 'SYNCED').length} QUEUED`;
      default: return '';
    }
  }

  function renderPipelineNodes(state) {
    const order = ['glove', 'hub', 'router', 'car', 'cam', 'cloud'];
    pipelineContainer.innerHTML = order
      .map((id) => {
        const node = state.nodes[id];
        const isSelected = selectedNodeId === id;
        const isAlert = node.status === 'ALERT' || (id === 'hub' && state.voiceStopShortcut);
        const isAi = id === 'hub' || id === 'cam';

        const dotClass =
          isAlert ? 'magenta' : node.status === 'ELEVATED' ? 'periwinkle' : isAi ? 'indigo' : '';

        return `
          <button class="sidebar-node ${isSelected ? 'selected' : ''} ${isAlert ? 'alert-node' : ''}" data-node="${id}" type="button" title="${node.title} (${node.latencyMs}ms)">
            <span class="sidebar-node-left">
              <span class="status-dot ${dotClass}"></span>
              <span class="sidebar-node-name">${node.title}</span>
            </span>
            <span class="sidebar-node-lat">${node.latencyMs}ms</span>
          </button>
        `;
      })
      .join('');

    // Rebind click handlers
    pipelineContainer.querySelectorAll('.sidebar-node').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-node');
        selectedNodeId = selectedNodeId === id ? null : id;
        renderInspector(service.state);
        renderPipelineNodes(service.state);
      });
    });

    if (selectedNodeId) {
      renderInspector(state);
    }
  }

  function renderInspector(state) {
    if (!selectedNodeId) {
      nodeInspector.classList.add('hidden');
      return;
    }
    const node = state.nodes[selectedNodeId];
    nodeInspector.classList.remove('hidden');
    inspectorTitle.textContent = `NODE INSPECTOR // ${node.title.toUpperCase()}`;
    inspectorDesc.textContent = `${node.detail} (${node.ip})`;
    inspectorMetrics.innerHTML = `
      <div class="inspector-kv"><span>LINK STATUS</span><span style="color: ${node.status === 'ALERT' ? 'var(--accent-magenta)' : 'var(--accent-sky)'};">${node.status}</span></div>
      <div class="inspector-kv"><span>LATENCY</span><span>${node.latencyMs} ms</span></div>
      <div class="inspector-kv"><span>PACKET RATE</span><span>${node.packetRate} pkt/s</span></div>
      <div class="inspector-kv"><span>PROTOCOL</span><span>${node.proto}</span></div>
      <div class="inspector-kv"><span>LIVE PAYLOAD</span><span>${getNodeLiveValue(selectedNodeId, state)}</span></div>
    `;
  }

  function renderSecondaryPages(state) {
    // Safety & Alerts Page
    const safetyEstopBadge = document.getElementById('safetyEstopBadge');
    const safetyEstopState = document.getElementById('safetyEstopState');
    const safetyLockSource = document.getElementById('safetyLockSource');
    const safetyVoiceStop = document.getElementById('safetyVoiceStop');
    const safetyValidatorStatus = document.getElementById('safetyValidatorStatus');
    const safetyAlertHistory = document.getElementById('safetyAlertHistory');
    const safetyValidatorLog = document.getElementById('safetyValidatorLog');
    const alertCountBadge = document.getElementById('alertCountBadge');

    if (safetyEstopBadge) {
      safetyEstopBadge.textContent = state.emergencyStop ? 'ENGAGED' : 'DISENGAGED';
      safetyEstopBadge.className = `badge mono ${state.emergencyStop ? 'badge-magenta' : 'badge-cyan'}`;
      safetyEstopState.textContent = state.emergencyStop ? 'MOTORS LOCKED' : 'STANDBY';
      safetyEstopState.style.color = state.emergencyStop ? 'var(--accent-magenta)' : 'var(--text-primary)';
      safetyLockSource.textContent = `CONTROL: ${state.controlLock}`;
      safetyVoiceStop.textContent = state.voiceStopShortcut ? 'TRIGGERED' : 'ARMED';
      safetyValidatorStatus.textContent = state.voice.validatorStatus;

      const alerts = state.logs.filter((l) => l.source === 'ALERT');
      alertCountBadge.textContent = `${alerts.length} ALERTS`;
      safetyAlertHistory.innerHTML = alerts.length
        ? alerts.map((l) => `<div class="log-entry"><span class="log-time">[${l.time}]</span><span class="log-src ALERT">ALERT</span><span>${l.message}</span></div>`).join('')
        : '<div class="mono" style="color: var(--text-muted);">No alerts recorded.</div>';

      const valLogs = state.logs.filter((l) => l.source === 'VALIDATOR' || l.source === 'ROUTER' || l.source === 'ALERT');
      safetyValidatorLog.innerHTML = valLogs
        .map((l) => `<div class="log-entry"><span class="log-time">[${l.time}]</span><span class="log-src ${l.source}">${l.source}</span><span>${l.message}</span></div>`)
        .join('');
    }

    // Device Info Page
    const deviceInfoGrid = document.getElementById('deviceInfoGrid');
    const deviceModeBadge = document.getElementById('deviceModeBadge');
    if (deviceInfoGrid) {
      deviceModeBadge.textContent = state.mode;
      const uptimeSec = Math.floor((Date.now() - state.startedAt) / 1000);
      const mins = Math.floor(uptimeSec / 60);
      const secs = uptimeSec % 60;
      const uptimeStr = `${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;

      deviceInfoGrid.innerHTML = Object.values(state.nodes)
        .map((node) => {
          const sig = node.id === 'car' ? `${state.car.rssi} dBm` : node.signal;
          const dotCls = node.status === 'ALERT' ? 'magenta' : node.status === 'ELEVATED' ? 'periwinkle' : '';
          return `
            <div class="device-card">
              <div class="panel-header">
                <span class="section-label">${node.title}</span>
                <span class="status-dot ${dotCls}"></span>
              </div>
              <div class="mono" style="font-size: 10.5px; color: var(--text-secondary);">${node.detail}</div>
              <div class="metrics-grid">
                <div class="metric-box"><div class="metric-label">Endpoint / IP</div><div class="mono" style="font-size: 11px;">${node.ip}</div></div>
                <div class="metric-box"><div class="metric-label">Link Type</div><div class="mono" style="font-size: 11px;">${node.proto}</div></div>
                <div class="metric-box"><div class="metric-label">Signal</div><div class="mono" style="font-size: 11px; color: var(--accent-sky);">${sig}</div></div>
                <div class="metric-box"><div class="metric-label">Latency / Uptime</div><div class="mono" style="font-size: 11px;">${node.latencyMs}ms &bull; ${uptimeStr}</div></div>
              </div>
            </div>
          `;
        })
        .join('');
    }
  }

  function renderDashboard(state) {
    // Header Mode, SIMULATED DATA badge & WS Status
    simDataBadge.classList.toggle('hidden', state.mode !== 'SIMULATION');
    targetUnitDot.className = `status-dot ${state.emergencyStop ? 'magenta' : state.mode === 'SIMULATION' ? 'indigo' : ''}`;
    btnModeSim.className = `mode-btn ${state.mode === 'SIMULATION' ? 'active-sim' : ''}`;
    btnModeWs.className = `mode-btn ${state.mode === 'WEBSOCKET' ? 'active-ws' : ''}`;

    if (state.mode === 'SIMULATION') {
      wsStatusText.textContent = 'SIM_SANDBOX // 192.168.4.1';
      wsDot.className = 'status-dot indigo';
    } else {
      wsStatusText.textContent = `${state.wsState} // ${state.wsUrl.replace('ws://', '')}`;
      wsDot.className = `status-dot ${state.wsState === 'CONNECTED' ? '' : state.wsState === 'CONNECTING' ? 'periwinkle' : 'magenta'}`;
    }

    // Global E-Stop
    if (state.emergencyStop) {
      btnGlobalEstop.classList.add('engaged');
      estopLabel.textContent = 'E-STOP ENGAGED (RESET)';
    } else {
      btnGlobalEstop.classList.remove('engaged');
      estopLabel.textContent = 'EMERGENCY STOP';
    }

    // Pipeline Nodes
    renderPipelineNodes(state);

    // Control Router & Arbiter
    activeLockBadge.textContent = state.controlLock;
    activeLockBadge.className = `badge ${
      state.controlLock === 'AI_VOICE_INTENT'
        ? 'badge-indigo'
        : state.controlLock === 'GLOVE_PRIORITY'
        ? 'badge-cyan'
        : 'badge-periwinkle'
    }`;

    if (state.voiceStopShortcut) {
      voiceStopIndicator.textContent = 'VOICE STOP SHORTCUT // TRIGGERED';
      voiceStopIndicator.classList.add('triggered');
    } else {
      voiceStopIndicator.textContent = 'ARMED // STANDBY';
      voiceStopIndicator.classList.remove('triggered');
    }

    // Highlight active glove button
    document.querySelectorAll('.gesture-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-gesture') === state.glove.gesture);
    });

    // Arbiter Logs
    arbiterLog.innerHTML = state.logs
      .map(
        (l) => `
      <div class="log-entry">
        <span class="log-time">[${l.time}]</span>
        <span class="log-src ${l.source}">${l.source}</span>
        <span style="color: var(--text-primary);">${l.message}</span>
      </div>`
      )
      .join('');

    // Motor & Telemetry Metrics
    const car = state.car;
    const speedCmS = Math.round(Math.abs(car.velocity) * 100);
    const obstacleCm = (window.AEGIS_CONFIG && window.AEGIS_CONFIG.OBSTACLE_CM) || 75;
    metricSpeed.innerHTML = `${speedCmS} <span style="font-size: 11px; color: var(--text-secondary);">cm/s</span>`;
    metricDirection.textContent = state.emergencyStop ? 'BRAKE LOCKED' : car.direction;
    metricDirection.style.color = state.emergencyStop
      ? 'var(--accent-magenta)'
      : car.direction === 'REVERSE'
      ? 'var(--accent-periwinkle)'
      : 'var(--accent-sky)';
    metricRpm.textContent = `${car.rpmLeft} / ${car.rpmRight}`;
    metricSteer.textContent = `STEER ${car.steeringAngle.toFixed(1)}°`;
    metricVoltage.innerHTML = `${car.batteryVoltage.toFixed(2)} <span style="font-size: 11px; color: var(--text-secondary);">V</span>`;
    metricRssi.innerHTML = `${car.rssi} <span style="font-size: 11px; color: var(--text-secondary);">dBm</span>`;
    metricLinkQual.textContent = car.rssi > -62 ? 'LINK OPTIMAL' : 'LINK ELEVATED';
    pwmBadge.textContent = `PWM ${car.pwm}%`;

    sparkline.draw(state.history.velocity, state.history.rssi);

    // Center Canvas HUD (unified to cm)
    simCommandBadge.textContent = `CMD: ${car.command}`;
    hudCoords.innerHTML = `X: ${Math.round(car.x * 100)} cm &nbsp; Y: ${Math.round(car.y * 100)} cm &nbsp; HDG: ${Math.round(((car.heading * 180) / Math.PI) % 360)}&deg;`;
    hudFrontDist.textContent = `${car.frontDist} cm`;
    hudFrontDist.style.color = car.frontDist < obstacleCm ? 'var(--accent-magenta)' : 'var(--accent-sky)';
    hudRearDist.textContent = `${car.rearDist} cm`;
    hudRearDist.style.color = car.rearDist < obstacleCm ? 'var(--accent-magenta)' : 'var(--accent-periwinkle)';

    if (state.emergencyStop) {
      hudMotionState.className = 'hud-pill estop-badge';
      hudStateDot.className = 'status-dot magenta';
      hudStateText.textContent = 'EMERGENCY BRAKE LOCKED';
    } else if (car.direction === 'REVERSE') {
      hudMotionState.className = 'hud-pill reverse-badge';
      hudStateDot.className = 'status-dot indigo';
      hudStateText.textContent = `REVERSE GEAR // ${speedCmS} cm/s`;
    } else if (car.direction === 'FORWARD') {
      hudMotionState.className = 'hud-pill';
      hudStateDot.className = 'status-dot';
      hudStateText.textContent = `FORWARD PROPULSION // ${speedCmS} cm/s`;
    } else {
      hudMotionState.className = 'hud-pill';
      hudStateDot.className = 'status-dot periwinkle';
      hudStateText.textContent = 'STANDBY // ZERO VELOCITY';
    }

    // Vision & Hazard Gauge (arc length = 144.5)
    const haz = state.vision.hazardScore;
    const offset = 144.5 - (haz / 100) * 144.5;
    hazardArc.setAttribute('stroke-dashoffset', offset.toFixed(1));
    hazardScoreText.textContent = String(haz);
    hazardSlider.value = haz;

    if (haz >= 75) {
      hazardTierBadge.textContent = 'HIGH ALERT';
      hazardTierBadge.className = 'badge badge-magenta';
    } else if (haz >= 45) {
      hazardTierBadge.textContent = 'ELEVATED';
      hazardTierBadge.className = 'badge badge-periwinkle';
    } else {
      hazardTierBadge.textContent = 'NOMINAL';
      hazardTierBadge.className = 'badge badge-cyan';
    }

    btnToggleBbox.textContent = `PERSON BBOX: ${state.vision.showBbox ? 'ON' : 'OFF'}`;
    btnToggleBbox.classList.toggle('active', state.vision.showBbox);
    personConfBadge.textContent = state.vision.personDetected
      ? `PERSON DETECTED // ${state.vision.confidence.toFixed(1)}%`
      : 'NO PERSON IN FRAME';

    // Cloud Sync Queue
    const sb = window.supabaseService;
    const pendingCount = state.syncQueue.filter((q) => q.status !== 'SYNCED').length;
    if (sb && sb.enabled) {
      syncQueueBadge.textContent = `SUPABASE: ${sb.lastSyncStatus} (${sb.syncedCount})`;
      syncQueueBadge.className = `badge mono ${sb.lastSyncStatus === 'SYNC_ERR' ? 'badge-magenta' : 'badge-cyan'}`;
    } else {
      syncQueueBadge.textContent = `QUEUE: ${pendingCount} PENDING`;
      syncQueueBadge.className = 'badge badge-periwinkle mono';
    }
    syncQueueList.innerHTML = state.syncQueue
      .map((item) => {
        const badgeCls =
          item.status === 'SYNCING'
            ? 'badge-indigo'
            : item.status === 'QUEUED'
            ? 'badge-periwinkle'
            : 'badge-cyan';
        return `
          <div class="sync-item">
            <div class="sync-item-left">
              <span class="status-dot ${item.status === 'SYNCING' ? 'indigo' : item.status === 'QUEUED' ? 'periwinkle' : ''}"></span>
              <div>
                <div class="sync-item-id">${item.id} &bull; ${item.type}</div>
                <div class="sync-item-meta">${item.sizeKb} KB &bull; ${item.timestamp}</div>
              </div>
            </div>
            <span class="badge ${badgeCls}">${item.status}</span>
          </div>
        `;
      })
      .join('');

    renderSecondaryPages(state);
    analyticsCharts.update(state);
  }

  service.subscribe(renderDashboard);

  // ==========================================================================
  // Event Listeners
  // ==========================================================================
  const btnSafetyEstop = document.getElementById('btnSafetyEstop');
  const btnSafetyClear = document.getElementById('btnSafetyClear');
  if (btnSafetyEstop) {
    btnSafetyEstop.addEventListener('click', () => service.triggerEmergencyStop('SAFETY_PAGE'));
  }
  if (btnSafetyClear) {
    btnSafetyClear.addEventListener('click', () => service.resetCarPose());
  }

  btnModeSim.addEventListener('click', () => service.setMode('SIMULATION'));
  btnModeWs.addEventListener('click', () => {
    if (service.state.mode !== 'WEBSOCKET') {
      wsModal.classList.remove('hidden');
    }
  });

  document.getElementById('btnWsConfig').addEventListener('click', () => {
    wsModal.classList.remove('hidden');
  });
  document.getElementById('btnCloseWsModal').addEventListener('click', () => {
    wsModal.classList.add('hidden');
  });
  document.getElementById('btnConnectWs').addEventListener('click', () => {
    wsModal.classList.add('hidden');
    service.connectWebSocket(wsUrlInput.value.trim());
  });
  document.getElementById('btnTestPayload').addEventListener('click', () => {
    wsModal.classList.add('hidden');
    service.ingestPayload({
      command: 'WS_EXT_FWD',
      velocity: 1.45,
      direction: 'FORWARD',
      sensors: { frontDist: 192, rearDist: 310, rssi: -51, batteryVoltage: 12.38, steeringAngle: 8, tempC: 27.1, humidity: 49.0, gasRaw: 240 },
      hazardScore: 62,
      personDetected: true,
    });
  });

  // Supabase Cloud Config Modal
  const supabaseModal = document.getElementById('supabaseModal');
  const supabaseUrlInput = document.getElementById('supabaseUrlInput');
  const supabaseKeyInput = document.getElementById('supabaseKeyInput');
  const supabaseTestStatus = document.getElementById('supabaseTestStatus');
  if (window.supabaseService) {
    supabaseUrlInput.value = window.supabaseService.url;
    supabaseKeyInput.value = window.supabaseService.anonKey;
  }

  document.getElementById('btnSupabaseConfig').addEventListener('click', () => {
    supabaseTestStatus.textContent = '';
    supabaseModal.classList.remove('hidden');
  });
  document.getElementById('btnCloseSupabaseModal').addEventListener('click', () => {
    supabaseModal.classList.add('hidden');
  });
  document.getElementById('btnSaveSupabase').addEventListener('click', async () => {
    const sb = window.supabaseService;
    if (!sb) return;
    const configured = sb.configure(supabaseUrlInput.value, supabaseKeyInput.value);
    if (!configured) {
      supabaseTestStatus.textContent = 'Sync disabled (empty Anon Key).';
      supabaseTestStatus.style.color = 'var(--accent-periwinkle)';
      return;
    }
    supabaseTestStatus.textContent = 'Testing connection to telemetry_logs...';
    supabaseTestStatus.style.color = 'var(--accent-sky)';
    try {
      await sb.testConnection();
      supabaseTestStatus.textContent = 'Connected! Cloud Sync Queue is now live.';
      supabaseTestStatus.style.color = 'var(--accent-cyan)';
      service.addLog('ROUTER', 'Supabase Cloud Sync connected & enabled.');
      service.notify();
      setTimeout(() => supabaseModal.classList.add('hidden'), 800);
    } catch (err) {
      supabaseTestStatus.textContent = `Connection failed: ${err.message}`;
      supabaseTestStatus.style.color = 'var(--accent-magenta)';
    }
  });

  document.getElementById('btnCloseInspector').addEventListener('click', () => {
    selectedNodeId = null;
    renderInspector(service.state);
    renderPipelineNodes(service.state);
  });

  btnGlobalEstop.addEventListener('click', () => {
    if (service.state.emergencyStop) {
      service.resetCarPose();
    } else {
      service.triggerEmergencyStop('GLOBAL_HEADER');
    }
  });

  document.getElementById('btnSimEstop').addEventListener('click', () => {
    service.triggerEmergencyStop('SIM_PANEL');
  });

  document.getElementById('btnResetCar').addEventListener('click', () => {
    service.resetCarPose();
  });

  // Voice Command Form & Presets
  const voiceForm = document.getElementById('voiceCommandForm');
  const voiceInput = document.getElementById('voiceInput');
  voiceForm.addEventListener('submit', (e) => {
    e.preventDefault();
    service.submitVoiceCommand(voiceInput.value);
    voiceInput.value = '';
  });

  document.querySelectorAll('.voice-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cmd = btn.getAttribute('data-cmd');
      voiceInput.value = cmd;
      service.submitVoiceCommand(cmd);
    });
  });

  // Glove Gesture Triggers
  document.querySelectorAll('.gesture-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      service.triggerGloveGesture(btn.getAttribute('data-gesture'));
    });
  });

  // Vision Controls
  btnToggleBbox.addEventListener('click', () => service.togglePersonBbox());
  hazardSlider.addEventListener('input', (e) => {
    service.setSimulatedHazard(Number(e.target.value));
  });

  // On-Screen D-Pad Hold Controls
  function bindDriveButton(elemId, driveKey) {
    const el = document.getElementById(elemId);
    const start = (e) => {
      e.preventDefault();
      el.classList.add('pressed');
      service.setManualDrive(driveKey, true);
    };
    const end = () => {
      el.classList.remove('pressed');
      service.setManualDrive(driveKey, false);
    };
    el.addEventListener('mousedown', start);
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('mouseup', end);
    el.addEventListener('mouseleave', end);
    el.addEventListener('touchend', end);
  }

  bindDriveButton('keyForward', 'forward');
  bindDriveButton('keyBackward', 'backward');
  bindDriveButton('keyLeft', 'left');
  bindDriveButton('keyRight', 'right');

  // Keyboard Controls (WASD + Arrows + Space)
  const keyMap = {
    w: { key: 'forward', el: 'keyForward' },
    arrowup: { key: 'forward', el: 'keyForward' },
    s: { key: 'backward', el: 'keyBackward' },
    arrowdown: { key: 'backward', el: 'keyBackward' },
    a: { key: 'left', el: 'keyLeft' },
    arrowleft: { key: 'left', el: 'keyLeft' },
    d: { key: 'right', el: 'keyRight' },
    arrowright: { key: 'right', el: 'keyRight' },
  };

  window.addEventListener('keydown', (e) => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (e.code === 'Space') {
      e.preventDefault();
      service.triggerEmergencyStop('KEYBOARD_SPACE');
      return;
    }
    const mapped = keyMap[e.key.toLowerCase()];
    if (mapped) {
      e.preventDefault();
      document.getElementById(mapped.el).classList.add('pressed');
      service.setManualDrive(mapped.key, true);
    }
  });

  window.addEventListener('keyup', (e) => {
    const mapped = keyMap[e.key.toLowerCase()];
    if (mapped) {
      document.getElementById(mapped.el).classList.remove('pressed');
      service.setManualDrive(mapped.key, false);
    }
  });
})();
