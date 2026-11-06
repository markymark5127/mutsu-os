import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {isWindowMaximized, gripResize} from './tabletGeometry.js';

// Floating windows (the green button floats an app in tablet mode) get a
// finger-sized resize grip at the bottom-right corner, like Stage Manager.
// Moving still uses the app's own title bar, which GTK supports by touch.
export class TabletWindowGrips {
    constructor({monitor, excluded}) {
        this._monitor = monitor;
        this._excluded = excluded; // window => true for Split View / Slide Over
        this._window = null;
        this._windowSignals = [];
        this._drag = null;
        this._grip = new St.Widget({style_class: 'mutsu-resize-grip', reactive: true,
            width: 44, height: 44, accessible_name: 'Resize window'});
        Main.layoutManager.addChrome(this._grip, {affectsStruts: false});
        this._grip.hide();
        this._focusId = global.display.connect('notify::focus-window', () => this._track());
        this._sessionId = Main.sessionMode.connect('updated', () => this._sync());
        this._eventId = this._grip.connect('event', (_a, event) => this._event(event));
        this._track();
    }

    _floating(window) {
        return !!window && window.get_window_type() === Meta.WindowType.NORMAL &&
            !window.is_skip_taskbar() && !window.minimized && !window.is_fullscreen() &&
            !isWindowMaximized(window) && window.allows_resize() && !this._excluded(window);
    }

    _track() {
        for (const [window, id] of this._windowSignals)
            window.disconnect(id);
        this._windowSignals = [];
        this._window = global.display.focus_window;
        if (this._window) {
            for (const signal of ['position-changed', 'size-changed', 'notify::minimized', 'unmanaged']) {
                this._windowSignals.push([this._window, this._window.connect(signal, () => {
                    if (signal === 'unmanaged') {
                        this._window = null;
                        this._windowSignals = [];
                    }
                    this._sync();
                })]);
            }
        }
        this._sync();
    }

    _sync() {
        const window = this._window;
        const show = !Main.sessionMode.isLocked && this._floating(window);
        if (!show) {
            if (!this._drag)
                this._grip.hide();
            return;
        }
        const r = window.get_frame_rect();
        this._grip.set_position(r.x + r.width - 30, r.y + r.height - 30);
        this._grip.show();
        this._grip.get_parent()?.set_child_above_sibling(this._grip, null);
    }

    _event(event) {
        const T = Clutter.EventType;
        const type = event.type();
        const [x, y] = event.get_coords();
        if (type === T.TOUCH_BEGIN || (type === T.BUTTON_PRESS && event.get_button() === 1)) {
            if (!this._window)
                return Clutter.EVENT_PROPAGATE;
            this._drag = {x, y, rect: this._window.get_frame_rect(),
                sequence: event.get_event_sequence?.() ?? null};
            return Clutter.EVENT_STOP;
        }
        if (!this._drag)
            return Clutter.EVENT_PROPAGATE;
        if (type === T.TOUCH_UPDATE || type === T.MOTION || type === T.TOUCH_END ||
            type === T.BUTTON_RELEASE) {
            const r = gripResize(this._drag.rect, x - this._drag.x, y - this._drag.y,
                this._monitor());
            this._window?.move_resize_frame(true, r.x, r.y, r.width, r.height);
            if (type === T.TOUCH_END || type === T.BUTTON_RELEASE)
                this._drag = null;
            return Clutter.EVENT_STOP;
        }
        if (type === T.TOUCH_CANCEL) {
            this._drag = null;
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    destroy() {
        for (const [window, id] of this._windowSignals)
            window.disconnect(id);
        this._windowSignals = [];
        global.display.disconnect(this._focusId);
        Main.sessionMode.disconnect(this._sessionId);
        Main.layoutManager.removeChrome(this._grip);
        this._grip.destroy();
    }
}
