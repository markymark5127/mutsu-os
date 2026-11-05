import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {classifyDrag} from './tabletGeometry.js';

// One recogniser per touch surface (Home, multitasking). Tap targets are
// plain actors carrying `_mutsuTap` / `_mutsuLongPress` callbacks instead of
// St.Buttons, so nothing grabs the pointer mid-gesture: a swipe that starts
// on an icon pages Home, a hold opens its menu, and a tap launches it.
//
// Delegate hooks (all optional):
//   dragStart(kind, s) -> false to ignore this drag
//   drag(kind, dx, dy, s), dragEnd(kind, dx, dy, velocity, s)
//   longPress(s) -> true if handled (then held moves go to:)
//   heldMove(dx, dy, s), heldEnd(s)
//   tap(s) -> true if handled, cancel(s)
// `s` = {x, y, startX, startY, source, kind, held}

export const LONG_PRESS_MS = 480;

export function findHandler(source, root, name) {
    for (let actor = source; actor; actor = actor.get_parent?.()) {
        if (actor[name])
            return actor;
        if (actor === root)
            break;
    }
    return null;
}

export class TouchRouter {
    constructor(actor, delegate) {
        this._actor = actor;
        this._delegate = delegate;
        this._state = null;
        this._timer = 0;
        this.modal = null;
        this.onOutsideModal = null;
        this._eventId = actor.connect('captured-event', (_actor, event) => this._event(event));
    }

    get active() { return this._state !== null; }

    _event(event) {
        const T = Clutter.EventType;
        const type = event.type();
        const touch = type === T.TOUCH_BEGIN || type === T.TOUCH_UPDATE ||
            type === T.TOUCH_END || type === T.TOUCH_CANCEL;
        const begin = type === T.TOUCH_BEGIN || type === T.BUTTON_PRESS;
        const end = type === T.TOUCH_END || type === T.BUTTON_RELEASE;
        const move = type === T.TOUCH_UPDATE || type === T.MOTION;
        if (!touch && !begin && !end && !move)
            return Clutter.EVENT_PROPAGATE;
        const sequence = touch ? event.get_event_sequence() : null;
        const [x, y] = event.get_coords();
        const source = event.get_source();

        if (begin) {
            if (this._state)
                return Clutter.EVENT_STOP; // second finger: ignore while tracking
            if (!touch && event.get_button?.() !== 1)
                return Clutter.EVENT_PROPAGATE;
            if (findHandler(source, this._actor, '_mutsuPassthrough'))
                return Clutter.EVENT_PROPAGATE; // text entries keep native handling
            if (this.modal && !this.modal.contains(source)) {
                this.onOutsideModal?.();
                this._state = {sequence, consumed: true};
                return Clutter.EVENT_STOP;
            }
            const time = event.get_time();
            this._state = {sequence, source, x, y, startX: x, startY: y, kind: null,
                held: false, lastX: x, lastTime: time, velocity: 0};
            this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, LONG_PRESS_MS, () => {
                this._timer = 0;
                this._longPress();
                return GLib.SOURCE_REMOVE;
            });
            return Clutter.EVENT_STOP;
        }

        const s = this._state;
        if (!s || s.sequence !== sequence)
            return s ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        if (s.consumed) {
            if (end || type === T.TOUCH_CANCEL)
                this._state = null;
            return Clutter.EVENT_STOP;
        }
        if (type === T.TOUCH_CANCEL) {
            this._reset();
            this._delegate.cancel?.(s);
            return Clutter.EVENT_STOP;
        }
        s.x = x;
        s.y = y;
        const dx = x - s.startX, dy = y - s.startY;
        const time = event.get_time();
        if (time > s.lastTime) {
            s.velocity = (x - s.lastX) / (time - s.lastTime);
            s.lastX = x;
            s.lastTime = time;
        }
        if (move) {
            if (s.held) {
                this._delegate.heldMove?.(dx, dy, s);
            } else if (s.kind === null) {
                const kind = classifyDrag(dx, dy);
                if (kind) {
                    this._clearTimer();
                    s.kind = this._delegate.dragStart?.(kind, s) === false ? 'ignored' : kind;
                }
            }
            if (s.kind && s.kind !== 'ignored')
                this._delegate.drag?.(s.kind, dx, dy, s);
            return Clutter.EVENT_STOP;
        }
        // end
        this._reset();
        if (s.held)
            this._delegate.heldEnd?.(s);
        else if (s.kind && s.kind !== 'ignored')
            this._delegate.dragEnd?.(s.kind, dx, dy, s.velocity, s);
        else if (!s.kind && !this._delegate.tap?.(s))
            findHandler(s.source, this._actor, '_mutsuTap')?._mutsuTap();
        return Clutter.EVENT_STOP;
    }

    _longPress() {
        const s = this._state;
        if (!s || s.kind || s.consumed)
            return;
        let handled = this._delegate.longPress?.(s);
        if (handled === undefined) {
            const target = findHandler(s.source, this._actor, '_mutsuLongPress');
            handled = target ? target._mutsuLongPress(s) !== false : false;
        }
        s.held = !!handled;
    }

    _clearTimer() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
    }

    _reset() {
        this._clearTimer();
        this._state = null;
    }

    cancel() {
        const s = this._state;
        this._reset();
        if (s && !s.consumed)
            this._delegate.cancel?.(s);
    }

    destroy() {
        this._reset();
        if (this._eventId)
            this._actor.disconnect(this._eventId);
        this._eventId = 0;
    }
}

// Make an actor a keyboard- and touch-activatable target.
export function makeTappable(actor, onTap, accessibleName = null) {
    actor.reactive = true;
    actor.can_focus = true;
    actor.track_hover = true;
    if (accessibleName)
        actor.accessible_name = accessibleName;
    actor._mutsuTap = onTap;
    actor.connect('key-press-event', (_a, event) => {
        const key = event.get_key_symbol();
        if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter || key === Clutter.KEY_space) {
            onTap();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });
    return actor;
}
