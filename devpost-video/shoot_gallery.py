"""Re-shoot the eight Devpost gallery screenshots against the demo as it is now.

Why this exists (2026-11-01):
  devpost-media/01_main.png .. 08_grid.png were captured on 2026-10-17. Since then
  the direct-adjudication inputs, the seeded ledger, the dispute desk and the proof
  panel all changed, and the captions describe scenes that no longer exist (the old
  copy said "$90 against a $60 budget"; the demo now fails on $500 against $1). A
  judge comparing the gallery with the live demo sees a different product.

Run with the demo server already up on :8787:
  env -u PYTHONPATH .venv/Scripts/python.exe shoot_gallery.py
"""
import asyncio
import base64
import json
import os
import subprocess
import sys
import time
import urllib.request

import websockets

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
APP_URL = "http://localhost:8787/?take=gallery"
OUT_DIR = r"C:\Users\hohoh\Desktop\triad-clean\devpost-media"
PROFILE = os.path.expanduser("~/chrome-gallery-prof")
PORT = 9403
VIEW_W, VIEW_H = 1920, 1080


class Cdp:
    def __init__(self, ws):
        self.ws = ws
        self._id = 0

    async def cmd(self, method, **params):
        self._id += 1
        mid = self._id
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == mid:
                return msg.get("result", {})

    async def js(self, expr):
        r = await self.cmd("Runtime.evaluate", expression=expr, returnByValue=True,
                           awaitPromise=True)
        if r.get("exceptionDetails"):
            print("    JS ERROR:", str(r["exceptionDetails"].get("text"))[:120], flush=True)
            return None
        return r.get("result", {}).get("value")

    async def shot(self, name):
        await asyncio.sleep(0.8)
        r = await self.cmd("Page.captureScreenshot", format="png")
        p = os.path.join(OUT_DIR, name)
        with open(p, "wb") as f:
            f.write(base64.b64decode(r["data"]))
        print("  saved %-16s %8d B" % (name, os.path.getsize(p)), flush=True)


async def wait_for(cdp, expr, tries=120, label=""):
    for _ in range(tries):
        if await cdp.js(expr):
            return True
        await asyncio.sleep(0.5)
    print("    TIMEOUT waiting for %s" % label, flush=True)
    return False


