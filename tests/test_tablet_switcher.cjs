const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2], 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export class TabletSwitcher', 'class TabletSwitcher');
const types = ['TOUCH_BEGIN','TOUCH_UPDATE','TOUCH_END','TOUCH_CANCEL','BUTTON_PRESS','BUTTON_RELEASE','MOTION','KEY_PRESS'];
const Clutter = {EventType: Object.fromEntries(types.map(x => [x, x])),
    EVENT_STOP: 1, EVENT_PROPAGATE: 0, AnimationMode: {EASE_OUT_QUAD: 1}};
const Main = {sessionMode: {isLocked: false}, modalCount: 0,
    layoutManager: {keyboardBox: {visible: true}}, // stays visible after startup on real GNOME
    keyboard: {visible: false, connect: () => 1, disconnect() {}}, overview: {visible: false}};
const monitor = {x: 0, y: 0, width: 1024, height: 768};
const timers = [];
const GLib = {PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false,
    timeout_add: (_p, _ms, fn) => { timers.push(fn); return timers.length; }, source_remove() {}};
const focus = {fullscreen: false, is_fullscreen() { return this.fullscreen; }};
const globalMock = {display: {focus_window: focus}};
const geometry = fs.readFileSync(path.join(path.dirname(process.argv[2]), 'tabletGeometry.js'), 'utf8')
    .replace(/export /g, '');
const {navigationAction, sameSequence} = new Function(`${geometry}; return {navigationAction, sameSequence};`)();
const Switcher = new Function('Clutter','Main','GLib','global','navigationAction','sameSequence',
    `${source}; return TabletSwitcher;`)(Clutter, Main, GLib, globalMock, navigationAction, sameSequence);
const state = Object.create(Switcher.prototype);
let homes = 0, shows = 0, docks = 0;
const switches = [];
const barClasses = new Set();
Object.assign(state, {_drag: null, _suppressed: () => false, _gesturesEnabled: () => true,
    _monitor: () => monitor, _home: () => homes++, show: () => shows++,
    _blades: {visible: false}, _dock: {show: () => docks++},
    _bar: {add_style_class_name: c => barClasses.add(c), remove_style_class_name: c => barClasses.delete(c)},
    _quickSwitch: direction => switches.push(direction),
    _startPreview() {}, _updatePreview() {}, _resetPreview() {}, _finishPreview() {},
    _shrinkIntoHome() {}});
function send(type, x, y, time, sequence = 1) {
    return state._event({type: () => type, get_coords: () => [x, y], get_time: () => time,
        get_event_sequence: () => ({get_slot: () => sequence}), // new wrapper per event, like GJS
        get_button: () => 1});
}
state._gesturesEnabled = () => false;
assert.equal(send('TOUCH_BEGIN',500,760,0),0, 'edge interception requires opt-in');
assert.equal(state._drag,null);
state._gesturesEnabled = () => true;
send('TOUCH_BEGIN',500,760,0);
send('TOUCH_UPDATE',500,630,100);
send('TOUCH_END',500,620,150);
assert.equal(homes,1, 'quick swipe returns Home');
send('TOUCH_BEGIN',500,760,1000);
send('TOUCH_UPDATE',500,620,1150);
send('TOUCH_END',500,620,1450);
assert.equal(shows,1, 'swipe and pause opens multitasking blades');
send('TOUCH_BEGIN',500,760,2000);
send('TOUCH_CANCEL',500,600,2100);
assert.equal(state._drag,null);
assert.equal(homes,1, 'cancel must not navigate');
send('TOUCH_BEGIN',500,760,3000);
assert.equal(send('TOUCH_END',500,620,3100,2),0, 'ignore another finger');
send('TOUCH_CANCEL',500,620,3200);
send('TOUCH_BEGIN',500,760,3300);
send('TOUCH_END',500,710,3400);
assert.equal(docks,1, 'short pull reveals dock');
assert.equal(homes,1, 'dock pull does not go Home');
send('TOUCH_BEGIN',500,760,3500);
send('TOUCH_END',380,750,3600);
send('TOUCH_BEGIN',500,760,3700);
send('TOUCH_END',620,750,3800);
assert.deepEqual(switches,[1,-1], 'side swipes switch in each direction');
assert.equal(send('TOUCH_BEGIN',500,400,3900),0, 'away from the edge is left to apps');
state._blades.visible = true;
assert.equal(send('TOUCH_BEGIN',500,760,3950),0, 'blades handle their own touches');
state._blades.visible = false;
Main.modalCount = 1;
assert.equal(send('TOUCH_BEGIN',500,760,3960),0, 'no navigation over a modal dialog');
Main.modalCount = 0;
// Full-screen games: first swipe stays in the game and arms the indicator.
focus.fullscreen = true;
assert.equal(send('TOUCH_BEGIN',500,760,4000),0, 'first swipe goes to the game');
assert(barClasses.has('mutsu-home-bar-armed'));
send('TOUCH_END',500,620,4100);
assert.equal(homes,1);
assert.equal(send('TOUCH_BEGIN',500,760,4500),1, 'second swipe navigates');
send('TOUCH_UPDATE',500,630,4550);
send('TOUCH_END',500,620,4600);
assert.equal(homes,2);
assert(!barClasses.has('mutsu-home-bar-armed'));
timers.forEach(fn => fn());
focus.fullscreen = false;
Main.sessionMode.isLocked = true;
assert.equal(send('TOUCH_BEGIN',500,760,6000),0);
console.log('Tablet gesture checks passed (Home, hold, cancellation, multi-touch, dock, sideways, modal, games, lock).');
