# ToDo タブをタスクから作り直す 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ToDo タブを、個人の ToDo ではなく、プロジェクトのタスクから自動で作る「今週の一覧」に置き換え、完了の入力欄（実績・状態・チェック）と週の見返しを付ける。

**Architecture:** 週に載るタスクは、保存せず、純関数 `weekTasks` が、タスクの期限・状態・枠から計算する（`core/week.js`）。完了の保存は、純関数 `completeTask`（`ui/edit.js`）が、実績・状態・チェックを 1 回で書く（途中で失敗したらデータは変わらない）。個人の ToDo（`todos`・ToDo の作業枠）は、すべて消す。個人ファイルに残るのは、見返しの気づき `reviews` だけ。

**Tech Stack:** 素の JavaScript（ES Modules）、単一 HTML へのビルド（`plugins/project-lens/tools/build.js`）、`node --test`。

**Spec:** `docs/specs/2026-11-25-todo-from-tasks-design.md`（設計書。矛盾したら設計書が優先）

## Global Constraints

- Windows 専用、Node 24 以上。テスト: `npm test`。`src/` を変えたら `npm run build` して `plugins/project-lens/assets/project-lens.html` をコミットする（古いと `npm test` が失敗する）。
- ビルドの `MODULES`（`plugins/project-lens/tools/build.js`）に、新しいファイルを足す。export 名は、モジュールをまたいで一意。
- データ形式の正本は `plugins/project-lens/data/sample.json` と `src/core/schema.js`。形を変えたら両方を直す。
- 画面に ID（`T-0001` など）を出さない。文言は日本語。画面に出す文字は `esc()` で必ずエスケープ。
- 用語は「タスク」にそろえる。「ToDo」はタブの名前だけに残す。「件名」は入力欄のラベルだけ。
- 旧形式の移行・読み替えは持たない。ただし、個人ファイルに `todos`・ToDo の作業枠が残っていても、読み込み（`mergeData`）で捨て、エラーにしない。保存し直すと消える。
- 変更の PR 本文に、「`docs/development.md`: 直した節の名前」を書く。`README.md`・`docs/guide.md` の画面の説明も直す。`docs/development.md` には、版番号・PR 番号・日付・「以前は〜」の経緯を書かない。
- 設計書に無いことは、設計書の趣旨で決め、台帳に `Ruling:` で記録する。次の 2 点は、計画で決める（設計書は書いていない）:
  - Cancelled のタスクは、どの週の一覧にも出さない。
  - 完了の入力欄の状態の選択肢は、To Do・In Progress・Done・Cancelled（Waiting は待ち先が要るので出さない）。

## Review Focus

1. 週の境界: 期限が日曜と、次の月曜のタスク。`doneAt` が週の最終日と翌週の初日のタスク。（Task 1 のテスト）
2. 完了の保存が途中で失敗したとき（実績の重なり、開始が今より後、時刻の片方だけ入力）、データが 1 つも変わらない。（Task 3 のテスト）
3. 個人ファイルに `todos` と ToDo の枠（`taskId` が `T-` で始まる）が残っているとき、読めて、結合後のデータに `todos` が無く、`orphanSessions` も出ない。（Task 5 のテスト）
4. プロジェクトなしのタスク（`projectId` が null）と、存在しない前のタスクの ID を持つタスクが、一覧と今日の優先で例外にならない。（Task 1・2 のテスト）
5. 同じタスクが、複数の規則（期限超過かつ今週に枠）に当たっても、一覧に 1 行だけ出る。（Task 1 のテスト）

---

## Task 0: ブランチ

- [ ] **Step 1:** 現在のブランチ `docs/todo-from-tasks`（設計書のコミットあり）から、実装用のブランチ `feat/todo-from-tasks` を作る（`git checkout -b feat/todo-from-tasks`）。以降の作業は、すべてこのブランチ。

---

## Task 1: 今週の一覧と見返しの計算（`core/week.js`）

**Files:**
- Create: `plugins/project-lens/src/core/week.js`、`tests/week.test.js`
- Modify: `plugins/project-lens/tools/build.js`（`MODULES` に `"src/core/week.js"` を、`"src/core/todos.js"` の次に足す）

