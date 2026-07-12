from __future__ import annotations

import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import subprocess


ROOT = Path(__file__).resolve().parent
ICONSET = ROOT / "icon.iconset"
PNG_PATH = ROOT / "icon.png"
ICNS_PATH = ROOT / "icon.icns"


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def energy(t: float) -> float:
    """Deterministic pseudo-spine: the groove/lane amplitude curve."""
    value = (
        0.55
        + 0.30 * math.sin(t * math.pi * 2.3 + 0.7)
        + 0.22 * math.sin(t * math.pi * 5.1 + 2.1)
        + 0.12 * math.sin(t * math.pi * 11.0 + 4.2)
    )
    return max(0.08, min(1.0, value))


def draw_icon(size: int) -> Image.Image:
    """The Pressing: the deck's signature object as the application mark —
    a crimson groove disc with a tempo-glyph hub over the archive lane.
    Every translucent element is drawn on its own layer and composited:
    PIL's draw replaces pixels rather than blending."""
    ss = 2  # supersample for crisp rings
    S = size * ss
    scale = S / 1024

    def layer() -> tuple[Image.Image, ImageDraw.ImageDraw]:
        surface = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        return surface, ImageDraw.Draw(surface)

    base = Image.new("RGBA", (S, S), "#08070c")
    draw = ImageDraw.Draw(base)

    # Plate: subtle vertical gradient.
    for y in range(S):
        tone = int(9 + (y / max(1, S - 1)) * 10)
        draw.line((0, y, S, y), fill=(tone, tone - 1, tone + 3, 255))

    # Blueprint grid, barely there.
    grid, grid_draw = layer()
    grid_step = max(16, int(88 * scale))
    for x in range(0, S, grid_step):
        grid_draw.line((x, 0, x, S), fill=(140, 170, 182, 22), width=max(1, int(2 * scale)))
    for y in range(0, S, grid_step):
        grid_draw.line((0, y, S, y), fill=(150, 40, 50, 18), width=max(1, int(2 * scale)))
    base.alpha_composite(grid)

    # Hardware bezel.
    bezel, bezel_draw = layer()
    margin = int(52 * scale)
    bezel_draw.rounded_rectangle(
        (margin, margin, S - margin, S - margin),
        radius=int(120 * scale),
        outline=(214, 205, 184, 52),
        width=max(2, int(4 * scale)),
    )
    base.alpha_composite(bezel)

    cx, cy = S / 2, S * 0.455
    outer = S * 0.335
    inner = outer * 0.34

    # Soft red glow behind the disc.
    glow, glow_draw = layer()
    glow_draw.ellipse((cx - outer, cy - outer, cx + outer, cy + outer), fill=(139, 17, 27, 92))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=max(10, int(70 * scale))))
    base.alpha_composite(glow)

    # Grooves: dark red rings whose weight and heat follow the pseudo-spine,
    # with visible gaps between them.
    disc, disc_draw = layer()
    disc_draw.ellipse((cx - outer, cy - outer, cx + outer, cy + outer), fill=(24, 8, 11, 235))
    rings = 26
    for ring in range(rings):
        t = ring / (rings - 1)
        e = energy(t)
        radius = inner + t * (outer - inner - 6 * scale)
        width = max(1, int((1.6 + e * 5.2) * scale))
        heat = int(52 + e * 118)
        disc_draw.ellipse(
            (cx - radius, cy - radius, cx + radius, cy + radius),
            outline=(heat, int(12 + e * 26), int(16 + e * 26), int(150 + e * 105)),
            width=width,
        )
    base.alpha_composite(disc)

    finish, finish_draw = layer()
    # Outer rim.
    finish_draw.ellipse(
        (cx - outer, cy - outer, cx + outer, cy + outer),
        outline=(239, 231, 207, 44),
        width=max(1, int(3 * scale)),
    )
    # Index line at 12 o'clock, hub to rim.
    finish_draw.line(
        (cx, cy - inner * 0.9, cx, cy - outer + 2 * scale),
        fill=(239, 231, 207, 200),
        width=max(2, int(7 * scale)),
    )
    # Hub plate, tempo-glyph spokes, spindle.
    hub = inner * 0.94
    finish_draw.ellipse((cx - hub, cy - hub, cx + hub, cy + hub), fill=(20, 11, 14, 255))
    finish_draw.ellipse((cx - hub, cy - hub, cx + hub, cy + hub), outline=(214, 205, 184, 64), width=max(1, int(3 * scale)))
    spokes = 5
    glyph_r = hub * 0.68
    points = []
    for spoke in range(spokes + 1):
        angle = (spoke / spokes) * math.pi * 2 - math.pi / 2
        points.append((cx + math.cos(angle) * glyph_r, cy + math.sin(angle) * glyph_r))
    finish_draw.line(points, fill=(216, 199, 155, 205), width=max(2, int(7 * scale)), joint="curve")
    spindle = S * 0.015
    finish_draw.ellipse((cx - spindle, cy - spindle, cx + spindle, cy + spindle), fill=(5, 5, 6, 255))
    base.alpha_composite(finish)

    # The archive lane: mirrored spine bars, played third red, road ahead in
    # dimmed steel, cream playhead.
    lane, lane_draw = layer()
    lane_mid = int(S * 0.875)
    lane_half = int(S * 0.058)
    bar_count = 40
    lane_left = int(S * 0.14)
    lane_right = int(S * 0.86)
    bar_pitch = (lane_right - lane_left) / bar_count
    playhead = 0.34
    lane_draw.line((lane_left, lane_mid, lane_right, lane_mid), fill=(214, 205, 184, 34), width=max(1, int(2 * scale)))
    for bar in range(bar_count):
        t = bar / (bar_count - 1)
        e = energy(t * 0.9 + 0.05)
        half = max(2 * scale, e * lane_half)
        x0 = lane_left + bar * bar_pitch
        x1 = x0 + bar_pitch * 0.6
        if t <= playhead:
            fill = (176, 38, 44, 215)
        else:
            fill = (154, 178, 190, 92)
        lane_draw.rectangle((x0, lane_mid - half, x1, lane_mid + half), fill=fill)
    ph_x = lane_left + playhead * (lane_right - lane_left)
    lane_draw.rectangle(
        (ph_x - 3 * scale, lane_mid - lane_half - 10 * scale, ph_x + 3 * scale, lane_mid + lane_half + 10 * scale),
        fill=(239, 231, 207, 225),
    )
    base.alpha_composite(lane)

    # Edge vignette to seat everything in the tube.
    vignette, vignette_draw = layer()
    vignette_draw.rounded_rectangle(
        (int(6 * scale), int(6 * scale), S - int(6 * scale), S - int(6 * scale)),
        radius=int(200 * scale),
        outline=(0, 0, 0, 140),
        width=int(56 * scale),
    )
    vignette = vignette.filter(ImageFilter.GaussianBlur(radius=int(42 * scale)))
    base.alpha_composite(vignette)

    image = base.resize((size, size), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(image, (0, 0))
    out.putalpha(rounded_mask(size, int(188 * (size / 1024))))
    return out


def save_iconset(source: Image.Image) -> None:
    ICONSET.mkdir(exist_ok=True)
    sizes = [16, 32, 128, 256, 512]

    for points in sizes:
        for scale in (1, 2):
            pixels = points * scale
            name = f"icon_{points}x{points}{'@2x' if scale == 2 else ''}.png"
            source.resize((pixels, pixels), Image.Resampling.LANCZOS).save(ICONSET / name)


def main() -> None:
    source = draw_icon(1024)
    source.save(PNG_PATH)
    save_iconset(source)
    subprocess.run(["iconutil", "-c", "icns", str(ICONSET), "-o", str(ICNS_PATH)], check=True)
    print(f"wrote {PNG_PATH}")
    print(f"wrote {ICNS_PATH}")


if __name__ == "__main__":
    main()
