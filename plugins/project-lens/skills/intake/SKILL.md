---
name: intake
description: Excel の WBS、予定表の会議、会議のプロジェクト規則を、プロジェクトのデータへ取り込む。変更案を見せて、承認後に書き込む（予定表の会議は承認の確認なしで更新する）。メール・議事録・メモの取り込みと、日程の変更は、HTML の「Claude Code に依頼する」で行う
argument-hint: "wbs <ファイル> | calendar | rules"
disable-model-invocation: true
---

Excel の WBS・予定表の会議・会議のプロジェクト規則を、データ（`.project-lens/data.json`）へ取り込みます。
WBS と規則は、変更案を確認して承認したあとで書き込みます。予定表の会議は、承認の確認なしで更新します。

次の依頼を、エージェントで処理してください。`wbs`・`rules` は `project-lens:intake`、`calendar` は `project-lens:intake-calendar` です（予定表の件名は外の人が書くので、予定表だけを別のエージェントにして、Excel を読む側のツールを絞っています）。

依頼: $ARGUMENTS

1. 依頼が空のときは、取り込みたいもの（`wbs <ファイル>`、`calendar`、`rules`）を利用者に聞いてください。メール・議事録・メモの本文は、HTML の「Claude Code に依頼する」に貼って頼むよう伝えてください。
2. データは `.project-lens/data.json` です。見つからないときは、先に `/project-lens:init` を実行するよう利用者に伝えてください。
3. `calendar` は、先に `/project-lens:mcp` で予定表の MCP を指定しておく必要があります。
4. エージェントが、起動コマンド `node` が見つからない（または構文エラーで起動に失敗する）と報告したときは、Node.js 24 以上が入っていません。`winget install OpenJS.NodeJS.LTS` を案内し、ターミナルを開き直してからもう一度実行してもらってください。