**Interfaces:**
- Consumes: `isClosed`（`core/schema.js`）、`checklistCount`（`core/checklist.js`）、`actualSpans`（`core/sessions.js`）、`addDays`・`toMin`（`core/dates.js`）。
- Produces（Task 4 の画面が使う）:
  - `weekTasks(data, weekStart: string, today: string): Row[]`。`Row = { task, group: "overdue"|"scheduled"|"due"|"done", waiting: boolean, planned: number, actual: number, checked: {done:number,total:number}|null }`。並び: group の順（overdue → scheduled → due → done）、同じ group の中は期限の昇順、同じなら ID 昇順。
  - `weekSummary(data, weekStart, today): { done:number, total:number, planned:number, actual:number, note:string, rows: Row[] }`。`total` は `rows.length`、`done` は `rows` のうち `task.status === "Done"` の数、`planned`・`actual` は `rows` の合計、`note` は `data.reviews?.[weekStart] ?? ""`。
- 名前の注意: `todos.js` の `weekReview`・`mondayOf`・`setReview` は、Task 5 まで残る。新しい名前（`weekTasks`・`weekSummary`）で、衝突させない。

- [ ] **Step 1: 失敗するテストを書く（`tests/week.test.js`）** 次を、テスト名つきで:
  - 「期限が週の中の未完了を、due の組に出す」「期限超過（`due < today`）の未完了は、overdue の組」「週の中に予定の枠か実績の区間のある未完了で、期限が週より後のものは scheduled の組」「期限が今日以降で週の終わりより後の、枠も無い未完了は出ない」
  - 「Done で `doneAt` が週の中、または、週の中に枠か実績の区間があるものは done の組」「Done で、どちらも週の外のものは出ない」「Cancelled は、期限超過でも枠があっても、どの週にも出ない」
  - 境界: 期限が週の日曜は出る・次の月曜は（枠が無ければ）出ない。`doneAt` が日曜は出る・次の月曜は出ない。
  - 「複数の規則に当たるタスクは 1 行だけ（期限超過が優先）」
  - 「前のタスクが未完了なら `waiting: true`。前のタスクが完了、または、存在しない ID だけなら `false`」
  - 「`projectId: null` のタスクを含んでも、例外にならない」
  - 並び（組の順 → 期限 → ID）。
  - `planned` は、週の日付にある予定の枠（`kind: "planned"`）の自身の時間の合計（`actual` を持つ枠も数える）、`actual` は、そのタスクの実績の区間（`actualSpans`）の週の日付の合計（分）。`checked` は、チェックリストが無ければ `null`。
  - `weekSummary`: `done`/`total`/`planned`/`actual`/`note`（`reviews` の値。無ければ空文字）。

- [ ] **Step 2:** `node --test tests/week.test.js` が、`week.js` が無いことで失敗することを確かめる。

- [ ] **Step 3: `weekTasks`・`weekSummary` を `core/week.js` に実装する。** 週は `weekStart`〜`addDays(weekStart, 6)`（日付文字列の比較）。「その週の枠・実績」は、タスクの `sessions` の日付（予定の枠は枠の `date`）と、`actualSpans` の区間の `date` で見る。ファイルの冒頭に、規則（上の Interfaces と設計書の「今週の一覧」）を日本語で 1 ブロック書く。

- [ ] **Step 4:** `npm run build && npm test` が通ることを確かめる。

- [ ] **Step 5: コミット** `feat: 週のタスクの一覧と見返しの計算を足す`

---

## Task 2: 今日の優先に、前のタスク待ちを含める

**Files:**
- Modify: `plugins/project-lens/src/core/schedule.js`（`rankTasks`）、`tests/schedule.test.js`（`rankTasks` の既存テスト）
- 影響確認: `grep -rn "rankTasks" plugins/project-lens/src tests` で、「前のタスクが未完了のものは出ない」を前提にする箇所を、すべて見つけて直す（`views/prio.js`・`views/schedule.js`・`views/project.js`・テスト）。

**Interfaces:**
- Consumes/Produces: `rankTasks(data, today)` の戻り値の形は変えない（`{ taskId, score, reasons, action, due }`）。

- [ ] **Step 1: 失敗するテストを書く（`tests/schedule.test.js`）**
  - 「前のタスクが未完了のタスクも、今日の優先に出て、reasons の先頭に『前のタスク待ち』が入る」
  - 「点数は、前のタスク待ちかどうかで変わらない（同じ期限・同じ条件の 2 タスクで、点数が同じ）」
  - 「前のタスクが完了、または、存在しない ID だけのときは、reasons に『前のタスク待ち』が入らない」
  - 既存の「前のタスクが未完了のものを外す」テストは、新しい規則へ書き直す。

