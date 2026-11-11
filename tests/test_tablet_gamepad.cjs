// On-screen gamepad: layout math, game detection and the overlay's touch
// handling (with fake GNOME Shell objects).
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const folder = process.argv[2];
const strip = file => fs.readFileSync(path.join(folder, file), 'utf8')
    .replace(/^import [\s\S]*?;$/gm, '').replace(/export /g, '');

const logic = new Function(`${strip('gamepadLogic.js')};
    return {isSteamGame, stickValue, dpadValue, gamepadLayout, faceButtonAt, encode, TRIGGERS, STICK_MAX,
        physicalGamepads, hasControllerButtons, layoutForGame, parseSavedLayouts};`)();
const {isSteamGame, stickValue, dpadValue, gamepadLayout, faceButtonAt, encode, physicalGamepads, layoutForGame,
    parseSavedLayouts} = logic;

// Steam games only.
assert.equal(isSteamGame('steam_app_1245620'), true);
assert.equal(isSteamGame('Steam_App_default'), true);
assert.equal(isSteamGame('steam'), false, 'the Steam client itself is not a game');
assert.equal(isSteamGame('org.mozilla.firefox'), false);
assert.equal(isSteamGame(null, 'steam_app_42'), true);

// Stick: dead zone, full tilt at the rim, clamped beyond it, up negative.
assert.deepEqual([stickValue(5, 0, 100).x, stickValue(5, 0, 100).y], [0, 0]);
assert.equal(stickValue(100, 0, 100).x, 32767);
assert.equal(stickValue(0, -100, 100).y, -32767, 'up is negative');
const far = stickValue(300, 0, 100);
assert.equal(far.x, 32767);assert.equal(far.knobX, 100, 'knob stops at the rim');
const half = stickValue(56, 0, 100);
assert(half.x > 10000 && half.x < 22000, 'scaled between dead zone and rim');
const diag = stickValue(100, 100, 100);
assert(Math.abs(diag.x - diag.y) <= 1 && Math.hypot(diag.x, diag.y) <= 32768);

// D-pad: 8-way.
assert.deepEqual(dpadValue(0, 0, 100), [0, 0]);
assert.deepEqual(dpadValue(80, 0, 100), [1, 0]);
assert.deepEqual(dpadValue(0, -80, 100), [0, -1]);
assert.deepEqual(dpadValue(-80, 0, 100), [-1, 0]);
assert.deepEqual(dpadValue(60, 60, 100), [1, 1]);
assert.deepEqual(dpadValue(-60, -60, 100), [-1, -1]);
assert.deepEqual(dpadValue(80, -10, 100), [1, 0], 'near-horizontal stays horizontal');

// Layouts fit the screen and don't overlap.
for (const monitor of [{x: 0, y: 0, width: 1280, height: 800}, {x: 0, y: 0, width: 800, height: 1280},
    {x: 0, y: 0, width: 1920, height: 1080}]) {
    for (const left of ['stick', 'dpad']) {
        for (const face of ['diamond', 'gamecube']) {
            const L = gamepadLayout(monitor, left, face);
            const circles = Object.entries(L.buttons).filter(([, b]) => b.kind !== 'pill');
            for (const [name, b] of circles) {
                assert(b.cx - b.radius >= 0 && b.cx + b.radius <= monitor.width, `${name} on screen`);
                assert(b.cy - b.radius >= 0 && b.cy + b.radius <= monitor.height, `${name} on screen`);
            }
            for (let i = 0; i < circles.length; i++)
                for (let j = i + 1; j < circles.length; j++) {
                    const [an, a] = circles[i], [bn, b] = circles[j];
                    assert(Math.hypot(a.cx - b.cx, a.cy - b.cy) >= a.radius + b.radius,
                        `${face}: ${an} and ${bn} don't overlap`);
                }
            const pad = L.stick ?? L.dpad;
            const padRight = pad.cx + (L.stick ? L.stick.radius : L.dpad.size);
            const faceLeft = Math.min(...circles.map(([, b]) => b.cx - b.radius));
            assert(padRight < faceLeft, 'left control and face buttons on their own sides');
            assert(L.buttons.home.y + L.buttons.home.height < monitor.height - 30,
                'Select/Home/Start clear of the bottom-edge Home swipe');
        }
    }
}
const cube = gamepadLayout({x: 0, y: 0, width: 1280, height: 800}, 'stick', 'gamecube');
assert(cube.buttons.a.radius > cube.buttons.b.radius * 1.5, 'GameCube: big A, small B');
assert(cube.buttons.b.cx < cube.buttons.a.cx && cube.buttons.b.cy > cube.buttons.a.cy, 'B down-left of A');
assert(cube.buttons.x.cx > cube.buttons.a.cx, 'X right of A');
assert(cube.buttons.y.cy < cube.buttons.a.cy, 'Y above A');
const diamond = gamepadLayout({x: 0, y: 0, width: 1280, height: 800}, 'stick', 'diamond');
assert(diamond.buttons.y.cy < diamond.buttons.a.cy && diamond.buttons.x.cx < diamond.buttons.b.cx);
assert.equal(faceButtonAt(diamond, diamond.buttons.b.cx, diamond.buttons.b.cy), 'b');
assert.equal(faceButtonAt(diamond, 0, 0), null);
assert.equal(encode([{k: ['a', true]}, {a: ['lx', -12.4]}, {h: [0, -1]}]), 'k a 1;a lx -12;h 0 -1');

