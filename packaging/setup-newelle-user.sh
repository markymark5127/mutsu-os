#!/usr/bin/env bash
# First login: pair Mutsu Search with headless Newelle using one generated token,
# then point Newelle at a local model if one is already on the machine.
set -euo pipefail

config_root="${XDG_CONFIG_HOME:-$HOME/.config}"
config_dir="$config_root/ai-desktop"
token_file="$config_dir/newelle-token"
marker="$config_dir/newelle-linked"
app=io.github.qwersyk.Newelle
port=8081

# A previous pairing marker is not proof that the API is still running.
# Reuse the token, but allow the Portal pairing button to repair startup.

if ! command -v flatpak >/dev/null; then
  exit 0
fi
if ! flatpak info "$app" >/dev/null 2>&1; then
  echo "Newelle is not installed yet; will retry next login." >&2
  exit 0
fi

umask 077
mkdir -p -m 700 "$config_dir"
chmod 700 "$config_dir"

# Flatpak cannot directly mount a host /usr subtree over its own runtime.
# Stage the immutable bundle in our private config directory, then grant
# this one setup process read-only access to that exact directory.
bundle=/usr/share/mutsu-os/newelle-gui-api
local_bundle="$config_dir/newelle-offline-bundle"
if [[ ! -s "$bundle/runtime.json" || ! -d "$bundle/packages" ]]; then
  echo >&2 "The offline Newelle dependency bundle is missing from this image."
  exit 1
fi
mkdir -p "$local_bundle"
cp -a "$bundle/runtime.json" "$bundle/packages" "$local_bundle/"
echo "Preparing bundled Newelle GUI API dependencies…"
if ! flatpak run --filesystem="$local_bundle:ro" --command=python3 "$app" - "$local_bundle" <<'NEWELLE_DEPS'
import importlib
import json
from pathlib import Path
import platform
import shutil
import sys


def prepare_dependencies(bundle, target):
    metadata = json.loads((bundle / "runtime.json").read_text(encoding="utf-8"))
    if metadata.get("python") != list(sys.version_info[:2]) or metadata.get("machine") != platform.machine():
        raise RuntimeError("Newelle runtime changed; a matching Mutsu dependency bundle is required")
    # Copy into the same directory used by Newelle's Interfaces installer.
    shutil.copytree(bundle / "packages", target, dirs_exist_ok=True)
    sys.path.insert(0, str(target))
    importlib.invalidate_caches()
    for name in ("fastapi", "uvicorn", "multipart"):
        importlib.import_module(name)


if __name__ == "__main__":
    from gi.repository import GLib
    prepare_dependencies(Path(sys.argv[1]), Path(GLib.get_user_config_dir()) / "pip")
    print("Newelle GUI API dependencies are ready (offline).")
NEWELLE_DEPS
then
  echo >&2 "Bundled Newelle dependencies could not be prepared; pairing is incomplete."
  exit 1
fi

if [[ ! -s "$token_file" ]]; then
  token="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(24))
PY
)"
  tmp="$(mktemp "$config_dir/.newelle-token.XXXXXXXX")"
  printf '%s\n' "$token" > "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$token_file"
else
  token="$(tr -d '\r\n' < "$token_file")"
fi

python3 - "$token" "$port" <<'PY'
import json, subprocess, sys
token, port = sys.argv[1], int(sys.argv[2])
schema = "io.github.qwersyk.Newelle"

def gsettings(args):
    return subprocess.run(
        ["flatpak", "run", "--command=gsettings", schema, *args],
        check=False, capture_output=True, text=True,
    )

def get_json(key):
    result = gsettings(["get", schema, key])
    if result.returncode != 0:
        return {}
    raw = result.stdout.strip()
    if raw.startswith("'"):
        raw = raw[1:-1]
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}

def set_json(key, value):
    payload = json.dumps(value, separators=(",", ":"))
    result = gsettings(["set", schema, key, payload])
    if result.returncode != 0:
        raise SystemExit(result.stderr.strip() or f"could not set {key}")

interfaces = get_json("interfaces-settings")
gui = interfaces.get("gui-api") if isinstance(interfaces.get("gui-api"), dict) else {}
gui.update({"api_key": token, "host": "127.0.0.1", "port": port})
interfaces["gui-api"] = gui
set_json("interfaces-settings", interfaces)

# Prefer a local model already on the machine. Do not download one here.
ollama = subprocess.run(
    ["curl", "-fsS", "--max-time", "2", "http://127.0.0.1:11434/api/tags"],
    check=False, capture_output=True, text=True,
)
if ollama.returncode == 0:
    try:
        names = [item.get("name") for item in json.loads(ollama.stdout).get("models", []) if item.get("name")]
    except json.JSONDecodeError:
        names = []
    if names:
        llm = get_json("llm-settings")
        ollama_settings = llm.get("ollama") if isinstance(llm.get("ollama"), dict) else {}
        ollama_settings.update({"endpoint": "http://127.0.0.1:11434", "model": names[0]})
        llm["ollama"] = ollama_settings
        set_json("llm-settings", llm)
        gsettings(["set", schema, "language-model", "ollama"])

# model_sharing is a user choice; do not force it.
PY

# The unit ships in the image. First login only enables it after the token
# is written, so Newelle does not start before it can authenticate.
started=0
if command -v systemctl >/dev/null; then
  systemctl --user daemon-reload || true
  if systemctl --user enable ai-desktop-newelle.service &&
     systemctl --user restart ai-desktop-newelle.service; then
    started=1
  fi
fi

if [[ "$started" -eq 1 ]]; then
  # Type=simple only confirms process launch, not API readiness. Probe the
  # authenticated model listing without sending a prompt to any AI provider.
  if ! python3 - "$token_file" "$port" <<'PY'
import json
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener


def wait_for_api(token_file, port, attempts=20):
    token = Path(token_file).read_text(encoding="utf-8").strip()
    request = Request(f"http://127.0.0.1:{int(port)}/v1/models",
                      headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
    opener = build_opener(ProxyHandler({}))
    for attempt in range(attempts):
        try:
            with opener.open(request, timeout=2) as response:
                data = json.loads(response.read(1000000))
            if not isinstance(data, dict) or not isinstance(data.get("data"), list):
                raise ValueError("incompatible model-list response")
            return True
        except HTTPError as error:
            if error.code in (401, 403):
                print("Newelle started but rejected the pairing token.", file=sys.stderr)
                return False
        except (URLError, TimeoutError, OSError, ValueError):
            pass
        if attempt + 1 < attempts:
            time.sleep(1)
    print("Newelle did not expose its local model API. Check: "
          "journalctl --user -u ai-desktop-newelle.service -b -n 60 --no-pager",
          file=sys.stderr)
    return False


if __name__ == "__main__":
    sys.exit(0 if wait_for_api(sys.argv[1], sys.argv[2]) else 1)
PY
  then
    rm -f "$marker"
    echo >&2 "Pairing is not complete; the Newelle API is not ready."
    exit 1
  fi
  touch "$marker"
  chmod 600 "$marker"
  echo "Newelle linked to Mutsu Search on 127.0.0.1:${port}."
else
  echo >&2 "Newelle service did not start; marker not written. Will retry next login."
  exit 1
fi