- [ ] **Step 2:** 該当テストが失敗することを確かめる。

- [ ] **Step 3: `rankTasks` を直す。** `(t.predecessors ?? []).some((p) => byId.has(p) && !isClosed(byId.get(p)))` の `continue` をやめ、同じ条件が真のとき `reasons.unshift("前のタスク待ち")` する（Waiting の催促の理由より先頭）。関数の上のコメントの「前のタスクがすべて完了しているもの」の文を、新しい規則に直す。

- [ ] **Step 4:** `npm test` が通ることを確かめる（`views` のテストの期待が変わったら直す）。

- [ ] **Step 5: コミット** `feat: 今日の優先に、前のタスク待ちのタスクも出す`

---

## Task 3: 完了の保存（`completeTask`）

**Files:**
- Modify: `plugins/project-lens/src/ui/edit.js`、`tests/edit.test.js`

**Interfaces:**
- Consumes: `recordActual`・`recordSlotActual`・`updateTask`・`updateChecklistItem`・`spawnNextRepeat`（すべて `edit.js`）、`futurePlanned`・`removeSession`・`allSessions`（`core/sessions.js`）。
- Produces（Task 4 の画面が使う）: `completeTask(data, taskId, { actual, status, checks }, now): { data, statusChanged: boolean, released: number, spawned: boolean }`。`actual` は `{ date, start, end }`（3 つとも空文字か `undefined` なら実績なし）。`status` は To Do／In Progress／Done／Cancelled のどれか（Waiting や不明は Error）。`checks` は `{ [項目 ID]: boolean }`（省略可。入っている項目の `done` を、その値にする）。`now` は `{ date, time }`。失敗は Error で、データは変えない。

- [ ] **Step 1: 失敗するテストを書く（`tests/edit.test.js`）**
  - 「実績つきで Done: 実績の枠ができ、状態が Done、`doneAt` が `now.date`、`checks` のとおりにチェックが付く」
  - 「そのタスクの、実績の日付の予定の枠（`actual` なし）があれば、その枠の `actual` に書く（実績だけの枠は増えない）。なければ、実績だけの枠を足す」
  - 「実績なし（3 つとも空）で Done: 実績の枠は増えず、状態だけ変わる」
  - 「状態の選択が優先される: 実績を入れても、To Do のまま保存すると To Do のまま（In Progress にならない）」
  - 「Done・Cancelled で、未来の予定の枠（`futurePlanned`）が消え、`released` がその件数。実績を持つ枠は消えない」
  - 「定例（`repeat`）の Done で、次回のタスクが 1 件できる（`spawned: true`）」
  - 失敗でデータが変わらない: 「時刻が片方だけ」「開始が今より後」「他の実績の区間と重なる」「Waiting を指定」のそれぞれで、Error が出て、返り値を使わなければ元の `data` は変わらない（純関数なので、入力が書き換わっていないことを `deepEqual` で確かめる）。

- [ ] **Step 2:** 該当テストが失敗することを確かめる。

- [ ] **Step 3: `completeTask` を実装する。** 順序: 実績（あれば `recordSlotActual` か `recordActual`。その結果の状態の自動変更は、次の `updateTask` で上書きされる）→ `updateTask(status)`（`now.date`）→ `checks` の反映 → Done・Cancelled なら未来の予定の枠を解除（実績を書いたあとの `futurePlanned` で数える）→ Done なら `spawnNextRepeat`。実績の枠の特定: タスクの `sessions` のうち、`kind: "planned"`・`date === actual.date`・`actual` なしの最初の枠（開始の昇順）。

- [ ] **Step 4:** `npm test` が通ることを確かめる。

- [ ] **Step 5: コミット** `feat: タスクの完了を、実績・状態・チェックでまとめて保存する関数を足す`

---

## Task 4: ToDo タブの画面と、古い ToDo の画面の撤去

