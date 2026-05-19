from __future__ import annotations

import json
import urllib.error
import urllib.request

from _env import load_dotenv, require_env


NEURONWRITER_URL = "https://app.neuronwriter.com/neuron-api/0.5/writer/list-projects"


def main() -> None:
    load_dotenv()
    api_key = require_env("NEURONWRITER_API_KEY")

    request = urllib.request.Request(
        NEURONWRITER_URL,
        data=b"{}",
        method="POST",
        headers={
            "X-API-KEY": api_key,
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
            if isinstance(body, dict) and body.get("error"):
                print("NEURONWRITER_API_ERROR")
                print(f"message={body['error']}")
                return

            project_count = len(body) if isinstance(body, list) else 0
            print("NEURONWRITER_OK")
            print(f"projects_found={project_count}")
            if project_count:
                sample_names = [item.get("name", "unknown") for item in body[:3]]
                print(f"sample_projects={', '.join(sample_names)}")
    except urllib.error.HTTPError as exc:
        print(f"NEURONWRITER_HTTP_ERROR status={exc.code}")
        print(exc.read().decode("utf-8", errors="replace"))
    except urllib.error.URLError as exc:
        print("NEURONWRITER_NETWORK_ERROR")
        print(f"message={exc.reason}")


if __name__ == "__main__":
    main()
