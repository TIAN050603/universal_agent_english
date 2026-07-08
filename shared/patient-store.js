(function () {
  "use strict";

  const STORAGE_KEY = "his_demo_patients_v2";
  const LEGACY_STORAGE_KEY = "his_demo_patients_v1";
  const AUDIT_KEY = "his_demo_patient_audit_v2";
  const LEGACY_AUDIT_KEY = "his_demo_patient_audit_v1";
  const CHANNEL_NAME = "his_demo_patient_store";

  const schema = window.PatientFieldSchema || { fields: [], getFieldLabel: function (key) { return key; } };
  const editableFields = new Set((schema.fields || []).filter(function (field) { return field.editable; }).map(function (field) { return field.key; }));
  const allFields = new Set((schema.fields || []).map(function (field) { return field.key; }));

  const demoPatients = [
    makePatient("P001", "Zhang Wei", "Male", 38, "Respiratory Medicine", "Initial Visit", "In Progress", "Urban Employee Medical Insurance", "Cough for one week, worse at night, occasional low-grade fever.", "Cough and throat irritation for the past week, without obvious exertional dyspnea.", "No known chronic medical history.", "None", "T 37.3C,P 82bpm,BP 122/78mmHg", "Upper respiratory infection to be ruled out", "Not yet completed", "Drink more water and return if needed.", "Baseline evaluation record."),
    makePatient("P002", "Li Na", "Female", 29, "Dermatology", "Follow-up Visit", "In Progress", "Urban/Rural Resident Medical Insurance", "Skin rash with itching for one week.", "Recurrent rash on forearms and neck, worse itching at night.", "History of seasonal dermatitis.", "Allergy to penicillin-class medications.", "Vital signs stable", "Dermatitis follow-up record", "Not yet completed", "Skin care education.", "Watch for allergy triggers."),
    makePatient("P003", "Wang Qiang", "Male", 45, "Orthopedics", "Initial Visit", "Waiting", "Commercial Insurance", "Left shoulder pain with limited movement.", "Left shoulder pain after lifting heavy objects, worse with abduction.", "History of old right-knee injury.", "None", "Vital signs stable", "Shoulder injury to be ruled out", "Imaging exam pending", "Not ordered yet", "Recommend completing imaging studies."),
    makePatient("P004", "Chen Min", "Female", 34, "Cardiology", "Initial Visit", "In Progress", "Self-pay", "Chest discomfort for half a day.", "Occasional palpitations without clear radiating chest pain.", "Occasional palpitations, no long-term medication.", "None", "BP 118/76mmHg", "Cause of palpitations to be investigated", "ECG pending", "Not ordered yet", "Multi-field editing test patient."),
    makePatient("P005", "Zhao Lei", "Male", 52, "Neurology", "Follow-up Visit", "In Progress", "Urban Employee Medical Insurance", "Dizziness and reduced sleep quality.", "Dizziness for three days with difficulty falling asleep.", "Five-year history of hypertension.", "Seafood allergy.", "BP 142/88mmHg", "Dizziness to be investigated", "Not yet completed", "Follow-up visit", "Used for phone-number validation testing."),
    makePatient("P006", "Liu Yang", "Male", 31, "Gastroenterology", "Initial Visit", "In Progress", "Urban Employee Medical Insurance", "Upper abdominal discomfort for three days.", "Postprandial upper abdominal bloating and pain with occasional acid reflux; no hematemesis or melena.", "History of chronic gastritis.", "None", "Soft abdomen with mild upper abdominal tenderness", "Gastritis to be ruled out", "Gastroscopy pending", "Light diet and follow-up as needed.", "Used for gastroenterology filter testing."),
    makePatient("P007", "Sun Fang", "Female", 41, "Endocrinology", "Follow-up Visit", "In Progress", "Urban/Rural Resident Medical Insurance", "Unstable blood glucose control for one month.", "Fasting glucose fluctuation for one month with occasional dry mouth.", "Three-year history of type 2 diabetes.", "None", "BP 126/80 mmHg, fasting glucose elevated", "Diabetes follow-up", "HbA1c pending", "Diet and exercise education.", "Monitor chronic disease follow-up."),
    makePatient("P008", "Zhou Jie", "Male", 27, "ENT", "Initial Visit", "Waiting", "Self-pay", "Sore throat with nasal congestion for two days.", "Sore throat and runny nose with marked nighttime nasal congestion; no obvious fever.", "No special medical history.", "None", "Pharyngeal congestion", "Acute pharyngitis to be ruled out", "Not yet completed", "Drink more water and observe symptoms.", "General outpatient test patient."),
    makePatient("P009", "Wu Min", "Female", 36, "Gynecology", "Initial Visit", "In Progress", "Urban Employee Medical Insurance", "Dull lower abdominal pain for one week.", "Dull lower abdominal pain, worse after activity, without obvious fever.", "No known chronic medical history.", "Allergy to cephalosporins.", "Vital signs stable", "Pelvic inflammatory disease to be ruled out", "Ultrasound pending", "Follow up after completing exams.", "Allergy-history test patient."),
    makePatient("P010", "Zheng Qiang", "Male", 58, "Respiratory Medicine", "Follow-up Visit", "In Progress", "Urban Employee Medical Insurance", "Worsening chronic cough.", "Cough with sputum for years; sputum increased over the past three days.", "History of COPD.", "None", "SpO2 96%,Coarse breath sounds bilaterally", "COPD follow-up", "Chest X-ray pending", "Regular inhalation therapy and avoid cold exposure.", "Respiratory follow-up sample."),
    makePatient("P011", "Ma Li", "Female", 24, "Ophthalmology", "Initial Visit", "Waiting", "Commercial Insurance", "Right-eye redness and itching for one day.", "Foreign-body sensation in the right eye with mild tearing; no obvious vision loss.", "No special medical history.", "None", "Right conjunctival congestion", "Conjunctivitis to be ruled out", "Slit-lamp exam pending", "Pay attention to eye hygiene.", "Ophthalmology sample."),
    makePatient("P012", "Hu Bin", "Male", 49, "Urology", "Initial Visit", "In Progress", "Urban/Rural Resident Medical Insurance", "Urinary frequency and urgency for three days.", "Urinary frequency and urgency with dysuria; no gross hematuria.", "History of benign prostatic hyperplasia.", "None", "Mild lower abdominal tenderness", "Urinary tract infection to be ruled out", "Urinalysis pending", "Treat after completing urine testing.", "Urology sample."),
    makePatient("P013", "Guo Jing", "Female", 33, "Dentistry", "Follow-up Visit", "In Progress", "Self-pay", "Follow-up for swollen and painful gums.", "Gum swelling and pain improved, still with chewing discomfort.", "History of periodontitis.", "None", "Mild gingival redness and swelling", "Periodontitis follow-up", "Dental imaging pending", "Continue oral care.", "Dentistry sample."),
    makePatient("P014", "He Wei", "Male", 62, "Cardiology", "Follow-up Visit", "In Progress", "Urban Employee Medical Insurance", "Follow-up for fluctuating blood pressure.", "Home blood-pressure records fluctuate with occasional head fullness.", "Ten-year history of hypertension.", "None", "BP 148/86mmHg", "Hypertension follow-up", "ECG pending", "Adjust lifestyle and monitor blood pressure.", "Chronic disease management sample."),
    makePatient("P015", "Gao Qian", "Female", 30, "Obstetrics", "Initial Visit", "In Progress", "Urban/Rural Resident Medical Insurance", "Early-pregnancy registration consultation.", "Positive home test after missed period with mild nausea; no abdominal pain or bleeding.", "No special medical history.", "None", "Vital signs stable", "Early pregnancy registration", "Prenatal exam pending", "Schedule prenatal exam.", "Obstetrics sample."),
    makePatient("P016", "Liang Feng", "Male", 40, "Emergency Department", "Initial Visit", "Completed", "Self-pay", "Fever with fatigue for one day.", "Maximum temperature 38.5C, with generalized fatigue and no obvious chest tightness.", "No known chronic medical history.", "None", "T 38.1C,P 96bpm", "Fever to be investigated", "CBC pending", "Observe after antipyretic treatment.", "Completed emergency visit sample."),
    makePatient("P017", "Song Jia", "Female", 47, "Rehabilitation Medicine", "Follow-up Visit", "Waiting", "Commercial Insurance", "Follow-up for low-back pain rehabilitation.", "Low-back pain improved but discomfort persists after prolonged sitting.", "History of lumbar disc herniation.", "None", "Mild limitation of lumbar movement", "Low-back pain rehabilitation follow-up", "Rehabilitation assessment pending", "Continue rehabilitation training.", "Rehabilitation sample."),
    makePatient("P018", "Pan Yu", "Male", 22, "Infectious Diseases", "Initial Visit", "In Progress", "Urban/Rural Resident Medical Insurance", "Diarrhea for two days.", "Watery diarrhea about five times daily with mild abdominal pain.", "No special medical history.", "None", "Soft abdomen with active bowel sounds", "Acute gastroenteritis to be ruled out", "Stool test pending", "Fluid replacement and observation.", "Infectious diseases sample."),
    makePatient("P019", "Du Juan", "Female", 55, "Oncology", "Follow-up Visit", "In Progress", "Urban Employee Medical Insurance", "Postoperative follow-up consultation.", "Postoperative follow-up with no obvious new discomfort.", "History of breast-surgery follow-up.", "Allergy to iodinated contrast.", "Vital signs stable", "Oncology postoperative follow-up", "Imaging follow-up pending", "Follow up as scheduled.", "Oncology follow-up sample."),
    makePatient("P020", "Yuan Hao", "Male", 37, "General Surgery", "Initial Visit", "Waiting", "Urban Employee Medical Insurance", "Right lower abdominal pain for half a day.", "Persistent dull right lower abdominal pain, worse after activity, with mild nausea.", "No known chronic medical history.", "None", "Right lower abdominal tenderness", "Abdominal pain to be investigated", "Abdominal ultrasound pending", "Treat after completing exams.", "P020 regression test patient.")
  ];
  const demoPatientIds = new Set(demoPatients.map(function (patient) { return patient.patientId; }));

  let channel = null;
  const subscribers = new Set();

  function makePatient(id, name, gender, age, department, visitType, visitStatus, insuranceType, chiefComplaint, presentIllness, pastHistory, allergyHistory, vitalSigns, diagnosis, examSummary, orders, note) {
    const birthYear = 2026 - Number(age || 0);
    const serial = id.replace(/\D/g, "").padStart(3, "0");
    return {
      patientId: id,
      name: name,
      gender: gender,
      age: age,
      birthDate: birthYear + "-03-12",
      phone: "13810010" + serial,
      idType: "National ID",
      idNumber: "IDTEST" + birthYear + "0312" + serial,
      address: "Evaluation Address " + serial + "",
      emergencyContact: name.slice(0, 1) + " Family",
      emergencyPhone: "13820010" + serial,
      insuranceType: insuranceType,
      encounterId: "E20260611" + serial,
      visitDate: "2026-06-11",
      department: department,
      doctor: "Attending Clinician",
      visitType: visitType,
      visitStatus: visitStatus,
      chiefComplaint: chiefComplaint,
      presentIllness: presentIllness,
      pastHistory: pastHistory,
      allergyHistory: allergyHistory,
      vitalSigns: vitalSigns,
      diagnosis: diagnosis,
      examSummary: examSummary,
      orders: orders,
      note: note,
      dataSource: "Browser Workspace",
      lastModifiedAt: "",
      lastModifiedSource: ""
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeVisiblePatientText(value) {
    return String(value || "")
      .replace(/localStorage Demo/gi, "Browser Workspace")
      .replace(/Demo Doctor/gi, "Attending Clinician")
      .replace(/Demo Address/gi, "Evaluation Address")
      .replace(/Demo data for HIS prototype only\./gi, "Baseline evaluation record.")
      .replace(/\bplaceholder\b/gi, "pending")
      .replace(/\bprototype\b/gi, "research")
      .replace(/\bdemo\b/gi, "evaluation");
  }

  function normalizePatient(patient) {
    const base = {};
    (schema.fields || []).forEach(function (field) {
      base[field.key] = patient && patient[field.key] !== undefined ? patient[field.key] : "";
    });
    base.patientId = String(base.patientId || "").toUpperCase();
    base.name = base.name || "Unnamed patient";
    base.dataSource = normalizeVisiblePatientText(patient && patient.dataSource ? patient.dataSource : "Browser Workspace");
    base.lastModifiedAt = patient && patient.lastModifiedAt ? patient.lastModifiedAt : "";
    base.lastModifiedSource = normalizeVisiblePatientText(patient && patient.lastModifiedSource ? patient.lastModifiedSource : "");
    base.doctor = normalizeVisiblePatientText(base.doctor);
    base.address = normalizeVisiblePatientText(base.address);
    base.examSummary = normalizeVisiblePatientText(base.examSummary);
    base.note = normalizeVisiblePatientText(base.note);
    if (!base.chiefComplaint && patient && patient.symptoms) base.chiefComplaint = patient.symptoms;
    if (!base.pastHistory && patient && patient.medicalHistory) base.pastHistory = patient.medicalHistory;
    if (!base.allergyHistory && patient && patient.allergyNote) base.allergyHistory = patient.allergyNote;
    if (!base.note && patient && patient.remark) base.note = patient.remark;
    return base;
  }

  function mergeWithDemoSeed(patients) {
    const source = Array.isArray(patients) ? patients : [];
    const byId = new Map();
    source.forEach(function (patient) {
      const patientId = String(patient && patient.patientId || "").toUpperCase();
      if (patientId) byId.set(patientId, patient);
    });
    const merged = demoPatients.map(function (seed) {
      const existing = byId.get(seed.patientId);
      return existing ? normalizePatient(Object.assign({}, seed, existing, { patientId: seed.patientId })) : clone(seed);
    });
    source.forEach(function (patient) {
      const patientId = String(patient && patient.patientId || "").toUpperCase();
      if (patientId && !demoPatientIds.has(patientId)) {
        merged.push(normalizePatient(patient));
      }
    });
    return merged;
  }

  function shouldPersistMergedPatients(original, merged) {
    return JSON.stringify((original || []).map(normalizePatient)) !== JSON.stringify(merged);
  }

  function readPatients() {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const merged = mergeWithDemoSeed(parsed);
          if (shouldPersistMergedPatients(parsed, merged)) writePatients(merged, { silent: true });
          return merged;
        }
      }
      const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const parsedLegacy = JSON.parse(legacy);
        if (Array.isArray(parsedLegacy)) {
          const migrated = mergeWithDemoSeed(parsedLegacy);
          writePatients(migrated, { silent: true });
          return migrated;
        }
      }
    } catch (error) {
      console.warn("patient-store read failed", error);
    }
    writePatients(demoPatients, { silent: true });
    return clone(demoPatients);
  }

  function writePatients(patients, options) {
    const next = clone(patients || []).map(normalizePatient);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (!options || !options.silent) notify(next);
    return next;
  }

  function readAuditLog() {
    try {
      const saved = window.localStorage.getItem(AUDIT_KEY) || window.localStorage.getItem(LEGACY_AUDIT_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function writeAuditLog(entries) {
    const next = clone(entries || []).slice(-500);
    window.localStorage.setItem(AUDIT_KEY, JSON.stringify(next));
    return next;
  }

  function appendAudit(entry) {
    const log = readAuditLog();
    const item = Object.assign({
      audit_id: "audit_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
      timestamp: new Date().toISOString(),
      patientId: "",
      patientName: "",
      field: "",
      fieldLabel: "",
      oldValue: "",
      newValue: "",
      actor: "user",
      source: "manual",
      task_id: "",
      pageType: "",
      instruction: "",
      reason: "",
      canRollback: false
    }, entry || {});
    item.fieldLabel = item.fieldLabel || schema.getFieldLabel(item.field);
    log.push(item);
    writeAuditLog(log);
    return clone(item);
  }

  function recordFieldAudits(before, after, fields, meta) {
    const settings = meta || {};
    (fields || []).forEach(function (field) {
      if (!before || !after || before[field] === after[field]) return;
      appendAudit({
        patientId: after.patientId,
        patientName: after.name,
        field: field,
        fieldLabel: schema.getFieldLabel(field),
        oldValue: before[field],
        newValue: after[field],
        actor: settings.actor || "user",
        source: settings.source || "manual",
        task_id: settings.task_id || "",
        pageType: settings.pageType || "patientEditor",
        instruction: settings.instruction || "",
        reason: settings.reason || "",
        canRollback: Boolean(settings.canRollback)
      });
    });
  }

  function notify(patients, options) {
    const settings = options || {};
    const next = clone(patients || readPatients());
    subscribers.forEach(function (callback) {
      try { callback(next); } catch (error) { console.warn("patient-store subscriber failed", error); }
    });
    if (channel && !settings.silentBroadcast) {
      channel.postMessage({ type: "patients_changed", patients: next });
    }
  }

  function getAllPatients() {
    return clone(readPatients());
  }

  function getPatientById(patientId) {
    const id = String(patientId || "").toUpperCase();
    return clone(readPatients().find(function (patient) { return patient.patientId === id; }) || null);
  }

  function compactText(value, limit) {
    const text = String(value == null ? "" : value).trim();
    const max = Number(limit || 80);
    return text.length > max ? text.slice(0, max) + "..." : text;
  }

  function normalizeLookup(value) {
    return String(value == null ? "" : value).trim().toLowerCase();
  }

  function compactPatientForIndex(patient) {
    return {
      patientId: patient.patientId,
      name: patient.name,
      gender: patient.gender,
      age: patient.age,
      birthDate: patient.birthDate,
      phone: patient.phone,
      idType: patient.idType,
      idNumber: patient.idNumber,
      department: patient.department,
      visitType: patient.visitType,
      insuranceType: patient.insuranceType,
      address: compactText(patient.address, 60),
      chiefComplaint: compactText(patient.chiefComplaint, 80),
      presentIllness: compactText(patient.presentIllness, 100),
      allergyHistory: compactText(patient.allergyHistory, 80),
      medicalHistory: compactText(patient.medicalHistory || patient.pastHistory, 80),
      pastHistory: compactText(patient.pastHistory || patient.medicalHistory, 80)
    };
  }

  function getPatientIndex() {
    return readPatients().map(compactPatientForIndex);
  }

  function uniquePatients(matches) {
    const seen = new Set();
    const result = [];
    (matches || []).forEach(function (patient) {
      if (!patient || !patient.patientId || seen.has(patient.patientId)) return;
      seen.add(patient.patientId);
      result.push(patient);
    });
    return result;
  }

  function buildResolveResult(matches, matchType, reason) {
    const unique = uniquePatients(matches);
    const candidates = unique.map(compactPatientForIndex);
    if (unique.length === 1) {
      return {
        ok: true,
        matchType: matchType || "unique_match",
        patient: compactPatientForIndex(unique[0]),
        candidates: candidates
      };
    }
    return {
      ok: false,
      reason: reason || (unique.length > 1 ? "multiple_matches" : "not_found"),
      matchType: matchType || "",
      patient: null,
      candidates: candidates
    };
  }

  function resolvePatientSelector(selector, options) {
    const settings = options || {};
    let input = selector;
    if (input && typeof input === "object" && input.patientSelector && typeof input.patientSelector === "object") {
      input = input.patientSelector;
    }
    if (typeof input === "string") {
      input = { query: input };
    }
    input = input && typeof input === "object" ? input : {};
    const patients = Array.isArray(settings.patients) ? settings.patients.map(normalizePatient) : readPatients();
    const patientId = normalizeLookup(input.patientId || input.patient_id || input.id);
    const phone = normalizeLookup(input.phone || input.mobile);
    const idNumber = normalizeLookup(input.idNumber || input.id_number || input.identityNumber);
    const name = String(input.name || input.patientName || input.patient_name || "").trim();
    const query = String(input.query || input.value || input.text || "").trim();
    const queryKey = normalizeLookup(query);

    if (patientId) {
      return buildResolveResult(patients.filter(function (patient) {
        return normalizeLookup(patient.patientId) === patientId;
      }), "exact_patientId");
    }
    if (phone) {
      return buildResolveResult(patients.filter(function (patient) {
        return normalizeLookup(patient.phone) === phone;
      }), "exact_phone");
    }
    if (idNumber) {
      return buildResolveResult(patients.filter(function (patient) {
        return normalizeLookup(patient.idNumber) === idNumber;
      }), "exact_idNumber");
    }
    if (name) {
      const exactName = patients.filter(function (patient) { return patient.name === name; });
      if (exactName.length) return buildResolveResult(exactName, "exact_name");
      return buildResolveResult(patients.filter(function (patient) {
        return patient.name.includes(name) || name.includes(patient.name);
      }), "partial_name");
    }
    if (queryKey) {
      const exactQuery = patients.filter(function (patient) {
        return normalizeLookup(patient.patientId) === queryKey ||
          normalizeLookup(patient.phone) === queryKey ||
          normalizeLookup(patient.idNumber) === queryKey ||
          normalizeLookup(patient.name) === queryKey;
      });
      if (exactQuery.length) return buildResolveResult(exactQuery, "exact_query");
      return buildResolveResult(patients.filter(function (patient) {
        return patient.name.includes(query) ||
          query.includes(patient.name) ||
          normalizeLookup(patient.patientId).includes(queryKey) ||
          normalizeLookup(patient.phone).includes(queryKey) ||
          normalizeLookup(patient.idNumber).includes(queryKey);
      }), "partial_query");
    }
    return buildResolveResult([], "", "missing_selector");
  }

  function updatePatient(patientId, patch, meta) {
    const id = String(patientId || "").toUpperCase();
    const patients = readPatients();
    const index = patients.findIndex(function (patient) { return patient.patientId === id; });
    if (index < 0) return { success: false, message: "Patient not found: " + id };
    const before = clone(patients[index]);
    const changedFields = [];
    Object.keys(patch || {}).forEach(function (field) {
      if (!editableFields.has(field)) return;
      patients[index][field] = patch[field];
      changedFields.push(field);
    });
    if (!changedFields.length) return { success: true, patient: clone(patients[index]), message: "No fields to update." };
    patients[index].lastModifiedAt = new Date().toISOString();
    patients[index].lastModifiedSource = (meta && meta.source) || "manual";
    writePatients(patients);
    recordFieldAudits(before, patients[index], changedFields, Object.assign({ canRollback: true }, meta || {}));
    return { success: true, patient: clone(patients[index]), changedFields: changedFields, message: "Patient information updated." };
  }

  function replacePatient(patientId, nextPatient, meta) {
    const id = String(patientId || "").toUpperCase();
    const patch = {};
    Object.keys(nextPatient || {}).forEach(function (key) {
      if (editableFields.has(key)) patch[key] = nextPatient[key];
    });
    return updatePatient(id, patch, Object.assign({ canRollback: false }, meta || {}));
  }

  function rollbackAudit(auditId) {
    const audit = readAuditLog().find(function (item) { return item.audit_id === auditId; });
    if (!audit || !audit.canRollback || audit.source !== "backend_llm" || !audit.patientId || !audit.field) {
      return { success: false, message: "This audit record cannot be rolled back." };
    }
    const result = updatePatient(audit.patientId, Object.fromEntries([[audit.field, audit.oldValue]]), {
      actor: "user",
      source: "manual",
      task_id: audit.task_id || "",
      pageType: audit.pageType || "patientEditor",
      instruction: "Undo Latest Agent Change",
      reason: "rollback:" + audit.audit_id,
      canRollback: false
    });
    if (result.success) {
      appendAudit({
        patientId: audit.patientId,
        patientName: audit.patientName,
        field: audit.field,
        fieldLabel: audit.fieldLabel || schema.getFieldLabel(audit.field),
        oldValue: audit.newValue,
        newValue: audit.oldValue,
        actor: "user",
        source: "manual",
        task_id: audit.task_id || "",
        pageType: audit.pageType || "patientEditor",
        instruction: "Undo Agent change",
        reason: "rollback:" + audit.audit_id,
        canRollback: false
      });
    }
    return result;
  }

  function getLastAgentRollbackCandidate(patientId) {
    const id = String(patientId || "").toUpperCase();
    return clone(readAuditLog().slice().reverse().find(function (item) {
      return item.patientId === id && item.actor === "agent" && item.source === "backend_llm" && item.canRollback;
    }) || null);
  }

  function getAuditLog(patientId) {
    const id = String(patientId || "").toUpperCase();
    const log = readAuditLog();
    return clone(id ? log.filter(function (item) { return item.patientId === id; }) : log);
  }

  function subscribePatientChanges(callback) {
    subscribers.add(callback);
    return function () { subscribers.delete(callback); };
  }

  function resetDemoPatients() {
    return writePatients(demoPatients);
  }

  function findPatients(query) {
    const text = String(query || "").trim().toLowerCase();
    if (!text) return getAllPatients();
    return getAllPatients().filter(function (patient) {
      return Array.from(allFields).some(function (key) {
        return String(patient[key] || "").toLowerCase().includes(text);
      });
    });
  }

  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = function (event) {
      if (event.data && event.data.type === "patients_changed") {
        notify(event.data.patients, { silentBroadcast: true });
      }
    };
  }

  window.addEventListener("storage", function (event) {
    if (event.key === STORAGE_KEY) notify(readPatients(), { silentBroadcast: true });
  });

  window.PatientStore = {
    getAllPatients: getAllPatients,
    getPatientById: getPatientById,
    getPatientIndex: getPatientIndex,
    resolvePatientSelector: resolvePatientSelector,
    updatePatient: updatePatient,
    replacePatient: replacePatient,
    subscribePatientChanges: subscribePatientChanges,
    resetDemoPatients: resetDemoPatients,
    findPatients: findPatients,
    getAuditLog: getAuditLog,
    appendAudit: appendAudit,
    rollbackAudit: rollbackAudit,
    getLastAgentRollbackCandidate: getLastAgentRollbackCandidate,
    getFieldLabel: schema.getFieldLabel,
    getEditableFields: function () { return Array.from(editableFields); }
  };
})();
