/* ============================================================
   assignment.js — Smart Skill-Based Assignment + Lock + Reassign
   ============================================================ */
"use strict";

/* ============================================================
   ALGORITHM: Skill-Based Balanced Assignment
   ------------------------------------------------------------
   1. Sort patients by acuity DESC
   2. Sort nurses by capability DESC
   3. Assign each patient to best candidate:
      - Critical/High → highest capability
      - Low/Moderate  → lowest capability (distribute experience)
      - Skill match bonus
   4. Apply constraints:
      - Max patients per nurse
      - Max 1 Critical per nurse
      - Max 2 High per nurse
      - Critical nurse cannot take High
      - Workload guard (max 95%)
   5. Balance pass: move stable patients from overloaded → underloaded
   ============================================================ */

function canAssign(slot, patient, rules, shiftMinutes) {
  const assigned = slot.assigned;

  if (assigned.length >= rules.maxPatientsPerNurse) return false;

  const criticalCount = assigned.filter(p => p.acuity === 4).length;
  const highCount = assigned.filter(p => p.acuity === 3).length;

  if (patient.acuity === 4) {
    if (criticalCount >= rules.maxCriticalPerNurse) return false;
    if (assigned.some(p => p.acuity >= 3)) return false;
    if (assigned.length >= 1) return false;
  }

  if (patient.acuity === 3) {
    if (highCount >= rules.maxHighPerNurse) return false;
    if (criticalCount >= 1) return false;
  }

  const addedMinutes = computePatientWorkload(patient).minutes;
  const newTotal = slot.totalMinutes + addedMinutes;
  const newPct = (newTotal / shiftMinutes) * 100;
  if (newPct > rules.workloadHardLimitPct) return false;

  return true;
}

function countSkillMatches(nurse, patient) {
  let matches = 0;
  (patient.careNeeds || []).forEach(cn => {
    if ((nurse.skills || []).some(s =>
      cn.toLowerCase().includes(s.toLowerCase()) ||
      s.toLowerCase().includes(cn.toLowerCase())
    )) matches++;
  });
  return matches;
}

function suggestBalancedAssignment() {
  const shift = getActiveShift();
  if (!shift) return { ok: false, message: t("noShift") };

  const availableNurses = DB.data.nurses
    .filter(n => n.availability === "available" || n.availability === "on_duty")
    .map(n => ({
      nurse: n,
      capability: getNurseCapability(n),
      assigned: [],
      totalMinutes: 0
    }))
    .sort((a, b) => b.capability - a.capability);

  if (!availableNurses.length) return { ok: false, message: t("noNurses") };

  const patients = [...DB.data.patients];
  if (!patients.length) return { ok: false, message: t("noData") };

  const sortedPatients = patients
    .map(p => ({ patient: p, workload: computePatientWorkload(p).minutes }))
    .sort((a, b) => {
      if (b.patient.acuity !== a.patient.acuity) return b.patient.acuity - a.patient.acuity;
      return b.workload - a.workload;
    });

  const rules = DB.data.settings.assignmentRules;
  const shiftMinutes = shiftTypeHours(shift.type) * 60;
  const unassigned = [];

  for (const { patient, workload } of sortedPatients) {
    const candidates = availableNurses.filter(slot =>
      canAssign(slot, patient, rules, shiftMinutes)
    );

    if (!candidates.length) {
      unassigned.push(patient);
      continue;
    }

    let best = null;
    let bestScore = -Infinity;

    for (const slot of candidates) {
      const skillMatch = countSkillMatches(slot.nurse, patient);
      let score = 0;

      if (patient.acuity >= 3) {
        score = slot.capability * 100 + skillMatch * 20 - slot.totalMinutes * 0.5;
      } else {
        score = -slot.capability * 100 + skillMatch * 20 - slot.totalMinutes * 0.5;
      }

      if (score > bestScore) {
        bestScore = score;
        best = slot;
      }
    }

    best.assigned.push(patient);
    best.totalMinutes += workload;
  }

  performBalancePass(availableNurses, rules, shiftMinutes);

  const buckets = availableNurses.map(slot => {
    const utilization = Math.min(200, Math.round((slot.totalMinutes / shiftMinutes) * 100));
    let level = "low";
    if (utilization >= 80) level = "overload";
    else if (utilization >= 60) level = "high";
    else if (utilization >= 35) level = "medium";

    return {
      nurse: slot.nurse,
      capabilityScore: slot.capability,
      patients: slot.assigned,
      total: slot.totalMinutes,
      utilization,
      level
    };
  });

  return { ok: true, buckets, unassigned, shift };
}

