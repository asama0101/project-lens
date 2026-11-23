# データの分割（共有ファイル + 個人ファイル）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SPEC の依頼 1（複数人で使うための、スケジュール・稼働の分離）を実装する。`data.json`（共有）と `personal.json`（個人）の 2 つにファイルを分け、画面・CLI・見張り・各スキルがその 2 つを扱えるようにする。

**Architecture:** **メモリ上のデータは、いまと同じ 1 つの形（作業枠は `tasks[].sessions`、会議・依頼・個人の設定も同じ場所）のまま**にして、`core/`・`ui/`・取り込みのコードを変えない。ファイルに書く・読む境界（`core/split.js` の `splitData`・`mergeData`）だけで、2 つに分け・戻す。画面は、既存の単一ファイルの `createStore` を 2 つ束ねる `createPairStore` を足し、同じ公開メソッドを返す（`sync.js` はほぼ変えない）。CLI は `tools/cli.js` に、2 ファイルを読み書きする `readData`・`saveData` を足し、各ツールがそれを使う。

**Tech Stack:** Node.js 24 以上・外部パッケージなし。`node --test`。ブラウザ側は File System Access API。

**Spec:** `docs/grill-spec/specs/2026-11-23-lens-multi-user-important-design.md`（図: 同名の `.svg`）

**前提:** `2026-11-23-important-ids-urgent.md` の計画を先に実装して、main に入れてから始める（`important`・新 ID・`changeLog` の `screen` 廃止を前提にする）。

## Global Constraints

- Windows 専用・Node.js 24 以上・外部パッケージを使わない。`plugins/project-lens/src/` を変えたら `npm run build` して `assets/project-lens.html` をコミットする。
- 振る舞い・規則を変えたら、同じ作業の中で `docs/development.md` の対応する節を直す。直した節の名前を PR の本文に書く。`skills/`・`agents/`・`tools/` の手順や分岐を変えたら、`docs/flow.html` の対応する箇所も直し、変えた分岐を実行して確かめる（確かめていない箇所は「未確認」）。
- 互換性は考慮しない。1 ファイルの旧 `data.json` の移行・読み替えは作らない。
- 共有ファイル（`data.json`）: `projects`・`tasks`（`sessions` を含まない）・`changeLog`・共有の設定（`countWeekendsAndHolidays`・`nationalHolidays`・`waitingLongDays`・`projectRules`・`labels`・`wbsMappings`・`wbsImports`。ほかの未知の設定のキーも共有）。
- 個人ファイル（既定 `<保存先>/personal.json`）: 直下に `sessions`（`taskId` を持つ平らな配列）・`events`・`settings`（`workday`・`holidays`・`workdays`・`selfEmails`・`selfNames`）・`inbox`。
- CLI は `--data`（保存先）に加えて `--mine <ファイル>`。省略時は `<保存先>/personal.json`。
- 画面は、2 つのファイルが揃うまで開かない（足りない方を選ぶよう案内）。保存・競合の検知・当て直し・自動の読み直しは、ファイルごとに独立。
- 共有ファイルに無いタスクの作業枠は、バナーで知らせ、カレンダーに出さず、データも消さない。「該当の枠を削除」ボタン（確認つき）で消す。
- 他の人の稼働の表示・担当者の項目・https の直接読み書きは作らない。
- 既存の流儀: 編集・検証の関数は、不正な入力で `throw new Error(日本語の文)`。CLI の保存は、検証に通ったときだけ書く（`tools/cli.js` の `save`）。

## Review Focus

- 共有ファイルに無いタスクの作業枠が、保存で失われない（`splitData` が個人ファイルへ書き戻す）。
- 設定のキーが、共有と個人に正しく振り分けられ、未知のキーは共有に残る。個人の設定が共有ファイルに混ざらない。
- 片方のファイルだけが変わった保存で、もう片方を書き換えない（更新日時が変わらず、競合の誤検知が起きない）。
- 2 つ書く操作で片方が失敗したとき、通知し、書けなかった方は、次の保存で再び書く対象になる。
- 前回の記憶が片方だけのとき、足りない方だけを案内し、画面を開かない。
- CLI で `personal.json` が無いとき（`--mine` の指定違い）、共有ファイルを壊さず、分かる文言のエラーにする。`--mine` の相対パスは、実行時のフォルダ基準。
- 共有のタスク ID を変えずにプロジェクトを移しても（`moveToProject`）、作業枠が結びついたまま残る。

