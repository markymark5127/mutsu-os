import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {dockDropZone} from './tabletGeometry.js';
import {TouchRouter, makeTappable, findHandler} from './touchRouter.js';
import {windowForApp} from './tabletSplitView.js';
import {vbox} from './stCompat.js';

// Temporary touch dock (short pull from the bottom edge). Does not pin
// Dash-to-Dock or reserve screen space.
//
//   tap an app                    open it
//   hold an app and drag it to    the left/right edge: Split View with the
//                                 current app; anywhere else above the dock:
//                                 Slide Over (floats above, like iPadOS)
export class TabletDockPopup {
    constructor(recent, monitor, split = null) {
        this._recent = recent;
        this._monitor = monitor;
        this._split = split;
        this._carry = null;
        this._box = new St.BoxLayout({style_class: 'mutsu-touch-dock', reactive: true});
        Main.layoutManager.addChrome(this._box, {affectsStruts: false});
        this._box.hide();
        this._router = new TouchRouter(this._box, this);
        this._zones = new St.Widget({style_class: 'mutsu-drop-zones', reactive: false});
        Main.layoutManager.uiGroup.add_child(this._zones);
        this._zones.hide();
        this._eventId = global.stage.connect('captured-event', (_stage, event) => {
            if (this._box.visible && !this._carry && [Clutter.EventType.BUTTON_PRESS,
                Clutter.EventType.TOUCH_BEGIN].includes(event.type()) &&
                !this._box.contains(event.get_source()))
                this.hide();
            return Clutter.EVENT_PROPAGATE;
        });
        this._focusId = global.display.connect('notify::focus-window', () => {
            const focus = global.display.focus_window;
            if (focus && focus !== this._sourceWindow && !this._carry)
                this.hide();
        });
    }

    get visible() { return this._box.visible; }

