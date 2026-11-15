/* ============================================================
   router.js — simple client-side page router
   ============================================================ */
"use strict";

const Router = {
  current: null,

  go(route) {
    if (!ROUTES[route]) {
      toast("Unknown page.", "error");
      return;
    }
    if (!guardRoute(route)) return;

    this.current = route;
    const meta = ROUTES[route];

    // update topbar
    $("#pageTitle").textContent = meta.title;
    $("#pageBreadcrumb").textContent = `${meta.section} / ${meta.title}`;

    // update sidebar highlight
    $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.route === route));

    // close panels
    $("#notifPanel")?.classList.add("hidden");

    // render page
    const content = $("#pageContent");
    content.innerHTML = "";
    const renderers = {
      dashboard:       () => renderHeadDashboard(content),
      shift:           () => renderShiftPage(content),
      nurses:          () => renderNursesPage(content),
      patients:        () => renderPatientsPage(content),
      workload:        () => renderWorkloadPage(content),
      assignment:      () => renderAssignmentPage(content),
      tasks:           () => renderTasksPage(content),
      monitor:         () => renderMonitorPage(content),
      reports:         () => renderReportsPage(content),
      audit:           () => renderAuditPage(content),
      admin:           () => renderAdminPage(content),

      nurseDashboard:  () => renderNurseDashboard(content),
      nurseTasks:      () => renderNurseTasksPage(content),
      nurseDoc:        () => renderNurseDocPage(content),
      nurseSummary:    () => renderNurseSummaryPage(content)
    };

    const fn = renderers[route];
    if (typeof fn === "function") {
      try { fn(); }
      catch (e) {
        console.error(e);
        content.innerHTML = `<div class="empty-state"><i class="fa-solid fa-bug"></i><h4>Page failed to render</h4><p>${esc(e.message)}</p></div>`;
      }
    } else {
      content.innerHTML = `<div class="empty-state"><i class="fa-solid fa-screwdriver-wrench"></i><h4>Coming soon</h4><p>This module is not implemented yet.</p></div>`;
    }

    // If nurse-side page, refresh notification badge
    if (typeof updateNotifBadge === "function") updateNotifBadge();
  },

  refresh() { if (this.current) this.go(this.current); }
};