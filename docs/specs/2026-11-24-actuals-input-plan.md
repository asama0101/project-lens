# 実績の入れ方の作り直し Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「実績にする」ボタンを廃止し、予定とは別の枠として実績（作業枠・会議）を入れられるようにし、予定の時間が過ぎて実績が未入力のものを「未確認」として残す。

**Architecture:** 実績の作業枠（`kind: "actual"`）を、予定の枠と重なって置ける別の枠にする。判定の純関数（`core/sessions.js`・`core/schedule.js`・`core/workload.js`）を先に直し、その上に編集の関数（`ui/edit.js`）、画面（`ui/views/*`・`ui/app.js`）、取り込み（`import/calendar.js`）を載せる。会議の実績は、任意の項目 `actual: { start, end }` で持つ。

**Tech Stack:** Node.js 24（ESM）、`node --test`、素の HTML／JS（ビルドは `npm run build`）。

**Spec:** `docs/specs/2026-11-24-actuals-input-design.md`

## Global Constraints
- Windows 専用、Node 24 以上。`plugins/project-lens/src/` を変えたら `npm run build` して `plugins/project-lens/assets/project-lens.html` をコミットする（古いと `npm test` が失敗する）。
- データ形式の正本は `plugins/project-lens/data/sample.json` と `src/core/schema.js`。
- 既存の方針: 旧形式の移行・読み替えは持たない。例外は、`confirmed: true` で `actual` の無い会議を、予定の時刻の実績として読むこと。
- 画面の文言は日本語。画面に ID（`AA-0001` など）は出さず、件名で言う。
- 既存のコードのスタイル（1 行の関数、日本語のコメント）に合わせる。関係のない箇所は直さない。
- PR 本文に「`development.md`: 直した節の名前」を書く。
- ブランチは `docs/actuals-input-design` から切り替える（実装は `feat/actuals-input`）。

## Review Focus
- 実績の枠の開始が今より後 → 置けない（エラー）。終了が今より後の実績は置ける。
- 同じ予定から実績を 2 回保存 → 2 回目は、実績どうしの重なりでエラー（データは変わらない）。
- 実績が予定と時間をずらして入った → 予定の枠は未確認でなくなる。実績が無い過ぎた予定は未確認のまま。
- `confirmed: true` だけの会議（`actual` なし）の稼働が、保存前と同じ時間で数えられる。
- 取り込みが今日より前の会議を落とす → 取り込み済みの過去の会議（範囲外になる）は消えない。
- 土日・休みの日の実績の枠が、置ける（予定は今までどおり置けない）。

---

### Task 1: 作業枠の規則（重なり・実績の追加・未確認の判定）

**Files:**
- Modify: `plugins/project-lens/src/core/sessions.js`（`check`・`sessionKind`・`addSession`・`moveSession`・`resizeSession`・`confirmSession` を削除し `addActual` を足す）
- Modify: `plugins/project-lens/src/core/schema.js:156-170`（枠の重なりの検査を、同じ種別どうしだけにする）
- Test: `tests/sessions.test.js`、`tests/schema.test.js`

**Interfaces:**
- Produces:
  - `actualSlots(data): Array<{date,start,end}>` — 全タスクの `kind === "actual"` の枠。
  - `sessionKind(session, now, actuals = []): "planned"|"actual"|"unconfirmed"` — `actual` は常に `actual`。`planned` で過ぎていて、`actuals` のどれとも時間が重ならなければ `unconfirmed`。それ以外は `planned`。
  - `addActual(data, taskId, slot, now): { data, error?, warning? }` — `slot = {date,start,end}`。`kind: "actual"` の枠を、新しい ID（`nextId`）で足す。
  - `confirmSession` は削除する。

