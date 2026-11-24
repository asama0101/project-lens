# 予定と実績を 1 つの作業枠に持たせる Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 予定の枠に任意の `actual`（日付・開始・終了）を持たせ、実績を保存し直して更新・消去できるようにし、カレンダー・ガントの実績の線・稼働・サマリー・札に、すぐ反映されるようにする。

**Architecture:** 稼働・ガント・集計は、「実績の区間」（実績だけの枠の自身の時間と、予定の枠の `actual`）を通して数える。判断は純関数（`core/sessions.js` ほか）、画面は `ui/views/schedule.js`・`views/prio.js`、結線は `ui/app.js`。今の形（予定の枠と、別の実績の枠）のデータは、そのまま同じ数字で読める。

**Tech Stack:** Node.js 24（ESM）、`node --test`、素の HTML／JS（`npm run build`）。

**Spec:** `docs/specs/2026-11-25-single-slot-design.md`（土台: `docs/specs/2026-11-24-actuals-input-design.md`）

## Global Constraints
- Windows 専用、Node 24 以上。`plugins/project-lens/src/` を変えたら `npm run build` して `plugins/project-lens/assets/project-lens.html` をコミットする（古いと `npm test` が失敗する）。export 名は、全モジュールで重複させない。
- 今の形のデータ（予定の枠と、別の実績の枠。`actual` を持たない）で、稼働・ガントの線・未確認の判定・サマリーの数字が変わらない。既存のテストは、そのまま通る（実績の枠を前提にして規則が変わるものだけ、新しい規則に直す）。
- `actual` を持てるのは `kind: "planned"` の枠だけ。形は `{ date, start, end }`（3 つともいつも書く）。保存の操作では、実績の開始が今より後のものを受けない。最短は 15 分。実績の区間どうしは重ならない（`err`）。会議の実績は「実績の区間」に含めず、会議との重なりは警告だけ。
- 画面に ID を出さない。`esc()` で必ずエスケープする。文言は日本語。メモリ上の状態（確認待ち・下書き）に、`render()` が `S.data.tasks` で検証する形で ToDo の id を入れない。
- 既存のコードのスタイル（1 行の関数、日本語のコメント）に合わせる。関係のない箇所は直さない。
- 変更の PR 本文に「`development.md`: 直した節の名前」を書く。ブランチは `feat/single-slot`（`docs/single-slot-design` から切り替える）。

## Review Focus
- 同じ枠の「実績を保存」をやり直して更新できる（自分自身の `actual` とは重ならない）。ほかの実績の区間（実績だけの枠を含む）とは、重なりのエラー。
- 今の形のデータ（予定の枠＋別の実績の枠）の稼働・ガントの線・未確認が、変更の前後で同じ。
- 予定の枠を別の日へ動かしても、`actual.date` は動かない。稼働・サマリーは、実績の日付で数える。
- 予定の枠が表示範囲外でも、`actual.date` が範囲内なら、カレンダーに実績の帯が出て、押すとその枠が選ばれ、サマリーに数えられる。
- 予定の枠の実績と、同じ時間の実績だけの枠を足せない（二重に数えない）。
- 実績のある枠を削除するときは確認が出て、「やめる」で何も変わらない。実績を消しても、予定の枠は残る。
- 実績を持つ枠を、あとから未来の予定へ動かしても、実績を更新・消せる。

---

### Task 1: 実績の区間と、枠の規則・検証

**Files:**
- Modify: `plugins/project-lens/src/core/sessions.js`、`plugins/project-lens/src/core/schema.js`、`plugins/project-lens/data/sample.json`
- Test: `tests/sessions.test.js`、`tests/schema.test.js`

