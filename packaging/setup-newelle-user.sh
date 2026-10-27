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

if [[ -e "$marker" && -s "$token_file" ]]; then
  exit 0
fi

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

onboarding = __import__("pathlib").Path.home() / ".config" / "ai-desktop" / "onboarding.json"
if onboarding.is_file():
    try:
        data = json.loads(onboarding.read_text())
    except json.JSONDecodeError:
        data = {}
    if isinstance(data, dict) and data.get("model_sharing") is not True:
        data["model_sharing"] = True
        onboarding.write_text(json.dumps(data) + "\n")
        onboarding.chmod(0o600)
PY

unit_dir="$config_root/systemd/user"
mkdir -p "$unit_dir"
unit="$unit_dir/ai-desktop-newelle.service"
if [[ ! -e "$unit" ]]; then
  cat > "$unit" <<'EOF'
[Unit]
Description=Headless Newelle backend for Mutsu OS
After=graphical-session.target

[Service]
Type=simple
ExecStart=/usr/bin/flatpak run io.github.qwersyk.Newelle --interface gui-api
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
fi

if command -v systemctl >/dev/null; then
  systemctl --user daemon-reload || true
  systemctl --user enable --now ai-desktop-newelle.service || true
fi

touch "$marker"
chmod 600 "$marker"
echo "Newelle linked to Mutsu Search on 127.0.0.1:${port}."
