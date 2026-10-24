import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';

// EXPERIMENTAL — disabled by default in the Mutsu OS image.
// Automatic tablet posture detection is not implemented.
// Bottom-edge gestures are off unless the user explicitly enables the experimental setting.
// Always test on a disposable VM before enabling on real hardware.
// Recovery: gnome-extensions disable mutsu-adaptive@mutsu-os

const BOTTOM_EDGE_HEIGHT = 24;
const DEBOUNCE_MS = 400;

export default class MutsuAdaptiveExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._inTablet = false;
        this._maximizeHandlerId = 0;
        this._gestureActors = [];
        this._debounceSource = 0;
        this._pendingTablet = null;
        this._saved = {};

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

        this._qsToggle = null;
        try {
            const menu = Main.panel.statusArea.quickSettings?.menu;
            if (menu) {
                this._qsToggle = new QuickSettings.QuickToggle({
                    title: 'Tablet Mode',
                    iconName: 'view-app-grid-symbolic',
                    toggleMode: true,
                });
                this._qsToggle.connect('clicked', () => this._toggleManual());
                menu.addItem(this._qsToggle);
            }
        } catch (error) {
            this._qsToggle?.destroy();
            this._qsToggle = null;
            log(`Mutsu Adaptive: Quick Settings unavailable (${error})`);
        }

        this._settingsChangedId = this._settings.connect('changed::mode', () => this._applyFromSettings());
        this._applyFromSettings();
        this._startPostureWatcher();
    }

    disable() {
        if (this._debounceSource) {
            GLib.source_remove(this._debounceSource);
            this._debounceSource = 0;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        if (this._qsToggle) {
            this._qsToggle.destroy();
            this._qsToggle = null;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._stopPostureWatcher();
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
            this._requestTablet(true);
        else if (mode === 'always-desktop')
            this._requestTablet(false);
        this._syncQsToggle();
    }

    _syncQsToggle() {
        if (!this._qsToggle)
            return;
        const mode = this._settings.get_string('mode');
        this._qsToggle.checked = mode === 'always-tablet' || (mode === 'automatic' && this._inTablet);
    }

    _requestTablet(wantTablet) {
        if (this._debounceSource)
            GLib.source_remove(this._debounceSource);
        this._pendingTablet = wantTablet;
        this._debounceSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
            this._debounceSource = 0;
            if (this._pendingTablet === true)
                this._enterTablet();
            else if (this._pendingTablet === false)
                this._leaveTablet();
            this._pendingTablet = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _enterTablet() {
        if (this._inTablet)
            return;
        this._inTablet = true;
        this._saveReversibleState();

        if (this._settings.get_boolean('open-home-on-tablet')) {
            try {
                Main.overview.showApps();
            } catch (e) {
                log(`Mutsu Adaptive: showApps failed (${e})`);
            }
        }

        this._applyTouchVisuals();
        this._installMaximizeOnLaunch();
        if (this._settings.get_boolean('enable-experimental-gestures'))
            this._installBottomGesture();
        this._syncQsToggle();
        log('Mutsu Adaptive: entered tablet mode');
    }

    _leaveTablet() {
        if (!this._inTablet)
            return;
        this._inTablet = false;

        this._removeMaximizeOnLaunch();
        this._removeBottomGesture();
        this._restoreReversibleState();

        try {
            Main.overview.hide();
        } catch (e) {}
        this._syncQsToggle();
        log('Mutsu Adaptive: left tablet mode');
    }

    _saveReversibleState() {
        // Save only values we are about to change. Do not overwrite a11y or user choices.
        try {
            const iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            this._saved.textScaling = iface.get_double('text-scaling-factor');
            this._saved.hadCustomScale = Math.abs(this._saved.textScaling - 1.0) > 0.01;
        } catch (e) {
            this._saved.textScaling = null;
        }
        // Dock state is best-effort; Dash to Dock uses its own schema when present.
        this._saved.dockCollapsed = false;
    }

    _applyTouchVisuals() {
        // Phase 3: temporary larger text while in tablet mode, only if user has not customized it.
        if (!this._saved.hadCustomScale && this._saved.textScaling !== null) {
            try {
                const iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
                const scale = this._settings.get_double('touch-text-scale');
                iface.set_double('text-scaling-factor', scale);
            } catch (e) {
                log(`Mutsu Adaptive: text scale failed (${e})`);
            }
        }

        // Rotation lock (best-effort)
        if (this._settings.get_boolean('rotation-lock')) {
            try {
                const iface = new Gio.Settings({ schema_id: 'org.gnome.settings-daemon.peripherals.touchscreen' });
                // Some versions use orientation-lock; ignore if schema differs.
                if (iface.settings_schema.has_key('orientation-lock'))
                    iface.set_boolean('orientation-lock', true);
            } catch (e) {}
        }

        // Dock collapse (best-effort for Dash to Dock)
        if (this._settings.get_boolean('collapse-dock-in-tablet')) {
            try {
                const dock = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.dash-to-dock' });
                this._saved.dockAutohide = dock.get_boolean('autohide');
                dock.set_boolean('autohide', true);
            } catch (e) {
                // Dash to Dock not present; ignore
            }
        }
    }

    _restoreReversibleState() {
        if (this._saved.textScaling !== null && !this._saved.hadCustomScale) {
            try {
                const iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
                iface.set_double('text-scaling-factor', this._saved.textScaling);
            } catch (e) {}
        }
        if (this._saved.dockAutohide !== undefined) {
            try {
                const dock = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.dash-to-dock' });
                dock.set_boolean('autohide', this._saved.dockAutohide);
            } catch (e) {}
        }
        this._saved = {};
    }

    _startPostureWatcher() {
        log('Mutsu Adaptive: posture watcher scaffold active (hardware signal not yet connected)');
    }

    _stopPostureWatcher() {}

    _installMaximizeOnLaunch() {
        if (this._maximizeHandlerId)
            return;
        try {
            this._maximizeHandlerId = global.display.connect('window-created', (_d, win) => {
                if (!this._inTablet)
                    return;
                if (win.window_type === Meta.WindowType.NORMAL) {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        try {
                            if (!win.maximized_horizontally || !win.maximized_vertically)
                                win.maximize(Meta.MaximizeFlags.BOTH);
                        } catch (e) {}
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
            } catch (e) {}
            this._maximizeHandlerId = 0;
        }
    }

    _installBottomGesture() {
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
                if (this._gestureSuppressed())
                    return Clutter.EVENT_PROPAGATE;
                const [, y] = event.get_coords();
                startY = y;
                holding = false;
                return Clutter.EVENT_PROPAGATE;
            });
            actor.connect('motion-event', (_a, event) => {
                if (!startY || this._gestureSuppressed())
                    return Clutter.EVENT_PROPAGATE;
                const [, y] = event.get_coords();
                const dy = startY - y;
                if (dy > 40 && !holding) {
                    holding = true;
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

    _gestureSuppressed() {
        // Phase 4: suppress gestures for listed fullscreen/game windows
        try {
            const exceptions = this._settings.get_strv('gesture-exceptions');
            if (!exceptions.length)
                return false;
            const win = global.display.focus_window;
            if (!win)
                return false;
            const wmClass = (win.get_wm_class() || '').toLowerCase();
            const appId = (win.get_gtk_application_id() || '').toLowerCase();
            return exceptions.some(ex => {
                const e = ex.toLowerCase();
                return wmClass.includes(e) || appId.includes(e);
            });
        } catch (e) {
            return false;
        }
    }

    _removeBottomGesture() {
        for (const actor of this._gestureActors) {
            try {
                actor.destroy();
            } catch (e) {}
        }
        this._gestureActors = [];
    }
}
