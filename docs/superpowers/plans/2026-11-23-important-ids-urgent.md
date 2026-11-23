# 重要・ID・履歴・突発タスク・編集の拡張 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SPEC の依頼 2〜11（突発タスクの追加・スケジュールからの編集・プロジェクト移動・ID の見直し・履歴の廃止・「重要」への変更と各画面の印）を実装する。ファイルの分割（依頼 1）は別の計画（`2026-11-23-split-data-files.md`）で、この計画のあとに行う。

**Architecture:** データの形は 1 つの `data.json` のまま変えず、`important: true` への改名・ID の採番・履歴の廃止を、`core/`・`ui/edit.js` の純関数で行い、画面は文字列を返す描画関数（`ui/views/*.js`）と `app.js` のイベント処理を足す。テストは `node --test`（`tests/*.test.js`）。

**Tech Stack:** Node.js 24 以上・外部パッケージなし・ブラウザ側は素の ES モジュール。`npm test` / `npm run build`。

**Spec:** `docs/grill-spec/specs/2026-11-23-lens-multi-user-important-design.md`（図: 同名の `.svg`）

## Global Constraints

- Windows 専用・Node.js 24 以上・外部パッケージを使わない（`CLAUDE.md`）。
- `plugins/project-lens/src/` を変えたら `npm run build` を実行し、`plugins/project-lens/assets/project-lens.html` をコミットする（古いと `npm test` が失敗する）。
- 振る舞い・規則を変えたら、同じ作業の中で `docs/development.md` の対応する節を直す。直した節の名前を PR の本文に書く。`docs/flow.html` は `skills/`・`agents/`・`tools/` の手順を変えたときだけ直す。
- 互換性は考慮しない（旧形式のデータの移行・読み替えは作らない）。
- プロジェクト ID は `AA`〜`ZZ`、`ZZ` はプロジェクトなしの接頭辞で予約。タスク ID は `<プロジェクト ID>-<4 桁>`（`AA-0001`）。上限を超えたら `throw new Error(...)`。
- データの項目は `important: true`（重要でないときは項目を持たない）。点数 +12 は据え置き。
- 完了（`Done`・`Cancelled`）したタスクには、どの画面でも重要の印を付けない。
- 重要の印: リスト＝ガントと同じ（左端の赤い太線・薄い赤の背景）／今日の優先・今日のタスク＝赤い「重要」バッジ／スケジュール＝件名を赤字・太字＋枠の左端に赤い線（枠の色は変えない・バッジなし）。
- 既存の流儀: 編集関数（`ui/edit.js`）は不正な入力で `throw new Error(日本語の文)`。描画関数は HTML の文字列を返し、値は `esc()` を通す。ほかの画面の CSS は `theme.css` の末尾の節にまとめる。

## Review Focus

- `important` が `false`・`"true"`・`1` など `true` 以外のデータ → 検証がエラーにする（画面で印が出ないまま点数だけ付く、を防ぐ）。
- 重要で `Done` のタスクを、定例（`repeat`）で複製したとき、次回のタスクは `important: true` を引き継ぎ、`Done` の元は印なし。
- プロジェクトを 675 個作った後の追加と、番号 9999 の次の追加 → データを変えずにエラー。
- プロジェクトなしのタスクの ID（`ZZ-0001`）が、プロジェクトの ID と衝突しない（`ZZ` は決して割り振られない）。
- スケジュールで、タスクを削除・プロジェクト移動した直後に、編集欄が開いたままにならない（対象が消えたら閉じる）。
- 突発タスクの入力欄で、日付が空・開始時刻が空のとき確定しない（何も作らず、欄は開いたまま）。
- 突発タスクのボタンを、スケジュール画面で、枠や会議を選択中に押しても、選択が残らない。

---

## File Structure

