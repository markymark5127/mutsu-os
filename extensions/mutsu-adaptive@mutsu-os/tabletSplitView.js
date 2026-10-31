import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {splitFrames, maximizeWindow, unmaximizeWindow} from './tabletGeometry.js';

export class TabletSplitView {
    constructor() {
        this._pair = null;
        this._signals = [];
        this._divider = new St.Button({style_class: 'mutsu-split-divider',
            accessible_name: 'Resize split view. Click to maximize the active app.',
            child: new St.Label({text: '⋮', y_align: Clutter.ActorAlign.CENTER})});
        this._divider.connect('clicked', () => this.fullscreen(global.display.focus_window));
        Main.layoutManager.addChrome(this._divider, {affectsStruts: false});
        this._divider.hide();
        this._connect(global.stage, 'captured-event', (_stage, event) => this._event(event));
        this._connect(Main.layoutManager, 'monitors-changed', () => this._layout());
        this._connect(global.display, 'workareas-changed', () => this._layout());
        this._connect(global.display, 'notify::focus-window', () => this._sync());
        this._connect(Main.overview, 'showing', () => this._sync());
        this._connect(Main.overview, 'hidden', () => this._sync());
        this._connect(Main.sessionMode, 'updated', () => {
            this._drag = null;
            this._sync();
        });
        this._connect(Main.layoutManager.keyboardBox, 'notify::visible', () => this._layout());
        this._connect(Main.layoutManager.keyboardBox, 'notify::height', () => this._layout());
    }

    _connect(object, signal, fn) { this._signals.push([object, object.connect(signal, fn)]); }

    arrange(left, right) {
        if (!left || !right || left === right ||
            !left.allows_resize() || !right.allows_resize()) {
            Main.notify('Split View', 'Choose two different resizable app windows.');
            return;
        }
        this.clear();
        this._pair = [left, right];
        this._ratio = 0.5;
        this._monitor = left.get_monitor();
        const workspace = left.get_workspace();
        for (const window of this._pair) {
            window.unmake_fullscreen();
            unmaximizeWindow(window, Meta);
            window.move_to_monitor(this._monitor);
            window.change_workspace(workspace);
            window.unminimize();
        }
        this._closeSignals = this._pair.map(window =>
            [window, window.connect('unmanaged', () => {
                const remaining = this._pair?.find(w => w !== window);
                this.clear();
                if (remaining)
                    maximizeWindow(remaining, Meta);
            })]);
        Main.overview.hide();
        Main.activateWindow(left);
        Main.activateWindow(right);
        this._layout();
    }

    _layout() {
        if (!this._pair)
            return;
        if (!Main.layoutManager.monitors[this._monitor])
            this._monitor = Main.layoutManager.primaryIndex;
        const work = Main.layoutManager.getWorkAreaForMonitor(this._monitor);
        const area = {x: work.x, y: work.y, width: work.width, height: work.height};
        const keyboard = Main.layoutManager.keyboardBox;
        if (keyboard.visible && keyboard.height > 0 &&
            this._monitor === (Main.layoutManager.keyboardIndex ?? Main.layoutManager.primaryIndex))
            area.height = Math.max(200, area.height - keyboard.height);
        this._area = area;
        const frames = splitFrames(area, this._ratio);
        this._pair.forEach((window, index) => {
            const r = frames[index];
            window.move_resize_frame(true, r.x, r.y, r.width, r.height);
        });
        this._divider.set_position(frames[1].x - 20, area.y + Math.round(area.height * 0.3));
        this._divider.set_size(28, Math.round(area.height * 0.4));
        this._sync();
    }

    _sync() {
        const focus = global.display.focus_window;
        const visible = !!this._pair && !Main.overview.visible &&
            !Main.sessionMode.isLocked && !this._pair.some(w => w.minimized) &&
            !Main.layoutManager.keyboardBox.visible &&
            this._pair.some(w => w === focus || focus?.get_transient_for() === w);
        this._divider.visible = visible;
        if (!visible)
            this._drag = null;
    }

