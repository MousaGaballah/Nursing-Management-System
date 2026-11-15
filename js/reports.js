/* ============================================================
   reports.js — dashboards, monitoring, reports, audit,
                nurse pages, admin page
   ============================================================ */
"use strict";

/* =================== HEAD NURSE DASHBOARD =================== */
function renderHeadDashboard(container) {
  const sess = Session.get();
  const shift = getActiveShift();
  const patients = DB.data.patients;
  const nurses = DB.data.nurses;
  const tasks = DB.data.tasks;

  const completed = tasks.filter(t => t.status === "Completed").length;
  const pending = tasks.filter(t => t.status === "Pending" || t.status === "In Progress").length;
  const overdue = tasks.filter(t => computeTaskStatus(t) === "Overdue").length;
  const notCompleted = tasks.filter(t => t.status === "Not Completed").length;

  const workloads = shift ? computeNurseWorkloads(shift) : [];
  const totalLoad = workloads.reduce((s, w) => s + w.total, 0);

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Welcome, ${esc(sess.name)}</h1>
        <p>${shift ? `${esc(shift.type)} Shift · ${esc(shift.date)} · ${esc(shift.start)}–${esc(shift.end)}` : "No shift configured yet"}</p>
      </div>
      ${shift ? `<div class="page-actions"><span class="badge teal"><i class="fa-solid fa-clock"></i> ${esc(shift.type)}</span></div>` : ""}
    </div>

    <div class="stats-grid">
      ${statCard("Patients", patients.length, "blue", "fa-bed-pulse")}
      ${statCard("Available Nurses", nurses.filter(n => n.availability === "available").length, "teal", "fa-user-nurse")}
      ${statCard("Total Tasks", tasks.length, "purple", "fa-list-check")}
      ${statCard("Completed", completed, "green", "fa-circle-check")}
      ${statCard("Pending", pending, "amber", "fa-hourglass-half")}
      ${statCard("Overdue", overdue, "red", "fa-triangle-exclamation")}
      ${statCard("Not Completed", notCompleted, "red", "fa-circle-xmark")}
      ${statCard("Total Workload", Math.round(totalLoad), "blue", "fa-scale-balanced")}
    </div>

    <div class="grid-dash">
      <div class="card">
        <div class="card-title"><i class="fa-solid fa-scale-balanced"></i> Workload Distribution</div>
        ${workloads.length ? renderWorkloadBars(workloads) : `<p style="font-size:12.5px;color:var(--text-muted)">No nurses available.</p>`}
      </div>
      <div class="card">
        <div class="card-title"><i class="fa-solid fa-chart-simple"></i> Task Completion</div>
        ${renderTaskDonut(completed, pending, overdue, notCompleted)}
      </div>
    </div>

    <div class="grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-title"><i class="fa-solid fa-triangle-exclamation"></i> Critical & Overdue Alerts</div>
        ${renderAlerts(tasks)}
      </div>
      <div class="card">
        <div class="card-title"><i class="fa-solid fa-clock-rotate-left"></i> Recent Activities</div>
        ${renderRecentAudit()}
      </div>
    </div>
  `;
}

function statCard(label, value, color, icon) {
  return `<div class="stat-card">
    <div class="stat-icon ${color}"><i class="fa-solid ${icon}"></i></div>
    <div class="stat-info"><small>${label}</small><strong>${value}</strong></div>
  </div>`;
}

function renderTaskDonut(completed, pending, overdue, nc) {
  const total = completed + pending + overdue + nc || 1;
  const segments = [
    { label: "Completed", value: completed, color: "#16a34a" },
    { label: "Pending", value: pending, color: "#3b82f6" },
    { label: "Overdue", value: overdue, color: "#dc2626" },
    { label: "Not Completed", value: nc, color: "#be185d" }
  ];
  return `
    <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
      <svg width="120" height="120" viewBox="0 0 42 42">
        <circle cx="21" cy="21" r="15.9" fill="none" stroke="#e2e8f0" stroke-width="6"></circle>
        ${(() => {
          let offset = 0;
          return segments.map(s => {
            const pct = (s.value / total) * 100;
            const dash = `${pct} ${100 - pct}`;
            const c = `<circle cx="21" cy="21" r="15.9" fill="none" stroke="${s.color}" stroke-width="6" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 21 21)"></circle>`;
            offset += pct;
            return c;
          }).join("");
        })()}
      </svg>
      <div style="font-size:12.5px">
        ${segments.map(s => `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px"><span style="width:10px;height:10px;border-radius:3px;background:${s.color};display:inline-block"></span> ${s.label}: <strong>${s.value}</strong></div>`).join("")}
      </div>
    </div>
  `;
}

function renderAlerts(tasks) {
  const alerts = tasks.filter(t => t.priority === "Critical" || computeTaskStatus(t) === "Overdue").slice(0, 6);
  if (!alerts.length) return `<p style="font-size:12.5px;color:var(--text-muted)">No critical alerts.</p>`;
  return alerts.map(t => {
    const p = getPatientById(t.patientId);
    const st = computeTaskStatus(t);
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-soft);font-size:12.5px">
      <div><strong>${esc(t.name)}</strong><div class="cell-sub">${esc(p?.code || "")} ${p ? `· ${esc(p.name)}` : ""}</div></div>
      <span class="badge ${t.priority.toLowerCase()}">${t.priority}</span>
      ${st === "Overdue" ? `<span class="badge overdue">Overdue</span>` : ""}
    </div>`;
  }).join("");
}

