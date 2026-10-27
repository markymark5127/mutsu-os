import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';

// Installed and enabled by default for new Mutsu OS users.
// Manual desktop/tablet modes are available even without a hinge switch.
// Automatic posture uses the GNOME backend signal when present, plus a
// sysfs poll of common convertible tablet-mode paths.
// Experimental bottom-edge interception remains disabled by default.
// Recovery: gnome-extensions disable mutsu-adaptive@mutsu-os

const BOTTOM_EDGE_HEIGHT = 24;
const DEBOUNCE_MS = 400;
const PULL_TRIGGER_PX = 70;

export default class MutsuAdaptiveExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._inTablet = false;
        this._maximizeHandlerId = 0;
        this._focusHandlerId = 0;
        this._gestureActors = [];
        this._pullActor = null;
        this._overviewShowingId = 0;
        this._hiddenChrome = [];
        this._debounceSource = 0;
        this._pendingTablet = null;
        this._saved = {};
        this._postureSignalId = 0;
        this._posturePollId = 0;
        this._searchBusy = false;

        this._indicator = new PanelMenu.Button(0.0, 'Mutsu Adaptive', false);
        this._modeIcon = new St.Icon({
            icon_name: 'video-display-symbolic',
            style_class: 'system-status-icon',
        });
        this._indicator.add_child(this._modeIcon);
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
        this._modeIcon = null;
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
        else if (mode === 'automatic') {
            // Do not leave an old forced-tablet state stuck on an ordinary laptop.
            // Enter tablet mode only after a positive hardware indication.
            this._requestTablet(false);
        }
        this._syncQsToggle();
    }

    _syncQsToggle() {
        const mode = this._settings.get_string('mode');
        const inTablet = mode === 'always-tablet' || (mode === 'automatic' && this._inTablet);
        if (this._qsToggle)
            this._qsToggle.checked = inTablet;
        this._updateModeIcon(inTablet);
    }

    _updateModeIcon(inTablet) {
        if (!this._modeIcon)
            return;
        // Show the current mode: tablet icon while in tablet, desktop icon otherwise.
        this._modeIcon.icon_name = inTablet
            ? 'mutsu-tablet-mode-symbolic'
            : 'video-display-symbolic';
        if (this._indicator)
            this._indicator.accessible_name = inTablet ? 'Tablet mode' : 'Desktop mode';
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

        this._applyTabletHome();
        this._applyTouchVisuals();
        this._installMaximizeOnLaunch();
        this._installAppLayering();
        this._installPullSearch();
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
        this._removeAppLayering();
        this._removeBottomGesture();
        this._removePullSearch();
        this._restoreTabletHome();
        this._restoreReversibleState();

        try {
            Main.overview.hide();
        } catch (e) {}
        this._syncQsToggle();
        log('Mutsu Adaptive: left tablet mode');
    }

    _overviewActor() {
        return Main.overview?._overview ?? null;
    }

    _controls() {
        return this._overviewActor()?._controls ?? null;
    }

    _applyTabletHome() {
        const overview = this._overviewActor();
        overview?.add_style_class_name('mutsu-tablet-home');
        this._hideChrome();
        if (!this._overviewShowingId) {
            this._overviewShowingId = Main.overview.connect('showing', () => {
                if (this._inTablet)
                    this._hideChrome();
            });
        }
    }

    _restoreTabletHome() {
        if (this._overviewShowingId) {
            try {
                Main.overview.disconnect(this._overviewShowingId);
            } catch (e) {}
            this._overviewShowingId = 0;
        }
        this._overviewActor()?.remove_style_class_name('mutsu-tablet-home');
        for (const entry of this._hiddenChrome) {
            try {
                entry.actor.visible = entry.visible;
                entry.actor.opacity = entry.opacity;
            } catch (e) {}
        }
        this._hiddenChrome = [];
    }

    _hideChrome() {
        const controls = this._controls();
        if (!controls)
            return;
        // Force apps view so the window overview ("desktop thingy") is not shown
        // above the app grid in tablet mode.
        try {
            if (controls._appDisplay && typeof controls._appDisplay.show === 'function')
                controls._appDisplay.show();
            if (typeof controls.showApps === 'function')
                controls.showApps();
        } catch (e) {}
        const actors = [
            controls._searchEntry,
            controls._searchEntryBin,
            controls._thumbnailsBox,
            controls._thumbnailsSlider,
            controls._workspacesDisplay,
            controls._windowPreview,
        ].filter(Boolean);
        for (const actor of actors) {
            if (!this._hiddenChrome.some(entry => entry.actor === actor)) {
                this._hiddenChrome.push({
                    actor,
                    visible: actor.visible,
                    opacity: actor.opacity,
                });
            }
            actor.opacity = 0;
            actor.visible = false;
        }
    }

    _installPullSearch() {
        if (this._pullActor)
            return;
        try {
            const width = Math.round(global.stage.width * 0.5);
            const height = Math.round(global.stage.height * 0.28);
            const actor = new St.Widget({
                reactive: true,
                can_focus: false,
                track_hover: false,
                style: 'background-color: transparent;',
            });
            actor.set_size(width, height);
            actor.set_position(
                Math.round((global.stage.width - width) / 2),
                Math.round(global.stage.height * 0.18),
            );
            Main.layoutManager.uiGroup.add_child(actor);
            // Keep the pull surface above the overview so the gesture works
            // while the app grid is visible.
            try {
                Main.layoutManager.uiGroup.set_child_above_sibling(actor, null);
            } catch (e) {}
            this._pullActor = actor;

            let startY = 0;
            actor.connect('button-press-event', (_a, event) => {
                if (!this._inTablet || !Main.overview.visible)
                    return Clutter.EVENT_PROPAGATE;
                const [, y] = event.get_coords();
                startY = y;
                return Clutter.EVENT_PROPAGATE;
            });
            actor.connect('motion-event', (_a, event) => {
                if (!startY || !this._inTablet || !Main.overview.visible)
                    return Clutter.EVENT_PROPAGATE;
                const [, y] = event.get_coords();
                if (y - startY > PULL_TRIGGER_PX) {
                    startY = 0;
                    this._openSpotlight();
                }
                return Clutter.EVENT_PROPAGATE;
            });
            actor.connect('button-release-event', () => {
                startY = 0;
                return Clutter.EVENT_PROPAGATE;
            });
        } catch (e) {
            log(`Mutsu Adaptive: pull search unavailable (${e})`);
        }
    }

    _removePullSearch() {
        if (!this._pullActor)
            return;
        try {
            this._pullActor.destroy();
        } catch (e) {}
        this._pullActor = null;
    }

    _openSpotlight() {
        if (this._searchBusy)
            return;
        this._searchBusy = true;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
            this._searchBusy = false;
            return GLib.SOURCE_REMOVE;
        });
        try {
            Gio.Subprocess.new(
                ['/usr/bin/mutsu-search'],
                Gio.SubprocessFlags.NONE,
            );
            // Give the search window a moment, then raise it over the overview.
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                try {
                    const wins = global.get_window_actors?.() ?? [];
                    for (const a of wins) {
                        const meta = a.meta_window;
                        if (!meta)
                            continue;
                        const title = (meta.get_title?.() || '').toLowerCase();
                        const wm = (meta.get_wm_class?.() || '').toLowerCase();
                        if (title.includes('mutsu') || wm.includes('mutsu') || title.includes('search')) {
                            meta.activate(global.get_current_time());
                            meta.make_above?.();
                        }
                    }
                } catch (e) {}
                return GLib.SOURCE_REMOVE;
            });
        } catch (e) {
            log(`Mutsu Adaptive: mutsu-search failed (${e})`);
        }
        try {
            const keyboard = Main.keyboard;
            if (keyboard?.open)
                keyboard.open(Main.layoutManager.primaryIndex);
            else if (keyboard?.show)
                keyboard.show(Main.layoutManager.primaryIndex);
        } catch (e) {
            log(`Mutsu Adaptive: on-screen keyboard unavailable (${e})`);
        }
    }

    _saveReversibleState() {
        try {
            const iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            this._saved.textScaling = iface.get_double('text-scaling-factor');
            this._saved.hadCustomScale = Math.abs(this._saved.textScaling - 1.0) > 0.01;
        } catch (e) {
            this._saved.textScaling = null;
        }
        this._saved.dockCollapsed = false;
    }

    _applyTouchVisuals() {
        if (!this._saved.hadCustomScale && this._saved.textScaling !== null) {
            try {
                const iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
                const scale = this._settings.get_double('touch-text-scale');
                iface.set_double('text-scaling-factor', scale);
            } catch (e) {
                log(`Mutsu Adaptive: text scale failed (${e})`);
            }
        }

        if (this._settings.get_boolean('rotation-lock')) {
            try {
                const iface = new Gio.Settings({ schema_id: 'org.gnome.settings-daemon.peripherals.touchscreen' });
                if (iface.settings_schema.has_key('orientation-lock'))
                    iface.set_boolean('orientation-lock', true);
            } catch (e) {}
        }

        if (this._settings.get_boolean('collapse-dock-in-tablet')) {
            try {
                const dock = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.dash-to-dock' });
                this._saved.dockAutohide = dock.get_boolean('autohide');
                dock.set_boolean('autohide', true);
            } catch (e) {}
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
        const candidates = ['tablet-mode', 'tablet-mode-switch', 'notify::tablet-mode'];
        for (const sig of candidates) {
            try {
                if (global.backend && typeof global.backend.connect === 'function') {
                    this._postureSignalId = global.backend.connect(sig, (_b, active) => {
                        if (this._settings.get_string('mode') !== 'automatic')
                            return;
                        this._requestTablet(!!active);
                    });
                    log(`Mutsu Adaptive: connected posture signal '${sig}'`);
                    break;
                }
            } catch (e) {}
        }
        // Sysfs fallback for convertibles that expose SW_TABLET_MODE
        // without a GNOME backend signal. Polls only while Automatic is set.
        this._posturePollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            if (this._settings.get_string('mode') !== 'automatic')
                return GLib.SOURCE_CONTINUE;
            const active = this._readSysfsTablet();
            if (active !== null && active !== this._inTablet)
                this._requestTablet(active);
            return GLib.SOURCE_CONTINUE;
        });
        log('Mutsu Adaptive: sysfs tablet-mode poller started');
    }

    _readSysfsTablet() {
        const paths = [
            '/sys/bus/platform/devices/tablet-mode-switch/tablet-mode',
            '/sys/devices/platform/tablet-mode-switch/tablet-mode',
            '/sys/class/input/tablet-mode',
        ];
        for (const path of paths) {
            try {
                const f = Gio.File.new_for_path(path);
                if (!f.query_exists(null))
                    continue;
                const [, contents] = f.load_contents(null);
                const val = new TextDecoder().decode(contents).trim();
                if (val === '1' || val === '0')
                    return val === '1';
            } catch (e) {}
        }
        return null;
    }

    _stopPostureWatcher() {
        if (this._postureSignalId && global.backend) {
            try {
                global.backend.disconnect(this._postureSignalId);
            } catch (e) {}
            this._postureSignalId = 0;
        }
        if (this._posturePollId) {
            GLib.source_remove(this._posturePollId);
            this._posturePollId = 0;
        }
    }

    _installAppLayering() {
        // Overview is always above windows. Hide it when an app is focused
        // so open apps sit above the app grid. Show the grid again when
        // nothing is open (home).
        if (this._focusHandlerId)
            return;
        try {
            this._focusHandlerId = global.display.connect('notify::focus-window', () => {
                if (!this._inTablet)
                    return;
                const win = global.display.focus_window;
                if (win && !win.is_skip_taskbar?.()) {
                    try { Main.overview.hide(); } catch (e) {}
                } else if (!this._anyNormalWindows()) {
                    try { Main.overview.showApps(); } catch (e) {}
                }
            });
        } catch (e) {}
    }

    _anyNormalWindows() {
        try {
            const wins = global.display.get_tab_list(Meta.TabList.NORMAL, null) || [];
            return wins.some(w => !w.minimized && !w.is_skip_taskbar?.());
        } catch (e) {
            return false;
        }
    }

    _removeAppLayering() {
        if (this._focusHandlerId) {
            try { global.display.disconnect(this._focusHandlerId); } catch (e) {}
            this._focusHandlerId = 0;
        }
    }

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
