# Erzeugt assets/icon/icon.png (iOS/klassisch) und icon_foreground.png (Android adaptive).
# Aufruf: python3 tool/make_icon.py assets/icon 0.82   (braucht Pillow: pip install pillow)
# Danach: dart run flutter_launcher_icons
"""App-Icon: Ohrkamera als schematischer Stift – flach, minimal, diagonal."""
import sys
from PIL import Image, ImageDraw

S = 2048            # doppelte Auflösung, am Ende 1024 (Kantenglättung)
OUT = sys.argv[1]
BG = (234, 88, 12)          # Theme-Orange
BODY = (28, 28, 30)
CONE = (46, 46, 50)
SHAFT = (208, 212, 218)
SPOON = (142, 205, 232)
BUTTON = (150, 214, 210)

def pen(canvas_size=S):
    L = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    d = ImageDraw.Draw(L)
    cy = canvas_size // 2
    h = 250                     # Griffdicke
    x0, x1 = 330, 1150          # Griff
    # Griff: hinten rund, vorne gerade
    d.rounded_rectangle([x0, cy - h // 2, x1, cy + h // 2], radius=h // 2, fill=BODY)
    d.rectangle([x1 - h // 2, cy - h // 2, x1, cy + h // 2], fill=BODY)
    # Konus: bündig an Griff, läuft auf Schaftbreite zu
    sw = 56                     # Schaftbreite
    c1 = 1330
    d.polygon([(x1, cy - h // 2), (c1, cy - sw // 2 - 14), (c1, cy + sw // 2 + 14), (x1, cy + h // 2)], fill=CONE)
    # Schaft
    s1 = 1640
    d.rectangle([c1, cy - sw // 2, s1, cy + sw // 2], fill=SHAFT)
    # Silikonlöffel
    d.rounded_rectangle([s1 - 10, cy - 50, s1 + 170, cy + 50], radius=50, fill=SPOON)
    # Knopf (türkis wie am Gerät, bewusst ohne Symbol – bleibt auch klein lesbar)
    bx, br = 960, 64
    d.ellipse([bx - br, cy - br, bx + br, cy + br], fill=BUTTON)
    return L

# Spitze zeigt nach oben rechts; leicht nach unten links versetzt, damit die
# Figur optisch mittig sitzt (der Griff ist massiger als die Spitze).
fg_big = pen().rotate(45, resample=Image.BICUBIC, center=(S // 2, S // 2))
def place(scale):
    """Stift skaliert und leicht nach unten links versetzt auf leere Fläche setzen."""
    n = round(S * scale)
    scaled = fg_big.resize((n, n), Image.LANCZOS)
    off = (S - n) // 2
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    layer.alpha_composite(scaled.crop((-off + 20, -off - 20, -off + 20 + S, -off - 20 + S)))
    return layer

# iOS/klassisches Icon: groß. Android-Vordergrund (adaptive icon): kleiner,
# damit der Stift in jeder Maskenform (Kreis, Squircle …) ganz sichtbar bleibt.
full = Image.new("RGBA", (S, S), BG + (255,))
full.alpha_composite(place(1.15))
fg = place(float(sys.argv[2]) if len(sys.argv) > 2 else 0.82)

fg.resize((1024, 1024), Image.LANCZOS).save(f"{OUT}/icon_foreground.png")
full.convert("RGB").resize((1024, 1024), Image.LANCZOS).save(f"{OUT}/icon.png")
print("ok")
