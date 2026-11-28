# project-lens の開発メモ

## 開発者向け文書

- `docs/development.md`（目次）と `docs/development/` に、コードから読み取れない仕様と判断を書いている。コードを変える前に、対応するファイルを読む。

  | 変えるもの | 読むファイル（`docs/development/` 内） |
  |---|---|
  | 設計判断（「なぜそうしたか」「何を見送ったか」） | `design-decisions.md` |
  | 優先順位の点数、日程変更、状態と進捗 | `calculation.md` |
  | 画面の全体、ガントチャート、リスト | `ui-gantt-list.md` |
  | 今日のタスク、スケジュール、ToDo タブ、会議と稼働 | `ui-today-todo.md` |
  | ファイルを開く、設定、祝日、共有・個人ファイル、保存と競合 | `ui-files.md` |
  | 取り込み（intake） | `intake.md` |
  | HTML からの依頼（inbox） | `inbox.md` |
  | 補助コマンド | `cli.md` |
  | 開発の手順、リリースの手順 | `docs/development.md` |
- データ形式の正本は、`plugins/project-lens/data/sample.json` と `plugins/project-lens/src/core/schema.js`。`development.md` には書かない。
- 構成（ファイル一覧）と変更履歴は、書かない。構成は `ls` と各ファイルの冒頭コメント、変更履歴は `git log` で分かる。

## docs の更新方法

- 振る舞い・規則・設計判断を変えたときは、同じ作業の中で、対応する節を直す。
- 節に書いてある事実（点数・日数・上限・コマンド名・フラグ・ファイル名）を変える・消すときは、その数や名前を直す。名前は、同じ作業の中で `grep -rn "<旧名>" docs/` を実行し、ヒットが 0 件になるまで、完了にしない。
- 「なぜそうしたか」を新しく決めたときは、「設計判断」に 1 項目足す。
- 見送った案があるときは、見送った理由も書く。
- 動作確認をしていないことは、「未確認」と書く。
- 時点で変わる情報は書かない。版番号・PR 番号・日付・「以前は〜」の経緯は、`git log` と GitHub にあるので、`development.md` には書かない。書いてよいのは、今の規則と、見送った案の理由だけ。
- ほかの文書やファイルを指す記述（`docs/…` のパスなど）は、指す先を消す前に、`grep` で参照を探して直す。消すのは、参照が 0 件になってからにする。
- コードの変更の PR では、`development.md` の直し忘れが目立たない。PR の本文に、「`docs/development/` の直したファイル名と節の名前」か「対応する節なし」を、必ず書く。
- 区切りの作業（リリース・大きな改名・機能の削除）のあとは、`docs/development.md` と `docs/development/` のバッククォートで囲んだファイル名と識別子が、コードに実在するか照合する（実在しないのは、「削除した」と説明している箇所だけを残す）。

## コマンド

Windows 専用。Node.js 24 以上が要る。

```
npm test        # node --test
npm run build   # plugins/project-lens/assets/project-lens.html を作る
```

`plugins/project-lens/src/` を変えたら、`npm run build` を実行して `assets/project-lens.html` をコミットする。古いと `npm test` が失敗する。

## リリース

版を上げるときと、タグを打つときは、`docs/development.md` の「リリースの手順」に従う。push のたびには version を上げない。
