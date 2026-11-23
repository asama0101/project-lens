import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../plugins/project-lens/src/core/schema.js";
import { taskStart } from "../plugins/project-lens/src/core/metrics.js";
import { addDays } from "../plugins/project-lens/src/core/dates.js";
import { groupSections } from "../plugins/project-lens/src/core/groups.js";
import {
  updateTask, updateProject, addMilestone, updateMilestone, deleteMilestone, moveTaskDates, moveProjectDates, moveMilestone,
  addTaskQuick, predecessorCandidates, addTask, deleteTask, addProject, deleteProject,
  addHoliday, addHolidayRange, holidayRangeDays, removeHoliday, addWorkday, removeWorkday, addPredecessor, moveTask,
  nextTaskId, nextProjectId, addUrgentTask, moveToProject,
} from "../plugins/project-lens/src/ui/edit.js";

import { addChecklistItem, updateChecklistItem, removeChecklistItem, moveChecklistItem, checkAllChecklist, newChecklist, confirmTodaySession } from "../plugins/project-lens/src/ui/edit.js";

const load = () => JSON.parse(readFileSync(new URL("../plugins/project-lens/data/sample.json", import.meta.url), "utf8"));
const TODAY = "2026-10-20";
const task = (d, id) => d.tasks.find((t) => t.id === id);
const proj = (d, id) => d.projects.find((p) => p.id === id);
const ok = (d) => assert.deepEqual(validate(d, { date: TODAY, time: "10:15" }).errors, []);

test("updateTask: Done にすると doneAt が今日、戻すと null。元のデータは変えない", () => {
  const d = load();
  const a = updateTask(d, "AA-0005", { status: "Done" }, TODAY);
  assert.deepEqual([task(a, "AA-0005").status, task(a, "AA-0005").doneAt], ["Done", TODAY]);
  const b = updateTask(a, "AA-0005", { status: "In Progress" }, TODAY);
  assert.equal(task(b, "AA-0005").doneAt, null);
  assert.equal(task(d, "AA-0005").status, "In Progress");
  ok(a);
});

test("updateTask: Waiting は待ち先が必須、Waiting から外れると waitingOn は null", () => {
  const d = load();
  assert.throws(() => updateTask(d, "AA-0004", { status: "Waiting" }, TODAY));
  assert.throws(() => updateTask(d, "AA-0004", { status: "Waiting", waitingOn: { party: "  ", since: TODAY } }, TODAY));
  const w = updateTask(d, "AA-0004", { status: "Waiting", waitingOn: { party: "ベンダーZ", since: TODAY } }, TODAY);
  assert.equal(task(w, "AA-0004").waitingOn.party, "ベンダーZ");
  const back = updateTask(w, "AA-0004", { status: "To Do" }, TODAY);
  assert.equal(task(back, "AA-0004").waitingOn, null);
  const same = updateTask(d, "AA-0003", { memo: "更新" }, TODAY);
  assert.equal(task(same, "AA-0003").waitingOn.party, "ベンダーX", "Waiting のままなら待ち先を保つ");
});

test("updateTask: 不正な値は例外（件名・日付・開始>期限・循環）", () => {
  const d = load();
  assert.throws(() => updateTask(d, "AA-0004", { title: "  " }, TODAY));
  assert.throws(() => updateTask(d, "AA-0004", { due: "2026/11/27" }, TODAY));
  assert.throws(() => updateTask(d, "AA-0005", { start: "2027-01-10" }, TODAY), "前のタスクなしで開始>期限");
  assert.throws(() => updateTask(d, "AA-0004", { predecessors: ["AA-0007"] }, TODAY), "次のタスクを前のタスクにすると循環");
  assert.throws(() => updateTask(d, "ZZ", { memo: "x" }, TODAY));
  assert.equal(task(updateTask(d, "AA-0004", { important: true, memo: "m", title: " 新件名 " }, TODAY), "AA-0004").title, "新件名");
});

test("updateTask: important は true で付き、false で項目が消える", () => {
  const d = load();
  const on = updateTask(d, "AA-0003", { important: true }, TODAY);
  assert.equal(task(on, "AA-0003").important, true);
  const off = updateTask(on, "AA-0003", { important: false }, TODAY);
  assert.equal("important" in task(off, "AA-0003"), false);
});

test("updateProject: 状態・期限・開始日。開始>期限と空の名前は例外", () => {
  const d = load();
  const p = updateProject(d, "AB", { status: "保留", due: "2027-01-31" });
  assert.deepEqual([proj(p, "AB").status, proj(p, "AB").due], ["保留", "2027-01-31"]);
  assert.throws(() => updateProject(d, "AB", { start: "2027-01-01" }));
  assert.throws(() => updateProject(d, "AB", { name: " " }));
  ok(p);
});

