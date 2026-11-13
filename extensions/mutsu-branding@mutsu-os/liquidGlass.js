/*
 * Liquid glass, as a real effect: a GLSL shader on Mutsu's glass surfaces
 * (every popup menu, quick settings, the calendar, notification banners and
 * the dock) that turns the flat Japandi tint into a thick pane of glass:
 *
 *   - a lit rim, brightest where the light (from above, a little left)
 *     strikes the edge, with a softer catch-light on the lower edge
 *   - refraction: near the rounded edge the pane bends what it shows inward,
 *     like the thick edge of a lens
 *   - a soft bevel glow along the lit side and a gentle sheen at the top
 *
 * Plus the dock's reflection: its icons mirrored on the "floor" below it,
 * fading out and softly blurred.
 *
 * The colours stay Japandi (japandi.css owns them); this only adds light.
 * Japandi only, off in high contrast and when the liquid-glass key is off.
 * Every step is guarded: without shader support the surfaces simply stay
 * the plain tinted glass.
 */
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const EFFECT_NAME = 'mutsu-liquid-glass';
const DOCK_NAME = 'dashtodockContainer';
const REFLECTION_NAME = 'mutsu-dock-reflection';
export const REFLECTION_DEPTH = 26;   // px of floor below the dock (japandi.css margin)

// Each effect is a Clutter.OffscreenEffect: Clutter paints the actor into a
// texture (premultiplied alpha) and we draw that texture back through our own
// Cogl pipeline with a fragment snippet. In the snippet, layer 0 is the
// actor: cogl_sampler0 at cogl_tex_coord0_in.

const GLASS_DECLARATIONS = `
uniform float tex_w;
uniform float tex_h;
uniform float rect_x;
uniform float rect_y;
uniform float width;
uniform float height;
uniform float radius;
uniform float strength;
uniform float refract;      // 0 = no bending (panes with text right at the edge)
uniform float bevel_px;     // how far in from the edge the bevel glow reaches
uniform float rim_alpha;    // the rim shows even where the pane's tint is faint

float mutsu_box(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + vec2(r);
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
`;

const GLASS_CODE = `
    // The texture is the actor's paint box, which can be a little larger
    // than the pane itself: work in texture pixels around the real pane.
    vec2 uv = cogl_tex_coord0_in.st;
    vec2 tex = vec2(tex_w, tex_h);
    vec2 size = vec2(width, height);
    vec2 half_size = size * 0.5;
    vec2 p = uv * tex - vec2(rect_x, rect_y) - half_size;
    float r = min(radius, min(half_size.x, half_size.y));
    float e = -mutsu_box(p, half_size, r);        // depth inside the pane, px
    vec2 n = vec2(mutsu_box(p + vec2(1.0, 0.0), half_size, r) - mutsu_box(p - vec2(1.0, 0.0), half_size, r),
                  mutsu_box(p + vec2(0.0, 1.0), half_size, r) - mutsu_box(p - vec2(0.0, 1.0), half_size, r));
    n = n / max(length(n), 0.0001);               // outward normal

    vec4 base = texture2D(cogl_sampler0, uv);

    // Refraction: the thick edge pulls what it shows inward, like a lens rim.
    float k = clamp(1.0 - e / 22.0, 0.0, 1.0);
    float inside = step(0.0, e);
    vec2 bend = -n * k * k * 9.0 * strength * refract * inside / tex;
    vec4 bent = texture2D(cogl_sampler0, clamp(uv + bend, 0.0, 1.0));
    vec3 colour = bent.a > 0.004 ? bent.rgb / bent.a : base.rgb / max(base.a, 0.004);
    vec4 glass = vec4(colour * base.a, base.a);

    // Light from above, a little left.
    vec2 light = normalize(vec2(-0.35, -1.0));
    float lit = max(dot(n, light), 0.0);
    float under = max(dot(n, -light), 0.0);

    float rim = smoothstep(2.4, 0.0, e);           // the 1-2 px edge itself
    float spec = rim * (0.22 + 0.85 * pow(lit, 1.6) + 0.50 * pow(under, 2.0));
    float bevel = smoothstep(bevel_px, 0.0, e) * (0.18 * pow(lit, 1.4) + 0.07 * pow(under, 2.0));
    float sheen = 0.0;
    float shade = smoothstep(9.0, 0.0, e) * 0.05 * under * inside;   // a hint of depth on the far edge

    float sheen_y = clamp((p.y + half_size.y) / size.y, 0.0, 1.0);
    sheen = 0.07 * clamp(1.0 - sheen_y / 0.42, 0.0, 1.0);
    float shine = (spec + bevel + sheen) * strength * inside;
    glass.rgb = glass.rgb * (1.0 - shade * strength) + vec3(shine) * base.a;
    // A faint pane still gets a visible lit edge: the rim adds its own light.
    float rim_light = rim * rim_alpha * (0.45 + 0.55 * max(lit, under * 0.7)) * strength * inside;
    glass = glass * (1.0 - rim_light) + vec4(rim_light);
    cogl_color_out = glass * cogl_color_in;
`;

