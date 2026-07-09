# HIS-Agent Documentation

This directory keeps reviewer-facing docs, evaluation plans, design notes, and generated reports out of the repository root.

## Reviewer Package

- [Reviewer Demo Guide](DEMO.md): quick path for checking the installable demo.
- [Evaluation Plan](EVALUATION.md): semantic role correction evaluation design.

## Demo Operations

- [English Demo Recording Checklist](demo/ENGLISH_DEMO_RECORDING_CHECKLIST.md): recording flow and service preflight checklist.

## Design Notes

- [Agent V2 Design](design/AGENT_V2_DESIGN.md): historical product and state-machine design notes.
- [Agent Loop Engineering](design/AGENT_LOOP_ENGINEERING.md): loop runner entry document.
- [Loop Engineering](design/LOOP_ENGINEERING.md): detailed loop-engineering design notes.

## Reports

- [Reports Index](reports/README.md): generated reports and latest run snapshots.
- [Latest Reports](reports/latest): newest root-level reports archived from the project root.

## Root Directory Policy

The repository root should stay small:

- Keep `README.md`, `AGENTS.md`, `package.json`, `package-lock.json`, `.gitignore`, and `index.html` at root.
- Keep runnable source directories at root: `html`, `shared`, `backend`, `asr_service`, `diarization_service`, `scripts`, `tests`, and `loop-engineering`.
- Put design notes, checklists, generated reports, and reviewer documents under `docs`.