test("マイルストーン: 追加・更新・削除は日付昇順を保ち、範囲外 index は例外", () => {
  const d = load();
  const a = addMilestone(d, "AA", { name: "中間", date: "2026-12-01" });
  assert.deepEqual(proj(a, "AA").milestones.map((m) => m.name), ["機器発注", "中間", "本番切替"]);
  const u = updateMilestone(a, "AA", 0, { date: "2027-03-01" });
  assert.deepEqual(proj(u, "AA").milestones.map((m) => m.name), ["中間", "本番切替", "機器発注"]);
  assert.equal(proj(deleteMilestone(u, "AA", 1), "AA").milestones.length, 2);
  assert.throws(() => updateMilestone(d, "AA", 9, { name: "x" }));
  assert.throws(() => deleteMilestone(d, "AA", -1));
  assert.throws(() => addMilestone(d, "AA", { name: "x", date: "bad" }));
});

test("moveTaskDates: 前のタスクなしの both / start / due", () => {
  const d = load();
  const b = moveTaskDates(d, "AA-0005", "both", 3);
  assert.deepEqual([task(b.data, "AA-0005").start, task(b.data, "AA-0005").due], ["2026-10-15", "2026-12-28"]);
  assert.ok(moveTaskDates(d, "AA-0005", "start", 999).error);
  assert.equal(task(moveTaskDates(d, "AA-0005", "start", 2).data, "AA-0005").start, "2026-10-14");
  assert.equal(task(moveTaskDates(d, "AA-0005", "due", 2).data, "AA-0005").due, "2026-12-27");
  assert.ok(moveTaskDates(d, "AA-0005", "due", -999).error);
});

test("moveTaskDates: 前のタスクがあっても start/both/due を動かせる。前後の期限は見ない（error・warning なし）", () => {
  const d = load();
  const base = taskStart(d, "AA-0004"); // 前のタスクの期限から決まる開始
  const s = moveTaskDates(d, "AA-0004", "start", 1);
  assert.equal(s.error, undefined);
  assert.equal(task(s.data, "AA-0004").start, addDays(base, 1));
  const b = moveTaskDates(d, "AA-0004", "both", 1);
  assert.equal(task(b.data, "AA-0004").start, addDays(base, 1));
  assert.equal(task(b.data, "AA-0004").due, addDays(task(d, "AA-0004").due, 1));
  const w = moveTaskDates(d, "AA-0004", "due", 80); // 次のタスク AA-0006 の期限より後ろでも、警告しない
  assert.equal(task(w.data, "AA-0004").due, "2027-02-15");
  assert.equal(w.warning, undefined);
  assert.ok(moveTaskDates(d, "AA-0004", "start", 999).error, "開始が期限より後になるのは error");
});

test("moveProjectDates / moveMilestone", () => {
  const d = load();
  assert.equal(proj(moveProjectDates(d, "AB", "due", 7).data, "AB").due, "2026-12-25");
  assert.ok(moveProjectDates(d, "AB", "start", 500).error);
  const m = moveMilestone(d, "AA", 0, 200);
  assert.deepEqual(proj(m, "AA").milestones.map((x) => x.name), ["本番切替", "機器発注"]);
});

test("addTaskQuick: 開始は今日・期限は 7 日後・To Do・前のタスクなし。ID は重複しない", () => {
  const d = load();
  const a = addTaskQuick(d, "AC", "追加タスク", TODAY);
  const t = a.tasks.find((x) => x.title === "追加タスク");
  assert.deepEqual([t.projectId, t.due, t.status, t.predecessors, t.start], ["AC", "2026-10-27", "To Do", [], TODAY]);
  const b = addTaskQuick(a, "AC", "もう1件", TODAY);
  assert.equal(new Set(b.tasks.map((x) => x.id)).size, b.tasks.length);
  ok(b);
});

test("addTaskQuick: place で大項目・中項目を指定でき、空白は null になる", () => {
  const d = load();
  const a = addTaskQuick(d, "AC", "x", TODAY, { group: " 設計 ", subgroup: "" });
  const t = a.tasks.find((y) => y.title === "x");
  assert.deepEqual([t.group, t.subgroup], ["設計", null]);
  assert.equal(addTaskQuick(d, "AC", "y", TODAY).tasks.find((z) => z.title === "y").group, undefined);
  ok(a);
});

test("predecessorCandidates: 自分・既存の前のタスク・次のタスク（孫を含む）を含まない。他プロジェクトも含まない", () => {
  const d = load();
  assert.deepEqual(predecessorCandidates(d, "AA-0004").sort(), ["AA-0001", "AA-0002", "AA-0005"].sort());
  assert.ok(!predecessorCandidates(d, "AA-0005").some((id) => ["AA-0005", "AA-0006", "AA-0007"].includes(id)));
  assert.ok(!predecessorCandidates(d, "AA-0001").includes("AA-0007"));
});

