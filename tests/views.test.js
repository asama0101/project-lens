import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addDays, diffDays } from "../plugins/project-lens/src/core/dates.js";
import { renderProjects } from "../plugins/project-lens/src/ui/views/project.js";
import { renderGantt, assignLevels, layoutMilestones } from "../plugins/project-lens/src/ui/views/gantt.js";
import { renderPrio, renderSide, renderTodayTasks, todayTaskIds, doneAskHtml } from "../plugins/project-lens/src/ui/views/prio.js";
import * as prioModule from "../plugins/project-lens/src/ui/views/prio.js";
import { renderSettings } from "../plugins/project-lens/src/ui/views/settings.js";
import { checkMeterHtml, dateInputHtml } from "../plugins/project-lens/src/ui/common.js";
import { checklistEditorHtml } from "../plugins/project-lens/src/ui/views/checklist.js";
import { renderTaskPop, renderTaskEditPanel } from "../plugins/project-lens/src/ui/views/taskpop.js";
import { renderInboxBar, ibExamples } from "../plugins/project-lens/src/ui/views/inboxpanel.js";
import { ruleMeetingCounts } from "../plugins/project-lens/src/core/rules.js";
import { renderSchedule, renderCalendar, selectionKey, sessionSelection, revealSelection, snapStart, calendarGeometry, urgentDefaultStart, urgentInput } from "../plugins/project-lens/src/ui/views/schedule.js";
import { taskActual } from "../plugins/project-lens/src/core/sessions.js";
import { rankTasks } from "../plugins/project-lens/src/core/schedule.js";
import { bannerHtml } from "../plugins/project-lens/src/ui/common.js";
import { validate } from "../plugins/project-lens/src/core/schema.js";
import { renderWorkload } from "../plugins/project-lens/src/ui/views/workload.js";
import { renderTodo, completeInput } from "../plugins/project-lens/src/ui/views/todo.js";
import { completeTask } from "../plugins/project-lens/src/ui/edit.js";


const load = () => JSON.parse(readFileSync(new URL("../plugins/project-lens/data/sample.json", import.meta.url), "utf8"));
const TODAY = "2026-10-20";
const count = (html, re) => (html.match(re) ?? []).length;
const gantt = (d, ids, extra = {}) => renderGantt(d, ids, TODAY, { window: "m6", ...extra });

// 18 か月規模（2026-04〜2027-09）に延ばしたデータ
function longData() {
  const d = load();
  d.projects[0].start = "2026-04-01"; d.projects[0].due = "2027-09-30";
  d.tasks.find((t) => t.id === "AA-0007").due = "2027-09-30";
  d.tasks.find((t) => t.id === "AA-0006").due = "2027-08-01";
  return d;
}

test("renderProjects: 画面内の「ガント／リスト」切り替え（data-pview）を出さない。view が gantt でも list でも、同じ絞り込みの状態が同じに出る", () => {
  const d = load();
  for (const view of ["gantt", "list"]) {
    const html = renderProjects(d, TODAY, { filter: "AA", view, window: "m6", hideDone: true });
    assert.doesNotMatch(html, /data-pview/);
    assert.match(html, /data-filter="AA" aria-pressed="true"/, view);
  }
});

test("renderProjects(gantt/all): 全プロジェクト名・進捗率・遅延バッジ・マイルストーン、目盛りが共通", () => {
  const d = load();
  const html = renderProjects(d, TODAY, { filter: "all", view: "gantt", window: "m6", hideDone: false });
  for (const p of d.projects) assert.ok(html.includes(p.name), p.name);
  assert.ok(html.includes("(29%)") || html.includes("%"), "進捗率");
  assert.ok(html.includes("期限超過"));
  assert.ok(html.includes("待ち長期化"));
  assert.ok(html.includes("機器発注") && html.includes("原因特定"));
  const ticks = (html.match(/data-tick="[^"]+"/g) ?? []);
  const perSection = ticks.length / 3;
  assert.equal(perSection, Math.floor(perSection), "各ガントの目盛りは同数");
  assert.ok(html.includes('id="h-rk"'), "既定で右の列（今日の優先）が開いている");
});

test("renderProjects: 進捗率の値（Cancelled を除く Done の割合）", () => {
  const html = renderProjects(load(), TODAY, { filter: "AA", view: "gantt", window: "m6" });
  assert.ok(html.includes("2/7 Done (29%)"));
});

test("レーン幅の式に ganttLayout の ratio が使われる", () => {
  const html = gantt(load(), ["AA", "AB", "AC"]);
  const m = /--lanew:calc\(\(100cqw - var\(--lw\) - 12px\) \* ([\d.]+)\)/.exec(html);
  assert.ok(m, "幅の式");
  assert.ok(+m[1] > 1, "6 か月より長い範囲なので 1 より大きい");
  const all = /--lanew:calc\(\(100cqw - var\(--lw\) - 12px\) \* ([\d.]+)\)/.exec(gantt(load(), ["AA"], { window: "all" }));
  assert.equal(+all[1], 1);
});

test("空データでも例外を出さず、空状態を表示する", () => {
  const d = { version: 1, settings: load().settings, projects: [], tasks: [], events: [], changeLog: [] };
  assert.ok(renderProjects(d, TODAY, { filter: "all", view: "gantt", window: "m6" }).includes("プロジェクトがありません"));
  assert.ok(renderProjects(d, TODAY, { filter: "all", view: "list" }).includes("プロジェクトがありません"));
});

test("renderProjects(list): 状態（英語表記）・待ち先・日程変更の履歴・実績", () => {
  const html = renderProjects(load(), TODAY, { filter: "AA", view: "list" });
  for (const s of ["To Do", "In Progress", "Waiting", "Done", "Cancelled"]) assert.ok(html.includes(`>${s}</option>`), s);
  assert.ok(html.includes('value="ベンダーX"'));
  assert.ok(html.includes("ベンダーX の納期回答が遅れたため"));
  assert.ok(html.includes("3.5h・初回 10/14・3回"), "AA-0005 の実績");
  assert.ok(html.includes("前のタスクから"), "前のタスクがあり、開始日の指定がないときは、決まる日と『前のタスクから』を添える");
  assert.ok(html.includes('data-date="1" data-f="start" data-id="AA-0005"'), "前のタスクなしは開始日を入力できる");
  assert.ok(html.includes('data-f="start" data-id="AA-0006"'), "前のタスクありでも開始日を入力できる");
});

test("renderGantt: 行数＝タスク数、今日の線、マイルストーン、実績の線は実績のあるタスクだけ", () => {
  const d = load();
  const html = gantt(d, ["AA"]);
  const tasks = d.tasks.filter((t) => t.projectId === "AA");
  assert.equal(count(html, /data-gt="/g), tasks.length);
  assert.equal(count(html, /class="todayline"/g), 1);
  assert.ok(html.includes("機器発注") && html.includes("8/31"));
  assert.equal(count(html, /class="gact" style="left/g), 1, "実績があるのは AA-0005 だけ");
});

test("renderGantt: 日表示で、手動の休みと祝日の列にも土日と同じ着色（class=\"gwk\"）が付く。土日祝を営業日に数える設定がオンでも付く", () => {
  const d = load();
  const n = (settings) => count(gantt({ ...d, settings: { ...d.settings, ...settings } }, ["AC"], { window: "m1" }), /class="gwk"/g);
  const none = n({ holidays: [], nationalHolidays: { dates: [] }, workdays: [] });
  const withRest = { holidays: [{ date: "2026-10-22", kind: "有給" }], nationalHolidays: { dates: [{ date: "2026-11-03", name: "文化の日" }] }, workdays: [] };
  assert.equal(n(withRest), none + 2);
  assert.equal(n({ ...withRest, countWeekendsAndHolidays: true }), none + 2);
});

test("renderGantt: 1か月は日目盛り（範囲の日数）と土日の着色、3か月は週目盛り", () => {
  const d = load();
  const m1 = gantt(d, ["AC"], { window: "m1" });
  const days = count(m1, /data-tick=/g);
  assert.ok(days > 30 && days < 60);
  const first = /data-tick="([^"]+)"/.exec(m1)[1];
  const last = [...m1.matchAll(/data-tick="([^"]+)"/g)].pop()[1];
  assert.equal(days, diffDays(last, first) + 1);
  assert.ok(count(m1, /class="gwk"/g) >= 8, "土日の着色");
  assert.ok(m1.includes("<small>火</small>"), "曜日");
  const m3 = gantt(d, ["AA"], { window: "m3" });
  assert.equal(count(m3, /class="gwk"/g), 0);
  assert.ok([...m3.matchAll(/data-tick="([^"]+)"/g)].every((m) => new Date(m[1] + "T00:00:00Z").getUTCDay() === 1));
});

test("renderGantt: タスク 0 件。「（なし）」見出しと「＋」", () => {
  const d = load(); d.tasks = d.tasks.filter((t) => t.projectId !== "AC");
  const html = gantt(d, ["AC"]);
  assert.ok(html.includes("（なし）") && html.includes('data-gopen="AC"'));
});

// プロジェクト AC の 3 件に大項目・中項目を付ける（保存順 AC-0001, AC-0002, AC-0003）
const setC = (d, spec) => { for (const [id, group, subgroup, status] of spec) Object.assign(d.tasks.find((t) => t.id === id), { group, subgroup, ...(status ? { status } : {}) }); return d; };
const gotoOrder = (html) => [...html.matchAll(/data-gedit="([^"]+)"/g)].map((m) => m[1]);

test("ガント: 大項目ごとの見出し行に「＋」があり、最下部の入力行はない", () => {
  const html = gantt(load(), ["AA"]);
  assert.ok(html.includes('data-gopen="AA"'));
  assert.ok(!html.includes("g-add") && !html.includes("data-gadd="));
});

test("ガント: 保存順が X/a, Y/b, X/c でも、X の2件が続けて並ぶ", () => {
  const d = setC(load(), [["AC-0001", "X", "a"], ["AC-0002", "Y", "b"], ["AC-0003", "X", "c"]]);
  assert.deepEqual(gotoOrder(gantt(d, ["AC"])), ["AC-0001", "AC-0003", "AC-0002"]);
});

test("ガント: 完了を隠す中でも、グループの見出しが残る", () => {
  const d = setC(load(), [["AC-0001", "X", "a"], ["AC-0002", "Y", "b", "Done"], ["AC-0003", "X", "c"]]);
  const html = gantt(d, ["AC"], { hideDone: true });
  assert.ok(html.includes('data-ag="Y"') && !html.includes('data-gedit="AC-0002"'));
});

test("ガント: addAt のある見出しに名前入力が出る。大項目名の特殊文字は escape される", () => {
  const g = 'A"<b>|';
  const d = setC(load(), [["AC-0001", g, "a"]]);
  const html = gantt(d, ["AC"], { addAt: { pid: "AC", group: g, subgroup: "a" } });
  assert.ok(html.includes('data-gadd="AC"') && html.includes('data-ag="A&quot;&lt;b&gt;|"'));
  assert.ok(!html.includes(g));
  assert.ok(html.includes("data-gaddok=") && html.includes("data-gaddno"));
});

test("ガント: 大項目が空で中項目だけあるタスクは「（なし）」のブロックに出る", () => {
  const d = setC(load(), [["AC-0001", "X", "a"], ["AC-0002", "", "メモ"], ["AC-0003", null, null]]);
  assert.deepEqual(gotoOrder(gantt(d, ["AC"])), ["AC-0001", "AC-0002", "AC-0003"]);
});

test("renderGantt: 完了を隠すと Done の行だけが減る（進捗は変わらない）", () => {
  const d = longData();
  const all = gantt(d, ["AA"]);
  const hid = gantt(d, ["AA"], { hideDone: true });
  const done = d.tasks.filter((t) => t.projectId === "AA" && t.status === "Done").length;
  assert.equal(count(all, /data-gt="/g) - count(hid, /data-gt="/g), done);
  assert.ok(hid.includes("2/7 Done"));
});

test("renderProjects: filter に指定したプロジェクトだけが出る", () => {
  const html = renderProjects(load(), TODAY, { filter: "AA", view: "gantt", window: "m6" });
  assert.ok(html.includes('data-gt="AA-0003"'));
  assert.ok(!html.includes('data-gt="AB-0002"') && !html.includes('data-gt="AC-0001"'));
  assert.ok(!html.includes('data-gp="AB"'));
});

test("利用者入力はエスケープされる", () => {
  const d = load();
  d.tasks[0].title = "<script>alert(1)</script>";
  d.projects[0].name = "<img src=x onerror=1>";
  for (const view of ["gantt", "list"]) {
    const html = renderProjects(d, TODAY, { filter: "all", view, window: "m6" });
    assert.ok(!html.includes("<script>alert"), view);
    assert.ok(!html.includes("<img src=x"), view);
    assert.ok(html.includes("&lt;script&gt;"), view);
  }
});

test("前のタスクがあるバーにも、左端のつまみがある（前のタスクとの関係は見ない）", () => {
  const html = gantt(load(), ["AA"]);
  const bar = (id) => new RegExp(`<i class="gbar[^"]*"[^>]*data-gt="${id}"[^>]*>(.*?)</i>`).exec(html)?.[1] ?? "";
  assert.ok(bar("AA-0004").includes('data-gh="l"'));
  assert.ok(bar("AA-0004").includes('data-gh="r"'));
  assert.ok(bar("AA-0005").includes('data-gh="l"'));
  assert.ok(html.includes("data-gp=") && html.includes("data-gms=") && html.includes("data-gedit=") && html.includes("data-gopen="));
});

test("addDays は表示範囲の計算に使える", () => {
  assert.equal(addDays(TODAY, -10), "2026-10-10");
});

// ---- スケジュール画面 ----
const NOW = { date: "2026-10-20", time: "10:15" };
const sched = (d, o = {}) => renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW, ...o });

test("snapStart: 15分刻み・その日（00:00〜23:59）の中に収める", () => {
  assert.equal(snapStart(10 * 60 + 7, 60), 10 * 60);
  assert.equal(snapStart(7 * 60 + 50, 60), 7 * 60 + 45, "勤務時間の制限はない（朝 7 時台にも置ける）");
  assert.equal(snapStart(-20, 60), 0);
  assert.equal(snapStart(23 * 60 + 50, 60), 22 * 60 + 45, "終了が 23:59 を超えない 15 分刻みの最後");
  assert.equal(snapStart(23 * 60 + 50, 15), 23 * 60 + 30);
});

test("calendarGeometry: 時間の軸は 00:00〜24:00 の固定（設定に依らない）", () => {
  const g = calendarGeometry();
  assert.deepEqual([g.h0, g.span], [0, 24 * 60]);
  assert.equal(g.tp(12 * 60), "50.000%");
  const html = renderSchedule(load(), TODAY, { view: "day", date: TODAY, now: NOW, showPrio: false });
  assert.equal(count(html, /class="hour"/g), 25, "0:00〜24:00 の 25 本");
  assert.ok(html.includes("<span>0:00</span>") && html.includes("<span>24:00</span>"));
});

test("renderSchedule(day): 優先タスクと理由・枠の種別クラス・実績時間", () => {
  const d = load();
  d.tasks.find((t) => t.id === "AA-0005").sessions.push({ id: "S9", date: "2026-10-20", start: "09:00", end: "09:30", kind: "planned" }); // 過ぎた予定 = 未確認
  const html = sched(d);
  assert.ok(html.includes('id="h-rk"') && html.includes("催促") && html.includes("期限超過 4日"));
  assert.ok(html.includes('class="blk task unconf'), "未確認");
  const w = renderSchedule(load(), TODAY, { view: "week", date: "2026-10-19", now: NOW });
  assert.ok(w.includes("class=\"blk task act"), "実績");
  assert.ok(w.includes("class=\"blk task plan"), "予定");
  assert.ok(w.includes(`${(3.5).toFixed(1)}時間`), "週の実績(10/19 の 1.5h + 1h + ZZ-0001 の 1h)");
  assert.equal(taskActual(load(), "AA-0005").hours + taskActual(load(), "AB-0002").hours, 4.5);
});

test("renderSchedule(week): 7 日分の列と会議の時間枠・件名（画面では常に件名を出す）", () => {
  const d = load();
  const html = renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW });
  assert.equal(count(html, /class="col dz/g), 7);
  for (const day of ["2026-10-19", "2026-10-25"]) assert.ok(html.includes(`data-date="${day}"`));
  assert.ok(html.includes("NW運用定例"));
  assert.ok(html.includes("class=\"blk mtg"));
});

test("renderSchedule(week): 不明な状態のタスクが期限欄にあっても例外にしない（validate が注意を出す。画面は白くしない）", () => {
  const d = load();
  d.tasks.find((t) => t.id === "AB-0002").status = "Doing"; // 期限 2026-10-23 は表示中の週
  const html = renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW });
  assert.ok(html.includes("ルータ設定の作成"));
});

test("renderCalendar(week): 期限の行は、日付の見出し（.dh）のすぐ下・時間の軸の上にあり、左端に開閉のボタン（既定は開く）。閉じると、各日のセルを出さず、件数の帯だけ", () => {
  const d = load();
  const open = renderCalendar(d, TODAY, { view: "week", date: TODAY, now: NOW });
  const lastDh = open.lastIndexOf('class="dh'), hd = open.indexOf('class="duehd"'), cell = open.indexOf('class="duecell"'), hrs = open.indexOf('class="hrs"');
  assert.ok(lastDh < hd && hd < cell && cell < hrs, "日付の見出し → 期限の行 → 時間の軸");
  assert.equal(count(open, /class="duecell"/g), 7);
  assert.ok(open.includes('<button class="duetg" data-sdue aria-expanded="true"') && open.includes("期限 ▾"), "開いているときのボタン");
  assert.ok(open.includes("ルータ設定の作成"), "期限の件名を出す");
  assert.equal(count(open, /class="week"/g), 1, "期限の行は、カレンダーと同じ 1 つの格子の中（下の別の格子は持たない）");
  assert.ok(!/AB-0002|AA-\d{4}/.test(open), "ID は出さない");
  const closed = renderCalendar(d, TODAY, { view: "week", date: TODAY, now: NOW, showDue: false });
  assert.ok(closed.includes('aria-expanded="false"') && closed.includes("期限 ▸"));
  assert.ok(!closed.includes('class="duecell"') && !closed.includes('class="impt"') && !closed.includes("dot "), "閉じると各日のセル（件名・状態の点）は出さない");
  assert.match(closed, /class="dueoff"[^>]*>この週の期限 \d+ 件</);
  assert.ok(closed.indexOf('class="dueoff"') < closed.indexOf('class="hrs"'));
  const day = renderCalendar(d, TODAY, { view: "day", date: TODAY, now: NOW });
  assert.ok(!day.includes("data-sdue") && !day.includes("duecell"), "日表示には期限の行が無い（変えない）");
});

test("renderCalendar(week): 期限の行の重要のタスクの件名に impt が付く", () => {
  const d = load();
  const t = d.tasks.find((x) => x.id === "AB-0002");
  t.important = true;
  const html = renderCalendar(d, TODAY, { view: "week", date: TODAY, now: NOW });
  assert.ok(html.includes(`<span class="impt">${t.title}</span>`));
});

test("renderSchedule: 『実績にする』のボタン（data-confirm・data-confirmmtg・data-confirmall）は、未確認があっても出さない／選択がなければ『枠を削除』は無効", () => {
  const d = load();
  const un = load();
  un.tasks.find((t) => t.id === "AA-0005").sessions.push({ id: "S9", date: TODAY, start: "08:00", end: "09:00", kind: "planned" }); // 過ぎた予定 = 未確認
  Object.assign(un.events.find((e) => e.id === "m1"), { confirmed: false, end: "10:00" }); // 過ぎた会議 = 未確認
  assert.ok(sched(un).includes("未確認 2件（作業枠 1・会議 1）"), "未確認の札は残す");
  for (const v of ["day", "week"]) {
    const h = sched(un, { view: v });
    for (const a of ["data-confirm=", "data-confirmmtg=", "data-confirmall"]) assert.ok(!h.includes(a), `${v}: ${a}`);
  }
  const html = sched(d);
  assert.ok(/data-delsel disabled>枠や会議を選んで削除/.test(html));
  assert.ok(!sched(d, { selSess: "S2" }).includes("の枠を削除"), "表示外の選択は無効");
  const sel = sched(d, { selSess: "S2", date: "2026-10-19" });
  assert.ok(sel.includes("「切替手順書の作成」の枠を削除"));
  assert.ok(!/data-delsel disabled/.test(sel));
  assert.ok(sel.includes("blk task act sel"));
});

test("renderSchedule: 過ぎた予定の枠は、時間が重なる実績が無ければ unconf。重なる実績を足すと unconf でなくなる（予定の枠は残る）", () => {
  const d = load();
  d.tasks.find((t) => t.id === "AA-0005").sessions.push({ id: "S9", date: TODAY, start: "08:00", end: "09:00", kind: "planned" });
  assert.ok(/class="blk task unconf[^"]*"[^>]*data-dragsess="S9"/.test(sched(d)), "実績が無ければ未確認");
  d.tasks.find((t) => t.id === "AA-0004").sessions = [{ id: "S20", date: TODAY, start: "08:30", end: "09:30", kind: "actual" }];
  const html = sched(d);
  assert.ok(/class="blk task plan[^"]*"[^>]*data-dragsess="S9"/.test(html), "重なる実績があれば予定のまま");
  assert.ok(!html.includes("blk task unconf"));
});

test("actualForm: 開始が今以前の予定の枠を選ぶと、実績の入力欄（開始・終了は枠の時刻、保存は data-actsave）を出す。実績の枠・未来の予定の枠では出さない", () => {
  const d = load();
  d.tasks.find((t) => t.id === "AA-0005").sessions.push({ id: "S9", date: TODAY, start: "08:00", end: "09:00", kind: "planned" }, { id: "S10", date: TODAY, start: "10:15", end: "11:00", kind: "planned" }, { id: "S11", date: TODAY, start: "10:30", end: "11:30", kind: "planned" });
  const html = sched(d, { selSess: "S9" });
  assert.ok(html.includes('<div class="actform" role="group" aria-label="実績の入力">'), html);
  assert.match(html, /<input[^>]*data-ac="start"[^>]*value="08:00"/);
  assert.match(html, /<input[^>]*data-ac="end"[^>]*value="09:00"/);
  assert.ok(html.includes('data-actsave="S9"') && html.includes(">実績を保存</button>"));
  assert.ok(!html.includes('data-ac="task"'), "枠から入れるときは、タスクを選ばない");
  assert.ok(sched(d, { selSess: "S10" }).includes('data-actsave="S10"'), "開始が今ちょうどの枠も出す");
  assert.ok(!sched(d, { selSess: "S11" }).includes('class="actform"'), "未来の予定の枠");
  assert.ok(!sched(d, { selSess: "S2", date: "2026-10-19" }).includes('class="actform"'), "実績の枠");
  assert.ok(!sched(d).includes('class="actform"'), "選択なし");
});

test("actualForm: 「実績を追加」（actAdd）では、タスク（Done・Cancelled 以外、文言は件名）・日付・開始・終了と、保存・キャンセルを出す", () => {
  const d = load();
  d.tasks.find((t) => t.id === "AA-0004").status = "Cancelled";
  const html = sched(d, { actAdd: { date: TODAY } });
  assert.ok(html.includes('<div class="actform" role="group" aria-label="実績の入力">'));
  const sel = /<select[^>]*data-ac="task"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1];
  assert.ok(sel, "タスクの選択");
  assert.ok(sel.includes(">切替手順書の作成（本社コアSW更改）</option>") && sel.includes(">問い合わせ対応</option>"), "プロジェクトありは（名前）を添え、なしは件名だけ");
  assert.ok(!sel.includes("要件整理") && !sel.includes("検証環境の構築"), "Done・Cancelled は候補にしない");
  assert.ok(!/>[A-Z]{2}-\d{4}</.test(sel), "ID は文言に出さない");
  assert.match(html, /data-ac="date"[^>]*value="2026-10-20"/);
  assert.ok(html.includes('data-ac="start"') && html.includes('data-ac="end"'));
  assert.ok(html.includes('data-actsave=""') && html.includes("data-actcancel"));
  assert.ok(!sched(d).includes('class="actform"'), "actAdd が無ければ出さない");
});

test("actualForm: 「実績を追加」の開始・終了の既定。今日は現在時刻を 15 分刻みに切り捨て＋60 分（23:59 まで）、過去は 09:00-10:00", () => {
  const d = load();
  const f = (date, time) => {
    const h = sched(d, { actAdd: { date }, now: { date: TODAY, time } });
    return [/data-ac="start"[^>]*value="([^"]*)"/.exec(h)[1], /data-ac="end"[^>]*value="([^"]*)"/.exec(h)[1]];
  };
  assert.deepEqual(f(TODAY, "08:20"), ["08:15", "09:15"]);
  assert.deepEqual(f(TODAY, "23:50"), ["23:45", "23:59"]);
  assert.deepEqual(f("2026-10-19", "08:20"), ["09:00", "10:00"]);
});

