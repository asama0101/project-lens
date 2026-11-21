# 日々の業務支援の強化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画面での期限変更を履歴に残し、`Waiting` に回答予定日を持たせ、完了で次回を作る定例タスクを足す。

**Architecture:** 3 つとも、`edit.js` の純関数（data → data）と `core/` の算出を足し、`app.js` の既存の `apply` の流れに載せる。データの形は任意項目の追加だけで、`version: 1` のまま。

**Tech Stack:** 素の ES モジュール（Node.js 24・`node --test`）。画面は `src/ui` を `npm run build` で 1 枚の HTML にまとめる。

**Spec:** `docs/superpowers/specs/2026-11-19-daily-support-design.md`

## Global Constraints

- 外部パッケージを足さない。Windows 専用。
- 既存の `data.json`（`expected`・`repeat`・`source:"screen"` がない）が、変更前と同じく `validate` を通る。
- 変えた行は、依頼（このプラグインの 3 機能）まで直接たどれること。隣接コードを整えない。既存の書き方（日本語のコメント・`apply` 経由の保存）に合わせる。
- `src/` を変えたら `npm run build` を実行し、`plugins/task-trail/assets/task-trail.html` をコミットする（古いと `npm test` が失敗する）。
- 振る舞い・規則・設計判断を変えたら、`docs/development.md` の対応する節を同じ作業で直す。名前を変えたり消したりしたら、`grep -n "<旧名>" docs/development.md` を 0 件にする。版番号・日付・経緯は書かない。確認していないことは「未確認」と書く。
- コミットは Conventional Commits（type は英語、説明は日本語）。末尾に `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`。ブランチは `feat/daily-support`（`docs/daily-support-design` から切る）。

## Review Focus

1. 同じ日に同じタスクの期限を動かして元に戻す → 履歴に残らない（Task 1）。
2. 開始日だけの変更、および `due` が変わらない保存 → 履歴に残らない（Task 1）。
3. `waitingOn.expected` が日付の形でない → `validate` が error。`Waiting` を外すと `expected` も消える（Task 2）。
4. 毎月 31 日指定 → 2 月は月末（うるう年は 29 日）。遅れて完了したら過ぎた周期を飛ばす（Task 3）。
5. `Done` → `To Do` → `Done` で次回が二重に作られない。`Cancelled` では作らない。チェックリストのないタスクに `checklist` キーを作らない（Task 3）。

---

### Task 1: 画面での期限変更を履歴に残す

**Files:**
- Modify: `plugins/task-trail/src/ui/edit.js`（関数を足す）、`plugins/task-trail/src/core/schema.js:231`（`source` の許可）、`plugins/task-trail/src/ui/app.js`（`:715` の期限の保存・`:971` のバーのドラッグ・原因の選択の `change`）、`plugins/task-trail/src/ui/views/project.js:70-72, 本文の注記`
- Test: `tests/due-log.test.js`（新規）

**Interfaces:**
- Produces（`edit.js`）:
  - `recordDueChanges(before: Data, after: Data, today?: string): Data` — `after` の各タスクの `due` を `before` と比べ、変わったタスクごとに `changeLog` を更新して返す。
  - `setLogCause(data: Data, key: { at: string, taskId: string }, cause: string | null): Data` — `source:"screen"` で `at` が一致し `taskIds` が `[taskId]` の行の `cause` を変える。行がなければ例外。`cause` は `CAUSES` のいずれかか `null`。

- [ ] **Step 1: 失敗するテストを書く** `tests/due-log.test.js`。サンプル（`data/sample.json` を読む。A3 の期限は `2026-10-16`）に対し、`TODAY = "2026-10-21"` で次を主張する。
  - `A3` の期限を `+3` した `after` で `recordDueChanges(before, after, TODAY)` → `changeLog` の末尾が `{ at: TODAY, taskIds: ["A3"], reason: "画面で期限を変更", cause: null, deltaDays: 3, source: "screen" }`。
  - その結果にもう `+2`（合計 `+5`）を適用して再度呼ぶ → `screen` の行は 1 件で `deltaDays === 5`。
  - さらに `-5` で元の期限へ戻して呼ぶ → `screen` の行が 0 件（元からあった行は残る）。
  - `start` だけを変えた `after` → `changeLog` は変わらない。`due` が同じ `after` → 同じオブジェクトの内容。
  - 別の日（`at` が違う）の `screen` の行があっても、新しい行を足す（まとめない）。
  - `setLogCause` で `"ベンダー"` を設定すると `cause` が変わり、`validate(result).errors` は空。不明な原因（`"x"`）と該当行なしは例外。
  - `validate` に `source:"screen"` の行を含むデータを渡して `errors` が空（`schema.js` の許可）。
