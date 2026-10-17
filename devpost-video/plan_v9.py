"""Tuesday submission video v9 -- the operation plan, measured against the live demo.

The v8 take drove a demo that no longer exists (it typed into fields that have
moved, and it never opened the three proof buttons the README now points at).
This file is the plan only: which element is on screen for which narration clip,
and how the screen gets there. build_video_v9.py executes it.

Timing basis (measured from vo_kokoro_durations.json, not estimated):
  10 clips, 94.06s of narration. Each beat holds narration + padding, and the
  padding is weighted so the screen has time to arrive before the line lands.

  beat  clip   audio   +pad   = beat   on screen
   01    01     8.77   3.23    12.0   title, the whole page at rest
   02    02     8.92   3.08    12.0   the premise in the header block
   03    03     9.58   2.42    12.0   the three model names, the role split
   04    04    13.50   2.50    16.0   the tribunal panel
   05    05     6.14   3.86    10.0   -> Direct, budget 200, amount 42: APPROVED
   06    06    10.65   3.35    14.0   -> Shop: candidates with photographs, APPROVED
   07    07     8.45   3.55    12.0   -> Direct, budget 60, amount 90: DENIED
   08    08     9.58   2.42    12.0   the dissent map: who blocked it and why
   09    09     8.04   4.96    13.0   -> proof panel: the money-gate suite, 31 passed
   10    10    10.43   6.57    17.0   -> ledger, then the timeline, then close
                                  ----
                                  146.0s = 2:26

Why the proof beat sits at 09: clip 09 says "nothing is captured automatically,
finalizing a payment is a human step". The money-gate suite is the mechanical
proof of exactly that sentence, and it is the one claim a judge can re-run.

Why the DENIED beat comes before the proof beat: the dissent map (clip 08) is
the most visually distinctive thing on the page, and it lands while the screen
sits still on a red verdict rather than mid-navigation.
"""

# (clip, audio_seconds, pad_seconds, note)
BEATS = [
    ("01",  8.77, 4.23, "title / whole page at rest"),
    ("02",  8.92, 4.08, "header block: the premise"),
    ("03",  9.58, 3.42, "three models, three roles"),
    ("04", 13.50, 4.50, "the tribunal panel"),
    ("05",  6.14, 6.86, "Direct: budget 200 / amount 42 -> APPROVED"),
    ("06", 10.65, 5.35, "Shop: candidates with photographs -> APPROVED"),
    ("07",  8.45, 6.55, "Direct: budget 60 / amount 90 -> DENIED"),
    ("08",  9.58, 4.42, "dissent map: who blocked it and why"),
    ("09",  8.04, 7.96, "proof panel: money-gate suite, 31 passed / 0 failed"),
    ("10", 10.43, 11.57, "ledger -> timeline -> close"),
]

# Measured element ids on the page as of commit 828518e.
IDS = {
    "shop_tab": "tabShop",
    "direct_tab": "tabDirect",
    "timeline_tab": "tabTimeline",
    "run": "run",
    "shop_run": "shopBtn",
    "proof_btn": "proofBtn",
    "grid_btn": "gridBtn",
    "ledger_verify_btn": "ledgerVerifyBtn",
    "decision": "decision",
    "dissent": "dissentWrap",
    "audit_grid": "auditGrid",
    "scheduler": "scheduler",
    "proof_panel": "proofPanel",
    "proof_verdict": "proofVerdict",
    "ledger_verify_out": "ledgerVerifyOut",
    "reco": "reco",
    "candidate_grid": "candidateGrid",
    "d_amount": "d_amount",
    "d_budget": "d_budget",
    "d_spent": "d_spent",
    "d_category": "d_category",
}

if __name__ == "__main__":
    total = sum(b[1] + b[2] for b in BEATS)
    print("beats: %d" % len(BEATS))
    print("audio: %.2fs" % sum(b[1] for b in BEATS))
    print("picture: %.2fs = %d:%02d" % (total, int(total) // 60, int(total) % 60))
    print("narration-to-picture ratio: %.2fx" % (total / sum(b[1] for b in BEATS)))
    assert total < 300, "Devpost allows 5:00 -- over budget"
    print("within the 5:00 limit: %.0fs of headroom" % (300 - total))
