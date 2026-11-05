import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {navigationAction} from './tabletGeometry.js';
import {TabletDockPopup} from './tabletDockPopup.js';
import {TabletSplitView} from './tabletSplitView.js';
import {TabletBlades} from './tabletBlades.js';

// Owns the bottom edge: the Home indicator and the system navigation
// gestures. Kept separate from GNOME's workspace overview.
//
//   short pull up            temporary dock
//   swipe up                 Home (the app shrinks away, Home shows through)
//   swipe up and pause       multitasking blades
//   swipe along the edge     previous / next app
export class TabletSwitcher {
    constructor(home, suppressed, gesturesEnabled, monitor) {
        this._home = home;
        this._suppressed = suppressed;
        this._gesturesEnabled = gesturesEnabled;
        this._monitor = monitor;
        this._drag = null;
        this._hiddenActors = [];
        this._restoreId = 0;
        this._split = new TabletSplitView(monitor);
        this._dock = new TabletDockPopup(() => this.show(), monitor);
        this._blades = new TabletBlades({monitor, split: this._split, home: () => this._home()});
        this._bar = new St.Button({style_class: 'mutsu-home-bar',
            accessible_name: 'Home. Swipe up and hold for multitasking',
            child: new St.Widget({style_class: 'mutsu-home-indicator'})});
        this._bar.connect('clicked', () => this._home());
        Main.layoutManager.addChrome(this._bar, {affectsInputRegion: true});
        this._monitorId = Main.layoutManager.connect('monitors-changed', () => {
            this.hide();
            this._dock.hide();
            this._resetPreview();
            this._positionBar();
        });
        this._positionBar();
        this._sessionId = Main.sessionMode.connect('updated', () => {
            this._syncBar();
            if (Main.sessionMode.isLocked)
                this.hide();
            this._dock.hide();
            this._drag = null;
            this._resetPreview();
        });
        this._keyboardId = Main.layoutManager.keyboardBox.connect('notify::visible', () => {
            const visible = Main.layoutManager.keyboardBox.visible;
            this._syncBar();
            if (visible) {
                this._drag = null;
                this._resetPreview();
                this._dock.hide();
            }
        });
        this._windowId = global.display.connect('window-created', (_display, window) => {
            if (this.visible && window.get_transient_for())
                this.hide(); // a dialog needs attention
        });
        this._eventId = global.stage.connect('captured-event', (_stage, event) =>
            this._event(event));
        this._syncBar();
    }

    get visible() { return this._blades.visible; }
    get split() { return this._split; }

    show() {
        this._dock.hide();
        this._blades.show();
    }

    hide() {
        this._blades.hide(false);
    }

