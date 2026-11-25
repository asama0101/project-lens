# ToDo と優先の連動・Waiting の催促 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 候補を優先の順に並べて理由を出し、「今日の優先」から「今日へ」できるようにし、ToDo タブに Waiting の「催促」の組を出す。

**Architecture:** データ形式・点数は変えない。純関数 `chaseTasks`（`core/week.js`）・`markChased`（`ui/edit.js`）を足し、`ui/views/todo.js` に並びと催促の組を、`ui/views/prio.js` に「今日へ」を足す。結線は `ui/app.js`。

**Tech Stack:** 素の JavaScript（ES Modules）、単一 HTML へのビルド、`node --test`。

**Spec:** `docs/specs/2026-11-26-todo-priority-remind-design.md`（矛盾したら設計書が優先）

## Global Constraints

- Windows 専用、Node 24 以上。`npm test`。`src/` を変えたら `npm run build` して `plugins/project-lens/assets/project-lens.html` をコミットする。
- データ形式・`rankTasks` の点数・順位は変えない。画面に ID を出さない。文言は日本語。`esc()` で必ずエスケープ。用語は「タスク」。
- PR 本文に「`docs/development.md`: 直した節の名前」。`development.md` に、版番号・PR 番号・日付・「以前は〜」を書かない。動作確認していないことは「未確認」。
- 設計書に無いことは、設計書の趣旨で決め、台帳に `Ruling:` で記録する。

## Review Focus

1. 催促の入力欄の保存が失敗したとき、入力が消えない。他の入力欄（完了・今日へ・突発）と同時に開かない。
2. 回答予定日が今日の日は、催促に入らない。予定日なしの日数の境界（`waitingLongDays` ちょうどで入る）。待ち始めなしは入らない。
3. 「催促した」の保存で、待ち先が変わらない。`since` = 今日、`expected` = 今日 + N 日。
4. 候補の並びが、今日の優先の順と一致する。Done は末尾の組。見る週を変えても壊れない。
5. 「今日の優先」の「今日へ」が、スケジュール画面に出ない。押して ToDo タブの入力欄が開く。

---

## Task 0: ブランチ

- [ ] **Step 1:** `docs/todo-priority-remind`（設計書・計画書のコミットあり）から `feat/todo-priority-remind` を作る。

---

## Task 1: 純関数 `chaseTasks`・`markChased`

**Files:** Modify `plugins/project-lens/src/core/week.js`、`plugins/project-lens/src/ui/edit.js`、`tests/week.test.js`（既存のテストの場所に合わせる。無ければ新規）、`tests/edit.test.js`（同）

**Interfaces:**
- Produces: `chaseTasks(data, today) → [{ task, party, since, expected, lapsedDays, waitedDays }]`。`lapsedDays` は予定日を過ぎた日数（予定日が今日より前のとき `diffDays(today, expected)`、他は `null`）、`waitedDays` は `since` があれば `diffDays(today, since)`、無ければ `null`。入れる条件・並びは設計書 3。しきい値は `data.settings.waitingLongDays`（無ければ 7）。
- Produces: `markChased(data, taskId, days, today) → data`。Waiting で `waitingOn.party` があり、`days` が 1〜30 の整数のとき、`waitingOn = { party, since: today, expected: addDays(today, days) }`。それ以外は `throw new Error("…")`（日本語。入力を直す案内を含む）。

