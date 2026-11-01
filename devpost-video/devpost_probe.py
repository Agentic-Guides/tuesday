"""Inspect the Devpost project-details form: what the story field holds and what it allows.

Deliberately read-only. The point is to learn three things before typing anything:
  * the textarea's maxlength / character counter (so a paste that would silently
    truncate is caught before it happens),
  * what the story field currently contains, so a rewrite can be diffed against it,
  * whether the video URL field is still empty.

Run:
  env -u PYTHONPATH .venv/Scripts/python.exe devpost_probe.py
"""
import asyncio
import json
import os
import subprocess
import time
import urllib.request

import websockets

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = ("https://devpost.com/submit-to/31302-paypal-ai-hackathon/manage/"
       "submissions/1220364-tuesday/project_details/edit")
PROFILE = os.path.expanduser("~/chrome-devpost-prof")
PORT = 9410


async def main():
    proc = subprocess.Popen(
        [CHROME, "--remote-debugging-port=%d" % PORT, "--user-data-dir=" + PROFILE,
         "--no-first-run", "--no-default-browser-check",
         "--force-device-scale-factor=1", "--window-position=0,0",
         "--window-size=1600,1200", URL],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(12)

    tabs = json.loads(urllib.request.urlopen(
        "http://127.0.0.1:%d/json/list" % PORT, timeout=10).read())
    page = next((t for t in tabs if t.get("type") == "page" and "devpost.com" in (t.get("url") or "")), None)
    if not page:
        print("no devpost tab. tabs:")
        for t in tabs:
            print("  ", t.get("type"), (t.get("url") or "")[:100])
        proc.terminate()
        return

    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=60 * 1024 * 1024) as ws:
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
                return {"__error__": str(r["exceptionDetails"].get("text"))[:160]}
            return r.get("result", {}).get("value")

        await cmd("Page.enable")
        print("url:", await js("location.href"))
        print("title:", await js("document.title"))
        print("logged in:", await js(
            "!!document.querySelector('a[href*=\"/users/\"], .user-profile, [data-user-id]')"))

        # every textarea on the page: id, name, length, maxlength
        print("\n--- textareas ---")
        print(json.dumps(await js("""
          (()=>Array.from(document.querySelectorAll('textarea')).map(t=>({
            id:t.id, name:t.name, cls:(t.className||'').slice(0,40),
            len:(t.value||'').length, maxlength:t.maxLength,
            first:(t.value||'').slice(0,60)
          })))()
        """), indent=1, ensure_ascii=False))

        # inputs that look like the video field
        print("\n--- likely video fields ---")
        print(json.dumps(await js("""
          (()=>Array.from(document.querySelectorAll('input')).filter(i=>{
            const s=(i.id+' '+i.name+' '+i.className+' '+(i.placeholder||'')).toLowerCase();
            return s.includes('video')||s.includes('youtube')||s.includes('url');
          }).map(i=>({id:i.id,name:i.name,type:i.type,value:i.value,placeholder:i.placeholder})))()
        """), indent=1, ensure_ascii=False))

        # character counters anywhere
        print("\n--- counters ---")
        print(json.dumps(await js("""
          (()=>Array.from(document.querySelectorAll('*')).filter(e=>
             e.children.length===0 && /^\\s*\\d+\\s*(\\/|of)\\s*\\d+\\s*$/.test(e.textContent||'')
          ).slice(0,12).map(e=>e.textContent.trim()))()
        """), indent=1, ensure_ascii=False))

        shot = await cmd("Page.captureScreenshot", format="png")
        import base64
        p = r"C:\Users\hohoh\AppData\Local\Temp\devpost_probe.png"
        with open(p, "wb") as f:
            f.write(base64.b64decode(shot["data"]))
        print("\nscreenshot:", p, os.path.getsize(p), "B")

    print("\n(leaving the browser open for the next step)")
    # do not terminate: the next step drives this same session


if __name__ == "__main__":
    asyncio.run(main())
