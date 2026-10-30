import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {TabletKeyboard} from './tabletKeyboard.js';

// Home widgets and native GNOME input/controls. No network-backed widgets.
export class TabletSession {
    constructor(search, settings) {
        this._signals = [];
        this._settings = settings;
        this._keyboard = new Gio.Settings({schema_id: 'org.gnome.desktop.a11y.applications'});
        this._keyboardSaved = this._keyboard.get_user_value('screen-keyboard-enabled');
        this._keyboardLayout = new TabletKeyboard();
        this._syncKeyboard();
        this._controls = Main.panel.statusArea.quickSettings?.menu.actor;
        this._notifications = Main.panel.statusArea.dateMenu?.menu.actor;
        this._controls?.add_style_class_name('mutsu-tablet-controls');
        this._notifications?.add_style_class_name('mutsu-tablet-controls');
        this._strip = new St.BoxLayout({style_class: 'mutsu-home-widgets', reactive: true});
        this._clock = new St.Label({style_class: 'mutsu-home-clock', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        this._strip.add_child(this._clock);
        const tools = new St.BoxLayout({style_class: 'mutsu-home-tools'});
        this._strip.add_child(tools);
        for (const [label, action] of [
            ['Search', search],
            ['Controls', () => Main.panel.statusArea.quickSettings?.menu.open()],
            ['Notifications', () => Main.panel.statusArea.dateMenu?.menu.open()],
            ['Keyboard', () => Main.keyboard.open(Main.layoutManager.primaryIndex)],
        ]) {
            const button = new St.Button({label, style_class: 'mutsu-tablet-button', accessible_name: label});
            button.connect('clicked', action);
            tools.add_child(button);
        }
        Main.layoutManager.addChrome(this._strip, {affectsStruts: false});
        this._connect(Main.overview, 'showing', () => this._sync());
        this._connect(Main.overview, 'hidden', () => this._sync());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._sync());
        this._connect(Main.sessionMode, 'updated', () => this._sync());
        this._connect(settings, 'changed::home-widgets', () => this._sync());
        this._connect(settings, 'changed::automatic-keyboard', () => this._syncKeyboard());
        this._clockTick();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            this._clockTick();
            return GLib.SOURCE_CONTINUE;
        });
        this._sync();
    }

    _connect(object, name, fn) { this._signals.push([object, object.connect(name, fn)]); }

    _clockTick() {
        const format = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).get_string('clock-format');
        this._clock.text = GLib.DateTime.new_now_local().format(
            format === '12h' ? '%I:%M %p\n%A, %B %e' : '%H:%M\n%A, %B %e');
    }

    _syncKeyboard() {
        if (this._settings.get_boolean('automatic-keyboard'))
            this._keyboard.set_boolean('screen-keyboard-enabled', true);
        else if (this._keyboardSaved === null)
            this._keyboard.reset('screen-keyboard-enabled');
        else
            this._keyboard.set_value('screen-keyboard-enabled', this._keyboardSaved);
    }

    _sync() {
        const overview = Main.overview._overview;
        if (this._settings.get_boolean('home-widgets'))
            overview?.remove_style_class_name('mutsu-home-no-widgets');
        else
            overview?.add_style_class_name('mutsu-home-no-widgets');
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        // Narrow portrait layouts use two lines rather than overflowing.
        this._strip.vertical = monitor.width < 850;
        this._strip.set_position(monitor.x + 24, monitor.y + 42);
        this._strip.set_width(monitor.width - 48);
        this._strip.visible = (Main.overview.visibleTarget || Main.overview.visible) &&
            this._settings.get_boolean('home-widgets') &&
            !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter;
    }

    destroy() {
        this._keyboardLayout.destroy();
        Main.overview._overview?.remove_style_class_name('mutsu-home-no-widgets');
        GLib.source_remove(this._timer);
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._controls?.remove_style_class_name('mutsu-tablet-controls');
        this._notifications?.remove_style_class_name('mutsu-tablet-controls');
        if (this._keyboardSaved === null)
            this._keyboard.reset('screen-keyboard-enabled');
        else
            this._keyboard.set_value('screen-keyboard-enabled', this._keyboardSaved);
        Main.layoutManager.removeChrome(this._strip);
        this._strip.destroy();
    }
}
