---
status: active
type: handoff
project: tuesday (Agentic-Guides/triad)
audience: next maintainer (deepseek-v4.1-flash or any LLM)
updated: 2026-10-31 (rev3 — 無言フォールバックをコードで塞いだ)
---

# Tuesday — 引き継ぎ書（2026-10-31 / rev3）

**リポジトリ:** `Agentic-Guides/triad`（GitHubでは `tuesday` 名）
**本番ローカル:** `C:\Users\hohoh\Desktop\triad-clean` → rename to `tuesday`（フォルダ名だけ古い）

---

## 訂正：初版(rev1)の診断は誤りだった

初版には「C04 が FAIL する → 決定論エンジンを DENIED に倒せ」と書いた。
**これは完全な見当違い。コードにバグは無く、直すべきものも無かった。**

**真因:** `--llm` を付けて実行したとき、シェルに `OLLAMA_API_KEY` が無かった。
`TriadRunner.live` が `false` になり、`debate()` が決定論フォールバックへ落ちていた。
そのため LLM パスでも決定論の答え（CONDITIONAL）が返り、期待値 DENIED と食い違って FAIL に見えた。

```javascript
// src/runner.js
get live() { return Boolean(this.apiKey); }

async debate(purchase) {
  if (!this.live) {
    // ここに落ちていた。engine は 'deterministic'
  }
```

**証拠:** 出力の `"engine": "deterministic"` と、Advocate の reason が
`This purchase (...) supports the stated goal: ...` という機械テンプレであること。

**キーを渡すと 23/23 全緑、C04 も LLM が DENIED を返して期待値と一致する。**
コードは 1 行も変更していない。

---

## 現在の状態（2026-10-31 rev2 実測）

```
✅ npm test                 → moneyGate 52 / disputeDesk 88 / tribunal 13 / test_triad PASS
✅ tribunal --llm（キー有り） → 23 passed / 0 failed
✅ デモサーバー              → node demo/server.mjs → http://localhost:8787 起動 OK
✅ Git                     → 8fce1aa / clean
```

**未解決の欠陥はゼロ。**

---

## ★ 最重要：`--llm` を走らせる正しいコマンド

**rev3 で解決済み。** `--llm` を付けるとテスト自身がプロジェクト直下の `.env` を
読むようになったので、手動 export は不要。

```bash
cd C:/Users/hohoh/Desktop/triad-clean
node tests/tribunal.fixture.mjs --llm
```

**キーは `triad-clean/.env` にある（`hermes/.env` ではない）。**
`.gitignore` 済み・未追跡なので漏れない。

```
~/Desktop/triad-clean/.env
  PAYPAL_CLIENT_ID=...
  PAYPAL_CLIENT_SECRET=...
  OLLAMA_API_KEY=...        ← これ
```

**キーが本当に無いときは、黙って決定論に落ちずに例外で止まる:**

```
Error: LLM key missing: neither OLLAMA_API_KEY nor OPENAI_API_KEY is set, so
debate() would silently use the deterministic engine. Set a key, or opt in
explicitly with ALLOW_DETERMINISTIC=1 ...
```

**rev1 ではこれが無かったため、`--llm` が決定論で走り、その結果が
「モデルと決定論の不一致」に見えた。** 同じ誤診をしないこと。

### 決定論エンジンを意図的に使う場合

```javascript
createTriad({ allowDeterministic: true })   // コードから
ALLOW_DETERMINISTIC=1 node ...              // 環境変数から
```

**デモ・moneyGate・test_triad・`--llm` 無しの fixture は既に opt-in 済み。**
新しく決定論に依存するコードを書くときは、この opt-in を明示すること。

---

## プロジェクト構造（手を入れる場所だけ）

```
src/
  triad.js      ← 3体の審判ロジック・決定論エンジン
  runner.js     ← ★ LLM呼び出しと決定論フォールバックの分岐（live ゲッター）
  disputes.js   ← E1-E7/D1-D5 のゲート
  channel3.js   ← 商品カタログ
  commerce.js   ← PayPal 注文生成
  receipt.js    ← 判定のハッシュ化（custom_id に入れる）
  webmcp.js     ← WebMCP エントリ

tests/
  tribunal.fixture.mjs   ← 10ケース。--llm で実 LLM を呼ぶ
  moneyGate.test.js      ← 52件。DENIED→PayPal不呼出を保証
  disputeDesk.test.js    ← 88件

docs/
  fixtures/tribunal-cases.json  ← 10ケースの正解（expect_deterministic / expect_llm）
demo/
  server.mjs    ← :8787 のデモ。審査員が開くページ
```

---

## よくある作業とコマンド

| 目的 | コマンド |
|---|---|
| 全部テスト | `npm test` |
| LLM込み | 上記の `export OLLAMA_API_KEY=...` を先に実行してから `node tests/tribunal.fixture.mjs --llm` |
| 決定論のみ | `node tests/tribunal.fixture.mjs`（キー不要） |
| デモ起動 | `node demo/server.mjs` → http://localhost:8787 |

**`npm test` に `--llm` は含まれていない。** 審査員が押す
"Run the money-gate test suite" は決定論のみ。**提出前に両方緑にすること。**

---

## ケースの期待値（`docs/fixtures/tribunal-cases.json`）

C04 は意図的に2経路で答えが違う:

```
expect_deterministic: CONDITIONAL
expect_llm:           DENIED
```

**これは仕様。** 決定論は「重複＝条件付き承認」、LLMはより厳しく「拒否」。
fixture の `note` に理由が書いてある。**一致させるためにどちらかを曲げてはいけない。**

| ケース | 決定論 | LLM |
|---|---|---|
| C01 | APPROVED | APPROVED |
| C02 | CONDITIONAL | CONDITIONAL |
| C03 | APPROVED | APPROVED |
| **C04** | **CONDITIONAL** | **DENIED** |
| C05 | DENIED | DENIED |
| C06-C10 | CONDITIONAL / APPROVED | 同じ |

---

## 注意（このプロジェクト固有）

1. **フォルダ名は `triad-clean` のまま。** `tuesday` に rename しようとして
   `WinError 32` で失敗した履歴あり。PC 再起動後にやる。実害なし
   （GitHub リポジトリ名は既に `tuesday`）。

2. **LLM キーは `triad-clean/.env` にある**（`.gitignore` 済み・未追跡）。
   `--llm` とデモは自分でこのファイルを読む。手動 export は不要。

3. **回線が悪い日は `--llm` がタイムアウトで別の失敗を出す。**
   その日は決定論だけで判断する。

4. **fixture 追加は `docs/fixtures/tribunal-cases.json`。**
   既存10件（C01-C10）に続けて C11 から。**両方の期待値を必ず書く。**

---

## 提出物の現在地

| 種類 | 場所 | 状態 |
|---|---|---|
| Devpost 提出文 | `docs/devpost/submission.md` | ✅ |
| コピペ用 | `docs/devpost/copy-paste.md` | ✅ |
| 動画 (1920×1080 / 2:52) | `devpost-media/tuesday_submission_final_1080p.mp4` | ✅ |
| サムネ (1920×1080) | `C:\Users\hohoh\Desktop\tuesday_thumb_v42.png` | ✅ |
| スクリーンショット8枚+キャプション | `devpost-media/`（140字） | ✅ |

**提出はまだしていない。** Devpost の YouTube URL を貼る段階で
ログインが必要。

---

## 最後に

**コードの欠陥はゼロ。テストも全緑。**
初版の診断ミスは「実行環境を確かめずに出力だけを読んだ」ことが原因。
**`engine` フィールドを見れば一発で分かった。** 次に触る人はまずそこを見ること。
