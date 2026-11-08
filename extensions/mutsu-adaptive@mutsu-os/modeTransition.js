// The moment the laptop becomes a tablet (and back), animated.
//
// Three things move together, all transforms and opacity so it stays smooth
// on old integrated graphics:
//   1. A wave of colour from the hinge: sage rising from the bottom edge
//      into tablet, warm sand falling from the top back to the desktop.
//   2. The apps settle into the new layout with a small spring (they dip
//      to 94% and bounce back), so the change reads as one motion.
//   3. A little hinge in the middle of the screen, seen side-on: the screen
//      folds all the way back behind the keyboard into tablet, or swings
//      up open into a laptop, with "Tablet" / "Desktop" under it.
//
// It plays after the switch has been made (the heavy work happens while
// the screen is frozen anyway), so it is never interrupted by it. Off when
// GNOME's animations are off.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Side-on hinge angles (degrees, around the hinge; 0 = screen lying flat on
// the keyboard pointing right). Open laptop ~ 110 degrees; tablet = folded
// all the way round, flat under the keyboard.
export const HINGE_OPEN = -110;
export const HINGE_TABLET = -355;
export const WAVE_MS = 700;
export const SPRING_MS = 520;
export const HINGE_MS = 620;
export const HUD_HOLD_MS = 450;
export const START_DELAY_MS = 60;

const COLOURS = {tablet: 'rgba(164, 201, 178, 0.55)', desktop: 'rgba(222, 205, 176, 0.55)'};

export function animationsEnabled() {
    try {
        return St.Settings.get().enable_animations;
    } catch (e) {
        return true;
    }
}

// Where the wave starts and how big it must grow to cover the screen.
export function wavePlan(monitor, toTablet) {
    const cx = monitor.x + monitor.width / 2;
    const cy = toTablet ? monitor.y + monitor.height : monitor.y;
    const radius = Math.ceil(Math.hypot(monitor.width / 2, monitor.height));
    return {cx, cy, radius};
}

export function hingeAngles(toTablet) {
    return toTablet ? [HINGE_OPEN, HINGE_TABLET] : [HINGE_TABLET, HINGE_OPEN];
}

export class ModeTransition {
    constructor() {
        this._actors = [];
        this._timeouts = [];
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => {
            // A rotation mid-animation: the overlay would be in the wrong
            // place. (monitors-changed also fires with nothing moved; ignore.)
            const m = Main.layoutManager.primaryMonitor;
            if (this._geometry && m && (m.width !== this._geometry.width || m.height !== this._geometry.height))
                this._clear(false);
        });
    }

    play(toTablet) {
        this._clear(true);
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !animationsEnabled() || Main.sessionMode.isLocked)
            return false;
        // Start just after the switch's own work (a low-priority idle can
        // starve while the shell is busy redrawing, so use a short timeout).
        this._later(START_DELAY_MS, () => {
            const current = Main.layoutManager.primaryMonitor ?? monitor;
            this._start(current, toTablet);
        });
        return true;
    }

    _later(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts = this._timeouts.filter(t => t !== id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.push(id);
    }

    _start(monitor, toTablet) {
        this._geometry = {width: monitor.width, height: monitor.height};
        this._wave(monitor, toTablet);
        this._spring();
        this._hud(monitor, toTablet);
    }

    _wave(monitor, toTablet) {
        const {cx, cy, radius} = wavePlan(monitor, toTablet);
        const wave = new St.Widget({
            style_class: 'mutsu-mode-wave', reactive: false,
            width: radius * 2, height: radius * 2,
            x: Math.round(cx - radius), y: Math.round(cy - radius),
            style: `border-radius: ${radius}px; background-color: ${COLOURS[toTablet ? 'tablet' : 'desktop']};`,
        });
        wave.set_pivot_point(0.5, 0.5);
        wave.scale_x = wave.scale_y = 0.02;
        wave.opacity = 255;
        Main.layoutManager.uiGroup.add_child(wave);
        this._actors.push(wave);
        wave.ease({
            scale_x: 1, scale_y: 1, opacity: 0, duration: WAVE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onStopped: () => this._drop(wave),
        });
    }

    _spring() {
        const group = global.window_group;
        if (!group?.ease)
            return;
        group.remove_transition?.('scale-x');
        group.remove_transition?.('scale-y');
        group.set_pivot_point(0.5, 0.5);
        group.scale_x = group.scale_y = 0.94;
        group.ease({
            scale_x: 1, scale_y: 1, duration: SPRING_MS,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
            onStopped: () => {
                group.scale_x = group.scale_y = 1;
            },
        });
    }

    _hud(monitor, toTablet) {
        const unit = Math.round(Math.min(monitor.width, monitor.height) * 0.05);
        const box = new St.Widget({style_class: 'mutsu-mode-hud', reactive: false,
            width: unit * 5, height: unit * 4.4,
            x: Math.round(monitor.x + monitor.width / 2 - unit * 2.5),
            y: Math.round(monitor.y + monitor.height / 2 - unit * 2.2)});
        // Side-on laptop: the keyboard is a bar from the hinge to the right,
        // the screen a bar that turns around the hinge.
        const thick = Math.max(4, Math.round(unit * 0.16));
        const length = Math.round(unit * 2.2);
        const hingeX = Math.round(unit * 1.4), hingeY = Math.round(unit * 2.3);
        const base = new St.Widget({style_class: 'mutsu-mode-hinge-part',
            x: hingeX, y: hingeY, width: length, height: thick,
            style: `border-radius: ${thick}px;`});
        const screen = new St.Widget({style_class: 'mutsu-mode-hinge-part mutsu-mode-hinge-screen',
            x: hingeX, y: hingeY, width: length, height: thick,
            style: `border-radius: ${thick}px;`});
        screen.set_pivot_point(0, 0.5);
        const [from, to] = hingeAngles(toTablet);
        screen.rotation_angle_z = from;
        const label = new St.Label({style_class: 'mutsu-mode-label',
            text: toTablet ? 'Tablet' : 'Desktop',
            x: 0, y: Math.round(unit * 3.25), width: unit * 5});
        label.clutter_text.x_align = Clutter.ActorAlign.CENTER;
        box.add_child(base);
        box.add_child(screen);
        box.add_child(label);
        box.opacity = 0;
        box.set_pivot_point(0.5, 0.5);
        box.scale_x = box.scale_y = 0.9;
        Main.layoutManager.uiGroup.add_child(box);
        this._actors.push(box);
        box.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        screen.ease({rotation_angle_z: to, duration: HINGE_MS,
            mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC});
        this._later(HINGE_MS + HUD_HOLD_MS, () => {
            box.ease({opacity: 0, scale_x: 0.96, scale_y: 0.96, duration: 220,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onStopped: () => this._drop(box)});
        });
    }

    _drop(actor) {
        if (!this._actors.includes(actor))
            return;
        this._actors = this._actors.filter(a => a !== actor);
        actor.destroy();
    }

    _clear(resetGroup) {
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts = [];
        for (const actor of [...this._actors]) {
            actor.remove_all_transitions?.();
            this._drop(actor);
        }
        if (resetGroup && global.window_group) {
            global.window_group.remove_all_transitions?.();
            global.window_group.scale_x = global.window_group.scale_y = 1;
        }
    }

    destroy() {
        this._clear(true);
        if (this._monitorsId)
            Main.layoutManager.disconnect(this._monitorsId);
        this._monitorsId = 0;
    }
}