| ファイル | 役割（変更） |
|---|---|
| `src/core/schema.js` | `IMPORTANCE` を廃し `important` の検証。`isImportantMark(t)` を足す。`source: "screen"` を許可から外す |
| `src/core/schedule.js` | 点数の +12 を `important` で判定 |
| `src/ui/edit.js` | `updateTask` の `important`、`newTask`・`carriedFields`、`recordDueChanges`・`setLogCause` の削除、`nextProjectId`・`nextTaskId`・`addProject` の新 ID |
| `src/import/wbs.js` | 重要度の列を廃止 |
| `src/ui/views/{gantt,project,taskpop,prio,schedule}.js` | 重要の印・チェックボックス・リストのプロジェクト列・編集欄・突発タスクの入力欄 |
| `src/ui/app.js`・`index.html`・`theme.css` | ヘッダーのボタン・イベント・CSS |
| `data/sample.json` | `important: true`・`importance: null` の削除 |

（パスは、特記がなければ `plugins/project-lens/` からの相対。）

---

### Task 1: 「重要」のデータ（`important`）

**Files:**
- Modify: `src/core/schema.js`（`IMPORTANCE`・119 行目の検証）、`src/core/schedule.js:66`、`src/ui/edit.js`（`updateTask` の `importance`・`newTask`・`carriedFields`）、`src/import/wbs.js`（9・34・153・161 行目）、`data/sample.json`
- Test: `tests/schema.test.js`、`tests/edit.test.js`、`tests/schedule.test.js`、`tests/wbs.test.js`

**Interfaces:**
- Produces: `isImportantMark(t: Task): boolean`（`schema.js`。`t.important === true && !isClosed(t)`）。`updateTask(data, id, { important: boolean })` は、`true` で `important: true` を付け、`false` で項目を消す。

- [ ] **Step 1: 失敗するテストを書く** — `tests/schema.test.js`: `important: true` は error なし／`important: false`・`"true"` は error「重要 (important) は true にするか、項目を消してください」／`importance` キーは無視（error も warning も出ない）。`tests/schedule.test.js`: `important: true` のタスクの点数が、同じ条件の重要でないタスクより 12 大きく、理由に「重要」を含む。`tests/edit.test.js`: `updateTask(d, "A3", { important: true })` で `important === true`、`{ important: false }` で `"important" in task === false`。`duplicateTask`・`spawnNextRepeat` の結果が `important: true` を引き継ぐ。`tests/wbs.test.js`: `importance` を持つ行を取り込んでも、タスクに `important`・`importance` が付かない。
- [ ] **Step 2: 実行して失敗を確かめる** — `node --test tests/schema.test.js tests/edit.test.js tests/schedule.test.js tests/wbs.test.js`（FAIL）。
- [ ] **Step 3: 実装** — `schema.js` に `isImportantMark` を足し、`IMPORTANCE` と旧検証を外して `important` の検証を足す。`schedule.js` は `t.important === true` で +12・理由「重要」。`edit.js`: `updateTask` の `"importance" in patch` を `"important" in patch`（`patch.important ? n.important = true : delete n.important`）にし、`newTask` から `importance: null` を外し、`carriedFields` を `important` に直す。`wbs.js`: `FIELDS`・`rowProblem`・`addTask` の引数・更新の `patch` から重要度を外す。`sample.json`: `importance: "high"` の 3 件（A3・A7・B4）を `"important": true` に、`"importance": null` をすべて消す。
- [ ] **Step 4: 通ることを確かめる** — 同じコマンド（PASS）。`importance` を使う既存のテスト（`tests/{inboxops,intake-cli,repeat,views}.test.js` など）は、`grep -rn importance tests` で洗い出して `important` に直し、`npm test` が通ること。
- [ ] **Step 5: コミット** — `git add -A && git commit -m "feat: 重要度を important: true に変える（データ・点数・取り込み）"`。

---

### Task 2: 「重要」のチェックボックスと、ガント・リストの印

**Files:**
- Modify: `src/ui/views/gantt.js:152`（`imp-high` を `isImportantMark` に）、`src/ui/views/project.js:61`（列「重要度」の `select` を、列「重要」のチェックボックスに。見出し 85 行目も）、`src/ui/views/taskpop.js:33,43`（「重要度」の `select` をチェックボックスに）、`src/ui/app.js:752`（`change` の処理）、`src/ui/theme.css`（リスト行の印）
- Test: `tests/views.test.js`

