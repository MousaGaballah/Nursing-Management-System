/* ============================================================
   app.js — Core: storage, utilities, shell UI, toast, modal, router helpers
   ============================================================ */
"use strict";

const STORE_KEY = "smartNursingDB_v1";

/* ---------- Generic helpers ---------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
function nowISO() { return new Date().toISOString(); }
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  return `${fmtDate(iso)} ${fmtTime(iso)}`;
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function timeToMinutes(t) { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function minutesNow() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function downloadFile(filename, content, type = "text/csv") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------- Database ---------- */
const DB = {
  data: null,

  defaults() {
    return {
      users: [
        { id: "u_admin", username: "admin", password: "123456", name: "System Administrator", role: "admin", active: true },
        { id: "u_head", username: "headnurse", password: "123456", name: "Sarah Ahmed", role: "headnurse", active: true },
        { id: "u_n1", username: "nurse1", password: "123456", name: "Mona Khalil", role: "nurse", nurseId: "nur_1", active: true },
        { id: "u_n2", username: "nurse2", password: "123456", name: "Huda Salem", role: "nurse", nurseId: "nur_2", active: true },
        { id: "u_n3", username: "nurse3", password: "123456", name: "Laila Fares", role: "nurse", nurseId: "nur_3", active: true }
      ],
      departments: [
        { id: "dep_1", name: "Medical Ward" }
      ],
      shifts: [],
      nurses: [
        { id: "nur_1", code: "N-01", name: "Mona Khalil", qualification: "BSN", experience: 5,
          skills: ["Vital Signs", "Medication Administration", "Wound Care"], departmentId: "dep_1",
          availability: "available", assignedShift: "Morning" },
        { id: "nur_2", code: "N-02", name: "Huda Salem", qualification: "BSN", experience: 8,
          skills: ["Vital Signs", "Medication Administration", "IV Therapy", "Patient Education"], departmentId: "dep_1",
          availability: "available", assignedShift: "Morning" },
        { id: "nur_3", code: "N-03", name: "Laila Fares", qualification: "Diploma", experience: 2,
          skills: ["Vital Signs", "Patient Repositioning", "Specimen Collection"], departmentId: "dep_1",
          availability: "available", assignedShift: "Morning" }
      ],
      patients: [
        { id: "pat_1", code: "P-001", name: "Patient Alpha", bed: "Bed 101", mrn: "MRN-1001",
          diagnosis: "Pneumonia", history: "Hypertension", condition: "Stable", acuity: 3,
          careNeeds: ["Oxygen monitoring", "Medication administration", "Positioning"],
          specialNeeds: "Oxygen therapy", assignedNurseId: null, departmentId: "dep_1" },
        { id: "pat_2", code: "P-002", name: "Patient Bravo", bed: "Bed 102", mrn: "MRN-1002",
          diagnosis: "Post-op recovery", history: "None", condition: "Moderate", acuity: 4,
          careNeeds: ["Wound dressing", "Pain management", "Vital signs monitoring"],
          specialNeeds: "Post-operative monitoring", assignedNurseId: null, departmentId: "dep_1" },
        { id: "pat_3", code: "P-003", name: "Patient Charlie", bed: "Bed 103", mrn: "MRN-1003",
          diagnosis: "Diabetes Type 2", history: "Obesity", condition: "Stable", acuity: 2,
          careNeeds: ["Blood glucose monitoring", "Patient education", "Diet advice"],
          specialNeeds: "Insulin administration", assignedNurseId: null, departmentId: "dep_1" },
        { id: "pat_4", code: "P-004", name: "Patient Delta", bed: "Bed 104", mrn: "MRN-1004",
          diagnosis: "Fracture – right leg", history: "Osteoporosis", condition: "Stable", acuity: 2,
          careNeeds: ["Positioning", "Pain assessment", "Vital signs"],
          specialNeeds: "Immobility care", assignedNurseId: null, departmentId: "dep_1" },
        { id: "pat_5", code: "P-005", name: "Patient Echo", bed: "Bed 105", mrn: "MRN-1005",
          diagnosis: "COPD exacerbation", history: "Smoking", condition: "Critical", acuity: 4,
          careNeeds: ["Respiratory monitoring", "Oxygen therapy", "Medication administration", "Frequent repositioning"],
          specialNeeds: "High dependency", assignedNurseId: null, departmentId: "dep_1" }
      ],
      tasks: [],
      assignments: [],      // { id, patientId, nurseId, shiftId, locked, date, approvedBy, approvedAt }
      assignmentLock: {},   // { [shiftId]: { locked: true, approvedAt, approvedBy } }
      reassignmentLog: [],  // exceptional changes
      documentation: [],
      notifications: [],
      auditTrail: [],
      settings: {
        workloadWeights: {
          acuityWeight: 10,        // per acuity level point
          taskTypeWeight: 2,       // per task-type factor point
          durationWeight: 0.35,    // per minute of estimated duration
          frequencyWeight: 1.2,    // per repeat
          competencyBonus: 3       // per matched competency
        },
        soundEnabled: false,
        notificationLeadMinutes: 15,
        shiftDefaults: {
          Morning:  { start: "06:00", end: "12:00" },
          Evening:  { start: "12:00", end: "18:00" },
          Night:    { start: "18:00", end: "06:00" },
          Long:     { start: "06:00", end: "18:00" }
        },
        shiftTypes: [
          { key: "Morning", label: "Morning Shift", hours: 6 },
          { key: "Evening", label: "Evening Shift", hours: 6 },
          { key: "Night",   label: "Night Shift",   hours: 12 },
          { key: "Long",    label: "Long Shift",    hours: 12 }
        ]
      }
    };
  },

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        this.data = JSON.parse(raw);
        // ensure structure integrity on old data
        const def = this.defaults();
        for (const k of Object.keys(def)) {
          if (!(k in this.data)) this.data[k] = def[k];
        }
        for (const k of Object.keys(def.settings)) {
          if (!(k in this.data.settings)) this.data.settings[k] = def.settings[k];
        }
      } else {
        this.data = this.defaults();
        this.save();
      }
    } catch (e) {
      console.error("DB load failed:", e);
      this.data = this.defaults();
      this.save();
    }
    return this.data;
  },

  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.error("DB save failed:", e);
      toast("Storage error – data could not be saved.", "error");
    }
  },

  reset() {
    localStorage.removeItem(STORE_KEY);
    this.data = this.defaults();
    this.save();
  }
};

