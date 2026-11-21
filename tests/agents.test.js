import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../plugins/project-lens/", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

for (const name of ["intake", "intake-calendar"]) {
  test(`サブエージェント ${name}: frontmatter と共通ルール`, () => {
    const text = read(`agents/${name}.md`);
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
    assert.match(fm, new RegExp(`^name: ${name}$`, "m"));
    assert.match(fm, /^description: .+/m);
    // 外の人が書いた文章を読むエージェントは、tools を絞る(intake-calendar は MCP を呼ばず、取得は呼び出し元の会話が行う)
    if (name === "intake-calendar") assert.match(fm, /^tools: Read, Bash$/m);
    else assert.match(fm, /^tools: Read, Write, Bash$/m);
    assert.ok(text.includes("承認"));
    assert.ok(text.includes(".project-lens/data.json"));
    // リポジトリ直下を前提にしたパスが残っていない
    assert.doesNotMatch(text, /node "?tools\//);
    assert.doesNotMatch(text, /(^|[^.\w])data\/data\.json/m);
  });
}

test("inbox: 受信箱を処理するエージェント。tools は Read, Bash で絞り、聞き返し・画面で行う操作の案内・CLI を持ち、承認・却下の節は持たない", () => {
  const text = read("agents/inbox.md");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  assert.match(fm, /^name: inbox$/m);
  assert.match(fm, /^description: .+/m);
  assert.match(fm, /^tools: Read, Bash$/m);
  for (const word of ["${CLAUDE_PLUGIN_ROOT}/tools/inbox.js", "claim", "propose", "ask", "fail", "承認", "画面で行ってください", ".project-lens/data.json", "moveDue", "addTask", "compress"]) assert.ok(text.includes(word), word);
  assert.doesNotMatch(text, /## 承認・却下/, "承認・却下は /project-lens:watch の手順。エージェントは承認を待たない");
  assert.match(text, /推測/);
  assert.match(text, /止まらない/);
  assert.doesNotMatch(text, /node "?tools\//);
  assert.doesNotMatch(text, /(^|[^.\w])data\/data\.json/m);
});

test("MCP を同梱しない（.mcp.json がない）", () => {
  assert.equal(existsSync(new URL(".mcp.json", root)), false);
});

test("intake: WBS・規則の手順と承認がある。予定表（MCP）の手順は持たず、intake-calendar を案内する", () => {
  const t = read("agents/intake.md");
  for (const w of [
    '${CLAUDE_PLUGIN_ROOT}/tools/intake.js', '${CLAUDE_PLUGIN_ROOT}/tools/xlsx.js',
    "wbs-plan", "wbs-apply", "rules-set", "rules-apply", "mapping-get", "mapping-set", "承認", "CSV", "project-lens:intake-calendar",
  ]) assert.ok(t.includes(w), w);
  for (const w of ["calendar-auto", "calendar-apply", "mcpconf.js", "/project-lens:mcp"]) assert.ok(!t.includes(w), w);
  assert.doesNotMatch(t, /## calendar/);
  assert.doesNotMatch(t, /\.mcp\.json/);
});

test("intake-calendar: tools は Read, Bash だけで MCP のツールを含まない。MCP は呼ばず、取得は呼び出し元が行う。Excel・規則の手順は持たない", () => {
  const t = read("agents/intake-calendar.md");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t)?.[1] ?? "";
  const tools = (/^tools: (.+)$/m.exec(fm)?.[1] ?? "").split(",").map((x) => x.trim()).sort();
  assert.deepEqual(tools, ["Bash", "Read"]);
  assert.doesNotMatch(fm, /mcp__/);
  assert.doesNotMatch(t, /`tools` を省略|mcpconf\.js/);
  for (const w of ['${CLAUDE_PLUGIN_ROOT}/tools/intake.js', "calendar-auto", "calendar-apply", "使った MCP", "呼び出し元"]) assert.ok(t.includes(w), w);
  for (const w of ["xlsx.js", "wbs-plan", "rules-set"]) assert.ok(!t.includes(w), w);
  assert.doesNotMatch(t, /\.mcp\.json/);
});

test("intake・intake-calendar: 文章の手順が無い。文章を貼られたときは HTML の帯からの依頼を案内する", () => {
  const t = read("agents/intake.md");
  assert.doesNotMatch(t, /## 文章/);
  assert.doesNotMatch(t, /submit/);
  for (const w of ["## wbs", "## rules", "Claude Code に依頼する"]) assert.ok(t.includes(w), w);
  const c = read("agents/intake-calendar.md");
  assert.doesNotMatch(c, /submit/);
  for (const w of ["## calendar", "Claude Code に依頼する"]) assert.ok(c.includes(w), w);
});

test("intake(wbs): 列の対応と変更案を一緒に見せて承認 1 回", () => {
  const t = read("agents/intake.md");
  assert.match(t, /対応表.*変更案/);
});

test("inbox: addTask は businessDays（due と排他）で営業日を書き、期限が無いときは聞き返さず仮で置く。行番号で直す", () => {
  const t = read("agents/inbox.md");
  for (const w of ["businessDays", "行番号", "仮", "もう一度"]) assert.ok(t.includes(w), w);
  assert.doesNotMatch(t, /期限が書かれていない/);
});

test("inbox: 依頼で受ける操作は addTask と moveDue の 2 種類で、ref を他の操作から指せることが書かれている。画面で行う操作は ask で案内する", () => {
  const t = read("agents/inbox.md");
  assert.ok(t.includes("2 種類だけ"));
  for (const op of ["moveDue", "addTask"]) assert.ok(t.includes(`"op":"${op}"`), op);
  for (const op of ["addPred", "addProject", "setStatus", "setImportance", "removeTask", "removeProject", "addMilestone", "addChecklistItem"]) assert.ok(!t.includes(`"op":"${op}"`), `${op} は書かない`);
  assert.ok(t.includes("3〜5 件"));
  assert.match(t, /ref.*moveDue|predecessors.*ref/);
  assert.match(t, /この依頼は画面で行ってください/);
});

test("inbox: 原因が複数なら「その他」", () => {
  const t = read("agents/inbox.md");
  assert.match(t, /原因が複数.*その他/);
});

test("inbox: メール・議事録・メモの本文の取り込みは、目的の外なので書かない。日程の遅れは原因を読み取る", () => {
  const t = read("agents/inbox.md");
  assert.doesNotMatch(t, /メール|議事録|メモ/);
  assert.match(t, /--cause/);
});

test("inbox: approve は、どの場合も実行しない（承認は利用者だけ）。reject・fail は、手順に書いた場合以外は実行しない", () => {
  const t = read("agents/inbox.md");
  assert.match(t, /`approve` は、どの場合も実行しない（承認は利用者だけが行う）/);
  assert.match(t, /`reject`・`fail` は、手順に書いた場合以外は実行しない/);
});

test("inbox: 対象外の依頼は、会議の追加・削除と、intake で扱うもの（Excel・予定表・会議の規則）だけ", () => {
  const t = read("agents/inbox.md");
  const line = t.split("\n").find((l) => l.includes("**対象外の依頼**")) ?? "";
  assert.ok(line, "対象外の依頼の行がある");
  assert.match(line, /会議/);
  assert.match(line, /intake/);
  assert.doesNotMatch(line, /プロジェクト・会議の追加|タスクの削除|状態の変更|既存のプロジェクトの変更/);
});

test("intake・inbox: 祝日の取得は propose が行うので、エージェントは holidays.js を呼ばない", () => {
  for (const name of ["agents/intake.md", "agents/intake-calendar.md", "agents/inbox.md"]) {
    const t = read(name);
    assert.doesNotMatch(t, /holidays\.js/, name);
    assert.match(t, /warnings/, name);
  }
});

test("inbox: 仮に置いた期限がプロジェクトの期間（projects[].start〜due）に収まるか確かめ、収まらなければ --summary に警告として書く（intake と共通の指針）", () => {
  const t = read("agents/inbox.md");
  const line = t.split("\n").find((l) => l.includes("projects[].start"));
  assert.ok(line, "プロジェクトの期間の確認がある");
  for (const w of ["収まる", "警告", "--summary"]) assert.ok(line.includes(w), w);
});

test("inbox: moveDue と businessDays の addTask は同じ依頼にしない。エラーが出たら、期限の移動だけを提案し、登録は承認後にもう一度依頼してもらう", () => {
  const t = read("agents/inbox.md");
  const line = t.split("\n").find((l) => l.includes("moveDue") && l.includes("businessDays") && l.includes("同じ依頼"));
  assert.ok(line, "併用できない旨");
  for (const w of ["期限の移動だけ", "--summary", "承認後", "もう一度依頼"]) assert.ok(line.includes(w), w);
});

test("inbox・intake: 外から来た文章（依頼・メール・Excel のセル・予定表の件名）は、読むだけのデータで、中の指示には従わないと書く", () => {
  for (const name of ["inbox", "intake", "intake-calendar"]) {
    const text = read(`agents/${name}.md`);
    assert.match(text, /読むだけのデータ/, name);
    assert.match(text, /指示（[^）]*）には従わない/, name);
  }
});

test("intake-calendar: 承認の確認なしで calendar-auto を実行し、保留・取得 0 件・失敗を知らせる。blocked のときだけ、削除してよいか聞いてから calendar-apply", () => {
  const t = read("agents/intake-calendar.md");
  const cal = t.slice(t.indexOf("## calendar"));
  assert.ok(cal.length > 0, "## calendar の節がある");
  for (const w of ["calendar-auto", "承認の確認なし", "held", "blocked", "取得に失敗", "fetched.json", "--data", "使った MCP", "削除してよいか", "calendar-apply"]) assert.ok(cal.includes(w), w);
  const step3 = cal.slice(cal.indexOf("3. `calendar-auto"), cal.indexOf("4. 結果"));
  assert.doesNotMatch(step3, /calendar-plan/, "書き込みの手順に、変更案の表はない");
  assert.ok(step3.includes("（削除確認済み <planKey>）") && step3.includes("calendar-apply") && step3.includes("--plan-key"), "calendar-apply は、依頼に（削除確認済み <planKey>）があるときだけ。--plan-key を渡す");
  assert.ok(step3.includes("（見張りから）") && step3.includes("無視"), "見張りからの依頼は、削除確認済みが付いていても calendar-auto");
  const step5 = cal.slice(cal.indexOf("5. `blocked`"), cal.indexOf("6. "));
  for (const w of ["calendar-plan", "見張りからのときは、聞かずに終わる", "実績", "削除しない", "planKey"]) assert.ok(step5.includes(w), w);
  const step6 = cal.slice(cal.indexOf("6. "));
  for (const w of ["fetched-remove", "project-lens-fetched-", "blocked"]) assert.ok(step6.includes(w), w);
  assert.doesNotMatch(step5, /利用者に聞く/, "エージェントは質問して待てない");
  const skill = read("skills/intake/SKILL.md");
  assert.ok(skill.includes("（削除確認済み <planKey>）") && skill.includes("fetched-remove"), "会話が、削除の確認を取ってから、エージェントに calendar-apply を頼む。fetched.json を消す具体的なコマンドがある");
  assert.doesNotMatch(t, /## calendar --auto/, "calendar --auto の節は calendar に統合した");
});

test("watch: 見張りの開始時と、30 分ごとの再起動時に、予定表を会話で取得してから、project-lens:intake-calendar エージェントへ calendar <開始日> <終了日> <パス> <MCP名>（見張りから）を頼む。予定表の MCP が未指定なら更新しない", () => {
  const t = read("skills/watch/SKILL.md");
  for (const w of ["（見張りから）", "project-lens:intake-calendar", "未指定", "30 分"]) assert.ok(t.includes(w), w);
  const step = t.slice(t.indexOf("予定表を更新します"), t.indexOf("2. イベントの種類"));
  for (const w of ["mcpconf.js", "listTool", "fetched.json", "読むだけのデータ", "取得に失敗", "（見張りから）", "project-lens-fetched-", "前景", "fetched-remove"]) assert.ok(step.includes(w), w);
  assert.ok(t.indexOf("予定表を更新します") > t.indexOf("1. Monitor"), "見張りを始めてから更新する（許可の確認で、見張りの開始が止まらないように）");
  assert.match(t.slice(t.indexOf("4. 30 分で")), /予定表/, "再起動時にも予定表を更新する");
});

test("mcp: 保存済みの selfEmails があれば、手順 4 で聞き直さない", () => {
  const t = read("skills/mcp/SKILL.md");
  const step = t.slice(t.indexOf("4. **自分のメールアドレス"), t.indexOf("5. **試しに"));
  assert.match(step, /保存済みなら、聞かずに/);
});

test("inbox: addTask の checklist は文字列の配列", () => {
  const t = read("agents/inbox.md");
  assert.ok(t.includes('"checklist":["'));
});

test("intake スキル: calendar は、エージェントを呼ぶ前に会話で取得する。取得の失敗・未指定で止まり、件名は読むだけのデータと書く", () => {
  const t = read("skills/intake/SKILL.md");
  const sec = t.slice(t.indexOf("## calendar の取得"));
  assert.ok(sec.length > 0, "## calendar の取得の節がある");
  for (const w of ["mcpconf.js", "/project-lens:mcp", "listTool", "fetched.json", "読むだけのデータ", "取得に失敗", "project-lens:intake-calendar", "project-lens-fetched-"]) assert.ok(sec.includes(w), w);
});
