import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import {TabletSwitcher} from './tabletSwitcher.js';
import {TabletHome} from './tabletHome.js';
import {applyTabletDock, DOCK_SCHEMA} from './tabletDock.js';
import {TabletSession} from './tabletSession.js';
import {SettingsJournal} from './settingsJournal.js';
import {PostureMonitor} from './posture.js';
import {setTabletWindowChrome} from './windowChrome.js';
import {maximizeWindow, unmaximizeWindow, isWindowMaximized, resolveTablet,
    planTabletEntry, planTabletExit} from './tabletGeometry.js';

// Mutsu OS core desktop/tablet mode, enabled by default for new users.
// Mac-first desktop; folding a 2-in-1 into tablet posture switches to an
// iPadOS-style Home, full-screen apps and touch navigation.
//
// Runs in the 'unlock-dialog' session mode too, so locking the screen does
// not tear tablet mode down (which used to unmaximize every window and lose
// Split View). All tablet UI hides itself while locked.
// Recovery: gnome-extensions disable mutsu-adaptive@mutsu-os

const DEBOUNCE_MS = 400;
const INTERFACE = 'org.gnome.desktop.interface';
const TOUCHSCREEN = 'org.gnome.settings-daemon.peripherals.touchscreen';
const TOUCHSHELL = 'org.gnome.shell.extensions.touchshell';
const TOUCHSHELL_UUID = 'touchshell@touchshell.com';
const KIWI = 'org.gnome.shell.extensions.kiwi';
// Schemas that live inside another bundled extension's directory.
const EXTENSION_SCHEMAS = {[TOUCHSHELL]: TOUCHSHELL_UUID, [KIWI]: 'kiwi@kemma'};
const SEARCH_APP_ID = 'io.github.markymark5127.AIDesktop';
const SEARCH_TITLE = 'Mutsu OS Search';
const SEARCH_BIN = '/usr/bin/mutsu-search';

// Touchshell owns the top edge (Controls, Notifications) and text helpers.
// Mutsu owns the bottom edge, Home, and window sizing, so Touchshell's
// competing gestures are switched off while in tablet mode.
const TOUCHSHELL_TABLET = {
    'top-right-swipe-activation': 'always',
    'top-center-swipe-activation': 'always',
    'swipe-to-dismiss-notifications-activation': 'always',
    'text-selection-activation': 'always',
    'text-action-fab-activation': 'always',
    'window-tiling-flick-activation': 'always',
    'bottom-edge-swipe-activation': 'off',
    'action-bar-activation': 'off',
    'panel-auto-hide-activation': 'off',
    'flick-to-close-activation': 'off',
    'overview-workspace-switch-activation': 'off',
    'overview-vertical-swipe-activation': 'off',
    'desktop-workspace-switch-activation': 'off',
    'desktop-vertical-swipe-activation': 'off',
    'auto-maximize-windows-activation': 'off',
};

function isSearchWindow(window) {
    try {
        return window?.get_gtk_application_id?.() === SEARCH_APP_ID &&
            window.get_title() === SEARCH_TITLE;
    } catch (e) {
        return false;
    }
}

function readFile(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : null;
    } catch (e) {
        return null;
    }
}

function listDir(path) {
    const names = [];
    try {
        const children = Gio.File.new_for_path(path).enumerate_children('standard::name',
            Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = children.next_file(null)))
            names.push(info.get_name());
    } catch (e) {}
    return names;
}

// The window tiled beside this one on the desktop (Super+Left/Right), if any.
function tilePartner(window) {
    try {
        const match = window.get_tile_match?.();
        if (match && !match.minimized)
            return match;
    } catch (e) {}
    return null;
}

