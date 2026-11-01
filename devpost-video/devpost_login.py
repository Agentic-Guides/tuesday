"""Log into Devpost through GitHub OAuth, then read the submission back.

The procedure is the one recorded in the vault (devpost-hub.md, measured 2026-10-06):
  1. https://devpost.com/authentications/initiate/github
  2. GitHub's login page (gh CLI is already authenticated as Agentic-Guides)
  3. GitHub mails a Device verification code -- that one step needs a human
  4. Devpost then logs in automatically

This script walks to step 3 and stops, printing the page state, so the code can be
supplied in a separate call. Nothing is guessed: if a step does not look the way the
vault says it should, it says so and stops rather than clicking blindly.

Run:
  env -u PYTHONPATH .venv/Scripts/python.exe devpost_login.py
"""
import asyncio
import json
import os
import subprocess
import time
import urllib.request

import websockets

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
START = "https://devpost.com/authentications/initiate/github"
PROFILE = os.path.expanduser("~/chrome-devpost-prof")
PORT = 9413


async def connect():
    proc = subprocess.Popen(
        [CHROME, "--remote-debugging-port=%d" % PORT, "--user-data-dir=" + PROFILE,
         "--no-first-run", "--no-default-browser-check",
         "--force-device-scale-factor=1", "--window-position=0,0",
         "--window-size=1280,1000", START],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(10)
    tabs = json.loads(urllib.request.urlopen(
        "http://127.0.0.1:%d/json/list" % PORT, timeout=10).read())
    page = next((t for t in tabs if t.get("type") == "page" and
                 ("devpost.com" in (t.get("url") or "") or "github.com" in (t.get("url") or ""))), None)
    return proc, page


async def main():
    proc, page = await connect()
    if not page:
        print("no tab")
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
                return "__ERR__" + str(r["exceptionDetails"].get("text"))[:140]
            return r.get("result", {}).get("value")

        await cmd("Page.enable")
        for _ in range(20):
            await asyncio.sleep(1)
            href = await js("location.href")
            if href and "github.com" in href:
                break

        print("url:", await js("location.href"))
        print("title:", await js("document.title"))

        # What does the page need from us? Describe it rather than assume it.
        state = await js("""
          (()=>{
            const body=(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,600);
            const inputs=[...document.querySelectorAll('input')].map(i=>({
              id:i.id, name:i.name, type:i.type, ph:i.placeholder||'', autofocus:i.autofocus
            }));
            const buttons=[...document.querySelectorAll('button, input[type=submit]')]
              .map(b=>({txt:(b.textContent||b.value||'').trim().slice(0,40), type:b.type||''}))
              .filter(b=>b.txt);
            return {body, inputs, buttons};
          })()
        """)
        print(json.dumps(state, ensure_ascii=False, indent=1)[:3000])

        shot = await cmd("Page.captureScreenshot", format="png")
        import base64
        p = r"C:\Users\hohoh\AppData\Local\Temp\devpost_login_state.png"
        open(p, "wb").write(base64.b64decode(shot["data"]))
        print("\nscreenshot:", p, os.path.getsize(p), "B")

    print("\n(browser left open at this step)")
    # do not terminate: the code entry happens in the next call against this session


if __name__ == "__main__":
    asyncio.run(main())
