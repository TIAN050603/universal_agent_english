import { expect, test } from "@playwright/test";

const serviceQuery = new URLSearchParams({
  backendUrl: "http://127.0.0.1:8000",
  asrUrl: "http://127.0.0.1:8010",
  diarizationUrl: "http://127.0.0.1:8000"
}).toString();

async function installFakeVoiceRuntime(page, diarizationDelayMs = 0) {
  await page.addInitScript(() => {
    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      url;
      readyState = FakeWebSocket.OPEN;
      binaryType = "";
      sent = [];
      onopen;
      onclose;
      onmessage;

      constructor(url) {
        this.url = String(url);
        window.__voiceRegressionSockets = window.__voiceRegressionSockets || [];
        window.__voiceRegressionSockets.push(this);
        setTimeout(() => this.onopen?.({ target: this }), 0);
      }

      send(data) { this.sent.push(data); }
      close() {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.({ target: this });
      }
      emit(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
    }

    window.__microphoneRegression = { requests: 0, stops: 0 };
    Object.defineProperty(window, "WebSocket", { value: FakeWebSocket, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          window.__microphoneRegression.requests += 1;
          return {
            getTracks: () => [{
              stop() { window.__microphoneRegression.stops += 1; }
            }]
          };
        }
      }
    });

    class FakeAudioContext {
      sampleRate = 16000;
      destination = {};
      state = "running";
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createScriptProcessor() { return { onaudioprocess: null, connect() {}, disconnect() {} }; }
      close() { this.state = "closed"; return Promise.resolve(); }
    }

    Object.defineProperty(window, "AudioContext", { value: FakeAudioContext, configurable: true });
    Object.defineProperty(window, "webkitAudioContext", { value: FakeAudioContext, configurable: true });
  });

  await page.route(/127\.0\.0\.1:8010\/health$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route(/\/diarization\/health$/, async (route) => {
    if (diarizationDelayMs) await new Promise((resolve) => setTimeout(resolve, diarizationDelayMs));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, provider: "diart_local", active_provider: "diart_local", status: "available" })
    });
  });
  await page.route(/\/api\/voice\/semantic-role-map$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, mapping: { speaker_0: "patient", speaker_1: "doctor" }, confidence: 0.99, suggestions: [] })
    });
  });
}

async function openVisitSession(page) {
  if (!((await page.locator("#hisAgentPanel").getAttribute("class")) || "").includes("open")) {
    await page.locator("#hisAgentLauncher").click();
  }
  if (!(await page.locator("#hisAgentVoiceView").isVisible())) {
    await page.locator("#hisAgentVisitSessionButton").click();
  }
  await expect(page.locator("#hisAgentVoiceView")).toBeVisible();
}

async function emitFinalTurn(page, turnId, speakerId, text) {
  await page.evaluate(({ turnId, speakerId, text }) => {
    const sockets = window.__voiceRegressionSockets || [];
    const asr = sockets.find((socket) => !socket.url.includes("/ws/diarization"));
    if (!asr) throw new Error("fake ASR socket not found");
    asr.emit({
      type: "final",
      session_id: "voice_clear_regression",
      normalizedText: text,
      turns: [{ turn_id: turnId, raw_speaker_id: speakerId, speaker_id: speakerId, text, is_final: true }]
    });
  }, { turnId, speakerId, text });
}