test("actualForm: 下書き（actDraft）の key が同じ欄は、下書きのタスク（selected）・日付・時刻で描く。違う key の下書きは使わない", () => {
  const d = load();
  d.tasks.find((t) => t.id === "AA-0005").sessions.push({ id: "S9", date: TODAY, start: "08:00", end: "09:00", kind: "planned" });
  const dr = { key: "add", task: "AA-0005", date: "2026-10-19", start: "11:15", end: "12:00" };
  const html = sched(d, { actAdd: { date: TODAY }, actDraft: dr });
  const sel = /<select[^>]*data-ac="task"[^>]*>([\s\S]*?)<\/select>/.exec(html)[1];
  assert.match(sel, /<option value="AA-0005" selected>/);
  assert.equal((sel.match(/ selected/g) ?? []).length, 1);
  assert.match(html, /data-ac="date"[^>]*value="2026-10-19"/);
  assert.match(html, /<input[^>]*data-ac="start"[^>]*value="11:15"/);
  assert.match(html, /<input[^>]*data-ac="end"[^>]*value="12:00"/);
  assert.match(sched(d, { selSess: "S9", actDraft: { key: "S9", start: "08:15", end: "08:45" } }), /<input[^>]*data-ac="start"[^>]*value="08:15"/);
  assert.match(sched(d, { selSess: "S9", actDraft: { key: "add", start: "11:15", end: "12:00" } }), /<input[^>]*data-ac="start"[^>]*value="08:00"/);
  const other = sched(d, { actAdd: { date: TODAY }, actDraft: { key: "S9", task: "AA-0005", start: "11:30", end: "12:00" } });
  assert.ok(!other.includes(" selected") && !other.includes('value="11:30"'), "別の欄の下書きは使わない");
});

// ---- 予定の枠の実績（actual）の入力欄 ----
const withPlan = (s) => { const d = load(); d.tasks.find((t) => t.id === "AA-0005").sessions.push({ kind: "planned", ...s }); return d; };
const acv = (html, k) => new RegExp(`<input[^>]*data-ac="${k}"[^>]*value="([^"]*)"`).exec(html)?.[1];

test("actualForm: 予定の枠（開始が今以前）で、日付・開始・終了が予定の値、ボタンの文言は「実績を保存」、実績を消すボタンは無い", () => {
  const html = sched(withPlan({ id: "S9", date: TODAY, start: "08:00", end: "09:00" }), { selSess: "S9" });
  assert.deepEqual([acv(html, "date"), acv(html, "start"), acv(html, "end")], [TODAY, "08:00", "09:00"]);
  assert.ok(html.includes('data-actsave="S9">実績を保存</button>'), html);
  assert.ok(!html.includes("data-actclear"));
});

test("actualForm: actual を持つ予定の枠では、初期値が actual の値、文言は「実績を更新」、data-actclear が出る", () => {
  const html = sched(withPlan({ id: "S9", date: TODAY, start: "08:00", end: "09:00", actual: { date: "2026-10-19", start: "08:15", end: "09:30" } }), { selSess: "S9" });
  assert.deepEqual([acv(html, "date"), acv(html, "start"), acv(html, "end")], ["2026-10-19", "08:15", "09:30"]);
  assert.ok(html.includes('data-actsave="S9">実績を更新</button>'), html);
  assert.ok(html.includes('data-actclear="S9">実績を消す</button>'), html);
});

test("actualForm: 開始が今より後の予定の枠でも、actual を持てば出る（持たなければ出ない）", () => {
  const fut = { id: "S9", date: "2026-10-21", start: "08:00", end: "09:00" };
  assert.ok(!sched(withPlan(fut), { selSess: "S9", date: fut.date }).includes('class="actform"'));
  const html = sched(withPlan({ ...fut, actual: { date: TODAY, start: "08:00", end: "09:00" } }), { selSess: "S9", date: fut.date });
  assert.ok(html.includes('data-actsave="S9">実績を更新</button>') && html.includes('data-actclear="S9"'), html);
});

test("actualForm: 下書きの日付・時刻が値になる", () => {
  const html = sched(withPlan({ id: "S9", date: TODAY, start: "08:00", end: "09:00" }), { selSess: "S9", actDraft: { key: "S9", task: "", date: "2026-10-19", start: "07:00", end: "07:45" } });
  assert.deepEqual([acv(html, "date"), acv(html, "start"), acv(html, "end")], ["2026-10-19", "07:00", "07:45"]);
});

test("会議フォーム: 下書き（key が m:<会議 ID>）の実績の開始・終了で描く。別の会議の下書きは使わない", () => {
  const d = noSessions();
  const html = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, selMtg: "m1", actDraft: { key: "m:m1", start: "09:45", end: "10:15" } });
  assert.match(html, /<input[^>]*data-ma="start"[^>]*value="09:45"/);
  assert.match(html, /<input[^>]*data-ma="end"[^>]*value="10:15"/);
  assert.match(renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, selMtg: "m1", actDraft: { key: "m:m2", start: "09:45", end: "10:15" } }), /<input[^>]*data-ma="start"[^>]*value="09:30"/);
});

test("meetingBlocks: actual を持つ会議は、実績の時刻に data-mact の 1 つだけ（文字は「実績 開始-終了 ✓」、title に予定の時刻）。ドラッグ・伸縮の属性なし。時刻が予定と違うときだけ、予定の時刻に影（data-mghost）", () => {
  const d = noSessions();
  Object.assign(d.events.find((e) => e.id === "m1"), { confirmed: true, actual: { start: "09:35", end: "10:20" } });
  Object.assign(d.events.find((e) => e.id === "m2"), { confirmed: true, actual: { start: "13:00", end: "14:00" } }); // 手動の会議・予定と同じ時刻
  const g = calendarGeometry();
  const tag = (h, a) => new RegExp(`<div class="blk mtg[^>]*${a}[^>]*>`).exec(h)?.[0] ?? "";
  for (const view of ["week", "day"]) {
    const h = renderSchedule(d, TODAY, { view, date: TODAY, now: NOW15 });
    for (const id of ["m1", "m2"]) {
      assert.equal((h.match(new RegExp(`data-mact="${id}"`, "g")) ?? []).length, 1, `${view} ${id}: 実績のブロックは 1 つ`);
      assert.ok(!h.includes(`data-mtg="${id}"`), `${view} ${id}: 予定のブロックは無い`);
      const b = tag(h, `data-mact="${id}"`);
      assert.ok(/class="blk mtg act[ "]/.test(b), `${view} ${id}: 実績後の見た目 ${b}`);
      assert.ok(!b.includes("draggable") && !b.includes("data-dragmtg"), `${view} ${id}: ドラッグなし ${b}`);
      assert.ok(!new RegExp(`data-rzm="${id}"`).test(h), `${view} ${id}: 伸縮の取っ手なし`);
    }
    assert.ok(tag(h, 'data-mact="m1"').includes(`style="top:${g.tp(9 * 60 + 35)};height:${g.ht(9 * 60 + 35, 10 * 60 + 20)}"`), `${view}: 実績の時刻の位置`);
    assert.match(tag(h, 'data-mact="m1"'), /title="NW運用定例\(予定 09:30-10:30\)/);
    assert.ok(/data-mact="m1"[^>]*><span class="tm">実績 09:35-10:20 ✓<\/span>/.test(h), `${view}: 文字`);
    const gh = tag(h, 'data-mghost="m1"');
    assert.ok(/class="blk mtg pghost[ "]/.test(gh), `${view}: 影 ${gh}`);
    assert.ok(gh.includes(`style="top:${g.tp(9 * 60 + 30)};height:${g.ht(9 * 60 + 30, 10 * 60 + 30)}"`), `${view}: 影は予定の時刻`);
    assert.ok(!gh.includes("draggable") && !gh.includes("data-dragmtg") && !gh.includes("data-mtg="), `${view}: 影はドラッグなし`);
    assert.ok(!h.includes('data-mghost="m2"'), `${view}: 予定と同じ時刻なら影なし`);
    assert.ok(h.indexOf('data-mghost="m1"') < h.indexOf('data-mact="m1"'), `${view}: 影は実績のブロックのうしろ（先に描く）`);
  }
  const sel = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, selMtg: "m1" });
  assert.ok(/class="blk mtg act[^"]*\bsel\b[^"]*"[^>]*data-mact="m1"/.test(sel), "選択中");
});

test("meetingBlocks: confirmed: true で actual の無い会議は、予定の時刻に act の class で出る（data-mact ではない）。手動の会議は今までどおりドラッグ・伸縮できる", () => {
  const d = noSessions();
  d.events.find((e) => e.id === "m2").confirmed = true;
  for (const view of ["week", "day"]) {
    const h = renderSchedule(d, TODAY, { view, date: TODAY, now: NOW15 });
    const b = /<div class="blk mtg[^>]*data-mtg="m2"[^>]*>/.exec(h)?.[0] ?? "";
    assert.ok(/class="blk mtg\s+act[ "]/.test(b) && b.includes('draggable="true" data-dragmtg="m2"'), `${view}: ${b}`);
    assert.ok(h.includes('data-rzm="m2"') && !h.includes('data-mact="m2"') && !h.includes('data-mghost="m2"'), view);
    assert.ok(h.includes("13:00-14:00 ✓"), view);
  }
});

test("renderSchedule: 凡例（会議・予定・実績・未確認、日は現在時刻）。空き時間の凡例は出さない", () => {
  const day = sched(load());
  for (const w of ["会議", "予定", "実績", "未確認", "現在時刻"]) assert.ok(day.includes(w), w);
  assert.ok(!day.includes("sw free") && !day.includes("空き時間"));
  const wk = renderSchedule(load(), TODAY, { view: "week", date: TODAY, now: NOW });
  assert.ok(!wk.includes("現在時刻") && wk.includes("未確認"));
  assert.ok(day.includes('class="nowline"'));
});

test("renderSchedule: 凡例は、予定・未確認・実績の 3 つの状態を、枠・会議ともに示し、実績とずれた予定の影（点線）も示す", () => {
  for (const view of ["week", "day"]) {
    const lg = /<div class="slegend"[^]*?<\/div>/.exec(renderSchedule(load(), TODAY, { view, date: TODAY, now: NOW }))[0];
    for (const w of ['<i class="sw plan"></i>予定', '<i class="sw unconf"></i>未確認', '<i class="sw act"></i>実績', '<i class="sw mtgun"></i>未確認の会議', '<i class="sw mtgact"></i>会議の実績', '<i class="sw pghost"></i>']) assert.ok(lg.includes(w), `${view}: ${w}`);
  }
});

test("renderSchedule: 凡例は上の操作の行（週・日の見出しの横）に置き、カレンダーの下（renderCalendar）には出さない", () => {
  for (const view of ["day", "week"]) {
    const html = renderSchedule(load(), TODAY, { view, date: TODAY, now: NOW });
    const nav = html.slice(0, html.indexOf('<div id="mtgslot">'));
    assert.ok(nav.includes('class="slegend"') && nav.indexOf("<strong") < nav.indexOf('class="slegend"'), `${view}: 見出しの後ろ`);
    assert.equal((html.match(/class="slegend"/g) ?? []).length, 1, view);
    assert.ok(!renderCalendar(load(), TODAY, { view, date: TODAY, now: NOW }).includes("slegend"), view);
  }
});

test("renderSchedule: 手入力の会議だけドラッグ可、参加しない会議は skip 表示、MCP 会議は編集不可の注意", () => {
  const d = load();
  d.events.find((e) => e.id === "m1").skip = true;
  const html = sched(d, { selMtg: "m1", showSkipped: true });
  assert.ok(/data-mtg="m2"[^>]*draggable="true"/.test(html));
  assert.ok(!/data-mtg="m1"[^>]*draggable/.test(html));
  assert.ok(html.includes("blk mtg skip"));
  assert.ok(html.includes("予定表から取得した会議です") && html.includes("data-mt=\"title\" value=\"NW運用定例\" placeholder=\"会議名\" style=\"min-width:200px\" disabled"));
});

test("renderSchedule: 優先リストはドラッグ可で、置いた回数と実績時間を出す。早朝の会議も表示する（勤務時間の切り詰めはない）", () => {
  const d = load();
  d.events.push({ id: "m9", date: "2026-10-20", start: "07:00", end: "08:30", title: "早朝作業", source: "manual", skip: false, externalId: null });
  const html = sched(d);
  assert.ok(/draggable="true" data-dragtask="AB-0002"/.test(html));
  assert.ok(!html.includes("data-pick") && !html.includes("picked"), "押して選ぶ方法は持たない（ドラッグだけで配置する）");
  assert.ok(!/<li[^>]*data-dragtask[^>]*tabindex/.test(html), "行はフォーカスを受けない");
  assert.ok(html.includes("タスクをカレンダーへドラッグして配置します(15分刻み・長さ1時間)。今日のタスクの行からも、同じタスクをもう 1 つ置けます。配置済みの枠もドラッグで移動できます。</p>") && !html.includes("キーボード"), "注記に選んで配置する文がない");
  assert.ok(html.includes("2回・実績 1.0h"));
  assert.ok(html.includes("早朝作業"));
});

test("リスト: 「重要」のチェックボックスとメモを編集できる。重要で未完了の行にだけ印（imp）が付く", () => {
  const d = load();
  for (const [id, imp, st] of [["AA-0001", true, "Done"], ["AA-0002", true, "Cancelled"], ["AA-0003", true, "Waiting"], ["AA-0004", false, "To Do"]]) {
    const t = d.tasks.find((x) => x.id === id); if (imp) t.important = true; else delete t.important; t.status = st;
  }
  const html = renderProjects(d, TODAY, { filter: "AA", view: "list" });
  assert.ok(html.includes('<tr class="imp" data-row="AA-0003"'));
  for (const id of ["AA-0001", "AA-0002", "AA-0004"]) assert.ok(!html.includes(`<tr class="imp" data-row="${id}"`), id);
  assert.ok(/<input type="checkbox" data-f="important" data-id="AA-0003" checked/.test(html), "AA-0003 は重要");
  assert.ok(/<input type="checkbox" data-f="important" data-id="AA-0004"(?! checked)/.test(html), "AA-0004 は重要でない");
  assert.ok(!html.includes("重要度") && !html.includes('data-f="importance"'));
  assert.ok(html.includes('data-f="memo" data-id="AA-0003" value="納期回答待ち"'));
});

// ---- 表示スイッチ（Task 12） ----
test("renderGantt: showActual:false で .gact と凡例の実績が消える（true では従来どおり）", () => {
  const d = load();
  const on = gantt(d, ["AA", "AB"]);
  assert.ok(count(on, /class="gact"/g) > 0 && on.includes("実績(最初の作業日"));
  const off = gantt(d, ["AA", "AB"], { showActual: false });
  assert.equal(count(off, /class="gact"/g), 0);
  assert.ok(!off.includes("実績(最初の作業日"));
  assert.equal(count(gantt(d, ["AA", "AB"], { showActual: true }), /class="gact"/g), count(on, /class="gact"/g));
});

test("renderProjects/renderSchedule: showPrio:false で『今日の優先』が出ず、cols に one が付く", () => {
  const d = load();
  const p = renderProjects(d, TODAY, { filter: "all", view: "gantt", window: "m6", showPrio: false });
  assert.ok(!p.includes('id="h-rk"') && p.includes('class="cols one"'), "パネル（見出し h-rk）が出ない。取っ手の名前には「今日の優先」が入る");
  const s = sched(d, { showPrio: false });
  assert.ok(!s.includes('id="h-rk"') && s.includes('class="cols one"'));
  assert.ok(renderProjects(d, TODAY, { filter: "all", view: "gantt", window: "m6" }).includes('id="h-rk"'), "既定で開いている");
  assert.ok(sched(d).includes('id="h-rk"'), "既定で開いている");
});

// ---- 大項目・中項目（Task 13） ----
const noGroups = () => { const d = load(); for (const t of d.tasks) { delete t.group; delete t.subgroup; } return d; };

test("リスト: 大項目・中項目の入力欄と、設定したラベル名の見出し", () => {
  const d = load();
  const html = renderProjects(d, TODAY, { filter: "AA", view: "list" });
  assert.ok(html.includes("<th>大項目</th><th>中項目</th>"));
  assert.ok(html.includes('data-f="group" data-id="AA-0001"') && html.includes('value="設計"'));
  assert.ok(html.includes('data-f="subgroup" data-id="AA-0003"') && html.includes('value="機器選定"'));
  d.settings.labels = { group: "フェーズ", subgroup: "作業群" };
  const h2 = renderProjects(d, TODAY, { filter: "AA", view: "list" });
  assert.ok(h2.includes("<th>フェーズ</th><th>作業群</th>"));
});

test("renderGantt: g-grp の区切り行が group ごとに出る。「（なし）」も常に出す", () => {
  const d = load();
  const html = gantt(d, ["AA"]);
  assert.equal(count(html, /class="g-row g-grp"/g), 5, "4 グループ＋追加の入口の「（なし）」");
  assert.ok(html.includes("調達") && html.includes("▸ 機器選定"));
  assert.ok(html.indexOf("設計") < html.indexOf('data-gt="AA-0001"') && html.indexOf('data-gt="AA-0001"') < html.indexOf("調達"));
  const head = /class="g-row g-grp"/g;
  assert.equal(count(gantt(noGroups(), ["AA"]), head), 1, "編集画面は「（なし）」だけ出る");
});

const rowOrder = (html) => [...html.matchAll(/<tr data-row="([^"]+)"/g)].map((m) => m[1]);
const listOf = (d, pid, extra = {}) => renderProjects(d, TODAY, { filter: pid, view: "list", ...extra });

test("リスト: 大項目・中項目ごとの見出し行があり、同じグループのタスクが続けて並ぶ", () => {
  const d = setC(load(), [["AC-0001", "X", "a"], ["AC-0002", "Y", "b"], ["AC-0003", "X", "c"]]);
  const html = listOf(d, "AC");
  assert.deepEqual(rowOrder(html), ["AC-0001", "AC-0003", "AC-0002"]);
  assert.equal(count(html, /class="grp-tr"/g), 4, "X/a, X/c, Y/b と、追加の入口の（なし）");
  assert.ok(html.includes('data-addat="AC" data-ag="X" data-asg="a"'));
});

test("リスト: 最下部の「＋ タスクを追加」ボタンはない", () => {
  assert.ok(!listOf(load(), "AA").includes("data-addtask"));
});

test("リスト: 0件のプロジェクトにも「（なし）」見出しと「＋」が出る", () => {
  const d = load(); d.tasks = d.tasks.filter((t) => t.projectId !== "AC");
  const html = listOf(d, "AC");
  assert.ok(html.includes("（なし）") && html.includes('data-addat="AC"'));
});

test("リスト: 大項目名の特殊文字は escape され、「＋」の属性に入る", () => {
  const g = 'A"<b>|';
  const html = listOf(setC(load(), [["AC-0001", g, "a"]]), "AC");
  assert.ok(html.includes('data-ag="A&quot;&lt;b&gt;|"'));
  assert.ok(!html.includes(g));
});

test("ガント: 編集画面の凡例は上端（固定の帯）にある", () => {
  const top = gantt(load(), ["AA"]);
  assert.ok(top.indexOf('class="gtop"') >= 0 && top.indexOf('class="gtop"') < top.indexOf('class="legend"'));
  assert.ok(top.indexOf('class="legend"') < top.indexOf('class="gscroll"'), "凡例が表より前");
  assert.equal(count(top, /class="legend"/g), 1);
});

test("今日の優先のパネルは、固定表示のための prio クラスを持つ（プロジェクト画面・スケジュール画面）", () => {
  assert.ok(renderProjects(load(), TODAY, { filter: "all", view: "list" }).includes('<section class="panel prio"'));
  assert.ok(sched(load()).includes('<section class="panel prio"'));
});

test("プロジェクト画面のフィルタ行は、固定表示のための ptool クラスを持つ", () => {
  for (const view of ["gantt", "list"]) assert.ok(renderProjects(load(), TODAY, { filter: "all", view, window: "m6" }).includes('<div class="toolbar ptool">'), view);
});

const sections = (html) => [...html.matchAll(/<section class="pg" aria-label="([^"]*)"/g)].map((m) => m[1]);
const NAMES = { AA: "本社コアSW更改", AB: "拠点B 回線増設", AC: "VPN 断続切断の対処" };

test("ガント: 完了を隠すと、状態が「完了」のプロジェクトと、タスクが全部 Done のプロジェクトも隠れる", () => {
  const d = load();
  d.projects.find((p) => p.id === "AB").status = "完了";
  for (const t of d.tasks.filter((x) => x.projectId === "AC")) t.status = "Done";
  assert.deepEqual(sections(gantt(d, ["AA", "AB", "AC"])), [NAMES.AA, NAMES.AB, NAMES.AC], "隠さないときは全部");
  assert.deepEqual(sections(gantt(d, ["AA", "AB", "AC"], { hideDone: true })), [NAMES.AA]);
});

test("ガント: 1 つのプロジェクトを選んでいるときは、完了していても完了を隠すで消さない", () => {
  const d = load(); d.projects.find((p) => p.id === "AB").status = "完了";
  assert.deepEqual(sections(gantt(d, ["AB"], { hideDone: true })), [NAMES.AB]);
});

test("ガント: 全プロジェクトが隠れても、「完了を隠す」の切り替えは残り、理由を出す", () => {
  const d = load(); for (const p of d.projects) p.status = "完了";
  const html = gantt(d, ["AA", "AB", "AC"], { hideDone: true });
  assert.ok(html.includes("data-hidedone") && html.includes("完了したプロジェクトを隠しています"));
  assert.deepEqual(sections(html), []);
});

test("今日の優先: どのプロジェクトのタスクかを、項目の先頭の見出しで示す（プロジェクト画面・スケジュール画面）", () => {
  const d = load();
  for (const sched of [false, true]) {
    const html = renderPrio(d, TODAY, { sched });
    assert.ok(count(html, /<span class="pj">/g) >= 1, `sched=${sched}`);
    assert.ok([...html.matchAll(/<span class="pj">([^<]*)<\/span>/g)].every((m) => [...Object.values(NAMES), "プロジェクトなし"].includes(m[1])));
  }
  assert.ok(!renderPrio(d, TODAY, { sched: false }).includes(" ・ "), "説明文に重複して出さない");
});

test("利用者入力（group 名）はエスケープされる", () => {
  const d = load(); d.tasks.find((t) => t.id === "AA-0001").group = "<img src=x onerror=1>";
  const html = renderProjects(d, TODAY, { filter: "AA", view: "gantt", window: "m6" }) + renderProjects(d, TODAY, { filter: "AA", view: "list" });
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img src=x"));
});

// ---- 会議のプロジェクトと確認（Task 14） ----
const NOW15 = { date: "2026-10-20", time: "15:10" };
const noSessions = () => { const d = load(); for (const t of d.tasks) t.sessions = []; return d; };

test("会議ブロック: 過ぎて未確認なら unconf と「未確認」（ボタンは無い）。確認済みは ✓。skip は従来の表示", () => {
  const d = noSessions();
  d.events.find((e) => e.id === "m3").date = "2026-10-20";
  const html = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15 });
  assert.ok(/class="blk mtg\s+act[^"]*"[^>]*data-mtg="m1"/.test(html) && html.includes("09:30-10:30 ✓"), "確認済み");
  assert.ok(/class="blk mtg\s+unconf[^"]*"[^>]*data-mtg="m2"/.test(html) && html.includes("13:00-14:00 未確認"), "未確認");
  assert.ok(!html.includes("data-confirmmtg"), "実績にするボタンは無い");
  d.events.find((e) => e.id === "m2").skip = true;
  const sk = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, showSkipped: true });
  assert.ok(sk.includes("blk mtg skip") && sk.includes("13:00-14:00 不参加"));
});

test("renderSchedule: 参加しない会議は、showSkipped が true のときだけ描く。凡例・ボタンの状態もそれに合わせる", () => {
  const d = load();
  d.events.find((e) => e.id === "m2").skip = true;
  for (const view of ["day", "week"]) {
    const hide = renderSchedule(d, TODAY, { view, date: TODAY, now: NOW });
    const show = renderSchedule(d, TODAY, { view, date: TODAY, now: NOW, showSkipped: true });
    assert.ok(!hide.includes("blk mtg skip") && !hide.includes('data-mtg="m2"'), `${view}: 既定は描かない`);
    assert.ok(hide.includes('data-mtg="m1"'), `${view}: 参加する会議は描く`);
    assert.ok(!hide.includes("skipsw") && /data-sskip aria-pressed="false"/.test(hide), `${view}: 凡例を出さず、ボタンは押していない`);
    assert.ok(show.includes("blk mtg skip") && show.includes("skipsw") && /data-sskip aria-pressed="true"/.test(show), `${view}: 出すとき`);
  }
  const sel = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW, selMtg: "m2" });
  assert.ok(sel.includes('data-mtg="m2"') && sel.includes("sel"), "選択中の参加しない会議は、隠していても出す（見えない会議を削除・編集しないため）");
  assert.ok(!renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW, selMtg: "m1" }).includes('data-mtg="m2"'), "ほかの会議を選んでいるときは、隠したまま");
});

test("会議ブロック: プロジェクト名と（規則|手動）を日表示に出す。未設定は『プロジェクト未設定』", () => {
  const d = noSessions();
  const html = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15 });
  assert.ok(html.includes("プロジェクト: 本社コアSW更改（規則）"));
  assert.ok(html.includes("プロジェクト未設定"));
  d.events.find((e) => e.id === "m2").projectId = "AB"; d.events.find((e) => e.id === "m2").projectBy = "manual";
  assert.ok(renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15 }).includes("プロジェクト: 拠点B 回線増設（手動）"));
});

