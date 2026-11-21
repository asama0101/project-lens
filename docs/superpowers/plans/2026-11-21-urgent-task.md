# 突発タスクの素早い登録 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** スケジュール画面の日表示で空き時間を押し、件名を入れるだけで、タスクの追加と今日の作業枠の配置を 1 操作で行う。そのために、タスクの「プロジェクトなし」（`projectId: null`）を許す。

**Architecture:** 登録は、`edit.js` の純関数 `addUrgentTask`（タスク作成 + `sessions.js` の `addSession`）に集め、画面（`app.js`・`schedule.js`）は入力欄の開閉と呼び出しだけを持つ。「プロジェクトなし」は、検証・ID 採番・稼働・各画面の表示を、`projectId === null` の分岐で受ける。

**Tech Stack:** プレーンな JavaScript（ES modules、Node.js 24 以上）、`node --test`。ビルドは `npm run build`（`assets/task-trail.html` を作る）。

**Spec:** `docs/spec-grill/specs/2026-11-21-urgent-task-design.md`（図: 同名の `.svg`）。実行する人は、先にこれを読む。

## Global Constraints

- Windows 専用。`npm test` と `npm run build` を使う。`plugins/task-trail/src/` を変えたら、`npm run build` を実行して `assets/task-trail.html` をコミットする（古いと `npm test` が失敗する）。
- ブランチは `feat/urgent-task`（作成済み）。コミットは Conventional Commits（type は英語、説明は日本語）。PR の本文に、「`development.md`: 直した節の名前」を書く。マージはユーザー（`gh pr merge <番号> --squash` を案内する）。
- 既存のコードのスタイル（不変更新、日本語のコメント、`esc()` での出力）に合わせる。隣接コードを整えない。
- プロジェクトなしのタスクの ID は、固定の接頭辞 `X` + 連番（`X1`, `X2`…）。既存の ID・変更履歴の ID と重ならない番号を使う。
- 長さは 15・30・45・60 分から選ぶ。初期値 30 分。期限・開始日は押した日。状態は `In Progress`。大項目・中項目・重要度・メモは空。
- 付け替えで ID は変えない。大項目・中項目は空にし、付け替え先の最後に入れる。前のタスクまたは次のタスクがあるタスクは付け替えない。
- 並び替え、前のタスク（プロジェクトなしのタスクへ）、週表示からの登録、依頼（inbox）の `addTask`・`moveDue`、WBS の取り込みの対応は作らない。
- 動作確認をしていないことは、`development.md` に「未確認」と書く。

## Review Focus

- 件名が空のまま確定: 何も作らず、入力欄が残る。
- 空きより長い・会議と重なる長さ: 警告を出して置く。タスクと枠は作られる。
- 枠が置けない（他の枠と重なる・勤務時間の外）: タスクも作られない（`addSession` の `error`）。
- 日本語入力の変換確定の Enter: 確定しない。
- 既存の `X` で始まる ID を持つプロジェクトがある、または `X1` が変更履歴にある: 重ならない番号になる。
- 付け替えの途中でエラー: データが変わらない（不変更新）。
- プロジェクトなしのタスクだけがあるデータ（`projects` が空）: 各画面が例外を出さない。

---

### Task 1: 検証と ID 採番がプロジェクトなしを許す

**Files:**
- Modify: `plugins/task-trail/src/core/schema.js:113`（`projectId` の検証）
- Modify: `plugins/task-trail/src/ui/edit.js:310-324`（`nextTaskId`・`newTask`）
- Modify: `plugins/task-trail/data/sample.json`（プロジェクトなしのタスクを 1 件）
- Test: `tests/schema.test.js`, `tests/edit.test.js`

**Interfaces:**
- Produces: `validate(data)` が、`projectId: null` のタスクを error にしない（`undefined` や、存在しない文字列は、今までどおり error）。`edit.js` の `export function nextTaskId(data, projectId: string | null) -> string`（`null` なら `X` + 連番）と、内部関数 `newTask(data, projectId: string | null, title, due, extra)`。後続の Task が使う。

- [ ] **Step 1: 失敗するテストを書く**
  - `tests/schema.test.js`: `validate` が、`projectId: null` のタスクで `errors` が空。`projectId: "ZZ"`（存在しない）は error のまま。
  - `tests/edit.test.js`: `nextTaskId(data, null)` が `"X1"`。`X1` が既にあれば `"X2"`。変更履歴 `changeLog[].taskIds` に `X1` があれば `"X2"`。
