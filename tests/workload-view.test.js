import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderWorkload } from "../plugins/project-lens/src/ui/views/workload.js";
import { renderProjects } from "../plugins/project-lens/src/ui/views/project.js";
import { renderGantt } from "../plugins/project-lens/src/ui/views/gantt.js";
import { projectHours } from "../plugins/project-lens/src/core/workload.js";

const D = "2026-10-20";
const sess = (id, date, start, end, kind = "actual") => ({ id, date, start, end, kind });
const task = (id, projectId, sessions = []) => ({ id, projectId, title: id, due: "2026-12-31", status: "To Do", sessions });
const mtg = (id, date, start, end, extra = {}) => ({ id, date, start, end, title: id, source: "manual", skip: false, externalId: null, ...extra });
const proj = (id, name) => ({ id, name, type: "更改", status: "進行中", start: "2026-09-01", due: "2026-12-31", milestones: [] });
const mk = () => ({
  version: 1, settings: {}, projects: [proj("AA", "拠点A"), proj("AB", "拠点B")],
  tasks: [task("AA-0001", "AA", [sess("S1", D, "09:00", "10:30"), sess("S9", D, "16:00", "17:00", "planned")]), task("AB-0001", "AB", [sess("S2", D, "13:00", "14:00")])],
  events: [mtg("m1", D, "10:30", "11:30", { projectId: "AA", confirmed: true }), mtg("m2", D, "14:00", "14:30", { confirmed: true }), mtg("m3", D, "15:00", "16:00", { projectId: "AB" })],
  changeLog: [],
});
const NOW = { date: D, time: "17:30" };
const wl = (d, o = {}) => renderWorkload(d, D, { period: "week", date: D, now: NOW, ...o });

test("renderWorkload: プロジェクトごとのタスク・会議・合計の時間が出る（手計算した値と一致）", () => {
  const html = wl(mk());
  assert.match(html, /拠点A[\s\S]*?1\.5h[\s\S]*?1\.0h[\s\S]*?2\.5h/);
  assert.match(html, /拠点B[\s\S]*?1\.0h[\s\S]*?0\.0h[\s\S]*?1\.0h/);
  assert.match(html, /<tfoot>[\s\S]*?2\.5h[\s\S]*?1\.5h[\s\S]*?4\.0h/, "合計（タスク 1.5+1.0、会議 1.0+0.5）");
  assert.ok(html.includes("10/19〜10/25 の週"));
});

test("renderWorkload: 未設定の会議の行、未確認の注記は該当するときだけ出る", () => {
  const html = wl(mk());
  assert.ok(html.includes("プロジェクト未設定") && /プロジェクト未設定[\s\S]*?0\.5h/.test(html));
  assert.ok(html.includes("未確認 2件（作業枠 1・会議 1）") && html.includes("まだ含まれていません"));
  const d = mk();
  d.events = d.events.filter((e) => e.id !== "m2" && e.id !== "m3");
  d.tasks[0].sessions = d.tasks[0].sessions.filter((s) => s.kind === "actual");
  const clean = wl(d);
  assert.ok(!clean.includes("プロジェクト未設定") && !clean.includes("まだ含まれていません"));
});

test("renderWorkload: プロジェクトなしのタスクの実績は「プロジェクト未設定」の行のタスク列に出る", () => {
  const d = mk();
  d.events = [];
  d.tasks.push(task("ZZ-0001", null, [sess("S7", D, "16:30", "17:00")]));
  const html = wl(d);
  assert.match(html, /<td>プロジェクト未設定<\/td><td class="num mono">0\.5h<\/td>/);
  assert.ok(!html.includes("プロジェクト未設定の会議"));
});

test("renderWorkload: 週と月で期間の見出しと対象が変わる。空データで例外にならない", () => {
  const d = mk();
  d.tasks[0].sessions.push(sess("S3", "2026-10-05", "09:00", "10:00"));
  const month = wl(d, { period: "month" });
  assert.ok(month.includes("2026年10月") && month.includes("今月") && wl(d).includes("今週"));
  assert.match(month, /拠点A[\s\S]*?2\.5h[\s\S]*?1\.0h[\s\S]*?3\.5h/, "月全体なら 10/5 の1時間も入る");
  assert.match(wl(d), /拠点A[\s\S]*?1\.5h/, "週には入らない");
  const empty = { version: 1, settings: {}, projects: [], tasks: [], events: [], changeLog: [] };
  const html = wl(empty);
  assert.ok(html.includes("0.0h") && html.includes("プロジェクトがありません"));
});

