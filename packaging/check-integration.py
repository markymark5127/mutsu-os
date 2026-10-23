#!/usr/bin/env python3
"""Read-only checks for the pinned Mutsu desktop sources and image assets."""
from __future__ import annotations

import ast
import pathlib
import struct
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "vendor" / "ai-desktop"
EXPECTED_FILES = [
    SRC / "src/aidesktop/__main__.py",
    SRC / "src/aidesktop/ui.py",
    SRC / "src/aidesktop/setup_wizard.py",
    SRC / "src/aidesktop/newelle_client.py",
    SRC / "src/aidesktop/onboarding.py",
    ROOT / "branding/icons/mutsu-logo-symbol.svg",
    ROOT / "branding/icons/mutsu-logo-wordmark.svg",
    ROOT / "branding/icons/mutsu-logo-symbolic.svg",
    ROOT / "packaging/mutsu-search",
    ROOT / "packaging/mutsu-first-login",
    ROOT / "packaging/io.github.markymark5127.AIDesktop.desktop",
    ROOT / "packaging/90-mutsu-wallpaper.gschema.override",
    ROOT / "packaging/20-mutsu-shortcut.dconf",
    ROOT / "packaging/30-mutsu-mac-defaults.dconf",
    ROOT / "docs/ADAPTIVE_DESKTOP_IMAGE.md",
    ROOT / "disk_config/iso.toml",
]


def main() -> int:
    failures: list[str] = []
    for path in EXPECTED_FILES:
        if not path.is_file() or path.stat().st_size == 0:
            failures.append(f"Missing or empty: {path.relative_to(ROOT)}")

    for path in (ROOT / "branding/icons").glob("*.svg"):
        try:
            element = ET.parse(path).getroot()
            if element.tag not in ("svg", "{http://www.w3.org/2000/svg}svg"):
                failures.append(f"Invalid SVG element: {path.name}")
        except ET.ParseError:
            failures.append(f"Invalid SVG document: {path.name}")

    for name in ("japandi", "cyberpunk"):
        path = ROOT / "branding/wallpapers" / f"mutsu-{name}-4k.png"
        try:
            with path.open("rb") as image:
                header = image.read(24)
            if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
                failures.append(f"Invalid PNG wallpaper: {path.name}")
            else:
                width, height = struct.unpack(">II", header[16:24])
                if (width, height) != (3840, 2160):
                    print(f"NOTE: {path.name} is {width}x{height}, not 3840x2160")
        except OSError:
            failures.append(f"Missing wallpaper: {path.name}")

    if (SRC / "src/aidesktop/ui.py").is_file():
        for path in (SRC / "src/aidesktop").glob("*.py"):
            try:
                ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            except (SyntaxError, UnicodeDecodeError) as error:
                failures.append(f"Invalid Python: {path.name}: {error}")

    print("Mutsu OS image integration inventory")
    for path in EXPECTED_FILES:
        print(f"  {'OK' if path.is_file() and path.stat().st_size else '--'} {path.relative_to(ROOT)}")
    if failures:
        for problem in failures:
            print("ERROR:", problem, file=sys.stderr)
        return 1
    print("Static integration checks passed. This is not a boot/GUI test.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
