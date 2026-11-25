# 小さな直し A 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** リストの状態欄と警告の置き場・実績の列、チェックの警告の 2 択化、スケジュールの実績の欄の統一、週の見返しの稼働タブへの移動。

**Architecture:** 表示と結線の変更。データ形式・集計は変えない。リストは `ui/views/project.js`、警告の部品は `ui/views/prio.js`（`doneAskHtml`）、結線は `ui/app.js`、スケジュールは `ui/views/schedule.js`、稼働は `ui/views/workload.js`、ToDo は `ui/views/todo.js`。

**Tech Stack:** 素の JavaScript（ES Modules）、単一 HTML へのビルド、`node --test`。

**Spec:** `docs/specs/2026-11-25-small-fixes-a-design.md`（矛盾したら設計書が優先）

## Global Constraints

- Windows 専用、Node 24 以上。`npm test`。`src/` を変えたら `npm run build` して `plugins/project-lens/assets/project-lens.html` をコミットする。
- データ形式・稼働の数字は変えない。画面に ID を出さない。文言は日本語。`esc()` で必ずエスケープ。用語は「タスク」。
- 変更の PR 本文に、「`docs/development.md`: 直した節の名前」を書く。`development.md` に、版番号・PR 番号・日付・「以前は〜」の経緯を書かない。動作確認していないことは「未確認」。
- 設計書に無いことは、設計書の趣旨で決め、台帳に `Ruling:` で記録する。

## Review Focus（実機でしか見つからない不具合が、前の仕事で 3 件あった。クリックの順序・状態の消え方に注意する）

1. リストの警告・待ち先の入力の行が出ているとき、入力欄の中のクリックが、行を閉じたり、状態を消したりしない。（Task 1）
2. 警告の「残りをすべてチェックして Done」が、チェックを付けて Done にし、未来の枠の解除の確認が続く規則は、今のまま。「やめる」で何も変わらない。（Task 2）
3. 会議の実績の欄を移しても、会議の編集の入力（件名など）が、再描画で消えない。実績の下書き（`S.actDraft`）が、枠・会議の切り替えで混ざらない。（Task 3）
4. 気づき（`reviews`）が、稼働タブでも保存され、読み込み直しても出る。稼働の日の移動で、別の週の気づきが出る。（Task 4）
5. 稼働の期間（日・週・月・…）がどれでも、週の見返しが出て、例外にならない。（Task 4）

---

## Task 0: ブランチ

- [ ] **Step 1:** `docs/small-fixes-a`（設計書・計画書のコミットあり）から `feat/small-fixes-a` を作る。以降の作業は、このブランチ。

---

## Task 1: リストの「実績」の列を外し、状態の欄と警告の置き場を直す

**Files:** Modify `plugins/project-lens/src/ui/views/project.js`、`plugins/project-lens/src/ui/theme.css`、`tests/views.test.js`（必要なら `tests/app-source.test.js`）

**Interfaces:**
- Consumes: `statusCellHtml(t, opts, late)`（`views/project.js`。`pendingWait`・`pendingDone` のとき、警告・入力を返す。ガントの編集の窓も共用）、`doneAskHtml`（`views/prio.js`）。
- Produces: リストの各タスクの行の直下に、`opts.pendingWait === t.id` または `opts.pendingDone?.id === t.id`（かつ今日のタスクの行でないとき）の間だけ、表の全幅の行（`<tr class="askrow"><td colspan="<列数>">…</td></tr>`。列数は、見出しの列の数から数える）として、待ち先の入力・Done の確認を出す。状態の欄のセルには、`select` と「期限超過」の札だけを出す（警告・入力は入れない）。状態の欄に、最小幅を付け、`In Progress`・`Cancelled` が切れない。「実績」の列（見出し・セル・`actText` と、使われなくなる関数・CSS）を外す。ガントの編集の窓（`taskpop.js` が `statusCellHtml` を使う）は、今までどおり、警告・入力が窓の中に出る（`statusCellHtml` に、リストでは出さないための引数を足してよい）。

