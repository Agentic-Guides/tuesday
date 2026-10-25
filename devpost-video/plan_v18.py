"""Tuesday submission video v18 -- the operation plan.

Rebuilt 2026-10-24 for two reasons:

1. THE STORY ORDER was wrong. v17 opened on the APPROVED case, so the judge
   watched a success before learning what problem it solved. The order now
   follows _memory/tuesday-video-script-usa.md: failure -> tribunal ->
   settlement -> human approval -> ledger.

2. THE NARRATION STALLED. The v17 Kokoro clips had 0.30-0.60s of silence at
   every sentence break (22 gaps across 91s of audio; measured with ffmpeg
   silencedetect). make_vo_v18.py regenerates the ten clips and shortens each
   internal gap to 55ms, removing 13.27s of dead air. Every clip now measures
   zero silences above 0.2s.

Timing basis: the ten vo_v18_*.wav durations, measured -- not estimated.
The padding is weighted so the screen arrives before the line lands, and it is
sized to the operation each beat has to perform (two field entries, a click,
and a verdict that has to be read).

  beat  audio    pad   = beat   on screen
   01   9.64   4.4  14.04  page at rest: the premise ($42/12,000 subscribers/Tuesday 3AM)
   02   7.82   4.2  12.02  the three agents and why one model is not enough
   03   7.21   5.8  13.01  THE FAILURE: budget 60 / amount 90 -> DENIED (red on screen)
   04  10.74   5.0  15.74  the tribunal deliberates: retry / audit / witness
   05   7.30   5.2  12.50  THE RESOLUTION: budget 200 / amount 42 -> APPROVED
   06  11.17   5.4  16.57  PayPal settlement: order created, custom_id stamped
   07  11.13   5.6  16.73  human approval: verify against PayPal (the API refuses until a person taps)
   08   5.48   5.0  10.48  the ledger: the red row turns green, receipt hash
   09   6.67   5.2  11.87  the proof a judge can re-run: money-gate suite, 31 passed
   10   8.73  12.0  20.73  the calendar, then 'Tuesday.'
                              ----
                              143.69s = 2:23.69
"""

# (clip, audio_seconds, pad_seconds, note)
BEATS = [
    ("01",  8.23,  3.9, "page at rest: $42 / 12,000 subscribers / Tuesday 3AM"),
    ("02",  5.86,  3.0, "why one model is not enough"),
    ("03",  6.61, 24.0, "THE SHOP: 5 real products with photos, a person picks one"),
    ("04",  6.41, 22.0, "THE FAILURE: budget 1 / amount 500 -> DENIED"),
    ("05",  7.18,  4.0, "three agents deliberate"),
    ("06",  5.41, 20.0, "THE RESOLUTION: budget 200 / amount 42 -> APPROVED"),
    ("07",  8.59,  5.0, "real PayPal order, custom_id stamped"),
    ("08",  6.73,  5.0, "human approval, verify against PayPal"),
    ("09",  4.60,  4.0, "the ledger"),
    ("10",  6.22, 10.0, "proof: 31 passed, then close"),
]

# Element ids, measured against demo/index.html as of 2026-10-24.
IDS = {
    "agents": "agents",
    "shop_run": "shopBtn",
    "candidate_grid": "candidateGrid",
    "premise": "premise",
    "d_budget": "d_budget",
    "d_amount": "d_amount",
    "run": "run",
    "decision": "decision",
    "paypal": "paypal",
    "paypalWrap": "paypalWrap",
    "receiptWrap": "receiptWrap",
    "verifyBtn": "verifyBtn",
    "verifyOut": "verifyOut",
    "audit_grid": "auditGrid",
    "proof_panel": "proofPanel",
    "proof_btn": "proofBtn",
    "proof_verdict": "proofVerdict",
    "scheduler": "scheduler",
    "dissent": "dissent",
}

if __name__ == "__main__":
    total = sum(b[1] + b[2] for b in BEATS)
    audio = sum(b[1] for b in BEATS)
    print("beats: %d" % len(BEATS))
    print("audio: %.2fs" % audio)
    print("picture: %.2fs = %d:%02d" % (total, int(total) // 60, int(total) % 60))
    print("narration-to-picture ratio: %.2fx" % (total / audio))
    assert total < 180, "over three minutes"
    print("within 3:00: %.1fs of headroom" % (180 - total))
