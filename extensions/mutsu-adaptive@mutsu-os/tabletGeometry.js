// Pure tablet geometry and decision helpers. No GNOME imports, so every
// function here is exercised directly by the Node checks in tests/.

export function navigationAction(dx, dy, elapsed, paused, height) {
    if (Math.abs(dx) > 72 && Math.abs(dx) > Math.abs(dy) * 1.25)
        return dx < 0 ? 'next' : 'previous';
    if (dy <= -Math.max(96, height * 0.14))
        return paused > 180 || elapsed > 550 ? 'switcher' : 'home';
    if (dy < -32)
        return 'dock';
    return Math.abs(dx) < 12 && Math.abs(dy) < 12 ? 'home' : 'cancel';
}

// Portrait (taller than wide, e.g. 9:16) stacks the pair top/bottom;
// landscape puts them side by side. `ratio` is the first pane's share.
export function splitVertical(area) {
    return area.height > area.width;
}

export function splitFrames(area, ratio, vertical = splitVertical(area)) {
    const gap = 12;
    const fraction = Math.max(0.3, Math.min(0.7, ratio));
    if (vertical) {
        const first = Math.round((area.height - gap) * fraction);
        return [
            {x: area.x, y: area.y, width: area.width, height: first},
            {x: area.x, y: area.y + first + gap, width: area.width, height: area.height - gap - first},
        ];
    }
    const first = Math.round((area.width - gap) * fraction);
    return [
        {x: area.x, y: area.y, width: first, height: area.height},
        {x: area.x + first + gap, y: area.y, width: area.width - gap - first, height: area.height},
    ];
}

// Slide Over: a phone-width app floating at the right edge.
// Slide Over's floating frame. The size is fixed; only x moves (the user can
// slide it along the screen). x defaults to the right side.
export function slideOverFrame(monitor, x = null) {
    const width = Math.round(Math.min(monitor.width * 0.4, Math.max(360, monitor.width * 0.32)));
    const min = monitor.x + 12, max = monitor.x + monitor.width - width - 12;
    return {x: x === null ? max : Math.round(Math.max(min, Math.min(max, x))),
        y: monitor.y + 72, width, height: monitor.height - 112};
}

// After Slide Over is dragged sideways (by its handle or title bar): a quick
// flick tucks it away to that side of the screen; anything slower just leaves
// it where it was dropped. velocity is px/ms over the last moments of the drag.
export const SLIDE_FLICK_VELOCITY = 0.9;
export function slideOverRelease(dx, velocity) {
    if (Math.abs(velocity) >= SLIDE_FLICK_VELOCITY && Math.abs(dx) >= 30 &&
        Math.sign(velocity) === Math.sign(dx))
        return dx < 0 ? 'tuck-left' : 'tuck-right';
    if (Math.abs(dx) < 8)
        return 'tap';
    return 'move';
}

// Recent-drag velocity (px/ms) from [time, x] samples, newest last.
export function dragVelocity(samples, windowMs = 90) {
    if (samples.length < 2)
        return 0;
    const [tEnd, xEnd] = samples[samples.length - 1];
    let first = samples[samples.length - 2];
    for (let i = samples.length - 2; i >= 0 && tEnd - samples[i][0] <= windowMs; i--)
        first = samples[i];
    const dt = tEnd - first[0];
    return dt > 0 ? (xEnd - first[1]) / dt : 0;
}

// Where an app dragged out of the dock lands. Edges split the screen with
// the current app; elsewhere above the dock floats it in Slide Over.
export function dockDropZone(x, y, monitor, dockTop) {
    if (y > dockTop - 24)
        return null; // back over the dock: cancel
    const rel = (x - monitor.x) / monitor.width;
    if (rel < 0.14)
        return 'split-left';
    if (rel > 0.86)
        return 'split-right';
    return 'slide';
}

// Bottom-right grip resize for floating windows, kept on screen and above
// a usable minimum size.
export function gripResize(rect, dx, dy, monitor, min = {width: 360, height: 240}) {
    const maxW = monitor.x + monitor.width - rect.x;
    const maxH = monitor.y + monitor.height - rect.y;
    return {x: rect.x, y: rect.y,
        width: Math.round(Math.max(min.width, Math.min(maxW, rect.width + dx))),
        height: Math.round(Math.max(min.height, Math.min(maxH, rect.height + dy)))};
}

