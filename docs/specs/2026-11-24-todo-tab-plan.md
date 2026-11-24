# ToDo タブ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 日・週の ToDo を管理する「ToDo」タブ（2 列。週の見返しつき）を足し、ToDo の予定・実績の時間を、スケジュール画面の枠と同じ仕組みで持つ。

**Architecture:** ToDo は個人ファイル（`personal.json`）の `todos`（と `reviews`）に置き、結合したデータでは `data.todos`・`data.reviews` になる。作業枠は、タスクの `sessions` と同じく、ToDo の `sessions` に戻す（`taskId` に ToDo の ID を入れる）。判断は純関数（`core/todos.js`）、画面は `ui/views/todo.js`、結線は `ui/app.js`。

**Tech Stack:** Node.js 24（ESM）、`node --test`、素の HTML／JS（`npm run build`）。

**Spec:** `docs/specs/2026-11-24-todo-tab-design.md`（土台: `docs/specs/2026-11-24-actuals-input-design.md`）

## Global Constraints
- Windows 専用、Node 24 以上。`plugins/project-lens/src/` を変えたら `npm run build` して `plugins/project-lens/assets/project-lens.html` をコミットする（古いと `npm test` が失敗する）。新しい .js は `tools/build.js` の `MODULES` に、依存の後ろへ入れる（`core/todos.js` は `core/sessions.js` の後、`ui/views/todo.js` は `ui/views/schedule.js` の後）。export 名は、全モジュールで重複させない。
- ToDo は個人ファイルだけに書く。共有ファイル（`data.json`）の形は変えない。`todos` と `reviews` は、空のときは個人ファイルに書かない（ToDo を使わない利用者のファイルを変えない）。
- 画面に ID（`T-0001`）を出さない。件名で言う。文言は日本語。`esc()` で必ずエスケープする。
- 既存のタスク・作業枠・稼働の数字を変えない（`npm test` の既存のテストが、そのまま通る）。
- ToDo を、ガント・リスト・今日の優先・今日のタスクに出さない。
- 既存のコードのスタイル（1 行の関数、日本語のコメント）に合わせる。関係のない箇所は直さない。
- 変更の PR 本文に「`development.md`: 直した節の名前」を書く。ブランチは `feat/todo-tab`（`docs/todo-tab-design` から切り替える）。

## Review Focus
- 個人ファイルに ToDo が 1 件も無い（`todos` なし）ときの読み込み・保存が、今までと同じ（保存してもファイルの中身が変わらない）。
- ToDo の枠が、孤立した枠の警告になる・共有ファイルのタスクの枠に混ざる、ということが起きない（`mergeData` の振り分け）。
- 日の ToDo を、休みの日をまたいで「明日へ回す」（金曜 → 月曜）。完了した ToDo は回せない。
- 週の ToDo を消しても、割り当てた日の ToDo と、その実績が残る。ToDo を消すと、その枠も消える。
- 見返しの「完了 X / Y 件」で、X が Y を超えない。割り当てた日の ToDo を数えない。
- ToDo の件名に `<`・`&` が入っていても、画面が崩れない。

---

### Task 1: データの持ち方（個人ファイルの `todos`・`reviews`）

**Files:**
- Modify: `plugins/project-lens/src/core/split.js`（`splitData`・`mergeData`・`emptyPersonal`・`checkPersonalShape`）
- Modify: `plugins/project-lens/src/core/schema.js`（`validate` に ToDo の検査を足す）
- Modify: `plugins/project-lens/data/sample.json`（ToDo を数件足す）
- Test: `tests/split.test.js`、`tests/schema.test.js`

**Interfaces:**
- Produces（結合したデータ）: `data.todos: Todo[]`（常に配列。なければ `[]`）、`data.reviews: { [月曜日の日付]: string }`（常にオブジェクト。なければ `{}`）。`Todo = { id, scope: "week"|"day", title, date, parentId?, doneAt: string|null, checklist?: {id,text,done}[], carried: number, sessions: Session[] }`。
- 個人ファイル: `todos`（`sessions` を除いた項目）、`reviews`、`sessions`（今までの平らな配列。ToDo の枠は `taskId` に ToDo の ID）。

