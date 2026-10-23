# Mutsu Adaptive Desktop

GNOME Shell extension that turns Mutsu OS into a MacBook-like desktop when open and an iPad-like tablet when a 2-in-1 is folded.

## Current status (Phase 1)

- Panel menu + **Quick Settings toggle** for Automatic / Always Desktop / Always Tablet.
- Debounced, idempotent enter/leave transitions.
- On tablet mode: opens the Show Applications grid as Home.
- Maximize-on-launch for ordinary windows while in tablet mode.
- Basic bottom-edge swipe recognizer (short → Home, longer → Overview).
- Posture watcher scaffold (ready for real `SW_TABLET_MODE` / Mutter signal).
- Settings schema and system-wide install for new users.

## Still needed for full Phase 1

- Connect the posture watcher to the actual hardware signal (Mutter tablet-mode property or a small libinput/evdev watcher that signals the extension).
- Save/restore only the settings the extension changes (dock visibility, temporary scale, etc.).
- Hardware QA on a real Yoga-class device.

## Not yet implemented (later phases)

- Proper multi-touch edge gestures that coexist cleanly with the OSK.
- Larger touch targets, dock collapse, and reversible appearance restore.
- First-run wizard explanation and test.

## Testing

1. Enable the extension.
2. Use the Quick Settings toggle or panel menu to switch Always Tablet / Always Desktop.
3. Confirm app grid opens, new windows maximize, and transitions are debounced.
4. On real convertible hardware, wire the posture watcher and verify automatic switching.

See the ai-desktop `docs/ADAPTIVE_DESKTOP.md` for the full product specification.
