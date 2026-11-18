/* ============================================================
   notifications.js — Notification Center + Engine
   ============================================================ */
"use strict";

let __notifTimer = null;
const __firedKeys = new Set();

function pushNotification(notification) {
  if (notification.key && __firedKeys.has(notification.key)) return;
  if (notification.key) __firedKeys.add(notification.key);

  DB.data.notifications.unshift({
    id: uid("notif"),
    read: false,
    ...notification,
    createdAt: nowISO()
  });
  if (DB.data.notifications.length > 200) DB.data.notifications.length = 200;
  DB.save();
  updateNotifBadge();
  if (DB.data.settings.soundEnabled) playBeep();

  const panel = $("#notifPanel");
  if (panel && !panel.classList.contains("hidden")) renderNotifPanel();
}

function getRelevantNotifications() {
  const sess = Session.get();
  if (!sess) return [];
  return DB.data.notifications.filter(n => {
    if (sess.role === "nurse") {
      if (n.targetNurseId) return n.targetNurseId === sess.nurseId;
      const tk = DB.data.tasks.find(x => x.id === n.taskId);
      return tk && tk.assignedNurseId === sess.nurseId;
    }
    return true;
  });
}

function updateNotifBadge() {
  const badge = $("#notifBadge");
  if (!badge) return;
  const unread = getRelevantNotifications().filter(n => !n.read).length;
  badge.textContent = unread > 99 ? "99+" : unread;
  badge.classList.toggle("hidden", unread === 0);
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

function tickNotifications() {
  const sess = Session.get();
  if (!sess) return;

  DB.data.tasks.forEach(task => {
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
          title: `${t("overdue")}: ${task.name}`,
          message: `${getPatientById(task.patientId)?.code || ""}`,
          taskId: task.id,
          targetNurseId: task.assignedNurseId,
          navigateTo: sess.role === "nurse" ? "nurseTasks" : "tasks"
        });
      }
    }

    if (isUpcoming(task) && sess.role === "nurse" && task.assignedNurseId === sess.nurseId) {
      pushNotification({
        key: `upcoming-${task.id}-${task.dueTime}`,
        type: "Upcoming Task",
        priority: task.priority === "Critical" ? "critical" : task.priority === "High" ? "high" : "medium",
        title: `${t("upcoming")}: ${task.name}`,
        message: `${t("dueTime")} ${task.dueTime}`,
        taskId: task.id,
        targetNurseId: task.assignedNurseId,
        navigateTo: "nurseTasks"
      });
    }

    if (task.dueTime && task.status !== "Completed" && task.status !== "Not Completed") {
      const dueMin = timeToMinutes(task.dueTime);
      const nowMin = minutesNow();
      const diff = nowMin - dueMin;
      if (diff >= 0 && diff < 2) {
        pushNotification({
          key: `due-${task.id}-${task.dueTime}`,
          type: "Due Task",
          priority: "high",
          title: `${t("dueNow")}: ${task.name}`,
          message: `${t("dueTime")} ${task.dueTime}`,
          taskId: task.id,
          targetNurseId: task.assignedNurseId,
          navigateTo: sess.role === "nurse" ? "nurseTasks" : "tasks"
        });
      }
    }
  });

  if (sess.role === "headnurse") {
    DB.data.tasks.filter(tk => tk.status === "Not Completed").forEach(tk => {
      pushNotification({
        key: `nc-${tk.id}`,
        type: "Head Nurse Alert",
        priority: "high",
        title: `${t("notCompleted")}: ${tk.name}`,
        message: `${t("reason")}: ${tk.notCompletedReason || "—"}`,
        taskId: tk.id,
        navigateTo: "tasks"
      });
    });
  }

  updateNotifBadge();
}

function startNotificationEngine() {
  if (__notifTimer) clearInterval(__notifTimer);
  setTimeout(() => { try { tickNotifications(); } catch (e) { console.error(e); } }, 800);
  __notifTimer = setInterval(() => {
    try { tickNotifications(); } catch (e) { console.error(e); }
  }, 30000);
}

function navigateToNotification(notif) {
  const sess = Session.get();
  if (!sess) return;

  let route = notif.navigateTo;
  if (!route) {
    if (["New Task Added", "Overdue Task", "Upcoming Task", "Due Task"].includes(notif.type)) {
      route = sess.role === "nurse" ? "nurseTasks" : "tasks";
    } else if (notif.type === "Head Nurse Alert") {
      route = "tasks";
    } else {
      route = sess.role === "nurse" ? "nurseDashboard" : "dashboard";
    }
  }

  notif.read = true;
  DB.save();
  updateNotifBadge();
  $("#notifPanel")?.classList.add("hidden");
  Router.go(route);

  if (notif.taskId) {
    setTimeout(() => { highlightTask(notif.taskId); }, 200);
  }
}

