const stateUrl = "./api/state";

const el = {
  summaryGrid: document.getElementById("summary-grid"),
  lastUpdated: document.getElementById("last-updated"),
  siteFilter: document.getElementById("site-filter"),
  statusFilter: document.getElementById("status-filter"),
  jobList: document.getElementById("job-list"),
  jobTitle: document.getElementById("job-title"),
  jobStatusPill: document.getElementById("job-status-pill"),
  jobEmpty: document.getElementById("job-empty"),
  jobDetail: document.getElementById("job-detail"),
  jobMetaGrid: document.getElementById("job-meta-grid"),
  strategyTab: document.getElementById("tab-strategy"),
  briefTab: document.getElementById("tab-brief"),
  reviewTab: document.getElementById("tab-review"),
  draftTab: document.getElementById("tab-draft"),
  activityTab: document.getElementById("tab-activity"),
  reviewComment: document.getElementById("review-comment"),
  reviewPreview: document.getElementById("review-preview"),
  approveJob: document.getElementById("approve-job"),
  requestChanges: document.getElementById("request-changes"),
  checkpointTitle: document.getElementById("checkpoint-title"),
  checkpointCopy: document.getElementById("checkpoint-copy"),
  siteTaxonomy: document.getElementById("site-taxonomy"),
  categoryPipeline: document.getElementById("category-pipeline"),
  clusterMap: document.getElementById("cluster-map"),
  urlFramework: document.getElementById("url-framework"),
  contentCalendar: document.getElementById("content-calendar"),
  planningSiteContext: document.getElementById("planning-site-context"),
  planningOverviewView: document.getElementById("planning-overview-view"),
  planningCalendarView: document.getElementById("planning-calendar-view"),
  planningPerformanceView: document.getElementById("planning-performance-view"),
  planningViewOverviewButton: document.getElementById("planning-view-overview"),
  planningViewCalendarButton: document.getElementById("planning-view-calendar"),
  planningViewPerformanceButton: document.getElementById("planning-view-performance"),
  performanceSummary: document.getElementById("performance-summary"),
  performancePages: document.getElementById("performance-pages"),
  performanceEvents: document.getElementById("performance-events"),
  syncStatus: document.getElementById("sync-status"),
  syncStatusText: document.getElementById("sync-status-text"),
  performanceStatus: document.getElementById("performance-status"),
};

const tabs = Array.from(document.querySelectorAll(".tab"));

let dashboardState = null;
let selectedJobId = null;
let selectedSiteId = "all";
let activeTab = "brief";
let activePlanningView = "overview";
let previewStatus = {};
let persistenceMode = "static";
let imageSearchState = {};
let autoImageFillState = {};

// Live-refresh state. lastSyncedAt is updated on every successful /api/state
// fetch and drives the sync indicator chip. POLL_INTERVAL_MS controls the
// background polling cadence; we pause polling when the tab is hidden or a
// review action is in flight to avoid clobbering an in-progress edit.
const POLL_INTERVAL_MS = 45000;
let lastSyncedAt = null;
let pollTimer = null;
let syncTickerTimer = null;
let refreshInFlight = false;

init().catch((error) => {
  console.error(error);
  el.jobList.innerHTML = `
    <div class="empty-state">
      <strong>Dashboard data failed to load.</strong>
      <p>Check ${stateUrl} and rebuild the dashboard state snapshot.</p>
    </div>
  `;
});

async function init() {
  await loadStateFromServer({ initial: true });
  bindEvents();
  renderSummary();
  renderFilters();
  renderPlanningBoard();
  renderJobs();
  renderPerformanceStatus();
  startSyncTicker();
  startPolling();
}

// Fetch /api/state and merge it into the local dashboardState. Used for both
// the initial load and every live refresh. Preserves the user's currently
// selected job / site / tab so a background poll doesn't disrupt navigation.
async function loadStateFromServer({ initial = false } = {}) {
  if (refreshInFlight) return false;
  refreshInFlight = true;
  setSyncIndicator("syncing");
  try {
    const response = await fetch(stateUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`State fetch failed: HTTP ${response.status}`);
    }
    const fresh = await response.json();
    dashboardState = fresh;
    persistenceMode = fresh.persistence || "static";
    previewStatus = Object.fromEntries(
      (fresh.jobs || []).map((job) => [job.job_id, job.status]),
    );
    if (initial) {
      selectedSiteId = "all";
    } else {
      // Keep the selected job pointed at the latest version of itself; clear
      // if it has been removed (e.g. published and rotated off the queue).
      if (selectedJobId && !fresh.jobs.some((job) => job.job_id === selectedJobId)) {
        selectedJobId = null;
      }
    }
    lastSyncedAt = Date.now();
    setSyncIndicator("ok");
    return true;
  } catch (error) {
    console.error("loadStateFromServer", error);
    setSyncIndicator("error", error.message || "Sync failed");
    return false;
  } finally {
    refreshInFlight = false;
  }
}

// Re-render every panel that reads from dashboardState. Called after a live
// refresh so the UI catches up without a hard page reload.
function rerenderAllPanels() {
  renderSummary();
  renderFilters();
  renderPlanningBoard();
  renderJobs();
  renderSelectedJob();
  renderPerformanceStatus();
}

// Live refresh entry point used by the post-action paths and the background
// poll. Re-fetches state and re-renders if anything changed.
async function liveRefresh({ silent = false } = {}) {
  if (reviewActionInFlight) return;
  const before = serializeJobsForDiff(dashboardState);
  const fetched = await loadStateFromServer();
  if (!fetched) return;
  const after = serializeJobsForDiff(dashboardState);
  if (silent && before === after) {
    return; // Nothing changed, no need to repaint and steal focus.
  }
  rerenderAllPanels();
}

function serializeJobsForDiff(state) {
  if (!state?.jobs) return "";
  return state.jobs
    .map((job) => `${job.job_id}:${job.status}:${job.updated_at || ""}`)
    .join("|");
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    liveRefresh({ silent: true });
  }, POLL_INTERVAL_MS);

  // Refresh immediately when the tab becomes visible again — keeps the
  // dashboard fresh after you switch back from another tab.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      liveRefresh({ silent: true });
    }
  });
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startSyncTicker() {
  if (syncTickerTimer) clearInterval(syncTickerTimer);
  syncTickerTimer = setInterval(updateSyncIndicatorText, 5000);
}

function setSyncIndicator(state, detail = "") {
  if (!el.syncStatus) return;
  el.syncStatus.dataset.state = state;
  if (state === "syncing") {
    el.syncStatusText.textContent = "Syncing…";
  } else if (state === "error") {
    el.syncStatusText.textContent = `Sync failed — ${detail || "retrying"}`;
  } else {
    updateSyncIndicatorText();
  }
}

function updateSyncIndicatorText() {
  if (!el.syncStatusText) return;
  if (!lastSyncedAt) return;
  const secondsAgo = Math.max(0, Math.round((Date.now() - lastSyncedAt) / 1000));
  el.syncStatusText.textContent = `Synced ${formatRelativeSeconds(secondsAgo)}`;
}

