#!/usr/bin/env python3
"""Draw Mutsu's Japandi cursor set (SVG) and its manifest.

Run from anywhere; writes branding/cursors/japandi/*.svg and cursors.json.
Every cursor follows the arrow (left_ptr.svg, drawn by hand): warm charcoal
#3B3632, rounded corners, a fine cream #FFFCF6 outline. Sage #7F9A82 only
where something is happening (busy, working, help, copy).

The outline is drawn as the same shape stroked wider in cream underneath:
one shape, one look, at every size. build-cursor-theme.py turns the result
into Xcursor files and GNOME 51's scalable (SVG) cursors.
"""
import json
import math
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent / "japandi"
C, P, S, T = "#3B3632", "#FFFCF6", "#7F9A82", "#D9CBB4"
ARROW = re.search(r'd="([^"]+)"', (HERE / "left_ptr.svg").read_text()).group(1)


def two(d, attrs=""):
    return (f'<path d="{d}" fill="{P}" stroke="{P}" stroke-width="3.2" {attrs}/>'
            f'<path d="{d}" fill="{C}" stroke="{C}" stroke-width="1.2" {attrs}/>')


def lines(d, w=2.2):
    return (f'<path d="{d}" fill="none" stroke="{P}" stroke-width="{w + 1.8:g}"/>'
            f'<path d="{d}" fill="none" stroke="{C}" stroke-width="{w:g}"/>')


def small_arrow():
    return f'<g transform="scale(0.78)">{two(ARROW)}</g>'


def badge(inner):
    return (f'<circle cx="23.5" cy="23.5" r="6.4" fill="{P}"/>'
            f'<circle cx="23.5" cy="23.5" r="5.2" fill="{S}"/>{inner}')


def spinner(cx, cy, r, w, turn=0.0):
    """A ring: tan track, a sage quarter and a charcoal quarter, turned."""
    def arc(start, end, colour, extra=""):
        a0, a1 = math.radians(start + turn), math.radians(end + turn)
        x0, y0 = cx + r * math.sin(a0), cy - r * math.cos(a0)
        x1, y1 = cx + r * math.sin(a1), cy - r * math.cos(a1)
        return (f'<path d="M{x0:.2f} {y0:.2f} A{r} {r} 0 0 1 {x1:.2f} {y1:.2f}" fill="none" '
                f'stroke="{colour}" stroke-width="{w:g}" stroke-linecap="round" {extra}/>')
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{P}" stroke-width="{w + 1.8:g}"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{T}" stroke-width="{w:g}"/>'
            + arc(0, 90, S) + arc(90, 180, C, 'opacity="0.85"'))


HAND = ("M12 4.6 q2.3-.6 2.6 1.6 V13 q0-1.6 1.6-1.6 q1.6 0 1.6 1.6 v.6 q0-1.5 1.5-1.5 "
        "q1.5 0 1.5 1.5 v.8 q0-1.4 1.4-1.4 q1.4 0 1.4 1.4 V21 q0 6-6 6 h-2.4 q-3 0-4.8-2.6 "
        "L6.6 19 q-.9-1.4.4-2.3 q1.3-.8 2.4.4 L11 19 V6.1 q0-1.1 1-1.5 z")
GRAB = ("M9 15 V9.6 q0-1.5 1.5-1.5 q1.5 0 1.5 1.5 V14 V7.6 q0-1.5 1.5-1.5 q1.5 0 1.5 1.5 V14 "
        "V8.2 q0-1.5 1.5-1.5 q1.5 0 1.5 1.5 v5.8 V10.2 q0-1.4 1.4-1.4 q1.4 0 1.4 1.4 V20 "
        "q0 7-6.5 7 h-1.5 q-3.5 0-5.5-3 L5.7 19.6 q-.8-1.3.5-2.1 q1.3-.8 2.3.3 L9 18.6 Z")
FIST = ("M8 15.2 q0-2.4 2-2.4 q1.6 0 1.8 1.2 q.3-1.8 2-1.8 q1.7 0 2 1.6 q.3-1.6 2-1.6 "
        "q1.7 0 2 1.8 q.4-1.2 1.8-1.2 q2 0 2 2.4 V20 q0 7-7 7 h-1.6 q-7 0-7-7z")
IBEAM = ("M11 5 h2.6 q2 0 2.4 1.4 q.4-1.4 2.4-1.4 H21 v2.6 h-2.4 q-1.2 0-1.2 1.2 v14.4 "
         "q0 1.2 1.2 1.2 H21 V27 h-2.6 q-2 0-2.4-1.4 q-.4 1.4-2.4 1.4 H11 v-2.6 h2.4 "
         "q1.2 0 1.2-1.2 V8.8 q0-1.2-1.2-1.2 H11 z")
MOVE = ("M16 3.2 L21 8.2 H18 V14 H23.8 V11 L28.8 16 L23.8 21 V18 H18 V23.8 H21 L16 28.8 "
        "L11 23.8 H14 V18 H8.2 V21 L3.2 16 L8.2 11 V14 H14 V8.2 H11 Z")
