// Desktop <-> tablet switch animation: geometry and lifecycle with fakes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const folder = process.argv[2];
const source = fs.readFileSync(path.join(folder, 'modeTransition.js'), 'utf8')
    .replace(/^import [\s\S]*?;$/gm, '').replace(/export /g, '');

class Actor {
    constructor(props = {}) { Object.assign(this, {scale_x: 1, scale_y: 1, opacity: 255, children: []}, props);
        this.clutter_text = {}; }
    set_pivot_point(x, y) { this.pivot = [x, y]; }
    add_child(c) { this.children.push(c); }
    ease(params) { this.eased = params; Object.assign(this, Object.fromEntries(
        Object.entries(params).filter(([k]) => !['duration', 'mode', 'onStopped'].includes(k))));
        params.onStopped?.(); }
    remove_all_transitions() {}
    remove_transition() {}
    destroy() { this.destroyed = true; }
}
const ui = new Actor();
const idles = [], timeouts = [];
const GLib = {PRIORITY_LOW: 300, PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false,
    idle_add: (p, fn) => { idles.push(fn); return idles.length; },
    timeout_add: (p, ms, fn) => { timeouts.push(fn); return 100 + timeouts.length; },
    source_remove() {}};
let animations = true;
const St = {Widget: Actor, Label: Actor, Settings: {get: () => ({enable_animations: animations})}};
const Clutter = {AnimationMode: {}, ActorAlign: {CENTER: 0}};
const monitorsHandlers = [];
const Main = {layoutManager: {primaryMonitor: {x: 0, y: 0, width: 1280, height: 800}, uiGroup: ui,
    connect: (s, fn) => { monitorsHandlers.push(fn); return 1; }, disconnect() {}},
    sessionMode: {isLocked: false}};
const group = new Actor();
globalThis.global = {window_group: group};
const M = new Function('Clutter', 'GLib', 'St', 'Main',
    `${source}; return {ModeTransition, wavePlan, hingeAngles, HINGE_OPEN, HINGE_TABLET};`)(Clutter, GLib, St, Main);

// The wave starts at the hinge edge and grows big enough to cover the screen.
const mon = {x: 0, y: 0, width: 1280, height: 800};
const up = M.wavePlan(mon, true), down = M.wavePlan(mon, false);
assert.equal(up.cy, 800, 'into tablet: rises from the bottom');
assert.equal(down.cy, 0, 'back to desktop: falls from the top');
for (const corner of [[0, 0], [1280, 0], [0, 800], [1280, 800]])
    assert(Math.hypot(corner[0] - up.cx, corner[1] - up.cy) <= up.radius, 'covers every corner');
assert.deepEqual(M.hingeAngles(true), [M.HINGE_OPEN, M.HINGE_TABLET], 'folds back into tablet');
assert.deepEqual(M.hingeAngles(false), [M.HINGE_TABLET, M.HINGE_OPEN], 'swings open into a laptop');
assert(M.HINGE_TABLET < M.HINGE_OPEN - 180, 'folds all the way round');

const t = new M.ModeTransition();
assert.equal(t.play(true), true);
assert.equal(ui.children.length, 0, "waits until just after the switch");
timeouts.shift()();
const [wave, hud] = ui.children;
assert.equal(wave.style.includes('164, 201, 178'), true, 'sage wave into tablet');
assert.equal(wave.eased.opacity, 0, 'the wave fades as it spreads');
assert.equal(wave.destroyed, true, 'wave removed when done');
assert.equal(group.eased.scale_x, 1, 'apps spring back to full size');
assert.equal(group.scale_x, 1);
const screen = hud.children[1];
assert.equal(screen.rotation_angle_z, M.HINGE_TABLET, 'hinge folded into tablet');
assert.equal(hud.children[2].text, 'Tablet');
timeouts.shift()();
assert.equal(hud.destroyed, true, 'label fades away');
// Back to the desktop.
t.play(false);
timeouts.shift()();
assert(ui.children.at(-2).style.includes('222, 205, 176'), 'sand wave back to the desktop');
assert.equal(ui.children.at(-1).children[2].text, 'Desktop');
// Off when GNOME's animations are off, or locked.
animations = false;
assert.equal(t.play(true), false);
animations = true;
Main.sessionMode.isLocked = true;
assert.equal(t.play(true), false);
Main.sessionMode.isLocked = false;
t.destroy();
console.log('Mode switch animation checks passed (wave from the hinge, spring, folding hinge, label, off when animations off).');
