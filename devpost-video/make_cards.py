"""Rebuild the four narration cards in the demo's own palette (1920x1080).

The existing cards (devpost-video/card_*.png, 2026-10-12) are black-background
graphics. This project's own design system uses a four-layer light palette —
warm paper, a sunken beige, pure-white cards, one accent red — and black is
something the user has rejected by name ("我々の過去動画は黒すぎ！"). The cards are
the only assets still on the old palette, so they read as a different product
bolted onto the recording.

The colours below are read from demo/index.html's :root, not chosen here, so the
cards cannot drift from the app:

    --bg      #f0eadf   outermost warm paper
    --panel-2 #e8e1d3   sunken surface (the eyebrow strip)
    --panel   #ffffff   pure white card, lifted with a soft shadow
    --gold    #c0203c   the single accent
    --txt     #241f1a   warm black text
    --dim     #5c554b   secondary text

No font file is needed: Chrome is driven over CDP and the screenshot is taken at
1920x1080 with deviceScaleFactor=1.

    python make_cards.py
"""
import base64, json, os, socket, struct, subprocess, time, urllib.request

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUT = os.path.expanduser("~/Desktop/ht_projyekuto/triad/devpost-video")
PORT = 9444

# --- read the palette out of the app itself, never hard-code a second copy ----
APP = os.path.expanduser("~/Desktop/ht_projyekuto/triad/demo/index.html")


def app_palette():
    import re
    s = open(APP, encoding="utf-8", errors="replace").read()
    m = re.search(r":root\s*\{(.*?)\}", s, re.S)
    vars_ = {}
    if m:
        for k, v in re.findall(r"--([\w-]+)\s*:\s*([^;]+);", m.group(1)):
            vars_[k] = v.strip()
    return vars_


P = app_palette()
BG = P.get("bg", "#f0eadf")
SUNK = P.get("panel-2", "#e8e1d3")
PANEL = P.get("panel", "#ffffff")
ACC = P.get("gold", "#c0203c")
TXT = P.get("txt", "#241f1a")
DIM = P.get("dim", "#5c554b")
LINE = P.get("line", "#d9d0bd")

CARDS = [
    ("card_title.png", "PAYPAL AGENT TOOLKIT × MCP",
     "Tuesday",
     "Adversarial consensus for autonomous commerce",
     "Three AI agents debate a failed renewal. A PayPal subscription moves only on their agreement, and the receipt is the audit trail."),
    ("card_rule.png", "WHY A RULE IS NOT ENOUGH",
     "A fixed retry cannot tell a stolen card from an empty wallet",
     "and one model cannot tell you why it decided",
     "So the money sits there — unresolved, unattributed, unprovable."),
    ("card_tribunal.png", "THE TRIBUNAL",
     "Advocate argues for the retry. Auditor audits it against the numbers.",
     "Witness reads both and decides.",
     "Two of three carry it. Split means conditional, and the split is kept on the record."),
    ("card_human.png", "THE HUMAN GATE",
     "The agents only propose",
     "PayPal hands a person the approval link",
     "No money moves until that tap. On a denial the order endpoint refuses outright."),
]


def html(card):
    _, eyebrow, head, sub, body = card
    return f"""<!doctype html><html><head><meta charset="utf-8">
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  html,body{{width:1920px;height:1080px;overflow:hidden}}
  body{{
    background:{BG};
    font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;
    color:{TXT};
    display:flex;align-items:center;justify-content:center;
  }}
  .card{{
    background:{PANEL};
    width:1440px;
    padding:96px 104px 104px;
    border-radius:28px;
    border:1px solid {LINE};
    box-shadow:0 24px 60px rgba(36,31,26,.10);
  }}
  .eyebrow{{
    display:inline-block;
    background:{SUNK};
    color:{DIM};
    font-size:22px;font-weight:700;
    letter-spacing:.18em;text-transform:uppercase;
    padding:12px 22px;border-radius:8px;
    margin-bottom:56px;
  }}
  h1{{font-size:112px;line-height:1.06;font-weight:700;letter-spacing:-.02em;color:{TXT}}}
  h2{{font-size:60px;line-height:1.22;font-weight:600;color:{TXT};max-width:1180px}}
  .sub{{font-size:38px;line-height:1.45;color:{DIM};margin-top:32px;max-width:1180px}}
  .body{{font-size:31px;line-height:1.62;color:{DIM};margin-top:56px;max-width:1150px}}
  .rule{{height:6px;width:132px;background:{ACC};border-radius:3px;margin:0 0 48px}}
  .foot{{margin-top:72px;font-size:24px;font-weight:700;letter-spacing:.16em;
         text-transform:uppercase;color:{ACC}}}
</style></head><body>
  <div class="card">
    <div class="eyebrow">{eyebrow}</div>
    <div class="rule"></div>
    {"<h1>" + head + "</h1>" if len(head) < 40 else "<h2>" + head + "</h2>"}
    <div class="sub">{sub}</div>
    <div class="body">{body}</div>
    <div class="foot">Tuesday · adversarial consensus</div>
  </div>
</body></html>"""


