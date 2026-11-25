# タスクの編集の統一 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ガントの窓・スケジュールの編集欄・リストで、同じ項目を見て直せるようにし、Waiting のバーに待ち先・回答予定日を出す。

**Architecture:** データ形式・規則は変えない。項目の HTML を `views/taskpop.js` の共通の関数にまとめ、窓とスケジュールがそれを使う。保存は、既存の `change` の結線（`data-f`）。ガントのバーの ◆・文字は `views/gantt.js`、リストの「詳細」の行は `views/project.js`。

**Tech Stack:** 素の JavaScript（ES Modules）、単一 HTML へのビルド、`node --test`。

**Spec:** `docs/specs/2026-11-26-task-edit-unify-design.md`（矛盾したら設計書が優先）

## Global Constraints

- Windows 専用、Node 24 以上。`npm test`。`src/` を変えたら `npm run build` して `plugins/project-lens/assets/project-lens.html` をコミットする。
- データ形式は変えない。画面に ID を新しく出さない。文言は日本語。`esc()` で必ずエスケープ。用語は「タスク」。
- PR 本文に「`docs/development.md`: 直した節の名前」。`development.md` に、版番号・PR 番号・日付・「以前は〜」を書かない。動作確認していないことは「未確認」。
- 設計書に無いことは、設計書の趣旨で決め、台帳に `Ruling:` で記録する。

## Review Focus

1. 入力途中の文字が、描き直しで消えない（待ち先・回答予定日を、窓・スケジュールで打つ）。
2. 待ち先が空のとき、回答予定日が無効（リストと同じ）。Waiting 以外では欄が出ない。
3. ◆・文字が、バーのクリック・ドラッグを邪魔しない。右端・左端・範囲外で壊れない。
4. 回答予定日が今日の日は超過にならない（過ぎている = 今日より前）。
5. 「詳細」の行の開閉が、チェックリストの行の開閉と干渉しない。

---

## Task 0: ブランチ

- [ ] **Step 1:** `docs/task-edit-unify`（設計書・計画書のコミットあり）から `feat/task-edit-unify` を作る。

---

## Task 1: 編集の項目を共通の部品にし、待ち先・回答予定日を窓とスケジュールに出す

**Files:** Modify `plugins/project-lens/src/ui/views/taskpop.js`、`plugins/project-lens/src/ui/theme.css`（必要なら）、`tests/views.test.js`（または既存の taskpop のテスト）

**Interfaces:**
- Produces（`taskpop.js` から export）: `taskFieldHtml(data, t, name, { ids })` — `name` は `"title"|"projectId"|"start"|"due"|"important"|"memo"|"party"|"expected"|"repeat"` のいずれか。その項目の入力部分（ラベルを含まない `<input>`/`<select>`）の HTML を返す。`party`・`expected` は、状態が Waiting でないとき `""` を返す。`expected` は、待ち先が空のとき `disabled`。属性は、リストと同じ: `data-f="party"`・`data-f="expected"`（回答予定日は `dateInputHtml`、`title="回答予定日"`）、`data-id`。
- `taskFieldsHtml`（窓）と `taskRowFieldsHtml`（スケジュール）は、各項目の入力部分を `taskFieldHtml` で作る（並べ方は今のまま）。待ち先・回答予定日を、状態の次に足す。

