# HIS-Agent Evaluation Results

This document reports the evaluation results used for the HIS-Agent demo submission. All experiments use synthetic HIS patient records or public/synthetic doctor-patient dialogue samples; no real protected health information is included.

## Experiment 1: Cross-Agent GUI Benchmark

The cross-agent benchmark evaluates whether different GUI/browser agents can complete the same HIS operations on the same real HTML interface. All agents operate through the browser UI. Correctness is checked by a Playwright oracle over final UI state, browser storage, and audit logs. Punctuation-only differences are ignored.

### Task Suite

| Task Category | HIS Pages | Task Scope | # |
| --- | --- | --- | ---: |
| Navigation & Retrieval | Login, Dashboard, Patient Management | Login, search the synthetic patient cohort, and open the target patient record. | 24 |
| Structured Field Editing | Patient Editor | Edit administrative or demographic fields such as phone, address, department, clinician, and visit metadata. | 27 |
| Clinical Record Editing | Patient Editor | Edit explicit user-provided documentation fields such as chief complaint, present illness, prescriptions, and physician notes. | 20 |
| Multi-field Update & Verification | Patient Editor, Browser Storage | Perform coordinated edits across patient fields and verify persistence in browser storage and audit logs. | 29 |
| **Total** | - | - | **100** |

### Cross-Agent Results

Entries are mean +/- standard deviation over three runs. `Succ.` is task success rate in percentage points; `Lat.` is average end-to-end latency in seconds; `Tok/Succ` is average total token cost per successful task in thousands. Playwright-Orchestrator is a deterministic feasibility reference rather than a fully autonomous GUI agent.

| System | Succ. (higher better) | Lat. (lower better) | Calls (lower better) | Steps (lower better) | Tok/Succ (lower better) |
| --- | ---: | ---: | ---: | ---: | ---: |
| HIS-Agent | 96.3 +/- 1.9 | 18.7 +/- 1.1 | 1.04 +/- 0.02 | 5.10 +/- 0.06 | 6.6k +/- 0.4k |
| Browser Use | 81.3 +/- 2.9 | 97.3 +/- 5.3 | 7.14 +/- 0.37 | 6.99 +/- 0.36 | 65.0k +/- 6.3k |
| LaVague | 83.7 +/- 2.1 | 88.2 +/- 2.2 | 9.90 +/- 0.05 | 0.94 +/- 0.01 | 54.1k +/- 0.9k |
| Skyvern | 94.7 +/- 0.5 | 100.1 +/- 7.3 | 5.65 +/- 0.03 | 2.00 +/- 0.00 | 33.4k +/- 0.5k |
| Stagehand | 98.0 +/- 0.0 | 23.2 +/- 1.5 | 2.85 +/- 0.01 | 4.84 +/- 0.00 | 14.4k +/- 0.6k |
| Playwright-Orch. | 100.0 +/- 0.0 | 9.7 +/- 0.0 | 0.00 +/- 0.00 | 3.86 +/- 0.00 | 0.0k +/- 0.0k |

## Experiment 2: Doctor-Patient Semantic Role Mapping

The voice pipeline evaluation measures whether HIS-Agent can map anonymous speaker IDs to clinically meaningful doctor/patient roles. The evaluation uses 1,000 MedDialog-derived two-speaker dialogues, with Chinese and English splits balanced at 500 dialogues each.

`Case EM` is case-level exact match. `Spk. Acc.` counts each speaker assignment independently. Latency is reported in seconds. Token values are average total token count in thousands. Entries are mean +/- standard deviation over three runs.

| Split / condition | #Dlg. | #Spk. | Case EM (higher better) | Spk. Acc. (higher better) | Lat. (lower better) | Tok. (lower better) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **Main role-mapping results** | | | | | | |
| Overall | 1000 | 2000 | 99.13 +/- 0.12 | 99.45 +/- 0.08 | 13.49 +/- 2.18 | 5.57k +/- 0.02k |
| English | 500 | 1000 | 99.47 +/- 0.19 | 99.73 +/- 0.09 | 14.11 +/- 1.28 | 5.52k +/- 0.04k |
| Chinese | 500 | 1000 | 98.80 +/- 0.16 | 99.17 +/- 0.09 | 12.86 +/- 3.17 | 5.61k +/- 0.00k |
| **Bias diagnostics** | | | | | | |
| Doctor = speaker_0 | 500 | 1000 | 99.60 +/- 0.00 | 99.67 +/- 0.05 | - | - |
| Doctor = speaker_1 | 500 | 1000 | 98.67 +/- 0.25 | 99.23 +/- 0.12 | - | - |
| Absolute position gap (pp) | - | - | 0.93 +/- 0.25 | 0.43 +/- 0.09 | - | - |

## Interpretation

The cross-agent GUI benchmark shows that HIS-Agent achieves high task success while using fewer LLM calls and substantially fewer tokens than general-purpose browser agents. Its lower token cost follows from the contract-guided architecture: the LLM plans over allowlisted clinical actions, while page execution and final-state verification are handled deterministically.

The semantic role-mapping evaluation shows that the voice pipeline can robustly map anonymous speaker IDs to doctor/patient roles across Chinese and English dialogues. The remaining position gap indicates mild sensitivity to whether the doctor speaks first or second, which should be reported as a bias diagnostic rather than hidden.

## Reproducibility Notes

- The GUI benchmark uses synthetic patient data only.
- The semantic role-mapping benchmark uses MedDialog-derived dialogue samples transformed into two-speaker role-mapping cases.
- Raw API keys, ASR credentials, and model service credentials are not included in this repository.
- The repository provides installable source code and documentation; exact reproduction requires configuring compatible LLM, ASR, and diarization services.
