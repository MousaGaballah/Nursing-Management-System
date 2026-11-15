/* ============================================================
   workload.js — configurable nursing workload calculator
   ------------------------------------------------------------
   DISCLAIMER: All weights below are ILLUSTRATIVE demo values.
   They are NOT clinically validated and MUST be reviewed by
   nursing specialists before any real use.
   ============================================================ */
"use strict";

/* Map a task name → task-type factor (illustrative). */
function taskTypeFactor(taskName) {
  const name = String(taskName || "").toLowerCase();
  if (name.includes("medication")) return 3;
  if (name.includes("wound")) return 4;
  if (name.includes("vital")) return 2;
  if (name.includes("glucose")) return 2;
  if (name.includes("oxygen") || name.includes("respiratory")) return 3;
  if (name.includes("reposition") || name.includes("positioning")) return 2;
  if (name.includes("intake") || name.includes("output")) return 1.5;
  if (name.includes("specimen")) return 2;
  if (name.includes("education")) return 1.5;
  if (name.includes("laboratory") || name.includes("results")) return 1;
  if (name.includes("preparation") || name.includes("procedure")) return 2.5;
  return 1.5;
}

/* Frequency factor — how many times/day */
function taskFrequencyFactor(taskName) {
  const name = String(taskName || "").toLowerCase();
  if (name.includes("vital")) return 4;
  if (name.includes("glucose")) return 4;
  if (name.includes("medication")) return 3;
  if (name.includes("reposition") || name.includes("positioning")) return 6;
  if (name.includes("intake") || name.includes("output")) return 3;
  return 1;
}

/* Standard estimated minutes per task type */
function taskDuration(taskName) {
  const name = String(taskName || "").toLowerCase();
  if (name.includes("medication")) return 10;
  if (name.includes("wound")) return 25;
  if (name.includes("vital")) return 8;
  if (name.includes("glucose")) return 6;
  if (name.includes("oxygen")) return 10;
  if (name.includes("reposition")) return 5;
  if (name.includes("specimen")) return 12;
  if (name.includes("education")) return 15;
  if (name.includes("preparation")) return 15;
  return 10;
}

/**
 * Compute workload score for a single patient.
 * Uses configurable weights from settings.workloadWeights.
 */
function computePatientWorkload(patient) {
  const w = DB.data.settings.workloadWeights;

  // Acuity contributes a base load
  const acuityScore = (patient.acuity || 1) * w.acuityWeight;

  // Care needs + real tasks
  const careList = patient.careNeeds || [];
  const patientTasks = DB.data.tasks.filter(t => t.patientId === patient.id);

  let taskScore = 0;
  const seen = new Set();
  const allNames = [...careList, ...patientTasks.map(t => t.name)];

  allNames.forEach(name => {
    const key = name.toLowerCase();
    if (seen.has(key)) return; // avoid double-counting the same concept
    seen.add(key);

    const typeF = taskTypeFactor(name);
    const freqF = taskFrequencyFactor(name);
    const dur = taskDuration(name);

    taskScore +=
      typeF * w.taskTypeWeight +
      dur * w.durationWeight +
      freqF * w.frequencyWeight;
  });

  // Extra edge: each patient has fixed overhead
  const baseOverhead = 5;

  const total = Math.round((acuityScore + taskScore + baseOverhead) * 10) / 10;
  return {
    patientId: patient.id,
    acuity: patient.acuity,
    taskCount: allNames.length,
    score: total,
    breakdown: { acuityScore, taskScore, baseOverhead }
  };
}

/**
 * Workload for each nurse = sum(patient workloads) + competency bonus adjust.
 * Also returns load vs available time classification.
 */
