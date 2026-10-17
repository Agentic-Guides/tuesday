"""Tuesday submission video v9 -- record one continuous take over CDP.

Same shape as build_video.py (which produced the v8 take), rewritten against the
demo as it exists now. What changed and why:

  * v8 drove a page whose input ids have since moved, and it never opened the
    three proof buttons the README points a judge at. The proof panel did not
    exist when v8 was shot.
  * The timeline now renders on the light Bryntum theme. v8's take has the black
    grid on it, which reads as a rendering fault in a light page.
  * The narration is unchanged -- 10 Kokoro clips, 94.06s -- and it is still
    accurate. Only the picture needed to catch up.

Timing comes from devpost-video/plan_v9.py (BEATS), measured from the audio files.
The take records the whole session in one pass; assembly cuts it at in-points.

Run:  python build_video_v9.py            # record + build
      python build_video_v9.py --build-only
"""
import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request

import websockets

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from plan_v9 import BEATS, IDS  # noqa: E402

FFMPEG = r"C:\Users\hohoh\AppData\Local\hermes\tools\ffmpeg-9.0.1-win32-x64\bin\ffmpeg.exe"
FFPROBE = FFMPEG.replace("ffmpeg.exe", "ffprobe.exe")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
APP_URL = "http://localhost:8787/"
REC_DIR = os.path.expanduser("~/Desktop/scs-sec/_rec")
VID_DIR = os.path.expanduser("~/Desktop/ht_projyekuto/triad/devpost-video")
TAKE = os.path.join(REC_DIR, "take_v9.mp4")
OUTPUT = os.path.join(REC_DIR, "tuesday_submission_v9_1080p.mp4")
CDP_PORT = 9333
KIOSK_PROFILE = os.path.expanduser("~/chrome-kiosk-prof")
TAKE_TAG = "take=v9"

# Wall-clock target for each step, so the take lines up with the assembly cuts.
STEP = {tag: audio + pad for tag, audio, pad, _ in BEATS}


def find_page(port, url_fragment, timeout=60):
    """Wait for the page we are actually going to drive.

    Measured failure: Chrome creates an about:blank target at startup, and an
    older kiosk from a previous run can outlive kill_stale_kiosks(). find_page
    returned whichever page target came first, the guard tripped on
    "driving the WRONG tab: about:blank", and the take was lost.

    So: skip about:blank, and keep polling until a page target actually carries
    the take tag. A target that is still navigating has an empty url and will
    match on a later pass.
    """
    deadline = time.time() + timeout
    seen = []
    while time.time() < deadline:
        try:
            targets = json.loads(
                urllib.request.urlopen("http://127.0.0.1:%d/json/list" % port, timeout=5).read()
            )
            for t in targets:
                if t.get("type") != "page":
                    continue
                url = t.get("url") or ""
                if url in ("about:blank", ""):
                    continue
                if url_fragment in url:
                    return t["webSocketDebuggerUrl"]
                seen.append(url)
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("demo page not on CDP port %d after %ds; saw: %s"
                       % (port, timeout, seen[-5:] or "no page targets"))


