import { getStatusAfterAction, isSupportedAction, isTerminalStatus, json } from "../_shared.js";
import { loadAssetJobForReview, publishApprovedJob } from "../_publish.js";
import {
  generateDraftForApprovedBrief,
  reviseBriefFromFeedback,
  reviseDraftFromFeedback,
} from "../_writer.js";

export async function onRequestPost(context) {
  const d1 = context.env.DASHBOARD_DB;

  if (!d1) {
    return json(
      {
        ok: false,
        message:
          "Review persistence is not configured yet. Bind DASHBOARD_DB in Cloudflare to enable approvals.",
      },
      { status: 501 },
    );
  }

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ ok: false, message: "Invalid JSON payload." }, { status: 400 });
  }

  const jobId = String(payload.job_id || "").trim();
  const action = String(payload.action || "").trim();
  const reviewer = String(payload.reviewer || "").trim() || "seo-expert";
  const comment = String(payload.comment || "").trim();
  const selectedImages = Array.isArray(payload.selected_images)
    ? payload.selected_images
    : null;
  const hasManualPlagiarismStatus = Object.prototype.hasOwnProperty.call(
    payload,
    "manual_plagiarism_status",
  );
  const hasFlaggedSectionsNote = Object.prototype.hasOwnProperty.call(
    payload,
    "flagged_sections_note",
  );
  const manualPlagiarismStatus = String(
    payload.manual_plagiarism_status || "",
  ).trim();
  const flaggedSectionsNote = String(payload.flagged_sections_note || "").trim();
  const saveReviewOnly = action === "save_review_notes";
  const saveImageSelectionOnly = action === "save_image_selection";

  if (!jobId) {
    return json({ ok: false, message: "job_id is required." }, { status: 400 });
  }

  if (!saveReviewOnly && !saveImageSelectionOnly && !isSupportedAction(action)) {
    return json(
      {
        ok: false,
        message:
          "action must be approve, request_changes, save_review_notes, or save_image_selection.",
      },
      { status: 400 },
    );
  }

  if (action === "request_changes" && !comment) {
    return json(
      {
        ok: false,
        message: "Reviewer notes are required before sending a job back.",
      },
      { status: 400 },
    );
  }

  const existing = await d1
    .prepare(
      "SELECT job_id, site_id, status, topic, primary_keyword, secondary_keywords_json, target_url, word_count, brief_summary, outline_json, manual_plagiarism_status, flagged_sections_note, selected_images_json, draft_json, publish_branch, publish_path FROM dashboard_jobs WHERE job_id = ? LIMIT 1",
    )
    .bind(jobId)
    .first();

  if (!existing) {
    return json({ ok: false, message: "Job not found." }, { status: 404 });
  }

  if (isTerminalStatus(existing.status)) {
    return json(
      {
        ok: false,
        message:
          "This job is already published and locked. It can no longer be approved, sent back, or edited from the dashboard.",
      },
      { status: 409 },
    );
  }

  let nextStatus = saveReviewOnly || saveImageSelectionOnly
    ? existing.status
    : getStatusAfterAction(existing.status, action);
  if (!saveReviewOnly && !saveImageSelectionOnly && action === "approve" && existing.status === "needs_revision") {
    const hasDraft = existing.draft_json && existing.draft_json !== "null";
    nextStatus = hasDraft ? "final_pending" : "brief_approved";
  }
  const now = new Date().toISOString();
  const nextManualPlagiarismStatus =
    hasManualPlagiarismStatus
      ? manualPlagiarismStatus || "Pending manual review"
      : existing.manual_plagiarism_status || "Pending manual review";
  const nextFlaggedSectionsNote =
    hasFlaggedSectionsNote
      ? flaggedSectionsNote
      : existing.flagged_sections_note || "";
  const nextSelectedImages = selectedImages
    ? selectedImages
    : JSON.parse(existing.selected_images_json || "[]");
  let nextDraftJson = existing.draft_json || null;
  let nextBriefSummary = existing.brief_summary || "";
  let nextOutlineJson = existing.outline_json || "[]";
  const assetJob = await loadAssetJobForReview(context, jobId);

  let draftResult = null;
  let briefRevisionResult = null;
  let publishResult = null;
  if (!saveReviewOnly && !saveImageSelectionOnly && action === "approve" && existing.status === "brief_pending") {
    draftResult = await generateDraftForApprovedBrief(context, existing);
    if (!draftResult.ok) {
      return json(
        {
          ok: false,
          message: draftResult.message,
          previous_status: existing.status,
        },
        { status: 502 },
      );
    }
    nextDraftJson = JSON.stringify(draftResult.draft);
    nextStatus = "final_pending";
  }

  if (!saveReviewOnly && !saveImageSelectionOnly && action === "request_changes") {
    const hasDraft = existing.draft_json && existing.draft_json !== "null";
    if (hasDraft) {
      draftResult = await reviseDraftFromFeedback(context, existing, comment);
      if (!draftResult.ok) {
        return json(
          {
            ok: false,
            message: draftResult.message,
            previous_status: existing.status,
          },
          { status: 502 },
        );
      }
      nextDraftJson = JSON.stringify(draftResult.draft);
      nextStatus = "final_pending";
    } else {
      briefRevisionResult = await reviseBriefFromFeedback(context, existing, comment);
      if (!briefRevisionResult.ok) {
        return json(
          {
            ok: false,
            message: briefRevisionResult.message,
            previous_status: existing.status,
          },
          { status: 502 },
        );
      }
      nextBriefSummary = briefRevisionResult.brief.summary;
      nextOutlineJson = JSON.stringify(briefRevisionResult.brief.outline);
      nextStatus = "brief_pending";
    }
  }

  if (!saveReviewOnly && !saveImageSelectionOnly && action === "approve" && existing.status === "final_pending") {
    const shouldPublishNow = shouldPublishImmediately(assetJob?.planned_publish_date, now);
    if (shouldPublishNow) {
      publishResult = await publishApprovedJob(context, {
        ...existing,
        draft_json: nextDraftJson,
        manual_plagiarism_status: nextManualPlagiarismStatus,
        flagged_sections_note: nextFlaggedSectionsNote,
        selected_images_json: JSON.stringify(draftResult?.selectedImages || nextSelectedImages),
      });
      if (!publishResult.ok) {
        return json(
          {
            ok: false,
            message: publishResult.message,
            previous_status: existing.status,
          },
          { status: 502 },
        );
      }
      nextStatus = "published";
    } else {
      nextStatus = "final_approved";
    }
  }

  await d1
    .prepare(
      `UPDATE dashboard_jobs
        SET status = ?, brief_summary = ?, outline_json = ?, manual_plagiarism_status = ?, flagged_sections_note = ?, selected_images_json = ?, draft_json = ?, updated_at = ?
        WHERE job_id = ?`,
    )
    .bind(
      nextStatus,
      nextBriefSummary,
      nextOutlineJson,
      nextManualPlagiarismStatus,
      nextFlaggedSectionsNote,
      JSON.stringify(draftResult?.selectedImages || nextSelectedImages),
      nextDraftJson,
      now,
      jobId,
    )
    .run();

  if (comment || (!saveReviewOnly && !saveImageSelectionOnly)) {
    await d1
      .prepare(
        `INSERT INTO dashboard_reviews (
          job_id,
          action,
          reviewer,
          comment,
          created_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        jobId,
        action,
        reviewer,
        comment
          || (draftResult
            ? "Approved and drafted immediately."
            : briefRevisionResult
            ? "Brief revised from reviewer notes."
            : publishResult
            ? `Approved and published to ${publishResult.liveUrl}.`
            : action === "approve" && existing.status === "final_pending"
            ? "Approved and queued for scheduled publish."
            : action === "request_changes" && existing.draft_json && existing.draft_json !== "null"
            ? "Draft revised immediately from reviewer notes."
            : action === "request_changes"
            ? "Brief revised immediately from reviewer notes."
            : saveImageSelectionOnly
            ? "Image selections updated."
            : "Review notes updated."),
        now,
      )
      .run();
  }

  return json({
    ok: true,
    job_id: jobId,
    previous_status: existing.status,
    next_status: nextStatus,
    reviewer,
    comment,
    manual_plagiarism_status: nextManualPlagiarismStatus,
    flagged_sections_note: nextFlaggedSectionsNote,
    selected_images: draftResult?.selectedImages || nextSelectedImages,
    draft: draftResult?.draft || (nextDraftJson ? JSON.parse(nextDraftJson) : null),
    brief: briefRevisionResult?.brief || {
      summary: nextBriefSummary,
      outline: JSON.parse(nextOutlineJson || "[]"),
    },
    draft_generated: Boolean(draftResult),
    publish: publishResult,
    persisted_at: now,
  });
}

function shouldPublishImmediately(plannedPublishDate, nowIso) {
  if (!plannedPublishDate) {
    return true;
  }

  const todayTbilisi = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tbilisi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(nowIso))
    .replaceAll("/", "-");

  if (plannedPublishDate < todayTbilisi) {
    return true;
  }
  if (plannedPublishDate > todayTbilisi) {
    return false;
  }

  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tbilisi",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(nowIso)),
  );
  const minute = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tbilisi",
      minute: "2-digit",
    }).format(new Date(nowIso)),
  );

  return hour > 17 || (hour === 17 && minute >= 0);
}
