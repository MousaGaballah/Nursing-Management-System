/* ============================================================
   patients.js — patient CRUD & listing
   ============================================================ */
"use strict";

function getPatients() { return DB.data.patients; }
function getPatientById(id) { return DB.data.patients.find(p => p.id === id); }

function isAssignmentLocked() {
  const shift = getActiveShift();
  if (!shift) return false;
  return !!DB.data.assignmentLock[shift.id]?.locked;
}

function renderPatientsPage(container) {
  const locked = isAssignmentLocked();

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Patient Management</h1>
        <p>Register patients, record care needs, and view assignments. ${locked ? '<span class="badge purple" style="margin-left:6px"><i class="fa-solid fa-lock"></i> Assignment Locked</span>' : ""}</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="addPatientBtn"><i class="fa-solid fa-plus"></i> Add Patient</button>
      </div>
    </div>

    <div class="filter-bar">
      <input type="text" id="patientSearch" class="search-input" placeholder="Search by name, code, bed, diagnosis..." />
      <select id="patientAcuityFilter">
        <option value="">All Acuity Levels</option>
        <option value="1">Level 1 – Low</option>
        <option value="2">Level 2 – Moderate</option>
        <option value="3">Level 3 – High</option>
        <option value="4">Level 4 – Critical</option>
      </select>
      <select id="patientAssignFilter">
        <option value="">All Patients</option>
        <option value="assigned">Assigned</option>
        <option value="unassigned">Unassigned</option>
      </select>
    </div>

    <div class="card">
      <div id="patientTableContainer"></div>
    </div>
  `;

  function renderTable() {
    const q = $("#patientSearch").value.trim().toLowerCase();
    const acuity = $("#patientAcuityFilter").value;
    const assign = $("#patientAssignFilter").value;

    const list = DB.data.patients.filter(p => {
      if (acuity && String(p.acuity) !== acuity) return false;
      if (assign === "assigned" && !p.assignedNurseId) return false;
      if (assign === "unassigned" && p.assignedNurseId) return false;
      if (q) {
        const blob = `${p.name} ${p.code} ${p.bed} ${p.diagnosis} ${p.condition}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });

    const wrap = $("#patientTableContainer");
    if (!list.length) {
      wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-bed-pulse"></i><h4>No patients found</h4><p>Try adjusting filters or add a new patient.</p></div>`;
      return;
    }

    const acuityLabel = (a) => {
      const map = { 1: "Low", 2: "Moderate", 3: "High", 4: "Critical" };
      return map[a] || "—";
    };

    const rows = list.map(p => {
      const nurse = p.assignedNurseId ? getNurseById(p.assignedNurseId) : null;
      return `
      <tr>
        <td class="cell-strong">${esc(p.name)}<div class="cell-sub">${esc(p.code)} · ${esc(p.bed)}</div></td>
        <td>${esc(p.diagnosis)}<div class="cell-sub">${esc(p.condition)}</div></td>
        <td><span class="meter"><span class="dot level-${p.acuity}"></span>${acuityLabel(p.acuity)}</span></td>
        <td><div class="cell-sub">${(p.careNeeds||[]).slice(0,2).map(c=>`<span class="badge low" style="margin:1px">${esc(c)}</span>`).join("")}${(p.careNeeds||[]).length>2 ? `<span class="cell-sub"> +${p.careNeeds.length-2}</span>`:""}</div></td>
        <td>${nurse ? `<span class="badge teal"><i class="fa-solid fa-user-nurse"></i> ${esc(nurse.name)}</span>` : `<span class="badge low">Unassigned</span>`}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn-sm btn-outline" data-view="${p.id}"><i class="fa-solid fa-eye"></i></button>
            ${!locked ? `<button class="btn btn-sm btn-outline" data-edit="${p.id}"><i class="fa-solid fa-pen"></i></button>` : ""}
            ${!locked ? `<button class="btn btn-sm btn-danger" data-del="${p.id}"><i class="fa-solid fa-trash"></i></button>` : ""}
          </div>
        </td>
      </tr>`;
    }).join("");

    wrap.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Patient</th><th>Diagnosis</th><th>Acuity</th><th>Care Needs</th><th>Assigned Nurse</th><th>Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    $$("[data-view]", wrap).forEach(b => b.onclick = () => viewPatient(b.dataset.view));
    $$("[data-edit]", wrap).forEach(b => b.onclick = () => openPatientForm(b.dataset.edit));
    $$("[data-del]", wrap).forEach(b => b.onclick = () => deletePatient(b.dataset.del));
  }

  $("#patientSearch").addEventListener("input", renderTable);
  $("#patientAcuityFilter").addEventListener("change", renderTable);
  $("#patientAssignFilter").addEventListener("change", renderTable);

  $("#addPatientBtn").onclick = () => {
    if (locked) { toast("Cannot add patients after assignment is locked.", "warning"); return; }
    openPatientForm(null);
  };

  renderTable();
}

