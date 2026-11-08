import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Tablet mode has its own dock on Home, so the desktop dock (Dash to Dock)
// is hidden entirely. Its own autohide was not enough: it rebuilt itself
// visible after the screen rotated and sat on top of the Home dock.
// Dash to Dock recreates its dock on monitor changes, so new docks are
// caught as they are added and hidden too.
const DOCK_NAME = 'dashtodockContainer';

export class DashToDockHider {
    constructor(group = Main.layoutManager.uiGroup) {
        this._group = group;
        this._docks = new Map();
        this._addedId = group.connect('child-added', (_g, child) => this._hide(child));
        for (const child of group.get_children())
            this._hide(child);
    }

    _hide(actor) {
        if (actor?.name !== DOCK_NAME || this._docks.has(actor))
            return;
        const ids = [
            actor.connect('notify::visible', () => {
                if (actor.visible)
                    actor.hide();
            }),
            actor.connect('destroy', () => this._docks.delete(actor)),
        ];
        this._docks.set(actor, ids);
        actor.hide();
    }

    destroy() {
        this._group.disconnect(this._addedId);
        for (const [actor, ids] of this._docks) {
            for (const id of ids)
                actor.disconnect(id);
            actor.show();
        }
        this._docks.clear();
    }
}
