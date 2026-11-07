#!/bin/bash
# Real-GNOME check for the bundled Shell extensions. Runs inside the published
# Mutsu OS image (so it uses that image's exact GNOME Shell / Mutter), overlays
# the extensions from this checkout, starts a headless Wayland Shell and drives
# tablet mode through it. Usage (from the repo root on the CI runner):
#   podman run --rm -v "$PWD:/src:ro" -v "$PWD/out:/out" IMAGE \
#       bash /src/tests/gnome/runtime-check.sh /src /out
set -uo pipefail
SRC=${1:-/src}
OUT=${2:-/out}
mkdir -p "$OUT"

export HOME=/tmp/mutsu-home
export XDG_RUNTIME_DIR=/tmp/mutsu-xdg
export XDG_CONFIG_HOME=$HOME/.config XDG_DATA_HOME=$HOME/.local/share XDG_CACHE_HOME=$HOME/.cache
export XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=GNOME
export NO_AT_BRIDGE=1 GSK_RENDERER=cairo LIBGL_ALWAYS_SOFTWARE=1
mkdir -p "$HOME" "$XDG_DATA_HOME/gnome-shell/extensions"
mkdir -p -m 0700 "$XDG_RUNTIME_DIR"

{
    echo "gnome-shell: $(gnome-shell --version 2>&1)"
    echo "mutter: $(rpm -q mutter 2>/dev/null)"
    echo "gjs: $(rpm -q gjs 2>/dev/null)"
} | tee "$OUT/versions.txt"

# Test this commit's extensions, not the ones baked into the image. A user
# copy of an extension takes precedence over the system one with the same UUID.
cp -r "$SRC"/extensions/* "$XDG_DATA_HOME/gnome-shell/extensions/"
for schemas in "$XDG_DATA_HOME"/gnome-shell/extensions/*/schemas; do
    glib-compile-schemas "$schemas"
done

# The Shell needs a system bus at startup (time limits, login manager).
mkdir -p /run/dbus
if [ ! -S /run/dbus/system_bus_socket ]; then
    dbus-daemon --system --fork --nopidfile 2>&1 || dbus-daemon --system --fork 2>&1 || true
fi

exec dbus-run-session -- bash "$SRC/tests/gnome/session.sh" "$SRC" "$OUT"