**Interfaces:**
- Produces:
  - `actualSpans(data): Array<{ sessionId, taskId, title, projectId, date, start, end }>` — タスクと ToDo の全枠から。`kind: "actual"` の枠は自身の `date`・`start`・`end`、`kind: "planned"` の枠で `actual` があるものは `actual` の 3 つ。`projectId` は持ち主のもの（ToDo は `null`）。
  - `actualSlots(data): Array<{date,start,end}>` — `actualSpans` の `date`・`start`・`end` だけ（今の名前・形のまま。中身が、予定の枠の `actual` を含む）。
  - `sessionKind(session, now, actuals = [])` — `kind: "actual"`、または `actual` を持つ予定の枠は `"actual"`。`actual` が無い過ぎた予定は、重なる実績の区間（`actuals`）が無ければ `"unconfirmed"`、あれば `"planned"`。過ぎていないものは `"planned"`。
  - `setActual(data, sessionId, { date, start, end }, now): { data, error?, warning? }` — `kind: "planned"` の枠の `actual` を書く（あれば上書き）。エラー: 枠が無い（`枠 X がありません`）、`kind: "actual"` の枠（`この枠は実績だけの枠です`）、開始が今より後（`まだ始まっていない時間には実績を入れられません`）、終了が開始以前・24:00 超・15 分未満（`check` と同じ文言）、ほかの実績の区間との重なり（`他の実績（HH:MM〜HH:MM）と重なっています`。自分自身の今の `actual` は除く）。会議との重なりは警告。
  - `clearActual(data, sessionId): { data, error? }` — `actual` を外す。枠が無い・`actual` が無いときは `error`。
  - `taskActual(data, taskId)` — `hours` と `firstDate` を、実績の区間から（`count` は、今までどおり枠の数）。
- 既存の `addActual`・`moveSession`・`resizeSession` の、実績どうしの重なりの判定は、実績の区間（`kind: "actual"` の枠と、予定の枠の `actual`）全体に対して行う（自分自身の枠は除く）。予定どうしの判定は変えない。

- [ ] **Step 1: 失敗するテストを書く**
  - `sessions.test.js`: `actualSpans: 実績だけの枠と、予定の枠の actual の両方が、持ち主の projectId つきで返る`。`setActual: 予定の枠に actual を書き、予定の枠はそのまま`。`setActual: もう一度書くと上書きになり、自分自身とは重ならない`。`setActual: 実績だけの枠・存在しない枠・開始が今より後・15 分未満・ほかの実績の区間との重なりは error で、データ不変`。`setActual: 休みの日にも書ける`。`clearActual: actual だけが外れ、予定の枠は残る。actual が無い枠は error`。`sessionKind: actual を持つ予定の枠は actual（過ぎていても未確認にならない）。actual が無く、重なる実績の枠も無い過ぎた予定は unconfirmed。今の形（別の実績の枠が重なる）は planned のまま`。`addActual・moveSession・resizeSession: 予定の枠の actual と重なる実績だけの枠は置けない（error）`。`moveSession: 予定の枠を別の日へ動かしても actual.date は変わらない`。`taskActual: 予定の枠の actual を含めた時間と、最初の日付`。
  - `schema.test.js`: 正しい `actual` は通る。error: `kind: "actual"` の枠が `actual` を持つ、`actual` の日付・時刻が不正、終了が開始以前、実績の区間どうし（予定の枠の `actual` と、実績だけの枠、または予定の枠の `actual` 2 つ）の重なり。今の形（予定の枠と、別の実績の枠が重なる）は、error にならない。
- [ ] **Step 2: 実行して失敗を確かめる** — `node --test tests/sessions.test.js tests/schema.test.js` → FAIL。
- [ ] **Step 3: 実装** — 上の Interfaces のとおり。`check` の実績の重なりの判定は、`allSessions` の `kind === "actual"` ではなく、`actualSpans` で、自分自身の枠（`ignoreId`）を除いて比べる。`schema.js` の枠の形の検査（`checkSession`）に `actual` の検査を足し、重なりの検査（`byDay` の総当たり）は、予定どうしは今のまま、実績の区間どうしを別に比べる。`sample.json`: 過去の予定の枠 1 件（`actual` つき。時刻は予定と少しずらす）を、タスクの枠に足す（今の形の例は残す）。`validate(sample)` が `errors: []`。
- [ ] **Step 4: 実行して通ることを確かめる** — 同じコマンドと `npm test` → PASS（既存のテストの数字は変わらない）。
- [ ] **Step 5: コミット** — `git commit -m "feat: 予定の枠に実績（actual）を持たせる規則と検証を足す"`