- [ ] **Step 1: 失敗するテストを書く**（`tests/sessions.test.js`。`confirmSession` を使う既存テストを削除または書き換える）
  - `sessionKind: 重なる実績があれば planned、無ければ unconfirmed`: 過ぎた予定 `{kind:"planned", date, start:"09:00", end:"10:00"}` に、`actuals = [{date, start:"09:30", end:"10:00"}]` を渡すと `"planned"`。`[]` では `"unconfirmed"`。接するだけ（実績が 10:00–11:00）は重ならない → `"unconfirmed"`。
  - `addActual: 予定と重なって置ける`: 予定の枠 S（10:00–11:00）があるタスクに、同じ時間の実績を足す → `error` なし、枠は 2 つになり、片方は `kind: "actual"`。
  - `addActual: 実績どうしの重なりはエラー`: 同じ時間に 2 回足すと、2 回目が `error` に `他の実績の枠（` を含み、`data` は変わらない。
  - `addActual: 開始が今より後はエラー`: `now.time = "10:15"` で、開始 `"10:30"` → `error` に `まだ始まっていない` を含む。開始 `"10:00"`・終了 `"11:00"`（終了は今より後）は通る。
  - `addActual: 休みの日にも置ける`: 土曜の日付で `error` なし。`addSession`（予定）は、土曜では今までどおり `error`。
  - `addActual: 15 分未満はエラー`、`存在しないタスクはエラー`（`タスク X がありません`）。
  - `moveSession: 実績を今より後へ動かすとエラー、予定へは戻らない`: 実績の枠を未来の開始へ動かす → `error` に `今より後` を含む。
  - `moveSession・resizeSession: 予定と実績が重なって動かせる`、同じ種別どうしの重なりは `error`。
- [ ] **Step 2: テストを実行し、失敗を確かめる** — `node --test tests/sessions.test.js` → FAIL（`addActual` が無い）。
- [ ] **Step 3: 実装** — `sessions.js`:
  - `check(data, slot, ignoreId, kind)` に、第 4 引数 `kind` を足す。重なりのエラーは、同じ `kind` の枠だけが対象。休みの日のエラーは `kind === "planned"` のときだけ。会議との重なりの警告は、両方で出す。
  - `moveSession`・`resizeSession` は、`cur.kind` を `check` に渡す。`moveSession` は、`cur.kind === "actual"` で、移動先の開始が今より後なら `error: "実績は、今より後の時間には動かせません"` を返し、種別を予定に戻す行を消す。
  - `addActual(data, taskId, slot, now)`: タスクの有無、開始が今より後（`startsLater(slot, now)` → `まだ始まっていない時間には実績を入れられません`）、`check(..., "actual")` の順に確かめる。
  - `sessionKind` と `actualSlots` を上のとおりにする。`confirmSession` を消す。
  - `schema.js` の重なり検査: `byDay` の総当たりで、`list[i].kind === list[j].kind` のときだけ `err`（予定と実績の組は、重なってよい）。
- [ ] **Step 4: テストを実行し、通ることを確かめる** — `node --test tests/sessions.test.js tests/schema.test.js` → PASS。`schema.test.js` に「予定と実績が同じ時間にあっても error にならない」「実績どうしの重なりは error」を足してから実行する。
- [ ] **Step 5: コミット** — `git add plugins/project-lens/src/core tests && git commit -m "feat: 実績の枠を予定と別の枠にし、未確認の判定を実績の有無にする"`

---

### Task 2: 会議の実績（`actual`）

**Files:**
- Modify: `plugins/project-lens/src/core/schedule.js`（`confirmMeeting` を `setMeetingActual` に置き換え、`updateMeeting`・`syncMcpEvents` で日時が変わったとき `actual` も外す）
- Modify: `plugins/project-lens/src/core/schema.js:177-184`（会議の `actual` の検査）
- Test: `tests/schedule.test.js`、`tests/calendar.test.js`、`tests/schema.test.js`

**Interfaces:**
- Produces:
  - `meetingActualSpan(m): {start, end}` — `m.actual ?? { start: m.start, end: m.end }`。
  - `setMeetingActual(data, id, { start, end }, now): data` — 例外で失敗を伝える。`skip` の会議は `参加しない会議は実績にできません`。会議の開始が今より後なら `未来の会議は実績にできません`。`start`・`end` が `HH:MM` でない、または終了が開始以前なら、既存の `assertTimes` と同じ文言。成功時は `confirmed: true` と `actual: { start, end }` を書く。
  - `confirmMeeting` は削除する。`meetingKind` は変えない。