function openPatientForm(patientId) {
  const editing = patientId ? getPatientById(patientId) : null;
  const nextNum = DB.data.patients.length + 1;

  Modal.open({
    title: editing ? "Edit Patient" : "Add Patient",
    wide: true,
    body: `
      <form id="patientForm" class="form-grid">
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">Patient Name *</small></label>
          <input type="text" id="pfName" value="${esc(editing?.name || "")}" placeholder="Fictional name" required />
        </div>
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">Patient Code *</small></label>
          <input type="text" id="pfCode" value="${esc(editing?.code || `P-00${nextNum}`)}" required />
        </div>
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">Bed Number</small></label>
          <input type="text" id="pfBed" value="${esc(editing?.bed || `Bed ${100+nextNum}`)}" />
        </div>
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">Medical Record Number</small></label>
          <input type="text" id="pfMrn" value="${esc(editing?.mrn || `MRN-${1000+nextNum}`)}" />
        </div>
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">Medical Diagnosis *</small></label>
          <input type="text" id="pfDiagnosis" value="${esc(editing?.diagnosis || "")}" required />
        </div>
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">Relevant History</small></label>
          <input type="text" id="pfHistory" value="${esc(editing?.history || "")}" />
        </div>
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">General Condition</small></label>
          <select id="pfCondition">
            ${["Stable","Moderate","Critical"].map(c => `<option value="${c}" ${editing?.condition === c ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </div>
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">Acuity / Dependency Level *</small></label>
          <select id="pfAcuity">
            <option value="1" ${editing?.acuity === 1 ? "selected" : ""}>1 – Low</option>
            <option value="2" ${editing?.acuity === 2 ? "selected" : ""}>2 – Moderate</option>
            <option value="3" ${editing?.acuity === 3 ? "selected" : ""}>3 – High</option>
            <option value="4" ${editing?.acuity === 4 ? "selected" : ""}>4 – Critical</option>
          </select>
        </div>
        <div class="full">
          <label><small style="font-weight:600;color:var(--text-soft)">Required Nursing Care (comma-separated)</small></label>
          <input type="text" id="pfCareNeeds" value="${esc(editing?.careNeeds?.join(", ") || "Vital Signs Monitoring, Medication Administration")}" />
          <div class="form-hint">Example: Vital Signs Monitoring, Wound Dressing, Blood Glucose Monitoring</div>
        </div>
        <div class="full">
          <label><small style="font-weight:600;color:var(--text-soft)">Special Care Needs</small></label>
          <input type="text" id="pfSpecial" value="${esc(editing?.specialNeeds || "")}" />
        </div>
        <div class="full" id="pfError" style="color:var(--red);font-size:12px;font-weight:600;display:none"></div>
      </form>
    `,
    footer: `
      <button class="btn btn-outline" id="pfCancel">Cancel</button>
      <button class="btn btn-primary" id="pfSave">${editing ? "Update" : "Add Patient"}</button>
    `,
    onMount() {
      $("#pfCancel").onclick = () => Modal.close();
      $("#pfSave").onclick = () => {
        const errEl = $("#pfError");
        errEl.style.display = "none";
        const name = $("#pfName").value.trim();
        const code = $("#pfCode").value.trim();
        const diagnosis = $("#pfDiagnosis").value.trim();
        if (!name || !code || !diagnosis) {
          errEl.textContent = "Name, code, and diagnosis are required.";
          errEl.style.display = "block";
          return;
        }
        if (DB.data.patients.some(p => p.code.toLowerCase() === code.toLowerCase() && p.id !== patientId)) {
          errEl.textContent = "Patient code already exists.";
          errEl.style.display = "block";
          return;
        }
        const payload = {
          name, code,
          bed: $("#pfBed").value.trim(),
          mrn: $("#pfMrn").value.trim(),
          diagnosis,
          history: $("#pfHistory").value.trim(),
          condition: $("#pfCondition").value,
          acuity: Number($("#pfAcuity").value),
          careNeeds: $("#pfCareNeeds").value.split(",").map(s => s.trim()).filter(Boolean),
          specialNeeds: $("#pfSpecial").value.trim(),
          departmentId: getActiveShift()?.departmentId || DB.data.departments[0].id
        };
        if (editing) {
          Object.assign(editing, payload);
          audit("Patient updated", `${name} (${code})`);
          toast("Patient updated.", "success");
        } else {
          DB.data.patients.push({ id: uid("pat"), assignedNurseId: null, ...payload });
          audit("Patient added", `${name} (${code})`);
          toast("Patient added.", "success");
        }
        DB.save();
        Modal.close();
        Router.refresh();
      };
    }
  });
}

function viewPatient(id) {
  const p = getPatientById(id);
  if (!p) return;
  const nurse = p.assignedNurseId ? getNurseById(p.assignedNurseId) : null;
  const tasks = DB.data.tasks.filter(t => t.patientId === p.id);

  Modal.open({
    title: `Patient – ${p.name}`,
    wide: true,
    body: `
      <div class="grid-2" style="font-size:13px;line-height:1.9">
        <div>
          <div><strong>Code:</strong> ${esc(p.code)}</div>
          <div><strong>Bed:</strong> ${esc(p.bed)}</div>
          <div><strong>MRN:</strong> ${esc(p.mrn)}</div>
          <div><strong>Diagnosis:</strong> ${esc(p.diagnosis)}</div>
        </div>
        <div>
          <div><strong>Condition:</strong> ${esc(p.condition)}</div>
          <div><strong>Acuity:</strong> Level ${p.acuity}</div>
          <div><strong>Assigned Nurse:</strong> ${nurse ? esc(nurse.name) : "—"}</div>
          <div><strong>Special Needs:</strong> ${esc(p.specialNeeds || "—")}</div>
        </div>
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0" />
      <div class="card-title"><i class="fa-solid fa-hand-holding-medical"></i> Care Needs</div>
      <div>${(p.careNeeds||[]).map(c => `<span class="badge teal" style="margin:3px">${esc(c)}</span>`).join("") || "—"}</div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0" />
      <div class="card-title"><i class="fa-solid fa-list-check"></i> Tasks (${tasks.length})</div>
      ${tasks.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Task</th><th>Priority</th><th>Due</th><th>Status</th></tr></thead><tbody>
        ${tasks.map(t => `<tr><td>${esc(t.name)}</td><td><span class="badge ${t.priority.toLowerCase()}">${t.priority}</span></td><td>${esc(t.dueTime||"—")}</td><td><span class="badge ${t.status.toLowerCase().replace(" ","")}">${t.status}</span></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="empty-state" style="padding:10px">No tasks created yet.</p>`}
    `,
    footer: `<button class="btn btn-outline" onclick="Modal.close()">Close</button>`
  });
}

function deletePatient(id) {
  const p = getPatientById(id);
  if (!p) return;
  Modal.confirm({
    title: "Delete Patient",
    message: `Delete "${p.name}" (${p.code})? Related tasks will also be removed.`,
    confirmText: "Delete",
    danger: true,
    onConfirm: () => {
      DB.data.patients = DB.data.patients.filter(x => x.id !== id);
      DB.data.tasks = DB.data.tasks.filter(t => t.patientId !== id);
      DB.data.assignments = DB.data.assignments.filter(a => a.patientId !== id);
      audit("Patient deleted", `${p.name} (${p.code})`);
      DB.save();
      toast("Patient deleted.", "success");
      Router.refresh();
    }
  });
}