    _event(event) {
        const type = event.type();
        const touch = [Clutter.EventType.TOUCH_BEGIN, Clutter.EventType.TOUCH_UPDATE,
            Clutter.EventType.TOUCH_END, Clutter.EventType.TOUCH_CANCEL].includes(type);
        const begin = type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN;
        const end = type === Clutter.EventType.BUTTON_RELEASE || type === Clutter.EventType.TOUCH_END;
        if (!touch && !begin && !end && type !== Clutter.EventType.MOTION)
            return Clutter.EVENT_PROPAGATE;
        const sequence = touch ? event.get_event_sequence() : null;
        if (begin && this._divider.visible && this._divider.contains(event.get_source()) &&
            (touch || event.get_button() === 1)) {
            this._drag = {sequence, ratio: this._ratio, x: event.get_coords()[0]};
            return Clutter.EVENT_STOP;
        }
        if (!this._drag || this._drag.sequence !== sequence)
            return Clutter.EVENT_PROPAGATE;
        if (type === Clutter.EventType.TOUCH_CANCEL) {
            this._ratio = this._drag.ratio;
            this._drag = null;
            this._layout();
        } else {
            const x = event.get_coords()[0];
            this._ratio = Math.max(0.3, Math.min(0.7, (x - this._area.x) / this._area.width));
            this._layout();
            if (end) {
                const tap = Math.abs(x - this._drag.x) < 8;
                this._drag = null;
                if (tap)
                    this.fullscreen(global.display.focus_window);
            }
        }
        return Clutter.EVENT_STOP;
    }

    slideOver(window) {
        if (!window || window.is_skip_taskbar())
            return;
        this.clear();
        this._dismissSlide();
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const width = Math.round(monitor.width * 0.4);
        const x = monitor.x + monitor.width - width - 12;
        const y = monitor.y + 40;
        const height = monitor.height - 80;
        window.unmaximize(Meta.MaximizeFlags.BOTH);
        window.move_resize_frame(false, x, y, width, height);
        Main.activateWindow(window);
        const card = new St.Widget({style_class: 'mutsu-slideover', reactive: true});
        card.set_position(x - 4, y - 4);
        card.set_size(width + 8, height + 8);
        const handle = new St.Button({
            style_class: 'mutsu-slideover-handle',
            accessible_name: 'Dismiss Slide Over',
            label: '⋯',
        });
        handle.connect('clicked', () => this._dismissSlide());
        card.add_child(handle);
        Main.layoutManager.addChrome(card, {affectsStruts: false});
        this._slide = {window, card, x};
        let start = null;
        card.connect('event', (_a, event) => {
            const type = event.type();
            if (type === Clutter.EventType.TOUCH_BEGIN || type === Clutter.EventType.BUTTON_PRESS) {
                start = event.get_coords()[0];
                return Clutter.EVENT_STOP;
            }
            if (start == null)
                return Clutter.EVENT_PROPAGATE;
            if (type === Clutter.EventType.TOUCH_UPDATE || type === Clutter.EventType.MOTION) {
                const dx = event.get_coords()[0] - start;
                if (dx > 0)
                    card.translation_x = dx;
                return Clutter.EVENT_STOP;
            }
            if (type === Clutter.EventType.TOUCH_END || type === Clutter.EventType.BUTTON_RELEASE) {
                const dx = event.get_coords()[0] - start;
                start = null;
                if (dx > 80)
                    this._dismissSlide();
                else
                    card.ease({translation_x: 0, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _dismissSlide() {
        if (!this._slide)
            return;
        const {window, card} = this._slide;
        this._slide = null;
        card.ease({
            translation_x: 280, opacity: 0, duration: 160,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                Main.layoutManager.removeChrome(card);
                card.destroy();
            },
        });
        try { window.minimize(); } catch (e) {}
    }

    fullscreen(window) {
        const target = this._pair?.includes(window) ? window : this._pair?.[0];
        this.clear();
        if (target) {
            maximizeWindow(target, Meta);
            Main.activateWindow(target);
        }
    }

    clear() {
        this._drag = null;
        for (const [window, id] of this._closeSignals ?? [])
            window.disconnect(id);
        this._closeSignals = [];
        this._pair = null;
        this._divider.hide();
        this._dismissSlide();
    }

    destroy() {
        this.clear();
        for (const [object, id] of this._signals)
            object.disconnect(id);
        Main.layoutManager.removeChrome(this._divider);
        this._divider.destroy();
    }
}