**Files:**
- Modify（作り直し）: `plugins/project-lens/src/ui/views/todo.js`、`plugins/project-lens/src/ui/app.js`、`plugins/project-lens/src/ui/theme.css`
- Modify（ToDo の撤去）: `src/ui/views/prio.js`（`renderTodayTodos`・`renderSide` の ToDo の部分）、`src/ui/views/schedule.js`（ToDo の枠の扱い。`sessionSelection` の ToDo の分岐、`task` が無いときのコメント）、`src/ui/app.js`（ToDo のハンドラ・状態・`taskTitle` の ToDo の分岐）
- Test: `tests/views.test.js`（ToDo 画面・今日の ToDo の既存テストを、新しい画面へ書き直すか、撤去）、`tests/app-source.test.js`（ToDo の記述の確認があれば直す）、`tests/dnd.test.js`（ToDo の 5 件の言及を確認）

**Interfaces:**
- Consumes: Task 1 の `weekTasks`・`weekSummary`、Task 3 の `completeTask`、`setReview`・`mondayOf`（まだ `core/todos.js`。Task 5 で `week.js` へ移すので、import 元は、その時に直す）、`planDone` は使わない。
- Produces: `renderTodo(data, today, { week, now, open, draft })`。`open` は、完了の入力欄を開いているタスクの ID か null。`draft` は `{ key, date, start, end, status, checks }` か null。画面の状態は、`S.todoWeek`（週の月曜日）・`S.tdOpen`（`open`）・`S.tdDraft`（`draft`）。`S.todoDay`・`S.tdAct`・`S.tdAskDel` は消す。

- [ ] **Step 1: 失敗するテストを書く（`tests/views.test.js`）**
  - 「一覧に、組の見出し（期限超過・今週に予定あり・今週の期限・完了）と、タスクの件名・プロジェクト名・状態・期限・進捗・予定と実績の分が出る。ID（`T-` や `AC-` で始まる文字）は出ない」
  - 「前のタスク待ちの行に『前のタスク待ち』が出る」「完了していない行に『完了』ボタン（`data-tdopen`）が出る。完了した行には出ない」
  - 「`open` を渡すと、その行に入力欄が出る: 日付・開始・終了・状態（初期値 Done）・チェックリストの項目と『残りをすべてチェック』（`data-tdckall`）・『保存』（`data-tdsave`）・『キャンセル』（`data-tdcancel`）。Done・Cancelled にすると未来の予定の枠を解除するという注意が、解除される枠があるときだけ出る」
  - 「`draft` があれば、入力欄がその値になる」「見返し: 『完了 X / Y 件』『予定 P 分に対して実績 A 分』・タスクごとの進捗/予定/実績・気づきの欄（`data-tdnote`）。『回した回数』の列は無い」「件名・気づきは `esc()` される（`<b>&` を入れたタスク）」
  - 撤去の確認: `renderTodayTodos` が export されていない、スケジュール画面の右の列に『今日の ToDo』が出ない。

- [ ] **Step 2:** 該当テストが失敗することを確かめる。

- [ ] **Step 3: `views/todo.js` を作り直す。** 週の移動（`data-tdweek="-1|1"`・`data-tdweek-today`）、一覧（`weekTasks`）、完了の入力欄（`data-tf="date|start|end|status"`・チェックリストは `data-tfck="<項目 ID>"`）、見返し（`weekSummary`）。入力欄の初期値: 日付は、`today` が表示中の週にあれば `today`、なければ週の月曜日。時刻は、その日のそのタスクの予定の枠（`actual` なし）があればその時刻、なければ空。状態は Done。チェックは、タスクの今の状態。`views/schedule.js` の `actAddSpan` への依存は、使わなくなるので外す。

