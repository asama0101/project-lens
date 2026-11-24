# スケジュールの実績の見せ方と、ToDo タブの今日の ToDo 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 実績を持つ予定の枠・会議を 1 つのブロックで描き、会議の実績を消せるようにし、現在時刻の線・いまの枠・今日の強調を足し、ToDo タブに今日の ToDo とチェックの追加・削除を足す。

**Architecture:** 描き方の変更は `ui/views/schedule.js`（`sessionBlocks`・`meetingBlocks`・週表示の列）と `ui/theme.css` に閉じる。データ形式と集計は変えない。会議の実績の消去は、純関数 `clearMeetingActual`（`core/schedule.js`）。ToDo タブの今日の一覧は、純関数 `todayTasks`（`core/week.js`）。チェックの追加・削除は、既存の `addChecklistItem`・`removeChecklistItem`（`ui/edit.js`）を使う。

**Tech Stack:** 素の JavaScript（ES Modules）、単一 HTML へのビルド（`plugins/project-lens/tools/build.js`）、`node --test`。

**Spec:** `docs/specs/2026-11-25-schedule-actual-view-design.md`（設計書。矛盾したら設計書が優先）

## Global Constraints

- Windows 専用、Node 24 以上。テスト: `npm test`。`src/` を変えたら `npm run build` して `plugins/project-lens/assets/project-lens.html` をコミットする。
- データ形式は変えない。稼働・サマリー・未確認の判定の数字は変わらない。
- 画面に ID を出さない。文言は日本語。`esc()` で必ずエスケープ。用語は「タスク」。今日の列に背景色は付けない。
- 実績を持たない予定の枠・会議の見た目・ドラッグ・伸縮は変えない。
- 変更の PR 本文に、「`docs/development.md`: 直した節の名前」を書く。`docs/development.md` に、版番号・PR 番号・日付・「以前は〜」の経緯を書かない。動作確認していないことは「未確認」と書く。
- 計画で決めた点（設計書に無い名前）: データ属性は、枠の影が `data-ghost="<枠の id>"`、会議の影が `data-mghost="<会議の id>"`、実績のブロックは、枠が既存の `data-actbar="<枠の id>"`、会議が `data-mact="<会議の id>"`。影・実績のブロックの押下は、`data-dragsess`・`data-mtg` の押下と同じ選択の処理に入れる（`app.js` の、選択を外さないセレクタ 2 か所と、選択の処理）。

## Review Focus

1. 実績を持たない枠・会議は、描き方・属性・ドラッグが、変更前と同じ。（Task 2 のテスト）
2. 実績が、予定と別の日にあるとき: 実績のブロックは `actual.date` の列、影は予定の日付の列。表示範囲に片方しか入らないときも、例外にならず、描ける方だけ描く。（Task 2）
3. 同じ日・同じ時刻の実績は、影を描かない。（Task 2）
4. `confirmed: true` で `actual` の無い会議が、実績後の見た目で、予定の時刻に出る。（Task 2）
5. 参加しない会議（`skip`）には、いまの強調を付けない。日をまたぐ・今日以外の日には、赤い線・いまの強調を出さない。（Task 3）
6. チェックの追加・削除のあとの再描画で、入力欄の下書き（日付・時刻・状態・チェック）が消えない。空文字の項目は追加しない。（Task 5）

---

## Task 0: ブランチ

- [ ] **Step 1:** `docs/schedule-actual-view`（設計書・計画書のコミットあり）から、`feat/schedule-actual-view` を作る。以降の作業はこのブランチ。

---

## Task 1: 会議の実績を消す（`clearMeetingActual`）

**Files:** Modify `plugins/project-lens/src/core/schedule.js`、`tests/schedule.test.js`、`plugins/project-lens/src/ui/views/schedule.js`（会議の編集欄 `meetingForm` にボタン）、`plugins/project-lens/src/ui/app.js`（ハンドラ）、`tests/app-source.test.js`、`tests/views.test.js`

**Interfaces:**
- Produces: `clearMeetingActual(data, id): data`。`actual` を外し、`confirmed` を `false` にする。会議が無ければ、日本語の Error。入力は変えない。
- UI: 会議の編集欄（`meetingForm`）の、実績の入力のそばに、`confirmed === true` の会議のときだけ「実績を消す」ボタン（`data-mtgactclear="<会議の id>"`）。押すと `clearMeetingActual` を `apply` し、通知「会議の実績を消しました」。`S.actDraft` は外す。

