# Mutsu OS Anaconda installer branding (Japandi)

These files replace the default Fedora/Bazzite blue sidebar on the Anaconda live installer.

## Files

| File | Purpose | Size |
|------|---------|------|
| `sidebar-bg.png` | Left sidebar background (Japandi sage-to-beige texture) | 360×1080 |
| `sidebar-logo.png` | "Mutsu" wordmark on transparent background | ~320×93 |
| `topbar-bg.png` | Solid sage top navigation bar | 1920×80 |
| `mutsu.css` | Stylesheet that points Anaconda at the images and sets brand color `#788773` | — |

## Install location (in the installer environment)

```
/usr/share/anaconda/pixmaps/sidebar-bg.png
/usr/share/anaconda/pixmaps/sidebar-logo.png
/usr/share/anaconda/pixmaps/topbar-bg.png
/usr/share/anaconda/pixmaps/mutsu.css
```

The CSS must be loaded by Anaconda (either by overriding `anaconda-gtk.css` or by ensuring the product stylesheet is picked up). On a bootc/anaconda-iso build this is typically done by copying the files into the image before the ISO is generated, or by supplying a `product.img`.

## Color

- Primary sage: `#788773` (matches the existing Mutsu wordmark SVG)
- Darker sage: `#5f6d5b`