- [ ] **Step 1: 失敗するテストを書く**
  - `tests/split.test.js`: `splitData: ToDo の枠は、taskId つきで個人の sessions に入り、todos には sessions が入らない`。`splitData: todos が空・reviews が空なら、個人ファイルに todos・reviews のキーを書かない`。`mergeData: taskId が ToDo の ID の枠は、その ToDo の sessions に戻り、orphanSessions にならない`。`mergeData: 共有のタスクの枠は、今までどおりタスクへ`。`mergeData: todos・reviews が個人ファイルに無いとき、data.todos は []・data.reviews は {}`。ラウンドトリップ（`mergeData(...splitData(d))` が `d` と深く等しい）を、ToDo ありの例で。`checkPersonalShape`: `todos` が配列でなければ例外（あるときだけ）。
  - `tests/schema.test.js`: `validate: 正しい ToDo は通る`。次は error: `scope` が `week`・`day` でない、`title` が空、`date` が日付でない、`scope: "week"` の `date` が月曜日でない、`parentId` が存在しない、`parentId` を `scope: "week"` の ToDo が持つ、`parentId` の指す ToDo が `scope: "week"` でない、`doneAt` が日付でない、`carried` が 0 以上の整数でない、`id` の重複（`T-0001` の形でないものも error）。`checklist` の形はタスクと同じ検査。ToDo の枠の検査（時刻の形式・`kind`・同じ種別どうしの重なり）は、タスクの枠と同じ規則で、ToDo どうし・タスクとの間でも判定する。
- [ ] **Step 2: 実行して失敗を確かめる** — `node --test tests/split.test.js tests/schema.test.js` → FAIL。
- [ ] **Step 3: 実装**
  - `splitData`: 分割代入で `todos`・`reviews` を取り出す（`rest` に入って共有ファイルへ行かないように）。ToDo の枠を、`sessions` に `{ ...s, taskId: todo.id }` で足す。個人ファイルには、`todos`（`sessions` を除く）を、配列が空でないときだけ、`reviews` を、キーがあるときだけ書く。
  - `mergeData`: `todos` の ID の集合を作り、`taskId` が ToDo の ID の枠は、その ToDo の `sessions` へ（共有のタスクの ID でも ToDo の ID でもなければ、今までどおり孤立）。戻りに `todos`・`reviews` を必ず含める。
  - `emptyPersonal` は変えない（空の `todos` は書かない方針）。`checkPersonalShape` に、`todos` があるとき配列であることの検査を足す。
  - `schema.js`: ToDo の検査を、タスクの検査の後ろに足す。枠の検査（`line 147` 付近の枠ごとの形、`line 163` 付近の重なり）は、タスクと ToDo の枠を合わせた一覧に対して行う。ToDo の枠に「完了なのに未来の予定枠」の警告は出さない（設計書: 完了しても未来の予定の枠は残す）。
  - `sample.json`: 週の ToDo 2 件（うち 1 件は `carried: 1`）、日の ToDo 2 件（1 件は週の ToDo の `parentId` つき）、実績の枠 1 件、`reviews` 1 件を足す。`node tools/validate.js` 相当（`validate(sample)` が `errors: []`）が通る。
- [ ] **Step 4: 実行して通ることを確かめる** — 同じコマンド → PASS。`npm test` 全体も PASS（`sample.json` の件数を数えるテストがあれば、期待値を直す）。
- [ ] **Step 5: コミット** — `git commit -m "feat: 個人ファイルに ToDo と週の気づきを持てるようにする"`

---

### Task 2: 作業枠の持ち主を、ToDo にも広げる

