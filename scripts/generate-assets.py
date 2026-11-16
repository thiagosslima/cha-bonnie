"""Gera os recursos visuais derivados dos convites originais.

Uso: python3 scripts/generate-assets.py
Entradas: public/img/flores/*.png (recortadas dos convites) e public/img/bonnie-mask.png
Saídas: public/img/paper-tile.webp, public/og/*.png, public/favicon*.png
"""
import glob, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = lambda *p: os.path.join(ROOT, *p)
PAPER = (249, 248, 246)
flowers = [Image.open(f).convert('RGBA') for f in sorted(glob.glob(A('public/img/flores/*.png')))]
mask = Image.open(A('public/img/bonnie-mask.png')).split()[-1]


def paper(w, h, seed=7):
    rng = np.random.default_rng(seed)
    noise = rng.normal(0, 1, (h // 2 + 1, w // 2 + 1))
    n = Image.fromarray(((noise - noise.min()) / (noise.max() - noise.min()) * 255).astype('uint8'))
    n = n.resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(1.2))
    arr = np.asarray(n).astype(float) / 255 - 0.5
    base = np.zeros((h, w, 3)) + PAPER
    base += arr[..., None] * 7
    return Image.fromarray(np.clip(base, 0, 255).astype('uint8')).convert('RGBA')


def tile(size=640, scale=0.78, seed=3):
    rnd = random.Random(seed)
    img = paper(size, size)
    cells = 4
    step = size / cells
    order = list(range(len(flowers)))
    rnd.shuffle(order)
    k = 0
    for gy in range(cells):
        for gx in range(cells):
            f = flowers[order[k % len(order)]]; k += 1
            f = f.resize((int(f.width * scale), int(f.height * scale)), Image.LANCZOS)
            f = f.rotate(rnd.uniform(-35, 35), expand=True, resample=Image.BICUBIC)
            x = int(gx * step + rnd.uniform(0, step - 20) + (step / 2 if gy % 2 else 0))
            y = int(gy * step + rnd.uniform(0, step - 30))
            for dx in (-size, 0, size):
                for dy in (-size, 0, size):
                    img.alpha_composite(f, (x + dx, y + dy)) if 0 <= x + dx < size or 0 <= x + dx + f.width < size + f.width else None
    return img


def colored_bonnie(color, width):
    h = int(mask.height * width / mask.width)
    m = mask.resize((width, h), Image.LANCZOS)
    layer = Image.new('RGBA', m.size, color + (255,))
    layer.putalpha(m)
    return layer


def font(w, size):
    return ImageFont.truetype(A('scripts/assets/outfit-%d.ttf' % w), size)


def og(city, color, line, place):
    W, H = 1200, 630
    bg = tile(640)
    img = Image.new('RGBA', (W, H))
    for x in range(0, W, 640):
        for y in range(0, H, 640):
            img.alpha_composite(bg, (x, y))
    cw, ch = 780, 480
    cx, cy = (W - cw) // 2, (H - ch) // 2
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((cx, cy + 10, cx + cw, cy + ch + 10), 44, fill=(60, 50, 70, 60))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((cx, cy, cx + cw, cy + ch), 44, fill=(255, 255, 255, 255))
    b = colored_bonnie(color, 520)
    bx = (W - b.width) // 2 - 10
    by = cy + 50
    img.alpha_composite(b, (bx, by))
    d.text((bx + 122, by + 14), 'Chá de bebê da', font=font(300, 36), fill=(85, 82, 82))
    y = by + b.height + 40
    d.text((W // 2, y), line, font=font(400, 38), fill=color, anchor='mt')
    d.line((cx + 110, y - 14, cx + cw - 110, y - 14), fill=(85, 82, 82), width=2)
    d.line((cx + 110, y + 56, cx + cw - 110, y + 56), fill=(85, 82, 82), width=2)
    d.text((W // 2, y + 82), place, font=font(500, 28), fill=(85, 82, 82), anchor='mt')
    os.makedirs(A('public/og'), exist_ok=True)
    img.convert('RGB').save(A(f'public/og/{city}.png'), optimize=True)


if __name__ == '__main__':
    t = tile(640)
    t.convert('RGB').save(A('public/img/paper-tile.webp'), quality=82)
    LILAS, ROSA = (192, 164, 237), (227, 97, 146)
    og('guarulhos', LILAS, 'SÁBADO  ·  05 DEZ  ·  ÀS 16:00', 'GUARULHOS · SP')
    og('indaiatuba', ROSA, 'SÁBADO  ·  28 NOV  ·  ÀS 15:00', 'INDAIATUBA · SP')
    og('home', LILAS, 'INDAIATUBA 28/11  ·  GUARULHOS 05/12', 'CONFIRME SUA PRESENÇA')
    # favicon: flor rosa do convite
    f = flowers[0]
    s = max(f.size)
    sq = Image.new('RGBA', (s, s), (0, 0, 0, 0)); sq.alpha_composite(f, ((s - f.width) // 2, (s - f.height) // 2))
    sq.resize((64, 64), Image.LANCZOS).save(A('public/favicon.png'))
    apple = Image.new('RGBA', (180, 180), (255, 255, 255, 255))
    apple.alpha_composite(sq.resize((140, 140), Image.LANCZOS), (20, 20))
    apple.convert('RGB').save(A('public/apple-touch-icon.png'))
    print('ok')
