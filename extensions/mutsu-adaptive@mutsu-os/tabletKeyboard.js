import Clutter from 'gi://Clutter';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Keyboard} from 'resource:///org/gnome/shell/ui/keyboard.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function tabletKeyboardSize(monitor) {
    const fraction = monitor.width > monitor.height ? 0.4 : 0.3;
    const height = Math.round(Math.min(monitor.height * 0.48,
        Math.max(240, monitor.height * fraction)));
    return {width: monitor.width, height,
        fontSize: Math.round(Math.max(16, Math.min(20, height / 15)))};
}

// How far to slide an app up when the on-screen keyboard opens: just enough
// to put the text cursor in the middle of the visible space above the
// keyboard, never more than the keyboard's height, never down.
export function keyboardShift(cursor, monitor, keyboardHeight) {
    const visibleBottom = monitor.y + monitor.height - keyboardHeight;
    const middle = monitor.y + (visibleBottom - monitor.y) / 2;
    const want = cursor.y + cursor.h / 2 - middle;
    return Math.round(Math.max(0, Math.min(keyboardHeight, want)));
}

// GNOME hides its emoji key for URL, e-mail and name fields and whenever an
// app sets NO_EMOJI (Firefox's address bar, many GTK entries). An iPad-style
// keyboard always has it, except on number, phone and PIN pads.
export function keyboardShowsEmoji(purpose, Purpose) {
    return ![Purpose?.DIGITS, Purpose?.NUMBER, Purpose?.PHONE, Purpose?.PIN]
        .filter(p => p !== undefined).includes(purpose);
}

// Retain GNOME's actual keys, input methods, suggestions, emoji and focus
// handling. Only its tablet geometry and square-key aspect constraint change.
export class TabletKeyboard {
    constructor() {
        this._states = new Map();
        this._signals = [];
        this._injections = new InjectionManager();
        const owner = this;
        for (const method of ['_relayout', '_setActiveLevel']) {
            if (typeof Keyboard.prototype[method] !== 'function')
                continue;
            this._injections.overrideMethod(Keyboard.prototype, method, original =>
                function (...args) {
                    const result = original.apply(this, args);
                    owner._apply(this);
                    return result;
                });
        }
        if (typeof Keyboard.prototype._shouldShowEmoji === 'function') {
            this._injections.overrideMethod(Keyboard.prototype, '_shouldShowEmoji', () =>
                function () {
                    return keyboardShowsEmoji(this._purpose, Clutter.InputContentPurpose);
                });
        }
        // The keyboard floats over the app. GNOME slides the app up by the
        // whole keyboard height; slide it only as far as needed to bring the
        // text cursor to the middle of the space left above the keyboard.
        if (typeof Keyboard.prototype.setCursorLocation === 'function') {
            this._injections.overrideMethod(Keyboard.prototype, 'setCursorLocation', original =>
                function (window, x, y, w, h) {
                    this._mutsuCursor = window ? {y, h} : null;
                    return original.call(this, window, x, y, w, h);
                });
        }
        if (typeof Keyboard.prototype._animateWindow === 'function') {
            this._injections.overrideMethod(Keyboard.prototype, '_animateWindow', original =>
                function (window, show) {
                    const actor = window?.get_compositor_private?.();
                    const monitor = Main.layoutManager.keyboardMonitor;
                    const height = Main.layoutManager.keyboardBox?.height ?? 0;
                    if (!show || !actor || !monitor || !this._mutsuCursor ||
                        typeof this._focusWindowStartY !== 'number')
                        return original.call(this, window, show);
                    const shift = keyboardShift(this._mutsuCursor, monitor, height);
                    const finalY = this._focusWindowStartY - shift;
                    actor.ease({
                        y: finalY,
                        duration: 150,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onStopped: () => {
                            if (window.get_compositor_private() !== actor)
                                return; // closed meanwhile
                            actor.y = finalY;
                            this._windowSlideAnimationComplete?.(window, finalY);
                        },
                    });
                    return undefined;
                });
        }
        this._connect(Main.layoutManager, 'monitors-changed', () => this._sync());
        this._connect(Main.keyboard, 'visibility-changed', () => this._sync());
        this._kbDrag = null;
        this._kbEvent = 0;
        if (globalThis.global?.stage?.connect) {
            this._kbEvent = global.stage.connect('captured-event',
                (_s, event) => this._keyboardSwipe(event));
        }
        this._sync();
    }

    _connect(object, name, callback) {
        this._signals.push([object, object.connect(name, callback)]);
    }