// The dock reflection: the mirrored icons fade out downward and blur a
// little, like a reflection on lacquer.
const REFLECTION_DECLARATIONS = `
uniform float height;
uniform float opacity;
`;

const REFLECTION_CODE = `
    vec2 uv = cogl_tex_coord0_in.st;
    float step_y = 1.6 / max(height, 1.0);
    vec4 c = texture2D(cogl_sampler0, uv) * 0.36
           + texture2D(cogl_sampler0, uv + vec2(0.0, step_y)) * 0.22
           + texture2D(cogl_sampler0, uv - vec2(0.0, step_y)) * 0.22
           + texture2D(cogl_sampler0, uv + vec2(0.0, 2.0 * step_y)) * 0.10
           + texture2D(cogl_sampler0, uv - vec2(0.0, 2.0 * step_y)) * 0.10;
    // Drawn mirrored: the texture's bottom (uv.y = 1) sits nearest the dock.
    float fade = pow(clamp(uv.y, 0.0, 1.0), 2.4);
    cogl_color_out = c * fade * opacity * cogl_color_in;
`;

// Built lazily and guarded: on a Shell where any of this is missing the
// class is never registered (and never retried) and the glass simply stays
// plain tint. Clutter creates the effect's pipeline on its first paint; the
// snippet joins that pipeline then (GJS can't override create_pipeline).
let _Effect;
function effectClass() {
    if (_Effect !== undefined)
        return _Effect;
    _Effect = null;
    try {
        _Effect = GObject.registerClass(
        class MutsuGlassShaderEffect extends Clutter.OffscreenEffect {
            _init(declarations, code) {
                super._init();
                this._declarations = declarations;
                this._code = code;
                this._uniforms = {};
                this._snipped = null;
            }

            vfunc_paint(node, paintContext, flags) {
                this._prepare();
                super.vfunc_paint(node, paintContext, flags);
                // First frame: the pipeline exists only now; draw again with light.
                if (!this._snipped && this._prepare())
                    this.queue_repaint();
            }

            _prepare() {
                const pipeline = this.get_pipeline();
                if (!pipeline)
                    return false;
                if (this._snipped !== pipeline) {
                    pipeline.add_snippet(Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, this._declarations, this._code));
                    this._snipped = pipeline;
                }
                const values = {...this._uniforms, ...this._geometry?.()};
                for (const [name, value] of Object.entries(values))
                    pipeline.set_uniform_1f(pipeline.get_uniform_location(name), value);
                return true;
            }

            setUniforms(values) {
                Object.assign(this._uniforms, values);
                this.queue_repaint();
            }
        });
    } catch (e) {
        log(`Mutsu liquid glass: no shader effects on this Shell (${e})`);
    }
    return _Effect;
}

function newEffect(declarations, code) {
    const Effect = effectClass();
    if (!Effect)
        throw new Error('no shader effects');
    return new Effect(declarations, code);
}

// Where the pane sits inside the effect's texture (the actor's paint box),
// in texture pixels, read as each frame is drawn: menus scale as they open.
function paneGeometry(effect) {
    const actor = effect.get_actor();
    const [, texW, texH] = effect.get_target_size();
    const [hasBox, box] = actor.get_paint_box();
    if (!hasBox || !texW || !texH)
        return {};
    const boxW = Math.max(1, box.x2 - box.x1);
    const scale = texW / boxW;
    const [ax, ay] = actor.get_transformed_position();
    const [tw, th] = actor.get_transformed_size();
    return {
        tex_w: texW, tex_h: texH,
        rect_x: (ax - box.x1) * scale, rect_y: (ay - box.y1) * scale,
        width: Math.max(1, tw * scale), height: Math.max(1, th * scale),
        radius: effect._radius * (tw / Math.max(1, actor.width)) * scale,
    };
}

