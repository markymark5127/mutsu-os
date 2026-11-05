import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {bladeTransform, groupWindows, isWindowMaximized, maximizeWindow, unmaximizeWindow}
    from './tabletGeometry.js';
import {TouchRouter, makeTappable, findHandler} from './touchRouter.js';

const SWIPE_ACTION_PX = 110;
const MAX_PANES = 3;

// Multitasking "blades": one tall blade per app, newest first, fanned in
// perspective. Every window of an app is a pane inside its blade with its
// own Mac traffic lights (close, minimize, zoom/float). Spaces along the top
// filter by workspace and accept dropped blades.
//
//   tap pane            open that window        swipe blade/pane up    close
//   swipe sideways      browse blades           swipe blade/pane down  minimize
//   hold + drag blade   onto a blade: Split View, onto a Space: move,
//                       onto the right edge: Slide Over
export class TabletBlades {
    constructor({monitor, split, home}) {
        this._getMonitor = monitor;
        this._split = split;
        this._home = home;
        this._root = null;
        this._grab = null;
        this._signals = [];
        this._filter = null; // null = all Spaces, otherwise workspace index
        this._expanded = new Set();
    }

    get visible() { return this._root !== null; }

    show() {
        if (this.visible || Main.sessionMode.isLocked)
            return;
        const m = this._getMonitor();
        if (!m)
            return;
        this._monitor = m;
        this._returnTo = global.display.focus_window;
        const root = new St.Widget({style_class: 'mutsu-blades', reactive: true, can_focus: true,
            x: m.x, y: m.y, width: m.width, height: m.height});
        Main.layoutManager.uiGroup.add_child(root);
        this._grab = Main.pushModal(root, {actionMode: Shell.ActionMode.POPUP});
        if (!this._grab.get_seat_state()) {
            Main.popModal(this._grab);
            this._grab = null;
            root.destroy();
            return;
        }
        this._root = root;
        this._addBlur(root);
        this._router = new TouchRouter(root, this);
        root.connect('key-press-event', (_a, event) => this._key(event));
        this._watch(global.display, 'window-created', () => this._rebuildSoon());
        this._watch(global.workspace_manager, 'notify::n-workspaces', () => this._rebuildSoon());
        this._watch(Main.layoutManager, 'monitors-changed', () => this.hide());
        this._watch(Main.sessionMode, 'updated', () => {
            if (Main.sessionMode.isLocked)
                this.hide();
        });
        this._offset = null;
        this._splitFirst = null;
        this._build();
        root.grab_key_focus();
        root.opacity = 0;
        root.ease({opacity: 255, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _addBlur(root) {
        try {
            const effect = new Shell.BlurEffect({mode: Shell.BlurMode.BACKGROUND, brightness: 0.55});
            if ('radius' in effect)
                effect.radius = 36;
            else
                effect.sigma = 18;
            root.add_effect(effect);
        } catch (e) {
            // The solid backdrop colour in the stylesheet is the fallback.
        }
    }

    _watch(object, signal, fn) {
        this._signals.push([object, object.connect(signal, fn)]);
    }

    _windows() {
        const tracker = Shell.WindowTracker.get_default();
        const all = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .filter(w => !w.is_skip_taskbar() && w.get_window_type() === Meta.WindowType.NORMAL);
        const filtered = this._filter === null ? all : all.filter(w =>
            w.is_on_all_workspaces() || w.get_workspace()?.index() === this._filter);
        return {all, groups: groupWindows(filtered, w => {
            const app = tracker.get_window_app(w);
            return app ? app.get_id() : `window:${w.get_id()}`;
        }).map(group => ({...group, app: tracker.get_window_app(group.windows[0])}))};
    }

    _rebuildSoon() {
        if (!this._root || this._rebuildPending)
            return;
        this._rebuildPending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            this._rebuildPending = 0;
            if (this._root && this._router && !this._router.active)
                this._build();
            else if (this._root)
                this._rebuildSoon();
            return GLib.SOURCE_REMOVE;
        });
    }

    _build() {
        const m = this._monitor;
        const keepKey = this._groups?.[this._centreIndex()]?.key;
        for (const [window, id] of this._windowSignals ?? [])
            window.disconnect(id);
        this._windowSignals = [];
        this._root.destroy_all_children();
        const {all, groups} = this._windows();
        if (!all.length) {
            this.hide();
            this._home();
            return;
        }
        this._groups = groups;
        for (const window of all) {
            this._windowSignals.push([window, window.connect('unmanaged', () => this._rebuildSoon())]);
            this._windowSignals.push([window, window.connect('notify::minimized', () => this._rebuildSoon())]);
        }

        // Spaces bar.
        this._spaces = new St.BoxLayout({style_class: 'mutsu-spaces'});
        const manager = global.workspace_manager;
        const pill = (label, filter, count) => {
            const actor = new St.BoxLayout({style_class: this._filter === filter
                ? 'mutsu-space mutsu-space-active' : 'mutsu-space'});
            actor.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
            if (count !== null)
                actor.add_child(new St.Label({text: String(count), style_class: 'mutsu-space-count',
                    y_align: Clutter.ActorAlign.CENTER}));
            makeTappable(actor, () => {
                this._filter = filter;
                this._offset = null;
                this._build();
            }, filter === null ? 'All Spaces' : label);
            actor._mutsuSpace = filter;
            this._spaces.add_child(actor);
            return actor;
        };
        pill('All', null, all.length);
        for (let i = 0; i < manager.get_n_workspaces(); i++) {
            const count = all.filter(w => w.get_workspace()?.index() === i).length;
            const active = i === manager.get_active_workspace_index();
            pill(`Desktop ${i + 1}${active ? ' •' : ''}`, i, count);
        }
        const add = new St.Label({text: '+', style_class: 'mutsu-space mutsu-space-add'});
        makeTappable(add, () => {
            manager.append_new_workspace(false, global.get_current_time());
            this._build();
        }, 'New Desktop');
        this._spaces.add_child(add);
        this._root.add_child(this._spaces);
        const [, spacesW] = this._spaces.get_preferred_width(-1);
        this._spaces.set_position(Math.round((m.width - Math.min(spacesW, m.width - 32)) / 2), 44);

        this._hint = new St.Label({style_class: 'mutsu-blades-hint',
            text: 'Swipe up to close · down to minimize · hold and drag to split or move'});
        this._root.add_child(this._hint);
        const [, hintW] = this._hint.get_preferred_width(-1);
        this._hint.set_position(Math.round((m.width - hintW) / 2), 96);

        // Blades.
        this._bladeH = Math.round(m.height * (m.height > m.width ? 0.56 : 0.64));
        this._bladeW = Math.round(Math.max(240, Math.min(440, m.width * (m.height > m.width ? 0.6 : 0.3))));
        this._spacing = Math.round(this._bladeW * 0.82);
        this._bladeY = Math.round(126 + (m.height - 126 - 96 - this._bladeH) / 2);
        this._strip = new St.Widget({x: 0, y: 0, width: m.width, height: m.height});
        this._root.add_child(this._strip);
        this._blades = groups.map((group, index) => this._blade(group, index));
        if (this._offset === null) {
            const start = groups.length > 1 && groups[0].windows.includes(this._returnTo) ? 1 : 0;
            this._offset = start * this._spacing;
        } else if (keepKey) {
            const index = groups.findIndex(g => g.key === keepKey);
            if (index >= 0)
                this._offset = index * this._spacing;
        }
        this._offset = this._clampOffset(this._offset);
        this._layoutBlades();

        // Footer.
        const footer = new St.BoxLayout({style_class: 'mutsu-blades-footer'});
        const home = new St.Label({text: 'Home', style_class: 'mutsu-blades-button'});
        makeTappable(home, () => { this.hide(false); this._home(); }, 'Go to Home');
        footer.add_child(home);
        const done = new St.Label({text: 'Done', style_class: 'mutsu-blades-button'});
        makeTappable(done, () => this.hide(), 'Return to app');
        footer.add_child(done);
        this._root.add_child(footer);
        const [, footW] = footer.get_preferred_width(-1);
        footer.set_position(Math.round((m.width - footW) / 2), m.height - 72);
    }

    _blade(group, index) {
        const blade = new St.BoxLayout({vertical: true, style_class: 'mutsu-blade',
            width: this._bladeW, height: this._bladeH, reactive: true});
        blade._mutsuBlade = group;
        const header = new St.BoxLayout({style_class: 'mutsu-blade-header'});
        if (group.app)
            header.add_child(group.app.create_icon_texture(28));
        header.add_child(new St.Label({text: group.app?.get_name() ?? group.windows[0].get_title(),
            x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'mutsu-blade-title'}));
        if (group.windows.length > 1)
            header.add_child(new St.Label({text: `${group.windows.length} windows`,
                style_class: 'mutsu-blade-count', y_align: Clutter.ActorAlign.CENTER}));
        blade.add_child(header);

        const expanded = this._expanded.has(group.key);
        const shown = expanded ? group.windows : group.windows.slice(0, MAX_PANES);
        const hidden = group.windows.length - shown.length;
        const bodyH = this._bladeH - 56 - 54 - (hidden ? 40 : 0);
        const paneH = Math.max(90, Math.floor((bodyH - (shown.length - 1) * 10) / shown.length));
        for (const window of shown)
            blade.add_child(this._pane(window, paneH));
        if (hidden) {
            const more = new St.Label({text: `Show ${hidden} more`, style_class: 'mutsu-blade-more'});
            makeTappable(more, () => {
                this._expanded.add(group.key);
                this._build();
            }, `Show ${hidden} more windows`);
            blade.add_child(more);
        }
        blade.add_child(new St.Widget({y_expand: true}));
        const actions = new St.BoxLayout({style_class: 'mutsu-blade-actions'});
        for (const [label, action] of [
            ['Split View', () => this._chooseSplit(group, blade)],
            ['Slide Over', () => { this.hide(false); this._split.slideOver(group.windows[0]); }],
        ]) {
            const button = new St.Label({text: label, style_class: 'mutsu-blade-action'});
            makeTappable(button, action, label);
            actions.add_child(button);
        }
        blade.add_child(actions);
        makeTappable(blade, () => this._activate(group.windows[0]), group.app?.get_name() ?? 'Window');
        this._strip.add_child(blade);
        blade.set_pivot_point(0.5, 0.5);
        blade._mutsuIndex = index;
        return blade;
    }

    _pane(window, height) {
        const pane = new St.BoxLayout({vertical: true, style_class: window.minimized
            ? 'mutsu-pane mutsu-pane-minimized' : 'mutsu-pane', height});
        pane._mutsuWindow = window;
        const bar = new St.BoxLayout({style_class: 'mutsu-pane-bar'});
        const light = (style, name, action) => {
            const dot = new St.Widget({style_class: `mutsu-light ${style}`});
            makeTappable(dot, action, name);
            bar.add_child(dot);
        };
        light('mutsu-light-close', 'Close window', () => window.delete(global.get_current_time()));
        light('mutsu-light-minimize', window.minimized ? 'Restore window' : 'Minimize window', () => {
            if (window.minimized)
                window.unminimize();
            else
                window.minimize();
        });
        const maximized = isWindowMaximized(window);
        light('mutsu-light-zoom', maximized ? 'Float window' : 'Full screen window', () => {
            if (isWindowMaximized(window))
                unmaximizeWindow(window, Meta);
            else
                maximizeWindow(window, Meta);
            this._rebuildSoon();
        });
        bar.add_child(new St.Label({text: window.get_title() || '', x_expand: true,
            style_class: 'mutsu-pane-title', y_align: Clutter.ActorAlign.CENTER}));
        if (window.minimized)
            bar.add_child(new St.Label({text: 'Minimized', style_class: 'mutsu-pane-badge'}));
        else if (!maximized)
            bar.add_child(new St.Label({text: 'Floating', style_class: 'mutsu-pane-badge'}));
        pane.add_child(bar);
        const preview = new St.Widget({style_class: 'mutsu-pane-preview', clip_to_allocation: true,
            x_expand: true, y_expand: true, layout_manager: new Clutter.BinLayout()});
        const source = window.get_compositor_private();
        if (source) {
            const rect = window.get_frame_rect();
            const boxW = this._bladeW - 24, boxH = Math.max(40, height - 34);
            const scale = Math.min(boxW / Math.max(1, rect.width), boxH / Math.max(1, rect.height));
            const clone = new Clutter.Clone({source, x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER});
            clone.set_size(Math.round(rect.width * scale), Math.round(rect.height * scale));
            preview.add_child(clone);
        }
        pane.add_child(preview);
        makeTappable(pane, () => this._activate(window), window.get_title() || 'Window');
        return pane;
    }

    // ---- layout ------------------------------------------------------------

    _clampOffset(offset) {
        const max = Math.max(0, (this._groups.length - 1) * this._spacing);
        return Math.max(0, Math.min(max, offset));
    }

    _centreIndex() {
        if (!this._spacing)
            return 0;
        return Math.round((this._offset ?? 0) / this._spacing);
    }

    _layoutBlades(animate = false) {
        const m = this._monitor;
        const order = [];
        this._blades.forEach((blade, index) => {
            const rel = (index * this._spacing - this._offset) / this._spacing;
            const t = bladeTransform(rel);
            const props = {
                x: Math.round(m.width / 2 - this._bladeW / 2 + rel * this._spacing),
                y: this._bladeY,
                rotation_angle_y: t.angle, scale_x: t.scale, scale_y: t.scale, opacity: t.opacity,
            };
            if (animate)
                blade.ease({...props, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            else
                Object.assign(blade, props);
            order.push([Math.abs(rel), blade]);
        });
        // The centred blade sits on top of its neighbours.
        order.sort((a, b) => b[0] - a[0]);
        for (const [, blade] of order)
            this._strip.set_child_above_sibling(blade, null);
    }

    _snap(velocity = 0) {
        const fling = Math.abs(velocity) > 0.5 ? -Math.sign(velocity) : 0;
        const index = Math.round(this._offset / this._spacing) + fling;
        this._offset = this._clampOffset(index * this._spacing);
        this._layoutBlades(true);
    }

    // ---- actions -----------------------------------------------------------

    _activate(window) {
        const first = this._splitFirst;
        if (first) {
            if (first !== window) {
                this.hide(false);
                this._split.arrange(first, window);
            }
            return;
        }
        this.hide(false);
        Main.activateWindow(window);
    }

    _chooseSplit(group, blade) {
        this._splitFirst = group.windows[0];
        for (const b of this._blades)
            b.remove_style_class_name('mutsu-split-selected');
        blade.add_style_class_name('mutsu-split-selected');
        this._hint.text = 'Now tap the app to place beside it';
    }

    _targets(s) {
        const target = findHandler(s.source, this._root, '_mutsuWindow') ??
            findHandler(s.source, this._root, '_mutsuBlade');
        if (!target)
            return null;
        if (target._mutsuWindow && target.get_parent()?._mutsuBlade?.windows.length > 1)
            return {actor: target, windows: [target._mutsuWindow]};
        const blade = target._mutsuBlade ? target : target.get_parent();
        return blade?._mutsuBlade ? {actor: blade, windows: blade._mutsuBlade.windows} : null;
    }

    // ---- router delegate -------------------------------------------------------

    dragStart(kind, s) {
        if (kind === 'horizontal') {
            this._scroll = {base: this._offset};
            for (const blade of this._blades)
                blade.remove_all_transitions();
            return true;
        }
        const target = this._targets(s);
        if (!target)
            return false;
        this._swipe = target;
        return true;
    }

    drag(kind, dx, dy) {
        if (kind === 'horizontal' && this._scroll) {
            const raw = this._scroll.base - dx;
            const clamped = this._clampOffset(raw);
            this._offset = clamped + (raw - clamped) * 0.3;
            this._layoutBlades();
        } else if (this._swipe) {
            this._swipe.actor.translation_y = dy;
            this._swipe.actor.opacity = Math.max(60, 255 - Math.abs(dy) * 0.8);
        }
    }

    dragEnd(kind, dx, dy, velocity) {
        if (kind === 'horizontal' && this._scroll) {
            this._scroll = null;
            this._snap(velocity);
            return;
        }
        const swipe = this._swipe;
        this._swipe = null;
        if (!swipe)
            return;
        if (dy < -SWIPE_ACTION_PX) {
            swipe.actor.ease({translation_y: -this._monitor.height, opacity: 0, duration: 200,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    // Ordinary close requests keep unsaved-work prompts.
                    for (const window of swipe.windows)
                        window.delete(global.get_current_time());
                    this._rebuildSoon();
                }});
        } else if (dy > SWIPE_ACTION_PX) {
            for (const window of swipe.windows)
                window.minimize();
            swipe.actor.ease({translation_y: 0, opacity: 255, duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        } else {
            swipe.actor.ease({translation_y: 0, opacity: 255, duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
    }

    longPress(s) {
        const blade = findHandler(s.source, this._root, '_mutsuBlade');
        if (!blade)
            return false;
        const [x, y] = blade.get_transformed_position();
        const clone = new Clutter.Clone({source: blade, opacity: 220});
        clone.set_size(this._bladeW, this._bladeH);
        clone.set_pivot_point(0.5, 0.5);
        this._root.add_child(clone);
        clone.set_position(x - this._monitor.x, y - this._monitor.y);
        clone.ease({scale_x: 0.6, scale_y: 0.6, duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        blade.opacity = 90;
        this._carry = {blade, clone, group: blade._mutsuBlade, dx: s.x - x, dy: s.y - y};
        this._hint.text = 'Drop on an app for Split View · on a Desktop to move · right edge for Slide Over';
        return true;
    }

    _dropTarget(s) {
        const m = this._monitor;
        if (s.x - m.x > m.width * 0.9)
            return {kind: 'slide'};
        const actor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, s.x, s.y);
        const space = findHandler(actor, this._root, '_mutsuTap');
        if (space && space._mutsuSpace !== undefined && space._mutsuSpace !== null)
            return {kind: 'space', index: space._mutsuSpace, actor: space};
        // Nearest blade by horizontal position (the clone covers the pick).
        let best = null;
        for (const blade of this._blades) {
            if (blade === this._carry.blade)
                continue;
            const [bx] = blade.get_transformed_position();
            const [bw] = blade.get_transformed_size();
            if (s.x >= bx && s.x <= bx + bw)
                best = blade;
        }
        return best ? {kind: 'split', blade: best} : null;
    }

    heldMove(_dx, _dy, s) {
        const c = this._carry;
        if (!c)
            return;
        c.clone.set_position(s.x - this._monitor.x - c.dx, s.y - this._monitor.y - c.dy);
        const target = this._dropTarget(s);
        for (const blade of this._blades)
            blade.remove_style_class_name('mutsu-blade-drop');
        for (const space of this._spaces.get_children())
            space.remove_style_class_name('mutsu-space-drop');
        if (target?.kind === 'split')
            target.blade.add_style_class_name('mutsu-blade-drop');
        else if (target?.kind === 'space')
            target.actor.add_style_class_name('mutsu-space-drop');
    }

    heldEnd(s) {
        const c = this._carry;
        this._carry = null;
        if (!c)
            return;
        // Pick under the finger without the floating clone in the way.
        c.clone.hide();
        const target = this._dropTarget(s);
        c.clone.destroy();
        c.blade.opacity = 255;
        if (target?.kind === 'split') {
            this.hide(false);
            this._split.arrange(c.group.windows[0], target.blade._mutsuBlade.windows[0]);
        } else if (target?.kind === 'slide') {
            this.hide(false);
            this._split.slideOver(c.group.windows[0]);
        } else if (target?.kind === 'space') {
            const workspace = global.workspace_manager.get_workspace_by_index(target.index);
            for (const window of c.group.windows)
                window.change_workspace(workspace);
            this._build();
        } else {
            this._build();
        }
    }

    tap(s) {
        if (findHandler(s.source, this._root, '_mutsuTap'))
            return false;
        if (this._splitFirst) {
            this._splitFirst = null;
            this._build();
            return true;
        }
        this.hide(); // empty space: back to where you were
        return true;
    }

    cancel() {
        if (this._scroll) {
            this._scroll = null;
            this._snap();
        }
        if (this._swipe) {
            this._swipe.actor.translation_y = 0;
            this._swipe.actor.opacity = 255;
            this._swipe = null;
        }
        if (this._carry) {
            this._carry.clone.destroy();
            this._carry.blade.opacity = 255;
            this._carry = null;
        }
    }

    _key(event) {
        const key = event.get_key_symbol();
        const centre = this._groups?.[this._centreIndex()];
        if (key === Clutter.KEY_Escape) {
            this.hide();
        } else if (key === Clutter.KEY_Left || key === Clutter.KEY_Right) {
            this._offset = this._clampOffset(this._offset +
                (key === Clutter.KEY_Left ? -1 : 1) * this._spacing);
            this._layoutBlades(true);
        } else if ((key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) && centre) {
            this._activate(centre.windows[0]);
        } else if ((key === Clutter.KEY_Delete || key === Clutter.KEY_BackSpace) && centre) {
            for (const window of centre.windows)
                window.delete(global.get_current_time());
        } else if ((key === Clutter.KEY_m || key === Clutter.KEY_M) && centre) {
            for (const window of centre.windows)
                window.minimize();
        } else {
            return Clutter.EVENT_PROPAGATE;
        }
        return Clutter.EVENT_STOP;
    }

    // restore: return focus to the window that was active before opening.
    hide(restore = true) {
        if (!this._root)
            return;
        const returnTo = this._returnTo;
        this._returnTo = null;
        if (this._rebuildPending)
            GLib.source_remove(this._rebuildPending);
        this._rebuildPending = 0;
        this._router?.destroy();
        this._router = null;
        for (const [window, id] of this._windowSignals ?? [])
            window.disconnect(id);
        this._windowSignals = [];
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        if (this._grab)
            Main.popModal(this._grab);
        this._grab = null;
        this._root.destroy();
        this._root = null;
        this._blades = [];
        this._groups = null;
        this._carry = this._swipe = this._scroll = null;
        this._expanded.clear();
        if (restore && returnTo && !returnTo.minimized && returnTo.get_compositor_private())
            Main.activateWindow(returnTo);
    }

    destroy() {
        this.hide(false);
    }
}
