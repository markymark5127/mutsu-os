/*
 * Rice-paper glass: a soft live blur behind Mutsu's Shell chrome (top bar,
 * quick settings, calendar). The tan tint and edge light live in japandi.css;
 * this only adds the blur that CSS can't do.
 *
 * Off for high contrast, and every step is guarded: if this Shell has no
 * BlurEffect (or a newer one with different properties), the chrome simply
 * stays the tinted paper with no blur.
 */
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const EFFECT_NAME = 'mutsu-rice-paper-blur';
const RADIUS = 20;          // matches the "balanced" mock-up level
const BRIGHTNESS = 1.04;    // paper glows a touch, like light through shoji

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
    }

    _targets() {
        const out = [[Main.panel, 0]];
        const status = Main.panel.statusArea ?? {};
        for (const key of ['quickSettings', 'dateMenu']) {
            const box = status[key]?.menu?.box;
            if (box)
                out.push([box, 13]);
        }
        // Dash-to-Dock's pill, at its own rounding.
        const find = (actor, found) => {
            if (actor.has_style_class_name?.('dash-background'))
                found.push(actor);
            for (const child of actor.get_children?.() ?? [])
                find(child, found);
            return found;
        };
        for (const pill of find(Main.layoutManager.uiGroup, [])) {
            let radius = 21;
            try {
                radius = pill.get_theme_node().get_border_radius(St.Corner.TOPLEFT) || radius;
            } catch (e) {}
            out.push([pill, radius]);
        }
        return out;
    }

    _refresh() {
        this._clear();
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
        this._clear();
        clearTimeout(this._retry);
        if (this._monitorsId)
            Main.layoutManager.disconnect(this._monitorsId);
        this._monitorsId = 0;
        if (this._a11y && this._a11yId)
            this._a11y.disconnect(this._a11yId);
        this._a11y = null;
        this._a11yId = 0;
    }
}
