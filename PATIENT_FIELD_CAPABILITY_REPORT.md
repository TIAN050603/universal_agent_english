# Patient Field Capability Report

Generated at: 2026-06-29T05:15:59.826Z
Run ID: patient-field-matrix-20260629T051559Z
Base URL: http://10.26.6.8:31589

## Summary

- Demo patients discovered: 20
- Editable editor fields: 25
- Candidate patient-field cells: 500
- Editable editor controls present and enabled: 25/25
- Full mutation execution complete: false

## Boundary

- This report discovers the full Demo patient x editable-field matrix from the live page schema and editor DOM.
- It does not execute every mutation in baseline/evaluate mode, so skipped execution must not be counted as pass.
- Real mutation execution still requires explicit mutation mode and data restore verification.

## Fields

- name (text)
- gender (select)
- age (number)
- birthDate (date)
- phone (text)
- idType (select)
- idNumber (text)
- address (text)
- emergencyContact (text)
- emergencyPhone (text)
- insuranceType (select)
- visitDate (date)
- department (select)
- doctor (text)
- visitType (select)
- visitStatus (select)
- chiefComplaint (textarea)
- presentIllness (textarea)
- pastHistory (textarea)
- allergyHistory (textarea)
- vitalSigns (textarea)
- diagnosis (textarea)
- examSummary (textarea)
- orders (textarea)
- note (textarea)

## Read-only Or Hidden

- patientId: editable=false, showInEditor=true
- encounterId: editable=false, showInEditor=true
- medicalHistory: editable=true, showInEditor=false

