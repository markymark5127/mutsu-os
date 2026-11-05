import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {TabletKeyboard} from './tabletKeyboard.js';

const A11Y = 'org.gnome.desktop.a11y.applications';
const OSK = 'screen-keyboard-enabled';

// Native GNOME input and controls, adapted for touch. The clock/Search
// widgets now live on Home itself (tabletHome.js). System settings changes
// go through the crash-safe journal and are restored by the extension.
export class TabletSession {
    constructor(settings, journal) {
        this._settings = settings;
        this._journal = journal;
        this._keyboardLayout = new TabletKeyboard();
        this._syncKeyboard();
        this._settingsId = settings.connect('changed::automatic-keyboard', () => this._syncKeyboard());
        this._controls = Main.panel.statusArea.quickSettings?.menu.actor;
        this._notifications = Main.panel.statusArea.dateMenu?.menu.actor;
        this._controls?.add_style_class_name('mutsu-tablet-controls');
        this._notifications?.add_style_class_name('mutsu-tablet-controls');
    }

    _syncKeyboard() {
        if (this._settings.get_boolean('automatic-keyboard'))
            this._journal.change(A11Y, OSK, s => s.set_boolean(OSK, true));
        else
            this._journal.revert(A11Y, OSK);
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        this._keyboardLayout.destroy();
        this._controls?.remove_style_class_name('mutsu-tablet-controls');
        this._notifications?.remove_style_class_name('mutsu-tablet-controls');
    }
}
