import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { QuickMenuToggle, SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js';

const FULLSCREEN_KEY = 'auto-maximize-windows-activation';
const PANEL_HIDE_KEY = 'panel-auto-hide-activation';
const FAB_KEY = 'text-action-fab-show-button';

// Quick Settings pill for Touchshell. The main pill area launches
// extension preferences; the chevron drops down a menu of three
// in-session toggles. We don't reuse the standard "main click toggles
// the headline feature" pattern because three roughly equal toggles
// have no obvious headline — and "open prefs" gives the pill a useful
// purpose beyond a duplicate switch.
//
// Tri-state schema keys (off|auto|always) are surfaced as binary
// switches that remember the last non-off value: turning OFF stashes
// the current value, turning ON restores it. This preserves an Auto
// setting made from prefs even after a session of QS flicks.
const TouchshellMenuToggle = GObject.registerClass(
class TouchshellMenuToggle extends QuickMenuToggle {
    _init(extension) {
        const iconFile = Gio.File.new_for_path(
            `${extension.path}/assets/icons/hicolor/scalable/actions/touchshell-symbolic.svg`);
        const gicon = new Gio.FileIcon({ file: iconFile });
        super._init({
            title: 'Touchshell',
            gicon,
            toggleMode: false,
            menuEnabled: true,
        });
        this._extension = extension;
        this._settings = extension.getSettings();
        this._cleanups = [];

        this.menu.setHeader(gicon, 'Touchshell');

        this._addTriStateSwitch('Fullscreen apps', FULLSCREEN_KEY);
        this._addTriStateSwitch('Auto-hide top panel', PANEL_HIDE_KEY);
        this._addBoolSwitch('Touch text-action FAB', FAB_KEY);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupMenuItem('Touchshell Settings');
        settingsItem.connect('activate',
            () => this._extension.openPreferences());
        this.menu.addMenuItem(settingsItem);

        this._clickedId = this.connect('clicked',
            () => this._extension.openPreferences());
    }

    _addTriStateSwitch(label, key) {
        const initial = this._settings.get_string(key);
        let lastNonOff = initial !== 'off' ? initial : 'always';

        const item = new PopupMenu.PopupSwitchMenuItem(label, initial !== 'off');
        const settingsId = this._settings.connect(`changed::${key}`, () => {
            const v = this._settings.get_string(key);
            if (v !== 'off') lastNonOff = v;
            // setToggleState avoids the recursive 'toggled' emission
            // that .state = ... would cause.
            item.setToggleState(v !== 'off');
        });
        item.connect('toggled', (_i, state) => {
            this._settings.set_string(key, state ? lastNonOff : 'off');
        });
        this._watch(item, settingsId);
        this.menu.addMenuItem(item);
    }

    _addBoolSwitch(label, key) {
        const item = new PopupMenu.PopupSwitchMenuItem(
            label, this._settings.get_boolean(key));
        const settingsId = this._settings.connect(`changed::${key}`, () => {
            item.setToggleState(this._settings.get_boolean(key));
        });
        item.connect('toggled', (_i, state) => {
            this._settings.set_boolean(key, state);
        });
        this._watch(item, settingsId);
        this.menu.addMenuItem(item);
    }

    // Mutsu: stop following the setting when the item goes, however it goes.
    // The Quick Settings menu can be torn down before this toggle (at session
    // end), and a settings change then reached a destroyed switch ("can't
    // access property 'factor', obj is null").
    _watch(item, settingsId) {
        const settings = this._settings;
        let connected = true;
        const stop = () => {
            if (connected)
                settings.disconnect(settingsId);
            connected = false;
        };
        item.connect('destroy', stop);
        this._cleanups.push(stop);
    }

    destroy() {
        if (this._clickedId) {
            this.disconnect(this._clickedId);
            this._clickedId = 0;
        }
        for (const fn of this._cleanups)
            fn();
        this._cleanups = [];
        this._settings = null;
        this._extension = null;
        super.destroy();
    }
});

const TouchshellIndicator = GObject.registerClass(
class TouchshellIndicator extends SystemIndicator {
    _init(toggle) {
        super._init();
        this.quickSettingsItems.push(toggle);
    }
});

export class TouchshellQuickSettings {
    constructor(extension) {
        this._toggle = new TouchshellMenuToggle(extension);
        this._indicator = new TouchshellIndicator(this._toggle);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    destroy() {
        if (this._indicator) {
            this._indicator.quickSettingsItems.forEach(i => i.destroy());
            this._indicator.destroy();
            this._indicator = null;
            this._toggle = null;
        }
    }
}
