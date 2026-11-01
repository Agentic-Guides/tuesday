"""Read the Devpost submission back and print exactly what each field holds.

Read-only. Nothing here writes to Devpost. It exists so the repository and the
submission can be diffed field by field instead of assumed to agree.

The session lives in ~/chrome-devpost-prof (the profile the story edit used), so the
same profile is reused rather than a fresh one that would arrive logged out.

Run:
  env -u PYTHONPATH .venv/Scripts/python.exe devpost_readback.py
"""
import asyncio
import json
import os
import subprocess
import time
import urllib.request

import websockets

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BASE = ("https://devpost.com/submit-to/31302-paypal-ai-hackathon/manage/"
        "submissions/1220364-tuesday")
PROFILE = os.path.expanduser("~/chrome-devpost-prof")
PORT = 9412


async def main():
    proc = subprocess.Popen(
        [CHROME, "--remote-debugging-port=%d" % PORT, "--user-data-dir=" + PROFILE,
         "--no-first-run", "--no-default-browser-check",
         "--force-device-scale-factor=1", "--window-position=0,0",
         "--window-size=1600,1200", BASE + "/project_details/edit"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(14)

    tabs = json.loads(urllib.request.urlopen(
        "http://127.0.0.1:%d/json/list" % PORT, timeout=10).read())
    page = next((t for t in tabs if t.get("type") == "page" and "devpost.com" in (t.get("url") or "")), None)
    if not page:
        print("no devpost tab")
        proc.terminate()
        return

    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=80 * 1024 * 1024) as ws:
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
                return "__ERR__" + str(r["exceptionDetails"].get("text"))[:140]
            return r.get("result", {}).get("value")

        await cmd("Page.enable")
        await asyncio.sleep(3)

        print("url:", await js("location.href"))
        logged = await js("!!document.getElementById('software_description')")
        print("logged in / form present:", logged)
        if not logged:
            print("body head:", (await js("document.body.innerText") or "")[:400])
            proc.terminate()
            return

        # ---- the three fields that matter -------------------------------------
        print("\n=== project_details ===")
        print(json.dumps(await js("""
          (()=>{
            const t=document.getElementById('software_description');
            const v=document.getElementById('software_video_url');
            const urls=[...document.querySelectorAll('input[id*="urls_attributes"][id$="_url"]')]
                        .map(i=>i.value).filter(Boolean);
            const g=id=>{const e=document.getElementById(id);return e?e.value:null;};
            return {
              storyLen: t?t.value.length:null,
              videoUrl: v?v.value:null,
              urls,
              name: g('software_name'),
              tagline: g('software_tagline'),
              storyHead: t?t.value.slice(0,300):null
            };
          })()
        """), ensure_ascii=False, indent=1))

        story = await js("document.getElementById('software_description').value") or ""
        out = r"C:\Users\hohoh\Desktop\triad-clean\docs\devpost\_live_story.txt"
        open(out, "w", encoding="utf-8").write(story)
        print("live story saved:", out, len(story), "chars")

        # ---- gallery ----------------------------------------------------------
        print("\n=== gallery images on this page ===")
        print(json.dumps(await js("""
          (()=>{
            const imgs=[...document.querySelectorAll('img')]
              .map(i=>({src:i.src, alt:i.alt||''}))
              .filter(x=>/software_photos|devpost-media|cloudfront/i.test(x.src));
            return imgs.slice(0,20);
          })()
        """), ensure_ascii=False, indent=1)[:3000])

        # ---- built with -------------------------------------------------------
        print("\n=== built with / tags ===")
        print(json.dumps(await js("""
          (()=>{
            const sel=['#built-with','.built-with','[id*=built]','[class*=built]'];
            const box=sel.map(s=>document.querySelector(s)).find(Boolean);
            const txt=box?box.innerText.replace(/\\s+/g,' ').trim():null;
            const chips=[...document.querySelectorAll('a.tag, .tag, .chip, span[class*=tag]')]
                        .map(e=>e.textContent.trim()).filter(x=>x&&x.length<30);
            return {box:txt? txt.slice(0,400):null, chips:[...new Set(chips)].slice(0,25)};
          })()
        """), ensure_ascii=False, indent=1))

    proc.terminate()
    print("\ndone")


if __name__ == "__main__":
    asyncio.run(main())