- [ ] **Step 2: 実行して失敗を確認** `node --test tests/due-log.test.js` → 関数が未定義で FAIL。
- [ ] **Step 3: 実装** `edit.js` に上の 2 関数。差は `diffDays(after.due, before.due)`。合計が 0 のときは該当行を除く。`schema.js` の `["wbs","calendar","inbox"]` に `"screen"` を足す。
- [ ] **Step 4: 画面に配線** `app.js` で、画面の期限変更の 2 か所を `recordDueChanges` で包む: ① `data-f` の保存で `f === "due"` のとき `(d) => recordDueChanges(d, updateTask(d, id, { due: el.value }, today), today)`、② バーのドラッグの `dragEdit`（`kind === "t"`）。ガントの編集の窓の期限欄は①と同じ `data-f` の流れ。`project.js` の履歴の行は、`source === "screen"` のときだけ原因の `<select data-logcause="<at>|<taskId>">`（「—」＋`CAUSES`）を出し、`app.js` の `change` で `setLogCause` を `apply` する。履歴の注記の「画面で期限を直接変えたときは記録されません」を、画面の変更も記録される旨に直す。
- [ ] **Step 5: テストが通ることを確認** `npm test` → 全件 PASS（`app-source.test.js`・`views.test.js` を含む）。
- [ ] **Step 6: コミット** `git add tests/due-log.test.js plugins/task-trail/src && git commit -m "feat: 画面での期限変更を日程変更の履歴に残す"`

---

### Task 2: `Waiting` の回答予定日

**Files:**
- Modify: `plugins/task-trail/src/ui/edit.js:77-82`（`updateTask` の Waiting 節）、`plugins/task-trail/src/core/schema.js:118`、`plugins/task-trail/src/core/schedule.js:68-72`（`rankTasks`）、`plugins/task-trail/src/ui/app.js:713` の近く、`plugins/task-trail/src/ui/views/project.js:56`（待ち先の列）
- Test: `tests/waiting-expected.test.js`（新規）

**Interfaces:**
- Consumes: `updateTask(data, id, patch, today)`、`rankTasks(data, today)`。
- Produces: `waitingOn` の形が `{ party: string, since: string, expected?: string }` になる。`updateTask` の `patch.waitingOn.expected` に `"YYYY-MM-DD"` を渡すと保存、空文字・`null` で外す。

- [ ] **Step 1: 失敗するテストを書く**。`rankTasks` は `data = { tasks: [{ id: "X1", projectId: "X", title: "t", due: "2026-10-26", status: "Waiting", predecessors: [], waitingOn: { party: "ベンダーX", since: "2026-10-10", expected: "2026-10-19" } }] }`、`today = "2026-10-21"` で、`score === 77.5`（37.5 ＋ 40）、`reasons` が `回答予定日を過ぎています（2日）` を含み、`action === "chase"`、先頭の理由が `ベンダーX への催促` で始まる。`expected` を `"2026-10-21"`（今日）にすると `score === 37.5`。`expected` なしも `37.5`。`updateTask`（サンプルのタスクで `status: "Waiting"`, `waitingOn: { party: "P", expected: "2026-10-30" }`）で `waitingOn.expected` が保存され、続けて `{ title: "x" }` だけの更新で保持され、`{ waitingOn: { party: "P", expected: "" } }` で消え、`{ status: "In Progress" }` で `waitingOn === null`。`expected: "10/30"` は例外（メッセージに「回答予定日」）。`validate` は、`expected: "bad"` の `waitingOn` に error を返す。
- [ ] **Step 2: 実行して失敗を確認** `node --test tests/waiting-expected.test.js` → FAIL。
- [ ] **Step 3: 実装** `updateTask` は `expected` を、`w` に `"expected"` があればそれ、なければ現在の値を使い、`isDate` でなければ「回答予定日は YYYY-MM-DD の形式で入力してください」で例外、空なら項目を付けない。`schema.js:118` の隣に `expected` の形式検査（error）。`rankTasks` は `expected < today` のとき +40、理由に `回答予定日を過ぎています（${diffDays(today, expected)}日）`、先頭の理由の「確認／催促」は `left < 0 || 予定日超過` なら「催促」。
- [ ] **Step 4: 画面に配線** `project.js` の待ち先の列に、`Waiting` のときだけ有効な `<input type="date" data-f="expected" data-id aria-label="… の回答予定日">` を足す。`app.js` の `data-f` の処理に `f === "expected"` を足し、`updateTask(d, id, { waitingOn: { party: t.waitingOn.party, since: t.waitingOn.since, expected: el.value } }, today)` を `apply` する。`taskpop.js` に待ち先の入力があるときだけ、同じ欄を足す（なければ足さない）。
- [ ] **Step 5: 通ることを確認** `npm test` → 全件 PASS。
- [ ] **Step 6: コミット** `git commit -m "feat: Waiting に回答予定日を持たせ、過ぎたら催促として優先に上げる"`（`git add` はテストと `src`）。

