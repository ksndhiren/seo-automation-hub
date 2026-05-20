from __future__ import annotations

import json
from pathlib import Path

from _cloudflare_d1 import d1_query
from _env import load_dotenv


REPO_ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = REPO_ROOT / "apps" / "dashboard" / "data" / "dashboard-state.json"


def sync_dashboard_jobs_to_d1() -> int:
    state = json.loads(STATE_FILE.read_text())
    jobs = state.get("jobs", [])
    updated_at = state.get("summary", {}).get("generated_at", "")

    for job in jobs:
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                job["status"],
                job.get("word_count", ""),
                job.get("brief", {}).get("summary", ""),
                json.dumps(job.get("brief", {}).get("outline", [])),
                json.dumps(job.get("final_review", {}).get("checklist", [])),
                job.get("final_review", {}).get(
                    "manual_plagiarism_status", "Pending manual review"
                ),
                job.get("final_review", {}).get("flagged_sections_note", ""),
                json.dumps((job.get("image_plan") or {}).get("selected_images", [])),
                job.get("final_review", {}).get("meta_title", ""),
                job.get("final_review", {}).get("meta_description", ""),
                json.dumps(job.get("activity", [])),
                job.get("publish", {}).get("branch", "main"),
                job.get("publish", {}).get("path", ""),
                updated_at,
            ],
        )

    return len(jobs)


def main() -> None:
    load_dotenv()
    count = sync_dashboard_jobs_to_d1()
    print(f"Upserted {count} dashboard job rows into D1.")


if __name__ == "__main__":
    main()