**Interfaces:**
- Consumes: `isImportantMark(t)`（Task 1）。
- Produces: チェックボックスは `<input type="checkbox" data-f="important" data-id="<ID>">`。`app.js` の `change` は、`data-f="important"` のとき `updateTask(d, id, { important: el.checked })` を呼ぶ。リスト行の印の class は `imp`（行 `<tr class="imp">`）。

- [ ] **Step 1: 失敗するテストを書く** — `tests/views.test.js`: (a) ガントの重要で未完了のタスクのラベルに `imp-high` がある、`Done` には無い。(b) リストの重要で未完了の行 `<tr` が `class="imp"` を含み、`Done` の行は含まない。(c) リストにも編集の窓にも、`data-f="important"` のチェックボックスがあり、重要のタスクは `checked`。「重要度」の文字が出ない。
- [ ] **Step 2: 失敗を確かめる** — `node --test tests/views.test.js`。
- [ ] **Step 3: 実装** — 上のファイルを直す。リストの印の CSS は、`theme.css` 末尾の節に `.tbl tr.imp td:first-child{box-shadow:inset 5px 0 0 var(--bad)}` と `.tbl tr.imp{background:var(--bad-soft)}` を足す（ガントの `imp-high` と同じ色）。`.thstrip` の列幅を測る `syncThStrips` は、列の数が変わらないので変えない。`docs/development.md` の「ガントチャートとリスト」の重要度の項（「重要度は、ガントのタスク行のラベルに出す」）を「重要」に直し、リストの印を足す。
- [ ] **Step 4: 通ることを確かめる** — `node --test tests/views.test.js`（PASS）。
- [ ] **Step 5: 動作確認** — `npm run build` のあと、`?today=2026-10-20` を付けてページを開き（Playwright で、`showOpenFilePicker` を差し替えて `sample.json` を読み込む。`development.md` の確認の書き方に従う）、リストの行・ガントのラベルに印が出て、チェックボックスで付け外しできること。確かめたことと未確認を `development.md` に書く。
- [ ] **Step 6: コミット** — `git commit -am "feat: 重要のチェックボックスと、リストの印"`。

---

### Task 3: 今日の優先・今日のタスクの「重要」バッジ

**Files:**
- Modify: `src/ui/views/prio.js`（`renderTodayTasks` の行・`renderPrio` の行）、`src/ui/theme.css`
- Test: `tests/views.test.js`

**Interfaces:**
- Consumes: `isImportantMark(t)`、`rankTasks` の理由（Task 1 で「重要」に変わる）。
- Produces: バッジは `<span class="impbadge">重要</span>`（赤地・白字の小さな丸）。

- [ ] **Step 1: 失敗するテストを書く** — 今日の優先: 重要のタスクの行で、理由の文字列に「重要度: 高」が出ず、`impbadge` が 1 つ、理由の欄（`class="why"`）の中にある。今日のタスク: 重要で未完了の行に、件名の `<span class="t">` の中、状態の pill（`class="pill`）の後に `impbadge` がある。`Done` の行には無い。
- [ ] **Step 2: 失敗を確かめる** — `node --test tests/views.test.js`。
- [ ] **Step 3: 実装** — 今日の優先は、`r.reasons` から「重要」の理由を取り除き、その位置にバッジを出す。今日のタスクは `statusPill(t)` の直後に出す。CSS: `.impbadge{background:var(--bad);color:#fff;font-size:10px;font-weight:700;border-radius:8px;padding:0 6px;margin-left:4px}`。`development.md` の「今日のタスクとスケジュール」と「優先順位」の表（重要度 → 重要）を直す。
- [ ] **Step 4: 通ることを確かめる** — `node --test tests/views.test.js tests/schedule.test.js`。
- [ ] **Step 5: コミット** — `git commit -am "feat: 今日の優先・今日のタスクに重要バッジ"`。

---

### Task 4: スケジュールの「重要」の印

**Files:**
- Modify: `src/ui/views/schedule.js`（`sessionBlocks` の 67 行目付近・週表示の期限の行 130 行目付近）、`src/ui/theme.css`
- Test: `tests/views.test.js`

**Interfaces:**
- Consumes: `isImportantMark(t)`。作業枠は `data.tasks[].sessions`（枠の持ち主のタスクを、枠から引く）。
- Produces: 枠の `<div class="blk task ...">` に class `imp` を足す。期限の行の件名 `<span>` に class `impt`。

