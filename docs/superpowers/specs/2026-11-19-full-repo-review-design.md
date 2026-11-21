# リポジトリ全体レビューの計画

## 目的と理由
task-trail 全体（約 124 ファイル）を、`~/.claude/reference/review.md` の汎用レビュー・ループで点検し、Critical・High を 0 にする。

## ゴール / 非ゴール
- ゴール: Critical = 0 かつ High = 0、品質スコア 95 点以上。残りは「既知の穴」に書く。
- 非ゴール: Medium・Low の修正、機能追加、リファクタリング、PR の作成。
- アンチゴール: レビューの修正で既存の動作を壊すこと（`npm test` が落ちる）。

## 制約
- Windows 専用、Node 24 以上。`src/` を変えたら `npm run build` して `assets/task-trail.html` をコミットする。
- 振る舞いを変えたら `docs/development.md` の該当節を同じ作業で直す。`skills/`・`agents/`・`tools/` の分岐を変えたら `docs/flow.html` も直す。
- 修正はブランチ `chore/full-repo-review` で行い、コミットする。PR は作らない。

## 方針（採用: 3 領域に分ける）
検討した案: A 3 領域×(A 担当・B 担当・反証) / B プラグイン全体で 1 組 / C 3 領域で担当統合。
A を選ぶ。理由: プラグインが 1 つだけで、`app.js`（1,169 行）などが大きく、全体を 1 体に渡すと浅くなる。

領域:
1. `src/core` + `src/import` + 対応する `tests`
2. `src/ui`（views 含む）+ 対応する `tests`
3. `tools` + `skills` + `agents` + `docs` + リポジトリ直下（README・CI・marketplace.json・plugin.json・NOTICE）

## 手順
1. 構成の一覧（領域ごとに、スクリプト・外部依存・副作用）を作る。 → 検証: 一覧を結果に載せる
2. 機械検査: `claude plugin validate --strict`（プラグインと marketplace）、`npm test`、`npm run build` 後に差分なし。落ちたら先に直す。 → 検証: 終了コード 0
3. `ponytail-audit` を 1 回（変更しない）。
4. 領域ごとに、新規サブエージェントで A 担当（正しさ・要件・plugin-rules.md の F）、B 担当（過剰実装・リスク・安全性）、別の 1 体で反証。領域 1・2 に `code-review` を加える。並列に起動し、領域ごとに結果をまとめる。
5. 横断点検（自分で）: doctor の表示形式、`author.name`、version の一致、NOTICE、README・marketplace.json と実際の構成、予約語。
6. 統合し、Critical・High を重い順に直す。同じ箇所 3 周まで。
7. 終了時に `npm test`・`npm run build`・`claude plugin validate --strict` を再実行し、品質スコアを出す。

## 対象外の扱い
外した観点は、領域ごとに理由を結果に書く。

## 実行者に任せること
サブエージェントの依頼文の細部、指摘の重複の統合。
