import { expect, test } from "@playwright/test";


const serviceQuery = new URLSearchParams({
  backendUrl: "http://127.0.0.1:8000",
  asrUrl: "http://127.0.0.1:8010",
  diarizationUrl: "http://127.0.0.1:8000"
}).toString();


test("final semantic mapping overrides mixed diarization clusters per turn", async ({ page }) => {
  const dialogue = [
    ["turn_1", "speaker_0", "Good morning, doctor."],
    ["turn_2", "speaker_0", "Could you confirm your full name for me?"],
    ["turn_3", "speaker_0", "My name is Zhang Wei."],
    ["turn_4", "speaker_1", "Do you have any medication allergies?"],
    ["turn_5", "speaker_1", "Yes, I am allergic to penicillin."],
    ["turn_6", "speaker_1", "I will add it to your allergy history."]
  ];
  const expectedRoles = ["patient", "doctor", "patient", "doctor", "patient", "doctor"];

  await page.addInitScript(({ dialogue }) => {
    const turns = dialogue.map(([turnId, speakerId, text]) => ({
      turn_id: turnId,
      speaker_id: speakerId,
      speaker: speakerId,
      raw_speaker_id: speakerId,
      role: speakerId === "speaker_0" ? "patient" : "doctor",
      role_label: speakerId === "speaker_0" ? "Patient" : "Doctor",
      role_source: "diart_local",
      text,
      is_final: true
    }));
    localStorage.clear();
    localStorage.setItem("his_agent_widget_state_v1", JSON.stringify({
      open: false,
      activeTab: "voice",
      viewMode: "voice",
      speakerTurns: turns,
      voiceSessionEnded: true,
      voiceTurnsFrozen: false,
      history: []
    }));
  }, { dialogue });

  let finalPayload;
  await page.route(/\/api\/voice\/semantic-role-map$/, async (route) => {
    finalPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        mapping: { speaker_0: "patient", speaker_1: "doctor" },
        turn_roles: Object.fromEntries(dialogue.map(([turnId], index) => [turnId, expectedRoles[index]])),
        confidence: 0.99,
        authoritativeFinal: true,
        mappingValidated: true,
        turnRolesValidated: true,
        suggestions: []
      })
    });
  });

  await page.goto(`/html/patient-editor.html?patientId=P001&v=turn-role-regression&${serviceQuery}`);
  await page.waitForFunction(() => Boolean(window.HisAgentWidget));
  const result = await page.evaluate(() => window.HisAgentWidget.triggerVoiceSemanticMapping("turn_role_regression", {
    force: true,
    allowWhenStopped: true,
    final: true
  }));

  expect(result.ok).toBe(true);
  expect(finalPayload.current_mapping).toEqual({});
  expect(finalPayload.turns.map((turn) => turn.turn_id)).toEqual(dialogue.map(([turnId]) => turnId));
  await expect.poll(async () => page.evaluate(() => window.HisAgentWidget.getConversationTurns().map((turn) => ({
    role: turn.role,
    source: turn.role_source
  })))).toEqual(expectedRoles.map((role) => ({ role, source: "llm_turn_semantic_mapping" })));
});
