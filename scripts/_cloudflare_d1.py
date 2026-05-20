from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from pathlib import Path

from _env import require_env


REPO_ROOT = Path(__file__).resolve().parent.parent
WRANGLER_FILE = REPO_ROOT / "apps" / "dashboard" / "wrangler.toml"


def get_database_id() -> str:
    text = WRANGLER_FILE.read_text()
    match = re.search(r'^database_id\s*=\s*"([^"]+)"', text, flags=re.MULTILINE)
    if not match:
        raise RuntimeError(f"Could not find database_id in {WRANGLER_FILE}")
    return match.group(1)


def d1_query(sql: str, params: list | None = None) -> list[dict]:
    account_id = require_env("CLOUDFLARE_ACCOUNT_ID")
    api_token = require_env("CLOUDFLARE_API_TOKEN")
    database_id = get_database_id()

    body = json.dumps(
        {
            "sql": sql,
            "params": params or [],
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query",
        data=body,
        headers={
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(
            f"Cloudflare D1 query failed with HTTP {exc.code}: {details}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Cloudflare D1 request failed: {exc}") from exc

    if not payload.get("success"):
        errors = payload.get("errors") or []
        raise RuntimeError(f"Cloudflare D1 query failed: {errors}")

    result_sets = payload.get("result") or []
    if not result_sets:
        return []

    first = result_sets[0]
    return first.get("results") or []
