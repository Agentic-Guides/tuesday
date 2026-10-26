"""Upload the Tuesday demo video to YouTube, so Devpost can embed it.

Devpost accepts YouTube / Vimeo / Youku only -- a file in the repo is not enough.
Everything needed is already installed (google-api-python-client,
google-auth-oauthlib); what is missing is a one-time OAuth consent, which only
the account owner can give.

Setup, once:
    1. Google Cloud console -> create a project (or reuse one)
    2. Enable "YouTube Data API v3"
    3. OAuth consent screen -> External -> add yourself as a test user
    4. Credentials -> Create credentials -> OAuth client ID -> Desktop app
    5. Download the JSON and save it as:
           ~/AppData/Local/hermes/client_secret.json

Then:
    python upload_to_youtube.py            # opens a browser once, stores the token
    python upload_to_youtube.py --check     # report status without uploading

The token is written to ~/AppData/Local/hermes/youtube_token.json and is
git-ignored. Never commit client_secret.json or the token.
"""
import argparse
import json
import os
import sys

VIDEO = os.path.expanduser("~/Desktop/scs-sec/_rec/tuesday_submission_v9_1080p.mp4")
CLIENT_SECRET = os.path.expanduser("~/AppData/Local/hermes/client_secret.json")
TOKEN = os.path.expanduser("~/AppData/Local/hermes/youtube_token.json")
SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]

TITLE = "Tuesday — three AI agents decide, PayPal settles, the human signs off"
DESCRIPTION = """When a $42 subscription renewal fails at 3 AM, who decides whether to retry it?

Tuesday convenes a tribunal of three independent LLMs — Advocate, Auditor and Witness. They
argue. They disagree. Nothing reaches PayPal unless they agree AND a human signs off. The
decision, including the disagreement, is hashed and stamped into the PayPal order's custom_id,
so the reason a payment was allowed is readable from the payment record itself.

Built for the PayPal AI Hackathon. Everything in this video is the demo running:
  - APPROVED (2 for, 0 against) and DENIED (1 for, 2 against) on a real budget
  - the whole test suite, run from the page: 135 passed, 0 failed (money-gate 44, dispute desk 88, end to end 3)
  - the candidate grid, the dissent map, the AG Grid ledger, the Bryntum timeline

Code: https://github.com/Agentic-Guides/triad
Run it: git clone, then `node demo/server.mjs` — no API keys needed.

Sponsor tools: PayPal (Orders v2 REST) · AG Grid · Bryntum · Channel3 · WebMCP
"""

TAGS = ["paypal", "ai agents", "multi-agent", "llm", "payments", "fintech",
        "hackathon", "ag grid", "bryntum", "webmcp"]

CATEGORY = "28"   # Science & Technology


def check():
    print("video   :", VIDEO, "exists" if os.path.exists(VIDEO) else "MISSING")
    if os.path.exists(VIDEO):
        print("          %.1f MB" % (os.path.getsize(VIDEO) / 1024 / 1024))
    print("secret  :", CLIENT_SECRET, "found" if os.path.exists(CLIENT_SECRET) else "MISSING")
    print("token   :", TOKEN, "found" if os.path.exists(TOKEN) else "MISSING")
    try:
        import googleapiclient  # noqa: F401
        import google_auth_oauthlib  # noqa: F401
        print("libs    : google-api-python-client + google-auth-oauthlib OK")
    except Exception as e:
        print("libs    : MISSING --", e)
    return os.path.exists(VIDEO) and os.path.exists(CLIENT_SECRET)


def get_service():
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    creds = None
    if os.path.exists(TOKEN):
        creds = Credentials.from_authorized_user_file(TOKEN, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRET, SCOPES)
            # A browser opens once. This is the step only the account owner can do.
            creds = flow.run_local_server(port=0)
        with open(TOKEN, "w") as f:
            f.write(creds.to_json())
        os.chmod(TOKEN, 0o600)
    return build("youtube", "v3", credentials=creds)


def upload():
    from googleapiclient.http import MediaFileUpload

    yt = get_service()
    body = {
        "snippet": {
            "title": TITLE,
            "description": DESCRIPTION,
            "tags": TAGS,
            "categoryId": CATEGORY,
        },
        "status": {
            "privacyStatus": "unlisted",   # flip to public from Studio when ready
            "selfDeclaredMadeForKids": False,
        },
    }
    media = MediaFileUpload(VIDEO, chunksize=8 * 1024 * 1024, resumable=True, mimetype="video/mp4")
    req = yt.videos().insert(part="snippet,status", body=body, media_body=media)

    print("uploading %.1f MB ..." % (os.path.getsize(VIDEO) / 1024 / 1024), flush=True)
    resp = None
    while resp is None:
        status, resp = req.next_chunk()
        if status:
            print("  %d%%" % int(status.progress() * 100), flush=True)
    vid = resp["id"]
    print("uploaded: https://www.youtube.com/watch?v=%s" % vid, flush=True)
    print("Devpost video URL: https://www.youtube.com/watch?v=%s" % vid)
    with open(os.path.expanduser("~/Desktop/scs-sec/_rec/_youtube_url.txt"), "w") as f:
        f.write("https://www.youtube.com/watch?v=%s\n" % vid)
    return vid


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report status, do not upload")
    a = ap.parse_args()
    if a.check:
        sys.exit(0 if check() else 1)
    if not check():
        print("\nclient_secret.json is missing. See the docstring at the top of this file.")
        sys.exit(1)
    upload()
