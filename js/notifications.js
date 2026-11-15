/* ============================================================
   notifications.js — smart reminders, due & overdue alerts
   ------------------------------------------------------------
   NOTE: An alert is NEVER treated as task completion.
   ============================================================ */
"use strict";

let __notifTimer = null;
const __firedKeys = new Set();

function pushNotification(notification) {
  // Dedup by key
  if (notification.key && __firedKeys.has(notification.key)) return;
  if (notification.key) __firedKeys.add(notification.key);

  DB.data.notifications.unshift({
    id: uid("notif"),
    ...notification,
    createdAt: nowISO(),
    read: false
  });
  if (DB.data.notifications.length > 200) DB.data.notifications.length = 200;
  DB.save();
  updateNotifBadge();
  if (DB.data.settings.soundEnabled) playBeep();
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.06;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, 140);
  } catch { /* ignore */ }
}

function updateNotifBadge() {
  const sess = Session.get();
  if (!sess) return;
  const badge = $("#notifBadge");
  if (!badge) return;

  let count = 0;
  if (sess.role === "nurse") {
    const own = DB.data.tasks.filter(t => t.assignedNurseId === sess.nurseId);
    count = own.filter(t => {
      const st = computeTaskStatus(t);
      return st === "Overdue" || isUpcoming(t);
    }).length;
  } else if (sess.role === "headnurse") {
    count = DB.data.tasks.filter(t => {
      const st = computeTaskStatus(t);
      return st === "Overdue" || t.status === "Not Completed";
    }).length;
  }

  badge.textContent = count > 99 ? "99+" : count;
  badge.classList.toggle("hidden", count === 0);
}

function isUpcoming(task) {
  if (!task.dueTime) return false;
  if (task.status === "Completed" || task.status === "Not Completed") return false;
  const dueMin = timeToMinutes(task.dueTime);
  const nowMin = minutesNow();
  const diff = dueMin - nowMin;
  const lead = DB.data.settings.notificationLeadMinutes || 15;
  return diff >= 0 && diff <= lead;
}

/* ---------- Engine tick ---------- */
function tickNotifications() {
  const sess = Session.get();
  if (!sess) return;

  DB.data.tasks.forEach(task => {
    // Auto update overdue
    const computed = computeTaskStatus(task);
    if (computed === "Overdue" && task.status !== "Overdue" &&
        task.status !== "Completed" && task.status !== "Not Completed") {
      task.status = "Overdue";
      DB.save();
      if (sess.role === "headnurse" || (sess.role === "nurse" && task.assignedNurseId === sess.nurseId)) {
        pushNotification({
          key: `overdue-${task.id}`,
          type: "Overdue Task",
          priority: task.priority === "Critical" ? "critical" : task.priority === "High" ? "high" : "medium",
          title: `Overdue: ${task.name}`,
          message: `Task for ${getPatientById(task.patientId)?.code || "patient"} is overdue.`,
          taskId: task.id
        });
      }
    }

    // Upcoming reminder
    if (isUpcoming(task)) {
      if (sess.role === "nurse" && task.assignedNurseId === sess.nurseId) {
        pushNotification({
          key: `upcoming-${task.id}-${task.dueTime}`,
          type: "Upcoming Task",
          priority: task.priority === "Critical" ? "critical" : task.priority === "High" ? "high" : "medium",
          title: `Upcoming: ${task.name}`,
          message: `Due at ${task.dueTime}.`,
          taskId: task.id
        });
      }
    }

    // Due now
    if (task.dueTime && task.status !== "Completed" && task.status !== "Not Completed") {
      const dueMin = timeToMinutes(task.dueTime);
      const nowMin = minutesNow();
      const diff = nowMin - dueMin;
      if (diff >= 0 && diff < 2) {
        pushNotification({
          key: `due-${task.id}-${task.dueTime}`,
          type: "Due Task",
          priority: "high",
          title: `Due now: ${task.name}`,
          message: `Task is due now.`,
          taskId: task.id
        });
      }
    }
  });

  // Head nurse: pending not-completed alerts
  if (sess.role === "headnurse") {
    DB.data.tasks.filter(t => t.status === "Not Completed").forEach(t => {
      pushNotification({
        key: `nc-${t.id}`,
        type: "Head Nurse Alert",
        priority: "high",
        title: `Not completed: ${t.name}`,
        message: `Reason: ${t.notCompletedReason || "Not specified"}`,
        taskId: t.id
      });
    });
  }

  updateNotifBadge();
}

function startNotificationEngine() {
  if (__notifTimer) clearInterval(__notifTimer);
  // run immediately, then every 30s
  setTimeout(() => { try { tickNotifications(); } catch(e){ console.error(e); } }, 800);
  __notifTimer = setInterval(() => {
    try { tickNotifications(); } catch(e){ console.error(e); }
  }, 30000);
}

/* ---------- Notification panel renderer ---------- */
function renderNotifPanel() {
  const list = $("#notifList");
  if (!list) return;
  const sess = Session.get();
  if (!sess) { list.innerHTML = ""; return; }

  const relevant = DB.data.notifications.filter(n => {
    if (sess.role === "nurse") {
      const t = DB.data.tasks.find(x => x.id === n.taskId);
      return t && t.assignedNurseId === sess.nurseId;
    }
    return true; // head nurse sees all
  }).slice(0, 40);

  if (!relevant.length) {
    list.innerHTML = `<div class="notif-empty"><i class="fa-solid fa-bell-slash" style="font-size:22px;margin-bottom:8px;display:block"></i>No notifications</div>`;
    return;
  }

  const iconFor = (priority) => {
    if (priority === "critical") return "fa-circle-exclamation";
    if (priority === "high") return "fa-triangle-exclamation";
    if (priority === "medium") return "fa-circle-info";
    return "fa-bell";
  };

  list.innerHTML = relevant.map(n => `
    <div class="notif-item">
      <div class="notif-icon ${n.priority || "info"}"><i class="fa-solid ${iconFor(n.priority)}"></i></div>
      <div class="notif-content">
        <strong>${esc(n.title)}</strong>
        <p>${esc(n.message || "")}</p>
        <small>${fmtTime(n.createdAt)}</small>
      </div>
    </div>
  `).join("");
}