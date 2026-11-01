"""Read the whole submission back and print every field, so it can be diffed.

Runs against the already-authenticated session on port 9413 (the browser that was
just logged in through GitHub OAuth). Nothing here writes.

Prints, in order:
  * whether the account is logged in and which project is open,
  * each of the five submission steps and its state,
  * project details: name, tagline, story length and head, video URL, all URLs,
  * the gallery: every image URL plus its caption,
  * the additional-info answers.

Run:
  env -u PYTHONPATH .venv/Scripts/python.exe devpost_final_check.py
"""
import asyncio
import json
import urllib.request

import websockets

PORT = 9413
BASE = ("https://devpost.com/submit-to/31302-paypal-ai-hackathon/manage/"
        "submissions/1220364-tuesday")


async def main():
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
                return "__ERR__" + str(r["exceptionDetails"].get("text"))[:140]
            return r.get("result", {}).get("value")

        await cmd("Page.enable")

        # ---- manage overview ---------------------------------------------------
        await cmd("Page.navigate", url=BASE)
        await asyncio.sleep(9)
        print("=== manage overview ===")
        print("url:", await js("location.href"))
        print(json.dumps(await js("""
          (()=>{
            const txt=(document.body.innerText||'').replace(/\\s+/g,' ');
            return {
              submitted: /SUBMITTED/i.test(txt),
              steps: (txt.match(/\\d\\s*\\/\\s*\\d+\\s*steps?/i)||[])[0]||null,
              deadline: (txt.match(/\\d+\\s*days? to deadline/i)||[])[0]||null,
              head: txt.slice(0,320)
            };
          })()
        """), ensure_ascii=False, indent=1))

        # ---- project details ---------------------------------------------------
        await cmd("Page.navigate", url=BASE + "/project_details/edit")
        await asyncio.sleep(9)
        print("\n=== project details ===")
        det = await js("""
          (()=>{
            const t=document.getElementById('software_description');
            const v=document.getElementById('software_video_url');
            const g=id=>{const e=document.getElementById(id);return e?e.value:null;};
            const urls=[...document.querySelectorAll('input[id*="urls_attributes"][id$="_url"]')]
                        .map(e=>e.value).filter(Boolean);
            return {
              storyLen: t?t.value.length:null,
              videoUrl: v?v.value:null,
              urls,
              name: g('software_name'),
              tagline: g('software_tagline')
            };
          })()
        """)
        print(json.dumps(det, ensure_ascii=False, indent=1))
        if isinstance(det, dict) and det.get("storyLen"):
            story = await js("document.getElementById('software_description').value") or ""
            open(r"C:\Users\hohoh\Desktop\triad-clean\docs\devpost\_live_story.txt",
                 "w", encoding="utf-8").write(story)
            print("live story saved:", len(story), "chars")

        # ---- gallery: images AND their captions --------------------------------
        print("\n=== gallery ===")
        gal = await js("""
          (()=>{
            const out=[];
            // Devpost renders each gallery item as a figure with an img and a caption
            document.querySelectorAll('figure, .software-photo, li').forEach(node=>{
              const img=node.querySelector && node.querySelector('img');
              if(!img) return;
              const src=img.src||'';
              if(!/software_photos|cloudfront|devpost/i.test(src)) return;
              const cap=(node.querySelector('figcaption, .caption, p')||{}).textContent||'';
              out.push({src:src.split('/').slice(-3, -1).join('/'), cap:(cap||'').trim(), alt:(img.alt||'').trim()});
            });
            // dedupe by src
            const seen=new Set(); const uniq=[];
            for(const o of out){ if(!seen.has(o.src)){ seen.add(o.src); uniq.push(o);} }
            return uniq;
          })()
        """)
        print(json.dumps(gal, ensure_ascii=False, indent=1)[:6000])

    print("\ndone")


if __name__ == "__main__":
    asyncio.run(main())
