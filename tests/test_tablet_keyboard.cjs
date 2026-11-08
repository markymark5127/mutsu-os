const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2], 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');

class Emitter {
    constructor() { this.signals = new Map(); this.next = 0; }
    connect(name, fn) { this.signals.set(++this.next, [name, fn]); return this.next; }
    disconnect(id) { this.signals.delete(id); }
    emit(name) { for (const [signal, fn] of [...this.signals.values()]) if (name === signal) fn(this); }
}
class InjectionManager {
    constructor() { this.undo = []; }
    overrideMethod(object, name, create) {
        const original = object[name];
        object[name] = create(original);
        this.undo.push(() => object[name] = original);
    }
    clear() { this.undo.reverse().forEach(fn => fn()); }
}
const monitor = {width: 1024, height: 768};
const Main = {layoutManager: Object.assign(new Emitter(), {keyboardMonitor: monitor}),
    keyboard: Object.assign(new Emitter(), {keyboardActor: null})};
class Keyboard extends Emitter {
    constructor() {
        super(); this.style = 'color: white;'; this.classes = new Set();
        this._currentPage = {getRatio: () => [11,4]};
        this._aspectContainer = {_ratio: 11/4, queue_relayout() {}, setRatio(w,h) { this._ratio = w/h; }};
    }
    _relayout() { this.width = monitor.width; this.height = monitor.height / 3; return 7; }
    _setActiveLevel() { this._aspectContainer.setRatio(...this._currentPage.getRatio()); return 'native'; }
    get_style() { return this.style; }
    set_style(style) { this.style = style; }
    add_style_class_name(name) { this.classes.add(name); }
    remove_style_class_name(name) { this.classes.delete(name); }
}
const Purpose = {NORMAL: 0, ALPHA: 1, DIGITS: 2, NUMBER: 3, PHONE: 4, URL: 5, EMAIL: 6, NAME: 7,
    PASSWORD: 8, PIN: 9, TERMINAL: 10};
const ClutterMock = {InputContentPurpose: Purpose, InputContentHintFlags: {NO_EMOJI: 1 << 9},
    AnimationMode: {EASE_OUT_QUAD: 1, EASE_OUT_CUBIC: 2}, EventType: {}};
Keyboard.prototype._shouldShowEmoji = function () { return this._purpose === Purpose.NORMAL; };
Keyboard.prototype._updateKeys = function () { this.keysBuilt = (this.keysBuilt ?? 0) + 1; };
const {TabletKeyboard, tabletKeyboardSize, keyboardShift, keyboardShowsEmoji} = new Function('InjectionManager','Keyboard','Main','Clutter',
    `${source}; return {TabletKeyboard, tabletKeyboardSize, keyboardShift, keyboardShowsEmoji};`)(InjectionManager, Keyboard, Main, ClutterMock);
// Emoji key on every text keyboard (URL, e-mail, NO_EMOJI apps), not on number pads.
for (const p of ['NORMAL','ALPHA','URL','EMAIL','NAME','PASSWORD','TERMINAL'])
    assert.equal(keyboardShowsEmoji(Purpose[p], Purpose), true, p);
for (const p of ['DIGITS','NUMBER','PHONE','PIN'])
    assert.equal(keyboardShowsEmoji(Purpose[p], Purpose), false, p);
{
    const original = Keyboard.prototype._shouldShowEmoji;
    const emojiKeyboard = new Keyboard();
    Main.keyboard.keyboardActor = emojiKeyboard;
    const controller = new TabletKeyboard();
    assert.equal(emojiKeyboard.keysBuilt, 1, 'keys rebuilt once so the emoji key appears');
    emojiKeyboard._purpose = Purpose.URL; emojiKeyboard._contentHints = 1 << 9;
    assert.equal(emojiKeyboard._shouldShowEmoji(), true, 'URL field with NO_EMOJI still gets emoji');
    emojiKeyboard._purpose = Purpose.PIN;
    assert.equal(emojiKeyboard._shouldShowEmoji(), false);
    controller.destroy();
    assert.equal(Keyboard.prototype._shouldShowEmoji, original, 'restored on teardown');
    Main.keyboard.keyboardActor = null;
}