- [ ] **Step 4: `app.js` を結線する。**
  - 状態を、上の Produces のとおりに直す。`render()` の検証（`S.tdOpen` が `S.data.tasks` に無ければ、`S.tdOpen`・`S.tdDraft` を外す）。画面の移動・週の移動で、入力欄を閉じる（`S.tdOpen = null; S.tdDraft = null`）。
  - 「完了」（`data-tdopen`）: 開く・もう一度押すと閉じる。
  - 「残りをすべてチェック」（`data-tdckall`）: 入力欄のチェックを、すべて付ける（描き直さず、欄の値を直接変える）。
  - 「保存」（`data-tdsave`）: 押したときに、欄の値を読み、先に `S.tdDraft` へ写してから `completeTask` を `apply` する。失敗は通知だけで、入力を残す。成功したら、入力欄を閉じ、通知（例: 「『件名』を Done にしました」。解除した枠があれば「未来の予定の枠 N 件を解除しました」、次回を作ったら「次回（期限 M/D）を作りました」）。
  - 「キャンセル」（`data-tdcancel`）: 閉じる。気づき（`data-tdnote`）の保存は、今のまま（`setReview`。`change`）。
  - `isEditing`（入力中は読み直しで描き直さない）の対象欄を、`["tdnote", "tf"]` にそろえる。
  - ToDo の古いハンドラ（`data-tdnew`・`tdtitle`・`tdck`・`tdday`・`tdassign`・`tdcarry`・`tddel`・`tdone`・`tdact`・`tdactsave` など）、`moveTodoWeek` 以外の ToDo の関数（`setTodoDay`・`submitTodoInput`・`deleteTodoNow`）、`app.js:36` の文言の「ToDo」（個人ファイルの説明から外す）を、すべて消す。
  - `views/prio.js` の `renderTodayTodos` と、`renderSide` の呼び出しを消す。`views/schedule.js` の `sessionSelection` の ToDo の分岐と、ToDo の枠を想定したコメント・コードを消す。`app.js` の `taskTitle` の ToDo の分岐を消す。
  - `theme.css` の ToDo 専用のクラス（`.tdpage`・`.tdcols`・`.tdcol`・`.td-*`・`.tdlist`・`.tdreview`・`.todaytodos`）を、新しい画面のものに作り直す（使わないものは消す）。

- [ ] **Step 5: `grep -rn "todos\|renderTodayTodos\|tdAskDel\|todoDay" plugins/project-lens/src/ui` が 0 件になることを確かめる（`reviews`・`todo` タブの名前・`b-todo`（状態 To Do の色）は対象外）。**

- [ ] **Step 6:** `npm run build && npm test` が通ることを確かめる。

- [ ] **Step 7: コミット** `feat: ToDo タブを、タスクから作る今週の一覧と完了の入力欄に作り直す`

---

## Task 5: ToDo のデータと規則を消す

**Files:**
- Delete: `plugins/project-lens/src/core/todos.js`、`tests/todos.test.js`
- Create/Modify: `plugins/project-lens/src/core/week.js`（`mondayOf`・`setReview` を、`todos.js` から移す。シグネチャ・挙動は同じ）
- Modify: `plugins/project-lens/tools/build.js`（`MODULES` から `todos.js` を外す）、`src/core/sessions.js`（`ownerOf`・`allSessions`・`mapOwners` の ToDo の扱い、コメント）、`src/core/schema.js`（`todos` の検査、`weekTodoIds`、枠の検査の対象）、`src/core/split.js`、`src/core/workload.js`（コメント）、`src/ui/app.js`（`mondayOf`・`setReview` の import 元）、`data/sample.json`（`todos` を消す。`reviews` は残す）
- Test: `tests/sessions.test.js`・`tests/split.test.js`・`tests/schema.test.js`・`tests/workload.test.js`・`tests/edit.test.js`・`tests/week.test.js`（`mondayOf`・`setReview` のテストを `todos.test.js` から移す）・`tests/twofiles.js`

**Interfaces:**
- Produces: `mergeData` は、`personal.todos` を結合後のデータに入れない。`personal.sessions` のうち、`personal.todos` の ID を `taskId` に持つ枠は捨てる（`orphanSessions` に入れない）。`splitData` は、入力の `todos` を無視する。`checkPersonalShape` は、`todos` の形を検査しない。`schema.validate` は、`todos` を見ない。

- [ ] **Step 1: 失敗するテストを書く**
  - `tests/split.test.js`: 「`personal.todos` と、その ToDo の枠が残っている個人ファイルを `mergeData` すると、結合後のデータに `todos` が無く、`orphanSessions` も出ない。タスクの枠は、そのまま残る」「`splitData` の出力に `todos` が出ない」「`todos` が配列でない個人ファイルも、`checkPersonalShape` が通す」
  - `tests/sessions.test.js`: ToDo の枠を前提にするテストを、撤去する。「`ownerOf`・`allSessions` が、タスクだけを見る」
  - `tests/schema.test.js`: ToDo の検査のテストを撤去する。
  - `tests/week.test.js`: `mondayOf`（月〜日 → その週の月曜日。日曜は前の月曜）、`setReview`（保存・空文字でキーを消す）。

- [ ] **Step 2:** 該当テストが失敗することを確かめる。

