# 読み込み中のファイルの表示 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ヘッダーに、読み込み中の共有・個人ファイルの札を出し、押すと詳細と「別のファイルを選ぶ」を出す。

**Architecture:** 読み書きは変えない。`store.js` に読み取り専用の `info()` を足し、純関数 `renderFileChips`（`ui/views/filechips.js`）が札と詳細を描き、`app.js` の `filebar` の描画と結線が使う。

**Tech Stack:** 素の JavaScript（ES Modules）、単一 HTML へのビルド、`node --test`。

**Spec:** `docs/specs/2026-11-26-file-badge-design.md`（矛盾したら設計書が優先）

## Global Constraints

- Windows 専用、Node 24 以上。`npm test`。`src/` を変えたら `npm run build` して `plugins/project-lens/assets/project-lens.html` をコミットする。
- ファイルの読み書き・競合検知・保存の動きは変えない。画面に ID を出さない。文言は日本語。`esc()` で必ずエスケープ。
- PR 本文に「`docs/development.md`: 直した節の名前」。`development.md` に、版番号・PR 番号・日付・「以前は〜」を書かない。動作確認していないことは「未確認」。
- 設計書に無いことは、設計書の趣旨で決め、台帳に `Ruling:` で記録する。

## Review Focus

1. `info()` が、読み書き・`loadedAt`・競合検知を変えない（呼ぶだけで副作用なし）。
2. 札の詳細を開いている間の描き直し・文字入力で、詳細が勝手に閉じない／タスクの入力を邪魔しない。外を押す・Escape・画面の移動で閉じる。
3. 「別の共有ファイル」「別の個人ファイル」の既存の処理（`data-open`）が、詳細のボタンから、今までどおり動く。ヘッダーに重複して残らない。
4. 日付の書式がローカル時刻で、日付が変わる境界（0 時前後）・更新日時が無いとき（「—」）で壊れない。
5. プロジェクトが 0 件・1 件・3 件・4 件、名前に HTML の記号があるとき。

---

## Task 0: ブランチ

- [ ] **Step 1:** `docs/file-badge`（設計書・計画書のコミットあり）から `feat/file-badge` を作る。

---

## Task 1: `info()` と、札・詳細の純関数

**Files:** Modify `plugins/project-lens/src/ui/store.js`、`tests/store.test.js`（既存のテストの場所に合わせる）。Create `plugins/project-lens/src/ui/views/filechips.js`、`tests/views.test.js`（または新しいテストファイル）。

**Interfaces:**
- Produces: `createStore(...).info() → { name: string|null, at: number|null }`（ハンドルの `name` と `loadedAt`）。`createPairStore(...).info() → { shared: {name, at}, personal: {name, at} }`。副作用なし。
- Produces: `renderFileChips(data, info, open) → string`。`info = { shared: { name, at, writable }, personal: { name, at, writable } }`、`open = "shared" | "personal" | null`。札 2 つ（`<button class="chip-btn" data-fileinfo="shared|personal" aria-expanded>`、点の class、名前）。`open` のとき、その札の下に詳細（`<div class="fileinfo" role="group" aria-label="…">`、`<dl>`、`<button class="btn" data-open="shared|personal">別の共有ファイルを選ぶ／別の個人ファイルを選ぶ</button>`）。中身は設計書 2。更新日時は「YYYY/MM/DD HH:MM」（ローカル時刻）、`at` が無ければ「—」。`writable` が偽なら「読み込み専用」。

