/*
 * Shoji Glass dock: the focused app sits in a soft liquid-glass capsule
 * tinted with its own icon's colour (warm for Firefox, blue for Steam...),
 * instead of a flat highlight. Japandi only, off in high contrast.
 *
 * Dash-to-Dock draws the icons; its focused app icon is found by its
 * `focused` property. The capsule is an inline style on that icon's
 * .overview-icon box: inline styles win over the extension stylesheets
 * (Dash-to-Dock's own focus wash), and it is removed as focus moves on.
 * Icon colours are read once per app, small and off the main thread.
 */
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DOCK_NAME = 'dashtodockContainer';
const WARM = [236, 160, 112];   // when an icon has no clear colour of its own

// The icon's characteristic colour: an average weighted toward saturated,
// opaque, reasonably bright pixels, so outlines and shadows don't win.
export function iconColour(pixels, width, height, stride, channels) {
    let r = 0, g = 0, b = 0, total = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * stride + x * channels;
            const a = channels === 4 ? pixels[i + 3] / 255 : 1;
            if (a < 0.5)
                continue;
            const pr = pixels[i], pg = pixels[i + 1], pb = pixels[i + 2];
            const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb);
            const sat = max ? (max - min) / max : 0;
            const weight = a * (0.05 + sat ** 1.5) * (0.3 + max / 255);
            r += pr * weight;
            g += pg * weight;
            b += pb * weight;
            total += weight;
        }
    }
    if (total < 1e-3)
        return WARM;
    const c = [r / total, g / total, b / total];
    const max = Math.max(...c), min = Math.min(...c);
    // Near-grey icons (terminals, files) get the warm Japandi capsule.
    return max - min < 24 ? WARM : c.map(Math.round);
}

// Inline style for the capsule: lit glass on top, the app's colour below.
export function capsuleStyle([r, g, b]) {
    const mix = (c, t) => Math.round(c + (255 - c) * t);
    return 'background-gradient-direction: vertical;' +
        `background-color: rgba(${mix(r, 0.45)}, ${mix(g, 0.45)}, ${mix(b, 0.45)}, 0.88);` +
        `background-gradient-start: rgba(${mix(r, 0.45)}, ${mix(g, 0.45)}, ${mix(b, 0.45)}, 0.88);` +
        `background-gradient-end: rgba(${r}, ${g}, ${b}, 0.72);` +
        'border: 1px solid rgba(255, 255, 255, 0.75);' +
        'border-radius: 16px;' +
        'transition-duration: 220ms;';
}

export class DockLiquid {
    constructor() {
        this._colours = new Map();     // app id -> [r, g, b] | 'pending'
        this._styled = new Set();      // overview-icon actors we styled
        this._timeouts = new Set();
        this._destroyed = false;
        this._theme = null;
        try {
            this._theme = new St.IconTheme();
        } catch (e) {}
        this._a11y = null;
        this._a11yId = 0;
        try {
            this._a11y = new Gio.Settings({schema_id: 'org.gnome.desktop.a11y.interface'});
            this._a11yId = this._a11y.connect('changed::high-contrast', () => this._sync());
        } catch (e) {
            this._a11y = null;
        }
        this._tracker = Shell.WindowTracker.get_default();
        this._focusId = this._tracker.connect('notify::focus-app', () => this._syncSoon());
        // Dash-to-Dock builds and rebuilds its icons after us.
        this._addedId = Main.layoutManager.uiGroup.connect('child-added', () => this._syncSoon(500));
        this._windowId = global.display.connect('window-created', () => this._syncSoon(600));
        this._syncSoon(1500);
    }

    _syncSoon(delay = 0) {
        // After Dash-to-Dock has updated its own `focused` flags.
        const id = GLib.timeout_add(GLib.PRIORITY_LOW, delay, () => {
            this._timeouts.delete(id);
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
    }

    _icons() {
        const out = [];
        const walk = actor => {
            if (actor.app && 'focused' in actor && actor.icon) {
                out.push(actor);
                return;
            }
            for (const child of actor.get_children?.() ?? [])
                walk(child);
        };
        for (const child of Main.layoutManager.uiGroup.get_children()) {
            if (child.name === DOCK_NAME)
                walk(child);
        }
        return out;
    }

    _sync() {
        if (this._destroyed)
            return;
        const keep = new Set();
        let highContrast = false;
        try {
            highContrast = this._a11y?.get_boolean('high-contrast') ?? false;
        } catch (e) {}
        for (const tile of highContrast ? [] : this._icons()) {
            if (!tile.focused)
                continue;
            const colour = this._colourFor(tile.app);
            if (!colour)
                continue;  // read in flight; _sync runs again when it lands
            try {
                tile.icon.set_style(capsuleStyle(colour));
                keep.add(tile.icon);
            } catch (e) {}
        }
        for (const actor of this._styled) {
            if (!keep.has(actor)) {
                try {
                    actor.set_style(null);
                } catch (e) {}
            }
        }
        this._styled = keep;
    }

    _colourFor(app) {
        const id = app.get_id?.() ?? `${app}`;
        const known = this._colours.get(id);
        if (Array.isArray(known))
            return known;
        if (known === 'pending')
            return null;
        this._colours.set(id, 'pending');
        this._read(app, id);
        return null;
    }

    _iconPath(app) {
        const gicon = app.get_icon?.();
        if (!gicon)
            return null;
        if (gicon instanceof Gio.FileIcon)
            return gicon.get_file().get_path();
        const info = this._theme?.lookup_by_gicon(gicon, 48, St.IconLookupFlags.FORCE_SIZE);
        return info?.get_filename?.() ?? null;
    }

    _read(app, id) {
        const done = colour => {
            if (this._destroyed)
                return;
            this._colours.set(id, colour);
            this._sync();
        };
        let path = null;
        try {
            path = this._iconPath(app);
        } catch (e) {}
        if (!path) {
            done(WARM);
            return;
        }
        const file = Gio.File.new_for_path(path);
        file.read_async(GLib.PRIORITY_LOW, null, (_f, res) => {
            let stream;
            try {
                stream = file.read_finish(res);
            } catch (e) {
                done(WARM);
                return;
            }
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, 32, 32, true, null, (_s, r) => {
                try {
                    const pix = GdkPixbuf.Pixbuf.new_from_stream_finish(r);
                    done(iconColour(pix.read_pixel_bytes().get_data(), pix.get_width(),
                        pix.get_height(), pix.get_rowstride(), pix.get_n_channels()));
                } catch (e) {
                    done(WARM);
                }
                stream.close_async(GLib.PRIORITY_LOW, null, null);
            });
        });
    }

    destroy() {
        this._destroyed = true;
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        this._tracker.disconnect(this._focusId);
        Main.layoutManager.uiGroup.disconnect(this._addedId);
        global.display.disconnect(this._windowId);
        if (this._a11y && this._a11yId)
            this._a11y.disconnect(this._a11yId);
        for (const actor of this._styled) {
            try {
                actor.set_style(null);
            } catch (e) {}
        }
        this._styled.clear();
    }
}