- [ ] **Step 2: テストが失敗することを確認する** — `node --test tests/schema.test.js tests/edit.test.js`。FAIL。
- [ ] **Step 3: 実装する** — `schema.js:113` は `t.projectId != null && !projectIds.has(t.projectId)` のときだけ error にする。`nextTaskId`・`newTask` は、`projectId` が `null` のとき、接頭辞を `"X"` にする（`idNumber` に渡す接頭辞を `projectId ?? "X"` にし、`newTask` の `projectId` は `null` のまま保存する）。`nextTaskId` を export する。
- [ ] **Step 4: `sample.json` に、プロジェクトなしのタスク `X1`（`projectId: null`、状態 `In Progress`、期限・開始は日付、`sessions` は過去の実績 1 件）を足す。**
- [ ] **Step 5: テストが通ることを確認する** — `npm test`。`sample.json` の変更で壊れた既存の期待値は、新しいタスクの分だけ直す。
- [ ] **Step 6: コミット** — `feat: タスクのプロジェクトなしを許す（検証・ID 採番・サンプル）`

---

### Task 2: 稼働・依頼・取り込みが、プロジェクトなしで落ちない

**Files:**
- Modify: `plugins/task-trail/src/core/workload.js:26-42`（`workload`）
- Modify: `plugins/task-trail/src/ui/views/workload.js:27-36`（行名・タスク列）
- Check（落ちるときだけ直す）: `core/impact.js`, `core/inbox.js`, `ui/inboxops.js`, `core/rules.js`, `import/wbs.js`, `tools/intake.js`
- Test: `tests/workload.test.js`, `tests/workload-view.test.js`, `tests/inboxops.test.js`

**Interfaces:**
- Consumes: Task 1 の `projectId: null` のタスク。
- Produces: `workload(data, range, now)` の戻り値の `unassigned` を、`{ task: number, meeting: number }`（時間 h）に変える。`total` は、`rows` の合計 + `unassigned.task` + `unassigned.meeting`。`ui/views/workload.js` の表は、`unassigned` の行名を「プロジェクト未設定」にし、タスク列に `unassigned.task`、会議列に `unassigned.meeting`、合計列にその和を出す。

- [ ] **Step 1: 失敗するテストを書く**
  - `tests/workload.test.js`: 過去の実績 30 分の枠を持つ `projectId: null` のタスク 1 件で、`workload(d, range).unassigned` が `{ task: 0.5, meeting: 0 }`。予定の枠（`kind: "planned"`）は数えない。既存の「`unassigned` は会議」のテストは、新しい形（`unassigned.meeting`）に直す。
  - `tests/workload-view.test.js`: 描画した HTML に「プロジェクト未設定」の行があり、「プロジェクト未設定の会議」の文字がない。タスク列に `0.5` が出る。
  - `tests/inboxops.test.js`: プロジェクトなしのタスクを含むデータで、`moveDue` の変更案づくりと承認が、例外を出さない。そのタスクは対象にならない。
- [ ] **Step 2: 失敗を確認する** — `node --test tests/workload.test.js tests/workload-view.test.js tests/inboxops.test.js`。
- [ ] **Step 3: `workload` を実装する** — `data.projects` に無い `projectId`（`null`・存在しない）の実績の枠を、`unassigned.task` に足す。会議は今までどおり `unassigned.meeting`。`ui/views/workload.js` を、上の形に合わせて直す。
- [ ] **Step 4: 落ちる箇所を直す** — `npm test` を実行し、プロジェクトなしのタスク（Task 1 の `sample.json`）で落ちる原因を、`projectId` を使う箇所で、`null` を「対象外」として扱って直す。進捗率・期限超過・遅延・マイルストーンは、今の `data.tasks.filter((t) => t.projectId === p.id)` のままで、プロジェクトなしのタスクを含まない（直さない）。
- [ ] **Step 5: テストが通ることを確認する** — `npm test`。
- [ ] **Step 6: コミット** — `feat: 稼働にプロジェクトなしのタスクを含め、依頼・取り込みが落ちないようにする`

---

### Task 3: `addUrgentTask`（タスクと枠を 1 操作で作る）

**Files:**
- Modify: `plugins/task-trail/src/ui/edit.js`（`addTaskQuick` の近くに追加。`sessions.js` の `addSession` を import）
- Test: `tests/edit.test.js`

