/* ============================================================
   auth.js — login, logout, role guard
   ============================================================ */
"use strict";

function attemptLogin(username, password) {
  const user = DB.data.users.find(u =>
    u.username.toLowerCase() === String(username).trim().toLowerCase() && u.active
  );
  if (!user) return { ok: false, message: "Invalid username or password." };
  if (user.password !== password) return { ok: false, message: "Invalid username or password." };

  Session.set(user);
  audit("Login", `User ${user.username} logged in`);
  return { ok: true, user };
}

function initLoginScreen() {
  const form = $("#loginForm");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const username = $("#loginUsername").value.trim();
    const password = $("#loginPassword").value;
    const errEl = $("#loginError");
    errEl.classList.add("hidden");

    if (!username || !password) {
      errEl.textContent = "Please enter username and password.";
      errEl.classList.remove("hidden");
      return;
    }

    const res = attemptLogin(username, password);
    if (!res.ok) {
      errEl.textContent = res.message;
      errEl.classList.remove("hidden");
      return;
    }

    toast(`Welcome, ${res.user.name}`, "success");
    enterApp();
  });

  // demo quick-fill chips
  $$(".demo-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      $("#loginUsername").value = chip.dataset.user;
      $("#loginPassword").value = chip.dataset.pass;
    });
  });
}

function enterApp() {
  const sess = Session.get();
  if (!sess) { showLogin(); return; }
  $("#loginScreen").classList.add("hidden");
  $("#appShell").classList.remove("hidden");
  bootShell();

  // Start notification engine for nurses & head nurse
  if (typeof startNotificationEngine === "function") startNotificationEngine();

  // Default route by role
  if (sess.role === "headnurse") Router.go("dashboard");
  else if (sess.role === "nurse") Router.go("nurseDashboard");
  else if (sess.role === "admin") Router.go("admin");
}

function showLogin() {
  $("#appShell").classList.add("hidden");
  $("#loginScreen").classList.remove("hidden");
}

function guardRoute(route) {
  const sess = Session.get();
  if (!sess) { showLogin(); return false; }
  const meta = ROUTES[route];
  if (!meta) return false;
  if (!meta.roles.includes(sess.role)) {
    toast("Access denied. You do not have permission for this page.", "error");
    return false;
  }
  return true;
}

/* Auto-boot on DOM ready */
document.addEventListener("DOMContentLoaded", () => {
  DB.load();
  initLoginScreen();
  if (Session.get()) {
    // Session persisted — go directly to app
    enterApp();
  } else {
    showLogin();
  }
});