export default class MutsuAdaptiveExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._inTablet = false;
        this._override = null;
        this._debounceSource = 0;
        this._pendingTablet = null;
        this._signals = [];
        this._searchBusy = 0;

        // Crash-safe journal: if the Shell died mid-tablet-mode, put the
        // user's desktop settings back before anything else.
        this._journal = new SettingsJournal({
            load: () => this._settings.get_string('saved-state'),
            save: value => this._settings.set_string('saved-state', value),
            open: schemaId => this._openSettings(schemaId),
            parse: text => GLib.Variant.parse(null, text, null, null),
        });
        if (this._journal.pending) {
            log('Mutsu Adaptive: restoring desktop settings left over from an interrupted tablet session');
            this._journal.restore();
        }
        // Likewise never leave tablet-size window controls on the desktop.
        setTabletWindowChrome(false);

        this._buildIndicator();
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

        this._connect(this._settings, 'changed::mode', () => {
            this._override = null;
            this._evaluate();
        });
        this._connect(Main.sessionMode, 'updated', () => this._syncLocked());
        this._posture = new PostureMonitor({
            seat: this._seat(),
            readFile,
            listDir,
            poll: (ms, fn) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                fn();
                return GLib.SOURCE_CONTINUE;
            }),
            cancel: id => GLib.source_remove(id),
            threshold: () => this._settings?.get_int('tablet-hinge-angle') ?? 0,
        }, () => {
            // A real fold/unfold ends any manual override.
            this._override = null;
            this._evaluate();
        });
        log(`Mutsu Adaptive: posture sources: ${this._posture.description}`);
        this._connect(this._settings, 'changed::tablet-hinge-angle', () => {
            this._posture?.refresh();
            this._override = null;
            this._evaluate();
        });
        this._evaluate(true);
        this._syncLocked();
    }

    disable() {
        if (this._debounceSource) {
            GLib.source_remove(this._debounceSource);
            this._debounceSource = 0;
        }
        this._posture?.destroy();
        this._posture = null;
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        this._leaveTablet();
        this._qsToggle?.destroy();
        this._qsToggle = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._modeIcon = null;
        this._journal?.restore();
        this._journal = null;
        this._settings = null;
    }

    _connect(object, signal, fn) {
        this._signals.push([object, object.connect(signal, fn)]);
    }

    // Gio.Settings aborts the whole Shell for an unknown schema, so look it
    // up first. Touchshell's schema lives in its own extension folder.
    _openSettings(schemaId) {
        let schema = Gio.SettingsSchemaSource.get_default()?.lookup(schemaId, true) ?? null;
        if (!schema && EXTENSION_SCHEMAS[schemaId]) {
            try {
                const dir = Main.extensionManager.lookup(EXTENSION_SCHEMAS[schemaId])?.dir?.get_child('schemas');
                if (dir?.query_exists(null)) {
                    const source = Gio.SettingsSchemaSource.new_from_directory(dir.get_path(),
                        Gio.SettingsSchemaSource.get_default(), false);
                    schema = source.lookup(schemaId, false);
                }
            } catch (e) {
                schema = null;
            }
        }
        return schema ? new Gio.Settings({settings_schema: schema}) : null;
    }

    // ---- indicator and mode ------------------------------------------------

    _buildIndicator() {
        this._indicator = new PanelMenu.Button(0.0, 'Mutsu Adaptive', false);
        this._modeIcon = new St.Icon({icon_name: 'video-display-symbolic',
            style_class: 'system-status-icon'});
        this._indicator.add_child(this._modeIcon);
        this._indicator.menu.addAction('Multitasking', () => this._switcher?.show());
        this._indicator.menu.addAction('Edit Home Screen', () => this._home?.setEditing(true));
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Tablet Mode'));
        this._modeItems = new Map();
        for (const [mode, label] of [['automatic', 'Automatic (follow the hinge)'],
            ['always-desktop', 'Always Desktop'], ['always-tablet', 'Always Tablet']]) {
            const item = this._indicator.menu.addAction(label, () => this._setMode(mode));
            this._modeItems.set(mode, item);
        }
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    _setMode(mode) {
        this._settings.set_string('mode', mode);
    }

    // Quick Settings toggle. In Automatic it is a temporary override that
    // lasts until the hardware posture next changes, so Automatic is never
    // silently lost. In a forced mode it flips between the forced modes.
    _toggleManual() {
        const want = !(this._pendingTablet ?? this._inTablet);
        // The toggle never leaves the laptop stuck in a forced mode: it
        // returns to Automatic and overrides only until the next fold.
        // ("Always Tablet/Desktop" stay available in the status menu.)
        if (this._settings.get_string('mode') !== 'automatic')
            this._setMode('automatic');
        this._override = want;
        this._evaluate();
    }

    _evaluate(immediate = false) {
        if (!this._settings)
            return;
        const want = resolveTablet({
            mode: this._settings.get_string('mode'),
            override: this._override,
            seatTouch: this._posture?.seatTouch ?? false,
            hardware: this._posture?.hardware ?? null,
            angleDecides: this._posture?.angleDecides ?? false,
        });
        this._requestTablet(want, immediate);
        this._syncIndicators(want);
    }

    _syncIndicators(inTablet = this._inTablet) {
        if (this._qsToggle)
            this._qsToggle.checked = inTablet;
        if (this._modeIcon)
            this._modeIcon.icon_name = inTablet ? 'mutsu-tablet-mode-symbolic' : 'video-display-symbolic';
        if (this._indicator)
            this._indicator.accessible_name = inTablet ? 'Tablet mode' : 'Desktop mode';
        const mode = this._settings?.get_string('mode');
        for (const [key, item] of this._modeItems ?? []) {
            try {
                item.setOrnament(key === mode ? PopupMenu.Ornament.CHECK ?? PopupMenu.Ornament.DOT
                    : PopupMenu.Ornament.NONE);
            } catch (e) {}
        }
    }

    _syncLocked() {
        const locked = Main.sessionMode.isLocked || Main.sessionMode.isGreeter;
        if (this._indicator)
            this._indicator.visible = !locked;
        if (this._qsToggle)
            this._qsToggle.visible = !locked;
    }

    _requestTablet(wantTablet, immediate = false) {
        if (this._debounceSource)
            GLib.source_remove(this._debounceSource);
        this._debounceSource = 0;
        this._pendingTablet = wantTablet;
        const apply = () => {
            this._debounceSource = 0;
            const want = this._pendingTablet;
            this._pendingTablet = null;
            if (want)
                this._enterTablet();
            else
                this._leaveTablet();
            this._syncIndicators();
        };
        if (immediate) {
            apply();
            return;
        }
        this._debounceSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
            apply();
            return GLib.SOURCE_REMOVE;
        });
    }

    // ---- entering and leaving ----------------------------------------------

    _enterTablet() {
        if (this._inTablet)
            return;
        this._inTablet = true;
        // Each part starts on its own: one failing (for example after a GNOME
        // API change) must not leave tablet mode half-started with no Home,
        // gestures or menu actions. Errors go to the journal with a stack.
        const start = (name, fn) => {
            try {
                return fn();
            } catch (error) {
                logError(error, `Mutsu Adaptive: ${name} failed to start`);
                return null;
            }
        };
        start('touch settings', () => this._applyTouchSettings());
        start('window controls', () => setTabletWindowChrome(true,
            {buttons: this._settings.get_boolean('tablet-window-buttons')}));
        this._home = start('Home', () => new TabletHome({
            settings: this._settings,
            monitor: () => this._tabletMonitor(),
            search: () => this._openSearch(),
        }));
        this._session = start('touch session', () => new TabletSession(this._settings, this._journal));
        // TabletSwitcher owns the bottom edge to avoid competing recognizers.
        this._switcher = start('gestures and multitasking', () => new TabletSwitcher(
            () => this._goHome(),
            () => this._gestureSuppressed(),
            () => this._settings.get_boolean('enable-experimental-gestures'),
            () => this._tabletMonitor(),
            {windowButtons: () => this._settings.get_boolean('tablet-window-buttons')}));
        start('window sizing', () => this._installWindowSizing());
        this._tabletSignals = [];
        // GNOME's overview has no role in tablet mode: Super / hot corner go Home.
        this._tabletSignals.push([Main.overview, Main.overview.connect('showing', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (this._inTablet && Main.overview.visible) {
                    Main.overview.hide();
                    this._goHome();
                }
                return GLib.SOURCE_REMOVE;
            });
        })]);
        Main.overview.hide();
        this._slimStatusBar(true);
        start('open apps', () => this._arrangeForTablet());
        log('Mutsu Adaptive: entered tablet mode');
    }

    _leaveTablet() {
        if (!this._inTablet)
            return;
        this._inTablet = false;
        for (const [object, id] of this._tabletSignals ?? [])
            object.disconnect(id);
        this._tabletSignals = [];
        try {
            this._arrangeForDesktop();
        } catch (error) {
            logError(error, 'Mutsu Adaptive: arranging windows for the desktop failed');
        }
        for (const part of ['_switcher', '_home', '_session']) {
            try {
                this[part]?.destroy();
            } catch (error) {
                logError(error, `Mutsu Adaptive: ${part} cleanup failed`);
            }
            this[part] = null;
        }
        this._removeWindowSizing();
        this._journal.restore();
        setTabletWindowChrome(false);
        this._slimStatusBar(false);
        log('Mutsu Adaptive: left tablet mode');
    }

    _applyTouchSettings() {
        const j = this._journal;
        // Larger text, unless the user already chose their own scaling.
        const scale = j.settings(INTERFACE)?.get_user_value('text-scaling-factor');
        if (!scale || Math.abs(scale.unpack() - 1.0) < 0.01) {
            const factor = this._settings.get_double('touch-text-scale');
            j.change(INTERFACE, 'text-scaling-factor', s => s.set_double('text-scaling-factor', factor));
        }
        if (this._settings.get_boolean('rotation-lock'))
            j.change(TOUCHSCREEN, 'orientation-lock', s => s.set_boolean('orientation-lock', true));
        if (this._settings.get_boolean('collapse-dock-in-tablet')) {
            const dock = j.settings(DOCK_SCHEMA);
            if (dock)
                applyTabletDock(dock, j);
        }
        for (const [key, value] of Object.entries(TOUCHSHELL_TABLET))
            j.change(TOUCHSHELL, key, s => s.set_string(key, value));
        // Kiwi's top-bar traffic lights for full-screen apps.
        if (!this._settings.get_boolean('tablet-window-buttons'))
            j.change(KIWI, 'show-window-controls', s => s.set_boolean('show-window-controls', false));
    }

    _slimStatusBar(on) {
        const panel = Main.panel;
        if (!panel)
            return;
        if (on)
            panel.add_style_class_name('mutsu-status-slim');
        else
            panel.remove_style_class_name('mutsu-status-slim');
        const hide = [panel.statusArea?.activities, panel.statusArea?.appMenu];
        for (const actor of hide) {
            if (!actor)
                continue;
            if (on && actor._mutsuSavedVisible === undefined)
                actor._mutsuSavedVisible = actor.visible;
            if (on) {
                actor.visible = false;
            } else if (actor._mutsuSavedVisible !== undefined) {
                actor.visible = actor._mutsuSavedVisible;
                delete actor._mutsuSavedVisible;
            }
        }
    }

    // The built-in panel of a 2-in-1 hosts tablet UI even if an external
    // display is primary. Falls back to the primary monitor.
    _tabletMonitor() {
        const layout = Main.layoutManager;
        try {
            const manager = global.backend.get_monitor_manager();
            for (const connector of ['eDP-1', 'eDP-2', 'LVDS-1', 'DSI-1']) {
                const index = manager.get_monitor_for_connector(connector);
                if (index >= 0 && layout.monitors[index])
                    return layout.monitors[index];
            }
        } catch (e) {}
        return layout.primaryMonitor;
    }

    // ---- Home and windows ------------------------------------------------------

    // Every visible app on the tablet screen steps aside; Home is behind
    // them. They come back with the desktop when tablet mode ends.
    // Visible app windows on the tablet monitor, most recently used first.
    _visibleWindows() {
        const monitor = this._tabletMonitor();
        const index = Main.layoutManager.monitors.indexOf(monitor);
        return global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null).filter(window =>
            !window.minimized && !window.is_skip_taskbar() && !isSearchWindow(window) &&
            window.get_window_type() === Meta.WindowType.NORMAL &&
            (index < 0 || window.get_monitor() === index) &&
            (window.is_on_all_workspaces() || window.get_workspace()?.active));
    }

    // Folding: the focused app stays as the full-screen app (a tiled pair
    // becomes Split View); the rest go to multitasking. No app open: Home.
    _arrangeForTablet() {
        if (this._settings.get_boolean('open-home-on-tablet')) {
            this._goHome();
            return;
        }
        const plan = planTabletEntry(this._visibleWindows(), global.display.focus_window, tilePartner);
        for (const window of plan.minimize)
            window.minimize();
        if (!plan.foreground) {
            this._home?.reveal();
            return;
        }
        if (plan.pair) {
            const [left, right] = [...plan.pair].sort((a, b) =>
                a.get_frame_rect().x - b.get_frame_rect().x);
            if (this._switcher?.split?.arrange(left, right))
                return;
        }
        if (plan.foreground.allows_resize?.() && !isWindowMaximized(plan.foreground))
            maximizeWindow(plan.foreground, Meta);
    }

    // Unfolding: what is on screen stays; apps waiting in multitasking stay
    // minimized and anything else still showing joins them.
    _arrangeForDesktop() {
        const pair = this._switcher?.split?.pair ?? null;
        for (const window of planTabletExit(this._visibleWindows(), global.display.focus_window, pair))
            window.minimize();
    }

    _goHome() {
        this._switcher?.hide();
        const monitor = this._tabletMonitor();
        const index = Main.layoutManager.monitors.indexOf(monitor);
        for (const window of global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)) {
            if (window.minimized || window.is_skip_taskbar() || isSearchWindow(window))
                continue;
            if (index >= 0 && window.get_monitor() !== index)
                continue;
            if (!window.get_workspace()?.active && !window.is_on_all_workspaces())
                continue;
            window.minimize();
        }
        this._home?.reveal();
    }


    // Apps open full screen (maximized, keeping their traffic lights). The
    // green button floats a window, and it stays floating: nothing fights it.
    _installWindowSizing() {
        this._tabletWindowState = new Map();
        const fit = (window, remember) => {
            if (isSearchWindow(window) || window.get_window_type() !== Meta.WindowType.NORMAL ||
                window.is_skip_taskbar() || window.get_transient_for() || !window.allows_resize?.())
                return;
            if (remember && !this._tabletWindowState.has(window))
                this._tabletWindowState.set(window, isWindowMaximized(window));
            if (!isWindowMaximized(window))
                maximizeWindow(window, Meta);
        };
        for (const window of global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)) {
            try {
                fit(window, true);
            } catch (e) {}
        }
        this._windowCreatedId = global.display.connect('window-created', (_d, window) => {
            // Wait until the client has set its app id, title and size hints.
            const id = window.connect('shown', () => {
                window.disconnect(id);
                if (this._inTablet) {
                    try {
                        fit(window, false);
                    } catch (e) {}
                }
            });
        });
    }

    _removeWindowSizing() {
        if (this._windowCreatedId)
            global.display.disconnect(this._windowCreatedId);
        this._windowCreatedId = 0;
        // Windows that were open before tablet mode get their desktop size
        // back. Windows opened in tablet mode stay as they are.
        for (const [window, wasMaximized] of this._tabletWindowState ?? []) {
            try {
                if (!wasMaximized && isWindowMaximized(window))
                    unmaximizeWindow(window, Meta);
            } catch (e) { /* closed in tablet mode */ }
        }
        this._tabletWindowState = null;
    }

    _openSearch() {
        if (this._searchBusy)
            return;
        this._searchBusy = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
            this._searchBusy = 0;
            return GLib.SOURCE_REMOVE;
        });
        // The branding extension positions and focuses the search window;
        // the on-screen keyboard follows its text field natively.
        if (!GLib.file_test(SEARCH_BIN, GLib.FileTest.IS_EXECUTABLE)) {
            Main.notify('Mutsu Search', 'Search is not installed on this system.');
            return;
        }
        try {
            Gio.Subprocess.new([SEARCH_BIN], Gio.SubprocessFlags.NONE);
        } catch (e) {
            log(`Mutsu Adaptive: mutsu-search failed (${e})`);
        }
    }

    _seat() {
        try {
            return global.stage?.get_context?.()?.get_backend?.()?.get_default_seat?.() ??
                Clutter.get_default_backend?.()?.get_default_seat?.() ?? null;
        } catch (e) {
            return null;
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
}
