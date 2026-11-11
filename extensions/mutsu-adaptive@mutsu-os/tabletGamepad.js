// On-screen gamepad for tablet mode.
//
// When a game Steam launched is the focused window in tablet mode, a
// translucent controller appears over it: a circle pad (or a D-pad) on the
// left, A/B/X/Y on the right (Xbox diamond or GameCube layout), shoulders
// and triggers near the top corners, Select / Home / Start at the bottom.
// Small chips swap the left control and the face layout, and hide it all.
//
// Touches drive a real virtual Xbox 360 controller created by the
// mutsu-virtual-gamepad helper (uinput), so games and Steam Input see an
// ordinary pad. Every finger is tracked on its own, so the stick and the
// buttons work at the same time; touches that land between the controls
// still reach the game.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {eventActor} from './touchRouter.js';
import {sameSequence} from './tabletGeometry.js';
import {isSteamGame, stickValue, dpadValue, gamepadLayout, faceButtonAt, encode,
    TRIGGERS, physicalGamepads, layoutForGame, parseSavedLayouts} from './gamepadLogic.js';

export const HELPER = '/usr/libexec/mutsu-os/mutsu-virtual-gamepad';

const LABELS = {a: 'A', b: 'B', x: 'X', y: 'Y', l: 'L', r: 'R', zl: 'ZL', zr: 'ZR',
    select: '⧉', home: '⌂', start: '☰'};

