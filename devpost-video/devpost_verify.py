"""Read the Devpost submission back and compare it with the repository.

Deliberately read-only: nothing here writes to Devpost. It opens the manage page
(which lists every step), then the project-details and additional-info edit pages,
and prints what each field actually holds so the two sources can be diffed.

Run:
  env -u PYTHONPATH .venv/Scripts/python.exe devpost_verify.py
"""
import asyncio
import json
import os
import subprocess
import time
import urllib.request

import websockets

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BASE = "https://devpost.com/submit-to/31302-paypal-ai-hackathon/manage/submissions/1220364-tuesday"
PROFILE = os.path.expanduser("~/chrome-devpost-prof")
PORT = 9411


async def main():
    proc = subprocess.Popen(
        [CHROME, "--remote-debugging-port=%d" % PORT, "--user-data-dir=" + PROFILE,
         "--no-first-run", "--no-default-browser-check",
         "--force-device-scale-factor=1", "--window-position=0,0",
         "--window-size=1600,1200", BASE],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(12)

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

        # ---- 1. the manage page: which steps are done -------------------------
        await asyncio.sleep(3)
        print("=== manage page ===")
        print("url:", await js("location.href"))
        print(json.dumps(await js("""
          (()=>{
            const body=document.body.innerText||'';
            const steps=[...document.querySelectorAll('li,div')].filter(e=>
              e.children.length<6 && /Manage team|Project overview|Project details|Additional info|Submit/i.test(e.textContent||'')
            ).slice(0,10).map(e=>e.textContent.replace(/\\s+/g,' ').trim().slice(0,80));
            const counts=(body.match(/\\d+\\s*\\/\\s*\\d+\\s*steps?/i)||[])[0]||null;
            const submitted=/SUBMITTED/i.test(body);
            return {steps, counts, submitted};
          })()
        """), ensure_ascii=False, indent=1))

        # ---- 2. project details ----------------------------------------------
        await cmd("Page.navigate", url=BASE + "/project_details/edit")
        await asyncio.sleep(9)
        print("\n=== project details ===")
        detail = await js("""
          (()=>{
            const t=document.getElementById('software_description');
            const v=document.getElementById('software_video_url');
            const urls=[...document.querySelectorAll('input[id*="urls_attributes"][id$="_url"]')]
                        .map(i=>i.value).filter(Boolean);
            const name=document.querySelector('#software_name, input[name="software[name]"]');
            const tag=document.querySelector('#software_tagline, input[name="software[tagline]"]');
            return {
              storyLen: t?t.value.length:null,
              storyHead: t?t.value.slice(0,220):null,
              videoUrl: v?v.value:null,
              urls,
              name: name?name.value:null,
              tagline: tag?tag.value:null
            };
          })()
        """)
        print(json.dumps(detail, ensure_ascii=False, indent=1))
        if isinstance(detail, dict) and detail.get("storyHead"):
            open(r"C:\Users\hohoh\Desktop\triad-clean\docs\devpost\_live_story.txt",
                 "w", encoding="utf-8").write(await js("document.getElementById('software_description').value") or "")

        # built-with tags
        print("\nbuilt with:", json.dumps(await js("""
          (()=>{
            const out=[...document.querySelectorAll('a[href*="/software/"], .built-with a, #built-with a')]
              .map(a=>a.textContent.trim()).filter(x=>x && x.length<40);
            const chips=[...document.querySelectorAll('[class*="tag"], [class*="tech"]')]
              .map(e=>e.textContent.trim()).filter(x=>x && x.length<40);
            return [...new Set([...out,...chips])].slice(0,20);
          })()
        """), ensure_ascii=False))

        # ---- 3. the gallery ---------------------------------------------------
        print("\n=== gallery ===")
        print(json.dumps(await js("""
          (()=>{
            const imgs=[...document.querySelectorAll('img')].map(i=>({
              src:(i.src||'').split('/').pop().slice(0,60), alt:(i.alt||'').slice(0,140)
            })).filter(x=>/devpost-media|d2ks5oxyl2w5ot|cloudfront|amazonaws/i.test(x.src)||x.alt);
            const files=[...document.querySelectorAll('input[type=file]')].map(f=>({id:f.id,name:f.name,multiple:f.multiple,files:f.files?f.files.length:0}));
            return {images:imgs.slice(0,20), fileInputs:files};
          })()
        """), ensure_ascii=False, indent=1)[:4000])

    proc.terminate()
    print("\ndone")


if __name__ == "__main__":
    asyncio.run(main())
