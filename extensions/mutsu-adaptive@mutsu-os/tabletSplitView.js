import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {slideOverhang, sameSequence, splitFrames, splitVertical, maximizeWindow, unmaximizeWindow, isWindowMaximized,
    slideOverFrame, slideOverRelease, dragVelocity} from './tabletGeometry.js';

const SLIDE_GAP = 12; // between two Slide Over apps on the row

// GNOME's minimize / unminimize / resize animations, switched off for one
// window while Slide Over moves it. (Main.wm.skipNextEffect isn't enough:
// Mutter reports the unminimize a moment later, and a resize in between
// used up the skip, so GNOME's zoom from the top-left corner still played.)
let noEffectsInstalled = null;
let noEffectsUsers = 0;
function installNoEffects() {
    noEffectsUsers++;
    const wm = Main.wm;
    if (noEffectsInstalled || typeof wm?._shouldAnimateActor !== 'function')
        return;
    const original = wm._shouldAnimateActor;
    const ours = function (actor, types) {
        if (noEffectsInstalled?.active && actor?._mutsuNoEffects)
            return false;
        return original.call(this, actor, types);
    };
    wm._shouldAnimateActor = ours;
    noEffectsInstalled = {active: true, original, ours};
}
function uninstallNoEffects() {
    noEffectsUsers = Math.max(0, noEffectsUsers - 1);
    if (!noEffectsInstalled || noEffectsUsers > 0)
        return;
    const wm = Main.wm;
    if (wm?._shouldAnimateActor === noEffectsInstalled.ours)
        wm._shouldAnimateActor = noEffectsInstalled.original;
    else
        noEffectsInstalled.active = false; // someone wrapped us: stay inert
    noEffectsInstalled = null;
}
function holdEffects(actor, ms = 1500) {
    if (!actor)
        return;
    actor._mutsuNoEffects = true;
    if (actor._mutsuNoEffectsId)
        GLib.source_remove(actor._mutsuNoEffectsId);
    actor._mutsuNoEffectsId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        actor._mutsuNoEffects = false;
        actor._mutsuNoEffectsId = 0;
        return GLib.SOURCE_REMOVE;
    });
}

function resetActor(actor) {
    actor.translation_x = 0;
    actor.scale_x = 1;
    actor.opacity = 255;
}

// Minimize a window that has just slid off an edge without anything else
// showing: it stays invisible (opacity 0) through the minimize, so neither
// a frame back at its old place nor GNOME's shrink-into-the-dock animation
// can flash. It becomes visible again whenever it is unminimized, however
// that happens (arrow tab, multitasking, dock).
function putAway(window, actor) {
    if (actor) {
        actor.opacity = 0;
        holdEffects(actor);
        if (!window._mutsuReveal) {
            window._mutsuReveal = window.connect('notify::minimized', () => {
                if (window.minimized)
                    return;
                window.disconnect(window._mutsuReveal);
                window._mutsuReveal = 0;
                const current = window.get_compositor_private?.();
                if (current && !current._mutsuSlidingIn)
                    resetActor(current);
            });
        }
    }
    try {
        window.minimize();
    } catch (e) {}
    if (actor) {
        // Back to its normal shape while hidden, ready for next time.
        actor.translation_x = 0;
        actor.scale_x = 1;
    }
}

