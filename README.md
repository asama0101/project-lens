# project-lens

ネットワーク設備の管理者が、複数のプロジェクトと自分のタスクを 1 枚の画面で管理する Claude Code プラグインです（Windows 専用）。次を実行すると、架空のサンプルデータ入りの画面が作られます。

```
/project-lens:init --sample
```

<img src="docs/images/overview.svg" alt="project-lens の全体図。画面（project-lens.html）と Claude Code が、同じ data.json を読み書きする" width="800">

*図 1: 全体図。画面と Claude Code が、同じ `data.json` を読み書きします。*

## 機能

<img src="docs/images/features.svg" alt="5 つの機能。一覧と優先、日程の調整、突発タスク、取り込み、稼働の集計" width="800">

*図 2: 5 つの機能。*

## 導入方法

| 必要なもの | 内容 |
|---|---|
| OS・Claude Code・ブラウザ | Windows。Claude Code は必須。ブラウザは Edge か Chrome |
| Node.js | 24 以上 |
| Python | 3.12 以上。Excel の WBS を取り込むときだけ |

```
/plugin marketplace add asama0101/project-lens
/plugin install project-lens@project-lens
/project-lens:init
```

そのあと、Edge か Chrome で `project-lens.html` を開き、「ファイルを開く」で `.project-lens/data.json` を選びます。

**すでに `project-lens.html` があると、`init` は新しい版に置き換えます。** 手で直していたときは、先に別の名前でコピーします（`data.json` は変わりません）。オフラインでの導入、更新、アンインストール、動作環境の確認（`/project-lens:doctor`）は、[利用ガイド](docs/guide.md)を見てください。

## 使い方

### 毎朝の流れ

| 1. 「今日の優先」を見る | 2. 時間枠に置く | 3. 「着手」を押す |
|---|---|---|
| <img src="docs/images/morning-1-priority.png" alt="ガントチャートの右側に「今日のタスク」と「今日の優先」が並ぶ" width="260"> | <img src="docs/images/morning-2-schedule.png" alt="スケジュールの週の枠に、作業枠と会議が並ぶ" width="260"> | <img src="docs/images/morning-3-started.png" alt="タスクが In Progress になり、「着手」のボタンが消える" width="260"> |

### 今日の優先の決まり方

<img src="docs/images/priority-score.svg" alt="点数の計算例の棒グラフ。突発タスク（期限は今日）は 45、期限 5 日後で項目なしは 37.5、期限 5 日後で未チェック 3 件は 48.75、3 日超過で未チェック 10 件は 199" width="800">

*図 3: 点数の計算例（重要なし）。前のタスクがすべて完了しているタスクだけが載ります。*

| 項目 | 点数 |
|---|---|
| 期限超過 | +100 |
| 期限点 | 残り 30 日以内は (30 − 残り日数) × 1.5 |
| 未チェックの項目 | 期限点を最大 2.0 倍（`Waiting` は 1 倍） |
| 重要 | +12 |
| `Waiting` の回答予定日の超過 | +40 |

### 突発タスクの登録

<img src="docs/images/urgent-flow.svg" alt="突発タスクの流れ。日表示で空き時間を押し、件名・プロジェクト・長さを入れると、タスクと作業枠が作られる。やめると何も作らない" width="800">

*図 4: 空き時間を押して登録する流れ。承認と見張りは要りません。*

### 依頼の帯から日程を頼む

<img src="docs/images/request-flow.svg" alt="依頼の流れ。画面で依頼を書き、Claude Code が変更案を作り、画面で確認して、承認すると期限が変わる。却下すると何も変わらない" width="800">

*図 5: 日程を変える流れ。「承認して反映する」を押すまで、期限は変わりません。*

Claude Code で `/project-lens:watch` を 1 回実行し、画面下端の帯に依頼を書きます（例: `A3 が 5 日遅れた（原因: ベンダー）`）。

### 取り込み

<img src="docs/images/intake-flow.svg" alt="取り込みの流れ。読み取り、変更案の表、承認、書き込みの順。承認の前は data.json を変えない" width="800">

*図 6: Excel の WBS と規則の取り込み。予定表の会議だけは、承認なしで更新します。*

### コマンド一覧

| コマンド | 使いどころ |
|---|---|
| `/project-lens:init` | セットアップ（`--sample` でサンプルデータ入り） |
| `/project-lens:watch` | 依頼の帯から届く依頼を処理する |
| `/project-lens:intake` | Excel の WBS・予定表の会議の取り込み |
| `/project-lens:mcp` | 予定表で使う MCP の指定 |
| `/project-lens:doctor` | 動作環境の診断（何も変更しない） |

### 画面の見方

<img src="docs/images/screens.svg" alt="画面の 5 つのタブ。ガントチャート、リスト、スケジュール、稼働、設定" width="800">

*図 7: 画面上部の 5 つのタブ。*

## 困ったとき

| 症状 | 対処 |
|---|---|
| 帯が「見ていません」になっている | `/project-lens:watch` を実行します。 |
| 「直接保存に対応していません」と出る | Edge か Chrome で開きます。 |
| `/project-lens:doctor` に `[NG]` と出る | `→` で始まる手順に、上から従います。 |

ほかの症状と、`data.json` を戻す手順は、[利用ガイド](docs/guide.md#困ったとき)を見てください。設定タブの項目は、[利用ガイド](docs/guide.md#設定)にあります。

## ライセンス

MIT（[LICENSE](LICENSE)）
