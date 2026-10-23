# Mutsu Adaptive Desktop

GNOME Shell extension that turns Mutsu OS into a MacBook-like desktop when open and an iPad-like tablet when a 2-in-1 is folded.

## Current status (prototype)

- Panel menu with manual modes: Automatic / Always Desktop / Always Tablet.
- On Always Tablet (or when hardware reports tablet mode in the future): opens the Show Applications grid as Home.
- Settings schema for mode and open-home behavior.
- Installed system-wide by the image build and enabled by default for new users (overridable).

## Not yet implemented

- Reliable automatic detection of `LIBINPUT_SWITCH_TABLET_MODE` / Mutter tablet-mode signal (API varies by GNOME version; needs hardware testing).
- Bottom-edge swipe-up → Home and swipe-up-and-hold → Overview that coexists with the on-screen keyboard.
- Larger touch targets, maximize-on-launch for new windows, dock collapse, and reversible restore of desktop settings.
- Quick Settings toggle and first-run explanation.

## Testing

After installing the extension (or booting an image that includes it):

1. Enable it in Extension Manager if not already enabled.
2. Use the panel icon menu to choose Always Tablet — the app grid should appear.
3. Choose Always Desktop to return.
4. On real Yoga-class hardware, verify whether a tablet-mode signal is available and wire the listener.

See `docs/ADAPTIVE_DESKTOP_IMAGE.md` (when present) and the ai-desktop `docs/ADAPTIVE_DESKTOP.md` for the full product specification.