/* ---------- Session ---------- */
const Session = {
  key: "smartNursingSession",
  get() {
    try { return JSON.parse(sessionStorage.getItem(this.key)); }
    catch { return null; }
  },
  set(user) {
    sessionStorage.setItem(this.key, JSON.stringify({
      id: user.id, username: user.username, name: user.name, role: user.role, nurseId: user.nurseId || null
    }));
  },
  clear() { sessionStorage.removeItem(this.key); }
};

/* ---------- Audit ---------- */
function audit(action, details = "", reason = "") {
  const s = Session.get();
  DB.data.auditTrail.unshift({
    id: uid("aud"),
    action,
    user: s ? s.name : "system",
    userId: s ? s.id : null,
    details,
    reason,
    at: nowISO()
  });
  if (DB.data.auditTrail.length > 500) DB.data.auditTrail.length = 500;
  DB.save();
}

/* ---------- Toast ---------- */
function toast(message, type = "info") {
  const root = $("#toastRoot");
  if (!root) return;
  const icons = { success: "fa-circle-check", error: "fa-circle-xmark", warning: "fa-triangle-exclamation", info: "fa-circle-info" };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${esc(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateX(30px)";
    el.style.transition = "all .25s";
    setTimeout(() => el.remove(), 260);
  }, 3200);
}

/* ---------- Modal ---------- */
const Modal = {
  open({ title, body, footer, wide = false, onMount }) {
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = body;
    $("#modalFooter").innerHTML = footer || "";
    $("#modalBox").classList.toggle("wide", wide);
    $("#modalOverlay").classList.remove("hidden");
    if (typeof onMount === "function") onMount($("#modalBody"), $("#modalFooter"));
  },
  close() {
    $("#modalOverlay").classList.add("hidden");
    $("#modalBody").innerHTML = "";
    $("#modalFooter").innerHTML = "";
  },
  confirm({ title = "Confirm", message, confirmText = "Confirm", danger = false, onConfirm }) {
    this.open({
      title,
      body: `<p style="font-size:13.5px;color:var(--text-soft);line-height:1.6">${esc(message)}</p>`,
      footer: `
        <button class="btn btn-outline" id="modalCancelBtn">Cancel</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="modalConfirmBtn">${esc(confirmText)}</button>`,
      onMount() {
        $("#modalCancelBtn").onclick = () => Modal.close();
        $("#modalConfirmBtn").onclick = () => {
          Modal.close();
          if (typeof onConfirm === "function") onConfirm();
        };
      }
    });
  }
};

