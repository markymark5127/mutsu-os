import Clutter from 'gi://Clutter';
import St from 'gi://St';

// A vertical St.BoxLayout on every supported GNOME. GNOME 48 deprecated
// `vertical: true` in favour of `orientation`, and newer releases drop the
// old property, where passing it throws and stops tablet mode from starting.
export function vbox(props = {}) {
    const box = new St.BoxLayout(props);
    if ('orientation' in box)
        box.orientation = Clutter.Orientation.VERTICAL;
    else
        box.vertical = true;
    return box;
}
