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
            subtitle: 'Automatic follows the keyboard fold when the hardware reports it',
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
        this._switch(behavior, settings, 'open-home-on-tablet', 'Open the app grid', 'Show Applications becomes Home');
        this._switch(behavior, settings, 'enable-experimental-gestures', 'Bottom swipe gestures', 'Short pull: Dock · Long swipe: Home · Hold: Recent Apps · Sideways: switch apps');
        this._switch(behavior, settings, 'collapse-dock-in-tablet', 'Hide the dock', 'Autohide Dash to Dock while folded');
        this._switch(behavior, settings, 'rotation-lock', 'Lock rotation', 'Stop auto-rotate while in tablet mode');
        this._switch(behavior, settings, 'home-widgets', 'Home widgets', 'Clock, date and touch shortcuts');
        this._switch(behavior, settings, 'automatic-keyboard', 'On-screen keyboard', 'Show the native keyboard for text fields in tablet mode');
    }

    _switch(group, settings, key, title, subtitle) {
        const row = new Adw.SwitchRow({title, subtitle});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);
    }
}
