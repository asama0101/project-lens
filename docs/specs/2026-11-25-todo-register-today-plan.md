# ToDo タブの今日のタスク登録 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ToDo タブで、突発タスクの登録と、候補のタスクを今日へ入れる操作（ボタンとドラッグ＆ドロップ）をできるようにする。

**Architecture:** データ形式・規則は変えない。突発タスクは、既存の `addUrgentTask` と入力欄 `urgentForm` を、ToDo タブの左の列に出す。「今日へ」は、既存の `addSession`（`core/sessions.js`）で、今日の予定の枠を足す。画面は `ui/views/todo.js`、結線は `ui/app.js`。

**Tech Stack:** 素の JavaScript（ES Modules）、単一 HTML へのビルド、`node --test`。

**Spec:** `docs/specs/2026-11-25-todo-register-today-design.md`（矛盾したら設計書が優先）

## Global Constraints

- Windows 専用、Node 24 以上。`npm test`。`src/` を変えたら `npm run build` して `plugins/project-lens/assets/project-lens.html` をコミットする。
- データ形式は変えない。画面に ID を出さない。文言は日本語。`esc()` で必ずエスケープ。用語は「タスク」。
- 既存のスケジュール画面の突発タスク・ドラッグ（`data-dragtask`）の動きは変えない。
- 変更の PR 本文に、「`docs/development.md`: 直した節の名前」を書く。`development.md` に、版番号・PR 番号・日付・「以前は〜」の経緯を書かない。動作確認していないことは「未確認」。
- 設計書に無いことは、設計書の趣旨で決め、台帳に `Ruling:` で記録する。

## Review Focus

1. 入力欄（突発・今日へ）の保存が失敗したとき、入力が消えない。（Task 1・2 のテスト）
2. 完了の入力欄（`S.tdOpen`）と「今日へ」の入力欄（`S.tdPlan`）が、同時に開かない。画面・週の移動で閉じる。（Task 2）
3. 完了済みの行（Done・Cancelled）に、「今日へ」とドラッグが出ない。（Task 2・3）
4. ヘッダーの「＋ 突発タスク」が、ToDo タブでは画面を移らず、ほかの画面では今までどおり移る。（Task 1）
5. ドラッグ＆ドロップが、スケジュール画面のドラッグ（`data-dragtask`）と干渉しない。（Task 3）

---

## Task 0: ブランチ

- [ ] **Step 1:** `docs/todo-register-today`（設計書・計画書のコミットあり）から `feat/todo-register-today` を作る。以降の作業は、このブランチ。

---

## Task 1: 突発タスクを ToDo タブで登録する

**Files:** Modify `plugins/project-lens/src/ui/views/todo.js`、`plugins/project-lens/src/ui/app.js`、`plugins/project-lens/src/ui/theme.css`（必要なら）、`tests/views.test.js`、`tests/app-source.test.js`

**Interfaces:**
- Consumes: `urgentForm(data, draft)`・`urgentDefaultStart`・`urgentInput`（`ui/views/schedule.js`）、`S.urgentDraft`、`addUrgentTask`（`ui/edit.js`）、既存の `data-urgent-open`・`data-urgsave`・`data-urgcancel`・`data-ug` の結線（`app.js`）。
- Produces: `renderTodo(data, today, opts)` が、`opts.urgentDraft`（下書きか null）を受け、あるとき、左の列「今日の ToDo」の見出しの下に `urgentForm` を出す。左の列の見出しの横に「＋ 突発タスク」（`data-urgent-open`）。`app.js` の `data-urgent-open` は、`S.screen === "todo"` のとき、画面を移さず、`S.urgentDraft` を作って描き直す（日付は今日。それ以外の画面は今までどおり）。登録が成功したとき、ToDo タブでは `S.sdate` を変えず、画面も移さない。Escape で、ToDo タブでも入力欄を閉じる。