function formatRelativeSeconds(seconds) {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function renderPerformanceStatus() {
  if (!el.performanceStatus) return;
  const generatedAt = dashboardState?.performance?.generated_at;
  if (!generatedAt) {
    el.performanceStatus.hidden = true;
    return;
  }
  const ageMs = Date.now() - new Date(generatedAt).getTime();
  const ageMinutes = Math.max(0, Math.round(ageMs / 60000));
  const label = ageMinutes < 60
    ? `${ageMinutes}m ago`
    : ageMinutes < 60 * 24
      ? `${Math.floor(ageMinutes / 60)}h ago`
      : `${Math.floor(ageMinutes / (60 * 24))}d ago`;
  el.performanceStatus.hidden = false;
  el.performanceStatus.textContent = `GA4 refreshed ${label}`;
  el.performanceStatus.title = `GA4 snapshot generated at ${new Date(generatedAt).toLocaleString()}`;
}

function bindEvents() {
  el.siteFilter.addEventListener("change", () => {
    selectedSiteId = el.siteFilter.value || "all";
    renderPlanningBoard();
    renderJobs();
  });

  el.statusFilter.addEventListener("change", () => {
    renderJobs();
  });

  el.planningViewOverviewButton.addEventListener("click", () => {
    activePlanningView = "overview";
    updatePlanningViews();
  });

  el.planningViewCalendarButton.addEventListener("click", () => {
    activePlanningView = "calendar";
    updatePlanningViews();
  });

  el.planningViewPerformanceButton.addEventListener("click", () => {
    activePlanningView = "performance";
    updatePlanningViews();
  });

  tabs.forEach((tabButton) => {
    tabButton.addEventListener("click", () => {
      activeTab = tabButton.dataset.tab;
      updateTabs();
      renderSelectedJob();
    });
  });

  el.approveJob.addEventListener("click", () => {
    handleReviewAction("approve");
  });

  el.requestChanges.addEventListener("click", () => {
    handleReviewAction("request_changes");
  });

  document.addEventListener("click", async (event) => {
    if (event.target.closest("#save-review-notes")) {
      handleReviewAction("save_review_notes");
      return;
    }

    if (event.target.closest("[data-auto-pick-images]")) {
      handleAutoPickImages();
      return;
    }

    const searchButton = event.target.closest("[data-image-search-index]");
    if (searchButton) {
      const index = Number.parseInt(searchButton.dataset.imageSearchIndex, 10);
      handleImageSearch(index);
      return;
    }

    const selectButton = event.target.closest("[data-image-select-index]");
    if (selectButton) {
      const index = Number.parseInt(selectButton.dataset.imageSelectIndex, 10);
      const resultIndex = Number.parseInt(selectButton.dataset.imageResultIndex, 10);
      handleImageSelect(index, resultIndex);
      return;
    }

    const button = event.target.closest("[data-copy-target]");
    if (!button) return;

    const payload = button.getAttribute("data-copy-payload") || "";
    if (!payload) return;

    try {
      await navigator.clipboard.writeText(payload);
      const originalLabel = button.textContent;
      button.textContent = "Copied";
      window.setTimeout(() => {
        button.textContent = originalLabel;
      }, 1200);
    } catch (error) {
      console.error(error);
      el.reviewPreview.innerHTML = `
        <h3>Copy failed</h3>
        <p class="muted">Clipboard access was blocked. Try again or copy from the draft preview manually.</p>
      `;
    }
  });
}

function renderSummary() {
  const summary = dashboardState.summary;
  el.lastUpdated.textContent = formatDateTime(summary.generated_at);

  el.summaryGrid.innerHTML = summary.cards
    .map(
      (card) => `
        <article class="summary-card">
          <span class="summary-label">${escapeHtml(card.label)}</span>
          <strong class="summary-value">${escapeHtml(String(card.value))}</strong>
        </article>
      `,
    )
    .join("");
}

function renderPlanningBoard() {
  const sites = dashboardState.sites || [];
  const jobs = dashboardState.jobs || [];
  const primarySite =
    sites.find((site) => site.site_id === selectedSiteId) || sites[0];

  el.planningSiteContext.textContent =
    selectedSiteId === "all"
      ? "All sites"
      : primarySite?.site_name || "Current site";

  renderCategoryPipeline(primarySite, jobs);
  renderClusterMap(jobs);
  renderUrlFramework(primarySite);
  renderContentCalendar(jobs);
  renderPerformance(primarySite);
  updatePlanningViews();
}

function renderPerformance(site) {
  const performance = dashboardState.performance || { sites: [], source: "pending-oauth" };
  const sitePerformance =
    performance.sites?.find((item) => item.site_id === (selectedSiteId === "all" ? site?.site_id : selectedSiteId))
    || performance.sites?.[0];

  if (!sitePerformance) {
    el.performanceSummary.innerHTML = `
      <div class="empty-state compact-empty">
        <strong>GA4 is not connected yet.</strong>
        <p>Run the Google OAuth bootstrap once, then fetch the GA4 snapshot to populate site performance here.</p>
      </div>
    `;
    el.performancePages.innerHTML = "";
    el.performanceEvents.innerHTML = "";
    return;
  }

  const overview = sitePerformance.overview || {};
  const pages = sitePerformance.top_blog_pages || [];
  const events = sitePerformance.events || [];
  const eventLegend = [
    {
      name: "cta_click",
      description: "Clicks on blog CTA buttons and key homepage CTA buttons.",
    },
    {
      name: "registration_start",
      description: "Registration-intent CTA clicks that send a visitor toward buyer signup.",
    },
    {
      name: "registration_complete",
      description: "Successful buyer registration form submissions.",
    },
    {
      name: "contact_click",
      description: "Seller/contact form submissions plus tracked phone or email contact actions.",
    },
  ];

  el.performanceSummary.innerHTML = `
    <div class="performance-meta">
      <span class="meta-chip meta-chip-soft">${escapeHtml(sitePerformance.site_name)}</span>
      <span class="meta-chip meta-chip-soft">GA4 property ${escapeHtml(String(sitePerformance.property_id || ""))}</span>
      <span class="meta-chip meta-chip-soft">Updated ${escapeHtml(formatDateTime(dashboardState.performance.generated_at || ""))}</span>
    </div>
    <div class="performance-metrics">
      ${performanceMetric("Sessions (28d)", formatNumber(overview.sessions))}
      ${performanceMetric("Users (28d)", formatNumber(overview.activeUsers))}
      ${performanceMetric("Page views (28d)", formatNumber(overview.screenPageViews))}
      ${performanceMetric("Engagement rate", formatPercent(overview.engagementRate))}
      ${performanceMetric("Avg. session", formatDuration(overview.averageSessionDuration))}
    </div>
  `;

  el.performancePages.innerHTML = `
    <div class="performance-section-head">
      <h4>Top blog pages</h4>
    </div>
    <div class="performance-table">
      ${
        pages.length
          ? pages
              .map(
                (row) => `
                <div class="performance-row">
                  <div class="performance-path">${escapeHtml(row.pagePath || "")}</div>
                  <div>${formatNumber(row.screenPageViews)}</div>
                  <div>${formatNumber(row.sessions)}</div>
                  <div>${formatNumber(row.activeUsers)}</div>
                  <div>${formatPercent(row.engagementRate)}</div>
                </div>
              `,
              )
              .join("")
          : `<p class="muted">No blog page metrics available yet.</p>`
      }
    </div>
  `;

  el.performanceEvents.innerHTML = `
    <div class="performance-section-head">
      <h4>Lead events</h4>
    </div>
    <div class="performance-events-list">
      ${
        events.length
          ? events
              .map(
                (row) => `
                <div class="event-chip">
                  <span>${escapeHtml(row.eventName || "")}</span>
                  <strong>${formatNumber(row.eventCount)}</strong>
                </div>
              `,
              )
              .join("")
          : `<p class="muted">No tracked CTA or registration events have appeared in GA4 yet.</p>`
      }
    </div>
    <div class="performance-legend">
      <div class="performance-section-head">
        <h4>Event legend</h4>
      </div>
      <div class="performance-legend-list">
        ${eventLegend
          .map(
            (item) => `
              <div class="performance-legend-item">
                <strong>${escapeHtml(item.name)}</strong>
                <p>${escapeHtml(item.description)}</p>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderCategoryPipeline(site, jobs) {
  if (!site?.blog_categories?.length) {
    el.categoryPipeline.innerHTML = `<p class="muted">No categories configured yet.</p>`;
    return;
  }

  const scopedJobs = jobs.filter(
    (job) => selectedSiteId === "all" || job.site_id === selectedSiteId,
  );
  const jobCountsByCategory = scopedJobs.reduce((acc, job) => {
    const slug = job.seo_strategy?.category_slug || getCategorySlug(job.target_url);
    if (!slug) return acc;
    acc[slug] = acc[slug] || { total: 0, statuses: new Set() };
    acc[slug].total += 1;
    acc[slug].statuses.add(job.status);
    return acc;
  }, {});

  el.categoryPipeline.innerHTML = site.blog_categories
    .map((category) => {
      const bucket = jobCountsByCategory[category.slug];
      const total = bucket?.total || 0;
      const statuses = bucket
        ? [...bucket.statuses].map(labelizeStatus).join(" · ")
        : "No jobs yet";
      return `
        <div class="pipeline-lane">
          <div class="pipeline-head">
            <strong>${escapeHtml(category.name)}</strong>
            <span>${escapeHtml(category.slug)}</span>
          </div>
          <div class="pipeline-metric-row">
            <div class="pipeline-metric">${escapeHtml(String(total))}</div>
            <p>${escapeHtml(total ? statuses : "No jobs yet")}</p>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderClusterMap(jobs) {
  const scopedJobs = jobs.filter(
    (job) => selectedSiteId === "all" || job.site_id === selectedSiteId,
  );
  const clusters = scopedJobs.reduce((acc, job) => {
    const cluster = job.seo_strategy?.cluster || "Unassigned";
    acc[cluster] = acc[cluster] || [];
    acc[cluster].push(job);
    return acc;
  }, {});

  const entries = Object.entries(clusters);
  if (!entries.length) {
    el.clusterMap.innerHTML = `<p class="muted">No cluster strategy has been mapped yet.</p>`;
    return;
  }

  el.clusterMap.innerHTML = entries
    .map(
      ([cluster, clusterJobs]) => `
        <details class="cluster-card">
          <summary class="cluster-summary">
            <div class="cluster-title">
              <strong>${escapeHtml(labelizeSlug(cluster))}</strong>
              <span>${escapeHtml(String(clusterJobs.length))} job${clusterJobs.length === 1 ? "" : "s"}</span>
            </div>
          </summary>
          <div class="cluster-items">
            ${clusterJobs
              .map(
                (job) => `
                  <div class="cluster-item">
                    <span>${escapeHtml(job.topic)}</span>
                    <small>${escapeHtml(job.primary_keyword)}</small>
                  </div>
                `,
              )
              .join("")}
          </div>
        </details>
      `,
    )
    .join("");
}

function renderUrlFramework(site) {
  if (!site) {
    el.urlFramework.innerHTML = `<p class="muted">No site selected yet.</p>`;
    return;
  }

  const categories = site.blog_categories || [];
  const pattern = categories.length
    ? "/blog/{category}/{blog-name}"
    : "/blog/{blog-name}";

  // Show concrete examples for each category so reviewers can see the
  // actual URL shape each new post will get, not just an abstract template.
  const exampleRows = categories.length
    ? categories
        .map(
          (category) => `
            <div class="framework-row">
              <span class="framework-row-label">${escapeHtml(category.name)}</span>
              <code class="framework-row-path">/blog/${escapeHtml(category.slug)}/&lt;slug&gt;</code>
            </div>
          `,
        )
        .join("")
    : `<p class="muted">No categories configured.</p>`;

  el.urlFramework.innerHTML = `
    <div class="framework-pattern">${escapeHtml(pattern)}</div>
    <div class="framework-site">${escapeHtml(site.site_name)}</div>
    <div class="framework-list">${exampleRows}</div>
  `;
}

function renderContentCalendar(jobs) {
  const scopedJobs = jobs
    .filter((job) => selectedSiteId === "all" || job.site_id === selectedSiteId)
    .filter((job) => job.planned_publish_date);

  if (!scopedJobs.length) {
    el.contentCalendar.innerHTML = `<p class="muted">No monthly calendar slots have been planned for the current site filter yet.</p>`;
    return;
  }

  const monthKeys = [...new Set(scopedJobs.map((job) => String(job.planned_publish_date).slice(0, 7)))].sort();
  const monthBoards = monthKeys
    .map((monthKey) => renderMonthBoard(monthKey, scopedJobs))
    .join("");

  el.contentCalendar.innerHTML = `
    <div class="calendar-month-stack">
      ${monthBoards}
    </div>
  `;

  Array.from(document.querySelectorAll(".calendar-day-card")).forEach((button) => {
    button.addEventListener("click", () => {
      selectedJobId = button.dataset.jobId;
      const selectedJob = dashboardState.jobs.find((job) => job.job_id === selectedJobId);
      if (selectedJob) {
        selectedSiteId = selectedJob.site_id;
        el.siteFilter.value = selectedSiteId;
        renderPlanningBoard();
      }
      renderJobs();
      renderSelectedJob();
    });
  });
}

function renderMonthBoard(monthKey, jobs) {
  const [year, month] = monthKey.split("-").map(Number);
  const monthDate = new Date(year, month - 1, 1);
  const monthLabel = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(monthDate);
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const totalDays = lastDay.getDate();
  const cells = [];

  for (let index = 0; index < startOffset; index += 1) {
    cells.push(`<div class="calendar-grid-cell calendar-grid-cell-empty"></div>`);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const dateKey = `${monthKey}-${String(day).padStart(2, "0")}`;
    const dayJobs = jobs
      .filter((job) => job.planned_publish_date === dateKey)
      .sort((left, right) => {
        return (
          (right.seo_strategy?.opportunity_score ?? 0) -
          (left.seo_strategy?.opportunity_score ?? 0)
        );
      });

    cells.push(`
      <div class="calendar-grid-cell ${dayJobs.length ? "calendar-grid-cell-active" : ""}">
        <div class="calendar-grid-day">${day}</div>
        <div class="calendar-grid-events">
          ${dayJobs
            .map((job) => renderCalendarEvent(job))
            .join("")}
        </div>
      </div>
    `);
  }

  return `
    <div class="calendar-month-board">
      <div class="calendar-month-head">
        <strong>${escapeHtml(monthLabel)}</strong>
        <span>${escapeHtml(String(jobs.filter((job) => String(job.planned_publish_date).startsWith(monthKey)).length))} scheduled posts</span>
      </div>
      <div class="calendar-weekdays">
        <span>Mon</span>
        <span>Tue</span>
        <span>Wed</span>
        <span>Thu</span>
        <span>Fri</span>
        <span>Sat</span>
        <span>Sun</span>
      </div>
      <div class="calendar-grid">
        ${cells.join("")}
      </div>
    </div>
  `;
}

function renderCalendarEvent(job) {
  const category = getCategoryName(job, dashboardState.sites || []);
  const siteShort = selectedSiteId === "all" ? job.site_name : category;
  const leadGoal = job.seo_strategy?.lead_goal || "lead generation";
  const score = job.seo_strategy?.opportunity_score ?? "—";
  return `
    <button class="calendar-day-card calendar-day-card-inline" data-job-id="${escapeHtml(job.job_id)}">
      <div class="calendar-day-top">
        <span class="calendar-date">${escapeHtml(siteShort)}</span>
        <span class="calendar-score">${escapeHtml(String(score))}</span>
      </div>
      <strong>${escapeHtml(job.topic)}</strong>
      <div class="calendar-meta">${escapeHtml(category)} · ${escapeHtml(leadGoal)}</div>
    </button>
  `;
}

function updatePlanningViews() {
  const isOverview = activePlanningView === "overview";
  const isCalendar = activePlanningView === "calendar";
  const isPerformance = activePlanningView === "performance";
  el.planningOverviewView.classList.toggle("active", isOverview);
  el.planningCalendarView.classList.toggle("active", isCalendar);
  el.planningPerformanceView.classList.toggle("active", isPerformance);
  el.planningViewOverviewButton.classList.toggle("active", isOverview);
  el.planningViewCalendarButton.classList.toggle("active", isCalendar);
  el.planningViewPerformanceButton.classList.toggle("active", isPerformance);
}

function performanceMetric(label, value) {
  return `
    <article class="summary-card performance-metric-card">
      <span class="summary-label">${escapeHtml(label)}</span>
      <strong class="summary-value">${escapeHtml(String(value || "—"))}</strong>
    </article>
  `;
}

function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return new Intl.NumberFormat().format(num);
}

function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `${(num * 100).toFixed(1)}%`;
}

function formatDuration(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  const minutes = Math.floor(num / 60);
  const seconds = Math.round(num % 60);
  if (!minutes) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function renderFilters() {
  const siteOptions = ["all", ...(dashboardState.sites || []).map((site) => site.site_id)];
  el.siteFilter.innerHTML = siteOptions
    .map((siteId) => {
      const site = (dashboardState.sites || []).find((item) => item.site_id === siteId);
      const label = siteId === "all" ? "All sites" : site?.site_name || siteId;
      return `<option value="${escapeHtml(siteId)}" ${
        siteId === selectedSiteId ? "selected" : ""
      }>${escapeHtml(label)}</option>`;
    })
    .join("");

  const options = ["all", ...dashboardState.summary.statuses];
  el.statusFilter.innerHTML = options
    .map(
      (status) =>
        `<option value="${escapeHtml(status)}">${escapeHtml(labelizeStatus(status))}</option>`,
    )
    .join("");
}

function renderJobs() {
  const filter = el.statusFilter.value || "all";
  const jobs = dashboardState.jobs
    .filter((job) => {
      if (selectedSiteId !== "all" && job.site_id !== selectedSiteId) return false;
      if (filter === "all") return true;
      return previewStatus[job.job_id] === filter;
    })
    .sort((left, right) => compareQueueJobs(left, right, filter));

  if (!selectedJobId && jobs[0]) {
    selectedJobId = jobs[0].job_id;
  } else if (
    selectedJobId &&
    !jobs.some((job) => job.job_id === selectedJobId)
  ) {
    selectedJobId = jobs[0]?.job_id ?? null;
  }

  if (!jobs.length) {
    el.jobList.innerHTML = `
      <div class="empty-state">
        <strong>No jobs match this filter.</strong>
        <p>Try another status filter or add a new job to the automation hub.</p>
      </div>
    `;
    selectedJobId = null;
    renderSelectedJob();
    return;
  }

  el.jobList.innerHTML = jobs
    .map((job) => {
      const isActive = job.job_id === selectedJobId;
      const status = previewStatus[job.job_id];
      const category = getCategoryName(job, dashboardState.sites || []);
      const plagiarismStatus = job.final_review?.manual_plagiarism_status || "";
      const flaggedNote = job.final_review?.flagged_sections_note || "";
      return `
        <button class="job-card ${isActive ? "active" : ""}" data-job-id="${escapeHtml(job.job_id)}">
          <div class="job-card-site">${escapeHtml(job.site_name)}</div>
          <h3>${escapeHtml(job.topic)}</h3>
          <div class="job-card-category">${escapeHtml(category)}</div>
          ${
            job.planned_publish_date
              ? `<div class="job-card-date">${escapeHtml(formatCalendarDate(job.planned_publish_date))}</div>`
              : ""
          }
          <div class="job-card-meta">${escapeHtml(job.primary_keyword)}</div>
          <div class="job-card-meta">${escapeHtml(job.seo_strategy?.lead_goal || "lead generation")}</div>
          <div class="job-card-score">Opportunity score: ${escapeHtml(String(job.seo_strategy?.opportunity_score ?? "—"))}</div>
          ${
            plagiarismStatus
              ? `<div class="job-card-review">
                  <span class="review-chip review-chip-${escapeHtml(slugifyStatus(plagiarismStatus))}">${escapeHtml(plagiarismStatus)}</span>
                  ${
                    flaggedNote
                      ? `<p class="job-card-note">${escapeHtml(flaggedNote)}</p>`
                      : ""
                  }
                </div>`
              : ""
          }
          <span class="status-pill status-${escapeHtml(status)}">${escapeHtml(labelizeStatus(status))}</span>
        </button>
      `;
    })
    .join("");

  Array.from(document.querySelectorAll(".job-card")).forEach((button) => {
    button.addEventListener("click", () => {
      selectedJobId = button.dataset.jobId;
      const selectedJob = dashboardState.jobs.find((job) => job.job_id === selectedJobId);
      if (selectedJob) {
        selectedSiteId = selectedJob.site_id;
        el.siteFilter.value = selectedSiteId;
        renderPlanningBoard();
      }
      renderJobs();
      renderSelectedJob();
    });
  });

  renderSelectedJob();
}

function compareQueueJobs(left, right, filter) {
  if (filter === "published") {
    const leftDate = left.planned_publish_date || left.draft?.publishedAt || "";
    const rightDate = right.planned_publish_date || right.draft?.publishedAt || "";

    return (
      rightDate.localeCompare(leftDate)
      || String(right.site_name || "").localeCompare(String(left.site_name || ""))
      || String(right.topic || "").localeCompare(String(left.topic || ""))
    );
  }

  const leftDate = left.planned_publish_date || "9999-12-31";
  const rightDate = right.planned_publish_date || "9999-12-31";

  return (
    leftDate.localeCompare(rightDate)
    || String(left.site_name || "").localeCompare(String(right.site_name || ""))
    || String(left.topic || "").localeCompare(String(right.topic || ""))
  );
}

function renderSelectedJob() {
  const job = dashboardState.jobs.find((item) => item.job_id === selectedJobId);

  if (!job) {
    el.jobTitle.textContent = "No job selected";
    el.jobStatusPill.textContent = "";
    el.jobStatusPill.className = "status-pill hidden";
    el.jobEmpty.classList.remove("hidden");
    el.jobDetail.classList.add("hidden");
    renderSiteTaxonomy(selectedSiteId === "all" ? null : selectedSiteId);
    renderCheckpointSummary(null);
    return;
  }

  el.jobEmpty.classList.add("hidden");
  el.jobDetail.classList.remove("hidden");

  const status = previewStatus[job.job_id];
  const isPublished = status === "published";

  el.jobTitle.textContent = job.topic;
  el.jobStatusPill.textContent = labelizeStatus(status);
  el.jobStatusPill.className = `status-pill status-${status}`;
  el.jobMetaGrid.innerHTML = [
    metaCard("Site", job.site_name),
    metaCard("Category", getCategoryName(job, dashboardState.sites || [])),
    metaCard("Lead Goal", job.seo_strategy?.lead_goal || "Pending"),
    metaCard("Status", labelizeStatus(status)),
    metaCard("Planned Date", job.planned_publish_date ? formatCalendarDate(job.planned_publish_date) : "Not scheduled"),
    metaCard("Target URL", job.target_url),
    metaCard("Primary Keyword", job.primary_keyword),
    metaCard("Audience", job.target_audience),
    metaCard("Word Count", job.word_count ?? "Pending"),
  ].join("");

  renderCheckpointSummary(status);
  el.reviewComment.disabled = isPublished;
  el.reviewComment.placeholder = isPublished
    ? "Published jobs are locked and cannot be changed."
    : "Add concise approval notes or revision requests.";
  el.approveJob.disabled = isPublished;
  el.requestChanges.disabled = isPublished;
  el.approveJob.hidden = isPublished;
  el.requestChanges.hidden = isPublished;
  renderSiteTaxonomy(job.site_id);
  el.strategyTab.innerHTML = renderStrategyTab(job);
  el.briefTab.innerHTML = renderBriefTab(job);
  el.reviewTab.innerHTML = renderReviewTab(job);
  el.draftTab.innerHTML = renderDraftTab(job);
  el.activityTab.innerHTML = renderActivityTab(job);
  updateTabs();
  maybeAutoFillImages(job);
}

function maybeAutoFillImages(job) {
  if (previewStatus[job?.job_id] === "published") {
    return;
  }

  const hasDraft = Boolean(job?.draft);
  const items = job?.image_plan?.items || [];
  const selectedImages = (job?.image_plan?.selected_images || []).filter(Boolean);
  if (!hasDraft || !items.length || selectedImages.length) {
    return;
  }

  const state = autoImageFillState[job.job_id];
  if (state === "running" || state === "done") {
    return;
  }

  autoImageFillState[job.job_id] = "running";
  queueMicrotask(async () => {
    try {
      await handleAutoPickImages();
      autoImageFillState[job.job_id] = "done";
    } catch (error) {
      autoImageFillState[job.job_id] = "failed";
    }
  });
}

function renderStrategyTab(job) {
  const strategy = job.seo_strategy || {};
  const tags = strategy.suggested_tags?.length
    ? strategy.suggested_tags
    : ["No tags suggested yet."];
  const linkTypes = strategy.recommended_internal_link_types?.length
    ? strategy.recommended_internal_link_types
    : ["No internal link guidance added yet."];

  return `
    <div class="stack">
      <article class="card">
        <h3>Strategy overview</h3>
        <div class="strategy-grid">
          ${strategyMetric("Search intent", strategy.search_intent || "Pending")}
          ${strategyMetric("Cluster", strategy.cluster || "Pending")}
          ${strategyMetric("Category", strategy.category_name || getCategoryName(job, dashboardState.sites || []))}
          ${strategyMetric("Lead goal", strategy.lead_goal || "Pending")}
          ${strategyMetric("Opportunity score", strategy.opportunity_score != null ? `${strategy.opportunity_score}/100` : "Pending")}
          ${strategyMetric("URL pattern", job.target_url || "Pending")}
          ${strategyMetric("Planned publish date", job.planned_publish_date ? formatCalendarDate(job.planned_publish_date) : "Not scheduled")}
        </div>
        ${
          strategy.opportunity_rationale
            ? `<p class="muted top-gap">${escapeHtml(strategy.opportunity_rationale)}</p>`
            : ""
        }
      </article>
      <article class="card">
        <h3>Suggested tags</h3>
        <div class="chip-row">
          ${tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}
        </div>
      </article>
      <article class="card">
        <h3>Internal linking plan</h3>
        <ul class="clean-list">
          ${linkTypes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </article>
      <article class="card">
        <h3>Image plan</h3>
        ${renderImagePlan(job)}
      </article>
    </div>
  `;
}

function renderBriefTab(job) {
  const outline = job.brief?.outline?.length
    ? job.brief.outline
    : ["Outline will appear after the first briefing pass."];
  const secondaryKeywords = job.secondary_keywords?.length
    ? job.secondary_keywords
    : ["No supporting keywords added yet."];

  return `
    <div class="stack">
      <article class="card">
        <h3>Keyword targets</h3>
        <div class="metric-row">
          <span>Primary keyword</span>
          <strong>${escapeHtml(job.primary_keyword)}</strong>
        </div>
        <div class="chip-row top-gap">
          ${secondaryKeywords
            .map((keyword) => `<span class="chip">${escapeHtml(keyword)}</span>`)
            .join("")}
        </div>
      </article>
      <article class="card">
        <h3>Brief summary</h3>
        <p>${escapeHtml(job.brief?.summary || "Brief content has not been generated yet.")}</p>
      </article>
      <article class="card">
        <h3>Outline</h3>
        <ol class="outline-list">
          ${renderOutlineItems(outline)}
        </ol>
      </article>
    </div>
  `;
}

// Renders an outline that uses the H1:/H2:/H3: tag convention from the writer.
// Each item is shown with its heading level as a small badge, and H3 items are
// indented under their preceding H2 for a clear visual hierarchy.
function renderOutlineItems(outline) {
  return outline
    .map((rawItem) => {
      const item = String(rawItem || "").trim();
      const match = item.match(/^(H[1-6]):\s*(.*)$/i);
      if (!match) {
        return `<li class="outline-row outline-h2"><span class="outline-tag">H2</span><span class="outline-text">${escapeHtml(item)}</span></li>`;
      }
      const level = match[1].toUpperCase();
      const text = match[2] || "";
      const cls = `outline-${level.toLowerCase()}`;
      return `<li class="outline-row ${cls}"><span class="outline-tag">${level}</span><span class="outline-text">${escapeHtml(text)}</span></li>`;
    })
    .join("");
}

function renderReviewTab(job) {
  const checklist = job.final_review?.checklist?.length
    ? job.final_review.checklist
    : ["Final review checklist will appear once the draft is ready."];
  const draft = job.draft;
  const plagiarismStatus =
    job.final_review?.manual_plagiarism_status || "Pending manual review";
  const flaggedSectionsNote = job.final_review?.flagged_sections_note || "";
  const isPublished = previewStatus[job.job_id] === "published";

  return `
    <div class="stack">
      ${
        isPublished
          ? `
            <article class="card">
              <h3>Review locked</h3>
              <p>This post has already been published. Review controls are disabled to prevent accidental duplicate publishing or post-publication status changes.</p>
            </article>
          `
          : ""
      }
      <article class="card">
        <h3>Manual plagiarism workflow</h3>
        <div class="metric-row">
          <span>Status</span>
          <strong>${escapeHtml(job.final_review?.manual_plagiarism_status || "Pending manual review")}</strong>
        </div>
        <div class="copy-toolbar top-gap">
          <button
            class="mini-action"
            data-copy-target="full-draft"
            data-copy-payload="${escapeHtmlAttr(buildFullDraftText(draft))}"
            ${draft ? "" : "disabled"}
          >
            Copy full draft
          </button>
          <button
            class="mini-action"
            data-copy-target="faq-cta"
            data-copy-payload="${escapeHtmlAttr(buildFaqAndCtaText(draft))}"
            ${draft ? "" : "disabled"}
          >
            Copy FAQ + CTA
          </button>
        </div>
        <p class="muted top-gap">
          Use these copy buttons to paste the draft into your plagiarism checker. If the tool has word limits, use the per-section copy buttons in the Draft tab.
        </p>
      </article>
      <article class="card">
        <h3>Plagiarism tracking</h3>
        <label class="field-label" for="plagiarism-status">Manual plagiarism status</label>
        <select id="plagiarism-status" class="field-input" ${isPublished ? "disabled" : ""}>
          ${[
            "Pending manual review",
            "In progress",
            "Passed",
            "Needs rewriting",
          ]
            .map(
              (option) => `
                <option value="${escapeHtmlAttr(option)}" ${
                  plagiarismStatus === option ? "selected" : ""
                }>${escapeHtml(option)}</option>
              `,
            )
            .join("")}
        </select>
        <label class="field-label top-gap" for="flagged-sections-note">Flagged sections / rewrite notes</label>
        <textarea
          id="flagged-sections-note"
          class="field-textarea"
          placeholder="Example: Rewrite intro paragraph, section 2 bullet list, and FAQ #3."
          ${isPublished ? "disabled" : ""}
        >${escapeHtml(flaggedSectionsNote)}</textarea>
        <div class="copy-toolbar top-gap">
          <button class="mini-action" id="save-review-notes" ${isPublished ? "disabled" : ""}>Save review notes</button>
        </div>
      </article>
      <article class="card">
        <h3>Review checklist</h3>
        <ul class="clean-list">
          ${checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </article>
      <article class="card">
        <h3>Manual plagiarism status</h3>
        <p>${escapeHtml(plagiarismStatus)}</p>
        <p class="muted top-gap">${escapeHtml(flaggedSectionsNote || "No flagged sections noted yet.")}</p>
      </article>
      <article class="card">
        <h3>Metadata</h3>
        <div class="metric-row">
          <span>Meta title</span>
          <strong>${escapeHtml(job.final_review?.meta_title || "Pending")}</strong>
        </div>
        <div class="metric-row">
          <span>Meta description</span>
          <strong>${escapeHtml(job.final_review?.meta_description || "Pending")}</strong>
        </div>
      </article>
    </div>
  `;
}

function renderDraftTab(job) {
  const draft = job.draft;
  if (!draft) {
    return `
      <div class="stack">
        <article class="card">
          <h3>No draft yet</h3>
          <p>This job has not been drafted yet. Once a brief-approved job is processed by the automation runner, the draft preview will appear here.</p>
        </article>
      </div>
    `;
  }

  const sections = draft.sections || [];
  const faq = draft.faq || [];
  const selectedImages = job.image_plan?.selected_images || [];
  const featuredImage = selectedImages[0] || null;

  return `
    <div class="stack">
      <article class="card">
        <h3>${escapeHtml(draft.title)}</h3>
        <p>${escapeHtml(draft.description)}</p>
        <div class="copy-toolbar top-gap">
          <button
            class="mini-action"
            data-copy-target="full-draft"
            data-copy-payload="${escapeHtmlAttr(buildFullDraftText(draft))}"
          >
            Copy full draft
          </button>
        </div>
        <div class="metric-row top-gap">
          <span>SEO title</span>
          <strong>${escapeHtml(draft.seoTitle || "Pending")}</strong>
        </div>
        <div class="metric-row">
          <span>SEO description</span>
          <strong>${escapeHtml(draft.seoDescription || "Pending")}</strong>
        </div>
        <div class="metric-row">
          <span>Hero asset</span>
          <strong>${escapeHtml(featuredImage?.photographer ? `Selected · ${featuredImage.photographer}` : draft.heroImage || "Prompt only")}</strong>
        </div>
        ${
          featuredImage
            ? renderDraftImagePreview(featuredImage, "Featured image")
            : ""
        }
      </article>
      <article class="card">
        <h3>Intro</h3>
        ${draft.intro.map((paragraph) => `<p class="paragraph-block">${escapeHtml(paragraph)}</p>`).join("")}
      </article>
      <article class="card">
        <h3>Sections</h3>
        <div class="section-stack">
          ${sections
            .map((section, index) => {
              const placement = `After section: ${section.heading}`;
              const selectedImage = findSelectedImageForPlacement(job, placement);
              return `
                <div class="section-card">
                  <div class="section-card-head">
                    <strong>${escapeHtml(section.heading)}</strong>
                    <button
                      class="mini-action"
                      data-copy-target="section-${index}"
                      data-copy-payload="${escapeHtmlAttr(buildSectionText(section))}"
                    >
                      Copy section
                    </button>
                  </div>
                  ${section.paragraphs
                    .map((paragraph) => `<p class="paragraph-block">${escapeHtml(paragraph)}</p>`)
                    .join("")}
                  ${
                    section.bullets?.length
                      ? `<ul class="clean-list">${section.bullets
                          .map((bullet) => `<li>${escapeHtml(bullet)}</li>`)
                          .join("")}</ul>`
                      : ""
                  }
                  ${
                    section.callout
                      ? `<p class="draft-callout">${escapeHtml(section.callout)}</p>`
                      : ""
                  }
                </div>
                ${
                  selectedImage
                    ? renderDraftImagePreview(selectedImage, placement)
                    : ""
                }
              `;
            })
            .join("")}
        </div>
      </article>
      <article class="card">
        <h3>FAQ and CTA</h3>
        <div class="section-stack">
          ${
            faq.length
              ? faq
                  .map(
                    (item) => `
                      <div class="section-card">
                        <strong>${escapeHtml(item.question)}</strong>
                        <p class="paragraph-block">${escapeHtml(item.answer)}</p>
                      </div>
                    `,
                  )
                  .join("")
              : `<p>No FAQ generated yet.</p>`
          }
          <div class="section-card">
            <strong>${escapeHtml(draft.cta?.title || "CTA pending")}</strong>
            <p class="paragraph-block">${escapeHtml(draft.cta?.body || "")}</p>
            <div class="metric-row">
              <span>Button</span>
              <strong>${escapeHtml(draft.cta?.buttonLabel || "")}</strong>
            </div>
          </div>
        </div>
      </article>
    </div>
  `;
}

function renderImagePlan(job) {
  const plan = job.image_plan;
  if (!plan?.items?.length) {
    return `<p class="muted">No image plan has been generated yet.</p>`;
  }

  const selectedImages = plan.selected_images || [];
  const jobSearchState = imageSearchState[job.job_id] || {};

  return `
    <div class="section-stack">
      <div class="copy-toolbar">
        <button class="mini-action" data-auto-pick-images>Auto-pick best images</button>
      </div>
      ${plan.items
        .map((item, index) => {
          const searchState = jobSearchState[index] || {};
          const selectedImage = selectedImages[index] || null;
          const defaultQuery = item.query || buildImageSearchQuery(job, item);

          return `
            <div class="section-card">
              <div class="metric-row">
                <span>Placement</span>
                <strong>${escapeHtml(item.placement || "Pending")}</strong>
              </div>
              <div class="metric-row">
                <span>Asset</span>
                <strong>${escapeHtml(selectedImage?.photographer ? `Selected · ${selectedImage.photographer}` : item.asset_hint || "Prompt only")}</strong>
              </div>
              <p class="paragraph-block top-gap">${escapeHtml(item.prompt || "Prompt pending")}</p>
              <div class="image-search-box top-gap">
                <label class="field-label" for="image-search-${index}">Pexels search</label>
                <div class="inline-search">
                  <input
                    id="image-search-${index}"
                    class="field-input"
                    type="text"
                    value="${escapeHtmlAttr(searchState.query || defaultQuery)}"
                    placeholder="Search Pexels for a realistic editorial image"
                  />
                  <button class="mini-action" data-image-search-index="${index}">Search</button>
                </div>
              </div>
              ${
                selectedImage
                  ? `
                    <div class="selected-image-card top-gap">
                      <img src="${escapeHtmlAttr(selectedImage.thumb || selectedImage.large || selectedImage.original || "")}" alt="${escapeHtmlAttr(selectedImage.alt || item.placement || "Selected image")}" />
                      <div class="selected-image-meta">
                        <strong>Selected image</strong>
                        <span>${escapeHtml(selectedImage.photographer || "Pexels")}</span>
                        <a href="${escapeHtmlAttr(selectedImage.pexels_url || "#")}" target="_blank" rel="noreferrer">Open on Pexels</a>
                      </div>
                    </div>
                  `
                  : ""
              }
              ${
                searchState.message
                  ? `<p class="muted top-gap">${escapeHtml(searchState.message)}</p>`
                  : ""
              }
              ${
                searchState.results?.length
                  ? `
                    <div class="image-results-grid top-gap">
                      ${searchState.results
                        .map(
                          (result, resultIndex) => `
                            <div class="image-result-card">
                              <img src="${escapeHtmlAttr(result.thumb || result.large || "")}" alt="${escapeHtmlAttr(result.alt || item.placement || "Pexels image")}" />
                              <div class="image-result-meta">
                                <strong>${escapeHtml(result.photographer || "Pexels")}</strong>
                                <span>${escapeHtml(result.alt || "Editorial photo")}</span>
                              </div>
                              <div class="copy-toolbar">
                                <button
                                  class="mini-action"
                                  data-image-select-index="${index}"
                                  data-image-result-index="${resultIndex}"
                                >
                                  Select image
                                </button>
                                <a class="mini-link" href="${escapeHtmlAttr(result.pexels_url || "#")}" target="_blank" rel="noreferrer">Open</a>
                              </div>
                            </div>
                          `,
                        )
                        .join("")}
                    </div>
                  `
                  : ""
              }
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function buildImageSearchQuery(job, item) {
  const category = job.seo_strategy?.category_name || "equipment guide";
  return item.query || `${job.primary_keyword} ${category} realistic industrial photo`;
}

function findSelectedImageForPlacement(job, placement) {
  const items = job.image_plan?.items || [];
  const selectedImages = job.image_plan?.selected_images || [];
  const index = items.findIndex((item) => item.placement === placement);
  if (index === -1) return null;
  return selectedImages[index] || null;
}

function renderDraftImagePreview(image, placementLabel) {
  return `
    <div class="draft-image-preview top-gap">
      <img src="${escapeHtmlAttr(image.large || image.thumb || image.original || "")}" alt="${escapeHtmlAttr(image.alt || placementLabel || "Selected image")}" />
      <div class="draft-image-meta">
        <strong>${escapeHtml(placementLabel)}</strong>
        <span>${escapeHtml(image.photographer || "Pexels")}</span>
      </div>
    </div>
  `;
}

function renderActivityTab(job) {
  const activity = job.activity?.length
    ? job.activity
    : ["No activity recorded yet."];

  return `
    <div class="stack">
      <article class="card">
        <h3>Activity log</h3>
        <ul class="clean-list">
          ${activity.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </article>
      <article class="card">
        <h3>Publishing target</h3>
        <div class="metric-row">
          <span>Branch</span>
          <strong>${escapeHtml(job.publish?.branch || "Pending")}</strong>
        </div>
        <div class="metric-row">
          <span>Repo path</span>
          <strong>${escapeHtml(job.publish?.path || "Pending")}</strong>
        </div>
      </article>
      <article class="card">
        <h3>Persistence mode</h3>
        <p>${
          persistenceMode === "d1"
            ? "Live review actions are enabled through D1."
            : "Static snapshot mode is active. Review actions only preview in-browser until persistence is enabled."
        }</p>
      </article>
    </div>
  `;
}

function updateTabs() {
  tabs.forEach((tabButton) => {
    const isActive = tabButton.dataset.tab === activeTab;
    tabButton.classList.toggle("active", isActive);
  });

  Array.from(document.querySelectorAll(".tab-panel")).forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${activeTab}`);
  });
}

async function handleImageSearch(index) {
  const job = dashboardState.jobs.find((item) => item.job_id === selectedJobId);
  if (!job) return;

  const input = document.getElementById(`image-search-${index}`);
  const query = input?.value.trim();
  if (!query) {
    el.reviewPreview.innerHTML = `
      <h3>Search query required</h3>
      <p class="muted">Add a search phrase before looking for Pexels images.</p>
    `;
    return;
  }

  imageSearchState[job.job_id] = imageSearchState[job.job_id] || {};
  imageSearchState[job.job_id][index] = {
    query,
    results: [],
    message: "Searching Pexels...",
  };
  renderSelectedJob();

  try {
    const response = await fetch(
      `./api/pexels-search?query=${encodeURIComponent(query)}&per_page=6`,
    );
    const result = await readApiJson(response);
    if (!response.ok || !result.ok) {
      throw new Error(result.message || "Pexels search failed.");
    }

    imageSearchState[job.job_id][index] = {
      query,
      results: result.photos || [],
      message: result.photos?.length ? "" : "No matching images found.",
    };
    renderSelectedJob();
  } catch (error) {
    imageSearchState[job.job_id][index] = {
      query,
      results: [],
      message: error.message || "Pexels search failed.",
    };
    renderSelectedJob();
  }
}

async function handleAutoPickImages() {
  const job = dashboardState.jobs.find((item) => item.job_id === selectedJobId);
  if (!job?.image_plan?.items?.length) return;

  el.reviewPreview.innerHTML = `
    <h3>Auto-picking images</h3>
    <p class="muted">Searching Pexels and selecting the best first-pass images for this draft.</p>
  `;

  try {
    const response = await fetch("./api/auto-images", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        job_id: job.job_id,
      }),
    });
    const payload = await readApiJson(response);
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "Auto-pick failed.");
    }

    job.image_plan = {
      ...(job.image_plan || {}),
      selected_images: payload.selected_images || [],
    };
    renderSelectedJob();

    el.reviewPreview.innerHTML = `
      <h3>Images auto-selected</h3>
      <p><strong>Job:</strong> ${escapeHtml(job.topic)}</p>
      <p><strong>Selections:</strong> ${escapeHtml(String(payload.selected_count || 0))} placements updated</p>
    `;
  } catch (error) {
    el.reviewPreview.innerHTML = `
      <h3>Auto-pick failed</h3>
      <p>${escapeHtml(error.message || "Unknown error")}</p>
    `;
  }
}

async function handleImageSelect(index, resultIndex) {
  const job = dashboardState.jobs.find((item) => item.job_id === selectedJobId);
  if (!job) return;

  const result =
    imageSearchState[job.job_id]?.[index]?.results?.[resultIndex];
  if (!result) return;

  const existingSelections = [...(job.image_plan?.selected_images || [])];
  existingSelections[index] = result;

  try {
    await saveSelectedImages(job, existingSelections, `Selected image for placement ${index + 1}.`);
    el.reviewPreview.innerHTML = `
      <h3>Image selected</h3>
      <p><strong>Job:</strong> ${escapeHtml(job.topic)}</p>
      <p><strong>Placement:</strong> ${escapeHtml(job.image_plan?.items?.[index]?.placement || `Placement ${index + 1}`)}</p>
      <p><strong>Photographer:</strong> ${escapeHtml(result.photographer || "Pexels")}</p>
    `;
  } catch (error) {
    el.reviewPreview.innerHTML = `
      <h3>Image save failed</h3>
      <p>${escapeHtml(error.message || "Unknown error")}</p>
    `;
  }
}

async function saveSelectedImages(job, selections, comment) {
  if (persistenceMode === "d1") {
    const response = await fetch("./api/review", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        job_id: job.job_id,
        action: "save_image_selection",
        reviewer: "seo-expert",
        comment,
        selected_images: selections,
      }),
    });
    const payload = await readApiJson(response);
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "Image selection failed.");
    }

    job.image_plan = {
      ...(job.image_plan || {}),
      selected_images: payload.selected_images || selections,
    };
    renderSelectedJob();
    return;
  }

  job.image_plan = {
    ...(job.image_plan || {}),
    selected_images: selections,
  };
  renderSelectedJob();
}

