"""Tuesday submission video v17 -- record one continuous take over CDP.

v17 = v9 + the 2026-10-24 fixes. What changed in the product since v9/v16:
  * Ledger rows now carry a Source column (demo / live). The seeded six rows are
    labelled "demo", anything adjudicated live is "live". The take must show it.
  * adjudicate() order fixed: votesAgainst >= 2 -> DENIED before any condition path.
  * triadVerifyReceipt now calls PayPal GET /orders/{id} instead of reading memory.
  * The $42 renewal reads CONDITIONAL at budget $60 (it was $100 in the old copy).

The narration is unchanged (10 Kokoro clips, 94.06s) and still accurate.

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
from plan_v17 import BEATS, IDS  # noqa: E402

FFMPEG = r"C:\Users\hohoh\AppData\Local\hermes\tools\ffmpeg-9.0.1-win32-x64\bin\ffmpeg.exe"
FFPROBE = FFMPEG.replace("ffmpeg.exe", "ffprobe.exe")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
APP_URL = "http://localhost:8787/"
REC_DIR = os.path.expanduser("~/Desktop/scs-sec/_rec")  # 既存の素材置き場（変更なし）
VID_DIR = os.path.expanduser("~/Desktop/ht_projyekuto/triad/devpost-video")  # 音声の置き場
OUT_DIR = os.path.expanduser("~/Desktop/triad-clean/devpost-media")  # ★出力先
TAKE = os.path.join(REC_DIR, "take_v17.mp4")
OUTPUT = os.path.join(OUT_DIR, "tuesday_submission_v17_1080p.mp4")
CDP_PORT = 9333
KIOSK_PROFILE = os.path.expanduser("~/chrome-kiosk-prof")
APP_PROFILE = os.path.expanduser("~/chrome-bu-rec")  # --app モード用（2026-10-19 の記録）
TAKE_TAG = "take=v17"

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

    # ---------------- マウス操作（2026-10-24 追加）----------------
    # ボスの指摘: 「画面中央にポインタがあってそこからずっと動かない！
    #             ボタン押したりどのように動くとかが全然無い！」
    # JS の .click() だけではカーソルが動かず、審査員には「勝手に画面が
    # 変わる」ようにしか見えない。CDP の Input.dispatchMouseEvent で
    # 実際にカーソルを移動させ、押し下げ・押し上げを送る。

    async def mouse_move(self, x, y, steps=12, duration=0.35):
        """カーソルを (x,y) へ滑らかに移動する。"""
        cur = getattr(self, "_mouse", None) or (x, y)
        x0, y0 = cur
        for i in range(1, steps + 1):
            t = i / steps
            # ease-out（終わりで減速＝人間らしい）
            e = 1 - (1 - t) ** 2
            px = int(round(x0 + (x - x0) * e))
            py = int(round(y0 + (y - y0) * e))
            await self.cmd("Input.dispatchMouseEvent", type="mouseMoved", x=px, y=py,
                           button="none", buttons=0)
            await asyncio.sleep(duration / steps)
        self._mouse = (x, y)

    async def mouse_click(self, x, y, settle=0.25):
        """カーソルを移動してから実際にクリックする。"""
        await self.mouse_move(x, y)
        await asyncio.sleep(0.12)
        await self.cmd("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y,
                       button="left", buttons=1, clickCount=1)
        await asyncio.sleep(0.08)
        await self.cmd("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y,
                       button="left", buttons=0, clickCount=1)
        await asyncio.sleep(settle)

    async def center_of(self, element_id):
        """要素の画面座標（中心）を返す。見えていなければスクロールして測る。"""
        expr = ("(()=>{const e=document.getElementById('%s');"
                "if(!e)return null;const r=e.getBoundingClientRect();"
                "if(r.width===0&&r.height===0)return null;"
                "return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),"
                "top:Math.round(r.top),h:Math.round(r.height)};})()" % element_id)
        return await self.js(expr)

    async def wheel(self, dy, x=None, y=None, steps=None, pause=0.09):
        """マウスホイールでスクロールする（カーソル位置から）。

        ★実測（2026-10-24）: deltaY を小分けにしすぎると取りこぼす。
        1回 120px 前後が最も確実（5回×120 で 900px 動いた）。
        pause は 0.09s 以上必要（0.06s では反映前に次を送って落ちる）。
        """
        pos = getattr(self, "_mouse", (960, 500))
        px = x if x is not None else pos[0]
        py = y if y is not None else pos[1]
        if steps is None:
            steps = max(1, min(12, abs(int(dy)) // 120 or 1))
        per = int(dy / steps)
        if per == 0:
            per = 120 if dy > 0 else -120
            steps = max(1, abs(int(dy)) // 120)
        before = None
        for i in range(steps):
            await self.cmd("Input.dispatchMouseEvent", type="mouseWheel",
                           x=px, y=py, deltaX=0, deltaY=per,
                           button="none", buttons=0)
            await asyncio.sleep(pause)
        # 動いたか確認できたら返す
        await asyncio.sleep(0.15)


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

    # ★ホイールで「マウスらしく」スクロールする（2026-10-24 追加）。
    #   瞬時に飛ぶと、審査員には「画面が切り替わった」ようにしか見えない。
    #   まず対象要素の位置までホイールで寄せ、最後に正確な位置へ合わせる。
    target_pos = await cdp.js(
        "(()=>{const e=document.getElementById('%s');if(!e)return null;"
        "const r=e.getBoundingClientRect();"
        "return {absTop: Math.round(r.top + window.scrollY)};})()" % element_id)
    if target_pos:
        cur_y = await cdp.js("Math.round(window.scrollY)") or 0
        delta = target_pos["absTop"] - cur_y + offset
        if abs(delta) > 80:
            # 大きい移動はホイールで段階的に
            steps = min(10, max(3, abs(delta) // 220))
            await cdp.wheel(delta, steps=steps, pause=0.07)
            await asyncio.sleep(0.2)

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
    # ★まず実際にマウスでそのフィールドをクリックする（2026-10-24）。
    #   フォーカスを JS で当てるだけだとカーソルが動かず、
    #   審査員には「勝手に数字が入った」ように見える。
    pos = await cdp.center_of(element_id)
    if pos:
        x = max(2, min(pos["x"], 1918))
        y = max(2, min(pos["y"], 1076))
        print("    type into %s at (%d,%d)" % (element_id, x, y), flush=True)
        await cdp.mouse_click(x, y, settle=0.2)
    await cdp.js("(()=>{const e=document.getElementById('%s');if(e){e.focus();e.select();}})()" % element_id)
    await asyncio.sleep(0.35)
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
    """★実際にマウスを動かしてクリックする（2026-10-24）。

    以前は JS の .click() だけだったので、画面ではカーソルが中央に止まったまま
    勝手に画面が変わっているように見えた（ボスの指摘）。
    CDP の Input.dispatchMouseEvent でカーソルを移動させてから押す。
    """
    # まず要素を画面内に入れる（スクロール後に再計測して本当に入ったか確認）
    await cdp.js("document.documentElement.style.scrollBehavior='auto'")
    for _ in range(10):
        info = await cdp.js(
            "(()=>{const e=document.getElementById('%s');if(!e)return null;"
            "const r=e.getBoundingClientRect();"
            "return {top:Math.round(r.top),bottom:Math.round(r.bottom),"
            "h:Math.round(r.height),vh:window.innerHeight};})()" % element_id)
        if not info or info["h"] == 0:
            break
        top, bottom, vh = info["top"], info["bottom"], info["vh"]
        if top >= 60 and bottom <= vh - 60:
            break   # 十分画面内
        # 画面外 → ホイールで寄せる
        delta = top - int(vh * 0.35)
        await cdp.js("window.scrollBy(0,%d)" % delta)
        await asyncio.sleep(0.25)

    pos = await cdp.center_of(element_id)
    if not pos:
        print("    click(%s): not found" % element_id, flush=True)
        await cdp.js("(()=>{const b=document.getElementById('%s');if(b&&!b.disabled)b.click();})()" % element_id)
        return
    # 座標が画面外なら、もう一度だけ中央寄せを試す
    if pos["y"] < 20 or pos["y"] > 1010:
        await cdp.js("(()=>{const e=document.getElementById('%s');"
                     "if(e)e.scrollIntoView({block:'center',behavior:'instant'});})()" % element_id)
        await asyncio.sleep(0.4)
        pos = await cdp.center_of(element_id) or pos
    if pos["y"] < 20 or pos["y"] > 1010:
        print("    click(%s): out of view (y=%d), js fallback" % (element_id, pos["y"]), flush=True)
        await cdp.js("(()=>{const b=document.getElementById('%s');if(b&&!b.disabled)b.click();})()" % element_id)
        return
    if False:
        # 見えない／存在しない場合は JS クリックにフォールバック
        print("    click(%s): not visible, js fallback" % element_id, flush=True)
        await cdp.js("(()=>{const b=document.getElementById('%s');if(b&&!b.disabled)b.click();})()" % element_id)
        return

    x, y = pos["x"], pos["y"]
    # 画面外なら座標をクランプ
    x = max(2, min(x, 1918))
    y = max(2, min(y, 1076))
    print("    click(%s) at (%d,%d)" % (element_id, x, y), flush=True)
    await cdp.mouse_click(x, y)
    # クリックが効かなかった場合の保険（disabled でないのに反応しない時）
    await asyncio.sleep(0.15)


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


def get_chrome_rect(fragment="Tuesday"):
    """★Chrome kiosk の実際のウィンドウ矩形を返す (x, y, w, h)。

    ボスの要求（2026-10-19）: 「PC画面全体ではなくブラウザ画面だけを撮る」。
    gdigrab の -offset_x/-offset_y/-video_size にこの矩形を渡せば、
    タスクバーも他のウィンドウも入らない。
    """
    script = (
        "$ErrorActionPreference='SilentlyContinue'; "
        "Add-Type -TypeDefinition 'using System;"
        "using System.Runtime.InteropServices;"
        "[StructLayout(LayoutKind.Sequential)] public struct RECT {"
        "public int Left, Top, Right, Bottom; }"
        "public class R {"
        "[DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr h, out RECT r);"
        "}'; "
        "Get-Process chrome | "
        "Where-Object { $_.MainWindowTitle -like '*" + fragment + "*' } | "
        "ForEach-Object {"
        "$r = New-Object RECT; "
        "[R]::GetWindowRect($_.MainWindowHandle, [ref]$r) | Out-Null; "
        "Write-Output ($r.Left.ToString() + ',' + $r.Top.ToString() + ',' + "
        "($r.Right - $r.Left).ToString() + ',' + ($r.Bottom - $r.Top).ToString())"
        "}"
    )
    r = subprocess.run(["powershell", "-NoProfile", "-Command", script],
                       capture_output=True, text=True, timeout=60)
    out = (r.stdout or "").strip().split("\n")
    for line in out:
        line = line.strip()
        if "," in line:
            try:
                x, y, w, h = [int(v) for v in line.split(",")]
                return x, y, w, h
            except Exception:
                continue
    return None


def minimize_all_windows():
    """Record-time guard: drop every other window before ffmpeg grabs the desktop.

    Measured failure (2026-10-24): gdigrab captures the whole desktop, so an open
    chat window sat over the right half of the demo in the finished take. Kiosk
    is fullscreen but loses the foreground to whatever the user last touched.
    """
    script = (
        "$shell = New-Object -ComObject Shell.Application; "
        "$shell.MinimizeAll(); "
        "Start-Sleep -Milliseconds 900"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", script],
                   capture_output=True, timeout=90)
    print("  minimized all windows", flush=True)


def force_foreground(fragment="Tuesday"):
    """Bring the kiosk window back to the front by title fragment."""
    script = (
        "$ErrorActionPreference='SilentlyContinue'; "
        "Add-Type -TypeDefinition 'using System;"
        "using System.Runtime.InteropServices;"
        "public class W {"
        "[DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h);"
        "[DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int n);"
        "}'; "
        "Get-Process chrome | "
        "Where-Object { $_.MainWindowTitle -like '*" + fragment + "*' } | "
        "ForEach-Object { [W]::ShowWindow($_.MainWindowHandle, 3) | Out-Null; "
        "[W]::SetForegroundWindow($_.MainWindowHandle) | Out-Null }"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", script],
                   capture_output=True, timeout=90)


def start_recording(seconds, width=1920, height=1032):
    """★ブラウザのウィンドウ矩形だけを録画する。

    ボスの要求（2026-10-19）: 「PC画面全体ではなくブラウザ画面だけを撮る」。
    デスクトップ全体を撮ると、タスクバー・通知・他アプリが映り込む。
    Chrome kiosk の実矩形を取得し、その範囲だけを gdigrab で切り取る。
    """
    height -= height % 2
    minimize_all_windows()
    force_foreground("Tuesday")
    time.sleep(1.2)

    rect = get_chrome_rect("Tuesday")
    if rect:
        x, y, w, h = rect
        # ★ウィンドウ矩形は枠シャドウを含むため画面外に (-8,-8) へはみ出す。
        #   gdigrab はそれを拒否する（Capture area extends outside window area）。
        #   画面内にクランプする。
        SCREEN_W, SCREEN_H = 1920, 1080
        TASKBAR_H = 48          # Windows のタスクバー高さ（実測: y=1032〜1080）
        TITLEBAR_H = 40         # --app モードのウィンドウ枠（実測: コンテンツ開始 y=40px）
        USABLE_TOP = TITLEBAR_H
        USABLE_BOTTOM = SCREEN_H - TASKBAR_H     # 1032
        # ★上はタイトルバーを避け、下はタスクバーを避ける。
        #   両方入れないと「ブラウザ画面だけ」にならない（2026-10-24 実測）。
        x = max(0, min(x, SCREEN_W - 2))
        y = max(USABLE_TOP, min(y + TITLEBAR_H, SCREEN_H - 2))
        w = min(w + (x - rect[0]), SCREEN_W - x)
        h = min(h + (y - rect[1]) - TITLEBAR_H, USABLE_BOTTOM - y)
        w -= w % 2
        h -= h % 2
        print("  usable area: y=%d..%d (titlebar %d / taskbar %d)"
              % (USABLE_TOP, USABLE_BOTTOM, TITLEBAR_H, TASKBAR_H), flush=True)
        print("  recording rect from Chrome: x=%d y=%d %dx%d (raw %s)"
              % (x, y, w, h, rect), flush=True)
        offset_x, offset_y = x, y
        video_w, video_h = w, h
    else:
        print("  ★Chrome rect not found - falling back to full desktop", flush=True)
        offset_x, offset_y = 0, 0
        video_w, video_h = width, height - (height % 2)

    return subprocess.Popen(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-f", "gdigrab",
         "-framerate", "30", "-t", str(seconds),
         "-offset_x", str(offset_x), "-offset_y", str(offset_y),
         "-video_size", "%dx%d" % (video_w, video_h), "-i", "desktop",
         "-c:v", "libx264", "-preset", "ultrafast", "-crf", "12", "-pix_fmt", "yuv420p", TAKE])


async def record_take():
    kill_stale_kiosks(CDP_PORT)
    subprocess.Popen(
        # ★--kiosk ではなく --app モードを使う（2026-10-24 実測）
        #   kiosk は --window-size を無視して常に全画面(1920x1080)になり、
        #   タスクバーが動画に映り込む。--app モードなら 1920x1032 が効き、
        #   タスクバー48pxを避けられる。
        #   ボスの要求「PC画面全体ではなくブラウザ画面だけを撮る」を満たす。
        [CHROME, "--app=%s?%s" % (APP_URL, TAKE_TAG),
         "--remote-debugging-port=%d" % CDP_PORT,
         "--user-data-dir=" + APP_PROFILE, "--no-first-run", "--no-default-browser-check",
         "--force-device-scale-factor=1", "--hide-scrollbars",
         "--disk-cache-size=1", "--window-position=0,0", "--window-size=1920,1032"],
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
        mp = os.path.join(VID_DIR, "marks_v17.json")
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
    """Beat start times in the take, measured while recording (marks_v17.json).

    Not estimated from the plan: waits for verdicts and late layout add real
    seconds, and a fixed offset cut the ledger beat onto the proof panel.
    """
    p = os.path.join(VID_DIR, "marks_v17.json")
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
        fc.append("[%d:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:%.3f,asetpts=PTS-STARTPTS[a%d]"
                  % (ai, dur, i))
    fc.append("%sconcat=n=%d:v=1:a=1[vout][aout]"
              % ("".join("[v%d][a%d]" % (i, i) for i in range(len(BEATS))), len(BEATS)))

    cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error"] + inputs + [
        "-filter_complex", ";".join(fc), "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "slow", "-b:v", "10000k", "-maxrate", "12000k",
        "-bufsize", "20000k", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", OUTPUT]
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
