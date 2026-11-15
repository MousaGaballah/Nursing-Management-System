/* ============================================================
   documentation.js — nursing notes & records
   ============================================================ */
"use strict";

function addDocRecord({ patientId, taskId, note, nurseId, type = "Observation" }) {
  const sess = Session.get();
  DB.data.documentation.unshift({
    id: uid("doc"),
    patientId,
    taskId: taskId || null,
    nurseId: nurseId || sess.nurseId,
    nurseName: sess.name,
    type,
    note,
    at: nowISO()
  });
  audit("Documentation created", `Patient ${getPatientById(patientId)?.code || ""}`);
  DB.save();
}

function renderNurseDocPage(container) {
  const sess = Session.get();
  if (!sess || sess.role !== "nurse") return;

  const myPatients = DB.data.patients.filter(p => p.assignedNurseId === sess.nurseId);
  const myDocs = DB.data.documentation.filter(d => d.nurseId === sess.nurseId);

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Nursing Documentation</h1>
        <p>Record nursing observations, completed tasks, and patient notes.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="addDocBtn"><i class="fa-solid fa-file-medical"></i> Add Note</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title"><i class="fa-solid fa-clock-rotate-left"></i> Recent Documentation (${myDocs.length})</div>
      ${myDocs.length === 0 ? `<div class="empty-state"><i class="fa-solid fa-file-medical"></i><h4>No notes yet</h4><p>Click "Add Note" to record nursing observations.</p></div>` : myDocs.map(d => {
        const p = getPatientById(d.patientId);
        const t = d.taskId ? DB.data.tasks.find(x => x.id === d.taskId) : null;
        return `
          <div class="doc-entry">
            <strong>${esc(p ? `${p.code} – ${p.name}` : "Unknown patient")} ${t ? ` · Task: ${esc(t.name)}` : ""}</strong>
            <div>${esc(d.note)}</div>
            <small><i class="fa-solid fa-user"></i> ${esc(d.nurseName)} · ${fmtDateTime(d.at)} · ${esc(d.type)}</small>
          </div>
        `;
      }).join("")}
    </div>
  `;

  $("#addDocBtn").onclick = () => {
    if (!myPatients.length) { toast("You have no assigned patients to document for.", "warning"); return; }
    Modal.open({
      title: "Add Nursing Note",
      body: `
        <form id="docForm">
          <div style="margin-bottom:12px">
            <label style="font-size:12px;font-weight:600;color:var(--text-soft)">Patient</label>
            <select id="docPatient">${myPatients.map(p => `<option value="${p.id}">${esc(p.code)} – ${esc(p.name)}</option>`).join("")}</select>
          </div>
          <div style="margin-bottom:12px">
            <label style="font-size:12px;font-weight:600;color:var(--text-soft)">Type</label>
            <select id="docType">
              <option>Observation</option>
              <option>Task Execution</option>
              <option>Patient Complaint</option>
              <option>Handover</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;color:var(--text-soft)">Note</label>
            <textarea id="docNote" placeholder="Describe observation, action taken, and patient response..." style="min-height:100px"></textarea>
          </div>
        </form>
      `,
      footer: `
        <button class="btn btn-outline" id="docCancel">Cancel</button>
        <button class="btn btn-primary" id="docSave">Save Note</button>
      `,
      onMount() {
        $("#docCancel").onclick = () => Modal.close();
        $("#docSave").onclick = () => {
          const note = $("#docNote").value.trim();
          if (!note) { toast("Note cannot be empty.", "error"); return; }
          addDocRecord({
            patientId: $("#docPatient").value,
            type: $("#docType").value,
            note
          });
          toast("Note saved.", "success");
          Modal.close();
          Router.refresh();
        };
      }
    });
  };
}