- [ ] **Step 1: 失敗するテストを書く** `schedule.test.js`: 「`actual` と `confirmed` が外れる（`confirmed` は `false`）」「`actual` が無い確認済みの会議も、`confirmed` が `false` になる」「他の会議は変わらず、入力は書き換わらない」「会議が無いと Error」。`views.test.js`: 「確認済みの会議の編集欄に『実績を消す』が出る。確認済みでない会議・参加しない会議には出ない」。`app-source.test.js`: 「`data-mtgactclear` のハンドラが `clearMeetingActual` を `apply` する」。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。**
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: 会議の実績を消せるようにする`

---

## Task 2: 実績を持つ枠・会議を 1 つのブロックで描く

**Files:** Modify `plugins/project-lens/src/ui/views/schedule.js`（`sessionBlocks`・`meetingBlocks`・凡例 `legendHtml`）、`plugins/project-lens/src/ui/theme.css`、`plugins/project-lens/src/ui/app.js`（選択のセレクタ）、`tests/views.test.js`、`tests/app-source.test.js`

**Interfaces:**
- Consumes: `meetingActualSpan`（`core/schedule.js`）、既存の `sessionKind`・`allSessions`。
- Produces: 描き方は設計書の「カレンダー」のとおり。属性は、Global Constraints の「計画で決めた点」のとおり。
  - 枠: 実績のブロック（`data-actbar`）は、今までどおり `actual.date` の列に描く（ただし左右割りにしない: 実績を持つ枠自身の予定のブロックが無くなるため）。予定のブロックは、予定と同じ日・同じ時刻でなければ、影（`data-ghost`、class に `ghost`）に変える。同じなら描かない。影は `draggable` でなく、下端の伸縮の取っ手も無い。
  - 会議: `actual` を持つ会議は、実績の時刻に、1 つのブロック（`data-mact`、class `mtg act`）。ドラッグ・伸縮の属性は付けない。影は `data-mghost`。`confirmed: true` で `actual` の無い会議は、予定の時刻に `mtg act` で描く。
  - 左右割り: 実績を持つ枠の影は、重なりの判定に入れない。実績を持たない予定の枠と、実績のブロック・実績だけの枠の左右割りは、今のまま。
  - CSS: `.blk.ghost`（薄い点線の枠、背景は透明に近い、`z-index` はブロックより下）、`.blk.mtg.act`（会議の実績後の濃い見た目）、必要なら凡例の見本 `.sw` の更新。ダーク配色でも読める色を使う（既存の変数を使う）。

- [ ] **Step 1: 失敗するテストを書く（`views.test.js`）**
  - 「実績を持つ予定の枠は、実績のブロック（`data-actbar`）が 1 つだけ出て、予定の枠を示す `data-dragsess` は出ない。影は、予定と実績の時刻（または日付）が違うときだけ `data-ghost` で出る。同じなら影も出ない」
  - 「影は `draggable` でなく、`data-rz` を持たない。実績のブロックも、`draggable`・`data-rz` が無い」
  - 「実績が予定と別の日: 実績のブロックは `actual.date` の列、影は予定の日付の列」「表示範囲に実績の日だけが入る週・予定の日だけが入る週で、例外にならない」
  - 「実績を持たない予定の枠・実績だけの枠・実績を持たない会議は、変更前と同じ属性（`data-dragsess`・`draggable`・`data-dragmtg`）で出る」（Review Focus 1）
  - 「`actual` を持つ会議は、実績の時刻に `data-mact` の 1 つが出て、`draggable`・`data-rzm` が無い。時刻が違うときだけ `data-mghost` が出る」
  - 「`confirmed: true` で `actual` の無い会議は、予定の時刻に `act` の class で出る（`data-mact` ではない）。手動の会議は `draggable`」（Review Focus 4）
  - 「実績を持たない予定の枠が、実績のブロックと重なると、今までどおり左右に割る。実績を持つ枠の影は、割りに影響しない」
  - 「凡例の文言に、予定・未確認・実績が出る」
  - 既存のテスト（`data-actbar` と `data-dragsess` の両方を前提にするもの、右半分の位置を確かめるもの）は、新しい規則へ直す。弱めない。
  - `app-source.test.js`: 「`data-ghost`・`data-mghost`・`data-mact` の押下が、選択の処理に入り、欄外クリックで選択を外さない」。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。** `app.js` の、`[data-dragsess],[data-actbar],[data-mtg],…` を並べた 2 か所（選択を外さない判定と、選択の処理）に、新しい属性を足す。会議の選択は、会議の既存の処理（`selMtg`）を使う。
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: 実績を持つ予定の枠・会議を、実績の時刻の 1 つのブロックで描く`

---

## Task 3: 現在時刻の線（週表示）・いまのブロック・今日の強調

**Files:** Modify `plugins/project-lens/src/ui/views/schedule.js`、`plugins/project-lens/src/ui/theme.css`、`tests/views.test.js`

