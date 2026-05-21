from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from _env import load_dotenv
from _images import auto_pick_images_for_job
from _openai import call_openai_json
from sync_dashboard_jobs_to_d1 import sync_dashboard_jobs_to_d1
from sync_jobs_from_d1 import sync_jobs_from_d1


REPO_ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = REPO_ROOT / "data" / "jobs"
SITES_DIR = REPO_ROOT / "config" / "sites"
RUNS_DIR = REPO_ROOT / "data" / "runs"
ACTIVE_BRIEF_STATUSES = {"brief_pending", "brief_approved"}
ELIGIBLE_STATUS_RANK = {
    "brief_approved": 0,
    "needs_revision": 1,
    "new": 2,
}
PRIORITY_RANK = {
    "high": 0,
    "medium": 1,
    "low": 2,
}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run one SEO automation cycle across eligible jobs."
    )
    parser.add_argument("--job-id", help="Only process the specified job ID.")
    args = parser.parse_args()

    load_dotenv()
    synced_job_ids = sync_jobs_from_d1()
    sites = load_sites()
    job_paths = sorted(JOBS_DIR.glob("*.json"))
    job_records = [
        (path, json.loads(path.read_text()))
        for path in job_paths
    ]
    processed: list[dict] = []

    if synced_job_ids:
        processed.append(
            {
                "job_id": ", ".join(synced_job_ids[:5])
                + ("…" if len(synced_job_ids) > 5 else ""),
                "status": "synced",
                "reason": f"Pulled {len(synced_job_ids)} job states from D1 before processing",
            }
        )

    if args.job_id:
        target = next(
            ((path, job) for path, job in job_records if job.get("job_id") == args.job_id),
            None,
        )
        if target:
            process_and_record(target[0], target[1], sites, processed)
            ensure_site_has_active_brief(target[1].get("site_id"), job_records, sites, processed)
        else:
            processed.append(
                {
                    "job_id": args.job_id,
                    "status": "skipped",
                    "reason": "Specified job_id was not found.",
                }
            )
    else:
        for site_id in sorted(sites.keys()):
            candidate = select_site_candidate(site_id, job_records)
            if candidate:
                process_and_record(candidate[0], candidate[1], sites, processed)
            ensure_site_has_active_brief(site_id, job_records, sites, processed)

    rebuild_dashboard_state()
    sync_dashboard_jobs_to_d1()
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
        site = json.loads(path.read_text())
        sites[site["site_id"]] = site
    return sites


def process_and_record(path: Path, job: dict, sites: dict[str, dict], processed: list[dict]) -> None:
    site = sites.get(job.get("site_id"))
    if not site:
        processed.append(
            {
                "job_id": job.get("job_id"),
                "status": "skipped",
                "reason": f"Unknown site_id: {job.get('site_id')}",
            }
        )
        return

    outcome = process_job(job, site)
    if outcome["changed"]:
        path.write_text(json.dumps(job, indent=2) + "\n")
    processed.append(
        {
            "job_id": job.get("job_id"),
            "status": outcome["status"],
            "reason": outcome["reason"],
        }
    )


def process_job(job: dict, site: dict) -> dict:
    status = job.get("status")
    if status == "new":
        return generate_brief(job, site)
    if status == "brief_approved":
        return generate_draft(job, site)
    if status == "needs_revision":
        return resume_revision(job, site)
    return {"changed": False, "status": "skipped", "reason": f"No automation for status {status}"}


def select_site_candidate(site_id: str, job_records: list[tuple[Path, dict]]) -> tuple[Path, dict] | None:
    site_jobs = [
        (path, job)
        for path, job in job_records
        if job.get("site_id") == site_id and job.get("status") in ELIGIBLE_STATUS_RANK
    ]
    if not site_jobs:
        return None

    site_jobs.sort(
        key=lambda item: (
            ELIGIBLE_STATUS_RANK.get(item[1].get("status"), 99),
            PRIORITY_RANK.get(item[1].get("priority", "medium"), 99),
            -((item[1].get("seo_strategy") or {}).get("opportunity_score") or 0),
            item[1].get("planned_publish_date") or "9999-99-99",
            item[1].get("created_at", ""),
            item[1].get("job_id", ""),
        )
    )
    return site_jobs[0]


