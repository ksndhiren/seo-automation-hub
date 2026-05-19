from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
SITES_DIR = REPO_ROOT / "config" / "sites"
JOBS_DIR = REPO_ROOT / "data" / "jobs"
OUTPUT_FILE = REPO_ROOT / "apps" / "dashboard" / "data" / "dashboard-state.json"


def load_json_files(folder: Path) -> list[dict]:
    return [
        json.loads(path.read_text())
        for path in sorted(folder.glob("*.json"))
        if path.is_file() and not path.name.endswith(".example.json")
    ]


def build_state() -> dict:
    sites = {site["site_id"]: site for site in load_json_files(SITES_DIR)}
    jobs = sort_jobs(load_json_files(JOBS_DIR))

    status_counts = Counter(job.get("status", "unknown") for job in jobs)

    dashboard_jobs = []
    for job in jobs:
        site = sites.get(job.get("site_id"), {})
        dashboard_jobs.append(
            {
                "job_id": job.get("job_id"),
                "site_id": job.get("site_id"),
                "site_name": site.get("site_name", job.get("site_id", "Unknown site")),
                "topic": job.get("topic"),
                "primary_keyword": job.get("primary_keyword"),
                "secondary_keywords": job.get("secondary_keywords", []),
                "target_url": job.get("target_url"),
                "target_audience": format_audience(site),
                "status": job.get("status", "unknown"),
                "priority": job.get("priority", "medium"),
                "planned_publish_date": job.get("planned_publish_date"),
                "calendar_month": job.get("calendar_month"),
                "word_count": format_word_count(site, job),
                "brief": {
                    "summary": extract_brief_summary(job),
                    "outline": extract_outline(job),
                },
                "seo_strategy": build_seo_strategy(job, site),
                "image_plan": build_image_plan(job),
                "draft": job.get("draft"),
                "final_review": {
                    "checklist": [
                        "Review final article quality and conversion alignment.",
                        "Complete manual plagiarism check before approving publish.",
                        "Confirm metadata and internal links look correct.",
                    ],
                    "manual_plagiarism_status": job.get("metrics", {}).get(
                        "manual_plagiarism_status", "Pending manual review"
                    ),
                    "flagged_sections_note": job.get("metrics", {}).get(
                        "flagged_sections_note", ""
                    ),
                    "meta_title": "Pending",
                    "meta_description": "Pending",
                },
                "activity": build_activity(job, site),
                "publish": {
                    "branch": site.get("publish_branch", "main"),
                    "path": site.get("content_path", "Not configured"),
                },
            }
        )

    return {
        "summary": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "statuses": sorted(status_counts.keys()),
            "cards": [
                {"label": "Active sites", "value": len(sites)},
                {"label": "Open jobs", "value": len(jobs)},
                {
                    "label": "Working-day plan slots",
                    "value": len(
                        [
                            job
                            for job in jobs
                            if job.get("planned_publish_date")
                        ]
                    ),
                },
                {"label": "Needs brief approval", "value": status_counts.get("brief_pending", 0)},
                {"label": "Needs final review", "value": status_counts.get("final_pending", 0)},
            ],
        },
        "sites": [
            {
                "site_id": site["site_id"],
                "site_name": site.get("site_name", site["site_id"]),
                "blog_categories": site.get("blog_categories", []),
            }
            for site in sites.values()
        ],
        "jobs": dashboard_jobs,
    }


def format_word_count(site: dict, job: dict) -> str:
    target_word_count = job.get("metrics", {}).get("target_word_count")
    if target_word_count:
        return f"{target_word_count} words"

    value = site.get("seo_defaults", {}).get("default_word_count_range")
    if isinstance(value, list) and len(value) == 2:
        return f"{value[0]} to {value[1]} words"
    return "Pending"


def format_audience(site: dict) -> str:
    audience = site.get("brand_guidelines", {}).get("audience", [])
    if isinstance(audience, list):
        return " • ".join(str(item) for item in audience) or "Not provided"
    if isinstance(audience, str):
        return audience or "Not provided"
    return "Not provided"


def extract_brief_summary(job: dict) -> str:
    brief = job.get("brief")
    if isinstance(brief, dict) and brief.get("summary"):
        return str(brief["summary"])
    return "Brief content has not been generated yet."


def extract_outline(job: dict) -> list[str]:
    brief = job.get("brief")
    if isinstance(brief, dict) and isinstance(brief.get("outline"), list):
        return [str(item) for item in brief["outline"]]
    return ["Outline will appear after the first briefing pass."]


def build_activity(job: dict, site: dict) -> list[str]:
    activity = [
        f"Job status: {job.get('status', 'unknown')}",
        f"Site target: {site.get('site_name', job.get('site_id', 'Unknown site'))}",
    ]

    if job.get("created_at"):
        activity.append(f"Created: {job['created_at']}")
    if job.get("updated_at"):
        activity.append(f"Last updated: {job['updated_at']}")
    if job.get("planned_publish_date"):
        activity.append(f"Planned publish date: {job['planned_publish_date']}")

    activity.append("Snapshot generated from automation hub data")
    return activity


