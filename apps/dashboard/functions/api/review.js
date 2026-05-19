import { getStatusAfterAction, isSupportedAction, isTerminalStatus, json } from "../_shared.js";
import { publishApprovedJob } from "../_publish.js";

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

  const existing = await d1
    .prepare(
      "SELECT job_id, site_id, status, manual_plagiarism_status, flagged_sections_note, selected_images_json, publish_branch, publish_path FROM dashboard_jobs WHERE job_id = ? LIMIT 1",
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

  let publishResult = null;
  if (!saveReviewOnly && !saveImageSelectionOnly && action === "approve" && existing.status === "final_pending") {
    publishResult = await publishApprovedJob(context, {
      ...existing,
      manual_plagiarism_status: nextManualPlagiarismStatus,
      flagged_sections_note: nextFlaggedSectionsNote,
      selected_images_json: JSON.stringify(nextSelectedImages),
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
  }

  await d1
    .prepare(
      `UPDATE dashboard_jobs
        SET status = ?, manual_plagiarism_status = ?, flagged_sections_note = ?, selected_images_json = ?, updated_at = ?
        WHERE job_id = ?`,
    )
    .bind(
      nextStatus,
      nextManualPlagiarismStatus,
      nextFlaggedSectionsNote,
      JSON.stringify(nextSelectedImages),
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
          || (publishResult
            ? `Approved and published to ${publishResult.liveUrl}.`
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
    selected_images: nextSelectedImages,
    publish: publishResult,
    persisted_at: now,
  });
}