- [ ] **Step 1: 失敗するテストを書く**
  - `setMeetingActual: 予定と違う時刻の実績を書き、confirmed を true にする`（`actual` が `{start:"10:05", end:"10:50"}`）。
  - `setMeetingActual: skip・未来・時刻の不正は例外`（文言は上のとおり）。
  - `meetingActualSpan: actual が無ければ予定の時刻`、`actual があればそれ`。
  - `updateMeeting: 日時を動かすと confirmed と actual が外れる`（手入力の会議）。`syncMcpEvents`: 予定表で日時が変わった確認済みの会議も、`actual` が外れる（`tests/calendar.test.js`）。
  - `validate: 会議の actual の形式が不正（時刻でない・開始が終了以前）は error`、正しければ通る。
- [ ] **Step 2: テストを実行し、失敗を確かめる** — `node --test tests/schedule.test.js tests/calendar.test.js tests/schema.test.js` → FAIL。
- [ ] **Step 3: 実装** — 上のシグネチャで `schedule.js` を直す。`updateMeeting` の `next.confirmed = false` の行は、`next.actual` も消す（`delete next.actual`）。`syncMcpEvents` の `moved && e.confirmed ? { confirmed: false }` は、`actual` も外す。`updateMeeting` の許す項目に `actual` は足さない（実績の書き込みは `setMeetingActual` だけ）。`schema.js` の会議の検査に、`e.actual != null` のとき `isTime(start)`・`isTime(end)`・`toMin(end) > toMin(start)` を `err` で足す。
- [ ] **Step 4: テストを実行し、通ることを確かめる** — 同じコマンド → PASS（`confirmMeeting` を使う既存テストは `setMeetingActual` に置き換えてある）。
- [ ] **Step 5: コミット** — `git commit -m "feat: 会議の実績（actual）を持てるようにする"`

---

### Task 3: 稼働の集計

**Files:**
- Modify: `plugins/project-lens/src/core/workload.js`
- Test: `tests/workload.test.js`

**Interfaces:**
- Consumes: Task 1 の `sessionKind(s, now, actuals)`・`actualSlots`、Task 2 の `meetingActualSpan`。
- Produces: `workload(data, range, now)`・`projectHours(data, projectId)` のシグネチャは変えない。

- [ ] **Step 1: 失敗するテストを書く**（`tests/workload.test.js`）
  - `workload: 確認済みの会議は actual の時間で数える`（予定 1 時間・実績 10:05–10:50 → 0.75 時間）。
  - `workload: confirmed だけで actual の無い会議は、予定の時間で数える`（今までと同じ。アンチゴール）。
  - `workload: unconfirmed は、重なる実績の無い過ぎた予定の枠と、過ぎた会議の件数`: 予定の枠 2 つのうち 1 つに実績が重なる → `unconfirmedTasks` は 1。
- [ ] **Step 2: 実行して失敗を確かめる** — `node --test tests/workload.test.js` → FAIL。
- [ ] **Step 3: 実装** — `countedMeetings` が返す会議の時間を、`hours(meetingActualSpan(m))` で数える（`hours` は `start`・`end` を持つ値を受ける）。`unconfirmedTasks` の判定は `sessionKind(s, now, actualSlots(data))`。
- [ ] **Step 4: 実行して通ることを確かめる** — PASS。
- [ ] **Step 5: コミット** — `git commit -m "feat: 稼働を会議の実績時間と、実績の有無による未確認で数える"`

---

### Task 4: 実績を保存する編集（状態の更新つき）

**Files:**
- Modify: `plugins/project-lens/src/ui/edit.js:376-388`（`confirmTodaySession` を `recordActual` に置き換える）
- Test: `tests/edit.test.js:637-662`（`confirmTodaySession` のテストを置き換える）

**Interfaces:**
- Consumes: Task 1 の `addActual`。既存の `updateTask`。
- Produces: `recordActual(data, taskId, slot, now): { data, taskId, statusChanged: boolean, from: string }` — `addActual` の `error` は `throw new Error(error)`。タスクが `To Do`・`Waiting` なら `In Progress` にする（`updateTask(r.data, taskId, { status: "In Progress" }, now.date)`。Waiting の待ち先は `updateTask` の規則で外れる）。`Done`・`Cancelled` のタスクは、状態を変えない。