export class TabletGamepad {
    constructor(settings, {spawn = null, pads = null} = {}) {
        this._settings = settings;
        // A real controller plugged in: the overlay steps aside (a Show
        // controls chip stays) until it's unplugged or you ask for it.
        this._pads = pads ?? new PadWatcher();
        this._padsConnected = this._pads.connected;
        this._showDespitePad = false;
        this._pads.onChange = connected => {
            this._padsConnected = connected;
            this._showDespitePad = false;
            this._sync();
        };
        this._spawn = spawn ?? (argv => this._spawnHelper(argv));
        this._helper = null;
        this._root = null;
        this._touches = []; // {sequence, control, ...}
        this._hidden = false;
        this._unredirectOff = false;
        this._signals = [];
        this._connect(global.display, 'notify::focus-window', () => this._sync());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._rebuild());
        for (const key of ['gamepad-overlay', 'gamepad-left', 'gamepad-face', 'gamepad-games'])
            this._connect(settings, `changed::${key}`, () => this._rebuild());
        this._connect(global.stage, 'captured-event', (_stage, event) => this._event(event));
        this._sync();
    }

    _connect(object, signal, fn) {
        this._signals.push([object, object.connect(signal, fn)]);
    }

    get visible() { return !!this._root?.visible; }
    get layout() { return this._layout; }

    _wanted() {
        if (!this._settings.get_boolean('gamepad-overlay'))
            return false;
        return !!this._currentGame();
    }

    // The focused game's window class (the key its layout is saved under).
    _currentGame() {
        const window = global.display.focus_window;
        if (!window)
            return null;
        const cls = window.get_wm_class?.() ?? '';
        const appId = window.get_gtk_application_id?.() ?? '';
        if (!isSteamGame(cls, appId))
            return null;
        return String(isSteamGame(cls) ? cls : appId).toLowerCase();
    }

    _layoutChoice(game = this._currentGame()) {
        const defaults = {
            left: this._settings.get_string('gamepad-left') === 'dpad' ? 'dpad' : 'stick',
            face: this._settings.get_string('gamepad-face') === 'gamecube' ? 'gamecube' : 'diamond',
        };
        let saved = {};
        try {
            saved = parseSavedLayouts(this._settings.get_string('gamepad-games'));
        } catch (e) {}
        return layoutForGame(saved, game, defaults);
    }

    get autoHidden() { return this._padsConnected && !this._showDespitePad; }

    _sync() {
        const wanted = this._wanted();
        // Another game came forward with a different saved layout.
        if (wanted && this._root && this._layout) {
            const choice = this._layoutChoice();
            if (choice.left !== this._layout.left || choice.face !== this._layout.face)
                this._destroyActors();
        }
        if (wanted && !this._root)
            this._build();
        if (!this._root)
            return;
        const show = wanted && !this._hidden && !this.autoHidden;
        if (!show)
            this._releaseAll();
        this._root.visible = wanted;
        for (const actor of this._controls ?? [])
            actor.visible = show;
        this._showChip.visible = wanted && !show;
        this._setUnredirect(wanted);
    }

    // Full-screen games can bypass the compositor; keep compositing on while
    // the overlay is up so it stays visible over them.
    _setUnredirect(overlayUp) {
        if (overlayUp && !this._unredirectOff) {
            global.compositor?.disable_unredirect?.();
            this._unredirectOff = true;
        } else if (!overlayUp && this._unredirectOff) {
            global.compositor?.enable_unredirect?.();
            this._unredirectOff = false;
        }
    }

    _rebuild() {
        this._destroyActors();
        this._sync();
    }

    _build() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const {left, face} = this._layoutChoice();
        const topInset = Main.panel?.height ?? 32;
        this._layout = gamepadLayout(monitor, left, face, topInset);
        const L = this._layout;
        // The root isn't reactive: only the controls catch touches, the rest
        // of the screen still belongs to the game.
        this._root = new St.Widget({style_class: 'mutsu-gamepad', reactive: false,
            x: 0, y: 0, width: global.stage.width, height: global.stage.height});
        Main.layoutManager.addChrome(this._root, {affectsStruts: false});
        this._controls = [];
        this._hits = new Map(); // actor -> control id

        const add = (actor, id) => {
            this._root.add_child(actor);
            this._controls.push(actor);
            if (id)
                this._hits.set(actor, id);
            return actor;
        };

        if (L.stick) {
            const s = L.stick;
            this._stickBase = add(new St.Widget({style_class: 'mutsu-gamepad-stick', reactive: true,
                x: s.cx - s.radius, y: s.cy - s.radius, width: s.radius * 2, height: s.radius * 2,
                style: `border-radius: ${s.radius}px;`}), 'stick');
            this._knob = new St.Widget({style_class: 'mutsu-gamepad-knob', reactive: false,
                width: s.knob * 2, height: s.knob * 2, style: `border-radius: ${s.knob}px;`});
            this._stickBase.add_child(this._knob);
            this._centreKnob();
        } else {
            const d = L.dpad;
            const box = add(new St.Widget({style_class: 'mutsu-gamepad-dpad', reactive: true,
                x: d.cx - d.size, y: d.cy - d.size, width: d.size * 2, height: d.size * 2}), 'dpad');
            const arm = Math.round(d.size * 0.66);
            this._dpadArms = {};
            for (const [name, ax, ay, glyph] of [['up', 1, 0, '▲'], ['down', 1, 2, '▼'],
                ['left', 0, 1, '◀'], ['right', 2, 1, '▶']]) {
                const cell = new St.Label({style_class: 'mutsu-gamepad-dpad-arm', text: glyph,
                    x: Math.round(d.size - arm * 1.5 + ax * arm), y: Math.round(d.size - arm * 1.5 + ay * arm),
                    width: arm, height: arm, y_align: Clutter.ActorAlign.CENTER});
                cell.clutter_text.x_align = Clutter.ActorAlign.CENTER;
                box.add_child(cell);
                this._dpadArms[name] = cell;
            }
        }

        this._buttonActors = {};
        for (const [name, b] of Object.entries(L.buttons)) {
            const pill = b.kind === 'pill';
            const actor = add(new St.Label({
                style_class: `mutsu-gamepad-button mutsu-gamepad-${name}${pill ? ' mutsu-gamepad-pill' : ''}` +
                    (face === 'gamecube' && !pill ? ' mutsu-gamepad-cube' : ''),
                text: LABELS[name] ?? name, reactive: true, y_align: Clutter.ActorAlign.CENTER,
                ...(pill ? {x: b.x, y: b.y, width: b.width, height: b.height}
                    : {x: b.cx - b.radius, y: b.cy - b.radius, width: b.radius * 2, height: b.radius * 2,
                        style: `border-radius: ${b.radius}px; font-size: ${Math.round(b.radius * 0.8)}px;`}),
            }), `button:${name}`);
            actor.clutter_text.x_align = Clutter.ActorAlign.CENTER;
            this._buttonActors[name] = actor;
        }

        const chip = (box, text, id) => {
            const actor = new St.Label({style_class: 'mutsu-gamepad-chip', text, reactive: true,
                x: box.x, y: box.y, width: box.width, height: box.height,
                y_align: Clutter.ActorAlign.CENTER});
            actor.clutter_text.x_align = Clutter.ActorAlign.CENTER;
            return add(actor, id);
        };
        chip(L.toggles.left, left === 'dpad' ? 'Use circle pad' : 'Use D-pad', 'toggle:left');
        chip(L.toggles.face, face === 'gamecube' ? 'Diamond layout' : 'GameCube layout', 'toggle:face');
        chip(L.toggles.hide, 'Hide controls', 'toggle:hide');
        // Shown instead of everything else while hidden.
        this._showChip = new St.Label({style_class: 'mutsu-gamepad-chip', text: 'Show controls',
            reactive: true, x: L.toggles.hide.x, y: L.toggles.hide.y,
            width: L.toggles.hide.width, height: L.toggles.hide.height,
            y_align: Clutter.ActorAlign.CENTER});
        this._showChip.clutter_text.x_align = Clutter.ActorAlign.CENTER;
        this._root.add_child(this._showChip);
        this._hits.set(this._showChip, 'toggle:show');
    }

    _centreKnob() {
        const s = this._layout.stick;
        this._knob.set_position(s.radius - s.knob, s.radius - s.knob);
    }

    // ---- input ----------------------------------------------------------

    _controlFor(source) {
        for (let actor = source; actor && actor !== this._root; actor = actor.get_parent?.()) {
            const id = this._hits?.get(actor);
            if (id && actor.visible)
                return id;
        }
        return null;
    }

    _event(event) {
        if (!this._root?.visible)
            return Clutter.EVENT_PROPAGATE;
        const type = event.type();
        const T = Clutter.EventType;
        const isBegin = type === T.TOUCH_BEGIN || (type === T.BUTTON_PRESS && event.get_button?.() === 1);
        const isUpdate = type === T.TOUCH_UPDATE || type === T.MOTION;
        const isEnd = type === T.TOUCH_END || type === T.TOUCH_CANCEL || type === T.BUTTON_RELEASE;
        if (!isBegin && !isUpdate && !isEnd)
            return Clutter.EVENT_PROPAGATE;
        const sequence = event.get_event_sequence?.() ?? 'pointer';
        const [x, y] = event.get_coords();
        if (isBegin) {
            const control = this._controlFor(eventActor(event));
            if (!control)
                return Clutter.EVENT_PROPAGATE;
            const touch = {sequence, control, face: null, hat: [0, 0]};
            this._touches.push(touch);
            this._press(touch, x, y);
            return Clutter.EVENT_STOP;
        }
        const touch = this._touches.find(t => t.sequence === sequence ||
            (t.sequence !== 'pointer' && sequence !== 'pointer' && sameSequence(t.sequence, sequence)));
        if (!touch)
            return Clutter.EVENT_PROPAGATE;
        if (isUpdate)
            this._move(touch, x, y);
        else {
            this._release(touch);
            this._touches = this._touches.filter(t => t !== touch);
        }
        return Clutter.EVENT_STOP;
    }

    _press(touch, x, y) {
        const [kind, name] = touch.control.split(':');
        if (kind === 'toggle') {
            touch.tap = true;
            return;
        }
        if (kind === 'stick' || kind === 'dpad') {
            this._move(touch, x, y);
            return;
        }
        if (['a', 'b', 'x', 'y'].includes(name)) {
            touch.face = name;
            this._send([{k: [name, 1]}]);
            this._lit(name, true);
            return;
        }
        this._send([TRIGGERS.has(name) ? {a: [name, 255]} : {k: [name, 1]}]);
        this._lit(name, true);
    }

    _move(touch, x, y) {
        const L = this._layout;
        if (touch.control === 'stick') {
            const s = L.stick;
            const v = stickValue(x - s.cx, y - s.cy, s.radius);
            this._knob.set_position(Math.round(s.radius - s.knob + v.knobX),
                Math.round(s.radius - s.knob + v.knobY));
            if (v.x !== touch.lx || v.y !== touch.ly) {
                touch.lx = v.x;
                touch.ly = v.y;
                this._send([{a: ['lx', v.x]}, {a: ['ly', v.y]}]);
            }
        } else if (touch.control === 'dpad') {
            const d = L.dpad;
            const hat = dpadValue(x - d.cx, y - d.cy, d.size);
            if (hat[0] !== touch.hat[0] || hat[1] !== touch.hat[1]) {
                touch.hat = hat;
                this._send([{h: hat}]);
                this._litDpad(hat);
            }
        } else if (touch.face) {
            // Slide between face buttons, like rolling a thumb across them.
            const over = faceButtonAt(L, x, y);
            if (over && over !== touch.face) {
                this._send([{k: [touch.face, 0]}, {k: [over, 1]}]);
                this._lit(touch.face, false);
                this._lit(over, true);
                touch.face = over;
            }
        }
    }

    _release(touch) {
        const [kind, name] = touch.control.split(':');
        if (kind === 'toggle') {
            if (touch.tap)
                this._toggle(name);
            return;
        }
        if (kind === 'stick') {
            this._centreKnob();
            this._send([{a: ['lx', 0]}, {a: ['ly', 0]}]);
            return;
        }
        if (kind === 'dpad') {
            this._send([{h: [0, 0]}]);
            this._litDpad([0, 0]);
            return;
        }
        const button = touch.face ?? name;
        this._send([TRIGGERS.has(button) ? {a: [button, 0]} : {k: [button, 0]}]);
        this._lit(button, false);
    }

    _toggle(name) {
        if (name === 'left' || name === 'face') {
            // Remembered for this game; other games keep their own (or the
            // defaults from settings).
            const game = this._currentGame();
            const next = {left: this._layout.left, face: this._layout.face};
            if (name === 'left')
                next.left = next.left === 'dpad' ? 'stick' : 'dpad';
            else
                next.face = next.face === 'gamecube' ? 'diamond' : 'gamecube';
            if (!game) {
                this._settings.set_string(name === 'left' ? 'gamepad-left' : 'gamepad-face',
                    name === 'left' ? next.left : next.face);
                return;
            }
            const saved = parseSavedLayouts(this._settings.get_string('gamepad-games'));
            saved[game] = next;
            this._settings.set_string('gamepad-games', JSON.stringify(saved));
        } else if (name === 'hide') {
            this._hidden = true;
            this._sync();
        } else if (name === 'show') {
            this._hidden = false;
            if (this._padsConnected)
                this._showDespitePad = true;
            this._sync();
        }
    }

    _lit(name, on) {
        const actor = this._buttonActors?.[name];
        if (!actor)
            return;
        if (on)
            actor.add_style_pseudo_class('active');
        else
            actor.remove_style_pseudo_class('active');
    }

    _litDpad([hx, hy]) {
        const lit = {up: hy < 0, down: hy > 0, left: hx < 0, right: hx > 0};
        for (const [name, cell] of Object.entries(this._dpadArms ?? {})) {
            if (lit[name])
                cell.add_style_pseudo_class('active');
            else
                cell.remove_style_pseudo_class('active');
        }
    }

    _releaseAll() {
        const touches = this._touches;
        this._touches = [];
        for (const touch of touches) {
            if (!touch.control.startsWith('toggle:'))
                this._release(touch);
        }
    }

    // ---- the virtual controller -------------------------------------------

    _send(commands) {
        const line = encode(commands);
        if (!line)
            return;
        if (!this._helper)
            this._helper = this._spawn([HELPER]);
        this._helper?.write(`${line}\n`);
    }

    _spawnHelper(argv) {
        try {
            const process = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_SILENCE);
            const stdin = process.get_stdin_pipe();
            const helper = {
                process,
                write: text => {
                    try {
                        stdin.write_all(new TextEncoder().encode(text), null);
                    } catch (e) {
                        // The helper is gone (no uinput access, crashed): stop
                        // trying until the overlay is rebuilt.
                        console.error(`Mutsu gamepad: ${e.message}`);
                        this._helper = {write: () => {}, close: () => {}};
                    }
                },
                close: () => {
                    try { stdin.close(null); } catch (e) {}
                },
            };
            process.wait_async(null, (proc, result) => {
                try {
                    proc.wait_finish(result);
                    if (!proc.get_successful())
                        console.error('Mutsu gamepad: the virtual controller could not be created');
                } catch (e) {}
                if (this._helper === helper)
                    this._helper = null;
            });
            return helper;
        } catch (e) {
            console.error(`Mutsu gamepad: can't start ${argv[0]}: ${e.message}`);
            return {write: () => {}, close: () => {}};
        }
    }

    // ---- teardown -----------------------------------------------------------

    _destroyActors() {
        this._releaseAll();
        if (this._root) {
            Main.layoutManager.removeChrome(this._root);
            this._root.destroy();
        }
        this._root = null;
        this._controls = [];
        this._hits = new Map();
        this._buttonActors = {};
        this._dpadArms = {};
        this._stickBase = this._knob = this._showChip = null;
    }

    destroy() {
        this._pads.onChange = null;
        this._pads.destroy?.();
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        this._destroyActors();
        this._setUnredirect(false);
        this._helper?.close();
        this._helper = null;
    }
}

