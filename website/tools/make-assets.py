#!/usr/bin/env python3
"""Regenerates the website's image assets from ../branding/png (the real app icon).

Only needed when the icon changes; the results are committed in src/assets/.
Needs Pillow (`pip install pillow`) and, for the Open Graph images, Google Chrome (headless).

    python3 website/tools/make-assets.py
"""
import os
import struct
import subprocess
import sys
import tempfile
from io import BytesIO
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
BRANDING = ROOT / "branding" / "png"
ASSETS = HERE.parent / "src" / "assets"
IMG = ASSETS / "img"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

IMG.mkdir(parents=True, exist_ok=True)


def save_png(image, path):
    image.save(path, optimize=True)
    print("wrote", path.relative_to(ROOT), f"({path.stat().st_size // 1024} KB)")


# App icon (full-bleed iOS artwork; the page rounds the corners with CSS, iOS masks apple-touch-icon itself).
icon = Image.open(BRANDING / "icon-ios-1024.png").convert("RGB")
save_png(icon.resize((256, 256), Image.LANCZOS), IMG / "icon-256.png")
save_png(icon.resize((180, 180), Image.LANCZOS), ASSETS / "apple-touch-icon.png")

# Favicon: the stone alone (transparent), cropped tight so it stays readable at 16-32 px.
mark = Image.open(BRANDING / "mark-1024.png").convert("RGBA")
alpha = mark.split()[3].point(lambda a: 255 if a > 90 else 0)  # ignore the soft shadow
left, top, right, bottom = alpha.getbbox()
side = int(max(right - left, bottom - top) * 1.06)
cx, cy = (left + right) // 2, (top + bottom) // 2
box = (cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2)
square = mark.crop(box)
save_png(square.resize((32, 32), Image.LANCZOS), ASSETS / "favicon-32.png")
save_png(square.resize((192, 192), Image.LANCZOS), ASSETS / "favicon-192.png")

# favicon.ico with PNG-compressed 16, 32 and 48 px images (supported by every current browser).
sizes = [16, 32, 48]
blobs = []
for s in sizes:
    buf = BytesIO()
    square.resize((s, s), Image.LANCZOS).save(buf, format="PNG", optimize=True)
    blobs.append(buf.getvalue())
header = struct.pack("<HHH", 0, 1, len(sizes))
offset = 6 + 16 * len(sizes)
entries = b""
for s, blob in zip(sizes, blobs):
    entries += struct.pack("<BBBBHHII", s, s, 0, 0, 1, 32, len(blob), offset)
    offset += len(blob)
ico = HERE.parent / "src" / "favicon.ico"  # served at the site root, where browsers look for it
ico.write_bytes(header + entries + b"".join(blobs))
print("wrote", ico.relative_to(ROOT))

# Open Graph images (1200x630), one per language, rendered from a small HTML page.
TEMPLATE = """<!doctype html><html lang="{lang}"><meta charset="utf-8"><style>
html,body{{margin:0;width:1200px;height:630px}}
body{{display:flex;align-items:center;gap:72px;padding:0 96px;box-sizing:border-box;
  background:linear-gradient(135deg,#FBF9F5 0%,#EFE9DE 55%,#DED8CE 100%);
  font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Helvetica Neue",sans-serif;color:#16151B}}
img{{width:288px;height:288px;border-radius:22.4%;flex:none;box-shadow:0 24px 48px rgba(22,21,27,.18)}}
h1{{margin:0;font-size:96px;letter-spacing:-.02em;line-height:1}}
.ko{{margin:12px 0 0;font-size:40px;color:#7A5410;font-weight:600}}
p{{margin:32px 0 0;font-size:44px;line-height:1.35;font-weight:600;word-break:keep-all;max-width:660px}}
</style><body><img src="file://{icon}" alt=""><div><h1>Touchstone</h1><div class="ko">{sub}</div><p>{tagline}</p></div></body></html>"""

pages = {
    "ko": ("시금석", "iPhone이 Mac의 트랙패드가 되고, 틀린 정보는 진동으로 알려줘요"),
    "en": ("", "Your iPhone becomes a Mac trackpad and buzzes at false info"),
}
for lang, (sub, tagline) in pages.items():
    html = TEMPLATE.format(lang=lang, icon=BRANDING / "icon-ios-1024.png", sub=sub, tagline=tagline)
    if not sub:
        html = html.replace('<div class="ko"></div>', "")  # English page: no Korean sub-title
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "og.html"
        page.write_text(html, encoding="utf-8")
        out = IMG / f"og-{lang}.png"
        if not os.path.exists(CHROME):
            sys.exit("Google Chrome not found; skipping Open Graph images")
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
             "--window-size=1200,630", f"--screenshot={out}", f"file://{page}"],
            check=True, capture_output=True,
        )
        # Re-save through Pillow to drop the alpha channel and shrink the file.
        save_png(Image.open(out).convert("RGB"), out)