function glassEffect() {
    const effect = newEffect(GLASS_DECLARATIONS, GLASS_CODE);
    effect._radius = 20;
    effect._geometry = () => {
        try {
            return paneGeometry(effect);
        } catch (e) {
            return {};   // until it has an actor and a texture: drawn unlit
        }
    };
    effect.setShape = (radius, strength, {refract = 1, bevel = 16, rimAlpha = 0} = {}) => {
        effect._radius = radius;
        effect.setUniforms({strength, refract, bevel_px: bevel, rim_alpha: rimAlpha});
    };
    return effect;
}

function reflectionEffect() {
    const effect = newEffect(REFLECTION_DECLARATIONS, REFLECTION_CODE);
    effect.setShape = (height, opacity) => effect.setUniforms({height: Math.max(1, height), opacity});
    return effect;
}

function radiusOf(actor, fallback) {
    try {
        const r = actor.get_theme_node().get_border_radius(St.Corner.TOPLEFT);
        return r > 0 ? r : fallback;
    } catch (e) {
        return fallback;
    }
}

function scaleOf(actor) {
    try {
        return actor.get_resource_scale?.() || 1;
    } catch (e) {
        return 1;
    }
}

export class LiquidGlass {
    constructor() {
        this._glazed = new Map();       // actor -> {effect, ids}
        this._timeouts = new Set();
        this._destroyed = false;
        this._reflection = null;

        this._patchMenus();
        this._watchBanners();
        // Dash-to-Dock builds (and rebuilds) the dock after us.
        this._addedId = Main.layoutManager.uiGroup.connect('child-added', () => this._dockSoon(400));
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._dockSoon(400));
        this._dockSoon(1200);
        this._dockSoon(4000);
    }

    // ---- glazing ----------------------------------------------------------

    glaze(actor, {strength = 1, fallbackRadius = 20, refract = 1, bevel = 16, rimAlpha = 0} = {}) {
        if (this._destroyed || !actor || this._glazed.has(actor))
            return;
        let effect;
        try {
            effect = glassEffect();
        } catch (e) {
            return;   // no shader support: the surface stays plain glass
        }
        const update = () => effect.setShape(radiusOf(actor, fallbackRadius), strength, {refract, bevel, rimAlpha});
        try {
            update();
            actor.add_effect_with_name(EFFECT_NAME, effect);
        } catch (e) {
            log(`Mutsu liquid glass: could not glaze ${actor} (${e})`);
            return;
        }
        const ids = [
            actor.connect('notify::width', update),
            actor.connect('notify::height', update),
            actor.connect('style-changed', update),
            actor.connect('destroy', () => this._glazed.delete(actor)),
        ];
        this._glazed.set(actor, {effect, ids});
    }

    _unglaze(actor) {
        const entry = this._glazed.get(actor);
        if (!entry)
            return;
        for (const id of entry.ids) {
            try {
                actor.disconnect(id);
            } catch (e) {}
        }
        try {
            actor.remove_effect_by_name(EFFECT_NAME);
        } catch (e) {}
        this._glazed.delete(actor);
    }

    // Every popup menu (top bar menus, quick settings, calendar, the app
    // menus, right-click menus) gets the glass as it opens.
    _patchMenus() {
        const self = this;
        const proto = PopupMenu.PopupMenu.prototype;
        this._origOpen = proto.open;
        const orig = this._origOpen;
        proto.open = function (...args) {
            try {
                self.glaze(this.box, {fallbackRadius: 20});
            } catch (e) {}
            return orig.apply(this, args);
        };
    }

    _unpatchMenus() {
        if (this._origOpen)
            PopupMenu.PopupMenu.prototype.open = this._origOpen;
        this._origOpen = null;
    }

    // Notification banners slide into the message tray's banner bin.
    _watchBanners() {
        const bin = Main.messageTray?._bannerBin;
        if (!bin)
            return;
        this._bannerBin = bin;
        this._bannerId = bin.connect('child-added', (_bin, banner) => {
            this.glaze(banner, {fallbackRadius: 24});
        });
        for (const child of bin.get_children())
            this.glaze(child, {fallbackRadius: 24});
    }

    // ---- dock -----------------------------------------------------------------

    _dockSoon(delay) {
        const id = GLib.timeout_add(GLib.PRIORITY_LOW, delay, () => {
            this._timeouts.delete(id);
            this._syncDock();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
    }

    _dock() {
        return Main.layoutManager.uiGroup.get_children().find(c => c.name === DOCK_NAME) ?? null;
    }

    _find(actor, test) {
        if (test(actor))
            return actor;
        for (const child of actor.get_children?.() ?? []) {
            const found = this._find(child, test);
            if (found)
                return found;
        }
        return null;
    }

    _syncDock() {
        if (this._destroyed)
            return;
        const dock = this._dock();
        if (!dock)
            return;
        const background = this._find(dock, a => a.has_style_class_name?.('dash-background'));
        if (background)
            this.glaze(background, {fallbackRadius: 28});
        const icons = this._find(dock, a => a.name === 'dashtodockDashContainer');
        if (background && icons)
            this._reflect(dock, background, icons);
    }

    _reflect(dock, background, icons) {
        if (this._reflection?.source === icons)
            return;
        this._clearReflection();
        let clone, effect;
        try {
            effect = reflectionEffect();
            clone = new Clutter.Clone({source: icons, name: REFLECTION_NAME, reactive: false});
        } catch (e) {
            return;
        }
        // A clipped floor under the dock; the mirrored clone sits inside it.
        const floor = new Clutter.Actor({name: `${REFLECTION_NAME}-floor`, reactive: false, clip_to_allocation: true});
        floor.add_child(clone);
        clone.set_pivot_point(0.5, 0.5);
        clone.scale_y = -1;
        clone.add_effect_with_name(REFLECTION_NAME, effect);
        Main.layoutManager.uiGroup.insert_child_below(floor, dock);

        const place = () => {
            try {
                const [bx, by] = background.get_transformed_position();
                const [ix, iy] = icons.get_transformed_position();
                const bottom = by + background.height;
                const floorH = Math.max(0, Math.min(REFLECTION_DEPTH, global.stage.height - bottom));
                floor.set_position(Math.round(bx), Math.round(bottom));
                floor.set_size(Math.round(background.width), Math.round(floorH));
                // Mirror about the dock's lower edge, a few px above the glass rim
                // so the reflection starts right at the edge, like the icons sit on it.
                const axis = bottom - 6;
                const mirroredTop = 2 * axis - (iy + icons.height);
                clone.set_size(icons.width, icons.height);
                clone.set_position(Math.round(ix - bx), Math.round(mirroredTop - bottom));
                effect.setShape(icons.height * scaleOf(icons), 0.55);
                floor.visible = dock.visible && floorH > 2 && !Main.overview.visible;
            } catch (e) {}
        };
        // Dash-to-Dock may destroy and rebuild any of these: an actor that is
        // gone is never touched again.
        const ids = [];
        const alive = new Set([background, icons, dock, floor]);
        const watch = (actor, signals) => {
            for (const s of signals)
                ids.push([actor, actor.connect(s, place)]);
        };
        for (const actor of [background, icons, dock, floor]) {
            actor.connect('destroy', () => {
                alive.delete(actor);
                if (this._reflection?.alive === alive)
                    this._clearReflection();
            });
        }
        watch(background, ['notify::allocation', 'notify::width', 'notify::height']);
        watch(icons, ['notify::allocation', 'notify::width']);
        watch(dock, ['notify::allocation', 'notify::visible', 'notify::translation-y', 'notify::y']);
        watch(Main.overview, ['showing', 'hidden']);
        this._reflection = {actor: floor, source: icons, ids, alive};
        place();
        // The overview hides the reflection while it is open.
        this._reflection.overviewIds = [
            Main.overview.connect('showing', () => {
                floor.visible = false;
            }),
        ];
    }

    _clearReflection() {
        const r = this._reflection;
        this._reflection = null;
        if (!r)
            return;
        for (const [actor, id] of r.ids) {
            if (actor === Main.overview || r.alive.has(actor))
                actor.disconnect(id);
        }
        for (const id of r.overviewIds ?? [])
            Main.overview.disconnect(id);
        if (r.alive.has(r.actor))
            r.actor.destroy();
    }

    destroy() {
        this._destroyed = true;
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        this._unpatchMenus();
        if (this._bannerBin && this._bannerId)
            this._bannerBin.disconnect(this._bannerId);
        this._bannerId = 0;
        Main.layoutManager.uiGroup.disconnect(this._addedId);
        Main.layoutManager.disconnect(this._monitorsId);
        for (const actor of [...this._glazed.keys()])
            this._unglaze(actor);
        this._clearReflection();
    }
}