test("会議フォーム: プロジェクト選択があり、mcp の会議でも disabled でない（件名は disabled のまま）。先頭の選択肢は規則で付く名前", () => {
  const d = noSessions();
  const mcp = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, selMtg: "m1" });
  const sel = /<select[^>]*data-mt="projectId"[^>]*>/.exec(mcp)?.[0];
  assert.ok(sel, "プロジェクト選択");
  assert.ok(!/disabled/.test(sel));
  assert.ok(/<input[^>]*data-mt="title"[^>]*disabled/.test(mcp));
  assert.ok(mcp.includes("プロジェクトは、規則で自動に付き"));
  const manual = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, selMtg: "m2" });
  assert.ok(manual.includes("自動（規則）→ 本社コアSW更改"));
  assert.ok(mcp.includes("自動（規則）→ 未設定"));
  d.events.find((e) => e.id === "m2").projectId = "AB"; d.events.find((e) => e.id === "m2").projectBy = "manual";
  const chosen = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, selMtg: "m2" });
  assert.ok(/<option value="AB" selected>/.test(chosen));
});

test("会議フォーム: 選んだ会議（mcp・manual）に、実績の開始・終了（初期値は実績、無ければ予定）と data-mtgact。参加しない・未来の会議には出さない", () => {
  const d = noSessions();
  const m1 = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, selMtg: "m1" });
  assert.match(m1, /<input[^>]*data-ma="start"[^>]*value="09:30"/);
  assert.match(m1, /<input[^>]*data-ma="end"[^>]*value="10:30"/);
  assert.ok(m1.includes('data-mtgact="m1"') && m1.includes(">実績を保存</button>"));
  assert.ok(!/<input[^>]*data-ma="start"[^>]*disabled/.test(m1), "予定表から取得した会議でも、実績は入れられる");
  d.events.find((e) => e.id === "m2").actual = { start: "13:15", end: "14:30" };
  const m2 = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, selMtg: "m2" });
  assert.match(m2, /<input[^>]*data-ma="start"[^>]*value="13:15"/);
  assert.match(m2, /<input[^>]*data-ma="end"[^>]*value="14:30"/);
  assert.ok(m2.includes('data-mtgact="m2"'));
  d.events.find((e) => e.id === "m2").skip = true;
  assert.ok(!renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, selMtg: "m2" }).includes("data-mtgact"), "参加しない会議");
  assert.ok(!renderSchedule(d, TODAY, { view: "day", date: "2026-10-21", now: NOW15, selMtg: "m3" }).includes("data-mtgact"), "未来の会議");
  assert.ok(!renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, mtgDraft: { date: TODAY, start: "09:00", end: "10:00", title: "", skip: false } }).includes("data-mtgact"), "追加中の会議");
});

test("サマリー: 未確認の会議も件数に入り（内訳つき）、一括で実績にするボタン（data-confirmall）は出さない。凡例に未確認の会議", () => {
  const d = noSessions();
  const html = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15 });
  assert.ok(html.includes("未確認 1件（作業枠 0・会議 1）") && !html.includes("data-confirmall"));
  assert.ok(html.includes("未確認の会議"));
  d.events.find((e) => e.id === "m2").confirmed = true;
  assert.ok(!renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15 }).includes("未確認 1件"));
});

// ---- 見送った Minor の修正: 日程変更の履歴に、取り込みの記録を出さない ----
test("日程変更の履歴: 取り込み（source があり、日数が 0）の記録は出さず、取り込みによる期限の変更（日数あり）は出す", () => {
  const d = load();
  d.changeLog.push(
    { at: "2026-10-20", taskIds: ["AA-0004"], reason: "WBS 取り込み: 追加 3 件", cause: null, deltaDays: 0, source: "wbs" },
    { at: "2026-10-20", taskIds: ["AA-0004"], reason: "受信箱: 着手", cause: null, deltaDays: 0, source: "inbox" },
    { at: "2026-10-20", taskIds: ["AA-0004"], reason: "受信箱: 納期延期", cause: "ベンダー", deltaDays: 5, source: "inbox" },
  );
  for (const html of [renderProjects(d, TODAY, { filter: "AA", view: "list" })]) {
    assert.ok(html.includes("ベンダーX の納期回答が遅れたため"));
    assert.ok(html.includes("受信箱: 納期延期"));
    assert.ok(!html.includes("WBS 取り込み: 追加 3 件") && !html.includes("受信箱: 着手"));
  }
});

// ---- 設定タブ ----
const setv = (d, o = {}) => renderSettings(d, TODAY, o);

test("設定: キーワード規則の一覧（キーワード・プロジェクトの選択・件数・削除）と追加の行、会議名の旨", () => {
  const d = load();
  const html = setv(d);
  assert.ok(html.includes("キーワード規則（会議名）"));
  assert.ok(html.includes('data-rkw="ベンダーX"') && html.includes('value="ベンダーX"'));
  assert.ok(html.includes('data-rpj="ベンダーX"') && /<option value="AA" selected>/.test(html));
  assert.ok(html.includes('data-rdel="ベンダーX"'));
  assert.ok(html.includes(`>${ruleMeetingCounts(d)[0]} 件</td>`), "いま付いている会議の件数");
  assert.ok(html.includes("data-rnew") && html.includes("data-rnewpj") && html.includes("data-radd"));
  assert.ok(html.includes("手動で付けた会議"));
});

test("設定: 規則が 0 件でも追加の行が出る。ruleError を出す", () => {
  const d = load(); d.settings.projectRules = [];
  const html = setv(d, { ruleError: "キーワードを入力してください" });
  assert.ok(html.includes("規則はありません") && html.includes("data-radd") && html.includes("キーワードを入力してください"));
});

test("設定: キーワードの特殊文字は escape される。プロジェクトが消えた規則は「不明」と出て落ちない", () => {
  const d = load(); d.settings.projectRules = [{ keyword: 'a"<b>&', projectId: "AA" }, { keyword: "古い", projectId: "ZZ" }];
  const html = setv(d);
  assert.ok(html.includes('data-rkw="a&quot;&lt;b&gt;&amp;"') && !html.includes('a"<b>&'));
  assert.ok(html.includes("不明") && html.includes('data-rdel="古い"'));
});

test("設定: WBS の取り込み記録（ファイル名・日付・件数）。ファイル名なしは「（不明）」、記録なしは「記録なし」", () => {
  const d = load();
  d.settings.wbsImports = { AA: { file: "plan.xlsx", at: "2026-10-20", added: 3, updated: 1 }, AB: { file: null, at: "2026-10-18", added: 0, updated: 2 } };
  const html = setv(d);
  assert.ok(html.includes("plan.xlsx") && html.includes("2026-10-20") && html.includes("（不明）") && html.includes("記録なし"));
  assert.equal(count(html, /記録なし/g), 1, "記録のあるプロジェクトには出ない（C だけ）");
  const none = setv(load());
  assert.equal(count(none, /記録なし/g), 3);
  const empty = { ...load(), projects: [], tasks: [], events: [] };
  assert.ok(setv(empty).includes("プロジェクトがありません"));
});

// ---- 受信箱の帯と引き出し ----
const NOW_MS = Date.parse("2026-10-21T10:01:00.000Z");
const T0 = "2026-10-21T10:00:00.000Z";
const reqOf = (id, status, extra = {}) => ({ id, at: T0, projectId: "AA", status, thread: [{ role: "user", at: T0, text: `依頼 ${id}` }], proposal: null, result: null, ...extra });
const PROPOSAL = {
  summary: "3 種類の変更案", reason: "ベンダーX の納期回答が遅れた", cause: "ベンダー",
  ops: [{ op: "moveDue", taskId: "AA-0003", deltaDays: 45 }],
  warnings: ["本社コアSW更改の期限（2027-03-31）を超えます（最後のタスクは 2027-04-10）"],
  sections: [
    { kind: "add", rows: [{ ref: "t1", title: "疎通確認テスト", projectId: "AA", group: "構築", subgroup: "検証環境", due: "2026-12-10", start: "2026-10-21", predecessors: ["AA-0004"] }] },
    { kind: "due", rows: [{ taskId: "AA-0003", title: "機器の発注（ベンダーX）", oldDue: "2026-10-16", newDue: "2026-11-30", reason: "指定（+45日）" }] },
  ],
};
const withInbox = (requests, watching = null) => { const d = load(); d.inbox = { watching, requests }; return d; };
const UI = (o = {}) => ({ open: false, canWrite: true, nowMs: NOW_MS, text: "", projectId: "", replies: {}, reasons: {}, causes: {}, ...o });
const ib = (d, o) => renderInboxBar(d, UI(o));

test("受信箱の帯（閉じている）: 見出し・開閉・状態（見ています／見ていません）・提案の印。入力欄は出さない", () => {
  const html = ib(withInbox([reqOf("R1", "proposed", { proposal: PROPOSAL })], { at: "2026-10-21T10:00:30.000Z" }));
  assert.ok(html.includes("data-ib-toggle") && html.includes("Claude Code に依頼する"));
  assert.ok(html.includes("見ています") && !html.includes("見ていません"));
  assert.ok(html.includes("提案が 1 件届いています"));
  assert.ok(!html.includes("data-ib-send") && !html.includes("data-ib-text"));
  const off = ib(withInbox([], { at: "2026-10-21T09:58:00.000Z" }));
  assert.ok(off.includes("見ていません") && !off.includes("提案が"));
  assert.ok(ib(withInbox([])).includes("見ていません"), "印なし");
});

test("受信箱の引き出し（開いている）: 対象の選択・書き方の例・入力（下書きを保つ）・送信。見ていないときは /project-lens:watch を案内", () => {
  const html = ib(withInbox([]), { open: true, text: "AA-0003 が 5 日遅れた", projectId: "AB" });
  assert.ok(html.includes("data-ib-send") && html.includes("data-ib-text") && html.includes(">AA-0003 が 5 日遅れた</textarea>"));
  assert.ok(/<select[^>]*data-ib-project/.test(html) && html.includes('<option value="">すべて</option>') && /<option value="AB" selected>/.test(html));
  for (const k of ["due", "add"]) assert.ok(html.includes(`data-ib-example="${k}"`), k);
  assert.ok(html.includes("/project-lens:watch"));
  assert.ok(!ib(withInbox([], { at: "2026-10-21T10:00:50.000Z" }), { open: true }).includes("/project-lens:watch"), "見ているときは案内しない");
  assert.ok(html.includes("まだ依頼はありません"));
});