test("Clear Voice Record clears controller, widget, persistence, and microphone", async ({ page }) => {
  await installFakeVoiceRuntime(page);
  await page.goto(`/html/patient-editor.html?patientId=P001&v=voice-clear-v6&${serviceQuery}`);
  await openVisitSession(page);
  await page.locator("#hisAgentStartVoiceButton").click();
  await expect.poll(async () => page.evaluate(() => window.HisVoiceInputController.getState().recording)).toBe(true);
  await emitFinalTurn(page, "patient_1", "speaker0", "My name is Zhang Wei.");
  await emitFinalTurn(page, "doctor_1", "speaker1", "I will update your record.");
  await expect(page.locator(".his-agent-turn")).toHaveCount(2);

  await page.locator("#hisAgentClearTurnsButton").click();
  await expect(page.locator(".his-agent-turn")).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => {
    const controller = window.HisVoiceInputController.getState();
    const persisted = JSON.parse(localStorage.getItem("his_agent_widget_state_v1") || "{}");
    return {
      controllerTurns: controller.turns.length,
      transcript: controller.transcript,
      persistedTurns: (persisted.speakerTurns || []).length,
      recording: controller.recording,
      tracks: controller.streamTrackCount,
      stopped: window.__microphoneRegression.stops >= 1
    };
  })).toEqual({ controllerTurns: 0, transcript: "", persistedTurns: 0, recording: false, tracks: 0, stopped: true });

  await page.reload();
  await expect(page.locator(".his-agent-turn")).toHaveCount(0);
});

test("Clear propagates across HIS pages and stale pages cannot restore turns", async ({ context, page }) => {
  await installFakeVoiceRuntime(page);
  await page.goto(`/html/patient-editor.html?patientId=P001&v=voice-clear-cross-page-v6&${serviceQuery}`);
  await openVisitSession(page);
  await page.locator("#hisAgentMockTurnsButton").click();
  await expect(page.locator(".his-agent-turn")).toHaveCount(4);

  const stalePage = await context.newPage();
  await installFakeVoiceRuntime(stalePage);
  await stalePage.goto(`/html/dashboard.html?v=voice-clear-cross-page-v6&${serviceQuery}`);
  await openVisitSession(stalePage);
  await expect(stalePage.locator(".his-agent-turn")).toHaveCount(4);

  await page.locator("#hisAgentClearTurnsButton").click();
  await expect(page.locator(".his-agent-turn")).toHaveCount(0);
  await expect(stalePage.locator(".his-agent-turn")).toHaveCount(0);
  await stalePage.locator("#hisAgentSwapRolesButton").click();
  await page.reload();
  await expect(page.locator(".his-agent-turn")).toHaveCount(0);
});

test("cancelling Diart cold start cannot open the microphone later", async ({ page }) => {
  await installFakeVoiceRuntime(page, 600);
  await page.goto(`/html/patient-editor.html?patientId=P001&v=voice-cancel-v6&${serviceQuery}`);
  await openVisitSession(page);
  await page.locator("#hisAgentStartVoiceButton").click();
  await expect(page.locator("#hisAgentStopVoiceButton")).toHaveText("Cancel Start");
  await expect(page.locator("#hisAgentStopVoiceButton")).toBeEnabled();
  await page.locator("#hisAgentStopVoiceButton").click();

  await expect.poll(async () => page.evaluate(() => window.HisVoiceInputController.getState().voiceInputStatus)).toBe("idle");
  await page.waitForTimeout(800);
  await expect.poll(async () => page.evaluate(() => ({
    requests: window.__microphoneRegression.requests,
    recording: window.HisVoiceInputController.getState().recording,
    tracks: window.HisVoiceInputController.getState().streamTrackCount
  }))).toEqual({ requests: 0, recording: false, tracks: 0 });
});

test("Stop Voice Task releases the active microphone track", async ({ page }) => {
  await installFakeVoiceRuntime(page);
  await page.goto(`/html/patient-editor.html?patientId=P001&v=voice-stop-v6&${serviceQuery}`);
  await openVisitSession(page);
  await page.locator("#hisAgentStartVoiceButton").click();
  await expect.poll(async () => page.evaluate(() => window.HisVoiceInputController.getState().recording)).toBe(true);
  await page.locator("#hisAgentStopVoiceButton").click();

  await expect.poll(async () => page.evaluate(() => ({
    stopped: window.__microphoneRegression.stops >= 1,
    recording: window.HisVoiceInputController.getState().recording,
    tracks: window.HisVoiceInputController.getState().streamTrackCount
  }))).toEqual({ stopped: true, recording: false, tracks: 0 });
});
