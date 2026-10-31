#!/usr/bin/env python3
"""Compile a genuine Mutsu GNOME desktop into the OS image, not a login hook.

GNOME supports machine-wide, user-overridable defaults via dconf and enables
system GNOME extensions with org.gnome.shell.enabled-extensions. The latter is
a REPLACEMENT array, so preserve available vendor extension defaults before
adding Mutsu. This runs only in Containerfile during the image build.

Existing accounts with user-set extension lists retain their choices. GNOME
does not offer an additive system extension default for already-created users.
"""
from __future__ import annotations

import ast
import configparser
import os
from pathlib import Path
import subprocess

BRANDING = "mutsu-branding@mutsu-os"
DOCK = "dash-to-dock@micxgx.gmail.com"
ADAPTIVE = "mutsu-adaptive@mutsu-os"
GLOBAL_MENU = "globalmenu@ShiroOSL.github.io"
KIWI = "kiwi@kemma"
TOUCHSHELL = "touchshell@touchshell.com"
FOCUSED = "focused-window-dbus@flexagoon.com"
# Adaptive Desktop loads on first GNOME login as a core Mutsu feature.
# Automatic posture still requires real-hardware qualification; experimental
# bottom-edge interception stays off until touch QA passes.
# Global Menu provides the Mac-style File/Edit/View/Window bar.
MUTSU_EXTENSIONS = (BRANDING, DOCK, ADAPTIVE, GLOBAL_MENU, KIWI, TOUCHSHELL, FOCUSED)
DESKTOP_ROOT = Path(os.environ.get("MUTSU_DESKTOP_ROOT", "/"))
DCONF_DIR = DESKTOP_ROOT / "etc/dconf/db"
MUTSU_DEFAULTS = DCONF_DIR / "mutsu.d/10-mutsu-shell"
GNOME_EXTENSIONS = DESKTOP_ROOT / "usr/share/gnome-shell/extensions"
BACKGROUND = DESKTOP_ROOT / "usr/share/backgrounds/mutsu/mutsu-japandi-4k.png"
# Exclude conflicting dock implementations only: GNOME can't render both
# Dash-to-Panel and Dash-to-Dock as the same coherent dock at once.
CONFLICTING_DOCKS = {"dash-to-panel@jderose9.github.com"}
# Bazzite Logo Menu puts a second logo next to Mutsu branding. Disable it.
# Mutsu branding owns the top-left logo and (with a global menu) the File/Edit bar.
EXCLUDED_EXTENSIONS = CONFLICTING_DOCKS | {
    "logomenu@aryan_k",
    "logo-menu@aryan_k",
}


def parse_array(value: str) -> list[str]:
    """Parse GVariant as[] text and validate before writing dconf defaults."""
    value = value.strip()
    if value.startswith("@as "):
        value = value[4:].strip()
    try:
        parsed = ast.literal_eval(value)
    except (SyntaxError, ValueError) as exc:
        raise ValueError(f"Invalid enabled-extensions GVariant: {value}") from exc
    if not isinstance(parsed, list) or any(not isinstance(v, str) for v in parsed):
        raise ValueError(f"enabled-extensions must be a list of strings: {value}")
    return parsed


def base_schema_extensions() -> list[str]:
    env = os.environ.copy()
    env["GSETTINGS_BACKEND"] = "memory"
    result = subprocess.run(
        ["gsettings", "get", "org.gnome.shell", "enabled-extensions"],
        capture_output=True, text=True, check=True, env=env,
    )
    return parse_array(result.stdout)


def vendor_dconf_extensions(root: Path = DCONF_DIR) -> list[str]:
    extensions: list[str] = []
    # Read shipped vendor keyfiles without overwriting them. dconf databases
    # may contain existing Bazzite/Universal Blue extension defaults.
    for keyfile in sorted(root.glob("*.d/*")):
        if not keyfile.is_file() or keyfile.parent.name == "mutsu.d":
            continue
        parser = configparser.ConfigParser(interpolation=None, strict=False)
        parser.optionxform = str
        try:
            with keyfile.open(encoding="utf-8") as handle:
                parser.read_file(handle)
        except (OSError, UnicodeDecodeError, configparser.Error):
            continue
        if parser.has_option("org/gnome/shell", "enabled-extensions"):
            extensions.extend(parse_array(
                parser.get("org/gnome/shell", "enabled-extensions")
            ))
    return extensions


def merged_extensions(vendor: list[str], schema: list[str]) -> list[str]:
    ordered: list[str] = []
    for name in [*vendor, *schema, *MUTSU_EXTENSIONS]:
        if name not in ordered and name not in EXCLUDED_EXTENSIONS:
            ordered.append(name)
    return ordered


def render_extensions(names: list[str]) -> str:
    # A Python single-quoted list has the GVariant array-of-strings format.
    return (
        "# Compiled into Mutsu OS, before GNOME's first login. No autostart.\n"
        "# User choices take precedence. Preserved upstream extensions plus Mutsu.\n"
        "[org/gnome/shell]\n"
        f"enabled-extensions={names!r}\n"
        "disable-user-extensions=false\n"
    )


def main() -> None:
    for uuid in MUTSU_EXTENSIONS:
        if not (GNOME_EXTENSIONS / uuid / "metadata.json").is_file():
            raise SystemExit(f"Missing native GNOME extension: {uuid}")
    if not BACKGROUND.is_file():
        raise SystemExit("Missing Mutsu Japandi wallpaper in OS image")
    vendor = vendor_dconf_extensions()
    schema = base_schema_extensions()
    names = merged_extensions(vendor, schema)
    if not all(ext in names for ext in MUTSU_EXTENSIONS):
        raise SystemExit("Missing required Mutsu Shell extensions from default list")
    MUTSU_DEFAULTS.parent.mkdir(parents=True, exist_ok=True)
    MUTSU_DEFAULTS.write_text(render_extensions(names), encoding="utf-8")
    subprocess.run(["dconf", "update"], check=True)
    print("Native Mutsu GNOME extensions:", ", ".join(names))
    print("Mutsu GNOME default compiled for first login; no runtime script.")


if __name__ == "__main__":
    main()