test("受信箱の履歴: 新しい順に、状態（送信済み・処理中・聞き返し・提案・反映済み・却下・失敗）を出す", () => {
  const reqs = [reqOf("R1", "applied", { result: { at: T0, by: "html", summary: "期限 1 件を反映しました" } }), reqOf("R2", "rejected"), reqOf("R3", "pending"), reqOf("R4", "working"), reqOf("R5", "question", { thread: [{ role: "user", at: T0, text: "依頼 R5" }, { role: "claude", at: T0, text: "どのプロジェクトですか" }] }), reqOf("R6", "proposed", { proposal: PROPOSAL }), reqOf("R7", "failed", { thread: [{ role: "user", at: T0, text: "依頼 R7" }, { role: "claude", at: T0, text: "提案のあとにデータが変わりました" }] })];
  const html = ib(withInbox(reqs), { open: true });
  const order = [...html.matchAll(/data-ib-req="(R\d)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["R7", "R6", "R5", "R4", "R3", "R2", "R1"]);
  for (const w of ["反映済み", "却下", "送信済み", "処理中", "聞き返しがあります", "提案があります", "失敗", "期限 1 件を反映しました"]) assert.ok(html.includes(w), w);
});

test("提案のカード: 期限・登録の表、警告、理由・原因の入力、承認・修正の依頼・却下", () => {
  const html = ib(withInbox([reqOf("R1", "proposed", { proposal: PROPOSAL })]), { open: true, reasons: { R1: "手で直した理由" }, causes: { R1: "社内" } });
  assert.ok(html.includes("疎通確認テスト") && html.includes("構築") && html.includes("検証環境") && html.includes("2026-12-10") || html.includes("12/10"));
  assert.ok(html.includes("AA-0003") && html.includes("機器の発注（ベンダーX）") && html.includes("10/16") && html.includes("11/30") && html.includes("指定（+45日）"));
  assert.ok(html.includes("2027-04-10"), "警告");
  assert.ok(html.includes('data-ib-reason="R1"') && html.includes('value="手で直した理由"'));
  assert.ok(/<option selected>社内<\/option>/.test(html) || /<option[^>]*selected[^>]*>社内</.test(html));
  for (const a of ['data-ib-approve="R1"', 'data-ib-reply="R1"', 'data-ib-replysend="R1"', 'data-ib-reject="R1"']) assert.ok(html.includes(a), a);
  const dflt = ib(withInbox([reqOf("R1", "proposed", { proposal: PROPOSAL })]), { open: true });
  assert.ok(dflt.includes('value="ベンダーX の納期回答が遅れた"'), "理由の既定は提案の理由");
});

test("聞き返し・失敗: 質問と返信欄、再提案のボタン", () => {
  const q = reqOf("R1", "question", { thread: [{ role: "user", at: T0, text: "依頼" }, { role: "claude", at: T0, text: "どのプロジェクトですか" }] });
  const f = reqOf("R2", "failed", { thread: [{ role: "user", at: T0, text: "依頼" }, { role: "claude", at: T0, text: "提案のあとにデータが変わりました" }] });
  const html = ib(withInbox([q, f]), { open: true, replies: { R1: "AA です" } });
  assert.ok(html.includes("どのプロジェクトですか") && html.includes('data-ib-reply="R1"') && html.includes('value="AA です"') && html.includes('data-ib-replysend="R1"'));
  assert.ok(html.includes("提案のあとにデータが変わりました") && html.includes('data-ib-retry="R2"') && html.includes("もう一度提案してもらう"));
  assert.ok(!html.includes('data-ib-approve'));
});

test("受信箱: 直接保存に対応しない環境では、理由を出して、開閉・入力・送信を出さない", () => {
  const html = ib(withInbox([]), { open: true, canWrite: false });
  assert.ok(html.includes("ファイルへの直接保存が必要です"));
  assert.ok(!html.includes("data-ib-toggle") && !html.includes("data-ib-send") && !html.includes("data-ib-text"));
});

test("受信箱: 依頼・質問・提案の文字は escape される。inbox が無いデータでも落ちない", () => {
  const evil = '<img src=x onerror=1>"&';
  const p = { ...PROPOSAL, summary: evil, warnings: [evil], sections: [{ kind: "add", rows: [{ ref: "t", title: evil, projectId: "AA", group: evil, subgroup: null, due: "2026-12-10", start: null, predecessors: [] }] }] };
  const html = ib(withInbox([reqOf("R1", "proposed", { proposal: p, thread: [{ role: "user", at: T0, text: evil }, { role: "claude", at: T0, text: evil }] })]), { open: true, text: evil });
  assert.ok(!html.includes("<img src=x") && html.includes("&lt;img src=x"));
  assert.doesNotThrow(() => ib(load(), { open: true }));
  assert.doesNotThrow(() => ib(load()));
});

test("受信箱の提案カード: 登録の行に 1 始まりの行番号（data-row）が出る", () => {
  const rows = [
    { ref: "t1", title: "機器の発注", projectId: "AA", group: null, subgroup: null, due: "2026-11-03", businessDays: 14, start: "2026-10-21", predecessors: [] },
    { ref: "t2", title: "納品確認", projectId: "AA", group: null, subgroup: null, due: "2026-11-08", businessDays: 5, start: null, predecessors: ["t1"] },
  ];
  const html = ib(withInbox([reqOf("R1", "proposed", { proposal: { ...PROPOSAL, sections: [{ kind: "add", rows }] } })]), { open: true });
  assert.ok(html.includes('data-row="1"') && html.includes('data-row="2"') && !html.includes('data-row="3"'));
});

const cardOf = (sections) => ib(withInbox([reqOf("R1", "proposed", { proposal: { ...PROPOSAL, sections } })]), { open: true });

test("受信箱の履歴: 処理待ち・処理中でも、2 件目以降のやりとり（修正の依頼）を出す。依頼文は 1 回だけ", () => {
  for (const status of ["pending", "working"]) {
    const thread = [{ role: "user", at: T0, text: "最初の依頼文" }, { role: "claude", at: T0, text: "提案の要約です" }, { role: "user", at: T0, text: "3 行目を 10 日にして" }];
    const html = ib(withInbox([reqOf("R1", status, { thread })]), { open: true });
    assert.ok(html.includes("3 行目を 10 日にして") && html.includes("提案の要約です"), status);
    assert.equal(count(html, /最初の依頼文/g), 1, status);
  }
});

// ---- 今日のタスク（状態・「実績にする」） ----
const withToday = () => {
  const d = load();
  const T = (id) => d.tasks.find((t) => t.id === id);
  T("AA-0007").sessions.push({ id: "S10", date: TODAY, start: "14:00", end: "15:00", kind: "planned" }); // To Do
  T("AA-0005").sessions.push({ id: "S9", date: TODAY, start: "11:00", end: "12:00", kind: "planned" }); // In Progress（遅い開始の AA-0007 より前）
  const done = d.tasks.find((t) => t.status === "Done");
  done.sessions = [...(done.sessions ?? []), { id: "S11", date: TODAY, start: "09:30", end: "10:00", kind: "actual" }];
  return { d, done };
};
const items = (html) => [...html.matchAll(/<li[^>]*data-today="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({ id: m[1], html: m[2] }));

test("todayTaskIds・renderTodayTasks: 今日に枠があるタスクだけを、最初の枠の開始順に出す。Done は薄く、ボタン無しで末尾。枠が無ければ空", () => {
  const { d, done } = withToday();
  assert.deepEqual(todayTaskIds(d, TODAY).sort(), ["AA-0005", "AA-0007", done.id].sort());
  const html = renderTodayTasks(d, TODAY);
  assert.deepEqual(items(html).map((x) => x.id), ["AA-0005", "AA-0007", done.id], "Done は末尾（開始は一番早くても）");
  const [a5, a7, dn] = items(html);
  assert.ok(a5.html.includes("In Progress") && a5.html.includes("11:00–12:00"), "状態と今日の枠の時間");
  assert.ok(a7.html.includes("14:00–15:00"), "To Do も");
  assert.ok(!html.includes("data-setstatus") && !html.includes("着手</button>") && !html.includes("完了</button>") && !html.includes("data-rec-"), "着手・完了・開始・終了のボタンは無い");
  assert.ok(dn.html.includes("09:30–10:00") && html.includes('class="closed"'), "Done は薄い");
  assert.equal(renderTodayTasks(load(), TODAY), "", "今日の枠が無ければ出さない");
  assert.deepEqual(todayTaskIds(load(), TODAY), []);
});

test("renderTodayTasks: スケジュール画面では、終わっていない行がドラッグできる（同じタスクをもう 1 つ置ける）。Done・ガント・リストでは付けない", () => {
  const { d, done } = withToday();
  const li = (html, id) => html.match(new RegExp(`<li[^>]*data-today="${id}"[^>]*>`))[0];
  const s = sched(d, { now: NOW });
  for (const id of ["AA-0005", "AA-0007"]) assert.ok(li(s, id).includes('draggable="true"') && li(s, id).includes(`data-dragtask="${id}"`), id);
  assert.ok(!li(s, done.id).includes("draggable") && !li(s, done.id).includes("data-dragtask"), "Done は付けない");
  assert.ok(renderTodayTasks(d, TODAY, { sched: true, now: NOW }).includes('data-dragtask="AA-0005"'));
  assert.ok(!renderTodayTasks(d, TODAY, { now: NOW }).includes("data-dragtask"), "sched 無しは付けない");
  const g = renderProjects(d, TODAY, { filter: "all", view: "list", now: NOW });
  assert.ok(!g.includes("data-today") || !/<li[^>]*data-today[^>]*data-dragtask/.test(g), "リスト・ガントの右の列は付けない");
  assert.ok(s.includes("今日のタスクの行からも"), "注記");
});

test("renderTodayTasks: 「実績にする」のボタン（data-session-actual）は付けない（実績はスケジュールで入れる）。スケジュール・プロジェクトの右の列も同じ", () => {
  const { d } = withToday();
  d.tasks.find((t) => t.id === "AA-0007").sessions.push({ id: "S13", date: TODAY, start: "08:00", end: "09:00", kind: "planned" }, { id: "S14", date: TODAY, start: "16:00", end: "17:00", kind: "actual" });
  for (const html of [renderTodayTasks(d, TODAY, { now: NOW }), sched(d, { now: NOW }), renderProjects(d, TODAY, { filter: "all", view: "list", now: NOW })]) {
    const side = html.slice(html.indexOf('class="panel todaytasks"'));
    assert.ok(side.includes("08:00–09:00") && !side.includes("data-session-actual") && !side.includes("実績にする"), side);
  }
});

test("renderTodayTasks: 過ぎた予定の枠は、重なる実績があれば「予定」の札（未確認にしない）", () => {
  const { d } = withToday();
  d.tasks.find((t) => t.id === "AA-0007").sessions.push({ id: "S13", date: TODAY, start: "08:00", end: "09:00", kind: "planned" });
  d.tasks.find((t) => t.id === "AA-0004").sessions = [{ id: "S15", date: TODAY, start: "08:00", end: "09:00", kind: "actual" }];
  const row = items(renderTodayTasks(d, TODAY, { now: NOW })).find((x) => x.id === "AA-0007").html;
  assert.ok(row.includes('<span class="ktag plan">予定</span>08:00–09:00'), row);
});

test("renderTodayTasks: 枠の時間の前に、予定・実績・未確認（過ぎた予定）の札を付ける（文字で出す。色はカレンダーの凡例と同じ class）", () => {
  const { d, done } = withToday();
  d.tasks.find((t) => t.id === "AA-0007").sessions.push({ id: "S13", date: TODAY, start: "08:00", end: "09:00", kind: "planned" }, { id: "S14", date: TODAY, start: "15:30", end: "16:00", kind: "actual" });
  const html = renderTodayTasks(d, TODAY, { now: NOW });
  const row = items(html).find((x) => x.id === "AA-0007").html;
  assert.ok(row.includes('<span class="ktag unconf">未確認</span>08:00–09:00'), row);
  assert.ok(row.includes('<span class="ktag plan">予定</span>14:00–15:00'), row);
  assert.ok(row.includes('<span class="ktag act">実績</span>15:30–16:00'), row);
  assert.ok(items(html).find((x) => x.id === done.id).html.includes('<span class="ktag act">実績</span>09:30–10:00'));
});

test("renderTodayTasks: 複数の枠は時間を並べる。pendingDone の行にだけ確認（data-doneok / data-doneno）を出す", () => {
  const { d } = withToday();
  d.tasks.find((t) => t.id === "AA-0005").sessions.push({ id: "S12", date: TODAY, start: "16:00", end: "17:00", kind: "planned" });
  const html = renderTodayTasks(d, TODAY, { pendingDone: { id: "AA-0005", status: "Done", n: 1, future: ["S3"] } });
  assert.ok(items(html)[0].html.includes("11:00–12:00") && items(html)[0].html.includes("16:00–17:00"));
  assert.ok(items(html)[0].html.includes('data-doneok="AA-0005"') && items(html)[0].html.includes("未来の予定の枠 1 件"));
  assert.equal(count(html, /data-doneok=/g), 1);
});

test("renderPrio: 今日のタスクに入ったタスクは出さない（プロジェクト画面は残りから 4 件）。行に状態の pill があり、ボタンは無い", async () => {
  const { rankTasks } = await import("../plugins/project-lens/src/core/schedule.js");
  const { d } = withToday();
  const base = rankTasks(d, TODAY).map((r) => r.taskId);
  const inToday = new Set(todayTaskIds(d, TODAY));
  assert.ok(base.some((id) => inToday.has(id)), "検査: 優先に並ぶタスクが今日のタスクに入っている");
  const full = renderPrio(d, TODAY, { sched: true });
  const ids = [...full.matchAll(/data-dragtask="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, base.filter((id) => !inToday.has(id)));
  assert.ok(!full.includes("data-setstatus") && full.includes('class="pill'), "ボタン無し・状態 pill");
  assert.equal(count(renderPrio(d, TODAY, { sched: false }), /<li/g), Math.min(4, ids.length), "上位 4 件も除いたうえで");
  const all = load();
  for (const t of all.tasks) t.sessions = [{ id: "S" + t.id, date: TODAY, start: "09:00", end: "09:15", kind: "planned" }];
  assert.ok(renderPrio(all, TODAY, { sched: true }).includes("優先するタスクはありません") && !renderPrio(all, TODAY, { sched: true }).includes("<ol"));
});

test("今日のタスクは、スケジュール・プロジェクトの両方の右パネルに出る（showPrio:false なら出ない）。pendingDone の確認はパネル内で、カレンダー側には出ない", () => {
  const { d } = withToday();
  const pd = { id: "AA-0005", status: "Done", n: 1, future: ["S3"] };
  for (const html of [sched(d, { pendingDone: pd }), renderProjects(d, TODAY, { filter: "all", view: "list", pendingDone: pd })]) {
    assert.ok(html.includes('id="h-td"') && html.includes('data-today="AA-0005"'));
    assert.ok(html.indexOf('id="h-td"') < html.indexOf('id="h-rk"'), "優先の上（取っ手の名前にも文字が入るので、見出しの id で見る）");
  }
  assert.equal(count(sched(d, { pendingDone: pd }), /data-doneok=/g), 1);
  assert.ok(!sched(d, { showPrio: false }).includes('id="h-td"'));
  assert.ok(!renderProjects(d, TODAY, { filter: "all", view: "list", showPrio: false }).includes('id="h-td"'));
  // 今日のタスクに居ないタスク（リストの select から押した）の確認は、リストの行に出る
  const other = renderProjects(d, TODAY, { filter: "all", view: "list", pendingDone: { id: "AA-0001", status: "Done", n: 1, future: ["S3"] } });
  assert.equal(count(other, /data-doneok="AA-0001"/g), 1);
});

test("renderSchedule: 作業枠のブロックに着手・完了ボタンは無く、日表示では状態の文字が出る。カレンダー上部の確認（doneAsk）は無い", () => {
  const { d } = withToday();
  const day = sched(d, { showPrio: false });
  const blocks = [...day.matchAll(/<div class="blk task[\s\S]*?<\/div>/g)].map((m) => m[0]);
  assert.ok(blocks.length >= 2 && blocks.every((b) => !b.includes("data-setstatus")));
  assert.ok(blocks.some((b) => b.includes("着手中")) && blocks.some((b) => b.includes("未着手")) && blocks.some((b) => b.includes("完了")), "各ブロックに状態の文字");
  assert.ok(!renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW, showPrio: false }).includes("data-setstatus"));
  assert.ok(!sched(d, { showPrio: false, pendingDone: { id: "AA-0005", status: "Done", n: 1, future: ["S3"] } }).includes("data-doneok"), "パネルを出さないときはカレンダー側にも出ない");
});

// ---- 設定タブ: 基本の設定と規則の並べ替え ----
const setTag = (html, name) => (html.match(new RegExp(`<input[^>]*data-set="${name}"[^>]*>`)) ?? [""])[0];

test("設定タブ: 基本の設定の入力。settings が無ければ既定値、あればその値。会議の件名の既定は、画面では変えない", () => {
  const none = load();
  delete none.settings;
  const html = setv(none);
  assert.ok(!html.includes("workday-") && !html.includes("勤務時間"), "勤務時間の行は無い");
  assert.ok(setTag(html, "waitingLongDays").includes('value="7"'));
  assert.ok(setTag(html, "label-group").includes('value="大項目"') && setTag(html, "label-subgroup").includes('value="中項目"'));
  const set = load();
  set.settings = { waitingLongDays: 3, labels: { group: "フェーズ" } };
  const h2 = setv(set);
  assert.ok(setTag(h2, "waitingLongDays").includes('value="3"') && setTag(h2, "label-group").includes('value="フェーズ"') && setTag(h2, "label-subgroup").includes('value="中項目"'));
});

test("設定タブ: 古いファイルに残った workday は無視する（行も注意も出さない）。不正な待ち長期化は既定値と注意", () => {
  const d = load();
  d.settings = { ...d.settings, workday: { start: "9:00", end: "18:00" }, waitingLongDays: "7" };
  const html = setv(d);
  assert.ok(!html.includes("workday"));
  assert.ok(setTag(html, "waitingLongDays").includes('value="7"'));
  assert.ok(html.includes("settings.waitingLongDays:"));
});

test("設定タブ: 規則の↑↓。先頭の↑と末尾の↓は無効", () => {
  const d = load();
  d.settings = { ...d.settings, projectRules: [{ keyword: "r1", projectId: "AA" }, { keyword: "r2", projectId: "AB" }, { keyword: "r3", projectId: "AA" }] };
  const html = setv(d);
  const btn = (kw, delta) => html.match(new RegExp(`<button[^>]*data-rmove="${kw}\\|${delta}"[^>]*>`))?.[0] ?? "";
  assert.ok(btn("r1", -1).includes("disabled") && btn("r3", 1).includes("disabled"));
  for (const [kw, delta] of [["r1", 1], ["r2", -1], ["r2", 1], ["r3", -1]]) assert.ok(btn(kw, delta) && !btn(kw, delta).includes("disabled"), `${kw}|${delta}`);
});

const NHOL = { fetchedAt: "2026-10-25", source: "u", dates: [{ date: "2026-01-01", name: "元日" }, { date: "2026-11-03", name: "文化の日" }, { date: "2026-11-23", name: "勤労感謝の日" }] };
const withSet = (o) => { const d = load(); d.settings = { ...d.settings, ...o }; return d; };

test("設定: 「日本の祝日」の節。未取得は案内、取得済みは取得日・件数・範囲と、今日以降の祝日だけ（読み取り専用）", () => {
  const none = setv(load());
  assert.ok(none.includes("日本の祝日") && none.includes("まだ取得していません") && none.includes("自動で更新") && !none.includes("/project-lens:holidays"));
  const html = setv(withSet({ nationalHolidays: NHOL }));
  assert.ok(html.includes("2026-10-25") && html.includes("3 件") && html.includes("2026-01-01") && html.includes("2026-11-23"), "取得日・件数・範囲");
  assert.ok(html.includes("文化の日") && html.includes("勤労感謝の日"));
  assert.ok(!html.includes("元日"), "今日（10/20）より前は一覧に出さない");
});

test("設定: 「休み（手動）」の節。開始日・終了日・区分・メモの入力、登録済みを昇順で区分とメモつきに出し、区分の変更と削除ができる", () => {
  const html = setv(withSet({ holidays: [{ date: "2026-11-23", kind: "祝日" }, { date: "2026-10-26", kind: "有給", note: "通院" }] }));
  assert.ok(html.includes("休み（手動）"));
  for (const a of ["data-hnew", "data-hto", "data-hkind", "data-hnote", "data-hadd"]) assert.ok(html.includes(a), a);
  assert.deepEqual([...html.matchAll(/<option[^>]*>(祝日|有給|その他)<[/]option>/g)].slice(0, 3).map((m) => m[1]), ["祝日", "有給", "その他"], "追加の区分の選択肢");
  const i = html.indexOf('data-hdel="2026-10-26"'), j = html.indexOf('data-hdel="2026-11-23"');
  assert.ok(i > 0 && j > i, "昇順");
  assert.match(html, /<select[^>]*data-hrowkind="2026-10-26"[^>]*>[^]*?<option selected>有給<[/]option>/);
  assert.ok(html.includes("通院"));
  assert.ok(setv(load()).includes("休みは登録されていません"));
});

test("設定: 「営業日として扱う日」の節。入力と一覧（昇順・削除）と説明", () => {
  const html = setv(withSet({ workdays: [{ date: "2026-11-28", note: "休日出勤" }, { date: "2026-10-31" }] }));
  assert.ok(html.includes("営業日として扱う日") && html.includes("営業日として数えます"));
  for (const a of ["data-wnew", "data-wnote", "data-wadd"]) assert.ok(html.includes(a), a);
  assert.ok(html.indexOf('data-wdel="2026-10-31"') > 0 && html.indexOf('data-wdel="2026-10-31"') < html.indexOf('data-wdel="2026-11-28"'));
  assert.ok(html.includes("休日出勤"));
});

test("設定: 休み・営業日・日本の祝日の値が壊れていても描画でき、注意が出る（前版の文字列の配列を含む）", () => {
  for (const o of [{ holidays: "x" }, { holidays: ["2026-10-26"] }, { holidays: [null, { date: 5 }] }, { workdays: [null] }, { workdays: "x" }, { nationalHolidays: 5 }, { nationalHolidays: { dates: "x" } }, { nationalHolidays: { fetchedAt: "2026-10-25", dates: [null] } }]) {
    const d = withSet(o);
    let html;
    assert.doesNotThrow(() => { html = setv(d); }, JSON.stringify(o));
    assert.ok(html.includes(`settings.${Object.keys(o)[0]}:`), JSON.stringify(o));
  }
});

test("renderSchedule(week): 枠・会議のブロックの時刻は開始–終了（10:00-11:00 形式）", () => {
  const { d } = withToday();
  const html = renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW, showPrio: false });
  assert.ok(html.includes('<span class="tm">11:00-12:00</span>') || html.includes('<span class="tm">11:00-12:00 '), "枠");
  assert.ok(/<span class="tm">\d\d:\d\d-\d\d:\d\d/.test(html.slice(html.indexOf("data-mtg="))), "会議");
});

test("受信箱の提案カード: 登録の表に「営業日」の列（無い行は —）。「修正を依頼する」は暖色のクラス（承認の primary とは別）", () => {
  const rows = [
    { ref: "t1", title: "機器の発注", projectId: "AA", group: null, subgroup: null, due: "2026-11-03", businessDays: 14, start: null, predecessors: [] },
    { ref: "t2", title: "納品確認", projectId: "AA", group: null, subgroup: null, due: "2026-11-08", businessDays: null, start: null, predecessors: ["t1"] },
  ];
  const html = ib(withInbox([reqOf("R1", "proposed", { proposal: { ...PROPOSAL, sections: [{ kind: "add", rows }] } })]), { open: true });
  assert.ok(html.includes("<th>営業日</th>"));
  const tr = (n) => html.match(new RegExp(`<tr data-row="${n}">[\\s\\S]*?</tr>`))[0];
  assert.ok(tr(1).includes('<td class="mono">14</td>') && tr(2).includes('<td class="mono">—</td>'));
  assert.match(html, /<button class="btn warm" data-ib-replysend=/);
  assert.match(html, /<button class="btn primary" data-ib-approve=/);
});

test("renderTodayTasks: 枠の時刻はエスケープする", () => {
  const { d } = withToday();
  d.tasks.find((t) => t.id === "AA-0007").sessions[0].start = "<b>x</b>";
  assert.ok(!renderTodayTasks(d, TODAY).includes("<b>x</b>"));
});

test("今日のタスクのパネルは、ヘッダーの日付ラベル用のクラス today を使わない（文字色・大きさが変わるため）", () => {
  const { d } = withToday();
  assert.doesNotMatch(renderTodayTasks(d, TODAY), /class="panel today"/);
});

test("renderSchedule: 休みの日（土日・手動の休み・日本の祝日）は weekend 扱いで、日付の見出しに「—」。営業日の指定の日は休みでない。空き時間の表示はない", () => {
  const d = load();
  d.settings = { ...d.settings, holidays: [{ date: "2026-10-22", kind: "有給" }], workdays: [{ date: "2026-10-24" }] };
  const week = renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW, showPrio: false });
  const col = (date) => week.match(new RegExp(`<div class="col dz[^"]*" data-date="${date}"`))[0];
  const head = (date) => week.match(new RegExp(`data-day="${date}"[^>]*>[^<]*<small class="mono">([^<]*)</small>`))[1];
  assert.match(col("2026-10-22"), /weekend/); // 手動の休み（木）
  assert.match(col("2026-10-25"), /weekend/); // 日曜
  assert.doesNotMatch(col("2026-10-24"), /weekend/, "営業日の指定の土曜");
  assert.equal(head("2026-10-22"), "—");
  assert.equal(head("2026-10-25"), "—");
  assert.ok(!/data-day="2026-10-24"[^>]*>[^<]*<small/.test(week) && !/data-day="2026-10-21"[^>]*>[^<]*<small/.test(week), "休みでない日は、日付だけ");
  assert.ok(!week.includes("空き"));
  const day = (date) => renderSchedule(d, TODAY, { view: "day", date, now: NOW, showPrio: false });
  assert.ok(day("2026-10-22").includes("この日は休みです"), "休みの日の日表示は、休みの案内を出す");
  assert.ok(!day("2026-10-24").includes("この日は休みです"), "営業日の指定の土曜は休みでない");
});

test("renderSchedule: 週表示・日表示とも、空き時間のボタン（data-free・data-freedate）を出さない（突発タスクはヘッダーのボタンから登録する）", () => {
  const d = load();
  for (const view of ["week", "day"]) {
    const html = renderSchedule(d, TODAY, { view, date: TODAY, now: NOW, showPrio: false });
    assert.ok(!html.includes("data-free") && !html.includes('class="free"'), view);
    assert.ok(!html.includes("空き時間を押す"), `${view}: 空き時間を押す案内も出さない`);
  }
});

test("受信箱の提案カード: 営業日の列の値もエスケープする（手で書き換えた data.json でも HTML を差し込めない）", () => {
  const rows = [{ ref: "t1", title: "x", projectId: "AA", group: null, subgroup: null, due: "2026-11-03", businessDays: "<img src=x onerror=alert(1)>", start: null, predecessors: [] }];
  const html = ib(withInbox([reqOf("R1", "proposed", { proposal: { ...PROPOSAL, sections: [{ kind: "add", rows }] } })]), { open: true });
  assert.ok(!html.includes("<img src=x"));
});

test("settingsInputValues: 基本の設定の入力に出す値（形が違う・無い項目は既定値）", async () => {
  const { settingsInputValues } = await import("../plugins/project-lens/src/ui/views/settings.js");
  assert.deepEqual(settingsInputValues({}), { waitingLongDays: 7, labelGroup: "大項目", labelSubgroup: "中項目" });
  const s = { settings: { workday: { start: "08:30", end: "17:30" }, waitingLongDays: 3, labels: { group: " フェーズ ", subgroup: "" } } };
  assert.deepEqual(settingsInputValues(s), { waitingLongDays: 3, labelGroup: "フェーズ", labelSubgroup: "中項目" }, "残った workday は使わない");
  for (const bad of [{ waitingLongDays: 0 }, { waitingLongDays: "3" }]) assert.equal(settingsInputValues({ settings: bad }).waitingLongDays, 7, JSON.stringify(bad));
});

test("renderSchedule(day): 休みの日（土日・手動の休み・日本の祝日）の日表示には、置けない旨と指定の方法の注意を出す。営業日の指定の日・平日には出さない", () => {
  const d = load();
  d.settings = { ...d.settings, holidays: [{ date: "2026-10-22", kind: "有給" }], workdays: [{ date: "2026-10-24" }] };
  const day = (date) => renderSchedule(d, TODAY, { view: "day", date, now: NOW, showPrio: false });
  for (const off of ["2026-10-22", "2026-10-25"]) {
    const h = day(off);
    assert.ok(h.includes("この日は休みです") && h.includes("営業日として扱う日"), off);
  }
  for (const ok of ["2026-10-21", "2026-10-24"]) assert.ok(!day(ok).includes("この日は休みです"), ok);
});

test("renderSchedule(day): 日本の祝日の日表示にも注意が出る。週表示には出ない", () => {
  const d = load();
  d.settings = { ...d.settings, nationalHolidays: { fetchedAt: "2026-10-20", source: "u", dates: [{ date: "2026-11-03", name: "文化の日" }] } };
  assert.ok(renderSchedule(d, TODAY, { view: "day", date: "2026-11-03", now: NOW, showPrio: false }).includes("この日は休みです"));
  assert.ok(!renderSchedule(d, TODAY, { view: "week", date: "2026-11-03", now: NOW, showPrio: false }).includes("この日は休みです"));
});

// ---- 営業日の数え方（settings.countWeekendsAndHolidays） ----
test("設定: 「営業日の数え方」は基本の設定の表の先頭の行にあり、土日祝を営業日に数えるスイッチはオフが既定", () => {
  const html = setv(load());
  assert.ok(!html.includes('id="h-count"'), "独立した節は無い");
  assert.ok(html.includes("営業日の数え方"));
  assert.match(html, /<input type="checkbox" data-set="countWeekendsAndHolidays"[^>]*>/);
  assert.doesNotMatch(html.match(/<input type="checkbox" data-set="countWeekendsAndHolidays"[^>]*>/)[0], /checked/);
  assert.ok(html.includes("土日祝を営業日に数える"));
  const basic = html.slice(html.indexOf('id="h-basic"'), html.indexOf('id="h-days"'));
  assert.ok(basic.includes("営業日の数え方") && basic.indexOf("営業日の数え方") < basic.indexOf("待ち長期化の日数"), "基本の設定の中で、先頭の行");
  assert.ok(!html.includes("この一覧は日数計算に使いません"));
  assert.ok(!html.includes("期間内の土日と日本の祝日も除きません"));
});

test("設定: スイッチがオンのとき checked になり、「日本の祝日」と「休み（手動）」の節に説明が出る", () => {
  const d = load();
  d.settings = { ...d.settings, countWeekendsAndHolidays: true };
  const html = setv(d);
  assert.match(html.match(/<input type="checkbox" data-set="countWeekendsAndHolidays"[^>]*>/)[0], /checked/);
  const nat = html.slice(html.indexOf('id="h-nat"'), html.indexOf('id="h-hol"'));
  assert.ok(nat.includes("いまは土日祝を営業日に数える設定なので、この一覧は日数計算に使いません"));
  const hol = html.slice(html.indexOf('id="h-hol"'), html.indexOf('id="h-wrk"'));
  assert.ok(hol.includes("土日祝を営業日に数えるときは、期間内の土日と日本の祝日も除きません"));
});

test("設定: スイッチの値が真偽値でない（\"true\"）ときはオフとして描き、注意を節に出す", () => {
  const d = load();
  d.settings = { ...d.settings, countWeekendsAndHolidays: "true" };
  const html = setv(d);
  assert.doesNotMatch(html.match(/<input type="checkbox" data-set="countWeekendsAndHolidays"[^>]*>/)[0], /checked/);
  const sec = html.slice(html.indexOf('id="h-basic"'), html.indexOf('id="h-days"'));
  assert.ok(sec.includes("settings.countWeekendsAndHolidays"), "注意が基本の設定の営業日の数え方の行に出る");
  assert.ok(!html.includes("この一覧は日数計算に使いません"));
});

test("renderSchedule: 土日祝を営業日に数える設定がオンなら、土日・祝日は休みの日にならない。手動の休みは休みの日のまま", () => {
  const d = load();
  d.settings = { ...d.settings, countWeekendsAndHolidays: true, holidays: [{ date: "2026-10-22", kind: "有給" }] };
  const week = renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW, showPrio: false });
  const col = (date) => week.match(new RegExp(`<div class="col dz[^"]*" data-date="${date}"`))[0];
  assert.match(col("2026-10-22"), /weekend/, "手動の休み");
  assert.doesNotMatch(col("2026-10-24"), /weekend/, "土曜");
  assert.doesNotMatch(col("2026-10-25"), /weekend/, "日曜");
  const day = (date) => renderSchedule(d, TODAY, { view: "day", date, now: NOW, showPrio: false });
  assert.ok(!day("2026-10-25").includes("この日は休みです"), "日曜は休みでない");
  assert.ok(day("2026-10-22").includes("この日は休みです"), "手動の休みの日は休み");
});

test("設定: 「営業日の数え方」の説明は、営業日後の期限とスケジュールの作業枠について書き、日程の移動（暦日で計算）には触れない", () => {
  const html = setv(load());
  const sec = html.slice(html.indexOf("営業日の数え方"), html.indexOf("待ち長期化の日数"));
  assert.ok(sec.includes("営業日後の期限") && sec.includes("スケジュールの作業枠"));
  assert.ok(!sec.includes("日程の移動"));
});

test("renderSchedule(day): 土日祝を営業日に数える設定がオンなら、休みの日の注意は「休み」だけを挙げる（土日・日本の祝日は休みにならない）。オフは今までの文", () => {
  const d = load();
  d.settings = { ...d.settings, holidays: [{ date: "2026-10-22", kind: "有給" }] };
  const day = (data, date) => renderSchedule(data, TODAY, { view: "day", date, now: NOW, showPrio: false });
  assert.ok(day(d, "2026-10-22").includes("この日は休みです（土日・日本の祝日・休み）"), "オフ");
  const on = { ...d, settings: { ...d.settings, countWeekendsAndHolidays: true } };
  const h = day(on, "2026-10-22");
  assert.ok(h.includes("この日は休みです（休み）") && h.includes("営業日として扱う日"));
  assert.ok(!h.includes("土日・日本の祝日"));
  assert.ok(!day(on, "2026-10-25").includes("この日は休みです"), "日曜は休みでない");
});