let reviewActionInFlight = false;
async function handleReviewAction(action) {
  // Guard against double-submits: a quick double-click on Approve would
  // otherwise fire two POSTs in parallel — the second could double-publish to
  // GitHub or race the D1 status update. We block re-entry until the current
  // call resolves and we disable the buttons so the UI matches the lock.
  if (reviewActionInFlight) return;
  const job = dashboardState.jobs.find((item) => item.job_id === selectedJobId);
  if (!job) return;
  const rawComment = el.reviewComment.value.trim();

  if (action === "request_changes" && !rawComment) {
    el.reviewPreview.innerHTML = `
      <h3>Reviewer notes required</h3>
      <p>Add reviewer notes before sending the job back so the AI has exact rewrite instructions.</p>
    `;
    el.reviewComment.focus();
    return;
  }

  const comment =
    action === "save_review_notes"
      ? rawComment || "Review notes updated."
      : rawComment || "No comment added.";
  const actionLabel =
    action === "approve"
      ? "Approved"
      : action === "request_changes"
        ? "Sent back"
        : "Review notes saved";
  const plagiarismStatusInput = document.getElementById("plagiarism-status");
  const flaggedSectionsNoteInput = document.getElementById("flagged-sections-note");
  const manualPlagiarismStatus =
    plagiarismStatusInput?.value ||
    job.final_review?.manual_plagiarism_status ||
    "Pending manual review";
  const flaggedSectionsNote =
    flaggedSectionsNoteInput?.value.trim() ||
    job.final_review?.flagged_sections_note ||
    "";

  // Lock both top-level buttons + show a working state so the user can see
  // the click registered. The `finally` block below re-derives the correct
  // enabled state via renderSelectedJob — don't restore a saved value, because
  // a successful approve transitions the job to `published` and the buttons
  // must stay disabled afterwards.
  reviewActionInFlight = true;
  el.approveJob.disabled = true;
  el.requestChanges.disabled = true;
  if (action === "approve" || action === "request_changes") {
    el.reviewPreview.innerHTML = `
      <h3>Working…</h3>
      <p>${escapeHtml(action === "approve" ? "Submitting approval" : "Sending back for revision")} — please wait.</p>
    `;
  }

  try {

  if (persistenceMode === "d1") {
    try {
      const response = await fetch("./api/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          job_id: job.job_id,
          action,
          reviewer: "seo-expert",
          comment,
          manual_plagiarism_status: manualPlagiarismStatus,
          flagged_sections_note: flaggedSectionsNote,
        }),
      });

      const result = await readApiJson(response);
      if (!response.ok || !result.ok) {
        throw new Error(result.message || "Review action failed.");
      }

      // Optimistically reflect the action — the live refetch below will then
      // pick up any chain reactions the backend did (next brief promoted,
      // job removed from queue, performance snapshot updated).
      previewStatus[job.job_id] = result.next_status;
      job.final_review = {
        ...(job.final_review || {}),
        manual_plagiarism_status: result.manual_plagiarism_status,
        flagged_sections_note: result.flagged_sections_note,
      };
      if (result.draft) {
        job.draft = result.draft;
      }
      if (result.brief) {
        job.brief = result.brief;
      }
      if (result.selected_images) {
        job.image_plan = {
          ...(job.image_plan || {}),
          selected_images: result.selected_images,
        };
      }
      renderJobs();
      renderSelectedJob();
      const promotion = result.promoted_next_brief;
      const promotionLine = promotion?.job_id
        ? `<p><strong>Next brief promoted:</strong> ${escapeHtml(promotion.topic || promotion.job_id)}</p>`
        : "";
      el.reviewPreview.innerHTML = `
        <h3>${escapeHtml(actionLabel)}</h3>
        <p><strong>Job:</strong> ${escapeHtml(job.topic)}</p>
        <p><strong>New status:</strong> ${escapeHtml(labelizeStatus(result.next_status))}</p>
        <p><strong>Plagiarism status:</strong> ${escapeHtml(result.manual_plagiarism_status)}</p>
        ${promotionLine}
        <p><strong>Note:</strong> ${escapeHtml(comment)}</p>
      `;
      // Pull the freshest server state so promoted-brief, next-job and
      // updated counters land in the UI without a manual reload. The fetch
      // is guarded by its own refreshInFlight flag, so background polls
      // won't double-fire here.
      await loadStateFromServer();
      rerenderAllPanels();
      return;
    } catch (error) {
      el.reviewPreview.innerHTML = `
        <h3>Action failed</h3>
        <p>${escapeHtml(error.message || "Unknown error")}</p>
      `;
      return;
    }
  }

  const nextStatus =
    action === "approve"
      ? getApprovedNextStatus(previewStatus[job.job_id])
      : action === "request_changes"
        ? "needs_revision"
        : previewStatus[job.job_id];

  previewStatus[job.job_id] = nextStatus;
  job.final_review = {
    ...(job.final_review || {}),
    manual_plagiarism_status: manualPlagiarismStatus,
    flagged_sections_note: flaggedSectionsNote,
  };
  renderJobs();

  el.reviewPreview.innerHTML = `
    <h3>${escapeHtml(actionLabel)}</h3>
    <p><strong>Job:</strong> ${escapeHtml(job.topic)}</p>
    <p><strong>Preview status:</strong> ${escapeHtml(labelizeStatus(nextStatus))}</p>
    <p><strong>Plagiarism status:</strong> ${escapeHtml(manualPlagiarismStatus)}</p>
    <p><strong>Note:</strong> ${escapeHtml(comment)}</p>
    <p class="muted">Static mode is active. Persist the dashboard state to save this action.</p>
  `;

  } finally {
    reviewActionInFlight = false;
    // Re-render so the buttons reflect the new job status (published jobs
    // stay disabled, others re-enable).
    renderSelectedJob();
  }
}