- [ ] **Step 1: 失敗するテストを書く（`views.test.js`）**: 「リストの見出しに『実績』が無い。行にも実績のセルが無い」「`pendingDone` のとき、その行の直下に `askrow` の行が出て、全幅（`colspan` が見出しの列数と同じ）。状態のセルの中に `class="ask"` が出ない」「`pendingWait` のとき、同じ（待ち先の入力 `data-waitparty` が `askrow` の中）」「`pendingDone`・`pendingWait` が無いとき、`askrow` は出ない」「ガントの編集の窓では、警告が窓の中に出る（今までどおり）」「状態の欄の最小幅が、CSS に書かれている（CSS 文字列の確認）」。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。**
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `fix: リストの実績の列を外し、状態の欄の幅と警告の置き場を直す`

---

## Task 2: チェックの警告を 2 択にする

**Files:** Modify `plugins/project-lens/src/ui/views/prio.js`（`doneAskHtml`）、`plugins/project-lens/src/ui/app.js`、`plugins/project-lens/src/ui/donecheck.js`（必要なら）、`tests/*.test.js`（`donecheck`・`views`・`app-source` のうち、該当するもの）

**Interfaces:**
- Produces: `doneAskHtml(pd)` の `stage: "check"` は、「残りをすべてチェックして <状態> にする」（`data-ckall`）と「やめる」（`data-doneno`）の 2 つのボタンだけ。`data-ckkeep` と、そのハンドラ・`S.pendingDone.checkAll` の「そのまま」の分岐を外す（「残りをチェックして Done」を選んだことを示す `checkAll` は、今までどおり、`data-ckall` が立てる）。Cancelled のとき、チェックの警告が出ない規則（`planDone`）は、今のまま。未来の予定の枠の解除の確認（`stage: "future"`）も、今のまま。

- [ ] **Step 1: 失敗するテストを書く**: 「未完了の項目があるタスクを Done にすると、警告に『残りをすべてチェックして Done にする』と『やめる』だけが出る（`data-ckkeep` が無い）」「`data-ckall` を押すと、チェックが付き、未来の枠があれば確認に進み、なければ Done になる」「`data-doneno` で何も変わらない」「Cancelled には警告が出ない」。`app-source.test.js`: 「`data-ckkeep` のハンドラが無い」。既存の「そのまま Done」を前提にするテストは、書き直すか、外す。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。**
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `fix: 未完了のチェックを残したまま Done にする選択肢をなくす`

---

## Task 3: スケジュールの、予定の枠と会議の実績の欄をそろえる

**Files:** Modify `plugins/project-lens/src/ui/views/schedule.js`（`actualForm`・`meetingForm`・実績の欄の部品）、`plugins/project-lens/src/ui/theme.css`、`plugins/project-lens/src/ui/app.js`（結線の属性名が変わるときだけ）、`tests/views.test.js`、`tests/app-source.test.js`

**Interfaces:**
- Produces: 実績の欄の部品 1 つ（例 `actualBox({ label, date: { value, editable }, start, end, buttons })`。名前・置き場所は実装者が決める）。枠の実績の欄と、会議の実績の欄が、これを使う。編集の領域 `#mtgslot` の先頭に出す。並び: 「実績」のラベル・日付・開始・終了・ボタン（右端、同じ順: 「実績を保存」か「実績を更新」、あれば「実績を消す」）。会議の日付は文字で出す（編集不可）。枠の日付は、今までどおり、`data-ac="date"` で直せる。会議の編集の欄（件名・日付・開始・終了・プロジェクト・参加しない・会議を削除・閉じる）は、実績の欄の下。既存の属性（`data-ac`・`data-actsave`・`data-actclear`・`data-ma`・`data-mtgact`・`data-mtgactclear`）と、下書きの結線は、変えない。

- [ ] **Step 1: 失敗するテストを書く**: 「枠を選んだときと会議を選んだときの、実績の欄が、同じ class・同じ並び（ラベル・日付・開始・終了・ボタン）で、`#mtgslot` の中の、編集の欄より前に出る」「会議の実績の欄の日付は文字（入力欄でない）。枠の実績の欄の日付は入力欄」「ボタンの順が、枠と会議で同じ」「会議の編集の欄（`data-mt="title"` など）が、実績の欄の下にある」「実績を持たない・始まっていない会議・参加しない会議には、実績の欄が出ない（今までどおり）」「下書き（`actDraft`）の値が、実績の欄に出る（枠・会議とも）」。既存のテスト（実績の欄の位置・構造に触れるもの）を、直す。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。**
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `fix: 予定の枠と会議の実績の欄を、同じ並び・同じ位置にそろえる`

