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
  planningViewOverviewButton: document.getElementById("planning-view-overview"),
  planningViewCalendarButton: document.getElementById("planning-view-calendar"),
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
  const response = await fetch(stateUrl);
  dashboardState = await response.json();
  persistenceMode = dashboardState.persistence || "static";
  previewStatus = Object.fromEntries(
    dashboardState.jobs.map((job) => [job.job_id, job.status]),
  );
  selectedSiteId = "all";

  bindEvents();
  renderSummary();
  renderFilters();
  renderPlanningBoard();
  renderJobs();
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
  updatePlanningViews();
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

  const prefix = site.blog_categories?.length
    ? `${site.site_name} → /blog/{category}/{slug}`
    : `${site.site_name} → /blog/{slug}`;

  el.urlFramework.innerHTML = `
    <div class="framework-pattern">/blog/{category}/{blog-name}</div>
    <div class="framework-meta">
      <span>${escapeHtml(site.site_name)}</span>
      <strong>${escapeHtml(prefix)}</strong>
    </div>
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
  el.planningOverviewView.classList.toggle("active", isOverview);
  el.planningCalendarView.classList.toggle("active", !isOverview);
  el.planningViewOverviewButton.classList.toggle("active", isOverview);
  el.planningViewCalendarButton.classList.toggle("active", !isOverview);
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
  const jobs = dashboardState.jobs.filter((job) => {
    if (selectedSiteId !== "all" && job.site_id !== selectedSiteId) return false;
    if (filter === "all") return true;
    return previewStatus[job.job_id] === filter;
  });

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
        <ul class="clean-list">
          ${outline.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </article>
    </div>
  `;
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
    const result = await response.json();
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
    const payload = await response.json();
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
    const payload = await response.json();
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

async function handleReviewAction(action) {
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

      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.message || "Review action failed.");
      }

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
      el.reviewPreview.innerHTML = `
        <h3>${escapeHtml(actionLabel)}</h3>
        <p><strong>Job:</strong> ${escapeHtml(job.topic)}</p>
        <p><strong>New status:</strong> ${escapeHtml(labelizeStatus(result.next_status))}</p>
        <p><strong>Plagiarism status:</strong> ${escapeHtml(result.manual_plagiarism_status)}</p>
        <p><strong>Note:</strong> ${escapeHtml(comment)}</p>
      `;
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
