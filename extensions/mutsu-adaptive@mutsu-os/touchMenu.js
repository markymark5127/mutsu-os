import Clutter from 'gi://Clutter';
import St from 'gi://St';
import {makeTappable} from './touchRouter.js';

// Long-press quick-actions menu (iPadOS style), shown inside a touch surface
// so its taps go through that surface's TouchRouter.
export class TouchMenu {
    constructor(parent, router) {
        this._parent = parent;
        this._router = router;
        this._box = null;
    }

    get isOpen() { return this._box !== null; }

    // items: [{label, action, destructive?}] ; anchor: {x, y, width, height}
    open(items, anchor, bounds) {
        this.close();
        const box = new St.BoxLayout({vertical: true, style_class: 'mutsu-touch-menu',
            reactive: true});
        for (const item of items) {
            const row = new St.BoxLayout({style_class: item.destructive
                ? 'mutsu-touch-menu-item mutsu-touch-menu-destructive' : 'mutsu-touch-menu-item'});
            row.add_child(new St.Label({text: item.label, x_expand: true,
                y_align: Clutter.ActorAlign.CENTER}));
            makeTappable(row, () => {
                this.close();
                item.action();
            }, item.label);
            box.add_child(row);
        }
        this._parent.add_child(box);
        const [, natWidth] = box.get_preferred_width(-1);
        const width = Math.max(220, natWidth);
        const [, natHeight] = box.get_preferred_height(width);
        let x = anchor.x + anchor.width / 2 - width / 2;
        let y = anchor.y + anchor.height + 8;
        if (y + natHeight > bounds.y + bounds.height - 16)
            y = anchor.y - natHeight - 8;
        x = Math.max(bounds.x + 12, Math.min(bounds.x + bounds.width - width - 12, x));
        y = Math.max(bounds.y + 36, y);
        // Parent-relative coordinates.
        const [px, py] = this._parent.get_transformed_position();
        box.set_position(Math.round(x - px), Math.round(y - py));
        box.set_width(width);
        box.opacity = 0;
        box.scale_x = box.scale_y = 0.92;
        box.set_pivot_point(0.5, 0);
        box.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 140,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._box = box;
        // Stack on top of an open folder's modal; restored on close.
        this._previous = [this._router.modal, this._router.onOutsideModal];
        this._router.modal = box;
        this._router.onOutsideModal = () => this.close();
        box.get_first_child()?.grab_key_focus();
    }

    close() {
        if (!this._box)
            return;
        if (this._router.modal === this._box)
            [this._router.modal, this._router.onOutsideModal] = this._previous ?? [null, null];
        this._previous = null;
        this._box.destroy();
        this._box = null;
    }
}
