#!/usr/bin/env python3
"""Install Mutsu's drawn cursors into a cursor theme.

Usage: build-cursor-theme.py SOURCE_DIR THEME_DIR

SOURCE_DIR holds the SVGs and cursors.json (draw-japandi-cursors.py makes
them). For each cursor this writes:
  THEME_DIR/cursors/<name>             Xcursor (Xwayland apps), every frame
                                        at 24-96 px, animated ones with delays
  THEME_DIR/cursors_scalable/<name>/    SVG frames + metadata.json, which
                                        GNOME Shell 51 draws itself
and links every alias name to it in both. Names it doesn't draw are left for
the Adwaita fallback that install-branding.sh adds afterwards.
"""
import importlib.util
import json
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("build_xcursor", HERE / "build-xcursor.py")
xc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(xc)
BASE = 32


def frame_image(svg: Path, size: int, hot, delay: int, tmp: Path) -> bytes:
    png = tmp / f"{svg.stem}-{size}.png"
    subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), "-o", str(png), str(svg)], check=True)
    width, height, rows = xc.decode_png(png.read_bytes())
    scale = size / BASE
    image = bytearray(xc.xcursor_image(size, width, height, rows,
                                       min(width - 1, round(hot[0] * scale)),
                                       min(height - 1, round(hot[1] * scale))))
    struct.pack_into("<I", image, 32, delay)  # the header's last field: delay (ms)
    return bytes(image)


def write_xcursor(frames, hot, delay, output: Path):
    images = []
    with tempfile.TemporaryDirectory() as tmp:
        for size in xc.SIZES:
            for svg in frames:
                images.append((size, frame_image(svg, size, hot, delay, Path(tmp))))
    out = bytearray(struct.pack("<4sIII", b"Xcur", 16, 0x10000, len(images)))
    offset = 16 + 12 * len(images)
    for size, image in images:
        out += struct.pack("<III", 0xFFFD0002, size, offset)
        offset += len(image)
    for _size, image in images:
        out += image
    output.write_bytes(bytes(out))


def link(target: str, link_path: Path):
    if link_path.is_symlink() or link_path.exists():
        if link_path.is_dir() and not link_path.is_symlink():
            shutil.rmtree(link_path)
        else:
            link_path.unlink()
    link_path.symlink_to(target)


def main(source: Path, theme: Path) -> int:
    manifest = json.loads((source / "cursors.json").read_text())
    xdir, sdir = theme / "cursors", theme / "cursors_scalable"
    xdir.mkdir(parents=True, exist_ok=True)
    sdir.mkdir(parents=True, exist_ok=True)
    names = 0
    for cursor in manifest:
        name, hot = cursor["name"], cursor["hotspot"]
        frames = [source / f for f in cursor["frames"]]
        delay = int(cursor.get("delay_ms", 0)) if len(frames) > 1 else 0
        write_xcursor(frames, hot, delay, xdir / name)
        folder = sdir / name
        if folder.is_symlink():
            folder.unlink()
        folder.mkdir(exist_ok=True)
        meta = []
        for svg in frames:
            shutil.copyfile(svg, folder / svg.name)
            entry = {"filename": svg.name, "hotspot_x": hot[0], "hotspot_y": hot[1], "nominal_size": BASE}
            if delay:
                entry["delay"] = delay
            meta.append(entry)
        (folder / "metadata.json").write_text(json.dumps(meta, indent=4) + "\n")
        names += 1
        for alias in cursor.get("aliases", []):
            link(name, xdir / alias)
            link(name, sdir / alias)
            names += 1
    print(f"Mutsu cursors: {len(manifest)} drawn, {names} names")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    sys.exit(main(Path(sys.argv[1]), Path(sys.argv[2])))
