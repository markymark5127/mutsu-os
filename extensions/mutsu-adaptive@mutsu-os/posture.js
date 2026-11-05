import {hingeTablet} from './tabletGeometry.js';

// Hardware posture sources, combined:
//  1. Mutter's seat "touch-mode" (libinput SW_TABLET_MODE, or a touchscreen
//     with no keyboard/mouse attached).
//  2. Kernel tablet-mode switches and iio hinge angles that Mutter does not
//     interpret. Only polled when such a file actually exists.
// File access is injected (readFile, listDir) so it is testable in Node.

const SWITCH_PATHS = [
    '/sys/bus/platform/devices/tablet-mode-switch/tablet-mode',
    '/sys/devices/platform/tablet-mode-switch/tablet-mode',
    '/sys/class/input/tablet-mode',
];
const IIO = '/sys/bus/iio/devices';
const HINGE_FILES = ['in_angl0_raw', 'in_angl_raw', 'in_angl0_input'];

export function findHardwareSources(readFile, listDir) {
    const sources = [];
    for (const path of SWITCH_PATHS) {
        if (readFile(path) !== null)
            sources.push({kind: 'switch', path});
    }
    for (const device of listDir(IIO)) {
        for (const file of HINGE_FILES) {
            const path = `${IIO}/${device}/${file}`;
            if (readFile(path) !== null) {
                sources.push({kind: 'hinge', path});
                break;
            }
        }
    }
    return sources;
}

export function readHardware(sources, readFile, previous) {
    for (const source of sources) {
        const text = readFile(source.path);
        if (text === null)
            continue;
        const value = text.trim();
        if (source.kind === 'switch' && (value === '0' || value === '1'))
            return value === '1';
        if (source.kind === 'hinge') {
            const result = hingeTablet(parseInt(value, 10), previous);
            if (result !== null)
                return result;
        }
    }
    return null;
}

export class PostureMonitor {
    constructor({seat, readFile, listDir, poll, cancel}, onChange) {
        this._seat = seat;
        this._readFile = readFile;
        this._cancel = cancel;
        this._onChange = onChange;
        this._seatId = 0;
        this._pollId = 0;
        this.seatTouch = this._seatTouch();
        this.hardware = null;
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
            this.hardware = readHardware(this._sources, readFile, null);
            this._pollId = poll(2, () => {
                const next = readHardware(this._sources, this._readFile, this.hardware);
                if (next !== this.hardware) {
                    this.hardware = next;
                    this._onChange();
                }
            });
        }
    }

    get description() {
        const parts = [this._seatId ? 'seat touch-mode' : null,
            ...this._sources.map(s => `${s.kind} ${s.path}`)].filter(Boolean);
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
