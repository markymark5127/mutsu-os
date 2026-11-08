// Tablet mode from the screen's orientation, for 2-in-1s whose firmware
// misses the fold (some Lenovo Yogas only report "tablet" when the laptop
// is level, so folding and immediately turning it sideways never switches).
// A laptop is never used with its screen sideways or upside down, so holding
// it that way for a moment means tablet (portrait) or tent (upside down).
// Typing on the keyboard or using the touchpad with the screen upright again
// means it is a laptop again.
//
// The screen's orientation comes from iio-sensor-proxy (the same sensor
// GNOME rotates with). GNOME only rotates the screen while its own tablet
// switch is on, so in this case Mutsu rotates it through DisplayConfig.

export const TILTED = ['left-up', 'right-up', 'bottom-up'];
export const TILT_DWELL_MS = 1200;

// state: {orientation, since, latched}. Returns the next state.
export function updateTiltLatch(state, orientation, now, dwell = TILT_DWELL_MS) {
    const next = {...state};
    if (orientation !== state.orientation) {
        next.orientation = orientation;
        next.since = now;
    }
    if (TILTED.includes(next.orientation) && now - next.since >= dwell)
        next.latched = true;
    return next;
}

// Laptop use (keyboard, touchpad, mouse) with the screen upright again ends it.
export function clearTiltOnLaptopUse(state) {
    return TILTED.includes(state.orientation) ? state : {...state, latched: false};
}

// iio-sensor-proxy orientation to a Mutter monitor transform (as Mutter's
// own orientation manager maps it).
export function transformFor(orientation) {
    return {'left-up': 1, 'bottom-up': 2, 'right-up': 3}[orientation] ?? 0;
}

// Build ApplyMonitorsConfig logical monitors from GetCurrentState, with the
// built-in panel's logical monitor set to `transform`. Only for a single
// logical monitor (no external screens to re-arrange); otherwise null.
export function rotatedLogicalMonitors(monitors, logicalMonitors, transform, isBuiltin) {
    if (logicalMonitors.length !== 1)
        return null;
    const [x, y, scale, , primary, specs] = logicalMonitors[0];
    if (!specs.some(spec => isBuiltin(spec[0])))
        return null;
    const configs = [];
    for (const spec of specs) {
        const monitor = monitors.find(m => m[0][0] === spec[0]);
        const mode = monitor?.[1].find(m => m[6]?.['is-current']);
        if (!mode)
            return null;
        configs.push([spec[0], mode[0], {}]);
    }
    return [[x, y, scale, transform, primary, configs]];
}

export function isBuiltinConnector(connector) {
    return /^(eDP|LVDS|DSI)/i.test(connector ?? '');
}