function computeNurseWorkloads(shift) {
  const shiftHours = shiftTypeHours(shift?.type) || 6;
  const availableMinutes = shiftHours * 60;

  return DB.data.nurses
    .filter(n => n.availability === "available" && (!shift || n.assignedShift === shift.type || true))
    .map(nurse => {
      const assignedPatients = DB.data.patients.filter(p => p.assignedNurseId === nurse.id);
      let total = 0;
      assignedPatients.forEach(p => { total += computePatientWorkload(p).score; });

      // Workload score → normalized 0-100 vs available minutes
      const normalized = Math.min(100, Math.round((total / availableMinutes) * 100));

      // competency adjustment for label only (does not reduce the numeric score)
      let competencyMatches = 0;
      assignedPatients.forEach(p => {
        (p.careNeeds || []).forEach(cn => {
          if (nurse.skills.some(s => cn.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(cn.toLowerCase()))) {
            competencyMatches++;
          }
        });
      });

      let level = "low";
      if (normalized >= 80) level = "overload";
      else if (normalized >= 60) level = "high";
      else if (normalized >= 35) level = "medium";

      return {
        nurse,
        assignedPatients,
        total,
        normalized,
        level,
        competencyMatches
      };
    })
    .sort((a, b) => b.total - a.total);
}

function shiftTypeHours(type) {
  const t = DB.data.settings.shiftTypes.find(x => x.key === type);
  return t ? t.hours : 6;
}