EW = "M3.5 16 L9 10.5 V14 H23 V10.5 L28.5 16 L23 21.5 V18 H9 V21.5 Z"
PLUS = (f'<path d="M23.5 20.6 V26.4 M20.6 23.5 H26.4" stroke="{P}" stroke-width="1.6" '
        f'stroke-linecap="round"/>')
QMARK = (f'<path d="M21.6 22 q0-2 1.9-2 q1.9 0 1.9 1.7 q0 1.2-1.4 1.7 q-.5.2-.5 1 v.3" '
         f'fill="none" stroke="{P}" stroke-width="1.4" stroke-linecap="round"/>'
         f'<circle cx="23.5" cy="26.6" r=".85" fill="{P}"/>')
FRAMES, FRAME_MS = 12, 70

# name: (drawing, hotspot, other names that show it)
CURSORS = {
    "pointer": (two(HAND), (13, 5), ["hand2", "hand1", "pointing_hand"]),
    "text": (two(IBEAM), (16, 16), ["xterm", "ibeam", "vertical-text"]),
    "grab": (two(GRAB), (16, 16), ["openhand"]),
    "grabbing": (two(FIST), (16, 16), ["closedhand", "dnd-none"]),
    "move": (two(MOVE), (16, 16), ["fleur", "all-scroll", "size_all", "dnd-move"]),
    "ew-resize": (two(EW), (16, 16), ["col-resize", "e-resize", "w-resize", "sb_h_double_arrow",
                                      "h_double_arrow", "left_side", "right_side", "split_h", "size_hor"]),
    "ns-resize": (f'<g transform="rotate(90 16 16)">{two(EW)}</g>', (16, 16),
                  ["row-resize", "n-resize", "s-resize", "sb_v_double_arrow", "v_double_arrow",
                   "top_side", "bottom_side", "split_v", "size_ver"]),
    "nwse-resize": (f'<g transform="rotate(45 16 16)">{two(EW)}</g>', (16, 16),
                    ["nw-resize", "se-resize", "top_left_corner", "bottom_right_corner",
                     "size_fdiag", "bd_double_arrow"]),
    "nesw-resize": (f'<g transform="rotate(-45 16 16)">{two(EW)}</g>', (16, 16),
                    ["ne-resize", "sw-resize", "top_right_corner", "bottom_left_corner",
                     "size_bdiag", "fd_double_arrow"]),
    "crosshair": (lines("M16 4 V12 M16 20 V28 M4 16 H12 M20 16 H28")
                  + f'<circle cx="16" cy="16" r="1.6" fill="{P}"/><circle cx="16" cy="16" r="1" fill="{C}"/>',
                  (16, 16), ["cross", "tcross", "cell"]),
    "not-allowed": (lines("M16 7 a9 9 0 1 0 .01 0 Z M9.6 22.4 L22.4 9.6", 2.8), (16, 16),
                    ["no-drop", "dnd-no-drop", "crossed_circle", "forbidden", "circle"]),
    "help": (small_arrow() + badge(QMARK), (2, 4), ["question_arrow", "whats_this", "left_ptr_help", "dnd-ask"]),
    "copy": (small_arrow() + badge(PLUS), (2, 4), ["dnd-copy"]),
    "alias": (small_arrow() + badge(f'<path d="M21 26 L26 21 M22.6 21 H26 V24.4" fill="none" stroke="{P}" '
                                    f'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'),
              (2, 4), ["dnd-link", "link"]),
}
ANIMATED = {
    "wait": (lambda turn: spinner(16, 16, 9, 3.4, turn), (16, 16), ["watch"]),
    "progress": (lambda turn: small_arrow() + spinner(23.5, 23.5, 4.6, 2.4, turn), (2, 4),
                 ["left_ptr_watch", "half-busy"]),
}


def svg(inner):
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
            f'<g stroke-linejoin="round" stroke-linecap="round">{inner}</g></svg>\n')


def main():
    manifest = [{"name": "default", "frames": ["left_ptr.svg"], "hotspot": [3, 5],
                 "aliases": ["left_ptr", "arrow", "top_left_arrow", "left_arrow", "context-menu"]}]
    for name, (inner, hot, aliases) in CURSORS.items():
        (HERE / f"{name}.svg").write_text(svg(inner))
        manifest.append({"name": name, "frames": [f"{name}.svg"], "hotspot": list(hot), "aliases": aliases})
    for name, (draw, hot, aliases) in ANIMATED.items():
        frames = []
        for i in range(FRAMES):
            frame = f"{name}-{i + 1:02d}.svg"
            (HERE / frame).write_text(svg(draw(360 * i / FRAMES)))
            frames.append(frame)
        manifest.append({"name": name, "frames": frames, "hotspot": list(hot), "aliases": aliases,
                         "delay_ms": FRAME_MS})
    (HERE / "cursors.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"{len(manifest)} cursors drawn in {HERE}")


if __name__ == "__main__":
    main()