---

### Task 3: 定例タスク（完了で次回を作る）

**Files:**
- Create: `plugins/task-trail/src/core/repeat.js`
- Modify: `plugins/task-trail/src/ui/edit.js`（`updateTask` の `repeat`・`spawnNextRepeat`・`duplicateTask`）、`plugins/task-trail/src/core/schema.js`（`repeat` の検査）、`plugins/task-trail/src/ui/app.js:568`（`setStatus`）と `data-f="repeat"`・`data-dup` の処理、`plugins/task-trail/src/ui/views/taskpop.js`（繰り返しの選択と「複製」）、`plugins/task-trail/src/ui/views/project.js`（ID の欄に「↻」の印）
- Test: `tests/repeat.test.js`（新規）

**Interfaces:**
- Produces:
  - `core/repeat.js`: `nextRepeatDue(repeat: { unit: "week" } | { unit: "month", day: number }, due: string, today: string): string` — `due` より後で、`today` より後の最初の周期日。`week` は `due` に 7 日ずつ足す。`month` は `due` の翌月から、その月の `day`（月末を超えるときは月末）。
  - `edit.js`: `spawnNextRepeat(data: Data, taskId: string, today: string): Data`、`duplicateTask(data: Data, taskId: string, today: string): { data: Data, id: string }`。`updateTask` の `patch.repeat`（`{unit:"week"}`・`{unit:"month",day}`・`null`）。

- [ ] **Step 1: 失敗するテストを書く** `tests/repeat.test.js`。
  - `nextRepeatDue`: `week`・due `2026-10-16`・today `2026-10-14` → `2026-10-23`、today `2026-10-16` → `2026-10-23`、today `2026-10-30` → `2026-11-06`。`month day:31`・due `2026-01-31`・today `2026-01-31` → `2026-02-28`、due `2026-02-28`・today `2026-02-28` → `2026-03-31`、due `2026-01-31`・today `2026-04-02` → `2026-04-30`、due `2028-01-31`・today `2028-01-31` → `2028-02-29`。
  - `spawnNextRepeat`（サンプルの A5 に `repeat: {unit:"week"}`・チェックリスト 2 項目（1 つは `done: true`）・`importance: "high"`・`memo` を付け、`status: "Done"` にしたデータ）: タスクが 1 件増え、新しいタスクは `status: "To Do"`、`due` が `nextRepeatDue` の値、件名・`group`・`subgroup`・`importance`・`memo` が同じ、`repeat` が `{unit:"week"}`（`spawned` なし）、`checklist` が全項目 `done: false` で ID が `c1`・`c2`、`predecessors: []`・`waitingOn: null`・`sessions: []`・`start: null`・`doneAt: null`。元の `repeat.spawned` が新しい ID。続けてもう一度呼んでも件数は増えない。`status` が `Cancelled`・`repeat` なし・`Done` でないときは同じ内容を返す。チェックリストのないタスクの次回に `checklist` キーがない。新しいタスクの ID は `nextTaskId` と同じ規則で、`validate(result).errors` は空。
  - `updateTask`: `repeat: {unit:"week"}` が保存され、`null` で消える。`{unit:"month", day: 0}`・`{unit:"year"}` は例外。`validate` が同じ不正値を error にする。
  - `duplicateTask`: 件名・プロジェクト・`group`・`subgroup`・`importance`・`memo` が同じ、`due === today`、`status: "To Do"`、`repeat` なし、チェックリストは未チェック、`id` が元と違う。
