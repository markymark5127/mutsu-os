import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Workspace} from 'resource:///org/gnome/shell/ui/workspace.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

const APP_ID = 'io.github.markymark5127.AIDesktop';

export function isSearchWindow(window) {
    return window?.get_gtk_application_id() === APP_ID &&
        window.get_title() === 'Mutsu OS Search';
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
        });
        this._focusId = global.display.connect('notify::focus-window', () => {
            const focus = global.display.focus_window;
            if (!focus)
                return; // Desktop/background clicks are handled below.
            for (const window of this._windows.keys()) {
                if (!window.minimized && !belongsToSearch(focus, window))
                    window.minimize();
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
            const inside = actor?.contains(event.get_source()) ||
                (x >= frame.x && x < frame.x + frame.width &&
                 y >= frame.y && y < frame.y + frame.height);
            if (!inside)
                search.minimize();
            // Let the original click/tap reach its intended target.
            return Clutter.EVENT_PROPAGATE;
        });
        for (const actor of global.get_window_actors()) {
            if (isSearchWindow(actor.meta_window))
                this._track(actor.meta_window);
        }
    }

    _track(window) {
        if (this._windows.has(window))
            return;
        const id = window.connect('unmanaged', () => this._windows.delete(window));
        this._windows.set(window, id);
    }

    destroy() {
        global.window_manager.disconnect(this._mapId);
        global.display.disconnect(this._focusId);
        global.stage.disconnect(this._eventId);
        for (const [window, id] of this._windows)
            window.disconnect(id);
        this._windows.clear();
        this._injections.clear();
    }
}
