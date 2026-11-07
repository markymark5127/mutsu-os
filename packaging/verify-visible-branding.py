#!/usr/bin/env python3
"""Build-time checks for visible Mutsu identity, not third-party technical IDs.

An immutable-image check cannot establish that a live ISO, GNOME, or the
installed bootloader will display the right text. Perform boot QA separately.
"""
from __future__ import annotations

from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

failures: list[str] = []
bad = re.compile(r"bazzite|fedora linux|fedora 44", re.IGNORECASE)

def require(condition: bool, description: str) -> None:
    if not condition:
        failures.append(description)

def content(path: str) -> str:
    p = Path(path)
    return p.read_text(encoding="utf-8") if p.is_file() else ""

os_release = content("/usr/lib/os-release")
require('PRETTY_NAME="Mutsu OS' in os_release, "Mutsu OS PRETTY_NAME not set")
require('NAME="Mutsu OS"' in os_release, "Mutsu OS NAME not set")
require(
    not Path("/etc/skel/.config/autostart/bazzite-portal.desktop").exists(),
    "New accounts would still autostart Bazzite Portal",
)

for path in (
    "/usr/share/ublue-os/motd/template.md",
    "/usr/share/ublue-os/motd/template.sv.md",
):
    body = content(path)
    require("Welcome to Mutsu OS" in body, f"Wrong welcome text: {path}")
    require(not bad.search(body), f"Upstream branding in welcome: {path}")

tips = Path("/usr/share/ublue-os/motd/tips")
require((tips / "20-mutsu.md").is_file(), "Mutsu terminal tips not installed")
for file in tips.rglob("*.md") if tips.is_dir() else []:
    require(not re.search(r"bazzite|fedora", content(str(file)), re.I),
            f"Upstream name in rotating tip: {file}")

fastfetch = content("/etc/xdg/fastfetch/config.jsonc")
require("/usr/share/mutsu-os/terminal/logo.txt" in fastfetch,
        "Default fastfetch points to inherited logo")

# Only visible desktop entries; hidden upstream technical launchers may remain.
def desktop_values(path: Path) -> tuple[bool, str]:
    in_desktop_group = False
    fields: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line.startswith("[") and line.endswith("]"):
            in_desktop_group = line == "[Desktop Entry]"
            continue
        if not in_desktop_group or "=" not in line or line.startswith("#"):
            continue
        key, value = line.split("=", 1)
        fields[key] = value
    hidden = fields.get("Hidden", "false").lower() == "true" or (
        fields.get("NoDisplay", "false").lower() == "true"
    )
    visible = "\n".join(
        value for key, value in fields.items()
        if key == "Name" or key.startswith("Name[")
        or key == "Comment" or key.startswith("Comment[")
        or key == "GenericName"
    )
    return hidden, visible

for folder in (
    Path("/usr/share/applications"),
    Path("/etc/xdg/autostart"),
):
    if not folder.is_dir():
        continue
    for path in folder.glob("*.desktop"):
        try:
            hidden, value = desktop_values(path)
        except (UnicodeError, OSError):
            continue
        require(hidden or not bad.search(value), f"Visible vendor desktop entry: {path}")

wallpapers = Path("/usr/share/gnome-background-properties")
if wallpapers.is_dir():
    for path in wallpapers.glob("*.xml"):
        try:
            xml = ET.parse(path).getroot()
        except (ET.ParseError, OSError):
            failures.append(f"Invalid wallpaper chooser XML: {path}")
            continue
        for name in xml.findall(".//wallpaper/name"):
            require(not bad.search(name.text or ""), f"Branded wallpaper chooser entry: {path}")

updater = content("/usr/share/applications/mutsu-updater.desktop")
require("Exec=/usr/bin/mutsu-updater" in updater, "Mutsu app still launches vendor updater GUI")
require(Path("/usr/bin/mutsu-updater").is_file(), "Mutsu updater launcher missing")

grub = content("/etc/default/grub")
if grub:
    require('GRUB_DISTRIBUTOR="Mutsu OS"' in grub, "GRUB fallback distributor is not Mutsu")

if failures:
    for failure in failures:
        print("VISIBLE BRANDING ERROR:", failure, file=sys.stderr)
    raise SystemExit(1)
print("Mutsu visible-branding image checks passed (not a boot or ISO runtime test).")
