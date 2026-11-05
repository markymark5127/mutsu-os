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

export function splitFrames(area, ratio) {
    const gap = 12;
    // Clamp the divider so neither app can be reduced to a sliver.
    const fraction = Math.max(0.3, Math.min(0.7, ratio));
    const first = Math.round((area.width - gap) * fraction);
    return [
        {x: area.x, y: area.y, width: first, height: area.height},
        {x: area.x + first + gap, y: area.y,
            width: area.width - gap - first, height: area.height},
    ];
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
export function hingeTablet(angle, previous) {
    if (angle === null || angle === undefined || Number.isNaN(angle))
        return null;
    if (angle >= 200)
        return true;
    if (angle <= 160)
        return false;
    return !!previous;
}

// Effective posture. A manual override from the Quick Settings toggle wins
// in Automatic mode until the hardware posture next changes.
export function resolveTablet({mode, override = null, seatTouch = false, hardware = null}) {
    if (mode === 'always-tablet')
        return true;
    if (mode === 'always-desktop')
        return false;
    if (override !== null && override !== undefined)
        return !!override;
    return !!seatTouch || hardware === true;
}
