#!/usr/bin/env bash
# Mutsu's change to GNOME Shell, as a resource overlay.
#
#   make-shell-overlay.sh <output dir>
#
# GNOME Shell's JavaScript lives in a resource inside libshell. Rather than
# rebuilding the Shell (its build needs Fedora's mesa headers, which Bazzite
# replaces with its own mesa), take the two files Mutsu changes from the
# Shell this image actually ships, patch them (apply-mutsu-shell.py) and
# leave them in <output dir>/ui. The Shell is started with
#   G_RESOURCE_OVERLAYS=/org/gnome/shell/ui=/usr/share/mutsu-os/shell-overlay/ui
# so GLib serves these two files and everything else from the Shell itself.
# Built per image, so the files always match the Shell next to them.
set -euo pipefail
out="${1:?output dir}"
here="$(cd "$(dirname "$0")" && pwd)"

lib=""
for candidate in /usr/lib64/gnome-shell/*.so /usr/bin/gnome-shell; do
  if gresource list "$candidate" 2>/dev/null | grep -qx /org/gnome/shell/ui/layout.js; then
    lib="$candidate"
    break
  fi
done
[[ -n "$lib" ]] || { echo "make-shell-overlay: GNOME Shell's JavaScript wasn't found" >&2; exit 1; }

work="$(mktemp -d)"
mkdir -p "$work/js/ui" "$out/ui"
for name in layout.js extensionSystem.js; do
  gresource extract "$lib" "/org/gnome/shell/ui/$name" > "$work/js/ui/$name"
done
python3 "$here/apply-mutsu-shell.py" "$work"
cp "$work/js/ui/layout.js" "$work/js/ui/extensionSystem.js" "$out/ui/"
grep -q _mutsuWaitForExtensions "$out/ui/layout.js"
grep -q startupComplete "$out/ui/extensionSystem.js"
echo "make-shell-overlay: $(rpm -q gnome-shell 2>/dev/null || echo gnome-shell) from $lib -> $out/ui"