**Files:**
- Modify: `plugins/project-lens/src/core/sessions.js`、`src/core/workload.js`、`src/ui/edit.js`（`recordActual`）、`src/ui/dnd.js`（`planDropAt`）、`src/ui/app.js`（`deleteSelected`・会議追加の重なり判定）、`src/ui/views/schedule.js`（`sessionBlocks`・`actualForm` の持ち主の引き方）
- Test: `tests/sessions.test.js`、`tests/workload.test.js`、`tests/edit.test.js`、`tests/dnd.test.js`、`tests/views.test.js`

**Interfaces:**
- Produces:
  - `allSessions(data): Array<Session & { taskId, title, projectId: string|null }>` — タスクと ToDo の全枠。ToDo の枠は、`taskId` が ToDo の ID、`title` が ToDo の件名、`projectId` が `null`。
  - `addSession`・`addActual`・`moveSession`・`resizeSession`・`removeSession` は、`taskId` に ToDo の ID も受ける。持ち主がどちらでもなければ、今までのエラー文（`タスク X がありません`）。
  - `recordActual(data, id, slot, now)`: 持ち主が ToDo のときは、状態を変えず、`statusChanged: false`・`from: ""` を返す。
- Consumes: Task 1 の `data.todos`。

- [ ] **Step 1: 失敗するテストを書く**
  - `sessions.test.js`: `allSessions: ToDo の枠も、taskId・title・projectId:null つきで返る`。`addSession・addActual: ToDo の ID に枠を足せる（todo.sessions に入る）`。`removeSession・moveSession・resizeSession は、ToDo の枠にも効く`。`sessionKind: ToDo の過ぎた予定で、重なる実績が無ければ unconfirmed`（`actualSlots` は ToDo の実績の枠も含む）。持ち主が無い ID は `タスク X がありません`。
  - `workload.test.js`: `workload: ToDo の実績の枠は「プロジェクト未設定」のタスクの列に入る`。`workload: ToDo の過ぎた予定の枠は、未確認の件数に入る`。既存の数字は変わらない。
  - `edit.test.js`: `recordActual: ToDo には、状態の変更がなく statusChanged が false`。
  - `dnd.test.js`: `planDropAt: ToDo のドラッグ（kind "task"）で予定の枠を置け、msg に ToDo の件名が入る`。
  - `views.test.js`: ToDo の枠のブロックは、件名だけを出し、状態の文字・重要の印を出さない（例外にならない）。選んだ ToDo の予定の枠（始まったもの）に、実績の入力欄が出る。
- [ ] **Step 2: 実行して失敗を確かめる** — `node --test tests/sessions.test.js tests/workload.test.js tests/edit.test.js tests/dnd.test.js tests/views.test.js` → FAIL。
- [ ] **Step 3: 実装**
  - `sessions.js`: 持ち主を引く小さな関数 `ownerOf(data, id): { list: "tasks"|"todos", item } | null` を足し（export 名は重複させない）、`addSession`・`addActual` の存在検査、`withTask`・`mapSessions`・`removeSession`・`check` の枠の一覧（`allSessions`）を、タスクと ToDo の両方を扱う形に直す。`taskActual`・`runningPlanned`・`futurePlanned` は、タスク専用のまま。
  - `workload.js`: 枠の一覧を `allSessions(data)` から作り、プロジェクトは枠の `projectId` を使う。
  - `edit.js`: `recordActual` の状態変更を、持ち主がタスクのときだけにする。
  - `dnd.js`・`app.js`・`views/schedule.js`: `data.tasks.find((t) => t.id === s.taskId)` で件名・タスクを引いている箇所を、`allSessions` の `title` と、タスクがあるときだけの状態・重要の印に直す。
- [ ] **Step 4: 実行して通ることを確かめる** — 同じコマンドと `npm test` → PASS（既存のテストの数字は変わらない）。
- [ ] **Step 5: コミット** — `git commit -m "feat: 作業枠の持ち主に ToDo を加える"`

---

### Task 3: ToDo の規則（純関数）

