#!/usr/bin/env python3
"""Deterministically generates the pixel-art app icons.

Produces the icons referenced by public/manifest.json: a castle keep on a rocky
plateau under a night sky, drawn on a 32x32 logical grid and scaled up with
nearest-neighbour sampling so it stays crisp and chunky at every size.

Every exported size is a whole multiple of the 32px grid, so no pixel is ever
sampled at a fractional offset.

Run with: python3 scripts/generate_icons.py
"""

import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from generate_background import (  # noqa: E402
    ENCHANT_GLOW,
    MOUNTAIN_NEAR,
    SKY_HORIZON_LOWER,
    SKY_TOP,
    STAR_COOL,
    STAR_WARM,
    WINDOW_DARK,
    lerp_color,
)

GRID = 32
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "public"

# The background art keeps its castle in near-silhouette, which works at full
# screen but disappears at 32px. The icon inverts that relationship: parchment
# stone against the night sky, matching the ticket the rest of the UI is built
# from.
CASTLE_STONE = (0xE0, 0xCB, 0x96)
RIDGE_HIGHLIGHT = lerp_color(MOUNTAIN_NEAR, STAR_COOL, 0.28)
SKY_BASE_ROW = 21

COLORS = {
    "C": CASTLE_STONE,
    "W": WINDOW_DARK,
    "G": ENCHANT_GLOW,
    "M": MOUNTAIN_NEAR,
    "H": RIDGE_HIGHLIGHT,
    "*": STAR_WARM,
    "+": STAR_COOL,
}

# "." is sky and is painted by the gradient underneath.
ART = (
    "................................",
    "...*.........+..........*.......",
    "................................",
    ".......+.............*..........",
    "..*.........................+...",
    "................................",
    "............CC.CC.CC............",
    "............CCCCCCCC............",
    "............CCCWWCCC............",
    ".......C.C.CCCCCCCCCC.C.C.......",
    ".......CCCCCCCCCCCCCCCCCC.......",
    ".......CCWCCCCCWWCCCCCWCC.......",
    ".......CCCCCCCCCCCCCCCCCC.......",
    ".......CCWCCCCCCCCCCCCWCC.......",
    ".......CCCCCCCCCCCCCCCCCC.......",
    ".......CCCCCCCCGGCCCCCCCC.......",
    ".......CCCCCCCCGGCCCCCCCC.......",
    "......CCCCCCCCCGGCCCCCCCCC......",
    "......CCCCCCCCCGGCCCCCCCCC......",
    "......CCCCCCCCCCCCCCCCCCCC......",
    "....HHHHHHHHHHHHHHHHHHHHHHHH....",
    "...HMMMMMMMMMMMMMMMMMMMMMMMMH...",
    "..HMMMMMMMMMMMMMMMMMMMMMMMMMMH..",
    ".HMMMMMMMMMMMMMMMMMMMMMMMMMMMMH.",
    "HMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMH",
    "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
    "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
    "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
    "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
    "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
    "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
    "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
)


def build_base() -> Image.Image:
    """Draws the icon at its authored 32x32 size."""
    if len(ART) != GRID:
        raise ValueError(f"art has {len(ART)} rows, expected {GRID}")

    image = Image.new("RGB", (GRID, GRID))
    pixels = image.load()

    for y in range(GRID):
        t = min(y / SKY_BASE_ROW, 1.0)
        sky = lerp_color(SKY_TOP, SKY_HORIZON_LOWER, t)

        row = ART[y]
        if len(row) != GRID:
            raise ValueError(f"art row {y} is {len(row)} wide, expected {GRID}")

        for x, key in enumerate(row):
            pixels[x, y] = sky if key == "." else COLORS[key]

    return image


def scale(image: Image.Image, size: int) -> Image.Image:
    if size % image.width:
        raise ValueError(f"{size} is not a whole multiple of {image.width}")

    return image.resize((size, size), resample=Image.NEAREST)


def build_maskable(base: Image.Image, size: int) -> Image.Image:
    """Insets the art so it survives being cropped to a circle.

    A maskable icon may be clipped to any shape inside the icon bounds, and
    only the centre circle of 80% diameter is guaranteed to survive. The art is
    therefore laid into the middle half of a wider canvas, which keeps the
    castle well inside that circle. The padding is filled by clamping to the
    edge pixels, so the sky and the rock simply continue outwards rather than
    sitting on a flat border.
    """
    padded_grid = GRID * 2
    inset = GRID // 2
    padded = Image.new("RGB", (padded_grid, padded_grid))
    source = base.load()
    target = padded.load()

    for y in range(padded_grid):
        sy = min(max(y - inset, 0), GRID - 1)
        for x in range(padded_grid):
            sx = min(max(x - inset, 0), GRID - 1)
            target[x, y] = source[sx, sy]

    return scale(padded, size)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    base = build_base()

    written = []
    for name, size in (
        ("icon-192.png", 192),
        ("icon-512.png", 512),
        ("apple-touch-icon.png", 192),
    ):
        path = OUTPUT_DIR / name
        scale(base, size).save(path)
        written.append(path)

    maskable = OUTPUT_DIR / "icon-maskable-512.png"
    build_maskable(base, 512).save(maskable)
    written.append(maskable)

    # Saved at the authored size so the entries are exact rather than resampled.
    favicon = OUTPUT_DIR / "favicon.ico"
    base.save(favicon, format="ICO", sizes=[(GRID, GRID)])
    written.append(favicon)

    for path in written:
        print(f"Wrote {path}")


if __name__ == "__main__":
    main()
