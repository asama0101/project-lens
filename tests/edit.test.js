import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../plugins/project-lens/src/core/schema.js";
import { taskStart } from "../plugins/project-lens/src/core/metrics.js";
import { addDays, toMin, toHHMM } from "../plugins/project-lens/src/core/dates.js";
import { allSessions } from "../plugins/project-lens/src/core/sessions.js";
import { freeSlots } from "../plugins/project-lens/src/core/schedule.js";
import { DEFAULT_WORKDAY } from "../plugins/project-lens/src/core/schema.js";
import { snapFreeStart } from "../plugins/project-lens/src/ui/views/schedule.js";
import { groupSections } from "../plugins/project-lens/src/core/groups.js";
import {
  updateTask, updateProject, addMilestone, updateMilestone, deleteMilestone, moveTaskDates, moveProjectDates, moveMilestone,
  addTaskQuick, predecessorCandidates, addTask, deleteTask, addProject, deleteProject,
  addHoliday, addHolidayRange, holidayRangeDays, removeHoliday, addWorkday, removeWorkday, addPredecessor, moveTask,
  nextTaskId, nextProjectId, addUrgentTask, moveToProject,
} from "../plugins/project-lens/src/ui/edit.js";

import { addChecklistItem, updateChecklistItem, removeChecklistItem, moveChecklistItem, checkAllChecklist, newChecklist } from "../plugins/project-lens/src/ui/edit.js";

const load = () => JSON.parse(readFileSync(new URL("../plugins/project-lens/data/sample.json", import.meta.url), "utf8"));
const TODAY = "2026-10-20";
const task = (d, id) => d.tasks.find((t) => t.id === id);
const proj = (d, id) => d.projects.find((p) => p.id === id);
const ok = (d) => assert.deepEqual(validate(d, { date: TODAY, time: "10:15" }).errors, []);

test("updateTask: Done にすると doneAt が今日、戻すと null。元のデータは変えない", () => {
  const d = load();
  const a = updateTask(d, "A5", { status: "Done" }, TODAY);
  assert.deepEqual([task(a, "A5").status, task(a, "A5").doneAt], ["Done", TODAY]);
  const b = updateTask(a, "A5", { status: "In Progress" }, TODAY);
  assert.equal(task(b, "A5").doneAt, null);
  assert.equal(task(d, "A5").status, "In Progress");
  ok(a);
});

test("updateTask: Waiting は待ち先が必須、Waiting から外れると waitingOn は null", () => {
  const d = load();
  assert.throws(() => updateTask(d, "A4", { status: "Waiting" }, TODAY));
  assert.throws(() => updateTask(d, "A4", { status: "Waiting", waitingOn: { party: "  ", since: TODAY } }, TODAY));
  const w = updateTask(d, "A4", { status: "Waiting", waitingOn: { party: "ベンダーZ", since: TODAY } }, TODAY);
  assert.equal(task(w, "A4").waitingOn.party, "ベンダーZ");
  const back = updateTask(w, "A4", { status: "To Do" }, TODAY);
  assert.equal(task(back, "A4").waitingOn, null);
  const same = updateTask(d, "A3", { memo: "更新" }, TODAY);
  assert.equal(task(same, "A3").waitingOn.party, "ベンダーX", "Waiting のままなら待ち先を保つ");
});

test("updateTask: 不正な値は例外（件名・日付・開始>期限・循環）", () => {
  const d = load();
  assert.throws(() => updateTask(d, "A4", { title: "  " }, TODAY));
  assert.throws(() => updateTask(d, "A4", { due: "2026/11/27" }, TODAY));
  assert.throws(() => updateTask(d, "A5", { start: "2027-01-10" }, TODAY), "前のタスクなしで開始>期限");
  assert.throws(() => updateTask(d, "A4", { predecessors: ["A7"] }, TODAY), "次のタスクを前のタスクにすると循環");
  assert.throws(() => updateTask(d, "ZZ", { memo: "x" }, TODAY));
  assert.equal(task(updateTask(d, "A4", { important: true, memo: "m", title: " 新件名 " }, TODAY), "A4").title, "新件名");
});

test("updateTask: important は true で付き、false で項目が消える", () => {
  const d = load();
  const on = updateTask(d, "A3", { important: true }, TODAY);
  assert.equal(task(on, "A3").important, true);
  const off = updateTask(on, "A3", { important: false }, TODAY);
  assert.equal("important" in task(off, "A3"), false);
});

test("updateProject: 状態・期限・開始日。開始>期限と空の名前は例外", () => {
  const d = load();
  const p = updateProject(d, "B", { status: "保留", due: "2027-01-31" });
  assert.deepEqual([proj(p, "B").status, proj(p, "B").due], ["保留", "2027-01-31"]);
  assert.throws(() => updateProject(d, "B", { start: "2027-01-01" }));
  assert.throws(() => updateProject(d, "B", { name: " " }));
  ok(p);
});

test("マイルストーン: 追加・更新・削除は日付昇順を保ち、範囲外 index は例外", () => {
  const d = load();
  const a = addMilestone(d, "A", { name: "中間", date: "2026-12-01" });
  assert.deepEqual(proj(a, "A").milestones.map((m) => m.name), ["機器発注", "中間", "本番切替"]);
  const u = updateMilestone(a, "A", 0, { date: "2027-03-01" });
  assert.deepEqual(proj(u, "A").milestones.map((m) => m.name), ["中間", "本番切替", "機器発注"]);
  assert.equal(proj(deleteMilestone(u, "A", 1), "A").milestones.length, 2);
  assert.throws(() => updateMilestone(d, "A", 9, { name: "x" }));
  assert.throws(() => deleteMilestone(d, "A", -1));
  assert.throws(() => addMilestone(d, "A", { name: "x", date: "bad" }));
});