// Split View (two apps side by side) and Slide Over (up to two narrow apps
// floating above everything) are independent, so up to four apps can be on
// screen at once: a split pair plus two Slide Over apps on top.
//
// Slide Over: fixed-size apps floating above the others, at most two, on
// one row. Each one's handle (the bar above it) and title bar move it
// sideways only; the two can't overlap, they bump into each other.
//   drag the handle or title bar   slide it along the row
//   flick it left or right         tuck it away off that edge; an arrow tab
//                                  appears there. Each edge holds one app:
//                                  if that edge is taken, it tucks away off
//                                  the other edge instead
//   tap an arrow tab (or drag it   that app slides back in from its edge
//   inward)
// A third app put in Slide Over replaces the oldest one.
export class TabletSplitView {
    constructor(monitor = () => Main.layoutManager.primaryMonitor) {
        this._monitor = monitor;
        installNoEffects();
        this._pair = null;
        this._splitMonitor = 0;
        // MRU, at most two: {window, x (null: right edge), tucked: null |
        // 'left' | 'right', handle, signals, shownAt}.
        this._entries = [];
        this._titleDrag = null;
        this._placing = false;
        this._signals = [];
        this._dividerLabel = new St.Label({text: '⋮', x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER});
        this._divider = new St.Button({style_class: 'mutsu-split-divider',
            accessible_name: 'Resize split view. Click to maximize the active app.',
            child: this._dividerLabel});
        this._divider.connect('clicked', () => this.fullscreen(global.display.focus_window));
        Main.layoutManager.addChrome(this._divider, {affectsStruts: false});
        this._divider.hide();
        // One arrow tab per edge.
        this._tabs = {left: this._makeTab('left'), right: this._makeTab('right')};
        this._connect(global.display, 'grab-op-begin', (_d, window) => this._titleGrab(window, true));
        this._connect(global.display, 'grab-op-end', (_d, window) => this._titleGrab(window, false));
        this._connect(global.stage, 'captured-event', (_stage, event) => this._event(event));
        this._connect(Main.layoutManager, 'monitors-changed', () => this._layout());
        this._connect(global.display, 'workareas-changed', () => this._layout());
        this._connect(global.display, 'notify::focus-window', () => this._sync());
        this._connect(Main.overview, 'showing', () => this._sync());
        this._connect(Main.overview, 'hidden', () => this._sync());
        this._connect(Main.sessionMode, 'updated', () => {
            this._drag = null;
            this._sync();
        });
        this._connect(Main.keyboard, 'visibility-changed', () => this._layout());
        this._connect(Main.layoutManager.keyboardBox, 'notify::height', () => this._layout());
    }