- [ ] **Step 1: 失敗するテストを書く:** `chaseTasks`: 「予定日が昨日 → 入る（lapsedDays 1）」「予定日が今日 → 入らない」「予定日が明日で待ち始めが 30 日前 → 入らない」「予定日なし・待ち始め 7 日前 → 入る（境界）、6 日前 → 入らない」「予定日なし・待ち始めなし → 入らない」「Waiting 以外 → 入らない」「並び: 予定日超過の日数が多い順 → 予定日なしの待ち日数が多い順 → ID」「`waitingLongDays` を 3 にすると境界が変わる」。`markChased`: 「since が今日、expected が今日 + 3、party は変わらない」「Waiting 以外 → エラー」「party が空 → エラー」「days が 0・31・1.5 → エラー」「元の data を変更しない」。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。**
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: Waiting の催促の対象を求める関数と、催促を記録する関数を足す`

---

## Task 2: 候補を優先の順に並べ、理由を添える

**Files:** Modify `plugins/project-lens/src/ui/views/todo.js`、`plugins/project-lens/src/ui/theme.css`（必要なら）、`tests/views.test.js`

**Interfaces:**
- Consumes: `rankTasks(data, today)`（`core/schedule.js`。`{ taskId, score, reasons, … }[]`）、`weekTasks` の行（`group`・`task`）。
- Produces: `renderTodo` の右の列で、`group !== "done"` の行を、`rankTasks` の順に並べた 1 つの `ul.tdlist` にする（見出しなし）。各行の `td-meta` の上に、`<div class="td-why">` で理由を「・」でつなぐ（`group === "scheduled"` なら先頭に「今週に予定あり」）。Done の組は、見出し「完了」で末尾。行の動き（完了・今日へ・ドラッグ・入力欄）は変えない。

- [ ] **Step 1: 失敗するテストを書く:** 「未完了の候補が、rankTasks の順（高い点数が先）に並ぶ」「理由（期限超過 N日・重要・前のタスク待ち）が行に出る」「scheduled の行の理由の先頭が『今週に予定あり』」「未完了の組の見出し（期限超過・今週の期限など）が出ない」「Done の行は『完了』の見出しの下」「別の週を見ても、並びは今日の点数の順」「ID が出ない」。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。**
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: ToDo タブの週の候補を、今日の優先の順に並べて理由を出す`

---

## Task 3: 「今日の優先」の行に「今日へ」

**Files:** Modify `plugins/project-lens/src/ui/views/prio.js`、`plugins/project-lens/src/ui/app.js`、`tests/views.test.js`、`tests/app-source.test.js`

**Interfaces:**
- Consumes: `renderPrio(data, today, opts)`（`opts.sched` が真ならスケジュール画面）、`openPlan(id)`（`app.js`）、`mondayOf`（`core/week.js`）。
- Produces: `renderPrio` の未完了の行に、`opts.sched` が偽のときだけ、`<button class="btn" data-prioplan="<id>">今日へ</button>`。`app.js` の `data-prioplan` で、`S.screen = "todo"`、`S.todoWeek = mondayOf(今日)`、`openPlan(id)`（画面の移動で、ほかの入力欄は閉じる。`clearSel` の流儀に合わせる）。

