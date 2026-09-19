#!/usr/bin/env python3
"""Deterministically generates the pixel-art enchanted castle background.

Produces src/assets/castle-mountain.png: a night sky, layered mountain
silhouettes, and a glowing enchanted castle perched on the tallest peak.
The scene is authored on a small logical grid and nearest-neighbor scaled up,
so it stays crisp and chunky when the browser stretches it with
`image-rendering: pixelated`.

Run with: python3 scripts/generate_background.py
"""

import math
import random
from pathlib import Path

from PIL import Image

# Logical pixel grid. The final PNG is this size multiplied by PIXEL_SCALE.
GRID_WIDTH = 120
GRID_HEIGHT = 68
PIXEL_SCALE = 4

SEED = 20240521

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "src" / "assets" / "castle-mountain.png"

# Palette shared with src/styles.css so the scene matches the rest of the UI.
SKY_TOP = (0x18, 0x13, 0x3C)
SKY_HORIZON_UPPER = (0x10, 0x14, 0x32)
SKY_HORIZON_LOWER = (0x17, 0x24, 0x3A)
SKY_BOTTOM = (0x0A, 0x10, 0x24)
STAR_WARM = (0xF8, 0xE7, 0xB0)
STAR_COOL = (0x8B, 0xA5, 0xD7)
MOUNTAIN_FAR = (0x1C, 0x29, 0x3D)
MOUNTAIN_NEAR = (0x29, 0x38, 0x4B)
CASTLE_SILHOUETTE = (0x12, 0x17, 0x2B)
CASTLE_SHADOW = (0x0B, 0x0E, 0x1E)
WINDOW_DARK = (0x05, 0x06, 0x12)
ENCHANT_GLOW = (0x8B, 0x6F, 0xD8)
SPARKLE = (0xC9, 0xB8, 0xF2)

HORIZON_ROW = int(GRID_HEIGHT * 0.52)