**Files:**
- Create: `plugins/project-lens/src/core/todos.js`
- Modify: `plugins/project-lens/tools/build.js`（`MODULES` に `src/core/todos.js` を `src/core/sessions.js` の後へ）
- Test: `tests/todos.test.js`（新規）

**Interfaces:**
- Consumes: Task 1・2 の `data.todos`・`allSessions`・`actualSlots`、`core/holidays.js` の `offDayChecker(settings)`、`core/dates.js` の `addDays`・`isDate`・`weekday`、`core/checklist.js` の `nextChecklistId`。
- Produces（すべて純関数。入力を変えず新しいデータを返し、不正なときは `throw new Error("日本語の理由")`）:
  - `mondayOf(date: string): string` — その日を含む週の月曜日。
  - `addTodo(data, { scope, title, date, parentId? }): { data, id }` — `scope: "week"` の `date` は月曜日に正規化する。ID は `T-` + 4 桁（`todos` の最大番号 + 1）。件名は前後の空白を除き、空なら例外。
  - `renameTodo(data, id, title): data` — 週の ToDo の件名を直すと、`parentId` がこの ToDo で、直す前の件名と同じ件名の日の ToDo も、新しい件名にする。
  - `setTodoDone(data, id, done: boolean, today: string): data` — `doneAt` を `today` か `null` に。
  - `deleteTodo(data, id): data` — その ToDo の枠ごと消す。週の ToDo なら、子の日の ToDo の `parentId` を外す。
  - `assignToDay(data, weekTodoId, date): { data, created: boolean }` — `scope: "week"` の ToDo だけ。同じ `parentId` で同じ `date` の日の ToDo があれば、`created: false`（データは変えない）。
  - `carryTodo(data, id): data` — 完了した ToDo は例外（`完了した ToDo は回せません`）。日: `date` を `offDayChecker(data.settings)` で休みでない次の日へ。週: `date` を +7 日。`carried` を +1。回す前の `date` にある、この ToDo の予定の枠（`kind: "planned"`）のうち、`actualSlots(data)` のどれとも時間が重ならないものを消す。
  - `addTodoCheck(data, id, text): data`・`toggleTodoCheck(data, id, itemId): data`・`removeTodoCheck(data, id, itemId): data` — 項目の形は `{ id, text, done }`（`id` は `nextChecklistId`）。空の文言は例外。
  - `setReview(data, weekStart, text): data` — 空文字なら、そのキーを消す。
  - `todoMinutes(data, id, range?: {start,end}): { planned: number, actual: number }` — その ToDo と、`parentId` がその ToDo の日の ToDo の枠の、`range` 内（省略は全期間）の分の合計。
  - `weekReview(data, weekStart): { done: number, total: number, planned: number, actual: number, note: string, rows: Array<{ todo, checked: {done,total}|null, planned, actual }> }` — `total` は、`date` がその週（月曜〜日曜）に入る、週の ToDo と `parentId` を持たない日の ToDo の数。`done` はその中の `doneAt` があるもの。`planned`・`actual` は、`rows` の各 `todoMinutes(data, id, 週の範囲)` の合計。`rows` は、週の ToDo、日の ToDo の順に、`date`・`id` の昇順。