---

### Task 2: 実績の区間を使う集計（稼働・ガント・ToDo の分数）

**Files:**
- Modify: `plugins/project-lens/src/core/workload.js`、`plugins/project-lens/src/core/metrics.js`、`plugins/project-lens/src/core/todos.js`
- Test: `tests/workload.test.js`、`tests/metrics.test.js`、`tests/todos.test.js`

**Interfaces:**
- Consumes: Task 1 の `actualSpans`・`actualSlots`。
- Produces: 公開する関数の形は変えない（`workload`・`projectHours`・`ganttRows` の `actual`・`todoMinutes`・`weekReview`・`carryTodo`）。

- [ ] **Step 1: 失敗するテストを書く**
  - `workload.test.js`: `workload: 予定の枠の actual の時間が、actual.date の日・持ち主のプロジェクトに数えられる`。`workload: 予定の枠を別の日へ動かしても、実績は actual.date の日に数える`。`workload: ToDo の予定の枠の actual は「プロジェクト未設定」に入る`。`workload: 今の形のデータの数字は変わらない`（既存のテストが通る）。
  - `metrics.test.js`: `ganttRows: 実績の線の開始は、予定の枠の actual.date（実績だけの枠と合わせた最小の日付）`。実績を直す（`setActual` で日付を変える）と、線の開始が変わる。
  - `todos.test.js`: `todoMinutes: planned は予定の枠の自身の時間（actual を持っていても数える）、actual は実績の区間（actual.date で範囲を絞る）`。`weekReview: 見出しと行の分数が同じ規則`。`carryTodo: actual を持つ予定の枠は、回す前の日にあっても消さない`。
- [ ] **Step 2: 実行して失敗を確かめる** — `node --test tests/workload.test.js tests/metrics.test.js tests/todos.test.js` → FAIL。
- [ ] **Step 3: 実装** — `workload.js` の `actualSessions` を `actualSpans(data)` から作り（範囲は区間の `date`、プロジェクトは区間の `projectId`）、`unconfirmedTasks` は `sessionKind(s, now, actualSlots(data))`（今のまま）。`metrics.js` の `actualSpan(t, today)` は、タスクの枠から、実績だけの枠の `date` と、予定の枠の `actual.date` を集める。`todos.js` の `todoMinutes`・`weekReview` の `sum` は、予定は `kind: "planned"` の枠の自身の時間（枠の日付で範囲を絞る）、実績は実績の区間（区間の日付で範囲を絞る）。`carryTodo` の「消す予定の枠」は、`actual` を持たない枠だけ。
- [ ] **Step 4: 実行して通ることを確かめる** — 同じコマンドと `npm test` → PASS。
- [ ] **Step 5: コミット** — `git commit -m "feat: 稼働・ガントの線・ToDo の分数を、実績の区間で数える"`

---

### Task 3: 実績を保存・更新・消す操作（入力欄とハンドラ）

**Files:**
- Modify: `plugins/project-lens/src/ui/edit.js`、`plugins/project-lens/src/ui/views/schedule.js`（`actualForm`）、`plugins/project-lens/src/ui/app.js`
- Test: `tests/edit.test.js`、`tests/views.test.js`、`tests/app-source.test.js`

**Interfaces:**
- Consumes: Task 1 の `setActual`・`clearActual`。
- Produces:
  - `recordSlotActual(data, sessionId, { date, start, end }, now): { data, taskId, statusChanged, from }` — `setActual` を呼び、失敗は `throw new Error(error)`。持ち主がタスクで To Do・Waiting なら In Progress にする（今の `recordActual` と同じ。Waiting の待ち先は外れる）。ToDo は状態を変えず `statusChanged: false`・`from: ""`。`taskId` は枠の持ち主の ID。
  - `actualForm(data, ctx)` の予定の枠モード（`ctx.selSess` が `kind: "planned"` の枠で、開始が今以前、または `actual` を持つとき）: 日付（`data-ac="date"`）・開始（`data-ac="start"`）・終了（`data-ac="end"`）。初期値は `actual` があればその値、なければ枠の日付と予定の時刻。ボタン `data-actsave="<枠の id>"`（文言は、`actual` が無いとき「実績を保存」、あるとき「実績を更新」）。`actual` があるとき、`data-actclear="<枠の id>"`（「実績を消す」）。下書き（`S.actDraft`）の `date` も、この欄に反映する。「＋ 実績を追加」のモードは今のまま。
  - 既存の `recordActual(data, taskId, slot, now)`（実績だけの枠を足す）は変えない。