// ---- ガントのバーは、開始日のマスから期限日のマスの右端まで（期限の日を含む） ----
test("renderGantt: タスクのバー・プロジェクト全体のバー・実績のバーの右端は、期限（終了）日のマスの右端。期限の表示はその右に付く", () => {
  const d = load();
  const html = gantt(d, ["AA"]);
  const s0 = /data-s0="([^"]+)"/.exec(html)[1], span = +/data-span="(\d+)"/.exec(html)[1];
  const edge = (date) => ((diffDays(date, s0) + 1) / span) * 100; // その日のマスの右端（%）
  const right = (m) => +m[1] + +m[2];
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} と ${b}`);
  const A5 = d.tasks.find((t) => t.id === "AA-0005"), P = d.projects.find((p) => p.id === "AA");
  const bar = /<i class="gbar[^"]*"[^>]*data-gt="AA-0005"[^>]*style="left:([\d.]+)%;width:([\d.]+)%/.exec(html);
  near(right(bar), edge(A5.due), "タスクのバー");
  const sum = /<i class="gbar gsum"[^>]*style="left:([\d.]+)%;width:([\d.]+)%/.exec(html);
  near(right(sum), edge(P.due), "プロジェクト全体のバー");
  const act = /<i class="gact" style="left:([\d.]+)%;width:([\d.]+)%;[^>]*title="実績 10\/14〜10\/20"/.exec(html);
  near(right(act), edge("2026-10-20"), "実績のバー");
  const row = html.split('<div class="g-row">').find((r) => r.includes('data-gt="AA-0005"'));
  near(+/class="g-due mono" style="left:([\d.]+)%/.exec(row)[1], edge(A5.due), "タスクの期限の表示");
  const sumRow = html.split('<div class="g-row g-sumrow">')[1];
  near(+/class="g-due mono" style="left:([\d.]+)%/.exec(sumRow)[1], edge(P.due), "プロジェクト全体の期限の表示");
});

test("renderGantt: 重要で未完了のタスクのラベルにだけ印（imp-high）が付き、重要でない・完了したタスクには付かない", () => {
  const d = load();
  const set = (id, imp, status) => { const t = d.tasks.find((x) => x.id === id); if (imp) t.important = true; else delete t.important; t.status = status; };
  set("AA-0001", true, "Done"); set("AA-0002", true, "Cancelled"); set("AA-0003", true, "Waiting"); set("AA-0004", false, "To Do"); set("AA-0005", true, "In Progress"); set("AA-0006", false, "To Do");
  const html = gantt(d, ["AA"]);
  const label = (id) => /<div class="g-label([^"]*)"/.exec(html.split('<div class="g-row">').find((r) => r.includes(`data-gt="${id}"`)))[1];
  assert.deepEqual(["AA-0001", "AA-0002", "AA-0003", "AA-0004", "AA-0005", "AA-0006"].map(label), ["", "", " imp-high", "", " imp-high", ""]);
});

test("renderGantt: 開始も前のタスクもない（期限だけの）タスクは点で、期限の日のマスの中央に置く。期限の表示は翌日の左端", () => {
  const d = load();
  const a1 = d.tasks.find((t) => t.id === "AA-0001");
  a1.start = null; a1.predecessors = []; // 期限だけ → 点
  const html = gantt(d, ["AA"]);
  const s0 = /data-s0="([^"]+)"/.exec(html)[1], span = +/data-span="(\d+)"/.exec(html)[1];
  const row = html.split('<div class="g-row">').find((r) => r.includes('data-gt="AA-0001"'));
  const m = /<i class="dot mk[^"]*"[^>]*data-gt="AA-0001"[^>]*style="left:calc\(([\d.]+)% \+ ([\d.]+)%\)/.exec(row);
  assert.ok(m, "点で描かれ、左は『期限の日の左端 + 半マス』");
  assert.ok(Math.abs(+m[1] + +m[2] - ((diffDays(a1.due, s0) + 0.5) / span) * 100) < 0.01, `マスの中央: ${m[1]} + ${m[2]}`);
  const left = +/class="g-due mono" style="left:([\d.]+)%/.exec(row)[1];
  assert.ok(Math.abs(left - ((diffDays(a1.due, s0) + 1) / span) * 100) < 0.01, `期限の表示は翌日の左端: ${left}`);
});

test("renderGantt: 開始が期限と同じ日のタスクと、前のタスクの期限が期限と同じ日のタスクは、1 日分の棒（両端のつまみつき）で、点にしない", () => {
  const d = load();
  const a1 = d.tasks.find((t) => t.id === "AA-0001");
  a1.start = a1.due; a1.predecessors = [];
  const a2 = d.tasks.find((t) => t.id === "AA-0002");
  a2.start = null; a2.predecessors = ["AA-0001"]; a2.due = a1.due;
  const html = gantt(d, ["AA"]);
  const span = +/data-span="(\d+)"/.exec(html)[1];
  for (const id of ["AA-0001", "AA-0002"]) {
    const row = html.split('<div class="g-row">').find((r) => r.includes(`data-gt="${id}"`));
    assert.doesNotMatch(row, /class="dot mk/, `${id}: 点にしない`);
    const m = /<i class="gbar[^"]*"[^>]*data-gt="[^"]*"[^>]*style="left:[\d.]+%;width:([\d.]+)%/.exec(row);
    assert.ok(m && Math.abs(+m[1] - (1 / span) * 100) < 0.01, `${id}: 幅は 1 日分`);
    assert.match(row, /data-gh="l"[\s\S]*data-gh="r"/, `${id}: 両端のつまみ`);
  }
});

test("renderProjects・renderSchedule: showPrio が true でも false でも data-pref=\"prio\" の取っ手が 1 つ出る。aria-expanded は開閉に合わせ、閉じると「今日の優先」は出ない", () => {
  const d = load();
  const views = {
    projects: (showPrio) => renderProjects(d, TODAY, { filter: "all", view: "gantt", window: "m6", showPrio }),
    schedule: (showPrio) => renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW, showPrio }),
  };
  for (const [name, render] of Object.entries(views)) {
    const open = render(true), shut = render(false);
    assert.equal(count(open, /data-pref="prio"/g), 1, `${name}: 開いているとき`);
    assert.equal(count(shut, /data-pref="prio"/g), 1, `${name}: 閉じているとき`);
    assert.match(open, /data-pref="prio"[^>]*aria-expanded="true"/, name);
    assert.match(shut, /data-pref="prio"[^>]*aria-expanded="false"/, name);
    assert.ok(open.includes(">今日の優先</h2>"), `${name}: 開いているとき見出しが出る`);
    assert.ok(!shut.includes(">今日の優先</h2>"), `${name}: 閉じると見出しが出ない`);
  }
});

test("renderGantt: 先行タスクのあるバーに data-pre（空白区切り）が付く。先行のないバーには付かない", () => {
  const d = load();
  const html = gantt(d, ["AA"]);
  assert.match(html, /data-gt="AA-0006"[^>]*data-pre="AA-0004 AA-0005"/);
  assert.match(html, /data-gt="AA-0002"[^>]*data-pre="AA-0001"/);
  assert.doesNotMatch(html, /data-gt="AA-0001"[^>]*data-pre=/);
});

test("ibExamples: 依頼の例は、対象のプロジェクトの終わっていないタスクの ID で埋める。別のプロジェクトの ID を混ぜない", () => {
  const data = { tasks: [
    { id: "AA-0001", projectId: "AA", status: "Done" }, { id: "AA-0002", projectId: "AA", status: "To Do" }, { id: "AA-0003", projectId: "AA", status: "Doing" },
    { id: "AB-0001", projectId: "AB", status: "To Do" },
  ] };
  const ex = ibExamples(data, "AA", "2026-11-01");
  assert.equal(ex.due, "AA-0002 が 5 日遅れた（原因: ベンダー）。");
  assert.match(ex.add, /結合テスト 2026-11-15 .*前のタスク AA-0002$/, "期限の例は今日の 14 日後");
  assert.match(ibExamples(data, "", "2026-11-01").due, /^AA-0002 /, "対象が空なら、先頭のタスクのプロジェクト");
  assert.match(ibExamples(data, "AB", "2026-11-01").due, /^AB-0001 /);
  assert.ok(!Object.values(ex).some((s) => /[<>]/.test(s)), "<…> の穴埋めを残さない");
  assert.match(ibExamples({ tasks: [] }, "", "2026-11-01").due, /^AA-0001 /);
});

test("renderTaskPop: 件名・メモ・ID はエスケープされ、窓には編集の入力と「リストで開く」「削除」が出る", () => {
  const d = load();
  const t = d.tasks.find((x) => x.id === "AA-0004"); t.title = '"><img src=x onerror=1>'; t.memo = "<script>x</script>";
  const html = renderTaskPop(d, { id: "AA-0004", x: 10.4, y: 20.6 }, "<select>状態</select>");
  assert.ok(!html.includes("<img src=x") && !html.includes("<script>x"));
  for (const k of ["title", "start", "due", "memo"]) assert.ok(html.includes(`data-f="${k}" data-id="AA-0004"`), k);
  assert.ok(html.includes('type="checkbox" data-f="important" data-id="AA-0004"') && !html.includes("重要度"));
  d.tasks.find((x) => x.id === "AA-0004").important = true;
  assert.ok(/data-f="important" data-id="AA-0004" checked/.test(renderTaskPop(d, { id: "AA-0004", x: 0, y: 0 }, "")), "重要なら checked");
  assert.ok(html.includes('data-goto="AA-0004"') && html.includes('data-del="AA-0004"') && html.includes("data-addpre=\"AA-0004\"") || html.includes('data-rmpre="AA-0004|AA-0003"'));
  assert.ok(html.includes("left:10px;top:21px") && html.includes("<select>状態</select>"));
  assert.equal(renderTaskPop(d, { id: "ZZ", x: 0, y: 0 }, ""), "");
});

test("assignLevels: 前のラベルと重なるなら、重ならない最初の段へ置く。段は必要な数だけ増える", () => {
  // x = ラベルの左端、w = 幅
  const lv = assignLevels([{ x: 0, w: 100 }, { x: 10, w: 100 }, { x: 20, w: 100 }, { x: 105, w: 50 }, { x: 300, w: 50 }]);
  assert.deepEqual(lv, [0, 1, 2, 0, 0]); // 4 つ目は、1 つ目の端(100)を過ぎているので 0 段目へ戻る
  assert.deepEqual(assignLevels([]), []);
  assert.deepEqual(assignLevels([{ x: 0, w: 50 }, { x: 50, w: 50 }]), [0, 0], "端が接するだけなら重ならない");
});

test("renderGantt: 近い日付のマイルストーン 3 件は、1 段ごとに 18px ずらして置き、行の高さを段数に合わせて広げる。離れていれば 1 段で 44px", () => {
  const d = load();
  d.projects[0].milestones = [{ name: "あ", date: "2026-08-31" }, { name: "い", date: "2026-09-01" }, { name: "う", date: "2026-09-02" }];
  const html = gantt(d, ["AA"]);
  assert.deepEqual([...html.matchAll(/class="ms"[^>]*top:(\d+)px/g)].map((m) => +m[1]), [6, 24, 42]);
  assert.deepEqual([...html.matchAll(/class="ms-l"[^>]*top:(\d+)px/g)].map((m) => +m[1]), [2, 20, 38]);
  assert.match(html, /g-msrow[^]*?width:var\(--lanew\);height:62px/); // 3 段 × 18 + 8
  d.projects[0].milestones = [{ name: "あ", date: "2026-08-31" }, { name: "い", date: "2027-02-20" }];
  assert.match(gantt(d, ["AA"]), /g-msrow[^]*?height:44px/);
});

test("layoutMilestones: 実測のラベル幅で段を決め直し、各要素の top と行の高さを書く。幅 0（隠れている）の行・マイルストーンの無い本体は触らない", () => {
  const el = (offsetLeft, offsetWidth) => ({ offsetLeft, offsetWidth, style: {} });
  const lane = (marks, labels, offsetWidth = 500) => ({ offsetWidth, style: {}, querySelectorAll: (s) => (s === ".ms" ? marks : labels) });
  const body = (l) => ({ querySelector: () => l });
  const marks = [el(0, 9), el(0, 9), el(0, 9)];
  const labels = [el(0, 100), el(50, 100), el(300, 100)];
  const shown = lane(marks, labels);
  const hidden = lane([el(0, 9), el(0, 9)], [el(0, 0), el(0, 0)], 0);
  layoutMilestones([body(shown), body(hidden), body(null)]);
  assert.deepEqual(marks.map((m) => m.style.top), ["6px", "24px", "6px"]);
  assert.deepEqual(labels.map((l) => l.style.top), ["2px", "20px", "2px"]);
  assert.equal(shown.style.height, "44px"); // 2 段 × 18 + 8 = 44
  assert.equal(hidden.style.height, undefined);
});

// ---- 設定タブ: 節の折りたたみ ----
const FOLD_IDS = ["basic", "days", "nat", "hol", "wrk", "rules", "wbs"];
const foldTag = (html, id) => (html.match(new RegExp(`<details[^>]*data-fold="${id}"[^>]*>`)) ?? [""])[0];

test("設定: 7 つの節（基本の設定・休みと営業日・日本の祝日・休み（手動）・営業日として扱う日・キーワード規則・WBS の取り込み記録）が details で、既定はすべて開く", () => {
  const html = setv(load());
  for (const id of FOLD_IDS) assert.match(foldTag(html, id), /<details[^>]* open[ >]/, id);
  assert.equal([...html.matchAll(/<details /g)].length, 7);
  assert.equal([...html.matchAll(/<summary/g)].length, 7);
});

test("設定: 日本の祝日・休み（手動）・営業日として扱う日は、「休みと営業日」の節の中にある。ほかの節の中には入れ子にならない", () => {
  const html = setv(load());
  const days = html.slice(html.indexOf('data-fold="days"'), html.indexOf('data-fold="rules"'));
  for (const id of ["nat", "hol", "wrk"]) assert.ok(days.includes(`data-fold="${id}"`), id);
  assert.ok(html.indexOf('data-fold="basic"') < html.indexOf('data-fold="days"'));
  assert.ok(!html.slice(html.indexOf('data-fold="basic"'), html.indexOf('data-fold="days"')).includes('data-fold="nat"'));
});

test("設定: opts.closed の節だけ open が付かない。親を閉じても、子の開閉は変えない", () => {
  const html = setv(load(), { closed: ["hol", "rules"] });
  for (const id of ["hol", "rules"]) assert.doesNotMatch(foldTag(html, id), / open/, id);
  for (const id of ["basic", "days", "nat", "wrk", "wbs"]) assert.match(foldTag(html, id), / open[ >]/, id);
  assert.match(foldTag(setv(load(), { closed: ["days"] }), "hol"), / open[ >]/);
});

test("設定: 節を閉じても、中の入力と注意は描く（閉じるのは表示だけ）", () => {
  const d = load();
  d.settings = { ...d.settings, waitingLongDays: "7" };
  const html = setv(d, { closed: FOLD_IDS });
  assert.ok(setTag(html, "waitingLongDays") && html.includes("settings.waitingLongDays:"));
  assert.match(html, /<input type="checkbox" data-set="countWeekendsAndHolidays"/);
});

test("設定: 折りたたむ節は、見出しで名前を付ける（aria-labelledby が見出しの id を指す）", () => {
  const html = setv(load());
  for (const id of FOLD_IDS) {
    assert.match(foldTag(html, id), new RegExp(`aria-labelledby="h-${id}"`), id);
    assert.ok(html.includes(`id="h-${id}"`), id);
  }
});

test("設定: 閉じている節の見出しに、中の注意の件数を出す。開いている節・注意のない節には出さない", () => {
  const d = load();
  d.settings = { ...d.settings, waitingLongDays: "7", countWeekendsAndHolidays: "true", holidays: "x" };
  const head = (html, id) => html.match(new RegExp(`data-fold="${id}"[^>]*><summary>([^]*?)</summary>`))?.[1] ?? "";
  const closed = setv(d, { closed: FOLD_IDS });
  assert.match(head(closed, "basic"), /注意 2 件/, "営業日の数え方と待ち長期化の日数");
  assert.match(head(closed, "hol"), /注意 1 件/);
  assert.match(head(closed, "days"), /注意 1 件/, "閉じた親の見出しには、子の注意を数える");
  for (const id of ["nat", "wrk", "rules", "wbs"]) assert.doesNotMatch(head(closed, id), /注意/, id);
  const open = setv(d);
  for (const id of FOLD_IDS) assert.doesNotMatch(head(open, id), /注意/, id);
  assert.doesNotMatch(head(setv(load(), { closed: FOLD_IDS }), "basic"), /注意/, "注意が無ければ出さない");
});

test("設定: 規則のエラー（ruleError）も、閉じた「キーワード規則」の見出しに 1 件として出す", () => {
  const head = (html) => html.match(/data-fold="rules"[^>]*><summary>([^]*?)<\/summary>/)[1];
  assert.match(head(setv(load(), { closed: ["rules"], ruleError: "同じキーワードがあります" })), /注意 1 件/);
  assert.doesNotMatch(head(setv(load(), { closed: ["rules"] })), /注意/);
});

test("タスクの並べ替え: 編集画面のリストとガントに「⠿」ハンドル（data-mvh）と、見出し・行の落とし先（data-mvgrp・data-mvrow）が出る", () => {
  const d = load();
  const list = renderProjects(d, TODAY, { filter: "AA", view: "list" });
  const edit = gantt(d, ["AA"]);
  const proj = d.tasks.filter((t) => t.projectId === "AA");
  for (const [name, html] of [["リスト", list], ["ガント", edit]]) {
    assert.equal(count(html, /data-mvh="/g), proj.length, `${name}: タスクごとに 1 つのハンドル`);
    assert.equal(count(html, /data-mvrow="/g), proj.length, `${name}: 行の落とし先`);
    assert.ok(count(html, /data-mvgrp="AA"/g) >= 4, `${name}: セクションの見出し（設計・調達・構築×2 と （なし））`);
  }
  assert.match(list, /data-mvgrp="AA" data-mvg="調達" data-mvsg="機器選定"/);
});

test("renderProjects（リスト）: 名前と状態は .pstick にあり、種別・開始・期限・進捗は .phead に残る。入力欄の data-pf は変わらない", () => {
  const cases = { タスクあり: load(), タスク0件: (() => { const d = load(); d.tasks = []; return d; })() };
  for (const [name, d] of Object.entries(cases)) {
    const html = renderProjects(d, TODAY, { filter: "AA", view: "list" });
    const stick = html.slice(html.indexOf('<div class="pstick">'), html.indexOf('<div class="phead">'));
    const head = html.slice(html.indexOf('<div class="phead">'), html.indexOf('<div class="twrap">'));
    assert.ok(html.includes('<div class="pstick">') && html.includes('<div class="tscroll tlist">'), `${name}: 構造がある`);
    assert.equal((stick.match(/data-pf="name"/g) ?? []).length, 1, `${name}: 名前の入力欄は .pstick に 1 つ`);
    assert.equal((stick.match(/data-pf="status"/g) ?? []).length, 1, `${name}: 状態の選択欄は .pstick に 1 つ`);
    assert.ok(!head.includes('data-pf="name"') && !head.includes('data-pf="status"'), `${name}: .phead には名前・状態がない`);
    for (const f of ["type", "start", "due"]) assert.ok(head.includes(`data-pf="${f}"`), `${name}: .phead に ${f}`);
  }
});

test("renderProjects（リスト）: .phead（種別・開始・期限・進捗・稼働・注意の印）も .pstick の中にあり、名前・状態の行（.prow）の次に並ぶ。固定する範囲に、プロジェクトの見出し全体が入る", () => {
  const html = renderProjects(load(), TODAY, { filter: "AA", view: "list" });
  const start = html.indexOf('<div class="pstick">');
  // .pstick の閉じ（最初の <div の深さが 0 に戻る位置）を探す
  let depth = 0, end = -1;
  for (const m of html.slice(start).matchAll(/<div\b|<\/div>/g)) { depth += m[0] === "</div>" ? -1 : 1; if (depth === 0) { end = start + m.index + m[0].length; break; } }
  const stick = html.slice(start, end);
  assert.ok(end > start, ".pstick の閉じが見つかる");
  assert.ok(stick.startsWith('<div class="pstick"><div class="prow">'), "最初が名前・状態の行（.prow）");
  assert.ok(stick.indexOf('data-pf="name"') < stick.indexOf('<div class="phead">') && stick.indexOf('data-pf="status"') < stick.indexOf('<div class="phead">'), "名前・状態は .phead の前");
  for (const f of ["type", "start", "due"]) assert.ok(stick.includes(`data-pf="${f}"`), `.pstick の中に ${f}`);
  assert.ok(stick.includes("class=\"hrs\"") || stick.includes("mono hrs"), "稼働も .pstick の中");
  assert.ok(html.slice(end).trimStart().startsWith('<div class="twrap"><div class="thstrip" aria-hidden="true"></div><div class="tscroll tlist">'), ".pstick の直後が、列見出しの複製(.thstrip)と表の枠を包む .twrap");
});

test("renderGantt（編集画面）: プロジェクトごとに .pgstick と .gwrap（.gstrip + .gscroll）に分かれ、.pg-head は .pgstick の中にある", () => {
  const html = gantt(load(), ["AA", "AB", "AC"]);
  assert.equal(count(html, /<section class="pg"/g), 3);
  assert.equal(count(html, /<div class="pgstick"><div class="pg-head">/g), 3);
  assert.equal(count(html, /<div class="gwrap"><div class="gstrip" aria-hidden="true"><\/div><div class="gscroll"/g), 3);
  assert.equal(count(html, /class="gscroll"/g), 3);
  const attrs = [...html.matchAll(/class="gscroll" (data-todayfrac="[^"]*" data-s0="[^"]*" data-span="[^"]*")/g)].map((m) => m[1]);
  assert.equal(attrs.length, 3);
  assert.equal(new Set(attrs).size, 1, "全プロジェクトで同じ値（ドラッグが各 .gscroll から読む）");
  for (const sec of html.split('<section class="pg"').slice(1)) {
    assert.equal(count(sec, /class="gbody"/g), 1);
    assert.ok(sec.indexOf('<div class="g-row g-head">') > sec.indexOf('class="gbody"'), "日付軸は .gbody の中");
    assert.ok(sec.indexOf('class="pg-head"') < sec.indexOf('class="gwrap"'), "見出しは枠の外（前）");
  }
});

test("renderProjects: チップは .chips-row に入り、プロジェクト名のプルダウンと「＋ プロジェクトを追加」は .ptool-end に入る（30 プロジェクトでも同じ形）", () => {
  const d = load();
  for (let i = 0; i < 27; i++) d.projects.push({ ...d.projects[1], id: `Z${i}`, name: `追加 ${i}` });
  for (const view of ["gantt", "list"]) {
    const html = renderProjects(d, TODAY, { filter: "all", view, window: "m6" });
    const tool = html.slice(html.indexOf('<div class="toolbar ptool">'), html.indexOf('<div class="cols'));
    const row = tool.slice(tool.indexOf('<div class="chips-row"'), tool.indexOf('<div class="ptool-end">'));
    assert.equal(count(tool, /class="chips-row"/g), 1, view);
    assert.equal(count(row, /data-filter="/g), 32, `${view}: すべて + 30 プロジェクト + プロジェクトなしのチップが全部 .chips-row の中`);
    assert.ok(!row.includes("data-addproject") && !row.includes("data-projectpick"), `${view}: 追加ボタンとプルダウンは、スクロールする行の外`);
    const end = tool.slice(tool.indexOf('<div class="ptool-end">'));
    assert.ok(end.includes("data-addproject") && end.includes("data-projectpick"), view);
    assert.ok(!html.includes("data-groupfilter"), `${view}: 大項目の絞り込みはない`);
  }
});

test("絞り込みのチップは、状態が「完了」のプロジェクトを出さない（選択中のあいだだけ出す）。プルダウンには、完了も含む全プロジェクトが出る", () => {
  const d = load();
  d.projects[1].status = "完了"; // B
  const chipIds = (html) => [...html.slice(html.indexOf('<div class="chips-row"'), html.indexOf('<div class="ptool-end">')).matchAll(/data-filter="([^"]+)"/g)].map((m) => m[1]);
  const opts = (html) => [...html.slice(html.indexOf("data-projectpick"), html.indexOf("</select>", html.indexOf("data-projectpick"))).matchAll(/<option value="([^"]+)"( selected)?>/g)].map((m) => [m[1], !!m[2]]);
  for (const view of ["gantt", "list"]) {
    const all = renderProjects(d, TODAY, { filter: "all", view, window: "m6" });
    assert.deepEqual(chipIds(all), ["all", "AA", "AC", "none"], `${view}: 完了の AB はチップに出ない`);
    assert.deepEqual(opts(all).map((o) => o[0]), ["all", "AA", "AB", "AC", "none"], `${view}: プルダウンには AB も出る`);
    assert.deepEqual(opts(all).filter((o) => o[1]), [["all", true]], `${view}: すべてが選択中`);
    const b = renderProjects(d, TODAY, { filter: "AB", view, window: "m6" });
    assert.deepEqual(chipIds(b), ["all", "AA", "AB", "AC", "none"], `${view}: 完了の AB を選んでいるあいだは、AB のチップが出る`);
    assert.deepEqual(opts(b).filter((o) => o[1]), [["AB", true]], `${view}: プルダウンも AB が選択中`);
  }
  assert.deepEqual(chipIds(renderProjects(load(), TODAY, { filter: "all", view: "list" })), ["all", "AA", "AB", "AC", "none"], "完了がなければ、全部出る");
});

test("renderList: .twrap は表（.tlist）だけを含み、メモ・マイルストーン・履歴は .twrap の外", () => {
  const html = renderProjects(load(), TODAY, { filter: "AA", view: "list" });
  const a = html.indexOf('<div class="twrap">');
  assert.ok(a > 0);
  let depth = 0, end = -1;
  for (const m of html.slice(a).matchAll(/<div\b|<\/div>/g)) { depth += m[0] === "</div>" ? -1 : 1; if (depth === 0) { end = a + m.index + 6; break; } }
  const wrap = html.slice(a, end);
  assert.equal(count(wrap, /<table\b/g), 1);
  assert.ok(!wrap.includes("マイルストーン") && !wrap.includes("日程変更の履歴") && !wrap.includes("変更はその場でファイルに保存"), "表の外のものを含まない");
  assert.ok(html.indexOf("マイルストーン", end) > end, "マイルストーンは .twrap の後");
});

// ---- チェックリストの M/N 表示（今日の優先・今日のタスク） ----
const ckTask = (n, done) => ({ checklist: Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, text: `項目${i + 1}`, done: i < done })) });

test("checkMeterHtml: 項目なしは空。あれば割合の幅と M/N。remain で残り件数。全部済みは all", () => {
  assert.equal(checkMeterHtml({}), "");
  assert.equal(checkMeterHtml({ checklist: [] }), "");
  const a = checkMeterHtml(ckTask(5, 2));
  assert.ok(a.includes("width:40%") && a.includes(">2/5<") && a.includes('class="ck-n mono"'));
  assert.ok(checkMeterHtml(ckTask(5, 2), { remain: true }).includes("2/5（残り 3 件）"));
  assert.ok(checkMeterHtml(ckTask(4, 4)).includes('class="ck-n mono all"'));
});

test("renderTodayTasks: チェックリストのあるタスクの行に M/N（残り K 件）。ないタスクの行には出ない", () => {
  const { d } = withToday();
  const [a5, a7] = items(renderTodayTasks(d, TODAY));
  assert.ok(a5.html.includes("2/4（残り 2 件）") && a5.html.includes("ck-meter"));
  assert.ok(!a7.html.includes("ck-meter"));
});

test("renderPrio: チェックリストのあるタスクの行に M/N（残り K 件）。ないタスクの行には出ない", () => {
  const html = renderPrio(load(), TODAY, { sched: true });
  assert.ok(html.includes("2/4（残り 2 件）"));
  assert.equal(count(html, /ck-meter/g), 1, "チェックリストのあるタスク（AA-0005）だけ");
});

// ---- ガントのチェックリスト表示 ----
const grow = (html, id) => html.split('<div class="g-row">').find((r) => r.includes(`<span class="id">${id}</span>`)) ?? "";

test("renderGantt: チェックリストのあるタスクは、ラベルに線と M/N、バーに割合の塗り。バーの右の期限には数字を出さない", () => {
  const r = grow(gantt(load(), ["AA"]), "AA-0005"); // In Progress・2/4
  assert.ok(r.includes("ck-meter") && count(r, />2\/4</g) === 1, "ラベルに M/N");
  assert.ok(/class="gbar[^"]*\bck\b/.test(r) && r.includes('<u class="gck" style="width:50%"></u>'), "バーの塗り");
  assert.match(/class="g-due mono"[^>]*>([^<]*)</.exec(r)[1], /^\d+\/\d+$/, "バーの右は期限の日付だけ");
});

test("renderGantt: 項目なしのタスクには、線も数字も塗りも出ない。0 件済みは幅 0%", () => {
  const d = load();
  const html = gantt(d, ["AA"]);
  const r4 = grow(html, "AA-0004");
  assert.ok(!r4.includes("ck-meter") && !r4.includes("gck"));
  d.tasks.find((t) => t.id === "AA-0004").checklist = [{ id: "c1", text: "a", done: false }, { id: "c2", text: "b", done: false }];
  assert.ok(grow(gantt(d, ["AA"]), "AA-0004").includes('class="gck" style="width:0%"'));
});

test("renderGantt: Done のタスクは、ラベルの M/N が all（緑）で、バーに塗りを出さない", () => {
  const r = grow(gantt(load(), ["AA"]), "AA-0001"); // Done・3/3
  assert.ok(r.includes('class="ck-n mono all"') && r.includes(">3/3<"));
  assert.ok(!r.includes("gck"));
});

test("renderGantt: 点（期限だけのタスク）は、ラベルに M/N を出し、塗りは出さない", () => {
  const d = load();
  const t = d.tasks.find((x) => x.id === "AA-0006");
  Object.assign(t, { start: null, predecessors: [], checklist: [{ id: "c1", text: "a", done: true }, { id: "c2", text: "b", done: false }] });
  const r = grow(gantt(d, ["AA"]), "AA-0006");
  assert.ok(r.includes("dot mk") && r.includes(">1/2<") && !r.includes("gck"));
});

// ---- チェックリストの編集欄（リストの展開・ガントの編集の窓） ----
test("checklistEditorHtml: 項目ごとに取っ手・チェック・文言・削除、末尾に追加欄。文言はエスケープ。項目なしでも追加欄は出る", () => {
  const t = { id: "AA-0005", checklist: [{ id: "c1", text: '<b>"x"&', done: true }, { id: "c2", text: "b", done: false }, { id: "c3", text: "c", done: false }] };
  const h = checklistEditorHtml(t);
  assert.equal(count(h, /data-ckid="/g), 3);
  for (const a of ["data-ckmv", "data-ckdone", "data-cktext", "data-ckdel"]) assert.equal(count(h, new RegExp(`${a}="AA-0005\\|c\\d"`, "g")), 3, a);
  assert.equal(count(h, /data-ckadd="AA-0005"/g), 1);
  assert.ok(h.includes('value="&lt;b&gt;&quot;x&quot;&amp;"') && !h.includes("<b>\"x\""));
  assert.equal(count(h, /type="checkbox"[^>]*checked/g), 1);
  const textInput = (id) => new RegExp(`<input[^>]*data-cktext="AA-0005\\|${id}"[^>]*>`).exec(h)[0];
  assert.ok(textInput("c1").includes("done") && !textInput("c2").includes("done"), "済みの文言だけ done");
  const e = checklistEditorHtml({ id: "AA-0004" });
  assert.ok(e.includes('data-ckadd="AA-0004"') && !e.includes("data-ckid"));
});

test("renderProjects(list): 列「チェック」。閉じていれば ▸ M/N（項目なしは ＋ 追加）、開いていればその行の直後に編集欄", () => {
  const d = load();
  const html = renderProjects(d, TODAY, { view: "list", filter: "AA" });
  assert.ok(html.includes("<th>チェック</th>"));
  assert.ok(/data-cktoggle="AA-0005" aria-expanded="false"[^>]*>▸ 2\/4</.test(html) && /data-cktoggle="AA-0004" aria-expanded="false"[^>]*>＋ 追加</.test(html));
  assert.ok(!html.includes("ck-tr"));
  const open = renderProjects(d, TODAY, { view: "list", filter: "AA", checkOpen: new Set(["AA-0005"]) });
  assert.ok(/aria-expanded="true"[^>]*>▾ 2\/4</.test(open));
  const i = open.indexOf('data-row="AA-0005"'), p = open.indexOf('data-ckpanel="AA-0005"'), nxt = open.indexOf('<tr data-row="', i + 1);
  assert.ok(i >= 0 && p > i && p < nxt, "AA-0005 の行の直後");
  assert.equal(count(open, /data-ckpanel=/g), 1);
});

test("renderTaskPop: チェックリストの欄を、期限の下・前のタスクの上に置く", () => {
  const h = renderTaskPop(load(), { id: "AA-0005", x: 10, y: 10 }, "");
  const due = h.indexOf('data-f="due"'), ck = h.indexOf("ckedit"), pre = h.indexOf("前のタスク");
  assert.ok(due >= 0 && ck > due && pre > ck);
});

// ---- Done にするときの警告 ----
test("doneAskHtml: stage が check なら、未完了の項目の一覧と 3 つのボタン。文言はエスケープする", () => {
  const h = doneAskHtml({ id: "AA-0005", status: "Done", n: 0, future: [], open: ["a<b>", "b"], stage: "check", checkAll: false });
  assert.ok(h.includes("未完了の項目が 2 件あります") && h.includes('role="alert"'));
  assert.ok(h.includes("<li>a&lt;b&gt;</li>") && !h.includes("<li>a<b>"));
  for (const a of ['data-ckall="AA-0005"', 'data-ckkeep="AA-0005"', "data-doneno"]) assert.ok(h.includes(a), a);
  assert.ok(!h.includes("data-doneok"));
});

test("doneAskHtml: stage が future、または stage なし（従来の形）なら、予定枠の確認（data-doneok）のまま", () => {
  for (const pd of [{ id: "AA-0005", status: "Done", n: 1, future: ["S3"], open: [], stage: "future" }, { id: "AA-0005", status: "Done", n: 1, future: ["S3"] }]) {
    const h = doneAskHtml(pd);
    assert.ok(h.includes('data-doneok="AA-0005"') && h.includes("未来の予定の枠 1 件") && !h.includes("data-ckall"));
  }
});

test("受信箱の提案カード: 登録の行には項目（チェックリスト）の件数を添える", () => {
  const html = cardOf([
    { kind: "add", rows: [{ ref: "t1", title: "疎通確認", projectId: "AA", group: null, subgroup: null, due: "2026-12-10", businessDays: null, start: null, predecessors: [], checklist: ["a", "b"] }] },
  ]);
  assert.ok(html.includes("項目 2 件"));
});
test("受信箱の履歴: 処理待ち・処理中の依頼にも「却下する」を出す（見張りが止まったときに、画面から取り下げられる）", () => {
  for (const status of ["pending", "working"]) {
    const html = ib(withInbox([reqOf("R1", status)]), { open: true });
    assert.ok(html.includes('data-ib-reject="R1"'), status);
  }
  assert.ok(!ib(withInbox([reqOf("R1", "applied", { result: { at: T0, by: "html", summary: "x" } })]), { open: true }).includes("data-ib-reject"));
});

test("escape: 数字・列挙値のつもりの項目（依頼の status・thread の role・定例の day・取り込みの件数）も、細工した値で HTML にならない", () => {
  const evil = '"><img src=x onerror=1>';
  const d = withInbox([reqOf("R1", evil, { thread: [{ role: "user", at: T0, text: "a" }, { role: evil, at: T0, text: "b" }] })]);
  assert.ok(!ib(d, { open: true }).includes("<img src=x"), "受信箱の status・role");
  const e = load();
  const t = e.tasks.find((x) => x.id === "AA-0001");
  t.repeat = { unit: "month", day: evil };
  assert.ok(!renderProjects(e, TODAY, { filter: "all", view: "list", window: "m6", hideDone: false }).includes("<img src=x"), "リストの定例");
  const pop = renderTaskPop(e, { id: "AA-0001", x: 10, y: 10 }, "");
  assert.ok(pop.includes("繰り返し") && !pop.includes("<img src=x"), "詳細の定例");
  e.settings.wbsImports = { [e.projects[0].id]: { file: "f", at: "2026-10-01", added: evil, updated: evil } };
  assert.ok(!renderSettings(e, TODAY, {}).includes("<img src=x"), "設定の取り込み件数");
});

test("受信箱: 提案の形が壊れていても、例外にせず、帯だけを「表示できません」にする（画面の本体を描けるように）", () => {
  const broken = reqOf("R1", "proposed", { proposal: { summary: "x", ops: [] } }); // sections が無い
  let html;
  assert.doesNotThrow(() => { html = ib(withInbox([broken]), { open: true }); });
  assert.match(html, /依頼の帯を表示できません/);
  assert.match(ib(withInbox([]), { open: true }), /これまでの依頼|依頼を送る/, "正常なデータは、これまでどおり出る");
});

test("renderSchedule: urgentDraft があると突発タスクの入力欄を出す（プロジェクトなし・30 分が選択済み）。null なら出さない", () => {
  const d = load();
  const draft = { date: TODAY, start: "13:00", title: "", projectId: "", minutes: 30 };
  const html = sched(d, { urgentDraft: draft });
  for (const a of ["data-urgsave", "data-urgcancel", "data-ug=\"title\"", "data-ug=\"projectId\"", "data-ug=\"minutes\""]) assert.ok(html.includes(a), a);
  assert.match(html, /<option value="" selected>プロジェクトなし<\/option>/);
  for (const p of d.projects) assert.ok(html.includes(`<option value="${p.id}">`), p.id);
  assert.match(html, /<option value="30" selected>30 分<\/option>/);
  for (const m of [15, 45, 60]) assert.ok(html.includes(`<option value="${m}">`), String(m));
  assert.ok(!sched(d, { urgentDraft: null }).includes("data-urgsave"));
  assert.ok(!sched(d, {}).includes("data-urgcancel"));
});

test("renderSchedule: 突発タスクの入力欄は、下書きの件名・プロジェクト・長さを反映し、件名をエスケープする", () => {
  const d = load();
  const html = sched(d, { urgentDraft: { date: TODAY, start: "13:00", title: "<b>x</b>", projectId: d.projects[0].id, minutes: 45 } });
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;") && !html.includes("<b>x</b>"));
  assert.ok(html.includes(`<option value="${d.projects[0].id}" selected>`));
  assert.match(html, /<option value="45" selected>/);
});

test("urgentDefaultStart: 突発タスクの開始の初期値。今日は現在時刻を 15 分刻みに切り上げ（23:45 まで）、ほかの日は 09:00", () => {
  const now = (time) => ({ date: "2026-10-21", time });
  assert.equal(urgentDefaultStart("2026-10-21", now("10:15")), "10:15", "刻みちょうどはそのまま");
  assert.equal(urgentDefaultStart("2026-10-21", now("10:16")), "10:30");
  assert.equal(urgentDefaultStart("2026-10-21", now("00:00")), "00:00");
  assert.equal(urgentDefaultStart("2026-10-21", now("23:44")), "23:45");
  assert.equal(urgentDefaultStart("2026-10-21", now("23:50")), "23:45", "23:45 を超えない");
  assert.equal(urgentDefaultStart("2026-10-22", now("15:07")), "09:00", "今日以外は 09:00");
  assert.equal(urgentDefaultStart("2026-10-20", now("15:07")), "09:00", "過去の日も 09:00");
});

test("urgentForm: 日付・開始時刻の欄に下書きの値が入る", () => {
  const html = sched(load(), { urgentDraft: { date: "2026-10-22", start: "14:15", title: "", projectId: "", minutes: 30 } });
  assert.match(html, /<input[^>]*type="text"[^>]*data-date="1" data-ug="date" value="2026-10-22"/);
  assert.match(html, /data-ug="start"[^>]*value="14:15"/);
  assert.match(html, /type="time"[^>]*data-ug="start"|data-ug="start"[^>]*type="time"/);
});

test("urgentInput: 件名・日付・開始のどれかが空なら null、そろえば addUrgentTask への入力", () => {
  const f = { title: " 障害対応 ", projectId: "", minutes: "45", date: "2026-10-22", start: "14:00" };
  assert.deepEqual(urgentInput(f), { input: { title: "障害対応", projectId: null, date: "2026-10-22", start: "14:00", minutes: 45 } });
  assert.equal(urgentInput({ ...f, projectId: "AA" }).input.projectId, "AA");
  for (const k of ["title", "date", "start"]) assert.equal(urgentInput({ ...f, [k]: "  " }), null, k);
});

// ---- プロジェクトなしのタスク（サンプルの ZZ-0001） ----
const noneOpt = (html) => /<option value="none"[^>]*>プロジェクトなし<\/option>/.test(html);
const noneChip = (html) => /<button class="chip-btn" data-filter="none"[^>]*>プロジェクトなし<\/button>/.test(html);

test("リスト: プロジェクトなしのタスクが、末尾の「プロジェクトなし」の区切りに出る。チップと選択欄にも出る", () => {
  const html = renderProjects(load(), TODAY, { view: "list" });
  assert.ok(html.includes('data-row="ZZ-0001"'));
  assert.ok(html.includes('aria-label="プロジェクトなし"'));
  assert.ok(noneChip(html) && noneOpt(html));
  assert.ok(html.indexOf('data-row="ZZ-0001"') > html.indexOf('data-row="AC-0001"') || html.indexOf('data-row="ZZ-0001"') > html.indexOf('data-row="AA-0001"'));
  const sec = html.slice(html.indexOf('aria-label="プロジェクトなし"'));
  for (const bad of ["data-pdel", "data-msadd", "data-pf=", "稼働", "data-addat"]) assert.ok(!sec.includes(bad), bad);
});

test("リスト: 絞り込みは AA で ZZ-0001 を隠し、none で ZZ-0001 だけにする", () => {
  assert.ok(!renderProjects(load(), TODAY, { view: "list", filter: "AA" }).includes('data-row="ZZ-0001"'));
  const html = renderProjects(load(), TODAY, { view: "list", filter: "none" });
  assert.ok(html.includes('data-row="ZZ-0001"') && !html.includes('data-row="AA-0001"'));
  assert.ok(/data-filter="none" aria-pressed="true"/.test(html) && /<option value="none" selected>/.test(html));
});

test("ガント: プロジェクトなしの行が出る。見出し・全体バー・マイルストーンは出ない", () => {
  const html = renderProjects(load(), TODAY, { view: "gantt" });
  assert.ok(html.includes('data-gt="ZZ-0001"'));
  const sec = html.slice(html.indexOf('<section class="pg" aria-label="プロジェクトなし"'));
  assert.ok(sec.includes('data-gt="ZZ-0001"') && !sec.includes("data-gp=") && !sec.includes("data-open=") && !sec.includes("g-msrow") && !sec.includes("data-gopen"));
  assert.ok(!renderProjects(load(), TODAY, { view: "gantt", filter: "AA" }).includes('data-gt="ZZ-0001"'));
  assert.ok(renderProjects(load(), TODAY, { view: "gantt", filter: "none" }).includes('data-gt="ZZ-0001"'));
});

test("プロジェクトなしのタスクしかない（projects が空）データでも、リスト・ガントが出る", () => {
  const d = load(); d.projects = []; d.tasks = d.tasks.filter((t) => t.projectId == null);
  for (const view of ["list", "gantt"]) {
    const html = renderProjects(d, TODAY, { view });
    assert.ok(html.includes("ZZ-0001") && !html.includes("プロジェクトがありません"), view);
  }
});

test("プロジェクトなしのタスクがなければ、区切りも選択肢も出ない。none の絞り込みは all に戻る", () => {
  const d = load(); d.tasks = d.tasks.filter((t) => t.projectId != null);
  const html = renderProjects(d, TODAY, { view: "list", filter: "none" });
  assert.ok(!noneChip(html) && !noneOpt(html) && html.includes('data-row="AA-0001"'));
});

test("今日の優先・今日のタスク: プロジェクトなしのタスクは、プロジェクト名の欄に「プロジェクトなし」と出る", () => {
  const d = load();
  assert.ok(rankTasks(d, TODAY).some((r) => r.taskId === "ZZ-0001"), "ZZ-0001 が順位にある");
  const prio = renderPrio(d, TODAY, { sched: true });
  assert.ok(/<span class="pj">プロジェクトなし<\/span><span class="t">[^<]*/.test(prio));
  const today = renderTodayTasks(d, "2026-10-19");
  assert.ok(today.includes('data-today="ZZ-0001"') && /<span class="pj">プロジェクトなし<\/span>/.test(today));
});

test("renderTaskPop: プロジェクトの選択欄に、プロジェクトなしと全プロジェクトが並び、現在値が選択済み", () => {
  const d = load();
  const h = renderTaskPop(d, { id: "AA-0004", x: 10, y: 10 }, "");
  assert.ok(h.includes('data-f="projectId" data-id="AA-0004"'));
  assert.ok(h.includes('<option value=""'));
  assert.ok(h.includes("プロジェクトなし"));
  for (const p of d.projects) assert.ok(h.includes(`<option value="${p.id}" ${p.id === "AA" ? "selected" : ""}>${p.name}</option>`));
  const x = renderTaskPop(d, { id: "ZZ-0001", x: 10, y: 10 }, "");
  assert.ok(x.includes('<option value="" selected>プロジェクトなし</option>'));
});

test("重要バッジ: 今日の優先は理由の欄に impbadge を 1 つ（重要度の文字は出さない）。今日のタスクは未完了の重要だけ、状態 pill の後に出す", () => {
  const d = load();
  const a = d.tasks.find((x) => x.id === "AA-0003"); a.important = true;
  const row = { html: [...renderPrio(d, TODAY, { sched: true }).matchAll(/<li[^>]*data-dragtask="AA-0003"[^>]*>[\s\S]*?<\/li>/g)].map((m) => m[0]).join("") };
  assert.ok(row.html, "AA-0003 が今日の優先にある");
  assert.equal(count(row.html, /impbadge/g), 1);
  assert.ok(/<span class="why">[^]*<span class="impbadge">重要<\/span>/.test(row.html), "why の中");
  assert.ok(!row.html.includes("重要度"));
  const { d: d2, done } = withToday();
  delete d2.tasks.find((x) => x.id === "AA-0007").important;
  d2.tasks.find((x) => x.id === "AA-0005").important = true;
  done.important = true;
  const rows = items(renderTodayTasks(d2, TODAY));
  assert.ok(/<span class="t">[^]*class="pill[^]*<\/span> ?<span class="impbadge">重要<\/span>/.test(rows.find((x) => x.id === "AA-0005").html), "pill の後");
  assert.ok(!rows.find((x) => x.id === done.id).html.includes("impbadge"), "Done には無い");
  assert.ok(!rows.find((x) => x.id === "AA-0007").html.includes("impbadge"), "重要でなければ無い");
});

test("renderCalendar: 重要で未完了のタスクの枠に imp、期限の行の件名に impt。Done には付けない", () => {
  const d = load();
  const A7 = d.tasks.find((t) => t.id === "AA-0007");
  A7.important = true;
  A7.due = TODAY;
  A7.sessions.push({ id: "S10", date: TODAY, start: "14:00", end: "15:00", kind: "planned" });
  const done = d.tasks.find((t) => t.status === "Done");
  done.important = true;
  done.sessions = [...(done.sessions ?? []), { id: "S11", date: TODAY, start: "09:30", end: "10:00", kind: "actual" }];
  for (const view of ["day", "week"]) {
    const html = renderSchedule(d, TODAY, { view, date: TODAY, now: NOW });
    const blk = (id) => html.match(new RegExp(`<div class="blk task [^"]*"[^>]*data-dragsess="${id}"`))[0];
    assert.match(blk("S10"), /class="blk task plan imp /, `${view}: 重要の枠は imp（予定の class は残る）`);
    assert.doesNotMatch(blk("S11"), /\bimp\b/, `${view}: Done の枠には付けない`);
    assert.match(html, /data-dragsess="S10"[^>]*><span class="tm">[^<]*<\/span><span class="ttl">/, `${view}: 件名は span.ttl に入り、時刻 .tm の外にある`);
  }
  const wk = renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW });
  assert.ok(wk.includes(`<span class="impt">${A7.title}</span>`), "期限の行の件名に impt");
});

