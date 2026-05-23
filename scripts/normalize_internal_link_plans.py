from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
SITES_DIR = REPO_ROOT / "config" / "sites"
JOBS_DIR = REPO_ROOT / "data" / "jobs"


def load_sites() -> dict[str, dict]:
    sites: dict[str, dict] = {}
    for path in sorted(SITES_DIR.glob("*.json")):
        if path.name.endswith(".example.json"):
            continue
        data = json.loads(path.read_text())
        sites[data["site_id"]] = data
    return sites


def main() -> None:
    sites = load_sites()
    updated = 0

    for path in sorted(JOBS_DIR.glob("*.json")):
        job = json.loads(path.read_text())
        site = sites.get(job.get("site_id"))
        if not site:
            continue

        preferred = site.get("internal_link_rules", {}).get("preferred_destinations", [])
        if not preferred:
            continue

        strategy = dict(job.get("seo_strategy") or {})
        if strategy.get("recommended_internal_link_types") == preferred:
            continue

        strategy["recommended_internal_link_types"] = preferred
        job["seo_strategy"] = strategy
        path.write_text(json.dumps(job, indent=2) + "\n")
        updated += 1

    print(f"Updated internal link plans for {updated} jobs")


if __name__ == "__main__":
    main()
