from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from _env import load_dotenv, require_env
from sync_dashboard_jobs_to_d1 import sync_dashboard_jobs_to_d1
from sync_jobs_from_d1 import sync_jobs_from_d1


REPO_ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = REPO_ROOT / "data" / "jobs"
SITES_DIR = REPO_ROOT / "config" / "sites"
RUNS_DIR = REPO_ROOT / "data" / "runs"


def main() -> None:
    load_dotenv()
    gating = current_publish_window()
    if gating is not None:
        write_run_log(
            [
                {
                    "job_id": "publish-window",
                    "status": "skipped",
                    "reason": gating,
                }
            ]
        )
        print(gating)
        return

    synced_job_ids = sync_jobs_from_d1()
    sites = load_sites()
    today = current_publish_date()
    processed: list[dict] = []

    if synced_job_ids:
        processed.append(
            {
                "job_id": ", ".join(synced_job_ids[:5])
                + ("…" if len(synced_job_ids) > 5 else ""),
                "status": "synced",
                "reason": f"Pulled {len(synced_job_ids)} job states from D1 before scheduled publish",
            }
        )

    for path in sorted(JOBS_DIR.glob("*.json")):
        if path.name.endswith(".example.json"):
            continue
        job = json.loads(path.read_text())
        if job.get("status") != "final_approved":
            continue
        if (job.get("planned_publish_date") or "") > today:
            continue

        site = sites.get(job.get("site_id"))
        if not site:
            processed.append(
                {
                    "job_id": job.get("job_id"),
                    "status": "error",
                    "reason": f"Unknown site_id: {job.get('site_id')}",
                }
            )
            continue

        try:
            publish_job(path, job, site, today)
            processed.append(
                {
                    "job_id": job.get("job_id"),
                    "status": "published",
                    "reason": f"Published to {site['site_url'].rstrip('/')}{job.get('target_url')}",
                }
            )
        except Exception as exc:
            job.setdefault("metrics", {})
            job["metrics"]["last_error"] = str(exc)
            job["updated_at"] = now_iso()
            path.write_text(json.dumps(job, indent=2) + "\n")
            processed.append(
                {
                    "job_id": job.get("job_id"),
                    "status": "error",
                    "reason": f"Scheduled publish failed: {exc}",
                }
            )

    rebuild_dashboard_state()
    try:
        sync_dashboard_jobs_to_d1()
    except Exception as exc:
        processed.append(
            {
                "job_id": "dashboard-d1-push",
                "status": "warning",
                "reason": f"Failed to push dashboard snapshot into D1: {exc}",
            }
        )
    write_run_log(processed)

    for item in processed:
        print(
            f"{item['job_id']}: {item['status']}"
            + (f" ({item['reason']})" if item.get("reason") else "")
        )


def load_sites() -> dict[str, dict]:
    sites = {}
    for path in sorted(SITES_DIR.glob("*.json")):
        if path.name.endswith(".example.json"):
            continue
        payload = json.loads(path.read_text())
        sites[payload["site_id"]] = payload
    return sites


def publish_job(path: Path, job: dict, site: dict, published_at: str) -> None:
    if not job.get("draft"):
        raise RuntimeError("Job does not have a draft to publish.")

    repo_path = prepare_repo(site)
    content_path = repo_path / site["content_path"]
    draft = job["draft"]
    draft["publishedAt"] = published_at

    output_path = content_path / f"{draft['slug']}.ts"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(render_typescript_module(job, site))

    git_author_name = require_env("GIT_AUTHOR_NAME")
    git_author_email = require_env("GIT_AUTHOR_EMAIL")

    subprocess.run(["git", "-C", str(repo_path), "add", str(output_path)], check=True)
    diff_check = subprocess.run(
        ["git", "-C", str(repo_path), "diff", "--cached", "--quiet"],
        check=False,
    )
    if diff_check.returncode != 0:
        env = {
            **os.environ,
            "GIT_AUTHOR_NAME": git_author_name,
            "GIT_AUTHOR_EMAIL": git_author_email,
            "GIT_COMMITTER_NAME": git_author_name,
            "GIT_COMMITTER_EMAIL": git_author_email,
        }
        subprocess.run(
            [
                "git",
                "-C",
                str(repo_path),
                "commit",
                "-m",
                f"Publish blog post: {draft['title']}",
            ],
            check=True,
            env=env,
        )
        subprocess.run(["git", "-C", str(repo_path), "push", "origin", site["publish_branch"]], check=True)

    job["status"] = "published"
    job["updated_at"] = now_iso()
    job.setdefault("publish_result", {})
    job["publish_result"].update(
        {
            "live_url": f"{site['site_url'].rstrip('/')}{job.get('target_url')}",
            "published_at": published_at,
            "branch": site["publish_branch"],
            "path": site["content_path"],
        }
    )
    path.write_text(json.dumps(job, indent=2) + "\n")


def current_publish_window() -> str | None:
    if os.environ.get("PUBLISH_REQUIRE_WINDOW", "").strip() not in {"1", "true", "TRUE", "yes", "YES"}:
        return None

    tz_name = os.environ.get("PUBLISH_TIMEZONE", "America/Chicago").strip() or "America/Chicago"
    publish_hour = int(os.environ.get("PUBLISH_HOUR", "8"))
    publish_minute = int(os.environ.get("PUBLISH_MINUTE", "0"))
    window_minutes = int(os.environ.get("PUBLISH_WINDOW_MINUTES", "90"))
    now_local = datetime.now(ZoneInfo(tz_name))
    start = now_local.replace(hour=publish_hour, minute=publish_minute, second=0, microsecond=0)
    end = start + timedelta(minutes=window_minutes)

    if start <= now_local < end:
        return None

    return (
        f"Skipped scheduled publish: current {tz_name} time "
        f"{now_local.strftime('%Y-%m-%d %H:%M')} is outside the "
        f"{publish_hour:02d}:{publish_minute:02d} publish window."
    )


