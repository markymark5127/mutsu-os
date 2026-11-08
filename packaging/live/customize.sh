#!/usr/bin/env bash
# Runs as root inside the Mutsu image while the live USB is built (Tacklebox
# live_customize). Tacklebox's own baseline runs first: live user, automatic
# login, no sleep, and the apps declared in
# /usr/share/flatpak/preinstall.d (Firefox and the rest of the default set),
# which the installer later copies to the installed disk.
set -euo pipefail

# Fail the build rather than ship a live USB without a browser.
flatpak info --system org.mozilla.firefox >/dev/null

# GNOME Tour would pop up over the desktop in every live session.
rm -f /etc/xdg/autostart/org.gnome.Tour.desktop