- [ ] **Step 1: 失敗するテストを書く**
  - `edit.test.js`: `recordSlotActual: To Do のタスクは In Progress になり statusChanged が true、実績の枠は予定の枠の actual に入る`。Waiting は待ち先が外れ `from: "Waiting"`。ToDo は状態変更なし。`recordSlotActual: 更新（2 回目）でも、重なりのエラーにならず、値が置き換わる`。エラー（開始が今より後・重なり・枠が無い）は例外でデータ不変。
  - `views.test.js`: `actualForm: 予定の枠（開始が今以前）で、日付・開始・終了が予定の値、ボタンの文言は「実績を保存」、実績を消すボタンは無い`。`actualForm: actual を持つ予定の枠では、初期値が actual の値、文言は「実績を更新」、data-actclear が出る`。`actualForm: 開始が今より後の予定の枠でも、actual を持てば出る（持たなければ出ない）`。`actualForm: 下書きの日付・時刻が値になる`。
  - `app-source.test.js`（既存の文字列照合の流儀）: `data-actsave` の枠モードが `recordSlotActual` を `apply` に通し、失敗の経路で下書きを消さない。`data-actclear` が `clearActual` を `apply` に通す。通知の文言（「の実績を入れました」「の実績を更新しました」「の実績を消しました」）。
- [ ] **Step 2: 実行して失敗を確かめる** — `node --test tests/edit.test.js tests/views.test.js tests/app-source.test.js` → FAIL。
- [ ] **Step 3: 実装** — `edit.js` に `recordSlotActual`。`actualForm` を上のとおりに直す。`app.js` の `data-actsave` の枠モード（`actsave` に枠の ID があるとき）は、入力欄から日付・開始・終了を読み、下書きへ先に写し、`recordSlotActual` を `apply` に通す（成功で選択・下書きを外す。失敗は下書きを残す）。`data-actclear` のハンドラを足す（`clearActual`）。画面の外クリックの判定（`line 512` 付近）と、入力中の判定に `[data-actclear]` を足す。「＋ 実績を追加」（`actsave=""`）は、今の `recordActual` のまま。
- [ ] **Step 4: 実行して通ることを確かめる** — `npm run build && npm test` → PASS。
- [ ] **Step 5: コミット** — `git commit -m "feat: 予定の枠の実績を、保存し直して更新・消せるようにする"`

---

### Task 4: カレンダー・サマリー・札の表示

**Files:**
- Modify: `plugins/project-lens/src/ui/views/schedule.js`（`sessionBlocks`・`renderCalendar`・`renderSchedule` の集計）、`plugins/project-lens/src/ui/views/prio.js`（`slotHtml`）、`plugins/project-lens/src/ui/app.js`（実績の帯を押したときの選択）、`plugins/project-lens/src/ui/theme.css`（必要なら）
- Test: `tests/views.test.js`

