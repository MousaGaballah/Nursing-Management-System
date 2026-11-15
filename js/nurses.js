/* ============================================================
   nurses.js — nurse CRUD & listing
   ============================================================ */
"use strict";

function getNurses() { return DB.data.nurses; }
function getNurseById(id) { return DB.data.nurses.find(n => n.id === id); }

function renderNursesPage(container) {
  const sess = Session.get();
  const isAdmin = sess.role === "admin";
  const isHead = sess.role === "headnurse";

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Nurse Management</h1>
        <p>Manage nursing staff, qualifications, skills and availability.</p>
      </div>
      <div class="page-actions">
        ${isHead || isAdmin ? `<button class="btn btn-primary" id="addNurseBtn"><i class="fa-solid fa-plus"></i> Add Nurse</button>` : ""}
      </div>
    </div>

    <div class="filter-bar">
      <input type="text" id="nurseSearch" class="search-input" placeholder="Search by name, code or skill..." />
      <select id="nurseAvailFilter">
        <option value="">All Availability</option>
        <option value="available">Available</option>
        <option value="unavailable">Unavailable</option>
      </select>
      <select id="nurseShiftFilter">
        <option value="">All Shifts</option>
        <option value="Morning">Morning</option>
        <option value="Evening">Evening</option>
        <option value="Night">Night</option>
        <option value="Long">Long</option>
      </select>
    </div>

    <div class="card">
      <div id="nurseTableContainer"></div>
    </div>
  `;

  function renderTable() {
    const q = $("#nurseSearch").value.trim().toLowerCase();
    const avail = $("#nurseAvailFilter").value;
    const shift = $("#nurseShiftFilter").value;

    const list = DB.data.nurses.filter(n => {
      if (avail && n.availability !== avail) return false;
      if (shift && n.assignedShift !== shift) return false;
      if (q) {
        const blob = `${n.name} ${n.code} ${n.skills.join(" ")} ${n.qualification}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });

    const wrap = $("#nurseTableContainer");
    if (!list.length) {
      wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-user-slash"></i><h4>No nurses found</h4><p>Try adjusting filters or add a new nurse.</p></div>`;
      return;
    }

    const rows = list.map(n => {
      const patientsCount = DB.data.patients.filter(p => p.assignedNurseId === n.id).length;
      return `
      <tr>
        <td class="cell-strong">${esc(n.name)}<div class="cell-sub">${esc(n.code)}</div></td>
        <td>${esc(n.qualification)}<div class="cell-sub">${n.experience} yrs experience</div></td>
        <td><div class="cell-sub">${n.skills.map(s => `<span class="badge teal" style="margin:2px">${esc(s)}</span>`).join("")}</div></td>
        <td><span class="badge ${n.availability === "available" ? "available" : "unavailable"}">${n.availability}</span></td>
        <td>${esc(n.assignedShift || "—")}</td>
        <td><strong>${patientsCount}</strong></td>
        <td>
          <div class="table-actions">
            <button class="btn btn-sm btn-outline" data-view="${n.id}"><i class="fa-solid fa-eye"></i></button>
            ${isHead || isAdmin ? `<button class="btn btn-sm btn-outline" data-edit="${n.id}"><i class="fa-solid fa-pen"></i></button>` : ""}
            ${isAdmin ? `<button class="btn btn-sm btn-danger" data-del="${n.id}"><i class="fa-solid fa-trash"></i></button>` : ""}
          </div>
        </td>
      </tr>`;
    }).join("");

    wrap.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Nurse</th><th>Qualification</th><th>Clinical Skills</th>
            <th>Availability</th><th>Shift</th><th>Patients</th><th>Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    $$("[data-view]", wrap).forEach(b => b.onclick = () => viewNurse(b.dataset.view));
    $$("[data-edit]", wrap).forEach(b => b.onclick = () => openNurseForm(b.dataset.edit));
    $$("[data-del]", wrap).forEach(b => b.onclick = () => deleteNurse(b.dataset.del));
  }

  $("#nurseSearch").addEventListener("input", renderTable);
  $("#nurseAvailFilter").addEventListener("change", renderTable);
  $("#nurseShiftFilter").addEventListener("change", renderTable);

  const addBtn = $("#addNurseBtn");
  if (addBtn) addBtn.onclick = () => openNurseForm(null);

  renderTable();
}

