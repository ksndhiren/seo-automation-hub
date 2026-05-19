from __future__ import annotations

import json
import urllib.error
import urllib.request

from _env import load_dotenv, require_env


OPENAI_URL = "https://api.openai.com/v1/responses"


def main() -> None:
    load_dotenv()
    api_key = require_env("OPENAI_API_KEY")

    payload = json.dumps(
        {
            "model": "gpt-5.4-mini",
            "input": "Reply with exactly the word OK.",
            "max_output_tokens": 16,
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        OPENAI_URL,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
            response_id = body.get("id", "unknown")
            print("OPENAI_OK")
            print(f"response_id={response_id}")
            print("note=Key is valid and billing/quota allowed this test request.")
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(body_text)
        except json.JSONDecodeError:
            body = {"raw": body_text}

        error = body.get("error", {})
        message = error.get("message", body.get("raw", "Unknown error"))
        code = error.get("code", "")
        err_type = error.get("type", "")

        print(f"OPENAI_HTTP_ERROR status={exc.code}")
        print(f"type={err_type or 'unknown'}")
        print(f"code={code or 'unknown'}")
        print(f"message={message}")

        if exc.code == 401:
            print("result=Authentication failed. Check the API key.")
        elif exc.code == 429:
            print(
                "result=Authentication likely worked, but billing/quota/rate limit blocked the request."
            )
        else:
            print("result=Request reached OpenAI but did not succeed.")
    except urllib.error.URLError as exc:
        print("OPENAI_NETWORK_ERROR")
        print(f"message={exc.reason}")


if __name__ == "__main__":
    main()
