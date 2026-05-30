import { json, safeParseJson } from "../_shared.js";
import {
  buildFallbackQueries,
  chooseBestPexelsPhoto,
  normalizePhotoId,
  searchPexels,
} from "../_images.js";

export async function onRequestPost(context) {
  const d1 = context.env.DASHBOARD_DB;
  const apiKey = context.env.PEXELS_API_KEY;

  if (!d1) {
    return json({ ok: false, message: "DASHBOARD_DB is not configured." }, { status: 501 });
  }
  if (!apiKey) {
    return json({ ok: false, message: "PEXELS_API_KEY is not configured." }, { status: 501 });
  }

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ ok: false, message: "Invalid JSON payload." }, { status: 400 });
  }

  const jobId = String(payload.job_id || "").trim();
  const force = Boolean(payload.force);
  if (!jobId) {
    return json({ ok: false, message: "job_id is required." }, { status: 400 });
  }

  const reviewRow = await d1
    .prepare(
      "SELECT job_id, site_id, status, selected_images_json FROM dashboard_jobs WHERE job_id = ? LIMIT 1",
    )
    .bind(jobId)
    .first();

  if (!reviewRow) {
    return json({ ok: false, message: "Job not found." }, { status: 404 });
  }

  if (reviewRow.status === "published" && !force) {
    return json(
      {
        ok: false,
        message:
          "Published jobs are locked. Auto-pick is only available for unpublished drafts.",
      },
      { status: 409 },
    );
  }

  const assetJob = await loadAssetJob(context, jobId);
  if (!assetJob?.image_plan?.items?.length) {
    return json({ ok: false, message: "This job does not have an image plan yet." }, { status: 400 });
  }

  const duplicateRows = await d1
    .prepare(
      `SELECT selected_images_json
       FROM dashboard_jobs
       WHERE site_id = ? AND job_id <> ? AND status IN ('brief_pending', 'final_pending', 'final_approved', 'published')`,
    )
    .bind(reviewRow.site_id, jobId)
    .all();

  const usedIds = new Set();
  for (const row of duplicateRows.results || []) {
    const images = safeParseJson(row.selected_images_json, []);
    for (const image of images) {
      const key = normalizePhotoId(image);
      if (key) usedIds.add(key);
    }
  }

  const existingSelections = safeParseJson(reviewRow.selected_images_json, []);
  const seenSelectionKeys = new Set();
  const selections = [...existingSelections];
  const searchDebug = [];

  for (let index = 0; index < assetJob.image_plan.items.length; index += 1) {
    if (selections[index]) {
      const existingKey = normalizePhotoId(selections[index]);
      if (existingKey && !seenSelectionKeys.has(existingKey)) {
        seenSelectionKeys.add(existingKey);
        usedIds.add(existingKey);
        continue;
      }
      selections[index] = null;
      searchDebug.push({
        placement: assetJob.image_plan.items[index]?.placement || `Placement ${index + 1}`,
        query: null,
        results: 0,
        picked: null,
        replaced_duplicate: existingKey || true,
      });
    }

    const item = assetJob.image_plan.items[index];
    const queries = buildFallbackQueries(assetJob, item);
    let chosen = null;
    let winningQuery = "";
    let winningCount = 0;

    for (const query of queries) {
      const photos = await searchPexels(apiKey, query, 6);
      if (!photos.length) {
        searchDebug.push({ placement: item.placement, query, results: 0 });
        continue;
      }
      const best = chooseBestPexelsPhoto(assetJob, item, photos, usedIds);
      searchDebug.push({ placement: item.placement, query, results: photos.length, picked: best?.id || null });
      if (best) {
        chosen = best;
        winningQuery = query;
        winningCount = photos.length;
        break;
      }
    }

    if (chosen) {
      selections[index] = chosen;
      const key = normalizePhotoId(chosen);
      if (key) usedIds.add(key);
      if (assetJob.image_plan.items[index]) {
        assetJob.image_plan.items[index].query = winningQuery || assetJob.image_plan.items[index].query;
        assetJob.image_plan.items[index].asset_hint = chosen.photographer
          ? `Selected · ${chosen.photographer}`
          : assetJob.image_plan.items[index].asset_hint;
        assetJob.image_plan.items[index].search_result_count = winningCount;
      }
    }
  }

  await d1
    .prepare(
      "UPDATE dashboard_jobs SET selected_images_json = ?, updated_at = ? WHERE job_id = ?",
    )
    .bind(JSON.stringify(selections), new Date().toISOString(), jobId)
    .run();

  return json({
    ok: true,
    job_id: jobId,
    forced: force,
    selected_images: selections,
    selected_count: selections.filter(Boolean).length,
    search_debug: searchDebug,
  });
}

async function loadAssetJob(context, jobId) {
  const requestUrl = new URL(context.request.url);
  const dataUrl = new URL("/data/dashboard-state.json", requestUrl.origin);
  const assetResponse = await context.env.ASSETS.fetch(dataUrl);
  if (!assetResponse.ok) {
    return null;
  }

  const assetState = await assetResponse.json();
  return (assetState.jobs || []).find((job) => job.job_id === jobId) || null;
}