- [ ] **Step 1: 失敗するテストを書く:** 「Waiting のタスクで、窓とスケジュールの編集欄に `data-f="party"`・`data-f="expected"` が出る。To Do・In Progress では出ない」「待ち先が空だと、`expected` が `disabled`」「待ち先と回答予定日の値が入る」「窓の項目（件名・プロジェクト・開始・期限・重要・メモ・繰り返し）の入力が、今までと同じ属性・値で出る（回帰）」「新しい欄に ID が出ない（スケジュールの編集欄）」。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。** 既存のラベル付けの流儀（窓 `tp-f`、スケジュール `label`）は変えない。
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: ガントの窓とスケジュールの編集欄に、待ち先・回答予定日を出す`

---

## Task 2: ガントのバーに待ち先・回答予定日を出す

**Files:** Modify `plugins/project-lens/src/ui/views/gantt.js`、`plugins/project-lens/src/ui/theme.css`、`tests/views.test.js`

**Interfaces:**
- Consumes: `rowHtml`（`gantt.js` ~130 行）の `t`・`x(date)`・`total`・`today`、`diffDays`。
- Produces: Waiting かつ `waitingOn.party` があるタスクの行に、(a) `waitingOn.expected` があり表示の範囲内なら ◆（`<i class="gwait-mk" data-gwait="<id>">`、位置は `x(expected)` の日の中央）、(b) バーの右に文字（`<span class="gwait-lab" data-gwait-lab>`「待ち: 待ち先 ・ M/D」。回答予定日なしなら「待ち: 待ち先」）。`expected < today` なら、◆ と文字に `late` の class と、文字に「超過」。文字がレーンの右端に収まらない（バーの右端が 70% を超える）ときは、バーの左に出す（`right:` で置く）。◆・文字は `pointer-events:none`。ポイント（マイルストーン）の行・Waiting 以外には出さない。

- [ ] **Step 1: 失敗するテストを書く:** 「Waiting + 待ち先 + 回答予定日で、◆ と『待ち: ベンダー・M/D』が出る」「回答予定日なしで、文字だけ（◆ なし）」「待ち先が空で、どちらも出ない」「To Do・Done では出ない」「回答予定日が今日より前で `late`・『超過』、今日の日は `late` でない」「範囲外の回答予定日で、◆ は出ず、文字は出る」「バーの右端が 70% 超で、文字が左置きの class」「ID が文字に出ない」「既存のバー（`data-gt`・ハンドル）の HTML が変わらない」。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。** 色は、既存の Waiting の色・`--late` を使う。
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: ガントの Waiting のバーに、待ち先と回答予定日を出す`

---

## Task 3: リストの「詳細」の行で、繰り返しを指定する

**Files:** Modify `plugins/project-lens/src/ui/views/project.js`、`plugins/project-lens/src/ui/app.js`、`plugins/project-lens/src/ui/theme.css`、`tests/views.test.js`、`tests/app-source.test.js`

**Interfaces:**
- Consumes: `taskFieldHtml(data, t, "repeat")`（Task 1）、`opts.detailOpen`（`Set` か undefined）。
- Produces: リストの行に「詳細」ボタン（`data-detailtoggle="<id>"`、`aria-expanded`）。開いているタスクの行の下に `<tr class="ck-tr" data-detailpanel="<id>"><td colspan=cols>` として、繰り返し（`data-f="repeat"`）と説明「完了すると、次回のタスクを作ります」。`S.detailOpen = new Set()`。`app.js` のクリックで開閉（`S.checkOpen` の開閉と同じ流儀）、`render` へ `detailOpen` を渡す。画面・プロジェクトの移動で空にする（`S.checkOpen` を空にしている箇所と同じ所）。

- [ ] **Step 1: 失敗するテストを書く:** 「行に『詳細』が出る。開いていないと詳細の行が無い」「`detailOpen` に id があると、その行の下に繰り返しの `<select data-f="repeat">` が出る」「毎月のとき『（N 日）』が出る」「チェックリストの行と同時に開ける」。`app-source.test.js`: 「`data-detailtoggle` が `S.detailOpen` を開閉する」「画面の移動で `S.detailOpen` を空にする」。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。** 繰り返しの保存は、既存の `data-f="repeat"` の結線のまま。
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: リストの「詳細」の行から、繰り返しを指定できるようにする`

---

## Task 4: 文書・ビルド・実機の確認

**Files:** Modify `docs/development.md`、`docs/guide.md`、`README.md`、`plugins/project-lens/assets/project-lens.html`（生成物）

- [ ] **Step 1: `docs/development.md` を直す。** 「画面の動き > ガントチャートとリスト」に、バーの ◆・文字の規則（出る条件・超過・左置き）、窓の待ち先・回答予定日、リストの「詳細」の行。スケジュールの編集欄の項目。「設計判断」に 1 項目（項目の部品を共通にした理由、繰り返しを列でなく「詳細」の行にした理由、バーを ◆ だけにしなかった理由）。未確認のことは「未確認」。
- [ ] **Step 2: `docs/guide.md`・`README.md` の画面の説明を直す。**
- [ ] **Step 3: 照合する。** `grep` で、バッククォートの名前（`taskFieldHtml`・`S.detailOpen`・`data-detailtoggle`・`data-gwait` など）がコードにあること。
- [ ] **Step 4:** `npm run build && npm test`。件数と失敗 0 を記録する。
- [ ] **Step 5: 実機の確認（コントローラが行う）。** デモデータ `D:\claude\project-lens-demo-v0.4\`、`?today=2026-11-25&time=10:15`。
- [ ] **Step 6: コミット** `docs: タスクの編集の統一に合わせて文書を直す`
