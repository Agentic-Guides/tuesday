
import os, json, time, soundfile as sf
from kokoro_onnx import Kokoro

VID = r"C:\\Users\\hohoh/Desktop/ht_projyekuto/triad/devpost-video"
MOD = r"C:\\Users\\hohoh/Desktop/scs-sec/_kokoro"
VOICE = "af_heart"

k = Kokoro(os.path.join(MOD, "kokoro-v1.0.onnx"), os.path.join(MOD, "voices-v1.0.bin"))
script = json.load(open(os.path.join(VID, "script.json"), encoding="utf-8"))

out = {}
t_all = time.time()
for idx, text in script:
    t = time.time()
    samples, sr = k.create(text, voice=VOICE, speed=1.0, lang="en-us")
    p = os.path.join(VID, "vo_kokoro_%s.wav" % idx)
    sf.write(p, samples, sr)
    dur = len(samples) / sr
    out[idx] = round(dur, 2)
    print("%s  %5.2fs gen  %6.2fs audio" % (idx, time.time()-t, dur), flush=True)

json.dump(out, open(os.path.join(VID, "vo_kokoro_durations.json"), "w", encoding="utf-8"), indent=1)
print("TOTAL audio: %.2fs  (gen %.1fs)" % (sum(out.values()), time.time()-t_all))
print("DONE")