class Cdp:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    async def cmd(self, method, **params):
        self.n += 1
        await self.ws.send(json.dumps({"id": self.n, "method": method, "params": params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == self.n:
                return msg.get("result", {})

    async def js(self, expr):
        r = await self.cmd("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        return r.get("result", {}).get("value")


VERDICT = ("(()=>{const d=document.getElementById('decision');"
           "const b=d&&d.querySelector('.big');return b?b.textContent.trim():'';})()")


# ---------------------------------------------------------------- page actions
async def scroll_to(cdp, element_id, offset=-30, retries=14):
    """Put an element at the top of the viewport, and confirm it actually stayed there.

    Measured failures, in order:

      1. scrollIntoView ran in the same tick the verdict arrived, while #decision
         still had height 0 -- the beat held 13s on a form with no verdict in frame.

      2. The document grows while AG Grid and the Bryntum scheduler lay out, so a
         scroll that landed correctly slides back off screen.

      3. The page sets `html { scroll-behavior: smooth }`. Every scroll is animated,
         so reading scrollY straight after the call returns the OLD position -- the
         frame check was measuring the wrong moment and reporting "did not land"
         even when the scroll was on its way.

    So: turn smooth scrolling off for the duration of the take, scroll, then poll
    until the element's measured position is actually inside the viewport.
    """
    await cdp.js("document.documentElement.style.scrollBehavior='auto'")
    expr = ("(()=>{const e=document.getElementById('%s');if(!e)return 'noel';"
            "e.scrollIntoView({block:'start',behavior:'instant'});window.scrollBy(0,%d);"
            "const r=e.getBoundingClientRect();"
            "return (r.top>=-4&&r.top<innerHeight*0.7&&r.height>20)?'ok':"
            "('off top='+Math.round(r.top)+' h='+Math.round(r.height)+"
            "' dh='+document.documentElement.scrollHeight+' y='+Math.round(window.scrollY));})()"
            % (element_id, offset))
    last = None
    for i in range(retries):
        await asyncio.sleep(0.5 if i == 0 else 0.9)
        last = await cdp.js(expr)
        if last == "ok":
            return True
    print("    scroll_to(%s) did not land: %s" % (element_id, last), flush=True)
    return False


async def scroll_top(cdp):
    await cdp.js("window.scrollTo(0,0)")


async def set_field(cdp, element_id, text, per_char=0.11):
    """Type a value the way a person would: clear, then one character at a time.

    Setting .value directly leaves the page's own listeners unfired, and the
    screenshot then shows an empty box next to a verdict that used the value.
    """
    await cdp.js("(()=>{const e=document.getElementById('%s');if(e){e.focus();e.select();}})()" % element_id)
    await asyncio.sleep(0.5)
    await cdp.js("(()=>{const e=document.getElementById('%s');if(e){e.value='';"
                 "e.dispatchEvent(new Event('input',{bubbles:true}));}})()" % element_id)
    await asyncio.sleep(0.4)
    for ch in str(text):
        await cdp.js("(()=>{const e=document.getElementById('%s');if(e){e.value=e.value+%s;"
                     "e.dispatchEvent(new Event('input',{bubbles:true}));}})()"
                     % (element_id, json.dumps(ch)))
        await asyncio.sleep(per_char)
    await asyncio.sleep(0.5)


async def click(cdp, element_id):
    await cdp.js("(()=>{const b=document.getElementById('%s');if(b&&!b.disabled)b.click();})()" % element_id)


async def wait_verdict(cdp, want, tries=80):
    for _ in range(tries):
        await asyncio.sleep(0.4)
        v = await cdp.js(VERDICT)
        if v and (want is None or v == want):
            return v
    return await cdp.js(VERDICT)


async def wait_for(cdp, expr, tries=80):
    for _ in range(tries):
        await asyncio.sleep(0.4)
        if await cdp.js(expr):
            return True
    return False


async def beat(tag, hold):
    """Hold the current picture for the length of this beat."""
    print("  beat %s  holding %.1fs" % (tag, hold), flush=True)
    await asyncio.sleep(hold)


# ---------------------------------------------------------------- recording
def kill_stale_kiosks(port):
    """Chromium exposes many page targets on one debug port. find_page() would
    drive whichever comes first while ffmpeg records a different window.

    Get-Process has no CommandLine on PowerShell 5.1, so close the targets over
    CDP first, then drop every chrome process.
    """
    try:
        tl = json.loads(urllib.request.urlopen(
            "http://127.0.0.1:%d/json/list" % port, timeout=5).read())
        for t in tl:
            if t.get("type") == "page":
                try:
                    urllib.request.urlopen(
                        "http://127.0.0.1:%d/json/close/%s" % (port, t.get("id")), timeout=5).read()
                except Exception:
                    pass
    except Exception:
        pass
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    "Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force"],
                   capture_output=True, timeout=90)
    time.sleep(3)


def start_recording(seconds, width=1536, height=864):
    height -= height % 2
    return subprocess.Popen(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-f", "gdigrab",
         "-framerate", "30", "-t", str(seconds), "-offset_x", "0", "-offset_y", "0",
         "-video_size", "%dx%d" % (width, height), "-i", "desktop",
         "-c:v", "libx264", "-preset", "ultrafast", "-crf", "12", "-pix_fmt", "yuv420p", TAKE])


async def record_take():
    kill_stale_kiosks(CDP_PORT)
    subprocess.Popen(
        [CHROME, "--kiosk", "--remote-debugging-port=%d" % CDP_PORT,
         "--user-data-dir=" + KIOSK_PROFILE, "--no-first-run", "--no-default-browser-check",
         "--disk-cache-size=1", "--window-position=0,0", "--window-size=1536,864",
         "%s?%s" % (APP_URL, TAKE_TAG)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # Wait for Chrome itself to answer, then for the tagged page. If the tagged
    # page never appears, open it explicitly over CDP rather than guessing.
    ws_url = None
    for _ in range(45):
        time.sleep(2)
        try:
            ws_url = find_page(CDP_PORT, TAKE_TAG, timeout=3)
            break
        except RuntimeError:
            try:
                urllib.request.urlopen("http://127.0.0.1:%d/json/new?%s?%s"
                                       % (CDP_PORT, APP_URL, TAKE_TAG), timeout=5,
                                       data=b"").read()
            except Exception:
                pass
    if not ws_url:
        raise RuntimeError("could not get a tagged demo page on port %d" % CDP_PORT)

    async with websockets.connect(ws_url, max_size=8 * 1024 * 1024) as ws:
        cdp = Cdp(ws)
        await cdp.cmd("Runtime.enable")
        href = await cdp.js("location.href")
        print("driving:", await cdp.js("document.title"), "|", href, flush=True)
        if TAKE_TAG not in (href or ""):
            raise RuntimeError("driving the WRONG tab: %s" % href)

        total = sum(STEP.values())
        rec = start_recording(int(total) + 60)
        started = time.time()
        marks = {}

        async def mark(tag):
            """Record when this beat's picture actually starts, measured from the
            recording's first frame.

            The plan's in-points used to assume the beats ran back to back from a
            fixed offset. They do not: waiting for a verdict, a grid, or the
            scheduler adds real seconds, and the built video then cut to the wrong
            footage (the ledger beat landed on the proof panel). Stamping each beat
            as it begins makes the cut independent of those waits.
            """
            marks[tag] = round(time.time() - started, 3)
            print("    [mark] %s at %.2fs" % (tag, marks[tag]), flush=True)

        await asyncio.sleep(2)

        # The page sets `html { scroll-behavior: smooth }`. Every programmatic
        # scroll is then animated, and a scroll issued while another is still
        # running lands in the wrong place. Measured: the DENIED verdict ended up
        # at top=963 (below the fold) with the screenshot showing a bare form.
        # Kill the animation for the whole take; the camera is the only audience.
        await cdp.js("document.documentElement.style.scrollBehavior='auto'")

        # --- 01: title, page at rest ------------------------------------
        await cdp.js("showTab('direct')")      # the page opens on Direct
        await scroll_top(cdp)
        await mark("01")
        await beat("01", STEP["01"])

        # --- 02: the premise is the header block, already on screen ----
        await mark("02")
        await beat("02", STEP["02"])

        # --- 03: the three models and their roles ------------------------
        await cdp.js("(()=>{const a=document.getElementById('agents');"
                     "if(a)a.scrollIntoView({block:'start'});})()")
        await mark("03")
        await beat("03", STEP["03"])

        # --- 04: the tribunal panel --------------------------------------
        await cdp.js("showTab('direct')")
        await scroll_top(cdp)
        await mark("04")
        await beat("04", STEP["04"])

        # --- 05: APPROVED -- budget 200, amount 42 -----------------------
        # Scroll the form (not the whole page) before typing, so the fields are
        # on screen while they fill -- that is what a person would see.
        await scroll_to(cdp, IDS["d_budget"], -220)
        await set_field(cdp, IDS["d_budget"], "200")
        await set_field(cdp, IDS["d_amount"], "42")
        await click(cdp, IDS["run"])
        v = await wait_verdict(cdp, "APPROVED")
        print("    verdict:", v, flush=True)
        await asyncio.sleep(2.0)          # let the panel lay out before we scroll to it
        ok = await scroll_to(cdp, IDS["decision"], -120)
        print("    decision in frame:", ok, flush=True)
        await mark("05")
        await beat("05", STEP["05"])

        # --- 06: Shop -- real products with photographs -------------------
        await cdp.js("showTab('shop')")
        await scroll_top(cdp)
        await click(cdp, IDS["shop_run"])
        await wait_for(cdp, "document.querySelectorAll('img').length >= 5", tries=100)
        await asyncio.sleep(2.5)
        ok = await scroll_to(cdp, IDS["reco"], -150)
        print("    reco in frame:", ok, flush=True)
        await mark("06")
        await beat("06", STEP["06"])

        # --- 07: DENIED -- budget 60, amount 90 ---------------------------
        await cdp.js("showTab('direct')")
        await scroll_to(cdp, IDS["d_budget"], -220)
        await set_field(cdp, IDS["d_budget"], "60")
        await set_field(cdp, IDS["d_amount"], "90")
        await click(cdp, IDS["run"])
        v = await wait_verdict(cdp, "DENIED")
        print("    verdict:", v, flush=True)
        await asyncio.sleep(2.0)
        ok = await scroll_to(cdp, IDS["decision"], -120)
        print("    decision in frame:", ok, flush=True)
        await mark("07")
        await beat("07", STEP["07"])

        # --- 08: the dissent map ------------------------------------------
        ok = await scroll_to(cdp, IDS["dissent"], -110)
        print("    dissent in frame:", ok, flush=True)
        await mark("08")
        await beat("08", STEP["08"])

        # --- 09: the proof panel -- run the suite in the page -------------
        ok = await scroll_to(cdp, IDS["proof_panel"], -30)
        await click(cdp, IDS["proof_btn"])
        await wait_for(cdp, "(()=>{const v=document.getElementById('proofVerdict');"
                            "return v && v.textContent.trim().length>0;})()", tries=140)
        print("    proof:", await cdp.js("document.getElementById('proofVerdict').textContent.trim()"),
              flush=True)
        await asyncio.sleep(1.5)
        ok = await scroll_to(cdp, IDS["proof_verdict"], -200)
        print("    proof verdict in frame:", ok, flush=True)
        await mark("09")
        await beat("09", STEP["09"])

        # --- 10: ledger, then timeline, then close -------------------------
        ok = await scroll_to(cdp, IDS["audit_grid"], -30)
        print("    ledger in frame:", ok, flush=True)
        await mark("10")
        await asyncio.sleep(5)
        tl_at = round(time.time() - started, 3)
        await cdp.js("document.getElementById('tabTimeline').click()")
        await wait_for(cdp, "document.querySelectorAll('.b-sch-event,.b-gantt-task').length>0",
                       tries=100)
        await asyncio.sleep(2.5)
        ok = await scroll_to(cdp, IDS["scheduler"], -30)
        print("    timeline in frame:", ok, flush=True)
        await beat("10", STEP["10"])

        rec.wait()
        mp = os.path.join(VID_DIR, "marks_v9.json")
        json.dump(marks, open(mp, "w"), indent=2)
        marks["timeline"] = tl_at
        print("marks:", json.dumps(marks), flush=True)
        print("take recorded:", TAKE, os.path.getsize(TAKE), "bytes", flush=True)


# ---------------------------------------------------------------- assembly
def probe(path, entries):
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", entries,
                        "-of", "default=nw=1:nk=1", path],
                       capture_output=True, text=True, timeout=180)
    return (r.stdout or "").strip().split("\n")


# In-points into take_v9.mp4, in seconds from the start of the recording.
# Filled from the take once it exists; the beats run back to back from t=2.
def load_inpoints():
    """Beat start times in the take, measured while recording (marks_v9.json).

    Not estimated from the plan: waits for verdicts and late layout add real
    seconds, and a fixed offset cut the ledger beat onto the proof panel.
    """
    p = os.path.join(VID_DIR, "marks_v9.json")
    if os.path.exists(p):
        marks = json.load(open(p))
        if all(tag in marks for tag, _, _, _ in BEATS):
            return marks
    return None


def build(inpoints):
    inputs, fc = [], []
    for i, (tag, audio, pad, _note) in enumerate(BEATS):
        start = inpoints[tag]
        dur = audio + pad
        inputs += ["-ss", str(start), "-t", str(dur), "-i", TAKE]
        inputs += ["-i", os.path.join(VID_DIR, "vo_kokoro_%s.wav" % tag)]
        vi, ai = i * 2, i * 2 + 1
        fc.append(
            "[%d:v]scale=1920:1080:force_original_aspect_ratio=decrease,"
            "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#f0eadf,fps=30,"
            "tpad=stop_mode=clone:stop_duration=60,trim=duration=%.3f,setpts=PTS-STARTPTS[v%d]"
            % (vi, dur, i))
        # narration + the rest of the beat as silence, so picture and audio
        # are exactly the same length and concat cannot drift
        fc.append("[%d:a]aresample=48000,apad,atrim=0:%.3f,asetpts=PTS-STARTPTS[a%d]"
                  % (ai, dur, i))
    fc.append("%sconcat=n=%d:v=1:a=1[vout][aout]"
              % ("".join("[v%d][a%d]" % (i, i) for i in range(len(BEATS))), len(BEATS)))

    cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error"] + inputs + [
        "-filter_complex", ";".join(fc), "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "slow", "-b:v", "10000k", "-maxrate", "12000k",
        "-bufsize", "20000k", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", OUTPUT]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    print("exit:", r.returncode, flush=True)
    if r.returncode:
        print((r.stderr or "")[-800:], flush=True)
        return False
    print("output:", OUTPUT, os.path.getsize(OUTPUT), "bytes", flush=True)
    print(probe(OUTPUT, "format=duration,bit_rate:stream=width,height"), flush=True)
    return True


if __name__ == "__main__":
    if "--build-only" not in sys.argv:
        asyncio.run(record_take())
    ip = load_inpoints()
    if ip:
        build(ip)
    else:
        print("no inpoints_v9.json yet -- take is recorded, set the in-points and re-run "
              "with --build-only", flush=True)
