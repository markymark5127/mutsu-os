// On-screen gamepad: the parts that are plain math, testable in Node.

export const STICK_MAX = 32767;
export const STICK_DEADZONE = 0.12; // fraction of the stick's travel
export const DPAD_DEADZONE = 0.3;

// Games Steam launches get a window class of steam_app_<id> (Proton and most
// native games); a few report steam_app_default.
export function isSteamGame(wmClass, appId = '') {
    const ids = [wmClass, appId].filter(Boolean).map(s => String(s).toLowerCase());
    return ids.some(id => /^steam_app_(\d+|default)$/.test(id));
}

// Finger offset from the stick's centre -> axis values. Up is negative
// (Linux / Xbox convention). The knob stops at the rim; inside the dead zone
// the stick reads centred.
export function stickValue(dx, dy, radius, deadzone = STICK_DEADZONE) {
    const length = Math.hypot(dx, dy);
    if (!radius || length <= radius * deadzone)
        return {x: 0, y: 0, knobX: dx, knobY: dy};
    const clamped = Math.min(length, radius);
    const ux = dx / length, uy = dy / length;
    // Rescale so the edge of the dead zone is 0 and the rim is full tilt.
    const amount = (clamped - radius * deadzone) / (radius * (1 - deadzone));
    return {
        x: Math.round(ux * amount * STICK_MAX),
        y: Math.round(uy * amount * STICK_MAX),
        knobX: ux * clamped,
        knobY: uy * clamped,
    };
}

// Finger offset from the D-pad's centre -> hat [x, y], 8-way: diagonals
// cover 45 degrees around them, like a real pad.
export function dpadValue(dx, dy, size, deadzone = DPAD_DEADZONE) {
    if (Math.hypot(dx, dy) < size * deadzone)
        return [0, 0];
    const angle = Math.atan2(dy, dx); // 0 = right, positive = down
    const sector = Math.round(angle / (Math.PI / 4)); // -4..4
    const table = {
        0: [1, 0], 1: [1, 1], 2: [0, 1], 3: [-1, 1], 4: [-1, 0], '-4': [-1, 0],
        '-3': [-1, -1], '-2': [0, -1], '-1': [1, -1],
    };
    return table[sector];
}

// Where everything goes on a monitor. `left` is 'stick' | 'dpad', `face` is
// 'diamond' | 'gamecube'. Sizes follow the shorter screen side so it scales
// from 1280x800 laptops to tall portrait screens. Returns centres and radii
// (circles) or boxes (pills), all in stage coordinates.
export function gamepadLayout(monitor, left = 'stick', face = 'diamond', topInset = 32) {
    const short = Math.min(monitor.width, monitor.height);
    const u = Math.round(short * 0.085);
    const cy = monitor.y + Math.round(monitor.height * 0.70);
    const lx = monitor.x + Math.round(Math.max(u * 2.1, monitor.width * 0.14));
    const rx = monitor.x + monitor.width - Math.round(Math.max(u * 2.1, monitor.width * 0.14));
    const pill = (x, y, w, h) => ({x: Math.round(x - w / 2), y: Math.round(y - h / 2),
        width: Math.round(w), height: Math.round(h)});

    const layout = {unit: u, left, face, buttons: {}};
    if (left === 'dpad') {
        layout.dpad = {cx: lx, cy, size: Math.round(u * 1.3)};
    } else {
        layout.stick = {cx: lx, cy, radius: Math.round(u * 1.25), knob: Math.round(u * 0.55)};
    }
    const b = (name, dx, dy, r) => {
        layout.buttons[name] = {cx: Math.round(rx + dx * u), cy: Math.round(cy + dy * u),
            radius: Math.round(r * u)};
    };
    if (face === 'gamecube') {
        // Big A in the middle, small B down-left, X right, Y on top.
        b('a', 0, 0, 0.78);
        b('b', -1.12, 0.78, 0.42);
        b('x', 1.36, -0.3, 0.5);
        b('y', -0.35, -1.34, 0.5);
    } else {
        // Xbox-style diamond: Y top, B right, A bottom, X left.
        b('y', 0, -1, 0.5);
        b('b', 1, 0, 0.5);
        b('a', 0, 1, 0.5);
        b('x', -1, 0, 0.5);
    }
    // Shoulders: L / R with ZL / ZR above them, near the top corners.
    const shoulderY = cy - u * 2.9;
    layout.buttons.l = {...pill(lx, shoulderY, u * 1.7, u * 0.75), kind: 'pill'};
    layout.buttons.zl = {...pill(lx, shoulderY - u * 1.0, u * 1.7, u * 0.75), kind: 'pill'};
    layout.buttons.r = {...pill(rx, shoulderY, u * 1.7, u * 0.75), kind: 'pill'};
    layout.buttons.zr = {...pill(rx, shoulderY - u * 1.0, u * 1.7, u * 0.75), kind: 'pill'};
    // Select / Home / Start low in the centre, clear of the bottom edge
    // (swiping up from there still goes Home).
    const mid = monitor.x + Math.round(monitor.width / 2);
    const lowY = monitor.y + monitor.height - Math.round(u * 1.6);
    layout.buttons.select = {...pill(mid - u * 1.5, lowY, u * 1.1, u * 0.6), kind: 'pill'};
    layout.buttons.home = {...pill(mid, lowY, u * 1.1, u * 0.6), kind: 'pill'};
    layout.buttons.start = {...pill(mid + u * 1.5, lowY, u * 1.1, u * 0.6), kind: 'pill'};
    // Small toggles under each cluster, and hide at the top centre.
    layout.toggles = {
        left: pill(lx, cy + u * 2.0, u * 2.4, u * 0.55),
        face: pill(rx, cy + u * 2.0, u * 2.4, u * 0.55),
        hide: pill(mid, monitor.y + topInset + u * 0.45, u * 1.6, u * 0.55),
    };
    return layout;
}

// Which face button a point is over (for sliding between buttons), or null.
export function faceButtonAt(layout, x, y) {
    let best = null, bestDistance = Infinity;
    for (const name of ['a', 'b', 'x', 'y']) {
        const button = layout.buttons[name];
        const distance = Math.hypot(x - button.cx, y - button.cy);
        // A little forgiveness around each button.
        if (distance <= button.radius * 1.25 && distance < bestDistance) {
            best = name;
            bestDistance = distance;
        }
    }
    return best;
}

// What one control sends: {k: [name, 0|1]}, {a: [axis, value]}, {h: [x, y]}.
export function encode(commands) {
    return commands.map(c => {
        if (c.k)
            return `k ${c.k[0]} ${c.k[1] ? 1 : 0}`;
        if (c.a)
            return `a ${c.a[0]} ${Math.round(c.a[1])}`;
        if (c.h)
            return `h ${c.h[0]} ${c.h[1]}`;
        return '';
    }).filter(Boolean).join(';');
}

export const TRIGGERS = new Set(['zl', 'zr']);