- [ ] **Step 1: 失敗するテストを書く:** 「ガント・リストの『今日の優先』の行に『今日へ』が出る」「`sched` のとき出ない」「完了の行・今日のタスクにある行には出ない」。`app-source.test.js`: 「`data-prioplan` が ToDo タブへ移り、`S.todoWeek` を今週にして `openPlan` を呼ぶ」。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。** 捕捉のクリック（外側のクリックで選択を外す処理）の例外のセレクタに、必要なら `[data-prioplan]` を足す。
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: 今日の優先の行から、今日へ入れられるようにする`

---

## Task 4: 催促の組

**Files:** Modify `plugins/project-lens/src/ui/views/todo.js`、`plugins/project-lens/src/ui/app.js`、`plugins/project-lens/src/ui/theme.css`、`tests/views.test.js`、`tests/app-source.test.js`

**Interfaces:**
- Consumes: `chaseTasks`・`markChased`（Task 1）、`updateTask(data, id, { waitingOn: {…} }, today)`（`ui/edit.js`。既存の party・expected の保存と同じ形）。
- Produces: `renderTodo(..., opts)` が `opts.chase`（`{ key: タスクの id, mode: "done"|"edit", days, party, expected }` か null）を受ける。左の列を `div.tdleft` にし、「今日の ToDo」の `section.tdtoday`（`data-tddrop` はこちらだけ）の下に `section.panel.tdchase`（`aria-label="催促"`、見出し「催促（N 件）」。0 件なら出さない）。行: `li.td-row`、`data-chaserow="<id>"`、プロジェクト名・件名・待ち先と日付の行・ボタン `data-chasedone="<id>"`（「催促した」）・`data-chaseedit="<id>"`（「待ち先・予定日を直す」）。`mode === "done"` の入力欄: `<select data-ch="days">`（1・2・3・5・7 日後、初期 3）・`data-chasesave="<id>"`（「記録する」）・`data-chasecancel`。`mode === "edit"` の入力欄: `<input data-ch="party">`・日付欄 `data-ch="expected"`（`dateInputHtml`）・`data-chasesave`・`data-chasecancel`。状態は `S.tdChase`。`S.tdChase` と `S.tdOpen`・`S.tdPlan`・`S.urgentDraft` は、同時に開かない。画面の移動・`clearSel`・週の移動・キャンセル・保存の成功で外す。`render()` の検証で、タスクが催促の対象でなくなったら外す。保存: 押したときに欄の値を読み、先に `S.tdChase` へ写してから `apply`（done は `markChased`、edit は `updateTask`。待ち先が空なら `throw`）。失敗は通知だけで、入力欄と入力を残す。`isEditing` の保護・`focusSelector` に `ch` を足す。

- [ ] **Step 1: 失敗するテストを書く:** `views.test.js`: 「催促の対象があるとき、『今日の ToDo』の下に『催促（N 件）』が出る。0 件なら出ない」「行に待ち先と『N 日超過』／『回答待ち N 日』、2 つのボタンが出る」「待ち先が空は『待ち先: 未設定』」「`chase` を渡すと、その行の下に入力欄が出る（done: 日数の選択・初期 3、edit: 今の待ち先・予定日）」「ドロップ先（`data-tddrop`）は『今日の ToDo』だけ」「ID が出ない」。`app-source.test.js`: 「`data-chasedone`・`data-chaseedit` が `S.tdChase` を開き、`S.tdOpen`・`S.tdPlan`・`S.urgentDraft` を外す」「`data-chasesave` が、先に `S.tdChase` へ写してから `apply` する」「失敗で外さない（成功のときだけ外す）」「`clearSel`・週の移動・`render()` の検証が `S.tdChase` を扱う」。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。** 入力（`data-ch`）の変更は、`change` で `S.tdChase` へ写す。
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: ToDo タブに、Waiting の催促の組を出す`

---

## Task 5: 文書・ビルド・実機の確認

**Files:** Modify `docs/development.md`、`docs/guide.md`、`README.md`、`plugins/project-lens/assets/project-lens.html`（生成物）

- [ ] **Step 1: `docs/development.md` を直す。** 「画面の動き > ToDo タブ」に、候補の並びと理由、催促の組（入る条件・並び・「催促した」「待ち先・予定日を直す」・`S.tdChase`・同時に開かない）、「今日の優先」の「今日へ」。「算出の規則」に、催促の対象の条件（`chaseTasks`、`waitingLongDays`）。「設計判断」に 1 項目（催促を点数に足さず別の組にした理由、下に置いた理由、履歴を持たない理由）。未確認は「未確認」。
- [ ] **Step 2: `docs/guide.md`・`README.md` の ToDo タブ・今日の優先の説明を直す。**
- [ ] **Step 3: 照合する。** バッククォートの名前（`chaseTasks`・`markChased`・`S.tdChase`・`data-chasedone`・`data-prioplan` など）がコードにあること。
- [ ] **Step 4:** `npm run build && npm test`。件数と失敗 0 を記録する。
- [ ] **Step 5: 実機の確認（コントローラが行う）。** デモデータ（Waiting のタスクの回答予定日を過去にして確認）、`?today=2026-11-25&time=10:15`。
- [ ] **Step 6: コミット** `docs: ToDo タブの並び・催促に合わせて文書を直す`
