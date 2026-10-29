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