    show() {
        this.hide();
        if (Main.sessionMode.isLocked)
            return;
        this._sourceWindow = global.display.focus_window;
        this._box.destroy_all_children();
        const apps = [...AppFavorites.getAppFavorites().getFavorites(),
            ...Shell.AppSystem.get_default().get_running()];
        const unique = [...new Map(apps.map(app => [app.get_id(), app])).values()];
        const monitor = this._monitor();
        if (!monitor)
            return;
        const count = Math.max(1, Math.floor((monitor.width - 100) / 68) - 1);
        for (const app of unique.slice(0, count)) {
            const button = new St.Widget({style_class: 'mutsu-dock-app',
                layout_manager: new Clutter.BinLayout()});
            button.add_child(app.create_icon_texture(48));
            makeTappable(button, () => this._open(app), app.get_name());
            button._mutsuApp = app;
            button._mutsuLongPress = state => {
                this._startCarry(button, app, state);
                return true;
            };
            this._box.add_child(button);
        }
        const recent = new St.Label({text: 'Recent', style_class: 'mutsu-dock-app',
            y_align: Clutter.ActorAlign.CENTER});
        makeTappable(recent, () => { this.hide(); this._recent(); }, 'Multitasking');
        this._box.add_child(recent);
        const width = Math.min(monitor.width - 32, (Math.min(unique.length, count) + 1) * 68 + 24);
        this._box.set_size(width, 80);
        this._box.set_position(monitor.x + (monitor.width - width) / 2,
            monitor.y + monitor.height - 112);
        this._box.show();
        this._box.get_parent()?.set_child_above_sibling(this._box, null);
        this._box.translation_y = 30;
        this._box.opacity = 0;
        this._box.ease({translation_y: 0, opacity: 255, duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._restartTimer();
    }

    _restartTimer() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
            this._timer = 0;
            if (!this._carry)
                this.hide();
            return this._carry ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        });
    }

    _open(app) {
        this.hide();
        const window = app.get_windows().find(w => !w.is_skip_taskbar());
        if (window)
            Main.activateWindow(window);
        else
            app.activate();
    }

    // ---- drag an app out of the dock -------------------------------------------

    _startCarry(button, app, s) {
        const monitor = this._monitor();
        const [x, y] = button.get_transformed_position();
        const clone = new Clutter.Clone({source: button, opacity: 230});
        clone.set_size(...button.get_size());
        clone.set_pivot_point(0.5, 0.5);
        Main.layoutManager.uiGroup.add_child(clone);
        clone.set_position(x, y);
        clone.ease({scale_x: 1.3, scale_y: 1.3, duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._carry = {app, clone, dx: s.x - x, dy: s.y - y, zone: null};
        this._showZones(monitor);
    }

    _showZones(monitor) {
        this._zones.destroy_all_children();
        this._zones.set_position(monitor.x, monitor.y);
        this._zones.set_size(monitor.width, monitor.height);
        const edge = Math.round(monitor.width * 0.14);
        const make = (name, label, x, width) => {
            const zone = vbox({style_class: 'mutsu-drop-zone', x, y: 48,
                width, height: monitor.height - 200});
            zone.add_child(new St.Widget({y_expand: true}));
            zone.add_child(new St.Label({text: label, x_align: Clutter.ActorAlign.CENTER,
                style_class: 'mutsu-drop-zone-label'}));
            zone.add_child(new St.Widget({y_expand: true}));
            zone._mutsuZone = name;
            this._zones.add_child(zone);
        };
        const split = !!this._sourceWindow;
        if (split) {
            make('split-left', 'Split View', 12, edge - 18);
            make('split-right', 'Split View', monitor.width - edge + 6, edge - 18);
        }
        make('slide', 'Slide Over', edge + 12, monitor.width - edge * 2 - 24);
        this._zones.show();
        this._zones.get_parent()?.set_child_above_sibling(this._zones, null);
        this._carry && this._carry.clone.get_parent()?.set_child_above_sibling(this._carry.clone, null);
    }

    _zoneAt(x, y) {
        const monitor = this._monitor();
        const [, boxY] = this._box.get_transformed_position();
        let zone = dockDropZone(x, y, monitor, boxY);
        if (zone?.startsWith('split') && !this._sourceWindow)
            zone = 'slide';
        return zone;
    }

    heldMove(_dx, _dy, s) {
        const c = this._carry;
        if (!c)
            return;
        c.clone.set_position(s.x - c.dx, s.y - c.dy);
        c.zone = this._zoneAt(s.x, s.y);
        for (const zone of this._zones.get_children()) {
            if (zone._mutsuZone === c.zone)
                zone.add_style_class_name('mutsu-drop-zone-active');
            else
                zone.remove_style_class_name('mutsu-drop-zone-active');
        }
    }

    heldEnd(s) {
        const c = this._carry;
        this._carry = null;
        this._zones.hide();
        if (!c)
            return;
        c.clone.destroy();
        const zone = this._zoneAt(s.x, s.y);
        const current = this._sourceWindow;
        this.hide();
        if (!zone)
            return; // dropped back on the dock
        windowForApp(c.app, window => {
            if (!window || !this._split)
                return;
            if (zone === 'slide')
                this._split.slideOver(window);
            else if (current && current !== window && zone === 'split-left')
                this._split.arrange(window, current);
            else if (current && current !== window)
                this._split.arrange(current, window);
        }, {newWindow: current ? c.app.get_windows().includes(current) : false});
    }

    cancel() {
        if (!this._carry)
            return;
        this._carry.clone.destroy();
        this._carry = null;
        this._zones.hide();
    }

    tap(s) {
        return !findHandler(s.source, this._box, '_mutsuTap');
    }

    hide() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        this._box.hide();
    }

    destroy() {
        this.cancel();
        this.hide();
        this._router.destroy();
        global.stage.disconnect(this._eventId);
        global.display.disconnect(this._focusId);
        Main.layoutManager.removeChrome(this._box);
        this._box.destroy();
        this._zones.destroy();
    }
}
