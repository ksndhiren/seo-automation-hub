from __future__ import annotations

import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
SITES_DIR = REPO_ROOT / "config" / "sites"
KEYS_DIR = REPO_ROOT / "keys"
CLIENT_SECRET_PATH = next(KEYS_DIR.glob("client_secret_*.json"))
TOKEN_PATH = KEYS_DIR / "google_reporting_token.json"
OUTPUT_PATH = REPO_ROOT / "apps" / "dashboard" / "data" / "performance-state.json"


def load_client() -> dict:
    return json.loads(CLIENT_SECRET_PATH.read_text())["installed"]


def load_sites() -> list[dict]:
    return [
        json.loads(path.read_text())
        for path in sorted(SITES_DIR.glob("*.json"))
        if path.is_file() and not path.name.endswith(".example.json")
    ]


def refresh_access_token(client: dict, refresh_token: str) -> str:
    body = urllib.parse.urlencode(
        {
            "client_id": client["client_id"],
            "client_secret": client["client_secret"],
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        client["token_uri"],
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload["access_token"]


def ga4_run_report(property_id: str, access_token: str, body: dict) -> dict:
    request = urllib.request.Request(
        f"https://analyticsdata.googleapis.com/v1beta/properties/{property_id}:runReport",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def parse_rows(report: dict) -> list[dict]:
    rows = []
    dimension_headers = [item["name"] for item in report.get("dimensionHeaders", [])]
    metric_headers = [item["name"] for item in report.get("metricHeaders", [])]

    for row in report.get("rows", []) or []:
        item: dict[str, str] = {}
        for index, header in enumerate(dimension_headers):
            item[header] = row["dimensionValues"][index]["value"]
        for index, header in enumerate(metric_headers):
            item[header] = row["metricValues"][index]["value"]
        rows.append(item)
    return rows


def site_overview(property_id: str, access_token: str) -> dict:
    report = ga4_run_report(
        property_id,
        access_token,
        {
            "dateRanges": [{"startDate": "28daysAgo", "endDate": "yesterday"}],
            "metrics": [
                {"name": "sessions"},
                {"name": "activeUsers"},
                {"name": "screenPageViews"},
                {"name": "engagedSessions"},
                {"name": "engagementRate"},
                {"name": "averageSessionDuration"},
            ],
        },
    )
    names = [item["name"] for item in report.get("metricHeaders", [])]
    totals = report.get("totals") or []
    values = totals[0].get("metricValues", []) if totals else []

    if values and len(values) == len(names):
        return {name: values[index]["value"] for index, name in enumerate(names)}

    if report.get("rows"):
        first_row_values = report["rows"][0].get("metricValues", [])
        if len(first_row_values) == len(names):
            return {
                name: first_row_values[index]["value"]
                for index, name in enumerate(names)
            }

    return {name: "0" for name in names}


def top_blog_pages(property_id: str, access_token: str) -> list[dict]:
    report = ga4_run_report(
        property_id,
        access_token,
        {
            "dateRanges": [{"startDate": "28daysAgo", "endDate": "yesterday"}],
            "dimensions": [{"name": "pagePath"}],
            "metrics": [
                {"name": "screenPageViews"},
                {"name": "sessions"},
                {"name": "activeUsers"},
                {"name": "engagementRate"},
            ],
            "dimensionFilter": {
                "filter": {
                    "fieldName": "pagePath",
                    "stringFilter": {"matchType": "BEGINS_WITH", "value": "/blog"},
                }
            },
            "limit": 10,
            "orderBys": [
                {
                    "metric": {"metricName": "screenPageViews"},
                    "desc": True,
                }
            ],
        },
    )
    return parse_rows(report)


def event_breakdown(property_id: str, access_token: str) -> list[dict]:
    report = ga4_run_report(
        property_id,
        access_token,
        {
            "dateRanges": [{"startDate": "28daysAgo", "endDate": "yesterday"}],
            "dimensions": [{"name": "eventName"}],
            "metrics": [{"name": "eventCount"}],
            "dimensionFilter": {
                "orGroup": {
                    "expressions": [
                        {
                            "filter": {
                                "fieldName": "eventName",
                                "stringFilter": {"matchType": "EXACT", "value": "cta_click"},
                            }
                        },
                        {
                            "filter": {
                                "fieldName": "eventName",
                                "stringFilter": {"matchType": "EXACT", "value": "registration_start"},
                            }
                        },
                        {
                            "filter": {
                                "fieldName": "eventName",
                                "stringFilter": {"matchType": "EXACT", "value": "registration_complete"},
                            }
                        },
                        {
                            "filter": {
                                "fieldName": "eventName",
                                "stringFilter": {"matchType": "EXACT", "value": "contact_click"},
                            }
                        },
                    ]
                }
            },
        },
    )
    return parse_rows(report)


def main() -> None:
    client = load_client()
    token_payload = json.loads(TOKEN_PATH.read_text())
    refresh_token = token_payload.get("refresh_token")
    if not refresh_token:
        raise RuntimeError("google_reporting_token.json does not include a refresh_token.")

    access_token = refresh_access_token(client, refresh_token)
    sites = []
    for site in load_sites():
        property_id = site.get("ga4_property_id")
        if not property_id:
            continue
        sites.append(
            {
                "site_id": site["site_id"],
                "site_name": site["site_name"],
                "property_id": property_id,
                "overview": site_overview(property_id, access_token),
                "top_blog_pages": top_blog_pages(property_id, access_token),
                "events": event_breakdown(property_id, access_token),
            }
        )

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "ga4",
        "sites": sites,
    }
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote GA4 performance snapshot to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
