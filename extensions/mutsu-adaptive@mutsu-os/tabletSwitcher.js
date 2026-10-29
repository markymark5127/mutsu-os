import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Kept separate from GNOME's workspace overview: Home can remain an app grid.
export class TabletSwitcher {
    constructor(home, suppressed, gesturesEnabled) {
        this._home = home;
        this._suppressed = suppressed;
        this._gesturesEnabled = gesturesEnabled;
        this._root = null;
        this._grab = null;
        this._drag = null;
        this._signals = [];
        this._bar = new St.Button({style_class: 'mutsu-home-bar',
            accessible_name: 'Home. Swipe up and hold for recent apps',
            child: new St.Widget({style_class: 'mutsu-home-indicator'})});
        this._bar.connect('clicked', () => this._home());
        Main.layoutManager.addChrome(this._bar, {affectsInputRegion: true});
        this._monitorId = Main.layoutManager.connect('monitors-changed', () => {
            this.hide();
            this._positionBar();
        });
        this._positionBar();
        this._sessionId = Main.sessionMode.connect('updated', () => {
            this._bar.visible = !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter;
            if (!this._bar.visible)
                this.hide();
        });
        this._windowId = global.display.connect('window-created', (_display, window) => {
            if (this.visible && window.get_transient_for()) {
                this.hide();
                Main.overview.hide();
            }
        });
        this._eventId = global.stage.connect('captured-event', (_stage, event) =>
            this._event(event));
    }

    get visible() { return this._root !== null; }

