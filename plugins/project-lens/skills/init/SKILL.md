---
name: init
description: project-lens のセットアップ。作業フォルダに、ダッシュボード(project-lens.html)とデータ(.project-lens/data.json)を用意する。何度実行しても既存のデータは変えない。データの取り込みや日程の変更には使わない（取り込みは /project-lens:intake、日程の変更は HTML の「Claude Code に依頼する」）
argument-hint: "[--sample] [--mine <個人ファイル>]"
allowed-tools: 'Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/init.js") Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/init.js" --sample) Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/init.js" --mine *) Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/init.js" --sample --mine *)'
disable-model-invocation: true
---

# init: セットアップをする

作業フォルダに、ダッシュボード（`project-lens.html`）とデータ（共有の `.project-lens/data.json` と、個人の `.project-lens/personal.json`）を作る。何度実行しても、既存のデータは変えない。終わると、ブラウザで `project-lens.html` を開いて、プロジェクトとタスクを管理し始められる。

## 手順

### 手順1: セットアップを実行する
目的: 作業フォルダに `project-lens.html` と `.project-lens/data.json` を用意する。

次のコマンドは、作業フォルダに `project-lens.html` と `.project-lens/data.json`・`.project-lens/personal.json` を書く（既存の `data.json`・`personal.json` は変えない）。

```
node "${CLAUDE_PLUGIN_ROOT}/tools/init.js"
```

- 利用者が `--sample` を付けたときだけ、代わりに次を実行する。空のデータの代わりに架空のサンプルデータが入る（試用向け）。

  ```
  node "${CLAUDE_PLUGIN_ROOT}/tools/init.js" --sample
  ```
- 利用者が個人ファイルの置き場を別の場所に指定したときだけ、`--mine <ファイル>` を付ける（そこへ `personal.json` の代わりに作る。以後のコマンドにも、同じ `--mine` を付ける）。`.project-lens/` の外を指したときは、`.gitignore` で除外されないので、手順2 で、個人ファイル（自分のメールアドレス `selfEmails` などが入る）を git で管理しないよう、自分で `.gitignore` に足すことを伝える。
- この 3 つ以外の引数は渡さない。
- 終了コードが 0 以外のときは、出力に書かれた理由をそのまま利用者に伝え、ファイルを作り直したり上書きしたりしない。
- 起動コマンド `node` が見つからないとき、または構文エラーで起動に失敗するときは、Node.js 24 以上が入っていない。`winget install OpenJS.NodeJS.LTS` を案内し、ターミナルを開き直してからもう一度実行してもらう。

### 手順2: 結果を伝える
目的: 作ったファイルと、次にやることを利用者に伝える。

成功したら、作成・更新されたファイルを短く伝え、次の手順を案内する。

1. ブラウザ（Edge または Chrome）で、プロジェクト直下の `project-lens.html` を開く。
2. 「共有ファイルを選ぶ」で `.project-lens/data.json`、「個人ファイルを選ぶ」で `.project-lens/personal.json`（`--mine` で別の場所を指したときは、そのファイル）を選ぶ。