async def main():
    proc = subprocess.Popen(
        [CHROME, "--remote-debugging-port=%d" % PORT, "--user-data-dir=" + PROFILE,
         "--no-first-run", "--no-default-browser-check",
         "--disable-features=Translate,TranslateUI,TranslateNewUX",
         "--lang=en-US", "--accept-lang=en-US,en",
         "--force-device-scale-factor=1", "--hide-scrollbars",
         "--window-position=0,0", "--window-size=%d,%d" % (VIEW_W, VIEW_H),
         APP_URL],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(9)

    tabs = json.loads(urllib.request.urlopen(
        "http://127.0.0.1:%d/json/list" % PORT, timeout=10).read())
    page = next((t for t in tabs if t.get("type") == "page" and "8787" in (t.get("url") or "")), None)
    if not page:
        print("no app tab; tabs:", [(t.get("type"), (t.get("url") or "")[:60]) for t in tabs])
        proc.terminate()
        return

    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=40 * 1024 * 1024) as ws:
        cdp = Cdp(ws)
        await cdp.cmd("Page.enable")
        await cdp.cmd("Emulation.setDeviceMetricsOverride", width=VIEW_W, height=VIEW_H,
                      deviceScaleFactor=1, mobile=False)
        await cdp.js("document.documentElement.style.scrollBehavior='auto'")

        # ---- 1. main: the opening question -------------------------------------
        await cdp.js("showTab('direct')")
        await cdp.js("window.scrollTo(0,0)")
        await asyncio.sleep(1.0)
        await cdp.shot("01_main.png")

        # ---- 2. shop: five candidates with photographs --------------------------
        await cdp.js("document.documentElement.style.scrollBehavior='auto'")
        await cdp.js("showTab('shop')")
        await asyncio.sleep(1.0)
        await cdp.js("document.getElementById('category').value='skincare'")
        await cdp.js("document.getElementById('budget').value='200'")
        await cdp.js("document.getElementById('spent').value='0'")
        await cdp.js("document.getElementById('maxPrice').value='200'")
        await cdp.js("(()=>{const b=document.getElementById('shopBtn');"
                     "if(b)b.scrollIntoView({block:'center',behavior:'instant'});})()")
        await asyncio.sleep(0.5)
        await cdp.js("document.getElementById('shopBtn').click()")
        await wait_for(cdp, "document.querySelectorAll('#candidateGrid .ag-row').length>=3", 140, "shop rows")
        await wait_for(cdp, "document.querySelectorAll('#candidateGrid img').length>=1", 40, "shop imgs")
        await asyncio.sleep(1.2)
        gp = await cdp.js("(()=>{const g=document.getElementById('candidateGrid');"
                          "const r=g.getBoundingClientRect();"
                          "return {top:Math.round(r.top+window.scrollY),h:Math.round(r.height)};})()")
        # The 44px thumbnails inside a 232px grid are illegible at 1x. Scroll so the grid
        # sits high, then scale it up from its top-left so the photographs read as
        # photographs -- the same treatment the video uses for this beat.
        if gp and gp["h"] > 40:
            await cdp.js("window.scrollTo(0,%d)" % max(0, gp["top"] - 330))
            await asyncio.sleep(0.7)
            await cdp.js("(()=>{const g=document.getElementById('candidateGrid');if(!g)return;"
                         "g.style.transformOrigin='top left';g.style.transform='scale(1.18)';"
                         "g.style.marginBottom='190px';})()")
            await asyncio.sleep(1.2)
        ok_img = await cdp.js("(()=>{const im=document.querySelector('#candidateGrid img');"
                              "if(!im)return false;const r=im.getBoundingClientRect();"
                              "return r.top>40 && r.bottom<window.innerHeight-40;})()")
        # The Tribunal column carries the verdict, and a photo with no verdict is only half
        # the point: check the whole grid fits, not just the first thumbnail.
        ok_grid = await cdp.js("(()=>{const g=document.getElementById('candidateGrid');"
                               "const r=g.getBoundingClientRect();"
                               "return r.right <= window.innerWidth+1 && r.bottom <= window.innerHeight;})()")
        print("    product photos in frame:", ok_img, "| whole grid fits:", ok_grid, flush=True)
        await cdp.shot("02_shop.png")
        await cdp.js("(()=>{const g=document.getElementById('candidateGrid');if(!g)return;"
                     "g.style.transform='';g.style.marginBottom='';})()")

        # ---- 3./4. direct adjudication: DENIED and APPROVED ---------------------
        async def adjudicate(budget, amount, want, fname, scroll_id="decision"):
            await cdp.js("showTab('direct')")
            await asyncio.sleep(0.6)
            for field, val in (("d_budget", budget), ("d_amount", amount)):
                await cdp.js("(()=>{const e=document.getElementById('%s');if(!e)return;"
                             "e.value=%r;e.dispatchEvent(new Event('input',{bubbles:true}));"
                             "e.dispatchEvent(new Event('change',{bubbles:true}));})()"
                             % (field, str(val)))
                await asyncio.sleep(0.3)
            await cdp.js("(()=>{const b=document.getElementById('run');"
                         "if(b)b.scrollIntoView({block:'center',behavior:'instant'});})()")
            await asyncio.sleep(0.5)
            await cdp.js("document.getElementById('run').click()")
            ok = await wait_for(cdp, "(document.getElementById('decision').textContent||'').includes('%s')" % want,
                                160, "verdict " + want)
            await asyncio.sleep(1.4)
            await cdp.js("(()=>{const d=document.getElementById('decision');"
                         "if(d)d.scrollIntoView({block:'start',behavior:'instant'});"
                         "window.scrollBy(0,-90);})()")
            await asyncio.sleep(0.9)
            await cdp.shot(fname)
            return ok

        print("  adjudicating DENIED ($500 against $1)...", flush=True)
        await adjudicate(1, 500, "DENIED", "03_denied.png")
        # The absence of a PayPal order is the product. Frame it together with the verdict.
        await cdp.js("(()=>{const d=document.getElementById('decision');"
                     "if(d)d.scrollIntoView({block:'start',behavior:'instant'});"
                     "window.scrollBy(0,-60);})()")
        await asyncio.sleep(0.9)
        await cdp.shot("03b_denied_nopaypal.png")
        print("  adjudicating APPROVED ($42 against $200)...", flush=True)
        await adjudicate(200, 42, "APPROVED", "04_approved.png")

        # ---- 5. the debate (three agents + dissent map) -------------------------
        await cdp.js("(()=>{const a=document.getElementById('agents');"
                     "if(a)a.scrollIntoView({block:'start',behavior:'instant'});"
                     "window.scrollBy(0,-70);})()")
        await asyncio.sleep(1.0)
        await cdp.shot("05_debate.png")

        # ---- 6. audit timeline (Bryntum) ----------------------------------------
        await cdp.js("showTab('timeline')")
        await asyncio.sleep(2.2)
        await cdp.js("(()=>{const s=document.getElementById('scheduler');"
                     "if(s)s.scrollIntoView({block:'center',behavior:'instant'});})()")
        await asyncio.sleep(1.2)
        await cdp.shot("06_timeline.png")

        # ---- 7. ledger ----------------------------------------------------------
        await cdp.js("showTab('direct')")
        await asyncio.sleep(0.5)
        await cdp.js("(()=>{const g=document.getElementById('ledgerGrid');"
                     "if(g)g.scrollIntoView({block:'start',behavior:'instant'});"
                     "window.scrollBy(0,-110);})()")
        await asyncio.sleep(1.4)
        await cdp.shot("07_ledger.png")

        # ---- 8. dispute desk ----------------------------------------------------
        await cdp.js("showTab('disputes')")
        await wait_for(cdp, "document.querySelectorAll('.dispute-card').length>0", 80, "dispute cards")
        await cdp.js("(()=>{const b=document.querySelector('.dispute-card .review-btn')"
                     "||document.querySelector('.dispute-card button')||document.querySelector('.dispute-card');"
                     "if(b)b.scrollIntoView({block:'center',behavior:'instant'});})()")
        await asyncio.sleep(1.0)
        await cdp.js("(()=>{const b=document.querySelector('.dispute-card .review-btn')"
                     "||document.querySelector('.dispute-card button');if(b)b.click();})()")
        await asyncio.sleep(12)
        await cdp.js("(()=>{const d=document.getElementById('disputeResult');"
                     "if(d)d.scrollIntoView({block:'start',behavior:'instant'});"
                     "window.scrollBy(0,-80);})()")
        await asyncio.sleep(1.2)
        await cdp.shot("08_dispute.png")

        # ---- 9. the proof panel -------------------------------------------------
        await cdp.js("showTab('direct')")
        await asyncio.sleep(0.5)
        await cdp.js("(()=>{const p=document.getElementById('proofPanel');"
                     "if(p)p.scrollIntoView({block:'start',behavior:'instant'});"
                     "window.scrollBy(0,-80);})()")
        await asyncio.sleep(0.8)
        await cdp.js("document.getElementById('proofBtn').click()")
        await wait_for(cdp, "(()=>{const v=document.getElementById('proofVerdict');"
                            "const t=(v&&v.textContent||'').trim();return t.length>0 && /[0-9]/.test(t);})()",
                       600, "proof verdict")
        pv = await cdp.js("document.getElementById('proofVerdict').textContent.trim()")
        print("  proof:", (pv or "")[:90], flush=True)
        await asyncio.sleep(1.4)
        await cdp.js("(()=>{const v=document.getElementById('proofVerdict');"
                     "if(v)v.scrollIntoView({block:'center',behavior:'instant'});"
                     "window.scrollBy(0,-140);})()")
        await asyncio.sleep(1.2)
        await cdp.shot("09_proof.png")

        # ---- 10. the 4x4 verdict grid -------------------------------------------
        await cdp.js("(()=>{const b=document.getElementById('gridBtn');if(b)b.click();})()")
        await asyncio.sleep(6)
        await cdp.js("(()=>{const g=document.getElementById('gridOut')||document.getElementById('grid');"
                     "if(g)g.scrollIntoView({block:'center',behavior:'instant'});})()")
        await asyncio.sleep(1.2)
        await cdp.shot("10_grid.png")

    proc.terminate()
    print("done")


if __name__ == "__main__":
    asyncio.run(main())