**Interfaces:**
- Consumes: Task 1 の `newTask`、`sessions.js` の `addSession(data, taskId, slot, now) -> { data, error?, warning? }`、`dates.js` の `toMin`・`toHHMM`。
- Produces: `export function addUrgentTask(data, { title: string, projectId: string | null, date: string, start: string, minutes: number }, now: { date: string, time: string }) -> { data, id: string, warning?: string }`。件名が空、`projectId` が不明、または `addSession` が `error` を返すときは、`Error` を投げる（データは変わらない）。

- [ ] **Step 1: 失敗するテストを書く（`tests/edit.test.js`）**
  - 件名だけ・`projectId: null`・`date: "2026-10-20"`・`start: "13:00"`・`minutes: 30`・`now` が `2026-10-20 12:00` のとき、`data.tasks` に `id: "X1"`・`projectId: null`・`due` と `start` が `"2026-10-20"`・`status: "In Progress"` のタスクができ、その `sessions` に `{ date: "2026-10-20", start: "13:00", end: "13:30", kind: "planned" }` が 1 件（`id` は `S` + 連番）。
  - `now.time` が `14:00`（枠が過去）のとき、`kind` が `"actual"`。
  - 会議と重なる枠で、戻り値に `warning` があり、タスクと枠は作られる。
  - 他の枠と重なる枠で `Error` が投げられ、`data.tasks.length` が変わらない。
  - 件名が空白だけで `Error`（「件名を入力してください」）。
  - `projectId: "A"` のときは、ID が既存の採番（`A` + 連番）。
- [ ] **Step 2: 失敗を確認する** — `node --test tests/edit.test.js`。
- [ ] **Step 3: `addUrgentTask` を実装する** — 件名を `trim`。`newTask(data, projectId, title, date, { start: date, status: "In Progress" })` を `tasks` の末尾に足し、その `id` に `addSession`（`end` は `toHHMM(toMin(start) + minutes)`）。`error` があれば、元の `data` を捨てて `Error(error)`。
- [ ] **Step 4: 通ることを確認する** — `node --test tests/edit.test.js`。
- [ ] **Step 5: コミット** — `feat: 突発タスクをタスクと枠で 1 操作で作る addUrgentTask`

---

### Task 4: スケジュール画面の入力欄

**Files:**
- Modify: `plugins/task-trail/src/ui/views/schedule.js`（入力欄の HTML。`renderSchedule` に `opts.urgentDraft` を足す。`:162` の戻り値で `meetingForm` の近くに出す）
- Modify: `plugins/task-trail/src/ui/app.js:539-550`（`[data-free]` のクリック）と、入力欄のイベント（既存の会議追加 `[data-mtgadd]`・`[data-mtgsave]`・`[data-mtgcancel]`、`:524-538` の近く）。欄外のクリックで下書きを外す処理（`:382-410` 付近）
- Test: `tests/views.test.js`, `tests/app-source.test.js`（既存の形式に合わせる）

**Interfaces:**
- Consumes: Task 3 の `addUrgentTask`。`schedule.js` の `snapStart(minutes, durationMin, workday)`。
- Produces: `S.urgentDraft: { date: string, start: string, title: string, projectId: string, minutes: number } | null`（`app.js` の状態。`projectId` は `""` が「プロジェクトなし」）。`renderSchedule` の `opts.urgentDraft` が非 null のとき、入力欄（件名・プロジェクトの選択欄（「プロジェクトなし」と既存のプロジェクト）・長さの選択欄（15・30・45・60）・確定ボタン `data-urgsave`・取り消しボタン `data-urgcancel`）を出す。

- [ ] **Step 1: 失敗するテストを書く（`tests/views.test.js`）** — `renderSchedule(data, today, { ..., urgentDraft: { date, start: "13:00", title: "", projectId: "", minutes: 30 } })` の HTML に、`data-urgsave`・`data-urgcancel`・プロジェクトの選択欄（`value=""` が選択済み）・長さの選択欄（`30` が選択済み、`15` `45` `60` がある）が含まれる。`urgentDraft` が null のときは含まれない。
- [ ] **Step 2: 失敗を確認する** — `node --test tests/views.test.js`。
- [ ] **Step 3: 入力欄を実装する（`schedule.js`）** — 既存の `meetingForm` の書き方（クラス・`aria-label`・`esc()`）に合わせる。
- [ ] **Step 4: `app.js` を実装する**
  - `[data-free]`: `S.picked` があれば、今までの動き（60 分の枠）のまま。なければ、`S.urgentDraft = { date: S.sdate, start: toHHMM(snapStart(+fr.dataset.free, 60, wd)), title: "", projectId: "", minutes: 30 }` にして `render()`（既存の「先にタスクを選んでください」は出さない）。
  - 確定（`data-urgsave`、または件名欄での Enter。`isComposing` のときは確定しない。`app.js:1016` の書き方に合わせる）: 件名が空なら何もしない（入力欄は残す）。`apply((d) => addUrgentTask(d, {...}, clock()).data, ...)` で保存し、成功したら `S.urgentDraft = null` にして `render()`。警告があれば通知に添える（`:548` と同じ書き方）。`Error` のときは通知だけにして、入力欄を残す。
  - 取り消し（`data-urgcancel`、Esc、入力欄の外のクリック）: `S.urgentDraft = null`。何も作らない。
