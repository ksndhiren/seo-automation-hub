from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

from _env import require_env


def build_image_plan_for_job(job: dict) -> dict:
    draft = job.get("draft") or {}
    sections = draft.get("sections") or []
    topic = job.get("topic", "blog article")
    primary_keyword = job.get("primary_keyword", "")
    site_id = job.get("site_id", "")
    selected_images = (job.get("image_plan") or {}).get("selected_images", [])

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
            "selected_images": selected_images,
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
        "selected_images": selected_images,
    }


def auto_pick_images_for_job(job: dict) -> int:
    plan = build_image_plan_for_job(job)
    items = plan.get("items") or []
    if not items:
        job["image_plan"] = plan
        return 0

    selections = list(plan.get("selected_images") or [])
    changed = 0
    for index, item in enumerate(items):
        if index < len(selections) and selections[index]:
            continue
        photos = search_pexels(item.get("query", ""), per_page=6)
        if not photos:
            continue
        best = choose_best_pexels_photo(job, item, photos)
        while len(selections) <= index:
            selections.append(None)
        selections[index] = best
        changed += 1

    plan["selected_images"] = selections
    job["image_plan"] = plan

    if selections:
        hero = selections[0]
        if hero and job.get("draft"):
            job["draft"]["heroImage"] = hero.get("large") or hero.get("thumb") or job["draft"].get("heroImage", "/hero.webp")
            job["draft"]["heroImageAlt"] = hero.get("alt") or job["draft"].get("title") or ""

    return changed


def search_pexels(query: str, per_page: int = 6) -> list[dict]:
    query = str(query or "").strip()
    if not query:
        return []

    api_key = require_env("PEXELS_API_KEY")
    api_url = "https://api.pexels.com/v1/search?" + urllib.parse.urlencode(
        {
            "query": query,
            "per_page": min(8, max(1, int(per_page))),
            "orientation": "landscape",
        }
    )

    request = urllib.request.Request(
        api_url,
        headers={"Authorization": api_key},
        method="GET",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError):
        return []

    return [
        {
            "id": photo.get("id"),
            "alt": photo.get("alt") or "",
            "photographer": photo.get("photographer") or "",
            "thumb": (photo.get("src") or {}).get("medium")
            or (photo.get("src") or {}).get("small")
            or "",
            "large": (photo.get("src") or {}).get("large2x")
            or (photo.get("src") or {}).get("large")
            or (photo.get("src") or {}).get("medium")
            or "",
            "original": (photo.get("src") or {}).get("original")
            or (photo.get("src") or {}).get("large2x")
            or "",
            "width": photo.get("width"),
            "height": photo.get("height"),
            "pexels_url": photo.get("url") or "",
        }
        for photo in (payload.get("photos") or [])
    ]


def choose_best_pexels_photo(job: dict, item: dict, photos: list[dict]) -> dict | None:
    if not photos:
        return None

    keyword_terms = " ".join(
        str(value)
        for value in [
            job.get("primary_keyword"),
            item.get("placement"),
            (job.get("seo_strategy") or {}).get("category_name"),
            "crane",
            "equipment",
            "industrial",
        ]
        if value
    ).lower().split()

    ranked = sorted(
        (
            {
                "photo": photo,
                "score": score_pexels_photo(photo, keyword_terms, job.get("site_id", "")),
            }
            for photo in photos
        ),
        key=lambda item_: item_["score"],
        reverse=True,
    )
    return ranked[0]["photo"] if ranked else photos[0]


def score_pexels_photo(photo: dict, keyword_terms: list[str], site_id: str) -> int:
    text = f"{photo.get('alt', '')} {photo.get('photographer', '')}".lower()
    score = 0

    for term in keyword_terms:
        if term and term in text:
            score += 2

    if site_id == "jma-golfcarts":
        if "golf" in text:
            score += 6
        if "cart" in text:
            score += 6
        if "vehicle" in text:
            score += 1
    else:
        if "crane" in text:
            score += 6
        if "construction" in text:
            score += 2
        if "industrial" in text:
            score += 2

    if photo.get("width") and photo.get("height") and photo["width"] > photo["height"]:
        score += 1

    return score
