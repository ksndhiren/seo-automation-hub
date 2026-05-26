const SITE_CONFIGS = {
  "cranes-auctions": {
    owner: "ksndhiren",
    repo: "Auctioncrane",
    branch: "main",
    contentPath: "src/web/content/blog",
    siteUrl: "https://www.cranesauctions.com",
    ga4PropertyId: "538033489",
  },
  "jma-golfcarts": {
    owner: "ksndhiren",
    repo: "golfcarts",
    branch: "main",
    contentPath: "src/content/blog/generated",
    siteUrl: "https://www.jmagolfcarts.com",
    ga4PropertyId: "538046014",
  },
};

const LEAD_EVENTS = [
  "cta_click",
  "registration_start",
  "registration_complete",
  "contact_click",
];

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(event, env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || !url.pathname.startsWith("/run/")) {
      return json({
        ok: true,
        service: "seo-automation-scheduler",
        endpoints: ["/run/publish", "/run/performance", "/run/all"],
      });
    }

    const expectedToken = env.SCHEDULER_ADMIN_TOKEN;
    const providedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!expectedToken || providedToken !== expectedToken) {
      return json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    if (url.pathname === "/run/publish") {
      return json(await safeRun(() => publishDuePosts(env)));
    }
    if (url.pathname === "/run/performance") {
      return json(await safeRun(() => refreshPerformance(env)));
    }
    if (url.pathname === "/run/all") {
      const publish = await safeRun(() => publishDuePosts(env));
      const performance = await safeRun(() => refreshPerformance(env));
      return json({ ok: publish.ok && performance.ok, publish, performance });
    }

    return json({ ok: false, message: "Unknown scheduler endpoint." }, { status: 404 });
  },
};

async function runScheduled(event, env) {
  const now = new Date(event.scheduledTime || Date.now());
  const results = {};

  if (isChicagoMorningCron(event.cron)) {
    results.publish = await safeRun(() => publishDuePosts(env, now));
    results.performance = await safeRun(() => refreshPerformance(env, now));
  }

  return results;
}

async function safeRun(task) {
  try {
    return await task();
  } catch (error) {
    return {
      ok: false,
      message: error?.message || "Scheduled task failed.",
    };
  }
}

function isChicagoMorningCron(cron) {
  return cron?.includes("13 * * *") || cron?.includes("14 * * *");
}

async function publishDuePosts(env, now = new Date()) {
  if (!env.DASHBOARD_DB) {
    return { ok: false, message: "DASHBOARD_DB binding is missing." };
  }
  if (!env.GITHUB_TOKEN) {
    return { ok: false, message: "GITHUB_TOKEN secret is missing." };
  }

  const state = await loadDashboardState(env);
  const assetJobsById = Object.fromEntries((state.jobs || []).map((job) => [job.job_id, job]));
  const rows = await env.DASHBOARD_DB
    .prepare(
      `SELECT
        job_id,
        site_id,
        site_name,
        topic,
        primary_keyword,
        secondary_keywords_json,
        target_url,
        target_audience,
        status,
        word_count,
        brief_summary,
        outline_json,
        draft_json,
        final_checklist_json,
        manual_plagiarism_status,
        flagged_sections_note,
        selected_images_json,
        meta_title,
        meta_description,
        activity_json,
        publish_branch,
        publish_path
      FROM dashboard_jobs
      WHERE status = 'final_approved'
      ORDER BY updated_at ASC`,
    )
    .all();

  const published = [];
  const skipped = [];
  const errors = [];

  for (const row of rows.results || []) {
    const assetJob = assetJobsById[row.job_id];
    const plannedPublishDate = assetJob?.planned_publish_date || null;
    if (!isDueForPublish(plannedPublishDate, now)) {
      skipped.push({
        job_id: row.job_id,
        reason: "scheduled_for_later",
        planned_publish_date: plannedPublishDate,
      });
      continue;
    }

    const publishResult = await publishJob(env, row, assetJob);
    if (!publishResult.ok) {
      errors.push({ job_id: row.job_id, message: publishResult.message });
      continue;
    }

    const updatedAt = new Date().toISOString();
    await env.DASHBOARD_DB
      .prepare("UPDATE dashboard_jobs SET status = 'published', updated_at = ? WHERE job_id = ?")
      .bind(updatedAt, row.job_id)
      .run();
    await insertReview(
      env,
      row.job_id,
      "system_publish",
      "system",
      `Published by Cloudflare Worker scheduler to ${publishResult.liveUrl}.`,
      updatedAt,
    );

    const promoted = await promoteNextBriefIfNeeded(env, row.site_id, state, updatedAt);
    published.push({ ...publishResult, job_id: row.job_id, promoted_next_brief: promoted });
  }

  return {
    ok: errors.length === 0,
    ran_at: new Date().toISOString(),
    published,
    skipped,
    errors,
  };
}

