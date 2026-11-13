#!/usr/bin/env python3
"""Draw Mutsu's "liquid shoji" Japandi wallpaper (3840x2160).

Rice-paper glass only reads as glass when there is colour and edge behind it
to blur. So instead of flat paper this paints a dawn: slate-to-peach sky, a
persimmon sun, soft colour fields, and layered silk ridges (Japandi ink-wash
mountains drawn as glossy fluid folds) with lit crests. The Mutsu mark floats
over the sun as a disc of liquid glass, with two small glass orbs, and an
out-of-focus bamboo branch sits behind the top bar. The dock sits over the
front ridge, where the gold crest light and deep sage meet.

--login draws the login-screen variant: the same dawn without the large
glass Mutsu mark, which would sit right behind the centred account list
(the login screen shows the wordmark at its foot instead).

Pillow only, deterministic. Usage:
    draw-liquid-glass.py OUT.png [--width 3840] [--login]
"""
import argparse
import math
import random

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

BASE_W, BASE_H = 3840, 2160


def hexc(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def stops_at(stops, t):
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        if t <= p1:
            u = 0 if p1 == p0 else (t - p0) / (p1 - p0)
            u = u * u * (3 - 2 * u)  # smoothstep: no banding at the stops
            return lerp(c0, c1, max(0.0, min(1.0, u)))
    return stops[-1][1]


def vgrad(stops, w, h, y0=0, y1=None):
    """Vertical gradient; positions 0..1 map onto y0..y1 (default full)."""
    y1 = h if y1 is None else y1
    col = Image.new('RGB', (1, h))
    col.putdata([stops_at(stops, min(1, max(0, (y - y0) / max(1, y1 - y0))))
                 for y in range(h)])
    return col.resize((w, h), Image.BILINEAR)


def hmask(w, h, profile):
    row = Image.new('L', (w, 1))
    row.putdata([round(255 * max(0.0, min(1.0, profile(x / w)))) for x in range(w)])
    return row.resize((w, h), Image.BILINEAR)


def radial(size, inner, outer, power=1.0):
    """Radial colour disc as RGB plus its circular 'L' mask."""
    n = 512
    img = Image.new('RGB', (n, n))
    px = []
    for y in range(n):
        for x in range(n):
            d = math.hypot(x - n / 2 + .5, y - n / 2 + .5) / (n / 2)
            px.append(lerp(inner, outer, min(1, d) ** power))
    img.putdata(px)
    return img.resize((size, size), Image.LANCZOS)


class Painter:
    def __init__(self, width):
        self.s = width / BASE_W
        self.W, self.H = width, round(BASE_H * self.s)

    def S(self, v):
        return v * self.s

    # ---- sky and colour fields -------------------------------------------
    def sky(self):
        return vgrad([(0.0, hexc('#3F5864')), (0.30, hexc('#6F8A88')),
                      (0.52, hexc('#B9B49E')), (0.62, hexc('#F1C79C')),
                      (1.0, hexc('#F6D2AC'))], self.W, self.H).convert('RGBA')

    def fields(self, img):
        # Painted small and blurred: these are light, not objects.
        sw, sh = 480, 270
        f = sw / BASE_W
        layer = Image.new('RGBA', (sw, sh), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        for cx, cy, rx, ry, col, a in [
            (520, 260, 980, 520, '#2F6E6C', 170),    # teal, top left
            (3420, 330, 900, 520, '#6D5C88', 150),   # dusk plum, top right
            (980, 1050, 760, 420, '#9DB89C', 120),   # sage haze
            (3150, 1020, 700, 380, '#DC8F86', 130),  # rose
            (2260, 1180, 1100, 600, '#F0743E', 205),  # persimmon glow
            (2240, 1120, 520, 360, '#F8C873', 210),   # gold core
        ]:
            d.ellipse([(cx - rx) * f, (cy - ry) * f, (cx + rx) * f, (cy + ry) * f],
                      fill=hexc(col) + (a,))
        layer = layer.filter(ImageFilter.GaussianBlur(34))
        layer = layer.resize((self.W, self.H), Image.BICUBIC)
        return Image.alpha_composite(img, layer)

    def sun(self, img, cx, cy, r):
        S = self.S
        size = round(2 * S(r))
        disc = radial(size, hexc('#FFE9B8'), hexc('#F08550'), power=1.6)
        m = Image.new('L', (size * 4, size * 4), 0)
        ImageDraw.Draw(m).ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
        m = m.resize((size, size), Image.LANCZOS)
        disc.putalpha(m)
        img.alpha_composite(disc, (round(S(cx - r)), round(S(cy - r))))
        return img

    # ---- silk ridges -----------------------------------------------------
    def ridge_points(self, base, waves, peaks):
        pts = []
        step = max(2, round(self.S(6)))
        for x in range(-step, self.W + 2 * step, step):
            bx = x / self.s
            y = base
            for amp, period, phase in waves:
                y += amp * math.sin(2 * math.pi * bx / period + phase)
            for px, h, w in peaks:
                y -= h * math.exp(-((bx - px) / w) ** 2)
            pts.append((x, self.S(y)))
        return pts

    def ridge(self, img, pts, top, bottom, warm, warmth, light, sun_x):
        W, H = self.W, self.H
        S = self.S
        crest = min(p[1] for p in pts)
        mask = Image.new('L', (W, H), 0)
        ImageDraw.Draw(mask).polygon(pts + [(W + 50, H + 50), (-50, H + 50)], fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(S(1.2)))

        # Mist pooling in the valley behind this fold.
        mist = mask.filter(ImageFilter.GaussianBlur(S(70)))
        mist = ImageChops.subtract(mist, mask)
        haze = Image.new('RGBA', (W, H), (250, 238, 222, 0))
        haze.putalpha(mist.point(lambda v: round(v * 0.30)))
        img = Image.alpha_composite(img, haze)

        cool = vgrad([(0, hexc(top)), (1, hexc(bottom))], W, H, round(crest), H)
        hot = vgrad([(0, hexc(warm)), (1, hexc(bottom))], W, H, round(crest), H)
        sx = sun_x / BASE_W
        glow = hmask(W, H, lambda t: warmth * math.exp(-((t - sx) / 0.20) ** 2))
        fill = Image.composite(hot, cool, glow).convert('RGBA')
        fill.putalpha(mask)
        img = Image.alpha_composite(img, fill)

        # Gloss: a lit crest like light along a glass fold, gold toward the sun.
        line = Image.new('L', (W, H), 0)
        ImageDraw.Draw(line).line(pts, fill=255, width=max(2, round(S(5))))
        near = hmask(W, H, lambda t: 0.25 + 0.75 * math.exp(-((t - sx) / 0.26) ** 2))
        for blur, alpha, col in [(S(26), 0.35 * light, (255, 214, 150)),
                                 (S(1.6), 1.0 * light, (255, 248, 232))]:
            a = ImageChops.multiply(line.filter(ImageFilter.GaussianBlur(blur)), near)
            a = ImageChops.multiply(a, mask.filter(ImageFilter.GaussianBlur(S(14))))
            a = a.point(lambda v, k=alpha * (4 if blur > S(10) else 1): min(255, round(v * k)))
            g = Image.new('RGBA', (W, H), col + (0,))
            g.putalpha(a)
            img = Image.alpha_composite(img, g)

        # Soft sheen just under the crest: the fold turning away from light.
        sheen = ImageChops.subtract(mask, mask.transform(
            (W, H), Image.AFFINE, (1, 0, 0, 0, 1, -S(60))).filter(ImageFilter.GaussianBlur(S(30))))
        sh = Image.new('RGBA', (W, H), (255, 240, 220, 0))
        sh.putalpha(sheen.point(lambda v: round(v * 0.12 * light)))
        return Image.alpha_composite(img, sh)

    # ---- glass -------------------------------------------------------------
    def glass(self, img, cx, cy, r, blur=26, logo=False):
        S = self.S
        cx, cy, r = S(cx), S(cy), S(r)
        pad = round(r * 1.5)
        box = (round(cx - pad), round(cy - pad), round(cx + pad), round(cy + pad))
        size = box[2] - box[0]

        # Shadow first, under the disc.
        sh = Image.new('L', (size, size), 0)
        o = pad - r
        ImageDraw.Draw(sh).ellipse([o, o + r * 0.12, o + 2 * r, o + 2 * r + r * 0.12], fill=255)
        sh = sh.filter(ImageFilter.GaussianBlur(r * 0.14)).point(lambda v: round(v * 0.30))
        shadow = Image.new('RGBA', (size, size), (34, 40, 36, 0))
        shadow.putalpha(sh)
        img.alpha_composite(shadow, box[:2])

        # Body: what's behind, blurred, lifted, a touch magnified like a lens.
        under = img.crop(box).filter(ImageFilter.GaussianBlur(S(blur)))
        zoom = 0.86
        zc = size * (1 - zoom) / 2
        lens = under.crop((round(zc), round(zc), round(size - zc), round(size - zc))).resize(
            (size, size), Image.BICUBIC)
        body = ImageEnhance.Color(lens.convert('RGB')).enhance(1.45)
        body = Image.blend(body, Image.new('RGB', (size, size), (255, 249, 238)), 0.14)
        # Rim: stronger lensing and brighter in a band near the edge.
        rim_src = under.crop((round(size * .02), round(size * .02),
                              round(size * .98), round(size * .98))).resize((size, size))
        rim_src = Image.blend(ImageEnhance.Color(rim_src.convert('RGB')).enhance(1.5),
                              Image.new('RGB', (size, size), (255, 252, 244)), 0.32)

        hi = 4
        disc = Image.new('L', (size * hi, size * hi), 0)
        ImageDraw.Draw(disc).ellipse([o * hi, o * hi, (o + 2 * r) * hi, (o + 2 * r) * hi], fill=255)
        disc = disc.resize((size, size), Image.LANCZOS)
        inner = Image.new('L', (size * hi, size * hi), 0)
        e = r * 0.10
        ImageDraw.Draw(inner).ellipse([(o + e) * hi, (o + e) * hi,
                                       (o + 2 * r - e) * hi, (o + 2 * r - e) * hi], fill=255)
        inner = inner.resize((size, size), Image.LANCZOS).filter(ImageFilter.GaussianBlur(r * 0.06))
        body = Image.composite(body, rim_src, inner)

        layer = body.convert('RGBA')
        layer.putalpha(disc)
        img.alpha_composite(layer, box[:2])

        def light(mask, col, alpha):
            g = Image.new('RGBA', (size, size), col + (0,))
            g.putalpha(ImageChops.multiply(mask, disc).point(lambda v: round(v * alpha)))
            img.alpha_composite(g, box[:2])

        # Edge light: bright top-left, a warm caustic bottom-right.
        ring = ImageChops.subtract(disc, inner.filter(ImageFilter.GaussianBlur(r * 0.02)))
        tl = Image.linear_gradient('L').rotate(45, expand=False).resize((size, size))
        tl = ImageChops.invert(tl)
        light(ImageChops.multiply(ring, tl), (255, 255, 255), 0.95)
        light(ImageChops.multiply(ring, ImageChops.invert(tl)), (255, 210, 160), 0.55)
        crisp = Image.new('L', (size * hi, size * hi), 0)
        ImageDraw.Draw(crisp).ellipse([o * hi, o * hi, (o + 2 * r) * hi, (o + 2 * r) * hi],
                                      outline=255, width=max(2, round(S(3) * hi)))
        crisp = crisp.resize((size, size), Image.LANCZOS)
        light(ImageChops.multiply(crisp, tl), (255, 255, 255), 0.9)
        # Specular bloom.
        spec = Image.new('L', (size, size), 0)
        ImageDraw.Draw(spec).ellipse([o + r * .38, o + r * .20, o + r * .98, o + r * .52], fill=255)
        light(spec.filter(ImageFilter.GaussianBlur(r * .10)), (255, 255, 255), 0.30)

        if logo:
            self._etched_mark(img, box, size, o, r, disc)
        return img

    def _etched_mark(self, img, box, size, o, r, disc):
        """The Mutsu waves, embossed into the glass (logo units: r=31 @ 50,50)."""
        k = r / 31
        hi = 3

        def pt(x, y):
            return ((o + r + (x - 50) * k) * hi, (o + r + (y - 50) * k) * hi)

        def quad(p0, p1, p2, n=400):
            return [pt(*(((1 - t) ** 2) * a + 2 * (1 - t) * t * b + t * t * c
                         for a, b, c in zip(p0, p1, p2)))
                    for t in (i / n for i in range(n + 1))]

        waves = [quad((25, 54), (50, 30), (75, 48)), quad((25, 65), (50, 43), (75, 59))]
        width = round(2.6 * k * hi)

        def stroke(dx, dy, w):
            m = Image.new('L', (size * hi, size * hi), 0)
            d = ImageDraw.Draw(m)
            for wv in waves:
                pts = [(x + dx * hi, y + dy * hi) for x, y in wv]
                for x, y in pts:
                    d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=255)
            return ImageChops.multiply(m.resize((size, size), Image.LANCZOS), disc)

        def paint(mask, col, alpha):
            g = Image.new('RGBA', (size, size), col + (0,))
            g.putalpha(mask.point(lambda v: round(v * alpha)))
            img.alpha_composite(g, box[:2])

        u = r / 31
        paint(stroke(0, u * 1.6, width).filter(ImageFilter.GaussianBlur(u * 1.4)), (40, 50, 44), 0.28)
        paint(stroke(0, 0, width), (255, 250, 240), 0.62)
        paint(stroke(-u * .5, -u * .9, max(2, round(width * 0.35))).filter(
            ImageFilter.GaussianBlur(u * .3)), (255, 255, 255), 0.85)

    # ---- foreground bamboo ---------------------------------------------------
    def bamboo(self, img):
        S = self.S
        W, H = self.W, self.H
        layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        rnd = random.Random(7)
        col = hexc('#2A3D33') + (190,)

        def stem(p0, p1, p2, w):
            pts = []
            for i in range(41):
                t = i / 40
                pts.append(tuple(S(((1 - t) ** 2) * a + 2 * (1 - t) * t * b + t * t * c)
                                 for a, b, c in zip(p0, p1, p2)))
            d.line(pts, fill=col, width=max(2, round(S(w))), joint='curve')
            return pts

        def leaf(x, y, ang, length, width):
            pts = []
            for i in range(25):
                t = i / 24
                half = width * math.sin(math.pi * t ** 0.7) ** 1.1
                pts.append((t * length, -half))
            for i in range(24, -1, -1):
                t = i / 24
                half = width * math.sin(math.pi * t ** 0.7) ** 1.1
                pts.append((t * length, half * 0.7))
            ca, sa = math.cos(ang), math.sin(ang)
            d.polygon([(S(x + px * ca - py * sa), S(y + px * sa + py * ca)) for px, py in pts],
                      fill=col)

        # A branch arching in from off-canvas, leaves hanging from it.
        main = stem((-120, -60), (420, 60), (820, 300), 10)
        twig = stem((300, 40), (360, 260), (300, 520), 7)
        for pts, n in [(main, 8), (twig, 5)]:
            for i in range(n):
                x, y = pts[round((i + 0.6) * (len(pts) - 1) / n)]
                x, y = x / self.s, y / self.s
                ang = math.radians(rnd.uniform(40, 80) if i % 2 else rnd.uniform(100, 150))
                leaf(x, y, ang, rnd.uniform(380, 500), rnd.uniform(46, 62))
        # Out of focus: in front of the lens, behind the bar.
        layer = layer.filter(ImageFilter.GaussianBlur(S(20)))
        return Image.alpha_composite(img, layer)

    # ---- finish ---------------------------------------------------------------
    def finish(self, img):
        W, H = self.W, self.H
        rgb = img.convert('RGB')
        # Rice-paper grain: faint, so the bar and dock blur still feel textured.
        noise = Image.effect_noise((W, H), 22).convert('RGB')
        rgb = Image.blend(rgb, ImageChops.overlay(rgb, noise), 0.09)
        # Gentle vignette.
        v = Image.radial_gradient('L').resize((W, H), Image.BICUBIC)
        v = v.point(lambda x: round(max(0, x - 120) * 0.30))
        rgb = Image.composite(Image.new('RGB', (W, H), (26, 30, 28)), rgb, v)
        return rgb


def draw(width, login=False):
    p = Painter(width)
    sun_x, sun_y = 2260, 1150
    img = p.sky()
    img = p.fields(img)
    img = p.sun(img, sun_x, sun_y, 340)

    ridges = [
        # base, waves (amp, period, phase), peaks (x, height, width), colours, warmth, light
        (1360, [(28, 1700, 0.4), (14, 640, 1.8)], [(3060, 250, 420), (820, 150, 520), (1900, 60, 300)],
         '#A9BCAB', '#86A08F', '#F2B892', 0.75, 0.55),
        (1510, [(34, 2100, 2.2), (16, 780, 0.6)], [(520, 210, 460), (2650, 120, 520)],
         '#7FA08D', '#5F8371', '#E9A27A', 0.60, 0.70),
        (1665, [(40, 2600, 1.1), (18, 900, 2.9)], [(3500, 230, 520), (1500, 110, 480)],
         '#5F8771', '#456B58', '#D8906A', 0.45, 0.80),
        (1830, [(46, 3000, 3.4), (20, 1100, 0.2)], [(1050, 170, 600), (2900, 90, 520)],
         '#466B5A', '#30503F', '#C7845F', 0.38, 0.90),
        # Front fold: the dock rides on this crest.
        # Its lit crest runs diagonally through the dock band (y 1990-2140).
        (2150, [(16, 1300, 2.4)], [(1350, 260, 650), (3600, 200, 420)],
         '#3E6352', '#1D3128', '#C98458', 0.55, 1.0),
    ]
    for base, waves, peaks, top, bottom, warm, warmth, lit in ridges:
        pts = p.ridge_points(base, waves, peaks)
        img = p.ridge(img, pts, top, bottom, warm, warmth, lit, sun_x)

    if not login:
        img = p.glass(img, 1820, 880, 430, blur=12, logo=True)
    img = p.glass(img, 3230, 560, 120, blur=18)
    img = p.glass(img, 2860, 1330, 64, blur=12)
    img = p.bamboo(img)
    return p.finish(img)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--width', type=int, default=BASE_W)
    ap.add_argument('--login', action='store_true',
                    help='login-screen variant without the large glass mark')
    a = ap.parse_args()
    draw(a.width, a.login).save(a.out, optimize=True)


if __name__ == '__main__':
    main()
