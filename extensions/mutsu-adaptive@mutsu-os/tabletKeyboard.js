import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
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
        this._connect(Main.layoutManager, 'monitors-changed', () => this._sync());
        this._connect(Main.keyboard, 'visibility-changed', () => this._sync());
        this._kbDrag = null;
        this._kbEvent = global.stage.connect('captured-event', (_s, event) => this._keyboardSwipe(event));
        this._sync();
    }

    _connect(object, name, callback) {
        this._signals.push([object, object.connect(name, callback)]);
    }

    _sync() {
        const keyboard = Main.keyboard.keyboardActor ?? Main.keyboard._keyboard;
        const box = Main.layoutManager.keyboardBox;
        if (keyboard)
            keyboard._relayout?.();
        if (box?.visible) {
            box.translation_y = 40;
            box.ease({translation_y: 0, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            this._liftApp(box.height || keyboard?.height || 280);
        } else {
            this._restoreApp();
        }
    }

    _liftApp(height) {
        const window = global.display.focus_window;
        if (!window || window.is_skip_taskbar())
            return;
        if (!this._lifted || this._lifted.window !== window)
            this._lifted = {window, rect: window.get_frame_rect()};
        const rect = this._lifted.rect;
        const next = Math.max(160, rect.height - height);
        window.unmaximize(Meta.MaximizeFlags.BOTH);
        window.move_resize_frame(false, rect.x, rect.y, rect.width, next);
    }

    _restoreApp() {
        if (!this._lifted)
            return;
        const {window, rect} = this._lifted;
        this._lifted = null;
        try {
            window.move_resize_frame(false, rect.x, rect.y, rect.width, rect.height);
            window.maximize(Meta.MaximizeFlags.BOTH);
        } catch (e) {}
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
        if (!box?.visible)
            return Clutter.EVENT_PROPAGATE;
        const type = event.type();
        const begin = type === Clutter.EventType.TOUCH_BEGIN || type === Clutter.EventType.BUTTON_PRESS;
        const end = type === Clutter.EventType.TOUCH_END || type === Clutter.EventType.BUTTON_RELEASE;
        const [, y] = event.get_coords();
        if (begin && y >= box.y && y <= box.y + 36) {
            this._kbDrag = y;
            return Clutter.EVENT_STOP;
        }
        if (this._kbDrag == null || !end)
            return Clutter.EVENT_PROPAGATE;
        const dismiss = y - this._kbDrag > 40;
        this._kbDrag = null;
        if (dismiss) {
            this._restoreApp();
            Main.keyboard.close();
        }
        return Clutter.EVENT_STOP;
    }

    destroy() {
        if (this._kbEvent)
            global.stage.disconnect(this._kbEvent);

        this._injections.clear();
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
            if (box?.visible) {
                box.translation_y = 40;
                box.ease({translation_y: 0, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            }
        }
        this._states.clear();
    }
}