async function readApiJson(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  if (text.trim().startsWith("<")) {
    throw new Error(
      "The dashboard session or API route returned an HTML page. Please refresh and sign in again, then retry.",
    );
  }

  throw new Error(text.trim() || "The dashboard API returned an unexpected response.");
}

function renderCheckpointSummary(status) {
  const summary = getCheckpointCopy(status);
  el.checkpointTitle.textContent = summary.title;
  el.checkpointCopy.textContent = summary.body;
}

function renderSiteTaxonomy(siteId) {
  if (!siteId) {
    el.siteTaxonomy.innerHTML = `<p class="muted">Select a site or job to view blog categories.</p>`;
    return;
  }

  const site = (dashboardState.sites || []).find((item) => item.site_id === siteId);

  if (!site || !site.blog_categories?.length) {
    el.siteTaxonomy.innerHTML = `<p class="muted">No blog categories configured yet.</p>`;
    return;
  }

  el.siteTaxonomy.innerHTML = site.blog_categories
    .map(
      (category) => `
        <div class="taxonomy-item">
          <strong>${escapeHtml(category.name)}</strong>
          <span>${escapeHtml(category.slug)}</span>
        </div>
      `,
    )
    .join("");
}

function getCheckpointCopy(status) {
  if (status === "brief_pending") {
    return {
      title: "Checkpoint 1 · Brief approval",
      body: "Approve the angle, target keyword direction, URL, and outline before drafting starts.",
    };
  }

  if (status === "final_pending") {
    return {
      title: "Checkpoint 2 · Final review",
      body: "Approve the final draft, confirm manual plagiarism review, and release the job for publishing.",
    };
  }

  if (status === "needs_revision") {
    return {
      title: "Revision requested",
      body: "This job has been sent back. The activity log and reviewer notes should guide the next revision pass.",
    };
  }

  if (status === "brief_approved") {
    return {
      title: "Drafting in progress",
      body: "The brief is approved. The next automation step should generate the draft and review package.",
    };
  }

  if (status === "final_approved") {
    return {
      title: "Ready to publish",
      body: "This job has passed review and can move into the publishing workflow.",
    };
  }

  if (status === "published") {
    return {
      title: "Published",
      body: "This job is complete. Review the activity log for final publish details.",
    };
  }

  return {
    title: "No checkpoint selected",
    body: "Approval actions will appear here once you choose a job from the queue.",
  };
}

