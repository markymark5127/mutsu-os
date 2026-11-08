#!/bin/bash
# Inside dbus-run-session: enable every bundled extension, start a headless
# GNOME Shell and hand over to the driver.
set -uo pipefail
SRC=$1
OUT=$2
EXT_DIR=$XDG_DATA_HOME/gnome-shell/extensions

uuids=$(python3 - "$EXT_DIR" <<'EOF'
import os, sys
names = sorted(n for n in os.listdir(sys.argv[1]) if os.path.isfile(os.path.join(sys.argv[1], n, "metadata.json")))
print("[" + ", ".join(f"'{n}'" for n in names) + "]")
EOF
)
# This commit's Mutsu defaults (the image compiles the same files into its
# system dconf database), so the check matches what the next image ships.
for defaults in "$SRC"/packaging/[0-9]*-mutsu-*.dconf; do
    grep -v '^#' "$defaults" | dconf load / || echo "could not load $defaults"
done
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "$uuids"
gsettings set org.gnome.shell disable-extension-version-validation false
echo "enabled-extensions: $uuids" | tee -a "$OUT/versions.txt"

gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 --unsafe-mode \
    > "$OUT/shell.log" 2>&1 &
shell=$!

ready=0
for _ in $(seq 1 180); do
    if gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval '1' >/dev/null 2>&1; then
        ready=1
        break
    fi
    if ! kill -0 "$shell" 2>/dev/null; then
        break
    fi
    sleep 1
done

if [ "$ready" != 1 ]; then
    echo "GNOME Shell did not start" | tee "$OUT/report.md"
    tail -80 "$OUT/shell.log"
    kill "$shell" 2>/dev/null
    exit 1
fi

# WAYLAND_DISPLAY for the test windows the driver opens.
export WAYLAND_DISPLAY=wayland-0
for socket in "$XDG_RUNTIME_DIR"/wayland-*; do
    case $socket in *.lock) ;; *) WAYLAND_DISPLAY=$(basename "$socket"); break ;; esac
done

sleep 10 # let extensions finish enabling
python3 "$SRC/tests/gnome/drive.py" "$OUT"
rc=$?
kill "$shell" 2>/dev/null
wait "$shell" 2>/dev/null
python3 "$SRC/tests/gnome/drive.py" --analyze-only "$OUT" || rc=1
exit $rc
