from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = REPO_ROOT / "apps" / "dashboard" / "data" / "dashboard-state.json"
OUTPUT_FILE = REPO_ROOT / "apps" / "dashboard" / "seed.sql"


def sql_quote(value: object) -> str:
    if value is None:
        value = ""
    return "'" + str(value).replace("'", "''") + "'"


def main() -> None:
    state = json.loads(STATE_FILE.read_text())
    jobs = state.get("jobs", [])

    lines = [
        "-- Generated from dashboard-state.json",
        "DELETE FROM dashboard_reviews;",
        "DELETE FROM dashboard_jobs;",
        "",
    ]

    for job in jobs:
        lines.append(
            "INSERT INTO dashboard_jobs ("
            "job_id, site_id, site_name, topic, primary_keyword, secondary_keywords_json, "
            "target_url, target_audience, status, word_count, brief_summary, outline_json, "
            "final_checklist_json, manual_plagiarism_status, flagged_sections_note, selected_images_json, meta_title, meta_description, "
            "activity_json, publish_branch, publish_path, updated_at"
            ") VALUES ("
            + ", ".join(
                [
                    sql_quote(job["job_id"]),
                    sql_quote(job["site_id"]),
                    sql_quote(job["site_name"]),
                    sql_quote(job["topic"]),
                    sql_quote(job["primary_keyword"]),
                    sql_quote(json.dumps(job.get("secondary_keywords", []))),
                    sql_quote(job["target_url"]),
                    sql_quote(job["target_audience"]),
                    sql_quote(job["status"]),
                    sql_quote(job.get("word_count", "")),
                    sql_quote(job.get("brief", {}).get("summary", "")),
                    sql_quote(json.dumps(job.get("brief", {}).get("outline", []))),
                    sql_quote(
                        json.dumps(job.get("final_review", {}).get("checklist", []))
                    ),
                    sql_quote(
                        job.get("final_review", {}).get(
                            "manual_plagiarism_status", "Pending manual review"
                        )
                    ),
                    sql_quote(
                        job.get("final_review", {}).get("flagged_sections_note", "")
                    ),
                    sql_quote(
                        json.dumps(
                            (job.get("image_plan") or {}).get("selected_images", [])
                        )
                    ),
                    sql_quote(job.get("final_review", {}).get("meta_title", "")),
                    sql_quote(
                        job.get("final_review", {}).get("meta_description", "")
                    ),
                    sql_quote(json.dumps(job.get("activity", []))),
                    sql_quote(job.get("publish", {}).get("branch", "main")),
                    sql_quote(job.get("publish", {}).get("path", "")),
                    sql_quote(state.get("summary", {}).get("generated_at", "")),
                ]
            )
            + ");"
        )

    OUTPUT_FILE.write_text("\n".join(lines) + "\n")
    print(f"Wrote seed SQL to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