- [ ] **Step 2: 実行して失敗を確認** `node --test tests/repeat.test.js` → FAIL。
- [ ] **Step 3: 実装** `repeat.js` は `dates.js` の `addDays` と `isDate` を使う。`edit.js` の `spawnNextRepeat` は同ファイルの `newTask`（`addTaskQuick` が使うもの）で作り、元のタスクの直後に挿入し、元の `repeat.spawned` を新しい ID にする。`spawned` の ID のタスクが残っていれば何もしない。`duplicateTask` も `newTask` を使う。`schema.js` は `repeat` の `unit` と `day`（整数 1〜31）と `spawned`（文字列）を検査する。
- [ ] **Step 4: 画面に配線** `app.js` の `setStatus`: `status === "Done"` のとき `updateTask` のあとに `spawnNextRepeat(next, id, clock().date)` を通し、作られたときは通知に `次回 ${新ID}（${期限}）を作りました` を足す。`data-f="repeat"` の `change`（`""`・`"week"`・`"month"`）は、`month` のとき `day` を期限の日付の日にして `updateTask` する。`data-dup` のクリックは `duplicateTask` を `apply` する。`taskpop.js` に「繰り返し」の選択（なし／毎週／毎月）と「複製」ボタン、`project.js` のリストの ID の欄に `repeat` があれば「↻」を出す。リストの列は増やさない（`colspan` が固定のため）。繰り返しの設定の入口は編集の窓だけになる。
- [ ] **Step 5: 通ることを確認** `npm test` → 全件 PASS。
- [ ] **Step 6: コミット** `git commit -m "feat: 完了で次回を作る定例タスクと、タスクの複製を追加"`

---

### Task 4: 文書・ビルド・確認

**Files:**
- Modify: `docs/development.md`（優先順位の表・状態と進捗・ガントチャートとリスト・設計判断）、`README.md`（機能の表または使い方に 1〜2 行）、`plugins/task-trail/assets/task-trail.html`（ビルドの生成物）
- Test: 既存の `npm test`

- [ ] **Step 1: `development.md` を直す** 優先順位の表に「回答予定日の超過 +40」を 1 行、状態と進捗に `waitingOn.expected` と `repeat`、ガントチャートとリストの「画面では前後を確認しない」の節に「期限の変更は `source:"screen"` で履歴に残す（同日・同タスクは 1 件にまとめ、合計 0 で消す）」を直す。設計判断に、次を 1 項目ずつ足す: 定例は「完了で次回を作る」（ひな形・会議連動は見送った理由）、履歴は「黙って記録して原因は後で選ぶ」（動かすたびに聞く案を見送った理由）。実ブラウザで確かめていない操作は「未確認」と書く。
- [ ] **Step 2: 旧文言が残っていないことを確認** `grep -n "記録されません" docs/development.md plugins/task-trail/src -r` → 0 件。
- [ ] **Step 3: ビルド** `npm run build` → `plugins/task-trail/assets/task-trail.html` が更新される。
- [ ] **Step 4: 全体のテスト** `npm test` → 全件 PASS（件数は 704 以上）。
- [ ] **Step 5: 画面の確認** `?today=2026-10-20` を付けて `--sample` のデータで開き、期限のドラッグ→履歴に行が出て原因を選べること、`Waiting` の回答予定日が過去だと「今日の優先」に上がること、`repeat` を付けたタスクを「完了」にすると次回ができることを目で確かめる。確かめられなかった項目は、報告に「未確認」と書く。
- [ ] **Step 6: コミット** `git add docs README.md plugins/task-trail/assets && git commit -m "docs: 日々の業務支援の 3 機能を文書に反映し、画面をビルド"`
- [ ] **Step 7: PR の本文** に「`development.md`: 直した節の名前」を書く（CLAUDE.md の規則）。