test("moveTaskDates: 前のタスクなしの both / start / due", () => {
  const d = load();
  const b = moveTaskDates(d, "A5", "both", 3);
  assert.deepEqual([task(b.data, "A5").start, task(b.data, "A5").due], ["2026-10-15", "2026-12-28"]);
  assert.ok(moveTaskDates(d, "A5", "start", 999).error);
  assert.equal(task(moveTaskDates(d, "A5", "start", 2).data, "A5").start, "2026-10-14");
  assert.equal(task(moveTaskDates(d, "A5", "due", 2).data, "A5").due, "2026-12-27");
  assert.ok(moveTaskDates(d, "A5", "due", -999).error);
});

test("moveTaskDates: 前のタスクがあっても start/both/due を動かせる。前後の期限は見ない（error・warning なし）", () => {
  const d = load();
  const base = taskStart(d, "A4"); // 前のタスクの期限から決まる開始
  const s = moveTaskDates(d, "A4", "start", 1);
  assert.equal(s.error, undefined);
  assert.equal(task(s.data, "A4").start, addDays(base, 1));
  const b = moveTaskDates(d, "A4", "both", 1);
  assert.equal(task(b.data, "A4").start, addDays(base, 1));
  assert.equal(task(b.data, "A4").due, addDays(task(d, "A4").due, 1));
  const w = moveTaskDates(d, "A4", "due", 80); // 次のタスク A6 の期限より後ろでも、警告しない
  assert.equal(task(w.data, "A4").due, "2027-02-15");
  assert.equal(w.warning, undefined);
  assert.ok(moveTaskDates(d, "A4", "start", 999).error, "開始が期限より後になるのは error");
});

test("moveProjectDates / moveMilestone", () => {
  const d = load();
  assert.equal(proj(moveProjectDates(d, "B", "due", 7).data, "B").due, "2026-12-25");
  assert.ok(moveProjectDates(d, "B", "start", 500).error);
  const m = moveMilestone(d, "A", 0, 200);
  assert.deepEqual(proj(m, "A").milestones.map((x) => x.name), ["本番切替", "機器発注"]);
});

test("addTaskQuick: 開始は今日・期限は 7 日後・To Do・前のタスクなし。ID は重複しない", () => {
  const d = load();
  const a = addTaskQuick(d, "C", "追加タスク", TODAY);
  const t = a.tasks.find((x) => x.title === "追加タスク");
  assert.deepEqual([t.projectId, t.due, t.status, t.predecessors, t.start], ["C", "2026-10-27", "To Do", [], TODAY]);
  const b = addTaskQuick(a, "C", "もう1件", TODAY);
  assert.equal(new Set(b.tasks.map((x) => x.id)).size, b.tasks.length);
  ok(b);
});

test("addTaskQuick: place で大項目・中項目を指定でき、空白は null になる", () => {
  const d = load();
  const a = addTaskQuick(d, "C", "x", TODAY, { group: " 設計 ", subgroup: "" });
  const t = a.tasks.find((y) => y.title === "x");
  assert.deepEqual([t.group, t.subgroup], ["設計", null]);
  assert.equal(addTaskQuick(d, "C", "y", TODAY).tasks.find((z) => z.title === "y").group, undefined);
  ok(a);
});

test("predecessorCandidates: 自分・既存の前のタスク・次のタスク（孫を含む）を含まない。他プロジェクトも含まない", () => {
  const d = load();
  assert.deepEqual(predecessorCandidates(d, "A4").sort(), ["A1", "A2", "A5"].sort());
  assert.ok(!predecessorCandidates(d, "A5").some((id) => ["A5", "A6", "A7"].includes(id)));
  assert.ok(!predecessorCandidates(d, "A1").includes("A7"));
});

test("前のタスク: プロジェクトなしのタスクには付けられない。候補は空で、updateTask・addPredecessor は拒む。外すのは妨げない", () => {
  const d = load();
  const x = { ...d, tasks: [...d.tasks, { ...task(d, "A1"), id: "X2", projectId: null, predecessors: [], sessions: [] }] };
  x.tasks.find((t) => t.id === "X1").predecessors = [];
  assert.deepEqual(predecessorCandidates(x, "X1"), []);
  assert.throws(() => updateTask(x, "X1", { predecessors: ["X2"] }, TODAY), /プロジェクトなしのタスクには前のタスクを付けられません/);
  assert.throws(() => addPredecessor(x, "X1", "X2", TODAY), /プロジェクトなしのタスクには前のタスクを付けられません/);
  assert.deepEqual(task(updateTask(x, "X1", { predecessors: [] }, TODAY), "X1").predecessors, []);
  assert.deepEqual(predecessorCandidates(d, "A4").sort(), ["A1", "A2", "A5"].sort());
  ok(addPredecessor(d, "A4", "A1", TODAY));
});

test("addTask: ID を採番し、追加後も validate が通る", () => {
  const d = load();
  const a = addTask(d, { projectId: "B", title: "追加", due: "2026-11-30", predecessors: ["B2"] });
  const t = a.tasks.find((x) => x.title === "追加");
  assert.match(t.id, /^B-\d{4}$/);
  assert.equal(t.status, "To Do");
  ok(a);
  assert.throws(() => addTask(d, { projectId: "ZZ", title: "x", due: "2026-11-30" }));
});

test("addTask: 開始日が期限より後なら拒む。同じ日、開始なしは通る", () => {
  const d = load();
  assert.throws(() => addTask(d, { projectId: "B", title: "逆", start: "2026-12-01", due: "2026-11-30" }), /開始日が期限より後/);
  ok(addTask(d, { projectId: "B", title: "同日", start: "2026-11-30", due: "2026-11-30" }));
  ok(addTask(d, { projectId: "B", title: "開始なし", due: "2026-11-30" }));
});

