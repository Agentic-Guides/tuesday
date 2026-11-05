"""Verify the PUBLIC Devpost page (what a judge sees) carries the new sections."""
import asyncio, json, urllib.request
import websockets

PORT = 9413
PUBLIC = "https://devpost.com/software/triad-accountable-agentic-commerce"

NEEDLES = ["Challenges", "What we learned", "What's next", "DeepSeek",
           "Live demo:", "dispute desk", "Sponsor tools"]


async def main():
    tabs = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/json/list" % PORT, timeout=10).read())
    page = next((t for t in tabs if t.get("type") == "page"), None)
    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=80*1024*1024) as ws:
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
                return "__ERR__"
            return r.get("result", {}).get("value")

        await cmd("Page.enable")
        await cmd("Page.navigate", url=PUBLIC)
        await asyncio.sleep(8)
        print("url :", await js("location.href"))
        text = await js("document.body.innerText") or ""
        print("chars:", len(text))
        for n in NEEDLES:
            print(f"  {'OK ' if n in text else 'MISS'}  {n}")
        # gallery caption table が消えたか
        print(f"  {'OK ' if 'Image gallery captions' not in text else 'STILL'}  Image gallery captions 表なし")

asyncio.run(main())