def ensure_site_has_active_brief(
    site_id: str,
    job_records: list[tuple[Path, dict]],
    sites: dict[str, dict],
    processed: list[dict],
) -> None:
    site_jobs = [
        (path, job)
        for path, job in job_records
        if job.get("site_id") == site_id
    ]
    if any(job.get("status") in ACTIVE_BRIEF_STATUSES for _, job in site_jobs):
        return

    candidates = [
        (path, job)
        for path, job in site_jobs
        if job.get("status") == "new" and job.get("planned_publish_date")
    ]
    candidates.sort(
        key=lambda item: (
            item[1].get("planned_publish_date", "9999-99-99"),
            -((item[1].get("seo_strategy") or {}).get("opportunity_score") or 0),
            item[1].get("job_id", ""),
        )
    )
    if not candidates:
        return

    path, job = candidates[0]
    outcome = generate_brief(job, sites[site_id])
    if outcome["changed"]:
        path.write_text(json.dumps(job, indent=2) + "\n")
        processed.append(
            {
                "job_id": job.get("job_id"),
                "status": outcome["status"],
                "reason": f"{outcome['reason']} and moved job to brief_pending as the next active site brief",
            }
        )


def generate_brief(job: dict, site: dict) -> dict:
    system_prompt = (
        "You are an SEO strategist building article briefs for a human-reviewed content workflow. "
        "Return only valid JSON. Be specific, commercially aware, and avoid keyword stuffing."
    )
    user_prompt = f"""
Site name: {site['site_name']}
Site URL: {site.get('site_url', '')}
Lead generation brand: {site.get('lead_generation_brand', '')}
Brand tone: {site.get('brand_guidelines', {}).get('tone', '')}
Lead generation context: {site.get('brand_guidelines', {}).get('lead_generation_context', '')}
Audience: {json.dumps(site.get('brand_guidelines', {}).get('audience', []))}
Blog categories: {json.dumps(site.get('blog_categories', []))}
Internal link preferences: {json.dumps(site.get('internal_link_rules', {}).get('preferred_destinations', []))}

Job topic: {job.get('topic')}
Primary keyword: {job.get('primary_keyword')}
Secondary keywords: {json.dumps(job.get('secondary_keywords', []))}
Target URL: {job.get('target_url')}

Return a JSON object with exactly these keys:
- brief_summary: string
- outline: array of 6 to 8 strings, using H1/H2 language where useful
- search_intent: string
- cluster: string
- category_slug: string
- category_name: string
- suggested_tags: array of 3 to 6 strings
- recommended_internal_link_types: array of 3 to 5 strings
- target_word_count: integer
"""

    result = call_openai_json(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_output_tokens=2200,
    )

    job["brief"] = {
        "summary": result["brief_summary"],
        "outline": result["outline"],
    }
    existing_strategy = dict(job.get("seo_strategy") or {})
    job["seo_strategy"] = {
        **existing_strategy,
        "search_intent": result["search_intent"],
        "cluster": result["cluster"],
        "category_slug": result["category_slug"],
        "category_name": result["category_name"],
        "suggested_tags": result["suggested_tags"],
        "recommended_internal_link_types": result["recommended_internal_link_types"],
    }
    job.setdefault("metrics", {})
    job["metrics"]["target_word_count"] = int(result["target_word_count"])
    job["status"] = "brief_pending"
    job["updated_at"] = now_iso()
    return {"changed": True, "status": "updated", "reason": "Generated brief"}