test("addTask: 変更履歴に残る消したタスクの ID は使い回さない", () => {
  const d = load();
  const last = d.tasks.filter((t) => t.projectId === "B").map((t) => t.id).sort().at(-1);
  const logged = { ...d, changeLog: [...d.changeLog, { at: "2026-11-01", taskIds: [last], reason: "遅れ", cause: "社内", deltaDays: 3 }] };
  const after = addTask(deleteTask(logged, last),{ projectId: "B", title: "新規", due: "2026-11-30" });
  assert.notEqual(after.tasks.find((x) => x.title === "新規").id, last);
});

test("deleteTask: 削除し、次のタスクの前のタスクからも外す", () => {
  const d = load();
  const f = deleteTask(d, "A4");
  assert.equal(task(f, "A4"), undefined);
  assert.deepEqual(task(f, "A6").predecessors, ["A5"]);
  ok(f);
  assert.equal(task(deleteTask(d, "A7"), "A7"), undefined);
});

test("addProject / deleteProject", () => {
  const d = load();
  const a = addProject(d, { name: "新規", type: "改善" }, TODAY);
  const p = a.projects[a.projects.length - 1];
  assert.deepEqual([p.id, p.status, p.start], ["AA", "計画中", TODAY]);
  ok(a);
  const del = deleteProject(d, "C");
  assert.ok(!del.projects.some((x) => x.id === "C") && !del.tasks.some((t) => t.projectId === "C"));
  ok(del);
});

test("updateTask: group/subgroup は trim され、空は null", () => {
  const d = { tasks: [{ id: "T1", projectId: "P", title: "x", due: "2026-10-20", status: "To Do", predecessors: [], waitingOn: null }], projects: [{ id: "P" }] };
  const n = updateTask(d, "T1", { group: "  設計 ", subgroup: "   " }).tasks[0];
  assert.deepEqual([n.group, n.subgroup], ["設計", null]);
  assert.equal(updateTask(d, "T1", { group: null }).tasks[0].group, null);
});

test("deleteProject: そのプロジェクトを指す会議のひも付け・規則・WBS の対応も掃除する（ID を再利用しても付け替わらない）", () => {
  const d = {
    settings: { projectRules: [{ keyword: "x", projectId: "A" }, { keyword: "y", projectId: "B" }], wbsMappings: { A: { title: "t" }, B: { title: "t" } }, wbsImports: { A: { file: "a.xlsx", at: "2026-10-20", added: 1, updated: 0 }, B: { file: null, at: "2026-10-20", added: 0, updated: 1 } } },
    projects: [{ id: "A" }, { id: "B" }], tasks: [],
    events: [{ id: "m1", projectId: "A", projectBy: "rule" }, { id: "m2", projectId: "A", projectBy: "manual" }, { id: "m3", projectId: "B", projectBy: "manual" }, { id: "m4" }],
    changeLog: [],
  };
  const n = deleteProject(d, "A");
  assert.deepEqual(n.events.map((e) => [e.projectId ?? null, e.projectBy ?? null]), [[null, null], [null, null], ["B", "manual"], [null, null]]);
  assert.deepEqual(n.settings.projectRules, [{ keyword: "y", projectId: "B" }]);
  assert.deepEqual(Object.keys(n.settings.wbsMappings), ["B"]);
  assert.deepEqual(Object.keys(n.settings.wbsImports), ["B"], "取り込み記録も消える");
  assert.equal(d.events[0].projectId, "A", "元のデータは変わらない");
  assert.equal(deleteProject({ ...d, settings: undefined }, "A").settings, undefined, "settings が無くても落ちない");
});

test("updateSettings: 勤務時間・待ち長期化・呼び名。他の設定は保つ。元のデータは変えない", async () => {
  const { updateSettings } = await import("../plugins/project-lens/src/ui/edit.js");
  const d = load();
  d.settings = { projectRules: [{ keyword: "ベンダーX", projectId: "A" }] };
  const n = updateSettings(d, { workday: { start: "08:30", end: "17:30" }, waitingLongDays: 3, labels: { group: " フェーズ ", subgroup: "作業" } });
  assert.deepEqual(n.settings, {
    projectRules: [{ keyword: "ベンダーX", projectId: "A" }], workday: { start: "08:30", end: "17:30" }, waitingLongDays: 3,
    labels: { group: "フェーズ", subgroup: "作業" },
  });
  assert.deepEqual(d.settings, { projectRules: [{ keyword: "ベンダーX", projectId: "A" }] });
  assert.deepEqual(validate(n).errors, []);
});

test("updateSettings: 不正な勤務時間（形式・開始 >= 終了）・待ち長期化は例外", async () => {
  const { updateSettings } = await import("../plugins/project-lens/src/ui/edit.js");
  const d = load();
  for (const patch of [
    { workday: { start: "9:00", end: "18:00" } }, { workday: { start: "18:00", end: "09:00" } }, { workday: { start: "09:00", end: "09:00" } }, { workday: { start: "", end: "" } },
    { waitingLongDays: 0 }, { waitingLongDays: 1.5 }, { waitingLongDays: "3" },
  ]) assert.throws(() => updateSettings(d, patch), /勤務時間|待ち長期化/, JSON.stringify(patch));
});

