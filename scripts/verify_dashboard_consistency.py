from __future__ import annotations

import json
from pathlib import Path

from _cloudflare_d1 import d1_query
from _env import load_dotenv


REPO_ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = REPO_ROOT / "data" / "jobs"


def load_local_jobs() -> dict[str, dict]:
    return {
        path.stem: json.loads(path.read_text())
        for path in JOBS_DIR.glob("*.json")
        if path.is_file() and not path.name.endswith(".example.json")
    }


def main() -> None:
    load_dotenv()
    local_jobs = load_local_jobs()
    rows = d1_query(
        """
        SELECT
          job_id,
          status,
          draft_json,
          selected_images_json
        FROM dashboard_jobs
        """
    )

    mismatches: list[str] = []
    for row in rows:
        job_id = row.get("job_id")
        if not job_id or job_id not in local_jobs:
            continue

        local = local_jobs[job_id]
        d1_status = row.get("status")
        local_status = local.get("status")
        if d1_status != local_status:
            mismatches.append(
                f"{job_id}: status mismatch local={local_status} d1={d1_status}"
            )

        local_draft = local.get("draft")
        d1_draft = json.loads(row.get("draft_json") or "null")
        if bool(local_draft) != bool(d1_draft):
            mismatches.append(
                f"{job_id}: draft presence mismatch local={bool(local_draft)} d1={bool(d1_draft)}"
            )

        local_images = (local.get("image_plan") or {}).get("selected_images", [])
        d1_images = json.loads(row.get("selected_images_json") or "[]")
        if bool(local_images) != bool(d1_images):
            mismatches.append(
                f"{job_id}: selected image presence mismatch local={bool(local_images)} d1={bool(d1_images)}"
            )

    if mismatches:
        raise SystemExit("\n".join(mismatches))

    print(f"Verified {len(rows)} dashboard rows against local job files.")


if __name__ == "__main__":
    main()
