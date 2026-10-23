import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

export default class MutsuAdaptiveExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._inTablet = false;
        this._saved = {};

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

        // Try to listen for Mutter tablet-mode changes when available
        this._onTabletChanged = this._onTabletChanged.bind(this);
        try {
            if (Main.layoutManager && Main.layoutManager._startingUp === false) {
                // Some Mutter versions expose tablet mode via the seat or backend.
                // We fall back to a settings-driven manual mode if the signal is absent.
            }
        } catch (e) {
            log(`Mutsu Adaptive: tablet signal unavailable (${e})`);
        }

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
        // automatic: wait for hardware signal (or stay in current state)
    }

    _onTabletChanged(active) {
        const mode = this._settings.get_string('mode');
        if (mode !== 'automatic')
            return;
        if (active)
            this._enterTablet();
        else
            this._leaveTablet();
    }

    _enterTablet() {
        if (this._inTablet)
            return;
        this._inTablet = true;

        // Open app grid as Home
        if (this._settings.get_boolean('open-home-on-tablet')) {
            try {
                Main.overview.showApps();
            } catch (e) {
                log(`Mutsu Adaptive: showApps failed (${e})`);
            }
        }

        // Future: larger touch targets, maximize-on-launch, bottom gesture surface.
        // These require additional Shell hooks and careful OSK coexistence testing.
        log('Mutsu Adaptive: entered tablet mode');
    }

    _leaveTablet() {
        if (!this._inTablet)
            return;
        this._inTablet = false;

        try {
            Main.overview.hide();
        } catch (e) {
            // ignore
        }
        log('Mutsu Adaptive: left tablet mode');
    }
}
