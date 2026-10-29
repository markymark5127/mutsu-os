const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2], 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export class TabletSwitcher', 'class TabletSwitcher');
const types = ['TOUCH_BEGIN','TOUCH_UPDATE','TOUCH_END','TOUCH_CANCEL','BUTTON_PRESS','BUTTON_RELEASE','MOTION','KEY_PRESS'];
const Clutter = {EventType: Object.fromEntries(types.map(x => [x, x])),
    EVENT_STOP: 1, EVENT_PROPAGATE: 0, AnimationMode: {EASE_OUT_QUAD: 1}};
const Main = {sessionMode: {isLocked: false}, layoutManager: {
    primaryMonitor: {x: 0, y: 0, width: 1024, height: 768}}};
const Switcher = new Function('Clutter','Main', `${source}; return TabletSwitcher;`)(Clutter, Main);
const state = Object.create(Switcher.prototype);
let homes = 0, shows = 0, dismissals = 0;
Object.assign(state, {_root: null, _drag: null, _suppressed: () => false,
    _home: () => homes++, show: () => shows++, _dismiss: () => dismissals++});
function event(type, x, y, time, sequence = 1, target = null) {
    return {type: () => type, get_coords: () => [x,y], get_time: () => time,
        get_event_sequence: () => sequence, get_source: () => target};
}
function send(type, x, y, time, sequence = 1, target = null) {
    return state._event(event(type,x,y,time,sequence,target));
}
send('TOUCH_BEGIN',500,760,0);
send('TOUCH_UPDATE',500,630,100);
send('TOUCH_END',500,620,150);
assert.equal(homes,1, 'quick swipe returns Home');
send('TOUCH_BEGIN',500,760,1000);
send('TOUCH_UPDATE',500,620,1150);
send('TOUCH_END',500,620,1450);
assert.equal(shows,1, 'swipe and pause opens multitasking');
send('TOUCH_BEGIN',500,760,2000);
send('TOUCH_CANCEL',500,600,2100);
assert.equal(state._drag,null);
assert.equal(homes,1, 'cancel must not navigate');
send('TOUCH_BEGIN',500,760,3000);
assert.equal(send('TOUCH_END',500,620,3100,2),0, 'ignore another finger');
send('TOUCH_CANCEL',500,620,3200);
state._root = {};
const card = {actor: {contains: s => s === 'card', ease() {}}};
state._cards = [card];
send('TOUCH_BEGIN',100,400,4000,1,'card');
send('TOUCH_END',110,280,4200,1,'card');
assert.equal(dismissals,1, 'upward card swipe closes');
send('TOUCH_BEGIN',100,400,5000,1,'card');
send('TOUCH_END',300,290,5200,1,'card');
assert.equal(dismissals,1, 'horizontal browsing must not close');
Main.sessionMode.isLocked = true;
assert.equal(send('TOUCH_BEGIN',500,760,6000),0);
console.log('Tablet gesture checks passed (Home, hold, cancellation, multi-touch, dismissal, horizontal motion, lock).');