- [ ] **Step 1: 失敗するテストを書く**（`tests/todos.test.js`。各関数に、次の値を含む）
  - `mondayOf("2026-10-20") === "2026-10-19"`、`mondayOf("2026-10-25") === "2026-10-19"`（日曜日）、`mondayOf("2026-10-19") === "2026-10-19"`。
  - `addTodo`: ID が `T-0001`、次が `T-0002`。`week` に `2026-10-22` を渡すと `date` は `2026-10-19`。空の件名は例外。`parentId` を週の ToDo 以外へ付けると例外。
  - `renameTodo`: 週の ToDo の件名を直すと、同じ件名の子も変わり、別の件名にした子は変わらない。
  - `carryTodo`: 日の ToDo（金曜 `2026-10-23`）→ `2026-10-26`（月曜）。休みの日（`settings.holidays` に月曜を入れた）をまたぐと火曜。`carried` が 1。週の ToDo → +7 日。完了した ToDo は例外。回す前の日の予定の枠は消え、実績が重なる予定の枠と、実績の枠は残る。
  - `deleteTodo`: 週の ToDo を消すと、子の `parentId` が外れ、子の枠は残る。ToDo の枠も消える。
  - `assignToDay`: 1 回目 `created: true`、同じ日の 2 回目は `created: false` でデータ不変。日の ToDo に使うと例外。
  - `weekReview`: 週の ToDo 1・単独の日の ToDo 1・子の日の ToDo 1（完了 1）→ `total` は 2、`done` は `doneAt` のある数（子は数えない）。`done` が `total` を超えない。予定・実績の分数は、子の枠を含む。先週の日付の枠は含まない。回した ToDo（`date` が来週）は、先週の `total` に入らない。
  - チェックリスト・`setReview`（空で消える）の基本の動き。
- [ ] **Step 2: 実行して失敗を確かめる** — `node --test tests/todos.test.js` → FAIL（ファイルがない）。
- [ ] **Step 3: 実装** — 上の Interfaces のとおり。`carryTodo` が消す枠は、`removeSession` を使う。
- [ ] **Step 4: 実行して通ることを確かめる** — `node --test tests/todos.test.js` と `npm test`（ビルドの順序の検査を含む）→ PASS。
- [ ] **Step 5: コミット** — `git commit -m "feat: ToDo の規則（追加・完了・割り当て・回す・見返し）を足す"`

---

### Task 4: ToDo タブの画面

**Files:**
- Create: `plugins/project-lens/src/ui/views/todo.js`
- Modify: `plugins/project-lens/src/ui/index.html`（タブ `tab-todo`「ToDo」を、スケジュールと稼働の間に）、`src/ui/app.js`（状態・描画・ハンドラ）、`src/ui/theme.css`、`tools/build.js`（`MODULES`）
- Test: `tests/views.test.js`、`tests/app-source.test.js`

**Interfaces:**
- Consumes: Task 3 の関数すべて、Task 2 の `recordActual`。
- Produces: `renderTodo(data, today, opts): string` — `opts = { week: string(月曜日), day: string, now: {date,time}, actFor: string|null }`。HTML の契約（テストが見る属性）:
  - 週の移動 `data-tdweek="-1"`・`data-tdweek="1"`・`data-tdweek-today`、日の移動 `data-tdday="-1"`・`data-tdday="1"`・`data-tdday-today`。
  - 追加の入力 `data-tdnew="week"`・`data-tdnew="day"`（Enter で追加）。
  - 行（`<li data-todo="<id>">`）: 完了のチェック `data-tdone="<id>"`、件名の入力 `data-tdtitle="<id>"`（`change` で改名）、削除 `data-tddel="<id>"`、割り当て `data-tdassign="<週の ToDo の id>"`（右の日が今日なら文言「今日へ」、そうでなければ「この日へ」）、回す `data-tdcarry="<id>"`（日は「明日へ回す」、週は「来週へ回す」。完了した ToDo には出さない）、実績 `data-tdact="<id>"`（「実績を入れる」）。
  - チェックリスト: 追加の入力 `data-tdck="<id>"`（Enter）、チェック `data-tdcktoggle="<id>:<項目 id>"`、削除 `data-tdckdel="<id>:<項目 id>"`。進捗は「M/N」。
  - 実績の入力欄（`opts.actFor` が ToDo の id のとき、その行に `<div class="actform">`）: `data-ta="date"`・`data-ta="start"`・`data-ta="end"`、保存 `data-tdactsave="<id>"`、キャンセル `data-tdactcancel`。初期値: 日付は `opts.day`、時刻は、その日にその ToDo の予定の枠があればその時刻、なければ `opts.now` を 15 分刻みに切り捨てた時刻から 60 分（今日以外の日は 09:00–10:00。23:59 を超えない）。
  - 回した回数が 1 以上の行に「N 回回しています」。予定・実績の分数（左の列は表示中の週、右の列は表示中の日の範囲で `todoMinutes`）。完了した ToDo は薄く（class `closed`）、列の末尾。
  - 見返し（`<section class="tdreview">`）: 「完了 X / Y 件」「予定 P 分に対して実績 A 分」、表（ToDo・進捗・予定・実績・回した回数。回した回数が 1 以上の行は class `hot`）、気づきの `<textarea data-tdnote="<週の月曜日>">`（`change` で `setReview`）。