---

## File Structure

| ファイル（`plugins/project-lens/` から） | 役割 |
|---|---|
| `src/core/split.js`（新） | `splitData`・`mergeData`・`removeOrphanSessions`・`emptyPersonal`・各ファイルの形の検査 |
| `src/core/schema.js` | `data.orphanSessions` が空でないときの警告 |
| `tools/cli.js` | `readData`・`saveData`・`takeMine`（2 ファイルの読み書き） |
| `tools/{inbox,intake,holidays,validate,init}.js` | `readData`・`saveData` と `--mine` を使う |
| `src/ui/store.js` | `createPairStore`（2 つの `createStore` を束ねる）。`createStore` は `key` を受ける |
| `src/ui/app.js`・`sync.js`・`index.html` | 2 つのファイルを開くボタン・案内・バナー・書き出し |
| `skills/*/SKILL.md`・`agents/*.md` | `--mine` の説明 |
| `docs/development.md`・`docs/guide.md`・`README.md`・`docs/flow.html` | 仕様・手順の更新 |

---

### Task 1: 分割・結合の純関数（`core/split.js`）

**Files:**
- Create: `plugins/project-lens/src/core/split.js`
- Test: `tests/split.test.js`

**Interfaces:**
- Produces（すべて `split.js` から export）:
  - `SHARED_SETTINGS: string[]` / `PERSONAL_SETTINGS: string[]`（上の Global Constraints のキー）。
  - `splitData(data): { shared: object, personal: object }` — `shared` = `{ projects, tasks（sessions を除く）, changeLog, settings（共有のキー）, version }`。`personal` = `{ version, sessions: [{ ...session, taskId }], events, settings（個人のキー）, inbox }`。`data.orphanSessions` は、`personal.sessions` に含める。`inbox` が無ければ `personal.inbox` も作らない。
  - `mergeData(shared, personal): object` — `tasks[].sessions` に、`taskId` で枠を戻す（`taskId` は枠から外す）。共有ファイルに無い `taskId` の枠は、`orphanSessions`（`taskId` つき）に入れる。`settings` は両方を合わせる。`events`・`inbox` は個人から。
  - `removeOrphanSessions(data): object` — `orphanSessions` を空にする。
  - `emptyPersonal(): object` — `{ version: 1, sessions: [], events: [], settings: {} }`。
  - `checkSharedShape(x)` / `checkPersonalShape(x)` — `projects`・`tasks`・`changeLog`／`sessions`・`events` が配列でないと `throw new Error("<ファイル名>のデータの形が違います（<キー> がありません）")`。

- [ ] **Step 1: 失敗するテストを書く** — `tests/split.test.js`: (a) `sample.json` を `splitData` → `mergeData` して、元と `deepEqual`（枠の順は、タスク順・枠の順のまま）。(b) `shared.tasks` のどのタスクにも `sessions` が無い。(c) 設定の振り分け（`workday`・`holidays` は personal、`nationalHolidays`・`projectRules`・未知のキー `reportShowMeetingTitles` は shared）。(d) 共有に無い `taskId` の枠は `mergeData` で `orphanSessions` に入り、タスクの `sessions` に入らない。(e) `orphanSessions` を持つデータを `splitData` → `mergeData` しても、枠は消えない。(f) `removeOrphanSessions` が空にし、ほかのデータを変えない。(g) `checkSharedShape({})` が「data.json」の文言で例外、`checkPersonalShape({ sessions: [] })` が例外。(h) `moveToProject` でタスクのプロジェクトを変えたデータを `splitData` → `mergeData` しても、そのタスクの作業枠が、タスクに結びついたまま残る。
- [ ] **Step 2: 失敗を確かめる** — `node --test tests/split.test.js`（FAIL: モジュールが無い）。
- [ ] **Step 3: 実装** — 上の署名どおりに `split.js` を書く。新しいオブジェクトを返し、入力は変えない（`edit.js` と同じ）。
- [ ] **Step 4: 通ることを確かめる** — `node --test tests/split.test.js`（PASS）。
- [ ] **Step 5: コミット** — `git add -A && git commit -m "feat: 共有ファイルと個人ファイルへ分ける純関数（split.js）"`。

---

### Task 2: 検証の警告（共有ファイルに無いタスクの作業枠）

