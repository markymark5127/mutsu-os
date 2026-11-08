#!/usr/bin/env bash
# on|off. Mac-style shortcuts come from keyd, a system service with the
# Mutsu map baked into the image (/etc/keyd/default.conf). "on" enables it
# so it survives restarts; "off" disables it. A polkit rule lets local
# administrators do this without a password prompt.
#
# (Toshy used to be preferred, but its per-user installer needs the network
# and package installs, which an image-based system can't do at login, so it
# usually never finished and Mac shortcuts silently did nothing.)
set -euo pipefail
action="${1:-}"
[[ "$action" == "on" || "$action" == "off" ]] || { echo "usage: set-mac-shortcuts.sh on|off" >&2; exit 2; }
if ! command -v systemctl >/dev/null || ! systemctl cat keyd >/dev/null 2>&1; then
  echo "Mac shortcut mapper (keyd) is not installed." >&2
  exit 1
fi
if [[ "$action" == "on" ]]; then
  args=(enable --now keyd)
else
  args=(disable --now keyd)
fi
systemctl "${args[@]}" 2>/dev/null || pkexec systemctl "${args[@]}"
# A Toshy left running from an older setup would remap on top of keyd.
if [[ -x "$HOME/.config/toshy/scripts/bin/toshy-services-disable" ]]; then
  "$HOME/.config/toshy/scripts/bin/toshy-services-disable" >/dev/null 2>&1 || true
fi