- [ ] **Step 5: 通ることを確認する** — `npm test`。
- [ ] **Step 6: 実ブラウザで確認する** — `npm run build` のあと、`assets/task-trail.html` を Playwright で、`?today=2026-10-20&time=10:15` を付けて開く。日表示の空き時間を押す → 件名を入れて Enter → 枠が置かれ、右の列の「今日のタスク」に出る。Esc で閉じて何も作られない。`isComposing` を立てた `KeyboardEvent` の Enter で確定しない。確かめたことと、確かめていないこと（実際の IME・タッチ・実際のマウス）を、Task 7 で `development.md` に書く。
- [ ] **Step 7: コミット** — `feat: スケジュール画面の空き時間から、突発タスクを登録する入力欄を足す`

---

### Task 5: ガントチャート・リスト・今日の優先に、プロジェクトなしを出す

**Files:**
- Modify: `plugins/task-trail/src/ui/views/project.js:104-126`（`renderProjects`: 絞り込みの選択肢・「プロジェクトなし」の区切り）と、`renderList`（`:40`）
- Modify: `plugins/task-trail/src/ui/views/gantt.js:61`（`renderGantt`）
- Modify: `plugins/task-trail/src/ui/views/prio.js:45,67`（プロジェクト名の欄）
- Modify: `plugins/task-trail/src/ui/app.js`（`S.filter` が `"none"` のときの扱い。`data-filter`・`data-projectpick`）
- Test: `tests/views.test.js`, `tests/schedule.test.js`, `tests/metrics.test.js`

**Interfaces:**
- Consumes: Task 1 の `projectId: null` のタスク。
- Produces: 絞り込みの値 `"none"`（`opts.filter`）は「プロジェクトなし」を指す。`renderProjects` は、`filter` が `"all"` か `"none"` で、プロジェクトなしのタスクが 1 件以上あるとき、末尾に「プロジェクトなし」の区切り（リストでは `renderList` と同じ表、ガントでは同じ行）を出す。進捗率・期限超過・マイルストーン・稼働の見出しは出さない。

- [ ] **Step 1: 失敗するテストを書く**
  - `tests/views.test.js`: `renderProjects(d, today, { view: "list" })` の HTML に、`X1` の行と「プロジェクトなし」の見出しがあり、チップと選択欄に「プロジェクトなし」（`value="none"`）がある。`opts.filter: "A"` では `X1` が出ず、`"none"` では `X1` だけが出る。`view: "gantt"` でも `X1` の行が出る。`projects` が空でプロジェクトなしのタスクだけがあるデータでも、例外が出ず `X1` が出る。
  - `renderPrio`・`renderTodayTasks` が、`X1` のプロジェクト名の欄に「プロジェクトなし」を出す。`tests/schedule.test.js`: `rankTasks` の順位に `X1` が含まれる。
  - `tests/metrics.test.js`: `projectProgress(d, "A")`・`projectFlags` の数に、`X1` が入らない。
- [ ] **Step 2: 失敗を確認する** — `node --test tests/views.test.js tests/schedule.test.js tests/metrics.test.js`。
- [ ] **Step 3: 実装する** — `renderProjects` の `filter` の検証に `"none"` を通す。プロジェクトがない（`data.projects` が空）データでも、プロジェクトなしのタスクがあれば、先頭の「プロジェクトがありません」の分岐を通らない。`renderList` は、表の部分をプロジェクトの見出しなしで再利用できる最小の分け方で直す。`prio.js` の 2 か所は、`t.projectId == null` のときだけ「プロジェクトなし」を出す。
- [ ] **Step 4: 通ることを確認する** — `npm test`。
- [ ] **Step 5: コミット** — `feat: ガントチャート・リスト・今日の優先に、プロジェクトなしのタスクを出す`

---

### Task 6: プロジェクトの付け替え

