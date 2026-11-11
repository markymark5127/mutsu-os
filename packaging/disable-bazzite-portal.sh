#!/usr/bin/env bash
# Hide Bazzite Portal / yafti so a fresh login only sees Mutsu's wizard.
# Keep bazzite-user-setup and hardware setup. Those are not the portal.
set -euo pipefail

# write_hidden <dest> <src> [extra key=value]: a valid hidden desktop entry
# that keeps the source's name. Reads src fully before writing dest, so the
# two may be the same file.
write_hidden() {
  local dest="$1" src="$2" extra="${3:-}" name
  name="$(grep -m1 '^Name=' "$src" 2>/dev/null | cut -d= -f2- || true)"
  [[ -n "$name" ]] || name="$(basename "$src" .desktop)"
  {
    printf '[Desktop Entry]\nType=Application\nName=%s\nExec=true\n' "$name"
    printf 'NoDisplay=true\nHidden=true\n'
    [[ -z "$extra" ]] || printf '%s\n' "$extra"
  } > "$dest.mutsu-tmp"
  mv -f "$dest.mutsu-tmp" "$dest"
}

hide_desktop() {
  local src="$1"
  local name
  name="$(basename "$src")"
  [[ -f "$src" ]] || return 0
  install -d -m 0755 /etc/xdg/autostart
  # A small, valid entry of its own. (Appending to a copy of the source
  # with `cat src > dest` truncated it when src and dest were the same file,
  # leaving files with no [Desktop Entry] group: "Key file does not start
  # with a group".)
  write_hidden "/etc/xdg/autostart/$name" "$src" 'X-GNOME-Autostart-enabled=false'

  echo "Hid Bazzite first-boot entry: $name"
}

shopt -s nullglob
for f in \
  /etc/xdg/autostart/*bazzite* \
  /etc/xdg/autostart/*yafti* \
  /etc/xdg/autostart/*ublue*firstboot* \
  /etc/xdg/autostart/*firstboot* \
  /usr/share/applications/*yafti* \
  /usr/share/applications/*bazzite-portal*
do
  case "$f" in
    *mutsu*) continue ;;
  esac
  hide_desktop "$f"
done

# The launcher is a user oneshot. Mask it so a later Bazzite update cannot
# re-enable the portal without a Mutsu image rebuild.
for unit in bazzite-yafti-launcher.service yafti.service; do
  if [[ -f "/usr/lib/systemd/user/$unit" ]]; then
    install -d -m 0755 /etc/systemd/user
    ln -sfn /dev/null "/etc/systemd/user/$unit"
    echo "Masked user unit: $unit"
  fi
done

printf 'Bazzite Portal disabled. Mutsu welcome remains the first-boot wizard.\n'

# Hide Bazzite-branded apps from the app grid (portal, updater, etc.).
# Keep the binaries; just stop them appearing as Bazzite-named launchers.
hide_app() {
  local src="$1"
  local name
  name="$(basename "$src")"
  [[ -f "$src" ]] || return 0
  # /usr/local is a symlink on this image and cannot be created during the build.
  # Overwrite the desktop file in /usr/share/applications, which is a real directory.
  local dest="/usr/share/applications/$name"
  install -d -m 0755 /usr/share/applications
  write_hidden "$dest" "$src"
  echo "NoDisplay override for: $name"
}

for f in \
  /usr/share/applications/*bazzite* \
  /usr/share/applications/*buddy* \
  /usr/share/applications/*yafti* \
  /usr/share/applications/system-update.desktop \
  /usr/share/applications/*updater*.desktop \
  /usr/share/applications/Documentation.desktop \
  /usr/share/applications/*landing*.desktop
do
  case "$f" in
    *mutsu*) continue ;;
  esac
  [[ -f "$f" ]] || continue
  hide_app "$f"
done
