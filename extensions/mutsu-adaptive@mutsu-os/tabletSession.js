import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {TabletKeyboard} from './tabletKeyboard.js';

// Native GNOME input and controls, adapted for touch. The clock/Search
// widgets live on Home itself (tabletHome.js).
//
// The on-screen keyboard is deliberately NOT forced on. GNOME already shows
// it when a text field is tapped and the last input came from the
// touchscreen, and hides it as soon as a hardware keyboard is used. Forcing
// the accessibility setting (as before) kept it popping up over a docked or
// folded-back keyboard on 2-in-1s.
export class TabletSession {
    constructor(settings, journal) {
        this._settings = settings;
        this._journal = journal;
        this._keyboardLayout = new TabletKeyboard();
        this._controls = Main.panel.statusArea.quickSettings?.menu.actor;
        this._notifications = Main.panel.statusArea.dateMenu?.menu.actor;
        this._controls?.add_style_class_name('mutsu-tablet-controls');
        this._notifications?.add_style_class_name('mutsu-tablet-controls');
    }

    destroy() {
        this._keyboardLayout.destroy();
        this._controls?.remove_style_class_name('mutsu-tablet-controls');
        this._notifications?.remove_style_class_name('mutsu-tablet-controls');
    }
}