    _makeTab(side) {
        const tab = new St.Widget({style_class: 'mutsu-slideover-tab', reactive: true,
            layout_manager: new Clutter.BinLayout(), width: 26, height: 120,
            accessible_name: 'Show Slide Over'});
        if (side === 'left')
            tab.add_style_class_name('mutsu-slideover-tab-left');
        tab.add_child(new St.Label({style_class: 'mutsu-slideover-tab-arrow',
            text: side === 'left' ? '›' : '‹',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        Main.layoutManager.addChrome(tab, {affectsStruts: false});
        tab.hide();
        return tab;
    }

    _connect(object, signal, fn) { this._signals.push([object, object.connect(signal, fn)]); }

    _chrome(style, width, height, name) {
        const actor = new St.Widget({style_class: style, reactive: true,
            layout_manager: new Clutter.BinLayout(), width, height, accessible_name: name});
        actor.add_child(new St.Widget({style_class: `${style}-grip`,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        Main.layoutManager.addChrome(actor, {affectsStruts: false});
        actor.hide();
        return actor;
    }

    get pair() { return this._pair; }
    get slides() { return this._entries.map(e => e.window); }
    // The newest on-screen Slide Over app and its handle (checks/tests).
    get front() { return this._entries.find(e => this._onScreen(e))?.window ?? null; }
    get _handle() { return this._entries.find(e => this._onScreen(e))?.handle ?? null; }
    get tabs() { return this._tabs; }
    tuckedOn(side) { return this._entries.find(e => e.tucked === side)?.window ?? null; }

    // ---- Split View ----------------------------------------------------------

    arrange(left, right) {
        // Mutter reports a maximized window as not resizable, and every app is
        // maximized in tablet mode; only fixed-size windows are refused.
        const resizable = w => isWindowMaximized(w) || w.allows_resize();
        if (!left || !right || left === right || !resizable(left) || !resizable(right)) {
            Main.notify('Split View', 'Choose two different resizable app windows.');
            return false;
        }
        this.clearSplit();
        // A Slide Over app moved into the split leaves the stack.
        this._removeSlide(left);
        this._removeSlide(right);
        this._pair = [left, right];
        this._ratio = 0.5;
        this._splitMonitor = left.get_monitor();
        const workspace = left.get_workspace();
        for (const window of this._pair) {
            window.unmake_fullscreen();
            unmaximizeWindow(window, Meta);
            window.move_to_monitor(this._splitMonitor);
            window.change_workspace(workspace);
            window.unminimize();
        }
        this._closeSignals = this._pair.map(window =>
            [window, window.connect('unmanaged', () => {
                const remaining = this._pair?.find(w => w !== window);
                this.clearSplit();
                if (remaining)
                    maximizeWindow(remaining, Meta);
            })]);
        Main.overview.hide();
        Main.activateWindow(left);
        Main.activateWindow(right);
        this._layout();
        this._raiseSlide();
        return true;
    }

    _layout() {
        this._layoutSlide();
        if (!this._pair)
            return;
        if (!Main.layoutManager.monitors[this._splitMonitor])
            this._splitMonitor = Main.layoutManager.primaryIndex;
        const work = Main.layoutManager.getWorkAreaForMonitor(this._splitMonitor);
        const area = {x: work.x, y: work.y, width: work.width, height: work.height};
        // Stack direction follows the screen's shape, not the space left
        // above the keyboard, so opening the keyboard never flips the split.
        this._vertical = splitVertical(area);
        const keyboard = Main.layoutManager.keyboardBox;
        if (Main.keyboard?.visible && keyboard.height > 0 &&
            this._splitMonitor === (Main.layoutManager.keyboardIndex ?? Main.layoutManager.primaryIndex))
            area.height = Math.max(200, area.height - keyboard.height);
        this._area = area;
        const frames = splitFrames(area, this._ratio, this._vertical);
        this._pair.forEach((window, index) => {
            const r = frames[index];
            window.move_resize_frame(true, r.x, r.y, r.width, r.height);
        });
        if (this._vertical) {
            // Stacked: a horizontal grabber in the gap between top and bottom.
            this._divider.set_position(area.x + Math.round(area.width * 0.3), frames[1].y - 20);
            this._divider.set_size(Math.round(area.width * 0.4), 28);
            this._dividerLabel.text = '⋯';
        } else {
            this._divider.set_position(frames[1].x - 20, area.y + Math.round(area.height * 0.3));
            this._divider.set_size(28, Math.round(area.height * 0.4));
            this._dividerLabel.text = '⋮';
        }
        this._sync();
    }

    _sync() {
        const focus = global.display.focus_window;
        const locked = Main.sessionMode.isLocked || Main.overview.visible;
        const visible = !!this._pair && !locked && !this._pair.some(w => w.minimized) &&
            !Main.keyboard?.visible &&
            this._pair.some(w => w === focus || focus?.get_transient_for() === w ||
                this._entries.some(e => e.window === focus));
        this._divider.visible = visible;
        if (!visible && this._drag?.kind === 'divider')
            this._drag = null;
        for (const e of this._entries)
            e.handle.visible = !e.tucked && !locked && !e.window.minimized;
        for (const side of ['left', 'right'])
            this._tabs[side].visible = !locked && !!this.tuckedOn(side);
        // Slide Over stays on top: whatever app comes forward (even a
        // full-screen one, which shares the top layer) goes under it.
        if (!locked && focus && !this._entries.some(e => e.window === focus)) {
            for (const e of [...this._entries].reverse()) {
                if (!e.tucked && !e.window.minimized)
                    e.window.raise?.();
            }
        }
    }

    // ---- Slide Over ------------------------------------------------------------

    _entry(window) { return this._entries.find(e => e.window === window) ?? null; }
    _other(e) { return this._entries.find(o => o !== e) ?? null; }
    _onScreen(e) { return !!e && !e.tucked && !e.window.minimized; }

    _frame(e, x = e.x) {
        return slideOverFrame(this._monitor(), x);
    }

    // Put a window in Slide Over (or bring back the one already there).
    slideOver(window) {
        if (!window || window.is_skip_taskbar() ||
            !(isWindowMaximized(window) || window.allows_resize()))
            return false;
        const existing = this._entry(window);
        if (existing) {
            if (existing.tucked)
                this._show(existing, existing.tucked);
            else
                Main.activateWindow(window);
            return true;
        }
        if (this._pair?.includes(window)) {
            const other = this._pair.find(w => w !== window);
            this.clearSplit();
            maximizeWindow(other, Meta);
        }
        // Two at most: a third replaces the oldest, which goes back to
        // being an ordinary app (in Recent Apps).
        while (this._entries.length >= 2)
            this._removeSlide(this._entries.at(-1).window, true);
        const monitor = this._monitor();
        const other = this._entries[0];
        // The new app opens at the free end of the row.
        const otherRight = this._onScreen(other) &&
            this._frame(other).x + this._frame(other).width / 2 > monitor.x + monitor.width / 2;
        const e = {window, x: otherRight ? monitor.x : null, tucked: null, shownAt: 0,
            handle: this._chrome('mutsu-slideover', 120, 28,
                'Slide Over. Drag to move, flick to tuck it away to that side')};
        e.signals = [
            window.connect('unmanaged', () => this._removeSlide(window)),
            // The green button (full screen) takes it out of Slide Over.
            window.connect('size-changed', () => {
                // Ignore the auto-maximize of a just-launched app.
                if (isWindowMaximized(window) && Date.now() - e.shownAt > 1500)
                    this._removeSlide(window, false);
                else if (isWindowMaximized(window) || this._sizeDrifted(e))
                    this._layoutSlideSoon(); // the size stays locked
            }),
            // Dragging the title bar: the handle follows the window.
            window.connect('position-changed', () => this._followSlide(e)),
        ];
        this._entries.unshift(e);
        // Whether it was full screen, waiting in multitasking or minimized,
        // it arrives the Slide Over way: in from its edge, never GNOME's
        // zoom out of the dock.
        this._show(e, e.x === null ? 'right' : 'left');
        return true;
    }

    // Tablet mode is ending: Slide Over apps on screen fold off their edge
    // (not into the dock) and wait minimized as ordinary apps; tucked ones
    // are already minimized. Then Slide Over is cleared.
    leaveTablet() {
        const monitor = this._monitor();
        for (const e of this._entries) {
            if (!this._onScreen(e) || !monitor)
                continue;
            const window = e.window;
            const r = window.get_frame_rect();
            const edge = r.x + r.width / 2 < monitor.x + monitor.width / 2 ? 'left' : 'right';
            const actor = window.get_compositor_private?.();
            const finish = () => putAway(window, actor);
            if (!actor?.ease) {
                finish();
                continue;
            }
            actor.remove_all_transitions?.();
            actor.set_pivot_point?.(edge === 'left' ? 0 : 1, 0.5);
            actor.ease({translation_x: this._tuckOffset(edge, r, monitor), scale_x: 0.82, opacity: 120,
                duration: 220, mode: Clutter.AnimationMode.EASE_IN_CUBIC, onStopped: finish});
        }
        this.clear();
    }

    // Bring an app on screen; `fromSide` slides it in from that edge.
    _show(e, fromSide) {
        const window = e.window;
        const monitor = this._monitor();
        if (fromSide)
            e.x = fromSide === 'left' ? monitor.x : null;
        e.tucked = null;
        e.shownAt = Date.now();
        window._mutsuSlideOver = false;
        const actor = window.get_compositor_private?.();
        const wasMinimized = window.minimized;
        if (actor && wasMinimized) {
            // Stay invisible until our slide starts: GNOME's unminimize zoom
            // (from the monitor's top-left corner when there's no dock icon)
            // must never show.
            actor._mutsuSlidingIn = true;
            actor.opacity = 0;
        }
        // No GNOME zoom or resize animation: we slide in from the edge.
        if (actor)
            holdEffects(actor);
        window.unminimize();
        unmaximizeWindow(window, Meta);
        window.make_above?.();
        // Most recent first, and make room on the row.
        this._entries = [e, ...this._entries.filter(o => o !== e)];
        this._makeRoom(e);
        this._layoutSlide();
        const slideIn = () => {
            if (!actor)
                return;
            // If GNOME started its zoom anyway, cut it short and put the
            // window back where it belongs before sliding.
            const zooming = Main.wm?._unminimizing?.has?.(actor);
            actor.remove_all_transitions?.();
            if (zooming) {
                actor.set_scale?.(1, 1);
                const rect = window.get_buffer_rect?.();
                if (rect)
                    actor.set_position(rect.x, rect.y);
            }
            actor.scale_x = actor.scale_y = 1;
            actor.opacity = 255;
            if (!fromSide || !actor.ease) {
                actor._mutsuSlidingIn = false;
                actor.translation_x = 0;
                return;
            }
            const frame = this._frame(e);
            actor.translation_x = this._tuckOffset(fromSide, frame, this._monitor() ?? monitor);
            actor._mutsuSlidingIn = true;
            actor.ease({translation_x: 0, duration: 240, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onStopped: () => {
                    actor._mutsuSlidingIn = false;
                    actor.translation_x = 0;
                }});
        };
        slideIn();
        Main.activateWindow(window);
        this._sync();
    }

    // `e` just took its place: push the other app along the row, or tuck it
    // away if both don't fit.
    _makeRoom(e) {
        const other = this._other(e);
        if (!this._onScreen(other))
            return;
        const gap = SLIDE_GAP;
        const mine = this._frame(e), theirs = this._frame(other);
        if (mine.x + mine.width + gap <= theirs.x || theirs.x + theirs.width + gap <= mine.x)
            return;
        const toRight = theirs.x + theirs.width / 2 >= mine.x + mine.width / 2;
        const wanted = toRight ? mine.x + mine.width + gap : mine.x - theirs.width - gap;
        const placed = this._frame(other, wanted);
        if (placed.x === wanted) {
            other.x = wanted;
            return;
        }
        this.hideSlide(other.window, toRight ? 'right' : 'left');
    }

    _tuckOffset(side, frame, monitor) {
        return side === 'left'
            ? monitor.x - (frame.x + frame.width) - 24
            : monitor.x + monitor.width - frame.x + 24;
    }

    _sizeDrifted(e) {
        if (!this._onScreen(e) || this._placing || !this._monitor())
            return false;
        const frame = this._frame(e);
        const r = e.window.get_frame_rect();
        return Math.abs(r.width - frame.width) > 2 || Math.abs(r.height - frame.height) > 2;
    }

    _placeHandle(e, rect) {
        e.handle.set_position(rect.x + Math.round(rect.width / 2) - 60, rect.y - 34);
        e.handle.translation_x = 0;
    }

    // Where `e` may go when moved to `x`: along its row, stopping where it
    // meets the other app (they don't pass through each other).
    _clampMove(e, x, leftOfOther) {
        let frame = this._frame(e, x);
        const other = this._other(e);
        if (this._onScreen(other)) {
            const theirs = this._frame(other);
            const limit = leftOfOther ? theirs.x - frame.width - SLIDE_GAP
                : theirs.x + theirs.width + SLIDE_GAP;
            const bumped = leftOfOther ? Math.min(frame.x, limit) : Math.max(frame.x, limit);
            frame = {...frame, x: bumped};
        }
        return frame;
    }

    // How far past a screen edge `e` was dragged; not counted on the side
    // where the other Slide Over app stands in the way.
    _overhang(e, x, width, leftOfOther) {
        const overhang = slideOverhang(x, width, this._monitor());
        if (this._onScreen(this._other(e)) && (overhang > 0 ? leftOfOther : !leftOfOther) && overhang !== 0)
            return 0;
        return overhang;
    }

    _leftOfOther(e) {
        const other = this._other(e);
        if (!this._onScreen(other))
            return false;
        return this._frame(e).x < this._frame(other).x;
    }

    _followSlide(e) {
        if (this._placing || !this._onScreen(e) || !this._entries.includes(e))
            return;
        const rect = e.window.get_frame_rect();
        this._placeHandle(e, rect);
        if (this._titleDrag?.entry === e)
            this._titleDrag.samples.push([Date.now(), rect.x]);
    }

    // The title bar is dragged with Mutter's own move: follow it, then on
    // release keep the size, put it back on its row (sideways moves only),
    // or tuck it away if it was flicked.
    _titleGrab(window, begin) {
        const e = this._entry(window);
        if (!this._onScreen(e))
            return;
        if (begin) {
            this._titleDrag = {entry: e, startX: window.get_frame_rect().x, samples: [],
                leftOf: this._leftOfOther(e)};
            return;
        }
        const drag = this._titleDrag;
        this._titleDrag = null;
        if (drag?.entry !== e)
            return;
        const rect = window.get_frame_rect();
        const x = rect.x;
        const result = slideOverRelease(x - drag.startX, dragVelocity(drag.samples),
            this._overhang(e, x, rect.width, drag.leftOf));
        if (result === 'tuck-left' || result === 'tuck-right') {
            this.hideSlide(window, result === 'tuck-left' ? 'left' : 'right');
            return;
        }
        if (result === 'move')
            e.x = this._clampMove(e, x, drag.leftOf).x;
        this._layoutSlide();
    }

    _layoutSlide() {
        const monitor = this._monitor();
        if (!monitor)
            return;
        for (const e of this._entries) {
            const frame = this._frame(e);
            if (!e.tucked && !e.window.minimized) {
                this._placing = true;
                try {
                    e.window.move_resize_frame(false, frame.x, frame.y, frame.width, frame.height);
                } finally {
                    this._placing = false;
                }
            }
            this._placeHandle(e, frame);
        }
        const y = monitor.y + Math.round(monitor.height / 2) - 60;
        this._tabs.left.set_position(monitor.x, y);
        this._tabs.right.set_position(monitor.x + monitor.width - 26, y);
        this._tabs.left.translation_x = this._tabs.right.translation_x = 0;
    }

    _layoutSlideSoon() {
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            for (const e of this._entries) {
                if (this._onScreen(e))
                    unmaximizeWindow(e.window, Meta);
            }
            this._layoutSlide();
            return GLib.SOURCE_REMOVE;
        });
    }

    _raiseSlide() {
        for (const e of this._entries) {
            if (this._onScreen(e))
                e.window.make_above?.();
        }
    }

    // Tuck an app away off one edge (it folds off that edge, not down into
    // the dock); the arrow tab on that edge brings it back. Each edge holds
    // one app: if the asked-for edge is taken it goes off the other one.
    hideSlide(window = null, side = null) {
        const e = window ? this._entry(window) : this._entries.find(o => this._onScreen(o));
        const monitor = this._monitor();
        if (!e || e.tucked)
            return;
        const frame = this._frame(e);
        let edge = side ?? (frame.x + frame.width / 2 < monitor.x + monitor.width / 2 ? 'left' : 'right');
        if (this.tuckedOn(edge))
            edge = edge === 'left' ? 'right' : 'left';
        e.tucked = edge;
        this._layoutSlide();
        this._sync();
        const target = e.window;
        const actor = target.get_compositor_private?.();
        const finish = () => {
            if (e.tucked && this._entries.includes(e)) {
                target._mutsuSlideOver = true; // no dock tile (Kiwi)
                putAway(target, actor);
            } else if (actor) {
                resetActor(actor);
            }
        };
        if (!actor?.ease) {
            finish();
            return;
        }
        const r = target.get_frame_rect();
        actor.remove_all_transitions?.();
        actor.set_pivot_point?.(edge === 'left' ? 0 : 1, 0.5);
        actor.ease({
            translation_x: this._tuckOffset(edge, r, monitor),
            scale_x: 0.82,
            opacity: 120,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onStopped: finish,
        });
    }

    _removeSlide(window, minimize = false) {
        const e = this._entry(window);
        if (!e)
            return;
        for (const id of e.signals ?? []) {
            try { window.disconnect(id); } catch (err) {}
        }
        try { window.unmake_above?.(); } catch (err) {}
        window._mutsuSlideOver = false;
        this._entries = this._entries.filter(o => o !== e);
        if (this._titleDrag?.entry === e)
            this._titleDrag = null;
        if (this._drag?.entry === e)
            this._drag = null;
        Main.layoutManager.removeChrome(e.handle);
        e.handle.destroy();
        if (minimize) {
            try { window.minimize(); } catch (err) {}
        }
        this._sync();
    }

    // ---- input -------------------------------------------------------------------

    _event(event) {
        const T = Clutter.EventType;
        const type = event.type();
        const touch = [T.TOUCH_BEGIN, T.TOUCH_UPDATE, T.TOUCH_END, T.TOUCH_CANCEL].includes(type);
        const begin = type === T.BUTTON_PRESS || type === T.TOUCH_BEGIN;
        const end = type === T.BUTTON_RELEASE || type === T.TOUCH_END;
        if (!touch && !begin && !end && type !== T.MOTION)
            return Clutter.EVENT_PROPAGATE;
        const sequence = touch ? event.get_event_sequence() : null;
        const [x, y] = event.get_coords();
        if (begin && (touch || event.get_button() === 1)) {
            const source = (globalThis.global?.stage?.get_event_actor?.(event) ?? event.get_source?.() ?? null); // see touchRouter.eventActor
            const targets = [['divider', this._divider, null, null],
                ...this._entries.map(e => ['handle', e.handle, e, null]),
                ['tab', this._tabs.left, null, 'left'], ['tab', this._tabs.right, null, 'right']];
            for (const [kind, actor, entry, side] of targets) {
                if (actor.visible && actor.contains(source)) {
                    this._drag = {kind, entry, side, sequence, ratio: this._ratio, x, y,
                        samples: [[Date.now(), x]],
                        startX: entry?.window.get_frame_rect().x ?? 0,
                        leftOf: entry ? this._leftOfOther(entry) : false};
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        }
        const drag = this._drag;
        if (!drag || !sameSequence(drag.sequence, sequence))
            return Clutter.EVENT_PROPAGATE;
        const dx = x - drag.x;
        if (type === T.TOUCH_CANCEL) {
            this._drag = null;
            if (drag.kind === 'divider') {
                this._ratio = drag.ratio;
                this._layout();
            }
            this._tabs.left.translation_x = this._tabs.right.translation_x = 0;
            if (drag.kind === 'handle')
                this._layoutSlide(); // back where it was
            return Clutter.EVENT_STOP;
        }
        if (drag.kind === 'divider') {
            const vertical = this._vertical;
            const share = vertical ? (y - this._area.y) / this._area.height
                : (x - this._area.x) / this._area.width;
            this._ratio = Math.max(0.3, Math.min(0.7, share));
            this._layout();
            if (end) {
                this._drag = null;
                if (Math.abs(vertical ? y - drag.y : dx) < 8)
                    this.fullscreen(global.display.focus_window);
            }
        } else if (drag.kind === 'handle') {
            // The app moves with its handle, sideways only, at a fixed size,
            // and stops where it meets the other Slide Over app.
            const e = drag.entry;
            drag.samples.push([Date.now(), x]);
            if (e && this._entries.includes(e) && this._monitor()) {
                const frame = this._clampMove(e, drag.startX + dx, drag.leftOf);
                this._placing = true;
                try {
                    e.window.move_frame(true, frame.x, frame.y);
                } finally {
                    this._placing = false;
                }
                this._placeHandle(e, frame);
                drag.lastX = frame.x;
            }
            if (end) {
                this._drag = null;
                // Where the finger wanted it, before keeping it on screen.
                const wanted = drag.startX + dx;
                const result = slideOverRelease(dx, dragVelocity(drag.samples),
                    this._overhang(e, wanted, this._frame(e).width, drag.leftOf));
                if (!e || !this._entries.includes(e)) {
                    // closed mid-drag
                } else if (result === 'tuck-left' || result === 'tuck-right') {
                    this.hideSlide(e.window, result === 'tuck-left' ? 'left' : 'right');
                } else if (result === 'tap') {
                    this._layoutSlide();
                    Main.activateWindow(e.window);
                } else {
                    e.x = drag.lastX ?? e.x;
                    this._layoutSlide();
                }
            }
        } else if (drag.kind === 'tab') {
            const tab = this._tabs[drag.side];
            const inward = drag.side === 'left' ? Math.max(0, dx) : Math.min(0, dx);
            tab.translation_x = inward;
            if (end) {
                this._drag = null;
                tab.translation_x = 0;
                const e = this._entries.find(o => o.tucked === drag.side);
                if (e && (Math.abs(inward) > 30 || Math.abs(dx) < 8))
                    this._show(e, drag.side);
            }
        }
        return Clutter.EVENT_STOP;
    }

    fullscreen(window) {
        const target = this._pair?.includes(window) ? window : this._pair?.[0];
        this.clearSplit();
        if (target) {
            maximizeWindow(target, Meta);
            Main.activateWindow(target);
        }
    }

    clearSplit() {
        if (this._drag?.kind === 'divider')
            this._drag = null;
        for (const [window, id] of this._closeSignals ?? [])
            window.disconnect(id);
        this._closeSignals = [];
        this._pair = null;
        this._divider.hide();
    }

    clear() {
        this.clearSplit();
        for (const e of [...this._entries])
            this._removeSlide(e.window);
        this._sync();
    }

    destroy() {
        this.clear();
        // Apps folding away as tablet mode ends finish their slide (220 ms)
        // and minimize after this; keep GNOME's animations off for them.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
            uninstallNoEffects();
            return GLib.SOURCE_REMOVE;
        });
        for (const [object, id] of this._signals)
            object.disconnect(id);
        for (const actor of [this._divider, this._tabs.left, this._tabs.right]) {
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
    }
}

// Get a normal window for an app: an existing one, or launch the app and
// wait for its first window (up to 15 s). Calls back with null on timeout.
export function windowForApp(app, callback, {newWindow = false} = {}) {
    const existing = app.get_windows().find(w => !w.is_skip_taskbar() &&
        w.get_window_type() === Meta.WindowType.NORMAL);
    if (existing && !newWindow) {
        callback(existing);
        return;
    }
    const tracker = Shell.WindowTracker.get_default();
    let done = false;
    let timeout = 0;
    const createdId = global.display.connect('window-created', (_d, window) => {
        if (done || window.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        const shownId = window.connect('shown', () => {
            window.disconnect(shownId);
            if (done || tracker.get_window_app(window) !== app)
                return;
            finish(window);
        });
    });
    const finish = window => {
        done = true;
        global.display.disconnect(createdId);
        if (timeout)
            GLib.source_remove(timeout);
        // Let the first configure (and tablet auto-maximize) settle.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, window ? 250 : 0, () => {
            callback(window);
            return GLib.SOURCE_REMOVE;
        });
    };
    timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
        timeout = 0;
        if (!done)
            finish(null);
        return GLib.SOURCE_REMOVE;
    });
    if (existing && newWindow && app.can_open_new_window?.())
        app.open_new_window(-1);
    else
        app.activate();
}