test("updateSettings: 呼び名を空にするとそのキーが消え、両方空なら labels ごと消える", async () => {
  const { updateSettings } = await import("../plugins/project-lens/src/ui/edit.js");
  const d = { ...load(), settings: { labels: { group: "フェーズ", subgroup: "作業" } } };
  const one = updateSettings(d, { labels: { group: "  " } });
  assert.deepEqual(one.settings.labels, { subgroup: "作業" });
  const both = updateSettings(one, { labels: { subgroup: "" } });
  assert.ok(!("labels" in both.settings));
});

test("updateSettings: 1 項目だけの patch は他の項目を保つ。labels がオブジェクトでないファイルでも、ゴミのキーを残さない", async () => {
  const { updateSettings } = await import("../plugins/project-lens/src/ui/edit.js");
  const d = { ...load(), settings: { workday: { start: "08:30", end: "17:30" }, waitingLongDays: 3 } };
  assert.deepEqual(updateSettings(d, { waitingLongDays: 5 }).settings, { workday: { start: "08:30", end: "17:30" }, waitingLongDays: 5 });
  assert.deepEqual(updateSettings({ ...d, settings: { labels: "xy" } }, { labels: { group: "G" } }).settings.labels, { group: "G" });
  assert.ok(!("labels" in updateSettings({ ...d, settings: { labels: ["a"] } }, { labels: { group: "" } }).settings));
});

// ---- 休みと営業日の指定 ----
const NH = { fetchedAt: "2026-10-25", source: "u", dates: [{ date: "2026-11-03", name: "文化の日" }] };
const hol = (d) => d.settings.holidays;

test("addHoliday: 昇順・同日は置き換え・区分とメモを持つ。他の設定を保ち、検証に通る", () => {
  let d = { ...load(), settings: { waitingLongDays: 3 } };
  d = addHoliday(d, { date: "2026-11-23", kind: "祝日" });
  d = addHoliday(d, { date: "2026-10-26", kind: "有給", note: " 通院 " });
  d = addHoliday(d, { date: "2026-11-23", kind: "その他", note: "" });
  assert.deepEqual(d.settings, { waitingLongDays: 3, holidays: [{ date: "2026-10-26", kind: "有給", note: "通院" }, { date: "2026-11-23", kind: "その他" }] });
  assert.deepEqual(validate(d, { date: TODAY, time: "10:15" }).errors, []);
  assert.deepEqual(validate(d, { date: TODAY, time: "10:15" }).warnings.filter((m) => m.startsWith("settings.")), []);
});

test("addHoliday: 日付・区分が不正なら例外。配列でない壊れた既存値は空として足し、配列の中の不正な要素は消さずに残す", () => {
  const d = load();
  assert.throws(() => addHoliday(d, { date: "x", kind: "祝日" }), /日付/);
  assert.throws(() => addHoliday(d, { date: "2026-02-30", kind: "祝日" }), /日付/);
  assert.throws(() => addHoliday(d, { date: "2026-10-26", kind: "休暇" }), /区分/);
  assert.deepEqual(hol(addHoliday({ ...d, settings: { holidays: "x" } }, { date: "2026-10-26", kind: "祝日" })), [{ date: "2026-10-26", kind: "祝日" }]);
  const mixed = addHoliday({ ...d, settings: { holidays: ["2026/11/23", { date: "2026-12-01", kind: "祝日" }] } }, { date: "2026-11-03", kind: "有給" });
  assert.deepEqual(hol(mixed), [{ date: "2026-11-03", kind: "有給" }, { date: "2026-12-01", kind: "祝日" }, "2026/11/23"]);
});

test("holidayRangeDays: 期間の各日から土日と日本の祝日（取得済みのとき）を除く。不正な期間は例外", () => {
  const d = { ...load(), settings: {} };
  const r = holidayRangeDays(d, "2026-10-26", "2026-11-06"); // 月〜翌々金
  assert.equal(r.days.length, 10);
  assert.equal(r.skipped, 2);
  assert.ok(!r.days.includes("2026-10-31") && !r.days.includes("2026-11-01"));
  const withNH = holidayRangeDays({ ...d, settings: { nationalHolidays: NH } }, "2026-10-26", "2026-11-06");
  assert.equal(withNH.days.length, 9);
  assert.equal(withNH.skipped, 3);
  assert.ok(!withNH.days.includes("2026-11-03"));
  assert.deepEqual(holidayRangeDays(d, "2026-10-26", "2026-10-26"), { days: ["2026-10-26"], skipped: 0 });
  assert.throws(() => holidayRangeDays(d, "2026-11-06", "2026-10-26"), /終了/);
  assert.throws(() => holidayRangeDays(d, "2026-01-01", "2027-01-02"), /366/);
  assert.doesNotThrow(() => holidayRangeDays(d, "2026-01-01", "2027-01-01"));
  assert.throws(() => holidayRangeDays(d, "x", "2026-10-26"), /日付/);
});