/* ---------- Route metadata (roles allowed per page) ---------- */
const ROUTES = {
  dashboard:      { title: "Dashboard",            section: "Overview",      roles: ["headnurse"] },
  shift:          { title: "Shift Setup",          section: "Overview",      roles: ["headnurse"] },
  nurses:         { title: "Nurse Management",     section: "Management",    roles: ["headnurse", "admin"] },
  patients:       { title: "Patient Management",   section: "Management",    roles: ["headnurse"] },
  workload:       { title: "Workload Calculator",  section: "Assignment",    roles: ["headnurse"] },
  assignment:     { title: "Patient Assignment",   section: "Assignment",    roles: ["headnurse"] },
  tasks:          { title: "Task Management",      section: "Operations",    roles: ["headnurse"] },
  monitor:        { title: "Monitoring Dashboard", section: "Operations",    roles: ["headnurse"] },
  reports:        { title: "Reports & Analytics",  section: "Reports",       roles: ["headnurse", "admin"] },
  audit:          { title: "Audit Trail",          section: "Reports",       roles: ["headnurse", "admin"] },
  admin:          { title: "System Administration",section: "Administration",roles: ["admin"] },

  nurseDashboard: { title: "My Dashboard",         section: "Nurse",         roles: ["nurse"] },
  nurseTasks:     { title: "My Tasks",             section: "Nurse",         roles: ["nurse"] },
  nurseDoc:       { title: "Nursing Documentation",section: "Nurse",         roles: ["nurse"] },
  nurseSummary:   { title: "My Shift Summary",     section: "Nurse",         roles: ["nurse"] }
};

/* ---------- Shell helpers ---------- */
function currentShift() {
  const s = DB.data.shifts[0] || null;
  return s;
}

function renderSidebar() {
  const s = Session.get();
  if (!s) return;
  const nav = $("#sidebarNav");
  const items = [];
  const add = (route, icon) => {
    const meta = ROUTES[route];
    if (meta.roles.includes(s.role)) {
      items.push(`<button class="nav-item" data-route="${route}"><i class="fa-solid ${icon}"></i>${meta.title}</button>`);
    }
  };

  if (s.role === "headnurse") {
    nav.innerHTML = `
      <div class="nav-section-label">Overview</div>
      ${'<button class="nav-item" data-route="dashboard"><i class="fa-solid fa-gauge-high"></i>Dashboard</button>'}
      ${'<button class="nav-item" data-route="shift"><i class="fa-solid fa-clock"></i>Shift Setup</button>'}
      <div class="nav-section-label">Management</div>
      ${'<button class="nav-item" data-route="nurses"><i class="fa-solid fa-user-nurse"></i>Nurses</button>'}
      ${'<button class="nav-item" data-route="patients"><i class="fa-solid fa-bed-pulse"></i>Patients</button>'}
      <div class="nav-section-label">Assignment</div>
      ${'<button class="nav-item" data-route="workload"><i class="fa-solid fa-scale-balanced"></i>Workload</button>'}
      ${'<button class="nav-item" data-route="assignment"><i class="fa-solid fa-people-arrows"></i>Assignment</button>'}
      <div class="nav-section-label">Operations</div>
      ${'<button class="nav-item" data-route="tasks"><i class="fa-solid fa-list-check"></i>Tasks</button>'}
      ${'<button class="nav-item" data-route="monitor"><i class="fa-solid fa-desktop"></i>Monitoring</button>'}
      <div class="nav-section-label">Reports</div>
      ${'<button class="nav-item" data-route="reports"><i class="fa-solid fa-chart-line"></i>Reports</button>'}
      ${'<button class="nav-item" data-route="audit"><i class="fa-solid fa-clipboard-list"></i>Audit Trail</button>'}
    `;
  } else if (s.role === "nurse") {
    nav.innerHTML = `
      <div class="nav-section-label">My Work</div>
      ${'<button class="nav-item" data-route="nurseDashboard"><i class="fa-solid fa-gauge-high"></i>My Dashboard</button>'}
      ${'<button class="nav-item" data-route="nurseTasks"><i class="fa-solid fa-list-check"></i>My Tasks</button>'}
      ${'<button class="nav-item" data-route="nurseDoc"><i class="fa-solid fa-file-medical"></i>Documentation</button>'}
      <div class="nav-section-label">Summary</div>
      ${'<button class="nav-item" data-route="nurseSummary"><i class="fa-solid fa-clipboard-check"></i>Shift Summary</button>'}
    `;
  } else if (s.role === "admin") {
    nav.innerHTML = `
      <div class="nav-section-label">Administration</div>
      ${'<button class="nav-item" data-route="admin"><i class="fa-solid fa-user-shield"></i>System Admin</button>'}
      ${'<button class="nav-item" data-route="nurses"><i class="fa-solid fa-user-nurse"></i>Nurses</button>'}
      ${'<button class="nav-item" data-route="reports"><i class="fa-solid fa-chart-line"></i>Reports</button>'}
      ${'<button class="nav-item" data-route="audit"><i class="fa-solid fa-clipboard-list"></i>Audit Trail</button>'}
    `;
  }

  // highlight active
  $$(".nav-item", nav).forEach(b => {
    b.onclick = () => { Router.go(b.dataset.route); if (window.innerWidth <= 900) $("#sidebar").classList.remove("open"); };
  });
}