- [ ] **Step 1: 失敗するテストを書く** — `renderCalendar` の週表示・日表示の両方で、重要で未完了のタスクの枠に `imp` が付き、`Done` のタスクの枠（実績）には付かない。週表示の期限の行で、重要のタスクの件名に `impt`。
- [ ] **Step 2: 失敗を確かめる** — `node --test tests/views.test.js`。
- [ ] **Step 3: 実装** — `sessionBlocks` は、枠のタスクを `data.tasks` から引いて `isImportantMark` を見る。CSS: `.blk.imp{box-shadow:inset 5px 0 0 var(--bad)}`、`.blk.imp` の件名と `.impt` に `color:var(--bad);font-weight:700`（枠の件名の class 名は `sessionBlocks` で確かめて合わせる）。枠の色（予定・実績・未確認）の class は変えない。`development.md` の「今日のタスクとスケジュール」に、スケジュールの印を足す。
- [ ] **Step 4: 通ることを確かめる** — `node --test tests/views.test.js`。
- [ ] **Step 5: 動作確認** — 赤字・太字が、予定（青緑）・実績（緑）・未確認（橙）の背景で読めるかを、画面で見る。読みにくければ `--bad` を濃い色にして、結果を `development.md` に書く（見られなければ「未確認」）。
- [ ] **Step 6: コミット** — `git commit -am "feat: スケジュールの枠・期限に重要の印"`。

---

### Task 5: 画面での期限変更の履歴を廃止する

**Files:**
- Modify: `src/ui/edit.js`（`isScreenLog`・`recordDueChanges`・`setLogCause` を削除）、`src/ui/app.js:729,752,1008`、`src/ui/views/project.js:38,74`（原因の選択欄 `causeSelect` を外す）、`src/core/schema.js:254`（`"screen"` を外す）
- Delete: `tests/due-log.test.js`
- Test: `tests/edit.test.js`、`tests/views.test.js`、`tests/schema.test.js`

- [ ] **Step 1: 失敗するテストを書く** — `tests/edit.test.js`: `updateTask` で期限を動かしても `changeLog.length` が変わらない。`tests/schema.test.js`: `source: "screen"` の履歴は error「changeLog: 不明な source」。`tests/views.test.js`: プロジェクト画面の履歴に `data-logcause` が出ない。
- [ ] **Step 2: 失敗を確かめる** — `node --test tests/edit.test.js tests/schema.test.js tests/views.test.js`。
- [ ] **Step 3: 実装** — 上の関数・呼び出し・原因の選択欄・`"screen"` を削除する。ドラッグ（`app.js:1008`）と期限欄（`:752`）は、`recordDueChanges` を外して、`updateTask`・`moveTaskDates` の結果をそのまま保存する。`tests/due-log.test.js` を削除する。`development.md`: 「ガントチャートとリスト」の履歴の記述と、設計判断の「画面での期限変更は、黙って履歴に残し」の項を、「画面の期限変更は履歴に残さない（依頼・取り込みの履歴だけ残す）」に直す。
- [ ] **Step 4: 通ることを確かめる** — 同じコマンド（PASS）。`grep -rn "setLogCause\|recordDueChanges" plugins docs tests` が 0 件。
- [ ] **Step 5: コミット** — `git commit -am "feat: 画面での期限変更の履歴を廃止する"`。

---

### Task 6: ID（プロジェクト `AA`〜`ZY`、タスク `AA-0001`）

**Files:**
- Modify: `src/ui/edit.js`（`idNumber`・`nextTaskId`・`addProject`）
- Test: `tests/edit.test.js`（`nextTaskId`・`addProject` の既存のテストを新形式に直す）

**Interfaces:**
- Produces: `nextProjectId(data): string`（使われていない最初の `AA`〜`ZY`。`ZZ` は返さない。使い切ったら `throw new Error("プロジェクトは 675 個までです")`）。`nextTaskId(data, projectId: string|null): string`（接頭辞は `projectId ?? "ZZ"`。いまのタスクと `changeLog.taskIds` の、`<接頭辞>-<4 桁>` の最大の番号 + 1。10000 になるなら `throw new Error("タスクの番号が 9999 を超えます")`）。`addProject` は `nextProjectId` を使う。