export function maximizeWindow(window, Meta) {
    // Mutter 49 removed the flags argument; 46–48 require it.
    if (Meta.MaximizeFlags)
        window.maximize(Meta.MaximizeFlags.BOTH);
    else
        window.maximize();
}

export function unmaximizeWindow(window, Meta) {
    if (Meta.MaximizeFlags)
        window.unmaximize(Meta.MaximizeFlags.BOTH);
    else
        window.unmaximize();
}

export function isWindowMaximized(window) {
    // Mutter 49 replaced get_maximized() with is_maximized().
    if (typeof window.is_maximized === 'function')
        return !!window.is_maximized();
    return !!window.get_maximized?.();
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Home grid for a monitor in logical pixels. Portrait and landscape both
// keep a fixed header (clock + search), page dots and the Home dock.
export const HOME_TOP_BAR = 32;
export function homeMetrics(width, height, widgets = true) {
    const short = Math.min(width, height);
    const icon = clamp(Math.round(short / 12), 56, 80);
    const cellW = icon + 64;
    const cellH = icon + 50;
    const pad = Math.round(clamp(width * 0.06, 20, 96));
    const header = widgets ? 104 : 56;
    const dockIcon = Math.round(icon * 0.82);
    const dock = dockIcon + 44;
    const dots = 28;
    const gridY = HOME_TOP_BAR + header;
    const gridW = width - pad * 2;
    const gridH = Math.max(cellH * 2, height - gridY - dots - dock - 24);
    const cols = clamp(Math.floor(gridW / cellW), 4, 8);
    const rows = clamp(Math.floor(gridH / cellH), 3, 6);
    return {
        icon, cols, rows, perPage: cols * rows,
        cellW: gridW / cols, cellH: gridH / rows,
        gridX: pad, gridY, gridW, gridH,
        headerY: HOME_TOP_BAR + 8, header,
        dotsY: gridY + gridH + 4,
        dockIcon, dockHeight: dock, dockY: height - dock - 16,
        portrait: height > width,
    };
}

// Which slot a point on the grid addresses. `onto` is true near an icon's
// centre: dropping there makes (or joins) a folder instead of reordering.
export function slotAt(x, y, m) {
    const col = clamp(Math.floor((x - m.gridX) / m.cellW), 0, m.cols - 1);
    const row = clamp(Math.floor((y - m.gridY) / m.cellH), 0, m.rows - 1);
    const cx = m.gridX + (col + 0.5) * m.cellW;
    const cy = m.gridY + row * m.cellH + m.icon / 2 + 8;
    const onto = Math.abs(x - cx) < m.icon * 0.3 && Math.abs(y - cy) < m.icon * 0.3;
    return {index: row * m.cols + col, col, row, onto};
}

// Page to settle on after a horizontal swipe. Velocity in px/ms.
export function pageSnap(page, dx, velocity, width, pageCount) {
    let target = page;
    if (Math.abs(dx) > width * 0.22 || (Math.abs(velocity) > 0.45 && Math.abs(dx) > 24))
        target += dx < 0 ? 1 : -1;
    return clamp(target, 0, Math.max(0, pageCount - 1));
}

// Direction of a drag once it has left the touch slop, or null while it is
// still a possible tap/long-press or the direction is ambiguous.
export function classifyDrag(dx, dy, slop = 12) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < slop)
        return null;
    if (Math.abs(dx) > Math.abs(dy) * 1.2)
        return 'horizontal';
    if (Math.abs(dy) > Math.abs(dx) * 1.2)
        return dy < 0 ? 'up' : 'down';
    return null;
}

// Pull down from the middle of Home opens Mutsu Search. The top band stays
// reserved for Notifications / Controls, as on iPadOS.
export function pullDownAllowed(x, y, monitor) {
    return y > monitor.y + 72 && y < monitor.y + monitor.height * 0.8 &&
        x > monitor.x + monitor.width * 0.12 && x < monitor.x + monitor.width * 0.88;
}
export const PULL_SEARCH_PX = 72;

// Perspective for multitasking blades. `offset` is the distance of a blade
// from the viewport centre in blade widths: 0 is the focused blade.
export function bladeTransform(offset) {
    const distance = Math.min(Math.abs(offset), 3);
    return {
        angle: clamp(-offset * 9, -24, 24),
        scale: 1 - Math.min(distance, 2) * 0.07,
        opacity: Math.round(255 - distance * 30),
    };
}

