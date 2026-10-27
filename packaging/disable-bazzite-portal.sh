#!/usr/bin/env bash
# Hide Bazzite Portal / yafti so a fresh login only sees Mutsu's wizard.
# Keep bazzite-user-setup and hardware setup. Those are not the portal.
set -euo pipefail

hide_desktop() {
  local src="$1"
  local name
  name="$(basename "$src")"
  [[ -f "$src" ]] || return 0
  install -d -m 0755 /etc/xdg/autostart
  {
    cat "$src"
    printf '\nHidden=true\nX-GNOME-Autostart-enabled=false\n'
  } > "/etc/xdg/autostart/$name"
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
