"""Draws the app icons (a speech bubble with sound bars) without any image library.

Usage: python scripts/make_icons.py
"""

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "frontend" / "icons"
BG = (47, 111, 94)
FG = (255, 255, 255)
SS = 4  # supersampling factor for anti-aliasing


def rounded_rect(x, y, x0, y0, x1, y1, r):
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r and x0 <= x <= x1 and y0 <= y <= y1


def shape(u, v, maskable):
    """u, v in 0..1. Returns 0 (transparent), 1 (background) or 2 (foreground)."""
    if maskable:
        bg = True  # maskable icons must fill the whole square
        s = 0.62  # keep the glyph inside the 80% safe zone
    else:
        bg = rounded_rect(u, v, 0, 0, 1, 1, 0.22)
        s = 0.78
    if not bg:
        return 0
    # Map into the glyph box centred in the icon.
    gx = (u - 0.5) / s + 0.5
    gy = (v - 0.5) / s + 0.5
    bubble = rounded_rect(gx, gy, 0.12, 0.16, 0.88, 0.74, 0.16)
    tail = 0.24 <= gx <= 0.42 and 0.72 <= gy <= 0.88 and (gx - 0.24) <= (0.88 - gy) * 1.1
    if bubble or tail:
        # Sound bars cut out of the bubble.
        for cx, h in ((0.33, 0.14), (0.44, 0.24), (0.56, 0.18), (0.67, 0.10)):
            if rounded_rect(gx, gy, cx - 0.035, 0.45 - h, cx + 0.035, 0.45 + h, 0.035):
                return 1
        return 2
    return 1


def render(size, maskable=False, opaque=False):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    k = shape((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, maskable)
                    if k:
                        c = FG if k == 2 else BG
                        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255
            n = SS * SS
            a = acc[3] / n
            if opaque:
                # Composite on the background colour (iOS ignores transparency).
                rgb = [int((acc[i] + (n - acc[3] / 255) * BG[i]) / n) for i in range(3)]
                row += bytes(rgb) + b"\xff"
            else:
                rgb = [int(acc[i] / (acc[3] / 255)) if acc[3] else 0 for i in range(3)]
                row += bytes(rgb) + bytes([int(a)])
        rows.append(bytes(row))
    return png(size, b"".join(rows))


def png(size, raw):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#2f6f5e"/>
  <g transform="translate(50 50) scale(.78) translate(-50 -50)" fill="#fff">
    <rect x="12" y="16" width="76" height="58" rx="16"/>
    <path d="M24 72h18L24 88z"/>
  </g>
  <g transform="translate(50 50) scale(.78) translate(-50 -50)" fill="#2f6f5e">
    <rect x="29.5" y="31" width="7" height="28" rx="3.5"/>
    <rect x="40.5" y="21" width="7" height="48" rx="3.5"/>
    <rect x="52.5" y="27" width="7" height="36" rx="3.5"/>
    <rect x="63.5" y="35" width="7" height="20" rx="3.5"/>
  </g>
</svg>
"""

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "icon.svg").write_text(SVG, encoding="utf-8")
    (OUT / "icon-192.png").write_bytes(render(192))
    (OUT / "icon-512.png").write_bytes(render(512))
    (OUT / "icon-maskable-512.png").write_bytes(render(512, maskable=True))
    (OUT / "apple-touch-icon.png").write_bytes(render(180, maskable=True, opaque=True))
    print("Icons written to", OUT)
