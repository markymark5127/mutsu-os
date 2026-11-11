#!/usr/bin/env bash
# Try this checkout on the running Mutsu OS machine without building an image.
#
#   sudo scripts/try-locally.sh          copy the changes in, then log out and back in
#   sudo scripts/try-locally.sh --undo   remove the login-screen test settings
#
# /usr is read-only on Mutsu OS (bootc), so this makes it writable with
# `bootc usr-overlay`. That overlay is thrown away at the next REBOOT: the
# machine is back to its installed image, nothing lingers. So test by logging
# out and back in (which also shows the login screen), not by rebooting.
#
# Copied in:
#   Mutsu's Shell extensions (mutsu-adaptive, mutsu-branding): the JS and CSS
#   the cursor theme's SVG cursors (what GNOME 51 draws the pointer from)
#   the login screen's cursor/icon/font/clock settings, in
#   /etc/dconf/db/gdm.d/99-mutsu-try-locally (/etc keeps it after a reboot;
#   it's the same as what the image sets, and --undo removes it)
set -euo pipefail
[[ $EUID -eq 0 ]] || exec sudo "$0" "$@"

repo=$(cd "$(dirname "$0")/.." && pwd)
gdm_test=/etc/dconf/db/gdm.d/99-mutsu-try-locally

if [[ "${1:-}" == "--undo" ]]; then
  rm -f "$gdm_test"
  dconf update
  echo "Removed the login-screen test settings. Reboot to drop everything else."
  exit 0
fi

# Writable /usr until the next reboot.
if ! touch /usr/.mutsu-try-locally 2>/dev/null; then
  echo "Making /usr writable until the next reboot (bootc usr-overlay)..."
  bootc usr-overlay
fi
rm -f /usr/.mutsu-try-locally

for ext in mutsu-adaptive@mutsu-os mutsu-branding@mutsu-os; do
  dest=/usr/share/gnome-shell/extensions/$ext
  [[ -d "$dest" ]] || { echo >&2 "not installed: $dest"; exit 1; }
  changed=0
  for file in "$repo/extensions/$ext"/*.js "$repo/extensions/$ext"/*.css; do
    [[ -f "$file" ]] || continue
    if ! cmp -s "$file" "$dest/$(basename "$file")"; then
      install -m0644 "$file" "$dest/"
      echo "  $ext/$(basename "$file")"
      changed=$((changed + 1))
    fi
  done
  echo "$ext: $changed file(s) updated"
done

python3 "$repo/branding/cursors/build-scalable-cursors.py" \
  /usr/share/icons/MutsuJapandi "$repo/branding/cursors/japandi/left_ptr.svg" 3 5 32

inter='Inter'
fc-list : family | tr ',' '\n' | grep -qx 'Inter' || inter='Inter Variable'
cat > "$gdm_test" <<DCONF
[org/gnome/desktop/interface]
cursor-theme='MutsuJapandi'
icon-theme='MutsuJapandi'
font-name='$inter 11'
clock-format='12h'

[org/gnome/desktop/sound]
theme-name='MutsuJapandi'
DCONF
dconf update
echo "Login screen settings written ($gdm_test)."

echo
echo "Done. Log out and back in to load it (don't reboot: that undoes the test)."