test("前のタスク: プロジェクトなしのタスクには付けられない。候補は空で、updateTask・addPredecessor は拒む。外すのは妨げない", () => {
  const d = load();
  const x = { ...d, tasks: [...d.tasks, { ...task(d, "AA-0001"), id: "ZZ-0002", projectId: null, predecessors: [], sessions: [] }] };
  x.tasks.find((t) => t.id === "ZZ-0001").predecessors = [];
  assert.deepEqual(predecessorCandidates(x, "ZZ-0001"), []);
  assert.throws(() => updateTask(x, "ZZ-0001", { predecessors: ["ZZ-0002"] }, TODAY), /プロジェクトなしのタスクには前のタスクを付けられません/);
  assert.throws(() => addPredecessor(x, "ZZ-0001", "ZZ-0002", TODAY), /プロジェクトなしのタスクには前のタスクを付けられません/);
  assert.deepEqual(task(updateTask(x, "ZZ-0001", { predecessors: [] }, TODAY), "ZZ-0001").predecessors, []);
  assert.deepEqual(predecessorCandidates(d, "AA-0004").sort(), ["AA-0001", "AA-0002", "AA-0005"].sort());
  ok(addPredecessor(d, "AA-0004", "AA-0001", TODAY));
});

test("addTask: ID を採番し、追加後も validate が通る", () => {
  const d = load();
  const a = addTask(d, { projectId: "AB", title: "追加", due: "2026-11-30", predecessors: ["AB-0002"] });
  const t = a.tasks.find((x) => x.title === "追加");
  assert.match(t.id, /^AB-\d{4}$/);
  assert.equal(t.status, "To Do");
  ok(a);
  assert.throws(() => addTask(d, { projectId: "ZZ", title: "x", due: "2026-11-30" }));
});

test("addTask: 開始日が期限より後なら拒む。同じ日、開始なしは通る", () => {
  const d = load();
  assert.throws(() => addTask(d, { projectId: "AB", title: "逆", start: "2026-12-01", due: "2026-11-30" }), /開始日が期限より後/);
  ok(addTask(d, { projectId: "AB", title: "同日", start: "2026-11-30", due: "2026-11-30" }));
  ok(addTask(d, { projectId: "AB", title: "開始なし", due: "2026-11-30" }));
});

test("addTask: 変更履歴に残る消したタスクの ID は使い回さない", () => {
  const d = load();
  const last = d.tasks.filter((t) => t.projectId === "AB").map((t) => t.id).sort().at(-1);
  const logged = { ...d, changeLog: [...d.changeLog, { at: "2026-11-01", taskIds: [last], reason: "遅れ", cause: "社内", deltaDays: 3 }] };
  const after = addTask(deleteTask(logged, last),{ projectId: "AB", title: "新規", due: "2026-11-30" });
  assert.notEqual(after.tasks.find((x) => x.title === "新規").id, last);
});

test("deleteTask: 削除し、次のタスクの前のタスクからも外す", () => {
  const d = load();
  const f = deleteTask(d, "AA-0004");
  assert.equal(task(f, "AA-0004"), undefined);
  assert.deepEqual(task(f, "AA-0006").predecessors, ["AA-0005"]);
  ok(f);
  assert.equal(task(deleteTask(d, "AA-0007"), "AA-0007"), undefined);
});

test("addProject / deleteProject", () => {
  const d = load();
  const a = addProject(d, { name: "新規", type: "改善" }, TODAY);
  const p = a.projects[a.projects.length - 1];
  assert.deepEqual([p.id, p.status, p.start], ["AD", "計画中", TODAY]);
  ok(a);
  const del = deleteProject(d, "AC");
  assert.ok(!del.projects.some((x) => x.id === "AC") && !del.tasks.some((t) => t.projectId === "AC"));
  ok(del);
});

test("updateTask: group/subgroup は trim され、空は null", () => {
  const d = { tasks: [{ id: "AA-0001", projectId: "AA", title: "x", due: "2026-10-20", status: "To Do", predecessors: [], waitingOn: null }], projects: [{ id: "AA" }] };
  const n = updateTask(d, "AA-0001", { group: "  設計 ", subgroup: "   " }).tasks[0];
  assert.deepEqual([n.group, n.subgroup], ["設計", null]);
  assert.equal(updateTask(d, "AA-0001", { group: null }).tasks[0].group, null);
});

