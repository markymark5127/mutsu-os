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

// Search comes and goes like part of the Shell, never like an app window
// minimizing or zooming: in tablet mode it fades in and out (opacity only);
// on the desktop it simply appears and disappears.
export function searchFadeMs(show, tablet) {
    if (!tablet)
        return 0;
    return show ? 180 : 140;
}

// Which of GNOME's window effects Search gets: on a tablet leaving (minimize
// or close) fades out; everything else, and anything on the desktop, has no
// effect at all (Search's own fade handles appearing).
export function searchEffect(window, tablet) {
    if (window?._mutsuFadedOut)
        return 'none'; // dismissSearch already faded it out
    return tablet && (window?.minimized || window?._mutsuClosing) ? 'fade' : 'none';
}

// Another extension's own minimize/unminimize animation on Search. Bazzite
// turns on "Compiz alike magic lamp effect", which skips GNOME's
// _shouldAnimateActor and warps the window into the dock itself, so Search
// still folded into the dock in tablet mode. Effects named (un)minimize that
// can finish themselves (destroy() tells Mutter the animation is done) are
// finished at once. Same rule as mutsu-adaptive's tabletGeometry.js.
export function dropForeignEffects(actor) {
    let dropped = 0;
    for (const effect of actor?.get_effects?.() ?? []) {
        const name = effect?.get_name?.() ?? effect?.name ?? '';
        if (!/minimize/i.test(name) || typeof effect.destroy !== 'function')
            continue;
        try {
            effect.destroy();
            dropped++;
        } catch (e) {
            console.warn(`Mutsu Search: couldn't finish the ${name} animation: ${e}`);
        }
    }
    return dropped;
}

// GNOME's minimize animation, reduced to its opacity: no shrinking, no
// flight towards the dock icon.
export function fadeOnlyParams(params, duration) {
    const out = {opacity: 0, duration, mode: Clutter.AnimationMode.EASE_OUT_QUAD};
    for (const key of ['onStopped', 'onComplete', 'delay'])
        if (key in params)
            out[key] = params[key];
    return out;
}

function fadeOnlyNextEase(actor) {
    if (actor._mutsuFadeOnly)
        return;
    actor._mutsuFadeOnly = true;
    const ownEase = Object.prototype.hasOwnProperty.call(actor, 'ease') ? actor.ease : null;
    const ease = actor.ease;
    actor.ease = function (params) {
        if (ownEase)
            actor.ease = ownEase;
        else
            delete actor.ease;
        actor._mutsuFadeOnly = false;
        actor.set_scale?.(1, 1);
        return ease.call(this, fadeOnlyParams(params, searchFadeMs(false, true)));
    };
}

function fade(window, show, done = null) {
    const actor = window?.get_compositor_private();
    if (!actor) {
        done?.();
        return;
    }
    actor.remove_all_transitions();
    actor.set_scale(1, 1);
    const duration = searchFadeMs(show, !!globalThis.mutsuTabletMode);
    if (!duration) {
        actor.opacity = 255;
        done?.();
        return;
    }
    if (show)
        actor.opacity = 0;
    actor.ease({
        opacity: show ? 255 : 0,
        duration,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onStopped: () => {
            done?.();
            if (!show)
                actor.opacity = 255;
        },
    });
}

// In touch mode Search opens with the on-screen keyboard up, like typing
// into any search field on a tablet.
function openKeyboardSoon() {
    let touch = false;
    try {
        touch = global.stage.get_context().get_backend().get_default_seat().get_touch_mode();
    } catch (e) {}
    if (!touch || !Main.keyboard?.open)
        return;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
        if (isSearchWindow(global.display.focus_window))
            Main.keyboard.open(Main.layoutManager.focusIndex ?? Main.layoutManager.primaryIndex);
        return GLib.SOURCE_REMOVE;
    });
}

export function dismissSearch(window) {
    if (!window || window.minimized || window._mutsuDismissing)
        return;
    const actor = window.get_compositor_private?.();
    const duration = searchFadeMs(false, !!globalThis.mutsuTabletMode);
    if (!duration || !actor?.ease) {
        // Desktop: Search simply disappears.
        window.minimize();
        return;
    }
    // Tablet: fade out first, then minimize with no animation of any kind
    // (GNOME's or another extension's), so whatever minimize effect is
    // installed, all that's seen is the fade. It stays at opacity 0 until
    // it's shown again (the unminimize handler fades it back in).
    window._mutsuDismissing = true;
    actor.remove_all_transitions?.();
    actor.set_scale?.(1, 1);
    actor.ease({
        opacity: 0,
        duration,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onStopped: finished => {
            window._mutsuDismissing = false;
            if (finished === false || window.minimized)
                return; // shown again mid-fade: its fade-in has taken over
            window._mutsuFadedOut = true;
            window.minimize();
        },
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
        // Everything in the Shell that asks "should this window be listed?"
        // (docks, minimized-window tiles, switchers) is told no for Search.
        this._injections.overrideMethod(Meta.Window.prototype, 'is_skip_taskbar', original =>
            function (...args) {
                return isSearchWindow(this) || original.apply(this, args);
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
                    const window = actor?.meta_window;
                    if (!isSearchWindow(window))
                        return original.call(this, actor, types);
                    if (searchEffect(window, !!globalThis.mutsuTabletMode) !== 'fade')
                        return false;
                    // Tablet: GNOME's minimize would shrink Search into the
                    // dock (and its close would zoom). Let it run, but as a
                    // plain fade: its next ease keeps only the opacity (and
                    // GNOME's own completion).
                    fadeOnlyNextEase(actor);
                    return true;
                });
        }
        // connect_after: another extension's (un)minimize handler has already
        // put its effect on the window, so it can be finished here.
        const after = (signal, fn) => (global.window_manager.connect_after ??
            global.window_manager.connect).call(global.window_manager, signal, fn);
        this._minimizeId = after('minimize', (_manager, actor) => {
            if (isSearchWindow(actor.meta_window))
                dropForeignEffects(actor);
        });
        this._unminimizeId = after('unminimize', (_manager, actor) => {
            if (!isSearchWindow(actor.meta_window))
                return;
            actor.meta_window._mutsuFadedOut = false;
            dropForeignEffects(actor);
            // Hidden right away so it can't flash fully drawn before the fade.
            if (globalThis.mutsuTabletMode)
                actor.opacity = 0;
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                fade(actor.meta_window, true);
                openKeyboardSoon();
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
            openKeyboardSoon();
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
        const ids = [
            window.connect('unmanaged', () => this._windows.delete(window)),
            // Closing (Escape, opening a result): fades out like a dismiss.
            window.connect('unmanaging', () => {
                window._mutsuClosing = true;
            }),
        ];
        this._windows.set(window, ids);
    }

    destroy() {
        global.window_manager.disconnect(this._mapId);
        global.window_manager.disconnect(this._unminimizeId);
        global.window_manager.disconnect(this._minimizeId);
        if (this._overviewEntry) {
            this._overviewEntry.clutter_text.disconnect(this._textId);
            Object.assign(this._overviewEntry, this._entryState);
            this._overviewEntry = null;
        }
        global.display.disconnect(this._focusId);
        global.stage.disconnect(this._eventId);
        for (const [window, ids] of this._windows)
            ids.forEach(id => window.disconnect(id));
        this._windows.clear();
        this._injections.clear();
    }
}