- [ ] **Step 1: 失敗するテストを書く** — 既存の 3 つ（To Do → In Progress と `statusChanged`、Waiting → 待ち先が外れ `from: "Waiting"`、重なり・開始が未来・存在しない ID は例外でデータが変わらない）を、`recordActual(d, taskId, {date,start,end}, now)` で書き直す。`In Progress` のタスクは `statusChanged: false`。
- [ ] **Step 2: 実行して失敗を確かめる** — `node --test tests/edit.test.js` → FAIL。
- [ ] **Step 3: 実装** — `recordActual` を足し、`confirmTodaySession` を消す。使われなくなった import（`confirmSession`）も消す。
- [ ] **Step 4: 実行して通ることを確かめる** — PASS。
- [ ] **Step 5: コミット** — `git commit -m "feat: 実績を保存する編集（recordActual）を足す"`

---

### Task 5: 予定表の取り込みで、今日より前の会議を落とす

**Files:**
- Modify: `plugins/project-lens/src/import/calendar.js:56-`（`planCalendarSync`・`planAutoSync`）
- Modify: `plugins/project-lens/skills/intake/SKILL.md:86`（期間の説明に「今日より前の会議は取り込みません」を足す）
- Test: `tests/calendar.test.js`、`tests/intake-cli.test.js`

**Interfaces:**
- Produces: `planCalendarSync(data, fetchedRaw, range, cfg, today = nowLocal().date)`。`planAutoSync` は、すでにある `now` の `now.date` を渡す。`tools/intake.js` の `calendar-plan`・`calendar-apply` は、既定の `today`（実行した日）を使う。

- [ ] **Step 1: 失敗するテストを書く**（`tests/calendar.test.js`）
  - `planCalendarSync: today より前の会議は追加しない`（`today = "2026-10-20"`、取得に 10/19 と 10/20 → `added` は 10/20 の 1 件。`valid` も 1）。
  - `planCalendarSync: 取り込み済みの過去の会議は、取得に無くても消えない`（10/19 の取り込み済みの会議が、`removed` に出ない）。
  - `planCalendarSync: 当日のすでに終わった会議は取り込む`。
  - `planAutoSync` でも同じ（`now.date` を使う）。
  - 既存の 7 か所の `planCalendarSync(` と `planAutoSync(` の呼び出しは、固定日付のテストデータで動くよう、`today` を `"2026-10-19"` で渡す。`tests/intake-cli.test.js` は実行日が入るので、`calendar-*` の日付を `today()`（`core/dates.js`）から作る相対日付に直す。
- [ ] **Step 2: 実行して失敗を確かめる** — `node --test tests/calendar.test.js` → FAIL。
- [ ] **Step 3: 実装** — `planCalendarSync` の先頭で、`range` の開始を `max(range.start, today)` にし、`checkFetched` の後で `ok` から `date < today` の項目を除く。`valid` は除いた後の件数。
- [ ] **Step 4: 実行して通ることを確かめる** — `node --test tests/calendar.test.js tests/intake-cli.test.js` → PASS。
- [ ] **Step 5: コミット** — `git commit -m "feat: 予定表の取り込みで、今日より前の会議を落とす"`

---

### Task 6: 画面（ボタンの廃止と、実績の入力欄）

**Files:**
- Modify: `plugins/project-lens/src/ui/views/schedule.js`（`sessionBlocks`・`meetingBlocks`・`meetingForm`・`renderSchedule`。`actualForm` を足す）
- Modify: `plugins/project-lens/src/ui/views/prio.js:14-20`（`slotHtml` から「実績にする」を消し、`sessionKind` に実績の一覧を渡す）
- Modify: `plugins/project-lens/src/ui/app.js`（状態 `S.actAdd`、ハンドラ、`[data-confirm]`・`[data-confirmmtg]`・`[data-confirmall]`・`[data-session-actual]` の処理と、`line 503`・`line 1122` の判定の更新）
- Test: `tests/views.test.js`、`tests/app-source.test.js`

