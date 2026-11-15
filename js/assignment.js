/* ============================================================
   assignment.js — balanced suggestion, review, approval, lock
   ============================================================ */
"use strict";

/**
 * Greedy balanced distribution:
 * - Sort patients by workload score descending (most demanding first).
 * - For each patient, assign to the available nurse with:
 *   1) matching competency (bonus priority),
 *   2) lowest current total workload.
 */
function suggestBalancedAssignment() {
  const shift = getActiveShift();
  if (!shift) return { ok: false, message: "Create a shift first." };

  const availableNurses = DB.data.nurses.filter(n => n.availability === "available");
  if (!availableNurses.length) return { ok: false, message: "No available nurses." };

  const patients = [...DB.data.patients];
  if (!patients.length) return { ok: false, message: "No patients to assign." };

  // Sort patients by descending workload score
  const patientsSorted = patients
    .map(p => ({ p, w: computePatientWorkload(p).score }))
    .sort((a, b) => b.w - a.w);

  // Reset current tentative assignment for suggestion (do NOT persist yet)
  const buckets = availableNurses.map(n => ({ nurse: n, total: 0, patients: [] }));

  patientsSorted.forEach(({ p, w }) => {
    // find best bucket
    let best = null;
    let bestScore = Infinity;

    buckets.forEach(b => {
      // competency bonus: if nurse has skill matching patient care need, effective cost is lower
      let matches = 0;
      (p.careNeeds || []).forEach(cn => {
        if (b.nurse.skills.some(s => cn.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(cn.toLowerCase()))) matches++;
      });
      const effective = b.total + w - matches * 2; // favor nurses with matching skill
      if (effective < bestScore) {
        bestScore = effective;
        best = b;
      }
    });

    best.patients.push(p);
    best.total += w;
  });

  return { ok: true, buckets, shift };
}

