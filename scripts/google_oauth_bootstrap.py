from __future__ import annotations

import base64
import hashlib
import json
import secrets
import threading
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
KEYS_DIR = REPO_ROOT / "keys"
CLIENT_SECRET_PATH = next(KEYS_DIR.glob("client_secret_*.json"))
TOKEN_PATH = KEYS_DIR / "google_reporting_token.json"
REDIRECT_PORT = 8765
REDIRECT_URI = f"http://127.0.0.1:{REDIRECT_PORT}/callback"
SCOPES = [
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/webmasters.readonly",
]


def load_client() -> dict:
    payload = json.loads(CLIENT_SECRET_PATH.read_text())
    return payload["installed"]


def build_pkce() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).decode("utf-8").rstrip("=")
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("utf-8")).digest())
        .decode("utf-8")
        .rstrip("=")
    )
    return verifier, challenge


class CallbackHandler(BaseHTTPRequestHandler):
    auth_code: str | None = None

    def do_GET(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        code = query.get("code", [None])[0]
        CallbackHandler.auth_code = code

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(
            b"<html><body><h1>Google authorization received.</h1><p>You can close this tab and return to Codex.</p></body></html>"
        )

    def log_message(self, format, *args):  # noqa: A003
        return


def exchange_code(client: dict, code: str, verifier: str) -> dict:
    body = urllib.parse.urlencode(
        {
            "code": code,
            "client_id": client["client_id"],
            "client_secret": client["client_secret"],
            "redirect_uri": REDIRECT_URI,
            "grant_type": "authorization_code",
            "code_verifier": verifier,
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        client["token_uri"],
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    client = load_client()
    verifier, challenge = build_pkce()
    state = secrets.token_urlsafe(24)

    params = {
        "client_id": client["client_id"],
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
    }
    auth_url = f"{client['auth_uri']}?{urllib.parse.urlencode(params)}"

    server = HTTPServer(("127.0.0.1", REDIRECT_PORT), CallbackHandler)
    thread = threading.Thread(target=server.handle_request, daemon=True)
    thread.start()

    print(f"Opening browser for Google consent: {auth_url}")
    webbrowser.open(auth_url)
    thread.join(timeout=300)
    server.server_close()

    if not CallbackHandler.auth_code:
        raise RuntimeError("Did not receive Google authorization code.")

    token_payload = exchange_code(client, CallbackHandler.auth_code, verifier)
    TOKEN_PATH.write_text(json.dumps(token_payload, indent=2) + "\n")
    print(f"Saved Google token to {TOKEN_PATH}")


if __name__ == "__main__":
    main()
