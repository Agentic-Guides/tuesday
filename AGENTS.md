# AGENTS.md — triad (Tuesday)

Tuesday is an adversarial-consensus layer for autonomous commerce: three
independent agents must agree before money moves, and their disagreement is
recorded as a verifiable receipt. Entry point for a coding agent working here.

## Quickstart

```bash
npm install                 # deps (AG Grid, Bryntum are CDN-loaded in the demo)
node demo/server.mjs        # demo + JSON API on :8787
node test_triad.mjs         # end-to-end tests (deterministic engine, no API key)
```

The demo is a single HTML file at `demo/index.html` driven by `demo/server.mjs`.
The engine lives in `src/`.

## Architecture — why three agents, and why they cannot corrupt each other

This is the part reviewers ask about, so keep it true.

- **`src/triad.js`** — the kernel. Defines the three roles, the deterministic
  reasoning fallback, the vote aggregation, and the receipt.
- **`src/runner.js`** — the LLM adapter (live models when keys exist, otherwise
  the deterministic judge). The engine must run without any API key.
- **`src/receipt.js`** — hashes decision + all three votes + reasoning into a
  tamper-evident record. Its `customId` is stamped into the PayPal order.
- **`src/commerce.js` / `src/channel3.js`** — product search and budget checks.
- **`src/webmcp.js`** — the MCP tool surface (this repo is also a registered MCP
  server; M8ven scores it 89/100, grade B, Verified Publisher).

**Design rule that matters (from Cognition's "Don't Build Multi-Agents"):**

1. **Share context.** All three agents reason over the *same* purchase object and
   the *same* constraints (`monthlyBudget`, `spentThisMonth`, `recentPurchases`).
   None of them holds private state the others cannot see.
   - The Advocate argues for. The Auditor audits numbers. The Witness judges the
     split. Only the Witness may attach conditions.
2. **Actions carry implicit decisions.** The agents *read and argue*; they never
   write. Exactly one place writes the ledger (`ledger.push` in `webmcp.js`) and
   one place writes the receipt. Parallel reads are safe; parallel writes are not,
   so there are none.

If you add a fourth agent, it must obey both rules or the receipt stops meaning
what it claims.

## 合意エンジンの規約（変更前に必ず読む）

- **threshold = 2**（3体中2票）。`adjudicate(purchase, args, 2)` を変えるなら、
  既存テスト3本（in-budget / over budget / split）を通すこと。
- **判定順序は「拒否が先、合意は後」。この順序を入れ替えるな**（2026-10-24 に
  実際に壊れた箇所）:
  1. `votesAgainst >= 2` → **DENIED**（金額を動かせない）
  2. `votesFor >= threshold` → Witness が条件を持てば **CONDITIONAL**、無ければ **APPROVED**
  3. `votesFor === 1 && votesAgainst === 1` かつ Witness が条件を提示 → **CONDITIONAL**
  4. それ以外 → **DISSENT**

  以前は「Witness が条件を持っていれば無条件に CONDITIONAL」を最優先していたため、
  **反対2票でも CONDITIONAL になり PayPal 注文が作れた**（実測で再現）。
  全会一致の反対（3票）でも同じだった。`tests/moneyGate.test.js` はこの経路を
  塞いでいるが、テストケースの `CONDITIONAL` は「賛成2票 + 条件」で組むこと。
  賛成1票 + 条件は DISSENT であり CONDITIONAL ではない。
- 3) を残しているのは製品の意味を守るため: 「Advocate が押し、Auditor が止め、
  Witness が条件で橋を架ける」が本製品の中心的な振る舞い。
  1) が先に落ちるので、この経路が金の抜け穴にはならない。
- **監査役（auditor）の判定順序**: ① 金額が正か（0/未指定/負は拒否）
  ② 予算超過か ③ 予算シェアが 50% 超か ④ recentPurchases があるなら 25% 超か。
  ③は recentPurchases に依存させない — 依存させると「予算の93%を使う買い物」が
  素通しで APPROVED になる（実測で確認した不具合。修正済み）。
- **決定論エンジンが正**。LLM が無くても同じ判定を返せること。

## 禁止事項

- 認証情報・トークン・秘密鍵を【ファイルに書かない】。`.env` か環境変数から読む。
  `.env` は絶対にコミットしない（`.gitignore` 済み）。
- **実弾を動かす経路を作らない。** PayPal は MOCK か sandbox までで、本番キーを
  コードに埋めない。
- 未実測の数字を README / Devpost / 動画に書かない（M8ven の 89/100 等は実測値）。

## テスト

- `node test_triad.mjs` — PASS 3 / FAIL 0 を維持する。判定を変えたら必ず実行。
- 判定マトリクスの確認（$42 固定）:
  予算$40→全部DENIED / $45〜60→CONDITIONAL混在 / $100→APPROVED / $200→全部APPROVED

## デモ（demo/index.html）

- **配色は beige 階層**（外側 #f0eadf ／ カード #ffffff ／ 赤 #c0203c ／ 文字 #241f1a）。
  白一色に戻すと「階層が無い」と評価される（vision で実測済み）。
- **AG Grid はライトテーマ**。dark テーマに戻すと文字が読めなくなる。
- コントラストは KPI 数字 1.07 → 18.9 に修正済み。白背景に白文字を残さない。
- タブは `id` で叩く（`tabShop` / `tabDirect` / `tabTimeline`）。テキスト一致は
  ボタンが2つある時点で誤爆する。

## 落とし穴（実測で踏んだもの）

- `#decision` の `innerText` は空。判定は **`#decision .big`** に入る。
- `document.body.style.zoom` を `scrollIntoView` の**後**に設定すると再レイアウトで
  判定が画面外へ出る（371px → 739px / viewport 864px）。
- 審議の**前に** zoom を 0.62 に縮小すると、判定が構造的に必ず画面内に入る。
- CDP の debug port に複数タブが残っていると、別タブを操作したまま別ウィンドウを
  録画する。起動時に URL を検証し、違えば即エラーにすること。

## Windows 固有の注意

- ターミナルは git-bash。PowerShell の組み込みは動かない。
- ネイティブツール（node / git）には `C:/Users/...` 形式のパスを渡す。
- h264 エンコードは**偶数サイズ**が必要（奇数の高さは 0 バイト出力で失敗）。
