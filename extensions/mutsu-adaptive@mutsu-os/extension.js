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
import {DashToDockHider} from './dockHider.js';
import {TabletGamepad} from './tabletGamepad.js';
import {ModeTransition} from './modeTransition.js';
import {updateTiltLatch, clearTiltOnLaptopUse, transformFor, rotatedLogicalMonitors,
    isBuiltinConnector, TILTED, TILT_DWELL_MS} from './orientation.js';
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
// The fold switch and the Quick Settings toggle are decisive: act almost at
// once. (Sensor polls keep the longer debounce: angles wobble.)
const SWITCH_DEBOUNCE_MS = 80;
// Work that doesn't change what's on screen during the switch (bigger text,
// dock and gesture settings, the gamepad, new-window sizing) waits until the
// switch animation has played, so the switch itself is one quick step.
const SETTLE_MS = 560;
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

// Read several small files in GIO's worker threads and call back once with
// a Map(path -> text | null). Never blocks the compositor.
function readFilesAsync(paths, callback) {
    const contents = new Map();
    let left = paths.length;
    if (!left) {
        callback(contents);
        return;
    }
    for (const path of paths) {
        Gio.File.new_for_path(path).load_contents_async(null, (file, result) => {
            try {
                const [, bytes] = file.load_contents_finish(result);
                contents.set(path, new TextDecoder().decode(bytes));
            } catch (e) {
                contents.set(path, null);
            }
            if (--left === 0)
                callback(contents);
        });
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
        try {
            this._transition = new ModeTransition();
        } catch (error) {
            logError(error, 'Mutsu Adaptive: mode animation unavailable');
            this._transition = null;
        }
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
            readFiles: readFilesAsync,
            listDir,
            active: () => this._settings?.get_string('mode') === 'automatic',
            poll: (ms, fn) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                fn();
                return GLib.SOURCE_CONTINUE;
            }),
            cancel: id => GLib.source_remove(id),
            threshold: () => this._settings?.get_int('tablet-hinge-angle') ?? 0,
        }, kind => {
            // A real fold/unfold ends any manual override.
            this._override = null;
            this._evaluate(false, kind === 'switch' ? SWITCH_DEBOUNCE_MS : DEBOUNCE_MS);
        });
        log(`Mutsu Adaptive: posture sources: ${this._posture.description}`);
        this._tilt = {orientation: 'undefined', since: 0, latched: false};
        this._appliedTransform = 0;
        this._watchOrientation();
        this._connect(this._settings, 'changed::tablet-from-orientation', () => {
            this._tilt = {...this._tilt, latched: false};
            this._evaluate();
        });
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
        this._transition?.destroy();
        this._transition = null;
        this._unwatchOrientation();
        globalThis.mutsuTabletMode = false;
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        this._leaveTablet();
        this._cancelSettle(); // the journal is restored right below
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
        this._evaluate(false, SWITCH_DEBOUNCE_MS);
    }

    _evaluate(immediate = false, debounceMs = DEBOUNCE_MS) {
        if (!this._settings)
            return;
        const want = resolveTablet({
            mode: this._settings.get_string('mode'),
            override: this._override,
            seatTouch: this._posture?.seatTouch ?? false,
            hardware: this._posture?.hardware ?? null,
            angleDecides: this._posture?.angleDecides ?? false,
            tilted: this._tiltActive(),
        });
        this._requestTablet(want, immediate, debounceMs);
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

    _requestTablet(wantTablet, immediate = false, debounceMs = DEBOUNCE_MS) {
        if (this._debounceSource)
            GLib.source_remove(this._debounceSource);
        this._debounceSource = 0;
        this._pendingTablet = wantTablet;
        const apply = () => {
            this._debounceSource = 0;
            const want = this._pendingTablet;
            this._pendingTablet = null;
            const was = this._inTablet;
            // The animation is queued first so it starts on the next frame,
            // right as the screen changes, not after all the work.
            if (was !== want && this._settings.get_boolean('mode-animation')) {
                try {
                    this._transition?.play(want);
                } catch (error) {
                    logError(error, 'Mutsu Adaptive: mode animation failed');
                }
            }
            if (want)
                this._enterTablet();
            else
                this._leaveTablet();
            this._syncIndicators();
            this._syncRotation();
        };
        if (immediate) {
            apply();
            return;
        }
        this._debounceSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, debounceMs, () => {
            apply();
            return GLib.SOURCE_REMOVE;
        });
    }

    // ---- entering and leaving ----------------------------------------------

    // Runs `fn`, timing it into `timings` (ms). One part failing (for
    // example after a GNOME API change) must not leave the switch half done;
    // errors go to the journal with a stack.
    _part(timings, name, fn) {
        const start = GLib.get_monotonic_time();
        try {
            return fn();
        } catch (error) {
            logError(error, `Mutsu Adaptive: ${name} failed`);
            return null;
        } finally {
            timings[name] = Math.round((GLib.get_monotonic_time() - start) / 1000);
        }
    }

    // After the switch animation: the parts that don't change what's on
    // screen right away. Cancelled if the mode switches back first.
    _settleLater(name, fn) {
        this._cancelSettle();
        this._settleSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_MS, () => {
            this._settleSource = 0;
            const timings = {};
            this._part(timings, name, fn);
            this._lastSwitch = {...(this._lastSwitch ?? {}), settled: timings};
            log(`Mutsu Adaptive: ${name} in ${timings[name]} ms`);
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelSettle() {
        if (this._settleSource)
            GLib.source_remove(this._settleSource);
        this._settleSource = 0;
    }

    _logSwitch(what, timings, start) {
        const total = Math.round((GLib.get_monotonic_time() - start) / 1000);
        this._lastSwitch = {what, total, parts: timings};
        const parts = Object.entries(timings).map(([k, v]) => `${k} ${v}`).join(', ');
        log(`Mutsu Adaptive: ${what} in ${total} ms (${parts})`);
    }

    _enterTablet() {
        globalThis.mutsuTabletMode = true; // read by Kiwi: no minimized-window tiles
        if (this._inTablet)
            return;
        this._inTablet = true;
        const begin = GLib.get_monotonic_time();
        const t = {};
        const start = (name, fn) => this._part(t, name, fn);
        this._cancelSettle();
        // What the switch shows: apps arranged, Home, gestures, chrome.
        start('gesture settings', () => this._applyGestureSettings());
        start('window controls', () => setTabletWindowChrome(true,
            {buttons: this._settings.get_boolean('tablet-window-buttons')}));
        this._home = start('Home', () => new TabletHome({
            settings: this._settings,
            monitor: () => this._tabletMonitor(),
            search: () => this._openSearch(),
        }));
        // TabletSwitcher owns the bottom edge to avoid competing recognizers.
        this._switcher = start('gestures and multitasking', () => new TabletSwitcher(
            () => this._goHome(),
            () => this._gestureSuppressed(),
            () => this._settings.get_boolean('enable-experimental-gestures'),
            () => this._tabletMonitor(),
            {windowButtons: () => this._settings.get_boolean('tablet-window-buttons')}));
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
        start('status bar', () => this._slimStatusBar(true));
        if (this._settings.get_boolean('collapse-dock-in-tablet'))
            this._dockHider = start('desktop dock hidden', () => new DashToDockHider());
        // Before arranging: it remembers each app's desktop size to restore.
        start('window sizing', () => this._installWindowSizing());
        start('open apps', () => this._arrangeForTablet());
        this._logSwitch('entered tablet mode', t, begin);
        // After the animation: bigger text, dock/gesture settings, the
        // touch session and the gamepad.
        this._settleLater('tablet settings', () => {
            if (!this._inTablet)
                return;
            const s = {};
            this._part(s, 'touch settings', () => this._applyTouchSettings());
            this._session = this._part(s, 'touch session', () => new TabletSession(this._settings, this._journal));
            this._gamepad = this._part(s, 'on-screen gamepad', () => new TabletGamepad(this._settings));
            log(`Mutsu Adaptive: tablet settings (${Object.entries(s).map(([k, v]) => `${k} ${v}`).join(', ')})`);
        });
    }

    _leaveTablet() {
        globalThis.mutsuTabletMode = false;
        if (!this._inTablet)
            return;
        this._inTablet = false;
        const begin = GLib.get_monotonic_time();
        const t = {};
        this._cancelSettle();
        for (const [object, id] of this._tabletSignals ?? [])
            object.disconnect(id);
        this._tabletSignals = [];
        this._part(t, 'open apps', () => this._arrangeForDesktop());
        for (const part of ['_gamepad', '_switcher', '_home', '_session', '_dockHider']) {
            this._part(t, part.slice(1), () => this[part]?.destroy());
            this[part] = null;
        }
        this._part(t, 'window sizing', () => this._removeWindowSizing());
        this._part(t, 'window controls', () => setTabletWindowChrome(false));
        this._part(t, 'status bar', () => this._slimStatusBar(false));
        this._logSwitch('left tablet mode', t, begin);
        // After the animation: text size, dock and gesture settings back.
        this._settleLater('desktop settings', () => {
            if (!this._inTablet)
                this._journal.restore();
        });
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
    }

    // Settings that must change with the switch itself: Touchshell's gestures
    // would otherwise compete with Mutsu's (its bottom edge, auto-maximize)
    // and Kiwi's top-bar buttons would show over full-screen apps.
    _applyGestureSettings() {
        const j = this._journal;
        for (const [key, value] of Object.entries(TOUCHSHELL_TABLET))
            j.change(TOUCHSHELL, key, s => s.set_string(key, value));
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
        const split = this._switcher?.split;
        const pair = split?.pair ?? null;
        // Slide Over apps fold away off their edge (handled by Split View),
        // not GNOME's minimize into the dock; the app behind them stays.
        const slides = split?.slides ?? [];
        const focus = slides.includes(global.display.focus_window) ? null : global.display.focus_window;
        const windows = this._visibleWindows().filter(w => !slides.includes(w));
        for (const window of planTabletExit(windows, focus, pair))
            window.minimize();
        split?.leaveTablet?.();
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

    // ---- orientation: tablet when the screen is held sideways / upside down

    _tiltActive() {
        return !!this._tilt?.latched && !!this._settings?.get_boolean('tablet-from-orientation');
    }

    _watchOrientation() {
        this._sensorCancel = new Gio.Cancellable();
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
            'net.hadess.SensorProxy', '/net/hadess/SensorProxy', 'net.hadess.SensorProxy',
            this._sensorCancel, (_o, res) => {
                try {
                    this._sensor = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (e) {
                    return; // no sensor service: nothing to do
                }
                this._sensor.call('ClaimAccelerometer', null, Gio.DBusCallFlags.NONE, -1, null, null);
                this._sensorId = this._sensor.connect('g-properties-changed', () => this._onOrientation());
                this._onOrientation();
            });
        // Typing or using the touchpad with the screen upright means laptop.
        this._laptopUseId = global.stage.connect('captured-event', (_stage, event) => {
            if (!this._tilt?.latched)
                return Clutter.EVENT_PROPAGATE;
            const type = event.type();
            if (type !== Clutter.EventType.KEY_PRESS && type !== Clutter.EventType.BUTTON_PRESS &&
                type !== Clutter.EventType.TOUCHPAD_SWIPE && type !== Clutter.EventType.SCROLL)
                return Clutter.EVENT_PROPAGATE;
            const device = event.get_source_device?.();
            const kind = device?.get_device_type?.();
            const physical = !!device?.get_device_node?.(); // not the on-screen keyboard
            if (!physical || kind === Clutter.InputDeviceType.TOUCHSCREEN_DEVICE ||
                kind === Clutter.InputDeviceType.TABLET_DEVICE || kind === Clutter.InputDeviceType.PEN_DEVICE)
                return Clutter.EVENT_PROPAGATE;
            const next = clearTiltOnLaptopUse(this._tilt);
            if (next.latched !== this._tilt.latched) {
                this._tilt = next;
                this._override = null;
                this._evaluate();
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _unwatchOrientation() {
        this._sensorCancel?.cancel();
        if (this._dwellId)
            GLib.source_remove(this._dwellId);
        this._dwellId = 0;
        if (this._sensor) {
            if (this._sensorId)
                this._sensor.disconnect(this._sensorId);
            this._sensor.call('ReleaseAccelerometer', null, Gio.DBusCallFlags.NONE, -1, null, null);
        }
        this._sensor = null;
        if (this._laptopUseId)
            global.stage.disconnect(this._laptopUseId);
        this._laptopUseId = 0;
        if (this._appliedTransform)
            this._applyTransform(0);
    }

    _onOrientation() {
        const orientation = this._sensor?.get_cached_property('AccelerometerOrientation')?.unpack() ?? 'undefined';
        const wasActive = this._tiltActive();
        this._tilt = updateTiltLatch(this._tilt, orientation, Date.now());
        if (this._dwellId)
            GLib.source_remove(this._dwellId);
        this._dwellId = 0;
        if (TILTED.includes(orientation) && !this._tilt.latched) {
            this._dwellId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TILT_DWELL_MS + 50, () => {
                this._dwellId = 0;
                this._onOrientation();
                return GLib.SOURCE_REMOVE;
            });
        }
        if (this._tiltActive() !== wasActive) {
            this._override = null;
            this._evaluate();
        }
        this._syncRotation();
    }

    // GNOME rotates only while its own tablet switch is on; when tablet mode
    // came from the orientation alone, rotate the built-in screen here.
    _syncRotation() {
        const locked = this._settings?.get_boolean('rotation-lock');
        const ours = this._inTablet && this._tiltActive() && !this._posture?.seatTouch && !locked;
        const transform = ours ? transformFor(this._tilt.orientation) : 0;
        if (transform !== this._appliedTransform && (ours || this._appliedTransform))
            this._applyTransform(transform);
    }

    _applyTransform(transform) {
        const bus = Gio.DBus.session;
        const dest = ['org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
            'org.gnome.Mutter.DisplayConfig'];
        this._appliedTransform = transform;
        bus.call(...dest, 'GetCurrentState', null, null, Gio.DBusCallFlags.NONE, -1, null, (conn, res) => {
            try {
                const [serial, monitors, logical] = conn.call_finish(res).recursiveUnpack();
                const config = rotatedLogicalMonitors(monitors, logical, transform, isBuiltinConnector);
                if (!config)
                    return;
                conn.call(...dest, 'ApplyMonitorsConfig',
                    new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [serial, 1, config, {}]),
                    null, Gio.DBusCallFlags.NONE, -1, null, (c, r) => {
                        try {
                            c.call_finish(r);
                        } catch (e) {
                            log(`Mutsu Adaptive: could not rotate the screen (${e.message})`);
                        }
                    });
            } catch (e) {
                log(`Mutsu Adaptive: could not read the display layout (${e.message})`);
            }
        });
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