function renderRecentAudit() {
  const items = DB.data.auditTrail.slice(0, 6);
  if (!items.length) return `<p style="font-size:12.5px;color:var(--text-muted)">No activity yet.</p>`;
  return items.map(a => `
    <div style="padding:7px 0;border-bottom:1px solid var(--border-soft);font-size:12.5px">
      <strong>${esc(a.action)}</strong>
      <div class="cell-sub">${esc(a.user)} · ${fmtTime(a.at)}</div>
    </div>
  `).join("");
}

/* =================== MONITORING DASHBOARD =================== */
function renderMonitorPage(container) {
  const nurses = DB.data.nurses.filter(n => n.availability === "available");
  const all = DB.data.tasks;

  container.innerHTML = `
    <div class="page-header"><div><h1>Monitoring Dashboard</h1><p>Live view of task progress per nurse.</p></div></div>
    <div class="grid-2">
      ${nurses.map(n => {
        const myPts = DB.data.patients.filter(p => p.assignedNurseId === n.id);
        const myTasks = all.filter(t => t.assignedNurseId === n.id);
        const comp = myTasks.filter(t => t.status === "Completed").length;
        const prog = myTasks.filter(t => t.status === "In Progress").length;
        const pend = myTasks.filter(t => t.status === "Pending").length;
        const over = myTasks.filter(t => computeTaskStatus(t) === "Overdue").length;
        const nc = myTasks.filter(t => t.status === "Not Completed").length;
        const wl = getActiveShift() ? computeNurseWorkloads(getActiveShift()).find(w => w.nurse.id === n.id) : null;

        return `
          <div class="card">
            <div class="card-title" style="justify-content:space-between">
              <span><i class="fa-solid fa-user-nurse"></i> ${esc(n.name)}</span>
              <span class="badge teal">${myPts.length} patients</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px;font-size:11.5px;text-align:center">
              <div><div style="font-size:18px;font-weight:800;color:var(--green)">${comp}</div>Done</div>
              <div><div style="font-size:18px;font-weight:800;color:var(--blue)">${prog}</div>Active</div>
              <div><div style="font-size:18px;font-weight:800;color:var(--amber)">${pend}</div>Pending</div>
              <div><div style="font-size:18px;font-weight:800;color:var(--red)">${over}</div>Overdue</div>
              <div><div style="font-size:18px;font-weight:800;color:#be185d">${nc}</div>Missed</div>
            </div>
            ${wl ? `<div style="font-size:12px;color:var(--text-muted)">Workload: <strong style="color:var(--navy)">${wl.total}</strong> · Level: <strong>${wl.level}</strong></div>` : ""}
            <div style="margin-top:10px;font-size:12px">
              <strong>Patients:</strong> ${myPts.map(p => esc(p.code)).join(", ") || "—"}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

/* =================== REPORTS PAGE =================== */
function renderReportsPage(container) {
  const tasks = DB.data.tasks;
  const patients = DB.data.patients;
  const nurses = DB.data.nurses;

  container.innerHTML = `
    <div class="page-header">
      <div><h1>Reports & Analytics</h1><p>Shift performance summary and export.</p></div>
      <div class="page-actions">
        <button class="btn btn-outline" id="exportCsvBtn"><i class="fa-solid fa-file-csv"></i> Export CSV</button>
        <button class="btn btn-outline" id="printReportBtn"><i class="fa-solid fa-print"></i> Print</button>
      </div>
    </div>

    <div class="stats-grid">
      ${statCard("Total Patients", patients.length, "blue", "fa-bed-pulse")}
      ${statCard("Total Tasks", tasks.length, "purple", "fa-list-check")}
      ${statCard("Completed", tasks.filter(t=>t.status==="Completed").length, "green", "fa-circle-check")}
      ${statCard("Overdue", tasks.filter(t=>computeTaskStatus(t)==="Overdue").length, "red", "fa-triangle-exclamation")}
    </div>

    <div class="card">
      <div class="card-title"><i class="fa-solid fa-users"></i> Individual Nurse Performance</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Nurse</th><th>Patients</th><th>Tasks</th><th>Completed</th><th>Overdue</th><th>Not Completed</th><th>Rate</th></tr></thead>
          <tbody>
            ${nurses.map(n => {
              const my = tasks.filter(t => t.assignedNurseId === n.id);
              const comp = my.filter(t => t.status === "Completed").length;
              const over = my.filter(t => computeTaskStatus(t) === "Overdue").length;
              const nc = my.filter(t => t.status === "Not Completed").length;
              const rate = my.length ? Math.round((comp / my.length) * 100) : 0;
              return `<tr>
                <td class="cell-strong">${esc(n.name)}</td>
                <td>${patients.filter(p => p.assignedNurseId === n.id).length}</td>
                <td>${my.length}</td>
                <td>${comp}</td>
                <td>${over}</td>
                <td>${nc}</td>
                <td><strong>${rate}%</strong></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title"><i class="fa-solid fa-clipboard-check"></i> Shift Summary – Handover</div>
      ${renderHandoverSection()}
    </div>
  `;

  $("#exportCsvBtn").onclick = exportTasksCsv;
  $("#printReportBtn").onclick = () => window.print();
}

function renderHandoverSection() {
  const unfinished = DB.data.tasks.filter(t => t.status !== "Completed");
  if (!unfinished.length) return `<p style="font-size:12.5px;color:var(--text-muted)">All tasks completed. Nothing to hand over.</p>`;
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Task</th><th>Patient</th><th>Nurse</th><th>Status</th><th>Reason</th></tr></thead>
    <tbody>${unfinished.map(t => {
      const p = getPatientById(t.patientId);
      const n = getNurseById(t.assignedNurseId);
      return `<tr>
        <td class="cell-strong">${esc(t.name)}</td>
        <td>${esc(p?.code || "")}</td>
        <td>${esc(n?.name || "")}</td>
        <td><span class="badge ${t.status.toLowerCase().replace(" ","")}">${t.status}</span></td>
        <td>${esc(t.notCompletedReason || "—")}</td>
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;
}

function exportTasksCsv() {
  const rows = [["ID","Task","Patient","Nurse","Priority","Due","Status","CompletedAt","NotCompletedReason"]];
  DB.data.tasks.forEach(t => {
    const p = getPatientById(t.patientId);
    const n = getNurseById(t.assignedNurseId);
    rows.push([
      t.id, t.name, p?.code || "", n?.name || "", t.priority, t.dueTime || "",
      t.status, t.completedAt || "", t.notCompletedReason || ""
    ]);
  });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  downloadFile("nursing-tasks-report.csv", csv, "text/csv");
  toast("CSV exported.", "success");
}

/* =================== AUDIT PAGE =================== */
function renderAuditPage(container) {
  container.innerHTML = `
    <div class="page-header"><div><h1>Audit Trail</h1><p>All important system activities.</p></div></div>
    <div class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Action</th><th>User</th><th>Details</th><th>Reason</th><th>When</th></tr></thead>
          <tbody>
            ${DB.data.auditTrail.map(a => `<tr>
              <td class="cell-strong">${esc(a.action)}</td>
              <td>${esc(a.user)}</td>
              <td class="cell-sub">${esc(a.details || "")}</td>
              <td class="cell-sub">${esc(a.reason || "")}</td>
              <td class="cell-sub">${fmtDateTime(a.at)}</td>
            </tr>`).join("") || `<tr><td colspan="5" class="empty-state">No activity yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* =================== STAFF NURSE DASHBOARD =================== */
function renderNurseDashboard(container) {
  const sess = Session.get();
  const nurseId = sess.nurseId;
  const myPts = DB.data.patients.filter(p => p.assignedNurseId === nurseId);
  const myTasks = DB.data.tasks.filter(t => t.assignedNurseId === nurseId);

  const completed = myTasks.filter(t => t.status === "Completed").length;
  const pending = myTasks.filter(t => t.status === "Pending" || t.status === "In Progress").length;
  const overdue = myTasks.filter(t => computeTaskStatus(t) === "Overdue").length;

  container.innerHTML = `
    <div class="page-header">
      <div><h1>Hello, ${esc(sess.name)}</h1><p>Here is your shift overview.</p></div>
    </div>

    <div class="stats-grid">
      ${statCard("My Patients", myPts.length, "blue", "fa-bed-pulse")}
      ${statCard("My Tasks", myTasks.length, "purple", "fa-list-check")}
      ${statCard("Completed", completed, "green", "fa-circle-check")}
      ${statCard("Pending", pending, "amber", "fa-hourglass-half")}
      ${statCard("Overdue", overdue, "red", "fa-triangle-exclamation")}
    </div>

    <div class="card">
      <div class="card-title"><i class="fa-solid fa-bed-pulse"></i> My Patients</div>
      ${myPts.length === 0 ? `<div class="empty-state"><i class="fa-solid fa-bed"></i><h4>No patients assigned yet</h4><p>Wait for Head Nurse approval.</p></div>` : `
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Code</th><th>Bed</th><th>Diagnosis</th><th>Acuity</th><th>Care Needs</th></tr></thead>
        <tbody>${myPts.map(p => `<tr>
          <td class="cell-strong">${esc(p.code)}</td>
          <td>${esc(p.bed)}</td>
          <td>${esc(p.diagnosis)}</td>
          <td>L${p.acuity}</td>
          <td class="cell-sub">${(p.careNeeds||[]).slice(0,3).join(", ")}</td>
        </tr>`).join("")}</tbody></table></div>
      `}
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title"><i class="fa-solid fa-list-check"></i> My Tasks</div>
      <div id="myTasksContainer"></div>
    </div>
  `;

  renderMyTaskCards($("#myTasksContainer"), myTasks);
}

function renderMyTaskCards(root, tasks) {
  if (!tasks.length) {
    root.innerHTML = `<div class="empty-state"><i class="fa-solid fa-list"></i><h4>No tasks assigned</h4></div>`;
    return;
  }
  const sorted = [...tasks].sort(taskSortComparator);
  root.innerHTML = `<div class="task-list">${sorted.map(t => {
    const p = getPatientById(t.patientId);
    const st = computeTaskStatus(t);
    const statusLower = st.toLowerCase().replace(" ","");
    return `
      <div class="task-card priority-${t.priority.toLowerCase()} status-${statusLower}">
        <div class="task-main">
          <strong>${esc(t.name)}</strong>
          <div class="task-meta">
            <span><i class="fa-solid fa-bed-pulse"></i> ${esc(p?.code || "")} ${p ? `· ${esc(p.bed)}` : ""}</span>
            <span><i class="fa-solid fa-clock"></i> Due ${esc(t.dueTime || "—")}</span>
            <span><i class="fa-solid fa-hourglass"></i> ~${t.estimatedDuration} min</span>
          </div>
        </div>
        <div class="task-side">
          <span class="badge ${t.priority.toLowerCase()}">${t.priority}</span>
          <span class="badge ${statusLower}">${st}</span>
          <div class="task-buttons">
            ${st !== "Completed" && st !== "Not Completed" ? `<button class="btn btn-xs btn-teal" data-start="${t.id}">Start</button>` : ""}
            ${st !== "Completed" && st !== "Not Completed" ? `<button class="btn btn-xs btn-primary" data-complete="${t.id}">Complete</button>` : ""}
            ${st !== "Completed" && st !== "Not Completed" ? `<button class="btn btn-xs btn-danger" data-nc="${t.id}">Not Done</button>` : ""}
          </div>
        </div>
      </div>
    `;
  }).join("")}</div>`;

  $$("[data-start]", root).forEach(b => b.onclick = () => updateTaskStatus(b.dataset.start, "In Progress"));
  $$("[data-complete]", root).forEach(b => b.onclick = () => completeTask(b.dataset.complete));
  $$("[data-nc]", root).forEach(b => b.onclick = () => markNotCompleted(b.dataset.nc));
}

function renderNurseTasksPage(container) {
  const sess = Session.get();
  const myTasks = DB.data.tasks.filter(t => t.assignedNurseId === sess.nurseId);
  container.innerHTML = `
    <div class="page-header"><div><h1>My Tasks</h1><p>All tasks assigned to you this shift.</p></div></div>
    <div class="filter-bar">
      <select id="ntStatus"><option value="">All Statuses</option><option>Pending</option><option>In Progress</option><option>Completed</option><option>Overdue</option><option>Not Completed</option></select>
      <select id="ntPriority"><option value="">All Priorities</option><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></select>
    </div>
    <div id="ntContainer"></div>
  `;

  function renderList() {
    const s = $("#ntStatus").value;
    const p = $("#ntPriority").value;
    const filtered = myTasks.filter(t => {
      if (s && computeTaskStatus(t) !== s) return false;
      if (p && t.priority !== p) return false;
      return true;
    });
    renderMyTaskCards($("#ntContainer"), filtered);
  }
  $("#ntStatus").addEventListener("change", renderList);
  $("#ntPriority").addEventListener("change", renderList);
  renderList();
}

function updateTaskStatus(taskId, newStatus) {
  const t = DB.data.tasks.find(x => x.id === taskId);
  if (!t) return;
  t.status = newStatus;
  DB.save();
  audit("Task status updated", `${t.name} → ${newStatus}`);
  toast(`Task: ${newStatus}`, "info");
  Router.refresh();
}

function completeTask(taskId) {
  const t = DB.data.tasks.find(x => x.id === taskId);
  if (!t) return;
  const sess = Session.get();
  t.status = "Completed";
  t.completedAt = nowISO();
  t.completedBy = sess.name;
  t.notCompletedReason = null;
  DB.save();
  audit("Task completed", t.name);
  toast("Task marked completed.", "success");
  Router.refresh();
}

function markNotCompleted(taskId) {
  const t = DB.data.tasks.find(x => x.id === taskId);
  if (!t) return;
  Modal.open({
    title: "Mark Task Not Completed",
    body: `
      <p style="font-size:13px;color:var(--text-soft);margin-bottom:10px">Please specify the reason. This will be visible to the Head Nurse.</p>
      <select id="ncReasonSelect" style="margin-bottom:10px">
        <option>Patient condition changed</option>
        <option>Patient refused</option>
        <option>Supplies not available</option>
        <option>Emergency intervention</option>
        <option>Other</option>
      </select>
      <textarea id="ncReasonText" placeholder="Additional details (optional)"></textarea>
    `,
    footer: `
      <button class="btn btn-outline" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-danger" id="ncConfirm">Confirm</button>
    `,
    onMount() {
      $("#ncConfirm").onclick = () => {
        const reason = $("#ncReasonSelect").value + ($("#ncReasonText").value ? ` – ${$("#ncReasonText").value}` : "");
        t.status = "Not Completed";
        t.notCompletedReason = reason;
        DB.save();
        audit("Task marked Not Completed", t.name, reason);
        toast("Task status updated.", "warning");
        Modal.close();
        Router.refresh();
      };
    }
  });
}

/* =================== NURSE SHIFT SUMMARY =================== */
function renderNurseSummaryPage(container) {
  const sess = Session.get();
  const myTasks = DB.data.tasks.filter(t => t.assignedNurseId === sess.nurseId);
  const myPts = DB.data.patients.filter(p => p.assignedNurseId === sess.nurseId);
  const shift = getActiveShift();

  container.innerHTML = `
    <div class="page-header"><div><h1>My Shift Summary</h1><p>${shift ? `${esc(shift.type)} · ${esc(shift.date)}` : "No shift"}</p></div></div>
    <div class="stats-grid">
      ${statCard("Patients", myPts.length, "blue", "fa-bed-pulse")}
      ${statCard("Tasks", myTasks.length, "purple", "fa-list-check")}
      ${statCard("Completed", myTasks.filter(t=>t.status==="Completed").length, "green", "fa-circle-check")}
      ${statCard("Pending", myTasks.filter(t=>t.status==="Pending" || t.status==="In Progress").length, "amber", "fa-hourglass")}
      ${statCard("Overdue", myTasks.filter(t=>computeTaskStatus(t)==="Overdue").length, "red", "fa-triangle")}
      ${statCard("Not Completed", myTasks.filter(t=>t.status==="Not Completed").length, "red", "fa-circle-xmark")}
    </div>
    <div class="card">
      <div class="card-title"><i class="fa-solid fa-clipboard-list"></i> Task Details</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Task</th><th>Patient</th><th>Priority</th><th>Status</th><th>Completed At</th><th>Reason (if not done)</th></tr></thead>
        <tbody>${myTasks.map(t => {
          const p = getPatientById(t.patientId);
          return `<tr>
            <td class="cell-strong">${esc(t.name)}</td>
            <td>${esc(p?.code || "")}</td>
            <td><span class="badge ${t.priority.toLowerCase()}">${t.priority}</span></td>
            <td><span class="badge ${computeTaskStatus(t).toLowerCase().replace(" ","")}">${computeTaskStatus(t)}</span></td>
            <td>${t.completedAt ? fmtTime(t.completedAt) : "—"}</td>
            <td class="cell-sub">${esc(t.notCompletedReason || "—")}</td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>
    </div>
  `;
}

/* =================== ADMIN PAGE =================== */
function renderAdminPage(container) {
  container.innerHTML = `
    <div class="page-header"><div><h1>System Administration</h1><p>Manage users, departments and demo settings.</p></div></div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title"><i class="fa-solid fa-users-gear"></i> Users</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Active</th><th>Actions</th></tr></thead>
        <tbody>${DB.data.users.map(u => `
          <tr>
            <td class="cell-strong">${esc(u.username)}</td>
            <td>${esc(u.name)}</td>
            <td><span class="badge ${u.role === "admin" ? "purple" : u.role === "headnurse" ? "teal" : "medium"}">${u.role}</span></td>
            <td><span class="badge ${u.active ? "available" : "unavailable"}">${u.active ? "Active" : "Inactive"}</span></td>
            <td>
              <button class="btn btn-sm btn-outline" data-toggle="${u.id}"><i class="fa-solid fa-power-off"></i></button>
              <button class="btn btn-sm btn-outline" data-pw="${u.id}"><i class="fa-solid fa-key"></i></button>
            </td>
          </tr>
        `).join("")}</tbody>
      </table></div>
    </div>

    <div class="card">
      <div class="card-title"><i class="fa-solid fa-building"></i> Departments</div>
      <ul style="padding-left:18px;font-size:13px">${DB.data.departments.map(d => `<li>${esc(d.name)}</li>`).join("")}</ul>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px">Adding new departments will be supported in a future version.</p>
    </div>
  `;

  $$("[data-toggle]").forEach(b => b.onclick = () => {
    const u = DB.data.users.find(x => x.id === b.dataset.toggle);
    u.active = !u.active;
    DB.save();
    audit("User status changed", `${u.username} → ${u.active ? "active" : "inactive"}`);
    toast("User updated.", "success");
    Router.refresh();
  });
  $$("[data-pw]").forEach(b => b.onclick = () => {
    const u = DB.data.users.find(x => x.id === b.dataset.pw);
    u.password = "123456";
    DB.save();
    audit("Password reset", u.username);
    toast(`Password reset for ${u.username} to 123456.`, "success");
  });
}