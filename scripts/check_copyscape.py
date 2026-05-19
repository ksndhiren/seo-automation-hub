from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

from _env import load_dotenv, require_env


COPYSCAPE_URL = "https://www.copyscape.com/api/"


def main() -> None:
    load_dotenv()
    username = require_env("COPYSCAPE_USERNAME")
    api_key = require_env("COPYSCAPE_API_KEY")

    params = urllib.parse.urlencode(
        {
            "u": username,
            "k": api_key,
            "o": "balance",
            "f": "json",
        }
    )
    url = f"{COPYSCAPE_URL}?{params}"

    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
            if "error" in body:
                print("COPYSCAPE_API_ERROR")
                print(f"message={body['error']}")
                return

            value = body.get("value", "unknown")
            today = body.get("today", "unknown")
            print("COPYSCAPE_OK")
            print(f"balance_usd={value}")
            print(f"remaining_searches_today={today}")
        if str(value) in {"0", "0.0", "0.00"}:
            print("note=Credentials work, but no credits are currently available.")
    except urllib.error.HTTPError as exc:
        print(f"COPYSCAPE_HTTP_ERROR status={exc.code}")
        print(exc.read().decode("utf-8", errors="replace"))
    except urllib.error.URLError as exc:
        print("COPYSCAPE_NETWORK_ERROR")
        print(f"message={exc.reason}")


if __name__ == "__main__":
    main()
