#!/usr/bin/env python
"""check_six_fixes.py — ぺぺの指摘6件が【3箇所すべて】に反映されているかを実測する

★なぜ作るか（2026-11-04）:
  README に書いた。ページにも書いた。だが本文（project_story_paste.txt）には書いてなかった。
  「やった」と言いながら3つのうち1つを落とした。範囲を数えていなかった。
  → 範囲を目視で数えるのをやめ、このスクリプトで数える。

対象3箇所:
  README.md                         リポジトリを見る審査員
  demo/index.html                   デモを開く審査員
  docs/devpost/project_story_paste.txt   Devpost本文を読む審査員

使い方: python check_six_fixes.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGETS = {
    "README.md": os.path.join(ROOT, "README.md"),
    "demo/index.html": os.path.join(ROOT, "demo", "index.html"),
    "devpost本文": os.path.join(ROOT, "docs", "devpost", "project_story_paste.txt"),
}

CHECKS = [
    ("P1-1 Challenges",      ["Challenges"]),
    ("P1-1 What we learned", ["What we learned"]),
    ("P1-1 What's next",     ["What's next", "What\u2019s next"]),
    ("P1-2 AIツール明記",     ["DeepSeek"]),
    ("P1-2 Gemma",           ["Gemma", "gemma"]),
    ("P2-6 Sponsor tools",   ["Sponsor tool"]),
]


def load(p):
    try:
        return open(p, encoding="utf-8", errors="ignore").read()
    except OSError:
        return ""


def main():
    texts = {name: load(p) for name, p in TARGETS.items()}
    for name, p in TARGETS.items():
        mark = "○" if texts[name] else "×★"
        print(f"{mark} {name:38s} {os.path.getsize(p) if os.path.exists(p) else 0} B")
    print()

    hdr = "".join(f"{n[:16]:>18s}" for n in TARGETS)
    print(f"{'項目':24s}{hdr}  判定")
    fails = []
    for label, needles in CHECKS:
        row = []
        for name in TARGETS:
            hit = any(nd in texts[name] for nd in needles)
            row.append("○" if hit else "×")
            if not hit:
                fails.append((label, name))
        verdict = "OK" if all(c == "○" for c in row) else "★未"
        print(f"{label:24s}{''.join(f'{c:>18s}' for c in row)}  {verdict}")

    print()
    if fails:
        print("★未反映:")
        for label, name in fails:
            print(f"  - {label} → {name}")
        print("\n★6件×3箇所。1箇所でも抜けたら「やった」と言うな。")
        return 1
    print("★6件×3箇所 = 18/18 反映済み")
    return 0


if __name__ == "__main__":
    sys.exit(main())
