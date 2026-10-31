#!/usr/bin/env bash
# on|off. Prefer Toshy. Fall back to keyd if Toshy is not seeded yet.
set -euo pipefail
action="${1:-}"
[[ "$action" == "on" || "$action" == "off" ]] || { echo "usage: set-mac-shortcuts.sh on|off" >&2; exit 2; }
enable="$HOME/.config/toshy/scripts/bin/toshy-services-enable"
disable="$HOME/.config/toshy/scripts/bin/toshy-services-disable"
if [[ -x "$enable" && -x "$disable" ]]; then
  if [[ "$action" == "on" ]]; then
    "$enable"
  else
    "$disable"
  fi
  exit 0
fi
if command -v systemctl >/dev/null && systemctl cat keyd >/dev/null 2>&1; then
  verb=start
  [[ "$action" == "off" ]] && verb=stop
  systemctl "$verb" keyd || pkexec systemctl "$verb" keyd
  exit 0
fi
echo "Mac shortcut mapper is not installed yet." >&2
exit 1
