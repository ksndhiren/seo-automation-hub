from __future__ import annotations

import subprocess
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
CHECKS = [
    ("OpenAI", "check_openai.py"),
    ("Copyscape", "check_copyscape.py"),
    ("Pexels", "check_pexels.py"),
    ("NeuronWriter", "check_neuronwriter.py"),
]


def main() -> None:
    overall_ok = True

    for label, filename in CHECKS:
        script_path = SCRIPT_DIR / filename
        print(f"\n=== {label} ===")
        result = subprocess.run(
            [sys.executable, str(script_path)],
            cwd=str(SCRIPT_DIR.parent),
            capture_output=True,
            text=True,
        )

        stdout = result.stdout.strip()
        stderr = result.stderr.strip()

        if stdout:
            print(stdout)
        if stderr:
            print(stderr)

        if result.returncode != 0:
            overall_ok = False
            print(f"summary={label} script exited with non-zero status {result.returncode}")

    print("\n=== Summary ===")
    if overall_ok:
        print("All checks executed. Review each section above for auth, balance, and quota details.")
    else:
        print("One or more checks failed to execute cleanly. Review the section outputs above.")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
