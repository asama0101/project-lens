# 監査の指摘 5 件の修正

## 目的と理由
`/ponytail-audit`（2026-11-24）の指摘 1〜5 を、1 つの作業で直す。画面が固まる不具合を直し（1）、古い文書を消し（2）、`app.js` の判断ロジックをテストできる形にし（3）、保存まわりの 2 つの小さなずれを直す（4・5）。

## ゴール / 非ゴール
- ゴール: 下の 5 項目すべてについて、「確かめること」が満たされ、`npm test` が通る。
- 非ゴール: `app.js` 全体のファイル分割、画面の見た目と操作の変更、データ形式（`data.json`・`personal.json`）の変更。
- アンチゴール: 既存の保存の競合処理（`saveMerged`・`write` の `behind`・`prior`）の動作を変えること。

## 制約
- Windows 専用、Node 24 以上。`src/` を変えたら `npm run build` して `assets/project-lens.html` をコミットする。
- `build.js` は `export { }`・`import * as`・`import { a as b }`・循環参照を受け付けず、`MODULES` の順で並べる。新しいファイルを足すときは `MODULES` に入れる。
- 変更の PR 本文に「`development.md`: 直した節の名前」を書く（`CLAUDE.md` の決まり）。

## 1. 描画の例外で画面が固まらないようにする
- 現状: `render()` は `view.innerHTML = renderBody()` を `try` なしで呼ぶ。手で直した `due` が不正（例 `2026-13-40`）だと、`rankTasks` が例外を投げ、画面が描き直されない。バナーも出ない（コードをたどった結論。ブラウザでは未確認）。
- 変更: `render()` で `renderBody()` を `try/catch` で囲む。例外のときは、`#view` に「画面を描けません: <理由>。data.json を直してから、再読込してください」の旨を出し、バナーは `refreshBanner()` で検証の結果（`validate` が日付の不正を `errors` に出す）を出す。
- 見送った案: 読み込み時に `validate` が `errors` を返したらファイルを開かない。理由: 直すために画面で開けなくなる。ほかの項目は使える場合もある。
- 確かめること: 不正な `due` を持つデータを `render` に渡すテスト（`tests/` の既存の DOM 差し替えの流儀に合わせる）が、例外を投げずに、案内を出す。実機（Chromium・Playwright）でも 1 回確かめる。

## 2. 古い計画書・仕様書を削除する
- 変更: `docs/superpowers/`・`docs/grill-spec/`・`docs/spec-grill/` を削除する（計 10 ファイルと `.svg` 2 つ）。新しい spec は `docs/specs/` に置く。
- 削除前に、`grep -rn "grill-spec\|spec-grill\|superpowers/" --include=*.md --include=*.js --include=*.json --include=*.html .` で参照を探して直す。0 件になってから消す。`.superpowers/`（git 無視）は対象外。
- 残す価値のある判断が見つかったら、`development.md` の「設計判断」に 1 項目足す。経緯・日付は書かない。
- 確かめること: 上の grep が 0 件。`npm test` が通る（文書を読むテストがあれば、その結果も）。

## 3. `app.js` の判断ロジックを、DOM に触れない関数に出す
- 設計の見立て: 判断そのもの（`moveSession`・`moveTask`・`applyProposal` など）は、すでに `src/core` と `inboxops.js` の純関数にある。`app.js` に残る問題は、DOM（`dataset`・`getBoundingClientRect`・`closest`）の読み取りと、判断が 1 つの関数に混ざっていること。そのためテストが、ソースの文字列を `assert.match` で探す形（`tests/app-source.test.js`）になっている。`S`（共有の状態）と `apply`・`render` を、全モジュールが共有するため、`app.js` 全体を仕事ごとのファイルに割ると、`S` を渡す口が増え、`build.js` の制約（順序・循環）にも当たる。割るのは、見送る。
- 変更: 次の 3 つだけ、「DOM を読む部分」と「判断する部分」に分ける。判断する部分は、`src/core/` の新しいファイル `dnd.js` と、`src/ui/inboxops.js` に置く。
  - `planDrop`: DOM から `{ date, at（分）, kind, id }` を読む部分は `app.js` に残す。`{ st, end, error, warning, next, msg }` を出す判断を、`planDropAt(data, drag, { date, at }, now)` として `dnd.js` に出す。
  - `planOrder`・`planCkOrder`: DOM から、落とし先の行の情報（`{ id, pid, g, sg }` の並びと、上半分か下半分か）を読む部分を残し、`beforeId`・`pos` を決める判断を、`dnd.js` に出す。
  - `approveRequest`: `apply` に渡す編集（`getRequest` の確認 → `applyProposal` → `markApplied`、`stale` のとき `markFailed`）を、`approveEdit(id, { reason, cause, today, now })`（data → data）として `inboxops.js` に出す。
