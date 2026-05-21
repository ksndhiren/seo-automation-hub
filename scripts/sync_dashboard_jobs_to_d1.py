from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from _cloudflare_d1 import d1_query
from _env import load_dotenv


REPO_ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = REPO_ROOT / "apps" / "dashboard" / "data" / "dashboard-state.json"


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return None


def sync_dashboard_jobs_to_d1() -> int:
    state = json.loads(STATE_FILE.read_text())
    jobs = state.get("jobs", [])
    updated_at = state.get("summary", {}).get("generated_at", "")
    local_generated_at = parse_iso(updated_at)

    existing_rows = {
        row["job_id"]: row
        for row in d1_query(
            """
            SELECT
              job_id,
              status,
              manual_plagiarism_status,
              flagged_sections_note,
              selected_images_json,
              draft_json,
              meta_title,
              meta_description,
              activity_json,
              updated_at
            FROM dashboard_jobs
            """
        )
        if row.get("job_id")
    }

    for job in jobs:
        existing = existing_rows.get(job["job_id"], {})
        existing_updated_at = parse_iso(existing.get("updated_at"))
        preserve_dashboard_state = bool(
            existing
            and existing_updated_at
            and local_generated_at
            and existing_updated_at > local_generated_at
        )

        status = (
            existing.get("status", job["status"])
            if preserve_dashboard_state
            else job["status"]
        )
        manual_plagiarism_status = (
            existing.get("manual_plagiarism_status", "Pending manual review")
            if preserve_dashboard_state
            else job.get("final_review", {}).get(
                "manual_plagiarism_status", "Pending manual review"
            )
        )
        flagged_sections_note = (
            existing.get("flagged_sections_note", "")
            if preserve_dashboard_state
            else job.get("final_review", {}).get("flagged_sections_note", "")
        )
        selected_images_json = (
            existing.get("selected_images_json", "[]")
            if preserve_dashboard_state
            else json.dumps((job.get("image_plan") or {}).get("selected_images", []))
        )
        meta_title = (
            existing.get("meta_title", "")
            if preserve_dashboard_state
            else job.get("final_review", {}).get("meta_title", "")
        )
        meta_description = (
            existing.get("meta_description", "")
            if preserve_dashboard_state
            else job.get("final_review", {}).get("meta_description", "")
        )
        activity_json = (
            existing.get("activity_json", "[]")
            if preserve_dashboard_state
            else json.dumps(job.get("activity", []))
        )
        existing_draft_json = existing.get("draft_json", "null")
        local_draft_json = json.dumps(job.get("draft"))
        draft_json = (
            existing_draft_json
            if preserve_dashboard_state
            and existing_draft_json not in (None, "", "null")
            else local_draft_json
        )
        row_updated_at = existing.get("updated_at", updated_at) if preserve_dashboard_state else updated_at

        d1_query(
            """
            INSERT INTO dashboard_jobs (
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
              publish_path,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(job_id) DO UPDATE SET
              site_id = excluded.site_id,
              site_name = excluded.site_name,
              topic = excluded.topic,
              primary_keyword = excluded.primary_keyword,
              secondary_keywords_json = excluded.secondary_keywords_json,
              target_url = excluded.target_url,
              target_audience = excluded.target_audience,
              status = excluded.status,
              word_count = excluded.word_count,
              brief_summary = excluded.brief_summary,
              outline_json = excluded.outline_json,
              draft_json = excluded.draft_json,
              final_checklist_json = excluded.final_checklist_json,
              manual_plagiarism_status = excluded.manual_plagiarism_status,
              flagged_sections_note = excluded.flagged_sections_note,
              selected_images_json = excluded.selected_images_json,
              meta_title = excluded.meta_title,
              meta_description = excluded.meta_description,
              activity_json = excluded.activity_json,
              publish_branch = excluded.publish_branch,
              publish_path = excluded.publish_path,
              updated_at = excluded.updated_at
            """,
            [
                job["job_id"],
                job["site_id"],
                job["site_name"],
                job["topic"],
                job["primary_keyword"],
                json.dumps(job.get("secondary_keywords", [])),
                job["target_url"],
                job["target_audience"],
                status,
                job.get("word_count", ""),
                job.get("brief", {}).get("summary", ""),
                json.dumps(job.get("brief", {}).get("outline", [])),
                draft_json,
                json.dumps(job.get("final_review", {}).get("checklist", [])),
                manual_plagiarism_status,
                flagged_sections_note,
                selected_images_json,
                meta_title,
                meta_description,
                activity_json,
                job.get("publish", {}).get("branch", "main"),
                job.get("publish", {}).get("path", ""),
                row_updated_at,
            ],
        )

    for job in jobs:
        if job.get("draft") is None:
            continue
        d1_query(
            "UPDATE dashboard_jobs SET draft_json = ? WHERE job_id = ?",
            [json.dumps(job.get("draft")), job["job_id"]],
        )

    return len(jobs)


def main() -> None:
    load_dotenv()
    count = sync_dashboard_jobs_to_d1()
    print(f"Upserted {count} dashboard job rows into D1.")


if __name__ == "__main__":
    main()