**Interfaces:**
- Consumes: Task 1 の `actualSpans`・`sessionKind`。
- Produces（HTML の契約）:
  - 予定の枠が `actual` を持つとき、カレンダーに 2 つの描画要素を出す: 予定のブロック（`data-dragsess="<枠の id>"`、class に `plan`。`actual` があるので「未確認」にはしない。文字は予定の時刻）と、実績の帯（`data-actbar="<枠の id>"`、class に `act`、`draggable` にしない。位置は `actual.date` の列の `actual.start`〜`actual.end`。文字は実績の時刻と ✓）。予定のブロックは、予定の日付が表示中の日のときだけ、実績の帯は、`actual.date` が表示中の日のときだけ描く。同じ日の列で時間が重なる予定と実績は、予定を左半分（`left:0;width:50%`）、実績を右半分（`left:50%;width:50%`）に並べる（今の規則と同じ）。重ならなければ全幅。実績だけの枠は、今のまま。
  - どちらを押しても、その枠が選ばれる（`data-actbar` の押下は、`data-dragsess` と同じ選択の処理）。
  - サマリー: 「実績 N 時間」は、表示中の日（週表示は 7 日）の日付を持つ、実績の区間の合計。「予定 N 件」は、予定の日付が表示中の日で、実績が無く、過ぎていない予定の枠の数（今の `kinds` の数え方）。未確認の件数は、今の規則。表示中の範囲の枠（`inView`）は、予定の日付が範囲内、または `actual.date` が範囲内のもの。
  - 札（`prio.js` の `slotHtml`）: 予定の枠が `actual` を持つとき、「実績」の札と実績の時刻（`HH:MM–HH:MM`）、続けて小さく「予定 HH:MM–HH:MM」。

- [ ] **Step 1: 失敗するテストを書く**
  - `views.test.js`: `renderCalendar: 予定の枠の actual が、実績の帯として actual.date の列に出る（data-actbar、位置は時刻どおり、draggable でない）`。`renderCalendar: 予定が表示範囲外で actual.date だけが範囲内でも、実績の帯が出て、予定のブロックは出ない`。`renderCalendar: 予定と実績が重なる列では、予定が左半分・実績が右半分`。`renderCalendar: actual を持つ予定の枠は、過ぎていても class unconf を持たない`。`renderSchedule: サマリーの実績の時間が、actual.date の日で数えられる`。`今日のタスクの札: actual を持つ枠は「実績」の札と実績の時刻と、予定の時刻`。選択: `sessionSelection`（既存）が、実績の帯の枠 ID でも同じ結果（枠が見つかる）。
  - `app-source.test.js`: `[data-actbar]` の押下が、`[data-dragsess]` と同じ選択の処理に入る。
- [ ] **Step 2: 実行して失敗を確かめる** — `node --test tests/views.test.js tests/app-source.test.js` → FAIL。
- [ ] **Step 3: 実装** — `sessionBlocks` は、その日の「描く要素」（予定のブロック・実績の帯・実績だけの枠）を作って並べる。`renderSchedule` の `inView`・時間・件数を上のとおりに直す。選択のハンドラ（`app.js`）に `[data-actbar]` を足す（ドラッグ・下端のサイズ変更の処理には入れない）。
- [ ] **Step 4: 実行して通ることを確かめる** — `npm run build && npm test` → PASS。
- [ ] **Step 5: コミット** — `git commit -m "feat: カレンダーに予定の枠の実績を帯で出し、集計・札を実績の区間にそろえる"`

---

### Task 5: 実績のある枠の削除の確認

**Files:**
- Modify: `plugins/project-lens/src/ui/app.js`（`deleteSelected`、状態 `S.askDelSess`、`clearSel`）、`plugins/project-lens/src/ui/views/schedule.js`（確認の表示）
- Test: `tests/views.test.js`、`tests/app-source.test.js`

**Interfaces:**
- Produces: 状態 `S.askDelSess`（確認待ちの枠の id か `null`。メモリのみ。`clearSel`・画面の移動・「やめる」・削除の成功・選択の変更で外す）。確認の表示は、選んだ枠の入力欄の領域（`actualForm` の隣）に `<div class="ask">`: 「実績 N 分も消えます」（N は、その枠の `actual` の分数）、`data-delsessok="<枠の id>"`（「削除する」）、`data-delsessno`（「やめる」）。

- [ ] **Step 1: 失敗するテストを書く**
  - `views.test.js`: `確認待ちの枠（actual あり）の欄に「実績 75 分も消えます」と 2 つのボタンが出る`（ID は属性だけ）。確認待ちでなければ出ない。
  - `app-source.test.js`: `deleteSelected` が、`actual` を持つ枠のとき、`S.askDelSess` に入れて描き直し、すぐには削除しない。`data-delsessok` が `removeSession` を `apply` に通す。`data-delsessno` で外す。`actual` を持たない枠・実績だけの枠は、今までどおり 1 回で削除。`S.askDelSess` に、`render()` が `S.data.tasks` で検証する形の ID を入れない。
