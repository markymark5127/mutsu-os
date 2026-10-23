# Mutsu Adaptive Desktop

GNOME Shell extension that turns Mutsu OS into a MacBook-like desktop when open and an iPad-like tablet when a 2-in-1 is folded.

## Current status (prototype)

- Panel menu with manual modes: Automatic / Always Desktop / Always Tablet.
- On tablet mode: opens the Show Applications grid as Home.
- Maximize-on-launch for ordinary windows while in tablet mode.
- Basic bottom-edge swipe recognizer (swipe-up → Home, longer swipe → Overview). Intentionally thin so it can coexist with the on-screen keyboard gesture.
- Settings schema for mode and open-home behavior.
- Installed system-wide by the image build and enabled by default for new users (overridable).

## Not yet implemented

- Reliable automatic detection of `LIBINPUT_SWITCH_TABLET_MODE` / Mutter tablet-mode signal (API varies by GNOME version; needs hardware testing on a Yoga-class device).
- Proper multi-touch gesture recognizer that does not fight the OSK or other edge gestures.
- Larger touch targets, dock collapse, and reversible restore of desktop settings when leaving tablet mode.
- Quick Settings toggle and first-run explanation.

## Testing

After installing the extension (or booting an image that includes it):

1. Enable it in Extension Manager if not already enabled.
2. Use the panel icon menu to choose Always Tablet — the app grid should appear and new windows should maximize.
3. Try a short upward swipe from the bottom edge (Home) and a longer one (Overview).
4. Choose Always Desktop to return.
5. On real Yoga-class hardware, verify whether a tablet-mode signal is available and wire the listener in `_applyFromSettings` / a new signal handler.

See the ai-desktop `docs/ADAPTIVE_DESKTOP.md` for the full product specification.
