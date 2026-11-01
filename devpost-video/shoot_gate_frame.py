"""Shoot one frame that proves the money gate: DENIED verdict + "PayPal was not called".

The gallery already has 03_denied.png, but that frame is scrolled to the verdict banner
and the PayPal panel sits below the fold, so a reader sees "DENIED" and has to take the
claim on trust. This frame puts both in one picture: the verdict banner, the three votes,
and the settlement panel that says Order: none.

The debate block is tall (three agent columns). For this frame only it is clamped to a
readable height so the settlement panel fits under it -- the clamp is applied in the page
for the screenshot and removed immediately after, so nothing shipped depends on it.
"""
import asyncio
import base64
import json
import os
import subprocess
import time
import urllib.request

import websockets

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
APP_URL = "http://localhost:8787/?take=gate"
OUT = r"C:\Users\hohoh\Desktop\triad-clean\devpost-media\03b_denied_nopaypal.png"
PROFILE = os.path.expanduser("~/chrome-gallery-prof")
PORT = 9404


async def main():
    proc = subprocess.Popen(
        [CHROME, "--remote-debugging-port=%d" % PORT, "--user-data-dir=" + PROFILE,
         "--no-first-run", "--no-default-browser-check",
         "--disable-features=Translate,TranslateUI,TranslateNewUX",
         "--lang=en-US", "--accept-lang=en-US,en",
         "--force-device-scale-factor=1", "--hide-scrollbars",
         "--window-position=0,0", "--window-size=1920,1080", APP_URL],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(10)

    tabs = json.loads(urllib.request.urlopen(
        "http://127.0.0.1:%d/json/list" % PORT, timeout=10).read())
    page = next((t for t in tabs if t.get("type") == "page" and "8787" in (t.get("url") or "")), None)
    if not page:
        print("no app tab")
        proc.terminate()
        return

    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=40 * 1024 * 1024) as ws:
        i = 0

        async def cmd(m, **p):
            nonlocal i
            i += 1
            await ws.send(json.dumps({"id": i, "method": m, "params": p}))
            while True:
                x = json.loads(await ws.recv())
                if x.get("id") == i:
                    return x.get("result", {})

        async def js(e):
            r = await cmd("Runtime.evaluate", expression=e, returnByValue=True, awaitPromise=True)
            if r.get("exceptionDetails"):
                print("  JS ERROR:", str(r["exceptionDetails"].get("text"))[:120])
            return r.get("result", {}).get("value")

        await cmd("Page.enable")
        await cmd("Emulation.setDeviceMetricsOverride", width=1920, height=1080,
                  deviceScaleFactor=1, mobile=False)
        await js("document.documentElement.style.scrollBehavior='auto'")

        # run the refused purchase: $500 against a $1 budget
        await js("showTab('direct')")
        await asyncio.sleep(0.8)
        for field, val in (("d_budget", "1"), ("d_amount", "500")):
            await js("(()=>{const e=document.getElementById('%s');if(!e)return;e.value='%s';"
                     "e.dispatchEvent(new Event('input',{bubbles:true}));"
                     "e.dispatchEvent(new Event('change',{bubbles:true}));})()" % (field, val))
            await asyncio.sleep(0.3)
        await js("document.getElementById('run').click()")

        for _ in range(160):
            await asyncio.sleep(0.5)
            txt = await js("document.getElementById('decision').textContent") or ""
            if "DENIED" in txt:
                break
        await asyncio.sleep(2.0)

        verdict = await js("document.getElementById('decision').textContent")
        ptext = await js("document.getElementById('paypal').textContent")
        print("verdict:", (verdict or "").strip()[:70])
        print("paypal :", (ptext or "").strip()[:70])
        if "PayPal was not called" not in (ptext or ""):
            print("!! the panel does not carry the claim; not shooting")
            proc.terminate()
            return

        # clamp the debate block so the settlement panel joins the verdict in one frame
        await js("(()=>{const a=document.getElementById('agents');"
                 "a.dataset.h=a.style.maxHeight||'';"
                 "a.style.maxHeight='230px';a.style.overflow='hidden';})()")
        await asyncio.sleep(0.6)
        await js("(()=>{const d=document.getElementById('decision');"
                 "d.scrollIntoView({block:'start',behavior:'instant'});"
                 "window.scrollBy(0,-8);})()")
        await asyncio.sleep(1.2)

        vis = await js("(()=>{const d=document.getElementById('decision').getBoundingClientRect();"
                       "const p=document.getElementById('paypalWrap').getBoundingClientRect();"
                       "return {dTop:Math.round(d.top),pTop:Math.round(p.top),"
                       "pH:Math.round(p.height),vh:window.innerHeight};})()")
        print("layout:", vis)

        shot = await cmd("Page.captureScreenshot", format="png")
        with open(OUT, "wb") as f:
            f.write(base64.b64decode(shot["data"]))
        print("saved:", OUT, os.path.getsize(OUT), "B")

        await js("(()=>{const a=document.getElementById('agents');"
                 "a.style.maxHeight=a.dataset.h||'';a.style.overflow='';})()")

    proc.terminate()
    print("done")


if __name__ == "__main__":
    asyncio.run(main())
