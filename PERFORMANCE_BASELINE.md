# Performance Baseline

Generated at: 2026-06-29T05:21:31.588Z
Source iteration: iteration-075
Source run ID: full-20260629T051628Z
Base URL: http://10.26.6.8:31589

## Summary

- Status: baseline_collected
- Score: 100
- Passed / failed / skipped: 29 / 0 / 0
- Total measured case elapsed: 124565ms
- Average case elapsed: 4295ms
- Max case elapsed: 22448ms

## Case Timings

- p0-runtime-health-baseline: passed, 171ms
- p0-login-invalid-username-manual: passed, 906ms
- p0-login-invalid-username-agent: passed, 2446ms
- p0-no-mutation-save-denied: passed, 1349ms
- p0-wrong-patient-protection: passed, 22448ms
- p0-no-llm-no-page-action: passed, 1574ms
- p0-terminal-task-not-reanimated: passed, 653ms
- p0-data-snapshot-restore: passed, 599ms
- p1-login-valid-manual: passed, 1092ms
- p1-agent-login-valid: passed, 2891ms
- p1-update-p001-phone: passed, 10056ms
- p1-in-his-no-return-login: passed, 9990ms
- p1-missing-patient-clarify: passed, 10880ms
- p1-missing-field-clarify: passed, 10997ms
- p1-new-task-during-waiting-user: passed, 1831ms
- p1-cancel-task-terminal: passed, 1813ms
- p1-refresh-restore-no-repeat: passed, 10950ms
- p1-multi-field-update: passed, 9948ms
- p1-date-and-select-update: passed, 10041ms
- p1-primary-voice-input-only: passed, 923ms
- p1-voice-session-review-before-execute: passed, 3543ms
- p1-diart-unavailable-manual: passed, 1091ms
- p2-latest-agent-message-visible: passed, 2070ms
- p2-user-scroll-not-forced-bottom: passed, 1197ms
- p2-new-message-prompt: passed, 1160ms
- p2-progress-does-not-steal-home-view: passed, 1118ms
- p2-expanded-steps-not-reset: passed, 1632ms
- p2-input-draft-persist: passed, 682ms
- p2-agent-history-rich-fields: passed, 514ms

## Threshold Notes

- Status refresh target: 5000ms
- LLM health fast-check target: 5000ms
- Single loop case target: 15000ms