    _sync() {
        const keyboard = Main.keyboard.keyboardActor ?? Main.keyboard._keyboard;
        const box = Main.layoutManager.keyboardBox;
        // Rebuild the keys once so the emoji key shows on a keyboard that
        // was already built before tablet mode began.
        if (keyboard && !this._keysRebuilt && typeof keyboard._updateKeys === 'function') {
            this._keysRebuilt = true;
            try {
                keyboard._updateKeys();
            } catch (e) {
                console.error(`Mutsu keyboard: emoji key: ${e}`);
            }
        }
        if (keyboard)
            keyboard._relayout?.();
        // GNOME itself slides the focused app up when the keyboard would cover
        // the text cursor. Resizing the app as well made windows jump (and used
        // Meta.MaximizeFlags, which Mutter 49 removed, so it threw).
        if (Main.keyboard?.visible) { // keyboardBox stays visible after startup
            box.translation_y = 40;
            box.ease({translation_y: 0, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        }
    }


    _apply(keyboard) {
        const monitor = Main.layoutManager.keyboardMonitor ?? Main.layoutManager.primaryMonitor;
        const aspect = keyboard._aspectContainer;
        if (!monitor || !aspect || monitor.width <= 0 || monitor.height <= 0)
            return;
        if (!this._states.has(keyboard)) {
            const state = {style: keyboard.get_style(), ratio: aspect._ratio,
                destroyId: keyboard.connect('destroy', () => this._states.delete(keyboard))};
            this._states.set(keyboard, state);
        }
        const state = this._states.get(keyboard);
        const size = tabletKeyboardSize(monitor);
        const style = `${state.style ? `${state.style}; ` : ''}font-size: ${size.fontSize}px;`;
        keyboard.add_style_class_name('mutsu-tablet-keyboard');
        if (keyboard.get_style() !== style)
            keyboard.set_style(style);
        if (keyboard.width !== size.width)
            keyboard.width = size.width;
        // Respect larger minimums from accessibility fonts or input layouts.
        const minimum = keyboard.get_preferred_height?.(-1)?.[0] ?? 0;
        const height = Math.round(Math.min(monitor.height * 0.5, Math.max(size.height, minimum)));
        if (keyboard.height !== height)
            keyboard.height = height;
        // GNOME narrows the key grid to maintain approximately square keys.
        // Permit wide tablet keycaps instead. A finite ratio also keeps
        // preferred-size calculations valid; y_expand fills the key area.
        const ratio = size.width / Math.max(1, height * 0.5);
        if (aspect._ratio !== ratio) {
            aspect._ratio = ratio;
            aspect.queue_relayout();
        }
    }

    _keyboardSwipe(event) {
        const box = Main.layoutManager.keyboardBox;
        if (!box || !Main.keyboard?.visible)
            return Clutter.EVENT_PROPAGATE;
        const type = event.type();
        const begin = type === Clutter.EventType.TOUCH_BEGIN || type === Clutter.EventType.BUTTON_PRESS;
        const end = type === Clutter.EventType.TOUCH_END || type === Clutter.EventType.BUTTON_RELEASE;
        const [, y] = event.get_coords();
        // Watch only: the top strip holds the suggestions and the first key
        // row, so stopping the press there swallowed real key taps.
        if (begin && y >= box.y && y <= box.y + 36) {
            this._kbDrag = y;
            return Clutter.EVENT_PROPAGATE;
        }
        if (this._kbDrag == null || !end)
            return Clutter.EVENT_PROPAGATE;
        const dismiss = y - this._kbDrag > 60;
        this._kbDrag = null;
        if (dismiss)
            Main.keyboard.close();
        return Clutter.EVENT_PROPAGATE;
    }

    destroy() {
        if (this._kbEvent && globalThis.global?.stage?.disconnect)
            global.stage.disconnect(this._kbEvent);

        this._injections.clear();
        // Back to GNOME's own emoji-key rules on the desktop keyboard.
        const current = Main.keyboard?.keyboardActor ?? Main.keyboard?._keyboard;
        if (this._keysRebuilt && typeof current?._updateKeys === 'function') {
            try {
                current._updateKeys();
            } catch (e) {
                console.error(`Mutsu keyboard: restore keys: ${e}`);
            }
        }
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        for (const [keyboard, state] of this._states) {
            keyboard.disconnect(state.destroyId);
            keyboard.remove_style_class_name('mutsu-tablet-keyboard');
            keyboard.set_style(state.style);
            const ratio = keyboard._currentPage?.getRatio?.();
            if (ratio)
                keyboard._aspectContainer.setRatio(...ratio);
            else
                keyboard._aspectContainer._ratio = state.ratio;
            keyboard._relayout?.();
            const box = Main.layoutManager.keyboardBox;
            if (box && Main.keyboard?.visible) {
                box.translation_y = 40;
                box.ease({translation_y: 0, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            }
        }
        this._states.clear();
    }
}