// Real controllers, not virtual ones.
const proc = `I: Bus=0003 Vendor=045e Product=028e Version=0110
N: Name="Mutsu On-Screen Gamepad"
H: Handlers=event20 js0

I: Bus=0003 Vendor=28de Product=11ff Version=0001
N: Name="Steam Virtual Gamepad"
H: Handlers=event21 js1

I: Bus=0011 Vendor=0001 Product=0001 Version=ab41
N: Name="AT Translated Set 2 keyboard"
H: Handlers=sysrq kbd event3 leds

I: Bus=0019 Vendor=0000 Product=0000 Version=0000
N: Name="ST LIS3LV02DL Accelerometer"
H: Handlers=event5 js3

I: Bus=0005 Vendor=054c Product=0ce6 Version=8100
N: Name="DualSense Wireless Controller Motion Sensors"
H: Handlers=event23 js4

I: Bus=0006 Vendor=0000 Product=0000 Version=0000
N: Name="Microsoft Vmbus HID-compliant Mouse"
H: Handlers=mouse0 event4 js5
B: KEY=1f0000 0 0 0 0`;
assert.deepEqual(physicalGamepads(proc), [], 'our pad, Steam virtual pads, sensors and keyboards are not controllers');
assert.deepEqual(physicalGamepads(proc + `

I: Bus=0005 Vendor=054c Product=0ce6 Version=8100
N: Name="DualSense Wireless Controller"
H: Handlers=event22 js2
B: KEY=7fdb000000000000 0 0 0 0`), ['DualSense Wireless Controller']);
assert.equal(logic.hasControllerButtons('7fdb000000000000 0 0 0 0'), true, 'BTN_SOUTH and friends');
assert.equal(logic.hasControllerButtons('ffff00000000 0 0 0 0'), true, 'BTN_JOYSTICK range');
assert.equal(logic.hasControllerButtons('1f0000 0 0 0 0'), false, 'mouse buttons only');
// Per-game layouts.
const defaults = {left: 'stick', face: 'diamond'};
assert.deepEqual(layoutForGame({steam_app_1: {left: 'dpad', face: 'gamecube'}}, 'steam_app_1', defaults),
    {left: 'dpad', face: 'gamecube'});
assert.deepEqual(layoutForGame({steam_app_1: {left: 'dpad'}}, 'steam_app_2', defaults), defaults, 'other games: defaults');
assert.deepEqual(layoutForGame({steam_app_1: {left: 'nonsense'}}, 'steam_app_1', defaults), defaults);
assert.deepEqual(parseSavedLayouts('not json'), {});

// ---- the overlay ----------------------------------------------------------
class Emitter {
    constructor() { this.signals = new Map(); this.next = 0; }
    connect(name, fn) { this.signals.set(++this.next, [name, fn]); return this.next; }
    disconnect(id) { this.signals.delete(id); }
    emit(name, ...args) {
        let result;
        for (const [signal, fn] of [...this.signals.values()])
            if (signal === name) result = fn(this, ...args);
        return result;
    }
}
class Widget {
    constructor(props = {}) {
        Object.assign(this, {visible: true, children: [], parent: null, pseudo: new Set()}, props);
        this.clutter_text = {};
    }
    add_child(child) { child.parent = this; this.children.push(child); }
    get_parent() { return this.parent; }
    set_position(x, y) { this.x = x; this.y = y; }
    add_style_pseudo_class(name) { this.pseudo.add(name); }
    remove_style_pseudo_class(name) { this.pseudo.delete(name); }
    destroy() { this.destroyed = true; }
}
const St = {Widget, Label: Widget};
const T = {TOUCH_BEGIN: 1, TOUCH_UPDATE: 2, TOUCH_END: 3, TOUCH_CANCEL: 4, BUTTON_PRESS: 5,
    MOTION: 6, BUTTON_RELEASE: 7};
