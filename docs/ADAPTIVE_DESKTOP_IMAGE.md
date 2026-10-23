# Adaptive Desktop — image-level plan

This document tracks how Mutsu OS (the bootc image) will deliver the
convertible / 2-in-1 experience described in the ai-desktop product docs.

**Status:** specification and scaffolding. Not yet implemented as a GNOME
Shell extension or image default.

## Goal (from product vision)

On supported 2-in-1 hardware (Lenovo Yoga-class and similar):

- Detect real tablet posture via the kernel/libinput `SW_TABLET_MODE` switch
  (not merely rotation or missing keyboard events).
- On fold/detach: switch to tablet mode, reveal the Show Applications grid as
  Home, enlarge touch targets, maximize or tile newly launched apps, and
  enable gesture navigation.
- Gestures:
  - Swipe up from the bottom edge → return to Home / app grid.
  - Swipe up and hold → multitasking / Overview (show background windows).
  - Must not conflict with GNOME's existing bottom-edge on-screen keyboard
    gesture.
- On unfold: restore the Mac-like desktop (dock, normal scaling, windowed
  mode) without closing running applications.
- Always provide a manual Always Desktop / Always Tablet / Automatic control
  so the feature works even when hardware signals are imperfect.

## Image responsibilities (this repo)

1. Ship a GNOME Shell extension (or integrate/fork an existing one such as
   Touchshell) that owns posture detection, Home, and gestures.
2. Enable that extension by default on the image, with version pinning against
   the GNOME Shell release shipped by the Bazzite GNOME base.
3. Provide system dconf defaults and a first-run explanation so new users
   understand the mode and can disable it.
4. Keep the change reversible and avoid breaking keyboard/trackpad recovery.

## Next concrete steps

- Evaluate Touchshell (and TouchUp) against the current Bazzite GNOME Shell
  version for Auto/Always/Off tablet-mode behavior, edge gestures, and
  fullscreen app handling.
- Prototype a minimal Mutsu Shell extension that:
  - Listens for `LIBINPUT_SWITCH_TABLET_MODE`.
  - Shows the app grid on confirmed tablet transition.
  - Adds a bottom-edge swipe recognizer that coexists with the OSK.
- Add the extension to the image build and enable it for new users.
- Document hardware QA requirements (real Yoga-class device + VM fallback).

## Relationship to the ai-desktop app

The GTK Spotlight launcher remains available in both modes via Super+Space
and touch search. Adaptive Desktop is a Shell integration, not a fullscreen
GTK window. The app's onboarding wizard should eventually explain the mode
and offer the manual toggle, but the posture logic lives in the Shell layer
shipped by this image.

See also:
- ai-desktop `docs/ADAPTIVE_DESKTOP.md` (full product specification)
- ai-desktop `docs/PRODUCT_VISION.md`