function getApprovedNextStatus(status) {
  if (status === "brief_pending") return "brief_approved";
  if (status === "brief_approved") return "final_pending";
  if (status === "final_pending") return "final_approved";
  return status;
}

function slugifyStatus(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getCategoryName(job, sites) {
  const slug = getCategorySlug(job.target_url);
  if (!slug) return "Uncategorized";

  const site = (sites || []).find((item) => item.site_id === job.site_id);
  const match = site?.blog_categories?.find((category) => category.slug === slug);
  return match?.name || labelizeSlug(slug);
}

function getCategorySlug(targetUrl) {
  const parts = String(targetUrl || "")
    .split("/")
    .filter(Boolean);

  if (parts[0] !== "blog" || parts.length < 3) {
    return "";
  }

  return parts[1];
}

function metaCard(label, value) {
  return `
    <article class="meta-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value ?? "Pending")}</strong>
    </article>
  `;
}

function strategyMetric(label, value) {
  return `
    <div class="strategy-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function labelizeStatus(status) {
  if (!status) return "Unknown";
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function labelizeSlug(value) {
  return String(value || "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(value) {
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatCalendarDate(value) {
  try {
    return new Intl.DateTimeFormat("en", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeHtmlAttr(value) {
  return escapeHtml(value).replaceAll("\n", "&#10;");
}

function buildFullDraftText(draft) {
  if (!draft) return "";

  const parts = [
    draft.title || "",
    "",
    ...(draft.intro || []),
    "",
    ...((draft.sections || []).flatMap((section) => {
      const block = [section.heading || "", ...(section.paragraphs || [])];
      if (section.bullets?.length) {
        block.push(...section.bullets.map((bullet) => `- ${bullet}`));
      }
      if (section.callout) {
        block.push(section.callout);
      }
      block.push("");
      return block;
    })),
    ...buildFaqAndCtaLines(draft),
  ];

  return parts.join("\n").trim();
}

function buildFaqAndCtaText(draft) {
  return buildFaqAndCtaLines(draft).join("\n").trim();
}

function buildFaqAndCtaLines(draft) {
  if (!draft) return [];
  const lines = [];

  if (draft.faq?.length) {
    lines.push("FAQ");
    for (const item of draft.faq) {
      lines.push(item.question || "");
      lines.push(item.answer || "");
      lines.push("");
    }
  }

  if (draft.cta) {
    lines.push("CTA");
    lines.push(draft.cta.title || "");
    lines.push(draft.cta.body || "");
    lines.push(draft.cta.buttonLabel || "");
  }

  return lines;
}

function buildSectionText(section) {
  if (!section) return "";
  const lines = [section.heading || "", ...(section.paragraphs || [])];
  if (section.bullets?.length) {
    lines.push(...section.bullets.map((bullet) => `- ${bullet}`));
  }
  if (section.callout) {
    lines.push(section.callout);
  }
  return lines.join("\n").trim();
}
