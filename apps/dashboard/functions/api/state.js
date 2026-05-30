import { buildImagePlanForJob } from "../_images.js";
import { json, safeParseJson } from "../_shared.js";

function sortJobs(jobs) {
  return [...jobs].sort((left, right) => {
    const leftDate = left.planned_publish_date || "9999-12-31";
    const rightDate = right.planned_publish_date || "9999-12-31";

    return (
      leftDate.localeCompare(rightDate) ||
      String(left.site_name || "").localeCompare(String(right.site_name || "")) ||
      String(left.topic || "").localeCompare(String(right.topic || ""))
    );
  });
}

export async function onRequestGet(context) {
  const d1 = context.env.DASHBOARD_DB;
  const url = new URL(context.request.url);
  const dataUrl = new URL("/data/dashboard-state.json", url.origin);
  let assetState = { jobs: [], sites: [] };
  try {
    const assetResponse = await context.env.ASSETS.fetch(dataUrl);
    if (assetResponse.ok) {
      assetState = await assetResponse.json();
    }
  } catch {
    // Asset bundle missing or corrupt — fall back to D1-only data.
  }
  const performanceState = await loadPerformanceState(context, url);
  const assetJobsById = Object.fromEntries(
    (assetState.jobs || []).map((job) => [job.job_id, job]),
  );

  if (d1) {
    const jobs = await d1
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
        ORDER BY updated_at DESC, topic ASC`,
      )
      .all();

    const rows = jobs.results ?? [];
    const statusSet = new Set();

    const normalizedJobs = rows.map((row) => {
      const assetJob = assetJobsById[row.job_id] || {};
      const draft = safeParseJson(row.draft_json, null) ?? assetJob.draft ?? null;
      const imagePlan = buildImagePlanForJob({
        ...assetJob,
        site_id: row.site_id,
        topic: row.topic,
        primary_keyword: row.primary_keyword,
        draft,
      });
      statusSet.add(row.status);
      return {
        job_id: row.job_id,
        site_id: row.site_id,
        site_name: row.site_name,
        topic: row.topic,
        primary_keyword: row.primary_keyword,
        secondary_keywords: safeParseJson(row.secondary_keywords_json, []),
        target_url: row.target_url,
        target_audience: row.target_audience,
        status: row.status,
        priority: assetJob.priority || "medium",
        planned_publish_date: assetJob.planned_publish_date || null,
        calendar_month: assetJob.calendar_month || null,
        word_count: row.word_count,
        brief: {
          summary: row.brief_summary,
          outline: safeParseJson(row.outline_json, []),
        },
        seo_strategy: assetJob.seo_strategy || {},
        image_plan: {
          ...imagePlan,
          selected_images: safeParseJson(row.selected_images_json, []),
        },
        draft,
        final_review: {
          checklist: safeParseJson(row.final_checklist_json, []),
          manual_plagiarism_status: row.manual_plagiarism_status,
          flagged_sections_note: row.flagged_sections_note || "",
          meta_title: row.meta_title,
          meta_description: row.meta_description,
        },
        activity: safeParseJson(row.activity_json, []),
        publish: {
          branch: row.publish_branch,
          path: row.publish_path,
        },
      };
    });

    const statusCounts = normalizedJobs.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    }, {});

    const sortedJobs = sortJobs(normalizedJobs);

    return json({
      summary: {
        generated_at: new Date().toISOString(),
        statuses: [...statusSet].sort(),
        cards: [
          {
            label: "Active sites",
            value: new Set(sortedJobs.map((job) => job.site_id)).size,
          },
          { label: "Open jobs", value: sortedJobs.length },
          {
            label: "Working-day plan slots",
            value: sortedJobs.filter((job) => job.planned_publish_date).length,
          },
          {
            label: "Needs brief approval",
            value: statusCounts.brief_pending || 0,
          },
          {
            label: "Needs final review",
            value: statusCounts.final_pending || 0,
          },
        ],
      },
      sites: assetState.sites || [],
      jobs: sortedJobs,
      performance: performanceState,
      persistence: "d1",
    });
  }

  return json({
    ...assetState,
    performance: performanceState,
    persistence: "static",
  });
}

async function loadPerformanceState(context, url) {
  const d1 = context.env.DASHBOARD_DB;
  if (d1) {
    const row = await d1
      .prepare("SELECT payload_json FROM dashboard_performance WHERE id = 'latest' LIMIT 1")
      .first();
    if (row?.payload_json) {
      try {
        return JSON.parse(row.payload_json);
      } catch {
        // Fall through to the static snapshot if a bad row ever lands in D1.
      }
    }
  }

  const performanceUrl = new URL("/data/performance-state.json", url.origin);
  const performanceResponse = await context.env.ASSETS.fetch(performanceUrl);
  return performanceResponse.ok
    ? await performanceResponse.json()
    : { generated_at: null, source: "missing", sites: [] };
}
