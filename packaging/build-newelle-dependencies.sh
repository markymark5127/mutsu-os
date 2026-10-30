#!/usr/bin/env bash
# Build HOST only: resolve dependencies using the staged Newelle runtime.
set -euo pipefail
app=io.github.qwersyk.Newelle
bundle="${1:?Pass the host output directory for the offline API bundle}"
staging="$(mktemp -d /var/tmp/mutsu-newelle-deps.XXXXXXXX)"
trap 'rm -rf -- "$staging"' EXIT

flatpak run --user --filesystem="$staging:rw" --command=python3 "$app" - "$staging" <<'PY'
import importlib.util
import json
from pathlib import Path
import platform
import os
import subprocess
import sys
from urllib.request import urlopen

root = Path(sys.argv[1])
target = root / "packages"
target.mkdir()
# pip is a build tool only. The installed OS never needs it for this bundle.
if importlib.util.find_spec("pip") is None:
    with urlopen("https://bootstrap.pypa.io/get-pip.py", timeout=60) as response:
        bootstrap = response.read()
    tooling = root / "build-tools"
    subprocess.run([sys.executable, "-", "--target", str(tooling)], input=bootstrap, check=True)
    os.environ["PYTHONPATH"] = str(tooling) + os.pathsep + os.environ.get("PYTHONPATH", "")
subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
                "--no-cache-dir", "--only-binary=:all:", "--target", str(target),
                "fastapi", "uvicorn", "python-multipart", "openai", "ollama"], check=True)
sys.path.insert(0, str(target))
import fastapi
import uvicorn
import multipart
import openai
import ollama
metadata = {"python": list(sys.version_info[:2]), "machine": platform.machine()}
(root / "runtime.json").write_text(json.dumps(metadata), encoding="utf-8")
PY

install -d -m0755 "$bundle"
cp -a "$staging/packages" "$staging/runtime.json" "$bundle/"
chmod -R a+rX "$bundle"
test -s "$bundle/runtime.json"