- 行わないこと: ガントのドラッグ（`:1072-1150`）、帯の描画（`renderBar` ほか）、クリック・入力の結線の移動。
- `tests/app-source.test.js`: 移した関数に関する文字列の検査（`planDrop`・`approveRequest` の中身を見るもの）は、新しい関数の単体テストに置き換える。ほかの検査は、そのまま残す。
- 確かめること: `dnd.js` と `approveEdit` の単体テスト（枠・会議・タスクのドロップ、上半分・下半分、見出しへの落とし、同じ位置で `null`、`stale` のとき `failed` になる）。移す前後で、既存の `views.test.js`・`edit.test.js`・`inboxops.test.js` が変わらず通る。Playwright で、枠のドラッグ・タスクの並べ替え・提案の承認を 1 回ずつ実行する。

## 4. `choose()` が、書き込みの拒否を無視しない
- 現状: `choose()`（`store.js`）は `await ensureWritable(h)` の戻り値を使わない。許可を拒んでも開き、最初の保存で初めて失敗する。
- 変更: `reopen()` と同じ文言で、`false` なら例外にする。`handle`・`loadedAt` は切り替えず、記憶もしない（`switchTo` の前で止める）。
- 確かめること: `tests/store.test.js` に「許可を拒むと `choose` が例外になり、`handle`・記憶が変わらない」を足す。

## 5. 読み直しの判定を、更新日時で先に行う
- 現状: `pollInbox`（`sync.js`）は、4〜16 秒ごとに `store.peek()` で全データを読み、`JSON.stringify` で画面のデータと比べる。
- 変更: `store.changed()` を足す。`createStore` では、`(await handle.getFile()).lastModified !== loadedAt`。`createPairStore` では、2 つのどちらかが変わっていれば `true`（`behind`・`prior` の状態は見ない）。`pollInbox` は、`changed()` が `false` なら `renderBar()` だけして終わる。`true` なら、今までどおり `reload()` して、`bodyChanged` で描き直しを決める。`peek` は使われなくなるので、`store.js` から消す。
- 見送った案: 内容の比較を残して更新日時と併用する。理由: 更新日時が同じで内容だけ違う状況は、保存の競合の判定（`save`）が前提にしているのと同じ前提でしか起きない。二重にしても得るものがない。
- 注意: 自分の保存のあとは `loadedAt` が進むので、自分の書き込みでは `changed()` は `true` にならない。`createPairStore.write` が一部だけ書けたあとの状態（`behind`）は、`changed()` では検出せず、従来の `write` の競合処理に任せる。
- 確かめること: `tests/store.test.js`・`tests/pairstore.test.js`・`tests/sync.test.js` の、`peek` を使うテストを `changed` に置き換える。「他が書いたら `true`、自分が保存したあとは `false`、`reload` したあとは `false`」「`pollInbox` は、変わっていなければ `reload` を呼ばない」。

## 実施の順序
1. 2（削除）→ 4・5（`store.js`・`sync.js`）→ 1（`render`）→ 3（分離）の順に、1 項目ずつ。各項目で `npm test` を通す。
2. 完了前に `npm run build` し、`assets/project-lens.html` をコミットする。`development.md` の「設計判断」と、保存・読み直しの節（`peek`・`changed`）を直し、`grep -n "peek" docs/development.md` を 0 件にする。`docs/flow.html` は、`skills/`・`agents/`・`tools/` の手順を変えないので対象外。

## 未確認
- 1 の、画面が固まる状況の実機での再現（コードをたどっただけ）。
- 3 の分離後の、ドラッグ操作の体感（Playwright では、位置の計算の結果までを見る）。
