# English Demo Recording Checklist

Use `/huaiwenpang/universal_agent_english` only. Do not use the Chinese source project for recording.

## Preflight

- Open the forced refresh URL: `http://10.26.6.8:30410/html/login.html?v=20260707-english-voice`.
- Confirm the service settings show:
  - Frontend: `http://10.26.6.8:30410`
  - Backend: `http://10.26.6.8:31782`
  - ASR: `http://10.26.6.8:31667`
  - LLM: `http://10.26.6.8:31656`
- Confirm Backend, LLM, and ASR status are connected before recording the main take.

## Recording Flow

1. Login: show the English login page and sign in.
2. Patient Management: open the patient list and select P001 Zhang Wei.
3. English Typed Task: ask the Agent to change Zhang Wei's phone number and save.
4. English Typed Task: update Chief Complaint and Present Illness in English and save.
5. English Voice Input: speak English into the Agent input; confirm the transcript is inserted but not auto-sent.
6. Visit Session: start a visit session and record English doctor/patient turns.
7. Doctor/Patient Turns: include cough for two days, low-grade fever, white sputum, worse at night.
8. Task Confirmation: end the conversation, generate the Agent task, and confirm canonical fields.
9. Agent GUI Operation: show the Agent opening the patient editor, editing fields, saving, and verifying.
10. History/Audit: open history and verify English field values were recorded.

## Fallback Plan If ASR Is Unstable

- Keep the English typed task flow as the primary successful demo.
- Show ASR configuration as `QWEN_ASR_LANGUAGE=en`.
- If live microphone recognition is noisy, record with fake media or a quiet microphone and state that ASR quality depends on the Qwen ASR realtime service and the audio device.
- Do not claim ASR passed unless the actual transcript is English and usable.