**Interfaces:**
- Consumes: Task 1〜4 の関数。
- Produces（`views/schedule.js`）: `actualForm(data, ctx): string` — `ctx = { selSess, add, today, now }`。次のどちらかのとき、`<div class="actform" role="group" aria-label="実績の入力">` を返し、どちらでもなければ `""`。
  - 選択中の枠が、種別 `planned` で、開始が今より前（今も含む）: 入力は `data-ac="start"`・`data-ac="end"`（`<input type="time" step="900">`、初期値は枠の時刻）と、ボタン `data-actsave="<枠 ID>"`（文言「実績を保存」）。
  - `ctx.add` が真（`S.actAdd`）: タスクの選択 `data-ac="task"`（候補は Done・Cancelled 以外のタスク。選択肢の文言は件名）、日付 `data-ac="date"`、開始・終了、ボタン `data-actsave=""`（「実績を保存」）と `data-actcancel`（「キャンセル」）。
- Produces（会議）: `meetingForm` の選択中の会議（`mcp`・`manual` 両方）に、実績の開始・終了（`data-ma="start"`・`data-ma="end"`、初期値は `meetingActualSpan(m)`）とボタン `data-mtgact="<会議 ID>"`（「実績を保存」）を足す。`skip` の会議と、開始が今より後の会議には出さない。
- 工具列: `＋ 突発タスク` の隣に、ボタン `data-actadd`（「＋ 実績を追加」）。

- [ ] **Step 1: 失敗するテストを書く**（`tests/views.test.js`。ボタンの有無を見る既存の検査は、新しい規則に書き換える）
  - `renderSchedule` の HTML に、`data-confirm=`・`data-confirmmtg=`・`data-confirmall` を含まない（`views.test.js:286, 488-493, 537-543` を書き換え）。
  - 過ぎた予定の枠に、時間が重なる実績が無ければ `class` に `unconf` を含む。実績を足したデータでは含まない。
  - 予定の枠を選ぶ（`selSess`）と、`class="actform"` と、`data-ac="start"` の `value` が枠の開始、`data-actsave="S…"` を含む。実績の枠・未来の予定の枠を選ぶと、含まない。
  - `renderSchedule(..., { actAdd: true })` で、`data-ac="task"` の選択肢に Done のタスクが無い。
  - 選択中の会議に `data-ma="start"` と `data-mtgact`。`actual` のある会議は、その時刻が初期値。skip の会議には出ない。
  - `prio.js`: 「今日のタスク」の行に `data-session-actual`・「実績にする」を含まない（`views.test.js:722-752` を書き換え）。札（予定・実績・未確認）は今までどおり出る。
  - `tests/app-source.test.js:599-601, 668` の、`confirmTodaySession`・`data-confirmall` を探す検査を、`recordActual`・`setMeetingActual`・`data-actsave`・`data-mtgact` を使うハンドラの検査に置き換える。
- [ ] **Step 2: 実行して失敗を確かめる** — `node --test tests/views.test.js tests/app-source.test.js` → FAIL。
- [ ] **Step 3: 実装**
  - `views/schedule.js`: 上の Interfaces のとおり。`sessionBlocks`・`renderSchedule` は `sessionKind(s, now, actualSlots(data))` を使い、「実績にする」のボタンを消す。サマリーの `data-confirmall` のボタンを消し、「未確認 N 件」の札は残す。凡例は変えない。`renderSchedule` の `#mtgslot` に `actualForm(...)` を足す。
  - `views/prio.js`: `slotHtml(t, s, now, actuals)` にし、呼び出し元（同じファイルの `renderTodayTasks`）で `actualSlots(data)` を渡す。ボタンの行を消す。
  - `app.js`: ハンドラ `[data-actsave]`（`recordActual`。入力は `view.querySelector('[data-ac="start"]')` などから読む。成功したら `S.actAdd = null`・選択を外し、通知「`<件名>` の `<開始>–<終了>` の実績を入れました（状態を In Progress にしました）」）、`[data-actadd]`（`clearSel()` して `S.actAdd = { date: S.sdate }`）、`[data-actcancel]`、`[data-mtgact]`（`setMeetingActual`。通知「会議の実績を入れました」）を足す。`clearSel` は `S.actAdd = null` も外す。`[data-confirm]`・`[data-confirmmtg]`・`[data-confirmall]`・`[data-session-actual]` のハンドラと、使わなくなった import を消す。`line 503` の外クリック判定と `line 1122` の入力中判定に、`.actform`・`[data-actadd]`・`[data-actsave]`・`[data-mtgact]` を足す。