test("日程変更の履歴: 原因の選択欄（data-logcause）は出さず、取り込み・依頼の原因は表示する", () => {
  const html = renderProjects(load(), TODAY, { filter: "AA", view: "list" });
  assert.ok(!html.includes("data-logcause"));
  assert.ok(html.includes("ベンダーX の納期回答が遅れたため"));
});

test("スケジュールの編集欄: 枠を選ぶと（selSess と taskEdit）編集欄が出る。「タスクを編集」のボタンは無い。編集欄は軽い欄だけ、full で全項目", () => {
  const d = load();
  d.tasks.find((t) => t.id === "AA-0007").sessions.push({ id: "S10", date: TODAY, start: "14:00", end: "15:00", kind: "planned" });
  const slot = (html) => html.match(/<div id="mtgslot">([\s\S]*?)<\/div><div id="calslot">/)[1];
  assert.ok(!sched(d, { selSess: "S10" }).includes("data-tedit-open") && !sched(d, { selSess: "S10" }).includes("タスクを編集"), "ボタンは無い");
  assert.ok(sched(d, { selSess: "S10" }).includes("「本番切替」の枠を削除"), "枠の削除のボタンは残る");
  assert.equal(slot(sched(d, { taskEdit: { id: "AA-0007", full: false } })), "", "枠を選んでいない（表示中の枠でない）ときは出さない");
  const light = slot(sched(d, { selSess: "S10", taskEdit: { id: "AA-0007", full: false } }));
  for (const f of ["title", "due", "start", "status", "important", "projectId", "memo"]) assert.ok(light.includes(`data-f="${f}" data-id="AA-0007"`), f);
  assert.ok(light.includes("data-tedit-full") && light.includes("data-tedit-close"));
  for (const x of ['data-f="repeat"', "data-addpre", "data-tedit-del", "data-ckadd"]) assert.ok(!light.includes(x), `軽い: ${x} なし`);
  const full = slot(sched(d, { selSess: "S10", taskEdit: { id: "AA-0007", full: true } }));
  for (const x of ['data-f="repeat"', 'data-tedit-del="AA-0007"', "前のタスク"]) assert.ok(full.includes(x), `full: ${x}`);
  assert.ok(!full.includes("data-dup"), "複製のボタンは持たない");
  assert.ok(/data-f="important" data-id="AA-0007"/.test(light));
  assert.equal(slot(sched(d, { selSess: "S10", taskEdit: { id: "ZZ", full: false } })), "", "対象のタスクが無いときは空");
  assert.equal(renderTaskEditPanel(d, { id: "ZZ", full: false }, ""), "");
});

/** 画面に見える文字だけ（タグと属性を除く）。data-id・aria-label などの属性の ID は、表示ではない */
const visibleText = (html) => html.replace(/<[^>]*>/g, " ");
const TASK_ID = /[A-Z]{2}-\d{4}/;

test("スケジュール画面: タスクの ID を表示しない（週・日の枠、選んだ枠の編集欄（詳細を開いた前のタスクも）、期限の行、削除のボタン、右の列の今日のタスク・今日の優先と確認）。属性の ID は残す", () => {
  const d = load();
  d.tasks.find((t) => t.id === "AA-0007").sessions.push({ id: "S10", date: TODAY, start: "14:00", end: "15:00", kind: "planned" });
  d.tasks.find((t) => t.id === "AA-0006").due = TODAY; // 期限の行に出す
  const pages = {
    week: renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW, selSess: "S10", taskEdit: { id: "AA-0007", full: true } }),
    day: sched(d, { selSess: "S10", taskEdit: { id: "AA-0007", full: true } }),
    dayLight: sched(d, { selSess: "S10", taskEdit: { id: "AA-0007", full: false } }),
    askDone: sched(d, { pendingDone: { id: "AA-0007", status: "Done", n: 1, future: ["S10"], open: [], stage: "future" } }),
    askDel: sched(d, { selSess: "S10", taskEdit: { id: "AA-0007", full: true, askDel: true } }),
  };
  for (const [k, html] of Object.entries(pages)) assert.ok(!TASK_ID.test(visibleText(html)), `${k}: ${visibleText(html).match(TASK_ID)?.[0]}`);
  assert.ok(pages.day.includes('data-id="AA-0007"') && pages.day.includes('data-dragtask="'), "属性の ID は残す");
  assert.ok(visibleText(pages.day).includes("本番切替") && visibleText(pages.week).includes("切替リハーサル"), "件名は出す");
});

test("ID の表示はガントとリストに残す（スケジュールだけ件名にする）", () => {
  const d = load();
  assert.ok(TASK_ID.test(visibleText(renderProjects(d, TODAY, { filter: "AA", view: "list" }))), "リスト");
  assert.ok(TASK_ID.test(visibleText(renderProjects(d, TODAY, { filter: "AA", view: "gantt" }))), "ガント");
  assert.ok(TASK_ID.test(visibleText(renderProjects(d, TODAY, { filter: "AA", view: "gantt", tpop: { id: "AA-0007", x: 0, y: 0 } }).match(/<div class="tpop"[\s\S]*?<\/div>/)[0])), "ガントの窓の見出し");
});

test("スケジュールの編集欄: 会議の入力欄と同じ、ラベル付きの項目が折り返して並ぶ（縦の枠 tp-f・tp-r を使わない）", () => {
  const d = load();
  const light = renderTaskEditPanel(d, { id: "AA-0007", full: false }, "<select>状態</select>");
  assert.ok(light.startsWith('<div class="mtgform tedit"'), "会議の入力欄と同じ .mtgform のまま");
  assert.ok(!/tp-r|tp-f/.test(light), "窓の縦の枠は使わない");
  for (const f of ["title", "due", "start", "projectId", "memo"]) assert.ok(new RegExp(`<label[^>]*><span>[^<]+</span>[^]*?data-f="${f}" data-id="AA-0007"`).test(light), `${f} はラベル付き`);
  assert.ok(/<label class="chk"><input type="checkbox" data-f="important" data-id="AA-0007"[^>]*>重要<\/label>/.test(light), "重要は label.chk");
  assert.ok(light.includes('<div class="tp-st"><span>状態</span><div><select>状態</select></div></div>'), "状態の欄");
  assert.ok(/<div class="tp-a"><button class="btn" data-tedit-full[^>]*>詳細を開く<\/button><button class="btn" data-tedit-close>閉じる<\/button><\/div>/.test(light), "末尾のボタンの行は、詳細を開く・閉じる");
  const full = renderTaskEditPanel(d, { id: "AA-0007", full: true }, "");
  assert.ok(/<div class="tedit-detail">.*<div class="tp-a"><button class="btn danger" data-tedit-del="AA-0007">削除<\/button><\/div>/.test(full.replace(/\n/g, "")), "full: 削除は、詳細の入れ物の中のボタンの行");
  assert.ok(/data-f="repeat" data-id="AA-0007"/.test(full) && full.includes('class="tp-wide"') && full.includes("data-ckbox=\"AA-0007\""), "full: 繰り返し・前のタスク・チェックリスト");
  assert.ok(full.indexOf('class="tp-a"') < full.indexOf("data-ckbox"), "全幅の編集欄はボタンの行のあと");
});

