import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Workspace} from 'resource:///org/gnome/shell/ui/workspace.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

const APP_ID = 'io.github.markymark5127.AIDesktop';

export function isSearchWindow(window) {
    return window?.get_gtk_application_id() === APP_ID &&
        window.get_title() === 'Mutsu OS Search';
}

function eventActor(event) {
    // Since GNOME 45 only enter/leave events carry a source actor.
    return global.stage.get_event_actor?.(event) ?? event.get_source?.() ?? null;
}

// Taps on the on-screen keyboard, or on a button that shows it, are typing
// into Search, not leaving it.
function isKeyboardTarget(actor) {
    const box = Main.layoutManager.keyboardBox;
    for (let a = actor; a; a = a.get_parent()) {
        if (a === box)
            return true;
        const name = `${a.accessible_name ?? ''} ${a.style_class ?? ''} ${a.name ?? ''}`;
        if (/keyboard/i.test(name))
            return true;
    }
    return false;
}

// Search should come and go like part of the Shell (a quick fade), not like
// an app window minimizing into the dock.
function fade(window, show, done = null) {
    const actor = window?.get_compositor_private();
    if (!actor) {
        done?.();
        return;
    }
    actor.remove_all_transitions();
    actor.set_pivot_point(0.5, 0.2);
    if (show) {
        actor.opacity = 0;
        actor.set_scale(0.97, 0.97);
    }
    actor.ease({
        opacity: show ? 255 : 0,
        scale_x: show ? 1 : 0.97,
        scale_y: show ? 1 : 0.97,
        duration: show ? 140 : 110,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onStopped: () => {
            done?.();
            if (!show) {
                actor.opacity = 255;
                actor.set_scale(1, 1);
            }
        },
    });
}

export function dismissSearch(window) {
    if (!window || window.minimized || window._mutsuDismissing)
        return;
    window._mutsuDismissing = true;
    fade(window, false, () => {
        window._mutsuDismissing = false;
        window.minimize();
    });
}

function belongsToSearch(window, search) {
    for (let current = window; current; current = current.get_transient_for()) {
        if (current === search)
            return true;
    }
    return false;
}

// Keep the GTK search client, but treat its surface as transient shell UI.
// All injections and signal handlers are restored when branding is disabled.
export class SearchIntegration {
    constructor() {
        this._injections = new InjectionManager();
        this._windows = new Map();
        this._injections.overrideMethod(Shell.AppSystem.prototype, 'get_running', original =>
            function (...args) {
                return original.apply(this, args).filter(app => {
                    const windows = app.get_windows();
                    return app.get_id() !== `${APP_ID}.desktop` ||
                        windows.some(window => !isSearchWindow(window));
                });
            });
        this._injections.overrideMethod(Meta.Display.prototype, 'get_tab_list', original =>
            function (...args) {
                return original.apply(this, args).filter(window => !isSearchWindow(window));
            });
        if (Workspace.prototype._isOverviewWindow) {
            this._injections.overrideMethod(Workspace.prototype, '_isOverviewWindow', original =>
                function (window) {
                    return !isSearchWindow(window) && original.call(this, window);
                });
        }
        if (Main.wm && typeof Main.wm._shouldAnimateActor === 'function') {
            this._injections.overrideMethod(Main.wm, '_shouldAnimateActor', original =>
                function (actor, types) {
                    return !isSearchWindow(actor?.meta_window) && original.call(this, actor, types);
                });
        }
        this._unminimizeId = global.window_manager.connect('unminimize', (_manager, actor) => {
            if (isSearchWindow(actor.meta_window))
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    fade(actor.meta_window, true);
                    return GLib.SOURCE_REMOVE;
                });
        });
        this._redirectOverviewSearch();
        this._mapId = global.window_manager.connect('map', (_manager, actor) => {
            const window = actor.meta_window;
            if (!isSearchWindow(window))
                return;
            this._track(window);
            const work = Main.layoutManager.getWorkAreaForMonitor(window.get_monitor());
            const frame = window.get_frame_rect();
            window.move_frame(true, work.x + Math.max(0, Math.round((work.width - frame.width) / 2)),
                work.y + Math.round(work.height * 0.16));
            Main.overview.hide();
            Main.activateWindow(window);
            fade(window, true);
        });
        this._focusId = global.display.connect('notify::focus-window', () => {
            const focus = global.display.focus_window;
            if (!focus)
                return; // Desktop/background clicks are handled below.
            for (const window of this._windows.keys()) {
                if (!window.minimized && !belongsToSearch(focus, window))
                    dismissSearch(window);
            }
        });
        this._eventId = global.stage.connect('captured-event', (_stage, event) => {
            const type = event.type();
            if (type !== Clutter.EventType.BUTTON_PRESS && type !== Clutter.EventType.TOUCH_BEGIN)
                return Clutter.EVENT_PROPAGATE;
            const search = global.display.focus_window;
            if (!isSearchWindow(search))
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            const frame = search.get_frame_rect();
            const actor = search.get_compositor_private();
            // Popovers can extend beyond the toplevel rectangle.
            const target = eventActor(event);
            const inside = actor?.contains(target) || isKeyboardTarget(target) ||
                (x >= frame.x && x < frame.x + frame.width &&
                 y >= frame.y && y < frame.y + frame.height);
            if (!inside)
                dismissSearch(search);
            // Let the original click/tap reach its intended target.
            return Clutter.EVENT_PROPAGATE;
        });
        for (const actor of global.get_window_actors()) {
            if (isSearchWindow(actor.meta_window))
                this._track(actor.meta_window);
        }
    }

    // One search in the OS: typing in the overview / app grid opens Mutsu
    // Search with what was typed, and the overview's own search box is hidden.
    _redirectOverviewSearch() {
        const entry = Main.overview.searchEntry;
        const text = entry?.clutter_text;
        if (!text)
            return;
        this._overviewEntry = entry;
        this._entryState = {opacity: entry.opacity, reactive: entry.reactive};
        entry.opacity = 0;
        entry.reactive = false;
        this._textId = text.connect('text-changed', () => {
            const query = text.get_text();
            if (!query || this._redirecting)
                return;
            this._redirecting = true;
            entry.set_text('');
            this._redirecting = false;
            Main.overview.hide();
            try {
                GLib.spawn_async(null, ['/usr/bin/mutsu-search', '--query', query], null,
                    GLib.SpawnFlags.SEARCH_PATH, null);
            } catch (e) {
                logError(e, 'Mutsu: could not open Mutsu Search');
            }
        });
    }

    _track(window) {
        if (this._windows.has(window))
            return;
        const id = window.connect('unmanaged', () => this._windows.delete(window));
        this._windows.set(window, id);
    }

    destroy() {
        global.window_manager.disconnect(this._mapId);
        global.window_manager.disconnect(this._unminimizeId);
        if (this._overviewEntry) {
            this._overviewEntry.clutter_text.disconnect(this._textId);
            Object.assign(this._overviewEntry, this._entryState);
            this._overviewEntry = null;
        }
        global.display.disconnect(this._focusId);
        global.stage.disconnect(this._eventId);
        for (const [window, id] of this._windows)
            window.disconnect(id);
        this._windows.clear();
        this._injections.clear();
    }
}