    _positionBar() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        this._bar.set_position(monitor.x + (monitor.width - 240) / 2,
            monitor.y + monitor.height - 24);
        this._bar.set_size(240, 24);
    }

    _event(event) {
        const type = event.type();
        const touch = type === Clutter.EventType.TOUCH_BEGIN ||
            type === Clutter.EventType.TOUCH_UPDATE ||
            type === Clutter.EventType.TOUCH_END || type === Clutter.EventType.TOUCH_CANCEL;
        const begin = type === Clutter.EventType.TOUCH_BEGIN || type === Clutter.EventType.BUTTON_PRESS;
        const end = type === Clutter.EventType.TOUCH_END || type === Clutter.EventType.BUTTON_RELEASE;
        if (this.visible && type === Clutter.EventType.KEY_PRESS &&
            event.get_key_symbol() === Clutter.KEY_Escape) {
            this.hide();
            return Clutter.EVENT_STOP;
        }
        if (!touch && !begin && !end && type !== Clutter.EventType.MOTION)
            return Clutter.EVENT_PROPAGATE;
        const sequence = touch ? event.get_event_sequence() : null;
        const [x, y] = event.get_coords();
        if (begin) {
            if (this._drag || Main.sessionMode.isLocked || this._suppressed())
                return Clutter.EVENT_PROPAGATE;
            if (!touch && event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            const m = Main.layoutManager.primaryMonitor;
            const edge = this._gesturesEnabled() && !this.visible && m && x >= m.x && x <= m.x + m.width &&
                y >= m.y + m.height - 24 && y <= m.y + m.height;
            const card = this._cards?.find(c => c.actor.contains(event.get_source()));
            if (!edge && !card)
                return Clutter.EVENT_PROPAGATE;
            this._drag = {x, y, sequence, card, time: event.get_time(), lastY: y,
                lastTime: event.get_time(), movedAt: event.get_time()};
            return Clutter.EVENT_STOP;
        }
        const drag = this._drag;
        if (!drag || drag.sequence !== sequence)
            return Clutter.EVENT_PROPAGATE;
        if (type === Clutter.EventType.TOUCH_CANCEL) {
            this._resetCard(drag.card);
            this._drag = null;
            return Clutter.EVENT_STOP;
        }
        const dy = y - drag.y;
        if (Math.abs(y - drag.lastY) > 4)
            drag.movedAt = event.get_time();
        drag.lastY = y;
        drag.lastTime = event.get_time();
        if (drag.card) {
            drag.card.actor.translation_y = Math.min(0, dy);
            drag.card.actor.opacity = Math.max(80, 255 + dy * 0.6);
        }
        if (end) {
            this._drag = null;
            if (drag.card) {
                if (dy < -90 && Math.abs(dy) > Math.abs(x - drag.x) * 1.2)
                    this._dismiss(drag.card);
                else if (Math.abs(dy) < 12 && Math.abs(x - drag.x) < 12)
                    this._activate(drag.card.window);
                else
                    this._resetCard(drag.card);
            } else if (dy < -48) {
                // A deliberate pause at the top of the swipe opens multitasking.
                if (event.get_time() - drag.movedAt > 180 || event.get_time() - drag.time > 550)
                    this.show();
                else
                    this._home();
            } else if (Math.abs(dy) < 12) {
                this._home();
            }
        }
        return Clutter.EVENT_STOP;
    }

    show() {
        if (this.visible || Main.sessionMode.isLocked)
            return;
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        const root = new St.Widget({style_class: 'mutsu-switcher', reactive: true,
            can_focus: true, layout_manager: new Clutter.BinLayout()});
        root.set_position(m.x, m.y);
        root.set_size(m.width, m.height);
        Main.layoutManager.uiGroup.add_child(root);
        this._grab = Main.pushModal(root, {actionMode: Shell.ActionMode.POPUP});
        if (!this._grab.get_seat_state()) {
            Main.popModal(this._grab);
            this._grab = null;
            root.destroy();
            return;
        }
        this._root = root;
        const box = new St.BoxLayout({vertical: true, style_class: 'mutsu-switcher-content',
            x_expand: true, y_expand: true});
        root.add_child(box);
        const heading = new St.BoxLayout({style_class: 'mutsu-switcher-heading'});
        heading.add_child(new St.Label({text: 'Recent Apps', x_expand: true,
            style_class: 'mutsu-switcher-title'}));
        const home = new St.Button({label: 'Home', style_class: 'mutsu-tablet-button',
            accessible_name: 'Go to Home'});
        home.connect('clicked', () => { this.hide(); this._home(); });
        heading.add_child(home);
        box.add_child(heading);
        box.add_child(new St.Label({text: 'Swipe up to close · Tap to resume',
            style_class: 'mutsu-switcher-hint'}));
        const scroll = new St.ScrollView({x_expand: true, y_expand: true});
        scroll.set_policy(St.PolicyType.AUTOMATIC, St.PolicyType.NEVER);
        box.add_child(scroll);
        const row = new St.BoxLayout({style_class: 'mutsu-switcher-cards',
            y_align: Clutter.ActorAlign.CENTER});
        scroll.set_child(row);
        this._cards = [];
        const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .filter(w => !w.is_skip_taskbar() && w.get_window_type() === Meta.WindowType.NORMAL);
        for (const window of windows) {
            const actor = new St.BoxLayout({vertical: true, reactive: true,
                can_focus: true, accessible_name: window.get_title(),
                style_class: 'mutsu-app-card', width: Math.min(420, Math.round(m.width * 0.65))});
            const label = new St.BoxLayout({style_class: 'mutsu-card-heading'});
            const app = Shell.WindowTracker.get_default().get_window_app(window);
            if (app)
                label.add_child(app.create_icon_texture(32));
            label.add_child(new St.Label({text: app?.get_name() ?? window.get_title(),
                x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
            actor.add_child(label);
            const preview = new St.Widget({height: Math.max(120, Math.min(300, m.height * 0.4)),
                clip_to_allocation: true, layout_manager: new Clutter.BinLayout(),
                style_class: 'mutsu-card-preview'});
            const source = window.get_compositor_private();
            if (source) {
                preview.add_child(new Clutter.Clone({source, x_expand: true, y_expand: true}));
            } else {
                preview.add_child(new St.Label({text: window.get_title()}));
            }
            actor.add_child(preview);
            row.add_child(actor);
            const card = {actor, window};
            actor.connect('key-press-event', (_actor, event) => {
                const key = event.get_key_symbol();
                if (key === Clutter.KEY_Return || key === Clutter.KEY_space)
                    this._activate(window);
                else if (key === Clutter.KEY_Delete)
                    this._dismiss(card);
                else
                    return Clutter.EVENT_PROPAGATE;
                return Clutter.EVENT_STOP;
            });
            this._cards.push(card);
            this._signals.push([window, window.connect('unmanaged', () => {
                actor.destroy();
                this._cards = this._cards.filter(c => c !== card);
                if (this._cards.length === 0) { this.hide(); this._home(); }
            })]);
        }
        if (!windows.length)
            row.add_child(new St.Label({text: 'No recent apps. Open an app from Home.'}));
        const done = new St.Button({label: 'Done', style_class: 'mutsu-tablet-button',
            x_align: Clutter.ActorAlign.CENTER});
        done.connect('clicked', () => this.hide());
        box.add_child(done);
        root.grab_key_focus();
        root.opacity = 0;
        root.ease({opacity: 255, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _activate(window) {
        this.hide();
        Main.overview.hide();
        Main.activateWindow(window);
    }

    _resetCard(card) {
        card?.actor.ease({translation_y: 0, opacity: 255, duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _dismiss(card) {
        // Request an ordinary close, so unsaved-document prompts still work.
        card.actor.ease({translation_y: -400, opacity: 0, duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                // Leave remaining cards available for further dismissals.
                this._resetCard(card);
                card.window.delete(global.get_current_time());
            }});
    }

    hide() {
        this._drag = null;
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        if (this._grab)
            Main.popModal(this._grab);
        this._grab = null;
        this._root?.destroy();
        this._root = null;
        this._cards = [];
    }

    destroy() {
        this.hide();
        global.stage.disconnect(this._eventId);
        global.display.disconnect(this._windowId);
        Main.sessionMode.disconnect(this._sessionId);
        Main.layoutManager.disconnect(this._monitorId);
        Main.layoutManager.removeChrome(this._bar);
        this._bar.destroy();
    }
}
