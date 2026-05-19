from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
SITES_DIR = REPO_ROOT / "config" / "sites"
LOCAL_STATE_FILE = REPO_ROOT / "apps" / "dashboard" / "data" / "dashboard-state.json"
LIVE_STATE_URL = "https://seo-automation-dashboard.pages.dev/api/state"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export a dashboard job into a site-ready TypeScript blog module.",
    )
    parser.add_argument("--job-id", required=True, help="Dashboard job ID to export.")
    args = parser.parse_args()

    state = load_dashboard_state()
    job = next(
        (item for item in state.get("jobs", []) if item.get("job_id") == args.job_id),
        None,
    )
    if not job:
        raise SystemExit(f"Job not found in dashboard state: {args.job_id}")

    site = load_site_config(job["site_id"])
    output_path = (
        Path(site["local_repo_path"])
        / site["content_path"]
        / f"{job['draft']['slug']}.ts"
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(render_typescript_module(job))
    print(output_path)


def load_dashboard_state() -> dict:
    try:
        raw = subprocess.check_output(
            ["curl", "-sS", LIVE_STATE_URL],
            text=True,
        )
        return json.loads(raw)
    except Exception:
        return json.loads(LOCAL_STATE_FILE.read_text())


def load_site_config(site_id: str) -> dict:
    path = SITES_DIR / f"{site_id}.json"
    if not path.exists():
        raise SystemExit(f"Site config not found: {path}")
    return json.loads(path.read_text())


def render_typescript_module(job: dict) -> str:
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
        "tags": draft["tags"],
        "heroImage": (
            hero_image.get("large")
            if hero_image
            else draft.get("heroImage", "/hero.webp")
        ),
        "heroImageAlt": (
            hero_image.get("alt")
            if hero_image
            else draft["title"]
        ),
        "heroImageCreditName": (
            hero_image.get("photographer")
            if hero_image
            else ""
        ),
        "heroImageCreditUrl": (
            hero_image.get("pexels_url")
            if hero_image
            else ""
        ),
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
            lines.append(f'{next_spacer}{key}: {to_ts(item, next_indent)},')
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


if __name__ == "__main__":
    main()
