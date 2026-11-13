/*
 * Rice-paper glass: a soft live blur behind Mutsu's Shell chrome (top bar,
 * quick settings, calendar). The tint and edge light live in japandi.css;
 * this adds what CSS can't do: the blur, and adaptive ink on the top bar
 * (.mutsu-glass-dark when the wallpaper behind it is dark).
 *
 * Off for high contrast, and every step is guarded: if this Shell has no
 * BlurEffect (or a newer one with different properties), the chrome simply
 * stays the tinted paper with no blur.
 */
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const EFFECT_NAME = 'mutsu-rice-paper-blur';
const RADIUS = 20;          // matches the "balanced" mock-up level
const BRIGHTNESS = 1.04;    // paper glows a touch, like light through shoji
// Ink adapts like Apple's bar: cream over a dark wallpaper strip.
const DARK_CLASS = 'mutsu-glass-dark';
const DARK_BELOW = 0.20;    // mean linear luminance of the strip behind the bar
// Dock running dots adapt the same way: charcoal with a light halo where the
// dock glass reads light, cream with a dark halo where it reads dark.
const DOCK_NAME = 'dashtodockContainer';
const DOCK_DARK_CLASS = 'mutsu-dock-dark';
const DOCK_LIGHT_CLASS = 'mutsu-dock-light';
// The dots sit low on the dock, where its milky glass (japandi.css
// .dash-background) is clearest: about 46% warm cream over the wallpaper.
const DOCK_GLASS = 0.46;
const DOCK_GLASS_LUMA = 0.83;   // linear luminance of that cream
const INK_LUMA = 0.028;         // charcoal #2B2F2C
const CREAM_LUMA = 0.92;        // cream #FBF7EE

function linear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// Mean luminance of some rows (and optionally columns) of a small (already
// scaled) pixbuf: the top rows by default.
export function stripLuminance(pix, rows, {fromBottom = false, x0 = 0, x1 = 1} = {}) {
    const data = pix.read_pixel_bytes().get_data();
    const stride = pix.get_rowstride();
    const n = pix.get_n_channels();
    const h = pix.get_height(), w = pix.get_width();
    const first = fromBottom ? Math.max(0, h - rows) : 0;
    const last = fromBottom ? h : Math.min(rows, h);
    let sum = 0, count = 0;
    for (let y = first; y < last; y++) {
        for (let x = Math.floor(x0 * w); x < Math.ceil(x1 * w); x++) {
            const i = y * stride + x * n;
            sum += 0.2126 * linear(data[i]) + 0.7152 * linear(data[i + 1]) +
                0.0722 * linear(data[i + 2]);
            count++;
        }
    }
    return count ? sum / count : 1;
}

// What the eye sees behind the dots (the glass over the wallpaper strip),
// and whether cream contrasts with it better than charcoal (WCAG ratio).
export function dockReadsDark(wallpaperLuma, glass = DOCK_GLASS) {
    const seen = glass * DOCK_GLASS_LUMA + (1 - glass) * wallpaperLuma;
    const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return contrast(CREAM_LUMA, seen) > contrast(INK_LUMA, seen);
}

function makeBlur(cornerRadius = 0) {
    if (!Shell.BlurEffect)
        return null;
    const effect = new Shell.BlurEffect({mode: Shell.BlurMode.BACKGROUND});
    // Property names changed between Shell releases (sigma -> radius).
    if ('radius' in effect)
        effect.radius = RADIUS;
    else if ('sigma' in effect)
        effect.sigma = RADIUS / 2;
    if ('brightness' in effect)
        effect.brightness = BRIGHTNESS;
    // Without rounded blur, a menu's square blurred corners would show
    // outside its rounded paper, so only rectangular chrome gets it then.
    if (cornerRadius > 0) {
        if (!('corner_radius' in effect))
            return null;
        effect.corner_radius = cornerRadius;
    }
    return effect;
}

