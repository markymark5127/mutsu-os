#!/usr/bin/env bash
# Automatic per-user connection; app, runtime, SDKs and model ship in the OS.
set -euo pipefail
config_root="${XDG_CONFIG_HOME:-$HOME/.config}"
config_dir="$config_root/ai-desktop"
token_file="$config_dir/newelle-token"
marker="$config_dir/newelle-linked"
app=io.github.qwersyk.Newelle
port=8081
if ! command -v flatpak >/dev/null || ! flatpak info "$app" >/dev/null 2>&1; then
  echo >&2 'Bundled Newelle is not installed. Check mutsu-newelle-preinstall.service.'
  exit 1
fi
umask 077
mkdir -p -m700 "$config_dir"
chmod 700 "$config_dir"
# Serialize the automatic session service and the Portal's repair button.
exec 9>"$config_dir/newelle-setup.lock"
flock -w 120 9
rm -f "$marker"
if [[ ! -s "$token_file" ]]; then
  token="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
  tmp="$(mktemp "$config_dir/.newelle-token.XXXXXXXX")"
  printf '%s\n' "$token" > "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$token_file"
fi
bundle=/usr/share/mutsu-os/newelle-gui-api
local_bundle="$config_dir/newelle-offline-bundle"
test -s "$bundle/runtime.json"
mkdir -p "$local_bundle"
cp -a "$bundle/runtime.json" "$bundle/packages" "$local_bundle/"
cp /usr/share/mutsu-os/local-ai/bundled-model.json "$config_dir/bundled-model.json"
# Confirm the packaged model is listed before selecting it. This performs no
# inference and never sends a user's question or device information anywhere.
python3 /usr/libexec/mutsu-os/wait-local-model.py
# Gio.Settings writes native values directly; do not parse/quote GVariant
# JSON strings through separate gsettings processes during session startup.
flatpak run --filesystem="$config_dir:ro" --command=python3 "$app" - "$config_dir" \
  < /usr/libexec/mutsu-os/configure-newelle.py

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