function isDueForPublish(plannedPublishDate, now) {
  const chicagoDate = formatDate(now, "America/Chicago");
  if (!plannedPublishDate) return isAfterLocalTime(now, "America/Chicago", 8, 0);
  if (plannedPublishDate < chicagoDate) return true;
  if (plannedPublishDate > chicagoDate) return false;
  return isAfterLocalTime(now, "America/Chicago", 8, 0);
}

async function publishJob(env, row, assetJob) {
  if (!assetJob) {
    return { ok: false, message: "Static job metadata was not found in dashboard-state.json." };
  }

  const siteConfig = SITE_CONFIGS[row.site_id];
  if (!siteConfig) {
    return { ok: false, message: `No publish config found for ${row.site_id}.` };
  }

  const draft = parseJson(row.draft_json) || assetJob.draft;
  if (!draft) {
    return { ok: false, message: "Draft JSON is missing." };
  }

  const selectedImages = parseJson(row.selected_images_json) || [];
  const mergedJob = {
    ...assetJob,
    draft,
    status: row.status,
    final_review: {
      ...(assetJob.final_review || {}),
      manual_plagiarism_status: row.manual_plagiarism_status,
      flagged_sections_note: row.flagged_sections_note || "",
    },
    image_plan: {
      ...(assetJob.image_plan || {}),
      selected_images: selectedImages,
    },
    publish: {
      ...(assetJob.publish || {}),
      branch: row.publish_branch || siteConfig.branch,
      path: row.publish_path || siteConfig.contentPath,
    },
  };

  const moduleSource = renderTypescriptModule(mergedJob);
  const filePath = `${siteConfig.contentPath}/${draft.slug}.ts`;
  const owner = env.GITHUB_OWNER || siteConfig.owner;
  const branch = row.publish_branch || siteConfig.branch;
  const existing = await getExistingContent({
    owner,
    repo: siteConfig.repo,
    path: filePath,
    branch,
    token: env.GITHUB_TOKEN,
  });

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${siteConfig.repo}/contents/${encodePath(filePath)}`,
    {
      method: "PUT",
      headers: githubHeaders(env.GITHUB_TOKEN),
      body: JSON.stringify({
        message: `Publish blog post: ${draft.title}`,
        content: utf8ToBase64(moduleSource),
        branch,
        sha: existing?.sha,
        committer: buildCommitAuthor(env),
      }),
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, message: payload?.message || "GitHub rejected the publish request." };
  }

  return {
    ok: true,
    commitSha: payload?.commit?.sha || null,
    filePath,
    liveUrl: `${siteConfig.siteUrl}${mergedJob.target_url}`,
  };
}

async function promoteNextBriefIfNeeded(env, siteId, state, now) {
  const activeBriefs = await env.DASHBOARD_DB
    .prepare(
      `SELECT job_id
       FROM dashboard_jobs
       WHERE site_id = ? AND status IN ('brief_pending', 'brief_approved')
       LIMIT 1`,
    )
    .bind(siteId)
    .all();

  if ((activeBriefs.results || []).length > 0) {
    return null;
  }

  const assetJobsById = Object.fromEntries((state.jobs || []).map((job) => [job.job_id, job]));
  const rows = await env.DASHBOARD_DB
    .prepare(
      `SELECT job_id, topic
       FROM dashboard_jobs
       WHERE site_id = ? AND status = 'new'`,
    )
    .bind(siteId)
    .all();

  const candidates = [];
  for (const row of rows.results || []) {
    const assetJob = assetJobsById[row.job_id];
    const plannedPublishDate = assetJob?.planned_publish_date || null;
    if (!plannedPublishDate) continue;
    candidates.push({
      job_id: row.job_id,
      topic: row.topic,
      planned_publish_date: plannedPublishDate,
      opportunity_score: assetJob?.seo_strategy?.opportunity_score || 0,
    });
  }

  candidates.sort((left, right) =>
    left.planned_publish_date.localeCompare(right.planned_publish_date)
    || right.opportunity_score - left.opportunity_score
    || String(left.job_id).localeCompare(String(right.job_id)),
  );

  const next = candidates[0];
  if (!next) return null;

  await env.DASHBOARD_DB
    .prepare(
      `UPDATE dashboard_jobs
       SET status = 'brief_pending', updated_at = ?
       WHERE job_id = ?`,
    )
    .bind(now, next.job_id)
    .run();
  await insertReview(
    env,
    next.job_id,
    "system_promote",
    "system",
    "Promoted automatically to brief_pending as the next scheduled site brief.",
    now,
  );

  return next;
}

async function refreshPerformance(env, now = new Date()) {
  if (!env.DASHBOARD_DB) {
    return { ok: false, message: "DASHBOARD_DB binding is missing." };
  }

  const latest = await env.DASHBOARD_DB
    .prepare("SELECT generated_at FROM dashboard_performance WHERE id = 'latest' LIMIT 1")
    .first();
  if (latest?.generated_at && formatDate(new Date(latest.generated_at), "Asia/Tbilisi") === formatDate(now, "Asia/Tbilisi")) {
    return {
      ok: true,
      skipped: true,
      message: "GA4 snapshot already refreshed for the current Tbilisi day.",
      generated_at: latest.generated_at,
    };
  }

  const accessToken = await refreshGoogleAccessToken(env);
  const sites = [];
  for (const [siteId, siteConfig] of Object.entries(SITE_CONFIGS)) {
    if (!siteConfig.ga4PropertyId) continue;
    sites.push({
      site_id: siteId,
      site_name: siteId === "cranes-auctions" ? "CranesAuctions" : "JMA Golf Carts",
      property_id: siteConfig.ga4PropertyId,
      overview: await siteOverview(siteConfig.ga4PropertyId, accessToken),
      top_blog_pages: await topBlogPages(siteConfig.ga4PropertyId, accessToken),
      events: await eventBreakdown(siteConfig.ga4PropertyId, accessToken),
    });
  }

  const payload = {
    generated_at: new Date().toISOString(),
    source: "ga4-worker",
    sites,
  };

  await env.DASHBOARD_DB
    .prepare(
      `INSERT INTO dashboard_performance (id, payload_json, generated_at, source)
       VALUES ('latest', ?, ?, 'ga4-worker')
       ON CONFLICT(id) DO UPDATE SET
         payload_json = excluded.payload_json,
         generated_at = excluded.generated_at,
         source = excluded.source`,
    )
    .bind(JSON.stringify(payload), payload.generated_at)
    .run();

  return { ok: true, refreshed: true, generated_at: payload.generated_at, sites: sites.length };
}

async function refreshGoogleAccessToken(env) {
  const clientContainer = parseSecretJson(env.GOOGLE_OAUTH_CLIENT_JSON, "GOOGLE_OAUTH_CLIENT_JSON");
  const tokenPayload = parseSecretJson(env.GOOGLE_REPORTING_TOKEN_JSON, "GOOGLE_REPORTING_TOKEN_JSON");
  const client = clientContainer.installed || clientContainer.web || clientContainer;
  const tokenUri = client.token_uri || "https://oauth2.googleapis.com/token";
  const refreshToken = tokenPayload.refresh_token;
  if (!refreshToken) {
    throw new Error("GOOGLE_REPORTING_TOKEN_JSON does not include refresh_token.");
  }

  const body = new URLSearchParams({
    client_id: client.client_id,
    client_secret: client.client_secret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Failed to refresh Google access token.");
  }
  return payload.access_token;
}

async function siteOverview(propertyId, accessToken) {
  const report = await ga4RunReport(propertyId, accessToken, {
    dateRanges: [{ startDate: "28daysAgo", endDate: "yesterday" }],
    metrics: [
      { name: "sessions" },
      { name: "activeUsers" },
      { name: "screenPageViews" },
      { name: "engagedSessions" },
      { name: "engagementRate" },
      { name: "averageSessionDuration" },
    ],
  });
  const names = (report.metricHeaders || []).map((item) => item.name);
  const totals = report.totals || [];
  const values = totals[0]?.metricValues || report.rows?.[0]?.metricValues || [];
  return Object.fromEntries(names.map((name, index) => [name, values[index]?.value || "0"]));
}

async function topBlogPages(propertyId, accessToken) {
  const report = await ga4RunReport(propertyId, accessToken, {
    dateRanges: [{ startDate: "28daysAgo", endDate: "yesterday" }],
    dimensions: [{ name: "pagePath" }],
    metrics: [
      { name: "screenPageViews" },
      { name: "sessions" },
      { name: "activeUsers" },
      { name: "engagementRate" },
    ],
    dimensionFilter: {
      filter: {
        fieldName: "pagePath",
        stringFilter: { matchType: "BEGINS_WITH", value: "/blog" },
      },
    },
    limit: 10,
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
  });
  return parseRows(report);
}

async function eventBreakdown(propertyId, accessToken) {
  const report = await ga4RunReport(propertyId, accessToken, {
    dateRanges: [{ startDate: "28daysAgo", endDate: "yesterday" }],
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      orGroup: {
        expressions: LEAD_EVENTS.map((eventName) => ({
          filter: {
            fieldName: "eventName",
            stringFilter: { matchType: "EXACT", value: eventName },
          },
        })),
      },
    },
  });
  return parseRows(report);
}

async function ga4RunReport(propertyId, accessToken, body) {
  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || "GA4 runReport failed.");
  }
  return payload;
}

function parseRows(report) {
  const dimensionHeaders = (report.dimensionHeaders || []).map((item) => item.name);
  const metricHeaders = (report.metricHeaders || []).map((item) => item.name);
  return (report.rows || []).map((row) => {
    const item = {};
    dimensionHeaders.forEach((header, index) => {
      item[header] = row.dimensionValues[index]?.value || "";
    });
    metricHeaders.forEach((header, index) => {
      item[header] = row.metricValues[index]?.value || "0";
    });
    return item;
  });
}

async function loadDashboardState(env) {
  const stateUrl = env.DASHBOARD_STATE_URL || "https://seo-automation-dashboard.pages.dev/data/dashboard-state.json";
  const response = await fetch(stateUrl);
  if (!response.ok) {
    throw new Error(`Failed to load dashboard state from ${stateUrl}.`);
  }
  return response.json();
}

async function insertReview(env, jobId, action, reviewer, comment, createdAt) {
  await env.DASHBOARD_DB
    .prepare(
      `INSERT INTO dashboard_reviews (
        job_id,
        action,
        reviewer,
        comment,
        created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(jobId, action, reviewer, comment, createdAt)
    .run();
}

function renderTypescriptModule(job) {
  const draft = job.draft;
  const imagePlan = job.image_plan || {};
  const selectedImages = imagePlan.selected_images || [];
  const heroImage = selectedImages[0] || null;
  const sections = (draft.sections || []).map((section) => {
    const sectionCopy = { ...section };
    const matchedImage = findSectionImage(job, section.heading);
    if (matchedImage) {
      sectionCopy.image = {
        src: matchedImage.large || matchedImage.thumb || "",
        alt: matchedImage.alt || section.heading,
        creditName: matchedImage.photographer || "Pexels",
        creditUrl: matchedImage.pexels_url || "",
      };
    }
    return sectionCopy;
  });

  const post = {
    slug: draft.slug,
    categorySlug: job.seo_strategy?.category_slug || "",
    title: draft.title,
    description: draft.description,
    publishedAt: draft.publishedAt,
    author: draft.author || "Jeff Martin Auctioneers Editorial Team",
    readTime: draft.readTime,
    category: draft.category,
    tags: draft.tags || [],
    heroImage: heroImage?.large || draft.heroImage || "/hero.webp",
    heroImageAlt: heroImage?.alt || draft.heroImageAlt || draft.title,
    heroImageCreditName: heroImage?.photographer || "",
    heroImageCreditUrl: heroImage?.pexels_url || "",
    featured: Boolean(draft.featured),
    seoTitle: draft.seoTitle || draft.title,
    seoDescription: draft.seoDescription || draft.description,
    intro: draft.intro || [],
    sections,
    faq: draft.faq || [],
    cta: draft.cta,
  };

  return (
    'import type { BlogPost } from "@/types/blog";\n\n' +
    `const post: BlogPost = ${toTs(post)};\n\n` +
    "export default post;\n"
  );
}

function findSectionImage(job, heading) {
  const imagePlan = job.image_plan || {};
  const selectedImages = imagePlan.selected_images || [];
  const planItems = imagePlan.items || [];
  const placement = `After section: ${heading}`;
  for (let index = 0; index < planItems.length; index += 1) {
    if (planItems[index]?.placement === placement) {
      return selectedImages[index] || null;
    }
  }
  return null;
}

function toTs(value, indent = 2) {
  const spacer = " ".repeat(indent);
  const nextIndent = indent + 2;
  const nextSpacer = " ".repeat(nextIndent);

  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const lines = ["["];
    for (const item of value) {
      lines.push(`${nextSpacer}${toTs(item, nextIndent)},`);
    }
    lines.push(`${spacer}]`);
    return lines.join("\n");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(
      ([key, item]) => !(key.startsWith("heroImageCredit") && (item === "" || item == null)),
    );
    if (!entries.length) return "{}";
    const lines = ["{"];
    for (const [key, item] of entries) {
      lines.push(`${nextSpacer}${key}: ${toTs(item, nextIndent)},`);
    }
    lines.push(`${spacer}}`);
    return lines.join("\n");
  }

  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value == null) return "null";
  return String(value);
}

function parseSecretJson(value, name) {
  if (!value) {
    throw new Error(`${name} secret is missing.`);
  }
  return JSON.parse(value);
}

function parseJson(value) {
  if (!value || value === "null") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isAfterLocalTime(date, timeZone, hour, minute) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return parts.hour > hour || (parts.hour === hour && parts.minute >= minute);
}

function formatDate(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replaceAll("/", "-");
}

async function getExistingContent({ owner, repo, path, branch, token }) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
    { headers: githubHeaders(token) },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || "Failed to look up existing GitHub content.");
  }
  return response.json();
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "seo-automation-scheduler",
  };
}

function buildCommitAuthor(env) {
  return {
    name: env.GIT_AUTHOR_NAME || "SEO Automation Bot",
    email: env.GIT_AUTHOR_EMAIL || "seo-automation@example.com",
  };
}

function encodePath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
    status: init.status ?? 200,
  });
}
