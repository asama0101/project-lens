# 開発者向けの情報

project-lens の開発者向けの情報です。利用者向けの説明は、リポジトリ直下の [README.md](../README.md) にあります。

| 変えるもの | 読むファイル |
|---|---|
| 設計判断・実装の前提 | [development/design-decisions.md](development/design-decisions.md) |
| 優先順位・日程変更・状態と進捗の計算 | [development/calculation.md](development/calculation.md) |
| 全体の画面構造、ガントチャート、リスト | [development/ui-gantt-list.md](development/ui-gantt-list.md) |
| 今日のタスク、スケジュール、ToDo タブ、会議と稼働 | [development/ui-today-todo.md](development/ui-today-todo.md) |
| ファイルを開く、設定、祝日、共有・個人ファイル、保存と競合 | [development/ui-files.md](development/ui-files.md) |
| Excel の WBS・会議の取り込み（intake） | [development/intake.md](development/intake.md) |
| HTML からの依頼（inbox） | [development/inbox.md](development/inbox.md) |
| 補助コマンド | [development/cli.md](development/cli.md) |

「開発の手順」（リリースの手順を含む）は、このファイルに書く。

## 開発の手順

```
npm test        # node --test
npm run build   # plugins/project-lens/assets/project-lens.html（プラグインに同梱する完成版）を作る
```

- `plugins/project-lens/src/` を変えたら `npm run build` を実行し、`assets/project-lens.html` をコミットする。古いと `npm test` が失敗する。
- ヘッダーの題名の横の版の表記（`.ver`。11px・`--muted` の色）は、ビルドのとき、`tools/build.js` が `.claude-plugin/plugin.json` の `version` を読み、`src/ui/index.html` の印 `<!--__VERSION__-->` に「v」付きで入れる（ソースに版の数字は書かない。版はリリースのときだけ上げるので、表記もそのときだけ変わる。版を上げたら `npm run build` も要る）。確認したこと（Chromium・Playwright、`?today` なし、デモの 2 ファイル）: 幅 1400・900・700px の 5 つの画面で、表記を消したときとヘッダーの高さ（`--hh`）・日付の位置が同じ。未確認: 暗い配色。
- GitHub Actions（`.github/workflows/test.yml`）が、`main` への push と pull request で、Windows・Node 24 の `npm test` を実行する。`engines`（`plugins/project-lens/package.json`）は `>=24`（README の表「Node.js | 24 以上」と同じ。それより古い版は未確認）。`engines` は npm の警告にしかならず、`node` の実行は止めない。ワークフローの実行は、GitHub 上では未確認。
- このリポジトリを直接開いてプラグインを試すときは、`claude --plugin-dir ./plugins/project-lens` で起動する。
- 環境変数 `PROJECT_LENS_HOME` は、プラグイン専用のフォルダ（`${CLAUDE_PLUGIN_DATA}`）の場所を固定する。テストと開発用。`--plugin-dir` で読み込むと置き場が本番と別（`project-lens-inline`）になるので、開発時はこれで固定する。

### リリースの手順

push のたびには `version` を上げない。リリースするときだけ、次の順で行う（グローバルの git-flow.md の段階 9 に、project-lens 固有の手順を足したもの）。

1. **version を上げる**: リリースする版（例: `v1.1.0`）が決まったら、その版の `v` を除いた数字に、次の 3 か所を合わせる。上げる PR は、リリースする変更の PR か、そのすぐ後の PR にする。
   - `plugins/project-lens/.claude-plugin/plugin.json` の `version`（変えないと、利用者に更新が届かない）
   - `plugins/project-lens/package.json` の `version`（`plugin.json` と同じ値。`tests/plugin.test.js` が一致を確かめる）
   - `tests/plugin.test.js` の `assert.equal(plugin.version, "…")`（固定値）
2. **マージしてからタグを打つ**: タグ（`vMAJOR.MINOR.PATCH`）は、version を上げた PR のマージ後の `origin/main` に付ける。version を上げる前のコミットに付けない。付けたあとで食い違いに気づいたら、タグと GitHub Release を付け直す前に、ユーザーに確認する。
3. 版の決め方・タグ・GitHub Release（`gh release create <版> --generate-notes`）は、git-flow.md の「リリースするとき」に従う。`docs`・`chore` だけのときは、版を上げず、リリースしない。