const Clutter = {EventType: T, EVENT_STOP: true, EVENT_PROPAGATE: false, ActorAlign: {CENTER: 0}};
const chrome = [];
let unredirect = 0;
const Main = {layoutManager: Object.assign(new Emitter(), {
    primaryMonitor: {x: 0, y: 0, width: 1280, height: 800},
    addChrome: actor => chrome.push(actor),
    removeChrome: actor => chrome.splice(chrome.indexOf(actor), 1),
}), panel: {height: 32}};
const focus = {cls: 'steam_app_570', get_wm_class() { return this.cls; }, get_gtk_application_id: () => null};
const display = Object.assign(new Emitter(), {focus_window: focus});
const stage = Object.assign(new Emitter(), {width: 1280, height: 800, get_event_actor: e => e.actor});
globalThis.global = {display, stage, compositor: {
    disable_unredirect() { unredirect++; }, enable_unredirect() { unredirect--; }}};
class Settings extends Emitter {
    constructor() { super(); this.values = {'gamepad-overlay': true, 'gamepad-left': 'stick', 'gamepad-face': 'diamond'}; }
    get_boolean(k) { return this.values[k]; }
    get_string(k) { return this.values[k]; }
    set_string(k, v) { this.values[k] = v; this.emit(`changed::${k}`); }
}
const sent = [];
const spawned = [];
const {TabletGamepad} = new Function('Clutter', 'Gio', 'GLib', 'St', 'Main',
    'eventActor', 'sameSequence', ...Object.keys(logic),
    `${strip('tabletGamepad.js')}; return {TabletGamepad};`)(
    Clutter, {}, {}, St, Main,
    e => globalThis.global.stage.get_event_actor(e), (a, b) => a === b, ...Object.values(logic));

const settings = new Settings();
const pads = {connected: false, onChange: null};
const pad = new TabletGamepad(settings, {pads, spawn: argv => {
    spawned.push(argv);
    return {write: line => sent.push(line.trim()), close() { this.closed = true; }};
}});
assert.equal(pad.visible, true, 'shown over a Steam game');
assert.equal(unredirect, 1, 'compositing kept on so it shows over full-screen games');
const L = pad.layout;
const event = (type, actor, x, y, seq) => ({type: () => type, actor, get_coords: () => [x, y],
    get_event_sequence: () => seq, get_button: () => 1});
const touch = (type, actor, x, y, seq) => stage.emit('captured-event', event(type, actor, x, y, seq));

// Left stick and a face button at the same time (two fingers).
const s = L.stick;
assert.equal(touch(T.TOUCH_BEGIN, pad._stickBase, s.cx, s.cy, 's1'), true, 'stick touch kept from the game');
touch(T.TOUCH_UPDATE, null, s.cx + s.radius, s.cy, 's1');
assert.equal(spawned.length, 1, 'virtual controller started on first use');
assert(sent.includes('a lx 32767;a ly 0'), 'stick right');
touch(T.TOUCH_BEGIN, pad._buttonActors.a, L.buttons.a.cx, L.buttons.a.cy, 'f1');
assert(sent.includes('k a 1'));
assert(pad._buttonActors.a.pseudo.has('active'), 'pressed button lights up');
// Slide from A to B.
touch(T.TOUCH_UPDATE, null, L.buttons.b.cx, L.buttons.b.cy, 'f1');
assert(sent.includes('k a 0;k b 1'), 'sliding across buttons');
touch(T.TOUCH_END, null, L.buttons.b.cx, L.buttons.b.cy, 'f1');
assert(sent.includes('k b 0'));
touch(T.TOUCH_END, null, s.cx + s.radius, s.cy, 's1');
assert.equal(sent.at(-1), 'a lx 0;a ly 0', 'stick recentres on release');
// Triggers are full-press analogue.
touch(T.TOUCH_BEGIN, pad._buttonActors.zr, L.buttons.zr.x + 5, L.buttons.zr.y + 5, 't1');
assert.equal(sent.at(-1), 'a zr 255');
touch(T.TOUCH_END, null, 0, 0, 't1');
assert.equal(sent.at(-1), 'a zr 0');
// A touch between the controls goes to the game.
assert.equal(touch(T.TOUCH_BEGIN, null, 640, 300, 'g1'), false);

