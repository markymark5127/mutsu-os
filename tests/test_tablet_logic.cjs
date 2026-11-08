// Pure tablet-mode logic: Home grid, gestures, layout model, posture and
// the crash-safe settings journal. Usage:
//   node tests/test_tablet_logic.cjs extensions/mutsu-adaptive@mutsu-os
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const folder = process.argv[2];
const load = (file, names, deps = {}) => {
    const source = fs.readFileSync(path.join(folder, file), 'utf8')
        .replace(/^import [\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
    return new Function(...Object.keys(deps), `${source}; return {${names.join(',')}};`)(
        ...Object.values(deps));
};
const g = load('tabletGeometry.js', ['sameSequence', 'planTabletEntry', 'planTabletExit', 'homeMetrics', 'slotAt', 'pageSnap', 'classifyDrag',
    'pullDownAllowed', 'bladeTransform', 'groupWindows', 'hingeTablet', 'hingeFromAccels', 'resolveTablet',
    'isWindowMaximized']);

// Home grid fits every common 2-in-1 screen, both orientations.
for (const [w, h] of [[1280, 800], [800, 1280], [1920, 1200], [1200, 1920], [1366, 768],
    [768, 1366], [1024, 768], [2560, 1600]]) {
    const m = g.homeMetrics(w, h);
    assert(m.cols >= 4 && m.cols <= 8 && m.rows >= 3 && m.rows <= 6, `${w}x${h} grid`);
    assert(m.gridX + m.gridW <= w, 'grid inside screen');
    assert(m.gridY + m.gridH <= m.dockY, `${w}x${h} grid clears dock`);
    assert(m.cellW >= m.icon && m.cellH >= m.icon, 'icon fits cell');
    assert.equal(m.portrait, h > w);
}
assert(g.homeMetrics(800, 1280).cols < g.homeMetrics(1280, 800).cols, 'portrait narrows grid');
const m = g.homeMetrics(1280, 800);
const centre = {x: m.gridX + m.cellW * 1.5, y: m.gridY + m.cellH + m.icon / 2 + 8};
assert.deepEqual(g.slotAt(centre.x, centre.y, m), {index: m.cols + 1, col: 1, row: 1, onto: true});
assert.equal(g.slotAt(m.gridX + m.cellW * 2 - 2, centre.y, m).onto, false, 'cell edge reorders');
assert.equal(g.slotAt(-50, 5000, m).index, (m.rows - 1) * m.cols, 'clamped to grid');

assert.equal(g.pageSnap(0, -400, 0.1, 1280, 3), 1, 'long drag flips page');
assert.equal(g.pageSnap(1, 80, 0.8, 1280, 3), 0, 'flick flips page');
assert.equal(g.pageSnap(1, 60, 0.1, 1280, 3), 1, 'short slow drag springs back');
assert.equal(g.pageSnap(2, -900, 1, 1280, 3), 2, 'never past last page');
assert.equal(g.pageSnap(0, 900, 1, 1280, 3), 0, 'never before first page');

assert.equal(g.classifyDrag(5, 6), null, 'inside slop stays a tap');
assert.equal(g.classifyDrag(40, 5), 'horizontal');
assert.equal(g.classifyDrag(3, -50), 'up');
assert.equal(g.classifyDrag(3, 50), 'down');
assert.equal(g.classifyDrag(30, 30), null, 'diagonal waits');

const screen = {x: 0, y: 0, width: 1280, height: 800};
assert(g.pullDownAllowed(640, 300, screen), 'centre pull searches');
assert(!g.pullDownAllowed(640, 20, screen), 'top edge belongs to notifications/controls');
assert(!g.pullDownAllowed(10, 300, screen), 'screen sides excluded');

const flat = g.bladeTransform(0);
assert.deepEqual(flat, {angle: -0, scale: 1, opacity: 255});
assert(g.bladeTransform(1).angle < 0 && g.bladeTransform(-1).angle > 0, 'blades lean toward centre');
assert(g.bladeTransform(5).scale >= 0.85 && g.bladeTransform(5).opacity > 0);
assert.deepEqual(g.groupWindows(['a1', 'b1', 'a2'], w => w[0]).map(x => x.windows),
    [['a1', 'a2'], ['b1']], 'blades group app windows in MRU order');

assert.equal(g.hingeTablet(300, false), true);
assert.equal(g.hingeTablet(100, true), false);
assert.equal(g.hingeTablet(180, true), true, 'hysteresis keeps tablet');
assert.equal(g.hingeTablet(180, false), false, 'hysteresis keeps laptop');
assert.equal(g.hingeTablet(NaN, false), null);
assert.equal(g.resolveTablet({mode: 'automatic', seatTouch: true}), true);
assert.equal(g.resolveTablet({mode: 'automatic', hardware: true}), true, 'kernel switch counts');
assert.equal(g.resolveTablet({mode: 'automatic', seatTouch: true, override: false}), false,
    'Quick Settings override wins in Automatic');
assert.equal(g.resolveTablet({mode: 'always-desktop', seatTouch: true}), false);
assert.equal(g.resolveTablet({mode: 'always-tablet'}), true);
assert.equal(g.isWindowMaximized({is_maximized: () => true}), true, 'Mutter 49');
assert.equal(g.isWindowMaximized({get_maximized: () => 3}), true, 'Mutter 46-48');
// Folding/unfolding with apps open.
{
    const [a, b, c] = ['a', 'b', 'c'];
    let p = g.planTabletEntry([a, b, c], b);
    assert.equal(p.foreground, b, 'focused app becomes the full-screen app');
    assert.deepEqual(p.minimize, [a, c], 'the rest go to multitasking');
    p = g.planTabletEntry([a, b, c], null);
    assert.equal(p.foreground, a, 'no focus: most recent app');
    p = g.planTabletEntry([a, b, c], a, w => (w === a ? c : null));
    assert.deepEqual(p.pair, [a, c], 'a tiled pair stays together');
    assert.deepEqual(p.minimize, [b]);
    assert.equal(g.planTabletEntry([], null).foreground, null, 'nothing open: Home');
    assert.deepEqual(g.planTabletExit([a, b, c], b), [a, c], 'unfold: only the app on screen stays');
    assert.deepEqual(g.planTabletExit([a, b, c], a, [a, b]), [c], 'Split View pair stays tiled');
    assert.deepEqual(g.planTabletExit([a, b, c], c, [a, b]), [a, b], 'a Slide Over focus wins');
    assert.deepEqual(g.planTabletExit([], null), []);
    const seq = n => ({get_slot: () => n});
    assert(g.sameSequence(seq(1), seq(1)), 'one finger across fresh GJS wrappers');
    assert(!g.sameSequence(seq(1), seq(2)), 'two fingers differ');
    assert(g.sameSequence(null, null) && !g.sameSequence(null, seq(1)));
}
console.log('Tablet geometry checks passed (grid, slots, paging, drags, pull search, blades, posture).');

// Home layout model.
const {HomeLayout, itemId} = load('homeLayout.js', ['HomeLayout', 'itemId']);
const apps = [
    {id: 'org.gnome.Nautilus.desktop', name: 'Files', categories: ['Utility']},
    {id: 'steam.desktop', name: 'Steam', categories: ['Game']},
    {id: 'net.lutris.Lutris.desktop', name: 'Lutris', categories: ['Game']},
    {id: 'org.libretro.RetroArch.desktop', name: 'RetroArch', categories: ['Game']},
    {id: 'org.mozilla.firefox.desktop', name: 'Firefox', categories: ['Network']},
];
const layout = new HomeLayout('').seed(apps);
assert.deepEqual(layout.items.slice(0, 3),
    ['org.gnome.Nautilus.desktop', 'org.mozilla.firefox.desktop', 'steam.desktop']);
assert.equal(layout.items[3].name, 'Games', 'games gathered, Steam stays on the grid');
assert.deepEqual(layout.items[3].apps.sort(),
    ['net.lutris.Lutris.desktop', 'org.libretro.RetroArch.desktop']);
const games = itemId(layout.items[3]);
const restored = new HomeLayout(layout.serialize());
assert.deepEqual(restored.items, layout.items, 'round trip');
assert.deepEqual(new HomeLayout('{broken').items, [], 'corrupt setting is ignored');
// Version 1 (flat list) layouts migrate and split by grid size.
const v1 = new HomeLayout(JSON.stringify({version: 1, items: ['a', 'b', 'c', 'd', 'e']}));
assert.deepEqual(v1.pages(2), [['a', 'b'], ['c', 'd'], ['e']], 'v1 layout split into pages');
assert(v1.serialize().includes('"pages"'));
assert.equal(restored.move('steam.desktop', 0, 0), true);
assert.equal(restored.items[0], 'steam.desktop');
assert.equal(restored.dropOnto('org.mozilla.firefox.desktop', 'org.gnome.Nautilus.desktop'), true);
const created = restored.items.find(item => typeof item !== 'string' && item.name === 'Folder');
assert.deepEqual(created.apps, ['org.gnome.Nautilus.desktop', 'org.mozilla.firefox.desktop']);
assert.notEqual(itemId(created), games, 'folder ids are unique after reload');
assert.equal(restored.dropOnto('steam.desktop', games), true, 'join existing folder');
assert(restored.folder(games).apps.includes('steam.desktop'));
assert.equal(restored.dropOnto(games, 'steam.desktop'), false, 'folders do not nest');
assert.equal(restored.renameFolder(itemId(created), '  Web  '), true);
assert.equal(created.name, 'Web');
restored.removeFromFolder(itemId(created), 'org.mozilla.firefox.desktop');
assert(!restored.items.includes(created), 'one-app folder dissolves');
assert(restored.items.includes('org.gnome.Nautilus.desktop') &&
    restored.items.includes('org.mozilla.firefox.desktop'));
const changed = restored.sync(['org.mozilla.firefox.desktop',
    'net.lutris.Lutris.desktop', 'new.app.desktop']);
assert.equal(changed, true);
assert(!JSON.stringify(restored.items).includes('Nautilus'), 'uninstalled app removed');
assert(!restored.items.includes('steam.desktop'), 'uninstalled folder member removed');
assert(!restored.folder(games), 'folder with one remaining app dissolves');
assert.equal(restored.items.at(-1), 'new.app.desktop', 'new installs appended');
assert.equal(restored.sync(['org.mozilla.firefox.desktop',
    'net.lutris.Lutris.desktop', 'new.app.desktop']), false, 'stable when nothing changed');

// Pages are kept: an app stays on the page you put it on.
const paged = new HomeLayout(JSON.stringify({version: 2, pages: [['a', 'b', 'c'], ['d']]}));
assert.deepEqual(paged.pages(3), [['a', 'b', 'c'], ['d']]);
assert.equal(paged.move('a', 1, 1), true);
assert.deepEqual(paged.pages(3), [['b', 'c'], ['d', 'a']], 'moved to page 2, page 1 keeps a gap at the end');
paged.move('b', 2, 0);
assert.deepEqual(paged.pages(3), [['c'], ['d', 'a'], ['b']], 'dropping past the last page creates one');
paged.move('c', 1, 0);
assert.deepEqual(paged.pages(3), [['c', 'd', 'a'], ['b']], 'emptied pages disappear');
paged.move('b', 0, 0);
assert.deepEqual(paged.pages(3), [['b', 'c', 'd'], ['a']], 'full page pushes its last app to the next page');
assert.deepEqual(paged.pages(2), [['b', 'c'], ['d', 'a']], 'smaller grid after rotation cascades overflow');
assert.deepEqual(paged.locate('a'), {page: 1, index: 1});
const folderPaged = new HomeLayout(JSON.stringify({version: 2,
    pages: [['x'], [{id: '7', name: 'F', apps: ['p', 'q', 'r']}, 'y']]}));
folderPaged.removeFromFolder('folder:7', 'q');
assert.deepEqual(folderPaged.pages(4)[1].map(itemId), ['folder:7', 'q', 'y'],
    'app dragged out of a folder lands beside it on the same page');
assert.deepEqual(new HomeLayout('').pages(10), [[]], 'empty Home still has a page');
console.log('Home layout checks passed (seed, games folder, reorder, folders, sync, paging, persistence).');

// Settings journal: crash-safe restore.
class Variant {
    constructor(text) { this.text = text; }
    print() { return this.text; }
}
const stores = {};
function settings(values) {
    return {values, settings_schema: {has_key: key => key in values || key === 'unset'},
        get_user_value(key) { return key in this.values ? new Variant(this.values[key]) : null; },
        set_value(key, v) { this.values[key] = v.text; },
        reset(key) { delete this.values[key]; }};
}
const iface = settings({'text-scaling-factor': '1.0'});
const ts = settings({});
let disk = '';
const open = id => ({'org.gnome.desktop.interface': iface, touchshell: ts})[id] ?? null;
const {SettingsJournal} = load('settingsJournal.js', ['SettingsJournal']);
const journal = new SettingsJournal({load: () => disk, save: v => { disk = v; }, open,
    parse: text => new Variant(text)});
assert.equal(journal.change('org.gnome.desktop.interface', 'text-scaling-factor',
    s => s.set_value('text-scaling-factor', new Variant('1.15'))), true);
assert.equal(journal.change('touchshell', 'unset', s => s.set_value('unset', new Variant("'always'"))), true);
assert.equal(journal.change('missing.schema', 'x', () => assert.fail('not applied')), false);
journal.change('org.gnome.desktop.interface', 'text-scaling-factor',
    s => s.set_value('text-scaling-factor', new Variant('1.2')));
assert(disk.includes('1.0'), 'original saved to disk before change');
// Simulate a Shell crash: a brand-new journal reads the disk copy.
const recovered = new SettingsJournal({load: () => disk, save: v => { disk = v; }, open,
    parse: text => new Variant(text)});
assert.equal(recovered.pending, 2);
recovered.restore();
assert.equal(iface.values['text-scaling-factor'], '1.0', 'first original kept, not intermediate');
assert(!('unset' in ts.values), 'unset key reset to default');
assert.equal(recovered.pending, 0);
assert.equal(disk, '{}');
// A user's manual change during tablet mode wins.
journal.change('org.gnome.desktop.interface', 'text-scaling-factor',
    s => s.set_value('text-scaling-factor', new Variant('1.15')));
iface.values['text-scaling-factor'] = '1.5';
journal.restore();
assert.equal(iface.values['text-scaling-factor'], '1.5');
journal.change('touchshell', 'unset', s => s.set_value('unset', new Variant("'always'")));
journal.revert('touchshell', 'unset');
assert(!('unset' in ts.values), 'single key reverted early');
assert.equal(journal.pending, 0);
console.log('Settings journal checks passed (disk copy, crash recovery, defaults, user changes win).');

// Posture monitor.
const {findHardwareSources, readHardware, PostureMonitor, readHingeAngle, parseMountMatrix} = load('posture.js',
    ['findHardwareSources', 'readHardware', 'PostureMonitor', 'readHingeAngle', 'parseMountMatrix'],
    {hingeTablet: g.hingeTablet, hingeFromAccels: g.hingeFromAccels});
const files = {'/sys/bus/iio/devices/iio:device3/in_angl0_raw': '90\n'};
const readFile = p => files[p] ?? null;
const listDir = p => p === '/sys/bus/iio/devices' ? ['iio:device0', 'iio:device3'] : [];
const sources = findHardwareSources(readFile, listDir);
assert.deepEqual(sources, [{kind: 'hinge', path: '/sys/bus/iio/devices/iio:device3/in_angl0_raw'}]);
assert.equal(readHardware(sources, readFile, null), false);
const seat = {touch_mode: false, handlers: [], connect(_n, fn) { this.handlers.push(fn); return 7; },
    disconnect(id) { this.disconnected = id; }};
let tick = null, changes = 0, cancelled = 0;
const monitor = new PostureMonitor({seat, readFile, listDir,
    poll: (_s, fn) => { tick = fn; return 9; }, cancel: () => cancelled++}, () => changes++);
assert.equal(monitor.hardware, false);
assert(tick, 'hinge found: polling runs even though the seat signal exists');
files['/sys/bus/iio/devices/iio:device3/in_angl0_raw'] = '330';
tick();
assert.equal(monitor.hardware, true);
assert.equal(changes, 1);
tick();
assert.equal(changes, 1, 'only real changes notify');
seat.touch_mode = true;
seat.handlers[0]();
assert.equal(monitor.seatTouch, true);
assert.equal(changes, 2);
monitor.destroy();
assert.equal(seat.disconnected, 7);
assert.equal(cancelled, 1);
// Chosen hinge angle: presets and custom thresholds, with hysteresis.
assert.equal(g.hingeTablet(190, false, 180), true, 'past flat');
assert.equal(g.hingeTablet(170, true, 180), true, 'just below past-flat keeps tablet (hysteresis)');
assert.equal(g.hingeTablet(150, true, 180), false);
assert.equal(g.hingeTablet(200, false, 225), false, 'laptop at 200: not yet tent');
assert.equal(g.hingeTablet(240, false, 225), true, 'tent');
assert.equal(g.hingeTablet(300, false, 359), false, 'not fully folded');
assert.equal(g.hingeTablet(345, false, 359), true, 'fully folded (sensors stop short of 360)');
// Two accelerometers: base flat, screen at 90 / flat / folded back.
assert.equal(g.hingeFromAccels([0, 1, 0], [0, 0, 1]), 90);
assert.equal(g.hingeFromAccels([0, 0, 1], [0, 0, 1]), 180);
assert.equal(g.hingeFromAccels([0, -1, 0], [0, 0, 1]), 270, 'tent / stand');
assert.equal(g.hingeFromAccels([0.99, 0.05, 0.05], [0, 0, 1]), null, 'hinge pointing down: unknown');
assert.deepEqual(parseMountMatrix('0, 1, 0; -1, 0, 0; 0, 0, 1'), [[0, 1, 0], [-1, 0, 0], [0, 0, 1]]);
{
    const accelFiles = {
        '/sys/bus/iio/devices/iio:device1/in_accel_x_raw': '0', '/sys/bus/iio/devices/iio:device1/in_accel_y_raw': '-1000',
        '/sys/bus/iio/devices/iio:device1/in_accel_z_raw': '0', '/sys/bus/iio/devices/iio:device1/label': 'accel-display',
        '/sys/bus/iio/devices/iio:device2/in_accel_x_raw': '0', '/sys/bus/iio/devices/iio:device2/in_accel_y_raw': '0',
        '/sys/bus/iio/devices/iio:device2/in_accel_z_raw': '1000', '/sys/bus/iio/devices/iio:device2/dev': '236:2',
        '/run/udev/data/c236:2': 'E:ACCEL_LOCATION=base\n',
        '/sys/bus/platform/devices/tablet-mode-switch/tablet-mode': '0',
    };
    const rf = p => accelFiles[p] ?? null;
    const ld = p => p === '/sys/bus/iio/devices' ? ['iio:device1', 'iio:device2'] : [];
    const src = findHardwareSources(rf, ld);
    assert(src.some(x => x.kind === 'accels'), 'display + base accelerometers found (label and udev)');
    assert.equal(readHingeAngle(src, rf), 270);
    assert.equal(readHardware(src, rf, null, 0), false, 'automatic: the tablet switch decides');
    assert.equal(readHardware(src, rf, null, 225), true, 'tent preset: 270 degrees is tablet');
    assert.equal(readHardware(src, rf, null, 359), false, 'fully-folded preset: 270 is not');
    let t2 = 0;
    const m2 = new PostureMonitor({seat: null, readFile: rf, listDir: ld, poll: () => 1, cancel() {},
        threshold: () => t2}, () => {});
    assert.equal(m2.angleDecides, false);
    t2 = 225;
    assert.equal(m2.refresh(), true);
    assert.equal(m2.hardware, true);
    assert.equal(m2.angleDecides, true);
    assert.equal(m2.angle, 270);
    assert.equal(g.resolveTablet({mode: 'automatic', seatTouch: true, hardware: false, angleDecides: true}), false,
        'chosen angle overrides the laptop switch');
}
const quiet = new PostureMonitor({seat, readFile: () => null, listDir: () => [],
    poll: () => assert.fail('no files, no polling'), cancel() {}}, () => {});
quiet.destroy();
console.log('Posture checks passed (seat + hinge combined, hysteresis, change-only notify, cleanup).');

// Touch router: taps, holds, drags and modal menus without pointer grabs.
const T = ['TOUCH_BEGIN', 'TOUCH_UPDATE', 'TOUCH_END', 'TOUCH_CANCEL', 'BUTTON_PRESS',
    'BUTTON_RELEASE', 'MOTION'];
const ClutterMock = {EventType: Object.fromEntries(T.map(t => [t, t])), EVENT_STOP: 1,
    EVENT_PROPAGATE: 0, KEY_Return: 1, KEY_KP_Enter: 2, KEY_space: 3};
let pending = null;
const GLibMock = {PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false,
    timeout_add: (_p, _ms, fn) => { pending = fn; return 5; }, source_remove: () => { pending = null; }};
const {TouchRouter, findHandler} = load('touchRouter.js', ['TouchRouter', 'findHandler'],
    {Clutter: ClutterMock, GLib: GLibMock, classifyDrag: g.classifyDrag, sameSequence: g.sameSequence});
class Actor {
    constructor(parent = null) { this.parent = parent; }
    get_parent() { return this.parent; }
    contains(a) { for (let x = a; x; x = x.parent) if (x === this) return true; return false; }
    connect(_n, fn) { this.handler = fn; return 3; }
    disconnect() { this.handler = null; }
}
const surface = new Actor();
const icon = new Actor(surface);
const label = new Actor(icon);
const entry = new Actor(surface);
entry._mutsuPassthrough = true;
let taps = 0;
icon._mutsuTap = () => taps++;
const log = [];
const delegate = {
    dragStart: (kind) => { log.push(`start:${kind}`); return kind !== 'up'; },
    drag: (kind, dx) => log.push(`drag:${kind}:${dx}`),
    dragEnd: (kind, dx, dy, v) => log.push(`end:${kind}:${v > 0 ? 'right' : 'left'}`),
    heldMove: (dx, dy) => log.push(`held:${dx},${dy}`),
    heldEnd: () => log.push('heldEnd'),
    cancel: () => log.push('cancel'),
};
const router = new TouchRouter(surface, delegate);
const ev = (type, x, y, time, source = label, sequence = 1) => surface.handler(surface, {
    type: () => type, get_coords: () => [x, y], get_time: () => time,
    get_event_sequence: () => (sequence === null ? null : {get_slot: () => sequence}), get_source: () => source, get_button: () => 1});
ev('TOUCH_BEGIN', 100, 100, 0);
ev('TOUCH_END', 103, 102, 80);
assert.equal(taps, 1, 'tap on a label reaches its tile');
assert.equal(pending, null, 'long-press timer cancelled on release');
ev('TOUCH_BEGIN', 100, 100, 100);
ev('TOUCH_UPDATE', 60, 102, 120);
ev('TOUCH_UPDATE', 20, 104, 140);
ev('TOUCH_END', 10, 104, 150);
assert.deepEqual(log, ['start:horizontal', 'drag:horizontal:-40', 'drag:horizontal:-80', 'end:horizontal:left']);
assert.equal(taps, 1, 'a swipe that starts on an icon does not launch it');
log.length = 0;
ev('TOUCH_BEGIN', 100, 100, 200);
ev('TOUCH_UPDATE', 100, 40, 220);
ev('TOUCH_END', 100, 30, 230);
assert.deepEqual(log, ['start:up'], 'declined drags are ignored, not tapped');
assert.equal(taps, 1);
log.length = 0;
let held = 0;
icon._mutsuLongPress = () => { held++; return true; };
ev('TOUCH_BEGIN', 100, 100, 300);
pending();
assert.equal(held, 1, 'hold reaches the tile');
ev('TOUCH_UPDATE', 130, 100, 900);
ev('TOUCH_END', 130, 100, 950);
assert.deepEqual(log, ['held:30,0', 'heldEnd'], 'moves after a hold drag the item');
assert.equal(taps, 1);
log.length = 0;
icon._mutsuLongPress = () => false;
ev('TOUCH_BEGIN', 100, 100, 1000);
pending();
ev('TOUCH_END', 100, 100, 1600);
assert.equal(taps, 2, 'a slow tap with no hold action still taps');
assert.equal(ev('TOUCH_BEGIN', 5, 5, 1700, entry), 0, 'text entries keep native input');
ev('TOUCH_BEGIN', 100, 100, 1800);
assert.equal(ev('TOUCH_BEGIN', 300, 300, 1810, label, 2), 1, 'second finger is swallowed');
ev('TOUCH_CANCEL', 100, 100, 1820);
assert.deepEqual(log, ['cancel']);
const menu = new Actor(surface);
let outside = 0;
router.modal = menu;
router.onOutsideModal = () => outside++;
ev('TOUCH_BEGIN', 100, 100, 1900);
ev('TOUCH_END', 100, 100, 1950);
assert.equal(outside, 1, 'tap outside an open menu closes it');
assert.equal(taps, 2, '...without activating what was underneath');
assert.equal(findHandler(label, surface, '_mutsuTap'), icon);
// GNOME 45+: touch/click events have no source; the stage knows the target.
router.modal = null;
globalThis.global = {stage: {get_event_actor: event => event.actor}};
surface.handler(surface, {type: () => 'TOUCH_BEGIN', get_coords: () => [100, 100], get_time: () => 3000,
    get_event_sequence: () => ({get_slot: () => 4}), get_source: () => null, actor: label, get_button: () => 1});
surface.handler(surface, {type: () => 'TOUCH_END', get_coords: () => [100, 100], get_time: () => 3050,
    get_event_sequence: () => ({get_slot: () => 4}), get_source: () => null, actor: label, get_button: () => 1});
delete globalThis.global;
assert.equal(taps, 3, 'tap finds its target through the stage when the event has no source');
router.destroy();
assert.equal(surface.handler, null);
console.log('Touch router checks passed (tap, swipe-on-icon, hold-drag, slow tap, entries, multi-touch, menus).');

const {withImport, TABLET_CSS} = load('windowChrome.js', ['withImport', 'TABLET_CSS'], {Gio: {}, GLib: {}});
assert.equal(withImport(''), "@import url('mutsu-tablet.css');\n");
assert.equal(withImport("@import url('mutsu-theme.css');\n"),
    "@import url('mutsu-theme.css');\n@import url('mutsu-tablet.css');\n", 'after the theme so it wins');
assert.equal(withImport("x\n@import url('mutsu-tablet.css');\n"), null, 'imported once');
assert(/windowcontrols > button \{\s*min-width: 28px;/.test(TABLET_CSS), 'finger-sized traffic lights');
console.log('Tablet window-control checks passed (import once, after theme, finger size).');

// The desktop dock stays hidden in tablet mode, even when it rebuilds itself.
{
    class A {
        constructor(name) { this.name = name; this.visible = true; this.handlers = new Map(); this.n = 0; this.children = []; }
        connect(sig, fn) { this.handlers.set(++this.n, [sig, fn]); return this.n; }
        disconnect(id) { this.handlers.delete(id); }
        emit(sig, ...a) { for (const [s, fn] of [...this.handlers.values()]) if (s === sig) fn(this, ...a); }
        hide() { if (this.visible) { this.visible = false; this.emit('notify::visible'); } }
        show() { if (!this.visible) { this.visible = true; this.emit('notify::visible'); } }
        get_children() { return this.children; }
    }
    const src = fs.readFileSync(path.join(folder, 'dockHider.js'), 'utf8').replace(/^import .*\n/gm, '').replace(/export /g, '');
    const group = new A('ui'), dock = new A('dashtodockContainer'), other = new A('panel');
    group.children.push(dock, other);
    const {DashToDockHider} = new Function('Main', `${src}; return {DashToDockHider};`)({layoutManager: {uiGroup: group}});
    const hider = new DashToDockHider(group);
    assert.equal(dock.visible, false, 'dock hidden');
    assert.equal(other.visible, true, 'other chrome untouched');
    dock.show();
    assert.equal(dock.visible, false, 'dock showing itself again is hidden again');
    const rebuilt = new A('dashtodockContainer');
    group.emit('child-added', rebuilt);
    assert.equal(rebuilt.visible, false, 'a dock rebuilt after rotation is hidden too');
    hider.destroy();
    assert(dock.visible && rebuilt.visible, 'both come back when tablet mode ends');
    console.log('Desktop dock hider checks passed (hide, stays hidden, rebuilt dock, restore).');
}
