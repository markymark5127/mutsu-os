#!/usr/bin/env python3
"""Brand human-readable system-management recipes without renaming commands.

This runs only while composing Mutsu OS. Keep upstream executable names,
technical paths and update scripts unchanged.
"""
from __future__ import annotations

from pathlib import Path

root = Path("/usr/share/ublue-os/just")

release = root / "10-update.just"
if release.is_file():
    content = release.read_text(encoding="utf-8")
    upstream = "https://api.github.com/repos/ublue-os/bazzite/releases"
    mutsu = "https://api.github.com/repos/markymark5127/mutsu-os/releases"
    if upstream in content:
        content = content.replace(upstream, mutsu)
    if mutsu not in content:
        raise SystemExit("Cannot verify Mutsu changelog source in update recipe")
    content = content.replace(
        "jq -r '.body'",
        'jq -r \' .body // "No Mutsu OS releases have been published yet." \'',
    ).replace(
        "jq -r 'map(select(.prerelease)) | .[0].body'",
        """jq -r 'if type == "array" then (map(select(.prerelease)) | .[0].body // "No Mutsu OS prerelease notes yet.") else "No Mutsu OS prerelease notes yet." end'""",
    )
    # Drop padding inside the jq single quotes; the syntax is valid either way.
    content = content.replace("' .body", "'.body").replace('." \'', '."\'')
    release.write_text(content, encoding="utf-8")

steam = root / "93-bazzite-update.just"
if steam.is_file():
    content = steam.read_text(encoding="utf-8")
    content = content.replace(
        "/usr/bin/steamos-add-to-steam /usr/bin/bazzite-updater",
        "/usr/bin/steamos-add-to-steam /usr/bin/mutsu-updater",
    )
    if "steamos-add-to-steam /usr/bin/mutsu-updater" not in content:
        raise SystemExit("Upstream Steam updater recipe changed unexpectedly")
    steam.write_text(content, encoding="utf-8")

# ujust pickers show recipe descriptions: rebrand prose but not real paths,
# service names, script logic, or third-party names like Bazzite Buddy.
for path in root.glob("*.just"):
    content = path.read_text(encoding="utf-8")
    lines = []
    for line in content.splitlines(keepends=True):
        if line.lstrip().startswith("#"):
            line = line.replace("Bazzite customized", "Mutsu OS customized")
            line = line.replace("Bazzite Updater", "Mutsu OS Updater")
            line = line.replace("Bazzite Portal", "Mutsu Portal")
        elif "Bazzite Portal" in line and "echo " in line:
            line = line.replace("Bazzite Portal", "Mutsu Portal")
        lines.append(line)
    rewritten = "".join(lines)
    if rewritten != content:
        path.write_text(rewritten, encoding="utf-8")

print("Mutsu system-management text and release notes references installed.")
