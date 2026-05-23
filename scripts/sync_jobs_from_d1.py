from __future__ import annotations

import json
from pathlib import Path

from _cloudflare_d1 import d1_query
from _env import load_dotenv


REPO_ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = REPO_ROOT / "data" / "jobs"
SITES_DIR = REPO_ROOT / "config" / "sites"


def load_sites() -> dict[str, dict]:
    sites: dict[str, dict] = {}
    for path in SITES_DIR.glob("*.json"):
        if path.is_file() and not path.name.endswith(".example.json"):
            payload = json.loads(path.read_text())
            sites[payload["site_id"]] = payload
    return sites


def sync_jobs_from_d1() -> list[str]:
    sites = load_sites()
    rows = d1_query(
        """
        SELECT
          job_id,
          site_id,
          target_url,
          status,
          manual_plagiarism_status,
          flagged_sections_note,
          selected_images_json,
          draft_json,
          updated_at
        FROM dashboard_jobs
        """
    )

    local_paths = {
        path.stem: path
        for path in JOBS_DIR.glob("*.json")
        if path.is_file() and not path.name.endswith(".example.json")
    }

    updated_job_ids: list[str] = []
    for row in rows:
        job_id = row.get("job_id")
        if not job_id or job_id not in local_paths:
            continue

        path = local_paths[job_id]
        payload = json.loads(path.read_text())

        payload["status"] = row.get("status", payload.get("status"))
        payload["updated_at"] = row.get("updated_at") or payload.get("updated_at")

        payload.setdefault("metrics", {})
        payload["metrics"]["manual_plagiarism_status"] = row.get(
            "manual_plagiarism_status", "Pending manual review"
        )
        payload["metrics"]["flagged_sections_note"] = row.get(
            "flagged_sections_note", ""
        )

        payload.setdefault("image_plan", {})
        payload["image_plan"]["selected_images"] = json.loads(
            row.get("selected_images_json") or "[]"
        )
        draft_json = row.get("draft_json")
        if draft_json:
            payload["draft"] = json.loads(draft_json)

        if payload.get("status") == "published":
            site = sites.get(payload.get("site_id") or row.get("site_id"))
            target_url = payload.get("target_url") or row.get("target_url")
            if site and target_url:
                live_url = f"{site['site_url'].rstrip('/')}{target_url}"
                payload.setdefault("publish", {})
                payload["publish"]["live_url"] = live_url
                payload.setdefault("publish_result", {})
                payload["publish_result"]["live_url"] = live_url

        path.write_text(json.dumps(payload, indent=2) + "\n")
        updated_job_ids.append(job_id)

    return updated_job_ids


def main() -> None:
    load_dotenv()
    updated_job_ids = sync_jobs_from_d1()
    print(f"Synced {len(updated_job_ids)} jobs from D1.")
    for job_id in updated_job_ids:
        print(job_id)


if __name__ == "__main__":
    main()