/* ---------- Workload page ---------- */
function renderWorkloadPage(container) {
  const shift = getActiveShift();

  if (!shift) {
    container.innerHTML = `
      <div class="page-header"><div><h1>Workload Calculator</h1><p>Configure a shift first.</p></div></div>
      <div class="card"><div class="empty-state"><i class="fa-solid fa-clock"></i><h4>No active shift</h4><p>Go to Shift Setup and create a shift.</p></div></div>
    `;
    return;
  }

  const workloads = computeNurseWorkloads(shift);
  const weights = DB.data.settings.workloadWeights;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Nursing Workload Calculator</h1>
        <p>Configurable workload estimation based on acuity, care tasks, duration and frequency.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-outline" id="wlWeightsBtn"><i class="fa-solid fa-sliders"></i> Adjust Weights</button>
      </div>
    </div>

    <div class="card" style="background:#fffbea;border-color:#fde68a;margin-bottom:16px">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <i class="fa-solid fa-triangle-exclamation" style="color:#b45309;font-size:18px;margin-top:2px"></i>
        <div style="font-size:12.5px;color:#78350f;line-height:1.6">
          <strong>Important disclaimer:</strong> The weights and coefficients used in this calculator are <strong>illustrative demo values</strong>. They are not clinically validated. They must be reviewed, adjusted, and approved by nursing specialists and based on scientific references before any real-world use.
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title"><i class="fa-solid fa-scale-balanced"></i> Workload per Nurse (Total Score)</div>
      ${workloads.length === 0 ? `<div class="empty-state"><i class="fa-solid fa-user-nurse"></i><h4>No available nurses</h4></div>` : renderWorkloadBars(workloads)}
    </div>

    <div class="grid-2" style="margin-bottom:16px">
      <div class="card">
        <div class="card-title"><i class="fa-solid fa-people-group"></i> Nurse Comparison</div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Nurse</th><th>Patients</th><th>Score</th><th>Level</th></tr></thead>
            <tbody>
              ${workloads.map(w => `
                <tr>
                  <td class="cell-strong">${esc(w.nurse.name)}<div class="cell-sub">${esc(w.nurse.code)}</div></td>
                  <td>${w.assignedPatients.length}</td>
                  <td><strong>${w.total}</strong></td>
                  <td><span class="badge ${w.level === 'overload' ? 'critical' : w.level === 'high' ? 'high' : w.level === 'medium' ? 'medium' : 'completed'}">${w.level}</span></td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><i class="fa-solid fa-users-between-lines"></i> Patient Load Breakdown</div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Patient</th><th>Acuity</th><th>Nurse</th><th>Score</th></tr></thead>
            <tbody>
              ${DB.data.patients.map(p => {
                const w = computePatientWorkload(p);
                const nurse = p.assignedNurseId ? getNurseById(p.assignedNurseId) : null;
                return `<tr>
                  <td class="cell-strong">${esc(p.code)}<div class="cell-sub">${esc(p.name)}</div></td>
                  <td>L${p.acuity}</td>
                  <td>${nurse ? esc(nurse.name) : "—"}</td>
                  <td><strong>${w.score}</strong></td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title"><i class="fa-solid fa-sliders"></i> Current Calculation Parameters (Illustrative)</div>
      <div class="grid-3" style="font-size:12.5px">
        <div><strong>Acuity weight:</strong> ${weights.acuityWeight} / level</div>
        <div><strong>Task-type weight:</strong> ${weights.taskTypeWeight}</div>
        <div><strong>Duration weight:</strong> ${weights.durationWeight} / min</div>
        <div><strong>Frequency weight:</strong> ${weights.frequencyWeight}</div>
        <div><strong>Competency bonus:</strong> ${weights.competencyBonus}</div>
        <div><strong>Shift hours:</strong> ${shiftTypeHours(shift.type)} h</div>
      </div>
    </div>
  `;

  $("#wlWeightsBtn").onclick = openWorkloadWeightsModal;
}

function renderWorkloadBars(workloads) {
  const max = Math.max(...workloads.map(w => w.total), 1);
  return workloads.map(w => {
    const pct = Math.round((w.total / max) * 100);
    return `
      <div class="workload-row">
        <div class="workload-name">${esc(w.nurse.name)}<div style="font-size:10.5px;color:var(--text-muted);font-weight:400">${w.assignedPatients.length} patients</div></div>
        <div class="workload-bar-wrap"><div class="workload-bar ${w.level}" style="width:${pct}%"></div></div>
        <div class="workload-score">${w.total}</div>
      </div>
    `;
  }).join("");
}

function openWorkloadWeightsModal() {
  const w = DB.data.settings.workloadWeights;
  Modal.open({
    title: "Adjust Workload Weights (Illustrative)",
    body: `
      <p style="font-size:12.5px;color:var(--text-soft);margin-bottom:14px;line-height:1.6">
        These weights directly affect the workload scores. Any change must be considered carefully. Values must be validated by nursing specialists.
      </p>
      <form id="weightsForm" class="form-grid">
        <div><label><small>Acuity Weight</small></label><input type="number" step="0.1" id="waAcuity" value="${w.acuityWeight}" /></div>
        <div><label><small>Task-Type Weight</small></label><input type="number" step="0.1" id="waTask" value="${w.taskTypeWeight}" /></div>
        <div><label><small>Duration Weight</small></label><input type="number" step="0.05" id="waDur" value="${w.durationWeight}" /></div>
        <div><label><small>Frequency Weight</small></label><input type="number" step="0.1" id="waFreq" value="${w.frequencyWeight}" /></div>
        <div><label><small>Competency Bonus</small></label><input type="number" step="0.1" id="waComp" value="${w.competencyBonus}" /></div>
      </form>
    `,
    footer: `
      <button class="btn btn-outline" id="waCancel">Cancel</button>
      <button class="btn btn-primary" id="waSave">Save Weights</button>
    `,
    onMount() {
      $("#waCancel").onclick = () => Modal.close();
      $("#waSave").onclick = () => {
        w.acuityWeight = Number($("#waAcuity").value) || 0;
        w.taskTypeWeight = Number($("#waTask").value) || 0;
        w.durationWeight = Number($("#waDur").value) || 0;
        w.frequencyWeight = Number($("#waFreq").value) || 0;
        w.competencyBonus = Number($("#waComp").value) || 0;
        DB.save();
        audit("Workload weights updated", JSON.stringify(w));
        toast("Weights updated.", "success");
        Modal.close();
        Router.refresh();
      };
    }
  });
}