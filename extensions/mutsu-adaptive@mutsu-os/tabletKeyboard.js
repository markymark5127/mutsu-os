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
        this._sync();
    }

    _connect(object, name, callback) {
        this._signals.push([object, object.connect(name, callback)]);
    }

    _sync() {
        const keyboard = Main.keyboard.keyboardActor ?? Main.keyboard._keyboard;
        if (keyboard)
            keyboard._relayout?.();
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

    destroy() {
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
        }
        this._states.clear();
    }
}
