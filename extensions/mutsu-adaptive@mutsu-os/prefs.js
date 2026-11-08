import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {findHardwareSources, hasAngleSource, readHingeAngle} from './posture.js';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class MutsuAdaptivePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'Adaptive Desktop',
            icon_name: 'view-app-grid-symbolic',
        });
        window.add(page);

        const mode = new Adw.PreferencesGroup({title: 'Mode'});
        page.add(mode);
        const modeRow = new Adw.ComboRow({
            title: 'Tablet mode',
            subtitle: 'Automatic switches when the 2-in-1 is folded. The Quick Settings toggle overrides it until the next fold.',
            model: Gtk.StringList.new(['Automatic', 'Always desktop', 'Always tablet']),
        });
        const modes = ['automatic', 'always-desktop', 'always-tablet'];
        modeRow.selected = Math.max(0, modes.indexOf(settings.get_string('mode')));
        modeRow.connect('notify::selected', () => {
            settings.set_string('mode', modes[modeRow.selected] || 'automatic');
        });
        mode.add(modeRow);
        this._hingeRows(mode, settings);
        this._switch(mode, settings, 'tablet-from-orientation', 'Turning the screen sideways means tablet',
            'For when the laptop misses a fold: held sideways or upside down, it switches and rotates. Typing switches back.');

        const behavior = new Adw.PreferencesGroup({title: 'When in tablet mode'});
        page.add(behavior);
        this._switch(behavior, settings, 'open-home-on-tablet', 'Always go Home when folding',
            'Off: the app you were using stays open full screen; the rest wait in multitasking');
        this._switch(behavior, settings, 'enable-experimental-gestures', 'Bottom swipe gestures',
            'Short pull: Dock · Swipe: Home · Swipe and hold: Multitasking · Sideways: switch apps');
        this._switch(behavior, settings, 'collapse-dock-in-tablet', 'Hide the desktop dock',
            'Home has its own dock');
        this._switch(behavior, settings, 'tablet-window-buttons', 'Window buttons in tablet mode',
            'Off: gestures close, minimize and tuck apps. On: finger-sized traffic lights');
        this._switch(behavior, settings, 'rotation-lock', 'Lock rotation',
            'Stop auto-rotate while in tablet mode');
        this._switch(behavior, settings, 'home-widgets', 'Home clock', 'Time and date on Home');

        const home = new Adw.PreferencesGroup({title: 'Home Screen'});
        page.add(home);
        const reset = new Adw.ActionRow({title: 'Reset Home Screen layout',
            subtitle: 'Alphabetical order, with games gathered in a folder'});
        const button = new Gtk.Button({label: 'Reset', valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action']});
        button.connect('clicked', () => settings.set_string('home-layout', ''));
        reset.add_suffix(button);
        home.add(reset);
    }

    // Where Automatic switches: the laptop's own tablet sensor, or a hinge
    // angle (presets plus custom) on laptops that report the angle.
    _hingeRows(group, settings) {
        const presets = [[0, 'Laptop\'s tablet sensor'], [180, 'Past flat (over 180°)'],
            [225, 'Tent (over 225°)'], [359, 'Fully folded (360°)'], [-1, 'Custom angle']];
        const row = new Adw.ComboRow({
            title: 'Switch to tablet at',
            subtitle: 'Automatic mode only',
            model: Gtk.StringList.new(presets.map(p => p[1])),
        });
        const custom = new Adw.SpinRow({
            title: 'Custom angle',
            subtitle: 'Tablet mode once the hinge opens past this; back to desktop 25° below',
            adjustment: new Gtk.Adjustment({lower: 90, upper: 359, step_increment: 5, page_increment: 15}),
        });
        const status = new Adw.ActionRow({title: 'Hinge angle', subtitle: 'Checking…'});
        const sync = () => {
            const value = settings.get_int('tablet-hinge-angle');
            const index = presets.findIndex(p => p[0] === value);
            const selected = index >= 0 ? index : presets.length - 1;
            if (row.selected !== selected)
                row.selected = selected;
            custom.visible = selected === presets.length - 1;
            if (value > 0 && custom.value !== value)
                custom.value = value;
        };
        row.connect('notify::selected', () => {
            const preset = presets[row.selected]?.[0] ?? 0;
            if (preset >= 0)
                settings.set_int('tablet-hinge-angle', preset);
            else if (settings.get_int('tablet-hinge-angle') <= 0 ||
                     presets.some(p => p[0] === settings.get_int('tablet-hinge-angle')))
                settings.set_int('tablet-hinge-angle', 200);
            sync();
        });
        custom.connect('notify::value', () => {
            if (row.selected === presets.length - 1)
                settings.set_int('tablet-hinge-angle', Math.round(custom.value));
        });
        const changedId = settings.connect('changed::tablet-hinge-angle', sync);
        sync();
        group.add(row);
        group.add(custom);
        group.add(status);

        // Live readout, so the user can see what the laptop reports.
        const readFile = path => {
            try {
                const [ok, bytes] = GLib.file_get_contents(path);
                return ok ? new TextDecoder().decode(bytes) : null;
            } catch (e) {
                return null;
            }
        };
        const listDir = path => {
            try {
                const names = [];
                const it = Gio.File.new_for_path(path).enumerate_children('standard::name',
                    Gio.FileQueryInfoFlags.NONE, null);
                for (let info; (info = it.next_file(null));)
                    names.push(info.get_name());
                return names;
            } catch (e) {
                return [];
            }
        };
        const sources = findHardwareSources(readFile, listDir);
        const refresh = () => {
            if (!hasAngleSource(sources)) {
                status.subtitle = 'This laptop does not report its hinge angle, so Automatic uses its tablet sensor whatever you pick here.';
                return GLib.SOURCE_CONTINUE;
            }
            const angle = readHingeAngle(sources, readFile);
            status.subtitle = angle === null
                ? 'Hold the laptop level to read the angle'
                : `Now: ${angle}° (0° closed, 180° flat, 360° folded into a tablet)`;
            return GLib.SOURCE_CONTINUE;
        };
        refresh();
        const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, refresh);
        row.connect('destroy', () => {
            GLib.source_remove(timer);
            settings.disconnect(changedId);
        });
    }

    _switch(group, settings, key, title, subtitle) {
        const row = new Adw.SwitchRow({title, subtitle});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);
    }
}
