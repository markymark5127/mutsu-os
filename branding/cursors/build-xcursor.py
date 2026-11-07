#!/usr/bin/env python3
"""Build an Xcursor file from an SVG (GNOME needs Xcursor, not SVG, cursors).

Usage: build-xcursor.py SOURCE.svg OUTPUT HOT_X HOT_Y [BASE_SIZE]

HOT_X/HOT_Y are the hotspot in SVG pixels at BASE_SIZE (default 32).
Renders 24/32/48/64/96 px with rsvg-convert (librsvg2-tools) and writes a
multi-size Xcursor. Standard library only, so it runs in the image build.
"""
import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

SIZES = (24, 32, 48, 64, 96)


def decode_png(data: bytes):
    """Minimal PNG decoder for rsvg-convert output: 8-bit RGBA, no interlace."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, idat, width = 8, b"", 0
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, colour, _c, _f, interlace = struct.unpack(">IIBBBBB", chunk)
            if depth != 8 or colour != 6 or interlace:
                raise ValueError("expected 8-bit RGBA, non-interlaced PNG")
        elif kind == b"IDAT":
            idat += chunk
        pos += 12 + length
    raw = zlib.decompress(idat)
    stride = width * 4
    rows, prev = [], bytearray(stride)
    for y in range(height):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - 4] if i >= 4 else 0
            b = prev[i]
            c = prev[i - 4] if i >= 4 else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 255
        rows.append(bytes(line))
        prev = line
    return width, height, rows


def xcursor_image(size, width, height, rows, hot_x, hot_y):
    pixels = bytearray()
    for row in rows:
        for i in range(0, len(row), 4):
            r, g, b, a = row[i:i + 4]
            # Xcursor wants premultiplied ARGB, little-endian uint32.
            pixels += struct.pack("<I", (a << 24) | (r * a // 255 << 16) |
                                  (g * a // 255 << 8) | (b * a // 255))
    header = struct.pack("<IIIIIIIII", 36, 0xFFFD0002, size, 1,
                         width, height, hot_x, hot_y, 0)
    return header + bytes(pixels)


def build(source: Path, output: Path, hot_x: float, hot_y: float, base: int = 32):
    images = []
    with tempfile.TemporaryDirectory() as tmp:
        for size in SIZES:
            png = Path(tmp) / f"{size}.png"
            subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size),
                            "-o", str(png), str(source)], check=True)
            width, height, rows = decode_png(png.read_bytes())
            scale = size / base
            images.append((size, xcursor_image(size, width, height, rows,
                                               min(width - 1, round(hot_x * scale)),
                                               min(height - 1, round(hot_y * scale)))))
    toc_start = 16 + 12 * len(images)
    out = bytearray(struct.pack("<4sIII", b"Xcur", 16, 0x10000, len(images)))
    offset = toc_start
    for size, image in images:
        out += struct.pack("<III", 0xFFFD0002, size, offset)
        offset += len(image)
    for _size, image in images:
        out += image
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(bytes(out))


if __name__ == "__main__":
    if len(sys.argv) not in (5, 6):
        sys.exit(__doc__)
    build(Path(sys.argv[1]), Path(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]),
          int(sys.argv[5]) if len(sys.argv) == 6 else 32)