def generate_draft(job: dict, site: dict) -> dict:
    system_prompt = (
        "You are a senior B2B content writer generating structured blog drafts for publication. "
        "Return only valid JSON. Write naturally, use short clear paragraphs, and keep SEO useful rather than forced."
    )
    user_prompt = f"""
Site name: {site['site_name']}
Site URL: {site.get('site_url', '')}
Lead generation brand: {site.get('lead_generation_brand', '')}
Brand tone: {site.get('brand_guidelines', {}).get('tone', '')}
Lead generation context: {site.get('brand_guidelines', {}).get('lead_generation_context', '')}
Audience: {json.dumps(site.get('brand_guidelines', {}).get('audience', []))}
Avoid: {json.dumps(site.get('brand_guidelines', {}).get('avoid', []))}

Job topic: {job.get('topic')}
Primary keyword: {job.get('primary_keyword')}
Secondary keywords: {json.dumps(job.get('secondary_keywords', []))}
Target URL: {job.get('target_url')}
Brief summary: {job.get('brief', {}).get('summary', '')}
Outline: {json.dumps(job.get('brief', {}).get('outline', []))}
SEO strategy: {json.dumps(job.get('seo_strategy', {}))}
Target word count: {job.get('metrics', {}).get('target_word_count', '')}

Return a JSON object with exactly these keys:
- title: string
- description: string
- readTime: string
- category: string
- tags: array of 3 to 6 strings
- seoTitle: string
- seoDescription: string
- intro: array of 2 strings
- sections: array of objects with keys heading (string), paragraphs (array of 2 strings minimum), optional bullets (array of strings), optional callout (string)
- faq: array of 2 to 4 objects with keys question and answer
- cta: object with keys title, body, buttonLabel, buttonHref

Rules:
- Use the category from seo_strategy where possible.
- The CTA and conversion language should name Jeff Martin Auctioneers as the trusted contact brand behind the micro-site whenever a company name is used.
- Do not make the microsite itself the speaking auction brand in CTA copy if Jeff Martin Auctioneers should be the named contact.
- Do not include markdown fences.
- Do not include any extra keys.
"""

    result = call_openai_json(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_output_tokens=5200,
    )

    target_url = str(job.get("target_url", ""))
    slug = target_url.rstrip("/").split("/")[-1] or job["job_id"]
    today = datetime.now(timezone.utc).date().isoformat()

    job["draft"] = {
        "slug": slug,
        "title": result["title"],
        "description": result["description"],
        "publishedAt": today,
        "author": f"{site.get('lead_generation_brand', site['site_name'])} Editorial Team",
        "readTime": result["readTime"],
        "category": result["category"],
        "tags": result["tags"],
        "heroImage": "/hero.webp",
        "featured": False,
        "seoTitle": result["seoTitle"],
        "seoDescription": result["seoDescription"],
        "intro": result["intro"],
        "sections": result["sections"],
        "faq": result["faq"],
        "cta": result["cta"],
    }
    selected_count = auto_pick_images_for_job(job)
    job["status"] = "final_pending"
    job["updated_at"] = now_iso()
    image_reason = (
        f" and auto-selected {selected_count} images"
        if selected_count
        else " and left image prompts ready for selection"
    )
    return {
        "changed": True,
        "status": "updated",
        "reason": f"Generated draft{image_reason}",
    }


def resume_revision(job: dict, site: dict) -> dict:
    if job.get("draft"):
        outcome = generate_draft(job, site)
        if outcome["changed"]:
            job["status"] = "final_pending"
            image_reason = outcome["reason"].replace("Generated draft", "", 1)
            outcome["reason"] = f"Regenerated draft from revision notes{image_reason}"
        return outcome
    return generate_brief(job, site)


def rebuild_dashboard_state() -> None:
    subprocess.run(
        ["python3", str(REPO_ROOT / "scripts" / "build_dashboard_state.py")],
        check=True,
    )
    subprocess.run(
        ["python3", str(REPO_ROOT / "scripts" / "build_dashboard_seed_sql.py")],
        check=True,
    )


def write_run_log(processed: list[dict]) -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "created_at": now_iso(),
        "results": processed,
    }
    path = RUNS_DIR / f"run-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    path.write_text(json.dumps(payload, indent=2) + "\n")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    main()