**Interfaces:**
- Consumes: `ctx.now`（`{date, time}`）、`calendarGeometry`。
- Produces: 
  - 週表示: 今日の列に、`nowline`（日表示と同じ見た目）を出す（今日が表示中の週に無ければ出さない）。
  - 進行中のブロック: 描いたブロックの時間（実績のブロックは実績の時刻、それ以外は予定の時刻）が、今の日付・時刻を含む枠・会議（`skip` を除く）に、class `now` と、時刻の前の「いま」の文字。影には付けない。
  - 今日の見出し: 週表示の今日の `.dh.t` を、塗りつぶし（`--accent` の背景・`--on-accent` の文字）にする。今日の列の上の線を、太くする。日表示のとき、今日なら、日付の見出しに同じ塗りの印を付ける。今日の列に背景色は付けない。

- [ ] **Step 1: 失敗するテストを書く（`views.test.js`）**: 「週表示で、今日が表示中の週にあるとき、今日の列にだけ `nowline` が出る。今日が週に無いとき、出ない」「日表示は今までどおり（今日の日付のときだけ出る）」「今 10:15 で 10:00-11:00 の枠・会議に class `now` と「いま」が付く。10:00-10:15（終了ちょうど）には付かない。開始ちょうど（10:15 開始）には付く」「`skip` の会議には付かない」「実績を持つ枠は、実績の時刻で判定する（予定は 9:00-10:00・実績は 10:00-11:00 で、10:15 なら付く）」「影・今日以外の日のブロックには付かない」「今日の見出しだけが、強調の class を持つ」。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。**
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: 週表示の現在時刻の線と、いまのブロック・今日の見出しを強調する`

---

## Task 4: ToDo タブの 2 列（今日の ToDo と週のタスク候補）

**Files:** Modify `plugins/project-lens/src/core/week.js`、`plugins/project-lens/src/ui/views/todo.js`、`plugins/project-lens/src/ui/views/prio.js`（`slotHtml` を export する）、`plugins/project-lens/src/ui/theme.css`、`plugins/project-lens/src/ui/app.js`（必要なら）、`tests/week.test.js`、`tests/views.test.js`

**Interfaces:**
- Produces: `todayTasks(data, today): TodayRow[]`。`TodayRow = { task, slots: [{ id, start, end, kind, actual }], waiting, planned, actual, checked }`。対象は、`today` の日付に、予定の枠（枠の `date`）か、実績の区間（`actual.date`・実績だけの枠）があるタスク（Cancelled を除く）。`slots` は、今日の枠（予定の枠は予定の時刻と `actual`、実績だけの枠は `kind: "actual"`）で、開始の昇順。`planned`・`actual` は、今日の日付の分。並びは、未完了を、今日の最初の枠の開始の昇順（同じなら ID）、Done を末尾に。
- UI: `renderTodo` の戻りを、左 `今日の ToDo（M/D）` と右 `この週のタスク候補`（週の移動の操作・組の見出し・行は今の `weekTasks` の一覧のまま）の 2 列にする。左の行は、右の行と同じ部品（件名・プロジェクト・状態・期限・進捗・分数・前のタスク待ち・「完了」）に、今日の枠の時刻と札（`slotHtml`）を足す。完了の入力欄は、どちらの列の行からでも開ける（`S.tdOpen` は、タスクの ID。左右に同じタスクがあるとき、両方の行に出さず、押した列の行にだけ出す: `S.tdOpen` に加えて、開いた列を `S.tdCol`（`"today"` か `"week"`）で持つ）。狭い幅（700px 以下）では縦に並べる。表示中の週に関わらず、左は今日。今日に枠のあるタスクが無いとき、左に「今日の枠のあるタスクはありません」を出す。

- [ ] **Step 1: 失敗するテストを書く**
  - `week.test.js`: `todayTasks`: 「今日に予定の枠のあるタスクが出る。今日に実績だけの枠・実績（`actual.date`）のあるタスクも出る。今日に何も無いタスクは出ない」「Cancelled は出ない。Done は末尾」「`slots` が開始の昇順。予定の枠が実績を持つとき、`actual` が付く」「`planned`・`actual` は今日の分だけ」「予定の枠が別の日にあって、実績だけが今日にあるタスクも出る」「`projectId` が null のタスクで例外にならない」。
  - `views.test.js`: 「左に『今日の ToDo』、右に『この週のタスク候補』の見出しが出る」「左の行に、今日の枠の時刻と札が出る。ID は出ない」「今日の枠のあるタスクが無いとき、空の文が出る」「表示中の週が今日の週でなくても、左は今日のタスクを出す」「『完了』を左の行で押したとき、入力欄は左の行にだけ出る（`S.tdCol`）」。既存の「この週のタスク」の見出しを前提にするテストは、新しい見出しへ直す。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。** `app.js` の、完了の押下（`data-tdopen`）のハンドラが、押した列を `S.tdCol` に持つ。画面・週の移動・キャンセル・保存で、`S.tdOpen`・`S.tdDraft` と同様に外す。`render()` の検証（`S.tdOpen` が無いタスクなら外す）を、`S.tdCol` にも当てる。
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: ToDo タブに、スケジュールの今日の枠から決まる「今日の ToDo」を足す`