- [ ] **Step 3: 実装する。**
  - 手順: `mondayOf`・`setReview` を `week.js` へ移す → `app.js` などの import 元を直す → `todos.js` と `tests/todos.test.js` を消し、`MODULES` を直す → `sessions.js`・`schema.js`・`split.js`・`workload.js` の ToDo を消す → `sample.json` から `todos` と、ToDo の枠を消す。
  - `grep -rn "todos\|ToDo" plugins/project-lens/src plugins/project-lens/data plugins/project-lens/tools` で、残りを確認する。残ってよいのは、タブの名前としての「ToDo」・状態の `To Do`・`b-todo`・`mergeData` の捨てる処理のコメントだけ。
  - `tests/*.test.js` のうち、ToDo を前提にするテストを、撤去するか、新しい規則へ直す（`grep -n -i "todo" tests/*.js` で一覧を取る。`To Do`（状態）は対象外）。

- [ ] **Step 4:** `npm run build && npm test` が通ることを確かめる。

- [ ] **Step 5: コミット** `refactor: 個人の ToDo のデータと規則を消す`

---

## Task 6: 文書・ビルド・実機の確認

**Files:**
- Modify: `docs/development.md`、`docs/guide.md`、`README.md`、`plugins/project-lens/assets/project-lens.html`（ビルドの生成物）、必要なら `docs/images/*.svg`（ToDo タブを描いたもの）
- 設計書・計画書: `docs/specs/2026-11-25-todo-from-tasks-{design,plan}.md`（コミット済み。直さない）

- [ ] **Step 1: `docs/development.md` を直す。** 「ToDo タブ」の節を、新しい規則（今週の一覧の条件・並び・前のタスク待ち・完了の入力欄と `completeTask`・見返し・個人ファイルの `reviews`・Cancelled を出さないこと・過去の週は今の状態での近似）に、全面的に書き直す。「今日の優先」の節（前のタスク待ちを含む）、「今日のタスクとスケジュール」の節（「今日の ToDo」・ToDo の枠の記述を消す）、「会議と稼働」の節（「プロジェクト未設定」の行の ToDo の列の記述を消す）、「共有ファイルと個人ファイルの分割」の節（`todos` を個人ファイルが持たないこと、残っていても捨てること）、「設計判断」に、1 項目（ToDo を、保存せず、タスクから計算にした理由。見送った案: 週ごとの一覧を保存するスナップショット／個人の ToDo を残すこと／手で足す前倒し／回す・回した回数。それぞれの理由）。動作確認をしていないことは「未確認」と書く。

- [ ] **Step 2: `docs/guide.md`・`README.md` の ToDo タブの説明を直す。** 画像（`docs/images/` の ToDo タブを描いたもの）が古くなるなら、「未更新」と、その旨を書く（作り直しはしない）。

- [ ] **Step 3: 照合する。** `grep -n "todos\|ToDo\|回した\|回す\|前倒し\|今日の ToDo" docs/development.md docs/guide.md README.md` で、消した機能の記述が残っていないことを確かめる。`development.md` のバッククォートで囲んだファイル名・識別子が、コードに実在することも確かめる（`weekTasks`・`weekSummary`・`completeTask`・`S.tdOpen` など）。

- [ ] **Step 4:** `npm run build && npm test`。出力の件数と、失敗 0 を記録する。

- [ ] **Step 5: 実機で確かめる（Chromium・Playwright、1400×900、`?today=2026-10-20&time=10:15`、`showOpenFilePicker` の差し替え。サンプルを `splitData` で 2 ファイルにして読み込む）。** 次を 1 回ずつ: 一覧が自動で出る（組の見出し・前のタスク待ち・期限超過）・完了の入力欄（実績・状態・チェック・「残りをすべてチェック」）で保存し、一覧・見返し・ガント・稼働に反映される・保存が失敗した（重なる実績）とき入力が残る・Cancelled が出ない・週を移動する・気づきの保存と読み直し・今日の優先に前のタスク待ちが出る・スケジュール画面の右の列に今日の ToDo が出ない・`todos` が残る個人ファイルを読んで、保存し直すと `todos` が消える・幅 700px で横スクロールが出ない。確かめなかった項目は、PR 本文に「未確認」と書く。

- [ ] **Step 6: コミット** `docs: ToDo タブの作り直しに合わせて文書とビルドを直す`
