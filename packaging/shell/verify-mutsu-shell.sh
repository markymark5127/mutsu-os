#!/usr/bin/env bash
# Is the installed GNOME Shell Mutsu's build (login waits for extensions)?
set -euo pipefail
rpm -q gnome-shell | grep -q mutsu
for lib in /usr/lib64/gnome-shell/*.so /usr/bin/gnome-shell; do
  if gresource list "$lib" 2>/dev/null | grep -qx /org/gnome/shell/ui/layout.js; then
    gresource extract "$lib" /org/gnome/shell/ui/layout.js | grep -q _mutsuWaitForExtensions
    gresource extract "$lib" /org/gnome/shell/ui/extensionSystem.js | grep -q startupComplete
    echo "Mutsu GNOME Shell: $(rpm -q gnome-shell) ($lib)"
    exit 0
  fi
done
echo "GNOME Shell's JavaScript resources weren't found" >&2
exit 1