---

## Task 5: 完了の入力欄で、チェックの項目を追加・削除する

**Files:** Modify `plugins/project-lens/src/ui/views/todo.js`、`plugins/project-lens/src/ui/app.js`、`plugins/project-lens/src/ui/theme.css`、`tests/views.test.js`、`tests/app-source.test.js`

**Interfaces:**
- Consumes: `addChecklistItem(data, taskId, text)`・`removeChecklistItem(data, taskId, itemId)`（`ui/edit.js`）、`tdFormDraft`（`ui/app.js` 内の、入力欄の値を下書きへ写す関数）。
- Produces: 入力欄の各項目の横に「×」（`data-tdckdel="<タスクの id>:<項目の id>"`）、項目の並びの末尾に、追加の欄（`data-tdckadd="<タスクの id>"`、`placeholder="＋ 項目を追加（Enter）"`）。
  - 追加: Enter（日本語入力の変換確定の Enter `isComposing` では追加しない）。空文字（前後の空白を除く）は追加しない。
  - 削除: 「×」。確認なし。
  - どちらも、押す前に、入力欄の値を `S.tdDraft` へ写し、`apply` で保存し、描き直す（日付・時刻・状態・チェックの状態が残る）。追加した項目は、未チェックで、下書きの `checks` に無い項目は、描くときにタスクの状態（未チェック）になる。削除した項目は、下書きの `checks` から外れる（描くとき無視する）。
  - 追加・削除が失敗したときは、通知だけで、入力欄はそのまま。
  - 入力中の保護（`isEditing`）の対象欄に、`tdckadd` を加える。

- [ ] **Step 1: 失敗するテストを書く（`views.test.js`・`app-source.test.js`）**: 「入力欄の項目の横に『×』、末尾に追加の欄が出る。チェックリストの無いタスクにも追加の欄が出る」「`tdckadd` の Enter が、`isComposing` を除いて、`addChecklistItem` を `apply` する」「追加・削除のハンドラが、`apply` の前に `S.tdDraft` へ写す」「`isEditing` の対象に `tdckadd` が入る」。`edit.test.js` に、既存の `addChecklistItem`・`removeChecklistItem` のテストが無ければ足す（空文字は Error。未知の項目の削除は Error）。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。**
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: 完了の入力欄で、チェックの項目を追加・削除できるようにする`

---

## Task 6: 文書・ビルド・実機の確認

**Files:** Modify `docs/development.md`、`docs/guide.md`、`README.md`、`plugins/project-lens/assets/project-lens.html`（生成物）

- [ ] **Step 1: `docs/development.md` を直す。** 「今日のタスクとスケジュール」（カレンダーの描き方: 実績の 1 ブロック・影・3 つの状態・予定を動かすには実績を消す・現在時刻の線・いまのブロック・今日の強調）、「会議と稼働」または会議の節（会議の実績のブロック・`clearMeetingActual`）、「ToDo タブ」（2 列・`todayTasks`・チェックの追加・削除はすぐ保存、チェックの付け外しは「保存」でまとめて）、「設計判断」に 1 項目（実績を持つ枠を 1 つのブロックにした理由。見送った案: 予定のブロックの中の帯・2 つ並べる・影もドラッグできる）。古い記述（予定のブロックと実績の帯を左右に並べる）を消す。動作確認していないことは「未確認」。
- [ ] **Step 2: `docs/guide.md`・`README.md` の画面の説明を直す。**
- [ ] **Step 3: 照合する。** `grep -n "実績の帯\|左半分\|右半分\|data-actbar" docs/development.md docs/guide.md README.md` で、古い描き方の記述が残っていないこと。バッククォートで囲んだ名前（`clearMeetingActual`・`todayTasks`・`data-ghost`・`data-mghost`・`data-mact`・`data-mtgactclear`・`data-tdckadd`・`S.tdCol`）がコードにあること。
- [ ] **Step 4:** `npm run build && npm test`。件数と失敗 0 を記録する。
- [ ] **Step 5: 実機の確認（コントローラが行う）。** Chromium・Playwright、`D:/claude/project-lens-demo-v0.4` のデモデータ、`showOpenFilePicker` の差し替え。確かめた項目は `development.md` に書き、確かめなかった項目は「未確認」と書く。
- [ ] **Step 6: コミット** `docs: スケジュールの実績の見せ方と ToDo タブの変更に合わせて文書を直す`
