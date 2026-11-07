#!/usr/bin/bash
# Mutsu live USB session: a passwordless "liveuser" that logs in
# automatically. Runs only when booted from the live USB (the unit's
# ConditionKernelCommandLine), before the login screen starts. Everything
# it writes lives in the live session's RAM overlay; installed systems never
# run it.
set -euo pipefail

user=liveuser

# /home is a symlink to /var/home on bootc images; the live /var may not
# have the directory yet.
install -d -m0755 /var/home

if ! getent passwd "$user" >/dev/null; then
  uid_args=()
  getent passwd 1000 >/dev/null || uid_args=(--uid 1000)
  useradd --create-home "${uid_args[@]}" --user-group --groups wheel \
    --comment "Mutsu Live" --shell /bin/bash "$user"
fi
passwd --delete "$user" >/dev/null

home=$(getent passwd "$user" | cut -d: -f6)
command -v restorecon >/dev/null && restorecon -R "$home" 2>/dev/null || true

# Automatic login. Keep any other GDM settings the image ships.
python3 - "$user" <<'PY'
import configparser, pathlib, sys
path = pathlib.Path("/etc/gdm/custom.conf")
config = configparser.ConfigParser(interpolation=None, strict=False)
config.optionxform = str
if path.exists():
    config.read(path)
if not config.has_section("daemon"):
    config.add_section("daemon")
config["daemon"]["AutomaticLoginEnable"] = "True"
config["daemon"]["AutomaticLogin"] = sys.argv[1]
path.parent.mkdir(parents=True, exist_ok=True)
with path.open("w") as stream:
    config.write(stream, space_around_delimiters=False)
PY

# A passwordless account must never be locked out: no screen lock or
# blanking in the live session, and sudo without a password.
install -d -m0755 /etc/dconf/db/mutsu.d
cat > /etc/dconf/db/mutsu.d/95-mutsu-live <<'DCONF'
[org/gnome/desktop/screensaver]
lock-enabled=false

[org/gnome/desktop/session]
idle-delay=uint32 0

[org/gnome/settings-daemon/plugins/power]
sleep-inactive-ac-type='nothing'
sleep-inactive-battery-type='nothing'
DCONF
command -v dconf >/dev/null && dconf update || true

printf '%s ALL=(ALL) NOPASSWD: ALL\n' "$user" > /etc/sudoers.d/90-mutsu-live
chmod 0440 /etc/sudoers.d/90-mutsu-live

echo "Mutsu live session ready: automatic login as $user"
