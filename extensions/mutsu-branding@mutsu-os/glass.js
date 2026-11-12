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
    }

    _targets() {
        const out = [[Main.panel, 0]];
        const status = Main.panel.statusArea ?? {};
        for (const key of ['quickSettings', 'dateMenu']) {
            const box = status[key]?.menu?.box;
            if (box)
                out.push([box, 13]);
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
        if (this._a11y && this._a11yId)
            this._a11y.disconnect(this._a11yId);
        this._a11y = null;
        this._a11yId = 0;
    }
}