---

## Task 4: 週の見返しを稼働タブへ移す

**Files:** Modify `plugins/project-lens/src/ui/views/todo.js`（見返しを外す）、`plugins/project-lens/src/ui/views/workload.js`（見返しを足す）、`plugins/project-lens/src/ui/app.js`（`renderWorkload` に渡す値・`data-tdnote` の結線が画面に依存していないことの確認）、`plugins/project-lens/src/ui/theme.css`、`tests/views.test.js`、`tests/workload-view.test.js`、`tests/app-source.test.js`

**Interfaces:**
- Consumes: `weekSummary(data, weekStart, today)`・`mondayOf`（`core/week.js`）、`setReview`。
- Produces: `renderWorkload(data, today, opts)` が、末尾に「週の見返し（M/D〜M/D）」の領域（`class="tdreview panel"` の流儀。`aria-label="週の見返し"`）を出す。週は、`mondayOf(opts.date)`（稼働で見ている日を含む週）。内容は、今の ToDo タブの見返しと同じ（完了 X / Y 件・予定と実績の分・タスクごとの表・気づきの `textarea data-tdnote="<週の月曜日>"`）。`renderTodo` は、見返しを出さない（`weekSummary` の import も外す）。見返しの描画は、`views/workload.js` の関数（例 `weekReviewHtml(data, today, weekStart)`）に置く。気づきの保存（`change` で `setReview`）は、稼働タブでも動く。`focusSelector`・入力中の保護（`isEditing`）に、`tdnote` が含まれていること（稼働タブでも）。

- [ ] **Step 1: 失敗するテストを書く**: 「稼働タブ（期間 日・週・月・年・全期間のそれぞれ）に、見返しの領域が出る。例外にならない」「週が、`opts.date` を含む週（月曜日〜日曜日）。日を動かすと、別の週になる」「`reviews` の値が、その週の気づきの欄に入る。HTML エスケープされる」「ToDo タブには、見返しが出ない」「`data-tdnote` の `change` が、稼働タブでも `setReview` を `apply` する（結線が `S.screen === "todo"` に限られていない）」。既存の、ToDo タブの見返しを前提にするテストは、稼働のテストへ移す。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。**
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: 週の見返しを、ToDo タブから稼働タブへ移す`

---

## Task 5: 文書・ビルド・実機の確認

**Files:** Modify `docs/development.md`、`docs/guide.md`、`README.md`、`plugins/project-lens/assets/project-lens.html`（生成物）

- [ ] **Step 1: `docs/development.md` を直す。** リストの節（実績の列を外したこと・警告の置き場・状態の欄の幅）、チェックの警告の節（2 択。「未完了のまま Done」の選択肢をなくした理由: 完了とチェック忘れの区別がつかない。不要な項目は削除してから Done）、スケジュールの実績の欄（枠と会議で同じ部品・同じ場所）、ToDo タブ（見返しを外す）、稼働（週の見返し。どの週か）。「設計判断」に 1〜2 項目（「未完了のまま Done」をなくした理由と見送った案: 項目に「対象外」を付ける。見返しを稼働へ移した理由）。古い記述を消す。動作確認していないことは「未確認」。
- [ ] **Step 2: `docs/guide.md`・`README.md` の画面の説明を直す。**
- [ ] **Step 3: 照合する。** `grep` で、消した機能（`data-ckkeep`・リストの実績の列・ToDo タブの見返し）の記述が文書に残っていないこと。バッククォートの名前がコードにあること。
- [ ] **Step 4:** `npm run build && npm test`。
- [ ] **Step 5: 実機の確認（コントローラが行う）。**
- [ ] **Step 6: コミット** `docs: 小さな直し A に合わせて文書を直す`