// Watches for real game controllers: /dev/input changes trigger a re-read of
// /proc/bus/input/devices (async, small).
class PadWatcher {
    constructor() {
        this.connected = false;
        this.onChange = null;
        this._monitor = null;
        this._timer = 0;
        try {
            this._monitor = Gio.File.new_for_path('/dev/input').monitor_directory(
                Gio.FileMonitorFlags.NONE, null);
            this._monitor.connect('changed', () => this._queue());
        } catch (e) {
            this._monitor = null;
        }
        this._read(true);
    }

    _queue() {
        if (this._timer)
            return;
        // Devices appear in bursts (event + js nodes); settle first.
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            this._timer = 0;
            this._read(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    _read(initial) {
        const file = Gio.File.new_for_path('/proc/bus/input/devices');
        const apply = text => {
            const connected = physicalGamepads(text).length > 0;
            if (connected === this.connected)
                return;
            this.connected = connected;
            if (!initial)
                this.onChange?.(connected);
        };
        if (initial) {
            try {
                const [, bytes] = file.load_contents(null);
                apply(new TextDecoder().decode(bytes));
            } catch (e) {}
            return;
        }
        file.load_contents_async(null, (f, result) => {
            try {
                const [, bytes] = f.load_contents_finish(result);
                apply(new TextDecoder().decode(bytes));
            } catch (e) {}
        });
    }

    destroy() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        this._monitor?.cancel();
        this._monitor = null;
    }
}