- [ ] **Step 1: 失敗するテストを書く** — `nextProjectId`: 空のデータで `"AA"`、`AA` が使用済みなら `"AB"`、`AZ` の次が `"BA"`、`ZY` まで使用済みなら例外（`ZZ` は返らない）、`XX` を作れる。`nextTaskId(d, "AA")` が `"AA-0001"`、`AA-0007` があれば `"AA-0008"`、`nextTaskId(d, null)` が `"ZZ-0001"`。`P1-0011` と `P11-0001` のような ID が互いの番号に影響しない（接頭辞は `^<接頭辞>-\d{4}$` の完全一致）。`AA-9999` があるとき例外。`changeLog.taskIds` にだけ残る `AA-0005` を数える。
- [ ] **Step 2: 失敗を確かめる** — `node --test tests/edit.test.js`。
- [ ] **Step 3: 実装** — `idNumber(id, prefix)` を `^<prefix>-(\d{4})$`（接頭辞は正規表現エスケープ）にし、`nextProjectId` を 2 文字の総当たり（`AA`〜`ZY`、`ZZ` を除く）で作り、`addProject` の A〜Z・`P1` の割り振りを置き換える。ID の形を検証する規則は足さない（手で書いた ID は、そのまま使える）。
- [ ] **Step 4: 通ることを確かめる** — `npm test`。ID をハードコードした既存のテスト・`sample.json`（`A1`・`X1` など）は生成関数を通らないので、変えなくても通る。通らないテストだけを新形式に直す。
- [ ] **Step 5: ドキュメント** — `development.md` の設計判断「タスクの ID は、消したあとも使い回さない」と「タスクが『プロジェクトなし』を持てる」（`X` + 連番）を新しい形に直す。`grep -n "X + 連番" docs/development.md` が 0 件。
- [ ] **Step 6: コミット** — `git commit -am "feat: ID を AA-0001 の形にし、26 個を超えても衝突しないようにする"`。

> **SPEC との差**: SPEC は「同梱の `sample.json`・既存のテストを新形式に書き直す」としているが、ID の形を検証しない設計なので、ハードコードされた旧形式の ID（テストに約 450 か所）は、通るかぎり書き換えない。全面の書き換えが必要なら、実行の前に伝える。

---

### Task 7: ガント・リストの ID 列の幅

**Files:**
- Modify: `src/ui/theme.css`（99 行目 `.tbl .id`、146〜147・277 行目の `.g-label` の `28px` 列）

- [ ] **Step 1: 実装** — `.g-label` の `grid-template-columns` の `28px` を、`AA-0001`（等幅 11px で 7 文字）が収まる幅（`56px`）に広げる（146 行目と 277 行目の 2 か所）。リストの `.tbl .id` は `white-space:nowrap` のままで、列幅は内容に従う。
- [ ] **Step 2: 動作確認** — 幅 1400・900・600px で、ガントのラベルの件名が極端に詰まらず、固定表示（`.thstrip`・`.gstrip`）がずれないことを、ID を `AA-0001` 形式にした一時データで見る（結果は `development.md` に。見られない幅は「未確認」）。
- [ ] **Step 3: コミット** — `git commit -am "style: ID が長くなる分、ガントのラベルの幅を広げる"`。

---

### Task 8: 突発タスクのボタン（ヘッダー）と入力欄

**Files:**
- Modify: `src/ui/app.js:80`（`filebar` の HTML にボタン `data-urgent-open`）とそのクリック処理（540〜546 行目の近く）、`submitUrgent`（560〜570 行目）、`src/ui/views/schedule.js`（`urgentForm`・`firstFreeStart` の追加）
- Test: `tests/views.test.js`

**Interfaces:**
- Produces: `firstFreeStart(data, date: string, now: {date,time}): string`（`views/schedule.js`。その日の勤務時間内で、会議・作業枠と重ならない空き時間のうち、`date === now.date` なら現在時刻以降で最初のものの開始 `HH:MM`。なければ勤務の開始時刻。`freeOf`・`calendarGeometry`・`snapFreeStart` を使う）。`urgentForm` に `data-ug="date"`（`type="date"`）と `data-ug="start"`（`type="time"`）の入力を足す。`addUrgentTask(data, { title, projectId, date, start, minutes }, now)` は、すでに日付と開始時刻を受けるので変えない。

