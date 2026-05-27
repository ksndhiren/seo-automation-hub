from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


REPO_ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = REPO_ROOT / "data" / "jobs"
SITES_DIR = REPO_ROOT / "config" / "sites"
ACTIVE_BRIEF_STATUSES = {"brief_pending", "brief_approved"}
PLACEHOLDER_SUMMARY = "Brief content has not been generated yet."


def load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def load_jobs() -> list[dict]:
    jobs = []
    for path in sorted(JOBS_DIR.glob("*.json")):
        if path.name.endswith(".example.json"):
            continue
        payload = load_json(path)
        payload["_path"] = str(path.relative_to(REPO_ROOT))
        jobs.append(payload)
    return jobs


def load_sites() -> dict[str, dict]:
    sites = {}
    for path in sorted(SITES_DIR.glob("*.json")):
        if path.name.endswith(".example.json"):
            continue
        payload = load_json(path)
        sites[payload["site_id"]] = payload
    return sites


def audit_jobs(jobs: list[dict], sites: dict[str, dict]) -> list[str]:
    issues: list[str] = []
    jobs_by_site: dict[str, list[dict]] = defaultdict(list)
    urls: dict[str, list[str]] = defaultdict(list)
    used_images: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))

    for job in jobs:
        site_id = job.get("site_id", "")
        jobs_by_site[site_id].append(job)
        if job.get("target_url"):
            urls[job["target_url"]].append(job["job_id"])

        selected_images = (job.get("image_plan") or {}).get("selected_images") or []
        for image in selected_images:
            image_id = normalize_image_id(image)
            if image_id:
                used_images[site_id][image_id].append(job["job_id"])

        status = job.get("status")
        brief = job.get("brief") or {}
        draft = job.get("draft")

        if status in ACTIVE_BRIEF_STATUSES:
            if not brief.get("summary") or brief.get("summary") == PLACEHOLDER_SUMMARY:
                issues.append(f"{job['job_id']}: active brief has placeholder summary")
            if len(brief.get("outline") or []) < 3:
                issues.append(f"{job['job_id']}: active brief outline is too short")

        if status in {"final_pending", "final_approved", "published"} and not draft:
            issues.append(f"{job['job_id']}: {status} job is missing draft content")

        if status == "published" and not published_url(job, sites.get(site_id)):
            issues.append(f"{job['job_id']}: published job is missing a live URL")

        if draft:
            expected_cta = (sites.get(site_id) or {}).get("cta_url")
            actual_cta = ((draft or {}).get("cta") or {}).get("buttonHref")
            if expected_cta and actual_cta != expected_cta:
                issues.append(
                    f"{job['job_id']}: CTA href is {actual_cta!r}, expected {expected_cta!r}"
                )

    for site_id, site_jobs in sorted(jobs_by_site.items()):
        active = [job for job in site_jobs if job.get("status") in ACTIVE_BRIEF_STATUSES]
        if len(active) > 1:
            active_ids = ", ".join(job["job_id"] for job in sorted(active, key=job_sort_key))
            issues.append(f"{site_id}: more than one active brief ({active_ids})")

    for target_url, job_ids in sorted(urls.items()):
        if len(job_ids) > 1:
            issues.append(f"{target_url}: target URL is reused by {', '.join(job_ids)}")

    for site_id, images in sorted(used_images.items()):
        for image_id, job_ids in sorted(images.items()):
            unique_job_ids = sorted(set(job_ids))
            if len(unique_job_ids) > 1:
                issues.append(
                    f"{site_id}: image {image_id} is reused by {', '.join(unique_job_ids)}"
                )

    overdue = overdue_final_approved(jobs)
    for job in overdue:
        issues.append(f"{job['job_id']}: final_approved is due but not published")

    return issues


def job_sort_key(job: dict) -> tuple:
    return (
        job.get("planned_publish_date") or "9999-99-99",
        -((job.get("seo_strategy") or {}).get("opportunity_score") or 0),
        job.get("job_id") or "",
    )


def normalize_image_id(image: object) -> str:
    if not isinstance(image, dict):
        return ""
    for key in ("id", "pexels_url", "original", "large", "thumb"):
        value = image.get(key)
        if value:
            return str(value)
    return ""


def published_url(job: dict, site: dict | None) -> str:
    publish = job.get("publish") or {}
    if publish.get("live_url"):
        return publish["live_url"]
    publish_result = job.get("publish_result") or {}
    if publish_result.get("live_url"):
        return publish_result["live_url"]
    if site and job.get("target_url"):
        return f"{site['site_url'].rstrip('/')}{job['target_url']}"
    return ""


def overdue_final_approved(jobs: list[dict]) -> list[dict]:
    chicago_now = datetime.now(ZoneInfo("America/Chicago"))
    today = chicago_now.date().isoformat()
    after_publish_time = (chicago_now.hour, chicago_now.minute) >= (8, 0)
    overdue = []
    for job in jobs:
        if job.get("status") != "final_approved":
            continue
        planned = job.get("planned_publish_date")
        if not planned:
            continue
        if planned < today or (planned == today and after_publish_time):
            overdue.append(job)
    return overdue


def main() -> None:
    issues = audit_jobs(load_jobs(), load_sites())
    if not issues:
        print("Workflow audit passed: no blocking issues found.")
        return

    print(f"Workflow audit found {len(issues)} issue(s):")
    for issue in issues:
        print(f"- {issue}")
    raise SystemExit(1)


if __name__ == "__main__":
    main()
