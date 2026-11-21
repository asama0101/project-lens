---
name: init
description: project-lens のセットアップ。作業フォルダに、ダッシュボード(project-lens.html)とデータ(.project-lens/data.json)を用意する。何度実行しても既存のデータは変えない。データの取り込みや日程の変更には使わない（取り込みは /project-lens:intake、日程の変更は HTML の「Claude Code に依頼する」）
argument-hint: "[--sample]"
allowed-tools: 'Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/init.js") Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/init.js" --sample)'
disable-model-invocation: true
---

project-lens のセットアップをします。作業フォルダに、ダッシュボード（`project-lens.html`）とデータ（`.project-lens/data.json`）を作ります。
終わると、ブラウザで `project-lens.html` を開いて、プロジェクトとタスクを管理し始められます。

次のコマンドは、作業フォルダに `project-lens.html` と `.project-lens/data.json` を書きます（既存の `data.json` は変えません）。

```
node "${CLAUDE_PLUGIN_ROOT}/tools/init.js"
```

- 利用者が `--sample` を付けたときだけ、代わりに次を実行してください。空のデータの代わりに架空のサンプルデータが入ります(試用向け)。

  ```
  node "${CLAUDE_PLUGIN_ROOT}/tools/init.js" --sample
  ```
- この 2 つ以外の引数は渡さないでください。
- 終了コードが 0 以外のときは、出力に書かれた理由をそのまま利用者に伝え、ファイルを作り直したり上書きしたりしないでください。
- 起動コマンド `node` が見つからないとき、または構文エラーで起動に失敗するときは、Node.js 24 以上が入っていない。`winget install OpenJS.NodeJS.LTS` を案内し、ターミナルを開き直してからもう一度実行してもらう。

成功したら、作成・更新されたファイルを短く伝え、次の手順を案内してください。

1. ブラウザ(Edge または Chrome)で、プロジェクト直下の `project-lens.html` を開く。
2. 「ファイルを開く」で `.project-lens/data.json` を選ぶ。