test("スケジュールの編集欄: 詳細の開閉で、軽い欄（件名〜メモ・詳細の開閉・閉じる）のマークアップは変わらない。詳細の項目は、そのあとの別の入れ物（.tedit-detail）に出る", () => {
  const d = load();
  const light = renderTaskEditPanel(d, { id: "AA-0007", full: false }, "<select>状態</select>");
  const full = renderTaskEditPanel(d, { id: "AA-0007", full: true }, "<select>状態</select>");
  assert.ok(!light.includes("tedit-detail"), "軽い欄には詳細の入れ物は無い");
  const at = full.indexOf('<div class="tedit-detail">');
  assert.ok(at > full.indexOf("data-tedit-close"), "詳細の入れ物は、軽い欄とボタンの行のあと");
  const lightRow = light.slice(0, light.lastIndexOf("\n  </div>"));
  const fullRow = full.slice(0, at).trimEnd().replace('aria-expanded="true">詳細を閉じる', 'aria-expanded="false">詳細を開く');
  assert.equal(fullRow, lightRow, "軽い欄は、ボタンの文字と aria-expanded のほかは同じ");
  const detail = full.slice(at);
  for (const x of ['data-f="repeat" data-id="AA-0007"', 'data-tedit-del="AA-0007"', 'data-ckbox="AA-0007"', 'class="tp-wide"', "前のタスク"]) assert.ok(detail.includes(x), `詳細: ${x}`);
  const ask = renderTaskEditPanel(d, { id: "AA-0007", full: true, askDel: true }, "<select>状態</select>");
  assert.ok(ask.slice(ask.indexOf('<div class="tedit-detail">')).includes('data-delyes="AA-0007"'), "削除の確認も詳細の入れ物の中");
});

test("renderTaskPop: 窓は縦の枠（tp-f・tp-r）のまま。編集欄の横並びの変更で変わらない", () => {
  const h = renderTaskPop(load(), { id: "AA-0007", x: 1, y: 2 }, "");
  assert.ok(h.includes('class="tp-f"') && h.includes('class="tp-r"') && h.includes("data-tpopclose") && !h.includes("tp-st") && !h.includes("tp-wide"));
});

test("スケジュールの編集欄: 削除は確認を挟む（askDel）", () => {
  const d = load();
  const html = renderTaskEditPanel(d, { id: "AA-0007", full: true, askDel: true }, "");
  assert.ok(html.includes('data-delyes="AA-0007"') && html.includes("data-tedit-delno") && !html.includes("data-tedit-del="));
});

test("リスト: 各行に「プロジェクト」の選択欄。現在のプロジェクト（なしは空の値）が selected。見出しにも出る", () => {
  const d = load();
  const sel = (html, id) => html.match(new RegExp(`<select class="in sm" data-f="projectId" data-id="${id}"[^>]*>(.*?)</select>`))?.[1];
  const a = renderProjects(d, TODAY, { view: "list", filter: "AA" });
  assert.ok(a.includes("<th>プロジェクト</th>") && a.includes('<td data-l="プロジェクト">'));
  assert.ok(a.indexOf("<th>件名</th><th>プロジェクト</th>") > 0, "件名の列の後ろ");
  assert.ok(a.includes('aria-label="AA-0001 のプロジェクト"'));
  assert.match(sel(a, "AA-0001"), /<option value="">プロジェクトなし<\/option>/);
  assert.match(sel(a, "AA-0001"), /<option value="AA" selected>/);
  for (const p of d.projects) assert.ok(sel(a, "AA-0001").includes(`value="${p.id}"`), p.id);
  const x = renderProjects(d, TODAY, { view: "list", filter: "none" });
  assert.match(sel(x, "ZZ-0001"), /<option value="" selected>プロジェクトなし<\/option>/);
});

test("バナー: 共有に無いタスクの作業枠があれば、注意の文と data-orphan-clear が出る。無ければ出ない", () => {
  const d = load();
  d.orphanSessions = [{ id: "SX1", taskId: "ZZ9", date: TODAY, start: "13:00", end: "14:00", kind: "planned" }];
  const msg = `注意: ${validate(d, NOW).warnings.join(" / ")}`;
  const html = bannerHtml(msg, {}, 1, false);
  assert.ok(html.includes("共有ファイルに無いタスクの作業枠が 1 件あります"));
  assert.ok(html.includes("data-orphan-clear"));
  assert.ok(!html.includes("data-orphan-ok"));
  const ask = bannerHtml(msg, {}, 1, true);
  assert.ok(ask.includes("1 件の作業枠を削除します。タスクが戻っていないか、少し待ってから確認してください"));
  assert.ok(ask.includes("data-orphan-ok") && ask.includes("data-orphan-cancel") && !ask.includes("data-orphan-clear"));
  assert.ok(!bannerHtml("注意: 別の警告", {}, 0, false).includes("data-orphan"));
  assert.ok(bannerHtml("読み直せません: x", { reload: true }, 1, false).includes("data-reload"), "ほかのボタンは従来どおり");
  assert.equal(bannerHtml("", {}, 0, false), "");
});

test("orphanSessions の枠は、カレンダー・優先度・稼働に描かない", () => {
  const base = load();
  const d = load();
  d.orphanSessions = [{ id: "SX1", taskId: "ZZ9", date: TODAY, start: "13:00", end: "14:00", kind: "planned" }];
  assert.equal(renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW }), renderSchedule(base, TODAY, { view: "day", date: TODAY, now: NOW }));
  assert.ok(!renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW }).includes("SX1"));
  assert.equal(renderPrio(d, TODAY, { now: NOW }), renderPrio(base, TODAY, { now: NOW }));
  assert.equal(renderWorkload(d, TODAY, { now: NOW }), renderWorkload(base, TODAY, { now: NOW }));
});

test("renderTaskEditPanel: スケジュールの編集欄は、開始の欄が期限の欄より前。ガントの窓（renderTaskPop）も開始が先", () => {
  const d = load();
  const p = renderTaskEditPanel(d, { id: "AA-0005", full: false }, "");
  assert.ok(p.indexOf('data-f="start"') > 0 && p.indexOf('data-f="start"') < p.indexOf('data-f="due"'), "編集欄");
  assert.ok(p.indexOf("<span>開始</span>") < p.indexOf("<span>期限</span>"));
  const w = renderTaskPop(d, { id: "AA-0005", x: 0, y: 0 }, "");
  assert.ok(w.indexOf('data-f="start"') < w.indexOf('data-f="due"'), "窓");
});

test("sessionBlocks・meetingBlocks: 30 分未満の枠と会議には short（時刻と件名を 1 行に）。30 分以上には付けない", () => {
  const d = load();
  d.tasks.find((t) => t.id === "AA-0004").sessions = [{ id: "S70", date: TODAY, start: "08:00", end: "08:15", kind: "planned" }, { id: "S71", date: TODAY, start: "11:00", end: "11:30", kind: "planned" }];
  d.events.push({ id: "m9", date: TODAY, start: "16:00", end: "16:15", title: "短い会議", source: "manual", skip: false, externalId: null, confirmed: false, projectId: null });
  for (const view of ["day", "week"]) {
    const html = renderSchedule(d, TODAY, { view, date: TODAY, now: NOW, showPrio: false });
    const tag = (attr) => html.match(new RegExp(`<div class="blk[^"]*"[^>]*${attr}`))[0];
    assert.ok(/\bshort\b/.test(tag('data-dragsess="S70"')), view);
    assert.ok(!/\bshort\b/.test(tag('data-dragsess="S71"')), view);
    assert.ok(/\bshort\b/.test(tag('data-mtg="m9"')), view);
  }
});

test("renderSchedule: 操作の行（← → 今日・見出し・凡例・ボタン）とサマリーを 1 つの箱（.stop）にまとめ、入力欄（#mtgslot）の前に置く（固定表示の 1 段）", () => {
  for (const view of ["day", "week"]) {
    const html = renderSchedule(load(), TODAY, { view, date: TODAY, now: NOW });
    const top = html.slice(html.indexOf('<div class="stop">'), html.indexOf('<div id="mtgslot">'));
    assert.ok(html.indexOf('<div class="stop">') > 0, view);
    for (const k of ["data-nav", "data-sgoto", 'class="slegend"', "data-sskip", "data-mtgadd", "data-sview", 'class="summary"', "data-delsel"]) assert.ok(top.includes(k), `${view}: ${k}`);
  }
});

test("dateInputHtml: 文字の欄（type=text・data-date）に値と例（2026/10/20）を入れ、横に「📅」（data-datepick）と、選ぶための隠れた日付の欄（.dpick-in）を置く。disabled はボタンにも付く", () => {
  const h = dateInputHtml({ value: "2026-10-20", attrs: 'data-f="due" data-id="A&1"', label: "期限" });
  assert.ok(h.includes('<input class="in din" type="text" inputmode="numeric" autocomplete="off" data-date="1" data-f="due" data-id="A&1" value="2026-10-20" placeholder="2026/10/20">'), h);
  assert.ok(h.includes('data-datepick') && h.includes('aria-label="期限をカレンダーから選ぶ"') && h.includes(">📅</button>"), h);
  assert.ok(/<input type="date" class="dpick-in" tabindex="-1" aria-hidden="true">/.test(h), h);
  const off = dateInputHtml({ value: "", attrs: "disabled", cls: "in sm" });
  assert.ok(off.includes('class="in sm din"') && /data-datepick[^>]*disabled/.test(off), off);
});

test("日付の欄は、すべて文字の欄（data-date）と「📅」。見えている type=date の欄は持たない（リスト・ガントの窓・スケジュールの編集欄・会議・突発タスク・プロジェクト・マイルストーン・回答予定日・設定の休み・営業日）", () => {
  const d = load();
  d.tasks.find((t) => t.id === "AA-0003").waitingOn.expected = "2026-10-30";
  const pages = {
    list: renderProjects(d, TODAY, { filter: "AA", view: "list" }),
    pop: renderProjects(d, TODAY, { filter: "AA", view: "gantt", tpop: { id: "AA-0005", x: 0, y: 0 } }),
    panel: renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW, selSess: "S3", taskEdit: { id: "AA-0005", full: true } }),
    mtg: sched(d, { selMtg: "m2" }),
    urgent: sched(d, { urgentDraft: { date: TODAY, start: "10:15", title: "", projectId: "", minutes: 30 } }),
    settings: setv(d),
  };
  const want = { list: ['data-f="due"', 'data-f="start"', 'data-f="expected"', 'data-pf="start"', 'data-pf="due"', 'data-mf="date"'], pop: ['data-f="due"', 'data-f="start"'], panel: ['data-f="due"', 'data-f="start"'], mtg: ['data-mt="date"'], urgent: ['data-ug="date"'], settings: ["data-hnew", "data-hto", "data-wnew"] };
  for (const [k, html] of Object.entries(pages)) {
    const typeDate = html.match(/<input[^>]*type="date"[^>]*>/g) ?? [];
    assert.ok(typeDate.every((x) => x.includes('class="dpick-in"')), `${k}: ${typeDate.join(" ")}`);
    for (const a of want[k]) assert.ok(new RegExp(`data-date="1" ${a}`).test(html), `${k}: ${a}`);
    assert.equal((html.match(/data-date="1"/g) ?? []).length, (html.match(/data-datepick/g) ?? []).length, k);
  }
});

test("revealSelection: 選んだ枠を見える位置へ出すのは、枠の選択・編集欄（タスク・詳細の開閉・削除の確認）が、この描き直しで変わったときだけ。同じ選択のままの描き直し（読み直し・欄の保存）では出さない", () => {
  const k = (s, e) => selectionKey(s, e);
  assert.equal(k(null, null), null);
  assert.equal(revealSelection(null, k("S1", { id: "A", full: false })), true, "選んだ");
  assert.equal(revealSelection(k("S1", { id: "A", full: false }), k("S1", { id: "A", full: false })), false, "同じ選択のまま");
  assert.equal(revealSelection(k("S1", { id: "A", full: false }), k("S1", { id: "A", full: true })), true, "詳細を開いた");
  assert.equal(revealSelection(k("S1", { id: "A", full: true }), k("S1", { id: "A", full: true, askDel: true })), true, "削除の確認");
  assert.equal(revealSelection(k("S1", { id: "A" }), k("S2", { id: "A" })), true, "別の枠");
  assert.equal(revealSelection(k("S1", { id: "A" }), null), false, "外した");
});

test("renderSchedule: 予定の枠と時間が重なる実績の枠は、予定を左半分・実績を右半分に並べる。重ならない枠は左右を指定しない（週・日）", () => {
  const d = load();
  d.tasks.find((t) => t.id === "AA-0005").sessions.push({ id: "S21", date: TODAY, start: "10:00", end: "11:00", kind: "planned" }, { id: "S23", date: TODAY, start: "14:00", end: "15:00", kind: "planned" });
  d.tasks.find((t) => t.id === "AA-0004").sessions = [{ id: "S22", date: TODAY, start: "10:00", end: "10:40", kind: "actual" }, { id: "S24", date: TODAY, start: "16:00", end: "17:00", kind: "actual" }];
  const blk = (html, id) => new RegExp(`<div class="blk task[^"]*"[^>]*data-dragsess="${id}" style="([^"]*)"`).exec(html)?.[1];
  for (const view of ["week", "day"]) {
    const html = renderSchedule(d, TODAY, { view, date: TODAY, now: NOW });
    assert.match(blk(html, "S21"), /left:0;width:50%/, `${view} 予定は左半分`);
    assert.match(blk(html, "S22"), /left:50%;width:50%/, `${view} 実績は右半分`);
    assert.ok(!/left:|width:/.test(blk(html, "S23")), `${view} 重ならない予定は全幅`);
    assert.ok(!/left:|width:/.test(blk(html, "S24")), `${view} 重ならない実績は全幅`);
  }
});

// 予定の枠の実績（actual）。sample の S8（AC-0001、2026-10-15 の予定 09:00–10:00、実績 09:10–10:10）
const S8_DAY = "2026-10-15";
const s8 = (d) => d.tasks.find((t) => t.id === "AC-0001").sessions.find((s) => s.id === "S8");
const tagOf = (html, attr) => html.match(new RegExp(`<div class="blk task[^"]*"[^>]*${attr}[^>]*>`))?.[0] ?? "";
const styleOf = (tag) => /style="([^"]*)"/.exec(tag)?.[1] ?? "";
const countOf = (html, attr) => (html.match(new RegExp(attr, "g")) ?? []).length;
/** 週表示の 1 日の列の中身 */
const colOf = (html, day) => html.match(new RegExp(`<div class="col dz[^"]*" data-date="${day}">[^]*?(?=<div class="col dz|$)`))?.[0] ?? "";
/** 属性 attr を持つブロック 1 つ（閉じタグまで） */
const blkOf = (html, attr) => new RegExp(`<div class="blk[^>]*${attr}[^]*?</div>`).exec(html)?.[0] ?? "";

test("renderCalendar: 実績を持つ予定の枠は、実績のブロック（data-actbar）が 1 つだけ出て、予定の枠を示す data-dragsess は出ない。影（data-ghost）は、予定と実績の時刻（または日付）が違うときだけ出る", () => {
  const d = load(); // S8 はそのまま（予定 09:00–10:00、実績 09:10–10:10 で同じ日）
  const g = calendarGeometry();
  for (const view of ["week", "day"]) {
    const html = renderCalendar(d, TODAY, { view, date: S8_DAY, now: NOW });
    assert.equal(countOf(html, 'data-actbar="S8"'), 1, `${view}: 実績のブロックは 1 つ`);
    assert.ok(!html.includes('data-dragsess="S8"'), `${view}: 予定のブロックは出ない`);
    assert.equal(countOf(html, 'data-ghost="S8"'), 1, `${view}: 時刻が違うので影が 1 つ`);
    const gh = tagOf(html, 'data-ghost="S8"');
    assert.ok(/class="blk task pghost[ "]/.test(gh), gh);
    assert.equal(styleOf(gh), `top:${g.tp(9 * 60)};height:${g.ht(9 * 60, 10 * 60)}`, `${view}: 影は予定の時刻・全幅`);
    assert.equal(styleOf(tagOf(html, 'data-actbar="S8"')), `top:${g.tp(9 * 60 + 10)};height:${g.ht(9 * 60 + 10, 10 * 60 + 10)}`, `${view}: 実績のブロックは、自分の影と重なっても全幅`);
    assert.ok(html.indexOf('data-ghost="S8"') < html.indexOf('data-actbar="S8"'), `${view}: 影は実績のブロックのうしろ（先に描く）`);
  }
  s8(d).actual = { date: S8_DAY, start: "09:00", end: "10:00" }; // 予定と同じ日・同じ時刻
  for (const view of ["week", "day"]) {
    const html = renderCalendar(d, TODAY, { view, date: S8_DAY, now: NOW });
    assert.ok(html.includes('data-actbar="S8"') && !html.includes('data-ghost="S8"') && !html.includes('data-dragsess="S8"') && !html.includes('class="pl"'), `${view}: 同じなら影も、予定の時刻の文字も出ない`);
  }
  s8(d).actual = { date: "2026-10-16", start: "09:00", end: "10:00" }; // 時刻は同じで、日付が違う
  assert.ok(renderCalendar(d, TODAY, { view: "week", date: S8_DAY, now: NOW }).includes('data-ghost="S8"'), "日付が違えば影が出る");
});

test("renderCalendar: 影は draggable でなく、data-rz を持たない。実績のブロックも、draggable・data-rz が無い。文字は「実績 HH:MM-HH:MM ✓」で、予定の時刻は title に添える", () => {
  const d = load();
  s8(d).actual = { date: S8_DAY, start: "13:00", end: "14:00" };
  const g = calendarGeometry();
  for (const view of ["week", "day"]) {
    const html = renderCalendar(d, TODAY, { view, date: S8_DAY, now: NOW });
    const bar = tagOf(html, 'data-actbar="S8"'), gh = blkOf(html, 'data-ghost="S8"');
    assert.ok(/class="blk task act[ "]/.test(bar), bar);
    assert.ok(!bar.includes("draggable") && !bar.includes("data-dragsess"), `${view}: 実績のブロックはドラッグできない ${bar}`);
    assert.ok(!blkOf(html, 'data-actbar="S8"').includes("data-rz"), `${view}: 実績のブロックに取っ手は無い`);
    assert.ok(gh && !gh.includes("draggable") && !gh.includes("data-rz") && !gh.includes("data-dragsess"), `${view}: 影はドラッグ・伸縮できない ${gh}`);
    assert.equal(styleOf(bar), `top:${g.tp(13 * 60)};height:${g.ht(13 * 60, 14 * 60)}`, `${view}: 実績の時刻の位置・重ならないので全幅`);
    assert.ok(/data-actbar="S8"[^>]*><span class="tm">実績 13:00-14:00 ✓<\/span>/.test(html), `${view}: 文字は実績の時刻と ✓`);
    assert.match(bar, /title="ログの収集\(実績\) 予定 10\/15 09:00-10:00"/, `${view}: title に予定の時刻`);
    assert.ok(blkOf(html, 'data-actbar="S8"').includes('<span class="pl">予定 10/15 09:00-10:00</span>'), `${view}: 1 時間以上のブロックには、予定の時刻を小さな文字で添える`);
    assert.ok(!/\bunconf\b/.test(bar) && !/\bunconf\b/.test(gh), `${view}: 過ぎていても未確認にしない`);
  }
  delete s8(d).actual;
  assert.ok(/\bunconf\b/.test(tagOf(renderCalendar(d, TODAY, { view: "day", date: S8_DAY, now: NOW }), 'data-dragsess="S8"')), "actual が無ければ未確認");
});

test("renderCalendar: 実績が予定と別の日: 実績のブロックは actual.date の列、影は予定の日付の列", () => {
  const d = load();
  s8(d).actual = { date: "2026-10-16", start: "13:00", end: "14:00" };
  const html = renderCalendar(d, TODAY, { view: "week", date: S8_DAY, now: NOW });
  assert.ok(colOf(html, "2026-10-16").includes('data-actbar="S8"') && !colOf(html, S8_DAY).includes('data-actbar="S8"'));
  assert.ok(colOf(html, S8_DAY).includes('data-ghost="S8"') && !colOf(html, "2026-10-16").includes('data-ghost="S8"'));
  assert.ok(!html.includes('data-dragsess="S8"'));
  assert.ok(renderCalendar(d, TODAY, { view: "day", date: S8_DAY, now: NOW }).includes('data-ghost="S8"') && !renderCalendar(d, TODAY, { view: "day", date: S8_DAY, now: NOW }).includes('data-actbar="S8"'), "日表示: 予定の日は影だけ");
  assert.ok(!renderCalendar(d, TODAY, { view: "day", date: "2026-10-16", now: NOW }).includes('data-ghost="S8"'), "日表示: 実績の日は実績のブロックだけ");
});

test("renderCalendar: 表示範囲に実績の日だけが入る週・予定の日だけが入る週で、例外にならず、描ける方だけ描く", () => {
  const d = load();
  s8(d).actual = { date: TODAY, start: "08:00", end: "09:00" }; // 予定は 10/15（前の週）
  for (const view of ["week", "day"]) {
    const html = renderCalendar(d, TODAY, { view, date: TODAY, now: NOW });
    assert.ok(html.includes('data-actbar="S8"') && !html.includes('data-dragsess="S8"') && !html.includes('data-ghost="S8"'), `${view}: 実績の日だけ`);
    const pl = renderCalendar(d, TODAY, { view, date: S8_DAY, now: NOW });
    assert.ok(pl.includes('data-ghost="S8"') && !pl.includes('data-actbar="S8"') && !pl.includes('data-dragsess="S8"'), `${view}: 予定の日だけ`);
  }
  // 選んだ枠の入力欄は、予定の枠が表示範囲外でも出る（初期値は実績の値）
  const sel = renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW, selSess: "S8", taskEdit: { id: "AC-0001", full: false, askDel: false } });
  assert.ok(sel.includes('data-actsave="S8"') && sel.includes('data-actclear="S8"'), "実績の入力欄");
  assert.ok(sel.includes('data-ac="start" value="08:00"') && sel.includes('data-ac="end" value="09:00"'));
  assert.ok(/class="blk task act[^"]*sel[^"]*"[^>]*data-actbar="S8"/.test(sel), "実績のブロックが選択中");
  assert.ok(sel.includes("「ログの収集」の枠を削除"));
});

test("renderCalendar: 実績を持たない予定の枠が、実績のブロックと重なると、今までどおり左右に割る。実績を持つ枠の影は、割りに影響しない", () => {
  const d = load(); // S8: 予定 09:00–10:00（影）、実績 09:10–10:10
  d.tasks.find((t) => t.id === "AA-0005").sessions.push(
    { id: "S31", date: S8_DAY, start: "08:00", end: "09:05", kind: "planned" }, // 影とだけ重なる
    { id: "S32", date: S8_DAY, start: "10:00", end: "11:00", kind: "planned" }, // 実績のブロックと重なる
  );
  for (const view of ["week", "day"]) {
    const html = renderCalendar(d, TODAY, { view, date: S8_DAY, now: NOW });
    assert.ok(!/left:|width:/.test(styleOf(tagOf(html, 'data-dragsess="S31"'))), `${view}: 影とだけ重なる予定は全幅`);
    assert.match(styleOf(tagOf(html, 'data-dragsess="S32"')), /;left:0;width:50%$/, `${view}: 予定は左半分`);
    assert.match(styleOf(tagOf(html, 'data-actbar="S8"')), /;left:50%;width:50%$/, `${view}: 実績は右半分`);
    assert.ok(!/left:|width:/.test(styleOf(tagOf(html, 'data-ghost="S8"'))), `${view}: 影は割らない`);
  }
});

test("renderCalendar: 実績を持たない予定の枠・実績だけの枠・実績を持たない会議は、変更前と同じ属性（data-dragsess・draggable・data-dragmtg・取っ手）で出る", () => {
  const d = load();
  const same = {
    S3: ["2026-10-21", '<div class="blk task plan " draggable="true" tabindex="0" data-dragsess="S3" style="top:58.333%;height:calc(8.333% - 2px)" title="切替手順書の作成(予定)"><span class="tm">14:00-16:00</span><span class="ttl">切替手順書の作成</span><i class="rz" data-rz="S3" aria-label="終了時刻を変更"></i></div>', 'data-dragsess="S3"'],
    S2: ["2026-10-19", '<div class="blk task act " draggable="true" tabindex="0" data-dragsess="S2" style="top:41.667%;height:calc(6.250% - 2px)" title="切替手順書の作成(実績)"><span class="tm">10:00-11:30 ✓</span><span class="ttl">切替手順書の作成</span><i class="rz" data-rz="S2" aria-label="終了時刻を変更"></i></div>', 'data-dragsess="S2"'],
    m2: [TODAY, '<div class="blk mtg   " data-mtg="m2" tabindex="0" draggable="true" data-dragmtg="m2" style="top:54.167%;height:calc(4.167% - 2px)" title="ベンダーX 打合せ"><span class="tm">13:00-14:00</span>ベンダーX 打合せ<i class="rz" data-rzm="m2" aria-label="終了時刻を変更"></i></div>', 'data-mtg="m2"'],
    m3: ["2026-10-21", '<div class="blk mtg   " data-mtg="m3" tabindex="0"  style="top:41.667%;height:calc(4.167% - 2px)" title="部内会議(予定表から取得)"><span class="tm">10:00-11:00</span>部内会議</div>', 'data-mtg="m3"'],
  };
  for (const [id, [date, want, attr]] of Object.entries(same)) assert.equal(blkOf(renderCalendar(d, TODAY, { view: "week", date, now: NOW }), attr), want, id);
});