export class RiceGlass {
    constructor() {
        this._actors = [];
        this._a11y = null;
        this._a11yId = 0;
        try {
            this._a11y = new Gio.Settings({schema_id: 'org.gnome.desktop.a11y.interface'});
            this._a11yId = this._a11y.connect('changed::high-contrast', () => this._refresh());
        } catch (e) {
            this._a11y = null;
        }
        this._refresh();
        // Dash-to-Dock may build its dock after us or rebuild it later.
        this._retry = setTimeout(() => this._refresh(), 3000);
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._refresh());
        this._watchWallpaper();
    }

    _watchWallpaper() {
        this._serial = 0;
        this._bgIds = [];
        this._ifaceId = 0;
        try {
            this._bg = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
            this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            for (const key of ['picture-uri', 'picture-uri-dark'])
                this._bgIds.push(this._bg.connect(`changed::${key}`, () => this._sample()));
            this._ifaceId = this._iface.connect('changed::color-scheme', () => this._sample());
            this._sample();
        } catch (e) {
            log(`Mutsu glass: no adaptive ink (${e})`);
        }
    }

    // Read the wallpaper small and off the main thread; only the newest
    // request may change the bar.
    _sample() {
        const serial = ++this._serial;
        const dark = this._iface.get_string('color-scheme') === 'prefer-dark';
        const uri = this._bg.get_string(dark ? 'picture-uri-dark' : 'picture-uri');
        const done = isDark => {
            if (serial === this._serial && !this._destroyed)
                this._setDark(isDark);
        };
        let file;
        try {
            file = Gio.File.new_for_uri(uri);
        } catch (e) {
            done(false);
            return;
        }
        file.read_async(GLib.PRIORITY_LOW, null, (_f, res) => {
            let stream;
            try {
                stream = file.read_finish(res);
            } catch (e) {
                done(false);
                return;
            }
            // 16:9 at 96x54: the bar covers about the top two rows.
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, 96, 54, false, null, (_s, r) => {
                try {
                    const pix = GdkPixbuf.Pixbuf.new_from_stream_finish(r);
                    // The dock sits over the bottom few rows, centred.
                    const behind = stripLuminance(pix, 5, {fromBottom: true, x0: 0.25, x1: 0.75});
                    if (serial === this._serial && !this._destroyed)
                        this._setDockDark(dockReadsDark(behind));
                    done(stripLuminance(pix, 3) < DARK_BELOW);
                } catch (e) {
                    done(false);
                }
                stream.close_async(GLib.PRIORITY_LOW, null, null);
            });
        });
    }

    _setDockDark(isDark) {
        this._dockDark = isDark;
        const dock = Main.layoutManager.uiGroup.get_children().find(c => c.name === DOCK_NAME);
        if (!dock)
            return;
        dock.remove_style_class_name(isDark ? DOCK_LIGHT_CLASS : DOCK_DARK_CLASS);
        dock.add_style_class_name(isDark ? DOCK_DARK_CLASS : DOCK_LIGHT_CLASS);
    }

    _clearDock() {
        const dock = Main.layoutManager.uiGroup.get_children().find(c => c.name === DOCK_NAME);
        dock?.remove_style_class_name(DOCK_DARK_CLASS);
        dock?.remove_style_class_name(DOCK_LIGHT_CLASS);
    }

    _setDark(isDark) {
        if (isDark)
            Main.panel.add_style_class_name(DARK_CLASS);
        else
            Main.panel.remove_style_class_name(DARK_CLASS);
    }

    _targets() {
        const out = [[Main.panel, 0]];
        const status = Main.panel.statusArea ?? {};
        for (const key of ['quickSettings', 'dateMenu']) {
            const box = status[key]?.menu?.box;
            if (box)
                out.push([box, 13]);
        }
        // The desktop dock's blur comes from Kiwi (dockBlur.js).
        return out;
    }

    _refresh() {
        this._clear();
        if (this._dockDark !== undefined)
            this._setDockDark(this._dockDark);
        try {
            if (this._a11y?.get_boolean('high-contrast'))
                return;
        } catch (e) {}
        for (const [actor, corner] of this._targets()) {
            try {
                const effect = makeBlur(corner);
                if (!effect)
                    continue;
                actor.add_effect_with_name(EFFECT_NAME, effect);
                this._actors.push(actor);
            } catch (e) {
                log(`Mutsu glass: no blur for ${actor} (${e})`);
            }
        }
    }

    _clear() {
        for (const actor of this._actors) {
            try {
                actor.remove_effect_by_name(EFFECT_NAME);
            } catch (e) {}
        }
        this._actors = [];
    }

    destroy() {
        this._destroyed = true;
        this._clear();
        clearTimeout(this._retry);
        if (this._monitorsId)
            Main.layoutManager.disconnect(this._monitorsId);
        this._monitorsId = 0;
        Main.panel.remove_style_class_name(DARK_CLASS);
        this._clearDock();
        for (const id of this._bgIds ?? [])
            this._bg.disconnect(id);
        if (this._ifaceId)
            this._iface.disconnect(this._ifaceId);
        this._bgIds = [];
        this._ifaceId = 0;
        if (this._a11y && this._a11yId)
            this._a11y.disconnect(this._a11yId);
        this._a11y = null;
        this._a11yId = 0;
    }
}
