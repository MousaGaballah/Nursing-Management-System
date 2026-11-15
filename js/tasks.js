/* ============================================================
   tasks.js — nursing task management (head nurse)
   ============================================================ */
"use strict";

const PRIORITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

function getTasks() { return DB.data.tasks; }

function taskSortComparator(a, b) {
  const pa = PRIORITY_ORDER[a.priority] ?? 9;
  const pb = PRIORITY_ORDER[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  const ta = a.dueTime ? timeToMinutes(a.dueTime) : 9999;
  const tb = b.dueTime ? timeToMinutes(b.dueTime) : 9999;
  return ta - tb;
}

function computeTaskStatus(task) {
  if (task.status === "Completed" || task.status === "Not Completed") return task.status;
  if (task.dueTime) {
    const dueMin = timeToMinutes(task.dueTime);
    if (dueMin !== null && minutesNow() > dueMin && task.status !== "Completed") {
      return "Overdue";
    }
  }
  return task.status;
}

function renderTasksPage(container) {
  const locked = isAssignmentLocked();

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Task Management</h1>
        <p>Create, edit and monitor nursing tasks. Tasks are sorted by priority and due time.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="addTaskBtn"><i class="fa-solid fa-plus"></i> Add Task</button>
        <button class="btn btn-outline" id="seedTasksBtn"><i class="fa-solid fa-wand-magic-sparkles"></i> Auto-Seed from Care Needs</button>
      </div>
    </div>

    <div class="filter-bar">
      <input type="text" id="taskSearch" class="search-input" placeholder="Search tasks, patient, nurse..." />
      <select id="taskPriorityFilter">
        <option value="">All Priorities</option>
        <option>Critical</option><option>High</option><option>Medium</option><option>Low</option>
      </select>
      <select id="taskStatusFilter">
        <option value="">All Statuses</option>
        <option>Pending</option><option>In Progress</option><option>Completed</option>
        <option>Overdue</option><option>Not Completed</option>
      </select>
      <select id="taskNurseFilter">
        <option value="">All Nurses</option>
        ${DB.data.nurses.map(n => `<option value="${n.id}">${esc(n.name)}</option>`).join("")}
      </select>
    </div>

    <div class="card">
      <div id="taskTableContainer"></div>
    </div>
  `;

  function renderTable() {
    const q = $("#taskSearch").value.trim().toLowerCase();
    const pri = $("#taskPriorityFilter").value;
    const sta = $("#taskStatusFilter").value;
    const nid = $("#taskNurseFilter").value;

    // refresh statuses (overdue auto)
    DB.data.tasks.forEach(t => {
      if (t.status === "Pending" || t.status === "In Progress") {
        const computed = computeTaskStatus(t);
        if (computed === "Overdue" && t.status !== "Overdue") {
          t.status = "Overdue";
        }
      }
    });
    DB.save();

    const list = DB.data.tasks.filter(t => {
      if (pri && t.priority !== pri) return false;
      if (sta && t.status !== sta) return false;
      if (nid && t.assignedNurseId !== nid) return false;
      if (q) {
        const patient = getPatientById(t.patientId);
        const nurse = getNurseById(t.assignedNurseId);
        const blob = `${t.name} ${t.description || ""} ${patient?.name || ""} ${patient?.code || ""} ${nurse?.name || ""}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    }).sort(taskSortComparator);

    const wrap = $("#taskTableContainer");
    if (!list.length) {
      wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-list-check"></i><h4>No tasks</h4><p>Add a task or auto-seed from patient care needs.</p></div>`;
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap"><table class="data-table">
        <thead><tr>
          <th>Task</th><th>Patient</th><th>Nurse</th><th>Priority</th><th>Due</th><th>Status</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${list.map(t => {
            const p = getPatientById(t.patientId);
            const n = getNurseById(t.assignedNurseId);
            const statusLower = t.status.toLowerCase().replace(" ","");
            return `
              <tr>
                <td class="cell-strong">${esc(t.name)}<div class="cell-sub">${esc(t.description || "")}</div></td>
                <td>${p ? `${esc(p.code)}<div class="cell-sub">${esc(p.name)}</div>` : "—"}</td>
                <td>${n ? esc(n.name) : "—"}</td>
                <td><span class="badge ${t.priority.toLowerCase()}">${t.priority}</span></td>
                <td>${esc(t.dueTime || "—")}</td>
                <td><span class="badge ${statusLower}">${t.status}</span></td>
                <td>
                  <div class="table-actions">
                    <button class="btn btn-sm btn-outline" data-edit="${t.id}"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-sm btn-danger" data-del="${t.id}"><i class="fa-solid fa-trash"></i></button>
                  </div>
                </td>
              </tr>`;
          }).join("")}
        </tbody>
      </table></div>
    `;

    $$("[data-edit]", wrap).forEach(b => b.onclick = () => openTaskForm(b.dataset.edit));
    $$("[data-del]", wrap).forEach(b => b.onclick = () => deleteTask(b.dataset.del));
  }

  $("#taskSearch").addEventListener("input", renderTable);
  $("#taskPriorityFilter").addEventListener("change", renderTable);
  $("#taskStatusFilter").addEventListener("change", renderTable);
  $("#taskNurseFilter").addEventListener("change", renderTable);

  $("#addTaskBtn").onclick = () => openTaskForm(null);
  $("#seedTasksBtn").onclick = autoSeedTasks;

  renderTable();
}

function openTaskForm(taskId) {
  const editing = taskId ? DB.data.tasks.find(t => t.id === taskId) : null;
  const patients = DB.data.patients.filter(p => p.assignedNurseId);
  if (!patients.length) {
    toast("Assign patients to nurses before creating tasks.", "warning");
    return;
  }

  Modal.open({
    title: editing ? "Edit Task" : "Add Nursing Task",
    wide: true,
    body: `
      <form id="taskForm" class="form-grid">
        <div class="full">
          <label><small style="font-weight:600;color:var(--text-soft)">Patient *</small></label>
          <select id="tfPatient">
            ${patients.map(p => `<option value="${p.id}" ${editing?.patientId === p.id ? "selected" : ""}>${esc(p.code)} – ${esc(p.name)} (Nurse: ${esc(getNurseById(p.assignedNurseId)?.name || "—")})</option>`).join("")}
          </select>
        </div>
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">Task Name *</small></label>
          <input type="text" id="tfName" value="${esc(editing?.name || "")}" placeholder="e.g., Vital Signs Monitoring" required />
        </div>
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">Priority *</small></label>
          <select id="tfPriority">
            ${["Critical","High","Medium","Low"].map(p => `<option ${editing?.priority === p ? "selected" : ""}>${p}</option>`).join("")}
          </select>
        </div>
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">Due Time</small></label>
          <input type="time" id="tfDue" value="${esc(editing?.dueTime || "")}" />
        </div>
        <div>
          <label><small style="font-weight:600;color:var(--text-soft)">Estimated Duration (min)</small></label>
          <input type="number" id="tfDuration" min="1" value="${editing?.estimatedDuration ?? 10}" />
        </div>
        <div class="full">
          <label><small style="font-weight:600;color:var(--text-soft)">Description</small></label>
          <textarea id="tfDesc" placeholder="Task details...">${esc(editing?.description || "")}</textarea>
        </div>
        <div class="full">
          <label><small style="font-weight:600;color:var(--text-soft)">Special Instructions</small></label>
          <input type="text" id="tfInstr" value="${esc(editing?.specialInstructions || "")}" />
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn-outline" id="tfCancel">Cancel</button>
      <button class="btn btn-primary" id="tfSave">${editing ? "Update" : "Add Task"}</button>
    `,
    onMount() {
      $("#tfCancel").onclick = () => Modal.close();
      $("#tfSave").onclick = () => {
        const name = $("#tfName").value.trim();
        if (!name) { toast("Task name is required.", "error"); return; }
        const pid = $("#tfPatient").value;
        const patient = getPatientById(pid);
        if (!patient) { toast("Select a valid patient.", "error"); return; }

        const payload = {
          patientId: pid,
          assignedNurseId: patient.assignedNurseId,
          name,
          priority: $("#tfPriority").value,
          dueTime: $("#tfDue").value,
          estimatedDuration: Number($("#tfDuration").value) || 10,
          description: $("#tfDesc").value.trim(),
          specialInstructions: $("#tfInstr").value.trim()
        };

        if (editing) {
          Object.assign(editing, payload);
          audit("Task updated", `${name} → ${payload.priority} @ ${payload.dueTime}`);
          toast("Task updated.", "success");
        } else {
          DB.data.tasks.push({
            id: uid("task"),
            ...payload,
            status: "Pending",
            completedAt: null,
            completedBy: null,
            notCompletedReason: null,
            createdAt: nowISO(),
            createdBy: Session.get().name
          });
          audit("Task created", `${name} for ${patient.code}`);
          toast("Task created.", "success");
        }
        DB.save();
        Modal.close();
        Router.refresh();
      };
    }
  });
}

function deleteTask(id) {
  const t = DB.data.tasks.find(x => x.id === id);
  if (!t) return;
  Modal.confirm({
    title: "Delete Task",
    message: `Delete task "${t.name}"?`,
    confirmText: "Delete",
    danger: true,
    onConfirm: () => {
      DB.data.tasks = DB.data.tasks.filter(x => x.id !== id);
      audit("Task deleted", t.name);
      DB.save();
      toast("Task deleted.", "success");
      Router.refresh();
    }
  });
}

function autoSeedTasks() {
  const patients = DB.data.patients.filter(p => p.assignedNurseId);
  if (!patients.length) { toast("No assigned patients to seed.", "warning"); return; }

  let created = 0;
  patients.forEach(p => {
    (p.careNeeds || []).forEach(care => {
      // skip if an equivalent task exists for this patient
      const exists = DB.data.tasks.some(t => t.patientId === p.id && t.name.toLowerCase() === care.toLowerCase());
      if (exists) return;

      const priority = p.acuity >= 4 ? "Critical" : p.acuity >= 3 ? "High" : "Medium";
      DB.data.tasks.push({
        id: uid("task"),
        patientId: p.id,
        assignedNurseId: p.assignedNurseId,
        name: care,
        priority,
        dueTime: defaultDueFor(care),
        estimatedDuration: taskDuration(care),
        description: `Auto-generated from care needs`,
        specialInstructions: "",
        status: "Pending",
        completedAt: null,
        completedBy: null,
        notCompletedReason: null,
        createdAt: nowISO(),
        createdBy: Session.get().name
      });
      created++;
    });
  });
  DB.save();
  audit("Auto-seed tasks", `${created} tasks created from care needs`);
  toast(`${created} task(s) created.`, "success");
  Router.refresh();
}

function defaultDueFor(name) {
  const n = name.toLowerCase();
  if (n.includes("vital")) return "08:00";
  if (n.includes("medication")) return "09:00";
  if (n.includes("glucose")) return "07:30";
  if (n.includes("reposition")) return "10:00";
  if (n.includes("wound")) return "11:00";
  return "10:30";
}