**Files:**
- Modify: `plugins/task-trail/src/ui/edit.js`（`moveToProject` を追加）
- Modify: `plugins/task-trail/src/ui/views/taskpop.js:36-42`（編集の窓に、プロジェクトの選択欄）
- Modify: `plugins/task-trail/src/ui/app.js:720-732`（`data-f` の変更ハンドラに `projectId` を足す）
- Test: `tests/edit.test.js`, `tests/views.test.js`

**Interfaces:**
- Consumes: Task 1 の `projectId: null`。
- Produces: `export function moveToProject(data, taskId: string, projectId: string | null) -> data`。タスクがない、`projectId` が不明（`null` 以外で `data.projects` に無い）、`predecessors` が空でない、または他のタスクの前のタスクに指されている、のときは `Error`（前後があるときの文言は「前のタスク・次のタスクがあるため付け替えられません。先に外してください」）。成功すると、`projectId` を変え、`group`・`subgroup` を `null` にし、タスクを `data.tasks` の末尾に移す。ID は変えない。

- [ ] **Step 1: 失敗するテストを書く**
  - `tests/edit.test.js`: `X1`（`null`）→ `"A"` で、`projectId === "A"`、ID は `X1` のまま、`group`・`subgroup` が `null`、`data.tasks` の最後。`"A"` のタスク（前後なし）→ `"B"`、`"A"` → `null`。`A5`（`predecessors: ["A3"]`）と、他のタスクの前のタスクになっている `A3` は `Error` で、データが変わらない。不明な `projectId` で `Error`。
  - `tests/views.test.js`: `renderTaskPop` の HTML に、`data-f="projectId"` の選択欄があり、現在値が選択済み、「プロジェクトなし」（`value=""`）と全プロジェクトの選択肢がある。
- [ ] **Step 2: 失敗を確認する** — `node --test tests/edit.test.js tests/views.test.js`。
- [ ] **Step 3: `moveToProject` と選択欄を実装する** — `app.js` の `data-f` ハンドラは、`f === "projectId"` のとき、`updateTask` を経由せず `moveToProject(d, id, el.value || null)` を呼ぶ。`Error` は、既存の `apply` の通知に出し、選択欄を元の値に戻す。
- [ ] **Step 4: 通ることを確認する** — `npm test`。
- [ ] **Step 5: コミット** — `feat: タスクのプロジェクトを付け替えられるようにする`

---

### Task 7: 文書・図・総合確認

**Files:**
- Modify: `docs/development.md`（設計判断、「優先順位」、「状態と進捗」、「画面の動き」の稼働・スケジュール・ガントとリスト、「HTML からの依頼」の対象外）
- Modify: `docs/flow.html`（変えた分岐があれば）
- Modify: `plugins/task-trail/assets/task-trail.html`（`npm run build` で作る）

- [ ] **Step 1: `development.md` を直す** — `CLAUDE.md` の「docs の更新方法」に従う。「設計判断」に、プロジェクトなしを許した理由（スケジュール画面だけで登録を終わらせるため）と、見送った案（「突発対応」の普通のプロジェクト: 変更は最小だが、利用者は大きさを知ったうえで選んだ。並び替え・前のタスク・依頼と WBS の対応: 頼まれていない）を、1 項目で書く。規則は現在形で書き、版番号・日付・経緯は書かない。Task 4 の実ブラウザ確認で、確かめたこと・確かめていないこと（実際の IME・タッチ・実際のマウス）を、「確認したこと」「未確認」に書く。
- [ ] **Step 2: 参照の確認** — 直した事実の旧い名前を探す。`grep -n "プロジェクト未設定の会議" docs/development.md` と `grep -rn "プロジェクト未設定の会議" README.md docs` が 0 件になるまで直す。
- [ ] **Step 3: `flow.html` を直す** — スケジュール画面の分岐（選択中のタスクがあるときの既存の動きと、入力欄が開くとき）を足す。変えた分岐を実行して確かめ、確かめていない箇所は「未確認」と書く。
- [ ] **Step 4: 総合確認** — `npm run build && npm test`。全部通る。Playwright で `assets/task-trail.html` を開き、ガントチャート・リスト・スケジュール・稼働・設定の各画面で、コンソールのエラーが出ないことを確かめる。
- [ ] **Step 5: コミットして push し、PR を作る** — `feat: 突発タスクをスケジュール画面から素早く登録する`。PR の本文に「`development.md`: 直した節の名前」を書く。マージはユーザー。