**Files:**
- Modify: `src/core/schema.js`（`validate` の末尾）
- Test: `tests/schema.test.js`

- [ ] **Step 1: 失敗するテストを書く** — `validate({ ...ok, orphanSessions: [{ id: "S9", taskId: "ZZ-0001", date, start, end, kind: "planned" }] })` の `warnings` に「共有ファイルに無いタスクの作業枠が 1 件あります」を含み、`errors` は空。`orphanSessions` が無い・空なら、その警告は出ない。
- [ ] **Step 2: 失敗を確かめる** — `node --test tests/schema.test.js`。
- [ ] **Step 3: 実装** — `validate` の最後に、`data.orphanSessions?.length` があれば `warn(\`共有ファイルに無いタスクの作業枠が ${n} 件あります\`)`。
- [ ] **Step 4: 通ることを確かめる** — `node --test tests/schema.test.js`。
- [ ] **Step 5: コミット** — `git commit -am "feat: 共有ファイルに無いタスクの作業枠を、検証の注意にする"`。

---

### Task 3: CLI の 2 ファイル読み書き（`tools/cli.js`）

**Files:**
- Modify: `plugins/project-lens/tools/cli.js`
- Test: `tests/cli.test.js`

**Interfaces:**
- Produces:
  - `takeMine(argv: string[]): { mine: string|null, rest: string[] }` — `--mine <ファイル>` を取り除く（`takeData` と同じ書き方に合わせる）。
  - `personalPathOf(path: string, mine?: string|null): string` — `mine` があれば `resolve(mine)`、なければ `join(dirname(path), "personal.json")`。
  - `readData(path, mine?): object` — 共有（`path`）と個人（`personalPathOf`）を `readJson` で読み、`checkSharedShape`・`checkPersonalShape` を通して `mergeData` する。個人ファイルが無ければ、共有ファイルは読み、個人は `emptyPersonal()` として扱う（`ENOENT` だけ。ほかの読み取り失敗は例外）。
  - `saveData(path, data, rename?, { backup = true, mine } = {}): void` — `validate(data)` を、結合したデータで 1 回通し、エラーなら何も書かない。通ったら `splitData` し、**内容が変わった方だけ**を、既存の `save` と同じ手順（一時ファイル・競合の確認・`.bak`・`rename`）で書く。`save` は、検証を省くオプション `{ validate: false }` を受ける形に直す。
- 既存の `save(path, data, rename, opts)`・`readJson` の使い方は、他のツールに影響しないよう残す。

- [ ] **Step 1: 失敗するテストを書く** — 一時フォルダに、`splitData(sample)` の 2 ファイルを書いて: (a) `readData` が `sample.json` と等しい。(b) 個人ファイルが無いと、共有だけ読めて `events` が空。(c) 共有だけが変わるデータを `saveData` すると、`personal.json` の更新日時が変わらない。(d) 検証エラー（`projects` に不正な状態）のデータは、どちらのファイルも変えず例外。(e) `--mine` で別の場所の個人ファイルを指して読み書きできる。(f) `takeMine(["a.json","--mine","p.json","x"])` が `{ mine: "p.json", rest: ["a.json","x"] }`。(g) 読んだあとに他が書き換えたファイルがあると、`saveData` は「他で更新されました」で例外にし、もう片方も書かない（書く前に両方の鮮度を確かめる）。
- [ ] **Step 2: 失敗を確かめる** — `node --test tests/cli.test.js`。
- [ ] **Step 3: 実装** — 上の署名どおり。2 つを書く前に、両方の `assertFresh` を先に行う（片方だけ書いてから、もう片方の競合に気づく形にしない）。書く順は、共有 → 個人。2 つ目が失敗したときは、1 つ目はそのまま（巻き戻さない）で、例外の文言に、書けたファイルと書けなかったファイルを書く。
- [ ] **Step 4: 通ることを確かめる** — `node --test tests/cli.test.js`（PASS）。
- [ ] **Step 5: コミット** — `git commit -am "feat: CLI に 2 ファイルの読み書き（readData・saveData・--mine）"`。

---

### Task 4: 各 CLI ツールを 2 ファイルに対応させる

