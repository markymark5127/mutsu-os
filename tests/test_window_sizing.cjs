// Mac-style window sizes: which new windows are resized, and to what. Usage:
//   node tests/test_window_sizing.cjs extensions/mutsu-branding@mutsu-os
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(process.argv[2], 'windowSizing.js'), 'utf8')
    .replace(/^import [\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
const {macFrame, FILL} = new Function(`${source}; return {macFrame, FILL};`)();

// 1920x1080 at 125%: a 1536x864 screen, minus a 32px top bar and the dock.
const area = {x: 0, y: 32, width: 1536, height: 760};
const W = Math.round(1536 * FILL), H = Math.round(760 * FILL);

// A maximized window becomes a centred window that nearly fills the area.
const max = macFrame(area, area, true);
assert.deepEqual(max, {x: Math.round((1536 - W) / 2), y: 32 + Math.round((760 - H) / 2), width: W, height: H});
assert.ok(max.x > 0 && max.y > area.y, 'margins on every side');
assert.ok(max.x + max.width < area.width && max.y + max.height < area.y + area.height);

// A screen-sized (but not maximized) window is brought in the same way.
assert.deepEqual(macFrame({x: 0, y: 32, width: 1536, height: 760}, area, false), max);

// Small windows (Calculator, Settings at its own size) are left alone.
assert.equal(macFrame({x: 300, y: 200, width: 800, height: 600}, area, false), null);

// Too tall only: keeps its width, gets a height that fits, centred.
const tall = macFrame({x: 100, y: 32, width: 900, height: 760}, area, false);
assert.equal(tall.width, 900);
assert.equal(tall.height, H);
assert.equal(tall.x, Math.round((1536 - 900) / 2));

// Second monitor offsets are respected.
const right = macFrame({x: 1536, y: 0, width: 1920, height: 1080}, {x: 1536, y: 0, width: 1920, height: 1040}, true);
assert.ok(right.x > 1536 && right.x + right.width < 1536 + 1920);

console.log('window sizing: ok');