def lerp_color(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def paint_sky(pixels):
    for y in range(GRID_HEIGHT):
        if y <= HORIZON_ROW:
            t = y / max(HORIZON_ROW, 1)
            color = lerp_color(SKY_TOP, SKY_HORIZON_UPPER, t)
        else:
            t = (y - HORIZON_ROW) / max(GRID_HEIGHT - 1 - HORIZON_ROW, 1)
            color = lerp_color(SKY_HORIZON_LOWER, SKY_BOTTOM, t)

        for x in range(GRID_WIDTH):
            pixels[x, y] = color


def scatter_stars(pixels, rng):
    star_rows = range(0, HORIZON_ROW - 2)

    for _ in range(64):
        x = rng.randrange(GRID_WIDTH)
        y = rng.choice(star_rows)
        tint = rng.choice((STAR_WARM, STAR_COOL))
        # Keep stars faint so they sit behind the UI instead of competing with it.
        intensity = rng.uniform(0.10, 0.30)
        pixels[x, y] = lerp_color(pixels[x, y], tint, intensity)


def jagged_heights(rng, base_row, amplitude, peak_column=None, peak_row=None):
    heights = []
    current = base_row

    for x in range(GRID_WIDTH):
        current += rng.randint(-2, 2)
        current = max(base_row - amplitude, min(base_row + amplitude // 2, current))
        heights.append(current)

    if peak_column is not None and peak_row is not None:
        # Blend a single prominent peak into the ridge line with a smooth
        # cosine falloff (rather than a linear one) so the mountain widens
        # naturally beneath the summit instead of reading as a thin spike,
        # while the castle still sits on one unmistakable highest point.
        spread = 34

        for x in range(GRID_WIDTH):
            distance = abs(x - peak_column)

            if distance <= spread:
                influence = (math.cos(math.pi * distance / spread) + 1) / 2
                heights[x] = round(heights[x] + (peak_row - heights[x]) * influence)

    return heights


def paint_ridge(pixels, heights, color):
    for x, top in enumerate(heights):
        for y in range(top, GRID_HEIGHT):
            pixels[x, y] = color

    return heights


def draw_castle(pixels, peak_column, peak_row):
    # Coordinates are relative to the peak, so the whole castle reads as one
    # readable silhouette: a central keep flanked by two shorter towers,
    # crenellated walls, and a gatehouse — sized generously so it stays
    # unmistakably a castle even at the small native grid resolution.
    left = peak_column - 10
    keep_top = peak_row - 9
    tower_top = peak_row - 7
    wall_top = peak_row - 4

    def px(x, y, color):
        if 0 <= x < GRID_WIDTH and 0 <= y < GRID_HEIGHT:
            pixels[x, y] = color

    # Soft enchanted glow behind the towers.
    for gy in range(keep_top - 5, peak_row + 1):
        for gx in range(left - 6, left + 22):
            if 0 <= gx < GRID_WIDTH and 0 <= gy < GRID_HEIGHT:
                distance = ((gx - peak_column) ** 2 + (gy - (keep_top + 4)) ** 2) ** 0.5
                if distance < 15 and pixels[gx, gy] not in (MOUNTAIN_NEAR, MOUNTAIN_FAR):
                    t = max(0.0, 1 - distance / 15)
                    pixels[gx, gy] = lerp_color(pixels[gx, gy], ENCHANT_GLOW, t * 0.4)

    # Curtain wall.
    for x in range(left, left + 21):
        for y in range(wall_top, peak_row + 6):
            px(x, y, CASTLE_SILHOUETTE)

    for x in range(left, left + 21, 2):
        px(x, wall_top - 1, CASTLE_SILHOUETTE)

    # Side towers.
    for tower_x in (left + 1, left + 16):
        for x in range(tower_x, tower_x + 4):
            for y in range(tower_top, peak_row + 6):
                px(x, y, CASTLE_SILHOUETTE)

        px(tower_x, tower_top - 1, CASTLE_SILHOUETTE)
        px(tower_x + 3, tower_top - 1, CASTLE_SILHOUETTE)
        px(tower_x + 1, tower_top - 2, CASTLE_SILHOUETTE)
        px(tower_x + 2, tower_top - 2, CASTLE_SILHOUETTE)
        px(tower_x + 1, tower_top - 3, CASTLE_SHADOW)
        px(tower_x + 2, tower_top - 3, CASTLE_SHADOW)

    # Central keep, the tallest part of the silhouette.
    keep_x = peak_column - 4
    for x in range(keep_x, keep_x + 9):
        for y in range(keep_top, peak_row + 6):
            px(x, y, CASTLE_SILHOUETTE)

    # Crenellated battlements along the top of the keep.
    for x in range(keep_x, keep_x + 9, 2):
        px(x, keep_top - 1, CASTLE_SILHOUETTE)

    # Gatehouse arch.
    for x in range(peak_column - 2, peak_column + 3):
        for y in range(peak_row + 2, peak_row + 6):
            px(x, y, CASTLE_SHADOW)

    # Dark windows: a few on the keep, one per side tower, and along the
    # curtain wall. They are punched out in near-black rather than lit so the
    # castle stays a quiet silhouette and never competes with the UI text.
    # Each is two pixels tall so it reads as a tall slit window.
    for x, y in (
        (keep_x + 2, keep_top + 4),
        (keep_x + 6, keep_top + 4),
        (keep_x + 4, keep_top + 8),
        (left + 2, tower_top + 3),
        (left + 18, tower_top + 3),
        (left + 3, wall_top + 3),
        (left + 17, wall_top + 3),
    ):
        px(x, y, WINDOW_DARK)
        px(x, y + 1, WINDOW_DARK)


def scatter_sparkles(rng, pixels, peak_column, peak_row):
    for _ in range(14):
        x = peak_column + rng.randint(-20, 20)
        y = peak_row + rng.randint(-20, 3)

        if 0 <= x < GRID_WIDTH and 0 <= y < GRID_HEIGHT and pixels[x, y] not in (
            MOUNTAIN_NEAR,
            MOUNTAIN_FAR,
            CASTLE_SILHOUETTE,
            CASTLE_SHADOW,
        ):
            pixels[x, y] = lerp_color(pixels[x, y], SPARKLE, rng.uniform(0.14, 0.34))


def generate() -> Image.Image:
    rng = random.Random(SEED)
    image = Image.new("RGB", (GRID_WIDTH, GRID_HEIGHT))
    pixels = image.load()

    paint_sky(pixels)
    scatter_stars(pixels, rng)

    far_heights = jagged_heights(rng, base_row=HORIZON_ROW + 3, amplitude=7)
    paint_ridge(pixels, far_heights, MOUNTAIN_FAR)

    peak_column = round(GRID_WIDTH * 0.58)
    peak_row = HORIZON_ROW - 16
    near_heights = jagged_heights(
        rng,
        base_row=HORIZON_ROW + 12,
        amplitude=14,
        peak_column=peak_column,
        peak_row=peak_row,
    )
    paint_ridge(pixels, near_heights, MOUNTAIN_NEAR)

    draw_castle(pixels, peak_column, peak_row)
    scatter_sparkles(rng, pixels, peak_column, peak_row)

    scaled = image.resize(
        (GRID_WIDTH * PIXEL_SCALE, GRID_HEIGHT * PIXEL_SCALE),
        resample=Image.NEAREST,
    )
    return scaled


def main() -> None:
    image = generate()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT_PATH)
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