function updateShellUser() {
  const s = Session.get();
  if (!s) return;
  $("#userNameTop").textContent = s.name;
  $("#userRoleTop").textContent = s.role === "headnurse" ? "Head Nurse" : s.role === "nurse" ? "Staff Nurse" : "Administrator";
  $("#userAvatar").textContent = s.name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();
}

function updateShiftBadge() {
  const shift = DB.data.shifts[0];
  const el = $("#sidebarShiftText");
  if (!el) return;
  if (shift) {
    el.textContent = `${shift.type} · ${shift.date}`;
  } else {
    el.textContent = "No active shift";
  }
}

/* ---------- Initial shell bootstrap (called once) ---------- */
function bootShell() {
  DB.load();
  updateShellUser();
  updateShiftBadge();
  renderSidebar();
  updateNotifBadge();

  // menu toggle
  const menuBtn = $("#menuToggle");
  if (menuBtn) menuBtn.onclick = () => $("#sidebar").classList.toggle("open");

  // user dropdown
  const uBtn = $("#userMenuBtn");
  const uDrop = $("#userDropdown");
  if (uBtn) {
    uBtn.onclick = (e) => { e.stopPropagation(); uDrop.classList.toggle("hidden"); };
  }
  document.addEventListener("click", (e) => {
    if (uDrop && !uDrop.contains(e.target) && uBtn && !uBtn.contains(e.target)) {
      uDrop.classList.add("hidden");
    }
  });

  // logout
  const logoutBtn = $("#logoutBtn");
  if (logoutBtn) logoutBtn.onclick = () => {
    audit("Logout", "");
    Session.clear();
    location.reload();
  };

  // reset demo
  const resetBtn = $("#resetDemoBtn");
  if (resetBtn) resetBtn.onclick = () => {
    Modal.confirm({
      title: "Reset Demo Data",
      message: "This will erase all current data and restore the original fictional demo data. Continue?",
      confirmText: "Reset",
      danger: true,
      onConfirm: () => {
        DB.reset();
        Session.clear();
        location.reload();
      }
    });
  };

  // notifications panel
  const notifBtn = $("#notifBtn");
  if (notifBtn) {
    notifBtn.onclick = (e) => {
      e.stopPropagation();
      $("#notifPanel").classList.toggle("hidden");
      if (typeof renderNotifPanel === "function") renderNotifPanel();
    };
  }
  const closeNotif = $("#closeNotifPanel");
  if (closeNotif) closeNotif.onclick = () => $("#notifPanel").classList.add("hidden");

  // sound toggle
  const soundBtn = $("#soundToggle");
  if (soundBtn) {
    soundBtn.classList.toggle("active", DB.data.settings.soundEnabled);
    soundBtn.innerHTML = `<i class="fa-solid ${DB.data.settings.soundEnabled ? "fa-volume-high" : "fa-volume-xmark"}"></i>`;
    soundBtn.onclick = () => {
      DB.data.settings.soundEnabled = !DB.data.settings.soundEnabled;
      DB.save();
      soundBtn.classList.toggle("active", DB.data.settings.soundEnabled);
      soundBtn.innerHTML = `<i class="fa-solid ${DB.data.settings.soundEnabled ? "fa-volume-high" : "fa-volume-xmark"}"></i>`;
      toast(`Sound alerts ${DB.data.settings.soundEnabled ? "enabled" : "disabled"}.`, "info");
    };
  }

  // modal close
  const modalClose = $("#modalClose");
  if (modalClose) modalClose.onclick = () => Modal.close();
  const overlay = $("#modalOverlay");
  if (overlay) overlay.addEventListener("click", (e) => { if (e.target === overlay) Modal.close(); });
}