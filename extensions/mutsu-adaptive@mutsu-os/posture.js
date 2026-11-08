import {hingeTablet, hingeFromAccels} from './tabletGeometry.js';

// Hardware posture sources, combined:
//  1. Mutter's seat "touch-mode" (libinput SW_TABLET_MODE, or a touchscreen
//     with no keyboard/mouse attached).
//  2. Kernel tablet-mode switches Mutter does not interpret.
//  3. The hinge angle: an iio hinge sensor, or computed from the display and
//     base accelerometers. With an angle, the user can choose where tablet
//     mode starts (past flat, tent, fully folded, or a custom angle).
// Files are only polled when such a source exists. File access is injected
// (readFile, listDir) so it is testable in Node.

const SWITCH_PATHS = [
    '/sys/bus/platform/devices/tablet-mode-switch/tablet-mode',
    '/sys/devices/platform/tablet-mode-switch/tablet-mode',
    '/sys/class/input/tablet-mode',
];
const IIO = '/sys/bus/iio/devices';
const HINGE_FILES = ['in_angl0_raw', 'in_angl_raw', 'in_angl0_input'];
const MATRIX_FILES = ['in_accel_mount_matrix', 'in_mount_matrix', 'mount_matrix'];
export const ANGLE_POLL_MS = 500;
const SWITCH_POLL_MS = 2000;

// Where an accelerometer sits: the kernel's label ("accel-display",
// "accel-base") or udev's ACCEL_LOCATION (systemd hwdb).
function accelLocation(dir, readFile) {
    const label = (readFile(`${dir}/label`) ?? '').trim().toLowerCase();
    if (/display|lid|screen/.test(label))
        return 'display';
    if (/base|keyboard/.test(label))
        return 'base';
    const dev = (readFile(`${dir}/dev`) ?? '').trim();
    if (dev) {
        const udev = readFile(`/run/udev/data/c${dev}`) ?? '';
        const match = udev.match(/^E:ACCEL_LOCATION=(\w+)/m);
        if (match)
            return match[1] === 'base' ? 'base' : 'display';
    }
    return null;
}

export function parseMountMatrix(text) {
    if (!text)
        return null;
    const rows = text.trim().split(';').map(row => row.split(',').map(Number));
    return rows.length === 3 && rows.every(r => r.length === 3 && r.every(Number.isFinite)) ? rows : null;
}

export function findHardwareSources(readFile, listDir) {
    const sources = [];
    for (const path of SWITCH_PATHS) {
        if (readFile(path) !== null)
            sources.push({kind: 'switch', path});
    }
    const accels = {};
    for (const device of listDir(IIO)) {
        const dir = `${IIO}/${device}`;
        const hinge = HINGE_FILES.find(file => readFile(`${dir}/${file}`) !== null);
        if (hinge) {
            sources.push({kind: 'hinge', path: `${dir}/${hinge}`});
            continue;
        }
        if (readFile(`${dir}/in_accel_x_raw`) === null)
            continue;
        const where = accelLocation(dir, readFile);
        if (where && !accels[where]) {
            const matrix = MATRIX_FILES.map(f => parseMountMatrix(readFile(`${dir}/${f}`))).find(Boolean);
            accels[where] = {dir, matrix};
        }
    }
    if (accels.display && accels.base)
        sources.push({kind: 'accels', display: accels.display, base: accels.base});
    return sources;
}

function readVector({dir, matrix}, readFile) {
    const raw = ['x', 'y', 'z'].map(axis => parseFloat(readFile(`${dir}/in_accel_${axis}_raw`)));
    if (raw.some(v => !Number.isFinite(v)))
        return null;
    if (!matrix)
        return raw;
    return matrix.map(row => row[0] * raw[0] + row[1] * raw[1] + row[2] * raw[2]);
}

export function hasAngleSource(sources) {
    return sources.some(s => s.kind === 'hinge' || s.kind === 'accels');
}

// Current hinge angle in degrees, or null (no sensor / hinge pointing down).
export function readHingeAngle(sources, readFile) {
    for (const source of sources) {
        if (source.kind === 'hinge') {
            const value = parseInt(readFile(source.path) ?? '', 10);
            if (Number.isFinite(value))
                return value;
        } else if (source.kind === 'accels') {
            const display = readVector(source.display, readFile);
            const base = readVector(source.base, readFile);
            if (display && base) {
                const angle = hingeFromAccels(display, base);
                if (angle !== null)
                    return angle;
            }
        }
    }
    return null;
}

// threshold 0: the laptop's own tablet switch decides (angle at the usual
// 200 degrees only when there is no switch). threshold > 0: the angle.
export function readHardware(sources, readFile, previous, threshold = 0) {
    const angle = hasAngleSource(sources) ? readHingeAngle(sources, readFile) : null;
    if (threshold > 0 && hasAngleSource(sources))
        return hingeTablet(angle, previous, threshold) ?? previous ?? null;
    for (const source of sources) {
        if (source.kind !== 'switch')
            continue;
        const value = (readFile(source.path) ?? '').trim();
        if (value === '0' || value === '1')
            return value === '1';
    }
    return hingeTablet(angle, previous);
}

export class PostureMonitor {
    constructor({seat, readFile, listDir, poll, cancel, threshold = () => 0}, onChange) {
        this._seat = seat;
        this._readFile = readFile;
        this._poll = poll;
        this._cancel = cancel;
        this._threshold = threshold;
        this._onChange = onChange;
        this._seatId = 0;
        this._pollId = 0;
        this.seatTouch = this._seatTouch();
        this.hardware = null;
        this.angle = null;
        if (seat?.connect) {
            try {
                this._seatId = seat.connect('notify::touch-mode', () => {
                    this.seatTouch = this._seatTouch();
                    this._onChange();
                });
            } catch (e) {
                this._seatId = 0;
            }
        }
        this._sources = findHardwareSources(readFile, listDir);
        if (this._sources.length) {
            this._read();
            this._pollId = poll(hasAngleSource(this._sources) ? ANGLE_POLL_MS : SWITCH_POLL_MS, () => {
                if (this._read())
                    this._onChange();
            });
        }
    }

    // True when the user's chosen hinge angle decides tablet mode.
    get angleDecides() {
        return this._threshold() > 0 && hasAngleSource(this._sources);
    }

    get hasAngle() {
        return hasAngleSource(this._sources);
    }

    // Re-read after the threshold setting changes. Returns true on change.
    refresh() {
        return this._read();
    }

    _read() {
        if (hasAngleSource(this._sources))
            this.angle = readHingeAngle(this._sources, this._readFile);
        const next = readHardware(this._sources, this._readFile, this.hardware, this._threshold());
        if (next === this.hardware)
            return false;
        this.hardware = next;
        return true;
    }

    get description() {
        const parts = [this._seatId ? 'seat touch-mode' : null,
            ...this._sources.map(s => (s.kind === 'accels'
                ? `accelerometers ${s.display.dir} (display) + ${s.base.dir} (base)`
                : `${s.kind} ${s.path}`))].filter(Boolean);
        return parts.join(', ') || 'none';
    }

    _seatTouch() {
        try {
            return !!(this._seat?.touch_mode ?? this._seat?.get_touch_mode?.());
        } catch (e) {
            return false;
        }
    }

    destroy() {
        if (this._seatId)
            this._seat.disconnect(this._seatId);
        this._seatId = 0;
        if (this._pollId)
            this._cancel(this._pollId);
        this._pollId = 0;
    }
}
