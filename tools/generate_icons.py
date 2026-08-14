import math
import os

from PIL import Image, ImageDraw

SIZE = 128
TAB_COLOR = (74, 144, 217, 255)
BACK_TAB_COLOR = (58, 115, 173, 255)
ACCENT_COLOR = (255, 255, 255, 255)

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Back tab (offset behind, darker shade)
draw.rounded_rectangle([28, 20, 108, 76], radius=14, fill=BACK_TAB_COLOR)
# Front tab
draw.rounded_rectangle([16, 40, 96, 96], radius=14, fill=TAB_COLOR)

# Circular "cycle" arrow accent
cx, cy, r = 78, 78, 22
bbox = [cx - r, cy - r, cx + r, cy + r]
draw.arc(bbox, start=30, end=300, fill=ACCENT_COLOR, width=6)

angle = math.radians(30)
ax = cx + r * math.cos(angle)
ay = cy + r * math.sin(angle)
arrow_size = 10
draw.polygon(
    [
        (ax, ay - arrow_size),
        (ax + arrow_size, ay),
        (ax - 2, ay + 4),
    ],
    fill=ACCENT_COLOR,
)

script_dir = os.path.dirname(os.path.abspath(__file__))
icons_dir = os.path.join(script_dir, "..", "icons")
os.makedirs(icons_dir, exist_ok=True)

img.save(os.path.join(icons_dir, "icon128.png"))

for size in (48, 16):
    resized = img.resize((size, size), Image.LANCZOS)
    resized.save(os.path.join(icons_dir, f"icon{size}.png"))

print("Generated icons/icon16.png, icons/icon48.png, icons/icon128.png")
