"""Check whether the Devpost session in the CDP profile is still authenticated."""
import asyncio, json, urllib.request
import websockets

PORT = 9413
PROBE = "https://devpost.com/submit-to/31302-paypal-ai-hackathon/manage/submissions/1220364-tuesday/project_details/edit"


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
                return "__ERR__" + str(r["exceptionDetails"].get("text"))[:200]
            return r.get("result", {}).get("value")

        await cmd("Page.enable")
        await cmd("Page.navigate", url=PROBE)
        await asyncio.sleep(6)
        print("url    :", await js("location.href"))
        print("title  :", await js("document.title"))
        field = await js("document.getElementById('software_description') ? document.getElementById('software_description').value.length : null")
        print("field  :", field)
        logged = await js("!!document.querySelector('a[href*=\'log_out\'], a[href*=\'logout\'], [data-cy=\'user-menu\']')")
        print("logged :", logged)
        body = await js("document.body.innerText.slice(0,200)")
        print("body   :", (body or "").replace("\n", " | ")[:200])

asyncio.run(main())
