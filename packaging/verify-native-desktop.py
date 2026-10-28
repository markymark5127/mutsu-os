#!/usr/bin/env python3
"""Fail Mutsu image builds if the *native* desktop is not installed.

No login-time theme mutations: validate actual compiled dconf configuration
and the GNOME 50-compatible extensions which must be ready before the first
fresh-user session starts.
"""
from __future__ import annotations

import ast
import json
import os
from pathlib import Path
import subprocess
import tempfile

REQUIRED_EXTENSIONS = (
    "mutsu-branding@mutsu-os",
    "dash-to-dock@micxgx.gmail.com",
    "mutsu-adaptive@mutsu-os",
    "globalmenu@ShiroOSL.github.io",
    "kiwi@kemma",
    "touchshell@touchshell.com",
)
REQUIRED_WALLPAPER = "file:///usr/share/backgrounds/mutsu/mutsu-japandi-4k.png"


def parse_extensions(value: str) -> list[str]:
    if value.startswith("@as "):
        value = value[4:]
    obj = ast.literal_eval(value.strip())
    if not isinstance(obj, list) or any(not isinstance(x, str) for x in obj):
        raise ValueError("GNOME enabled-extensions must be an array of strings")
    return obj


def native_profile_ok(lines: list[str]) -> bool:
    active = [v.strip() for v in lines if v.strip() and not v.lstrip().startswith("#")]
    return len(active) >= 2 and active[0] == "user-db:user" and active[1] == "system-db:mutsu"


def verify_source_layout(root: Path) -> list[str]:
    errors = []
    path = root / "etc/dconf/profile/user"
    if not path.is_file() or not native_profile_ok(path.read_text().splitlines()):
        errors.append("GNOME is not configured to use Mutsu as the first system dconf database")

    compiled = root / "etc/dconf/db/mutsu"
    if not compiled.is_file() or compiled.stat().st_size == 0:
        errors.append("Mutsu's system dconf database was not compiled")

    entries = root / "etc/dconf/db/mutsu.d/10-mutsu-shell"
    try:
        text = entries.read_text(encoding="utf-8")
        lines = [s for s in text.splitlines() if s.startswith("enabled-extensions=")]
        if len(lines) != 1:
            raise ValueError("Expected exactly one GNOME enabled-extensions setting")
        names = parse_extensions(lines[0].split("=", 1)[1])
        errors.extend(f"Native extension missing from compiled defaults: {v}"
                      for v in REQUIRED_EXTENSIONS if v not in names)
    except (OSError, SyntaxError, ValueError) as exc:
        errors.append(f"Invalid Mutsu GNOME enabled extensions: {exc}")

    wallpaper = root / REQUIRED_WALLPAPER.removeprefix("file:///")
    if not wallpaper.is_file():
        errors.append("Japandi wallpaper is missing from /usr/share/backgrounds")

    extroot = root / "usr/share/gnome-shell/extensions"
    for uuid in REQUIRED_EXTENSIONS:
        meta = extroot / uuid / "metadata.json"
        if not meta.is_file():
            errors.append(f"System GNOME extension not installed: {uuid}")
            continue
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
            if data.get("uuid") != uuid:
                errors.append(f"GNOME extension UUID mismatch: {uuid}")
            if "50" not in data.get("shell-version", []):
                errors.append(f"GNOME 50 support not declared: {uuid}")
        except (ValueError, OSError) as exc:
            errors.append(f"Invalid system GNOME extension {uuid}: {exc}")

    if (root / "etc/xdg/autostart/mutsu-first-boot.desktop").exists():
        errors.append("Legacy per-login appearance script is still enabled")
    return errors


def gsetting_value(schema: str, key: str, env: dict[str, str]) -> str:
    result = subprocess.run(
        ["gsettings", "get", schema, key],
        capture_output=True, text=True, env=env, check=True,
    )
    return result.stdout.strip()


def verify_fresh_user_effective_defaults() -> list[str]:
    errors = []
    # Read *actual* gsettings resolution, not just grep files. Isolate
    # HOME so the build runner cannot lend its own GNOME user overrides.
    with tempfile.TemporaryDirectory(prefix="mutsu-native-check-") as fresh_home:
        env = os.environ.copy()
        env.update({
            "HOME": fresh_home,
            "XDG_CONFIG_HOME": str(Path(fresh_home) / ".config"),
            "DCONF_PROFILE": "user",
            "GSETTINGS_BACKEND": "dconf",
        })
        try:
            actual = parse_extensions(gsetting_value(
                "org.gnome.shell", "enabled-extensions", env))
            for ext in REQUIRED_EXTENSIONS:
                if ext not in actual:
                    errors.append(f"Fresh GNOME session would not load: {ext}")
            if "logomenu@aryan_k" in actual or "logo-menu@aryan_k" in actual:
                errors.append("Bazzite Logo Menu still overrides Mutsu top-left branding")
            wallpaper = gsetting_value(
                "org.gnome.desktop.background", "picture-uri", env)
            if wallpaper != repr(REQUIRED_WALLPAPER):
                errors.append(f"GNOME wallpaper is not Mutsu Japandi: {wallpaper}")
            scheme = gsetting_value(
                "org.gnome.desktop.interface", "color-scheme", env)
            if scheme != "'prefer-light'":
                errors.append(f"GNOME is not set to light Japandi appearance: {scheme}")
        except (OSError, subprocess.CalledProcessError, SyntaxError, ValueError) as exc:
            errors.append(f"Could not resolve fresh-user GSettings: {exc}")
    return errors


def main() -> None:
    errors = verify_source_layout(Path("/"))
    if not errors:
        errors.extend(verify_fresh_user_effective_defaults())
    if errors:
        for error in errors:
            print("NATIVE DESKTOP ERROR:", error)
        raise SystemExit(1)
    print("Mutsu native Japandi GNOME desktop is installed and active for fresh users.")


if __name__ == "__main__":
    main()