test("addHolidayRange: 期間を 1 日ずつの休みにして足す。登録済みの日は区分を置き換え、重複しない。全部除外なら例外", () => {
  let d = { ...load(), settings: { nationalHolidays: NH } };
  d = addHoliday(d, { date: "2026-10-27", kind: "祝日" });
  d = addHolidayRange(d, { from: "2026-10-26", to: "2026-11-03", kind: "有給", note: "夏休み" });
  assert.deepEqual(hol(d).map((h) => h.date), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02"]);
  assert.ok(hol(d).every((h) => h.kind === "有給" && h.note === "夏休み"));
  assert.throws(() => addHolidayRange(d, { from: "2026-10-31", to: "2026-11-01", kind: "有給" }), /休みにできる日がありません/);
  assert.throws(() => addHolidayRange(d, { from: "2026-10-26", to: "2026-10-27", kind: "休暇" }), /区分/);
  assert.deepEqual(validate(d, { date: TODAY, time: "10:15" }).errors, []);
});

test("removeHoliday: 無い日は変更なし。空になったらキーを消す", () => {
  let d = addHolidayRange({ ...load(), settings: { waitingLongDays: 3 } }, { from: "2026-10-26", to: "2026-10-27", kind: "祝日" });
  assert.deepEqual(hol(removeHoliday(d, "2026-01-01")).length, 2);
  d = removeHoliday(removeHoliday(d, "2026-10-26"), "2026-10-27");
  assert.deepEqual(d.settings, { waitingLongDays: 3 });
});

test("addWorkday・removeWorkday: 営業日の指定。昇順・同日は置き換え・メモ・不正は例外・空になったらキーを消す", () => {
  let d = { ...load(), settings: { waitingLongDays: 3 } };
  d = addWorkday(d, { date: "2026-11-28", note: "休日出勤" });
  d = addWorkday(d, { date: "2026-10-31" });
  d = addWorkday(d, { date: "2026-10-31", note: "試験" });
  assert.deepEqual(d.settings.workdays, [{ date: "2026-10-31", note: "試験" }, { date: "2026-11-28", note: "休日出勤" }]);
  assert.throws(() => addWorkday(d, { date: "x" }), /日付/);
  assert.deepEqual(validate(d, { date: TODAY, time: "10:15" }).errors, []);
  d = removeWorkday(removeWorkday(d, "2026-10-31"), "2026-11-28");
  assert.deepEqual(d.settings, { waitingLongDays: 3 });
  assert.deepEqual(removeWorkday(d, "2026-01-01").settings, { waitingLongDays: 3 });
});

test("updateSettings: countWeekendsAndHolidays は true で保存、false でキーを消す。他の設定を保つ", async () => {
  const { updateSettings } = await import("../plugins/project-lens/src/ui/edit.js");
  const d = { ...load(), settings: { waitingLongDays: 3, nationalHolidays: NH } };
  const on = updateSettings(d, { countWeekendsAndHolidays: true });
  assert.deepEqual(on.settings, { waitingLongDays: 3, nationalHolidays: NH, countWeekendsAndHolidays: true });
  const back = updateSettings(on, { countWeekendsAndHolidays: false });
  assert.deepEqual(back.settings, { waitingLongDays: 3, nationalHolidays: NH }, "オフに戻しても取得済みの祝日は残る");
});

test("holidayRangeDays・addHolidayRange: オンのとき期間の全日を対象にし、除外は 0。366 日以上は例外のまま", () => {
  const d = { ...load(), settings: { countWeekendsAndHolidays: true, nationalHolidays: NH } };
  const r = holidayRangeDays(d, "2026-10-30", "2026-11-03"); // 金〜火（土・日・祝日を含む）
  assert.equal(r.days.length, 5);
  assert.equal(r.skipped, 0);
  assert.throws(() => holidayRangeDays(d, "2026-01-01", "2027-01-02"), /366/);
  const added = addHolidayRange(d, { from: "2026-10-31", to: "2026-11-01", kind: "有給" });
  assert.deepEqual(hol(added).map((h) => h.date), ["2026-10-31", "2026-11-01"]);
});

test("updateTask: 前のタスクがあるタスクでも、開始日が期限より後になる更新は拒む（start は前のタスクがあっても有効なため）", () => {
  const d = load();
  assert.throws(() => updateTask(d, "A4", { start: "2027-03-01" }), /開始日は期限以前/);
  assert.equal(task(updateTask(d, "A4", { start: "2026-11-20" }), "A4").start, "2026-11-20");
});

test("addPredecessor: 前のタスクを足しても、指定してあった開始日は変わらない", () => {
  const d = load();
  assert.equal(task(d, "A5").start, "2026-10-12");
  const n = addPredecessor(d, "A5", "A3");
  assert.deepEqual(task(n, "A5").predecessors, ["A3"]);
  assert.equal(task(n, "A5").start, "2026-10-12");
  assert.equal(taskStart(n, "A5"), "2026-10-12");
  const m = addPredecessor(d, "A4", "A5"); // 開始日の指定がないタスクは、前のタスクが増えるだけ
  assert.deepEqual(task(m, "A4").predecessors, ["A3", "A5"]);
});

// ---- moveTask: 表示順の入れ替え ----
const idsOf = (d, pid) => d.tasks.filter((t) => t.projectId === pid).map((t) => t.id);
const shownOrder = (d, pid) => groupSections(d.tasks.filter((t) => t.projectId === pid)).flatMap((s) => s.tasks.map((t) => t.id));
const place = (d, id) => [task(d, id).group, task(d, id).subgroup];

test("moveTask: 同じセクション内で、指定したタスクの前へ入れ替える。大項目・中項目は変わらない", () => {
  const n = moveTask(load(), "A3", { beforeId: "A2" });
  assert.deepEqual(idsOf(n, "A"), ["A1", "A3", "A2", "A4", "A5", "A6", "A7"]);
  assert.deepEqual(place(n, "A3"), ["調達", "機器選定"]);
  ok(n);
});

test("moveTask: 別のセクションのタスクの前へ落とすと、そのタスクの大項目・中項目になる。セクションの順は変わらない", () => {
  const n = moveTask(load(), "A1", { beforeId: "A5" });
  assert.deepEqual(idsOf(n, "A"), ["A2", "A3", "A4", "A1", "A5", "A6", "A7"]);
  assert.deepEqual(place(n, "A1"), ["構築", "切替準備"]);
  assert.deepEqual(groupSections(n.tasks.filter((t) => t.projectId === "A")).map((s) => `${s.group}/${s.subgroup}`), ["調達/機器選定", "構築/検証環境", "構築/切替準備"]);
  ok(n);
});

test("moveTask: beforeId が null のときは、指定した大項目・中項目のセクションの末尾へ入る。空の指定は「（なし）」", () => {
  const e = moveTask(load(), "A1", { beforeId: null, group: "調達", subgroup: "機器選定" });
  assert.deepEqual(idsOf(e, "A"), ["A2", "A3", "A1", "A4", "A5", "A6", "A7"]);
  assert.deepEqual(place(e, "A1"), ["調達", "機器選定"]);
  const none = moveTask(load(), "A1", { beforeId: null, group: "", subgroup: "" });
  assert.deepEqual(place(none, "A1"), [null, null]);
  assert.deepEqual(idsOf(none, "A"), ["A2", "A3", "A4", "A5", "A6", "A7", "A1"]);
  ok(e); ok(none);
});

test("moveTask: 今の位置のままになる移動（すぐ次のタスクの前・自分の前）は、何も変えず同じデータを返す", () => {
  const d = load();
  assert.equal(moveTask(d, "A2", { beforeId: "A3" }), d);
  assert.equal(moveTask(d, "A2", { beforeId: "A2" }), d);
  assert.equal(moveTask(d, "A3", { beforeId: null, group: "調達", subgroup: "機器選定" }), d);
});

test("moveTask: 不正な指定は例外（存在しない ID・別のプロジェクトのタスクの前）。元のデータは変えない", () => {
  const d = load();
  const before = JSON.stringify(d);
  assert.throws(() => moveTask(d, "X9", { beforeId: "A1" }), /X9/);
  assert.throws(() => moveTask(d, "A1", { beforeId: "X9" }), /X9/);
  assert.throws(() => moveTask(d, "A1", { beforeId: "B1" }), /別のプロジェクト/);
  moveTask(d, "A1", { beforeId: "A5" });
  assert.equal(JSON.stringify(d), before);
});

test("moveTask: 他のプロジェクトのタスクの配列上の位置は変えず、動かしたプロジェクトは表示順に整える", () => {
  const d = load();
  const by = new Map(d.tasks.map((t) => [t.id, t]));
  d.tasks = ["A1", "B1", "A2", "B2", "A3", "C1", "A4", "B3", "A5", "A6", "B4", "A7", "C2", "C3"].map((id) => by.get(id)); // A・B・C が交互
  const pos = (x, pid) => x.tasks.map((t, i) => (t.projectId === pid ? i : -1)).filter((i) => i >= 0);
  const n = moveTask(d, "A5", { beforeId: "A2" });
  for (const pid of ["A", "B", "C"]) assert.deepEqual(pos(n, pid), pos(d, pid), `${pid} の占める位置`);
  assert.deepEqual(["B", "C"].map((pid) => idsOf(n, pid)), ["B", "C"].map((pid) => idsOf(d, pid)));
  assert.deepEqual(idsOf(n, "A"), shownOrder(n, "A"), "配列の順 = 表示の順");
  assert.deepEqual(place(n, "A5"), ["調達", "機器選定"]);
  ok(n);
});

test("moveTask: 配列の順が表示の順と違うプロジェクトも、動かしたあとは配列の順 = 表示の順になる", () => {
  const d = load();
  const by = new Map(d.tasks.map((t) => [t.id, t]));
  d.tasks = ["A2", "A4", "A3", "A1", "A5", "A6", "A7", "B1", "B2", "B3", "B4", "C1", "C2", "C3"].map((id) => by.get(id)); // 調達・構築・調達・設計の順
  assert.deepEqual(shownOrder(d, "A"), ["A2", "A3", "A4", "A5", "A6", "A7", "A1"]);
  const n = moveTask(d, "A7", { beforeId: "A6" });
  assert.deepEqual(idsOf(n, "A"), ["A2", "A3", "A4", "A5", "A7", "A6", "A1"]);
});

// ---- チェックリスト ----
const items = (d, id) => (task(d, id).checklist ?? []).map((c) => [c.id, c.text, c.done]);

test("addChecklistItem: 末尾に c1, c2… で足す。前後の空白は除き、空は例外。元のデータは変えない", () => {
  const d = load();
  const a = addChecklistItem(d, "A4", "a");
  assert.deepEqual(items(a, "A4"), [["c1", "a", false]]);
  assert.deepEqual(items(addChecklistItem(a, "A4", "  x  "), "A4"), [["c1", "a", false], ["c2", "x", false]]);
  assert.throws(() => addChecklistItem(d, "A4", "  "), /項目を入力/);
  assert.equal(task(d, "A4").checklist, undefined);
  ok(a);
});

test("addChecklistItem: 削除のあとに足しても、同時にある ID は重複しない", () => {
  let d = load();
  for (const t of ["a", "b", "c"]) d = addChecklistItem(d, "A4", t);
  const noC1 = removeChecklistItem(d, "A4", "c1");
  assert.deepEqual(items(addChecklistItem(noC1, "A4", "d"), "A4").map((x) => x[0]), ["c2", "c3", "c4"]);
  const noC3 = removeChecklistItem(d, "A4", "c3");
  assert.equal(new Set(items(addChecklistItem(noC3, "A4", "d"), "A4").map((x) => x[0])).size, 3);
});

test("updateChecklistItem: done と text を変える。存在しない項目・空の text は例外", () => {
  const d = addChecklistItem(load(), "A4", "a");
  assert.deepEqual(items(updateChecklistItem(d, "A4", "c1", { done: true }), "A4"), [["c1", "a", true]]);
  assert.deepEqual(items(updateChecklistItem(d, "A4", "c1", { text: " b " }), "A4"), [["c1", "b", false]]);
  assert.throws(() => updateChecklistItem(d, "A4", "c9", { done: true }), /項目/);
  assert.throws(() => updateChecklistItem(d, "A4", "c1", { text: "" }), /項目を入力/);
});

test("moveChecklistItem: beforeId の前へ。null は末尾。同じ並びなら同じ data を返す", () => {
  let d = load();
  for (const t of ["a", "b", "c"]) d = addChecklistItem(d, "A4", t);
  assert.deepEqual(items(moveChecklistItem(d, "A4", "c3", "c1"), "A4").map((x) => x[0]), ["c3", "c1", "c2"]);
  assert.deepEqual(items(moveChecklistItem(d, "A4", "c1", null), "A4").map((x) => x[0]), ["c2", "c3", "c1"]);
  assert.equal(moveChecklistItem(d, "A4", "c2", "c3"), d);
  assert.equal(moveChecklistItem(d, "A4", "c3", null), d);
});

test("checkAllChecklist: 全項目を済みにする。newChecklist: 空を除いて c1 から採番", () => {
  let d = load();
  for (const t of ["a", "b"]) d = addChecklistItem(d, "A4", t);
  assert.deepEqual(items(checkAllChecklist(d, "A4"), "A4").map((x) => x[2]), [true, true]);
  assert.deepEqual(newChecklist(["a", "", "b"]), [{ id: "c1", text: "a", done: false }, { id: "c2", text: "b", done: false }]);
});

// ---- コードレビューの指摘（#21 のあと） ----
test("deleteProject: そのプロジェクトを絞り込みに持つ依頼も外す（残すと検証が不明な projectId で保存を止める）", () => {
  const d = load();
  d.inbox = { watching: null, requests: [{ id: "R1", at: "2026-10-20T00:00:00Z", projectId: "C", status: "pending", thread: [{ role: "user", at: "2026-10-20T00:00:00Z", text: "x" }], proposal: null, result: null }] };
  const del = deleteProject(d, "C");
  assert.equal(del.inbox.requests[0].projectId, null);
  ok(del);
});

test("updateTask: すでに Done のタスクに Done を渡しても、元の完了日（doneAt）を保つ", () => {
  const d = load();
  const a = updateTask(d, "A5", { status: "Done" }, "2026-10-01");
  const b = updateTask(a, "A5", { status: "Done" }, TODAY);
  assert.equal(task(b, "A5").doneAt, "2026-10-01");
});

test("nextProjectId: AA から、使われていない最初の 2 文字。ZZ は返さない", () => {
  const withIds = (ids) => ({ projects: ids.map((id) => ({ id })), tasks: [] });
  assert.equal(nextProjectId(withIds([])), "AA");
  assert.equal(nextProjectId(withIds(["AA"])), "AB");
  assert.equal(nextProjectId(withIds(["AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI", "AJ", "AK", "AL", "AM", "AN", "AO", "AP", "AQ", "AR", "AS", "AT", "AU", "AV", "AW", "AX", "AY", "AZ"])), "BA");
  assert.equal(nextProjectId(withIds(["AA", "AC"])), "AB");
  assert.equal(nextProjectId(withIds(["A", "B"])), "AA");
  assert.equal(addProject(withIds(["XA", "XB"]), { name: "x", type: "y" }, TODAY).projects.at(-1).id, "AA");
  const all = [];
  for (const a of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") for (const b of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (a + b !== "ZZ") all.push(a + b);
  assert.equal(all.length, 675);
  assert.equal(nextProjectId(withIds(all.slice(0, -1))), "ZY");
  assert.throws(() => nextProjectId(withIds(all)), /プロジェクトは 675 個までです/);
  assert.throws(() => addProject(withIds(all), { name: "x", type: "y" }, TODAY), /プロジェクトは 675 個までです/);
  assert.equal(nextProjectId(withIds(all.filter((x) => x !== "XX"))), "XX");
});

test("nextTaskId: 接頭辞-4 桁。null は ZZ。タスクと変更履歴の最大番号 + 1", () => {
  const mk = (ids, log = []) => ({ tasks: ids.map((id) => ({ id })), changeLog: log });
  assert.equal(nextTaskId(mk([]), "AA"), "AA-0001");
  assert.equal(nextTaskId(mk(["AA-0007", "AA-0003"]), "AA"), "AA-0008");
  assert.equal(nextTaskId(mk([]), null), "ZZ-0001");
  assert.equal(nextTaskId(mk(["ZZ-0001"]), null), "ZZ-0002");
  assert.equal(nextTaskId(mk([], [{ taskIds: ["AA-0005"] }]), "AA"), "AA-0006");
  assert.equal(nextTaskId(mk(["P1-0011", "P11-0001", "AA-0002"]), "P1"), "P1-0012");
  assert.equal(nextTaskId(mk(["P1-0011", "P11-0001"]), "P11"), "P11-0002");
  assert.equal(nextTaskId(mk(["A1", "AA-12"]), "AA"), "AA-0001");
  assert.equal(nextTaskId(mk(["AA-9998"]), "AA"), "AA-9999");
  assert.throws(() => nextTaskId(mk(["AA-9999"]), "AA"), /タスクの番号が 9999 を超えます/);
});

const URGENT = { title: " 障害対応 ", projectId: null, date: TODAY, start: "13:00", minutes: 30 };

test("addUrgentTask: プロジェクトなしのタスクと枠を 1 操作で作る（未来の枠は planned）", () => {
  const d = load();
  const r = addUrgentTask(d, URGENT, { date: TODAY, time: "12:00" });
  const t = task(r.data, "ZZ-0001");
  assert.equal(r.id, "ZZ-0001");
  assert.deepEqual([t.projectId, t.title, t.due, t.start, t.status], [null, "障害対応", TODAY, TODAY, "In Progress"]);
  assert.equal(t.sessions.length, 1);
  assert.match(t.sessions[0].id, /^S\d+$/);
  assert.deepEqual({ ...t.sessions[0], id: undefined }, { id: undefined, date: TODAY, start: "13:00", end: "13:30", kind: "planned" });
  assert.equal(d.tasks.some((x) => x.id === "ZZ-0001"), false);
});

test("addUrgentTask: 1 時間より短い最後の空き枠（サンプル 10/19 の 17:30-18:00）の開始に、30 分の枠を置ける", () => {
  const d = load();
  const wd = d.settings?.workday ?? DEFAULT_WORKDAY;
  const free = freeSlots([...d.events, ...allSessions(d)], "2026-10-19", wd).at(-1);
  assert.equal(free.start, "17:30");
  const start = toHHMM(snapFreeStart(toMin(free.start), wd));
  assert.equal(start, "17:30");
  const r = addUrgentTask(load(), { title: "x", projectId: null, date: "2026-10-19", start, minutes: 30 }, { date: "2026-10-19", time: "12:00" });
  assert.deepEqual(task(r.data, "ZZ-0001").sessions.map((s) => [s.start, s.end]), [["17:30", "18:00"]]);
});

test("addUrgentTask: 枠が過去なら actual", () => {
  const r = addUrgentTask(load(), URGENT, { date: TODAY, time: "14:00" });
  assert.equal(task(r.data, "ZZ-0001").sessions[0].kind, "actual");
});

test("addUrgentTask: 会議と重なると warning が付き、タスクと枠は作られる", () => {
  const r = addUrgentTask(load(), URGENT, { date: TODAY, time: "12:00" });
  assert.match(r.warning, /ベンダーX 打合せ/);
  assert.equal(task(r.data, "ZZ-0001").sessions.length, 1);
  assert.equal(addUrgentTask(load(), { ...URGENT, start: "15:00" }, { date: TODAY, time: "12:00" }).warning, undefined);
});

test("addUrgentTask: 他の枠と重なると Error で、データは変わらない", () => {
  const d = load();
  const n = d.tasks.length;
  assert.throws(() => addUrgentTask(d, { ...URGENT, date: "2026-10-21", start: "14:30" }, { date: TODAY, time: "12:00" }), /他の枠/);
  assert.equal(d.tasks.length, n);
});

test("addUrgentTask: 件名が空白だけ・プロジェクトが不明は Error", () => {
  const now = { date: TODAY, time: "12:00" };
  assert.throws(() => addUrgentTask(load(), { ...URGENT, title: "  " }, now), /件名を入力してください/);
  assert.throws(() => addUrgentTask(load(), { ...URGENT, projectId: "ZZ" }, now), /プロジェクト ZZ がありません/);
});

test("addUrgentTask: projectId を指定すると、そのプロジェクトの採番になる", () => {
  const d = load();
  const r = addUrgentTask(d, { ...URGENT, start: "15:00" }, { date: TODAY, time: "12:00" });
  const r2 = addUrgentTask(d, { ...URGENT, projectId: "A", start: "15:00" }, { date: TODAY, time: "12:00" });
  assert.equal(r.id, nextTaskId(d, null));
  assert.equal(r2.id, nextTaskId(d, "A"));
  assert.equal(task(r2.data, r2.id).projectId, "A");
});

// ---- プロジェクトの付け替え ----
const lone = (projectId) => { const d = load(); d.tasks.push({ ...task(d, "A5"), id: "L1", projectId, group: "構築", subgroup: "切替準備", predecessors: [] }); return d; };

test("moveToProject: プロジェクトなし → A。ID はそのまま、大項目・中項目は null、配列の末尾へ", () => {
  const d = load();
  const r = moveToProject(d, "X1", "A");
  assert.equal(r.tasks.at(-1).id, "X1");
  assert.equal(r.tasks.at(-1).projectId, "A");
  assert.equal(r.tasks.at(-1).group, null);
  assert.equal(r.tasks.at(-1).subgroup, null);
  assert.equal(r.tasks.length, d.tasks.length);
  assert.equal(task(d, "X1").projectId, null);
});

test("moveToProject: A → B、A → null（大項目・中項目は外れる）", () => {
  const d = lone("A");
  const b = moveToProject(d, "L1", "B");
  assert.equal(task(b, "L1").projectId, "B");
  assert.equal(task(b, "L1").group, null);
  const n = moveToProject(d, "L1", null);
  assert.equal(task(n, "L1").projectId, null);
  assert.equal(task(n, "L1").subgroup, null);
  assert.equal(task(d, "L1").group, "構築");
});

test("moveToProject: 前のタスクがある・次のタスクがある・不明なタスク・不明なプロジェクトは Error で、データは変わらない", () => {
  const d = load(), snap = JSON.stringify(d);
  assert.throws(() => moveToProject(d, "A4", "B"), /付け替えられません/);
  assert.throws(() => moveToProject(d, "A5", "B"), /付け替えられません/);
  assert.throws(() => moveToProject(d, "ZZ", "B"), /ZZ がありません/);
  assert.throws(() => moveToProject(d, "X1", "ZZ"), /プロジェクト ZZ がありません/);
  assert.equal(JSON.stringify(d), snap);
});

test("updateTask: 画面で期限を動かしても、履歴（changeLog）は増えない", async () => {
  const { updateTask } = await import("../plugins/project-lens/src/ui/edit.js");
  const d = load();
  const n = updateTask(d, "A3", { due: addDays(d.tasks.find((t) => t.id === "A3").due, 3) }, TODAY);
  assert.equal(n.changeLog.length, d.changeLog.length);
});