- アプリの状態: `S.todoWeek`・`S.todoDay`（初期値は今日の週・今日）、`S.tdAct`（実績の入力欄を開いている ToDo の id か `null`）。週を動かすと、`S.todoDay` は、その週に今日が含まれれば今日、なければ月曜日。

- [ ] **Step 1: 失敗するテストを書く**（`tests/views.test.js`）
  - `renderTodo: 左に週の ToDo だけ、右に表示中の日の日の ToDo が並ぶ`（週の ToDo と、同じ週の単独の日の ToDo と、別の日の ToDo を用意し、`data-todo` の有無を検査）。
  - `renderTodo: 件名に <script> が入っていても、エスケープされる`。ID（`T-0001`）が HTML のテキストに出ない（属性値は除く）。
  - `renderTodo: 回した回数が 1 以上の行に「回しています」、0 の行に出ない`。完了した ToDo に `data-tdcarry` が無く、class `closed`。
  - `renderTodo: 割り当てのボタンの文言は、右の日が今日なら「今日へ」、そうでなければ「この日へ」`。
  - `renderTodo: 実績の入力欄の初期値`（予定の枠があればその時刻。なければ `now` 10:20 → 10:15 と 11:15。今日以外は 09:00・10:00）。
  - `renderTodo: 見返しの完了数・分数・回した回数の行`。
  - `renderTodo: ToDo が 1 件もなくても、空の列と追加の入力が出る`。
  - `tests/app-source.test.js`（既存の文字列照合の流儀）: `tab-todo` のクリックで `S.screen === "todo"`、`renderBody` が `renderTodo` を呼ぶ、`data-tdnew` の Enter が `isComposing` のときは確定しない、`data-tdactsave` が `recordActual` を `apply` に通す、各 `data-td*` に、対応するハンドラがある。
- [ ] **Step 2: 実行して失敗を確かめる** — `node --test tests/views.test.js tests/app-source.test.js` → FAIL。
- [ ] **Step 3: 実装** — 上の Interfaces のとおり。右の列の見出し（日付と「‹ 前の日」「次の日 ›」「今日」）、狭い画面で 2 列を縦に並べる CSS（`theme.css`。既存のメディアクエリに合わせる）。`apply` 1 回で 1 操作を保存する（`addTodo`・`assignToDay` など）。失敗の例外は、通知に出す（`apply` の既存の流れ）。`assignToDay` が `created: false` のときは「すでにこの日に割り当てています」を通知。入力欄は、保存の成功で空にする。`clearSel` と同様に、画面を移るとき `S.tdAct` を外す。
- [ ] **Step 4: 実行して通ることを確かめる** — `npm run build && npm test` → PASS。
- [ ] **Step 5: コミット** — `git commit -m "feat: ToDo タブ（2 列と週の見返し）を足す"`

---

### Task 5: スケジュール画面の「今日の ToDo」

**Files:**
- Modify: `plugins/project-lens/src/ui/views/prio.js`（`renderTodayTodos` を足し、`renderSide` の `sched: true` のとき、今日のタスクの前に出す）、`src/ui/app.js`（ドラッグ開始の対象に ToDo の行を含める）
- Test: `tests/views.test.js`、`tests/dnd.test.js`

