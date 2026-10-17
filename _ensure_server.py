"""Make sure the demo server on 8787 is up, started with a reliable node.

Measured problem: this machine's PATH has no nodejs entry, so a bare `node`
resolves to nothing in a fresh shell. Starting the server with
`shell=True, "node demo/server.mjs"` either fails outright or starts a server
whose own child spawn dies with 0xC0000142 (STATUS_DLL_INIT_FAILED). That is what
made the in-page money-gate button report "0 passed, 0 failed" during a take,
while `node tests/moneyGate.test.js` passed 31/31 from a terminal at the same
moment. Pin the absolute interpreter and hand it to the server.

Run:  python _ensure_server.py
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(os.path.expanduser("~"), "Desktop", "scs-sec", "_rec", "_srv.log")

# Measured locations; the first that answers --version wins.
NODE_CANDIDATES = [
    r"C:\Program Files\nodejs\node.exe",
    r"C:\Program Files (x86)\nodejs\node.exe",
    os.path.expanduser("~/AppData/Roaming/npm/node.exe"),
    "node",
]


def find_node():
    for c in NODE_CANDIDATES:
        try:
            r = subprocess.run([c, "--version"], capture_output=True, text=True, timeout=30)
            if r.returncode == 0 and (r.stdout or "").strip().startswith("v"):
                return c
        except Exception:
            continue
    return None


def ok():
    try:
        with urllib.request.urlopen("http://127.0.0.1:8787/api/ledger", timeout=8) as r:
            return r.status == 200
    except Exception:
        return False


def proof_works():
    """The page's money-gate button only works if the server can spawn a working
    node. Measured: a server started by an older shell (no nodejs on PATH, no
    TRIAD_NODE) answers /api/ledger fine but returns exit code 3221225794 from
    /api/proof, because its child spawn dies on startup. A live server is
    therefore NOT proof that the demo is healthy -- ask the endpoint that needs
    the child process."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:8787/api/proof", timeout=200) as r:
            j = json.loads(r.read())
        return bool(j.get("passed")) and j.get("exitCode") == 0
    except Exception:
        return False


def ensure(verbose=True):
    node = find_node()
    if not node:
        if verbose:
            print("  server: no working node found")
        return False

    # A live server is not enough: /api/ledger answers even when the child spawn is
    # broken. Only a passing /api/proof proves the demo is actually healthy, and
    # that is the button a judge presses. Restart if it fails.
    if ok() and proof_works():
        if verbose:
            print("  server: up and /api/proof passes (%s)" % node)
        return True
    if ok():
        if verbose:
            print("  server: up but /api/proof fails -- restarting with %s" % node)

    # clear whatever holds the port
    r = subprocess.run(
        'powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8787 -State Listen '
        '-ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"',
        shell=True, capture_output=True, text=True, timeout=60)
    for pid in set(x.strip() for x in (r.stdout or "").split("\n") if x.strip()):
        subprocess.run('powershell -NoProfile -Command "Stop-Process -Id %s -Force '
                       '-ErrorAction SilentlyContinue"' % pid,
                       shell=True, capture_output=True, timeout=60)
    time.sleep(2)

    env = dict(os.environ)
    env["PATH"] = os.path.dirname(node) + os.pathsep + env.get("PATH", "")
    # The server spawns `node tests/moneyGate.test.js` for /api/proof. Give it the
    # same absolute interpreter so the child cannot fail to start.
    env["TRIAD_NODE"] = node

    log = open(LOG, "w", encoding="utf-8")
    subprocess.Popen([node, "demo/server.mjs"], cwd=BASE, stdout=log,
                     stderr=subprocess.STDOUT, env=env)
    for _ in range(20):
        time.sleep(2)
        if ok() and proof_works():
            if verbose:
                print("  server: started with %s, /api/proof passes" % node)
            return True
    if verbose:
        print("  server: FAILED to start or /api/proof still failing")
    return False


if __name__ == "__main__":
    sys.exit(0 if ensure() else 1)
