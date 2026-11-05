// Every system setting tablet mode changes goes through this journal. The
// user's original values are written to disk before the change, so a Shell
// crash, logout or power loss mid-tablet-mode is undone on the next enable.
//
// Dependencies are injected so the Node checks can run it without GLib:
//   load() -> string, save(string), open(schemaId) -> Gio.Settings | null,
//   parse(text) -> GLib.Variant

const print = variant => variant ? variant.print(true) : null;

export class SettingsJournal {
    constructor({load, save, open, parse}) {
        this._save = save;
        this._open = open;
        this._parse = parse;
        this._cache = new Map();
        try {
            const data = JSON.parse(load() || '{}');
            this._entries = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        } catch (e) {
            this._entries = {};
        }
    }

    get pending() { return Object.keys(this._entries).length; }

    settings(schemaId) {
        if (!this._cache.has(schemaId)) {
            let settings = null;
            try {
                settings = this._open(schemaId);
            } catch (e) {
                settings = null;
            }
            this._cache.set(schemaId, settings);
        }
        return this._cache.get(schemaId);
    }

    has(schemaId, key) {
        const settings = this.settings(schemaId);
        try {
            return !!settings?.settings_schema.has_key(key);
        } catch (e) {
            return false;
        }
    }

    // apply(settings) performs the change. Returns false if the schema or key
    // does not exist on this system (e.g. an extension is not installed).
    change(schemaId, key, apply) {
        if (!this.has(schemaId, key))
            return false;
        const settings = this.settings(schemaId);
        const id = `${schemaId}|${key}`;
        if (!this._entries[id]) {
            this._entries[id] = {schema: schemaId, key, original: print(settings.get_user_value(key))};
            this._persist();
        }
        apply(settings);
        this._entries[id].applied = print(settings.get_user_value(key));
        this._persist();
        return true;
    }

    // Put back one key early (e.g. a preference switched off mid-session).
    revert(schemaId, key) {
        const id = `${schemaId}|${key}`;
        const entry = this._entries[id];
        if (!entry)
            return;
        this._restoreEntries([entry]);
        delete this._entries[id];
        this._persist();
    }

    // Put back every original value. A key the user changed by hand while in
    // tablet mode is left alone: their newer choice wins.
    restore() {
        this._restoreEntries(Object.values(this._entries));
        this._entries = {};
        this._persist();
    }

    _restoreEntries(entries) {
        for (const entry of entries) {
            const settings = this.settings(entry.schema);
            if (!settings)
                continue;
            try {
                if (!settings.settings_schema.has_key(entry.key))
                    continue;
                if ('applied' in entry && print(settings.get_user_value(entry.key)) !== entry.applied)
                    continue;
                if (entry.original === null)
                    settings.reset(entry.key);
                else
                    settings.set_value(entry.key, this._parse(entry.original));
            } catch (e) {
                // One broken key must not keep the others from being restored.
            }
        }
    }

    _persist() {
        try {
            this._save(JSON.stringify(this._entries));
        } catch (e) {}
    }
}
