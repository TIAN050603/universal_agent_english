(function () {
  "use strict";

  const STORAGE_KEY = "his_agent_widget_state_v1";
  const POSITION_KEY = "hisAgentWidgetPosition";
  const SIZE_KEY = "hisAgentWidgetSize";
  const TASK_STEPS_UI_KEY = "hisAgentTaskStepsUiV2";
  const INPUT_DRAFT_KEY = "hisAgentInputDraftV2";
  const SCROLL_RESTORE_KEY = "hisAgentScrollRestoreV2";
  const DEFAULT_PANEL_SIZE = { width: 500, height: 720 };
  const MIN_PANEL_SIZE = { width: 320, height: 360 };
  const MAX_PANEL_SIZE = { width: 760, height: 840 };
  const HEALTH_STATUS_TIMEOUT_MS = 3500;
  const LLM_STATUS_TIMEOUT_MS = 5000;
  const TASK_SUMMARY_TICK_MS = 100;
  const TASK_PANEL_AUTO_COMPACT_MS = 2000;
  const SEMANTIC_ROLE_COOLDOWN_MS = 10000;
  const SEMANTIC_ROLE_MIN_NEW_FINAL_TURNS = 2;
  const SEMANTIC_ROLE_MIN_TURNS_PER_SPEAKER = 2;
  const SEMANTIC_ROLE_MIN_TEXT_PER_SPEAKER = 10;
  const SAFE_PAGES = {
    login: "login.html",
    dashboard: "dashboard.html",
    patientManagement: "patient-management.html",
    patientEditor: "patient-editor.html",
    agentHistory: "agent-history.html",
    "login.html": "login.html",
    "dashboard.html": "dashboard.html",
    "patient-management.html": "patient-management.html",
    "patient-editor.html": "patient-editor.html",
    "agent-history.html": "agent-history.html",
    "index.html": "patient-editor.html"
  };
  const RUNTIME_URLS = window.HisRuntimeConfig && window.HisRuntimeConfig.serviceUrls
    ? window.HisRuntimeConfig.serviceUrls()
    : {};
  const EXAMPLE_TASKS = [
    "The account and password are both 123. After login, open Patient Management, open the edit page for P001 Zhang Wei, change the phone number to 13800138000, and save.",
    "Open Patient Management, find P004, open the edit page, change Chief Complaint to chest tightness for half a day, add worsens after activity to Present Illness, and save.",
    "After login, open Patient Management, find P006, change Visit Type to Follow-up Visit and Department to Respiratory Medicine, then save.",
    "Open the Medical Record Editor for P008, change Allergy History to penicillin allergy, change Notes to follow-up reminder given, and save.",
    "Try to change the phone number of nonexistent PatientABC to 13800138000, and confirm that no patient is modified by mistake."
  ];

  const DEFAULT_STATE = {
    open: false,
    agentSessionId: "",
    asrSessionId: "",
    history: [],
    speakerTurns: [],
    backendUrl: RUNTIME_URLS.backendUrl || "",
    asrUrl: RUNTIME_URLS.asrUrl || "",
    diarizationUrl: RUNTIME_URLS.diarizationUrl || RUNTIME_URLS.backendUrl || "",
    activeTab: "agent",
    viewMode: "home",
    panelPosition: loadStandaloneValue(POSITION_KEY),
    panelSize: loadStandaloneValue(SIZE_KEY),
    launcherPosition: null,
    backendStatus: "Not checked",
    asrStatus: "Not checked",
    asrWebSocketStatus: "idle",
    microphoneStatus: "unknown",
    diarizationStatus: "not_activated",
    diarizationProvider: "disabled",
    diarizationWebSocketStatus: "idle",
    llmStatus: "disconnected",
    agentMode: "blocked_no_llm",
    llmProviderStatus: "Not checked",
    dataSource: "Browser Workspace",
    loginMode: "Signed In",
    topicPage: 0,
    voiceSessionEnded: false,
    voiceTurnsFrozen: false,
    voiceSemanticMapping: null,
    voiceSemanticSuggestions: [],
    pendingVoicePlan: null,
    recentTaskPanelMinimized: false,
    recentTaskStepsExpanded: false,
    recentTaskPinnedTaskId: "",
    conversationState: "home",
    stateTransitions: [],
    lastError: ""
  };
  const VIEW_MODES = ["home", "chat", "voice", "status", "examples"];

  const state = Object.assign({}, DEFAULT_STATE, loadState());
  // A persisted "connected" value cannot prove that a scale-to-zero GPU is still warm.
  state.diarizationStatus = "not_activated";
  state.diarizationProvider = "disabled";
  state.diarizationWebSocketStatus = "idle";
  const runtime = {
    websocket: null,
    audioContext: null,
    mediaStream: null,
    processor: null,
    source: null,
    recording: false,
    voiceMode: "",
    dictationCommittedText: "",
    suppressLegacyUserText: "",
    pointerInteraction: null,
    suppressNextLauncherClick: false,
    lastBackendErrorMessage: "",
    lastBackendErrorAt: 0,
    serviceDetails: {
      backend: {
        url: (RUNTIME_URLS.backendUrl || "").replace(/\/+$/, "") + "/api/health",
        status: "unknown",
        error: ""
      },
      asr: {
        url: (RUNTIME_URLS.asrUrl || "").replace(/\/+$/, "") + "/health",
        status: "unknown",
        error: ""
      },
      diarization: {
        url: ((RUNTIME_URLS.diarizationUrl || RUNTIME_URLS.backendUrl || "").replace(/\/+$/, "")) + "/diarization/health",
        status: "not_activated",
        error: "Diart starts only after an explicit user action."
      },
      llm: {
        url: (RUNTIME_URLS.backendUrl || "").replace(/\/+$/, "") + "/api/llm/test",
        status: "unknown",
        error: ""
      }
    },
    lastAsrEvent: null,
    lastVoiceAction: "",
    taskSummaryTimer: null,
    lastTaskSummaryRenderMs: 0,
    taskPanelAutoCompactTimer: null,
    taskPanelManualOverride: false,
    lastTaskPanelTaskId: "",
    topicVisualIndex: 1,
    topicJumpTimer: null,
    statusRefreshInFlight: false,
    statusRefreshStage: "",
    diarizationActivationInFlight: false,
    voiceStartInFlight: false,
    voicePlanMessage: null,
    semanticRoleMapping: {
      initialized: false,
      inFlight: false,
      lastMappedAt: 0,
      lastMappedFinalTurnCount: 0,
      stopped: true,
      frozen: false,
      lastReason: "",
      lastError: "",
      lastResult: null,
      firstRoundTriggered: false,
      manualEditing: false
    },
    planningTask: null,
    activeRunId: "",
    hiddenRecentTaskId: "",
    draftTimer: null,
    restoringScroll: false,
    initialScrollRestore: null,
    currentTaskStepsScroll: null,
    currentTaskStepLock: null,
    suppressTaskListScrollCapture: false,
    suppressHistoryAutoScroll: false,
    stateMachine: null,
    scrollManager: null,
    lastRoute: null,
    pendingConflictingInput: ""
  };

  let elements = {};

  function init() {
    ensureSessionIds();
    createWidget();
    initializeV2Managers();
    readPageDefaultUrls();
    prepareInitialScrollRestore();
    renderAll();
    restoreInputDraft();
    restoreInitialScrollSnapshot();
    bindEvents();
    startTaskSummaryTicker();
    probeServices();
    resumeStoredTask();
    saveState();
    window.HisAgentWidget = {
      addMessage: addMessage,
      receiveLegacyMessage: receiveLegacyMessage,
      getSnapshot: getSnapshot,
      getConversationTurns: function () {
        return state.speakerTurns.slice();
      },
      getVoiceSemanticState: function () {
        return getVoiceSemanticSnapshot();
      },
      triggerVoiceSemanticMapping: function (reason, options) {
        return runSemanticRoleMapping(reason || "debug", options || {});
      },
      getAgentMessages: function () {
        return state.history.slice(-12);
      },
      getV2State: function () {
        return {
          conversationState: state.conversationState || "home",
          stateTransitions: (state.stateTransitions || []).slice(-20),
          scroll: runtime.scrollManager && runtime.scrollManager.getState ? runtime.scrollManager.getState() : null,
          lastRoute: runtime.lastRoute || null,
          planningTask: runtime.planningTask ? Object.assign({}, runtime.planningTask) : null,
          inputDraft: loadInputDraft(),
          activeRunId: runtime.activeRunId || ""
        };
      }
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
      saved.backendUrl = normalizeSavedServiceUrl(saved.backendUrl, DEFAULT_STATE.backendUrl);
      saved.asrUrl = normalizeSavedServiceUrl(saved.asrUrl, DEFAULT_STATE.asrUrl);
      saved.diarizationUrl = normalizeSavedServiceUrl(saved.diarizationUrl, DEFAULT_STATE.diarizationUrl);
      saved.microphoneStatus = normalizePersistedMicrophoneStatus(saved.microphoneStatus);
      return saved;
    } catch (error) {
      return {};
    }
  }

  function normalizePersistedMicrophoneStatus(value) {
    const text = String(value || "").trim().toLowerCase();
    if (text === "recording" || text === "checking" || text === "stopping") return "unknown";
    return value;
  }

  function normalizeSavedServiceUrl(value, fallback) {
    const text = String(value || "").trim();
    if (!text) {
      return fallback;
    }
    try {
      const url = new URL(text);
      const current = new URL(fallback);
      if (url.protocol !== current.protocol || url.hostname !== current.hostname || url.port !== current.port) {
        return fallback;
      }
    } catch (error) {
      return fallback;
    }
    return text;
  }

  function saveState() {
    const serializable = {
      open: state.open,
      agentSessionId: state.agentSessionId,
      asrSessionId: state.asrSessionId,
      history: state.history.slice(-80),
      speakerTurns: state.speakerTurns.slice(-120),
      backendUrl: state.backendUrl,
      asrUrl: state.asrUrl,
      diarizationUrl: state.diarizationUrl,
      activeTab: state.activeTab,
      viewMode: normalizeViewMode(state.viewMode),
      panelPosition: state.panelPosition,
      panelSize: state.panelSize,
      launcherPosition: state.launcherPosition,
      backendStatus: state.backendStatus,
      asrStatus: state.asrStatus,
      microphoneStatus: normalizeMicrophoneStatusForStorage(state.microphoneStatus),
      diarizationStatus: state.diarizationStatus,
      diarizationProvider: state.diarizationProvider,
      diarizationWebSocketStatus: state.diarizationWebSocketStatus,
      llmStatus: state.llmStatus,
      agentMode: state.agentMode,
      llmProviderStatus: state.llmProviderStatus,
      dataSource: state.dataSource,
      loginMode: state.loginMode,
      voiceSessionEnded: Boolean(state.voiceSessionEnded),
      voiceTurnsFrozen: Boolean(state.voiceTurnsFrozen),
      voiceSemanticMapping: state.voiceSemanticMapping || null,
      voiceSemanticSuggestions: Array.isArray(state.voiceSemanticSuggestions) ? state.voiceSemanticSuggestions.slice(-20) : [],
      pendingVoicePlan: state.pendingVoicePlan || null,
      recentTaskPanelMinimized: Boolean(state.recentTaskPanelMinimized),
      recentTaskStepsExpanded: Boolean(state.recentTaskStepsExpanded),
      recentTaskPinnedTaskId: state.recentTaskPinnedTaskId || "",
      conversationState: state.conversationState || "home",
      stateTransitions: Array.isArray(state.stateTransitions) ? state.stateTransitions.slice(-80) : [],
      lastError: state.lastError
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  }

  function normalizeMicrophoneStatusForStorage(value) {
    const text = String(value || "").trim().toLowerCase();
    if (text === "recording" || text === "checking" || text === "stopping") return "unknown";
    return value;
  }

  function normalizeViewMode(value) {
    const text = String(value || "home");
    return VIEW_MODES.indexOf(text) >= 0 ? text : "home";
  }

  function loadStandaloneValue(key) {
    try {
      return JSON.parse(window.localStorage.getItem(key) || "null");
    } catch (error) {
      return null;
    }
  }

  function saveStandaloneValue(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Local persistence is best-effort only.
    }
  }

  function removeStandaloneValue(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      // Local persistence is best-effort only.
    }
  }

  function makeRunId(prefix) {
    return String(prefix || "run") + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function getCurrentTaskIdentifier(summary) {
    return summary && (summary.taskId || summary.task_id || summary.id || summary.objective || "");
  }

  function loadTaskStepsUiState() {
    return loadStandaloneValue(TASK_STEPS_UI_KEY) || {};
  }

  function saveTaskStepsUiState(taskId, expanded) {
    if (!taskId) return;
    saveStandaloneValue(TASK_STEPS_UI_KEY, {
      taskId: String(taskId),
      expanded: Boolean(expanded),
      updatedAt: Date.now()
    });
  }

  function shouldRestoreTaskStepsOpen(summary) {
    const taskId = getCurrentTaskIdentifier(summary);
    const saved = loadTaskStepsUiState();
    return Boolean(taskId && saved && saved.taskId === String(taskId) && saved.expanded);
  }

  function captureCurrentTaskStepsScroll(summary) {
    if (!elements.currentTaskCard || elements.currentTaskCard.hidden) return null;
    const taskId = getCurrentTaskIdentifier(summary);
    const details = elements.currentTaskCard.querySelector(".his-agent-current-steps");
    const taskList = elements.currentTaskCard.querySelector("#hisAgentTaskList");
    if (!taskId || !details || !details.open || !taskList) return null;
    return {
      taskId: String(taskId),
      listScrollTop: Number(taskList.scrollTop || 0),
      bodyScrollTop: elements.body ? Number(elements.body.scrollTop || 0) : 0,
      updatedAt: Date.now()
    };
  }

  function restoreCurrentTaskStepsScroll(summary, snapshot) {
    const taskId = String(getCurrentTaskIdentifier(summary) || "");
    const saved = snapshot || runtime.currentTaskStepsScroll;
    if (!taskId || !saved || String(saved.taskId || "") !== taskId) return;
    const taskList = elements.currentTaskCard && elements.currentTaskCard.querySelector("#hisAgentTaskList");
    if (taskList) {
      const maxTop = Math.max(0, taskList.scrollHeight - taskList.clientHeight);
      taskList.scrollTop = Math.max(0, Math.min(Number(saved.listScrollTop || 0), maxTop));
    }
    if (elements.body && Number(saved.bodyScrollTop || 0) > 0) {
      const maxBodyTop = Math.max(0, elements.body.scrollHeight - elements.body.clientHeight);
      elements.body.scrollTop = Math.max(0, Math.min(Number(saved.bodyScrollTop || 0), maxBodyTop));
    }
  }

  function handleTaskListScrollCapture(event) {
    const target = event && event.target;
    if (!target || target.id !== "hisAgentTaskList") return;
    const summary = currentOrRecentTaskSummary();
    const taskId = getCurrentTaskIdentifier(summary);
    if (!taskId) return;
    state.recentTaskStepsExpanded = true;
    saveTaskStepsUiState(taskId, true);
    const lock = runtime.currentTaskStepLock || {};
    runtime.currentTaskStepLock = Object.assign({}, lock, {
      taskId: String(taskId),
      userPinnedStepScroll: true
    });
    runtime.currentTaskStepsScroll = {
      taskId: String(taskId),
      listScrollTop: Number(target.scrollTop || 0),
      bodyScrollTop: elements.body ? Number(elements.body.scrollTop || 0) : 0,
      updatedAt: Date.now()
    };
  }

  function loadInputDraft() {
    const draft = loadStandaloneValue(INPUT_DRAFT_KEY);
    if (!draft || draft.sessionId !== state.agentSessionId) {
      return null;
    }
    return draft;
  }

  function saveInputDraft(text, source) {
    const value = String(text || "");
    if (!value.trim()) {
      removeStandaloneValue(INPUT_DRAFT_KEY);
      return;
    }
    saveStandaloneValue(INPUT_DRAFT_KEY, {
      sessionId: state.agentSessionId,
      text: value,
      source: source || "typed",
      updatedAt: Date.now()
    });
  }

  function scheduleSaveInputDraft(source) {
    if (runtime.draftTimer) {
      window.clearTimeout(runtime.draftTimer);
    }
    runtime.draftTimer = window.setTimeout(function () {
      runtime.draftTimer = null;
      if (elements.input) {
        saveInputDraft(elements.input.value || "", source || "typed");
      }
    }, 120);
  }

  function restoreInputDraft() {
    if (!elements.input || (elements.input.value || "").trim()) {
      return;
    }
    const draft = loadInputDraft();
    if (!draft || !draft.text) {
      return;
    }
    elements.input.value = draft.text;
    syncInputHeight();
  }

  function clearInputDraft() {
    if (runtime.draftTimer) {
      window.clearTimeout(runtime.draftTimer);
      runtime.draftTimer = null;
    }
    removeStandaloneValue(INPUT_DRAFT_KEY);
  }

  function getBodyScrollSnapshot() {
    if (!elements.body) return null;
    return {
      sessionId: state.agentSessionId,
      viewMode: state.viewMode,
      scrollTop: elements.body.scrollTop || 0,
      scrollHeight: elements.body.scrollHeight || 0,
      clientHeight: elements.body.clientHeight || 0,
      nearBottom: isNearBodyBottom(),
      updatedAt: Date.now()
    };
  }

  function isNearBodyBottom() {
    if (!elements.body) return true;
    const distance = Math.max(0, elements.body.scrollHeight - elements.body.scrollTop - elements.body.clientHeight);
    return distance < 8;
  }

  function saveScrollSnapshot(reason) {
    const snapshot = getBodyScrollSnapshot();
    if (!snapshot) return;
    snapshot.reason = reason || "unknown";
    saveStandaloneValue(SCROLL_RESTORE_KEY, snapshot);
  }

  function prepareInitialScrollRestore() {
    const snapshot = loadStandaloneValue(SCROLL_RESTORE_KEY);
    if (!snapshot || snapshot.sessionId !== state.agentSessionId || snapshot.viewMode !== state.viewMode) {
      return;
    }
    runtime.initialScrollRestore = snapshot;
    runtime.restoringScroll = true;
    runtime.suppressHistoryAutoScroll = true;
    if (elements.body) {
      elements.body.classList.add("restoring-scroll");
      elements.body.style.visibility = "hidden";
    }
  }

  function restoreInitialScrollSnapshot() {
    const snapshot = runtime.initialScrollRestore;
    if (!snapshot || !elements.body) {
      runtime.restoringScroll = false;
      runtime.suppressHistoryAutoScroll = false;
      return;
    }
    function applyRestore() {
      if (!elements.body) return;
      const maxTop = Math.max(0, elements.body.scrollHeight - elements.body.clientHeight);
      const target = snapshot.nearBottom
        ? maxTop
        : Math.max(0, Math.min(Number(snapshot.scrollTop) || 0, maxTop));
      elements.body.scrollTop = target;
    }
    applyRestore();
    window.requestAnimationFrame(function () {
      applyRestore();
      elements.body.classList.remove("restoring-scroll");
      elements.body.style.visibility = "";
      window.setTimeout(applyRestore, 50);
      window.setTimeout(function () {
        applyRestore();
        runtime.restoringScroll = false;
        runtime.suppressHistoryAutoScroll = false;
        runtime.initialScrollRestore = null;
        removeStandaloneValue(SCROLL_RESTORE_KEY);
      }, 80);
    });
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = window.setTimeout(function () {
      controller.abort();
    }, timeoutMs || 6000);
    try {
      return await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
    } finally {
      window.clearTimeout(timer);
    }
  }

  function ensureSessionIds() {
    if (!state.agentSessionId) {
      state.agentSessionId = "agent_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    }
    if (!state.asrSessionId) {
      state.asrSessionId = "asr_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    }
  }

  function createWidget() {
    if (document.getElementById("hisAgentPanel")) {
      return;
    }
    const existingLauncher = document.getElementById("hisAgentLauncher");
    const bootstrapPanel = document.getElementById("hisAgentBootstrapPanel");
    if (existingLauncher) {
      existingLauncher.remove();
    }
    if (bootstrapPanel) {
      bootstrapPanel.remove();
    }

    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "his-agent-launcher";
    launcher.id = "hisAgentLauncher";
    launcher.setAttribute("aria-label", "Open or collapse the site-wide AI Agent");
    launcher.innerHTML = "<strong>AI Agent</strong><span>LLM disconnected</span>";
    launcher.style.cssText = [
      "position:fixed",
      "right:20px",
      "bottom:24px",
      "top:auto",
      "z-index:2147483647",
      "display:grid",
      "visibility:visible",
      "opacity:1",
      "pointer-events:auto"
    ].join(";");

    const panel = document.createElement("section");
    panel.className = "his-agent-panel";
    panel.id = "hisAgentPanel";
    panel.setAttribute("aria-label", "Site-wide Floating AI Agent");
    panel.innerHTML = [
      '<header class="his-agent-header" id="hisAgentHeader" data-testid="his-agent-drag-region" title="Drag to move Agent">',
      '  <div class="his-agent-drag-handle" id="hisAgentDragHandle" title="Drag to move Agent">',
      '    <button type="button" class="his-agent-back-button" id="hisAgentViewBackButton" aria-label="Back to main view" title="Back">Back</button>',
      '    <h2 class="his-agent-title" id="hisAgentViewTitle">HIS AGENT</h2>',
      "  </div>",
      '  <div class="his-agent-header-actions">',
      '    <button type="button" class="his-agent-header-task-button" id="hisAgentTaskPlanButton" aria-label="Open latest task plan" title="Open latest task plan" hidden>Task Plan</button>',
      '    <button type="button" class="his-agent-icon-button his-agent-reset-button" id="hisAgentResetPositionButton" aria-label="Reset Agent position and size" title="Reset position and size">↺</button>',
      '    <button type="button" class="his-agent-icon-button" id="hisAgentCloseButton" aria-label="Collapse Floating Agent" title="Collapse">×</button>',
      "  </div>",
      "</header>",
      '<div class="his-agent-body" id="hisAgentBody">',
      '  <div class="his-agent-status" id="hisAgentStatus" hidden>Checking connection status...</div>',
      '  <div class="his-agent-task" id="hisAgentTask" hidden></div>',
      '  <div class="his-agent-connection-row" hidden>',
      '    <span id="hisAgentBackendStatus">LLM Backend: Disconnected / Agent: paused because LLM is disconnected / manual page actions are still available</span>',
      '    <span id="hisAgentAsrStatus">Agent backend: not checked / ASR: not checked</span>',
      "  </div>",
      '  <div class="his-agent-tabs his-agent-module-tabs" role="tablist" aria-label="Agent Modules">',
      '    <button type="button" id="hisAgentTabAgent" data-agent-tab="agent" role="tab">Agent Assistant</button>',
      '    <button type="button" id="hisAgentTabVoice" data-agent-tab="voice" role="tab">Visit Session</button>',
      "  </div>",
      '  <section class="his-agent-view his-agent-home-view" id="hisAgentHomeView" data-agent-view="home">',
      '    <section class="his-agent-home" id="hisAgentHome">',
      '      <div class="his-agent-greeting">',
      '        <div class="his-agent-mark" aria-hidden="true">*</div>',
      '        <h3>Hello, I am the <span>HIS System Assistant</span></h3>',
      '        <p>I can assist with Patient Management, Medical Record Editing, and visit-session organization.</p>',
      '        <div class="his-agent-home-actions">',
      '          <button type="button" class="his-agent-button secondary his-agent-open-chat-button" id="hisAgentOpenChatButton">Enter Agent Chat</button>',
      "        </div>",
      "      </div>",
      '      <div class="his-agent-topic-carousel" id="hisAgentTopicGrid" aria-label="HIS Agent Topic Entry">',
      '        <div class="his-agent-topic-viewport" id="hisAgentTopicViewport">',
      '          <div class="his-agent-topic-track" id="hisAgentTopicTrack">',
      '            <button type="button" class="his-agent-topic-card his-agent-topic-card-clone" data-agent-topic="examples" aria-hidden="true" tabindex="-1"><strong>Example Tasks</strong><span>Select a task and enter the execution flow</span></button>',
      '            <button type="button" class="his-agent-topic-card" data-agent-topic="patient-management"><strong>View Patient Management</strong><span>Confirm to open the Patient List</span></button>',
      '            <button type="button" class="his-agent-topic-card" data-agent-topic="connection"><strong>System Connection Status</strong><span>Backend / LLM / ASR / Microphone</span></button>',
      '            <button type="button" class="his-agent-topic-card" data-agent-topic="history"><strong>View Task History</strong><span>Open Agent execution records</span></button>',
      '            <button type="button" class="his-agent-topic-card" data-agent-topic="examples"><strong>Example Tasks</strong><span>5 clickable acceptance tasks</span></button>',
      '            <button type="button" class="his-agent-topic-card his-agent-topic-card-clone" data-agent-topic="patient-management" aria-hidden="true" tabindex="-1"><strong>View Patient Management</strong><span>Confirm to open the Patient List</span></button>',
      "          </div>",
      "        </div>",
      '        <div class="his-agent-topic-nav" aria-label="Switch Topic">',
      '          <button type="button" class="his-agent-topic-nav-button" id="hisAgentTopicPrevButton" aria-label="Previous Topic Group">‹</button>',
      '          <button type="button" class="his-agent-topic-nav-button primary" id="hisAgentTopicNextButton" aria-label="Next Topic Group">›</button>',
      "        </div>",
      "      </div>",
      "    </section>",
      "  </section>",
      '  <section class="his-agent-view his-agent-chat-view" id="hisAgentChatView" data-agent-view="chat">',
      '    <section class="his-agent-tab-panel" data-agent-panel="agent">',
      '    <div class="his-agent-current-card" id="hisAgentCurrentTaskCard" hidden></div>',
      '    <div class="his-agent-compat-actions" hidden>',
      '      <button type="button" id="hisAgentCheckConnectionButton">Check Backend Connection</button>',
      '      <button type="button" id="hisAgentOpenHistoryButton">View Full Records</button>',
      '      <div id="hisAgentExampleTasks"></div>',
      "    </div>",
      '    <div class="his-agent-history" id="hisAgentHistory" role="log" aria-live="polite"></div>',
      '    <button type="button" class="his-agent-new-messages" id="hisAgentNewMessagesButton" hidden>↓ 0 new messages</button>',
      "  </section>",
      "  </section>",
      '  <section class="his-agent-view his-agent-status-view" id="hisAgentStatusView" data-agent-view="status" hidden>',
      '    <div class="his-agent-view-intro">System connection status is shown here. Scale-to-zero services may take longer to start, and checks do not block other actions.</div>',
      '    <div class="his-agent-status-content" id="hisAgentStatusContent"></div>',
      '    <div class="his-agent-actions his-agent-status-actions">',
      '      <button type="button" class="his-agent-button secondary" id="hisAgentRefreshStatusButton">Refresh Status</button>',
      '      <button type="button" class="his-agent-button primary" id="hisAgentActivateDiarizationButton">Activate Diart</button>',
      "    </div>",
      "  </section>",
      '  <section class="his-agent-view his-agent-examples-view" id="hisAgentExamplesView" data-agent-view="examples" hidden>',
      '    <div class="his-agent-view-intro">After selecting an example task, it enters the Agent taskflow as if manually entered. Without the LLM, no page action will execute.</div>',
      '    <div class="his-agent-example-grid" id="hisAgentExamplesList"></div>',
      "  </section>",
      '  <section class="his-agent-view his-agent-voice-view" id="hisAgentVoiceView" data-agent-view="voice" data-agent-panel="voice" hidden>',
      '    <div class="his-agent-section-title">Visit Session</div>',
      '    <div class="his-agent-boundary">After Start, conduct the visit normally. ASR only records Doctor/Patient turns. After the doctor clicks End Conversation and Organize Task, the LLM only generates a natural-language task for confirmation and does not automatically execute page actions.</div>',
      '    <div class="his-agent-voice-status-card" id="hisAgentVoiceStatusCard"></div>',
      '    <div class="his-agent-actions">',
      '      <button type="button" class="his-agent-button secondary" id="hisAgentStartVoiceButton">Start Voice Task</button>',
      '      <button type="button" class="his-agent-button secondary" id="hisAgentStopVoiceButton">Stop Voice Task</button>',
      '      <button type="button" class="his-agent-button primary" id="hisAgentPlanVoiceTaskButton" hidden>End Conversation and Organize Task</button>',
      '      <button type="button" class="his-agent-button secondary" id="hisAgentMockTurnsButton">Load Example Visit</button>',
      '      <button type="button" class="his-agent-button secondary" id="hisAgentSwapRolesButton">Swap Doctor/Patient</button>',
      '      <button type="button" class="his-agent-button secondary" id="hisAgentClearTurnsButton">Clear Voice Record</button>',
      '    </div>',
      '    <div class="his-agent-voice-session-summary" id="hisAgentVoiceSessionSummary"></div>',
      '    <div class="his-agent-voice-draft" id="hisAgentVoiceDraft"></div>',
      '    <div class="his-agent-section-title">Live Transcript / Doctor-Patient Turns</div>',
      '    <div class="his-agent-turns" id="hisAgentTurns"></div>',
      '    <details class="his-agent-voice-debug-panel">',
      '      <summary>ASR Developer Details</summary>',
      '      <pre class="his-agent-voice-debug" id="hisAgentVoiceDebug"></pre>',
      "    </details>",
      "  </section>",
      "</div>",
      '<footer class="his-agent-controls">',
      '  <div>',
      '    <label for="hisAgentInput">Text or Voice Task</label>',
      '    <textarea id="hisAgentInput" placeholder="Enter the task for the LLM Agent to understand. When the LLM is disconnected, no page action will be executed."></textarea>',
      "  </div>",
      '  <div class="his-agent-actions">',
      '    <button type="button" class="his-agent-button primary" id="hisAgentSendButton">Send</button>',
      '    <button type="button" class="his-agent-button secondary" id="hisAgentVoiceButton">Voice Input</button>',
      '    <button type="button" class="his-agent-button secondary" id="hisAgentVisitSessionButton">Visit Session</button>',
      '    <button type="button" class="his-agent-button secondary" id="hisAgentNewSessionButton">New Session</button>',
      "  </div>",
      '  <details class="his-agent-settings">',
      "    <summary>Service Addresses</summary>",
      '    <label for="hisAgentBackendUrl">Agent Backend</label>',
      '    <input id="hisAgentBackendUrl" type="text" />',
      '    <label for="hisAgentAsrUrl">ASR Service</label>',
      '    <input id="hisAgentAsrUrl" type="text" />',
      '    <div class="his-agent-service-diagnostics" id="hisAgentServiceDiagnostics"></div>',
      "  </details>",
      "</footer>",
      '<div class="his-agent-resize-handle" id="hisAgentResizeHandle" aria-label="Resize Agent" title="Drag to resize"></div>'
    ].join("");

    document.body.appendChild(launcher);
    document.body.appendChild(panel);
    elements = {
      launcher: launcher,
      panel: panel,
      closeButton: panel.querySelector("#hisAgentCloseButton"),
      resetPositionButton: panel.querySelector("#hisAgentResetPositionButton"),
      taskPlanButton: panel.querySelector("#hisAgentTaskPlanButton"),
      viewBackButton: panel.querySelector("#hisAgentViewBackButton"),
      viewTitle: panel.querySelector("#hisAgentViewTitle"),
      header: panel.querySelector("#hisAgentHeader"),
      dragHandle: panel.querySelector("#hisAgentDragHandle"),
      resizeHandle: panel.querySelector("#hisAgentResizeHandle"),
      status: panel.querySelector("#hisAgentStatus"),
      body: panel.querySelector("#hisAgentBody"),
      task: panel.querySelector("#hisAgentTask"),
      currentTaskCard: panel.querySelector("#hisAgentCurrentTaskCard"),
      homeView: panel.querySelector("#hisAgentHomeView"),
      chatView: panel.querySelector("#hisAgentChatView"),
      statusView: panel.querySelector("#hisAgentStatusView"),
      examplesView: panel.querySelector("#hisAgentExamplesView"),
      voiceView: panel.querySelector("#hisAgentVoiceView"),
      statusContent: panel.querySelector("#hisAgentStatusContent"),
      statusRefreshButton: panel.querySelector("#hisAgentRefreshStatusButton"),
      activateDiarizationButton: panel.querySelector("#hisAgentActivateDiarizationButton"),
      examplesList: panel.querySelector("#hisAgentExamplesList"),
      home: panel.querySelector("#hisAgentHome"),
      topicGrid: panel.querySelector("#hisAgentTopicGrid"),
      openChatButton: panel.querySelector("#hisAgentOpenChatButton"),
      topicTrack: panel.querySelector("#hisAgentTopicTrack"),
      topicPrevButton: panel.querySelector("#hisAgentTopicPrevButton"),
      topicNextButton: panel.querySelector("#hisAgentTopicNextButton"),
      backendStatus: panel.querySelector("#hisAgentBackendStatus"),
      asrStatus: panel.querySelector("#hisAgentAsrStatus"),
      history: panel.querySelector("#hisAgentHistory"),
      newMessagesButton: panel.querySelector("#hisAgentNewMessagesButton"),
      openHistoryButton: panel.querySelector("#hisAgentOpenHistoryButton"),
      voiceDraft: panel.querySelector("#hisAgentVoiceDraft"),
      turns: panel.querySelector("#hisAgentTurns"),
      tabButtons: Array.from(panel.querySelectorAll("[data-agent-tab]")),
      tabPanels: Array.from(panel.querySelectorAll("[data-agent-panel]")),
      input: panel.querySelector("#hisAgentInput"),
      sendButton: panel.querySelector("#hisAgentSendButton"),
      voiceButton: panel.querySelector("#hisAgentVoiceButton"),
      visitSessionButton: panel.querySelector("#hisAgentVisitSessionButton"),
      startVoiceButton: panel.querySelector("#hisAgentStartVoiceButton"),
      stopVoiceButton: panel.querySelector("#hisAgentStopVoiceButton"),
      planVoiceTaskButton: panel.querySelector("#hisAgentPlanVoiceTaskButton"),
      fillVoiceInputButton: panel.querySelector("#hisAgentFillVoiceInputButton"),
      mockTurnsButton: panel.querySelector("#hisAgentMockTurnsButton"),
      swapRolesButton: panel.querySelector("#hisAgentSwapRolesButton"),
      clearTurnsButton: panel.querySelector("#hisAgentClearTurnsButton"),
      voiceStatusCard: panel.querySelector("#hisAgentVoiceStatusCard"),
      voiceSessionSummary: panel.querySelector("#hisAgentVoiceSessionSummary"),
      voiceDebug: panel.querySelector("#hisAgentVoiceDebug"),
      checkConnectionButton: panel.querySelector("#hisAgentCheckConnectionButton"),
      exampleTasks: panel.querySelector("#hisAgentExampleTasks"),
      newSessionButton: panel.querySelector("#hisAgentNewSessionButton"),
      backendUrl: panel.querySelector("#hisAgentBackendUrl"),
      asrUrl: panel.querySelector("#hisAgentAsrUrl"),
      serviceDiagnostics: panel.querySelector("#hisAgentServiceDiagnostics")
    };
    assertWidgetElements();
  }

  function assertWidgetElements() {
    const required = [
      "launcher",
      "panel",
      "closeButton",
      "resetPositionButton",
      "taskPlanButton",
      "viewBackButton",
      "viewTitle",
      "dragHandle",
      "resizeHandle",
      "status",
      "body",
      "task",
      "currentTaskCard",
      "homeView",
      "chatView",
      "statusView",
      "examplesView",
      "voiceView",
      "statusContent",
      "statusRefreshButton",
      "activateDiarizationButton",
      "examplesList",
      "home",
      "topicGrid",
      "openChatButton",
      "topicTrack",
      "topicPrevButton",
      "topicNextButton",
      "backendStatus",
      "asrStatus",
      "history",
      "newMessagesButton",
      "openHistoryButton",
      "voiceDraft",
      "turns",
      "input",
      "sendButton",
      "voiceButton",
      "visitSessionButton",
      "startVoiceButton",
      "stopVoiceButton",
      "planVoiceTaskButton",
      "mockTurnsButton",
      "swapRolesButton",
      "clearTurnsButton",
      "voiceStatusCard",
      "voiceSessionSummary",
      "voiceDebug",
      "checkConnectionButton",
      "exampleTasks",
      "newSessionButton",
      "backendUrl",
      "asrUrl",
      "serviceDiagnostics"
    ];
    const missing = required.filter(function (key) {
      return !elements[key];
    });
    if (!elements.tabButtons || !elements.tabButtons.length) missing.push("tabButtons");
    if (!elements.tabPanels || !elements.tabPanels.length) missing.push("tabPanels");
    if (missing.length) {
      throw new Error("Agent widget missing required element(s): " + missing.join(", "));
    }
  }

  function initializeV2Managers() {
    if (window.AgentStateMachine && typeof window.AgentStateMachine.createMachine === "function") {
      runtime.stateMachine = window.AgentStateMachine.createMachine({
        initialState: state.conversationState || (normalizeViewMode(state.viewMode) === "home" ? "home" : "chatting"),
        transitions: state.stateTransitions || [],
        onTransition: function (transition, transitions) {
          state.conversationState = transition.to;
          state.stateTransitions = transitions.slice(-80);
          saveState();
        }
      });
      state.conversationState = runtime.stateMachine.getState();
      state.stateTransitions = runtime.stateMachine.getTransitions();
    }
    if (window.AgentScrollManager && typeof window.AgentScrollManager.create === "function") {
      runtime.scrollManager = window.AgentScrollManager.create({
        container: elements.body,
        unreadButton: elements.newMessagesButton,
        threshold: 120
      });
    }
  }

  function transitionConversation(to, event, details) {
    if (runtime.stateMachine && typeof runtime.stateMachine.transition === "function") {
      const result = runtime.stateMachine.transition(to, event || "ui_event", details || {});
      if (result && result.ok === false) {
        updateDebugState({ lastStateTransitionError: result });
      }
      recordFlowTrace("conversation_transition", {
        conversation_state: result && result.to || to,
        route: event || "ui_event",
        view_state: normalizeViewMode(state.viewMode),
        task_id: details && details.task_id || ""
      });
      return result;
    }
    state.conversationState = to;
    recordFlowTrace("conversation_transition", {
      conversation_state: to,
      route: event || "ui_event",
      view_state: normalizeViewMode(state.viewMode),
      task_id: details && details.task_id || ""
    });
    return { ok: true, to: to };
  }

  function recordFlowTrace(event, details) {
    if (!window.AgentFlowTrace || typeof window.AgentFlowTrace.record !== "function") return null;
    const summary = window.AgentTaskOrchestrator && window.AgentTaskOrchestrator.getSummary
      ? window.AgentTaskOrchestrator.getSummary()
      : null;
    const payload = Object.assign({
      task_id: summary && summary.taskId || "",
      conversation_state: state.conversationState || "",
      page_type: getPageType(),
      view_state: normalizeViewMode(state.viewMode),
      scroll_state: runtime.scrollManager && typeof runtime.scrollManager.getState === "function"
        ? runtime.scrollManager.getState()
        : "",
      task_slots: summary && summary.slots || {}
    }, details || {});
    return window.AgentFlowTrace.record(event, payload);
  }

  function readPageDefaultUrls() {
    const backendInput = document.getElementById("backendUrlInput");
    const asrInput = document.getElementById("asrServiceUrlInput");
    if (backendInput && backendInput.value && state.backendUrl === DEFAULT_STATE.backendUrl) {
      state.backendUrl = backendInput.value.trim();
    }
    if (asrInput && asrInput.value && state.asrUrl === DEFAULT_STATE.asrUrl) {
      state.asrUrl = asrInput.value.trim();
    }
    elements.backendUrl.value = state.backendUrl;
    elements.asrUrl.value = state.asrUrl;
  }

  function bindEvents() {
    elements.launcher.addEventListener("click", async function () {
      if (runtime.suppressNextLauncherClick) {
        runtime.suppressNextLauncherClick = false;
        return;
      }
      await toggleOpen();
    });
    elements.closeButton.addEventListener("click", toggleOpen);
    elements.resetPositionButton.addEventListener("click", resetPosition);
    elements.taskPlanButton.addEventListener("click", openRecentTaskPanel);
    elements.viewBackButton.addEventListener("click", returnToHomeView);
    elements.sendButton.addEventListener("click", handlePrimaryTaskButton);
    elements.openChatButton.addEventListener("click", openChatWorkspace);
    elements.voiceButton.addEventListener("click", toggleVoice);
    elements.visitSessionButton.addEventListener("click", openVisitSession);
    elements.startVoiceButton.addEventListener("click", startVoiceTask);
    elements.stopVoiceButton.addEventListener("click", stopVoiceTask);
    elements.planVoiceTaskButton.addEventListener("click", endVoiceConversationAndDraftTask);
    if (elements.fillVoiceInputButton) {
      elements.fillVoiceInputButton.addEventListener("click", fillVoiceTurnsIntoInput);
    }
    elements.mockTurnsButton.addEventListener("click", fillMockTurns);
    elements.swapRolesButton.addEventListener("click", swapTurnRoles);
    elements.clearTurnsButton.addEventListener("click", clearVoiceTurns);
    elements.checkConnectionButton.addEventListener("click", checkBackendConnection);
    elements.openHistoryButton.addEventListener("click", openAgentHistory);
    elements.statusRefreshButton.addEventListener("click", showConnectionTopic);
    elements.activateDiarizationButton.addEventListener("click", activateDiarization);
    elements.topicGrid.addEventListener("click", handleTopicClick);
    elements.examplesList.addEventListener("click", function (event) {
      const button = event.target.closest("[data-example-task]");
      if (!button) return;
      const task = EXAMPLE_TASKS[Number(button.dataset.exampleTask)] || "";
      runExampleTask(task);
    });
    elements.topicPrevButton.addEventListener("click", function () {
      shiftTopicPage(-1);
    });
    elements.topicNextButton.addEventListener("click", function () {
      shiftTopicPage(1);
    });
    elements.history.addEventListener("click", handleMessageAction);
    if (runtime.scrollManager && typeof runtime.scrollManager.bind === "function") {
      runtime.scrollManager.bind();
    }
    elements.currentTaskCard.addEventListener("click", handleTaskCardAction);
    elements.currentTaskCard.addEventListener("scroll", handleTaskListScrollCapture, true);
    renderExampleTasks();
    renderExamplesView();
    elements.newSessionButton.addEventListener("click", newSession);
    elements.input.addEventListener("input", function () {
      syncInputHeight();
      scheduleSaveInputDraft("typed");
    });
    elements.tabButtons.forEach(function (button) {
      button.addEventListener("click", async function () {
        if (button.dataset.agentTab === "voice") {
          await openVisitSession();
          return;
        }
        if (runtime.recording && runtime.voiceMode === "session") {
          await stopActiveVoice("leave_voice_tab");
        }
        setActiveTab(button.dataset.agentTab);
      });
    });
    bindPanelDrag();
    bindPanelResize();
    window.addEventListener("resize", function () {
      clampWidgetToViewport();
      renderTopicCarousel();
    });
    window.addEventListener("his-agent-task-progress", handleTaskProgress);
    window.addEventListener("beforeunload", function () {
      saveScrollSnapshot("beforeunload");
      if (elements.input) {
        saveInputDraft(elements.input.value || "", "beforeunload");
      }
    });
    elements.backendUrl.addEventListener("change", function () {
      state.backendUrl = elements.backendUrl.value.trim() || DEFAULT_STATE.backendUrl;
      saveState();
      probeServices();
    });
    elements.asrUrl.addEventListener("change", function () {
      state.asrUrl = elements.asrUrl.value.trim() || DEFAULT_STATE.asrUrl;
      saveState();
      probeServices();
    });
  }

  function renderExampleTasks() {
    if (!elements.exampleTasks) {
      return;
    }
    elements.exampleTasks.innerHTML = EXAMPLE_TASKS.map(function (task, index) {
      return '<button type="button" class="his-agent-button secondary" data-example-task="' + index + '">Example ' + (index + 1) + ": " + escapeHtml(task) + "</button>";
    }).join("");
    elements.exampleTasks.addEventListener("click", function (event) {
      const button = event.target.closest("[data-example-task]");
      if (!button) {
        return;
      }
      const task = EXAMPLE_TASKS[Number(button.dataset.exampleTask)] || "";
      runExampleTask(task);
    });
  }

  async function handleTopicClick(event) {
    const button = event.target.closest("[data-agent-topic]");
    if (!button) {
      return;
    }
    const topic = button.dataset.agentTopic;
    if (topic === "connection") {
      await showConnectionTopic();
      return;
    }
    if (topic === "examples") {
      enterExamplesView();
      return;
    }
    if (topic === "voice") {
      await openVisitSession();
      return;
    }
    beginTopicConversation(topicLabel(topic));
    if (topic === "patient-management") {
      addMessage("agent", "Open the Patient Management page? This is an explicit manual UI action and does not depend on the LLM.", "agent", {
        kind: "topic-card",
        actions: [
          { label: "Open Patient Management", action: "navigate", target: "patient-management.html", style: "primary" },
          { label: "Cancel", action: "dismiss", style: "secondary" }
        ]
      });
      return;
    }
    if (topic === "history") {
      addMessage("agent", "Open the Agent execution records page?", "agent", {
        kind: "topic-card",
        actions: [
          { label: "Open Task History", action: "history", style: "primary" },
          { label: "Cancel", action: "dismiss", style: "secondary" }
        ]
      });
      return;
    }
  }

  function topicLabel(topic) {
    const labels = {
      "patient-management": "View Patient Management",
      "history": "View Task History",
      "voice": "Visit Session",
      "connection": "System Connection Status",
      "examples": "Example Tasks"
    };
    return labels[topic] || "Topic";
  }

  function beginTopicConversation(label) {
    setActiveTab("agent");
    enterChatView({ topicResponse: true });
    elements.panel.classList.remove("has-active-task", "is-planning-task");
    elements.currentTaskCard.hidden = true;
    state.history = [];
    renderHistory();
    if (label) {
      addMessage("user", label, "user", { kind: "topic-command" });
    }
  }

  async function showConnectionTopic() {
    if (runtime.statusRefreshInFlight) {
      return;
    }
    runtime.statusRefreshInFlight = true;
    runtime.statusRefreshStage = "checking";
    markStatusRefreshChecking();
    setStatusRefreshLoading(true);
    enterStatusView("checking");
    setStatus("Refreshing system connection status...");
    try {
      await Promise.allSettled([
        probeHttpViaRuntime((state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, "") + "/api/health", "backendStatus", "backend", HEALTH_STATUS_TIMEOUT_MS),
        probeHttpViaRuntime((state.asrUrl || DEFAULT_STATE.asrUrl).replace(/\/+$/, "") + "/health", "asrStatus", "asr", HEALTH_STATUS_TIMEOUT_MS)
      ]);
      runtime.statusRefreshStage = "llm_checking";
      renderStatusView("llm_checking");
      const llmResult = await refreshLlmStatusViaRuntime(LLM_STATUS_TIMEOUT_MS, { quick: true });
      runtime.statusRefreshStage = "done";
      renderStatusView("done");
      setStatus(llmResult && llmResult.slow
        ? "Quick status refreshed; LLM response is slow, so it will be checked strictly again before task execution."
        : "System connection status refreshed.");
    } finally {
      runtime.statusRefreshInFlight = false;
      runtime.statusRefreshStage = "";
      setStatusRefreshLoading(false);
      renderStatusView("done");
    }
  }

  function markStatusRefreshChecking() {
    state.backendStatus = "checking";
    state.asrStatus = "checking";
    state.llmStatus = "checking";
    state.llmProviderStatus = "checking";
    state.agentMode = "checking";
    runtime.serviceDetails.backend = {
      url: (state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, "") + "/api/health",
      status: "checking",
      error: ""
    };
    runtime.serviceDetails.asr = {
      url: (state.asrUrl || DEFAULT_STATE.asrUrl).replace(/\/+$/, "") + "/health",
      status: "checking",
      error: ""
    };
    runtime.serviceDetails.llm = {
      url: (state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, "") + "/api/llm/test",
      status: "checking",
      error: ""
    };
  }

  function setStatusRefreshLoading(isLoading) {
    if (!elements.statusRefreshButton) {
      return;
    }
    elements.statusRefreshButton.disabled = Boolean(isLoading);
    elements.statusRefreshButton.classList.toggle("is-loading", Boolean(isLoading));
    elements.statusRefreshButton.setAttribute("aria-busy", isLoading ? "true" : "false");
    elements.statusRefreshButton.innerHTML = isLoading
      ? '<span class="his-agent-spinner" aria-hidden="true"></span><span>Refreshing...</span>'
      : "Refresh Status";
  }

  function setDiarizationActivationLoading(isLoading) {
    if (!elements.activateDiarizationButton) {
      return;
    }
    elements.activateDiarizationButton.disabled = Boolean(isLoading);
    elements.activateDiarizationButton.classList.toggle("is-loading", Boolean(isLoading));
    elements.activateDiarizationButton.setAttribute("aria-busy", isLoading ? "true" : "false");
    elements.activateDiarizationButton.innerHTML = isLoading
      ? '<span class="his-agent-spinner" aria-hidden="true"></span><span>Starting Diart...</span>'
      : (connectionDiarizationStatusValue() === "connected" ? "Restart Diart" : "Activate Diart");
  }

  async function activateDiarization() {
    if (runtime.diarizationActivationInFlight) {
      return;
    }
    runtime.diarizationActivationInFlight = true;
    state.diarizationStatus = "starting";
    state.diarizationProvider = "diart_local";
    state.diarizationWebSocketStatus = "idle";
    runtime.serviceDetails.diarization = {
      url: ((state.diarizationUrl || DEFAULT_STATE.diarizationUrl || state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, "")) + "/diarization/health",
      status: "starting",
      error: "Cold start in progress. This can take tens of seconds."
    };
    setDiarizationActivationLoading(true);
    renderCompactServiceStatus();
    setStatus("Diart is starting. A cold start can take tens of seconds; wait for Connected before using it.");
    try {
      const result = await probeDiarization();
      if (result && result.connected) {
        setStatus("Diart is connected and ready.");
      } else {
        setStatus("Diart could not be activated. Review the status details and retry.", true);
      }
    } finally {
      runtime.diarizationActivationInFlight = false;
      setDiarizationActivationLoading(false);
      renderCompactServiceStatus();
    }
  }

  function buildConnectionTopicDetails(stage) {
    return {
      kind: "connection-status",
      stage: stage || "done",
      rows: [
        { label: "Backend Service", value: state.backendStatus },
        { label: "LLM", value: state.llmStatus },
        { label: "Agent", value: state.agentMode },
        { label: "ASR Service", value: state.asrStatus },
        { label: "Microphone", value: state.microphoneStatus },
        { label: "Speaker Diarization", value: connectionDiarizationStatusValue() }
      ],
      urls: {
        backendHealth: (state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, "") + "/api/health",
        llmTest: (state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, "") + "/api/llm/test",
        asrHealth: (state.asrUrl || DEFAULT_STATE.asrUrl).replace(/\/+$/, "") + "/health",
        diarizationHealth: ((state.diarizationUrl || DEFAULT_STATE.diarizationUrl || state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, "")) + "/diarization/health"
      },
      serviceDetails: runtime.serviceDetails,
      lastError: state.lastError || "",
      checkedAt: new Date().toISOString()
    };
  }

  function connectionDiarizationStatusValue() {
    const details = runtime.serviceDetails && runtime.serviceDetails.diarization || {};
    const status = String(details.status || state.diarizationStatus || "").trim();
    const provider = String(state.diarizationProvider || "").trim().toLowerCase();
    if (status === "connected" || status === "available") {
      return "connected";
    }
    if (status === "starting" || status === "connecting") {
      return "starting";
    }
    if (provider && provider !== "manual" && !status) {
      return "connected";
    }
    return status || "unknown";
  }

  function renderStatusView(stage) {
    if (!elements.statusContent) {
      return;
    }
    const details = buildConnectionTopicDetails(stage || "done");
    const rows = details.rows || [];
    const hint = details.stage === "checking"
      ? "Quickly checking backend and ASR; this usually completes within a few seconds."
      : details.stage === "llm_checking"
        ? "Backend and ASR responded; running a 5-second quick LLM probe..."
        : "Diart remains off until you click Activate Diart here or Start Voice Task in Visit Session.";
    elements.statusContent.innerHTML = [
      '<div class="his-agent-status-panel">',
      '  <div class="his-agent-status-hint">' + escapeHtml(hint) + '</div>',
      '  <div class="his-agent-status-list">',
      rows.map(function (row) {
        const normalized = connectionStatusText(row.value);
        return [
          '<div class="his-agent-status-row ' + escapeHtml(connectionStatusClass(row.value)) + '">',
          '  <strong>' + escapeHtml(row.label || "") + '</strong>',
          '  <span>' + escapeHtml(statusDisplayText(row.value)) + '</span>',
          '  <small>' + escapeHtml(normalized) + '</small>',
          '</div>'
        ].join("");
      }).join(""),
      '  </div>',
      details.lastError ? '<div class="his-agent-connection-error">Latest error: ' + escapeHtml(details.lastError) + '</div>' : "",
      '  <details class="his-agent-developer-foldout">',
      '    <summary>Developer Details</summary>',
      '    <div class="his-agent-service-diagnostics">',
      serviceDiagnosticRow("Backend health", details.serviceDetails && details.serviceDetails.backend),
      serviceDiagnosticRow("LLM test", details.serviceDetails && details.serviceDetails.llm),
      serviceDiagnosticRow("ASR health", details.serviceDetails && details.serviceDetails.asr),
      serviceDiagnosticRow("Diarization health", details.serviceDetails && details.serviceDetails.diarization),
      '    </div>',
      '  </details>',
      '</div>'
    ].join("");
  }

  function statusDisplayText(value) {
    const text = connectionStatusText(value);
    const labels = {
      connected: "Connected",
      starting: "Starting (cold start)",
      not_activated: "Not activated",
      llm_enabled: "Executable",
      blocked_no_llm: "Temporarily blocked",
      disconnected: "Disconnected",
      timeout: "Timeout",
      checking: "Checking",
      slow: "Slow response",
      llm_check_required: "Check before execution",
      not_configured: "Not configured",
      permission_denied: "Permission denied",
      permission_granted: "Available",
      permission_prompt: "Pending authorization",
      recording: "Recording",
      unavailable: "Unavailable",
      unavailable_api: "Unavailable",
      not_found: "Device not found",
      device_busy: "Device busy",
      get_user_media_error: "Microphone error",
      neutral: "Local mode"
    };
    return labels[text] || (String(text).indexOf("http_") === 0 ? "Error" : String(value || "Unknown"));
  }

  async function handleMessageAction(event) {
    const button = event.target.closest("[data-agent-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.agentAction;
    if (action === "navigate") {
      const target = button.dataset.target || "";
      navigateToSafePage(target);
      return;
    }
    if (action === "history") {
      openAgentHistory();
      return;
    }
    if (action === "connection") {
      await showConnectionTopic();
      return;
    }
    if (action === "enter-voice") {
      await openVisitSession();
      setStatus("Entered Visit Session.");
      return;
    }
    if (action === "example") {
      const task = EXAMPLE_TASKS[Number(button.dataset.exampleIndex)] || "";
      await runExampleTask(task);
      return;
    }
    if (action === "voice-task-execute") {
      await executePendingVoiceTask(button.dataset.messageId || "", button);
      return;
    }
    if (action === "voice-task-cancel") {
      cancelPendingVoiceTask(button.dataset.messageId || "");
      setStatus("Cancelled current visit-session organization; no page action executed.");
      return;
    }
    if (action === "clinical-draft-confirm") {
      await confirmClinicalDraftWrite(button.dataset.messageId || "");
      return;
    }
    if (action === "clinical-draft-cancel") {
      cancelClinicalDraftWrite(button.dataset.messageId || "");
      return;
    }
    if (action === "continue-active") {
      const text = runtime.pendingConflictingInput || "";
      runtime.pendingConflictingInput = "";
      if (text) {
        await handleCommand(text, "clarification");
      }
      return;
    }
    if (action === "cancel-and-start-new") {
      const text = runtime.pendingConflictingInput || "";
      runtime.pendingConflictingInput = "";
      cancelTask();
      if (text) {
        await handleCommand(text, "text");
      }
      return;
    }
    if (action === "dismiss") {
      state.history = [];
      backToAgentHome();
      setStatus("Cancelled. Back to topic home.");
    }
  }

  function handleTaskCardAction(event) {
    const button = event.target.closest("[data-agent-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.agentAction;
    const summary = currentOrRecentTaskSummary();
    if (action === "cancel-task") {
      cancelTask();
    }
    if (action === "history") {
      openAgentHistory();
    }
    if (action === "minimize-task-panel") {
      setTaskPanelMinimized(summary, true, true);
    }
    if (action === "expand-task-panel") {
      setTaskPanelMinimized(summary, false, true);
    }
  }

  async function handlePrimaryTaskButton() {
    if (elements.sendButton && elements.sendButton.dataset.action === "cancel-task") {
      cancelTask();
      return;
    }
    await sendCurrentInput();
  }

  async function runExampleTask(task) {
    if (!task) {
      return;
    }
    elements.input.value = "";
    syncInputHeight();
    clearInputDraft();
    setActiveTab("agent");
    enterChatView();
    addMessage("user", task, "user");
    await handleCommand(task, "example");
  }

  async function checkBackendConnection() {
    setStatus("Checking backend, LLM, and ASR connections...");
    const backendBase = (state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, "");
    const asrBase = (state.asrUrl || DEFAULT_STATE.asrUrl).replace(/\/+$/, "");
    const results = [];
    async function check(label, url) {
      try {
        const response = await fetchWithTimeout(url, { method: "GET" }, 5000);
        results.push(label + ": " + (response.ok ? "Available" : "Error " + response.status));
        return response.ok;
      } catch (error) {
        results.push(label + ": Unavailable");
        return false;
      }
    }
    await check("Agent backend /api/health", backendBase + "/api/health");
    await check("LLM /api/llm/test", backendBase + "/api/llm/test");
    await check("ASR /health", asrBase + "/health");
    await refreshLlmStatus(LLM_STATUS_TIMEOUT_MS, { quick: true });
    addMessage("system", results.join("\n"), "system");
    setStatus("Connection check completed.");
  }

  async function toggleOpen() {
    if (state.open && runtime.recording) {
      await stopActiveVoice("panel_close");
    }
    state.open = !state.open;
    renderOpenState();
    saveState();
  }

  function renderAll() {
    renderOpenState();
    renderViewMode();
    renderHistory();
    renderTurns();
    renderTabs();
    renderTopicCarousel();
    renderPositions();
    renderServiceStatus();
    renderTaskSummary();
    syncInputHeight();
    updateVoiceButtons();
  }

  function renderViewMode() {
    const mode = normalizeViewMode(state.viewMode);
    state.viewMode = mode;
    const views = {
      home: elements.homeView,
      chat: elements.chatView,
      status: elements.statusView,
      examples: elements.examplesView,
      voice: elements.voiceView
    };
    Object.keys(views).forEach(function (key) {
      if (views[key]) views[key].hidden = key !== mode;
      elements.panel.classList.toggle("his-agent-view-" + key, key === mode);
    });
    elements.viewBackButton.hidden = mode === "home";
    elements.viewTitle.textContent = viewTitle(mode);
    updateTaskPlanHeaderButton();
    if (mode !== "chat") {
      elements.panel.classList.remove("conversation-mode", "topic-response-mode");
    }
  }

  function viewTitle(mode) {
    const titles = {
      home: "HIS AGENT",
      chat: "HIS AGENT",
      voice: "Visit Session",
      status: "System Connection Status",
      examples: "Example Tasks"
    };
    return titles[mode] || "HIS AGENT";
  }

  function enterChatView(options) {
    const settings = options || {};
    state.viewMode = "chat";
    elements.panel.classList.add("conversation-mode");
    if (settings.topicResponse) {
      elements.panel.classList.add("topic-response-mode");
    }
    renderViewMode();
    transitionConversation(settings.planning ? "planning" : "chatting", settings.event || "enter_chat_view");
    if (!runtime.restoringScroll && !runtime.suppressHistoryAutoScroll && runtime.scrollManager && typeof runtime.scrollManager.scrollToBottom === "function") {
      window.requestAnimationFrame(function () {
        runtime.scrollManager.scrollToBottom({ force: true, behavior: "auto", respectUserScroll: true });
      });
    }
    recordFlowTrace("view_enter_chat", {
      route: settings.event || "enter_chat_view",
      view_state: "chat"
    });
    saveState();
  }

  function openChatWorkspace() {
    setActiveTab("agent");
    enterChatView({ event: "open_chat_workspace" });
    elements.panel.classList.remove("topic-response-mode", "is-planning-task");
    renderTaskSummary();
    if (!state.history.length) {
      addMessage(
        "agent",
        "This is the Agent chat and task workspace. You can enter a task directly; after execution, I will show the task plan above and describe each step.",
        "agent",
        { kind: "workspace-intro" }
      );
    }
    setStatus("Entered Agent chat.");
    saveState();
  }

  async function returnToHomeView() {
    if (runtime.recording && runtime.voiceMode === "session") {
      await stopActiveVoice("leave_voice_view");
    }
    state.viewMode = "home";
    state.activeTab = "agent";
    elements.panel.classList.remove("topic-response-mode", "is-planning-task");
    renderTabs();
    renderViewMode();
    renderTopicCarousel();
    transitionConversation("home", "return_home");
    recordFlowTrace("view_return_home", {
      route: "return_home",
      view_state: "home"
    });
    setStatus("Returned to the HIS Agent main view.");
    saveState();
  }

  function enterVoiceView() {
    state.viewMode = "voice";
    state.activeTab = "voice";
    renderTabs();
    renderViewMode();
    renderVoiceSessionStatus();
    renderTurns();
    transitionConversation(runtime.recording && runtime.voiceMode === "session" ? "voice_recording" : "voice_idle", "enter_voice_view");
    saveState();
  }

  async function openVisitSession() {
    if (runtime.recording && runtime.voiceMode === "dictation") {
      await stopActiveVoice("switch_to_visit_session");
      setStatus("Stopped main-input voice and entered Visit Session.");
    }
    enterVoiceView();
  }

  function enterStatusView(stage) {
    state.viewMode = "status";
    state.activeTab = "agent";
    renderTabs();
    renderViewMode();
    renderStatusView(stage || "checking");
    transitionConversation("chatting", "enter_status_view");
    saveState();
  }

  function enterExamplesView() {
    state.viewMode = "examples";
    state.activeTab = "agent";
    renderTabs();
    renderExamplesView();
    renderViewMode();
    transitionConversation("chatting", "enter_examples_view");
    saveState();
  }

  function renderOpenState() {
    elements.panel.classList.toggle("open", Boolean(state.open));
    elements.launcher.style.display = "grid";
    elements.launcher.style.visibility = "visible";
    elements.launcher.style.opacity = "1";
    elements.launcher.style.pointerEvents = "auto";
    renderPositions();
  }

  function renderPositions() {
    applyPanelGeometry();
    applyPosition(elements.launcher, state.launcherPosition);
  }

  function applyPanelGeometry() {
    const size = clampSize(state.panelSize || DEFAULT_PANEL_SIZE);
    elements.panel.style.width = size.width + "px";
    elements.panel.style.height = size.height + "px";
    elements.panel.style.right = "auto";
    elements.panel.style.bottom = "auto";
    if (state.panelSize) {
      state.panelSize = size;
    }
    const fallback = {
      left: Math.max(8, window.innerWidth - size.width - 20),
      top: 20
    };
    const position = clampPosition((state.panelPosition || fallback).left, (state.panelPosition || fallback).top, elements.panel, size);
    elements.panel.style.left = position.left + "px";
    elements.panel.style.top = position.top + "px";
    state.panelPosition = position;
  }

  function applyPosition(element, position) {
    if (!element || !position) {
      return;
    }
    const next = clampPosition(position.left, position.top, element);
    element.style.left = next.left + "px";
    element.style.top = next.top + "px";
    element.style.right = "auto";
    element.style.bottom = "auto";
  }

  function renderTabs() {
    const active = state.activeTab === "voice" ? "voice" : "agent";
    elements.tabButtons.forEach(function (button) {
      const selected = button.dataset.agentTab === active;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
    });
    elements.tabPanels.forEach(function (panel) {
      panel.hidden = panel.dataset.agentPanel !== active;
    });
  }

  function topicPageCount() {
    return elements.topicTrack ? elements.topicTrack.querySelectorAll(".his-agent-topic-card:not(.his-agent-topic-card-clone)").length : 1;
  }

  function clampTopicPage(value) {
    return Math.max(0, Math.min(topicPageCount() - 1, Number(value) || 0));
  }

  function renderTopicCarousel() {
    if (!elements.topicTrack) {
      return;
    }
    state.topicPage = clampTopicPage(state.topicPage);
    runtime.topicVisualIndex = Number(runtime.topicVisualIndex || state.topicPage + 1);
    applyTopicTransform(runtime.topicVisualIndex, true);
    elements.topicPrevButton.disabled = false;
    elements.topicNextButton.disabled = false;
    elements.topicGrid.dataset.topicPage = String(state.topicPage);
  }

  function shiftTopicPage(delta) {
    const count = topicPageCount();
    const current = clampTopicPage(state.topicPage);
    if (!count) {
      return;
    }
    if (runtime.topicJumpTimer) {
      window.clearTimeout(runtime.topicJumpTimer);
      runtime.topicJumpTimer = null;
    }
    if (delta > 0 && current === count - 1) {
      runtime.topicVisualIndex = count + 1;
      applyTopicTransform(runtime.topicVisualIndex, true);
      runtime.topicJumpTimer = window.setTimeout(function () {
        state.topicPage = 0;
        runtime.topicVisualIndex = 1;
        applyTopicTransform(runtime.topicVisualIndex, false);
        elements.topicGrid.dataset.topicPage = String(state.topicPage);
        saveState();
      }, 430);
      return;
    }
    if (delta < 0 && current === 0) {
      runtime.topicVisualIndex = 0;
      applyTopicTransform(runtime.topicVisualIndex, true);
      runtime.topicJumpTimer = window.setTimeout(function () {
        state.topicPage = count - 1;
        runtime.topicVisualIndex = count;
        applyTopicTransform(runtime.topicVisualIndex, false);
        elements.topicGrid.dataset.topicPage = String(state.topicPage);
        saveState();
      }, 430);
      return;
    }
    state.topicPage = clampTopicPage(current + delta);
    runtime.topicVisualIndex = state.topicPage + 1;
    applyTopicTransform(runtime.topicVisualIndex, true);
    elements.topicGrid.dataset.topicPage = String(state.topicPage);
    saveState();
  }

  function applyTopicTransform(visualIndex, animated) {
    elements.topicTrack.classList.toggle("no-transition", !animated);
    elements.topicTrack.style.transform = "translateX(calc(-" + (visualIndex * 50) + "% - " + (visualIndex * 7) + "px))";
    if (!animated) {
      elements.topicTrack.offsetHeight;
      elements.topicTrack.classList.remove("no-transition");
    }
  }

  function backToAgentHome() {
    returnToHomeView();
  }

  function renderServiceStatus() {
    renderCompactServiceStatus();
  }

  function renderCompactServiceStatus() {
    elements.backendStatus.innerHTML = [
      connectionChip("Backend", state.backendStatus),
      connectionChip("LLM", state.llmStatus),
      connectionChip("Agent", state.agentMode)
    ].join("");
    elements.asrStatus.innerHTML = [
      connectionChip("ASR Service", state.asrStatus),
      connectionChip("Microphone", state.microphoneStatus),
      connectionChip("Speaker Diarization", connectionDiarizationStatusValue())
    ].join("");
    renderServiceDiagnostics();
    renderLauncherStatus();
    renderVoiceSessionStatus();
    if (state.viewMode === "status") {
      renderStatusView(runtime.statusRefreshStage || "done");
    }
    updateDebugState();
    setVoiceActionAvailability();
  }

  function setVoiceActionAvailability() {
    if (!elements.planVoiceTaskButton) return;
    const hasFinalTurns = finalSpeakerTurns().length > 0;
    const hasAnyTurns = state.speakerTurns.some(function (turn) {
      return turn && String(turn.text || "").trim();
    });
    const llmReady = state.llmStatus === "connected";
    elements.planVoiceTaskButton.hidden = !hasFinalTurns;
    elements.planVoiceTaskButton.disabled = !hasFinalTurns;
    elements.planVoiceTaskButton.title = !hasFinalTurns
      ? "At least one final text turn is required"
      : (llmReady
        ? "Send visit-session turns to the LLM to organize into a task for confirmation; unconfirmed speakers are treated as doctor dictation"
        : "Clicking first checks the LLM; if disconnected, it only shows a notice and does not execute page actions");
    if (elements.fillVoiceInputButton) {
      elements.fillVoiceInputButton.disabled = !hasAnyTurns;
      elements.fillVoiceInputButton.title = hasAnyTurns ? "Only fill Doctor/Patient turns into the input box; do not send automatically" : "No turns available to fill";
    }
    updateVoiceButtons();
  }

  function renderVoiceSessionStatus() {
    if (!elements.voiceStatusCard) return;
    const microphone = normalizedVoiceMicrophoneStatus();
    const diarization = connectionStatusText(state.diarizationStatus);
    const diarizationSocket = connectionStatusText(state.diarizationWebSocketStatus);
    let notice = "";
    if (runtime.voiceStartInFlight || diarization === "starting" || diarizationSocket === "starting") {
      notice = "Diart is starting. A cold start can take tens of seconds. Wait for the ready message before speaking.";
    } else if (runtime.recording && runtime.voiceMode === "session" && diarization === "connected" && diarizationSocket === "connected") {
      notice = "Diart is connected. You can begin the doctor-patient conversation now.";
    } else if (microphone === "checking") {
      notice = "Requesting microphone permission...";
    } else if (microphone === "recording") {
      notice = "Microphone is connected and recording. ASR only handles transcription; page actions still require the LLM and user confirmation.";
    } else if (microphone === "unavailable_api") {
      notice = "The current browser does not expose getUserMedia, so microphone permission cannot be requested. Copy diagnostic information to continue troubleshooting.";
    } else if (microphone === "insecure_context") {
      notice = "Microphone request failed: SecurityError. The browser rejected this microphone call. Copy diagnostic information to continue troubleshooting.";
    } else if (microphone === "permission_denied") {
      notice = "Microphone request failed: NotAllowedError.The user or browser denied microphone permission.";
    } else if (microphone === "not_found") {
      notice = "Microphone request failed: NotFoundError.No microphone device was found.";
    } else if (microphone === "device_busy") {
      notice = "Microphone request failed: NotReadableError.The device may be busy or unreadable.";
    } else if (microphone === "available" || microphone === "permission_granted") {
      notice = "Microphone permission granted. Click Voice Input to start recording.";
    } else if (microphone === "get_user_media_error") {
      notice = "Microphone request failed. Check the real error name/message in ASR Developer Details.";
    } else if (state.asrStatus === "disconnected" || state.asrStatus === "unavailable") {
      notice = "ASR service is disconnected, so speech transcription is unavailable.";
    } else {
      notice = "Microphone permission is requested only after clicking Start Voice Task. No page action is automatically executed before organization is completed.";
    }
    elements.voiceStatusCard.innerHTML = [
      '<div class="his-agent-voice-status-grid">',
      voiceStatusChip("Microphone", voiceMicrophoneLabel(microphone), microphone),
      voiceStatusChip("ASR", voiceAsrLabel(state.asrStatus, state.asrWebSocketStatus), state.asrStatus),
      voiceStatusChip("Speaker Diarization", voiceDiarizationLabel(), state.diarizationStatus),
      "</div>",
      '<div class="his-agent-voice-notice">' + escapeHtml(notice) + "</div>",
      '<details class="his-agent-voice-dev-summary">',
      '  <summary>Developer Details</summary>',
      '  <div class="his-agent-voice-mode-note">ASR: ' + escapeHtml(connectionStatusText(state.asrStatus || state.asrWebSocketStatus || "idle")) + '; Speaker Separation: ' + escapeHtml(voiceDiarizationLabel()) + '; Role Mapping: Semantic Correction Enabled.</div>',
      '</details>'
    ].join("");
    setVoiceActionAvailability();
    renderVoiceSessionSummary();
    renderVoiceDebug();
  }

  function voiceStatusChip(label, value, rawStatus) {
    return '<span class="his-agent-connection-chip ' + escapeHtml(connectionStatusClass(rawStatus || value)) + '">' +
      '<strong>' + escapeHtml(label) + '</strong>' +
      '<em>' + escapeHtml(value || "Unknown") + '</em>' +
      "</span>";
  }

  function voiceMicrophoneLabel(value) {
    const text = connectionStatusText(value);
    if (isActualVoiceRecording()) return "Recording";
    if (text === "permission_denied") return "Unavailable";
    if (text === "not_found" || text === "device_busy" || text === "unavailable" || text === "unavailable_api") return "Unavailable";
    return "Standby";
  }

  function normalizedVoiceMicrophoneStatus() {
    const raw = String(state.microphoneStatus || "unknown").trim().toLowerCase();
    if (raw === "recording" && !isActualVoiceRecording()) {
      return state.microphonePermission === "granted" ? "permission_granted" : "unknown";
    }
    if ((raw === "checking" || raw === "stopping") && !runtime.recording) return "unknown";
    return state.microphoneStatus || "unknown";
  }

  function isActualVoiceRecording() {
    const diagnostics = runtime.lastAsrEvent && runtime.lastAsrEvent.voiceDiagnostic ? runtime.lastAsrEvent.voiceDiagnostic : {};
    const trackCount = Number(diagnostics.streamTrackCount || 0);
    return Boolean(runtime.recording && trackCount > 0);
  }

  function voiceAsrLabel(asrStatus, socketStatus) {
    if (runtime.recording && runtime.voiceMode === "session" && connectionStatusText(socketStatus) === "connected") return "Connected";
    return connectionStatusText(asrStatus) === "connected" ? "Connected" : "Disconnected";
  }

  function voiceDiarizationLabel() {
    const provider = String(state.diarizationProvider || "").toLowerCase();
    const status = connectionStatusText(state.diarizationStatus);
    const socketStatus = connectionStatusText(state.diarizationWebSocketStatus);
    if (status === "starting" || socketStatus === "starting") return "Starting...";
    if (provider.indexOf("diart") >= 0 && status === "connected" && socketStatus === "connected") return "Connected";
    if (provider.indexOf("diart") >= 0 && status === "connected") return "Ready";
    if (status === "not_activated" || provider.indexOf("disabled") >= 0) return "Not activated";
    return "Unavailable";
  }

  function renderVoiceSessionSummary() {
    if (!elements.voiceSessionSummary) return;
    const finalCount = finalSpeakerTurns().length;
    elements.voiceSessionSummary.textContent = finalCount
      ? "Current Visit session has generated " + finalCount + " organizable turns. You can keep correcting roles or organize them into an Agent task for confirmation."
      : "There are no final Doctor/Patient turns yet. Start a voice task or load an example visit.";
  }

  function connectionChip(label, value, forcedClass) {
    const statusClass = forcedClass || connectionStatusClass(value);
    return '<span class="his-agent-connection-chip ' + escapeHtml(statusClass) + '">' +
      '<strong>' + escapeHtml(label) + '</strong>' +
      '<em>' + escapeHtml(connectionStatusText(value)) + '</em>' +
      "</span>";
  }

  function connectionStatusText(value) {
    const text = String(value || "unknown").trim();
    const lower = text.toLowerCase();
    if (!text) return "unknown";
    if (lower === "connected" || lower === "ok" || lower === "available" || text.indexOf("Available") >= 0 || text.indexOf("Connected") >= 0) return "connected";
    if (lower === "starting" || lower === "connecting" || lower === "cold_starting") return "starting";
    if (lower === "not_activated" || lower === "disabled") return "not_activated";
    if (lower.indexOf("diart_local") >= 0 && lower.indexOf("connected") >= 0) return "connected";
    if (lower.indexOf("manual") >= 0) return "neutral";
    if (lower === "llm_enabled") return "llm_enabled";
    if (lower === "blocked_no_llm") return "blocked_no_llm";
    if (lower === "permission_denied") return "permission_denied";
    if (lower === "permission_granted") return "permission_granted";
    if (lower === "permission_prompt") return "permission_prompt";
    if (lower === "recording") return "recording";
    if (lower === "insecure_context") return "insecure_context";
    if (lower === "unavailable_api") return "unavailable_api";
    if (lower.indexOf("unavailable_api") >= 0) return "unavailable_api";
    if (lower === "not_found") return "not_found";
    if (lower === "device_busy") return "device_busy";
    if (lower === "get_user_media_error") return "get_user_media_error";
    if (lower === "blocked_by_browser") return "blocked_by_browser";
    if (lower === "blocked_by_asr") return "blocked_by_asr";
    if (lower === "unavailable") return "unavailable";
    if (lower.indexOf("unavailable") >= 0) return "unavailable";
    if (lower === "disconnected" || text.indexOf("Unavailable") >= 0 || text.indexOf("Disconnected") >= 0) return "disconnected";
    if (lower === "not_configured" || text.indexOf("Not configured") >= 0) return "not_configured";
    if (lower === "checking") return "checking";
    if (lower === "timeout") return "timeout";
    if (lower.indexOf("http_") === 0 || text.indexOf("Error") >= 0) return text;
    return text;
  }

  function connectionStatusClass(value) {
    const text = connectionStatusText(value).toLowerCase();
    if (text === "connected" || text === "llm_enabled" || text === "available" || text === "permission_granted" || text === "recording") return "connected";
    if (text === "blocked_no_llm" || text === "llm_check_required" || text === "slow" || text === "not_configured" || text === "unknown" || text === "not_activated") return "warning";
    if (text === "permission_prompt" || text === "permission_denied" || text === "insecure_context" || text === "blocked_by_browser" || text === "blocked_by_asr" || text === "unavailable" || text === "unavailable_api" || text === "not_found" || text === "device_busy" || text === "get_user_media_error") return "warning";
    if (text === "checking" || text === "starting" || text === "timeout") return "checking";
    if (text === "disconnected" || text.indexOf("http_") === 0) return "disconnected";
    return "neutral";
  }

  function renderServiceDiagnostics() {
    if (!elements.serviceDiagnostics) {
      return;
    }
    const details = runtime.serviceDetails || {};
    elements.serviceDiagnostics.innerHTML = [
      serviceDiagnosticRow("Backend health", details.backend),
      serviceDiagnosticRow("LLM test", details.llm),
      serviceDiagnosticRow("ASR health", details.asr)
    ].join("");
  }

  function serviceDiagnosticRow(label, detail) {
    const info = detail || {};
    return '<div class="his-agent-service-diagnostic-row">' +
      '<strong>' + escapeHtml(label) + '</strong>' +
      '<span>' + escapeHtml(connectionStatusText(info.status || "unknown")) + '</span>' +
      '<code>' + escapeHtml(info.url || "-") + '</code>' +
      (info.error ? '<em>' + escapeHtml(info.error) + '</em>' : "") +
      "</div>";
  }

  function renderLauncherStatus() {
    if (!elements.launcher) {
      return;
    }
    const subtitle = state.llmStatus === "connected" ? "LLM connected" : "LLM disconnected";
    elements.launcher.innerHTML = "<strong>AI Agent</strong><span>" + subtitle + "</span>";
  }

  function setActiveTab(tab) {
    state.activeTab = tab === "voice" ? "voice" : "agent";
    if (state.activeTab === "voice") {
      state.viewMode = "voice";
    } else if (state.viewMode === "voice") {
      state.viewMode = "chat";
    }
    renderTabs();
    renderViewMode();
    saveState();
  }

  function renderTaskSummary() {
    if (!elements.task || !elements.currentTaskCard) {
      return;
    }
    elements.task.hidden = true;
    elements.task.textContent = "";
    const summary = window.AgentTaskOrchestrator && window.AgentTaskOrchestrator.getSummary
      ? window.AgentTaskOrchestrator.getSummary()
      : { hasActiveTask: false };
    if (!summary.hasActiveTask) {
      if (runtime.planningTask && state.viewMode === "chat") {
        elements.panel.classList.add("has-active-task", "is-planning-task");
        updatePrimaryTaskButton({
          hasActiveTask: true,
          status: "planning",
          taskId: runtime.planningTask.runId,
          objective: runtime.planningTask.objective
        });
        elements.currentTaskCard.hidden = false;
        renderPlanningTaskCard(runtime.planningTask);
        updateHistoryButton("");
        updateTaskPlanHeaderButton({
          hasActiveTask: true,
          status: "planning",
          taskId: runtime.planningTask.runId,
          objective: runtime.planningTask.objective
        });
        return;
      }
      const recentSummary = state.viewMode === "chat" ? latestTaskHistorySummary() : null;
      elements.panel.classList.remove("has-active-task", "is-planning-task");
      updatePrimaryTaskButton(recentSummary);
      if (recentSummary) {
        elements.currentTaskCard.hidden = false;
        renderCurrentTaskCard(recentSummary);
        maybeAppendClinicalDraftReviewFromSummary(recentSummary);
        updateHistoryButton(recentSummary.taskId || "");
        updateTaskPlanHeaderButton(recentSummary);
        return;
      }
      elements.currentTaskCard.hidden = true;
      elements.currentTaskCard.innerHTML = "";
      updateHistoryButton("");
      updateTaskPlanHeaderButton(null);
      return;
    }
    elements.panel.classList.add("has-active-task");
    elements.panel.classList.remove("is-planning-task");
    updatePrimaryTaskButton(summary);
    elements.currentTaskCard.hidden = false;
    renderCurrentTaskCard(summary);
    maybeAppendClinicalDraftReviewFromSummary(summary);
    recordFlowTrace("task_summary_render", {
      task_id: summary.taskId || "",
      conversation_state: state.conversationState || "",
      view_state: normalizeViewMode(state.viewMode),
      action_result: {
        status: summary.status || "",
        currentStepIndex: summary.currentStepIndex,
        completedSteps: summary.completedSteps,
        totalSteps: summary.totalSteps
      }
    });
    updateHistoryButton(summary.taskId || "");
    updateTaskPlanHeaderButton(summary);
  }

  function updateTaskPlanHeaderButton(summary) {
    if (!elements.taskPlanButton) return;
    const currentSummary = summary || currentOrRecentTaskSummary();
    const visible = normalizeViewMode(state.viewMode) === "chat" && Boolean(currentSummary && (currentSummary.hasActiveTask || currentSummary.isRecentTask));
    elements.taskPlanButton.hidden = !visible;
    elements.taskPlanButton.disabled = !visible;
    if (!visible) {
      elements.taskPlanButton.removeAttribute("data-task-id");
      return;
    }
    const taskId = getCurrentTaskIdentifier(currentSummary);
    elements.taskPlanButton.dataset.taskId = taskId || "";
    const status = taskStatusLabel(currentSummary.status || "pending");
    const progress = (currentSummary.completedSteps || 0) + "/" + (currentSummary.totalSteps || 0);
    elements.taskPlanButton.textContent = "Task Plan";
    elements.taskPlanButton.title = "Open latest task plan: " + status + " " + progress;
    elements.taskPlanButton.setAttribute("aria-label", "Open latest task plan");
  }

  function currentOrRecentTaskSummary() {
    const summary = window.AgentTaskOrchestrator && window.AgentTaskOrchestrator.getSummary
      ? window.AgentTaskOrchestrator.getSummary()
      : null;
    if (summary && summary.hasActiveTask) return summary;
    return state.viewMode === "chat" ? latestTaskHistorySummary() : null;
  }

  function resetTaskPanelUiState() {
    state.recentTaskPanelMinimized = false;
    state.recentTaskStepsExpanded = false;
    state.recentTaskPinnedTaskId = "";
    runtime.taskPanelManualOverride = false;
    runtime.lastTaskPanelTaskId = "";
    if (runtime.taskPanelAutoCompactTimer) {
      window.clearTimeout(runtime.taskPanelAutoCompactTimer);
      runtime.taskPanelAutoCompactTimer = null;
    }
  }

  function syncTaskPanelUiState(summary) {
    const taskId = getCurrentTaskIdentifier(summary);
    if (!taskId) return;
    if (String(state.recentTaskPinnedTaskId || "") !== String(taskId)) {
      state.recentTaskPinnedTaskId = String(taskId);
      state.recentTaskStepsExpanded = shouldRestoreTaskStepsOpen(summary);
      state.recentTaskPanelMinimized = Boolean(summary && summary.isRecentTask);
      runtime.taskPanelManualOverride = false;
      runtime.currentTaskStepsScroll = null;
      if (runtime.lastTaskPanelTaskId !== String(taskId)) {
        runtime.lastTaskPanelTaskId = String(taskId);
      }
      saveState();
    }
    if (summary && summary.hasActiveTask && !state.recentTaskPanelMinimized) {
      scheduleTaskPanelAutoCompact(summary);
    }
  }

  function scheduleTaskPanelAutoCompact(summary) {
    const taskId = getCurrentTaskIdentifier(summary);
    if (!taskId || runtime.taskPanelManualOverride || runtime.taskPanelAutoCompactTimer || isTerminalTaskStatus(summary && summary.status)) {
      return;
    }
    runtime.taskPanelAutoCompactTimer = window.setTimeout(function () {
      runtime.taskPanelAutoCompactTimer = null;
      const latest = currentOrRecentTaskSummary();
      if (!latest || String(getCurrentTaskIdentifier(latest) || "") !== String(taskId) || runtime.taskPanelManualOverride) {
        return;
      }
      state.recentTaskPanelMinimized = true;
      saveState();
      renderTaskSummary();
    }, TASK_PANEL_AUTO_COMPACT_MS);
  }

  function isTaskPanelMinimized(summary) {
    const taskId = getCurrentTaskIdentifier(summary);
    return Boolean(taskId && String(state.recentTaskPinnedTaskId || "") === String(taskId) && state.recentTaskPanelMinimized);
  }

  function setTaskPanelMinimized(summary, minimized, manual) {
    const taskId = getCurrentTaskIdentifier(summary);
    if (!taskId) return;
    state.recentTaskPinnedTaskId = String(taskId);
    state.recentTaskPanelMinimized = Boolean(minimized);
    runtime.taskPanelManualOverride = Boolean(manual);
    if (runtime.taskPanelAutoCompactTimer) {
      window.clearTimeout(runtime.taskPanelAutoCompactTimer);
      runtime.taskPanelAutoCompactTimer = null;
    }
    saveState();
    renderTaskSummary();
  }

  function openRecentTaskPanel() {
    setActiveTab("agent");
    enterChatView({ event: "open_recent_task_panel" });
    const summary = currentOrRecentTaskSummary();
    if (!summary) {
      updateTaskPlanHeaderButton(null);
      return;
    }
    setTaskPanelMinimized(summary, false, true);
    window.requestAnimationFrame(function () {
      if (elements.currentTaskCard && !elements.currentTaskCard.hidden) {
        elements.currentTaskCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  }

  function startTaskSummaryTicker() {
    if (runtime.taskSummaryTimer) {
      window.clearInterval(runtime.taskSummaryTimer);
    }
    runtime.taskSummaryTimer = window.setInterval(function () {
      const now = Date.now();
      const summary = window.AgentTaskOrchestrator && window.AgentTaskOrchestrator.getSummary
        ? window.AgentTaskOrchestrator.getSummary()
        : null;
      if (summary && summary.hasActiveTask) {
        refreshCurrentTaskElapsed(summary);
        const details = elements.currentTaskCard && elements.currentTaskCard.querySelector(".his-agent-current-steps");
        const pinned = runtime.currentTaskStepLock && runtime.currentTaskStepLock.userPinnedStepScroll;
        if (now - Number(runtime.lastTaskSummaryRenderMs || 0) < 250) return;
        if (details && details.open && pinned) return;
        renderTaskSummary();
        runtime.lastTaskSummaryRenderMs = now;
        return;
      }
      if (runtime.planningTask && state.viewMode === "chat") {
        refreshCurrentTaskElapsed(null);
        if (now - Number(runtime.lastTaskSummaryRenderMs || 0) >= 250) {
          renderTaskSummary();
          runtime.lastTaskSummaryRenderMs = now;
        }
      }
    }, TASK_SUMMARY_TICK_MS);
  }

  function refreshCurrentTaskElapsed(summary) {
    if (!elements.currentTaskCard || elements.currentTaskCard.hidden) return;
    const target = elements.currentTaskCard.querySelector(".his-agent-current-elapsed");
    if (!target) return;
    let elapsedMs = 0;
    if (summary && summary.hasActiveTask) {
      elapsedMs = summary.elapsedMs || 0;
    } else if (runtime.planningTask) {
      elapsedMs = Math.max(0, Date.now() - Number(runtime.planningTask.startedAtMs || Date.now()));
    }
    target.textContent = "Elapsed: " + formatElapsed(elapsedMs);
  }

  function renderTaskDetails(summary) {
    if (!elements.stepDetails || !elements.developerDetails || !elements.taskHistory) {
      return;
    }
    if (!summary || !summary.hasActiveTask) {
      elements.stepDetails.innerHTML = '<div class="his-agent-empty-detail">No task is currently running.</div>';
      elements.developerDetails.textContent = "";
    } else {
      const plan = Array.isArray(summary.plan) ? summary.plan : [];
      elements.stepDetails.innerHTML = plan.length ? plan.map(function (step, index) {
        return buildTaskStepDetails(step, index, summary);
      }).join("") : '<div class="his-agent-empty-detail">No steps.</div>';
      elements.developerDetails.textContent = JSON.stringify({
        status: summary.status,
        elapsedMs: summary.elapsedMs,
        usageLast: summary.usageLast || null,
        usageTotal: summary.usageTotal || null,
        currentStep: summary.currentStep || "",
        progressMessages: sanitizeProgressMessages(summary.progressMessages || []),
        stepLogs: sanitizeStepLogs(summary.stepLogs || []),
        lastError: summary.lastError || ""
      }, null, 2);
    }
    renderTaskHistoryPanel();
  }

  function renderCurrentTaskCard(summary) {
    syncTaskPanelUiState(summary);
    const progress = (summary.completedSteps || 0) + "/" + (summary.totalSteps || 0);
    const status = normalizeStepStatus(summary.status || "running");
    const showCancel = !summary.isRecentTask && !isTerminalTaskStatus(status);
    const minimized = isTaskPanelMinimized(summary);
    const scrollSnapshot = captureCurrentTaskStepsScroll(summary);
    if (scrollSnapshot) {
      runtime.currentTaskStepsScroll = scrollSnapshot;
    }
    const stepsOpen = Boolean(state.recentTaskStepsExpanded || shouldRestoreTaskStepsOpen(summary) || scrollSnapshot);
    elements.currentTaskCard.classList.toggle("recent", Boolean(summary.isRecentTask));
    elements.currentTaskCard.classList.toggle("minimized", minimized);
    if (minimized) {
      elements.currentTaskCard.innerHTML = [
        '<div class="his-agent-current-compact" role="group" aria-label="Current Task Plan">',
        '  <span class="his-agent-current-compact-title">' + escapeHtml(summary.cardTitle || (summary.isRecentTask ? "Recent Task" : "Current Task")) + ': </span>',
        '  <strong>' + escapeHtml(summary.objective || summary.currentStep || "LLM Task") + '</strong>',
        '  <span class="his-agent-current-compact-meta">' + escapeHtml(taskStatusLabel(status)) + ' ' + escapeHtml(progress) + ' ' + escapeHtml(formatElapsed(summary.elapsedMs || 0)) + '</span>',
        summary.lastError ? '  <span class="his-agent-current-compact-error">' + escapeHtml(summary.lastError) + '</span>' : "",
        '  <button type="button" class="his-agent-link-button" data-agent-action="expand-task-panel">Expand</button>',
        "</div>"
      ].join("");
      return;
    }
    elements.currentTaskCard.innerHTML = [
      '<div class="his-agent-current-head">',
      '  <div class="his-agent-current-title">' + escapeHtml(summary.cardTitle || "Current Task") + '</div>',
      '  <button type="button" class="his-agent-link-button" data-agent-action="minimize-task-panel">Minimize</button>',
      "</div>",
      '<div class="his-agent-current-main">' + escapeHtml(summary.objective || summary.currentStep || "LLM Task") + '</div>',
      '<div class="his-agent-current-meta">',
      '  <span>Status: ' + escapeHtml(taskStatusLabel(status)) + '</span>',
      '  <span>Progress: ' + escapeHtml(progress) + '</span>',
      '  <span class="his-agent-current-elapsed">Elapsed: ' + escapeHtml(formatElapsed(summary.elapsedMs || 0)) + '</span>',
      '  <span>' + escapeHtml(taskUsageText(summary)) + '</span>',
      "</div>",
      '<div class="his-agent-current-narration">Agent: ' + escapeHtml(buildTaskNarration(summary, status)) + '</div>',
      summary.currentStep ? '<div class="his-agent-current-step">Executing: ' + escapeHtml(summary.currentStep) + '</div>' : "",
      summary.lastError ? '<div class="his-agent-current-error">Notice: ' + escapeHtml(summary.lastError) + '</div>' : "",
      '<details class="his-agent-current-steps"' + (stepsOpen ? " open" : "") + '>',
      '  <summary>Expand Steps</summary>',
      '  <div class="his-agent-task-list" id="hisAgentTaskList"></div>',
      '</details>',
      '<div class="his-agent-current-actions">',
      '  <button type="button" class="his-agent-button secondary" data-agent-action="history">View Full Records</button>',
      showCancel ? '  <button type="button" class="his-agent-button danger" data-agent-action="cancel-task">Cancel Task</button>' : "",
      "</div>"
    ].join("");
    const taskList = elements.currentTaskCard.querySelector("#hisAgentTaskList");
    if (taskList) {
      renderTaskList(summary, taskList);
      restoreCurrentTaskStepsScroll(summary, scrollSnapshot);
      window.requestAnimationFrame(function () {
        if (!scrollSnapshot) lockTaskListToCurrentStep(summary, taskList);
        if (scrollSnapshot) restoreCurrentTaskStepsScroll(summary, scrollSnapshot);
      });
      if (scrollSnapshot) {
        window.setTimeout(function () {
          restoreCurrentTaskStepsScroll(summary, scrollSnapshot);
        }, 80);
      }
      taskList.addEventListener("scroll", function () {
        if (runtime.suppressTaskListScrollCapture) return;
        const taskId = getCurrentTaskIdentifier(summary);
        if (!taskId) return;
        state.recentTaskStepsExpanded = true;
        saveTaskStepsUiState(taskId, true);
        const lock = runtime.currentTaskStepLock || {};
        runtime.currentTaskStepLock = Object.assign({}, lock, {
          taskId: String(taskId),
          userPinnedStepScroll: true
        });
        runtime.currentTaskStepsScroll = {
          taskId: String(taskId),
          listScrollTop: Number(taskList.scrollTop || 0),
          bodyScrollTop: elements.body ? Number(elements.body.scrollTop || 0) : 0,
          updatedAt: Date.now()
        };
      }, { passive: true });
    }
    const stepsDetails = elements.currentTaskCard.querySelector(".his-agent-current-steps");
    if (stepsDetails) {
      const taskId = getCurrentTaskIdentifier(summary);
      stepsDetails.addEventListener("toggle", function () {
        state.recentTaskStepsExpanded = Boolean(stepsDetails.open);
        saveTaskStepsUiState(taskId, stepsDetails.open);
        saveState();
        if (!stepsDetails.open && runtime.currentTaskStepsScroll && runtime.currentTaskStepsScroll.taskId === String(taskId || "")) {
          runtime.currentTaskStepsScroll = null;
        }
        if (stepsDetails.open) {
          const taskList = elements.currentTaskCard && elements.currentTaskCard.querySelector("#hisAgentTaskList");
          window.requestAnimationFrame(function () {
            lockTaskListToCurrentStep(summary, taskList);
          });
        }
      });
    }
  }

  function updateHistoryButton(taskId) {
    if (!elements.openHistoryButton) return;
    elements.openHistoryButton.dataset.taskId = taskId || "";
    elements.openHistoryButton.textContent = taskId ? "View Full Records" : "View History";
  }

  function openAgentHistory() {
    saveScrollSnapshot("open_agent_history");
    const taskId = elements.openHistoryButton && elements.openHistoryButton.dataset.taskId || readActiveTaskId();
    const target = "agent-history.html" + (taskId ? "?taskId=" + encodeURIComponent(taskId) : "");
    window.location.href = target;
  }

  function readActiveTaskId() {
    try {
      const task = JSON.parse(window.localStorage.getItem("hisAgentActiveTask") || "null");
      return task && task.task_id ? String(task.task_id) : "";
    } catch (error) {
      return "";
    }
  }

  function updatePrimaryTaskButton(summary) {
    if (!elements.sendButton) {
      return;
    }
    const shouldCancel = isFooterCancellableTask(summary);
    elements.sendButton.dataset.action = shouldCancel ? "cancel-task" : "send";
    elements.sendButton.textContent = shouldCancel ? "Cancel Task" : "Send";
    elements.sendButton.classList.toggle("danger", shouldCancel);
    elements.sendButton.setAttribute("aria-label", shouldCancel ? "Cancel current Agent task" : "Send task to Agent");
    elements.sendButton.title = shouldCancel
      ? "The current task is executing; click to cancel it."
      : "Send the task in the input box.";
  }

  function isFooterCancellableTask(summary) {
    if (!summary || !summary.hasActiveTask) {
      return false;
    }
    const rawStatus = String(summary.status || "").toLowerCase();
    const status = normalizeStepStatus(rawStatus);
    return rawStatus === "planning" || rawStatus === "running" || status === "running";
  }

  function latestTaskHistorySummary() {
    const history = window.AgentTaskOrchestrator && window.AgentTaskOrchestrator.getHistory
      ? window.AgentTaskOrchestrator.getHistory()
      : [];
    const latest = history.slice().reverse().find(function (item) {
      return item && Array.isArray(item.plan) && item.plan.length && item.task_id !== runtime.hiddenRecentTaskId;
    });
    if (!latest) {
      return null;
    }
    const plan = latest.plan || [];
    const completedSteps = plan.filter(function (step) {
      return normalizeStepStatus(step && step.status) === "completed";
    }).length;
    const activeStepIndex = plan.findIndex(function (step) {
      const status = normalizeStepStatus(step && step.status);
      return status === "running" || status === "waiting_user" || status === "failed";
    });
    const currentStepIndex = activeStepIndex >= 0
      ? activeStepIndex
      : Math.max(0, Math.min(plan.length - 1, Number(latest.current_step_index || completedSteps || 0)));
    const currentStep = plan[currentStepIndex] || {};
    const rawStatus = latest.status || (completedSteps >= plan.length ? "completed" : "pending");
    return {
      hasActiveTask: false,
      isRecentTask: true,
      cardTitle: "Recent Task Plan",
      taskId: latest.task_id || "",
      objective: latest.objective || latest.message || latest.task_id || "Recent Task",
      status: rawStatus,
      currentStep: isTerminalTaskStatus(rawStatus) ? "" : currentStep.goal || currentStep.id || "",
      currentStepIndex: currentStepIndex,
      totalSteps: plan.length,
      completedSteps: completedSteps,
      pendingSteps: Math.max(0, plan.length - completedSteps),
      lastError: latest.lastError || latest.last_error || "",
      elapsedMs: taskElapsedMsForDisplay(latest),
      usageLast: latest.usage_last || null,
      usageTotal: latest.usage_total || null,
      slots: latest.slots || {},
      progressMessages: latest.progress_messages || [],
      stepLogs: latest.step_logs || [],
      plan: plan
    };
  }

  function isTerminalTaskStatus(status) {
    const normalized = normalizeStepStatus(status || "");
    const raw = String(status || "").toLowerCase();
    return normalized === "completed" || normalized === "failed" || normalized === "skipped" ||
      raw === "cancelled" || raw === "canceled";
  }

  function buildTaskNarration(summary, status) {
    if (summary && summary.isRecentTask) {
      if (status === "completed") {
        return "Task completed. The task plan and each step result are kept below for review.";
      }
      if (status === "failed") {
        return "The latest task did not complete. The failed step and reason are kept below so you can decide whether to rerun.";
      }
      if (status === "waiting_user") {
        return "The latest task is waiting for confirmation. Review the plan and continue entering additional details.";
      }
      return "Below is the latest task execution plan and current status.";
    }
    if (status === "running") {
      return summary && summary.currentStep
        ? "I am executing " + summary.currentStep + " and will continue to the next step when done."
        : "I am executing step by step according to the LLM-generated task plan.";
    }
    if (status === "waiting_user") {
      return "I need more information or confirmation from you; after confirmation, I will continue with the same task plan.";
    }
    if (status === "completed") {
      return "Task completed. The execution plan is kept below for review.";
    }
    if (status === "failed") {
      return "This task has stopped. The failed step and reason are shown in the step details below.";
    }
    return "I am understanding the task and preparing to generate or update the task plan.";
  }

  function renderTaskList(summary, target) {
    const plan = Array.isArray(summary && summary.plan) ? summary.plan : [];
    if (!plan.length) {
      target.innerHTML = '<div class="his-agent-empty-detail">The LLM has not returned displayable steps yet.</div>';
      return;
    }
    target.innerHTML = [
      '<div class="his-agent-task-list-title">Task: ' + escapeHtml(summary.objective || "LLM task") + '</div>',
      plan.map(function (step, index) {
        return buildTaskListItem(step, index, summary);
      }).join("")
    ].join("");
  }

  function lockTaskListToCurrentStep(summary, taskList) {
    if (!summary || !taskList) return;
    const plan = Array.isArray(summary.plan) ? summary.plan : [];
    const targetIndex = plan.findIndex(function (step) {
      const status = normalizeStepStatus(step && step.status);
      return status === "running" || status === "failed" || status === "waiting_user";
    });
    if (targetIndex < 0) return;
    const step = plan[targetIndex] || {};
    const status = normalizeStepStatus(step.status || "");
    if (status === "completed") return;
    const taskId = String(getCurrentTaskIdentifier(summary) || "");
    const stepId = String(step.id || targetIndex);
    const lockKey = [taskId, stepId, status].join("|");
    const currentLock = runtime.currentTaskStepLock || {};
    const isNewStep = currentLock.lockKey !== lockKey;
    const savedScroll = runtime.currentTaskStepsScroll;
    const hasSavedScroll = Boolean(savedScroll && String(savedScroll.taskId || "") === taskId && Number(savedScroll.listScrollTop || 0) > 0);
    const userPinned = Boolean((currentLock.userPinnedStepScroll || hasSavedScroll) && !isNewStep);
    const details = taskList.closest(".his-agent-current-steps");
    if (details && !details.open) return;
    if (taskList.clientHeight <= 0) return;
    if (userPinned && status !== "failed") return;
    if (!isNewStep && currentLock.autoLocked && status !== "failed") return;
    const item = taskList.querySelector('[data-step-index="' + String(targetIndex) + '"]');
    if (!item) return;
    runtime.currentTaskStepLock = {
      taskId: taskId,
      stepId: stepId,
      lockKey: lockKey,
      userPinnedStepScroll: false,
      autoLocked: true,
      updatedAt: Date.now()
    };
    const listRect = taskList.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const itemTop = taskList.scrollTop + itemRect.top - listRect.top;
    const top = Math.max(0, itemTop - Math.max(0, (taskList.clientHeight - itemRect.height) / 2));
    const bodyTop = elements.body ? elements.body.scrollTop : null;
    try {
      taskList.scrollTo({ top: top, behavior: "auto" });
    } catch (error) {
      taskList.scrollTop = top;
    }
    try {
      item.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    } catch (error) {
      // scrollTo above is the primary path; scrollIntoView is best-effort.
    }
    if (elements.body && bodyTop !== null) {
      elements.body.scrollTop = bodyTop;
      window.requestAnimationFrame(function () {
        if (elements.body) elements.body.scrollTop = bodyTop;
      });
    }
  }

  function buildTaskListItem(step, index, summary) {
    const status = normalizeStepStatus(step.status || (index === summary.currentStepIndex ? "running" : "pending"));
    const isCurrent = index === Number(summary.currentStepIndex || 0) && (status === "running" || status === "waiting_user");
    const pulse = isCurrent && status === "running";
    const open = status === "running" || status === "failed" || status === "waiting_user" ? " open" : "";
    const elapsed = stepElapsedLabel(step, status);
    const reason = status === "failed" || status === "waiting_user"
      ? (step.error || (step.result && step.result.error) || summary.lastError || "")
      : "";
    return '<details class="his-agent-task-item ' + escapeHtml(status) + (isCurrent ? " current-step" : "") + (pulse ? " agent-step-pulse" : "") + '"' + open + ' data-step-status="' + escapeHtml(status) + '" data-step-id="' + escapeHtml(step.id || String(index)) + '" data-step-index="' + escapeHtml(String(index)) + '">' +
      '<summary class="his-agent-task-row">' +
      '  <span class="his-agent-status-mark ' + escapeHtml(status) + '" aria-hidden="true">' + escapeHtml(taskStatusIcon(status)) + '</span>' +
      '  <span class="his-agent-task-copy">' +
      '    <strong>' + escapeHtml(index + 1 + ". " + (step.goal || step.id || "Unnamed Step")) + '</strong>' +
      '    <span>' + escapeHtml(step.actionType || step.type || "action") + '</span>' +
      (reason ? '    <span class="his-agent-task-error">Reason: ' + escapeHtml(reason) + '</span>' : "") +
      '  </span>' +
      '  <span class="his-agent-task-meta">' +
      '    <span class="his-agent-status-pill ' + escapeHtml(status) + '">' + escapeHtml(taskStatusLabel(status)) + '</span>' +
      '    <span>' + escapeHtml(elapsed) + '</span>' +
      '    <span>' + escapeHtml(stepUsageText(step)) + '</span>' +
      "  </span>" +
      "</summary>" +
      buildTaskStepDetails(step, index, summary) +
      "</details>";
  }

  function buildTaskStepDetails(step, index, summary) {
    const stepLogs = summary && summary.stepLogs || [];
    const details = {
      step: index + 1,
      id: step.id || "",
      status: normalizeStepStatus(step.status || "pending"),
      llmPlanSummary: step.goal || "",
      structuredAction: {
        actionType: step.actionType || step.type || "",
        requiredPage: step.requiredPage || "",
        args: step.args || {}
      },
      patientResolver: extractResolverLogs(stepLogs, "patient"),
      fieldResolver: extractResolverLogs(stepLogs, "field"),
      adapterExecution: compactResult(step.result || null),
      valueChange: extractValueChange(step.result || null),
      audit: extractAuditDetails(step.result || null),
      error: step.error || "",
      timing: step.timing || (step.timing_breakdown ? { breakdown: step.timing_breakdown, elapsed_ms: step.elapsed_ms } : "timing not recorded"),
      usage: stepUsageObject(step) || "local DOM execution / token usage not returned",
      tokenSource: step.usage_source || step.token_source || step.result && (step.result.usage_source || step.result.token_source) || "unknown"
    };
    if (step.waiting_details) {
      details.waitingDetails = step.waiting_details;
    }
    const progress = findRelatedProgress(step, summary && summary.progressMessages || []);
    if (progress.length) {
      details.progress = progress;
    }
    return '<div class="his-agent-task-detail">' +
      '<div class="his-agent-task-detail-grid">' +
      '<span>Action</span><strong>' + escapeHtml(details.structuredAction.actionType || "-") + '</strong>' +
      '<span>Page</span><strong>' + escapeHtml(details.structuredAction.requiredPage || "-") + '</strong>' +
      '<span>Elapsed</span><strong>' + escapeHtml(stepElapsedLabel(step, details.status)) + '</strong>' +
      '<span>Token</span><strong>' + escapeHtml(stepUsageText(step).replace(/^token: /, "")) + '</strong>' +
      "</div>" +
      '<pre>' + escapeHtml(JSON.stringify(details, null, 2)) + '</pre>' +
      "</div>";
  }

  function taskUsageText(summary) {
    return summary && summary.usageTotal ? "token: " + formatUsage(summary.usageTotal) : "token: Not returned";
  }

  function stepUsageText(step) {
    const usage = stepUsageObject(step);
    if (usage) return "token: " + formatUsage(usage);
    const source = step && (step.usage_source || step.token_source || step.result && (step.result.usage_source || step.result.token_source));
    if (source === "local_dom" || source === "local" || source === "dom") return "token: Local execution";
    return "token: Not returned";
  }

  function stepUsageObject(step) {
    if (!step) return null;
    if (step.usage && typeof step.usage === "object") return step.usage;
    if (step.result && step.result.usage && typeof step.result.usage === "object") return step.result.usage;
    if (step.result && step.result.usage_total && typeof step.result.usage_total === "object") return step.result.usage_total;
    return null;
  }

  function taskElapsedMsForDisplay(task) {
    if (!task) return 0;
    const status = normalizeStepStatus(task.status || "");
    if ((status === "running" || status === "waiting_user") && task.started_at_ms) {
      return Math.max(0, Date.now() - Number(task.started_at_ms));
    }
    if (typeof task.elapsed_ms === "number") return task.elapsed_ms;
    const started = Number(task.started_at_ms || (task.created_at ? task.created_at * 1000 : 0));
    const finished = Number(task.finished_at_ms || (task.finished_at ? task.finished_at * 1000 : 0));
    if (started && finished) return Math.max(0, finished - started);
    if (started && (status === "running" || status === "waiting_user")) return Math.max(0, Date.now() - started);
    return 0;
  }

  function stepElapsedLabel(step, status) {
    const normalized = normalizeStepStatus(status || step && step.status || "pending");
    if (!step || normalized === "pending" || normalized === "skipped") return "--:--";
    if ((normalized === "running" || normalized === "waiting_user") && step.started_at_ms) {
      return formatElapsed(Math.max(0, Date.now() - Number(step.started_at_ms)));
    }
    if (typeof step.elapsed_ms === "number") return formatElapsed(step.elapsed_ms);
    if (step.started_at_ms) return formatElapsed(Math.max(0, Date.now() - Number(step.started_at_ms)));
    return normalized === "running" ? formatElapsed(0) : "--:--";
  }

  function normalizeStepStatus(status) {
    const value = String(status || "pending").toLowerCase();
    if (value === "completed" || value === "complete" || value === "success") return "completed";
    if (value === "running" || value === "in_progress") return "running";
    if (value === "failed" || value === "error") return "failed";
    if (value === "waiting_user" || value === "blocked_no_llm" || value === "blocked") return "waiting_user";
    if (value === "skipped" || value === "cancelled") return "skipped";
    return "pending";
  }

  function taskStatusLabel(status) {
    const stableLabels = {
      completed: "completed",
      running: "running",
      failed: "failed",
      waiting_user: "waiting_user",
      skipped: "skipped",
      pending: "pending"
    };
    return stableLabels[normalizeStepStatus(status)] || "pending";
    const labels = {
      completed: "Completed",
      running: "Executing",
      failed: "Failed",
      waiting_user: "Waiting for user",
      skipped: "Skipped",
      pending: "Pending execution"
    };
    return labels[normalizeStepStatus(status)] || "Pending execution";
  }

  function taskStatusIcon(status) {
    const stableIcons = {
      completed: "✓",
      running: "⏳",
      failed: "✕",
      waiting_user: "?",
      skipped: "-",
      pending: "○"
    };
    return stableIcons[normalizeStepStatus(status)] || "○";
    const icons = {
      completed: "✓",
      running: "…",
      failed: "!",
      waiting_user: "?",
      skipped: "-",
      pending: "○"
    };
    return icons[normalizeStepStatus(status)] || "○";
  }

  function compactResult(result) {
    if (!result || typeof result !== "object") return result || null;
    return {
      success: Boolean(result.success),
      action_type: result.action_type || result.actionType || "",
      page_before: result.page_before || "",
      page_after: result.page_after || "",
      changed_fields: result.changed_fields || [],
      navigation_happened: Boolean(result.navigation_happened),
      observation: result.observation || result.message || "",
      error: result.error || ""
    };
  }

  function extractResolverLogs(logs, kind) {
    const pattern = kind === "field" ? /field|field/ : /patient|Patient|patient-store|match/;
    return sanitizeStepLogs(logs).filter(function (item) {
      return pattern.test(item.message || "");
    });
  }

  function extractValueChange(result) {
    if (!result || typeof result !== "object") return null;
    if (result.oldValue !== undefined || result.newValue !== undefined) {
      return { oldValue: result.oldValue, newValue: result.newValue };
    }
    if (Array.isArray(result.changed_fields) && result.changed_fields.length) {
      return result.changed_fields.map(function (item) {
        return {
          field: item.field || item.name || "",
          oldValue: item.oldValue,
          newValue: item.newValue
        };
      });
    }
    if (Array.isArray(result.changedFields) && result.changedFields.length) {
      return result.changedFields.map(function (item) {
        return {
          field: item.field || item.name || "",
          oldValue: item.oldValue,
          newValue: item.newValue
        };
      });
    }
    return null;
  }

  function extractAuditDetails(result) {
    if (!result || typeof result !== "object") return null;
    if (result.audit) return result.audit;
    if (result.audit_id) return { audit_id: result.audit_id };
    if (Array.isArray(result.auditLog)) return result.auditLog.slice(-5);
    if (Array.isArray(result.changed_fields)) return { changed_fields: result.changed_fields };
    return null;
  }

  function sanitizeProgressMessages(messages) {
    return (Array.isArray(messages) ? messages : []).slice(-10).map(function (item) {
      return {
        at: item.at || "",
        elapsed_ms: item.elapsed_ms || 0,
        text: item.text || "",
        stage: item.details && item.details.stage || "",
        status: item.details && item.details.status || ""
      };
    });
  }

  function sanitizeStepLogs(logs) {
    return (Array.isArray(logs) ? logs : []).slice(-10).map(function (item) {
      return {
        at: item.at || "",
        message: item.message || ""
      };
    });
  }

  function findRelatedProgress(step, messages) {
    const stepId = step && step.id ? String(step.id) : "";
    return (Array.isArray(messages) ? messages : []).filter(function (entry) {
      const related = entry && entry.details && entry.details.step;
      return stepId && related && related.id === stepId;
    }).slice(-5).map(function (entry) {
      return {
        elapsed_ms: entry.elapsed_ms || 0,
        text: entry.text || ""
      };
    });
  }

  function renderTaskHistoryPanel() {
    if (!elements.taskHistory) return;
    const history = window.AgentTaskOrchestrator && window.AgentTaskOrchestrator.getHistory
      ? window.AgentTaskOrchestrator.getHistory()
      : [];
    if (!history.length) {
      elements.taskHistory.innerHTML = '<div class="his-agent-empty-detail">No task history.</div>';
      return;
    }
    elements.taskHistory.innerHTML = history.slice(-8).reverse().map(function (item) {
      const detail = JSON.stringify({
        plan: (item.plan || []).map(function (step, index) {
          return {
            step: index + 1,
            id: step.id || "",
            goal: step.goal || "",
            status: normalizeStepStatus(step.status || "pending"),
            actionType: step.actionType || "",
            elapsed_ms: step.elapsed_ms || null,
            token: stepUsageObject(step) || null,
            result: compactResult(step.result || null),
            error: step.error || ""
          };
        }),
        progressMessages: sanitizeProgressMessages(item.progress_messages || []),
        stepLogs: sanitizeStepLogs(item.step_logs || []),
        usageTotal: item.usage_total || null,
        lastError: item.lastError || ""
      }, null, 2);
      return '<details class="his-agent-task-history-item">' +
        '<summary>' + escapeHtml((item.status || "unknown") + " / " + (item.objective || item.task_id || "")) + '</summary>' +
        '<div class="his-agent-task-history-meta">Elapsed: ' + escapeHtml(formatElapsed(taskElapsedMsForDisplay(item))) + ' / ' +
        escapeHtml(item.usage_total ? "token: " + formatUsage(item.usage_total) : "token: Not returned") + '</div>' +
        '<pre>' + escapeHtml(detail) + '</pre>' +
        '</details>';
    }).join("");
  }

  function renderHistory() {
    if (!runtime.suppressHistoryAutoScroll && runtime.scrollManager && typeof runtime.scrollManager.beforeRender === "function") {
      runtime.scrollManager.beforeRender();
    }
    elements.history.innerHTML = "";
    const visibleHistory = state.history.filter(shouldRenderHistoryItem);
    if (!visibleHistory.length) {
      if (!runtime.suppressHistoryAutoScroll && runtime.scrollManager && typeof runtime.scrollManager.afterRender === "function") {
        runtime.scrollManager.afterRender({ messageCount: 0 });
      }
      return;
    }
    visibleHistory.slice(-30).forEach(function (item) {
      const node = document.createElement("div");
      node.className = "his-agent-message " + (item.type || item.role || "agent") + (item.kind ? " his-agent-message-" + item.kind : "");
      node.dataset.messageId = item.messageId || "";
      if (item.kind === "connection-status") {
        renderConnectionStatusMessage(node, item);
      } else if (item.kind === "voice-task-review") {
        renderVoiceTaskReviewMessage(node, item);
      } else if (item.kind === "clinical-draft-review") {
        renderClinicalDraftReviewMessage(node, item);
      } else {
        node.textContent = roleLabel(item.role) + ": \n" + item.text;
      }
      if (item.details && Object.keys(item.details).length && item.kind !== "connection-status" && item.kind !== "voice-task-review" && item.kind !== "clinical-draft-review") {
        const originalText = node.textContent;
        node.textContent = "";
        node.appendChild(document.createTextNode(originalText));
        const detail = document.createElement("details");
        detail.className = "his-agent-message-detail";
        const summary = document.createElement("summary");
        summary.textContent = "Details";
        const pre = document.createElement("pre");
        pre.textContent = JSON.stringify(item.details, null, 2);
        detail.appendChild(summary);
        detail.appendChild(pre);
        node.appendChild(detail);
      }
      if (Array.isArray(item.actions) && item.actions.length) {
        const actionRow = document.createElement("div");
        actionRow.className = "his-agent-message-actions";
        item.actions.forEach(function (action, actionIndex) {
          const actionButton = document.createElement("button");
          actionButton.type = "button";
          actionButton.className = "his-agent-button " + (action.style === "primary" ? "primary" : "secondary");
          actionButton.dataset.agentAction = action.action || "";
          actionButton.dataset.messageId = action.messageId || item.messageId || "";
          if (action.target) actionButton.dataset.target = action.target;
          if (typeof action.index === "number") actionButton.dataset.exampleIndex = String(action.index);
          actionButton.textContent = action.label || ("Actions " + (actionIndex + 1));
          actionRow.appendChild(actionButton);
        });
        node.appendChild(actionRow);
      }
      elements.history.appendChild(node);
    });
    if (!runtime.suppressHistoryAutoScroll && runtime.scrollManager && typeof runtime.scrollManager.afterRender === "function") {
      runtime.scrollManager.afterRender({
        messageCount: visibleHistory.length,
        important: visibleHistory.some(function (item) {
          return item.kind === "voice-task-review" || String(item.type || "").indexOf("error") >= 0;
        })
      });
    } else if (!runtime.suppressHistoryAutoScroll) {
      elements.history.scrollTop = elements.history.scrollHeight;
    }
  }

  function renderConnectionStatusMessage(node, item) {
    const details = item.details || {};
    const rows = Array.isArray(details.rows) ? details.rows : [];
    const title = document.createElement("div");
    title.className = "his-agent-connection-title";
    title.textContent = item.text || "System Connection Status";
    const hint = document.createElement("div");
    hint.className = "his-agent-connection-hint";
    hint.textContent = details.stage === "checking"
      ? "Checking services; slow LLM checks wait up to 30 seconds and do not block other actions."
      : "The following status comes from current runtime-config and browser capability checks.";
    const grid = document.createElement("div");
    grid.className = "his-agent-connection-topic-grid";
    rows.forEach(function (row) {
      const cell = document.createElement("div");
      cell.className = "his-agent-connection-topic-row " + connectionStatusClass(row.value);
      const label = document.createElement("strong");
      label.textContent = row.label || "";
      const value = document.createElement("span");
      value.textContent = connectionStatusText(row.value);
      cell.appendChild(label);
      cell.appendChild(value);
      grid.appendChild(cell);
    });
    node.appendChild(title);
    node.appendChild(hint);
    node.appendChild(grid);
    if (details.lastError) {
      const error = document.createElement("div");
      error.className = "his-agent-connection-error";
      error.textContent = "Latest error: " + details.lastError;
      node.appendChild(error);
    }
  }

  function renderVoiceTaskReviewMessage(node, item) {
    node.textContent = "";
    const title = document.createElement("div");
    title.className = "his-agent-voice-task-title";
    title.textContent = item.text || "The following task was organized from the visit session. Please confirm or edit before execution:";
    const textarea = document.createElement("textarea");
    textarea.className = "his-agent-voice-task-editor";
    textarea.dataset.voiceTaskEditor = "1";
    textarea.dataset.messageId = item.messageId || "";
    textarea.value = (item.details && item.details.task_text) || "";
    textarea.setAttribute("aria-label", "Editable visit-session Agent task");
    textarea.addEventListener("input", function () {
      if (!item.details || typeof item.details !== "object") {
        item.details = {};
      }
      item.details.task_text = textarea.value;
      if (state.pendingVoicePlan && (!state.pendingVoicePlan.messageId || state.pendingVoicePlan.messageId === item.messageId)) {
        state.pendingVoicePlan.taskText = textarea.value;
      }
      saveState();
    });
    const note = document.createElement("div");
    note.className = "his-agent-voice-task-note";
    note.textContent = "Before confirmation, the page, patient-store, and audit log will not be modified; after execution, it enters the existing Agent taskflow as a normal natural-language task.";
    node.appendChild(title);
    node.appendChild(textarea);
    node.appendChild(note);
  }

  function renderClinicalDraftReviewMessage(node, item) {
    node.textContent = "";
    const details = item.details || {};
    const title = document.createElement("div");
    title.className = "his-agent-voice-task-title";
    title.textContent = item.text || "The following medical-record draft was generated. Please edit and confirm whether to write it:";
    const meta = document.createElement("div");
    meta.className = "his-agent-clinical-draft-meta";
    const patient = [details.patient_id || "", details.patient_name || ""].filter(Boolean).join(" ");
    meta.textContent = [
      patient ? "Patient: " + patient : "",
      details.field_label ? "Write field: " + details.field_label : ""
    ].filter(Boolean).join(" / ");
    const textarea = document.createElement("textarea");
    textarea.className = "his-agent-voice-task-editor his-agent-clinical-draft-editor";
    textarea.dataset.clinicalDraftEditor = "1";
    textarea.dataset.messageId = item.messageId || "";
    textarea.value = details.draft_text || "";
    textarea.setAttribute("aria-label", "Editable medical-record draft");
    textarea.addEventListener("input", function () {
      if (!item.details || typeof item.details !== "object") {
        item.details = {};
      }
      item.details.draft_text = textarea.value;
      saveState();
    });
    const note = document.createElement("div");
    note.className = "his-agent-voice-task-note";
    note.textContent = "Before confirmation, patient-store and audit log will not be modified; after write confirmation, it enters the existing Agent taskflow as a new natural-language task.";
    node.appendChild(title);
    if (meta.textContent) node.appendChild(meta);
    node.appendChild(textarea);
    node.appendChild(note);
  }

  function shouldRenderHistoryItem(item) {
    if (!item) return false;
    const type = String(item.type || "");
    if (!type.includes("progress")) return true;
    return Boolean(item.keepInHistory);
  }

  function renderTurns() {
    elements.turns.innerHTML = "";
    if (!state.speakerTurns.length) {
      const empty = document.createElement("div");
      empty.className = "his-agent-message system";
      empty.textContent = "No Doctor/Patient turns yet. Click Start Voice Task to begin recording, or load an example visit.";
      elements.turns.appendChild(empty);
      renderVoiceSessionSummary();
      renderVoiceDebug();
      return;
    }
    state.speakerTurns.slice(-30).forEach(function (turn) {
      const node = document.createElement("article");
      node.className = "his-agent-turn " + (turn.role || "unknown") + (turn.is_final ? "" : " provisional");
      node.innerHTML = [
        '<div class="his-agent-role-row">',
        '  <span class="his-agent-role-label">' + escapeHtml(turn.role_label || roleLabel(turn.role)) + (turn.is_final ? "" : " interim") + "</span>",
        '  <select aria-label="Manually correct speaker">',
        '    <option value="unknown">Unconfirmed</option>',
        '    <option value="doctor">Doctor</option>',
        '    <option value="patient">Patient</option>',
        "  </select>",
        "</div>",
        '<div class="his-agent-turn-text"></div>',
        '<details class="his-agent-meta-details"><summary>Metadata</summary><div class="his-agent-meta"></div></details>'
      ].join("");
      node.querySelector(".his-agent-turn-text").textContent = turn.text || "";
      node.querySelector(".his-agent-meta").textContent = [
        turn.speaker || "unknown",
        turn.raw_speaker && turn.raw_speaker !== turn.speaker ? "raw:" + turn.raw_speaker : "",
        turn.source || "asr_text_only",
        turn.diarization_source || "",
        turn.is_final ? "final" : "partial",
        turn.automatic_diarization ? "auto" : "Manual Correction"
      ].filter(Boolean).join(" / ");
      const select = node.querySelector("select");
      select.value = turn.role === "patient" || turn.role === "doctor" ? turn.role : "unknown";
      select.addEventListener("change", function () {
        correctTurnRole(turn.turn_id, select.value);
      });
      elements.turns.appendChild(node);
    });
    renderVoiceSessionSummary();
    renderVoiceDebug();
  }

  function addMessage(role, text, type, options) {
    if (!text) {
      return;
    }
    const messageId = options && options.messageId
      ? String(options.messageId)
      : defaultMessageId(role, text, type, options);
    if (messageId && state.history.some(function (item) { return item.messageId === messageId; })) {
      renderHistory();
      return null;
    }
    const item = {
      messageId: messageId,
      role: role || "agent",
      type: type || role || "agent",
      text: String(text),
      at: new Date().toISOString()
    };
    if (options && Array.isArray(options.actions)) {
      item.actions = options.actions.map(function (action) {
        return Object.assign({}, action);
      });
    }
    if (options && options.details && typeof options.details === "object") {
      item.details = options.details;
    }
    if (options && options.kind) {
      item.kind = String(options.kind);
    }
    state.history.push(item);
    state.history = state.history.slice(-80);
    recordFlowTrace("message_append", {
      conversation_state: state.conversationState || "",
      view_state: normalizeViewMode(state.viewMode),
      action_result: {
        messageId: item.messageId,
        role: item.role,
        type: item.type,
        kind: item.kind || ""
      }
    });
    renderHistory();
    saveState();
    return item;
  }

  function defaultMessageId(role, text, type, options) {
    const kind = options && options.kind || "";
    const messageType = String(type || role || "");
    const body = String(text || "").replace(/\s+/g, " ").trim().slice(0, 180);
    if (messageType.indexOf("error") >= 0 || messageType === "system" || kind === "task-conflict") {
      return ["dedupe", role || "agent", messageType, kind, body].join("|");
    }
    return "msg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function updateHistoryItem(item, patch) {
    if (!item || !patch) {
      return;
    }
    Object.assign(item, patch);
    renderHistory();
    saveState();
  }

  function handleTaskProgress(event) {
    const entry = event && event.detail ? event.detail : null;
    if (!entry || !entry.text) return;
    if (!isCurrentTaskProgress(entry)) {
      return;
    }
    recordFlowTrace("task_progress", {
      task_id: entry.task_id || "",
      action_result: {
        text: entry.text,
        elapsed_ms: entry.elapsed_ms || 0,
        details: entry.details || {}
      }
    });
    const holdTaskListScroll = shouldHoldTaskListScroll(entry);
    if (!holdTaskListScroll) renderTaskSummary();
    if (shouldMirrorProgress(entry)) {
      const message = formatProgressEntry(entry);
      const duplicate = state.history.some(function (item) {
        return item.progressKey === progressKey(entry);
      });
      if (!duplicate) {
        state.history.push({
          role: "agent",
          type: "agent progress-summary",
          text: message,
          at: entry.at || new Date().toISOString(),
          task_id: entry.task_id || "",
          progressKey: progressKey(entry),
          keepInHistory: true,
          details: entry.details || {}
        });
        state.history = state.history.slice(-80);
      }
    }
    appendClinicalDraftReviewFromProgress(entry);
    renderHistory();
    if (!holdTaskListScroll) renderTaskSummary();
    saveState();
  }

  function shouldHoldTaskListScroll(entry) {
    const details = elements.currentTaskCard && elements.currentTaskCard.querySelector(".his-agent-current-steps");
    const lock = runtime.currentTaskStepLock || {};
    if (!details || !details.open || !lock.userPinnedStepScroll) return false;
    const step = entry && entry.details && entry.details.step || null;
    if (!step) return true;
    const stepId = String(step.id || step.step_id || "");
    return !stepId || stepId === String(lock.stepId || "");
  }

  function appendClinicalDraftReviewFromProgress(entry) {
    const draft = extractClinicalDraftFromProgress(entry);
    if (!draft || !draft.text) return null;
    const key = clinicalDraftReviewKey(entry, draft);
    const existing = state.history.find(function (item) {
      return item.kind === "clinical-draft-review" && item.draftReviewKey === key;
    });
    if (existing) return existing;
    const message = {
      messageId: "clinical_draft_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
      role: "agent",
      type: "agent",
      kind: "clinical-draft-review",
      text: "The following medical-record draft was generated. Please edit and confirm whether to write it:",
      at: entry.at || new Date().toISOString(),
      task_id: entry.task_id || "",
      draftReviewKey: key,
      details: {
        task_id: entry.task_id || "",
        patient_id: draft.patientId || "",
        patient_name: draft.patientName || "",
        field: draft.field || "note",
        field_label: draft.fieldLabel || "Notes",
        draft_text: draft.text
      },
      actions: [
        { label: "Confirm Write", action: "clinical-draft-confirm", style: "primary" },
        { label: "Cancel", action: "clinical-draft-cancel", style: "secondary" }
      ]
    };
    state.history.push(message);
    state.history = state.history.slice(-80);
    return message;
  }

  function maybeAppendClinicalDraftReviewFromSummary(summary) {
    const draft = extractClinicalDraftFromSummary(summary);
    if (!draft || !draft.text) return null;
    const historyCount = state.history.length;
    const message = appendClinicalDraftReviewFromProgress({
      task_id: summary && (summary.taskId || summary.task_id) || "",
      at: new Date().toISOString(),
      text: "Generated medical-record draft: " + draft.text,
      details: { draft: draft }
    });
    if (message && state.history.length > historyCount) {
      renderHistory();
      saveState();
    }
    return message;
  }

  function extractClinicalDraftFromSummary(summary) {
    if (!summary) return null;
    const slots = summary.slots || {};
    const slotDraft = slots.structured_draft || slots.clinical_draft || null;
    if (slotDraft && (slotDraft.text || slotDraft.draft_text || slotDraft.draftText)) {
      return normalizeClinicalDraftReviewDraft({
        text: slotDraft.text || slotDraft.draft_text || slotDraft.draftText,
        field: slotDraft.field,
        fieldLabel: slotDraft.fieldLabel || slotDraft.field_label,
        patientId: slotDraft.patientId || slotDraft.patient_id,
        patientName: slotDraft.patientName || slotDraft.patient_name
      });
    }
    const plan = Array.isArray(summary.plan) ? summary.plan : [];
    for (let index = plan.length - 1; index >= 0; index -= 1) {
      const step = plan[index] || {};
      const actionType = String(step.actionType || step.action_type || step.type || "");
      const result = step.result || {};
      if (actionType === "create_structured_draft" && result && (result.draft_text || result.draftText || result.text)) {
        return normalizeClinicalDraftReviewDraft({
          text: result.draft_text || result.draftText || result.text,
          field: result.draft_field || result.field,
          fieldLabel: result.fieldLabel || result.field_label,
          patientId: result.patientId || result.patient_id,
          patientName: result.patientName || result.patient_name
        });
      }
    }
    const progress = Array.isArray(summary.progressMessages) ? summary.progressMessages : [];
    for (let index = progress.length - 1; index >= 0; index -= 1) {
      const draft = extractClinicalDraftFromProgress(Object.assign({ task_id: summary.taskId || "" }, progress[index] || {}));
      if (draft && draft.text) return draft;
    }
    return null;
  }

  function normalizeClinicalDraftReviewDraft(draft) {
    const context = currentPatientContext();
    return {
      text: String(draft && draft.text || "").trim(),
      field: draft && draft.field || "note",
      fieldLabel: draft && draft.fieldLabel || "Notes",
      patientId: draft && draft.patientId || context.patientId || "",
      patientName: draft && draft.patientName || context.patientName || ""
    };
  }

  function extractClinicalDraftFromProgress(entry) {
    const details = entry && entry.details || {};
    const draft = details.draft || {};
    const actionResult = details.actionResult || details.action_result || {};
    const actionResultDraft = actionResult.draft || {};
    const actionDetails = details.action || {};
    const stepDetails = details.step || {};
    const actionType = String(
      actionDetails.type ||
      actionDetails.actionType ||
      actionDetails.action_type ||
      actionResult.action_type ||
      actionResult.actionType ||
      stepDetails.actionType ||
      stepDetails.action_type ||
      ""
    );
    if (actionType && actionType !== "create_structured_draft") {
      return null;
    }
    const progressText = String(entry && entry.text || "");
    const textFromProgress = /^Generated medical-record draft[:: ]/.test(progressText)
      ? progressText.replace(/^Generated medical-record draft[:: ]\s*/, "").trim()
      : "";
    const text = draft.text ||
      actionResultDraft.text ||
      details.draft_text ||
      details.draftText ||
      actionResult.draft_text ||
      actionResult.draftText ||
      actionResult.text ||
      textFromProgress ||
      "";
    if (!text) return null;
    const context = currentPatientContext();
    return {
      text: String(text).trim(),
      field: draft.field || actionResultDraft.field || details.draft_field || actionResult.draft_field || details.field || actionResult.field || "note",
      fieldLabel: draft.fieldLabel || actionResultDraft.fieldLabel || details.fieldLabel || details.field_label || actionResult.fieldLabel || actionResult.field_label || "Notes",
      patientId: draft.patientId || actionResultDraft.patientId || details.patientId || details.patient_id || actionResult.patientId || actionResult.patient_id || context.patientId || "",
      patientName: draft.patientName || actionResultDraft.patientName || details.patientName || details.patient_name || actionResult.patientName || actionResult.patient_name || context.patientName || ""
    };
  }

  function clinicalDraftReviewKey(entry, draft) {
    return [
      entry && entry.task_id || "",
      draft.patientId || "",
      draft.field || "",
      String(draft.text || "").replace(/\s+/g, " ").trim().slice(0, 160)
    ].join("|");
  }

  function formatProgressEntry(entry) {
    return formatElapsed(entry.elapsed_ms || 0) + " " + String(entry.text || "");
  }

  function shouldMirrorProgress(entry) {
    const text = String(entry && entry.text || "");
    return /Step \d+\/\d+|task completed|task failed|task ended|Waiting for user|login prerequisite|already due to LLM|LLM connection|Timeout|Cancel|Generated medical-record draft|writing medical-record field/.test(text);
  }

  function progressKey(entry) {
    return [entry.task_id || "", Math.round(Number(entry.elapsed_ms || 0)), entry.text || ""].join("|");
  }

  function findHistoryItemByMessageId(messageId) {
    const id = String(messageId || "");
    if (!id) return null;
    return state.history.find(function (item) {
      return item && item.messageId === id;
    }) || null;
  }

  async function confirmClinicalDraftWrite(messageId) {
    const item = findHistoryItemByMessageId(messageId);
    if (!item || item.kind !== "clinical-draft-review") {
      setStatus("No medical-record draft pending confirmation was found.", true);
      return;
    }
    const editor = elements.history.querySelector("[data-clinical-draft-editor='1'][data-message-id='" + cssEscape(messageId) + "']");
    const details = item.details || {};
    const draftText = String(editor ? editor.value : details.draft_text || "").trim();
    if (!draftText) {
      setStatus("Medical-record draft is empty; nothing was written.", true);
      return;
    }
    const patientId = String(details.patient_id || currentPatientContext().patientId || "").trim();
    const patientName = String(details.patient_name || currentPatientContext().patientName || "").trim();
    const fieldLabel = String(details.field_label || "Notes").trim();
    const patientText = patientId ? ("Patient " + patientId + (patientName ? " " + patientName : "")) : "current patient";
    const command = "Please update " + patientText + "'s " + fieldLabel + " field to the following medical-record draft. Do not modify other fields:\n" + draftText;
    updateHistoryItem(item, {
      text: "Medical-record draft write confirmed; handing it to the Agent taskflow for execution.",
      kind: "",
      actions: [],
      details: Object.assign({}, details, { draft_text: draftText, confirmed_at: new Date().toISOString() })
    });
    addMessage("user", "Confirm medical-record draft write: " + compactText(draftText, 120), "user");
    await handleCommand(command, "clinical_draft_confirm");
  }

  function cancelClinicalDraftWrite(messageId) {
    const item = findHistoryItemByMessageId(messageId);
    if (!item || item.kind !== "clinical-draft-review") {
      setStatus("No medical-record draft pending cancellation was found.", true);
      return;
    }
    updateHistoryItem(item, {
      text: "Medical-record draft write cancelled; patient-store and audit log were not modified.",
      kind: "",
      actions: []
    });
    setStatus("Medical-record draft write cancelled; patient data was not modified.");
  }

  function receiveLegacyMessage(role, message, type) {
    if (role === "user" && runtime.suppressLegacyUserText && String(message || "").trim() === runtime.suppressLegacyUserText) {
      runtime.suppressLegacyUserText = "";
      return;
    }
    addMessage(role, message, type || role);
  }

  function roleLabel(role) {
    if (role === "user") {
      return "User";
    }
    if (role === "doctor") {
      return "Doctor";
    }
    if (role === "patient") {
      return "Patient";
    }
    if (role === "unknown") {
      return "Unconfirmed";
    }
    if (role === "system") {
      return "System";
    }
    return "Agent";
  }

  function routeCurrentInput(text, inputType) {
    const activeTask = window.AgentTaskOrchestrator && window.AgentTaskOrchestrator.getSummary
      ? window.AgentTaskOrchestrator.getSummary()
      : null;
    if (!window.AgentInputRouter || typeof window.AgentInputRouter.routeInput !== "function") {
      return {
        route: "start_new_task",
        confidence: 0.5,
        reason_code: "router_unavailable",
        input: {
          text: String(text || ""),
          input_type: inputType || "text_task",
          source_view: normalizeViewMode(state.viewMode),
          conversation_state: state.conversationState || "idle"
        }
      };
    }
    const route = window.AgentInputRouter.routeInput({
      input_type: inputType || "text_task",
      text: text,
      source_view: normalizeViewMode(state.viewMode),
      active_task_id: activeTask && activeTask.taskId,
      conversation_state: state.conversationState || "idle"
    }, {
      activeTask: activeTask && activeTask.hasActiveTask ? {
        task_id: activeTask.taskId,
        status: activeTask.status,
        waitingFor: activeTask.waitingFor || null
      } : null
    });
    runtime.lastRoute = {
      route: route.route,
      confidence: route.confidence,
      reason_code: route.reason_code,
      input_type: route.input && route.input.input_type,
      source_view: route.input && route.input.source_view
    };
    updateDebugState({ lastRoute: runtime.lastRoute });
    recordFlowTrace("input_routed", {
      route: route.route,
      conversation_state: state.conversationState || "",
      view_state: normalizeViewMode(state.viewMode),
      action_payload: {
        input_type: inputType || "text_task",
        reason_code: route.reason_code || "",
        active_task_id: activeTask && activeTask.taskId || ""
      }
    });
    return route;
  }

  function isCancelTaskCommand(text) {
    const value = String(text || "").replace(/\s+/g, "");
    if (!value) return false;
    const activeTask = window.AgentTaskOrchestrator && window.AgentTaskOrchestrator.getSummary
      ? window.AgentTaskOrchestrator.getSummary()
      : null;
    if (!activeTask || !activeTask.hasActiveTask) {
      return false;
    }
    return /(Cancel|stop|terminate|never mind|no need|do not execute|abandon|do not modify for now|do not modify|I sent the wrong task)/.test(value);
  }

  async function sendCurrentInput() {
    const command = (elements.input.value || "").trim();
    if (!command) {
      setStatus("Enter a task before sending.", true);
      return;
    }
    const route = routeCurrentInput(command, "text_task");
    if (runtime.recording) {
      await stopActiveVoice("send");
    }
    setActiveTab("agent");
    enterChatView();
    addMessage("user", command, "user");
    recordFlowTrace("user_send", {
      route: route.route,
      view_state: "chat",
      action_payload: { input_type: "text_task" }
    });
    if (route.route === "cancel_active_task" || isCancelTaskCommand(command)) {
      elements.input.value = "";
      syncInputHeight();
      clearInputDraft();
      cancelTask(command);
      return;
    }
    if (route.route === "ask_disambiguation") {
      runtime.pendingConflictingInput = command;
      addMessage("agent", "A task is already running or waiting for additional input. Confirm whether to continue the current task or cancel it and start a new one.", "agent", {
        kind: "task-conflict",
        actions: [
          { label: "Continue Current Task", action: "continue-active", style: "primary" },
          { label: "Cancel Old Task and Start New", action: "cancel-and-start-new", style: "secondary" }
        ],
        details: { route: runtime.lastRoute }
      });
      setStatus("Waiting for you to confirm how to handle the current input.");
      transitionConversation("waiting_user", "input_route_conflict");
      return;
    }
    elements.input.value = "";
    syncInputHeight();
    clearInputDraft();
    await handleCommand(command, "text");
  }

  async function handleCommand(command, source, options) {
    const settings = options || {};
    const route = routeCurrentInput(command, source === "voice_confirmed_task" ? "voice_session_task" : "text_task");
    if (settings.taskContract) {
      route.task_contract = settings.taskContract;
    }
    const runId = makeRunId("task");
    runtime.activeRunId = runId;
    showPlanningTask(command, runId);
    transitionConversation("planning", "task_planning");
    addMessage("agent", [
      "Agent: I'm starting the task.",
      "Timer: 00:00",
      "Token usage: waiting for backend token usage"
    ].join("\n"), "agent");
    setStatus("Planning task...");
    if (runtime.activeRunId !== runId) {
      return { accepted: false, message: "Task was cancelled or replaced." };
    }
    if (!window.AgentTaskOrchestrator || !window.AgentTaskOrchestrator.startTask) {
      const message = "Agent orchestrator is not loaded; task was not executed.";
      addMessage("system", message, "error");
      setStatus(message, true);
      elements.panel.classList.remove("has-active-task", "is-planning-task");
      runtime.planningTask = null;
      runtime.activeRunId = "";
      transitionConversation("failed", "orchestrator_missing");
      renderTaskSummary();
      return { accepted: false, success: false, message: message };
    }
    const taskStartedAtMs = Date.now();
    const taskResult = await window.AgentTaskOrchestrator.startTask(command, {
      backendUrl: (state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, ""),
      agentMessages: state.history.slice(-12),
      speakerTurns: state.speakerTurns.slice(-30),
      pageState: collectPageState(),
      connectionStatus: getConnectionStatus(),
      source: source || "text",
      inputRoute: route,
      taskContract: settings.taskContract || null,
      taskStartedAtMs: taskStartedAtMs,
      runId: runId
    });
    if (runtime.activeRunId !== runId) {
      return { accepted: false, message: "Task was cancelled or replaced." };
    }
    runtime.planningTask = null;
    recordFlowTrace("task_result_received", {
      route: runtime.lastRoute && runtime.lastRoute.route || "",
      action_result: taskResult || {}
    });
    if (taskResult && taskResult.llmStatus) {
      state.llmStatus = taskResult.llmStatus;
      state.agentMode = taskResult.agentMode || (taskResult.llmStatus === "connected" ? "llm_enabled" : "blocked_no_llm");
    }
    const message = taskResult && taskResult.message ? taskResult.message : "Task was not executed.";
    addMessage(taskResult && taskResult.success ? "agent" : "system", message, taskResult && taskResult.success ? "agent" : "error");
    setStatus(message, !(taskResult && taskResult.success));
    syncConversationStateFromTask(taskResult);
    renderServiceStatus();
    renderTaskSummary();
    const currentSummary = window.AgentTaskOrchestrator && window.AgentTaskOrchestrator.getSummary
      ? window.AgentTaskOrchestrator.getSummary()
      : null;
    if (!currentSummary || !currentSummary.hasActiveTask) {
      runtime.activeRunId = "";
    }
    saveState();
    return Object.assign({ accepted: true }, taskResult || {});
  }

  function syncConversationStateFromTask(taskResult) {
    const summary = window.AgentTaskOrchestrator && window.AgentTaskOrchestrator.getSummary
      ? window.AgentTaskOrchestrator.getSummary()
      : null;
    if (summary && summary.hasActiveTask) {
      if (summary.status === "waiting_user") {
        transitionConversation("waiting_user", "task_waiting_user", { task_id: summary.taskId });
      } else if (summary.status === "running" || summary.status === "planning") {
        transitionConversation("task_running", "task_running", { task_id: summary.taskId });
      }
      return;
    }
    if (taskResult && taskResult.success) {
      transitionConversation("completed", "task_completed");
    } else {
      transitionConversation("failed", "task_failed");
    }
  }

  function showPlanningTask(command, runId) {
    runtime.hiddenRecentTaskId = "";
    resetTaskPanelUiState();
    runtime.planningTask = {
      runId: runId || makeRunId("task"),
      objective: command || "LLM Task",
      startedAtMs: Date.now()
    };
    enterChatView({ planning: true, event: "show_planning_task" });
    elements.panel.classList.add("has-active-task", "is-planning-task", "conversation-mode");
    elements.panel.classList.remove("topic-response-mode");
    elements.currentTaskCard.hidden = false;
    elements.currentTaskCard.classList.remove("recent");
    updatePrimaryTaskButton({ hasActiveTask: true, status: "planning" });
    renderPlanningTaskCard(runtime.planningTask);
    updateTaskPlanHeaderButton({
      hasActiveTask: true,
      status: "planning",
      taskId: runtime.planningTask.runId,
      objective: runtime.planningTask.objective
    });
  }

  function renderPlanningTaskCard(planningTask) {
    const task = planningTask || {};
    elements.currentTaskCard.innerHTML = [
      '<div class="his-agent-current-title">Current Task</div>',
      '<div class="his-agent-current-main">' + escapeHtml(task.objective || "LLM Task") + '</div>',
      '<div class="his-agent-current-meta">',
      '  <span>Status: planning</span>',
      '  <span>Progress: 0/0</span>',
      '  <span class="his-agent-current-elapsed">Elapsed: ' + escapeHtml(formatElapsed(Math.max(0, Date.now() - Number(task.startedAtMs || Date.now())))) + '</span>',
      '  <span>token: Not returned</span>',
      "</div>",
      '<div class="his-agent-current-narration">Agent: I am understanding this task and requesting a structured plan from the backend LLM.</div>',
      '<div class="his-agent-current-step">Connecting to LLM and generating task plan...</div>',
      '<div class="his-agent-task-list"><div class="his-agent-empty-detail">Waiting for the LLM to return structured task steps.</div></div>',
      '<div class="his-agent-current-actions">',
      '  <button type="button" class="his-agent-button secondary" data-agent-action="history">View Full Records</button>',
      '  <button type="button" class="his-agent-button danger" data-agent-action="cancel-task">Cancel Task</button>',
      "</div>"
    ].join("");
  }

  async function startVoiceTask() {
    if (runtime.recording && runtime.voiceMode === "session") {
      setStatus("A Visit Session voice task is already running.");
      return;
    }
    if (runtime.recording && runtime.voiceMode === "dictation") {
      await stopActiveVoice("switch_to_visit_recording");
    }
    await startSessionVoice();
  }

  async function stopVoiceTask() {
    if (runtime.recording && runtime.voiceMode === "session") {
      await stopActiveVoice("stop_session");
      setStatus(state.voiceSessionEnded ? "Voice task stopped. Click End Conversation and Organize Task to generate an Agent task for confirmation." : "Voice task stopped.");
      return;
    }
    setStatus("No visit-session voice task is currently running.");
  }

  async function endVoiceConversationAndDraftTask() {
    if (runtime.recording) {
      await stopActiveVoice("draft_voice_task");
    }
    await runFinalSemanticRoleMapping("end_voice_conversation");
    freezeVoiceTurnsForReview();
    state.voiceSessionEnded = Boolean(state.speakerTurns.length);
    const finalTurns = finalSpeakerTurns();
    if (!finalTurns.length) {
      setStatus("No final Doctor/Patient turns are available, so a task cannot be organized.", true);
      return;
    }
    setActiveTab("agent");
    enterChatView({ event: "voice_review_to_chat" });
    transitionConversation("voice_review", "draft_voice_task_requested");
    const pendingMessage = addMessage("agent", "Organizing a pending Agent task from Doctor/Patient dialogue...", "agent");
    runtime.voicePlanMessage = pendingMessage;
    const llm = await refreshLlmStatus();
    if (!llm.connected) {
      updateHistoryItem(pendingMessage, {
        role: "system",
        type: "error",
        text: "LLM is disconnected, so the visit-session task cannot be organized.",
        actions: []
      });
      setStatus("LLM is disconnected; cannot organize task.", true);
      return;
    }
    const result = await requestVoiceTurnsToAgentTask(finalTurns);
    if (!result || !result.ok || !result.task_text) {
      updateHistoryItem(pendingMessage, {
        role: "system",
        type: "error",
        text: result && (result.message || result.error) ? (result.message || result.error) : "LLM did not return confirmable task text.",
        actions: []
      });
      setStatus(result && (result.message || result.error) ? (result.message || result.error) : "Task organization failed.", true);
      return;
    }
    const taskText = String(result.task_text || "").trim();
    const resultType = normalizeVoiceTaskResultType(result.result_type, taskText);
    if (resultType === "no_action" || resultType === "needs_clarification" || isNoActionVoiceTask(taskText)) {
      const noActionText = resultType === "needs_clarification" && taskText
        ? taskText
        : "No clear page actions were found. You can generate a medical-record draft or add more description.";
      updateHistoryItem(pendingMessage, {
        role: "agent",
        type: "agent",
        text: noActionText,
        details: {
          usage: result.usage || null,
          result_type: resultType,
          reason_summary: result.reason_summary || "",
          source: "backend_llm_voice_task_text",
          direct_execution: false
        },
        actions: []
      });
      state.pendingVoicePlan = null;
      transitionConversation("voice_review", "voice_task_no_action");
      setStatus("No clear page actions found; no task was executed.", true);
      saveState();
      return;
    }
    state.pendingVoicePlan = {
      messageId: pendingMessage && pendingMessage.messageId || "",
      taskText: taskText,
      resultType: resultType,
      proposedFields: Array.isArray(result.proposed_fields) ? result.proposed_fields : [],
      expectedMutations: Array.isArray(result.expected_mutations) ? result.expected_mutations : [],
      taskContract: result.task_contract || null,
      plannedAt: new Date().toISOString()
    };
    updateHistoryItem(pendingMessage, {
      role: "agent",
      type: "agent",
      kind: "voice-task-review",
      text: "The following task was organized from the visit session. Please confirm or edit before execution:",
      details: {
        task_text: taskText,
        result_type: resultType,
        proposed_fields: Array.isArray(result.proposed_fields) ? result.proposed_fields : [],
        expected_mutations: Array.isArray(result.expected_mutations) ? result.expected_mutations : [],
        task_contract: result.task_contract || null,
        reason_summary: result.reason_summary || "",
        usage: result.usage || null,
        source: "backend_llm_voice_task_text",
        direct_execution: false
      },
      actions: [
        { label: "Execute Task", action: "voice-task-execute", style: "primary" },
        { label: "Cancel", action: "voice-task-cancel", style: "secondary" }
      ]
    });
    transitionConversation("voice_task_draft_ready", "voice_task_draft_ready");
    setStatus("The LLM organized a pending task. Doctor should confirm or edit before execution.");
    saveState();
  }

  function normalizeVoiceTaskResultType(type, taskText) {
    const value = String(type || "").trim().toLowerCase();
    if (value === "explicit_action" || value === "clinical_draft" || value === "needs_clarification" || value === "no_action") {
      return value;
    }
    return isNoActionVoiceTask(taskText) ? "no_action" : "explicit_action";
  }

  function isCurrentTaskProgress(entry) {
    const entryTaskId = String(entry && entry.task_id || "");
    const entryRunId = String(entry && (entry.run_id || (entry.details && entry.details.run_id)) || "");
    if (entryRunId && runtime.activeRunId && entryRunId !== runtime.activeRunId) {
      return false;
    }
    const summary = window.AgentTaskOrchestrator && window.AgentTaskOrchestrator.getSummary
      ? window.AgentTaskOrchestrator.getSummary()
      : null;
    if (summary && summary.hasActiveTask) {
      return !entryTaskId || entryTaskId === String(summary.taskId || "");
    }
    if (runtime.planningTask) {
      return !entryRunId || entryRunId === runtime.planningTask.runId;
    }
    return !entryTaskId || entryTaskId !== runtime.hiddenRecentTaskId;
  }

  async function requestVoiceTurnsToAgentTask(finalTurns) {
    const patientContext = currentPatientContext();
    const endpoint = (state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, "") + "/api/voice/turns-to-agent-task";
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        patient_context: patientContext,
        current_page_type: getPageType(),
        current_patient_id: patientContext.patientId || "",
        turns: finalTurns
      })
    }, 45000);
    return response.json().catch(function () {
      return { ok: false, message: "Backend did not return valid JSON." };
    });
  }

  function renderExamplesView() {
    if (!elements.examplesList) {
      return;
    }
    const titles = ["Change Phone", "Change Gender", "Change Department", "Change Chief Complaint", "Change Birthday After Login"];
    elements.examplesList.innerHTML = EXAMPLE_TASKS.map(function (task, index) {
      return [
        '<button type="button" class="his-agent-example-card" data-example-task="' + index + '">',
        '  <strong>' + escapeHtml(titles[index] || ("Example " + (index + 1))) + '</strong>',
        '  <span>' + escapeHtml(task) + '</span>',
        "</button>"
      ].join("");
    }).join("");
  }

  function isNoActionVoiceTask(text) {
    return /^No clear page actions requiring execution were found/.test(String(text || "").trim());
  }

  function voiceTaskEditorForMessage(messageId, button) {
    const buttonNode = button && button.closest ? button.closest(".his-agent-message") : null;
    const buttonEditor = buttonNode ? buttonNode.querySelector("[data-voice-task-editor='1']") : null;
    if (buttonEditor) return buttonEditor;
    const id = String(messageId || "");
    if (id) {
      const exact = elements.history.querySelector("[data-voice-task-editor='1'][data-message-id='" + cssEscape(id) + "']");
      if (exact) return exact;
    }
    const editors = Array.from(elements.history.querySelectorAll("[data-voice-task-editor='1']"));
    return editors.length ? editors[editors.length - 1] : null;
  }

  function cancelPendingVoiceTask(messageId) {
    const id = String(messageId || "");
    const item = findHistoryItemByMessageId(id) || runtime.voicePlanMessage;
    if (state.pendingVoicePlan && (!state.pendingVoicePlan.messageId || !id || state.pendingVoicePlan.messageId === id)) {
      state.pendingVoicePlan = null;
    }
    if (item) {
      updateHistoryItem(item, {
        text: "Current visit-session organization cancelled. Original turns are kept and can be edited or reorganized.",
        kind: "",
        actions: []
      });
    }
    saveState();
  }

  async function executePendingVoiceTask(messageId, button) {
    const pending = state.pendingVoicePlan;
    if (!pending) {
      setStatus("No voice-organized task pending execution.", true);
      return;
    }
    const id = String(messageId || "");
    if (pending.messageId && id && pending.messageId !== id) {
      setStatus("This is not the current visit-session task pending execution. Use the latest confirmation box.", true);
      return;
    }
    const editor = voiceTaskEditorForMessage(id || pending.messageId || "", button);
    const taskText = (editor ? editor.value : pending.taskText || "").trim();
    if (!taskText || isNoActionVoiceTask(taskText)) {
      setStatus("Task text is empty or has no clear page actions; nothing was executed.", true);
      return;
    }
    addMessage("user", taskText, "user");
    transitionConversation("confirm_execute", "voice_task_execute_confirmed");
    const reviewItem = findHistoryItemByMessageId(id || pending.messageId || "") || runtime.voicePlanMessage;
    if (reviewItem) {
      updateHistoryItem(reviewItem, {
        actions: [],
        details: Object.assign({}, reviewItem.details || {}, { task_text: taskText, confirmed_at: new Date().toISOString() })
      });
    }
    state.pendingVoicePlan = null;
    saveState();
    await handleCommand(taskText, "voice_confirmed_task", {
      taskContract: pending.taskContract || {
        expected_mutations: pending.expectedMutations || [],
        requires_save: true,
        requires_verification: true,
        source: "voice_turns_to_agent_task"
      }
    });
  }

  async function checkMicrophonePermission() {
    if (!window.HisVoiceInputController || !window.HisVoiceInputController.checkMicrophonePermission) {
      setStatus("Shared Voice Input module is not loaded; cannot check microphone permission.", true);
      return;
    }
    setActiveTab("voice");
    setStatus("Checking current browser microphone permission...");
    const voice = await window.HisVoiceInputController.checkMicrophonePermission({
      asrUrl: state.asrUrl || DEFAULT_STATE.asrUrl,
      diarizationUrl: state.diarizationUrl || DEFAULT_STATE.diarizationUrl,
      llmStatus: state.llmStatus
    });
    syncVoiceState(voice);
    renderServiceStatus();
    setStatus(voice.message || "Microphone permission check completed.", isMicrophoneProblem(voice.microphoneStatus));
    addMessage("system", "Microphone diagnostics completed. View full diagnostics in ASR Developer Details or run window.__HIS_AGENT_VOICE_DEBUG__.dump() in the console.", "system");
  }

  function toggleMicrophonePolicy() {
    if (!window.HisVoiceInputController || !window.HisVoiceInputController.setMicrophonePolicy) {
      setStatus("Shared Voice Input module is not loaded; cannot switch microphone policy.", true);
      return;
    }
    const current = getMicrophonePolicy();
    const next = current === "force_probe" ? "auto" : "force_probe";
    const voice = window.HisVoiceInputController.setMicrophonePolicy(next);
    syncVoiceState(voice);
    renderServiceStatus();
    setStatus(voice.message || "Microphone policy updated.");
  }

  function getMicrophonePolicy() {
    const voice = window.HisVoiceInputController && window.HisVoiceInputController.getState
      ? window.HisVoiceInputController.getState()
      : {};
    return voice.microphonePolicy || "auto";
  }

  function syncVoiceState(voice) {
    if (!voice) return;
    runtime.recording = Boolean(voice.recording);
    state.asrStatus = voice.asrStatus || state.asrStatus;
    state.asrWebSocketStatus = voice.asrWebSocketStatus || state.asrWebSocketStatus || "idle";
    state.microphoneStatus = normalizeLiveMicrophoneStatus(voice) || state.microphoneStatus;
    const incomingDiarizationStatus = voice.diarizationStatus || "";
    const keepExplicitActivation = incomingDiarizationStatus === "not_activated" &&
      (state.diarizationStatus === "connected" || state.diarizationStatus === "starting");
    if (!keepExplicitActivation) {
      state.diarizationStatus = incomingDiarizationStatus || state.diarizationStatus || "not_activated";
      state.diarizationProvider = voice.diarizationProvider || state.diarizationProvider || "disabled";
    }
    state.diarizationWebSocketStatus = voice.diarizationWebSocketStatus || state.diarizationWebSocketStatus || "idle";
    runtime.lastAsrEvent = Object.assign({}, runtime.lastAsrEvent || {}, {
      voiceDiagnostic: {
        microphoneStatus: voice.microphoneStatus || "",
        permissionState: voice.permissionState || "",
        asrWebSocketStatus: voice.asrWebSocketStatus || "",
        diarizationStatus: voice.diarizationStatus || "",
        diarizationProvider: voice.diarizationProvider || "",
        diarizationWebSocketStatus: voice.diarizationWebSocketStatus || "",
        diarizationLastError: voice.diarizationLastError || "",
        didCallGetUserMedia: Boolean(voice.didCallGetUserMedia),
        getUserMediaCalledAt: voice.getUserMediaCalledAt || "",
        audioContextState: voice.audioContextState || "",
        streamTrackCount: voice.streamTrackCount === undefined ? 0 : voice.streamTrackCount,
        lastVoiceErrorName: voice.lastVoiceErrorName || "",
        lastVoiceErrorMessage: voice.lastVoiceErrorMessage || "",
        lastCheckedAt: voice.lastCheckedAt || ""
      },
      timestamp: new Date().toISOString()
    });
    if (elements.forceProbeButton) {
      elements.forceProbeButton.textContent = getMicrophonePolicy() === "force_probe" ? "Restore auto policy" : "Enable force_probe";
    }
  }

  function isMicrophoneProblem(status) {
    return ["unavailable_api", "insecure_context", "permission_denied", "not_found", "device_busy", "get_user_media_error"].includes(String(status || ""));
  }

  function fillMockTurns() {
    const now = Date.now();
    state.speakerTurns = [
      {
        turn_id: "example_patient_identity_" + now,
        raw_speaker: "speaker_1",
        speaker: "speaker_1",
        role: "patient",
        role_label: "Patient",
        text: "I am Zhang Wei, 45 years old. I have had a cough for two days and a mild fever.",
        is_final: true,
        source: "example_visit",
        role_source: "example_visit",
        automatic: false,
        automatic_diarization: false
      },
      {
        turn_id: "example_doctor_confirm_" + now,
        raw_speaker: "speaker_0",
        speaker: "speaker_0",
        role: "doctor",
        role_label: "Doctor",
        text: "Let me confirm: you are P001 Zhang Wei, correct? Is there sputum with the cough?",
        is_final: true,
        source: "example_visit",
        role_source: "example_visit",
        automatic: false,
        automatic_diarization: false
      },
      {
        turn_id: "example_patient_detail_" + now,
        raw_speaker: "speaker_1",
        speaker: "speaker_1",
        role: "patient",
        role_label: "Patient",
        text: "Yes, I am P001 Zhang Wei. There is a small amount of white sputum, not much, and the cough is worse at night.",
        is_final: true,
        source: "example_visit",
        role_source: "example_visit",
        automatic: false,
        automatic_diarization: false
      },
      {
        turn_id: "example_doctor_instruction_" + now,
        raw_speaker: "speaker_0",
        speaker: "speaker_0",
        role: "doctor",
        role_label: "Doctor",
        text: "I will record this first: cough for two days with low-grade fever, worse at night, small amount of white sputum.",
        is_final: true,
        source: "example_visit",
        role_source: "example_visit",
        automatic: false,
        automatic_diarization: false
      }
    ];
    state.voiceSessionEnded = true;
    state.voiceTurnsFrozen = false;
    state.voiceSemanticMapping = {
      mapping: { speaker_0: "doctor", speaker_1: "patient" },
      source: "example_visit",
      mappedAt: new Date().toISOString(),
      confidence: 1,
      reason_summary: "The example visit uses preset Doctor/Patient roles."
    };
    state.voiceSemanticSuggestions = [];
    runtime.semanticRoleMapping.frozen = false;
    runtime.semanticRoleMapping.stopped = true;
    runtime.lastAsrEvent = { type: "example_visit", source: "example_visit", timestamp: new Date().toISOString() };
    renderTurns();
    saveState();
    setVoiceActionAvailability();
    setStatus("Example visit loaded. It will not be sent to the Agent automatically and will not execute page actions.");
  }

  function swapTurnRoles() {
    if (!state.speakerTurns.length) {
      setStatus("No turns are available to swap.", true);
      return;
    }
    markSemanticRoleManualEdit();
    state.speakerTurns = state.speakerTurns.map(function (turn) {
      if (turn.role !== "doctor" && turn.role !== "patient") {
        return Object.assign({}, turn, { role_source: "manual_swapped" });
      }
      const nextRole = turn.role === "patient" ? "doctor" : "patient";
      return Object.assign({}, turn, {
        role: nextRole,
        role_label: nextRole === "patient" ? "Patient" : "Doctor",
        role_source: "manual_swapped"
      });
    });
    renderTurns();
    saveState();
    setVoiceActionAvailability();
    setStatus("Doctor/Patient roles swapped.");
  }

  function clearVoiceTurns() {
    state.speakerTurns = [];
    state.voiceSessionEnded = false;
    state.voiceTurnsFrozen = false;
    state.voiceSemanticMapping = null;
    state.voiceSemanticSuggestions = [];
    state.pendingVoicePlan = null;
    runtime.semanticRoleMapping.initialized = false;
    runtime.semanticRoleMapping.inFlight = false;
    runtime.semanticRoleMapping.lastMappedAt = 0;
    runtime.semanticRoleMapping.lastMappedFinalTurnCount = 0;
    runtime.semanticRoleMapping.stopped = true;
    runtime.semanticRoleMapping.frozen = false;
    runtime.semanticRoleMapping.lastResult = null;
    runtime.semanticRoleMapping.firstRoundTriggered = false;
    runtime.lastAsrEvent = null;
    elements.voiceDraft.innerHTML = "";
    renderTurns();
    setVoiceActionAvailability();
    saveState();
    setStatus("Current voice record cleared.");
  }

  function normalizeLiveMicrophoneStatus(voice) {
    const status = voice.microphoneStatus || voice.permissionState || voice.microphonePermission || "";
    const trackCount = Number(voice.streamTrackCount || 0);
    if (status === "recording" && (!voice.recording || trackCount <= 0)) {
      return voice.microphonePermission === "granted" || voice.permissionState === "granted" ? "permission_granted" : "unknown";
    }
    return status;
  }

  function fillVoiceTurnsIntoInput() {
    const text = turnsToText().trim();
    if (!text) {
      setStatus("No Doctor/Patient turns are available to fill into the input box.", true);
      return;
    }
    elements.input.value = text;
    syncInputHeight();
    saveInputDraft(text, "voice_turns");
    setStatus("Doctor/Patient turns filled into the input box. They will not be sent automatically and will not execute page actions.");
  }

  function turnsToText() {
    return state.speakerTurns.map(function (turn) {
      return (turn.role_label || roleLabel(turn.role)) + ": " + (turn.text || "");
    }).join("\n");
  }

  function finalSpeakerTurns() {
    return state.speakerTurns.filter(isFinalTextTurn).slice(-30).map(function (turn) {
      const role = turn.role === "patient" ? "patient" : "doctor";
      return {
        role: role,
        role_label: roleLabel(role),
        text: compactText(turn.text || "", 500),
        is_final: true
      };
    });
  }

  function finalVoiceTurnsRaw() {
    return state.speakerTurns.filter(isFinalTextTurn).slice(-40);
  }

  function initializeSemanticRoleMapping() {
    const currentMapping = currentSpeakerRoleMapping();
    state.voiceTurnsFrozen = false;
    state.voiceSemanticMapping = {
      mapping: currentMapping,
      source: state.voiceSemanticMapping && state.voiceSemanticMapping.source || "default_mapping",
      mappedAt: state.voiceSemanticMapping && state.voiceSemanticMapping.mappedAt || "",
      confidence: state.voiceSemanticMapping && state.voiceSemanticMapping.confidence || 0,
      reason_summary: state.voiceSemanticMapping && state.voiceSemanticMapping.reason_summary || ""
    };
    runtime.semanticRoleMapping.initialized = true;
    runtime.semanticRoleMapping.inFlight = false;
    runtime.semanticRoleMapping.lastMappedAt = 0;
    runtime.semanticRoleMapping.lastMappedFinalTurnCount = 0;
    runtime.semanticRoleMapping.stopped = false;
    runtime.semanticRoleMapping.frozen = false;
    runtime.semanticRoleMapping.lastReason = "";
    runtime.semanticRoleMapping.lastError = "";
    runtime.semanticRoleMapping.lastResult = null;
    runtime.semanticRoleMapping.firstRoundTriggered = false;
  }

  function stopSemanticRoleMappingTriggers() {
    runtime.semanticRoleMapping.stopped = true;
  }

  function freezeVoiceTurnsForReview() {
    state.voiceTurnsFrozen = true;
    runtime.semanticRoleMapping.frozen = true;
    runtime.semanticRoleMapping.stopped = true;
  }

  function getVoiceSemanticSnapshot() {
    return {
      initialized: Boolean(runtime.semanticRoleMapping.initialized),
      inFlight: Boolean(runtime.semanticRoleMapping.inFlight),
      stopped: Boolean(runtime.semanticRoleMapping.stopped),
      frozen: Boolean(state.voiceTurnsFrozen || runtime.semanticRoleMapping.frozen),
      lastMappedAt: runtime.semanticRoleMapping.lastMappedAt || 0,
      lastMappedFinalTurnCount: runtime.semanticRoleMapping.lastMappedFinalTurnCount || 0,
      firstRoundTriggered: Boolean(runtime.semanticRoleMapping.firstRoundTriggered),
      lastReason: runtime.semanticRoleMapping.lastReason || "",
      lastError: runtime.semanticRoleMapping.lastError || "",
      mapping: currentSpeakerRoleMapping(),
      persisted: state.voiceSemanticMapping || null,
      suggestions: Array.isArray(state.voiceSemanticSuggestions) ? state.voiceSemanticSuggestions.slice(-10) : [],
      finalTurnCount: finalVoiceTurnsRaw().length
    };
  }

  function currentSpeakerRoleMapping() {
    const mapping = Object.assign({
      speaker_0: "doctor",
      speaker_1: "patient"
    }, state.voiceSemanticMapping && state.voiceSemanticMapping.mapping || {});
    state.speakerTurns.forEach(function (turn) {
      const speakerId = normalizeSpeakerId(turn && (turn.speaker || turn.speaker_id || turn.raw_speaker || turn.raw_speaker_id));
      if (!speakerId || mapping[speakerId]) {
        return;
      }
      if (turn.role === "doctor" || turn.role === "patient") {
        mapping[speakerId] = turn.role;
      }
    });
    Object.keys(mapping).forEach(function (speakerId) {
      if (mapping[speakerId] !== "doctor" && mapping[speakerId] !== "patient" && mapping[speakerId] !== "unknown") {
        delete mapping[speakerId];
      }
    });
    return mapping;
  }

  function compactSemanticRoleTurns(turns) {
    return (Array.isArray(turns) ? turns : []).filter(isFinalTextTurn).slice(-40).map(function (turn) {
      return {
        speaker: normalizeSpeakerId(turn.speaker || turn.speaker_id || turn.raw_speaker || turn.raw_speaker_id) || "",
        role: normalizeRole(turn.role),
        role_label: roleLabel(turn.role),
        role_source: turn.role_source || "",
        text: compactText(turn.text || "", 320),
        is_final: true
      };
    }).filter(function (turn) {
      return turn.speaker && turn.text;
    });
  }

  function semanticRoleStats(turns) {
    return compactSemanticRoleTurns(turns).reduce(function (stats, turn) {
      const current = stats[turn.speaker] || { count: 0, textLength: 0 };
      current.count += 1;
      current.textLength += String(turn.text || "").length;
      stats[turn.speaker] = current;
      return stats;
    }, {});
  }

  function hasSemanticRoleSample(turns) {
    const stats = semanticRoleStats(turns);
    const speakers = Object.keys(stats);
    if (speakers.length < 2) {
      return false;
    }
    return speakers.every(function (speakerId) {
      return stats[speakerId].count >= SEMANTIC_ROLE_MIN_TURNS_PER_SPEAKER
        && stats[speakerId].textLength >= SEMANTIC_ROLE_MIN_TEXT_PER_SPEAKER;
    });
  }

  function hasFirstRoundSemanticRoleSample(turns) {
    const speakers = {};
    const roles = {};
    compactSemanticRoleTurns(turns).forEach(function (turn) {
      if (turn.speaker) {
        speakers[turn.speaker] = true;
      }
      const role = normalizeRole(turn.role);
      if (role === "doctor" || role === "patient") {
        roles[role] = true;
      }
    });
    return Object.keys(speakers).length >= 2 && roles.doctor && roles.patient;
  }

  function hasActivePageMutationStep() {
    const summary = window.AgentTaskOrchestrator && window.AgentTaskOrchestrator.getSummary
      ? window.AgentTaskOrchestrator.getSummary()
      : null;
    if (!summary || !summary.hasActiveTask) {
      return false;
    }
    const status = String(summary.status || "").toLowerCase();
    return status === "running" || status === "planning";
  }

  function shouldTriggerSemanticRoleMapping(turns, options) {
    const settings = options || {};
    const finalTurns = turns || finalVoiceTurnsRaw();
    const firstRound = Boolean(settings.firstRound);
    if (firstRound ? !hasFirstRoundSemanticRoleSample(finalTurns) : !hasSemanticRoleSample(finalTurns)) {
      return false;
    }
    if (runtime.semanticRoleMapping.inFlight) {
      return false;
    }
    if (!settings.allowWhenStopped && runtime.semanticRoleMapping.stopped) {
      return false;
    }
    if (!settings.force && (state.voiceTurnsFrozen || runtime.semanticRoleMapping.frozen)) {
      return false;
    }
    if (!settings.force && runtime.semanticRoleMapping.manualEditing) {
      return false;
    }
    if (!settings.force && hasActivePageMutationStep()) {
      return false;
    }
    if (settings.force) {
      return true;
    }
    if (firstRound) {
      return true;
    }
    const now = Date.now();
    if (runtime.semanticRoleMapping.lastMappedAt && now - runtime.semanticRoleMapping.lastMappedAt < SEMANTIC_ROLE_COOLDOWN_MS) {
      return false;
    }
    if (finalTurns.length - Number(runtime.semanticRoleMapping.lastMappedFinalTurnCount || 0) < SEMANTIC_ROLE_MIN_NEW_FINAL_TURNS) {
      return false;
    }
    return true;
  }

  function maybeTriggerFirstRoundSemanticRoleMapping(reason) {
    if (runtime.semanticRoleMapping.firstRoundTriggered) {
      return false;
    }
    const finalTurns = finalVoiceTurnsRaw();
    if (!shouldTriggerSemanticRoleMapping(finalTurns, { firstRound: true })) {
      return false;
    }
    runtime.semanticRoleMapping.firstRoundTriggered = true;
    runSemanticRoleMapping(reason || "first_doctor_patient_turns", {
      background: true,
      firstRound: true
    }).catch(function () {
      return null;
    });
    return true;
  }

  function maybeTriggerSemanticRoleMapping(reason) {
    const finalTurns = finalVoiceTurnsRaw();
    if (!shouldTriggerSemanticRoleMapping(finalTurns)) {
      return false;
    }
    runSemanticRoleMapping(reason || "final_turn_added", { background: true }).catch(function () {
      return null;
    });
    return true;
  }

  async function runFinalSemanticRoleMapping(reason) {
    return runSemanticRoleMapping(reason || "final_semantic_mapping", {
      force: true,
      allowWhenStopped: true,
      final: true
    });
  }

  async function runSemanticRoleMapping(reason, options) {
    const settings = options || {};
    const finalTurns = finalVoiceTurnsRaw();
    if (!shouldTriggerSemanticRoleMapping(finalTurns, settings)) {
      return {
        ok: false,
        skipped: true,
        reason: "sample_or_state_not_ready",
        mapping: currentSpeakerRoleMapping()
      };
    }
    runtime.semanticRoleMapping.inFlight = true;
    runtime.semanticRoleMapping.lastReason = reason || "";
    runtime.semanticRoleMapping.lastError = "";
    try {
      const result = await requestSemanticRoleMapping(finalTurns, reason || "semantic_role_mapping", settings);
      runtime.semanticRoleMapping.lastMappedAt = Date.now();
      runtime.semanticRoleMapping.lastMappedFinalTurnCount = finalTurns.length;
      runtime.semanticRoleMapping.lastResult = result || null;
      if (result && result.ok && result.mapping) {
        applySemanticRoleMapping(result, reason || "semantic_role_mapping");
      }
      return result;
    } catch (error) {
      runtime.semanticRoleMapping.lastError = error && error.message ? error.message : String(error || "semantic role mapping failed");
      return {
        ok: false,
        error: runtime.semanticRoleMapping.lastError,
        mapping: currentSpeakerRoleMapping()
      };
    } finally {
      runtime.semanticRoleMapping.inFlight = false;
    }
  }

  async function requestSemanticRoleMapping(turns, reason, options) {
    const patientContext = currentPatientContext();
    const endpoint = (state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, "") + "/api/voice/semantic-role-map";
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        patient_context: patientContext,
        current_page_type: getPageType(),
        current_patient_id: patientContext.patientId || "",
        current_mapping: currentSpeakerRoleMapping(),
        turns: compactSemanticRoleTurns(turns),
        reason: reason || "",
        final: Boolean(options && options.final)
      })
    }, 6000);
    return response.json();
  }

  function applySemanticRoleMapping(result, reason) {
    const mapping = result && result.mapping && typeof result.mapping === "object" ? result.mapping : {};
    const suggestions = Array.isArray(result && result.suggestions) ? result.suggestions.slice(0, 8) : [];
    const conflicts = [];
    let changed = false;
    state.speakerTurns = state.speakerTurns.map(function (turn) {
      const speakerId = normalizeSpeakerId(turn && (turn.speaker || turn.speaker_id || turn.raw_speaker || turn.raw_speaker_id));
      const nextRole = speakerId ? mapping[speakerId] : "";
      if (nextRole !== "doctor" && nextRole !== "patient") {
        return turn;
      }
      if (isManualRoleSource(turn.role_source)) {
        if (turn.role !== nextRole) {
          conflicts.push({
            speaker: speakerId,
            current_role: turn.role,
            suggested_role: nextRole,
            role_source: turn.role_source
          });
        }
        return turn;
      }
      if (turn.role === nextRole && turn.role_source === "llm_semantic_mapping") {
        return turn;
      }
      changed = true;
      return Object.assign({}, turn, {
        role: nextRole,
        role_label: roleLabel(nextRole),
        role_source: "llm_semantic_mapping",
        semantic_role_confidence: result.confidence === undefined ? null : result.confidence,
        semantic_role_reason: reason || ""
      });
    });
    state.voiceSemanticMapping = {
      mapping: Object.assign(currentSpeakerRoleMapping(), mapping),
      source: "llm_semantic_mapping",
      mappedAt: new Date().toISOString(),
      confidence: result.confidence === undefined ? 0 : result.confidence,
      reason_summary: result.reason_summary || ""
    };
    state.voiceSemanticSuggestions = suggestions.concat(conflicts).slice(-20);
    if (changed) {
      renderTurns();
      setVoiceActionAvailability();
    }
    saveState();
  }

  function isManualRoleSource(value) {
    return value === "manual_corrected" || value === "manual_swapped";
  }

  function isFinalTextTurn(turn) {
    return Boolean(turn && turn.is_final && String(turn.text || "").trim());
  }

  function currentPatientContext() {
    const url = new URL(window.location.href);
    const pageState = typeof window.collectHisPageState === "function" ? window.collectHisPageState() : {};
    const activePatient = pageState && (pageState.activePatient || pageState.patient || pageState.selectedPatient) || {};
    const patientId = String(
      pageState.patientId ||
      activePatient.patientId ||
      url.searchParams.get("patientId") ||
      url.searchParams.get("id") ||
      getFieldValue(["#patientId", "[name='patientId']", "[data-field='patientId']"]) ||
      ""
    ).trim();
    const storePatient = patientFromStore(patientId);
    const patientName = String(
      activePatient.name ||
      pageState.patientName ||
      (storePatient && storePatient.name) ||
      getFieldValue(["#patientName", "[name='patientName']", "[data-patient-name]", "[data-field='name']", "#nameInput", "[name='name']"]) ||
      getVisiblePatientName() ||
      ""
    ).trim();
    return {
      patientId: compactText(patientId, 40),
      patientName: compactText(cleanPatientNameText(patientName), 60),
      pageType: pageState.pageType || getPageType()
    };
  }

  function patientFromStore(patientId) {
    const id = String(patientId || "").trim();
    if (!id || !window.PatientStore || typeof window.PatientStore.getPatientById !== "function") return null;
    return window.PatientStore.getPatientById(id) || null;
  }

  function getFieldValue(selectors) {
    for (let index = 0; index < selectors.length; index += 1) {
      const node = document.querySelector(selectors[index]);
      if (node && typeof node.value === "string" && node.value.trim()) {
        return node.value.trim();
      }
      if (node && node.textContent && node.textContent.trim()) {
        return node.textContent.trim();
      }
    }
    return "";
  }

  function getVisiblePatientName() {
    const candidates = Array.from(document.querySelectorAll("[data-patient-name], .patient-name, .patient-title"));
    const match = candidates.find(function (node) {
      const text = cleanPatientNameText(node.textContent || "");
      return Boolean(text);
    });
    return match ? cleanPatientNameText(match.textContent || "") : "";
  }

  function cleanPatientNameText(text) {
    const value = compactText(text || "", 80).replace(/^P\d{3,}\s*/i, "").trim();
    if (!value || /HIS Demo|Hospital Information System|Clinical Note Revision|Patient Management|Medical Record Editor|Visit Session|Workspace|AI Agent/i.test(value)) return "";
    return value;
  }

  function resumeStoredTask() {
    if (!window.AgentTaskOrchestrator) {
      return;
    }
    const task = window.AgentTaskOrchestrator.getTask();
    if (!task || task.status !== "running") {
      return;
    }
    window.setTimeout(async function () {
      const result = await window.AgentTaskOrchestrator.resume({
        backendUrl: (state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, "")
      });
      if (result && result.handled) {
        addMessage(result.success ? "agent" : "system", result.message, result.success ? "agent" : "error");
        setStatus(result.message, !result.success);
        renderTaskSummary();
      }
    }, 350);
  }

  function cancelTask(reason) {
    if (!window.AgentTaskOrchestrator) {
      addMessage("system", "The current page has not loaded the cross-page task coordinator.", "system");
      return;
    }
    const summary = window.AgentTaskOrchestrator.getSummary ? window.AgentTaskOrchestrator.getSummary() : null;
    const result = typeof window.AgentTaskOrchestrator.cancelActiveTask === "function"
      ? window.AgentTaskOrchestrator.cancelActiveTask(reason || "User cancelled the task.", "user")
      : window.AgentTaskOrchestrator.cancel();
    runtime.planningTask = null;
    runtime.activeRunId = "";
    runtime.hiddenRecentTaskId = summary && summary.taskId || result.taskId || "";
    addMessage("system", result.message, "system", {
      messageId: "task-cancelled|" + (runtime.hiddenRecentTaskId || Date.now())
    });
    setStatus(result.message);
    transitionConversation("cancelled", "cancel_task");
    elements.currentTaskCard.hidden = true;
    elements.currentTaskCard.innerHTML = "";
    renderTaskSummary();
  }

  async function refreshLlmStatus(timeoutMs, options) {
    return refreshLlmStatusViaRuntime(timeoutMs, options);
    const backendUrl = (state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, "");
    try {
      const response = await fetchWithTimeout(backendUrl + "/api/llm/test", { method: "GET" }, 5000);
      const data = await response.json().catch(function () { return {}; });
      if (response.ok && data.ok) {
        state.backendStatus = "Available";
        state.llmProviderStatus = "Connected";
        state.llmStatus = "connected";
        state.agentMode = "llm_enabled";
        state.lastError = "";
        if (window.AgentTaskOrchestrator && typeof window.AgentTaskOrchestrator.clearBlockedNoLlmTask === "function") {
          window.AgentTaskOrchestrator.clearBlockedNoLlmTask();
        }
        renderServiceStatus();
        renderTaskSummary();
        saveState();
        return { connected: true, status: "connected", data: data };
      }
      state.backendStatus = response.status === 0 ? "Unavailable" : "Error " + response.status;
      state.llmProviderStatus = response.status === 400 ? "Not configured" : "Disconnected";
      state.llmStatus = response.status === 400 ? "not_configured" : "unavailable";
      state.agentMode = "blocked_no_llm";
      state.lastError = data.error || ("HTTP " + response.status);
    } catch (error) {
      state.backendStatus = "Unavailable";
      state.llmProviderStatus = "Disconnected";
      state.llmStatus = "disconnected";
      state.agentMode = "blocked_no_llm";
      state.lastError = error.message || "";
    }
    renderServiceStatus();
    saveState();
    return { connected: false, status: state.llmStatus, error: state.lastError };
  }

  async function refreshLlmStatusViaRuntime(timeoutMs, options) {
    const backendUrl = (state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, "");
    let endpoint = backendUrl + "/api/llm/test";
    const timeout = Number(timeoutMs) || 30000;
    const quick = Boolean(options && options.quick);
    runtime.serviceDetails.llm = { url: endpoint, status: "checking", error: "" };
    renderCompactServiceStatus();
    try {
      const response = await fetchWithTimeout(endpoint, { method: "GET" }, timeout);
      const data = await response.json().catch(function () { return {}; });
      state.backendStatus = "connected";
      if (response.ok && data.ok) {
        state.llmProviderStatus = "connected";
        state.llmStatus = "connected";
        state.agentMode = "llm_enabled";
        state.lastError = "";
        runtime.serviceDetails.llm = { url: endpoint, status: "connected", error: "" };
        if (window.AgentTaskOrchestrator && typeof window.AgentTaskOrchestrator.clearBlockedNoLlmTask === "function") {
          window.AgentTaskOrchestrator.clearBlockedNoLlmTask();
        }
        renderServiceStatus();
        renderTaskSummary();
        saveState();
        return { connected: true, status: "connected", data: data, url: endpoint };
      }
      state.llmProviderStatus = response.status === 400 ? "not_configured" : "disconnected";
      state.llmStatus = response.status === 400 ? "not_configured" : "unavailable";
      state.agentMode = "blocked_no_llm";
      state.lastError = data.error || ("HTTP " + response.status);
      runtime.serviceDetails.llm = { url: endpoint, status: "http_" + response.status, error: state.lastError };
    } catch (error) {
      const aborted = error && error.name === "AbortError";
      if (state.backendStatus !== "connected") {
        state.backendStatus = aborted ? state.backendStatus : "disconnected";
      }
      if (aborted && quick) {
        state.llmProviderStatus = "slow";
        state.llmStatus = "slow";
        state.agentMode = "llm_check_required";
        state.lastError = "LLM quick check exceeded " + timeout + "ms";
        runtime.serviceDetails.llm = {
          url: endpoint,
          status: "slow",
          error: "Response exceeded " + Math.round(timeout / 1000) + " seconds; it will be strictly checked again before task execution"
        };
        renderServiceStatus();
        saveState();
        return { connected: false, status: "slow", slow: true, error: state.lastError, url: endpoint };
      }
      state.llmProviderStatus = aborted ? "timeout" : "disconnected";
      state.llmStatus = aborted ? "timeout" : "disconnected";
      state.agentMode = "blocked_no_llm";
      state.lastError = aborted ? "LLM test timeout after " + timeout + "ms" : (error && error.message ? error.message : "");
      runtime.serviceDetails.llm = { url: endpoint, status: state.llmStatus, error: state.lastError };
    }
    renderServiceStatus();
    saveState();
    return { connected: false, status: state.llmStatus, error: state.lastError, url: endpoint };
  }

  function noLlmMessage() {
    return "The LLM is disconnected, so the Agent cannot understand or execute tasks. You can still use page buttons and forms manually.";
  }

  function getConnectionStatus() {
    return {
      frontend: "Normal",
      backend: state.backendStatus,
      llmStatus: state.llmStatus,
      agentMode: state.agentMode,
      asr: state.asrStatus,
      llm: state.llmProviderStatus,
      diarization: state.diarizationProvider || "manual",
      diarizationStatus: state.diarizationStatus || "unknown",
      dataSource: state.dataSource,
      loginMode: state.loginMode,
      activeTask: window.AgentTaskOrchestrator && window.AgentTaskOrchestrator.getSummary ? window.AgentTaskOrchestrator.getSummary() : { hasActiveTask: false },
      serviceDetails: runtime.serviceDetails,
      lastError: state.lastError || ""
    };
  }

  function reportBackendError(message) {
    const now = Date.now();
    const sameError = runtime.lastBackendErrorMessage === message && now - runtime.lastBackendErrorAt < 30000;
    runtime.lastBackendErrorMessage = message;
    runtime.lastBackendErrorAt = now;
    state.backendStatus = "Unavailable";
    state.llmStatus = "disconnected";
    state.agentMode = "blocked_no_llm";
    state.lastError = message || "";
    runtime.serviceDetails.backend = {
      url: (state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, "") + "/api/health",
      status: "disconnected",
      error: state.lastError
    };
    runtime.serviceDetails.llm = {
      url: (state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, "") + "/api/llm/test",
      status: "disconnected",
      error: state.lastError
    };
    renderServiceStatus();
    saveState();
    if (!sameError) {
      addMessage("system", noLlmMessage(), "system");
    }
  }

  

  function applyAction(action) {
    if (!action || !action.type) {
      return { success: false, message: "Missing action." };
    }
    if (typeof window.applyHisAgentAction === "function") {
      const pageResult = window.applyHisAgentAction(action);
      if (pageResult && pageResult.handled) {
        return pageResult;
      }
    }
    if (action.type === "ask_clarification" || action.type === "ask_user") {
      return { success: false, needsUser: true, message: action.value || action.reason || "Additional information is required." };
    }
    if (action.type === "noop") {
      return { success: true, message: action.reason || "No action needed." };
    }
    if (action.type === "open_page" || action.type === "navigate") {
      return navigateToSafePage(action.value || (action.target && action.target.page));
    }
    return { success: false, message: "The current page does not support action.type: " + action.type };
  }

  function navigateToSafePage(value) {
    const key = String(value || "").trim();
    const target = SAFE_PAGES[key] || (Object.values(SAFE_PAGES).includes(key) ? key : "");
    if (!target) {
      return { success: false, message: "Navigation target is not in the safety allowlist: " + key };
    }
    saveScrollSnapshot("navigate_safe_page");
    if (elements.input) {
      saveInputDraft(elements.input.value || "", "navigate");
    }
    window.location.href = target;
    return { success: true, message: "Opening: " + target };
  }

  async function toggleVoice() {
    if (runtime.recording && runtime.voiceMode === "dictation") {
      await stopActiveVoice("stop_dictation");
      setStatus("Voice Input stopped; transcript text was kept.");
      return;
    }
    if (runtime.recording && runtime.voiceMode === "session") {
      setStatus("Visit Session is recording. Click Stop Voice Task on the Visit Session page.", true);
      return;
    }
    await startDictationVoice();
  }

  async function startDictationVoice() {
    if (!window.HisVoiceInputController) {
      setStatus("Shared Voice Input module is not loaded; cannot start Voice Input.", true);
      return;
    }
    runtime.voiceMode = "dictation";
    runtime.dictationCommittedText = (elements.input.value || "").trim();
    updateVoiceButtons();
    setStatus("Starting Voice Input. Transcription will only fill the bottom input box and will not send automatically.");
    const voice = await window.HisVoiceInputController.start({
      mode: "dictation",
      enableDiarization: false,
      asrUrl: state.asrUrl || DEFAULT_STATE.asrUrl,
      diarizationUrl: state.diarizationUrl || DEFAULT_STATE.diarizationUrl,
      llmStatus: state.llmStatus,
      onTranscript: function (text, data) {
        runtime.lastAsrEvent = Object.assign({}, data || {}, {
          finalText: data && data.type === "final" ? text : "",
          timestamp: new Date().toISOString()
        });
        applyDictationTranscript(text, data);
        saveState();
      }
    });
    runtime.recording = Boolean(voice.recording);
    if (!runtime.recording) {
      runtime.voiceMode = "";
    }
    syncVoiceState(voice);
    updateVoiceButtons();
    renderServiceStatus();
    setStatus(voice.message || "Voice Input started.", voice.asrStatus === "disconnected" || isMicrophoneProblem(voice.microphoneStatus));
  }

  async function startSessionVoice() {
    if (!window.HisVoiceInputController) {
      setStatus("Shared Voice Input module is not loaded; cannot start visit-session voice task.", true);
      return;
    }
    if (runtime.voiceStartInFlight) return;
    runtime.voiceStartInFlight = true;
    runtime.voiceMode = "session";
    state.diarizationStatus = "starting";
    state.diarizationProvider = "diart_local";
    state.diarizationWebSocketStatus = "connecting";
    initializeSemanticRoleMapping();
    updateVoiceButtons();
    renderServiceStatus();
    setStatus("Diart is starting. A cold start can take tens of seconds; wait before speaking.");
    try {
      const voice = await window.HisVoiceInputController.start({
        mode: "visit_session",
        enableDiarization: true,
        asrUrl: state.asrUrl || DEFAULT_STATE.asrUrl,
        diarizationUrl: state.diarizationUrl || DEFAULT_STATE.diarizationUrl,
        llmStatus: state.llmStatus,
        onTranscript: function (text, data) {
          runtime.lastAsrEvent = Object.assign({}, data || {}, {
            finalText: data && data.type === "final" ? text : "",
            timestamp: new Date().toISOString()
          });
          renderVoiceDebug();
        },
        onTurns: function (turns, data) {
          runtime.lastAsrEvent = Object.assign({}, data || runtime.lastAsrEvent || {}, {
            timestamp: new Date().toISOString()
          });
          const beforeFinalCount = finalVoiceTurnsRaw().length;
          state.speakerTurns = mergeIncomingSpeakerTurns(state.speakerTurns, turns);
          renderTurns();
          setVoiceActionAvailability();
          saveState();
          if (finalVoiceTurnsRaw().length > beforeFinalCount) {
            if (!maybeTriggerFirstRoundSemanticRoleMapping("first_doctor_patient_turns")) {
              maybeTriggerSemanticRoleMapping("final_turn_added");
            }
          }
        }
      });
      runtime.recording = Boolean(voice.recording);
      if (runtime.recording) {
        state.voiceSessionEnded = false;
        transitionConversation("voice_recording", "start_visit_recording");
      } else {
        runtime.voiceMode = "";
        stopSemanticRoleMappingTriggers();
        transitionConversation("voice_idle", "visit_recording_not_started");
      }
      syncVoiceState(voice);
      setStatus(voice.message || "Visit-session voice status updated.", voice.asrStatus === "disconnected" || isMicrophoneProblem(voice.microphoneStatus));
    } finally {
      runtime.voiceStartInFlight = false;
      updateVoiceButtons();
      renderServiceStatus();
    }
  }

  async function stopActiveVoice(reason) {
    if (!window.HisVoiceInputController || !runtime.recording) {
      runtime.recording = false;
      runtime.voiceMode = "";
      updateVoiceButtons();
      return null;
    }
    const previousMode = runtime.voiceMode;
    const voice = await window.HisVoiceInputController.stop({ reason: reason || "manual_stop" });
    runtime.recording = false;
    runtime.voiceMode = "";
    syncVoiceState(voice);
    updateVoiceButtons();
    renderServiceStatus();
    setVoiceActionAvailability();
    renderVoiceSessionStatus();
    if (previousMode === "session") {
      stopSemanticRoleMappingTriggers();
      state.voiceSessionEnded = Boolean(state.speakerTurns.length);
      transitionConversation(state.voiceSessionEnded ? "voice_review" : "voice_idle", "stop_visit_recording");
      if (reason !== "draft_voice_task") {
        await runFinalSemanticRoleMapping("stop_session");
      }
    }
    syncVoiceState(voice);
    updateVoiceButtons();
    renderServiceStatus();
    setVoiceActionAvailability();
    renderVoiceSessionStatus();
    return voice;
  }

  function applyDictationTranscript(text, data) {
    const value = String(text || "").trim();
    if (!value) return;
    if (data && data.type === "final") {
      runtime.dictationCommittedText = joinDictationText(runtime.dictationCommittedText, value);
      elements.input.value = runtime.dictationCommittedText;
    } else {
      elements.input.value = joinDictationText(runtime.dictationCommittedText, value);
    }
    syncInputHeight();
    saveInputDraft(elements.input.value || "", data && data.type === "final" ? "dictation_final" : "dictation_partial");
  }

  function joinDictationText(base, addition) {
    const left = String(base || "").trim();
    const right = String(addition || "").trim();
    if (!left) return right;
    if (!right) return left;
    return left + " " + right;
  }

  function updateVoiceButtons() {
    if (!elements.voiceButton) return;
    const dictating = runtime.recording && runtime.voiceMode === "dictation";
    const sessionRecording = runtime.recording && runtime.voiceMode === "session";
    elements.voiceButton.textContent = dictating ? "Stop Recording" : "Voice Input";
    elements.voiceButton.disabled = sessionRecording;
    elements.voiceButton.title = sessionRecording
      ? "Visit Session is recording; stop it on the Visit Session page"
      : "Only fill voice transcription into the bottom input box; do not send automatically";
    if (elements.visitSessionButton) {
      elements.visitSessionButton.disabled = dictating;
      elements.visitSessionButton.title = dictating ? "Stop main-input voice first" : "Open Visit Session page; microphone will not start automatically";
    }
    if (elements.startVoiceButton) {
      elements.startVoiceButton.disabled = runtime.recording || runtime.voiceStartInFlight;
      elements.startVoiceButton.classList.toggle("is-loading", runtime.voiceStartInFlight);
      elements.startVoiceButton.setAttribute("aria-busy", runtime.voiceStartInFlight ? "true" : "false");
      elements.startVoiceButton.innerHTML = runtime.voiceStartInFlight
        ? '<span class="his-agent-spinner" aria-hidden="true"></span><span>Starting Diart...</span>'
        : "Start Voice Task";
    }
    if (elements.stopVoiceButton) {
      elements.stopVoiceButton.disabled = !sessionRecording;
    }
  }

  async function startVoice() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("The current browser does not expose getUserMedia, so microphone permission cannot be requested.");
      }
      setStatus("Connecting to ASR service...");
      const wsUrl = toWebSocketUrl(state.asrUrl || DEFAULT_STATE.asrUrl);
      runtime.websocket = new WebSocket(wsUrl);
      runtime.websocket.binaryType = "arraybuffer";
      runtime.websocket.onmessage = handleAsrMessage;
      await waitForWebSocketOpen(runtime.websocket);
      runtime.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      runtime.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      runtime.source = runtime.audioContext.createMediaStreamSource(runtime.mediaStream);
      runtime.processor = runtime.audioContext.createScriptProcessor(4096, 1, 1);
      runtime.processor.onaudioprocess = function (event) {
        if (!runtime.websocket || runtime.websocket.readyState !== WebSocket.OPEN) {
          return;
        }
        const input = event.inputBuffer.getChannelData(0);
        const resampled = downsampleTo16k(input, runtime.audioContext.sampleRate);
        runtime.websocket.send(resampled.buffer);
      };
      runtime.source.connect(runtime.processor);
      runtime.processor.connect(runtime.audioContext.destination);
      runtime.recording = true;
      elements.voiceButton.textContent = "Stop Voice";
      setStatus("Listening. ASR stores structured turns; the current model has unconfirmed support for automatic speaker diarization.");
    } catch (error) {
      setStatus("Voice Input failed to start: " + error.message, true);
      await stopVoice({ skipFinal: true });
    }
  }

  async function stopVoice(options) {
    const settings = options || {};
    stopAudioGraph();
    if (!settings.skipFinal && runtime.websocket && runtime.websocket.readyState === WebSocket.OPEN) {
      runtime.websocket.send(JSON.stringify({ type: "end" }));
    }
    const websocket = runtime.websocket;
    runtime.websocket = null;
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      window.setTimeout(function () {
        websocket.close();
      }, 150);
    }
    runtime.recording = false;
    elements.voiceButton.textContent = "Voice Input";
    setStatus("Voice input stopped.");
  }

  function stopAudioGraph() {
    if (runtime.processor) {
      runtime.processor.disconnect();
    }
    if (runtime.source) {
      runtime.source.disconnect();
    }
    if (runtime.mediaStream) {
      runtime.mediaStream.getTracks().forEach(function (track) {
        track.stop();
      });
    }
    if (runtime.audioContext) {
      runtime.audioContext.close();
    }
    runtime.processor = null;
    runtime.source = null;
    runtime.mediaStream = null;
    runtime.audioContext = null;
  }

  function handleAsrMessage(event) {
    const data = JSON.parse(event.data);
    if (data.type === "error") {
      addMessage("system", "ASR error: " + data.message, "error");
      setStatus("ASR returned an error.", true);
      return;
    }
    if (data.type !== "partial" && data.type !== "final") {
      return;
    }
    const text = data.normalizedText || data.rawText || "";
    if (text) {
      elements.input.value = text;
    }
    mergeAsrTurns(data, text);
    renderTurns();
    saveState();
    setStatus(data.type === "final" ? "ASR final result updated." : "ASR interim result updated.");
  }

  function mergeAsrTurns(data, text) {
    const incoming = Array.isArray(data.turns) && data.turns.length ? data.turns : [buildFallbackTurn(data, text)];
    incoming.forEach(function (turn) {
      const normalized = normalizeTurn(turn, data.type === "final");
      const existingIndex = state.speakerTurns.findIndex(function (item) {
        return item.turn_id === normalized.turn_id;
      });
      if (existingIndex >= 0) {
        state.speakerTurns[existingIndex] = normalized;
      } else if (normalized.text) {
        state.speakerTurns.push(normalized);
      }
    });
    state.speakerTurns = state.speakerTurns.slice(-120);
  }

  function buildFallbackTurn(data, text) {
    const rawSpeakerId = data.raw_speaker || data.raw_speaker_id || data.speaker || data.speaker_id || "";
    const speakerId = normalizeSpeakerId(rawSpeakerId);
    const mapped = roleFromSpeakerId(speakerId);
    const role = data.role || mapped.role;
    return {
      turn_id: (data.session_id || state.asrSessionId) + "_" + (data.type || "partial"),
      raw_speaker: rawSpeakerId || null,
      speaker: speakerId,
      role: role,
      role_label: data.role_label || roleLabel(role),
      text: text || "",
      start_ms: data.start_ms || 0,
      end_ms: data.end_ms || 0,
      is_final: data.type === "final",
      confidence: data.confidence || null,
      source: data.source || "asr_text_only_default_role",
      role_source: speakerId ? "asr_default_mapping" : "manual_fallback",
      automatic: false,
      automatic_diarization: false
    };
  }

  function normalizeTurn(turn, finalFromMessage) {
    const rawSpeakerId = turn.raw_speaker || turn.raw_speaker_id || turn.speaker || turn.speaker_id || "";
    const speakerId = normalizeSpeakerId(rawSpeakerId);
    const mapped = roleFromSpeakerId(speakerId);
    const role = normalizeRole(turn.role || mapped.role);
    const diarizationSource = turn.diarization_source || (turn.source === "diart_local" ? "diart_local" : "");
    const automatic = Boolean(turn.automatic || turn.automatic_diarization);
    return {
      turn_id: turn.turn_id || state.asrSessionId + "_" + state.speakerTurns.length,
      raw_speaker: rawSpeakerId || null,
      speaker: speakerId,
      role: role,
      role_label: turn.role_label || roleLabel(role),
      text: turn.text || "",
      start_ms: Number(turn.start_ms || 0),
      end_ms: Number(turn.end_ms || 0),
      is_final: Boolean(turn.is_final || finalFromMessage),
      confidence: turn.confidence === undefined ? null : turn.confidence,
      automatic: automatic,
      automatic_diarization: automatic && (diarizationSource === "diart_local" || turn.source === "diart_local"),
      source: turn.source || "asr_text_only_default_role",
      diarization_source: diarizationSource || "",
      role_source: turn.role_source || (speakerId ? "default_mapping" : "manual_fallback"),
      diarization_start_ms: turn.diarization_start_ms === undefined ? null : Number(turn.diarization_start_ms),
      diarization_end_ms: turn.diarization_end_ms === undefined ? null : Number(turn.diarization_end_ms),
      diarization_confidence: turn.diarization_confidence === undefined ? null : turn.diarization_confidence,
      diarization_match_mode: turn.diarization_match_mode || "",
      diarization_overlap_ms: turn.diarization_overlap_ms === undefined ? null : Number(turn.diarization_overlap_ms)
    };
  }

  function mergeIncomingSpeakerTurns(existing, incoming) {
    const next = Array.isArray(existing) ? existing.slice() : [];
    (Array.isArray(incoming) ? incoming : []).forEach(function (turn) {
      const normalized = normalizeTurn(turn, turn.is_final);
      const index = next.findIndex(function (item) {
        return item.turn_id === normalized.turn_id;
      });
      if (index >= 0) {
        const previous = next[index] || {};
        const manualRole = previous.role_source === "manual_corrected" || previous.role_source === "manual_swapped";
        const preserveDiarization = previous.diarization_source && !normalized.diarization_source;
        next[index] = Object.assign({}, previous, normalized, preserveDiarization ? {
          raw_speaker: previous.raw_speaker,
          speaker: previous.speaker,
          source: previous.source,
          diarization_source: previous.diarization_source,
          automatic: previous.automatic,
          automatic_diarization: previous.automatic_diarization,
          diarization_start_ms: previous.diarization_start_ms,
          diarization_end_ms: previous.diarization_end_ms,
          diarization_confidence: previous.diarization_confidence,
          diarization_match_mode: previous.diarization_match_mode,
          diarization_overlap_ms: previous.diarization_overlap_ms
        } : {}, manualRole ? {
          role: previous.role,
          role_label: previous.role_label,
          role_source: previous.role_source
        } : {});
      } else if (normalized.text) {
        next.push(normalized);
      }
    });
    return next.slice(-120);
  }

  function correctTurnRole(turnId, role) {
    const turn = state.speakerTurns.find(function (item) {
      return item.turn_id === turnId;
    });
    if (!turn) {
      return;
    }
    markSemanticRoleManualEdit();
    turn.role = normalizeRole(role);
    turn.role_label = roleLabel(turn.role);
    turn.role_source = "manual_corrected";
    renderTurns();
    saveState();
  }

  function normalizeSpeakerId(value) {
    if (window.HisVoiceInputController && window.HisVoiceInputController.normalizeSpeakerId) {
      return window.HisVoiceInputController.normalizeSpeakerId(value);
    }
    const text = String(value || "").trim().toLowerCase();
    if (!text) return null;
    const match = text.match(/^(?:speaker|spk)[_\-\s]*(\d+)$/);
    if (match) {
      return "speaker_" + Number(match[1]);
    }
    return null;
  }

  function roleFromSpeakerId(speakerId) {
    if (speakerId === "speaker_0") return { role: "doctor", role_label: "Doctor" };
    if (speakerId === "speaker_1") return { role: "patient", role_label: "Patient" };
    return { role: "unknown", role_label: "Unconfirmed" };
  }

  function normalizeRole(role) {
    const value = String(role || "").toLowerCase();
    if (value === "doctor" || value === "patient") return value;
    return "unknown";
  }

  function renderVoiceDebug() {
    if (!elements.voiceDebug) return;
    const rawDebug = window.__HIS_AGENT_VOICE_DEBUG__ || {};
    const voiceDebug = Object.keys(rawDebug).reduce(function (result, key) {
      if (key !== "dump") result[key] = rawDebug[key];
      return result;
    }, {});
    const lastEvent = runtime.lastAsrEvent || {};
    elements.voiceDebug.textContent = JSON.stringify({
      rawText: lastEvent.rawText || "",
      normalizedText: lastEvent.normalizedText || "",
      finalText: lastEvent.finalText || "",
      asrEventType: lastEvent.type || "",
      speakerTurns: state.speakerTurns.slice(-30),
      source: lastEvent.source || "",
      timestamp: lastEvent.timestamp || "",
      asrWebSocketStatus: voiceDebug.asrWebSocketStatus || (runtime.recording ? "recording" : "idle"),
      lastAsrError: voiceDebug.lastVoiceError || state.lastError || "",
      voiceDebug: voiceDebug
    }, null, 2);
  }

  function collectPageState() {
    const fromPage = typeof window.collectHisPageState === "function" ? window.collectHisPageState() : {};
    const pageType = getPageType();
    const demoAuth = readDemoAuthState(pageType);
    return Object.assign({}, fromPage, {
      pageType: pageType,
      isLoginPage: pageType === "login",
      isInHisContext: pageType !== "login",
      hisDemoAuthenticated: demoAuth.authenticated,
      loginState: Object.assign({}, fromPage.loginState || {}, {
        authenticated: Boolean(demoAuth.authenticated || (fromPage.loginState && fromPage.loginState.authenticated)),
        isDemoLoggedIn: Boolean(demoAuth.authenticated || (fromPage.loginState && fromPage.loginState.isDemoLoggedIn)),
        isInHisContext: pageType !== "login"
      }),
      url: window.location.href,
      path: window.location.pathname,
      title: document.title,
      visibleButtons: getVisibleControls("button").map(controlSnapshot),
      visibleInputs: getVisibleControls("input, textarea, select").map(controlSnapshot),
      visibleLinks: getVisibleControls("a").map(controlSnapshot),
      visibleNavItems: getVisibleControls("a, [data-his-entry]").map(controlSnapshot),
      activeTask: window.AgentTaskOrchestrator && window.AgentTaskOrchestrator.getSummary ? window.AgentTaskOrchestrator.getSummary() : { hasActiveTask: false },
      llmStatus: state.llmStatus,
      agentMode: state.agentMode,
      connectionStatus: getConnectionStatus(),
      auditLogSummary: window.PatientStore && window.PatientStore.getAuditLog ? window.PatientStore.getAuditLog().slice(-20) : [],
      agentWidget: getSnapshot(),
      speakerTurnsSummary: state.speakerTurns.slice(-8).map(function (turn) {
        return {
          role: turn.role,
          role_label: turn.role_label,
          raw_speaker: turn.raw_speaker,
          speaker: turn.speaker,
          text: turn.text,
          is_final: turn.is_final,
          source: turn.source,
          diarization_source: turn.diarization_source,
          automatic_diarization: Boolean(turn.automatic_diarization),
          role_source: turn.role_source || ""
        };
      })
    });
  }

  function readDemoAuthState(pageType) {
    let stored = false;
    try {
      stored = window.localStorage.getItem("hisDemoAuthenticated") === "true";
    } catch (error) {
      stored = false;
    }
    return {
      authenticated: Boolean(stored || pageType !== "login")
    };
  }

  function getSnapshot() {
    return {
      open: state.open,
      agent_session_id: state.agentSessionId,
      asr_session_id: state.asrSessionId,
      history_count: state.history.length,
      speaker_turn_count: state.speakerTurns.length,
      panel_position: state.panelPosition,
      panel_size: state.panelSize
    };
  }

  function getVisibleControls(selector) {
    return Array.from(document.querySelectorAll(selector)).filter(function (element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    }).slice(0, 60);
  }

  function controlSnapshot(element) {
    return {
      id: element.id || "",
      name: element.getAttribute("name") || "",
      text: compactText(element.textContent || element.value || element.getAttribute("aria-label") || ""),
      label: element.getAttribute("aria-label") || element.getAttribute("data-label") || "",
      href: element.getAttribute("href") || "",
      type: element.tagName.toLowerCase()
    };
  }

  function getPageType() {
    if (document.body && document.body.dataset.pageType) {
      return document.body.dataset.pageType;
    }
    const path = window.location.pathname.toLowerCase();
    if (path.endsWith("login.html")) {
      return "login";
    }
    if (path.endsWith("dashboard.html")) {
      return "dashboard";
    }
    if (path.endsWith("patient-management.html")) {
      return "patientManagement";
    }
    return "patientEditor";
  }

  function bindDrag(target, handle, stateKey) {
    if (!target || !handle) {
      return;
    }
    handle.addEventListener("pointerdown", function (event) {
      if (event.button !== 0 || event.target.closest("button, input, textarea, select, a")) {
        return;
      }
      const rect = target.getBoundingClientRect();
      runtime.pointerInteraction = {
        type: "drag",
        target: target,
        stateKey: stateKey,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top,
        moved: false
      };
      target.classList.add("dragging");
      if (handle.setPointerCapture) {
        handle.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
    });
  }

  function bindPanelDrag() {
    bindDrag(elements.panel, elements.header || elements.dragHandle, "panelPosition");
  }

  function bindPanelResize() {
    elements.resizeHandle.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) {
        return;
      }
      const rect = elements.panel.getBoundingClientRect();
      runtime.pointerInteraction = {
        type: "resize",
        target: elements.panel,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: rect.width,
        startHeight: rect.height,
        startLeft: rect.left,
        startTop: rect.top
      };
      elements.panel.classList.add("resizing");
      elements.resizeHandle.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    });
  }

  document.addEventListener("pointermove", function (event) {
    const interaction = runtime.pointerInteraction;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }
    if (interaction.type === "drag") {
      const left = interaction.startLeft + event.clientX - interaction.startX;
      const top = interaction.startTop + event.clientY - interaction.startY;
      if (Math.abs(event.clientX - interaction.startX) > 3 || Math.abs(event.clientY - interaction.startY) > 3) {
        interaction.moved = true;
      }
      const next = clampPosition(left, top, interaction.target);
      setFixedPosition(interaction.target, next);
      event.preventDefault();
      return;
    }
    if (interaction.type === "resize") {
      const size = clampSize({
        width: interaction.startWidth + event.clientX - interaction.startX,
        height: interaction.startHeight + event.clientY - interaction.startY
      }, interaction.startLeft, interaction.startTop);
      elements.panel.style.width = size.width + "px";
      elements.panel.style.height = size.height + "px";
      event.preventDefault();
    }
  });

  document.addEventListener("pointerup", finishPointerInteraction);
  document.addEventListener("pointercancel", finishPointerInteraction);

  function finishPointerInteraction(event) {
    const interaction = runtime.pointerInteraction;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }
    if (interaction.type === "drag") {
      const rect = interaction.target.getBoundingClientRect();
      const next = clampPosition(rect.left, rect.top, interaction.target);
      state[interaction.stateKey] = next;
      setFixedPosition(interaction.target, next);
      if (interaction.stateKey === "panelPosition") {
        window.localStorage.setItem(POSITION_KEY, JSON.stringify(next));
      }
      if (interaction.stateKey === "launcherPosition" && interaction.moved) {
        runtime.suppressNextLauncherClick = true;
      }
      interaction.target.classList.remove("dragging");
    }
    if (interaction.type === "resize") {
      const rect = elements.panel.getBoundingClientRect();
      const size = clampSize({ width: rect.width, height: rect.height }, rect.left, rect.top);
      state.panelSize = size;
      window.localStorage.setItem(SIZE_KEY, JSON.stringify(size));
      elements.panel.style.width = size.width + "px";
      elements.panel.style.height = size.height + "px";
      elements.panel.classList.remove("resizing");
      clampWidgetToViewport();
    }
    runtime.pointerInteraction = null;
    saveState();
  }

  function setFixedPosition(element, position) {
    element.style.left = position.left + "px";
    element.style.top = position.top + "px";
    element.style.right = "auto";
    element.style.bottom = "auto";
  }

  function clampPosition(left, top, element, sizeOverride) {
    const width = sizeOverride && sizeOverride.width ? sizeOverride.width : (element.offsetWidth || 120);
    const height = sizeOverride && sizeOverride.height ? sizeOverride.height : (element.offsetHeight || 80);
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    return {
      left: Math.min(Math.max(8, Number(left) || 8), maxLeft),
      top: Math.min(Math.max(8, Number(top) || 8), maxTop)
    };
  }

  function clampSize(size, left, top) {
    const currentLeft = Number(left === undefined ? (state.panelPosition && state.panelPosition.left) || 20 : left);
    const currentTop = Number(top === undefined ? (state.panelPosition && state.panelPosition.top) || 20 : top);
    const maxWidth = Math.max(MIN_PANEL_SIZE.width, Math.min(MAX_PANEL_SIZE.width, window.innerWidth - currentLeft - 8));
    const maxHeight = Math.max(MIN_PANEL_SIZE.height, Math.min(MAX_PANEL_SIZE.height, window.innerHeight - currentTop - 8));
    return {
      width: Math.min(Math.max(MIN_PANEL_SIZE.width, Math.round(Number(size.width) || DEFAULT_PANEL_SIZE.width)), maxWidth),
      height: Math.min(Math.max(MIN_PANEL_SIZE.height, Math.round(Number(size.height) || DEFAULT_PANEL_SIZE.height)), maxHeight)
    };
  }

  function clampWidgetToViewport() {
    if (elements.panel) {
      const rect = elements.panel.getBoundingClientRect();
      const size = clampSize({ width: rect.width, height: rect.height }, rect.left, rect.top);
      state.panelSize = size;
      elements.panel.style.width = size.width + "px";
      elements.panel.style.height = size.height + "px";
      state.panelPosition = clampPosition(rect.left, rect.top, elements.panel, size);
      setFixedPosition(elements.panel, state.panelPosition);
      window.localStorage.setItem(POSITION_KEY, JSON.stringify(state.panelPosition));
      window.localStorage.setItem(SIZE_KEY, JSON.stringify(state.panelSize));
    }
    saveState();
  }

  function resetPosition() {
    state.panelPosition = null;
    state.panelSize = null;
    state.launcherPosition = null;
    window.localStorage.removeItem(POSITION_KEY);
    window.localStorage.removeItem(SIZE_KEY);
    [elements.panel, elements.launcher].forEach(function (element) {
      element.style.left = "";
      element.style.top = "";
      element.style.right = "";
      element.style.bottom = "";
    });
    elements.panel.style.width = "";
    elements.panel.style.height = "";
    renderPositions();
    saveState();
    setStatus("Floating Agent position and size reset.");
  }

  function probeServices() {
    probeHttp((state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, "") + "/api/health", "backendStatus");
    probeHttp((state.asrUrl || DEFAULT_STATE.asrUrl).replace(/\/+$/, "") + "/health", "asrStatus");
    markLlmStatusDeferred();
  }

  function markLlmStatusDeferred() {
    const backendBase = (state.backendUrl || DEFAULT_STATE.backendUrl || "").replace(/\/+$/, "");
    const endpoint = backendBase ? backendBase + "/api/llm/test" : "";
    if (!state.llmStatus || state.llmStatus === "checking" || state.llmStatus === "timeout") {
      state.llmStatus = "not_checked";
      state.llmProviderStatus = "not_checked";
      state.agentMode = "llm_check_required";
    }
    runtime.serviceDetails.llm = {
      url: endpoint,
      status: "not_checked",
      error: "On-demand check: LLM is called only when sending a task or refreshing status"
    };
    renderServiceStatus();
    saveState();
  }

  function markSemanticRoleManualEdit() {
    runtime.semanticRoleMapping.manualEditing = true;
    window.setTimeout(function () {
      runtime.semanticRoleMapping.manualEditing = false;
    }, 1500);
  }

  async function probeDiarization() {
    const base = (state.diarizationUrl || DEFAULT_STATE.diarizationUrl || state.backendUrl || DEFAULT_STATE.backendUrl).replace(/\/+$/, "");
    const url = base + "/diarization/health";
    state.diarizationStatus = "starting";
    state.diarizationProvider = "diart_local";
    runtime.serviceDetails.diarization = { url: url, status: "starting", error: "Cold start in progress." };
    renderCompactServiceStatus();
    try {
      const response = await fetchWithTimeout(url, { method: "GET" }, 45000);
      const data = await response.json().catch(function () { return {}; });
      state.diarizationProvider = data.active_provider || data.provider || "manual";
      state.diarizationStatus = response.ok ? (data.ok ? (state.diarizationProvider === "manual" ? "manual" : "connected") : (data.status || "unavailable")) : "http_" + response.status;
      runtime.serviceDetails.diarization = {
        url: url,
        status: state.diarizationStatus,
        error: data.message || ""
      };
      renderCompactServiceStatus();
      saveState();
      return {
        connected: state.diarizationStatus === "connected",
        status: state.diarizationStatus,
        provider: state.diarizationProvider,
        message: data.message || ""
      };
    } catch (error) {
      state.diarizationProvider = "manual";
      state.diarizationStatus = error && error.name === "AbortError" ? "timeout" : "disconnected";
      runtime.serviceDetails.diarization = {
        url: url,
        status: state.diarizationStatus,
        error: error && error.message ? error.message : "Failed to fetch"
      };
      renderCompactServiceStatus();
      saveState();
      return {
        connected: false,
        status: state.diarizationStatus,
        provider: state.diarizationProvider,
        message: runtime.serviceDetails.diarization.error
      };
    }
  }

  async function probeHttp(url, stateKey) {
    return probeHttpViaRuntime(url, stateKey);
    try {
      const response = await fetchWithTimeout(url, { method: "GET" }, 5000);
      state[stateKey] = response.ok ? "Available" : "Error " + response.status;
    } catch (error) {
      state[stateKey] = "Unavailable";
    }
    renderServiceStatus();
    saveState();
  }

  async function probeHttpViaRuntime(url, stateKey, detailKeyOverride, timeoutMs) {
    const detailKey = detailKeyOverride || (stateKey === "asrStatus" ? "asr" : "backend");
    const timeout = Number(timeoutMs) || 30000;
    runtime.serviceDetails[detailKey] = { url: url, status: "checking", error: "" };
    renderCompactServiceStatus();
    try {
      const response = await fetchWithTimeout(url, { method: "GET" }, timeout);
      let errorText = "";
      if (!response.ok) {
        errorText = "HTTP " + response.status;
      }
      state[stateKey] = response.ok ? "connected" : "http_" + response.status;
      runtime.serviceDetails[detailKey] = {
        url: url,
        status: state[stateKey],
        error: errorText
      };
    } catch (error) {
      const aborted = error && error.name === "AbortError";
      const message = aborted ? "timeout after " + timeout + "ms" : (error && error.message ? error.message : "Failed to fetch");
      state[stateKey] = aborted ? "timeout" : "disconnected";
      runtime.serviceDetails[detailKey] = {
        url: url,
        status: state[stateKey],
        error: message
      };
    }
    renderServiceStatus();
    saveState();
  }

  async function newSession() {
    if (runtime.recording) {
      await stopActiveVoice("new_session");
    }
    if (window.AgentTaskOrchestrator && window.AgentTaskOrchestrator.clearActiveTask) {
      window.AgentTaskOrchestrator.clearActiveTask("User clicked New Session; old activeTask cleared.");
    }
    state.agentSessionId = "";
    state.asrSessionId = "";
    state.history = [];
    state.speakerTurns = [];
    state.activeTab = "agent";
    state.viewMode = "home";
    state.topicPage = 0;
    resetTaskPanelUiState();
    transitionConversation("home", "new_session");
    if (runtime.scrollManager && typeof runtime.scrollManager.clearUnread === "function") {
      runtime.scrollManager.clearUnread();
    }
    ensureSessionIds();
    elements.panel.classList.remove("conversation-mode", "has-active-task", "is-planning-task");
    elements.currentTaskCard.hidden = true;
    elements.currentTaskCard.innerHTML = "";
    setStatus("New session created.");
    renderHistory();
    renderTabs();
    renderViewMode();
    renderTopicCarousel();
    renderTaskSummary();
    renderTurns();
    updateVoiceButtons();
    saveState();
  }

  function setStatus(text, isError) {
    elements.status.textContent = text;
    elements.status.style.borderColor = isError ? "#fda29b" : "#c7d2fe";
  }

  function syncInputHeight() {
    if (!elements.input) return;
    const minHeight = 48;
    const maxHeight = 104;
    elements.input.style.height = minHeight + "px";
    const next = Math.max(minHeight, Math.min(maxHeight, elements.input.scrollHeight));
    elements.input.style.height = next + "px";
    elements.input.style.overflowY = elements.input.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  function updateDebugState(patch) {
    window.__HIS_AGENT_WIDGET_DEBUG__ = Object.assign({}, window.__HIS_AGENT_WIDGET_DEBUG__ || {}, {
      bootstrapLoaded: Boolean((window.__HIS_AGENT_WIDGET_DEBUG__ || {}).bootstrapLoaded),
      launcherEnsured: Boolean(document.getElementById("hisAgentLauncher")),
      llmStatus: state.llmStatus || "unknown",
      agentMode: state.agentMode || "blocked_no_llm",
      viewMode: normalizeViewMode(state.viewMode),
      backendUrl: state.backendUrl || DEFAULT_STATE.backendUrl,
      asrUrl: state.asrUrl || DEFAULT_STATE.asrUrl,
      asrStatus: state.asrStatus || "unknown",
      microphoneStatus: state.microphoneStatus || "unknown",
      llmUrl: RUNTIME_URLS.llmUrl,
      llmProviderStatus: state.llmProviderStatus || "unknown",
      lastInitError: null,
      scriptsVersion: "20260624-voice-confirm-execute",
      conversationState: state.conversationState || "home",
      stateTransitions: (state.stateTransitions || []).slice(-20),
      scrollState: runtime.scrollManager && runtime.scrollManager.getState ? runtime.scrollManager.getState() : null,
      lastRoute: runtime.lastRoute || null,
      runtimeConfig: RUNTIME_URLS,
      serviceDetails: runtime.serviceDetails,
      speakerTurns: state.speakerTurns.slice(-10)
    }, patch || {});
  }

  function toWebSocketUrl(serviceUrl) {
    const url = String(serviceUrl || "").trim().replace(/\/+$/, "");
    if (url.startsWith("https://")) {
      return "wss://" + url.slice("https://".length) + "/ws";
    }
    if (url.startsWith("http://")) {
      return "ws://" + url.slice("http://".length) + "/ws";
    }
    return url;
  }

  function waitForWebSocketOpen(websocket) {
    return new Promise(function (resolve, reject) {
      websocket.onopen = resolve;
      websocket.onerror = function () {
        reject(new Error("Unable to connect to ASR service"));
      };
    });
  }

  function downsampleTo16k(input, sourceRate) {
    if (sourceRate === 16000) {
      return new Float32Array(input);
    }
    const ratio = sourceRate / 16000;
    const length = Math.floor(input.length / ratio);
    const output = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      output[index] = input[Math.floor(index * ratio)];
    }
    return output;
  }

  

  function compactText(text, maxLength) {
    const limit = Math.max(1, Number(maxLength || 80));
    const value = String(text || "").replace(/\s+/g, " ").trim();
    return value.length > limit ? value.slice(0, limit) + "..." : value;
  }

  function formatElapsed(ms) {
    if (ms === null || ms === undefined || ms === "") {
      return "--:--";
    }
    const value = Math.max(0, Number(ms || 0));
    if (value < 1000) {
      return (value / 1000).toFixed(1) + "s";
    }
    if (value < 60000) {
      return (value / 1000).toFixed(1) + "s";
    }
    const totalSeconds = Math.floor(value / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds - minutes * 60;
    const secondText = String(seconds).padStart(2, "0");
    return String(minutes).padStart(2, "0") + ":" + secondText;
  }

  function formatUsage(usage) {
    const value = usage || {};
    const total = Number(value.total_tokens || 0);
    return String(total);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(String(value || ""));
    }
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, function (char) {
      return "\\" + char.charCodeAt(0).toString(16) + " ";
    });
  }

  function createRecoveryLauncher(error) {
    if (!document.body || document.getElementById("hisAgentLauncher") || document.getElementById("hisAgentRecoveryLauncher")) {
      return;
    }
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(POSITION_KEY);
      window.localStorage.removeItem(SIZE_KEY);
    } catch (storageError) {
      console.warn("[AgentWidget] unable to clear widget storage", storageError);
    }
    console.error("[AgentWidget] initialization failed", error);

    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.id = "hisAgentRecoveryLauncher";
    launcher.className = "his-agent-recovery-launcher";
    launcher.innerHTML = "<strong>AI Agent</strong><span>LLM disconnected</span>";

    const panel = document.createElement("section");
    panel.id = "hisAgentRecoveryPanel";
    panel.className = "his-agent-recovery-panel";
    panel.hidden = true;
    panel.innerHTML = [
      "<strong>AI Agent</strong>",
      "<p>The LLM is disconnected, so the Agent cannot understand or execute tasks. You can still use page buttons and forms manually.</p>",
      '<button type="button" id="hisAgentRecoveryClose">Collapse</button>'
    ].join("");

    launcher.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
    });
    panel.querySelector("#hisAgentRecoveryClose").addEventListener("click", function () {
      panel.hidden = true;
    });
    document.body.appendChild(launcher);
    document.body.appendChild(panel);
    console.warn("[AgentWidget] fallback button rendered");
  }

  function safeInit() {
    try {
      init();
      updateDebugState({ lastInitError: null });
      window.setTimeout(function () {
        if (!document.getElementById("hisAgentLauncher") && !document.getElementById("hisAgentPanel")) {
          createRecoveryLauncher(new Error("Agent widget DOM was not mounted."));
        }
      }, 0);
      console.info("[AgentWidget] initialized");
    } catch (error) {
      updateDebugState({ lastInitError: error && error.message ? error.message : String(error) });
      createRecoveryLauncher(error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", safeInit);
  } else {
    safeInit();
  }
})();