- [ ] **Step 1: 失敗するテストを書く** — `firstFreeStart`: 勤務 09:00–18:00・会議が 09:30–10:30 の日で `now` が 09:00 なら `"09:00"`、09:20 なら `"10:30"`（`snapFreeStart` の刻みの規則に従う）、`now` が別の日なら勤務の開始以降の最初の空き、1 日すべて埋まっていれば `"09:00"`。`urgentForm`: 下書きの日付・開始時刻が `data-ug="date"`・`data-ug="start"` の値として出る。`tests/edit.test.js` ではなく、`submitUrgent` を切り出した純関数 `urgentInput(draftFields): { input } | { error } | null`（`app.js` 内、または `views/schedule.js`）で、件名・日付・開始時刻のどれかが空なら `null`（何も作らない）、そろっていれば `addUrgentTask` へ渡す入力を返すことをテストする。ボタンを押すと、`selSess`・`selMtg`・`mtgDraft`・`taskEdit` が空になること（`clearSel` が呼ばれること）は、`app-source.test.js` の流儀で、ボタンの処理の文字列に `clearSel()` があることで確かめる。
- [ ] **Step 2: 失敗を確かめる** — `node --test tests/views.test.js`。
- [ ] **Step 3: 実装** — ボタンの文言は「＋ 突発タスク」。押したとき: `clearSel()`、スケジュール画面へ移り（既存のナビの処理を通す）、`S.urgentDraft = { date: <スケジュール画面なら S.sdate、ほかは今日>, start: firstFreeStart(...), title: "", projectId: "", minutes: 30 }` として描き直し、件名にフォーカスする。`submitUrgent` は `date`・`start` を欄から読み、どちらかが空なら何もしない（下書きは残す）。空き時間（日表示）を押す既存の動きは変えない。週表示に空き時間を押す方法は足さない。
- [ ] **Step 4: 通ることを確かめる** — `node --test tests/views.test.js tests/edit.test.js`。
- [ ] **Step 5: 動作確認** — ガント・リスト・稼働・設定のどの画面でもボタンが出て、押すとスケジュール画面へ移って入力欄が開くこと。週表示で、日付・開始時刻を変えて追加でき、今日の枠なら「今日のタスク」に載ること。枠を置けない時刻（休みの日・重なり）でエラーが出て、タスクが作られず、欄が残ること。
- [ ] **Step 6: ドキュメント** — `development.md` の「空き時間からの突発タスクの登録」を、ボタンからの登録を含む形に直し、未確認を書く。
- [ ] **Step 7: コミット** — `git commit -am "feat: 突発タスクのボタンをヘッダーに置き、日付・開始時刻を指定できるようにする"`。

---

### Task 9: スケジュールからのタスク編集欄

**Files:**
- Modify: `src/ui/views/taskpop.js`（中身の部品を、窓と編集欄で共有できる形に分ける）、`src/ui/views/schedule.js`（選択中の枠の操作の行に「タスクを編集」・`#mtgslot` に編集欄）、`src/ui/app.js`（状態 `S.taskEdit = { id, full }`・クリック・描き直し）、`src/ui/theme.css`
- Test: `tests/views.test.js`

**Interfaces:**
- Produces: `renderTaskEditPanel(data, edit: { id: string, full: boolean }, statusHtml: string): string`（`taskpop.js`。軽い欄は件名・期限・開始・状態・重要・プロジェクト・メモ。`full` が真なら、繰り返し・チェックリスト・前のタスク・複製・削除を足す。ボタン `data-tedit-open="<ID>"`・`data-tedit-full`・`data-tedit-close`）。`renderSchedule` の `opts.taskEdit` で渡す。入力は既存の `data-f`・`data-id` を使うので、保存は既存の `change` の処理が行う。

