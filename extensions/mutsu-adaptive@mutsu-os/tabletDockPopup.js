import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Temporary touch dock: does not pin Dash-to-Dock or reserve screen space.
export class TabletDockPopup {
    constructor(recent) {
        this._recent = recent;
        this._box = new St.BoxLayout({style_class: 'mutsu-touch-dock', reactive: true});
        Main.layoutManager.addChrome(this._box, {affectsStruts: false});
        this._box.hide();
        this._eventId = global.stage.connect('captured-event', (_stage, event) => {
            if (this._box.visible && [Clutter.EventType.BUTTON_PRESS,
                Clutter.EventType.TOUCH_BEGIN].includes(event.type()) &&
                !this._box.contains(event.get_source()))
                this.hide();
            return Clutter.EVENT_PROPAGATE;
        });
        this._focusId = global.display.connect('notify::focus-window', () => {
            const focus = global.display.focus_window;
            if (focus && focus !== this._sourceWindow)
                this.hide();
        });
    }

    show() {
        this.hide();
        if (Main.sessionMode.isLocked)
            return;
        this._sourceWindow = global.display.focus_window;
        this._box.destroy_all_children();
        const apps = [...AppFavorites.getAppFavorites().getFavorites(),
            ...Shell.AppSystem.get_default().get_running()];
        const unique = [...new Map(apps.map(app => [app.get_id(), app])).values()];
        const monitor = Main.layoutManager.primaryMonitor;
        const count = Math.max(1, Math.floor((monitor.width - 100) / 68) - 1);
        for (const app of unique.slice(0, count)) {
            const button = new St.Button({style_class: 'mutsu-dock-app',
                accessible_name: app.get_name(), child: app.create_icon_texture(48)});
            button.connect('clicked', () => {
                this.hide();
                Main.overview.hide();
                const window = app.get_windows().find(w => !w.is_skip_taskbar());
                if (window)
                    Main.activateWindow(window);
                else
                    app.activate();
            });
            this._box.add_child(button);
        }
        const recent = new St.Button({label: 'Recent', style_class: 'mutsu-dock-app',
            accessible_name: 'Recent Apps and Split View'});
        recent.connect('clicked', () => { this.hide(); this._recent(); });
        this._box.add_child(recent);
        const width = Math.min(monitor.width - 32, (Math.min(unique.length, count) + 1) * 68 + 24);
        this._box.set_size(width, 80);
        this._box.set_position(monitor.x + (monitor.width - width) / 2,
            monitor.y + monitor.height - 112);
        this._box.show();
        this._box.translation_y = 30;
        this._box.opacity = 0;
        this._box.ease({translation_y: 0, opacity: 255, duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
            this._timer = 0;
            this.hide();
            return GLib.SOURCE_REMOVE;
        });
    }

    hide() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        this._box.hide();
    }

    destroy() {
        this.hide();
        global.stage.disconnect(this._eventId);
        global.display.disconnect(this._focusId);
        Main.layoutManager.removeChrome(this._box);
        this._box.destroy();
    }
}
