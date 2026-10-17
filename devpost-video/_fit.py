from PIL import Image
import os
src = r"C:\Users\hohoh/Desktop/ht_projyekuto/triad/devpost-media"
dst = r"C:\Users\hohoh/Desktop/ht_projyekuto/triad/devpost-video"
os.makedirs(dst, exist_ok=True)
W, H = 1920, 1080
for f in sorted(os.listdir(src)):
    if not f.lower().endswith(".png"):
        continue
    im = Image.open(os.path.join(src, f)).convert("RGB")
    sc = min((W - 120) / im.width, (H - 120) / im.height)
    nw, nh = int(im.width * sc), int(im.height * sc)
    im2 = im.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGB", (W, H), (10, 10, 12))
    canvas.paste(im2, ((W - nw) // 2, (H - nh) // 2))
    canvas.save(os.path.join(dst, "fit_" + f))
    print("  fit_" + f + "  " + str(nw) + "x" + str(nh))
