import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
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

    _switch(group, settings, key, title, subtitle) {
        const row = new Adw.SwitchRow({title, subtitle});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);
    }
}