**Interfaces:**
- Produces: `renderTodayTodos(data, today, opts): string` — 今日の日の ToDo（`scope: "day"`、`date` が今日）の一覧。完了していない行は `draggable="true" data-dragtask="<ToDo の id>"`、完了した行は薄く（class `closed`）・末尾でドラッグ不可。件名とその日の予定・実績の時刻（`slotHtml` と同じ札つき）を出す。ToDo が 0 件のときは空文字。

- [ ] **Step 1: 失敗するテストを書く**
  - `renderSide（sched: true）: 今日の ToDo の行が、今日のタスクの前に出て、完了していない行だけ data-dragtask を持つ`。`sched` でないとき（ガント・リスト）は出ない。ToDo が無ければ何も出ない。
  - `planDropAt: ToDo の data-dragtask を、ToDo の date と違う日へ落としても、予定の枠が置ける`（Task 2 のテストの補強）。
- [ ] **Step 2: 実行して失敗を確かめる** — `node --test tests/views.test.js tests/dnd.test.js` → FAIL。
- [ ] **Step 3: 実装** — `data-dragtask` を拾う既存のドラッグ処理（`app.js` の `dragstart`・drop）が、`data.tasks` から持ち主を引いていれば、`ownerOf`（Task 2）に直す。
- [ ] **Step 4: 実行して通ることを確かめる** — `npm run build && npm test` → PASS。
- [ ] **Step 5: コミット** — `git commit -m "feat: スケジュール画面の右の列に、今日の ToDo を出す"`

---

### Task 6: 文書・ビルド・実機の確認

**Files:**
- Modify: `docs/development.md`（「画面の動き」に ToDo タブの節、「共有ファイルと個人ファイルの分割」の表に `todos`・`reviews`、「設計判断」に 1 項目）、`docs/guide.md`・`README.md`（画面の説明）、`plugins/project-lens/assets/project-lens.html`（`npm run build`）

- [ ] **Step 1: `development.md` を直す** — 設計書の「決めたこと」を、今のコードの事実として書く（データの形、回す・割り当て・見返しの規則、スケジュール画面との関係）。設計判断に、「ToDo をタスクにせず、個人ファイルの専用の `todos` にした」理由と、見送った案（案 2・案 3 と、画面の案 B）を書く。版・日付・経緯は書かない。確かめていないことは「未確認」と書く。
- [ ] **Step 2: ビルドとテスト** — `npm run build && npm test` → すべて PASS。
- [ ] **Step 3: 実機の確認** — Chromium・Playwright、`?today=2026-10-20&time=10:15`、`sample.json` を `showOpenFilePicker` の差し替えで読み込む（仕事 1 の確認と同じ手順）。次を 1 回ずつ: ToDo タブを開く → 週・日の ToDo を追加 → 「今日へ」→ 実績を入れる → チェックリスト → 明日へ回す（回数・翌日の列）→ 見返しの数と気づきの保存 → スケジュール画面で今日の ToDo をカレンダーへドラッグ → 実績の入力欄 → 稼働の「プロジェクト未設定」。確かめていない画面（暗い配色、幅 900px・700px、日本語入力）は「未確認」と書く。
- [ ] **Step 4: コミット** — `git add -A && git commit -m "docs: ToDo タブを文書に反映する"`

---

## Self-Review の結果
- 設計書の各項目の担当: データ・検証 → Task 1、枠の共通化・稼働 → Task 2、規則（追加・完了・割り当て・回す・時間・見返し）→ Task 3、画面（2 列・行の操作・見返し）→ Task 4、スケジュール画面（今日の ToDo・ドラッグ・実績の入力）→ Task 2・5、文書・実機 → Task 6。
- 型の一貫: `allSessions`・`ownerOf`・`todoMinutes`・`weekReview` の名前と戻り値は、Task 2・3・4 で同じ。
- 設計書にない決め（私の判断）: 「実績を追加」（スケジュール画面）の候補は、今までどおりタスクだけ（ToDo の実績は、ToDo タブか、予定の枠を選んで入れる）。`mondayOf` は `core/todos.js` に置く（`weekStartOf` は `ui/views/schedule.js` にあり、core から読めない）。