**Files:**
- Modify: `tools/inbox.js`・`tools/intake.js`・`tools/holidays.js`・`tools/validate.js`・`tools/init.js`（それぞれ、`readJson`/`save` の呼び出しを `readData`/`saveData` にし、`takeMine` で `--mine` を受ける）。`tools/doctor.js` は、保存先のフォルダの診断だけなので変えない。
- Test: `tests/inbox-cli.test.js`、`tests/intake-cli.test.js`、`tests/holidays-cli.test.js`、`tests/init.test.js`、`tests/cli.test.js`

**Interfaces:**
- Consumes: `readData`・`saveData`・`takeMine`（Task 3）。
- Produces: `init` は、保存先に `data.json` と `personal.json` を作る（`--sample` のときは、同梱の `data/sample.json`〈分割前の形のサンプル〉を `splitData` して 2 ファイルに書く）。`init` が書く `.gitignore` の除外は、`.project-lens/` のまま。

- [ ] **Step 1: 失敗するテストを書く** — 各ツールのテストが、2 ファイルの一時フォルダ（`data.json`・`personal.json`）で動くこと。`inbox.js claim/ask/propose/approve` が、依頼（個人の `inbox`）とタスク（共有）の両方を更新する。`intake.js calendar-*` が `personal.json` の `events` だけを変え、`wbs-apply` が `data.json` の `tasks` を変える。`holidays.js update`（取得先は環境変数で差し替え）が `data.json` の `nationalHolidays` を書く。`init` が 2 ファイルを作り、`--sample` で作業枠が `personal.json` に入る。`--mine` で別の場所を指したとき、そこが読み書きされる。個人ファイルが無い保存先での `validate.js` は、共有だけ検証して成功する。
- [ ] **Step 2: 失敗を確かめる** — `node --test tests/inbox-cli.test.js tests/intake-cli.test.js tests/holidays-cli.test.js tests/init.test.js`。
- [ ] **Step 3: 実装** — 各ツールの主処理を直す。位置引数の `<data.json>` の意味は変えない。`inbox.js wait`（見張りの印を書く）は `saveData(..., { backup: false })`。
- [ ] **Step 4: 通ることを確かめる** — 同じコマンド、続けて `npm test`（PASS）。
- [ ] **Step 5: スキル・エージェントの手順** — `grep -rn "data.json" plugins/project-lens/skills plugins/project-lens/agents` で、コマンドの書式を示す箇所に、「個人ファイルは、同じフォルダの `personal.json`。別の場所なら `--mine <ファイル>` を付ける」を足す（`watch`・`inbox`・`intake`・`intake-calendar`・`init`・`doctor`）。`tests/skills.test.js`・`tests/agents.test.js` が文言を検査するので、通ること。
- [ ] **Step 6: docs/flow.html** — `init` の手順（2 ファイル）と、`--mine` を足した箇所を直し、変えた分岐を実行して確かめる（確かめていない箇所は「未確認」と書く）。
- [ ] **Step 7: コミット** — `git commit -am "feat: 各 CLI ツールを共有ファイルと個人ファイルに対応させる"`。

---

### Task 5: 画面の保存の層（`createPairStore`）

**Files:**
- Modify: `src/ui/store.js`
- Test: `tests/store.test.js`（既存の `createStore` のテストはそのまま通ること）、`tests/pairstore.test.js`（新）

**Interfaces:**
- Consumes: `splitData`・`mergeData`・`checkSharedShape`・`checkPersonalShape`（Task 1）。
- Produces:
  - `createStore({ key, check, showOpenFilePicker, idb })` — `key`（IndexedDB のキー。既定は今の `"dataFileHandle"`）を受けるようにするだけ。
  - `createPairStore(deps = {}): Store` — `shared`（キー `dataFileHandle`、`checkSharedShape`）と `personal`（キー `personalFileHandle`、`checkPersonalShape`）の 2 つの `createStore` を持つ。公開メソッドは、いまの `Store` と同じ形（`restore`・`reopen`・`choose`・`lastFile`・`peek`・`reload`・`save`・`saveMerged`・`hasFile`・`rememberFailed`）に、次を足す: `choose(which: "shared"|"personal")`・`missing(): ("shared"|"personal")[]`（まだ開いていない方）・`lastFile()` は両方の名前（`{ shared, personal }`）。データは、結合した 1 つのデータ（`mergeData` の結果）で受け渡し、`hasFile` は 2 つとも開いているときだけ真。
  - 保存は、`splitData` した 2 つのうち、直前に読んだ（または保存した）内容から変わった方だけを、それぞれの `saveMerged` で書く。競合は、ファイルごとに検知し、最新のファイルへの当て直しは、「そのファイルの最新を、もう片方のメモリ上の内容と `mergeData` し、`edit` を当て、`splitData` で取り出した、そのファイルの分」で行う。片方が失敗したら、結果は `{ ok: false, reason, message: "<ファイル名>: …" }` で、成功した方の `loadedAt` は進める。

