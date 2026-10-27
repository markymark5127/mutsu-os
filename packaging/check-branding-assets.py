#!/usr/bin/env python3
"""Validate Mutsu's approved SVG copies and opt-in theme source inventory."""
from __future__ import annotations

import configparser
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "branding"
SYMBOLS = [
    "mutsu-logo-symbol.svg",
    "mutsu-logo-symbolic.svg",
    "mutsu-logo-wordmark.svg",
    "mutsu-logo-original.svg",
    "mutsu-logo-japandi.svg",
    "mutsu-logo-cyberpunk.svg",
    "mutsu-wordmark-original.svg",
    "mutsu-wordmark-japandi.svg",
    "mutsu-wordmark-cyberpunk.svg",
    "mutsu-logo-symbolic-white.svg",
    "mutsu-ai.svg",
    "mutsu-app-grid.svg",
    "mutsu-lockup-original.svg",
    "mutsu-lockup-japandi.svg",
    "mutsu-lockup-cyberpunk.svg",
    "mutsu-lockup-symbolic-white.svg",
]
ERRORS: list[str] = []


def need(path: Path) -> bool:
    if path.is_file() and path.stat().st_size:
        return True
    ERRORS.append(f"Missing or empty: {path.relative_to(ROOT)}")
    return False


for name in SYMBOLS:
    path = SOURCE / "icons" / name
    if not need(path):
        continue
    try:
        root = ET.parse(path).getroot()
        if root.tag != "{http://www.w3.org/2000/svg}svg":
            ERRORS.append(f"Not an SVG document: {path.relative_to(ROOT)}")
    except ET.ParseError as exc:
        ERRORS.append(f"Malformed SVG {name}: {exc}")

boot_logo = SOURCE / "plymouth" / "mutsu-boot-logo.svg"
if need(boot_logo):
    try:
        ET.parse(boot_logo)
    except ET.ParseError as exc:
        ERRORS.append(f"Malformed Plymouth emblem: {exc}")

for name in ("japandi", "cyberpunk"):
    token_path = SOURCE / "themes" / f"{name}.json"
    css_path = SOURCE / "shell" / f"{name}.css"
    if need(css_path):
        css = css_path.read_text(encoding="utf-8")
        if "#panel" not in css or ".popup-menu-content" not in css:
            ERRORS.append(f"Expected Shell selectors missing: {css_path}")
    if not need(token_path):
        continue
    try:
        data = json.loads(token_path.read_text(encoding="utf-8"))
        if data.get("id") != name:
            ERRORS.append(f"Theme id mismatch in {token_path}")
        for asset in data.get("assets", {}).values():
            if not isinstance(asset, str) or not asset.startswith("branding/"):
                ERRORS.append(f"Unsafe theme asset path in {token_path}: {asset}")
            else:
                need(ROOT / asset)
    except (ValueError, TypeError) as exc:
        ERRORS.append(f"Invalid theme token file {token_path}: {exc}")

theme_path = SOURCE / "plymouth" / "mutsu.plymouth"
script_path = SOURCE / "plymouth" / "mutsu.script"
if need(theme_path) and need(script_path):
    cfg = configparser.ConfigParser()
    cfg.read(theme_path, encoding="utf-8")
    if cfg.get("Plymouth Theme", "ModuleName", fallback="") != "script":
        ERRORS.append("Plymouth must use script plugin")
    if "mutsu-boot-logo.png" not in script_path.read_text(encoding="utf-8"):
        ERRORS.append("Plymouth script is not using the staged logo PNG")
    # The PNG is an intentional generated output of render-plymouth-theme.sh.

# The system GNOME Shell extension is built into the image and enabled by default for fresh users.
ext = ROOT / "extensions" / "mutsu-branding@mutsu-os"
meta = ext / "metadata.json"
schema = ext / "schemas" / "org.gnome.shell.extensions.mutsu-branding.gschema.xml"
if need(meta) and need(schema) and need(ext / "extension.js"):
    try:
        m = json.loads(meta.read_text(encoding="utf-8"))
        if m.get("uuid") != "mutsu-branding@mutsu-os":
            ERRORS.append("Unexpected Mutsu branding Shell extension UUID")
        ET.parse(schema)
        script = (ROOT / "packaging/install-shell-branding.sh").read_text(encoding="utf-8")
        if "enabled-extensions" in script and "No dconf enabled-extensions" not in script:
            ERRORS.append("Shell branding installer may modify enabled-extensions")
    except (OSError, ValueError, ET.ParseError) as exc:
        ERRORS.append(f"Invalid optional branding extension metadata: {exc}")

if ERRORS:
    for error in ERRORS:
        print(f"ERROR: {error}", file=sys.stderr)
    raise SystemExit(1)
print("Mutsu branding source assets validated (NOT a GNOME/Plymouth runtime test).")
