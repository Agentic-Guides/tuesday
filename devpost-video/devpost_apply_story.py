"""Apply the two stale sentences to the live Devpost Project Story and verify it stuck.

What is wrong in the live copy (measured 2026-11-01):
  * "On a Tuesday at 3 AM the agent decides..." -- the demo has no clock and no
    failed renewal any more; it opens on a purchase against a budget.
  * "TUESDAY, 3 PM - CAN THE AGENT SPEND $42?" -- same leftover, and the on-screen
    heading it quotes does not say 3 PM.

Everything else in the 19,646-character story already matches the product, so this
edits two spans rather than replacing the whole field. Replacing the whole thing
would throw away text a human wrote and reviewed.

The form ignores programmatic value changes (measured: element.value = x does not
survive a save). The way that does survive is focus -> real keystrokes -> real
click on the save button after scrolling it into view. Then the page is reloaded
and the field is read back, because "the URL changed" is not proof of a save.

Run:
  env -u PYTHONPATH .venv/Scripts/python.exe devpost_apply_story.py
"""
import asyncio
import json
import time
import urllib.request

import websockets

PORT = 9410
URL = ("https://devpost.com/submit-to/31302-paypal-ai-hackathon/manage/"
       "submissions/1220364-tuesday/project_details/edit")

OLD_A = ("A skincare brand gives its restock agent a **$200/month purchasing budget**. On a Tuesday\n"
         "at 3 AM the agent decides the Vitamin C serum is running low and wants to spend $42. Nobody\n"
         "is awake to approve it.")
NEW_A = ("A skincare brand gives its restock agent a **$200/month purchasing budget**. The Vitamin C\n"
         "serum is running low, so the agent wants to spend $42 of it. Nobody is watching the number\n"
         "when it decides.")

OLD_B = "The demo opens on the question: **TUESDAY, 3 PM — CAN THE AGENT SPEND $42?**"
NEW_B = "The demo opens on the question: **CAN THE AGENT SPEND $42?**"


async def main():
    tabs = json.loads(urllib.request.urlopen(
        "http://127.0.0.1:%d/json/list" % PORT, timeout=10).read())
    page = next((t for t in tabs if t.get("type") == "page" and "devpost.com" in (t.get("url") or "")), None)
    if not page:
        print("no devpost tab on %d" % PORT)
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
                return "__ERR__" + str(r["exceptionDetails"].get("text"))[:160]
            return r.get("result", {}).get("value")

        await cmd("Page.enable")

        val = await js("document.getElementById('software_description').value") or ""
        print("current length:", len(val))
        if val.startswith("__ERR__"):
            print(val)
            return

        have_a = OLD_A in val
        have_b = OLD_B in val
        print("OLD_A present:", have_a, "| OLD_B present:", have_b)
        if not have_a and not have_b:
            print("nothing to change -- both spans are already gone")
            return

        # Build the edited text; do the replacement on the page itself so the browser's own
        # value is the source of truth (line endings and unicode stay exactly as they are).
        new_val = val
        if have_a:
            new_val = new_val.replace(OLD_A, NEW_A)
        if have_b:
            new_val = new_val.replace(OLD_B, NEW_B)
        print("new length:", len(new_val), "delta:", len(new_val) - len(val))

        json.dump({"new": new_val}, open(r"C:\Users\hohoh\AppData\Local\Temp\story_new.json", "w",
                                         encoding="utf-8"), ensure_ascii=False)

        # Focus, then set through the DOM, then fire the events the form listens for.
        # A pure value assignment is discarded on save; setting it and dispatching input +
        # change on a focused element is what the form's own listeners need to see.
        await js("document.getElementById('software_description').focus()")
        await asyncio.sleep(0.4)
        await js("""(()=>{
            const t=document.getElementById('software_description');
            t.value = %s;
            t.dispatchEvent(new Event('input',{bubbles:true}));
            t.dispatchEvent(new Event('change',{bubbles:true}));
            t.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true}));
        })()""" % json.dumps(new_val))
        await asyncio.sleep(1.0)
        after_set = await js("document.getElementById('software_description').value") or ""
        print("field length after set:", len(after_set), "| matches:", after_set == new_val)

        # find the save control and click it with a real mouse event
        info = await js("""(()=>{
            const cands=[...document.querySelectorAll('button, input[type=submit], a.button')];
            return cands.map(b=>({
              tag:b.tagName, id:b.id, txt:(b.textContent||b.value||'').trim().slice(0,40),
              type:b.type||'', cls:(b.className||'').slice(0,40)
            })).filter(b=>/save|next|continue|update|submit/i.test(b.txt+b.id));
        })()""")
        print("save candidates:", json.dumps(info, ensure_ascii=False, indent=1))

        rect = await js("""(()=>{
            const b=[...document.querySelectorAll('button, input[type=submit]')]
              .find(x=>/save|next|continue/i.test((x.textContent||x.value||'')));
            if(!b) return null;
            b.scrollIntoView({block:'center',behavior:'instant'});
            const r=b.getBoundingClientRect();
            return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2),
                    txt:(b.textContent||b.value||'').trim().slice(0,30)};
        })()""")
        print("save button rect:", rect)

        if rect and rect.get("x"):
            for ev, extra in (("mousePressed", {"button": "left", "clickCount": 1}),
                              ("mouseReleased", {"button": "left", "clickCount": 1})):
                await cmd("Input.dispatchMouseEvent", type=ev, x=rect["x"], y=rect["y"], **extra)
                await asyncio.sleep(0.15)
            print("clicked:", rect["txt"])
        else:
            print("!! no save button found; not clicking anything")

        await asyncio.sleep(6)
        print("url now:", await js("location.href"))

    # ---- verify: reload the edit page and read the field back -------------------
    await asyncio.sleep(2)
    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=60 * 1024 * 1024) as ws:
        i2 = 0

        async def cmd2(m, **p):
            nonlocal i2
            i2 += 1
            await ws.send(json.dumps({"id": i2, "method": m, "params": p}))
            while True:
                x = json.loads(await ws.recv())
                if x.get("id") == i2:
                    return x.get("result", {})

        async def js2(e):
            r = await cmd2("Runtime.evaluate", expression=e, returnByValue=True, awaitPromise=True)
            return r.get("result", {}).get("value")

        await cmd2("Page.navigate", url=URL)
        await asyncio.sleep(10)
        back = await js2("document.getElementById('software_description') ? document.getElementById('software_description').value : null")
        if back is None:
            print("!! could not re-read the field after reload")
            return
        print("\n--- after reload ---")
        print("length:", len(back))
        print("OLD_A gone:", OLD_A not in back)
        print("OLD_B gone:", OLD_B not in back)
        print("NEW_A present:", NEW_A in back)
        print("NEW_B present:", NEW_B in back)


if __name__ == "__main__":
    asyncio.run(main())