    _arm() {
        this._armed = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            this._armed = 0;
            this._bar.remove_style_class_name('mutsu-home-bar-armed');
            return GLib.SOURCE_REMOVE;
        });
        this._bar.add_style_class_name('mutsu-home-bar-armed');
    }

    _disarm() {
        if (this._armed)
            GLib.source_remove(this._armed);
        this._armed = 0;
        this._bar.remove_style_class_name('mutsu-home-bar-armed');
    }

    _syncBar() {
        this._bar.visible = !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter &&
            !Main.layoutManager.keyboardBox.visible;
    }

    _positionBar() {
        const monitor = this._monitor();
        if (!monitor)
            return;
        this._bar.set_position(monitor.x + (monitor.width - 240) / 2,
            monitor.y + monitor.height - 24);
        this._bar.set_size(240, 24);
    }

    _event(event) {
        const type = event.type();
        const touch = type === Clutter.EventType.TOUCH_BEGIN ||
            type === Clutter.EventType.TOUCH_UPDATE ||
            type === Clutter.EventType.TOUCH_END || type === Clutter.EventType.TOUCH_CANCEL;
        const begin = type === Clutter.EventType.TOUCH_BEGIN || type === Clutter.EventType.BUTTON_PRESS;
        const end = type === Clutter.EventType.TOUCH_END || type === Clutter.EventType.BUTTON_RELEASE;
        if (!touch && !begin && !end && type !== Clutter.EventType.MOTION)
            return Clutter.EVENT_PROPAGATE;
        const sequence = touch ? event.get_event_sequence() : null;
        const [x, y] = event.get_coords();
        if (begin) {
            if (this._drag || Main.sessionMode.isLocked || this._suppressed())
                return Clutter.EVENT_PROPAGATE;
            if (!touch && event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            const m = this._monitor();
            const edge = this._gesturesEnabled() && !this.visible &&
                !Main.layoutManager.keyboardBox?.visible &&
                !(Main.modalCount > 0) &&
                m && x >= m.x && x <= m.x + m.width &&
                y >= m.y + m.height - 24 && y <= m.y + m.height;
            if (!edge)
                return Clutter.EVENT_PROPAGATE;
            // Full-screen games keep the first swipe (iPadOS "deferred system
            // gestures"): it only lights up the Home indicator; a second swipe
            // within a couple of seconds navigates.
            if (global.display.focus_window?.is_fullscreen?.() && !this._armed) {
                this._arm();
                return Clutter.EVENT_PROPAGATE;
            }
            this._disarm();
            this._drag = {x, y, sequence, time: event.get_time(), lastY: y,
                lastTime: event.get_time(), movedAt: event.get_time()};
            return Clutter.EVENT_STOP;
        }
        const drag = this._drag;
        if (!drag || drag.sequence !== sequence)
            return Clutter.EVENT_PROPAGATE;
        if (type === Clutter.EventType.TOUCH_CANCEL) {
            this._resetPreview();
            this._drag = null;
            return Clutter.EVENT_STOP;
        }
        const dy = y - drag.y;
        if (Math.abs(y - drag.lastY) > 4)
            drag.movedAt = event.get_time();
        drag.lastY = y;
        drag.lastTime = event.get_time();
        if (!this._preview && Math.max(Math.abs(x - drag.x), Math.abs(dy)) > 8)
            this._startPreview();
        this._updatePreview(x - drag.x, dy);
        if (end) {
            this._drag = null;
            const action = navigationAction(x - drag.x, dy,
                event.get_time() - drag.time, event.get_time() - drag.movedAt,
                this._monitor().height);
            if (action === 'switcher') {
                this._resetPreview();
                this.show();
            } else if (action === 'home') {
                this._home();
                this._shrinkIntoHome();
            } else if (action === 'dock') {
                this._resetPreview();
                this._dock.show();
            } else if (action === 'next' || action === 'previous') {
                this._quickSwitch(action === 'next' ? 1 : -1);
                this._finishPreview();
            } else {
                this._finishPreview();
            }
        }
        return Clutter.EVENT_STOP;
    }

    // The app follows the finger; everything behind it is hidden so Home
    // shows through, as on iPadOS.
    _startPreview() {
        this._resetPreview();
        if (Main.overview.visible)
            return;
        const window = global.display.focus_window;
        const source = window?.get_compositor_private();
        if (!source || window.is_skip_taskbar())
            return;
        const monitor = this._monitor();
        const rect = window.get_frame_rect();
        this._preview = new St.Widget({reactive: false, clip_to_allocation: true});
        this._preview.set_position(monitor.x, monitor.y);
        this._preview.set_size(monitor.width, monitor.height);
        this._previewClone = new Clutter.Clone({source});
        this._previewClone.set_size(rect.width, rect.height);
        this._previewClone.set_position(rect.x - monitor.x, rect.y - monitor.y);
        this._previewClone.set_pivot_point(0.5, 0.5);
        this._preview.add_child(this._previewClone);
        Main.layoutManager.uiGroup.add_child(this._preview);
        this._hideWindows(monitor);
    }

    _hideWindows(monitor) {
        this._showWindows();
        const index = Main.layoutManager.monitors.indexOf?.(monitor) ?? -1;
        for (const window of global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)) {
            if (window.minimized || (index >= 0 && window.get_monitor() !== index))
                continue;
            const actor = window.get_compositor_private();
            if (actor && actor.opacity > 0) {
                this._hiddenActors.push(actor);
                actor.opacity = 0;
            }
        }
    }

    _showWindows() {
        if (this._restoreId)
            GLib.source_remove(this._restoreId);
        this._restoreId = 0;
        for (const actor of this._hiddenActors) {
            try {
                actor.opacity = 255;
            } catch (e) { /* window closed */ }
        }
        this._hiddenActors = [];
    }

    _updatePreview(dx, dy) {
        if (!this._previewClone)
            return;
        const progress = Math.min(1, Math.max(0, -dy / 320));
        const scale = Math.abs(dx) > Math.abs(dy) ? 1 : 1 - progress * 0.35;
        this._previewClone.set_scale(scale, scale);
        this._previewClone.translation_y = Math.min(0, dy) * 0.3;
        this._previewClone.translation_x = dx * 0.7;
    }

    _resetPreview() {
        this._preview?.destroy();
        this._preview = null;
        this._previewClone = null;
        this._showWindows();
    }

    _shrinkIntoHome() {
        const clone = this._previewClone;
        const preview = this._preview;
        if (!clone || !preview) {
            this._finishPreview();
            return;
        }
        // Windows are minimizing underneath; un-hide them once that settles.
        if (this._restoreId)
            GLib.source_remove(this._restoreId);
        this._restoreId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 450, () => {
            this._restoreId = 0;
            this._showWindows();
            return GLib.SOURCE_REMOVE;
        });
        clone.ease({
            scale_x: 0.18, scale_y: 0.18,
            translation_y: 80, opacity: 0,
            duration: 280, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                if (this._preview === preview) {
                    this._preview.destroy();
                    this._preview = null;
                    this._previewClone = null;
                }
            },
        });
    }

    _finishPreview() {
        const preview = this._preview;
        this._showWindows();
        if (!preview)
            return;
        preview.ease({opacity: 0, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._preview === preview)
                    this._resetPreview();
            }});
    }

    _quickSwitch(direction) {
        const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .filter(w => !w.is_skip_taskbar() && w.get_window_type() === Meta.WindowType.NORMAL);
        const current = global.display.focus_window;
        const now = global.get_current_time();
        if (!this._ring?.includes(current) || now - this._ringTime > 2500)
            this._ring = windows;
        this._ring = this._ring.filter(window => windows.includes(window));
        if (this._ring.length < 2)
            return;
        const index = this._ring.indexOf(current);
        const target = this._ring[(index + direction + this._ring.length) % this._ring.length];
        this._ringTime = now;
        Main.activateWindow(target);
    }

    destroy() {
        this._disarm();
        this.hide();
        this._resetPreview();
        this._blades.destroy();
        this._dock.destroy();
        this._split.destroy();
        global.stage.disconnect(this._eventId);
        global.display.disconnect(this._windowId);
        Main.sessionMode.disconnect(this._sessionId);
        Main.layoutManager.disconnect(this._monitorId);
        Main.layoutManager.keyboardBox.disconnect(this._keyboardId);
        Main.layoutManager.removeChrome(this._bar);
        this._bar.destroy();
    }
}