function openNurseForm(nurseId) {
  const editing = nurseId ? getNurseById(nurseId) : null;
  const { shiftTypes } = DB.data.settings;

  Modal.open({
    title: editing ? "Edit Nurse" : "Add Nurse",
    body: `
      <form id="nurseForm" class="form-grid">
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">Full Name *</small></label>
          <input type="text" id="nfName" value="${esc(editing?.name || "")}" required />
        </div>
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">Nurse Code *</small></label>
          <input type="text" id="nfCode" value="${esc(editing?.code || "")}" placeholder="N-04" required />
        </div>
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">Qualification</small></label>
          <input type="text" id="nfQual" value="${esc(editing?.qualification || "BSN")}" />
        </div>
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">Years of Experience</small></label>
          <input type="number" id="nfExp" min="0" max="50" value="${editing?.experience ?? 0}" />
        </div>
        <div class="full">
          <label><small style="font-weight:600;color:var(--text-soft)">Clinical Skills (comma-separated)</small></label>
          <input type="text" id="nfSkills" value="${esc(editing?.skills?.join(", ") || "Vital Signs")}" />
        </div>
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">Availability</small></label>
          <select id="nfAvail">
            <option value="available" ${editing?.availability === "available" ? "selected" : ""}>Available</option>
            <option value="unavailable" ${editing?.availability === "unavailable" ? "selected" : ""}>Unavailable</option>
          </select>
        </div>
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">Assigned Shift</small></label>
          <select id="nfShift">
            ${shiftTypes.map(t => `<option value="${t.key}" ${editing?.assignedShift === t.key ? "selected" : ""}>${t.label}</option>`).join("")}
          </select>
        </div>
        <div class="full" id="nfError" style="color:var(--red);font-size:12px;font-weight:600;display:none"></div>
      </form>
    `,
    footer: `
      <button class="btn btn-outline" id="nfCancel">Cancel</button>
      <button class="btn btn-primary" id="nfSave">${editing ? "Update" : "Add Nurse"}</button>
    `,
    onMount() {
      $("#nfCancel").onclick = () => Modal.close();
      $("#nfSave").onclick = () => {
        const errEl = $("#nfError");
        errEl.style.display = "none";
        const name = $("#nfName").value.trim();
        const code = $("#nfCode").value.trim();
        if (!name || !code) { errEl.textContent = "Name and code are required."; errEl.style.display = "block"; return; }

        if (DB.data.nurses.some(n => n.code.toLowerCase() === code.toLowerCase() && n.id !== nurseId)) {
          errEl.textContent = "Nurse code already exists."; errEl.style.display = "block"; return;
        }

        const payload = {
          name, code,
          qualification: $("#nfQual").value.trim(),
          experience: Number($("#nfExp").value) || 0,
          skills: $("#nfSkills").value.split(",").map(s => s.trim()).filter(Boolean),
          availability: $("#nfAvail").value,
          assignedShift: $("#nfShift").value,
          departmentId: getActiveShift()?.departmentId || DB.data.departments[0].id
        };

        if (editing) {
          Object.assign(editing, payload);
          audit("Nurse updated", `${name} (${code})`);
          toast("Nurse updated.", "success");
        } else {
          DB.data.nurses.push({ id: uid("nur"), ...payload });
          audit("Nurse added", `${name} (${code})`);
          toast("Nurse added.", "success");
        }
        DB.save();
        Modal.close();
        Router.refresh();
      };
    }
  });
}

function viewNurse(id) {
  const n = getNurseById(id);
  if (!n) return;
  const pts = DB.data.patients.filter(p => p.assignedNurseId === n.id);
  Modal.open({
    title: `Nurse Profile – ${n.name}`,
    body: `
      <div style="font-size:13px;line-height:2">
        <div><strong>Code:</strong> ${esc(n.code)}</div>
        <div><strong>Qualification:</strong> ${esc(n.qualification)}</div>
        <div><strong>Experience:</strong> ${n.experience} years</div>
        <div><strong>Availability:</strong> <span class="badge ${n.availability === "available" ? "available" : "unavailable"}">${n.availability}</span></div>
        <div><strong>Shift:</strong> ${esc(n.assignedShift || "—")}</div>
        <div><strong>Skills:</strong> ${n.skills.map(s => `<span class="badge teal">${esc(s)}</span>`).join(" ") || "—"}</div>
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0" />
      <div class="card-title"><i class="fa-solid fa-bed-pulse"></i> Assigned Patients (${pts.length})</div>
      ${pts.length ? `<ul style="font-size:13px;padding-left:18px">${pts.map(p => `<li>${esc(p.code)} – ${esc(p.name)} (${esc(p.bed)})</li>`).join("")}</ul>` : `<p class="empty-state" style="padding:10px">No patients assigned.</p>`}
    `,
    footer: `<button class="btn btn-outline" onclick="Modal.close()">Close</button>`
  });
}

function deleteNurse(id) {
  const n = getNurseById(id);
  if (!n) return;
  Modal.confirm({
    title: "Delete Nurse",
    message: `Delete nurse "${n.name}"? This cannot be undone.`,
    confirmText: "Delete",
    danger: true,
    onConfirm: () => {
      DB.data.nurses = DB.data.nurses.filter(x => x.id !== id);
      DB.data.users = DB.data.users.filter(u => u.nurseId !== id);
      DB.data.patients.forEach(p => { if (p.assignedNurseId === id) p.assignedNurseId = null; });
      audit("Nurse deleted", `${n.name} (${n.code})`);
      DB.save();
      toast("Nurse deleted.", "success");
      Router.refresh();
    }
  });
}