- [ ] **Step 1: 失敗するテストを書く** — 作業枠を選んだ（`selSess`）画面に「タスクを編集」ボタン（`data-tedit-open`）が出る。`opts.taskEdit = { id, full: false }` のとき `#mtgslot` に編集欄が出て、件名・期限・開始・状態・重要・プロジェクト・メモの入力があり、繰り返し・前のタスクは無い。`full: true` では、繰り返し・チェックリスト・前のタスク・複製・削除がある。対象のタスクが無いとき、編集欄は空。
- [ ] **Step 2: 失敗を確かめる** — `node --test tests/views.test.js`。
- [ ] **Step 3: 実装** — `renderTaskPop` の項目の HTML を `taskFieldsHtml(data, t, { full, statusHtml })` に切り出し、窓は `full: true` で使う。編集欄は `S.taskEdit` で開閉し、読み直しで対象のタスクが消えたら閉じる（`S.tpop` と同じ扱い）。ほかの画面へ移る・Esc で閉じる。会議の編集欄・突発タスクの入力欄とは同時に開かない（`clearSel` で閉じる）。
- [ ] **Step 4: 通ることを確かめる** — `node --test tests/views.test.js`、`npm test`。
- [ ] **Step 5: 動作確認** — 枠を選んで「タスクを編集」→ 件名・期限・重要・プロジェクトを変えて保存でき、「詳細を開く」で全項目が出ること。プロジェクトを変えたあとも、枠は残ること。
- [ ] **Step 6: ドキュメント** — `development.md` の「ガントチャートとリスト」の編集の窓の項に、スケジュールの編集欄を足す。
- [ ] **Step 7: コミット** — `git commit -am "feat: スケジュールの編集欄（タスクの編集）"`。

---

### Task 10: リストの「プロジェクト」列

**Files:**
- Modify: `src/ui/views/project.js`（表の行 52 行目・見出し 85 行目）
- Test: `tests/views.test.js`

**Interfaces:**
- Consumes: 既存の `change` の処理（`app.js:743` の `f === "projectId"` が `moveToProject` を呼び、前後のタスクがあると例外で選択欄を元に戻す）。

- [ ] **Step 1: 失敗するテストを書く** — リストの各行に `data-f="projectId" data-id="<ID>"` の `select` があり、現在のプロジェクト（プロジェクトなしは空の値）が `selected`。見出しに「プロジェクト」。
- [ ] **Step 2: 失敗を確かめる** — `node --test tests/views.test.js`。
- [ ] **Step 3: 実装** — 行の `<td data-l="プロジェクト">` を、タスク名の列の後ろに足す。`syncThStrips` の複製は列の数に従うので、変えない。
- [ ] **Step 4: 通ることを確かめる** — `node --test tests/views.test.js`、`npm test`。
- [ ] **Step 5: 動作確認** — リストで、別のプロジェクトとプロジェクトなしへ移せること。前後のあるタスクは「先に外してください」で戻ること。幅 700px 以下で列が崩れないこと（見られなければ「未確認」）。
- [ ] **Step 6: コミット** — `git commit -am "feat: リストの各行にプロジェクトの選択欄"`。

---

### Task 11: 仕上げ（ビルド・docs の整合・全体の確認）

**Files:**
- Modify: `docs/development.md`、`README.md`・`docs/guide.md`（重要度・ID・突発タスクの記述）、`plugins/project-lens/assets/project-lens.html`（ビルドの出力）。`docs/flow.html` は、手順や分岐を変えていなければ触らない。

- [ ] **Step 1: 残りを洗い出す** — `grep -rn "importance" plugins docs README.md`（`setImportance` を除き 0 件）、`grep -rn "重要度" docs README.md plugins`、`grep -rn "recordDueChanges\|setLogCause" plugins docs`。出たものを直す。保存済みの操作名 `setImportance`（`OP_KINDS`）は残す（古い依頼の検証のため）。
- [ ] **Step 2: ビルドと全テスト** — `npm run build && npm test`（全件 PASS）。
- [ ] **Step 3: 識別子の照合** — `development.md` のバッククォートで囲んだファイル名・識別子が、コードに実在するか照合する（`CLAUDE.md` の区切りの作業）。
- [ ] **Step 4: コミット** — `git add -A && git commit -m "chore: ビルドとドキュメントの整合"`。PR の本文に、「`development.md`: 直した節の名前」を書く。