function renderAssignmentPage(container) {
  const shift = getActiveShift();
  if (!shift) {
    container.innerHTML = `<div class="page-header"><div><h1>Patient Assignment</h1><p>Configure a shift first.</p></div></div>
    <div class="card"><div class="empty-state"><i class="fa-solid fa-clock"></i><h4>No active shift</h4></div></div>`;
    return;
  }

  const lockInfo = DB.data.assignmentLock[shift.id];
  const locked = !!lockInfo?.locked;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Patient Assignment</h1>
        <p>Generate a balanced distribution, review, then approve to lock.</p>
      </div>
      <div class="page-actions">
        ${!locked ? `<button class="btn btn-primary" id="suggestBtn"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate Suggestion</button>` : ""}
      </div>
    </div>

    ${locked ? `
      <div class="card" style="background:#ecfeff;border-color:#a5f3fc;margin-bottom:16px">
        <div style="display:flex;gap:10px;align-items:flex-start">
          <i class="fa-solid fa-lock" style="color:var(--teal);font-size:18px;margin-top:2px"></i>
          <div style="font-size:13px;color:#155e75;line-height:1.7">
            <strong>Assignment is LOCKED.</strong> Approved by ${esc(lockInfo.approvedBy)} on ${fmtDateTime(lockInfo.approvedAt)}.<br/>
            Patient responsibility is fixed for this shift. Exceptional reassignment by the Head Nurse is possible with a documented reason.
          </div>
        </div>
      </div>
    ` : ""}

    <div id="assignmentBody"></div>
  `;

  renderAssignmentBody(locked);

  const suggestBtn = $("#suggestBtn");
  if (suggestBtn) suggestBtn.onclick = () => {
    const res = suggestBalancedAssignment();
    if (!res.ok) { toast(res.message, "warning"); return; }
    showSuggestionPreview(res);
  };
}

function renderAssignmentBody(locked) {
  const body = $("#assignmentBody");
  const nurses = DB.data.nurses.filter(n => n.availability === "available");
  const patients = DB.data.patients;

  if (!patients.length || !nurses.length) {
    body.innerHTML = `<div class="card"><div class="empty-state"><i class="fa-solid fa-people-arrows"></i><h4>Not enough data</h4><p>Add available nurses and patients first.</p></div></div>`;
    return;
  }

  const grouped = nurses.map(n => ({
    nurse: n,
    patients: patients.filter(p => p.assignedNurseId === n.id)
  }));

  const unassigned = patients.filter(p => !p.assignedNurseId);

  body.innerHTML = `
    <div class="grid-2">
      ${grouped.map(g => {
        const total = g.patients.reduce((s, p) => s + computePatientWorkload(p).score, 0);
        return `
          <div class="card">
            <div class="card-title" style="justify-content:space-between">
              <span><i class="fa-solid fa-user-nurse"></i> ${esc(g.nurse.name)}</span>
              <span class="badge ${total > 70 ? 'critical' : total > 45 ? 'high' : 'teal'}">Load: ${total}</span>
            </div>
            ${g.patients.length === 0 ? `<p style="font-size:12.5px;color:var(--text-muted)">No patients assigned.</p>` : `
              <div class="table-wrap"><table class="data-table"><thead><tr><th>Patient</th><th>Acuity</th><th>Score</th>${locked ? "" : "<th></th>"}</tr></thead><tbody>
                ${g.patients.map(p => `
                  <tr>
                    <td class="cell-strong">${esc(p.code)}<div class="cell-sub">${esc(p.name)} · ${esc(p.bed)}</div></td>
                    <td>L${p.acuity}</td>
                    <td>${computePatientWorkload(p).score}</td>
                    ${locked ? "" : `<td><button class="btn btn-xs btn-outline" data-unassign="${p.id}"><i class="fa-solid fa-xmark"></i></button></td>`}
                  </tr>
                `).join("")}
              </tbody></table></div>
            `}
            ${locked ? `<div style="margin-top:10px"><button class="btn btn-sm btn-outline" data-reassign="${g.nurse.id}"><i class="fa-solid fa-people-arrows"></i> Exceptional Reassign</button></div>` : ""}
          </div>
        `;
      }).join("")}
    </div>

    ${unassigned.length ? `
      <div class="card" style="margin-top:16px;border-color:#fde68a;background:#fffbea">
        <div class="card-title"><i class="fa-solid fa-triangle-exclamation" style="color:#b45309"></i> Unassigned Patients (${unassigned.length})</div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Patient</th><th>Acuity</th><th>Score</th><th>${locked ? "" : "Assign To"}</th></tr></thead>
          <tbody>
            ${unassigned.map(p => `
              <tr>
                <td class="cell-strong">${esc(p.code)}<div class="cell-sub">${esc(p.name)}</div></td>
                <td>L${p.acuity}</td>
                <td>${computePatientWorkload(p).score}</td>
                ${locked
                  ? ""
                  : `<td>
                    <select data-assign-patient="${p.id}" style="padding:6px;font-size:12px">
                      <option value="">Select nurse...</option>
                      ${nurses.map(n => `<option value="${n.id}">${esc(n.name)}</option>`).join("")}
                    </select>
                  </td>`}
              </tr>
            `).join("")}
          </tbody>
        </table></div>
      </div>
    ` : ""}

    ${!locked ? `
      <div class="card" style="margin-top:16px;text-align:center;padding:22px">
        <p style="font-size:13px;color:var(--text-soft);margin-bottom:12px">When satisfied with the distribution, approve it. This will lock patient responsibility for the entire shift.</p>
        <button class="btn btn-teal" id="approveAssignmentBtn"><i class="fa-solid fa-check-double"></i> Approve & Lock Assignment</button>
      </div>
    ` : ""}
  `;

  // wire up assignment selects
  $$("[data-assign-patient]").forEach(sel => {
    sel.onchange = () => {
      const pid = sel.dataset.assignPatient;
      const nid = sel.value;
      if (!nid) return;
      const p = getPatientById(pid);
      if (!p) return;
      p.assignedNurseId = nid;
      DB.save();
      audit("Patient assigned", `${p.code} → ${getNurseById(nid).name}`);
      toast("Patient assigned.", "success");
      Router.refresh();
    };
  });

  $$("[data-unassign]").forEach(b => {
    b.onclick = () => {
      const p = getPatientById(b.dataset.unassign);
      if (!p) return;
      p.assignedNurseId = null;
      DB.save();
      audit("Patient unassigned", p.code);
      Router.refresh();
    };
  });

  $$("[data-reassign]").forEach(b => b.onclick = () => openExceptionalReassign(b.dataset.reassign));

  const approveBtn = $("#approveAssignmentBtn");
  if (approveBtn) approveBtn.onclick = () => approveAssignment();
}

function showSuggestionPreview(res) {
  const { buckets } = res;
  const body = buckets.map(b => {
    const total = b.total;
    return `
      <div class="card" style="margin-bottom:12px">
        <div class="card-title" style="justify-content:space-between">
          <span><i class="fa-solid fa-user-nurse"></i> ${esc(b.nurse.name)}</span>
          <span class="badge ${total > 70 ? 'critical' : total > 45 ? 'high' : 'teal'}">Score: ${total.toFixed(1)}</span>
        </div>
        <ul style="padding-left:18px;font-size:13px;line-height:1.8">
          ${b.patients.map(p => `<li><strong>${esc(p.code)}</strong> – ${esc(p.name)} (Acuity L${p.acuity}, Score ${computePatientWorkload(p).score})</li>`).join("") || "<li><em>No patients</em></li>"}
        </ul>
      </div>
    `;
  }).join("");

  Modal.open({
    title: "Suggested Distribution",
    wide: true,
    body: `${body}
      <div style="background:#fffbea;padding:10px;border-radius:8px;font-size:12px;color:#78350f;margin-top:8px">
        <i class="fa-solid fa-info-circle"></i> This is a suggestion only. Review and modify before approval. Nothing is locked until you approve.
      </div>`,
    footer: `
      <button class="btn btn-outline" id="suggCancel">Cancel</button>
      <button class="btn btn-primary" id="suggApply"><i class="fa-solid fa-check"></i> Apply to Assignment</button>
    `,
    onMount() {
      $("#suggCancel").onclick = () => Modal.close();
      $("#suggApply").onclick = () => {
        // Persist the suggestion into patients
        DB.data.patients.forEach(p => { p.assignedNurseId = null; });
        buckets.forEach(b => {
          b.patients.forEach(p => { p.assignedNurseId = b.nurse.id; });
        });
        DB.save();
        audit("Assignment suggestion applied", "");
        toast("Suggestion applied. Review and approve.", "success");
        Modal.close();
        Router.refresh();
      };
    }
  });
}

function approveAssignment() {
  const shift = getActiveShift();
  if (!shift) return;
  const sess = Session.get();

  const unassigned = DB.data.patients.filter(p => !p.assignedNurseId);
  if (unassigned.length > 0) {
    toast(`${unassigned.length} patient(s) still unassigned. Assign or leave explicit.`, "warning");
    return;
  }

  Modal.confirm({
    title: "Approve & Lock Assignment",
    message: "Once approved, patient responsibility will be LOCKED for this shift. Exceptional changes require documented reasons.",
    confirmText: "Approve & Lock",
    onConfirm: () => {
      DB.data.assignmentLock[shift.id] = {
        locked: true,
        approvedAt: nowISO(),
        approvedBy: sess.name
      };
      // snapshot assignments
      DB.data.assignments = DB.data.patients.map(p => ({
        id: uid("asg"),
        patientId: p.id,
        nurseId: p.assignedNurseId,
        shiftId: shift.id,
        date: shift.date,
        locked: true
      }));
      DB.save();
      audit("Assignment approved & locked", `Shift ${shift.type} ${shift.date}`);
      toast("Assignment locked.", "success");
      Router.refresh();
    }
  });
}

function openExceptionalReassign(nurseId) {
  const nurse = getNurseById(nurseId);
  if (!nurse) return;
  const patients = DB.data.patients.filter(p => p.assignedNurseId === nurseId);
  if (!patients.length) { toast("No patients assigned to this nurse.", "warning"); return; }

  const otherNurses = DB.data.nurses.filter(n => n.availability === "available" && n.id !== nurseId);

  Modal.open({
    title: `Exceptional Reassignment – ${nurse.name}`,
    wide: true,
    body: `
      <div style="background:#fef2f2;padding:10px;border-radius:8px;font-size:12px;color:#7f1d1d;margin-bottom:12px">
        <i class="fa-solid fa-triangle-exclamation"></i> Exceptional changes must have a documented reason. They are recorded in the audit trail.
      </div>
      <form id="reassignForm">
        <div style="margin-bottom:12px">
          <label style="font-size:12px;font-weight:600;color:var(--text-soft)">Patient to reassign</label>
          <select id="reassignPatient">
            ${patients.map(p => `<option value="${p.id}">${esc(p.code)} – ${esc(p.name)}</option>`).join("")}
          </select>
        </div>
        <div style="margin-bottom:12px">
          <label style="font-size:12px;font-weight:600;color:var(--text-soft)">New Responsible Nurse</label>
          <select id="reassignNewNurse">
            ${otherNurses.map(n => `<option value="${n.id}">${esc(n.name)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--text-soft)">Reason * (required)</label>
          <textarea id="reassignReason" placeholder="e.g., sudden absence of primary nurse, patient critical condition needs specialist" style="min-height:70px"></textarea>
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn-outline" id="reCancel">Cancel</button>
      <button class="btn btn-danger" id="reConfirm"><i class="fa-solid fa-people-arrows"></i> Reassign</button>
    `,
    onMount() {
      $("#reCancel").onclick = () => Modal.close();
      $("#reConfirm").onclick = () => {
        const pid = $("#reassignPatient").value;
        const newNid = $("#reassignNewNurse").value;
        const reason = $("#reassignReason").value.trim();
        if (!reason) { toast("A reason is required.", "error"); return; }
        const p = getPatientById(pid);
        const oldNurse = getNurseById(p.assignedNurseId);
        const newNurse = getNurseById(newNid);
        const sess = Session.get();

        DB.data.reassignmentLog.unshift({
          id: uid("re"),
          patientId: pid,
          patientCode: p.code,
          oldNurseId: oldNurse?.id,
          oldNurseName: oldNurse?.name,
          newNurseId: newNid,
          newNurseName: newNurse.name,
          reason,
          byUser: sess.name,
          at: nowISO(),
          handoverStatus: "Pending"
        });

        p.assignedNurseId = newNid;
        DB.save();
        audit("Exceptional reassignment", `${p.code}: ${oldNurse?.name || "?"} → ${newNurse.name}`, reason);
        toast("Reassignment recorded.", "success");
        Modal.close();
        Router.refresh();
      };
    }
  });
}