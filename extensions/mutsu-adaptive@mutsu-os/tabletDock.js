// Use Dash-to-Dock's own visibility handling so Home/overview still shows
// the dock, and ordinary app windows can use the freed screen area.
export function applyTabletDock(settings) {
    const values = {
        'autohide': true,
        'intellihide': false,
        'manualhide': false,
        'autohide-in-fullscreen': true,
        'show-dock-urgent-notify': false,
        'dock-fixed': false,
    };
    const saved = new Map();
    let restored = false;
    const restore = () => {
        if (restored)
            return;
        for (const [key, value] of saved) {
            if (value === null)
                settings.reset(key);
            else
                settings.set_value(key, value);
        }
        restored = true;
    };
    try {
        for (const [key, value] of Object.entries(values)) {
            if (!settings.settings_schema.has_key(key))
                continue;
            saved.set(key, settings.get_user_value(key));
            settings.set_boolean(key, value);
        }
    } catch (error) {
        restore();
        throw error;
    }
    return restore;
}
