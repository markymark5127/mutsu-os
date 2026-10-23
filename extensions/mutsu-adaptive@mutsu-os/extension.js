import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';

const BOTTOM_EDGE_HEIGHT = 24; // px; keep small so OSK bottom gesture can still win

export default class MutsuAdaptiveExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._inTablet = false;
        this._maximizeHandlerId = 0;
        this._gestureActors = [];

        // Panel indicator / quick toggle
        this._indicator = new PanelMenu.Button(0.0, 'Mutsu Adaptive', false);
        const icon = new St.Icon({
            icon_name: 'view-app-grid-symbolic',
            style_class: 'system-status-icon',
        });
        this._indicator.add_child(icon);
        this._indicator.menu.addAction('Toggle Tablet Mode', () => this._toggleManual());
        this._indicator.menu.addAction('Always Desktop', () => this._setMode('always-desktop'));
        this._indicator.menu.addAction('Always Tablet', () => this._setMode('always-tablet'));
        this._indicator.menu.addAction('Automatic', () => this._setMode('automatic'));
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._settingsChangedId = this._settings.connect('changed::mode', () => this._applyFromSettings());
        this._applyFromSettings();
    }

    disable() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._leaveTablet();
        this._settings = null;
    }

    _setMode(mode) {
        this._settings.set_string('mode', mode);
    }

    _toggleManual() {
        const current = this._settings.get_string('mode');
        if (current === 'always-tablet')
            this._setMode('always-desktop');
        else
            this._setMode('always-tablet');
    }

    _applyFromSettings() {
        const mode = this._settings.get_string('mode');
        if (mode === 'always-tablet')
            this._enterTablet();
        else if (mode === 'always-desktop')
            this._leaveTablet();
        // automatic: hardware signal not yet wired; stay in current state
    }

    _enterTablet() {
        if (this._inTablet)
            return;
        this._inTablet = true;

        if (this._settings.get_boolean('open-home-on-tablet')) {
            try {
                Main.overview.showApps();
            } catch (e) {
                log(`Mutsu Adaptive: showApps failed (${e})`);
            }
        }

        this._installMaximizeOnLaunch();
        this._installBottomGesture();
        log('Mutsu Adaptive: entered tablet mode');
    }

    _leaveTablet() {
        if (!this._inTablet)
            return;
        this._inTablet = false;

        this._removeMaximizeOnLaunch();
        this._removeBottomGesture();

        try {
            Main.overview.hide();
        } catch (e) {
            // ignore
        }
        log('Mutsu Adaptive: left tablet mode');
    }

    _installMaximizeOnLaunch() {
        if (this._maximizeHandlerId)
            return;
        try {
            this._maximizeHandlerId = global.display.connect('window-created', (_d, win) => {
                if (!this._inTablet)
                    return;
                // Maximize ordinary windows; skip dialogs / splash where possible
                if (win.window_type === Meta.WindowType.NORMAL) {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        try {
                            if (!win.maximized_horizontally || !win.maximized_vertically)
                                win.maximize(Meta.MaximizeFlags.BOTH);
                        } catch (e) {
                            // window may already be destroyed
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });
        } catch (e) {
            log(`Mutsu Adaptive: maximize-on-launch unavailable (${e})`);
        }
    }

    _removeMaximizeOnLaunch() {
        if (this._maximizeHandlerId) {
            try {
                global.display.disconnect(this._maximizeHandlerId);
            } catch (e) {
                // ignore
            }
            this._maximizeHandlerId = 0;
        }
    }

    _installBottomGesture() {
        // Thin bottom-edge actor that recognizes a simple upward swipe.
        // Intentionally small so GNOME's OSK bottom gesture can still activate.
        // Swipe-up → Home; swipe-up-and-hold → Overview (basic threshold).
        if (this._gestureActors.length)
            return;

        try {
            const actor = new St.Widget({
                reactive: true,
                can_focus: false,
                track_hover: false,
                style: 'background-color: transparent;',
            });
            actor.set_size(global.stage.width, BOTTOM_EDGE_HEIGHT);
            actor.set_position(0, global.stage.height - BOTTOM_EDGE_HEIGHT);
            Main.layoutManager.uiGroup.add_child(actor);
            this._gestureActors.push(actor);

            let startY = 0;
            let holding = false;
            actor.connect('button-press-event', (_a, event) => {
                const [, y] = event.get_coords();
                startY = y;
                holding = false;
                return Clutter.EVENT_PROPAGATE;
            });
            actor.connect('motion-event', (_a, event) => {
                if (!startY)
                    return Clutter.EVENT_PROPAGATE;
                const [, y] = event.get_coords();
                const dy = startY - y;
                if (dy > 40 && !holding) {
                    holding = true;
                    // Treat a longer swipe as hold → Overview
                    if (dy > 80)
                        Main.overview.show();
                    else
                        Main.overview.showApps();
                }
                return Clutter.EVENT_PROPAGATE;
            });
            actor.connect('button-release-event', () => {
                startY = 0;
                holding = false;
                return Clutter.EVENT_PROPAGATE;
            });
        } catch (e) {
            log(`Mutsu Adaptive: bottom gesture unavailable (${e})`);
        }
    }

    _removeBottomGesture() {
        for (const actor of this._gestureActors) {
            try {
                actor.destroy();
            } catch (e) {
                // ignore
            }
        }
        this._gestureActors = [];
    }
}
