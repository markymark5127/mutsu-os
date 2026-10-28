# Mutsu OS native Japandi desktop acceptance

The OS identity must be present at the very **first GNOME Shell frame** on a
fresh installed user, without an autostart theme script or a first-login
GSettings writer. The compiled dconf system profile + installed extensions
produce the default desktop. Normal user preferences still take precedence.

## Build-time gate

The image build runs `packaging/verify-native-desktop.py` AFTER native
GNOME settings are compiled. The checker refuses to publish the image if:

- The `/etc/dconf/profile/user` does not prioritize `system-db:mutsu`.
- The compiled `/etc/dconf/db/mutsu` is missing.
- The Mutsu GNOME extensions (branding, dock, adaptive, global menu, Kiwi)
  are missing, incompatible with GNOME 50, or absent from enabled defaults.
- A fresh HOME resolves to Bazzite's logo or wallpaper, or a dark theme
  instead of Japandi.
- The old `mutsu-first-boot.desktop` autostart exists.

This is **not** a visual runtime test. Dconf and Shell metadata can be valid
while a GNOME extension throws an exception at enable time.

## Fresh VirtualBox install acceptance

Use a new blank UEFI virtual disk (keep prior failing VMs separate).
When ISO install completes and GNOME launches:

1. Confirm Mutsu Japandi wallpaper, Mutsu symbol and cream GNOME top bar,
   dark sage/charcoal floating dock, and no Bazzite logo menu.
2. Confirm only one dock, a working app grid, a usable Mutsu Search
   (Super+Space), and Mac-style window controls.
3. Confirm Mutsu Welcome appears as the onboarding UI and that it doesn't
   relaunch after completing setup. The onboarding **user service** is
   intentionally separate from appearance; it is not a theme script.
4. Open terminal:
   ```bash
   cat /etc/dconf/profile/user
   gsettings get org.gnome.shell enabled-extensions
   gsettings get org.gnome.desktop.background picture-uri
   gsettings get org.gnome.desktop.interface color-scheme
   gnome-extensions list --enabled
   gnome-extensions info mutsu-branding@mutsu-os
   gnome-extensions info dash-to-dock@micxgx.gmail.com
   ```
5. Switch to Cyberpunk and back; confirm wallpaper, GNOME Shell and
   application color preferences update. Restart GNOME and ensure the
   selected appearance persists.
6. Create **another fresh user account**. Its first session must again be
   Japandi without running a branding fix.
7. Verify an existing user's custom wallpaper and extension preferences
   are not reset when the OS updates.

If the installed OS still looks like Bazzite, **do not add another
login-time script**. Inspect the effective dconf profile and GNOME Shell
extension error state from step 4, fix the root cause in the image or
the GNOME extension, then rebuild.

## Boundaries

A custom Plymouth splash is distinct from the desktop and is kept behind
OSTree boot-safety checks; do not risk breaking the initramfs to change a
cosmetic logo. GTK4/libadwaita apps are not fully recolored by a GNOME Shell
stylesheet, so the final application-theme pass needs separate QA.
