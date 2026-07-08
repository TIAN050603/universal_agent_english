(function () {
  "use strict";

  const fieldSchema = [
    { key: "patientId", label: "Patient ID", group: "Basic Information", type: "text", editable: false, aliases: ["Patient ID", "Patient ID"], showInManagement: true, showInEditor: true },
    { key: "name", label: "Name", group: "Basic Information", type: "text", editable: true, aliases: ["Name", "given name"], showInManagement: true, showInEditor: true },
    { key: "gender", label: "Gender", group: "Basic Information", type: "select", editable: true, options: ["Male", "Female", "Other"], aliases: ["Gender"], showInManagement: true, showInEditor: true },
    { key: "age", label: "Age", group: "Basic Information", type: "number", editable: true, aliases: ["Age"], showInManagement: true, showInEditor: true },
    { key: "birthDate", label: "Date of Birth", group: "Basic Information", type: "date", editable: true, aliases: ["Date of Birth", "birthday"], showInManagement: false, showInEditor: true },
    { key: "phone", label: "Phone", group: "Basic Information", type: "text", editable: true, aliases: ["Phone", "Phonefield", "mobile", "phone", "contact phone", "contact number"], showInManagement: true, showInEditor: true },
    { key: "idType", label: "ID Type", group: "Basic Information", type: "select", editable: true, options: ["National ID", "Passport", "Hong Kong/Macau Permit", "Other"], aliases: ["ID Type"], showInManagement: false, showInEditor: true },
    { key: "idNumber", label: "ID Number", group: "Basic Information", type: "text", editable: true, aliases: ["ID Number", "National ID number"], showInManagement: false, showInEditor: true },
    { key: "address", label: "Address", group: "Basic Information", type: "text", editable: true, aliases: ["Address", "residential address", "residential address"], showInManagement: false, showInEditor: true },
    { key: "emergencyContact", label: "Emergency Contact", group: "Basic Information", type: "text", editable: true, aliases: ["Emergency Contact"], showInManagement: false, showInEditor: true },
    { key: "emergencyPhone", label: "Emergency Contact Phone", group: "Basic Information", type: "text", editable: true, aliases: ["emergency phone", "Emergency Contact Phone"], showInManagement: false, showInEditor: true },
    { key: "insuranceType", label: "Insurance Type", group: "Basic Information", type: "select", editable: true, options: ["Urban Employee Medical Insurance", "Urban/Rural Resident Medical Insurance", "Commercial Insurance", "Self-pay", "Other"], aliases: ["medical insurance", "Insurance Type"], showInManagement: false, showInEditor: true },
    { key: "encounterId", label: "Encounter ID", group: "Current Visit", type: "text", editable: false, aliases: ["Encounter ID", "visitId"], showInManagement: false, showInEditor: true },
    { key: "visitDate", label: "Visit Date", group: "Current Visit", type: "date", editable: true, aliases: ["Visit Date"], showInManagement: false, showInEditor: true },
    { key: "department", label: "Department", group: "Current Visit", type: "select", editable: true, options: ["Respiratory Medicine", "Gastroenterology", "Cardiology", "Neurology", "Orthopedics", "Dermatology", "Pediatrics", "Ophthalmology", "ENT", "Emergency Department"], aliases: ["Department", "Department"], showInManagement: true, showInEditor: true },
    { key: "doctor", label: "Attending Doctor", group: "Current Visit", type: "text", editable: true, aliases: ["Doctor", "Attending Doctor"], showInManagement: false, showInEditor: true },
    { key: "visitType", label: "Visit Type", group: "Current Visit", type: "select", editable: true, options: ["Initial Visit", "Follow-up Visit", "Emergency Visit"], aliases: ["Visit Type"], showInManagement: false, showInEditor: true },
    { key: "visitStatus", label: "Visit Status", group: "Current Visit", type: "select", editable: true, options: ["Waiting", "In Progress", "Completed"], aliases: ["Visit Status"], showInManagement: true, showInEditor: true },
    { key: "chiefComplaint", label: "Chief Complaint", group: "Clinical Note", type: "textarea", editable: true, aliases: ["Chief Complaint", "Symptom Description"], showInManagement: true, showInEditor: true },
    { key: "presentIllness", label: "Present Illness", group: "Clinical Note", type: "textarea", editable: true, aliases: ["Present Illness", "Current Illness History"], showInManagement: false, showInEditor: true },
    { key: "pastHistory", label: "Past History", group: "Clinical Note", type: "textarea", editable: true, aliases: ["Past History", "Past Medical History"], showInManagement: false, showInEditor: true },
    { key: "medicalHistory", label: "Past Medical History", group: "Compatibility Field", type: "textarea", editable: true, aliases: ["medical history", "legacy past medical history field"], showInManagement: false, showInEditor: false },
    { key: "allergyHistory", label: "Allergy History", group: "Clinical Note", type: "textarea", editable: true, aliases: ["Allergy History", "Allergy Notes"], showInManagement: false, showInEditor: true },
    { key: "vitalSigns", label: "Vital Signs", group: "Clinical Note", type: "textarea", editable: true, aliases: ["Vital Signs", "Signs"], showInManagement: false, showInEditor: true },
    { key: "diagnosis", label: "Diagnosis", group: "Clinical Note", type: "textarea", editable: true, aliases: ["Diagnosis"], showInManagement: false, showInEditor: true },
    { key: "examSummary", label: "Exams / Labs", group: "Clinical Note", type: "textarea", editable: true, aliases: ["Exams / Labs", "Exam", "Lab"], showInManagement: false, showInEditor: true },
    { key: "orders", label: "Orders / Prescription", group: "Clinical Note", type: "textarea", editable: true, aliases: ["Orders", "Prescription"], showInManagement: false, showInEditor: true },
    { key: "note", label: "Notes", group: "Clinical Note", type: "textarea", editable: true, aliases: ["Notes", "Description"], showInManagement: false, showInEditor: true }
  ];

  const byKey = Object.fromEntries(fieldSchema.map(function (field) { return [field.key, field]; }));
  const aliasToKey = {};
  fieldSchema.forEach(function (field) {
    [field.key, field.label].concat(field.aliases || []).forEach(function (alias) {
      const key = normalizeFieldText(alias);
      if (key) aliasToKey[key] = field.key;
    });
  });
  aliasToKey[normalizeFieldText("Past History")] = "pastHistory";
  aliasToKey[normalizeFieldText("Past Medical History")] = "pastHistory";
  aliasToKey[normalizeFieldText("past medical history content")] = "pastHistory";
  aliasToKey[normalizeFieldText("medical history")] = "pastHistory";
  aliasToKey[normalizeFieldText("past history")] = "pastHistory";
  aliasToKey[normalizeFieldText("past medical history")] = "pastHistory";
  aliasToKey[normalizeFieldText("medical history")] = "pastHistory";
  aliasToKey[normalizeFieldText("medicalHistory")] = "pastHistory";

  function getField(key) {
    return byKey[key] || null;
  }

  function getEditableFields() {
    return fieldSchema.filter(function (field) { return field.editable; });
  }

  function getFieldLabel(key) {
    const field = getField(key);
    return field ? field.label : key;
  }

  function normalizeFieldText(value) {
    return String(value == null ? "" : value)
      .trim()
      .toLowerCase()
      .replace(/[: :]/g, "")
      .replace(/\s+/g, "")
      .replace(/field$/g, "");
  }

  function resolvePatientField(selector) {
    let input = selector;
    if (input && typeof input === "object") {
      input = input.field || input.fieldKey || input.fieldLabel || input.label || input.query || input.name || input.value || "";
    }
    const query = String(input == null ? "" : input).trim();
    const normalized = normalizeFieldText(query);
    if (!normalized) {
      return { ok: false, reason: "field_not_found", query: query, candidates: candidateFields() };
    }
    if (aliasToKey[normalized] && byKey[aliasToKey[normalized]] && byKey[aliasToKey[normalized]].editable) {
      return fieldResult(byKey[aliasToKey[normalized]], aliasToKey[normalized] === query ? "key" : "alias", query);
    }
    if (byKey[query] && byKey[query].editable && byKey[query].showInEditor !== false) {
      return fieldResult(byKey[query], "key", query);
    }
    const partial = fieldSchema.filter(function (field) {
      if (!field.editable) return false;
      const names = [field.key, field.label].concat(field.aliases || []).map(normalizeFieldText);
      return names.some(function (name) { return name && (name.includes(normalized) || normalized.includes(name)); });
    });
    if (partial.length === 1) {
      return fieldResult(partial[0], "partial_alias", query);
    }
    return {
      ok: false,
      reason: partial.length > 1 ? "multiple_fields" : "field_not_found",
      query: query,
      candidates: (partial.length ? partial : fieldSchema.filter(function (field) { return field.editable; })).map(function (field) {
        return { field: field.key, fieldLabel: field.label, aliases: field.aliases || [] };
      }).slice(0, 20)
    };
  }

  function fieldResult(field, matchType, query) {
    return {
      ok: true,
      field: field.key,
      fieldLabel: field.label,
      fieldType: field.type,
      options: field.options || [],
      matchType: matchType,
      query: query
    };
  }

  function candidateFields() {
    return fieldSchema.filter(function (field) { return field.editable; }).map(function (field) {
      return { field: field.key, fieldLabel: field.label, aliases: field.aliases || [] };
    }).slice(0, 20);
  }

  function getManagementColumns() {
    return ["patientId", "name", "gender", "age", "phone", "department", "visitStatus", "chiefComplaint", "lastModifiedAt"];
  }

  window.PatientFieldSchema = {
    fields: fieldSchema.slice(),
    byKey: byKey,
    getField: getField,
    getEditableFields: getEditableFields,
    getFieldLabel: getFieldLabel,
    resolvePatientField: resolvePatientField,
    getManagementColumns: getManagementColumns
  };
})();