- [ ] **Step 1: 失敗するテストを書く** `views.test.js`: 「`urgentDraft` を渡すと、左の列に突発タスクの入力欄（`data-ug="title"` など）が出る。渡さないと出ない」「左の列の見出しの横に『＋ 突発タスク』が出る」。`app-source.test.js`: 「`data-urgent-open` のハンドラが、ToDo タブでは画面を移さない（`S.screen = "schedule"` を呼ばない分岐がある）」「保存の成功が、ToDo タブでは `S.screen` を変えない」「Escape が ToDo タブでも入力欄を閉じる」「`scheduleOpts` 以外の `renderTodo` の呼び出しが `urgentDraft` を渡す」。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。** 失敗時（空の件名など）は、通知だけで、入力欄と入力が残る（今のスケジュール画面と同じ結線を使う）。
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: ToDo タブで突発タスクを登録できるようにする`

---

## Task 2: 候補のタスクを「今日へ」入れる

**Files:** Modify `plugins/project-lens/src/ui/views/todo.js`、`plugins/project-lens/src/ui/app.js`、`plugins/project-lens/src/ui/theme.css`、`tests/views.test.js`、`tests/app-source.test.js`

**Interfaces:**
- Consumes: `addSession(data, taskId, { date, start, end })`（`core/sessions.js`。`{ data, error?, warning? }` を返す）、`urgentDefaultStart(date, now)`（`ui/views/schedule.js`。15 分刻みに切り上げた開始）、`toHHMM`・`toMin`（`core/dates.js`）。
- Produces: `renderTodo(..., opts)` が `opts.plan`（`{ key: タスクの id, start, minutes }` か null）を受ける。右の列（週の候補）の、未完了の行に「今日へ」（`data-tdplan="<id>"`）。`opts.plan.key` の行の下に、入力欄: 開始（`data-tp="start"`、type time、step 900）、長さ（`data-tp="minutes"`、15/30/45/60、初期値 60）、「今日に入れる」（`data-tdplansave="<id>"`）、「キャンセル」（`data-tdplancancel`）。状態は `S.tdPlan`。`S.tdPlan` と `S.tdOpen` は、同時に開かない（一方を開くと、他方を `null` にする）。画面の移動・`clearSel`・週の移動・キャンセル・保存の成功で外す。`render()` の検証で、タスクが無ければ外す。保存: 押したときに欄の値を読み、先に `S.tdPlan` へ写し、`addSession` を `apply`（`end` = 開始 + 長さ。23:59 を超えるときは、`addSession` のエラーに任せる）。成功: 入力欄を閉じ、通知「『件名』を今日の HH:MM–HH:MM に入れました」（`warning` があれば、括弧で添える）。失敗: 通知だけで、入力欄と入力を残す。

- [ ] **Step 1: 失敗するテストを書く**
  - `views.test.js`: 「未完了の候補の行に『今日へ』が出る。Done・Cancelled の行（完了の組）には出ない」「`plan` を渡すと、その行の下に、開始・長さ・『今日に入れる』・『キャンセル』が出て、初期値が `plan` の値になる。ほかの行には出ない」「左の『今日の ToDo』の行には、『今日へ』が出ない」「ID が画面に出ない」。
  - `app-source.test.js`: 「`data-tdplan` が `S.tdPlan` を開き、`S.tdOpen` を外す。完了の押下が `S.tdPlan` を外す」「`data-tdplansave` が、先に `S.tdPlan` へ写してから、`addSession` を `apply` する」「失敗で `S.tdPlan` を外さない（成功のときだけ外す）」「`clearSel`・週の移動・`render()` の検証が、`S.tdPlan` を扱う」。
  - 結線を、純関数で確かめられる部分（初期値を作る関数 `planDefault(now)` など。置き場所は実装者が決める）は、単体テストで: 10:15 → 開始 10:15、60 分。10:16 → 10:30。23:50 → 23:45（`urgentDefaultStart` の規則）。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。** 入力欄の入力（`data-tp`）の変更は、`S.tdPlan` へ写す（`change`）。`isEditing` の保護と `focusSelector` に、`tp` を足す。
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: ToDo タブで、週の候補のタスクを今日へ入れられるようにする`

---

## Task 3: ドラッグ＆ドロップで今日へ入れる

**Files:** Modify `plugins/project-lens/src/ui/views/todo.js`、`plugins/project-lens/src/ui/app.js`、`plugins/project-lens/src/ui/theme.css`、`tests/views.test.js`、`tests/app-source.test.js`

**Interfaces:**
- Produces: 候補の行（未完了）に `draggable="true"` と `data-tdrag="<タスクの id>"`。左の列（`.tdtoday`）が、ドロップ先: `dragover` で `preventDefault`（ドラッグ中のタスクが、`data-tdrag` のときだけ）、ドラッグ中は、左の列に強調の class（例 `drop`）。`drop` で、`data-tdplan` を押したのと同じ処理（`S.tdPlan` を開き、`S.tdOpen` を外し、描き直し）。`dragend` で強調を外す。既存のスケジュール画面のドラッグ（`data-dragtask`・`data-dragsess`・`data-dragmtg`）のハンドラは、`data-tdrag` を扱わない（`closest()` に当たらない）。

- [ ] **Step 1: 失敗するテストを書く** `views.test.js`: 「未完了の候補の行に `draggable` と `data-tdrag` が付く。完了の行・左の列の行には付かない」「左の列が、ドロップ先として出る」。`app-source.test.js`: 「`dragstart`・`dragover`・`drop`・`dragend` の結線が `data-tdrag` を扱い、`drop` が `S.tdPlan` を開く」「既存の `data-dragtask` のハンドラが `data-tdrag` を処理しない」。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。** 既存の dragstart/drop の実装（`app.js` の ~990〜1080 行）の流儀（`dataTransfer`・`effectAllowed`・プレビュー）に合わせる。
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: 週の候補のタスクを、今日の ToDo へドラッグして入れられるようにする`

---

## Task 4: 文書・ビルド・実機の確認

**Files:** Modify `docs/development.md`、`docs/guide.md`、`README.md`、`plugins/project-lens/assets/project-lens.html`（生成物）

- [ ] **Step 1: `docs/development.md` を直す。** 「ToDo タブ」の節に、突発タスクの登録（左の列・ヘッダーのボタンの動き）、「今日へ」の入力欄（初期値・規則・`S.tdPlan`・完了の入力欄と同時に開かない）、ドラッグ＆ドロップ（`data-tdrag`）を足す。「設計判断」に 1 項目（今日の枠の時刻を、入力欄で決める理由。見送った案: 自動で空きに入れる／「今日やる」の印を持つ、の理由）。動作確認していないことは「未確認」。
- [ ] **Step 2: `docs/guide.md`・`README.md` の ToDo タブの説明を直す。**
- [ ] **Step 3: 照合する。** `grep` で、バッククォートの名前（`S.tdPlan`・`data-tdplan`・`data-tdrag`・`planDefault` など）がコードにあること。
- [ ] **Step 4:** `npm run build && npm test`。件数と失敗 0 を記録する。
- [ ] **Step 5: 実機の確認（コントローラが行う）。**
- [ ] **Step 6: コミット** `docs: ToDo タブの今日のタスク登録に合わせて文書を直す`
