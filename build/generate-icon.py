from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import subprocess


ROOT = Path(__file__).resolve().parent
ICONSET = ROOT / "icon.iconset"
PNG_PATH = ROOT / "icon.png"
ICNS_PATH = ROOT / "icon.icns"


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in (
        "/System/Library/Fonts/SFNSMono.ttf",
        "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
        "/System/Library/Fonts/Menlo.ttc",
    ):
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue

    return ImageFont.load_default()


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def draw_icon(size: int) -> Image.Image:
    scale = size / 1024
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = rounded_mask(size, int(188 * scale))
    base = Image.new("RGBA", (size, size), "#07080a")
    draw = ImageDraw.Draw(base)

    for y in range(size):
        tone = int(8 + (y / max(1, size - 1)) * 16)
        draw.line((0, y, size, y), fill=(tone, tone, tone + 2, 255))

    grid_step = max(12, int(54 * scale))
    for x in range(0, size, grid_step):
        draw.line((x, 0, x, size), fill=(92, 119, 130, 34), width=max(1, int(2 * scale)))
    for y in range(0, size, grid_step):
        draw.line((0, y, size, y), fill=(118, 18, 28, 30), width=max(1, int(2 * scale)))

    margin = int(108 * scale)
    deck = (margin, margin, size - margin, size - margin)
    draw.rounded_rectangle(deck, radius=int(46 * scale), outline=(222, 222, 212, 220), width=max(3, int(10 * scale)))
    draw.rounded_rectangle(
        (
            margin + int(34 * scale),
            margin + int(34 * scale),
            size - margin - int(34 * scale),
            size - margin - int(34 * scale),
        ),
        radius=int(24 * scale),
        outline=(98, 126, 136, 150),
        width=max(2, int(4 * scale)),
    )

    red = (139, 17, 27, 255)
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    node_box = (
        int(405 * scale),
        int(344 * scale),
        int(619 * scale),
        int(558 * scale),
    )
    glow_draw.rectangle(node_box, fill=(139, 17, 27, 150))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=max(8, int(48 * scale))))
    base.alpha_composite(glow)

    draw = ImageDraw.Draw(base)
    draw.rectangle(node_box, fill=red)
    inset = int(62 * scale)
    draw.rectangle(
        (
            node_box[0] + inset,
            node_box[1] + inset,
            node_box[2] - inset,
            node_box[3] - inset,
        ),
        outline=(255, 218, 222, 180),
        width=max(2, int(5 * scale)),
    )

    play = [
        (int(465 * scale), int(386 * scale)),
        (int(465 * scale), int(518 * scale)),
        (int(570 * scale), int(452 * scale)),
    ]
    draw.polygon(play, fill=(245, 242, 232, 235))

    rail_y = int(708 * scale)
    draw.rectangle((int(172 * scale), rail_y, int(852 * scale), rail_y + int(28 * scale)), fill=(12, 15, 16, 255))
    draw.rectangle((int(172 * scale), rail_y, int(522 * scale), rail_y + int(28 * scale)), fill=(139, 17, 27, 220))
    draw.rectangle(
        (int(500 * scale), rail_y - int(22 * scale), int(560 * scale), rail_y + int(50 * scale)),
        fill=(208, 208, 200, 255),
        outline=(30, 30, 30, 255),
        width=max(1, int(4 * scale)),
    )

    font = load_font(int(78 * scale))
    small_font = load_font(int(31 * scale))
    label = "CODY"
    label_box = draw.textbbox((0, 0), label, font=font)
    draw.text(
        ((size - (label_box[2] - label_box[0])) / 2, int(780 * scale)),
        label,
        font=font,
        fill=(239, 239, 231, 235),
    )
    draw.text((int(178 * scale), int(196 * scale)), "LOCAL / SIGNAL", font=small_font, fill=(156, 199, 216, 170))
    draw.text((int(646 * scale), int(196 * scale)), "DECK A", font=small_font, fill=(156, 199, 216, 150))

    image.alpha_composite(base)
    image.putalpha(mask)
    return image


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