- [ ] **Step 2: 実行して失敗を確かめる** — `node --test tests/views.test.js tests/app-source.test.js` → FAIL。
- [ ] **Step 3: 実装** — 上のとおり。Delete・Backspace キーの経路（`deleteSelected` を通る）も、同じ確認になる。確認が出ている間の再描画で、確認が消えない。
- [ ] **Step 4: 実行して通ることを確かめる** — `npm run build && npm test` → PASS。
- [ ] **Step 5: コミット** — `git commit -m "feat: 実績のある予定の枠を削除するとき、確認を出す"`

---

### Task 6: 文書・ビルド・実機の確認

**Files:**
- Modify: `docs/development.md`（「画面の動き > 今日のタスクとスケジュール」の実績の節、「会議と稼働」の稼働、「設計判断」に 1 項目）、`docs/guide.md`・`README.md`（画面の説明）、`plugins/project-lens/assets/project-lens.html`（`npm run build`）

- [ ] **Step 1: `development.md` を直す** — 設計書の「決めたこと」を、今のコードの事実として書く（`actual` の形、実績の区間、保存・更新・消去、未確認の判定、カレンダーの帯、サマリー・ガント・稼働の数え方、削除の確認、今の形のデータの扱い）。設計判断に、「予定と実績を 1 つの枠にした」理由と、見送った案（実績の枠に予定への参照を持たせる案、実績を直す欄だけを足す案、実績の帯のドラッグ）を書く。前の仕事の「実績は、予定の枠を書き換えず、予定と別の枠として入れる」の項目は、今の規則に合わせて直す（経緯は書かない）。確かめていないことは「未確認」と書く。`grep -n` で、旧い記述（「予定の枠は、実績ができても、消えない」など）が残っていないことを確かめる。
- [ ] **Step 2: ビルドとテスト** — `npm run build && npm test` → すべて PASS。
- [ ] **Step 3: 実機の確認** — Chromium・Playwright、`?today=2026-10-20&time=10:15`、`sample.json` を `showOpenFilePicker` の差し替えで読み込む（前の仕事と同じ手順）。次を 1 回ずつ: 予定の枠を選ぶ → 実績を保存（帯が出る）→ 時刻を直して更新 → カレンダー・ガントの実績の線・稼働・サマリー・今日のタスクの札が変わる → 予定の枠を別の日へ動かして実績の日が動かない → 実績を消す（予定の枠は残る）→ 実績のある枠を削除（確認 → やめる → 削除する）→ 今の形のデータ（`sample.json` の実績だけの枠）が変わらない。確かめていない画面（暗い配色、幅 900px・700px）は「未確認」と書く。
- [ ] **Step 4: コミット** — `git add -A && git commit -m "docs: 予定と実績を 1 つの枠に持たせる変更を文書に反映する"`

---

## Self-Review の結果
- 設計書の各項目の担当: データ・規則・検証 → Task 1、集計（稼働・ガント・ToDo）→ Task 2、操作（保存・更新・消去）→ Task 3、画面（帯・サマリー・札）→ Task 4、削除の確認 → Task 5、文書・実機 → Task 6。
- 型の一貫: `actualSpans`・`actualSlots`・`setActual`・`clearActual`・`recordSlotActual`・`data-actbar`・`data-actclear`・`S.askDelSess` の名前は、Task 1〜5 で同じ。
- 設計書にない決め（私の判断）: 実績を持つ予定の枠の「予定のブロック」は、予定の色（class `plan`）で、実績の帯とは別の色にする（実績があるので「未確認」の点線は付けない）。「実績を保存」と「実績を更新」は、同じボタン（文言だけ変わる）。ToDo タブの「実績を入れる」は、この仕事では変えない（実績だけの枠を足す今の動き。仕事 2 で作り直す）。
