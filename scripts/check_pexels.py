from __future__ import annotations

import json
import urllib.error
import urllib.request

from _env import load_dotenv, require_env


PEXELS_URL = "https://api.pexels.com/v1/curated?per_page=1&page=1"


def main() -> None:
    load_dotenv()
    api_key = require_env("PEXELS_API_KEY")

    request = urllib.request.Request(
        PEXELS_URL,
        method="GET",
        headers={"Authorization": api_key},
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
            photo_count = len(body.get("photos", []))
            total = body.get("total_results", "unknown")
            print("PEXELS_OK")
            print(f"photos_returned={photo_count}")
            print(f"total_results={total}")
    except urllib.error.HTTPError as exc:
        print(f"PEXELS_HTTP_ERROR status={exc.code}")
        print(exc.read().decode("utf-8", errors="replace"))
    except urllib.error.URLError as exc:
        print("PEXELS_NETWORK_ERROR")
        print(f"message={exc.reason}")


if __name__ == "__main__":
    main()