// Slide the app only enough to centre the cursor above the keyboard.
const screen = {x: 0, y: 0, width: 1280, height: 800};
assert.equal(keyboardShift({y: 100, h: 20}, screen, 320), 0, 'cursor already visible: app stays put');
assert.equal(keyboardShift({y: 500, h: 20}, screen, 320), 270, 'cursor moved to the middle of the space above');
assert.equal(keyboardShift({y: 780, h: 20}, screen, 320), 320, 'never more than the keyboard height');

for (const screen of [{width:1024,height:768}, {width:768,height:1024},
    {width:1280,height:800}, {width:640,height:360}]) {
    const size = tabletKeyboardSize(screen);
    assert.equal(size.width, screen.width, 'keyboard uses monitor width');
    assert(size.height <= screen.height * 0.48 + 1, 'keep room for the app');
    assert(size.fontSize >= 16 && size.fontSize <= 20);
    // GNOME narrows a key grid only if its allocated aspect exceeds its
    // configured ratio. With room for suggestions and padding, it must fill.
    const keyHeight = size.height - 48;
    const allocationRatio = (screen.width - 16) / keyHeight;
    const tabletRatio = size.width / (size.height * 0.5);
    assert(allocationRatio < tabletRatio, 'key grid is not narrowed to the center');
}
const originalRelayout = Keyboard.prototype._relayout;
const originalLevel = Keyboard.prototype._setActiveLevel;
const keyboard = new Keyboard();
Main.keyboard.keyboardActor = keyboard;
const controller = new TabletKeyboard();
assert.equal(keyboard.width,1024);
assert.equal(keyboard.height,307);
assert(keyboard.classes.has('mutsu-tablet-keyboard'));
assert(keyboard.style.includes('color: white;'));
assert(keyboard.style.includes('font-size: 20px;'));
assert.equal(keyboard._relayout(),7,'preserve native method return');
keyboard._currentPage = {getRatio: () => [13,4]};
assert.equal(keyboard._setActiveLevel(),'native');
assert(keyboard._aspectContainer._ratio > 13/4, 'language/number-page changes remain full width');
monitor.width=768;monitor.height=1024;
Main.layoutManager.emit('monitors-changed');
assert.equal(keyboard.width,768);
assert.equal(keyboard.height,307);
// Keyboard manager can destroy/recreate its actor as accessibility changes.
keyboard.emit('destroy');
const replacement = new Keyboard();
replacement.style='color: yellow;';
Main.keyboard.keyboardActor = replacement;
Main.keyboard.emit('visibility-changed');
assert(replacement.classes.has('mutsu-tablet-keyboard'));
controller.destroy();
assert.equal(Keyboard.prototype._relayout,originalRelayout);
assert.equal(Keyboard.prototype._setActiveLevel,originalLevel);
assert.equal(replacement.style,'color: yellow;');
assert.equal(replacement.classes.has('mutsu-tablet-keyboard'),false);
assert.equal(replacement._aspectContainer._ratio,11/4);
assert.equal(replacement.height,monitor.height/3, 'restore GNOME sizing on exit');
assert.equal(Main.keyboard.signals.size,0);
assert.equal(Main.layoutManager.signals.size,0);
// Existing actors restore the current input layout, not a stale saved ratio.
const current = new Keyboard();
Main.keyboard.keyboardActor = current;
const secondController = new TabletKeyboard();
current._currentPage={getRatio:()=>[12,5]};
current._setActiveLevel();
secondController.destroy();
assert.equal(current._aspectContainer._ratio,12/5);
const accessible = new Keyboard();
accessible.get_preferred_height = () => [400,400];
Main.keyboard.keyboardActor = accessible;
const accessibilityController = new TabletKeyboard();
assert.equal(accessible.height,400, 'respect a larger native minimum');
accessibilityController.destroy();
console.log('Tablet keyboard checks passed (full width, key grid, portrait, compact screen, layout changes, recreation, restoration, emoji key).');
