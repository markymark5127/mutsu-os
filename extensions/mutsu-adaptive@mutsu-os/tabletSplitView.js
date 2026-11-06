import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {splitFrames, maximizeWindow, unmaximizeWindow, isWindowMaximized,
    slideOverFrame} from './tabletGeometry.js';

// Split View (two apps side by side) and Slide Over (a stack of narrow apps
// floating above everything) are independent, so three apps can be on
// screen at once: a split pair plus a Slide Over app on top.
//
// Slide Over handle (above the floating app):
//   drag right / tap     tuck the stack away (an edge tab brings it back)
//   drag left            next app in the stack
// Edge tab (right edge, while tucked away): tap or drag left to show again.
export class TabletSplitView {
    constructor(monitor = () => Main.layoutManager.primaryMonitor) {
        this._monitor = monitor;
        this._pair = null;
        this._splitMonitor = 0;
        this._slides = []; // MRU: [0] is the visible / most recent
        this._slideHidden = false;
        this._slideShownAt = 0;
        this._slideSignals = new Map();
        this._signals = [];
        this._divider = new St.Button({style_class: 'mutsu-split-divider',
            accessible_name: 'Resize split view. Click to maximize the active app.',
            child: new St.Label({text: '⋮', y_align: Clutter.ActorAlign.CENTER})});
        this._divider.connect('clicked', () => this.fullscreen(global.display.focus_window));
        Main.layoutManager.addChrome(this._divider, {affectsStruts: false});
        this._divider.hide();
        this._handle = this._chrome('mutsu-slideover', 120, 28,
            'Slide Over. Drag left for the next app; drag right or tap to tuck away');
        this._tab = this._chrome('mutsu-slideover-tab', 22, 120,
            'Show Slide Over. Tap or drag left');
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

    _chrome(style, width, height, name) {
        const actor = new St.Widget({style_class: style, reactive: true,
            layout_manager: new Clutter.BinLayout(), width, height, accessible_name: name});
        actor.add_child(new St.Widget({style_class: `${style}-grip`,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        Main.layoutManager.addChrome(actor, {affectsStruts: false});
        actor.hide();
        return actor;
    }

    get pair() { return this._pair; }
    get slides() { return [...this._slides]; }

    // ---- Split View ----------------------------------------------------------

    arrange(left, right) {
        if (!left || !right || left === right ||
            !left.allows_resize() || !right.allows_resize()) {
            Main.notify('Split View', 'Choose two different resizable app windows.');
            return false;
        }
        this.clearSplit();
        // A Slide Over app moved into the split leaves the stack.
        this._removeSlide(left);
        this._removeSlide(right);
        this._pair = [left, right];
        this._ratio = 0.5;
        this._splitMonitor = left.get_monitor();
        const workspace = left.get_workspace();
        for (const window of this._pair) {
            window.unmake_fullscreen();
            unmaximizeWindow(window, Meta);
            window.move_to_monitor(this._splitMonitor);
            window.change_workspace(workspace);
            window.unminimize();
        }
        this._closeSignals = this._pair.map(window =>
            [window, window.connect('unmanaged', () => {
                const remaining = this._pair?.find(w => w !== window);
                this.clearSplit();
                if (remaining)
                    maximizeWindow(remaining, Meta);
            })]);
        Main.overview.hide();
        Main.activateWindow(left);
        Main.activateWindow(right);
        this._layout();
        this._raiseSlide();
        return true;
    }

    _layout() {
        this._layoutSlide();
        if (!this._pair)
            return;
        if (!Main.layoutManager.monitors[this._splitMonitor])
            this._splitMonitor = Main.layoutManager.primaryIndex;
        const work = Main.layoutManager.getWorkAreaForMonitor(this._splitMonitor);
        const area = {x: work.x, y: work.y, width: work.width, height: work.height};
        const keyboard = Main.layoutManager.keyboardBox;
        if (keyboard.visible && keyboard.height > 0 &&
            this._splitMonitor === (Main.layoutManager.keyboardIndex ?? Main.layoutManager.primaryIndex))
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
        const locked = Main.sessionMode.isLocked || Main.overview.visible;
        const visible = !!this._pair && !locked && !this._pair.some(w => w.minimized) &&
            !Main.layoutManager.keyboardBox.visible &&
            this._pair.some(w => w === focus || focus?.get_transient_for() === w ||
                this._slides[0] === focus);
        this._divider.visible = visible;
        if (!visible && this._drag?.kind === 'divider')
            this._drag = null;
        const slide = this._slides[0];
        this._handle.visible = !!slide && !this._slideHidden && !locked && !slide.minimized;
        this._tab.visible = !!slide && this._slideHidden && !locked;
    }

    // ---- Slide Over ------------------------------------------------------------

    // Add a window to the top of the Slide Over stack and show it.
    slideOver(window) {
        if (!window || window.is_skip_taskbar() || !window.allows_resize())
            return false;
        if (this._pair?.includes(window)) {
            const other = this._pair.find(w => w !== window);
            this.clearSplit();
            maximizeWindow(other, Meta);
        }
        this._slides = [window, ...this._slides.filter(w => w !== window)];
        if (!this._slideSignals.has(window)) {
            this._slideSignals.set(window, [
                window.connect('unmanaged', () => this._removeSlide(window)),
                // The green button (full screen) takes it out of Slide Over.
                window.connect('size-changed', () => {
                    // Ignore the auto-maximize of a just-launched app.
                    if (isWindowMaximized(window) && Date.now() - this._slideShownAt > 1500)
                        this._removeSlide(window, false);
                    else if (isWindowMaximized(window))
                        this._layoutSlideSoon();
                }),
            ]);
        }
        // Others in the stack wait off screen.
        for (const other of this._slides.slice(1)) {
            if (!other.minimized)
                other.minimize();
        }
        this._showSlide();
        return true;
    }

    _showSlide() {
        const window = this._slides[0];
        if (!window)
            return;
        this._slideHidden = false;
        this._slideShownAt = Date.now();
        unmaximizeWindow(window, Meta);
        window.unminimize();
        window.make_above?.();
        this._layoutSlide();
        Main.activateWindow(window);
        this._sync();
    }

    _layoutSlide() {
        const window = this._slides[0];
        const monitor = this._monitor();
        if (!window || !monitor)
            return;
        const frame = slideOverFrame(monitor);
        if (!this._slideHidden)
            window.move_resize_frame(false, frame.x, frame.y, frame.width, frame.height);
        this._handle.set_position(frame.x + Math.round(frame.width / 2) - 60, frame.y - 34);
        this._handle.translation_x = 0;
        this._tab.set_position(monitor.x + monitor.width - 22,
            monitor.y + Math.round(monitor.height / 2) - 60);
        this._tab.translation_x = 0;
    }

    _layoutSlideSoon() {
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            const window = this._slides[0];
            if (window && !this._slideHidden) {
                unmaximizeWindow(window, Meta);
                this._layoutSlide();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _raiseSlide() {
        const window = this._slides[0];
        if (window && !this._slideHidden)
            window.make_above?.();
    }

    // Tuck the stack away; the edge tab brings it back.
    hideSlide() {
        const window = this._slides[0];
        if (!window)
            return;
        this._slideHidden = true;
        window.minimize();
        this._sync();
    }

    nextSlide() {
        if (this._slides.length < 2)
            return;
        const [current, ...rest] = this._slides;
        current.minimize();
        this._slides = [...rest, current];
        this._showSlide();
    }

    _removeSlide(window, minimize = false) {
        const ids = this._slideSignals.get(window);
        if (!ids && !this._slides.includes(window))
            return;
        this._slideSignals.delete(window);
        for (const id of ids ?? []) {
            try { window.disconnect(id); } catch (e) {}
        }
        try { window.unmake_above?.(); } catch (e) {}
        const wasTop = this._slides[0] === window;
        this._slides = this._slides.filter(w => w !== window);
        if (minimize) {
            try { window.minimize(); } catch (e) {}
        }
        if (wasTop && this._slides.length && !this._slideHidden)
            this._showSlide();
        this._sync();
    }

    // ---- input -------------------------------------------------------------------

    _event(event) {
        const T = Clutter.EventType;
        const type = event.type();
        const touch = [T.TOUCH_BEGIN, T.TOUCH_UPDATE, T.TOUCH_END, T.TOUCH_CANCEL].includes(type);
        const begin = type === T.BUTTON_PRESS || type === T.TOUCH_BEGIN;
        const end = type === T.BUTTON_RELEASE || type === T.TOUCH_END;
        if (!touch && !begin && !end && type !== T.MOTION)
            return Clutter.EVENT_PROPAGATE;
        const sequence = touch ? event.get_event_sequence() : null;
        const [x] = event.get_coords();
        if (begin && (touch || event.get_button() === 1)) {
            const source = event.get_source();
            for (const [kind, actor] of [['divider', this._divider], ['handle', this._handle],
                ['tab', this._tab]]) {
                if (actor.visible && actor.contains(source)) {
                    this._drag = {kind, sequence, ratio: this._ratio, x};
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        }
        const drag = this._drag;
        if (!drag || drag.sequence !== sequence)
            return Clutter.EVENT_PROPAGATE;
        const dx = x - drag.x;
        if (type === T.TOUCH_CANCEL) {
            this._drag = null;
            if (drag.kind === 'divider') {
                this._ratio = drag.ratio;
                this._layout();
            }
            this._handle.translation_x = this._tab.translation_x = 0;
            return Clutter.EVENT_STOP;
        }
        if (drag.kind === 'divider') {
            this._ratio = Math.max(0.3, Math.min(0.7, (x - this._area.x) / this._area.width));
            this._layout();
            if (end) {
                this._drag = null;
                if (Math.abs(dx) < 8)
                    this.fullscreen(global.display.focus_window);
            }
        } else if (drag.kind === 'handle') {
            this._handle.translation_x = dx;
            if (end) {
                this._drag = null;
                this._handle.translation_x = 0;
                if (dx < -60)
                    this.nextSlide();
                else if (dx > 60 || Math.abs(dx) < 8)
                    this.hideSlide();
            }
        } else if (drag.kind === 'tab') {
            this._tab.translation_x = Math.min(0, dx);
            if (end) {
                this._drag = null;
                this._tab.translation_x = 0;
                if (dx < -30 || Math.abs(dx) < 8)
                    this._showSlide();
            }
        }
        return Clutter.EVENT_STOP;
    }

    fullscreen(window) {
        const target = this._pair?.includes(window) ? window : this._pair?.[0];
        this.clearSplit();
        if (target) {
            maximizeWindow(target, Meta);
            Main.activateWindow(target);
        }
    }

    clearSplit() {
        if (this._drag?.kind === 'divider')
            this._drag = null;
        for (const [window, id] of this._closeSignals ?? [])
            window.disconnect(id);
        this._closeSignals = [];
        this._pair = null;
        this._divider.hide();
    }

    clear() {
        this.clearSplit();
        for (const window of [...this._slides])
            this._removeSlide(window);
        this._slideHidden = false;
        this._sync();
    }

    destroy() {
        this.clear();
        for (const [object, id] of this._signals)
            object.disconnect(id);
        for (const actor of [this._divider, this._handle, this._tab]) {
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
    }
}

// Get a normal window for an app: an existing one, or launch the app and
// wait for its first window (up to 15 s). Calls back with null on timeout.
export function windowForApp(app, callback, {newWindow = false} = {}) {
    const existing = app.get_windows().find(w => !w.is_skip_taskbar() &&
        w.get_window_type() === Meta.WindowType.NORMAL);
    if (existing && !newWindow) {
        callback(existing);
        return;
    }
    const tracker = Shell.WindowTracker.get_default();
    let done = false;
    let timeout = 0;
    const createdId = global.display.connect('window-created', (_d, window) => {
        if (done || window.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        const shownId = window.connect('shown', () => {
            window.disconnect(shownId);
            if (done || tracker.get_window_app(window) !== app)
                return;
            finish(window);
        });
    });
    const finish = window => {
        done = true;
        global.display.disconnect(createdId);
        if (timeout)
            GLib.source_remove(timeout);
        // Let the first configure (and tablet auto-maximize) settle.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, window ? 250 : 0, () => {
            callback(window);
            return GLib.SOURCE_REMOVE;
        });
    };
    timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
        timeout = 0;
        if (!done)
            finish(null);
        return GLib.SOURCE_REMOVE;
    });
    if (existing && newWindow && app.can_open_new_window?.())
        app.open_new_window(-1);
    else
        app.activate();
}
