// Smoke test for the tablet Home and multitasking blades against mocked
// Shell objects. It drives real gestures through the real TouchRouter and
// checks the outcomes; it cannot prove rendering on hardware.
//   node tests/test_tablet_ui.cjs extensions/mutsu-adaptive@mutsu-os
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const folder = process.argv[2];
const strip = file => fs.readFileSync(path.join(folder, file), 'utf8')
    .replace(/^import [\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
const load = (file, names, deps) => new Function(...Object.keys(deps),
    `${strip(file)}; return {${names.join(',')}};`)(...Object.values(deps));

// ---- generic mocks ---------------------------------------------------------
class Emitter {
    constructor() { this._handlers = new Map(); this._next = 0; }
    connect(name, fn) { this._handlers.set(++this._next, [name, fn]); return this._next; }
    disconnect(id) { this._handlers.delete(id); }
    emit(name, ...args) {
        let result;
        for (const [n, fn] of [...this._handlers.values()])
            if (n === name) result = fn(this, ...args);
        return result;
    }
    get handlerCount() { return this._handlers.size; }
}
class Actor extends Emitter {
    constructor(props = {}) {
        super();
        Object.assign(this, {x: 0, y: 0, width: 100, height: 100, opacity: 255, visible: true,
            translation_x: 0, translation_y: 0, scale_x: 1, scale_y: 1}, props);
        this.children = [];
        this.parent = null;
        this.classes = new Set(String(props.style_class ?? '').split(' ').filter(Boolean));
        if (props.layout_manager) {
            this.layout_manager = props.layout_manager;
            props.layout_manager.owner = this;
        }
    }
    add_child(c) { c.parent = this; this.children.push(c); }
    insert_child_above(c) { this.add_child(c); }
    remove_child(c) { this.children = this.children.filter(x => x !== c); c.parent = null; }
    destroy_all_children() { [...this.children].forEach(c => c.destroy()); }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        [...this.children].forEach(c => c.destroy());
        this.parent?.remove_child(this);
        this.emit('destroy');
    }
    get_parent() { return this.parent; }
    get_children() { return this.children; }
    get_first_child() { return this.children[0] ?? null; }
    contains(a) { for (let x = a; x; x = x.parent) if (x === this) return true; return false; }
    set_position(x, y) { this.x = x; this.y = y; }
    set_size(w, h) { this.width = w; this.height = h; }
    set_width(w) { this.width = w; }
    get_size() { return [this.width, this.height]; }
    get_preferred_width() { return [80, 160]; }
    get_preferred_height() { return [40, 120]; }
    get_transformed_position() {
        let x = 0, y = 0;
        for (let a = this; a; a = a.parent) { x += (a.x ?? 0) + (a.translation_x ?? 0); y += (a.y ?? 0) + (a.translation_y ?? 0); }
        return [x, y];
    }
    get_transformed_size() { return [this.width, this.height]; }
    set_pivot_point() {}
    set_scale(x, y) { this.scale_x = x; this.scale_y = y; }
    ease(props) { const {onComplete, duration, mode, repeatCount, autoReverse, ...rest} = props;
        Object.assign(this, rest); onComplete?.(); }
    remove_all_transitions() {}
    set_child_above_sibling(c) { this.children = [...this.children.filter(x => x !== c), c]; }
    add_style_class_name(c) { this.classes.add(c); }
    remove_style_class_name(c) { this.classes.delete(c); }
    grab_key_focus() { this.focused = true; }
    add_effect() {}
    show() { this.visible = true; }
    hide() { this.visible = false; }
    get_text() { return this.text ?? ''; }
}
class Entry extends Actor {
    constructor(p) { super(p); this.clutter_text = Object.assign(new Emitter(), {set_selection() {}}); }
}
class Grid { attach(child) { this.owner?.add_child(child); } }
class BinActor extends Actor { constructor(p = {}) { super(p); if (p.child) this.add_child(p.child); } }
const St = {Widget: Actor, BoxLayout: Actor, Label: Actor, Icon: Actor, Button: Actor, Entry, Bin: BinActor};
const vbox = props => new Actor(props);
const T = ['TOUCH_BEGIN', 'TOUCH_UPDATE', 'TOUCH_END', 'TOUCH_CANCEL', 'BUTTON_PRESS',
    'BUTTON_RELEASE', 'MOTION', 'KEY_PRESS'];
const Clutter = {EventType: Object.fromEntries(T.map(t => [t, t])), EVENT_STOP: 1, EVENT_PROPAGATE: 0,
    ActorAlign: {CENTER: 0, FILL: 1, START: 2, END: 3}, AnimationMode: {}, BinLayout: class {}, GridLayout: Grid,
    PickMode: {REACTIVE: 0}, Clone: Actor, KEY_Return: 1, KEY_KP_Enter: 2, KEY_space: 3,
    KEY_Escape: 4, KEY_Left: 5, KEY_Right: 6, KEY_Delete: 7, KEY_BackSpace: 8, KEY_m: 9, KEY_M: 10};
let timers = new Map(), timerId = 0;
const GLib = {PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false, SOURCE_CONTINUE: true,
    timeout_add: (_p, _ms, fn) => { timers.set(++timerId, fn); return timerId; },
    timeout_add_seconds: (_p, _s, fn) => { timers.set(++timerId, fn); return timerId; },
    source_remove: id => timers.delete(id),
    DateTime: {new_now_local: () => ({format: f => f.includes('%A,') ? 'Thursday, November 5' : '11:30'})}};
const runTimers = () => { const t = [...timers.values()]; timers.clear(); t.forEach(fn => fn()); };
const Gio = {Settings: class { get_string() { return '24h'; } }};

const monitor = {x: 0, y: 0, width: 1280, height: 800};
const sessionMode = Object.assign(new Emitter(), {isLocked: false, isGreeter: false});
const backgroundGroup = new Actor();
const uiGroup = new Actor();
const layoutManager = Object.assign(new Emitter(), {_backgroundGroup: backgroundGroup, uiGroup,
    monitors: [monitor], primaryMonitor: monitor});
const activated = [];
let modal = 0;
const Main = {sessionMode, layoutManager, activateWindow: w => { activated.push(w); w.minimized = false; },
    pushModal: () => { modal++; return {get_seat_state: () => true}; }, popModal: () => modal--,
    notify() {}, overview: {hide() {}}};

function makeApp(id, name, categories = '', running = false) {
    const windows = [];
    return {id, windows, state: running ? 1 : 0, launched: 0, quit: 0,
        get_id: () => id, get_name: () => name, get_windows: () => windows,
        get_app_info: () => ({get_categories: () => categories}),
        create_icon_texture: () => new Actor(), activate() { this.launched++; },
        can_open_new_window: () => true, open_new_window() {}, request_quit() { this.quit++; }};
}
const apps = [
    makeApp('org.mozilla.firefox.desktop', 'Firefox', 'Network;', true),
    makeApp('steam.desktop', 'Steam', 'Game;'),
    makeApp('net.lutris.Lutris.desktop', 'Lutris', 'Game;'),
    makeApp('org.libretro.RetroArch.desktop', 'RetroArch', 'Game;'),
    makeApp('org.gnome.Nautilus.desktop', 'Files', 'Utility;'),
    makeApp('org.gnome.TextEditor.desktop', 'Text Editor', 'Utility;'),
];
const appSystem = Object.assign(new Emitter(), {
    get_installed: () => apps.map(a => ({should_show: () => true, get_id: () => a.id})),
    lookup_app: id => apps.find(a => a.id === id) ?? null,
    get_running: () => apps.filter(a => a.state === 1)});
const Shell = {AppSystem: {get_default: () => appSystem}, AppState: {RUNNING: 1},
    WindowTracker: {get_default: () => ({get_window_app: w => w.app})},
    ActionMode: {POPUP: 0}, BlurEffect: class { constructor() { this.radius = 0; } }, BlurMode: {BACKGROUND: 0}};
const favorites = Object.assign(new Emitter(), {list: ['org.gnome.Nautilus.desktop'],
    getFavorites() { return this.list.map(id => appSystem.lookup_app(id)); },
    isFavorite(id) { return this.list.includes(id); },
    addFavorite(id) { this.list.push(id); this.emit('changed'); },
    addFavoriteAtPos(id, pos) { this.list.splice(pos, 0, id); this.emit('changed'); },
    moveFavoriteToPos(id, pos) { this.list = this.list.filter(x => x !== id); this.list.splice(pos, 0, id); this.emit('changed'); },
    removeFavorite(id) { this.list = this.list.filter(x => x !== id); this.emit('changed'); }});
const AppFavorites = {getAppFavorites: () => favorites};
const settings = Object.assign(new Emitter(), {values: {'home-layout': '', 'home-widgets': true},
    get_string(k) { return this.values[k]; }, get_boolean(k) { return this.values[k]; },
    set_string(k, v) { this.values[k] = v; this.emit(`changed::${k}`); }});

const geometry = load('tabletGeometry.js', ['homeMetrics', 'slotAt', 'pageSnap', 'pullDownAllowed',
    'PULL_SEARCH_PX', 'classifyDrag', 'sameSequence', 'bladeTransform', 'cloneable', 'groupWindows', 'isWindowMaximized',
    'maximizeWindow', 'unmaximizeWindow'], {});
const {HomeLayout, itemId} = load('homeLayout.js', ['HomeLayout', 'itemId'], {});
const router = load('touchRouter.js', ['TouchRouter', 'makeTappable', 'findHandler', 'eventActor'],
    {Clutter, GLib, classifyDrag: geometry.classifyDrag, sameSequence: geometry.sameSequence});
const {TouchMenu} = load('touchMenu.js', ['TouchMenu'], {Clutter, St, makeTappable: router.makeTappable, vbox});
let searches = 0;
const {TabletHome} = load('tabletHome.js', ['TabletHome'], {Clutter, GLib, Gio, Shell, St, Main,
    AppFavorites, ...geometry, HomeLayout, itemId, ...router, TouchMenu, vbox});

// ---- Home ---------------------------------------------------------------------
const home = new TabletHome({settings, monitor: () => monitor, search: () => searches++});
const root = backgroundGroup.children.at(-1);
assert(root.classes.has('mutsu-home'), 'Home lives in the background layer, behind windows');
const saved = JSON.parse(settings.values['home-layout']);
assert(saved.pages.flat().some(i => i.name === 'Games'), 'first run builds a layout with a Games folder');
const all = node => [node, ...node.children.flatMap(all)];
const find = pred => all(root).find(pred);
const tile = id => find(a => a._mutsuItem === id);
const send = (type, x, y, time, source) => root.emit('captured-event', {type: () => type,
    get_coords: () => [x, y], get_time: () => time, get_event_sequence: () => 1,
    get_source: () => source, get_button: () => 1});
const tap = (actor, t = 0) => {
    const [x, y] = actor.get_transformed_position();
    send('TOUCH_BEGIN', x + 5, y + 5, t, actor);
    send('TOUCH_END', x + 5, y + 5, t + 50, actor);
};

// Tap an icon: launches (running apps are brought forward instead).
tap(tile('org.gnome.TextEditor.desktop'));
assert.equal(apps[5].launched, 1, 'tap launches the app');
apps[0].windows.push({is_skip_taskbar: () => false, name: 'firefox window'});
tap(tile('org.mozilla.firefox.desktop'), 100);
assert.equal(activated.at(-1).name, 'firefox window', 'tap on a running app brings its window forward');

// Pull down from the middle: Mutsu Search.
send('TOUCH_BEGIN', 640, 300, 200, root);
send('TOUCH_UPDATE', 642, 340, 220, root);
send('TOUCH_UPDATE', 642, 400, 240, root);
send('TOUCH_END', 642, 400, 260, root);
assert.equal(searches, 1, 'pull down on Home opens Mutsu Search');
send('TOUCH_BEGIN', 640, 10, 300, root);
send('TOUCH_UPDATE', 640, 200, 320, root);
send('TOUCH_END', 640, 200, 330, root);
assert.equal(searches, 1, 'the top edge is not a search pull');
assert.equal(find(a => a.accessible_name?.startsWith('Search')), undefined, 'no search box on Home (pull down instead)');

// Long-press menu, then Add to Dock.
const firefox = tile('org.mozilla.firefox.desktop');
const [fx, fy] = firefox.get_transformed_position();
send('TOUCH_BEGIN', fx + 5, fy + 5, 500, firefox);
runTimers();
send('TOUCH_END', fx + 5, fy + 5, 1100, firefox);
let menu = find(a => a.classes.has('mutsu-touch-menu'));
assert(menu, 'long press opens the quick-actions menu');
const labels = all(menu).filter(a => a.accessible_name).map(a => a.accessible_name);
assert.deepEqual(labels, ['Show', 'New Window', 'Add to Dock', 'Edit Home Screen', 'Quit']);
tap(all(menu).find(a => a.accessible_name === 'Add to Dock'), 1200);
runTimers();
assert(favorites.isFavorite('org.mozilla.firefox.desktop'), 'menu adds the app to the dock');
assert(!find(a => a.classes.has('mutsu-touch-menu')), 'menu closes after choosing');

// Hold and drag an icon: jiggle mode and reorder.
const files = tile('org.gnome.TextEditor.desktop');
const before = new HomeLayout(settings.values['home-layout']).indexOf('org.gnome.TextEditor.desktop');
const [nx, ny] = files.get_transformed_position();
send('TOUCH_BEGIN', nx + 5, ny + 5, 1300, files);
runTimers();
send('TOUCH_UPDATE', nx + 40, ny + 5, 1900, files);
assert(home.editing, 'dragging after a hold enters edit (jiggle) mode');
const m = geometry.homeMetrics(1280, 800);
send('TOUCH_UPDATE', m.gridX + 5, m.gridY + 5, 2000, files); // the dragged icon now sits on the first slot
send('TOUCH_END', m.gridX + 5, m.gridY + 5, 2100, files);
runTimers();
const after = new HomeLayout(settings.values['home-layout']).indexOf('org.gnome.TextEditor.desktop');
assert.notEqual(after, before, 'dropping reorders and saves the layout');
assert.equal(after, 0, 'dropped into the first slot');
tap(find(a => a.accessible_name === 'Done editing Home Screen'), 2200);
assert(!home.editing, 'Done leaves edit mode');

// Folders: open, rename, close.
const games = new HomeLayout(settings.values['home-layout']).items.find(i => typeof i !== 'string');
tap(tile(itemId(games)), 2300);
const title = find(a => a instanceof Entry);
assert(title, 'tapping a folder opens it');
title.text = 'Play';
send('TOUCH_BEGIN', 5, 790, 2400, root);
send('TOUCH_END', 5, 790, 2450, root);
runTimers();
assert(!find(a => a instanceof Entry), 'tapping outside closes the folder');
assert(settings.values['home-layout'].includes('"Play"'), 'folder rename is saved');

// Drag an app out of a folder.
const games2 = new HomeLayout(settings.values['home-layout']).items.find(i => typeof i !== 'string');
tap(tile(itemId(games2)), 2500);
const inFolder = all(root).find(a => a.accessible_name === 'Lutris' && !a._mutsuItem);
assert(inFolder, 'folder shows its apps');
const [lx, ly] = inFolder.get_transformed_position();
send('TOUCH_BEGIN', lx + 5, ly + 5, 2600, inFolder);
runTimers();
send('TOUCH_UPDATE', lx + 60, ly + 60, 3200, inFolder);
assert(home.editing, 'dragging out of a folder enters edit mode');
assert(!find(a => a instanceof Entry), 'the folder closes while dragging out');
send('TOUCH_END', m.gridX + 5, m.gridY + 5, 3300, root);
runTimers();
let lay = new HomeLayout(settings.values['home-layout']);
assert.equal(lay.items[0], 'net.lutris.Lutris.desktop', 'app dragged out of the folder onto the grid');
assert(!lay.items.some(i => typeof i !== 'string' && i.apps.includes('net.lutris.Lutris.desktop')));

// Drag a grid app into the dock (edit mode: drag starts at once).
const dockBox = find(a => a.classes.has('mutsu-home-dock'));
const editor = tile('org.gnome.TextEditor.desktop');
const [ex, ey] = editor.get_transformed_position();
send('TOUCH_BEGIN', ex + 5, ey + 5, 3400, editor);
send('TOUCH_UPDATE', ex + 40, ey + 5, 3420, editor);
const [dkx, dky] = dockBox.get_transformed_position();
send("TOUCH_UPDATE", dkx + 90, dky + 10, 3450, editor);
send("TOUCH_END", dkx + 90, dky + 10, 3460, editor);
runTimers();
assert(favorites.isFavorite('org.gnome.TextEditor.desktop'), 'dropping on the dock adds the app');
assert.equal(favorites.list.at(-1), 'org.gnome.TextEditor.desktop', 'at the slot under the finger');
// Drag it back off the dock onto the grid: removed from the dock only.
const dockApp = find(a => a._mutsuDockApp === 'org.gnome.TextEditor.desktop');
const [ax, ay] = dockApp.get_transformed_position();
send('TOUCH_BEGIN', ax + 5, ay + 5, 3500, dockApp);
send('TOUCH_UPDATE', ax + 5, ay - 40, 3520, dockApp);
send('TOUCH_UPDATE', m.gridX + 50, m.gridY + 50, 3550, dockApp);
send('TOUCH_END', m.gridX + 50, m.gridY + 50, 3560, dockApp);
runTimers();
assert(!favorites.isFavorite('org.gnome.TextEditor.desktop'), 'dragging off the dock removes it from the dock');
assert(new HomeLayout(settings.values['home-layout']).items.includes('org.gnome.TextEditor.desktop'),
    '...and the app stays on Home');
tap(find(a => a.accessible_name === 'Done editing Home Screen'), 3600);

// Page swipe with finger tracking.
for (let i = 0; i < 40; i++)
    apps.push(makeApp(`extra${i}.desktop`, `Extra ${i}`));
appSystem.emit('installed-changed');
const strip2 = find(a => a.width === 1280 * home._pages.length && home._pages.length > 1);
assert(strip2, 'many apps make several pages');
send('TOUCH_BEGIN', 900, 400, 3000, root);
send('TOUCH_UPDATE', 700, 402, 3050, root);
assert.equal(strip2.translation_x, -200, 'pages follow the finger');
send('TOUCH_UPDATE', 400, 402, 3100, root);
send('TOUCH_END', 380, 402, 3110, root);
assert.equal(home._page, 1, 'a long swipe flips to the next page');

// Rotation reflows the grid.
monitor.width = 800; monitor.height = 1280;
layoutManager.emit('monitors-changed');
assert.equal(root.width, 800, 'Home follows rotation');
assert.equal(home._metrics.portrait, true);
monitor.width = 1280; monitor.height = 800;
layoutManager.emit('monitors-changed');

// New wallpaper actors must not cover Home.
const wallpaper = new Actor();
backgroundGroup.add_child(wallpaper);
backgroundGroup.emit('child-added', wallpaper);
assert.equal(backgroundGroup.children.at(-1), root, 'Home stays above the wallpaper');

sessionMode.isLocked = true; sessionMode.emit('updated');
assert.equal(root.visible, false, 'Home hides while locked');
sessionMode.isLocked = false; sessionMode.emit('updated');
home.destroy();
assert.equal(appSystem.handlerCount, 0, 'Home disconnects app signals');
assert.equal(settings.handlerCount, 0);
assert.equal(backgroundGroup.children.includes(root), false);
console.log('Tablet Home checks passed (behind windows, launch, pull search, menu, dock, jiggle reorder, folders, paging, rotation, lock, cleanup).');

// ---- Multitasking blades -------------------------------------------------------
const display = Object.assign(new Emitter(), {focus_window: null, list: [],
    get_tab_list() { return this.list; }});
const workspaces = [{index: () => 0, active: true}, {index: () => 1, active: false}];
const workspaceManager = Object.assign(new Emitter(), {
    get_n_workspaces: () => workspaces.length, get_active_workspace_index: () => 0,
    get_workspace_by_index: i => workspaces[i],
    append_new_workspace() { workspaces.push({index: () => workspaces.length - 1}); }});
const stage = {get_actor_at_pos: () => null};
const globalMock = {display, workspace_manager: workspaceManager, stage, get_current_time: () => 0};
let nextId = 1;
function makeWindow(app, title) {
    const w = Object.assign(new Emitter(), {app, title, id: nextId++, minimized: false, maximized: true,
        deleted: 0, workspace: workspaces[0],
        is_skip_taskbar: () => false, get_window_type: () => 0, get_id() { return this.id; },
        get_title() { return this.title; }, is_on_all_workspaces: () => false,
        get_workspace() { return this.workspace; }, change_workspace(ws) { this.workspace = ws; },
        get_compositor_private: () => new Actor(), get_frame_rect: () => ({width: 1280, height: 772}),
        is_maximized() { return this.maximized; }, maximize() { this.maximized = true; },
        unmaximize() { this.maximized = false; },
        minimize() { this.minimized = true; this.emit('notify::minimized'); },
        unminimize() { this.minimized = false; },
        delete() { this.deleted++; }});
    app.windows.push(w);
    return w;
}
const docA = makeWindow(apps[5], 'Notes.txt');
const docB = makeWindow(apps[5], 'Todo.txt');
const web = makeWindow(apps[0], 'Mutsu OS');
display.list = [web, docA, docB];
display.focus_window = web;
const splits = [];
const split = {arrange: (a, b) => splits.push(['split', a, b]), slideOver: w => splits.push(['slide', w])};
let homes = 0;
const {TabletBlades} = load('tabletBlades.js', ['TabletBlades'], {Clutter, GLib, Meta: {TabList: {NORMAL_ALL: 0},
    WindowType: {NORMAL: 0}, MaximizeFlags: null}, Shell, St, Main, ...geometry, ...router,
    global: globalMock, vbox});
const blades = new TabletBlades({monitor: () => monitor, split, home: () => homes++, windowButtons: () => true});
blades.show();
const broot = uiGroup.children.at(-1);
assert(blades.visible && modal === 1, 'blades open modally');
const ball = () => all(broot);
const bladeActors = () => ball().filter(a => a._mutsuBlade);
assert.equal(bladeActors().length, 2, 'one blade per app');
assert.equal(bladeActors()[1]._mutsuBlade.windows.length, 2, 'app windows grouped into one blade');
const panes = ball().filter(a => a._mutsuWindow);
assert.equal(panes.length, 3, 'every window is a pane');
assert.equal(ball().filter(a => a.classes.has('mutsu-light')).length, 9, 'traffic lights on every window');
const bsend = (type, x, y, time, source) => broot.emit('captured-event', {type: () => type,
    get_coords: () => [x, y], get_time: () => time, get_event_sequence: () => 1,
    get_source: () => source, get_button: () => 1});
const btap = (actor, t) => { bsend('TOUCH_BEGIN', 10, 10, t, actor); bsend('TOUCH_END', 10, 10, t + 40, actor); };
const light = (window, kind) => ball().find(a => a.classes.has(`mutsu-light-${kind}`) &&
    a.parent.parent._mutsuWindow === window);
btap(light(docA, 'minimize'), 0);
assert.equal(docA.minimized, true, 'yellow minimizes');
runTimers();
btap(light(docB, 'zoom'), 100);
assert.equal(docB.maximized, false, 'green floats a full-screen window');
runTimers();
btap(light(docB, 'close'), 200);
assert.equal(docB.deleted, 1, 'red closes (with the app\'s own unsaved-work prompt)');
// Swipe a pane up inside a multi-window blade: closes only that window.
const paneA = ball().find(a => a._mutsuWindow === docA);
bsend('TOUCH_BEGIN', 300, 400, 300, paneA);
bsend('TOUCH_UPDATE', 302, 300, 320, paneA);
bsend('TOUCH_UPDATE', 302, 200, 340, paneA);
bsend('TOUCH_END', 302, 200, 360, paneA);
assert.equal(docA.deleted, 1, 'swipe up on a pane closes that window');
assert.equal(web.deleted, 0);
// Swipe a single-window blade down: minimize.
const webBlade = bladeActors().find(b => b._mutsuBlade.windows.includes(web));
bsend('TOUCH_BEGIN', 300, 300, 400, webBlade);
bsend('TOUCH_UPDATE', 300, 360, 420, webBlade);
bsend('TOUCH_UPDATE', 300, 460, 440, webBlade);
bsend('TOUCH_END', 300, 460, 460, webBlade);
assert.equal(web.minimized, true, 'swipe down minimizes');
runTimers();
// Hold a blade and drop it on Desktop 2.
const space2 = ball().find(a => a._mutsuSpace === 1);
stage.get_actor_at_pos = () => space2;
const textBlade = bladeActors().find(b => b._mutsuBlade.windows.includes(docA));
bsend('TOUCH_BEGIN', 300, 300, 500, textBlade);
runTimers();
bsend('TOUCH_UPDATE', 500, 60, 1000, textBlade);
bsend('TOUCH_END', 500, 60, 1050, textBlade);
assert.equal(docA.workspace, workspaces[1], 'drop on a Space moves the app there');
stage.get_actor_at_pos = () => null;
runTimers();
// Split View from the blade action.
const splitButton = ball().find(a => a.accessible_name === 'Split View');
btap(splitButton, 1100);
const other = ball().find(a => a._mutsuWindow && a._mutsuWindow !== splitButton.parent.parent._mutsuBlade.windows[0]);
btap(other, 1200);
assert.equal(splits.at(-1)?.[0], 'split', 'Split View pairs two apps');
assert.equal(blades.visible, false, 'blades close after choosing');
// Keyboard: Escape returns to the previous app.
blades.show();
const broot2 = uiGroup.children.at(-1);
broot2.emit('key-press-event', {get_key_symbol: () => Clutter.KEY_Escape});
assert.equal(blades.visible, false);
assert.equal(modal, 0, 'modal released');
// Default tablet mode: no traffic lights (swipes close and minimize).
const plain = new TabletBlades({monitor: () => monitor, split, home: () => homes++});
plain.show();
assert.equal(all(uiGroup.children.at(-1)).filter(a => a.classes.has('mutsu-light')).length, 0,
    'traffic lights hidden unless window buttons are on');
plain.hide();
// Closing everything returns Home.
display.list = [];
blades.show();
assert.equal(homes, 1, 'no windows left: go Home');
assert.equal(display.handlerCount, 0, 'blades disconnect display signals');
console.log('Multitasking blades checks passed (per-app blades, panes, traffic lights, swipe close/minimize, Spaces drop, Split View, keyboard, cleanup).');

// ---- Pull-up dock: drag an app to a screen edge / Slide Over -------------
const geo2 = load('tabletGeometry.js', ['dockDropZone', 'cloneable', 'gripResize', 'isWindowMaximized'], {});
const arranged = [];
const fakeSplit = {pair: null, slides: [], arrange: (l, r) => arranged.push(['split', l, r]),
    slideOver: w => arranged.push(['slide', w])};
const current = {name: 'current', is_skip_taskbar: () => false};
const otherWin = {name: 'other', is_skip_taskbar: () => false};
apps[4].windows.push(otherWin); // Files has a window
display.focus_window = current;
display.handlerCount; // display is an Emitter with focus_window
const stageEmitter = new Emitter();
const globalDock = {display, stage: stageEmitter};
favorites.list = ['org.gnome.Nautilus.desktop'];
const layoutDock = Object.assign(layoutManager, {addChrome: a => uiGroup.add_child(a), removeChrome: a => uiGroup.remove_child(a)});
const {TabletDockPopup} = load('tabletDockPopup.js', ['TabletDockPopup'], {Clutter, GLib, Shell, St,
    AppFavorites, Main: {...Main, layoutManager: layoutDock}, dockDropZone: geo2.dockDropZone, cloneable: geo2.cloneable,
    ...router, windowForApp: (app, cb) => cb(app.get_windows()[0]), global: globalDock, vbox});
const popup = new TabletDockPopup(() => {}, () => monitor, fakeSplit);
popup.show();
const dockRoot = popup._box;
const filesButton = all(dockRoot).find(a => a._mutsuApp?.get_id() === 'org.gnome.Nautilus.desktop');
const dsend = (type, x, y, t) => dockRoot.emit('captured-event', {type: () => type,
    get_coords: () => [x, y], get_time: () => t, get_event_sequence: () => 1,
    get_source: () => filesButton, get_button: () => 1});
dockRoot.set_position(400, 688);
dsend('TOUCH_BEGIN', 420, 700, 0);
runTimers();
assert(popup._zones.visible, 'drop zones appear while carrying an app');
dsend('TOUCH_UPDATE', 60, 300, 600);
dsend('TOUCH_END', 60, 300, 650);
assert.deepEqual(arranged.at(-1), ['split', otherWin, current], 'left edge: Split View, new app on the left');
popup.show();
dsend('TOUCH_BEGIN', 420, 700, 1000);
runTimers();
dsend('TOUCH_UPDATE', 640, 300, 1600);
dsend('TOUCH_END', 640, 300, 1650);
assert.deepEqual(arranged.at(-1), ['slide', otherWin], 'middle: Slide Over');
popup.show();
const count = arranged.length;
dsend('TOUCH_BEGIN', 420, 700, 2000);
runTimers();
dsend('TOUCH_END', 425, 702, 2600);
assert.equal(arranged.length, count, 'dropped back on the dock: nothing happens');
popup.destroy();
console.log('Pull-up dock checks passed (carry, drop zones, edge Split View, Slide Over, cancel).');

// ---- Floating window resize grip -----------------------------------------
const floatWin = Object.assign(new Emitter(), {minimized: false, maximized: false,
    get_window_type: () => 0, is_skip_taskbar: () => false, is_fullscreen: () => false,
    is_maximized() { return this.maximized; }, allows_resize: () => true,
    rect: {x: 200, y: 150, width: 600, height: 400}, get_frame_rect() { return {...this.rect}; },
    move_resize_frame(_u, x, y, width, height) { this.rect = {x, y, width, height}; this.emit('size-changed'); }});
display.focus_window = floatWin;
const {TabletWindowGrips} = load('windowGrips.js', ['TabletWindowGrips'], {Clutter,
    Meta: {WindowType: {NORMAL: 0}}, St, Main: {...Main, layoutManager: layoutDock},
    isWindowMaximized: geo2.isWindowMaximized, gripResize: geo2.gripResize, global: globalDock});
const grips = new TabletWindowGrips({monitor: () => monitor, excluded: () => false});
assert.equal(grips._grip.visible, true, 'floating window gets a resize grip');
assert.deepEqual([grips._grip.x, grips._grip.y], [770, 520], 'at its bottom-right corner');
const gev = (type, x, y) => grips._grip.emit('event', {type: () => type, get_coords: () => [x, y],
    get_button: () => 1, get_event_sequence: () => 1});
gev('TOUCH_BEGIN', 790, 540);
gev('TOUCH_UPDATE', 890, 600);
gev('TOUCH_END', 890, 600);
assert.deepEqual(floatWin.rect, {x: 200, y: 150, width: 700, height: 460}, 'dragging the grip resizes');
assert.deepEqual([grips._grip.x, grips._grip.y], [870, 580], 'grip follows the corner');
floatWin.maximized = true;
floatWin.emit('size-changed');
assert.equal(grips._grip.visible, false, 'full-screen windows have no grip');
grips.destroy();
assert.equal(floatWin.handlerCount, 0);
console.log('Resize grip checks passed (shown for floating windows, resize, follow, hidden when full screen).');