test("deleteProject: そのプロジェクトを指す会議のひも付け・規則・WBS の対応も掃除する（ID を再利用しても付け替わらない）", () => {
  const d = {
    settings: { projectRules: [{ keyword: "x", projectId: "AA" }, { keyword: "y", projectId: "AB" }], wbsMappings: { AA: { title: "t" }, AB: { title: "t" } }, wbsImports: { AA: { file: "a.xlsx", at: "2026-10-20", added: 1, updated: 0 }, AB: { file: null, at: "2026-10-20", added: 0, updated: 1 } } },
    projects: [{ id: "AA" }, { id: "AB" }], tasks: [],
    events: [{ id: "m1", projectId: "AA", projectBy: "rule" }, { id: "m2", projectId: "AA", projectBy: "manual" }, { id: "m3", projectId: "AB", projectBy: "manual" }, { id: "m4" }],
    changeLog: [],
  };
  const n = deleteProject(d, "AA");
  assert.deepEqual(n.events.map((e) => [e.projectId ?? null, e.projectBy ?? null]), [[null, null], [null, null], ["AB", "manual"], [null, null]]);
  assert.deepEqual(n.settings.projectRules, [{ keyword: "y", projectId: "AB" }]);
  assert.deepEqual(Object.keys(n.settings.wbsMappings), ["AB"]);
  assert.deepEqual(Object.keys(n.settings.wbsImports), ["AB"], "取り込み記録も消える");
  assert.equal(d.events[0].projectId, "AA", "元のデータは変わらない");
  assert.equal(deleteProject({ ...d, settings: undefined }, "AA").settings, undefined, "settings が無くても落ちない");
});

test("updateSettings: 待ち長期化・呼び名。他の設定は保つ。元のデータは変えない。勤務時間（workday）は受けない", async () => {
  const { updateSettings } = await import("../plugins/project-lens/src/ui/edit.js");
  const d = load();
  d.settings = { projectRules: [{ keyword: "ベンダーX", projectId: "AA" }] };
  const n = updateSettings(d, { workday: { start: "08:30", end: "17:30" }, waitingLongDays: 3, labels: { group: " フェーズ ", subgroup: "作業" } });
  assert.deepEqual(n.settings, {
    projectRules: [{ keyword: "ベンダーX", projectId: "AA" }], waitingLongDays: 3,
    labels: { group: "フェーズ", subgroup: "作業" },
  });
  assert.deepEqual(d.settings, { projectRules: [{ keyword: "ベンダーX", projectId: "AA" }] });
  assert.deepEqual(validate(n).errors, []);
});

test("updateSettings: 不正な待ち長期化は例外", async () => {
  const { updateSettings } = await import("../plugins/project-lens/src/ui/edit.js");
  const d = load();
  for (const patch of [{ waitingLongDays: 0 }, { waitingLongDays: 1.5 }, { waitingLongDays: "3" }]) assert.throws(() => updateSettings(d, patch), /待ち長期化/, JSON.stringify(patch));
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
  const d = { ...load(), settings: { selfNames: ["自分"], waitingLongDays: 3 } };
  assert.deepEqual(updateSettings(d, { waitingLongDays: 5 }).settings, { selfNames: ["自分"], waitingLongDays: 5 });
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
  assert.throws(() => updateTask(d, "AA-0004", { start: "2027-03-01" }), /開始日は期限以前/);
  assert.equal(task(updateTask(d, "AA-0004", { start: "2026-11-20" }), "AA-0004").start, "2026-11-20");
});

test("addPredecessor: 前のタスクを足しても、指定してあった開始日は変わらない", () => {
  const d = load();
  assert.equal(task(d, "AA-0005").start, "2026-10-12");
  const n = addPredecessor(d, "AA-0005", "AA-0003");
  assert.deepEqual(task(n, "AA-0005").predecessors, ["AA-0003"]);
  assert.equal(task(n, "AA-0005").start, "2026-10-12");
  assert.equal(taskStart(n, "AA-0005"), "2026-10-12");
  const m = addPredecessor(d, "AA-0004", "AA-0005"); // 開始日の指定がないタスクは、前のタスクが増えるだけ
  assert.deepEqual(task(m, "AA-0004").predecessors, ["AA-0003", "AA-0005"]);
});

// ---- moveTask: 表示順の入れ替え ----
const idsOf = (d, pid) => d.tasks.filter((t) => t.projectId === pid).map((t) => t.id);
const shownOrder = (d, pid) => groupSections(d.tasks.filter((t) => t.projectId === pid)).flatMap((s) => s.tasks.map((t) => t.id));
const place = (d, id) => [task(d, id).group, task(d, id).subgroup];

test("moveTask: 同じセクション内で、指定したタスクの前へ入れ替える。大項目・中項目は変わらない", () => {
  const n = moveTask(load(), "AA-0003", { beforeId: "AA-0002" });
  assert.deepEqual(idsOf(n, "AA"), ["AA-0001", "AA-0003", "AA-0002", "AA-0004", "AA-0005", "AA-0006", "AA-0007"]);
  assert.deepEqual(place(n, "AA-0003"), ["調達", "機器選定"]);
  ok(n);
});