- [ ] **Step 1: 失敗するテストを書く** — `tests/pairstore.test.js`（偽のハンドル・偽の IndexedDB。`tests/store.test.js` の作り方に合わせる）: (a) 2 つ選んだあと `reload()` が結合したデータ。(b) 共有だけを変えたデータの `save` で、個人ファイルは書かれない。(c) 個人ファイルの更新日時が外から変わっていると、そのファイルだけ `conflict`、共有は書かれる（またはエラー文に、ファイル名が入る）。(d) `saveMerged` の当て直しで、他の人が共有ファイルに足したタスクを消さずに、自分の編集が入る。(e) `restore()` は、片方の記憶しか無いとき `null` で、`missing()` が足りない方を返す。(f) 片方の `save` が失敗したとき、`ok: false`・メッセージにファイル名があり、書けた方の `loadedAt` は進む。(g) 共有に無いタスクの枠を持つデータを保存しても、枠は個人ファイルに残る。
- [ ] **Step 2: 失敗を確かめる** — `node --test tests/pairstore.test.js`。
- [ ] **Step 3: 実装** — 上の署名どおり。`createStore` の中身は、`key` 以外変えない。
- [ ] **Step 4: 通ることを確かめる** — `node --test tests/store.test.js tests/pairstore.test.js tests/sync.test.js`（PASS）。
- [ ] **Step 5: コミット** — `git commit -am "feat: 画面の保存を、共有・個人の 2 ファイルにする（createPairStore）"`。

---

### Task 6: 画面の起動・開くボタン・バナー

**Files:**
- Modify: `src/ui/app.js`（2 行目の `createStore` を `createPairStore` に。210〜232 行目の起動、`filebar`（80 行目）、ファイルを開くボタンの処理）、`src/ui/index.html`、`src/ui/sync.js`（`store` の使い方が変わらないことを確かめる。変える場合は最小限）
- Test: `tests/app-source.test.js`（画面のソースの検査があれば）、`tests/sync.test.js`

**Interfaces:**
- Consumes: `createPairStore`（Task 5）。

- [ ] **Step 1: 失敗するテストを書く** — `tests/app-source.test.js` の流儀に合わせ、画面が 2 つの開くボタン（`data-open="shared"`・`data-open="personal"`）と、「個人ファイルを選んでください」/「共有ファイルを選んでください」の案内の文言を持つこと（文字列の検査）。`sync.test.js`: 偽の `store`（`createPairStore` と同じ形）で、自動の読み直しが、結合したデータで動くこと。
- [ ] **Step 2: 失敗を確かめる** — `node --test tests/app-source.test.js tests/sync.test.js`。
- [ ] **Step 3: 実装** — 起動: `restore()` が `null` のとき、`missing()` に応じて、足りない方を選ぶボタンと案内を出し、2 つ揃うまで画面（ガント以降）を描かない。「前回のファイルを開く」（`reopen`）も、2 つ分。開いたあとのデータは、`S.data`（結合した 1 つ）。`filebar` の「別のファイルを開く」は、共有・個人の 2 つのボタンにする。
- [ ] **Step 4: 通ることを確かめる** — `node --test tests/app-source.test.js tests/sync.test.js`、`npm test`。
- [ ] **Step 5: 動作確認** — Playwright（`showOpenFilePicker` を差し替えて、2 つのファイルを渡す）で、(a) 初回に、共有 → 個人の順に選ぶと画面が開く。(b) 共有だけ選んだ状態で、個人を選ぶ案内が出て、画面が開かない。(c) 再読み込みで前回の 2 つが開く。(d) 片方の記憶を消すと、足りない方の案内になる。(e) 画面で編集して保存すると、変えたファイルだけが書き換わる。確かめた範囲と未確認（実際のネットワークドライブ・SharePoint 経由）を `development.md` に書く。
- [ ] **Step 6: コミット** — `git commit -am "feat: 画面が共有・個人の 2 ファイルを開く"`。

---

### Task 7: 共有ファイルに無いタスクの作業枠のバナーと削除