function performBalancePass(slots, rules, shiftMinutes) {
  const threshold = rules.balanceThreshold;

  for (let pass = 0; pass < 2; pass++) {
    const overloaded = slots.filter(s => (s.totalMinutes / shiftMinutes) * 100 >= threshold.highPct);
    const underloaded = slots.filter(s => (s.totalMinutes / shiftMinutes) * 100 <= threshold.lowPct);

    if (!overloaded.length || !underloaded.length) return;

    for (const over of overloaded) {
      const movable = over.assigned.filter(p => p.acuity <= 2);
      if (!movable.length) continue;

      for (const patient of movable) {
        const workload = computePatientWorkload(patient).minutes;
        const target = underloaded.find(u => {
          const tentative = { ...u, assigned: u.assigned, totalMinutes: u.totalMinutes };
          return canAssign(tentative, patient, rules, shiftMinutes);
        });
        if (target) {
          over.assigned = over.assigned.filter(p => p.id !== patient.id);
          over.totalMinutes -= workload;
          target.assigned.push(patient);
          target.totalMinutes += workload;
          break;
        }
      }
    }
  }
}

/* ---------- Page ---------- */
function renderAssignmentPage(container) {
  const shift = getActiveShift();
  if (!shift) {
    container.innerHTML = `
      <div class="page-header"><div><h1>${t("assignment")}</h1><p>${t("noShiftDesc")}</p></div></div>
      <div class="card"><div class="empty-state"><i class="fa-solid fa-clock"></i><h4>${t("noShift")}</h4></div></div>
    `;
    return;
  }

  const lockInfo = DB.data.assignmentLock[shift.id];
  const locked = !!lockInfo?.locked;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>${t("assignment")}</h1>
        <p>${t("assignmentDesc")}</p>
      </div>
      <div class="page-actions">
        ${!locked ? `<button class="btn btn-primary" id="suggestBtn"><i class="fa-solid fa-wand-magic-sparkles"></i> ${t("generateSuggestion")}</button>` : ""}
      </div>
    </div>

    <div class="card" style="background:#f0f9ff;border-color:#bae6fd;margin-bottom:16px">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <i class="fa-solid fa-circle-info" style="color:var(--blue);font-size:18px;margin-top:2px"></i>
        <div style="font-size:12.5px;color:#075985;line-height:1.7">
          <strong>${t("assignmentRules")}:</strong> ${t("assignmentRulesDesc")}
        </div>
      </div>
    </div>

    ${locked ? `
      <div class="card" style="background:#ecfeff;border-color:#a5f3fc;margin-bottom:16px">
        <div style="display:flex;gap:10px;align-items:flex-start">
          <i class="fa-solid fa-lock" style="color:var(--teal);font-size:18px;margin-top:2px"></i>
          <div style="font-size:13px;color:#155e75;line-height:1.7">
            <strong>${t("assignmentLocked")}.</strong> ${t("approvedBy")} ${esc(lockInfo.approvedBy)} ${t("on")} ${fmtDateTime(lockInfo.approvedAt)}.
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
  const nurses = DB.data.nurses.filter(n => n.availability === "available" || n.availability === "on_duty");
  const patients = DB.data.patients;

  if (!patients.length || !nurses.length) {
    body.innerHTML = `<div class="card"><div class="empty-state"><i class="fa-solid fa-people-arrows"></i><h4>${t("noData")}</h4></div></div>`;
    return;
  }

  const grouped = nurses.map(n => ({
    nurse: n,
    capability: getNurseCapability(n),
    patients: patients.filter(p => p.assignedNurseId === n.id)
  }));

  const unassigned = patients.filter(p => !p.assignedNurseId);

  body.innerHTML = `
    <div class="grid-2">
      ${grouped.map(g => {
        const totalMin = g.patients.reduce((s, p) => s + computePatientWorkload(p).minutes, 0);
        const criticalCount = g.patients.filter(p => p.acuity === 4).length;
        return `
          <div class="card">
            <div class="card-title" style="justify-content:space-between;flex-wrap:wrap;gap:6px">
              <span><i class="fa-solid fa-user-nurse"></i> ${esc(g.nurse.name)}</span>
              <div style="display:flex;gap:5px;flex-wrap:wrap">
                <span class="badge purple" title="${t("capability")}">Cap: ${g.capability}</span>
                <span class="badge ${totalMin > 300 ? 'critical' : totalMin > 200 ? 'high' : 'teal'}">${totalMin} min</span>
                ${criticalCount > 0 ? `<span class="badge critical"><i class="fa-solid fa-heart-pulse"></i> Critical</span>` : ""}
              </div>
            </div>
            <div class="cell-sub" style="margin-bottom:8px;font-size:11.5px">
              ${esc(g.nurse.qualification)} · ${g.nurse.experience} ${t("years")}
            </div>
            ${g.patients.length === 0 ? `<p style="font-size:12.5px;color:var(--text-muted)">${t("noData")}</p>` : `
              <div class="table-wrap"><table class="data-table"><thead><tr>
                <th>${t("patients")}</th><th>${t("acuity")}</th><th>${t("minutes") || "Min"}</th>${locked ? "" : "<th></th>"}
              </tr></thead><tbody>
                ${g.patients.map(p => `
                  <tr>
                    <td class="cell-strong">${esc(p.code)}<div class="cell-sub">${esc(p.name)} · ${esc(p.bed)}</div></td>
                    <td><span class="meter"><span class="dot level-${p.acuity}"></span>L${p.acuity}</span></td>
                    <td>${computePatientWorkload(p).minutes}</td>
                    ${locked ? "" : `<td><button class="btn btn-xs btn-outline" data-unassign="${p.id}"><i class="fa-solid fa-xmark"></i></button></td>`}
                  </tr>
                `).join("")}
              </tbody></table></div>
            `}
            ${locked ? `<div style="margin-top:10px"><button class="btn btn-sm btn-outline" data-reassign="${g.nurse.id}"><i class="fa-solid fa-people-arrows"></i> ${t("exceptionalReassign")}</button></div>` : ""}
          </div>
        `;
      }).join("")}
    </div>

    ${unassigned.length ? `
      <div class="card" style="margin-top:16px;border-color:#fde68a;background:#fffbea">
        <div class="card-title"><i class="fa-solid fa-triangle-exclamation" style="color:#b45309"></i> ${t("unassigned")} (${unassigned.length})</div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>${t("patients")}</th><th>${t("acuity")}</th><th>${t("minutes") || "Min"}</th><th>${locked ? "" : t("assignTo")}</th></tr></thead>
          <tbody>
            ${unassigned.map(p => `
              <tr>
                <td class="cell-strong">${esc(p.code)}<div class="cell-sub">${esc(p.name)}</div></td>
                <td><span class="meter"><span class="dot level-${p.acuity}"></span>L${p.acuity}</span></td>
                <td>${computePatientWorkload(p).minutes}</td>
                ${locked ? "" : `<td>
                  <select data-assign-patient="${p.id}" style="padding:6px;font-size:12px">
                    <option value="">${t("selectNurse")}</option>
                    ${nurses.map(n => `<option value="${n.id}">${esc(n.name)} (Cap: ${getNurseCapability(n)})</option>`).join("")}
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
        <p style="font-size:13px;color:var(--text-soft);margin-bottom:12px">${t("approveHint")}</p>
        <button class="btn btn-teal" id="approveAssignmentBtn"><i class="fa-solid fa-check-double"></i> ${t("approveAndLock")}</button>
      </div>
    ` : ""}
  `;

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
      toast(t("dataSaved"), "success");
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
  const { buckets, unassigned } = res;

  const body = buckets.map(b => `
    <div class="card" style="margin-bottom:12px">
      <div class="card-title" style="justify-content:space-between;flex-wrap:wrap;gap:6px">
        <span><i class="fa-solid fa-user-nurse"></i> ${esc(b.nurse.name)}</span>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          <span class="badge purple">Cap: ${b.capabilityScore}</span>
          <span class="badge ${workloadLevelBadgeClass(b.level)}">${b.total} min (${b.utilization}%)</span>
        </div>
      </div>
      <div class="cell-sub" style="font-size:11.5px;margin-bottom:6px">${esc(b.nurse.qualification)} · ${b.nurse.experience} ${t("years")}</div>
      <ul style="padding-inline-start:18px;font-size:13px;line-height:1.8">
        ${b.patients.map(p => `<li><strong>${esc(p.code)}</strong> – ${esc(p.name)}
          <span class="meter"><span class="dot level-${p.acuity}"></span>L${p.acuity}</span>
          (${computePatientWorkload(p).minutes} min)</li>`).join("") || `<li><em>${t("noData")}</em></li>`}
      </ul>
    </div>
  `).join("");

  const unassignedHtml = unassigned.length ? `
    <div class="card" style="background:#fef2f2;border-color:#fecaca;margin-bottom:12px">
      <div class="card-title" style="color:var(--red)"><i class="fa-solid fa-triangle-exclamation"></i> ${t("unassigned")} (${unassigned.length})</div>
      <ul style="padding-inline-start:18px;font-size:13px;line-height:1.8">
        ${unassigned.map(p => `<li><strong>${esc(p.code)}</strong> – ${esc(p.name)} (L${p.acuity})</li>`).join("")}
      </ul>
    </div>
  ` : "";

  Modal.open({
    title: t("suggestedDistribution"),
    wide: true,
    body: `${unassignedHtml}${body}
      <div style="background:#fffbea;padding:10px;border-radius:8px;font-size:12px;color:#78350f;margin-top:8px">
        <i class="fa-solid fa-info-circle"></i> ${t("suggestionHint")}
      </div>`,
    footer: `
      <button class="btn btn-outline" id="suggCancel">${t("cancel")}</button>
      <button class="btn btn-primary" id="suggApply"><i class="fa-solid fa-check"></i> ${t("applySuggestion")}</button>
    `,
    onMount() {
      $("#suggCancel").onclick = () => Modal.close();
      $("#suggApply").onclick = () => {
        DB.data.patients.forEach(p => { p.assignedNurseId = null; });
        buckets.forEach(b => {
          b.patients.forEach(p => { p.assignedNurseId = b.nurse.id; });
        });
        DB.save();
        audit("Assignment suggestion applied", "Skill-based distribution");
        toast(t("dataSaved"), "success");
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
    toast(`${unassigned.length} ${t("unassigned")}`, "warning");
    return;
  }

  Modal.confirm({
    title: t("approveAndLock"),
    message: t("approveConfirm"),
    confirmText: t("approveAndLock"),
    onConfirm: () => {
      DB.data.assignmentLock[shift.id] = {
        locked: true,
        approvedAt: nowISO(),
        approvedBy: sess.name
      };
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
      toast(t("dataSaved"), "success");
      Router.refresh();
    }
  });
}

function openExceptionalReassign(nurseId) {
  const nurse = getNurseById(nurseId);
  if (!nurse) return;
  const patients = DB.data.patients.filter(p => p.assignedNurseId === nurseId);
  if (!patients.length) { toast(t("noData"), "warning"); return; }

  const otherNurses = DB.data.nurses.filter(n =>
    n.id !== nurseId && (n.availability === "available" || n.availability === "on_duty")
  );

  Modal.open({
    title: `${t("exceptionalReassign")} – ${nurse.name}`,
    wide: true,
    body: `
      <div style="background:#fef2f2;padding:10px;border-radius:8px;font-size:12px;color:#7f1d1d;margin-bottom:12px">
        <i class="fa-solid fa-triangle-exclamation"></i> ${t("reassignWarning")}
      </div>
      <form id="reassignForm">
        <div style="margin-bottom:12px">
          <label style="font-size:12px;font-weight:600;color:var(--text-soft)">${t("patients")}</label>
          <select id="reassignPatient">
            ${patients.map(p => `<option value="${p.id}">${esc(p.code)} – ${esc(p.name)} (L${p.acuity})</option>`).join("")}
          </select>
        </div>
        <div style="margin-bottom:12px">
          <label style="font-size:12px;font-weight:600;color:var(--text-soft)">${t("newNurse")}</label>
          <select id="reassignNewNurse">
            ${otherNurses.map(n => `<option value="${n.id}">${esc(n.name)} (Cap: ${getNurseCapability(n)})</option>`).join("")}
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--text-soft)">${t("reason")} *</label>
          <textarea id="reassignReason" placeholder="${t("reasonPlaceholder")}" style="min-height:70px"></textarea>
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn-outline" id="reCancel">${t("cancel")}</button>
      <button class="btn btn-danger" id="reConfirm"><i class="fa-solid fa-people-arrows"></i> ${t("reassign")}</button>
    `,
    onMount() {
      $("#reCancel").onclick = () => Modal.close();
      $("#reConfirm").onclick = () => {
        const pid = $("#reassignPatient").value;
        const newNid = $("#reassignNewNurse").value;
        const reason = $("#reassignReason").value.trim();
        if (!reason) { toast(t("reason") + " " + t("required"), "error"); return; }
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
        toast(t("dataSaved"), "success");
        Modal.close();
        Router.refresh();
      };
    }
  });
}