test("renderSchedule: サマリーの実績の時間が、actual.date の日で数えられる", () => {
  const hours = (d, date) => +/実績 <b class="mono">([\d.]+)時間<\/b>/.exec(renderSchedule(d, TODAY, { view: "week", date, now: NOW }))[1];
  const plans = (d, date) => +/予定 <b class="mono">(\d+)件<\/b>/.exec(renderSchedule(d, TODAY, { view: "week", date, now: NOW }))[1];
  const d = load();
  const without = load(); delete s8(without).actual;
  const base = { prev: hours(without, S8_DAY), cur: hours(without, TODAY) };
  assert.equal(hours(d, S8_DAY), base.prev + 1, "S8 の実績 1.0 時間（予定の 10/15 の週）");
  s8(d).actual = { date: TODAY, start: "08:00", end: "09:30" };
  assert.equal(hours(d, S8_DAY), base.prev, "実績を別の週へ移すと、予定の週からは消える");
  assert.equal(hours(d, TODAY), base.cur + 1.5, "actual.date の週で数える");
  assert.equal(plans(d, TODAY), plans(without, TODAY), "予定の件数は、予定の日付で数える（実績だけが範囲内の枠は数えない）");
  assert.equal(plans(d, S8_DAY), plans(without, S8_DAY), "過ぎた予定は予定の件数に入らない（今のまま）");
});

test("今日のタスクの札: actual を持つ枠は「実績」の札と実績の時刻と、予定の時刻", () => {
  const d = load();
  Object.assign(s8(d), { date: TODAY, actual: { date: TODAY, start: "09:10", end: "10:10" } });
  const row = items(renderTodayTasks(d, TODAY, { now: NOW })).find((x) => x.id === "AC-0001").html;
  assert.ok(row.includes('<span class="ktag act">実績</span>09:10–10:10<small class="muted">予定 09:00–10:00</small>'), row);
});

test("sessionSelection: 実績のブロックの枠 ID（予定の枠の ID）でも、その枠が選ばれる", () => {
  assert.deepEqual(sessionSelection(load(), "S8", null), { selSess: "S8", taskEdit: { id: "AC-0001", full: false, askDel: false } });
});

test("sessionSelection: タスクの枠は選択と編集欄（full を引き継ぐ）。無い枠・null は両方外す", () => {
  const d = load();
  assert.deepEqual(sessionSelection(d, "S2", { id: "X", full: true, askDel: true }), { selSess: "S2", taskEdit: { id: "AA-0005", full: true, askDel: false } });
  assert.deepEqual(sessionSelection(d, "S999", null), { selSess: null, taskEdit: null });
  assert.deepEqual(sessionSelection(d, null, null), { selSess: null, taskEdit: null });
});

/* ---------- ToDo タブ（今週のタスク） ---------- */
const TD_WEEK = "2026-10-19";
const TD_NOW = { date: TODAY, time: "10:20" };
const tdTask = (id, o = {}) => ({ id, title: id, projectId: "PX", status: "To Do", due: null, predecessors: [], sessions: [], ...o });
// AA-0001 期限超過（チェック 1/2）・AA-0002 今週に予定あり（未来の予定の枠 2 件・実績 30 分）・AA-0003 今週の期限（前のタスク待ち）・AA-0004 完了・AA-0005 Cancelled
const tdData = (reviews) => ({
  projects: [{ id: "PX", name: "案件X" }], events: [], settings: {}, ...(reviews && { reviews }),
  tasks: [
    tdTask("AA-0001", { title: "超過のタスク", due: "2026-10-15", checklist: [{ id: "c1", text: "一", done: true }, { id: "c2", text: "二", done: false }] }),
    tdTask("AA-0002", { title: "予定のタスク", status: "In Progress", due: "2026-11-10", sessions: [
      { id: "S1", date: "2026-10-21", start: "13:00", end: "14:00", kind: "planned" },
      { id: "S2", date: TODAY, start: "15:00", end: "16:00", kind: "planned" },
      { id: "S3", date: TD_WEEK, start: "09:00", end: "09:30", kind: "actual" },
    ] }),
    tdTask("AA-0003", { title: "期限のタスク", due: "2026-10-23", predecessors: ["AA-0001"] }),
    tdTask("AA-0004", { title: "済みのタスク", status: "Done", due: TD_WEEK, doneAt: TD_WEEK }),
    tdTask("AA-0005", { title: "中止のタスク", status: "Cancelled", due: "2026-10-21" }),
  ],
});
const tdHtml = (d, o = {}) => renderTodo(d, TODAY, { week: TD_WEEK, now: TD_NOW, open: null, draft: null, ...o });
const tdRow = (html, id) => html.match(new RegExp(`<li[^>]*data-tdrow="${id}"[^]*?</li>`))?.[0] ?? "";
const tdList = (html) => html.slice(0, html.indexOf('class="tdreview'));

test("renderTodo: 一覧に、組の見出し（期限超過・今週に予定あり・今週の期限・完了）の順で、件名・プロジェクト名・状態・期限・進捗・予定と実績の分が出る。Cancelled と ID は出ない", () => {
  const html = tdHtml(tdData()), list = tdList(html);
  const heads = ["期限超過", "今週に予定あり", "今週の期限", "完了"].map((h) => list.indexOf(`<h3>${h}</h3>`));
  assert.ok(heads.every((i) => i >= 0) && heads.every((x, i) => i === 0 || heads[i - 1] < x), heads.join(","));
  const r1 = tdRow(html, "AA-0001"), r2 = tdRow(html, "AA-0002");
  for (const s of ["超過のタスク", "案件X", "To Do", "10/15", "1/2"]) assert.ok(r1.includes(s), s);
  for (const s of ["予定のタスク", "In Progress", "11/10", "予定 <b class=\"mono\">120</b> 分", "実績 <b class=\"mono\">30</b> 分"]) assert.ok(r2.includes(s), `${s}: ${r2}`);
  assert.ok(tdRow(html, "AA-0004").includes("Done"));
  assert.ok(!html.includes("中止のタスク"), "Cancelled は出ない");
  assert.ok(!TASK_ID.test(visibleText(html)), visibleText(html).match(TASK_ID)?.[0]);
  assert.ok(!TASK_ID.test(visibleText(tdHtml(tdData(), { open: "AA-0001" }))), "入力欄にも ID は出ない");
});

test("renderTodo: 前のタスク待ちの行に「前のタスク待ち」。完了していない行に「完了」ボタン（data-tdopen）、完了した行には出ない", () => {
  const html = tdHtml(tdData());
  assert.ok(tdRow(html, "AA-0003").includes("前のタスク待ち"));
  assert.ok(!tdRow(html, "AA-0001").includes("前のタスク待ち"));
  for (const id of ["AA-0001", "AA-0002", "AA-0003"]) assert.ok(tdRow(html, id).includes(`data-tdopen="${id}"`), id);
  assert.ok(!tdRow(html, "AA-0004").includes("data-tdopen"));
});

test("renderTodo: open の行に完了の入力欄（日付・開始・終了・状態（初期値 Done・Waiting なし）・チェックリストと「残りをすべてチェック」・保存・キャンセル）。ほかの行には出ない", () => {
  const html = tdHtml(tdData(), { open: "AA-0001" }), f = tdRow(html, "AA-0001");
  assert.match(f, /data-tf="date" value="2026-10-20"/, "今日が表示中の週にあれば今日");
  assert.match(f, /data-tf="start" value=""/, "予定の枠が無ければ空");
  assert.match(f, /data-tf="end" value=""/);
  const opts = [...f.matchAll(/<option value="([^"]+)"( selected)?/g)].map((m) => m[1] + (m[2] ? "*" : ""));
  assert.deepEqual(opts, ["To Do", "In Progress", "Done*", "Cancelled"]);
  assert.match(f, /<input type="checkbox" data-tfck="c1" checked/);
  assert.match(f, /<input type="checkbox" data-tfck="c2"(?! checked)/);
  for (const a of ["data-tdckall", 'data-tdsave="AA-0001"', "data-tdcancel", "残りをすべてチェック", "保存", "キャンセル"]) assert.ok(f.includes(a), a);
  assert.ok(!f.includes("未来の予定の枠"), "解除される枠が無ければ、注意は出ない");
  assert.ok(!tdRow(html, "AA-0002").includes("data-tf="), "開いていない行");
  assert.ok(!tdRow(tdHtml(tdData()), "AA-0001").includes("data-tf="), "open が null");
});

test("renderTodo: 入力欄の時刻は、その日のそのタスクの、始まった予定の枠（actual なし）。始まっていなければ空。未来の予定の枠があれば解除の注意（件数）。今日が週の外なら、日付は週の月曜日", () => {
  const f = tdRow(tdHtml(tdData(), { open: "AA-0002" }), "AA-0002"); // 10:20。S2（15:00–16:00）はまだ始まっていない
  assert.match(f, /data-tf="start" value=""/);
  assert.match(f, /data-tf="end" value=""/);
  assert.ok(f.includes("未来の予定の枠 2 件"), f);
  const g = tdRow(tdHtml(tdData(), { open: "AA-0002", now: { date: TODAY, time: "15:00" } }), "AA-0002"); // 開始ちょうどは始まった枠
  assert.match(g, /data-tf="start" value="15:00"/);
  assert.match(g, /data-tf="end" value="16:00"/);
  assert.ok(g.includes("未来の予定の枠 1 件"), g);
  assert.ok(!f.includes("data-tdckall"), "チェックリストが無ければ、ボタンも無い");
  const next = tdRow(tdHtml(tdData(), { week: "2026-10-26", open: "AA-0001" }), "AA-0001");
  assert.match(next, /data-tf="date" value="2026-10-26"/);
});

test("renderTodo: draft（key が同じ）があれば、入力欄がその値になる", () => {
  const draft = { key: "AA-0001", date: "2026-10-21", start: "09:00", end: "10:00", status: "In Progress", checks: { c1: false, c2: true } };
  const f = tdRow(tdHtml(tdData(), { open: "AA-0001", draft }), "AA-0001");
  assert.match(f, /data-tf="date" value="2026-10-21"/);
  assert.match(f, /data-tf="start" value="09:00"/);
  assert.match(f, /data-tf="end" value="10:00"/);
  assert.match(f, /<option value="In Progress" selected>/);
  assert.ok(!/<option value="Done" selected>/.test(f));
  assert.match(f, /<input type="checkbox" data-tfck="c1"(?! checked)/);
  assert.match(f, /<input type="checkbox" data-tfck="c2" checked/);
  const other = tdRow(tdHtml(tdData(), { open: "AA-0001", draft: { ...draft, key: "AA-0002" } }), "AA-0001");
  assert.match(other, /<option value="Done" selected>/, "別のタスクの下書きは使わない");
});

test("renderTodo: 週の移動（data-tdweek・data-tdweek-today）と、見返し（完了 X / Y 件・予定 P 分に対して実績 A 分・タスクごとの進捗/予定/実績・気づき）。回した回数の列は無い", () => {
  const html = tdHtml(tdData({ [TD_WEEK]: "会議が多い週" }));
  for (const a of ['data-tdweek="-1"', 'data-tdweek="1"', "data-tdweek-today", "10/19〜10/25"]) assert.ok(html.includes(a), a);
  const rv = html.slice(html.indexOf('class="tdreview'));
  assert.ok(rv.includes("完了 1 / 4 件"), rv);
  assert.ok(rv.includes("予定 120 分に対して実績 30 分"), rv);
  const tr = (t) => rv.split("<tr").find((x) => x.includes(t)) ?? "";
  assert.ok(tr("超過のタスク").includes("1/2") && tr("超過のタスク").includes("0 分"), tr("超過のタスク"));
  assert.ok(tr("予定のタスク").includes("—") && tr("予定のタスク").includes("120 分") && tr("予定のタスク").includes("30 分"), tr("予定のタスク"));
  assert.ok(!rv.includes("回した"));
  assert.match(rv, /<textarea[^>]*data-tdnote="2026-10-19"[^>]*>会議が多い週<\/textarea>/);
});

test("renderTodo: 件名・プロジェクト名・チェックの項目・気づきは esc() される", () => {
  const d = tdData({ [TD_WEEK]: "<b>&" });
  d.projects[0].name = "<b>&";
  Object.assign(d.tasks[0], { title: "<b>&" });
  d.tasks[0].checklist[0].text = "<b>&";
  const html = tdHtml(d, { open: "AA-0001" });
  assert.ok(!html.includes("<b>&"), "生のタグが無い");
  assert.ok(html.includes("&lt;b&gt;&amp;"));
});

test("renderTodo: 週にタスクが無ければ、一覧は案内だけ。見返しは 0 件", () => {
  const html = tdHtml({ ...tdData(), tasks: [] });
  assert.ok(!html.includes("data-tdrow=") && html.includes("この週のタスクはありません") && html.includes("完了 0 / 0 件"));
});

/** 描いた入力欄の初期値を読む（app.js の tdFormDraft と同じ形） */
const formDraft = (f, key) => ({
  key, ...Object.fromEntries(["date", "start", "end"].map((k) => [k, new RegExp(`data-tf="${k}" value="([^"]*)"`).exec(f)[1]])),
  status: /<option value="([^"]+)" selected>/.exec(f)[1],
  checks: Object.fromEntries([...f.matchAll(/data-tfck="([^"]+)"( checked)?/g)].map((m) => [m[1], !!m[2]])),
});

test("完了の保存: 予定の枠が無いタスクで、初期値のまま保存すると、実績なしで Done になる（日付だけ入っていても止めない）", () => {
  const d = tdData();
  const dr = formDraft(tdRow(tdHtml(d, { open: "AA-0001" }), "AA-0001"), "AA-0001");
  assert.deepEqual([dr.date, dr.start, dr.end, dr.status], [TODAY, "", "", "Done"]);
  assert.equal(completeInput(dr).actual, undefined);
  const r = completeTask(d, "AA-0001", completeInput(dr), TD_NOW);
  const t = r.data.tasks.find((x) => x.id === "AA-0001");
  assert.equal(t.status, "Done");
  assert.deepEqual(t.sessions, [], "実績は足さない");
});

test("完了の保存: その日の予定の枠がまだ始まっていなければ、初期値のまま保存すると、実績なしで Done になる（その枠は未来の枠として解除）", () => {
  const d = tdData();
  const dr = formDraft(tdRow(tdHtml(d, { open: "AA-0002" }), "AA-0002"), "AA-0002");
  assert.deepEqual([dr.start, dr.end], ["", ""]);
  const r = completeTask(d, "AA-0002", completeInput(dr), TD_NOW);
  const t = r.data.tasks.find((x) => x.id === "AA-0002");
  assert.equal(t.status, "Done");
  assert.deepEqual(t.sessions.map((s) => s.id), ["S3"], "実績は足さず、S1・S2 は解除");
  assert.equal(r.released, 2);
});

test("完了の保存: 予定の枠があるタスクを初期値のまま保存すると、その時刻で実績が入る。開始・終了の片方だけは、completeTask の検査で止まる", () => {
  const d = tdData({}), now = { date: TODAY, time: "16:30" };
  const dr = formDraft(tdRow(tdHtml(d, { open: "AA-0002", now }), "AA-0002"), "AA-0002");
  const t = completeTask(d, "AA-0002", completeInput(dr), now).data.tasks.find((x) => x.id === "AA-0002");
  assert.deepEqual(t.sessions.find((s) => s.id === "S2").actual, { date: TODAY, start: "15:00", end: "16:00" });
  assert.deepEqual(completeInput({ ...dr, end: "" }).actual, { date: TODAY, start: "15:00", end: "" });
  assert.throws(() => completeTask(d, "AA-0002", completeInput({ ...dr, end: "" }), now), /すべて入れるか、すべて空に/);
});

test("撤去: prio.js は renderTodayTodos を export しない。スケジュール画面の右の列に「今日の ToDo」が出ない", () => {
  assert.equal(prioModule.renderTodayTodos, undefined);
  const d = load();
  const html = renderSide(d, TODAY, { sched: true, now: NOW });
  assert.ok(!html.includes("今日の ToDo") && !html.includes("todaytodos"));
});


test("削除の確認（askDelSess）: 確認待ちの枠（actual あり）の欄に「実績 75 分も消えます」と 2 つのボタンが出る。確認待ちでなければ出ない。ID は属性だけ", () => {
  const d = load();
  s8(d).actual = { date: S8_DAY, start: "09:00", end: "10:15" };
  const o = { view: "day", date: S8_DAY, selSess: "S8" };
  const html = sched(d, { ...o, askDelSess: "S8" });
  assert.ok(html.includes("実績 75 分も消えます"), html);
  assert.ok(html.includes('<div class="ask"') && html.includes('data-delsessok="S8"') && html.includes("data-delsessno") && html.includes("削除する") && html.includes("やめる"));
  assert.ok(!html.replace(/<[^>]*>/g, "").includes("S8"), "ID は画面の文字に出ない");
  assert.ok(!sched(d, o).includes("data-delsessok"), "確認待ちでない");
  assert.ok(!sched(d, { ...o, askDelSess: "S9" }).includes("data-delsessok"), "別の枠の確認");
  delete s8(d).actual;
  assert.ok(!sched(d, { ...o, askDelSess: "S8" }).includes("data-delsessok"), "actual のない枠");
});

test("実績の入力欄の説明: actual を持つ枠は「更新します」、持たない枠は「入れます」", () => {
  const d = load();
  d.tasks.find((t) => t.id === "AA-0004").sessions = [{ id: "S30", date: TODAY, start: "08:00", end: "09:00", kind: "planned" }];
  const o = { selSess: "S30", taskEdit: { id: "AA-0004", full: false, askDel: false } };
  assert.ok(sched(d, o).includes("「検証環境の構築」の実績を入れます（予定の枠は残ります）"));
  d.tasks.find((t) => t.id === "AA-0004").sessions[0].actual = { date: TODAY, start: "08:10", end: "09:10" };
  const h = sched(d, o);
  assert.ok(h.includes("「検証環境の構築」の実績を更新します（予定の枠は残ります）") && !h.includes("の実績を入れます"));
});

test("会議フォーム: 「実績を消す」（data-mtgactclear）は、確認済みの会議にだけ出る。未確認・参加しない・追加中には出ない", () => {
  const d = noSessions();
  const html = (o) => renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, ...o });
  const m2 = d.events.find((e) => e.id === "m2");
  m2.confirmed = false;
  assert.ok(!html({ selMtg: "m2" }).includes("data-mtgactclear"), "未確認");
  m2.confirmed = true;
  assert.ok(html({ selMtg: "m2" }).includes('data-mtgactclear="m2">実績を消す</button>'), "確認済み");
  m2.skip = true;
  assert.ok(!html({ selMtg: "m2" }).includes("data-mtgactclear"), "参加しない");
  assert.ok(!html({ mtgDraft: { date: TODAY, start: "09:00", end: "10:00", title: "", skip: false, confirmed: true } }).includes("data-mtgactclear"), "追加中");
});

// ---- 現在時刻の線・いまのブロック・今日の強調 ----
const blkTag = (h, a) => new RegExp(`<div class="blk[^>]*${a}[^>]*>`).exec(h)?.[0] ?? "";
const nowD = (time, date = TODAY) => ({ date, time });
const mtgAt = (d, id, start, end, extra = {}) => Object.assign(d.events.find((e) => e.id === id), { date: TODAY, start, end, ...extra });
const wk = (d, now, o = {}) => renderSchedule(d, TODAY, { view: "week", date: TODAY, now, ...o });
const dayv = (d, now, o = {}) => renderSchedule(d, TODAY, { view: "day", date: TODAY, now, ...o });

test("現在時刻の線: 週表示は、今日が表示中の週にあるとき今日の列にだけ 1 本。今日が週に無いと出ない。日表示は今までどおり", () => {
  const d = noSessions();
  const h = wk(d, nowD("10:15"));
  assert.equal((h.match(/class="nowline"/g) ?? []).length, 1);
  const col = /<div class="col dz today[^>]*>([\s\S]*?)(?=<div class="col dz|$)/.exec(h)[1];
  assert.ok(col.includes('class="nowline"') && col.includes("現在 10:15"));
  assert.ok(!wk(d, nowD("10:15"), { date: "2026-10-27" }).includes('class="nowline"'), "今日が週に無い");
  assert.ok(dayv(d, nowD("10:15")).includes('class="nowline"'));
  assert.ok(!dayv(d, nowD("10:15"), { date: "2026-10-21" }).includes('class="nowline"'), "日表示で今日以外");
});

test("いまのブロック: 今を含む枠・会議に class now と「いま」。開始ちょうどは付き、終了ちょうどは付かない", () => {
  for (const view of [wk, dayv]) {
    const d = noSessions();
    mtgAt(d, "m1", "10:00", "11:00"); mtgAt(d, "m2", "09:00", "10:15");
    const h = view(d, nowD("10:15"));
    assert.match(blkTag(h, 'data-mtg="m1"'), /class="blk mtg[^"]*\bnow\b/);
    assert.ok(/data-mtg="m1"[^>]*><span class="tm"><b class="nw">いま<\/b> 10:00-11:00/.test(h), "いま は時刻の前");
    assert.doesNotMatch(blkTag(h, 'data-mtg="m2"'), /\bnow\b/, "終了ちょうど");
    mtgAt(d, "m1", "10:15", "11:00");
    assert.match(blkTag(view(d, nowD("10:15")), 'data-mtg="m1"'), /\bnow\b/, "開始ちょうど");
  }
});

test("いまのブロック: skip の会議・影・今日以外の日・今日でない now には付かない", () => {
  const d = noSessions();
  mtgAt(d, "m1", "10:00", "11:00", { skip: true });
  mtgAt(d, "m2", "09:00", "11:00", { confirmed: true, actual: { start: "12:00", end: "13:00" } });
  const h = dayv(d, nowD("10:15"), { showSkipped: true });
  assert.doesNotMatch(blkTag(h, 'data-mtg="m1"'), /\bnow\b/, "skip");
  assert.doesNotMatch(blkTag(h, 'data-mghost="m2"'), /\bnow\b/, "影（予定の時刻に今が入っても）");
  assert.ok(!/class="blk[^"]*\bnow\b/.test(h) && !h.includes("いま"), "描いたブロック（実績 12:00-13:00）に今は入らない");
  const e = noSessions();
  mtgAt(e, "m1", "10:00", "11:00"); e.events = e.events.filter((x) => x.id === "m1");
  assert.doesNotMatch(wk(e, nowD("10:15", "2026-10-21")), /\bnow\b/, "今日でない now");
  const o = noSessions();
  Object.assign(o.events.find((x) => x.id === "m1"), { date: "2026-10-21", start: "10:00", end: "11:00" });
  assert.doesNotMatch(blkTag(wk(o, nowD("10:15")), 'data-mtg="m1"'), /\bnow\b/, "今日以外の日のブロック");
});

test("いまのブロック: 実績を持つ枠・会議は、実績の時刻で判定する（予定 9-10・実績 10-11 で 10:15 なら付く。予定側の時刻では付かない）", () => {
  const d = withPlan({ id: "S9", date: TODAY, start: "09:00", end: "10:00", actual: { date: TODAY, start: "10:00", end: "11:00" } });
  for (const t of d.tasks) t.sessions = t.sessions.filter((s) => s.id === "S9");
  const h = dayv(d, nowD("10:15"));
  assert.match(blkTag(h, 'data-actbar="S9"'), /class="blk task act[^"]*\bnow\b/);
  assert.ok(/data-actbar="S9"[^>]*><span class="tm"><b class="nw">いま<\/b> 実績 10:00-11:00/.test(h));
  assert.doesNotMatch(blkTag(h, 'data-ghost="S9"'), /\bnow\b/);
  assert.doesNotMatch(blkTag(dayv(d, nowD("09:30")), 'data-actbar="S9"'), /\bnow\b/, "予定の時刻は判定に使わない");
  const m = noSessions();
  mtgAt(m, "m1", "09:00", "10:00", { confirmed: true, actual: { start: "10:00", end: "11:00" } });
  assert.match(blkTag(dayv(m, nowD("10:15")), 'data-mact="m1"'), /\bnow\b/);
  assert.doesNotMatch(blkTag(dayv(m, nowD("09:30")), 'data-mact="m1"'), /\bnow\b/);
});

test("今日の強調: 週表示は今日の見出しだけ .dh.t・今日の列だけ today。日表示は今日のときだけ見出しに印（dtt）", () => {
  const h = wk(noSessions(), nowD("10:15"));
  assert.equal((h.match(/class="dh t"/g) ?? []).length, 1);
  assert.equal((h.match(/class="col dz today/g) ?? []).length, 1);
  assert.ok(dayv(noSessions(), nowD("10:15")).includes('<strong class="dtt"'));
  assert.ok(!dayv(noSessions(), nowD("10:15"), { date: "2026-10-21" }).includes("dtt"));
  assert.ok(!wk(noSessions(), nowD("10:15"), { date: "2026-10-27" }).includes('class="dh t"'));
});
