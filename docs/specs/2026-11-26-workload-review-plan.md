# 稼働タブの見返しの見直し 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 稼働タブのタスクの集計を、日・週・月に従わせ、プロジェクト別の表に完了・進捗を足し、タスクの表にプロジェクトを出し、気づきをなくす。

**Architecture:** 集計は純関数（`core/week.js` に `rangeTasks`・`projectProgress`）。画面は `ui/views/workload.js`。ToDo タブの `weekTasks` は、`rangeTasks` の週版として動きを変えない。

**Tech Stack:** 素の JavaScript（ES Modules）、単一 HTML へのビルド、`node --test`。

**Spec:** `docs/specs/2026-11-26-workload-review-design.md`（矛盾したら設計書が優先）

## Global Constraints

- Windows 専用、Node 24 以上。`npm test`。`src/` を変えたら `npm run build` して `plugins/project-lens/assets/project-lens.html` をコミットする。
- 稼働の時間の集計（`core/workload.js`）、ToDo タブの候補の組・並び、データ形式は変えない。個人ファイルの `reviews` は読んで書き戻す（消さない）。画面に ID を出さない。文言は日本語。`esc()` で必ずエスケープ。
- PR 本文に「`docs/development.md`: 直した節の名前」。`development.md` に、版番号・PR 番号・日付・「以前は〜」を書かない。動作確認していないことは「未確認」。
- 設計書に無いことは、設計書の趣旨で決め、台帳に `Ruling:` で記録する。

## Review Focus

1. `weekTasks` の既存のテストが、1 つも変わらずに通る（ToDo タブの動きが変わらない）。
2. 日・週・月の境界: 日の範囲は 1 日、月の範囲の最初・最後の日、週をまたぐタスク、期限超過（今日基準）。
3. プロジェクトが 0 件・タスクが 0 件・プロジェクト未設定・存在しないプロジェクトの ID のタスク。
4. `reviews` が、`splitData`／`mergeData` と保存で消えない（気づきの画面を消しても）。
5. 稼働の時間の数字が変わらない。

---

## Task 0: ブランチ

- [ ] **Step 1:** `docs/workload-review`（設計書・計画書のコミットあり）から `feat/workload-review` を作る。作業は、メインとは別の作業ツリー（`D:\claude\local-repo\project-lens-wt-review`）で行う。

---

## Task 1: 純関数 `rangeTasks`・`projectProgress`

**Files:** Modify `plugins/project-lens/src/core/week.js`、`tests/week.test.js`

**Interfaces:**
- Produces: `rangeTasks(data, range, today) → rows`（`range = { start, end }`、行の形は `weekTasks` と同じ: `{ task, group, waiting, planned, actual, checked }`、並びも同じ）。`weekTasks(data, weekStart, today)` は `rangeTasks(data, { start: weekStart, end: addDays(weekStart, 6) }, today)`。
- Produces: `projectProgress(rows) → Map<projectId|null, { done, total }>`（`task.projectId` ごと。Done の行を数える）。

- [ ] **Step 1: 失敗するテストを書く:** `rangeTasks`: 「週の範囲で、`weekTasks` と同じ結果」「日の範囲（1 日）: その日に予定の枠があるタスクだけ『予定あり』、その日が期限のタスクは『期限』」「月の範囲: 月末が期限のタスクが入り、翌月が期限のタスクは入らない」「期限超過は、範囲によらず今日基準」「Done は、`doneAt` が範囲にあるものだけ（範囲外の Done は入らない）」「Cancelled は入らない」。`projectProgress`: 「プロジェクトごとの done / total」「`projectId` が null のタスクは null のキー」「空の行は空の Map」。既存の `weekTasks` のテストは、変えない。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。**
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: タスクの集計を、任意の期間で求める関数を足す`

---

## Task 2: 稼働の画面を作り直し、気づきを消す

**Files:** Modify `plugins/project-lens/src/ui/views/workload.js`、`plugins/project-lens/src/ui/app.js`、`plugins/project-lens/src/ui/theme.css`、`plugins/project-lens/src/core/week.js`（`setReview`・`weekSummary` の削除）、`tests/workload-view.test.js`、`tests/views.test.js`、`tests/app-source.test.js`、`tests/week.test.js`

**Interfaces:**
- Consumes: `rangeTasks`・`projectProgress`（Task 1）、`periodRange(period, date)`（`core/workload.js`）、`workload(...)` の行（`rows`・`unassigned`）。
- Produces: `renderWorkload(data, today, opts)` が、(a) プロジェクト別の表（今の列 + 「完了」「進捗」）、(b) 見出し「タスク」と、列「プロジェクト・タスク・進捗・予定・実績」の表を返す。`weekReviewHtml` は無くす。`renderWorkload` の引数・戻り値の型は変えない。「見返し」の見出し・「完了 X / Y 件…」の文・気づきの欄が出ない。

- [ ] **Step 1: 失敗するテストを書く:** 「プロジェクト別の表に『完了』『進捗』の列が出て、`n / m 件`（0 件は `—`）、合計の行に完了の合計」「プロジェクト未設定の行にも出る」「期間が日・週・月で、タスクの表の範囲が変わる」「タスクの表に『プロジェクト』の列（名前。未設定は『プロジェクトなし』）」「0 件で『この期間のタスクはありません。』」「見返しの見出し・`data-tdnote`・気づきが出ない」「稼働の時間の数字（タスク・会議・合計）が、変更前と同じ」「ID が出ない」。`app-source.test.js`: 「`tdnote` の処理・`focusSelector` の `tdnote` が無い」「`setReview` が `app.js` に無い」。`views.test.js`/`workload-view.test.js` の、見返し・気づきを前提にするテストは、新しい規則へ直す（弱めない）。`week.test.js`: `weekSummary`・`setReview` のテストを外し、`reviews` が `splitData`／`mergeData` で保たれるテスト（既存の split のテストの場所）を、無ければ足す。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。** `.tdreview`・`.td-note`・`.td-sum` の CSS と、使われなくなった import・関数は消す。
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: 稼働タブの見返しを期間に従わせ、プロジェクト別の完了・進捗を出し、気づきをなくす`

---

## Task 3: 文書・ビルド・実機の確認

**Files:** Modify `docs/development.md`、`docs/guide.md`、`README.md`、`plugins/project-lens/assets/project-lens.html`（生成物）

- [ ] **Step 1: `docs/development.md` を直す。** 「画面の動き > 会議と稼働」: 稼働の画面の形（プロジェクト別の表の完了・進捗・タスクの表）、期間に従うこと、`rangeTasks`、気づきをなくしたこと（ファイルの `reviews` は読んで書き戻すだけ）。「設計判断」に 1 項目（見返しを別の領域にせず稼働の表に統合した理由、`weekTasks` を `rangeTasks` の週版にした理由、`reviews` を消さない理由、見送った案: 案 B・プロジェクトの別表）。未確認は「未確認」。
- [ ] **Step 2: `docs/guide.md`・`README.md` の、稼働・週の見返し・気づきの説明を直す。**
- [ ] **Step 3: 照合する。** バッククォートの名前（`rangeTasks`・`projectProgress` など）がコードにあること。古い名前（`weekSummary`・`setReview`・`tdreview`・`data-tdnote`・「週の見返し」）が `docs/`・`README.md` に 0 件。
- [ ] **Step 4:** `npm run build && npm test`。件数と失敗 0 を記録する。
- [ ] **Step 5: 実機の確認（コントローラが行う）。** デモデータ、日・週・月の切り替え・←→。
- [ ] **Step 6: コミット** `docs: 稼働タブの見返しの見直しに合わせて文書を直す`
