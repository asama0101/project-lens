# 補助コマンド

`tools/cli.js` などの補助コマンド。[開発者向けの情報](../development.md)の一部。

プラグインとして使うときは、エージェントとコマンドが呼ぶので意識する必要はない。このリポジトリを直接開いて手で実行する場合の例（`plugins/project-lens/` で実行する）。試すデータは、別の作業フォルダで `node <このリポジトリ>/plugins/project-lens/tools/init.js --sample` を実行して作る（`.project-lens/data.json`・`personal.json`）。`data/sample.json` は分割前の結合した形なので、そのまま `validate.js` などに渡すと、旧形式の data.json として読まない。

```
node tools/validate.js <作業フォルダ>/.project-lens/data.json [--mine <ファイル>]  # 検証（共有と個人を合わせて検証。errors があれば終了コード 1。個人ファイルが無い既定の場所は、空として扱う）
node tools/init.js [--sample] [--mine <ファイル>]       # 作業フォルダに project-lens.html と、.project-lens/data.json（共有）・personal.json（個人）の 2 つを作る（--mine で個人ファイルの場所を変える。既存のファイルは変えない。ほかの引数を付けると、使い方を出して終了コード 2 で止め、何も作らない）
node tools/intake.js                                   # 取り込み・会議の規則・WBS の列の対応のコマンド一覧
node tools/inbox.js                                    # 受信箱（HTML からの依頼）のコマンド一覧（wait・claim・propose・approve など）
node tools/holidays.js <update|status> <data.json> [--mine <ファイル>]  # 日本の祝日（内閣府の一覧）を取得して settings.nationalHolidays に保存／取得状況を表示
node tools/mcpconf.js --data <保存先> show             # 予定表の MCP の指定（保存先は PROJECT_LENS_HOME でも指定できる）
node tools/doctor.js --data <保存先>                   # 動作環境の診断のみ（Node・保存先・祝日の接続・Excel・予定表の MCP。必須が足りなければ終了コード 3）
node tools/xlsx.js doctor --data <保存先>              # Excel 用の環境の診断のみ（Python のパスと置き場を表示。使えなければ終了コード 3）
node tools/xlsx.js setup [--system] [--yes] --data <保存先>   # 環境を作る（既定は専用の venv、--system はシステムのユーザー領域。--yes なしは入れ先と内容を表示して終了コード 3）
node tools/xlsx.js --data <保存先> plan.xlsx           # Excel を JSON で読む（Python と openpyxl を使う。環境が使えないときは終了コード 3）
# 個人ファイルの場所: `--mine <ファイル>`（値が無いときは終了コード 2）（`tools/cli.js` の `takeMine`）。省くと、data.json と同じフォルダの personal.json。inbox.js・intake.js・holidays.js・validate.js・init.js が受ける（相対パスは実行したフォルダから数える）。doctor.js は保存先のフォルダだけを見るので受けない。
```