test("moveTask: 別のセクションのタスクの前へ落とすと、そのタスクの大項目・中項目になる。セクションの順は変わらない", () => {
  const n = moveTask(load(), "AA-0001", { beforeId: "AA-0005" });
  assert.deepEqual(idsOf(n, "AA"), ["AA-0002", "AA-0003", "AA-0004", "AA-0001", "AA-0005", "AA-0006", "AA-0007"]);
  assert.deepEqual(place(n, "AA-0001"), ["構築", "切替準備"]);
  assert.deepEqual(groupSections(n.tasks.filter((t) => t.projectId === "AA")).map((s) => `${s.group}/${s.subgroup}`), ["調達/機器選定", "構築/検証環境", "構築/切替準備"]);
  ok(n);
});

test("moveTask: beforeId が null のときは、指定した大項目・中項目のセクションの末尾へ入る。空の指定は「（なし）」", () => {
  const e = moveTask(load(), "AA-0001", { beforeId: null, group: "調達", subgroup: "機器選定" });
  assert.deepEqual(idsOf(e, "AA"), ["AA-0002", "AA-0003", "AA-0001", "AA-0004", "AA-0005", "AA-0006", "AA-0007"]);
  assert.deepEqual(place(e, "AA-0001"), ["調達", "機器選定"]);
  const none = moveTask(load(), "AA-0001", { beforeId: null, group: "", subgroup: "" });
  assert.deepEqual(place(none, "AA-0001"), [null, null]);
  assert.deepEqual(idsOf(none, "AA"), ["AA-0002", "AA-0003", "AA-0004", "AA-0005", "AA-0006", "AA-0007", "AA-0001"]);
  ok(e); ok(none);
});

test("moveTask: 今の位置のままになる移動（すぐ次のタスクの前・自分の前）は、何も変えず同じデータを返す", () => {
  const d = load();
  assert.equal(moveTask(d, "AA-0002", { beforeId: "AA-0003" }), d);
  assert.equal(moveTask(d, "AA-0002", { beforeId: "AA-0002" }), d);
  assert.equal(moveTask(d, "AA-0003", { beforeId: null, group: "調達", subgroup: "機器選定" }), d);
});

test("moveTask: 不正な指定は例外（存在しない ID・別のプロジェクトのタスクの前）。元のデータは変えない", () => {
  const d = load();
  const before = JSON.stringify(d);
  assert.throws(() => moveTask(d, "ZZ-0009", { beforeId: "AA-0001" }), /ZZ-0009/);
  assert.throws(() => moveTask(d, "AA-0001", { beforeId: "ZZ-0009" }), /ZZ-0009/);
  assert.throws(() => moveTask(d, "AA-0001", { beforeId: "AB-0001" }), /別のプロジェクト/);
  moveTask(d, "AA-0001", { beforeId: "AA-0005" });
  assert.equal(JSON.stringify(d), before);
});

test("moveTask: 他のプロジェクトのタスクの配列上の位置は変えず、動かしたプロジェクトは表示順に整える", () => {
  const d = load();
  const by = new Map(d.tasks.map((t) => [t.id, t]));
  d.tasks = ["AA-0001", "AB-0001", "AA-0002", "AB-0002", "AA-0003", "AC-0001", "AA-0004", "AB-0003", "AA-0005", "AA-0006", "AB-0004", "AA-0007", "AC-0002", "AC-0003"].map((id) => by.get(id)); // AA・AB・AC が交互
  const pos = (x, pid) => x.tasks.map((t, i) => (t.projectId === pid ? i : -1)).filter((i) => i >= 0);
  const n = moveTask(d, "AA-0005", { beforeId: "AA-0002" });
  for (const pid of ["AA", "AB", "AC"]) assert.deepEqual(pos(n, pid), pos(d, pid), `${pid} の占める位置`);
  assert.deepEqual(["AB", "AC"].map((pid) => idsOf(n, pid)), ["AB", "AC"].map((pid) => idsOf(d, pid)));
  assert.deepEqual(idsOf(n, "AA"), shownOrder(n, "AA"), "配列の順 = 表示の順");
  assert.deepEqual(place(n, "AA-0005"), ["調達", "機器選定"]);
  ok(n);
});

