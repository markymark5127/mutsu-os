/*
 * Mac-style window sizes on the desktop. A new app window opens as a
 * window, centred and nearly filling the space between the top bar and the
 * dock, never maximized or edge to edge. GNOME maximizes anything that
 * opens near screen size (Mutter's auto-maximize, switched off in
 * 30-mutsu-mac-defaults), and many apps reopen maximized because they
 * remember it; both are undone here once, when the window first appears.
 * After that the person can maximize or resize as they like.
 *
 * Left alone: full-screen windows (games, video), dialogs and other
 * non-normal windows, windows that can't be resized, windows already
 * smaller than the target, and everything in tablet mode (Mutsu Adaptive
 * keeps apps full screen there; it sets globalThis.mutsuTabletMode).
 */
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

// Share of the work area (top bar and dock excluded) a large window takes.
export const FILL = 0.92;

// Where a newly shown window should go, or null to leave it as it is.
// rect and area are {x, y, width, height}.
export function macFrame(rect, area, maximized, fill = FILL) {
    const width = Math.round(area.width * fill);
    const height = Math.round(area.height * fill);
    if (!maximized && rect.width <= width && rect.height <= height)
        return null;
    const w = Math.min(rect.width, width);
    const h = Math.min(rect.height, height);
    return {
        x: area.x + Math.round((area.width - (maximized ? width : w)) / 2),
        y: area.y + Math.round((area.height - (maximized ? height : h)) / 2),
        width: maximized ? width : w,
        height: maximized ? height : h,
    };
}

function isMaximized(window) {
    // Mutter 49 replaced get_maximized() with is_maximized().
    if (typeof window.is_maximized === 'function')
        return !!window.is_maximized();
    return !!window.get_maximized?.();
}

function unmaximize(window) {
    // Mutter 49 removed the flags argument; 46–48 require it.
    if (Meta.MaximizeFlags)
        window.unmaximize(Meta.MaximizeFlags.BOTH);
    else
        window.unmaximize();
}

function eligible(window) {
    if (globalThis.mutsuTabletMode)
        return false;
    if (window.get_window_type() !== Meta.WindowType.NORMAL)
        return false;
    if (window.get_transient_for() || window.is_fullscreen())
        return false;
    if (typeof window.allows_resize === 'function' && !window.allows_resize())
        return false;
    return true;
}

export class MacWindowSizing {
    constructor() {
        this._pending = new Map();   // window -> 'shown' handler id
        this._idles = new Set();
        this._createdId = global.display.connect('window-created', (_d, window) => {
            // Wait until the client has set its type, size and saved state.
            const id = window.connect('shown', () => {
                this._forget(window);
                this._fit(window);
            });
            this._pending.set(window, id);
            // Closed before it was ever shown.
            window.connect('unmanaged', () => this._forget(window));
        });
    }

    _forget(window) {
        const id = this._pending.get(window);
        this._pending.delete(window);
        try {
            if (id)
                window.disconnect(id);
        } catch (e) {}
    }

    _fit(window) {
        try {
            if (!eligible(window))
                return;
            const maximized = isMaximized(window);
            const frame = macFrame(window.get_frame_rect(),
                window.get_work_area_current_monitor(), maximized);
            if (!frame)
                return;
            if (maximized)
                unmaximize(window);
            // After the unmaximize has settled, or Mutter puts back the
            // app's own (often screen-sized) unmaximized size.
            const idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._idles.delete(idle);
                try {
                    if (!window.is_fullscreen() && !isMaximized(window))
                        window.move_resize_frame(false, frame.x, frame.y, frame.width, frame.height);
                } catch (e) { /* closed meanwhile */ }
                return GLib.SOURCE_REMOVE;
            });
            this._idles.add(idle);
        } catch (e) {
            log(`Mutsu window sizing: ${e}`);
        }
    }

    destroy() {
        if (this._createdId)
            global.display.disconnect(this._createdId);
        this._createdId = 0;
        for (const window of [...this._pending.keys()])
            this._forget(window);
        for (const idle of this._idles)
            GLib.source_remove(idle);
        this._idles.clear();
    }
}