// Blades are per app, newest first; each app lists its own windows MRU.
export function groupWindows(windows, keyFor) {
    const groups = new Map();
    for (const window of windows) {
        const key = keyFor(window);
        if (!groups.has(key))
            groups.set(key, {key, windows: []});
        groups.get(key).windows.push(window);
    }
    return [...groups.values()];
}

// Hinge angle with hysteresis so a laptop opened flat does not flicker.
// Hinge angle (0 closed, 180 flat, 360 folded into a tablet) to posture.
// threshold: tablet mode once the hinge opens past it. Leaving needs the
// hinge to close HINGE_HYSTERESIS degrees below it, so sensor jitter near
// the threshold does not flap. "Fully folded" (>= 355) enters at 340:
// sensors rarely report a full 360.
export const HINGE_HYSTERESIS = 25;
export function hingeTablet(angle, previous, threshold = 200) {
    if (angle === null || angle === undefined || Number.isNaN(angle))
        return null;
    const enter = threshold >= 355 ? 340 : threshold;
    if (angle >= enter)
        return true;
    if (angle <= enter - HINGE_HYSTERESIS)
        return false;
    return !!previous;
}

// Hinge angle from two accelerometers, one in the display and one in the
// base (as on convertibles without a hinge-angle sensor). Each vector is in
// its part's own frame after the mount matrix: x along the hinge, y up the
// screen / toward the back of the keyboard, z out of the screen / up from the
// keyboard. Returns null when the hinge points at the ground (gravity along
// the hinge says nothing about the angle).
export function hingeFromAccels(display, base, minShare = 0.5) {
    const [, dy, dz] = display, [, by, bz] = base;
    const gd = Math.hypot(...display), gb = Math.hypot(...base);
    if (!gd || !gb || Math.hypot(dy, dz) < minShare * gd || Math.hypot(by, bz) < minShare * gb)
        return null;
    const degrees = (Math.atan2(dz, dy) - Math.atan2(bz, by)) * 180 / Math.PI + 180;
    return Math.round(((degrees % 360) + 360) % 360);
}

// When the user picked a hinge angle and the laptop reports one, the angle
// alone decides (GNOME's own tablet switch is ignored); otherwise Automatic
// follows the laptop's tablet switch / touch mode.
// Effective posture. A manual override from the Quick Settings toggle wins
// in Automatic mode until the hardware posture next changes.
export function resolveTablet({mode, override = null, seatTouch = false, hardware = null, angleDecides = false,
    tilted = false}) {
    if (mode === 'always-tablet')
        return true;
    if (mode === 'always-desktop')
        return false;
    if (override !== null && override !== undefined)
        return !!override;
    // Screen held sideways / upside down (firmware that missed the fold).
    if (tilted)
        return true;
    if (angleDecides)
        return hardware === true;
    return !!seatTouch || hardware === true;
}

// Entering tablet mode: the app on top becomes the full-screen app, and
// every other open window steps into multitasking (minimized). A tiled pair
// stays together as Split View. `windows` are the visible windows of the
// tablet monitor, most recently used first.
export function planTabletEntry(windows, focus, partnerOf = () => null) {
    const top = windows.includes(focus) ? focus : windows[0] ?? null;
    if (!top)
        return {foreground: null, pair: null, minimize: []};
    const partner = partnerOf(top);
    const pair = partner && partner !== top && windows.includes(partner) ? [top, partner] : null;
    const keep = pair ?? [top];
    return {foreground: top, pair, minimize: windows.filter(w => !keep.includes(w))};
}

// Leaving tablet mode: what is on screen stays (the full-screen app, or the
// Split View pair when one of them has focus); everything else that is
// still showing (Slide Over, apps behind) goes to minimized.
export function planTabletExit(windows, focus, pair = null) {
    let keep;
    if (pair && pair.includes(focus))
        keep = pair;
    else if (windows.includes(focus))
        keep = [focus];
    else
        keep = windows.slice(0, 1);
    return windows.filter(w => !keep.includes(w));
}

// GJS hands out a new wrapper object for the same touch sequence on every
// event, so `a === b` is false for one finger's begin and end. Compare the
// touch slot instead; with no slot API, any two touches count as the same
// finger (routers track one finger at a time).
export function sameSequence(a, b) {
    if (a === b)
        return true;
    if (!a || !b)
        return false;
    try {
        if (typeof a.get_slot === 'function' && typeof b.get_slot === 'function')
            return a.get_slot() === b.get_slot();
    } catch (e) {}
    return true;
}