test("moveTask: 配列の順が表示の順と違うプロジェクトも、動かしたあとは配列の順 = 表示の順になる", () => {
  const d = load();
  const by = new Map(d.tasks.map((t) => [t.id, t]));
  d.tasks = ["AA-0002", "AA-0004", "AA-0003", "AA-0001", "AA-0005", "AA-0006", "AA-0007", "AB-0001", "AB-0002", "AB-0003", "AB-0004", "AC-0001", "AC-0002", "AC-0003"].map((id) => by.get(id)); // 調達・構築・調達・設計の順
  assert.deepEqual(shownOrder(d, "AA"), ["AA-0002", "AA-0003", "AA-0004", "AA-0005", "AA-0006", "AA-0007", "AA-0001"]);
  const n = moveTask(d, "AA-0007", { beforeId: "AA-0006" });
  assert.deepEqual(idsOf(n, "AA"), ["AA-0002", "AA-0003", "AA-0004", "AA-0005", "AA-0007", "AA-0006", "AA-0001"]);
});

// ---- チェックリスト ----
const items = (d, id) => (task(d, id).checklist ?? []).map((c) => [c.id, c.text, c.done]);

test("addChecklistItem: 末尾に c1, c2… で足す。前後の空白は除き、空は例外。元のデータは変えない", () => {
  const d = load();
  const a = addChecklistItem(d, "AA-0004", "a");
  assert.deepEqual(items(a, "AA-0004"), [["c1", "a", false]]);
  assert.deepEqual(items(addChecklistItem(a, "AA-0004", "  x  "), "AA-0004"), [["c1", "a", false], ["c2", "x", false]]);
  assert.throws(() => addChecklistItem(d, "AA-0004", "  "), /項目を入力/);
  assert.equal(task(d, "AA-0004").checklist, undefined);
  ok(a);
});

test("addChecklistItem: 削除のあとに足しても、同時にある ID は重複しない", () => {
  let d = load();
  for (const t of ["a", "b", "c"]) d = addChecklistItem(d, "AA-0004", t);
  const noC1 = removeChecklistItem(d, "AA-0004", "c1");
  assert.deepEqual(items(addChecklistItem(noC1, "AA-0004", "d"), "AA-0004").map((x) => x[0]), ["c2", "c3", "c4"]);
  const noC3 = removeChecklistItem(d, "AA-0004", "c3");
  assert.equal(new Set(items(addChecklistItem(noC3, "AA-0004", "d"), "AA-0004").map((x) => x[0])).size, 3);
});

test("updateChecklistItem: done と text を変える。存在しない項目・空の text は例外", () => {
  const d = addChecklistItem(load(), "AA-0004", "a");
  assert.deepEqual(items(updateChecklistItem(d, "AA-0004", "c1", { done: true }), "AA-0004"), [["c1", "a", true]]);
  assert.deepEqual(items(updateChecklistItem(d, "AA-0004", "c1", { text: " b " }), "AA-0004"), [["c1", "b", false]]);
  assert.throws(() => updateChecklistItem(d, "AA-0004", "c9", { done: true }), /項目/);
  assert.throws(() => updateChecklistItem(d, "AA-0004", "c1", { text: "" }), /項目を入力/);
});

test("moveChecklistItem: beforeId の前へ。null は末尾。同じ並びなら同じ data を返す", () => {
  let d = load();
  for (const t of ["a", "b", "c"]) d = addChecklistItem(d, "AA-0004", t);
  assert.deepEqual(items(moveChecklistItem(d, "AA-0004", "c3", "c1"), "AA-0004").map((x) => x[0]), ["c3", "c1", "c2"]);
  assert.deepEqual(items(moveChecklistItem(d, "AA-0004", "c1", null), "AA-0004").map((x) => x[0]), ["c2", "c3", "c1"]);
  assert.equal(moveChecklistItem(d, "AA-0004", "c2", "c3"), d);
  assert.equal(moveChecklistItem(d, "AA-0004", "c3", null), d);
});

test("checkAllChecklist: 全項目を済みにする。newChecklist: 空を除いて c1 から採番", () => {
  let d = load();
  for (const t of ["a", "b"]) d = addChecklistItem(d, "AA-0004", t);
  assert.deepEqual(items(checkAllChecklist(d, "AA-0004"), "AA-0004").map((x) => x[2]), [true, true]);
  assert.deepEqual(newChecklist(["a", "", "b"]), [{ id: "c1", text: "a", done: false }, { id: "c2", text: "b", done: false }]);
});

// ---- コードレビューの指摘（#21 のあと） ----
test("deleteProject: そのプロジェクトを絞り込みに持つ依頼も外す（残すと検証が不明な projectId で保存を止める）", () => {
  const d = load();
  d.inbox = { watching: null, requests: [{ id: "R1", at: "2026-10-20T00:00:00Z", projectId: "AC", status: "pending", thread: [{ role: "user", at: "2026-10-20T00:00:00Z", text: "x" }], proposal: null, result: null }] };
  const del = deleteProject(d, "AC");
  assert.equal(del.inbox.requests[0].projectId, null);
  ok(del);
});