function highlightTask(taskId) {
  const selectors = [`[data-task-id="${taskId}"]`, `[data-complete="${taskId}"]`, `[data-edit="${taskId}"]`];
  let el = null;
  for (const sel of selectors) {
    el = document.querySelector(sel);
    if (el) break;
  }
  if (!el) return;
  const card = el.closest(".task-card, tr") || el;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.style.transition = "background 0.4s";
  const prev = card.style.background;
  card.style.background = "#fef3c7";
  setTimeout(() => { card.style.background = prev || ""; }, 1800);
}

function markNotifRead(notifId) {
  const n = DB.data.notifications.find(x => x.id === notifId);
  if (!n) return;
  n.read = true;
  DB.save();
  updateNotifBadge();
  renderNotifPanel();
}

function markAllNotifsRead() {
  getRelevantNotifications().forEach(n => { n.read = true; });
  DB.save();
  updateNotifBadge();
  renderNotifPanel();
  toast(t("allMarkedRead"), "success");
}

function deleteNotif(notifId) {
  DB.data.notifications = DB.data.notifications.filter(n => n.id !== notifId);
  DB.save();
  updateNotifBadge();
  renderNotifPanel();
}

function clearAllNotifs() {
  const sess = Session.get();
  if (!sess) return;
  Modal.confirm({
    title: t("clearAll"),
    message: t("clearAllConfirm"),
    confirmText: t("clearAll"),
    danger: true,
    onConfirm: () => {
      const toDelete = new Set(getRelevantNotifications().map(n => n.id));
      DB.data.notifications = DB.data.notifications.filter(n => !toDelete.has(n.id));
      DB.save();
      updateNotifBadge();
      renderNotifPanel();
      toast(t("dataDeleted"), "success");
    }
  });
}

function renderNotifPanel() {
  const list = $("#notifList");
  if (!list) return;
  const sess = Session.get();
  if (!sess) { list.innerHTML = ""; return; }

  const relevant = getRelevantNotifications().slice(0, 40);

  // Update header actions
  const actions = $("#notifPanelActions");
  if (actions) {
    const unreadCount = relevant.filter(n => !n.read).length;
    actions.innerHTML = `
      ${unreadCount > 0 ? `<button class="notif-header-btn" id="markAllReadBtn" title="${t("markAllRead")}"><i class="fa-solid fa-check-double"></i></button>` : ""}
      ${relevant.length > 0 ? `<button class="notif-header-btn danger" id="clearAllBtn" title="${t("clearAll")}"><i class="fa-solid fa-trash"></i></button>` : ""}
    `;
    const markAll = actions.querySelector("#markAllReadBtn");
    if (markAll) markAll.onclick = (e) => { e.stopPropagation(); markAllNotifsRead(); };
    const clearAll = actions.querySelector("#clearAllBtn");
    if (clearAll) clearAll.onclick = (e) => { e.stopPropagation(); clearAllNotifs(); };
  }

  if (!relevant.length) {
    list.innerHTML = `<div class="notif-empty"><i class="fa-solid fa-bell-slash" style="font-size:22px;margin-bottom:8px;display:block"></i>${t("noNotifications")}</div>`;
    return;
  }

  const iconFor = (type, priority) => {
    if (type === "New Task Added") return "fa-plus-circle";
    if (type === "Handover") return "fa-handshake";
    if (priority === "critical") return "fa-circle-exclamation";
    if (priority === "high") return "fa-triangle-exclamation";
    if (priority === "medium") return "fa-circle-info";
    return "fa-bell";
  };

  list.innerHTML = relevant.map(n => `
    <div class="notif-item ${n.read ? "read" : "unread"}">
      <div class="notif-icon ${n.priority || "info"}">
        <i class="fa-solid ${iconFor(n.type, n.priority)}"></i>
      </div>
      <div class="notif-content" data-click="${n.id}" role="button" tabindex="0">
        <strong>${esc(n.title)} ${!n.read ? '<span class="unread-dot"></span>' : ""}</strong>
        <p>${esc(n.message || "")}</p>
        <small>${fmtTime(n.createdAt)} · ${esc(n.type || "")}</small>
      </div>
      <div class="notif-actions">
        ${!n.read ? `<button class="notif-act-btn" data-read="${n.id}" title="${t("markRead")}"><i class="fa-solid fa-check"></i></button>` : ""}
        <button class="notif-act-btn danger" data-del="${n.id}" title="${t("delete")}"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>
  `).join("");

  $$("[data-click]", list).forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const n = DB.data.notifications.find(x => x.id === el.dataset.click);
      if (n) navigateToNotification(n);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
    });
  });
  $$("[data-read]", list).forEach(b => b.addEventListener("click", (e) => { e.stopPropagation(); markNotifRead(b.dataset.read); }));
  $$("[data-del]", list).forEach(b => b.addEventListener("click", (e) => { e.stopPropagation(); deleteNotif(b.dataset.del); }));
}