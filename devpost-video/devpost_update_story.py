"""Update the live Devpost story so it carries the hosted demo URL and a clone line.

The organisers' reminder says a judge must be able to find something runnable. The
story said "node demo/server.mjs -> localhost:8787" but gave neither the hosted URL
nor a copy-pasteable clone, so this replaces the whole description with the current
docs/devpost/project_story_paste.txt.

Measured behaviour of the form (vault, devpost-hub.md): a bare element.value
assignment is discarded on save. The way that survives is focus, set, then fire
input + change, then a real mouse click on Save after scrolling it into view. The
page is reloaded afterwards and the field read back, because a changed URL is not
proof of a save.

Run:
  env -u PYTHONPATH .venv/Scripts/python.exe devpost_update_story.py
"""
import asyncio
import json
import time
import urllib.request

import websockets

PORT = 9413
URL = ("https://devpost.com/submit-to/31302-paypal-ai-hackathon/manage/"
       "submissions/1220364-tuesday/project_details/edit")
STORY = r"C:\Users\hohoh\Desktop\triad-clean\docs\devpost\project_story_paste.txt"


async def main():
    new_val = open(STORY, encoding="utf-8").read()
    print("paste length:", len(new_val))

    tabs = json.loads(urllib.request.urlopen(
        "http://127.0.0.1:%d/json/list" % PORT, timeout=10).read())
    page = next((t for t in tabs if t.get("type") == "page"), None)
    if not page:
        print("no tab")
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
                return "__ERR__" + str(r["exceptionDetails"].get("text"))[:160]
            return r.get("result", {}).get("value")

        await cmd("Page.enable")
        await cmd("Page.navigate", url=URL)

        # The page renders "Loading..." first; a fixed sleep raced it and reported the
        # field as missing on an authenticated session. Poll for the field instead.
        cur = None
        for _ in range(40):
            await asyncio.sleep(1)
            cur = await js("document.getElementById('software_description') ? document.getElementById('software_description').value : null")
            if cur:
                break
        if not cur:
            print("field never appeared; url:", await js("location.href"))
            return
        print("current length:", len(cur))
        if cur == new_val:
            print("already up to date; nothing to do")
            return

        await js("document.getElementById('software_description').focus()")
        await asyncio.sleep(0.4)
        await js("""(()=>{
            const t=document.getElementById('software_description');
            t.value = %s;
            t.dispatchEvent(new Event('input',{bubbles:true}));
            t.dispatchEvent(new Event('change',{bubbles:true}));
            t.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true}));
        })()""" % json.dumps(new_val))
        await asyncio.sleep(1.2)
        after = await js("document.getElementById('software_description').value") or ""
        print("field length after set:", len(after), "| matches:", after == new_val)

        rect = await js("""(()=>{
            const b=[...document.querySelectorAll('button, input[type=submit]')]
              .find(x=>/save|continue/i.test((x.textContent||x.value||'')));
            if(!b) return null;
            b.scrollIntoView({block:'center',behavior:'instant'});
            const r=b.getBoundingClientRect();
            return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2),
                    txt:(b.textContent||b.value||'').trim().slice(0,30)};
        })()""")
        print("save button:", rect)
        if rect and rect.get("x"):
            for ev in ("mousePressed", "mouseReleased"):
                await cmd("Input.dispatchMouseEvent", type=ev, x=rect["x"], y=rect["y"],
                          button="left", clickCount=1)
                await asyncio.sleep(0.15)
            print("clicked:", rect["txt"])
        await asyncio.sleep(7)
        print("url now:", await js("location.href"))

        # ---- verify by reloading and reading back --------------------------
        await cmd("Page.navigate", url=URL)
        back = None
        for _ in range(40):
            await asyncio.sleep(1)
            back = await js("document.getElementById('software_description') ? document.getElementById('software_description').value : null")
            if back:
                break
        print("\n--- after reload ---")
        print("length:", len(back) if back else None)
        if back:
            print("matches the paste:", back == new_val)
            print("has hosted URL:", "tuesday-paypal.onrender.com" in back)
            print("has git clone:", "git clone" in back)
            print("video URL:", await js("(document.getElementById('software_video_url')||{}).value"))

    print("\ndone")


if __name__ == "__main__":
    asyncio.run(main())