test("updateTask: すでに Done のタスクに Done を渡しても、元の完了日（doneAt）を保つ", () => {
  const d = load();
  const a = updateTask(d, "AA-0005", { status: "Done" }, "2026-10-01");
  const b = updateTask(a, "AA-0005", { status: "Done" }, TODAY);
  assert.equal(task(b, "AA-0005").doneAt, "2026-10-01");
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
  const r = addUrgentTask(d, URGENT);
  const t = task(r.data, "ZZ-0002");
  assert.equal(r.id, "ZZ-0002");
  assert.deepEqual([t.projectId, t.title, t.due, t.start, t.status], [null, "障害対応", TODAY, TODAY, "In Progress"]);
  assert.equal(t.sessions.length, 1);
  assert.match(t.sessions[0].id, /^S\d+$/);
  assert.deepEqual({ ...t.sessions[0], id: undefined }, { id: undefined, date: TODAY, start: "13:00", end: "13:30", kind: "planned" });
  assert.equal(d.tasks.some((x) => x.id === "ZZ-0002"), false);
});

test("addUrgentTask: 勤務時間の制限はなく、夜（23:15〜23:45）にも置ける。23:59 を超える終了は Error で何も作らない", () => {
  const r = addUrgentTask(load(), { title: "x", projectId: null, date: "2026-10-19", start: "23:15", minutes: 30 });
  assert.deepEqual(task(r.data, "ZZ-0002").sessions.map((s) => [s.start, s.end]), [["23:15", "23:45"]]);
  assert.throws(() => addUrgentTask(load(), { title: "x", projectId: null, date: "2026-10-19", start: "23:45", minutes: 30 }), /23:59/);
});

test("addUrgentTask: 枠はいつでも planned（過去なら未確認として出て、確認で実績になる）", () => {
  const r = addUrgentTask(load(), URGENT);
  assert.equal(task(r.data, "ZZ-0002").sessions[0].kind, "planned");
});

test("addUrgentTask: 会議と重なると warning が付き、タスクと枠は作られる", () => {
  const r = addUrgentTask(load(), URGENT);
  assert.match(r.warning, /ベンダーX 打合せ/);
  assert.equal(task(r.data, "ZZ-0002").sessions.length, 1);
  assert.equal(addUrgentTask(load(), { ...URGENT, start: "15:00" }).warning, undefined);
});

test("addUrgentTask: 他の枠と重なると Error で、データは変わらない", () => {
  const d = load();
  const n = d.tasks.length;
  assert.throws(() => addUrgentTask(d, { ...URGENT, date: "2026-10-21", start: "14:30" }), /他の枠/);
  assert.equal(d.tasks.length, n);
});

test("addUrgentTask: 件名が空白だけ・プロジェクトが不明は Error", () => {
  assert.throws(() => addUrgentTask(load(), { ...URGENT, title: "  " }), /件名を入力してください/);
  assert.throws(() => addUrgentTask(load(), { ...URGENT, projectId: "ZZ" }), /プロジェクト ZZ がありません/);
});

test("addUrgentTask: projectId を指定すると、そのプロジェクトの採番になる", () => {
  const d = load();
  const r = addUrgentTask(d, { ...URGENT, start: "15:00" });
  const r2 = addUrgentTask(d, { ...URGENT, projectId: "AA", start: "15:00" });
  assert.equal(r.id, nextTaskId(d, null));
  assert.equal(r2.id, nextTaskId(d, "AA"));
  assert.equal(task(r2.data, r2.id).projectId, "AA");
});

// ---- プロジェクトの付け替え ----
const lone = (projectId) => { const d = load(); d.tasks.push({ ...task(d, "AA-0005"), id: "AA-0008", projectId, group: "構築", subgroup: "切替準備", predecessors: [] }); return d; };

test("moveToProject: プロジェクトなし → AA。ID はそのまま、大項目・中項目は null、配列の末尾へ", () => {
  const d = load();
  const r = moveToProject(d, "ZZ-0001", "AA");
  assert.equal(r.tasks.at(-1).id, "ZZ-0001");
  assert.equal(r.tasks.at(-1).projectId, "AA");
  assert.equal(r.tasks.at(-1).group, null);
  assert.equal(r.tasks.at(-1).subgroup, null);
  assert.equal(r.tasks.length, d.tasks.length);
  assert.equal(task(d, "ZZ-0001").projectId, null);
});

test("moveToProject: AA → AB、AA → null（大項目・中項目は外れる）", () => {
  const d = lone("AA");
  const b = moveToProject(d, "AA-0008", "AB");
  assert.equal(task(b, "AA-0008").projectId, "AB");
  assert.equal(task(b, "AA-0008").group, null);
  const n = moveToProject(d, "AA-0008", null);
  assert.equal(task(n, "AA-0008").projectId, null);
  assert.equal(task(n, "AA-0008").subgroup, null);
  assert.equal(task(d, "AA-0008").group, "構築");
});