def build_seo_strategy(job: dict, site: dict) -> dict:
    strategy = job.get("seo_strategy") or {}
    category_slug = strategy.get("category_slug") or extract_category_slug(
        job.get("target_url", "")
    )
    category_name = strategy.get("category_name") or resolve_category_name(
        site, category_slug
    )

    return {
        "search_intent": strategy.get("search_intent", "Pending"),
        "cluster": strategy.get("cluster", "Pending"),
        "lead_goal": strategy.get("lead_goal", "Pending"),
        "opportunity_score": strategy.get("opportunity_score"),
        "opportunity_rationale": strategy.get("opportunity_rationale", ""),
        "category_slug": category_slug,
        "category_name": category_name,
        "suggested_tags": strategy.get("suggested_tags", []),
        "recommended_internal_link_types": strategy.get(
            "recommended_internal_link_types",
            site.get("internal_link_rules", {}).get("preferred_destinations", []),
        ),
    }


def build_image_plan(job: dict) -> dict:
    draft = job.get("draft") or {}
    sections = draft.get("sections") or []
    topic = job.get("topic", "blog article")
    primary_keyword = job.get("primary_keyword", "")
    site_id = job.get("site_id", "")
    category_name = (
        (job.get("seo_strategy") or {}).get("category_name")
        or extract_category_slug(job.get("target_url", "")).replace("-", " ")
        or "guide"
    )

    if site_id == "jma-golfcarts":
        plans = [
            {
                "placement": "Featured image",
                "asset_hint": draft.get("heroImage", "Not assigned yet"),
                "query": "used golf cart marketplace listing outdoor realistic",
                "prompt": (
                    f"Realistic editorial photo of a used golf cart prepared for sale outdoors, clean daylight, "
                    f"trustworthy marketplace mood, no text overlay, visually supports the topic '{topic}'."
                ),
            }
        ]

        if len(sections) >= 2:
            plans.append(
                {
                    "placement": f"After section: {sections[1].get('heading', 'Listing details')}",
                    "asset_hint": "Prompt only",
                    "query": "golf cart inspection listing details realistic",
                    "prompt": (
                        "Detailed golf cart inspection scene with close-up listing details, service notes, and condition checks, "
                        "natural light, realistic marketplace photography, no staged AI look, no text."
                    ),
                }
            )

        if len(sections) >= 3:
            plans.append(
                {
                    "placement": f"After section: {sections[2].get('heading', 'Preparation checklist')}",
                    "asset_hint": "Prompt only",
                    "query": "cleaning golf cart for sale realistic",
                    "prompt": (
                        f"Seller preparing a golf cart for online sale with cleaning, photo setup, and checklist steps visible, "
                        f"credible commercial style, realistic details, supports keyword '{primary_keyword}'."
                    ),
                }
            )

        return {
            "status": "planned",
            "items": plans,
        }

    plans = [
        {
            "placement": "Featured image",
            "asset_hint": draft.get("heroImage", "Not assigned yet"),
            "query": "used crane industrial yard equipment auction",
            "prompt": (
                f"Realistic editorial photo of a used crane prepared for auction in an industrial yard, "
                f"clean daylight, documentary style, no text overlay, trustworthy heavy-equipment marketplace mood, "
                f"supports the topic '{topic}'."
            ),
        }
    ]

    if len(sections) >= 2:
        plans.append(
            {
                "placement": f"After section: {sections[1].get('heading', 'Buyer information')}",
                "asset_hint": "Prompt only",
                "query": "crane inspection maintenance records industrial equipment",
                "prompt": (
                    "Detailed crane inspection scene with paperwork, serial plate, and maintenance records visible, "
                    "professional industrial photography, natural light, no staged AI look, no text."
                ),
            }
        )

    if len(sections) >= 3:
        plans.append(
            {
                "placement": f"After section: {sections[2].get('heading', 'Preparation checklist')}",
                "asset_hint": "Prompt only",
                "query": "preparing crane for sale inspection heavy equipment yard",
                "prompt": (
                    f"Heavy equipment seller preparing a crane for listing, showing cleaning, inspection, and photo capture steps, "
                    f"credible B2B industrial style, sharp realistic details, visually supports keyword '{primary_keyword}'."
                ),
            }
        )

    return {
        "status": "planned",
        "items": plans,
    }


def extract_category_slug(target_url: str) -> str:
    parts = [part for part in str(target_url).split("/") if part]
    if len(parts) >= 3 and parts[0] == "blog":
        return parts[1]
    return ""


def resolve_category_name(site: dict, category_slug: str) -> str:
    for category in site.get("blog_categories", []):
        if category.get("slug") == category_slug:
            return category.get("name", category_slug)
    return category_slug or "Uncategorized"


def sort_jobs(jobs: list[dict]) -> list[dict]:
    status_rank = {
        "final_approved": 0,
        "brief_approved": 1,
        "needs_revision": 2,
        "brief_pending": 3,
        "new": 4,
        "final_pending": 5,
    }
    priority_rank = {
        "high": 0,
        "medium": 1,
        "low": 2,
    }

    def score(job: dict) -> tuple:
        strategy = job.get("seo_strategy") or {}
        return (
            status_rank.get(job.get("status", "unknown"), 99),
            priority_rank.get(job.get("priority", "medium"), 99),
            -(strategy.get("opportunity_score") or 0),
            job.get("created_at", ""),
            job.get("job_id", ""),
        )

    return sorted(jobs, key=score)


def main() -> None:
    state = build_state()
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(state, indent=2))
    print(f"Wrote dashboard snapshot to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