def current_publish_date() -> str:
    tz_name = os.environ.get("PUBLISH_TIMEZONE", "").strip()
    if tz_name:
        return datetime.now(ZoneInfo(tz_name)).date().isoformat()
    return datetime.now(timezone.utc).date().isoformat()


def prepare_repo(site: dict) -> Path:
    local_repo = Path(site.get("local_repo_path", ""))
    if local_repo.exists():
        return local_repo

    token = require_env("GITHUB_TOKEN")
    repo_url = site.get("github_repo", "").strip()
    if not repo_url:
        raise RuntimeError(f"Site {site.get('site_id')} is missing github_repo.")

    clone_root = Path(tempfile.gettempdir()) / "seo-automation-publish" / site["site_id"]
    if clone_root.exists():
        shutil.rmtree(clone_root)
    clone_root.parent.mkdir(parents=True, exist_ok=True)

    auth_url = repo_url.replace("https://", f"https://x-access-token:{token}@")
    subprocess.run(["git", "clone", auth_url, str(clone_root)], check=True)
    subprocess.run(["git", "-C", str(clone_root), "checkout", site["publish_branch"]], check=True)
    return clone_root


def render_typescript_module(job: dict, site: dict) -> str:
    draft = job["draft"]
    image_plan = job.get("image_plan") or {}
    selected_images = image_plan.get("selected_images") or []
    hero_image = selected_images[0] if selected_images else None

    sections = []
    for section in draft.get("sections", []):
        section_copy = dict(section)
        matched_image = find_section_image(job, section_copy.get("heading", ""))
        if matched_image:
            section_copy["image"] = {
                "src": matched_image.get("large") or matched_image.get("thumb") or "",
                "alt": matched_image.get("alt") or section_copy.get("heading", ""),
                "creditName": matched_image.get("photographer") or "Pexels",
                "creditUrl": matched_image.get("pexels_url") or "",
            }
        sections.append(section_copy)

    post = {
        "slug": draft["slug"],
        "categorySlug": (job.get("seo_strategy") or {}).get("category_slug", ""),
        "title": draft["title"],
        "description": draft["description"],
        "publishedAt": draft["publishedAt"],
        "author": draft.get("author") or f"{site.get('lead_generation_brand', site['site_name'])} Editorial Team",
        "readTime": draft["readTime"],
        "category": draft["category"],
        "tags": draft.get("tags", []),
        "heroImage": hero_image.get("large") if hero_image else draft.get("heroImage", "/hero.webp"),
        "heroImageAlt": hero_image.get("alt") if hero_image else draft.get("heroImageAlt") or draft["title"],
        "heroImageCreditName": hero_image.get("photographer") if hero_image else "",
        "heroImageCreditUrl": hero_image.get("pexels_url") if hero_image else "",
        "featured": bool(draft.get("featured")),
        "seoTitle": draft["seoTitle"],
        "seoDescription": draft["seoDescription"],
        "intro": draft["intro"],
        "sections": sections,
        "faq": draft.get("faq", []),
        "cta": draft["cta"],
    }

    return (
        'import type { BlogPost } from "@/types/blog";\n\n'
        f"const post: BlogPost = {to_ts(post)};\n\n"
        "export default post;\n"
    )


def find_section_image(job: dict, heading: str) -> dict | None:
    image_plan = job.get("image_plan") or {}
    selected_images = image_plan.get("selected_images") or []
    plan_items = image_plan.get("items") or []
    placement = f"After section: {heading}"
    for index, item in enumerate(plan_items):
        if item.get("placement") == placement:
            return selected_images[index] if index < len(selected_images) else None
    return None


def to_ts(value: object, indent: int = 2) -> str:
    spacer = " " * indent
    next_indent = indent + 2
    next_spacer = " " * next_indent

    if isinstance(value, dict):
        if not value:
            return "{}"
        lines = ["{"]
        for key, item in value.items():
            if item in ("", None, [], {}) and key.startswith("heroImageCredit"):
                continue
            lines.append(f"{next_spacer}{key}: {to_ts(item, next_indent)},")
        lines.append(f"{spacer}}}")
        return "\n".join(lines)

    if isinstance(value, list):
        if not value:
            return "[]"
        lines = ["["]
        for item in value:
            lines.append(f"{next_spacer}{to_ts(item, next_indent)},")
        lines.append(f"{spacer}]")
        return "\n".join(lines)

    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    return str(value)


def rebuild_dashboard_state() -> None:
    subprocess.run(["python3", str(REPO_ROOT / "scripts" / "build_dashboard_state.py")], check=True)
    subprocess.run(["python3", str(REPO_ROOT / "scripts" / "build_dashboard_seed_sql.py")], check=True)


def write_run_log(processed: list[dict]) -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"created_at": now_iso(), "results": processed}
    path = RUNS_DIR / f"publish-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    path.write_text(json.dumps(payload, indent=2) + "\n")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    main()
