import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {sameSequence, splitFrames, maximizeWindow, unmaximizeWindow, isWindowMaximized,
    slideOverFrame, slideOverRelease, dragVelocity} from './tabletGeometry.js';

// Split View (two apps side by side) and Slide Over (a stack of narrow apps
// floating above everything) are independent, so three apps can be on
// screen at once: a split pair plus a Slide Over app on top.
//
// Slide Over: a fixed-size app floating above the others. Its handle (the
// bar above it) and its title bar move together, sideways only:
//   drag the handle or title bar   slide it along the screen
//   flick it left or right         tuck it away to that side (an arrow tab
//                                  appears on that edge)
//   tap the handle                 next app in the Slide Over stack
// Arrow tab: tap it (or drag it inward) and the app slides back.
export class TabletSplitView {
    constructor(monitor = () => Main.layoutManager.primaryMonitor) {
        this._monitor = monitor;
        this._pair = null;
        this._splitMonitor = 0;
        this._slides = []; // MRU: [0] is the visible / most recent
        this._slideHidden = false;
        this._slideShownAt = 0;
        this._slideX = null;      // null: right side
        this._tuckSide = 'right';
        this._titleDrag = null;
        this._placing = false;
        this._slideSignals = new Map();
        this._signals = [];
        this._divider = new St.Button({style_class: 'mutsu-split-divider',
            accessible_name: 'Resize split view. Click to maximize the active app.',
            child: new St.Label({text: '⋮', y_align: Clutter.ActorAlign.CENTER})});
        this._divider.connect('clicked', () => this.fullscreen(global.display.focus_window));
        Main.layoutManager.addChrome(this._divider, {affectsStruts: false});
        this._divider.hide();
        this._handle = this._chrome('mutsu-slideover', 120, 28,
            'Slide Over. Drag to move, flick to tuck away, tap for the next app');
        this._tab = new St.Widget({style_class: 'mutsu-slideover-tab', reactive: true,
            layout_manager: new Clutter.BinLayout(), width: 26, height: 120,
            accessible_name: 'Show Slide Over'});
        this._tabArrow = new St.Label({style_class: 'mutsu-slideover-tab-arrow', text: '‹',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this._tab.add_child(this._tabArrow);
        Main.layoutManager.addChrome(this._tab, {affectsStruts: false});
        this._tab.hide();
        this._connect(global.display, 'grab-op-begin', (_d, window) => this._titleGrab(window, true));
        this._connect(global.display, 'grab-op-end', (_d, window) => this._titleGrab(window, false));
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
        this._connect(Main.keyboard, 'visibility-changed', () => this._layout());
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
        // Mutter reports a maximized window as not resizable, and every app is
        // maximized in tablet mode; only fixed-size windows are refused.
        const resizable = w => isWindowMaximized(w) || w.allows_resize();
        if (!left || !right || left === right || !resizable(left) || !resizable(right)) {
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
        if (Main.keyboard?.visible && keyboard.height > 0 &&
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
            !Main.keyboard?.visible &&
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
        if (!window || window.is_skip_taskbar() ||
            !(isWindowMaximized(window) || window.allows_resize()))
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
                    else if (isWindowMaximized(window) || this._sizeDrifted(window))
                        this._layoutSlideSoon(); // the size stays locked
                }),
                // Dragging the title bar: the handle follows the window.
                window.connect('position-changed', () => this._followSlide(window)),
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
        const fromSide = this._slideHidden && window.minimized ? this._tuckSide : null;
        window._mutsuSlideOver = false;
        this._slideHidden = false;
        this._slideShownAt = Date.now();
        unmaximizeWindow(window, Meta);
        const actor = window.get_compositor_private?.();
        if (fromSide && actor)
            Main.wm?.skipNextEffect?.(actor); // slide in from the edge instead
        window.unminimize();
        window.make_above?.();
        this._layoutSlide();
        if (fromSide && actor?.ease) {
            const monitor = this._monitor();
            const frame = slideOverFrame(monitor, this._slideX);
            actor.remove_all_transitions?.();
            actor.translation_x = this._tuckOffset(fromSide, frame, monitor);
            actor.ease({translation_x: 0, duration: 240, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        }
        Main.activateWindow(window);
        this._sync();
    }

    _tuckOffset(side, frame, monitor) {
        return side === 'left'
            ? monitor.x - (frame.x + frame.width) - 24
            : monitor.x + monitor.width - frame.x + 24;
    }

    _sizeDrifted(window) {
        if (this._slideHidden || this._placing || this._slides[0] !== window || window.minimized)
            return false;
        const monitor = this._monitor();
        if (!monitor)
            return false;
        const frame = slideOverFrame(monitor, this._slideX);
        const r = window.get_frame_rect();
        return Math.abs(r.width - frame.width) > 2 || Math.abs(r.height - frame.height) > 2;
    }

    _placeHandle(rect) {
        this._handle.set_position(rect.x + Math.round(rect.width / 2) - 60, rect.y - 34);
        this._handle.translation_x = 0;
    }

    _followSlide(window) {
        if (this._placing || this._slideHidden || this._slides[0] !== window || window.minimized)
            return;
        const rect = window.get_frame_rect();
        this._placeHandle(rect);
        this._titleDrag?.samples.push([Date.now(), rect.x]);
    }

    // The title bar is dragged with Mutter's own move: follow it, then on
    // release keep the size, put it back on its row (sideways moves only),
    // or tuck it away if it was flicked.
    _titleGrab(window, begin) {
        if (!window || window !== this._slides[0] || this._slideHidden)
            return;
        if (begin) {
            this._titleDrag = {startX: window.get_frame_rect().x, samples: []};
            return;
        }
        const drag = this._titleDrag;
        this._titleDrag = null;
        if (!drag)
            return;
        const x = window.get_frame_rect().x;
        const result = slideOverRelease(x - drag.startX, dragVelocity(drag.samples));
        if (result === 'tuck-left' || result === 'tuck-right') {
            this.hideSlide(result === 'tuck-left' ? 'left' : 'right');
            return;
        }
        if (result === 'move')
            this._slideX = x;
        this._layoutSlide();
    }

    _layoutSlide() {
        const window = this._slides[0];
        const monitor = this._monitor();
        if (!window || !monitor)
            return;
        const frame = slideOverFrame(monitor, this._slideX);
        if (!this._slideHidden) {
            this._placing = true;
            try {
                window.move_resize_frame(false, frame.x, frame.y, frame.width, frame.height);
            } finally {
                this._placing = false;
            }
        }
        this._placeHandle(frame);
        const left = this._tuckSide === 'left';
        this._tab.set_position(left ? monitor.x : monitor.x + monitor.width - 26,
            monitor.y + Math.round(monitor.height / 2) - 60);
        this._tab.translation_x = 0;
        this._tabArrow.text = left ? '›' : '‹';
        if (left)
            this._tab.add_style_class_name('mutsu-slideover-tab-left');
        else
            this._tab.remove_style_class_name('mutsu-slideover-tab-left');
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

    // Tuck the stack away to one side (it folds off that edge, not down into
    // the dock); the arrow tab on that edge brings it back.
    hideSlide(side = null) {
        const window = this._slides[0];
        const monitor = this._monitor();
        if (!window)
            return;
        const frame = slideOverFrame(monitor, this._slideX);
        this._tuckSide = side ?? (frame.x + frame.width / 2 < monitor.x + monitor.width / 2 ? 'left' : 'right');
        this._slideHidden = true;
        this._layoutSlide();
        this._sync();
        const actor = window.get_compositor_private?.();
        const finish = () => {
            if (actor) {
                actor.translation_x = 0;
                actor.scale_x = 1;
                actor.opacity = 255;
                Main.wm?.skipNextEffect?.(actor);
            }
            if (this._slideHidden && this._slides[0] === window) {
                window._mutsuSlideOver = true; // no dock tile (Kiwi)
                window.minimize();
            }
        };
        if (!actor?.ease) {
            finish();
            return;
        }
        const r = window.get_frame_rect();
        actor.remove_all_transitions?.();
        actor.set_pivot_point?.(this._tuckSide === 'left' ? 0 : 1, 0.5);
        actor.ease({
            translation_x: this._tuckOffset(this._tuckSide, r, monitor),
            scale_x: 0.82,
            opacity: 120,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onStopped: finish,
        });
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
        window._mutsuSlideOver = false;
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
            const source = (globalThis.global?.stage?.get_event_actor?.(event) ?? event.get_source?.() ?? null); // see touchRouter.eventActor
            for (const [kind, actor] of [['divider', this._divider], ['handle', this._handle],
                ['tab', this._tab]]) {
                if (actor.visible && actor.contains(source)) {
                    this._drag = {kind, sequence, ratio: this._ratio, x, samples: [[Date.now(), x]],
                        startX: this._slides[0]?.get_frame_rect().x ?? 0};
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        }
        const drag = this._drag;
        if (!drag || !sameSequence(drag.sequence, sequence))
            return Clutter.EVENT_PROPAGATE;
        const dx = x - drag.x;
        if (type === T.TOUCH_CANCEL) {
            this._drag = null;
            if (drag.kind === 'divider') {
                this._ratio = drag.ratio;
                this._layout();
            }
            this._handle.translation_x = this._tab.translation_x = 0;
            if (drag.kind === 'handle')
                this._layoutSlide(); // back where it was
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
            // The app moves with its handle, sideways only, at a fixed size.
            const window = this._slides[0];
            const monitor = this._monitor();
            drag.samples.push([Date.now(), x]);
            if (window && monitor) {
                const frame = slideOverFrame(monitor, drag.startX + dx);
                this._placing = true;
                try {
                    window.move_frame(true, frame.x, frame.y);
                } finally {
                    this._placing = false;
                }
                this._placeHandle(frame);
                drag.lastX = frame.x;
            }
            if (end) {
                this._drag = null;
                const result = slideOverRelease(dx, dragVelocity(drag.samples));
                if (result === 'tuck-left' || result === 'tuck-right') {
                    this.hideSlide(result === 'tuck-left' ? 'left' : 'right');
                } else if (result === 'tap') {
                    this._layoutSlide();
                    this.nextSlide();
                } else {
                    this._slideX = drag.lastX ?? this._slideX;
                    this._layoutSlide();
                }
            }
        } else if (drag.kind === 'tab') {
            const inward = this._tuckSide === 'left' ? Math.max(0, dx) : Math.min(0, dx);
            this._tab.translation_x = inward;
            if (end) {
                this._drag = null;
                this._tab.translation_x = 0;
                if (Math.abs(inward) > 30 || Math.abs(dx) < 8)
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
