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

# Whichever file of the gnome-shell package carries the JavaScript resource
# (an ELF .gresource section, or a .gresource file).
lib=""
while read -r candidate; do
  [[ -f "$candidate" && ! -L "$candidate" ]] || continue
  case "$candidate" in *.so*|*.gresource|*/bin/*|*/libexec/*) ;; *) continue ;; esac
  # (Read the whole list first: grep -q stopping early would SIGPIPE
  # gresource, and pipefail would call that a miss.)
  listing="$(gresource list "$candidate" 2>/dev/null || true)"
  if grep -qx /org/gnome/shell/ui/layout.js <<<"$listing"; then
    lib="$candidate"
    break
  fi
done < <(rpm -ql gnome-shell 2>/dev/null; ls /usr/lib64/gnome-shell/* /usr/bin/gnome-shell 2>/dev/null)
if [[ -z "$lib" ]]; then
  echo "make-shell-overlay: GNOME Shell's JavaScript wasn't found. Resources seen:" >&2
  for f in $(rpm -ql gnome-shell | grep -E '\.so|\.gresource|/bin/|/libexec/'); do
    [[ -f "$f" ]] || continue
    echo "  $f: $(gresource list "$f" 2>&1 | head -3 | tr '\n' ' ')" >&2 || true
  done
  exit 1
fi

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