test("moveToProject: 前のタスクがある・次のタスクがある・不明なタスク・不明なプロジェクトは Error で、データは変わらない", () => {
  const d = load(), snap = JSON.stringify(d);
  assert.throws(() => moveToProject(d, "AA-0004", "AB"), /付け替えられません/);
  assert.throws(() => moveToProject(d, "AA-0005", "AB"), /付け替えられません/);
  assert.throws(() => moveToProject(d, "ZZ", "AB"), /ZZ がありません/);
  assert.throws(() => moveToProject(d, "ZZ-0001", "ZZ"), /プロジェクト ZZ がありません/);
  assert.equal(JSON.stringify(d), snap);
});

test("updateTask: 画面で期限を動かしても、履歴（changeLog）は増えない", async () => {
  const { updateTask } = await import("../plugins/project-lens/src/ui/edit.js");
  const d = load();
  const n = updateTask(d, "AA-0003", { due: addDays(d.tasks.find((t) => t.id === "AA-0003").due, 3) }, TODAY);
  assert.equal(n.changeLog.length, d.changeLog.length);
});

test("removeOrphanSessions: orphanSessions だけを空にし、タスクと枠は変えない", async () => {
  const { removeOrphanSessions } = await import("../plugins/project-lens/src/core/split.js");
  const d = load();
  d.orphanSessions = [{ id: "SX1", taskId: "ZZ9", date: TODAY, start: "13:00", end: "14:00", kind: "planned" }];
  const n = removeOrphanSessions(d);
  assert.deepEqual(n.orphanSessions, []);
  assert.deepEqual(n.tasks, d.tasks);
  assert.equal(validate(n, { date: TODAY, time: "10:15" }).warnings.some((w) => w.includes("共有ファイルに無い")), false);
});

// ---- 今日のタスクの「実績にする」 ----
const at = (time) => ({ date: TODAY, time });
const sess = (d, id) => d.tasks.flatMap((t) => t.sessions ?? []).find((s) => s.id === id);

test("confirmTodaySession: 予定の枠を実績にし、To Do は In Progress にする（statusChanged）。時刻は変えない。元のデータは変えない", () => {
  const d = load();
  task(d, "AA-0004").sessions.push({ id: "S40", date: TODAY, start: "10:00", end: "11:00", kind: "planned" }, { id: "S41", date: TODAY, start: "08:00", end: "09:00", kind: "planned" });
  const r = confirmTodaySession(d, "S40", at("10:15"));
  assert.deepEqual([sess(r.data, "S40").kind, sess(r.data, "S40").start, sess(r.data, "S40").end], ["actual", "10:00", "11:00"], "まだ終わっていない枠も実績にする");
  assert.deepEqual([r.taskId, r.statusChanged, task(r.data, "AA-0004").status], ["AA-0004", true, "In Progress"]);
  assert.equal(sess(d, "S40").kind, "planned", "元のデータは変えない");
  ok(r.data);
  const r2 = confirmTodaySession(r.data, "S41", at("10:15"));
  assert.deepEqual([sess(r2.data, "S41").kind, r2.statusChanged], ["actual", false], "In Progress はそのまま（未確認の枠も実績にできる）");
});

test("confirmTodaySession: Waiting は In Progress にし、待ち先を外す（from に元の状態）", () => {
  const d = load();
  task(d, "AC-0002").sessions = [{ id: "S42", date: TODAY, start: "15:00", end: "16:00", kind: "planned" }];
  const w = confirmTodaySession(d, "S42", at("10:15"));
  assert.deepEqual([task(w.data, "AC-0002").status, task(w.data, "AC-0002").waitingOn, w.statusChanged, w.from], ["In Progress", null, true, "Waiting"]);
});

test("confirmTodaySession: ほかの実績の枠と重なる・明日以降の枠は Error で、データは変えない", () => {
  const d = load();
  task(d, "AA-0004").sessions.push({ id: "S43", date: TODAY, start: "10:00", end: "11:00", kind: "actual" });
  task(d, "AA-0005").sessions.push({ id: "S44", date: TODAY, start: "10:30", end: "11:30", kind: "planned" });
  assert.throws(() => confirmTodaySession(d, "S44", at("10:15")), /他の実績の枠（10:00〜11:00）と重なっています/);
  assert.throws(() => confirmTodaySession(load(), "S5", at("10:15")), /明日以降の枠は実績にできません/);
  assert.throws(() => confirmTodaySession(load(), "S99", at("10:15")), /枠 S99 がありません/);
});
