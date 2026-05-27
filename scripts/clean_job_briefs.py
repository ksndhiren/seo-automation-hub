from __future__ import annotations

import json
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = REPO_ROOT / "data" / "jobs"
PLACEHOLDER_SUMMARY = "Brief content has not been generated yet."
HEADING_MARKER_RE = re.compile(r"^\s*(?:#{1,6}\s+|H[1-6]:\s*)", re.IGNORECASE)


def clean_heading(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return HEADING_MARKER_RE.sub("", value).strip()


def derive_outline(job: dict, draft: dict) -> list[str]:
    outline: list[str] = []
    if draft.get("title") or job.get("topic"):
        outline.append(draft.get("title") or job["topic"])
    for section in draft.get("sections") or []:
        heading = section.get("heading") if isinstance(section, dict) else ""
        if heading:
            outline.append(heading)
    if draft.get("faq"):
        outline.append("Frequently asked questions")
    cta = draft.get("cta") or {}
    if cta.get("title"):
        outline.append(cta["title"])

    deduped: list[str] = []
    seen: set[str] = set()
    for item in outline:
        cleaned = clean_heading(item)
        if cleaned and cleaned not in seen:
            deduped.append(cleaned)
            seen.add(cleaned)
    return deduped


def clean_job(path: Path) -> tuple[bool, dict[str, int]]:
    job = json.loads(path.read_text())
    original = json.dumps(job, sort_keys=True)
    stats = {"cleaned_markers": 0, "filled_summaries": 0, "derived_outlines": 0}

    brief = job.get("brief")
    if isinstance(brief, dict) and isinstance(brief.get("outline"), list):
        cleaned_outline = []
        for item in brief["outline"]:
            cleaned = clean_heading(item)
            if cleaned and cleaned != item:
                stats["cleaned_markers"] += 1
            if cleaned:
                cleaned_outline.append(cleaned)
        brief["outline"] = cleaned_outline

    if job.get("status") != "new" and isinstance(job.get("draft"), dict):
        if not isinstance(job.get("brief"), dict):
            job["brief"] = {}
        brief = job["brief"]
        summary = brief.get("summary")
        if not isinstance(summary, str) or summary.strip() in {"", PLACEHOLDER_SUMMARY}:
            brief["summary"] = job["draft"].get("description") or (
                f"Review and publish-ready brief for {job.get('topic') or job['draft'].get('title') or 'this article'}."
            )
            stats["filled_summaries"] += 1
        if not isinstance(brief.get("outline"), list) or len(brief["outline"]) < 3:
            brief["outline"] = derive_outline(job, job["draft"])
            stats["derived_outlines"] += 1

    changed = json.dumps(job, sort_keys=True) != original
    if changed:
        path.write_text(json.dumps(job, indent=2) + "\n")
    return changed, stats


def main() -> None:
    totals = {"files_changed": 0, "cleaned_markers": 0, "filled_summaries": 0, "derived_outlines": 0}
    for path in sorted(JOBS_DIR.glob("*.json")):
        if path.name.endswith(".example.json"):
            continue
        changed, stats = clean_job(path)
        if changed:
            totals["files_changed"] += 1
        for key, value in stats.items():
            totals[key] += value

    print(json.dumps(totals, indent=2))


if __name__ == "__main__":
    main()
