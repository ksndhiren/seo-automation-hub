import { json } from "../_shared.js";

export async function onRequestGet(context) {
  const d1 = context.env.DASHBOARD_DB;

  if (!d1) {
    return json({
      reviews: [],
      persistence: "static",
      message: "No database configured yet.",
    });
  }

  const url = new URL(context.request.url);
  const jobId = url.searchParams.get("job_id");

  if (!jobId) {
    return json({ ok: false, message: "job_id query param is required." }, { status: 400 });
  }

  const result = await d1
    .prepare(
      `SELECT job_id, action, reviewer, comment, created_at
       FROM dashboard_reviews
       WHERE job_id = ?
       ORDER BY created_at DESC`,
    )
    .bind(jobId)
    .all();

  return json({
    reviews: result.results ?? [],
    persistence: "d1",
  });
}