test("renderWorkload: 内訳の横棒は合計に比例し、操作用の属性がある。名前はエスケープされる", () => {
  const d = mk(); d.projects[0].name = "<img src=x onerror=1>";
  const html = wl(d);
  assert.ok(!html.includes("<img src=x") && html.includes("&lt;img src=x"));
  assert.ok(html.includes('data-wnav="-1"') && html.includes('data-wnav="1"') && html.includes("data-wtoday"));
  assert.ok(html.includes('data-wperiod="week" aria-pressed="true"') && html.includes('data-wperiod="month" aria-pressed="false"') && html.includes('data-wperiod="day" aria-pressed="false"'));
  assert.ok(html.indexOf('data-wperiod="day"') < html.indexOf('data-wperiod="week"') && html.indexOf('data-wperiod="week"') < html.indexOf('data-wperiod="month"'), "日・週・月の順");
  assert.match(html, /class="wl-bar" style="width:100(\.0+)?%/, "最大の行は 100%");
});

test("プロジェクトの見出しが『稼働 …（タスク …・会議 …）』になる（リストとガント）", () => {
  const d = JSON.parse(readFileSync(new URL("../plugins/project-lens/data/sample.json", import.meta.url), "utf8"));
  d.events.find((e) => e.id === "m2").confirmed = true; // A に付いた会議 1h を確認済みにする
  const h = projectHours(d, "AA");
  const want = `稼働 ${(h.task + h.meeting).toFixed(1)}h（タスク ${h.task.toFixed(1)}h・会議 ${h.meeting.toFixed(1)}h）`;
  assert.ok(h.meeting >= 1, "前提: 会議の時間が入っている");
  assert.ok(renderProjects(d, D, { filter: "AA", view: "list" }).includes(want), "リスト");
  assert.ok(renderGantt(d, ["AA"], D, {}).includes(want), "ガント");
});

import { shiftWorkloadDate } from "../plugins/project-lens/src/ui/views/workload.js";

test("renderWorkload(day): その日だけを集計し、見出しは 2026/10/20(火)、今日へのボタンは「今日」", () => {
  const d = mk();
  d.tasks[0].sessions.push(sess("S3", "2026-10-21", "09:00", "11:00"));
  const html = wl(d, { period: "day" });
  assert.ok(html.includes("2026/10/20(火)") && html.includes(">今日</button>") && html.includes('data-wperiod="day" aria-pressed="true"'));
  assert.match(html, /拠点A[\s\S]*?1\.5h[\s\S]*?1\.0h[\s\S]*?2\.5h/, "10/21 の 2 時間は入らない");
  assert.match(wl(d, { period: "day", date: "2026-10-21" }), /拠点A[\s\S]*?2\.0h[\s\S]*?0\.0h[\s\S]*?2\.0h/);
});

test("shiftWorkloadDate: 日は1日、週は7日、月は1か月（年またぎ・月末の日付でもずれない）", () => {
  assert.equal(shiftWorkloadDate("day", "2026-12-31", 1), "2027-01-01");
  assert.equal(shiftWorkloadDate("day", "2026-10-20", -1), "2026-10-19");
  assert.equal(shiftWorkloadDate("week", "2026-10-20", 1), "2026-10-27");
  assert.equal(shiftWorkloadDate("week", "2026-10-20", -1), "2026-10-13");
  assert.equal(shiftWorkloadDate("month", "2026-12-31", 1), "2027-01-01");
  assert.equal(shiftWorkloadDate("month", "2026-01-31", -1), "2025-12-01");
  assert.equal(shiftWorkloadDate("month", "2026-03-31", 1), "2026-04-01");
});

test("renderWorkload: 末尾はタスクの表。期間を渡さないとき（日・今日）も出る。見返し・気づきは出ない", () => {
  const html = wl(mk());
  assert.ok(html.endsWith("</section>") && html.indexOf("<h2>タスク</h2>") > html.indexOf("<tfoot>"));
  for (const s of ["週の見返し", "data-tdnote", "気づき"]) assert.ok(!html.includes(s), s);
  assert.ok(renderWorkload(mk(), D, { now: NOW }).includes("<h2>タスク</h2>"), "期間・日を省略（日・今日）");
  const empty = { version: 1, settings: {}, projects: [], tasks: [], events: [], changeLog: [] };
  assert.ok(wl(empty).includes("この期間のタスクはありません。"), "空データ");
});

test("renderWorkload: 時間の数字（タスク・会議・合計）は、完了・進捗の列を足しても変わらない", () => {
  const html = wl(mk());
  assert.match(html, /<th>プロジェクト<\/th><th class="num">タスク<\/th><th class="num">会議<\/th><th class="num">合計<\/th><th>内訳<\/th><th class="num">完了<\/th><th>進捗<\/th>/);
  assert.match(html, /拠点A<\/td><td class="num mono">1\.5h<\/td><td class="num mono">1\.0h<\/td><td class="num mono"><b>2\.5h<\/b>/);
});

test("renderWorkload: 期間を渡さないときは日（今日）。app.js の初期値も日", () => {
  const html = renderWorkload(mk(), D, { now: NOW });
  assert.ok(html.includes('data-wperiod="day" aria-pressed="true"') && html.includes("2026/10/20(火)"));
  const app = readFileSync(new URL("../plugins/project-lens/src/ui/app.js", import.meta.url), "utf8");
  assert.match(app, /wperiod: "day", wdate: clock\(\)\.date/);
});
