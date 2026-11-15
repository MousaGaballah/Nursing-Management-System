/* ============================================================
   shifts.js — shift setup & management
   ============================================================ */
"use strict";

function getActiveShift() {
  return DB.data.shifts[0] || null;
}

function createOrUpdateShift({ id, type, date, start, end, departmentId }) {
  const existing = id ? DB.data.shifts.find(s => s.id === id) : null;
  const shift = existing || {
    id: uid("shift"),
    type, date, start, end, departmentId,
    createdAt: nowISO(),
    approvedAt: null
  };
  if (existing) Object.assign(existing, { type, date, start, end, departmentId });
  if (!existing) DB.data.shifts.unshift(shift);

  // keep only current active shift at top; archived remain at bottom if desired
  audit(existing ? "Shift updated" : "Shift created", `${type} on ${date} (${start}–${end})`);
  DB.save();
  return shift;
}

function renderShiftPage(container) {
  const active = getActiveShift();
  const deps = DB.data.departments;
  const { shiftTypes, shiftDefaults } = DB.data.settings;

  const depOptions = deps.map(d => `<option value="${d.id}" ${active && active.departmentId === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("");
  const typeOptions = shiftTypes.map(t => `<option value="${t.key}" ${active && active.type === t.key ? "selected" : ""}>${t.label} (${t.hours}h)</option>`).join("");

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Shift Setup</h1>
        <p>Configure the active shift for your department. Only one active shift is used in this prototype.</p>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title"><i class="fa-solid fa-clock"></i> ${active ? "Edit Current Shift" : "Create New Shift"}</div>
        <form id="shiftForm">
          <div class="form-grid">
            <div>
              <label class="form-group-label"><small style="color:var(--text-soft);font-weight:600">Department</small></label>
              <select id="shiftDept" required>${depOptions}</select>
            </div>
            <div>
              <label><small style="color:var(--text-soft);font-weight:600">Shift Type</small></label>
              <select id="shiftType" required>${typeOptions}</select>
            </div>
            <div>
              <label><small style="color:var(--text-soft);font-weight:600">Date</small></label>
              <input type="date" id="shiftDate" value="${active ? active.date : todayStr()}" required />
            </div>
            <div>
              <label><small style="color:var(--text-soft);font-weight:600">Start Time</small></label>
              <input type="time" id="shiftStart" value="${active ? active.start : "06:00"}" required />
            </div>
            <div>
              <label><small style="color:var(--text-soft);font-weight:600">End Time</small></label>
              <input type="time" id="shiftEnd" value="${active ? active.end : "12:00"}" required />
            </div>
          </div>
          <div style="margin-top:16px">
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> ${active ? "Update Shift" : "Create Shift"}</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="card-title"><i class="fa-solid fa-circle-info"></i> Current Shift Status</div>
        ${active ? `
          <div style="font-size:13px;line-height:2">
            <div><strong>Type:</strong> ${esc(active.type)} Shift</div>
            <div><strong>Date:</strong> ${esc(active.date)}</div>
            <div><strong>Time:</strong> ${esc(active.start)} – ${esc(active.end)}</div>
            <div><strong>Department:</strong> ${esc((DB.data.departments.find(d=>d.id===active.departmentId)||{}).name || "—")}</div>
            <div><strong>Created:</strong> ${fmtDateTime(active.createdAt)}</div>
            <div><strong>Assignment Approved:</strong> ${DB.data.assignmentLock[active.id]?.approvedAt ? fmtDateTime(DB.data.assignmentLock[active.id].approvedAt) : "Not yet"}</div>
          </div>
        ` : `<div class="empty-state" style="padding:30px 10px"><i class="fa-solid fa-clock-rotate-left"></i><h4>No shift configured</h4><p>Create a shift to continue.</p></div>`}
      </div>
    </div>
  `;

  // auto-fill end time when type changes
  const typeSel = $("#shiftType");
  const startInp = $("#shiftStart");
  const endInp = $("#shiftEnd");
  typeSel.addEventListener("change", () => {
    const def = shiftDefaults[typeSel.value];
    if (def) { startInp.value = def.start; endInp.value = def.end; }
  });

  $("#shiftForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const type = typeSel.value;
    const date = $("#shiftDate").value;
    const start = startInp.value;
    const end = endInp.value;
    const departmentId = $("#shiftDept").value;

    if (!date || !start || !end) { toast("Please fill all fields.", "error"); return; }
    if (timeToMinutes(end) <= timeToMinutes(start) && type !== "Night") {
      // allow overnight only for Night
      toast("End time must be after start time.", "error");
      return;
    }

    createOrUpdateShift({ id: active?.id, type, date, start, end, departmentId });
    toast("Shift saved successfully.", "success");
    updateShiftBadge();
    Router.refresh();
  });
}