// Swap to the D-pad and the GameCube layout.
const chips = [...pad._hits.entries()];
const chipFor = id => chips.find(([, v]) => v === id)[0];
touch(T.TOUCH_BEGIN, chipFor('toggle:left'), 0, 0, 'c1');
touch(T.TOUCH_END, null, 0, 0, 'c1');
assert.equal(JSON.parse(settings.values['gamepad-games']).steam_app_570.left, 'dpad', 'remembered for this game');
assert.equal(settings.values['gamepad-left'], 'stick', 'defaults for other games unchanged');
assert(pad.layout.dpad && !pad.layout.stick, 'D-pad instead of the circle pad');
const d = pad.layout.dpad;
const dpadActor = [...pad._hits.entries()].find(([, v]) => v === 'dpad')[0];
touch(T.TOUCH_BEGIN, dpadActor, d.cx, d.cy - d.size, 'd1');
assert.equal(sent.at(-1), 'h 0 -1', 'D-pad up');
assert(pad._dpadArms.up.pseudo.has('active'));
touch(T.TOUCH_UPDATE, null, d.cx + d.size, d.cy - d.size, 'd1');
assert.equal(sent.at(-1), 'h 1 -1', 'diagonal');
touch(T.TOUCH_END, null, 0, 0, 'd1');
assert.equal(sent.at(-1), 'h 0 0');
touch(T.TOUCH_BEGIN, [...pad._hits.entries()].find(([, v]) => v === 'toggle:face')[0], 0, 0, 'c2');
touch(T.TOUCH_END, null, 0, 0, 'c2');
assert.equal(JSON.parse(settings.values['gamepad-games']).steam_app_570.face, 'gamecube');
assert(pad.layout.buttons.a.radius > pad.layout.buttons.b.radius * 1.5);
// Another game: its own layout (the defaults); back to the first: its saved one.
focus.cls = 'steam_app_42';
display.emit('notify::focus-window');
assert(pad.layout.stick && pad.layout.face === 'diamond', 'another game starts from the defaults');
focus.cls = 'steam_app_570';
display.emit('notify::focus-window');
assert(pad.layout.dpad && pad.layout.face === 'gamecube', 'the first game keeps its layout');
// A real controller plugged in: the overlay steps aside, Show controls stays.
pads.connected = true; pads.onChange(true);
assert.equal(pad._buttonActors.a.visible, false, 'hidden while a real controller is connected');
assert.equal(pad._showChip.visible, true);
touch(T.TOUCH_BEGIN, pad._showChip, 0, 0, 'p1');
touch(T.TOUCH_END, null, 0, 0, 'p1');
assert.equal(pad._buttonActors.a.visible, true, 'Show controls brings it back anyway');
pads.connected = false; pads.onChange(false);
assert.equal(pad._buttonActors.a.visible, true, 'unplugged: shown');

// Hide / show.
touch(T.TOUCH_BEGIN, [...pad._hits.entries()].find(([, v]) => v === 'toggle:hide')[0], 0, 0, 'h1');
touch(T.TOUCH_END, null, 0, 0, 'h1');
assert.equal(pad._buttonActors.a.visible, false, 'hidden');
assert.equal(pad._showChip.visible, true, 'a Show controls chip remains');
touch(T.TOUCH_BEGIN, pad._showChip, 0, 0, 'h2');
touch(T.TOUCH_END, null, 0, 0, 'h2');
assert.equal(pad._buttonActors.a.visible, true);

// Held buttons are released when the game loses focus.
touch(T.TOUCH_BEGIN, pad._buttonActors.x, pad.layout.buttons.x.cx, pad.layout.buttons.x.cy, 'f2');
focus.cls = 'org.gnome.Nautilus';
display.emit('notify::focus-window');
assert.equal(sent.at(-1), 'k x 0', 'released when leaving the game');
assert.equal(pad.visible, false, 'not over other apps');
assert.equal(unredirect, 0);
focus.cls = 'steam_app_570';
display.emit('notify::focus-window');
assert.equal(pad.visible, true);
// Off in settings: never shown.
settings.values['gamepad-overlay'] = false;
settings.emit('changed::gamepad-overlay');
assert.equal(pad.visible, false);
pad.destroy();
assert.equal(chrome.length, 0, 'overlay removed');
assert.equal(unredirect, 0);
console.log('On-screen gamepad checks passed (real-controller hide, per-game layouts, game detection, stick, D-pad, ABXY + slide, triggers, GameCube, hide, focus).');