**Files:**
- Modify: `src/ui/app.js`（バナーの描画。`validate` の注意を出している `banner()` の呼び出し元）、`src/ui/views/schedule.js` と `src/ui/views/prio.js`・`workload.js`（`orphanSessions` を使わないことの確認のみ）
- Test: `tests/views.test.js`、`tests/edit.test.js`

**Interfaces:**
- Consumes: `data.orphanSessions`・`removeOrphanSessions`（Task 1）、検証の警告（Task 2）。
- Produces: バナーに、ボタン `data-orphan-clear`（文言「該当の枠を削除」）。押すと確認の文「N 件の作業枠を削除します。タスクが戻っていないか、少し待ってから確認してください」を出し、承認されたら `apply((d) => removeOrphanSessions(d), "…")` で保存する。

- [ ] **Step 1: 失敗するテストを書く** — `orphanSessions` を持つデータで、バナーの HTML に「共有ファイルに無いタスクの作業枠が 1 件あります」と `data-orphan-clear` がある。持たないデータでは出ない。`renderCalendar` は、`orphanSessions` の枠を描かない（タスクの `sessions` だけを描く）。
- [ ] **Step 2: 失敗を確かめる** — `node --test tests/views.test.js`。
- [ ] **Step 3: 実装** — バナーの組み立てに、ボタンと確認（`S.pendingOrphan` の状態。メモリのみ）を足す。読み直しで `orphanSessions` が空になれば、バナーとボタンは消える。
- [ ] **Step 4: 通ることを確かめる** — `node --test tests/views.test.js`。
- [ ] **Step 5: 動作確認** — 個人ファイルに、共有に無いタスク ID の枠を手で足して開き、バナーが出て、枠がカレンダーに出ないこと。ボタン → 確認 → 承認で、個人ファイルからその枠だけが消えること。共有ファイルにそのタスクを足して読み直すと、バナーが消え、枠が出ること。
- [ ] **Step 6: コミット** — `git commit -am "feat: 共有ファイルに無いタスクの作業枠をバナーで知らせ、削除できるようにする"`。

---

### Task 8: 書き出し（直接保存できないブラウザ）と、ドキュメント・ビルド

**Files:**
- Modify: `src/ui/app.js`（「JSON を書き出す」の処理）、`docs/development.md`、`docs/guide.md`、`README.md`
- Modify: `plugins/project-lens/assets/project-lens.html`（ビルドの出力）

- [ ] **Step 1: 書き出し** — 直接保存に対応しないブラウザの「JSON を書き出す」は、`splitData` した 2 つを、`data.json`・`personal.json` の名前で、続けてダウンロードする。テスト（`tests/app-source.test.js` 相当）で、2 つのダウンロードの名前を検査する。
- [ ] **Step 2: development.md** — 「設計判断」の「1 人で使う前提」を、「共有 + 個人の 2 ファイル。1 つの共有ファイルを複数人が使う想定。ロックはしない」に直す。「保存と競合」の節に、ファイルごとの独立した保存・競合・当て直しと、片方だけ成功する場合を書く。「SharePoint Online 上の `data.json` は…」の項を、共有ファイルだけを置く想定（個人は手元）に直す。「画面の動き > 全体」に、2 つのファイルを開く動き、「共有ファイルに無いタスクの作業枠」のバナーを足す。「補助コマンド」に `--mine` を足す。未確認（SharePoint・ネットワークドライブ・実ブラウザの権限の確認・自動の読み直しの遅さ）を書く。
- [ ] **Step 3: guide.md・README** — 導入と、使い始め（2 つのファイルを選ぶ・`init` が 2 つ作る・複数人での使い方）を直す。README の行数（100 行以内）と、`plugin.test.js` が読む表を壊さない。
- [ ] **Step 4: 残りの洗い出し** — `grep -rn "1 人で使う前提\|data.json を" docs README.md plugins/project-lens/skills plugins/project-lens/agents` で、1 ファイルを前提にした記述を直す。
- [ ] **Step 5: ビルドと全体** — `npm run build && npm test`（全件 PASS）。`development.md` のバッククォートで囲んだファイル名・識別子が、コードに実在するかを照合する。
- [ ] **Step 6: コミット** — `git add -A && git commit -m "feat: 書き出しを 2 ファイルにし、ドキュメントとビルドを整える"`。PR の本文に「`development.md`: 直した節の名前」を書く。
