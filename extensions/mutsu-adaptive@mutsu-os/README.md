# Mutsu Adaptive Desktop

GNOME Shell extension that turns Mutsu OS into a MacBook-like desktop when open and an iPad-like tablet when a 2-in-1 is folded.

## Current status (Phases 1–4)

### Phase 1 (done)
- Panel menu + Quick Settings toggle for Automatic / Always Desktop / Always Tablet.
- Debounced, idempotent enter/leave transitions.
- On tablet mode: opens the Show Applications grid as Home.
- Maximize-on-launch for ordinary windows while in tablet mode.
- Posture watcher scaffold (hardware signal not yet connected).

### Phase 2 (gestures)
- Experimental bottom-edge swipe (short → Home, longer → Overview), gated behind `enable-experimental-gestures` (default off).
- Gesture suppression for listed fullscreen/game windows (`gesture-exceptions`).
- Intentionally thin actor so it can coexist with the OSK bottom-edge gesture.

### Phase 3 (touch-first visuals)
- Temporary text scaling while in tablet mode (only if the user has not already customized text scaling; restored on exit).
- Best-effort dock autohide in tablet mode (Dash to Dock) and restore on exit.
- Optional rotation lock while in tablet mode.

### Phase 4 (polish)
- Reversible save/restore of the settings the extension changes.
- Gesture exception list for games/fullscreen apps.
- Clear recovery path: `gnome-extensions disable mutsu-adaptive@mutsu-os`.
- Extension remains disabled by default in the image until hardware QA is complete.

## Still needed (hardware)

- Wire Automatic mode to the real `SW_TABLET_MODE` / Mutter tablet-mode signal.
- Verify gestures do not fight the OSK, notification shade, or lock screen on real hardware.
- Confirm text scaling and dock changes are fully reversible and do not clobber accessibility settings.
- Real Yoga-class + second 2-in-1 QA (see product definition of done).

## Testing

1. Enable the extension in a disposable VM.
2. Switch to Always Tablet via Quick Settings or the panel menu.
3. Confirm app grid opens, new windows maximize, and (if enabled) bottom swipes work.
4. Switch back to Always Desktop and confirm text scaling / dock state are restored.
5. Add a game WM_CLASS to `gesture-exceptions` and confirm gestures are suppressed for that window.

See the ai-desktop `docs/ADAPTIVE_DESKTOP.md` for the full product specification.