# ------------------------------------------------------------------ CDP client
class Cdp:
    def __init__(self, url, timeout=90):
        rest = url[5:]
        hostport, path = rest.split("/", 1)
        host, port = hostport.split(":")
        self.s = socket.create_connection((host, int(port)), timeout=timeout)
        k = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n"
                        f"Connection: Upgrade\r\nSec-WebSocket-Key: {k}\r\n"
                        f"Sec-WebSocket-Version: 13\r\n\r\n").encode())
        b = b""
        while b"\r\n\r\n" not in b:
            b += self.s.recv(4096)
        self.i = 0

    def _send(self, o):
        d = json.dumps(o).encode()
        h = bytearray([0x81]); mask = os.urandom(4); n = len(d)
        if n < 126:
            h.append(0x80 | n)
        elif n < 65536:
            h.append(0x80 | 126); h += struct.pack(">H", n)
        else:
            h.append(0x80 | 127); h += struct.pack(">Q", n)
        h += mask
        self.s.sendall(bytes(h) + bytes(c ^ mask[i % 4] for i, c in enumerate(d)))

    def _recv(self, t=90):
        self.s.settimeout(t)
        buf = b""
        while True:
            try:
                c = self.s.recv(1 << 20)
            except socket.timeout:
                break
            if not c:
                break
            buf += c
            if len(buf) > 10:
                n = buf[1] & 0x7F
                if n == 126 and len(buf) > 4:
                    if len(buf) >= 4 + struct.unpack(">H", buf[2:4])[0]:
                        break
                elif n == 127 and len(buf) > 10:
                    if len(buf) >= 10 + struct.unpack(">Q", buf[2:10])[0]:
                        break
                elif n < 126 and len(buf) >= 2 + n:
                    break
        n = buf[1] & 0x7F; off = 2
        if n == 126:
            n = struct.unpack(">H", buf[2:4])[0]; off = 4
        elif n == 127:
            n = struct.unpack(">Q", buf[2:10])[0]; off = 10
        return json.loads(buf[off:off + n].decode("utf-8", "replace"))

    def cmd(self, method, **params):
        self.i += 1
        self._send({"id": self.i, "method": method, "params": params})
        while True:
            m = self._recv()
            if m.get("id") == self.i:
                return m.get("result", {})

    def close(self):
        try:
            self.s.close()
        except Exception:
            pass


def main():
    subprocess.run(["taskkill", "/IM", "chrome.exe", "/F"], capture_output=True, timeout=120)
    time.sleep(3)
    prof = os.path.expanduser("~/chrome-card-prof")
    tmp = os.path.join(prof, "card.html")
    os.makedirs(prof, exist_ok=True)
    open(tmp, "w", encoding="utf-8", newline="\n").write(html(CARDS[0]))

    subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={PORT}",
                      f"--user-data-dir={prof}", "--no-first-run", "--no-default-browser-check",
                      "--window-size=1920,1080", "--hide-scrollbars",
                      "file:///" + tmp.replace("\\", "/")],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(9)

    deadline = time.time() + 60
    page = None
    while time.time() < deadline and not page:
        try:
            for t in json.loads(urllib.request.urlopen(
                    f"http://127.0.0.1:{PORT}/json/list", timeout=5).read()):
                if t.get("type") == "page":
                    page = t["webSocketDebuggerUrl"]
                    break
        except Exception:
            pass
        time.sleep(1)
    if not page:
        raise RuntimeError("headless chrome did not come up")

    cdp = Cdp(page)
    try:
        cdp.cmd("Page.enable")
        for name, eyebrow, head, sub, body in CARDS:
            open(tmp, "w", encoding="utf-8", newline="\n").write(html((name, eyebrow, head, sub, body)))
            cdp.cmd("Page.navigate", url="file:///" + tmp.replace("\\", "/"))
            time.sleep(2.5)
            cdp.cmd("Emulation.setDeviceMetricsOverride", width=1920, height=1080,
                    deviceScaleFactor=1, mobile=False)
            time.sleep(1.5)
            r = cdp.cmd("Page.captureScreenshot", format="png", captureBeyondViewport=False)
            dst = os.path.join(OUT, name)
            open(dst, "wb").write(base64.b64decode(r["data"]))
            print("  %-20s %8d B" % (name, os.path.getsize(dst)), flush=True)
    finally:
        cdp.close()
    print("palette used:", {k: P.get(k) for k in ("bg", "panel", "panel-2", "gold", "txt")})


if __name__ == "__main__":
    main()
