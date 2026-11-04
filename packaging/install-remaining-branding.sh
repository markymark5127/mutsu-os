#!/usr/bin/env bash
# System-image-only user-facing cleanup; never mutate user homes.
# Keep upstream technical IDs, bootc deployment machinery and package names.
set -euo pipefail

# Bazzite's per-user autostart entry is copied into *new* accounts from skel.
# Hiding /etc/xdg/autostart entries does not suppress user-scoped autostarts.
rm -f /etc/skel/.config/autostart/bazzite-portal.desktop

# Do not launch upstream Bazzite news/marketing on new Mutsu accounts.
# The main Mutsu welcome unit and system update notifications are unaffected.
install -d -m0755 /etc/xdg/autostart
cat > /etc/xdg/autostart/bazzite-announcement.desktop <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Mutsu OS (legacy upstream announcements disabled)
Hidden=true
X-GNOME-Autostart-enabled=false
DESKTOP

# GNOME enumerates system wallpapers through metadata XML files, even when
# the active wallpaper is Mutsu. Remove branded chooser entries, not the
# underlying pictures or non-branded wallpaper choices.
python3 - <<'PY'
from pathlib import Path
import xml.etree.ElementTree as ET

directory = Path("/usr/share/gnome-background-properties")
for path in directory.glob("*.xml"):
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError):
        continue
    if root.tag != "wallpapers":
        continue
    removed = 0
    for entry in list(root):
        if entry.tag != "wallpaper":
            continue
        title = entry.findtext("name", default="").casefold()
        if "bazzite" in title or "fedora" in title:
            root.remove(entry)
            removed += 1
    if not removed:
        continue
    if not list(root):
        path.unlink()
    else:
        # Do not erase an unrelated wallpaper bundled in the same XML file.
        content = ET.tostring(root, encoding="unicode")
        path.write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE wallpapers SYSTEM "gnome-wp-list.dtd">\n'
            + content + "\n",
            encoding="utf-8",
        )
    print(f"Removed {removed} inherited vendor-branded wallpaper entries: {path.name}")
PY

# GRUB's generated fallback entries may use the distributor string; BLS/OSTree
# deployments normally derive titles from PRETTY_NAME=Mutsu OS already.
# Do NOT regenerate grub.cfg, edit BLS files or touch EFI entries during build.
# Only set the fallback /etc/default/grub value when the file is present.
python3 - <<'PY'
from pathlib import Path
path = Path("/etc/default/grub")
if path.exists() and path.is_file():
    lines = path.read_text(encoding="utf-8").splitlines()
    lines = [line for line in lines if not line.startswith("GRUB_DISTRIBUTOR=")]
    lines.append('GRUB_DISTRIBUTOR="Mutsu OS"')
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY

# Expose a branded update entry that calls the existing safe update recipe,
# rather than showing the Bazzite updater GUI or patching its executable.
test -x /usr/bin/mutsu-updater
test -x /usr/libexec/mutsu-os/run-mutsu-update.sh
test -s /usr/share/applications/mutsu-updater.desktop

printf 'Mutsu first-run, wallpaper chooser, GRUB default and updater launcher checks installed.\n'