- [ ] **Step 4: 実行して通ることを確かめる** — `npm test` → PASS。
- [ ] **Step 5: コミット** — `git commit -m "feat: スケジュールから実績を入れる欄を足し、実績にするボタンを廃止する"`

---

### Task 7: サンプル・文書・ビルド・実機の確認

**Files:**
- Modify: `plugins/project-lens/data/sample.json`（予定と違う時刻の実績を持つ会議を 1 件足す）
- Modify: `docs/development.md`（「画面の動き > 今日のタスクとスケジュール」「会議と稼働」「設計判断」）、`docs/guide.md:177-187, 312, 351, 384`、`README.md:43`
- Modify: `plugins/project-lens/agents/intake-calendar.md:35`（言葉の確認。今日より前を取り込まないことを 1 文足す）
- Modify: `plugins/project-lens/assets/project-lens.html`（`npm run build`）

- [ ] **Step 1: `sample.json` に、会議を 1 件足す** — `confirmed: true` と `actual: { start: "10:05", end: "10:50" }`（予定は 10:00–11:00）。`node plugins/project-lens/tools/validate.js plugins/project-lens/data/sample.json` が通る。
- [ ] **Step 2: `development.md` を直す** — 対応する節に、次を書く。実績の枠は予定と別で、重なって置ける。未確認は「過ぎた予定で、重なる実績が無い」。会議の `actual`。取り込みは今日以降だけ。設計判断に 1 項目（なぜ、予定を書き換えず別の枠にしたか。見送った案: 予定の枠の書き換え、未確認の範囲を区切る設定）。「実績にする」・`confirmSession`・`confirmMeeting`・`confirmTodaySession`・`data-confirm` の語を、`grep -n` で 0 件にする。`guide.md`・`README.md` の画面の説明（「実績にする」を押す手順）も、新しい操作（予定の枠を選び、「実績を保存」）に直す。画像は、変えない（画像の説明文に「実績にする」があれば、文言だけ直し、画像の更新は「未確認」と書く）。
- [ ] **Step 3: ビルドとテスト** — `npm run build && npm test` → すべて PASS。`git diff --stat` で `assets/project-lens.html` が変わっていることを確かめる。
- [ ] **Step 4: 実機の確認（Chromium・Playwright、`?today=2026-10-20&time=10:15`、`sample.json` を `showOpenFilePicker` の差し替えで読み込む）** — 次を 1 回ずつ実行する。予定の枠を選ぶ → 初期値が予定の時刻 → 「実績を保存」で、実績の枠が予定と並ぶ。時刻を直して保存。「＋ 実績を追加」。会議を選び、実績を保存（稼働の時間が変わる）。実績の枠を選んで削除。確かめていない画面は、`development.md` に「未確認」と書く。
- [ ] **Step 5: コミット** — `git add -A && git commit -m "docs: 実績の入れ方の変更を文書とサンプルに反映する"`

---

## Self-Review の結果
- 設計書の各項目の担当: 作業枠 → Task 1・4・6、会議 → Task 2・6、取り込み → Task 5、稼働 → Task 3、検証・データ → Task 1・2・7、確かめること → 各 Task の Step 1 と Task 7。
- 設計書との違い（1 つ）: 設計書は、実績の枠どうしの重なりを「`validate` の warning」と書いた。今の `validate` は、枠どうしの重なりを `err`（保存を止める）にしている。この計画は、今の重さ（`err`）を変えず、同じ種別どうしだけに絞った。
- 設計書にない決め（私の判断）: 実績の枠は、休みの日にも置ける（事実の記録のため）。「今日のタスク」の行からは、実績を入れる操作をなくした（スケジュール画面で入れる）。