- [ ] **Step 1: 失敗するテストを書く:** `info()`: 「`choose`／`restore` 後に name と at が入る」「何も開いていないと name が null」「`info()` を呼んでも `changed()`・`save` の動きが変わらない」。`renderFileChips`: 「札が 2 つ（名前・`data-fileinfo`・`aria-expanded` が `open` で変わる）」「`open: null` で詳細なし」「`open: "shared"` でプロジェクト名 3 件まで＋『ほか 1 件』（4 件のとき）・タスク件数（Done 件数）・更新日時（`new Date(2026,10,26,9,12).getTime()` → 『2026/11/26 09:12』）」「`at: null` で『—』」「`writable: false` で『読み込み専用』と橙の点の class」「個人の詳細に作業枠数・会議数」「`data-open` のボタンが詳細に 1 つ」「名前に `<` を含むプロジェクトがエスケープされる」「ID が出ない」。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。**
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: 読み込み中のファイルの札と詳細を描く関数と、ファイル情報の取得を足す`

---

## Task 2: ヘッダーに札を出し、開閉・ファイル選択を結線する

**Files:** Modify `plugins/project-lens/src/ui/app.js`、`plugins/project-lens/src/ui/theme.css`、`tests/app-source.test.js`

**Interfaces:**
- Consumes: `renderFileChips`・`store.info()`（Task 1）、既存の `data-open`（ファイルを選ぶ処理 ~287）、`filebar` の描画（`app.js` ~99）。
- Produces: `S.fileInfo`（`null | "shared" | "personal"`）。`filebar` の「別の共有ファイル」「別の個人ファイル」のボタンを外し、`renderFileChips` の出力に置き換える（ほかのボタンは今のまま）。`data-fileinfo` のクリックで開閉（同じ札なら閉じる）。外を押す・Escape・画面の移動・ファイルを選んだとき（`data-open`）に閉じる。`info` の `writable` は、`window.showOpenFilePicker` が関数のとき真。使えないブラウザでは、ファイル名・更新日時は分かる範囲で渡す（分からなければ `name: null` → 「選んだファイル」、`at: null`）。詳細の位置は札の下（`filebar` を `position:relative` にして `absolute`）。狭い幅で札が折り返す。

- [ ] **Step 1: 失敗するテストを書く（`app-source.test.js`）:** 「`filebar` の描画が `renderFileChips` を使い、`別の共有ファイル` の直書きが無い」「`data-fileinfo` のハンドラが `S.fileInfo` を開閉する」「Escape・画面の移動・`data-open` で `S.fileInfo` を null にする」「外を押したときの処理が詳細の中（`.fileinfo`・`[data-fileinfo]`）を外として扱わない」。
- [ ] **Step 2:** 失敗を確かめる。
- [ ] **Step 3: 実装する。** タスク編集・文字入力中の描き直しで、詳細が閉じない／入力が消えないこと（`isEditing`・描き直しの流儀に合わせる）。
- [ ] **Step 4:** `npm run build && npm test` が通る。
- [ ] **Step 5: コミット** `feat: ヘッダーに、読み込み中のファイルの札を出す`

---

## Task 3: 文書・ビルド・実機の確認

**Files:** Modify `docs/development.md`、`docs/guide.md`、`README.md`、`plugins/project-lens/assets/project-lens.html`（生成物）

- [ ] **Step 1: `docs/development.md` を直す。** 「画面の動き > 全体（ヘッダー）」に、札・詳細の中身・開閉の規則・`S.fileInfo`・`store.info()`・読み込み専用の表示。「設計判断」に 1 項目（札にして詳細を押して出す理由、フォルダの場所を出さない理由（ブラウザが渡さない）、ボタンを詳細へ移した理由、見送った案の理由）。未確認は「未確認」。
- [ ] **Step 2: `docs/guide.md`・`README.md` の、ファイルを開く・別のファイルを選ぶ説明を直す。**
- [ ] **Step 3: 照合する。** バッククォートの名前（`renderFileChips`・`S.fileInfo`・`data-fileinfo`・`info()` など）がコードにあること。
- [ ] **Step 4:** `npm run build && npm test`。件数と失敗 0 を記録する。
- [ ] **Step 5: 実機の確認（コントローラが行う）。** デモデータ、札の表示・詳細の開閉・「別のファイルを選ぶ」・狭い幅。
- [ ] **Step 6: コミット** `docs: 読み込み中のファイルの表示に合わせて文書を直す`
