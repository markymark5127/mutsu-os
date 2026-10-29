const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2], 'utf8').replace('export ', '');
const applyTabletDock = new Function(`${source}; return applyTabletDock;`)();
const defaults = {'dock-fixed': true, autohide: false, intellihide: true,
    manualhide: false, 'autohide-in-fullscreen': false, 'show-dock-urgent-notify': true};
function fakeSettings() {
    const user = new Map([['autohide', {value: false}], ['intellihide', {value: true}]]);
    return {user, settings_schema: {has_key: key => key in defaults},
        get_user_value: key => user.get(key) ?? null,
        set_boolean: (key, value) => user.set(key, {value}),
        set_value: (key, value) => user.set(key, value), reset: key => user.delete(key),
        get: key => user.get(key)?.value ?? defaults[key]};
}
const settings = fakeSettings();
const original = new Map(settings.user);
const restore = applyTabletDock(settings);
assert.equal(settings.get('dock-fixed'), false, 'release always-visible dock');
assert.equal(settings.get('autohide'), true, 'hide outside Home');
assert.equal(settings.get('intellihide'), false, 'do not force dock visible when no overlap');
assert.equal(settings.get('manualhide'), false, 'Home dock remains available');
assert.equal(settings.get('autohide-in-fullscreen'), true);
assert.equal(settings.get('show-dock-urgent-notify'), false);
restore();
assert.deepEqual(settings.user, original, 'restore exact user overrides, including unset defaults');
restore();
assert.deepEqual(settings.user, original, 'cleanup is idempotent');
const partial = fakeSettings();
partial.settings_schema.has_key = key => key === 'dock-fixed';
applyTabletDock(partial)();
assert.deepEqual(partial.user, original, 'tolerate older schemas');
const failure = fakeSettings();
failure.set_boolean = (key, value) => {
    if (key === 'intellihide') throw new Error('simulated write failure');
    failure.user.set(key, {value});
};
assert.throws(() => applyTabletDock(failure), /simulated/);
assert.deepEqual(failure.user, original, 'failed setup rolls back partial changes');
console.log('Tablet dock checks passed (auto-hide, fullscreen, Home, restore, older schema, rollback).');
