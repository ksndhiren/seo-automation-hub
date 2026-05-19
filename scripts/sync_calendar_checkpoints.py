from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = REPO_ROOT / "data" / "jobs"
UPDATED_AT = "2026-05-19T22:20:00+04:00"
ACTIVE_STATUSES = {
    "brief_pending",
    "brief_approved",
}


def load_jobs() -> list[tuple[Path, dict]]:
    jobs: list[tuple[Path, dict]] = []
    for path in sorted(JOBS_DIR.glob("*.json")):
        if path.name.endswith(".example.json"):
            continue
        jobs.append((path, json.loads(path.read_text())))
    return jobs


def save_job(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n")


def sync_site(site_id: str, jobs: list[tuple[Path, dict]]) -> str | None:
    site_jobs = [
        (path, payload)
        for path, payload in jobs
        if payload.get("site_id") == site_id
    ]
    if any(payload.get("status") in ACTIVE_STATUSES for _, payload in site_jobs):
        return None

    candidates = [
        (path, payload)
        for path, payload in site_jobs
        if payload.get("status") == "new" and payload.get("planned_publish_date")
    ]
    candidates.sort(
        key=lambda item: (
            item[1].get("planned_publish_date", "9999-99-99"),
            -(item[1].get("seo_strategy", {}).get("opportunity_score") or 0),
            item[1].get("job_id", ""),
        )
    )
    if not candidates:
        return None

    path, payload = candidates[0]
    payload["status"] = "brief_pending"
    payload["updated_at"] = UPDATED_AT
    save_job(path, payload)
    return payload.get("job_id")


def sync_calendar_checkpoints() -> list[tuple[str, str]]:
    jobs = load_jobs()
    site_ids = sorted({payload.get("site_id") for _, payload in jobs if payload.get("site_id")})
    promoted: list[tuple[str, str]] = []
    for site_id in site_ids:
        job_id = sync_site(site_id, jobs)
        if job_id:
            promoted.append((site_id, job_id))
    return promoted


def main() -> None:
    promoted = sync_calendar_checkpoints()

    if promoted:
        for site_id, job_id in promoted:
            print(f"{site_id}: promoted {job_id} to brief_pending")
    else:
        print("No calendar promotions were needed.")


if __name__ == "__main__":
    main()
