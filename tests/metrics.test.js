import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addDays, weekday } from "../plugins/project-lens/src/core/dates.js";
import { taskStart, ganttRows, ganttLayout, timeTicks, projectProgress, taskFlags, projectFlags } from "../plugins/project-lens/src/core/metrics.js";

const load = () => JSON.parse(readFileSync(new URL("../plugins/project-lens/data/sample.json", import.meta.url), "utf8"));
const TODAY = "2026-10-20";
const range = (start, days) => ({ start, end: addDays(start, days - 1) });
const mk = (tasks, extra = {}) => ({
  settings: { waitingLongDays: 7 },
  projects: [{ id: "AA", name: "p", status: "進行中", start: "2026-10-01", due: "2026-12-31", milestones: [], ...extra }],
  tasks: tasks.map((t) => ({ projectId: "AA", status: "To Do", start: null, predecessors: [], sessions: [], waitingOn: null, doneAt: null, ...t })),
  events: [], changeLog: [],
});

test("ganttLayout: 表示期間ごとの visibleDays / ratio / scale", () => {
  const r = range("2026-01-01", 580);
  const m6 = ganttLayout(r, "m6");
  assert.equal(m6.visibleDays, 183);
  assert.ok(Math.abs(m6.ratio - 580 / 183) < 1e-9);
  assert.equal(m6.scale, "month");
  assert.deepEqual([ganttLayout(r, "all").ratio, ganttLayout(r, "all").scale], [1, "quarter"]);
  assert.equal(ganttLayout(r, "m1").scale, "day");
  assert.equal(ganttLayout(r, "m3").scale, "week");
  assert.equal(ganttLayout(range("2026-01-01", 30), "y1").scale, "day");
  const s = ganttLayout(range("2026-01-01", 60), "y1");
  assert.deepEqual([s.visibleDays, s.ratio], [60, 1]);
});

test("timeTicks: 日・週・月・四半期", () => {
  const r = range("2026-10-25", 14);
  const days = timeTicks(r, "day");
  assert.equal(days.length, 14);
  assert.equal(days.find((t) => t.date === "2026-11-01").label, "11/1");
  const rr = { start: "2026-10-05", end: "2027-02-10" };
  const months = timeTicks(rr, "month");
  assert.deepEqual(months.map((t) => t.label), ["10月", "11月", "12月", "2027/1", "2月"]);
  assert.equal(months.find((t) => t.label === "2027/1").yearStart, true);
  assert.equal(months[0].date, "2026-10-05"); // 範囲開始より前の月初は範囲開始に寄せる
  assert.deepEqual(timeTicks(rr, "quarter").map((t) => t.label), ["2026 Q4", "2027 Q1"]);
  const weeks = timeTicks(rr, "week");
  assert.ok(weeks.every((t) => weekday(t.date) === 1));
  const long = timeTicks(range("2026-01-01", 546), "month");
  assert.equal(long.length, 18);
});

test("taskStart: start があればそれ／なければ前のタスクの期限の最大値／それもなければ due", () => {
  const d = mk([
    { id: "AA-0001", due: "2026-10-10" }, { id: "AA-0002", due: "2026-10-14" },
    { id: "AA-0003", due: "2026-10-30", start: "2026-10-01", predecessors: ["AA-0001", "AA-0002"] },
    { id: "AA-0004", due: "2026-10-30", start: "2026-10-05" }, { id: "AA-0005", due: "2026-10-30" },
    { id: "AA-0006", due: "2026-10-30", predecessors: ["AA-0001", "AA-0002"] },
  ]);
  assert.equal(taskStart(d, "AA-0003"), "2026-10-01"); // start を指定したら、前のタスクがあってもその日
  assert.equal(taskStart(d, "AA-0006"), "2026-10-14");
  assert.equal(taskStart(d, "AA-0004"), "2026-10-05");
  assert.equal(taskStart(d, "AA-0005"), "2026-10-30");
});

test("ganttRows: 行・point・マイルストーン", () => {
  const d = load();
  const g = ganttRows(d, "AA");
  assert.equal(g.rows.length, d.tasks.filter((t) => t.projectId === "AA").length);
  const a2 = g.rows.find((r) => r.taskId === "AA-0002");
  assert.deepEqual([a2.start, a2.end, a2.point], ["2026-07-31", "2026-08-20", false]);
  assert.deepEqual(g.milestones.map((m) => m.name), ["機器発注", "本番切替"]);
  assert.ok(g.range.start <= "2026-06-01" && g.range.end >= "2027-03-31");
  // 点は、開始も前のタスクもない（期限だけの）タスクに限る。開始が期限以後のタスク・前のタスクがあるタスクは、期限の 1 日分の棒
  const rowOf = (t) => ganttRows(mk([{ id: "AA-0009", due: "2026-10-01" }, t]), "AA").rows.find((r) => r.taskId === t.id);
  assert.deepEqual([rowOf({ id: "AA-0001", due: "2026-10-05" })].map((r) => [r.start, r.end, r.point]), [["2026-10-05", "2026-10-05", true]]);
  assert.deepEqual([rowOf({ id: "AA-0001", due: "2026-10-05", start: "2026-10-05" })].map((r) => [r.start, r.end, r.point]), [["2026-10-05", "2026-10-05", false]]);
  assert.deepEqual([rowOf({ id: "AA-0001", due: "2026-10-05", start: "2026-10-20" })].map((r) => [r.start, r.end, r.point]), [["2026-10-05", "2026-10-05", false]]);
  assert.deepEqual([rowOf({ id: "AA-0001", due: "2026-10-01", predecessors: ["AA-0009"] })].map((r) => [r.start, r.end, r.point]), [["2026-10-01", "2026-10-01", false]], "前のタスクの期限と同じ日");
  assert.deepEqual(ganttRows(mk([]), "AA").rows, []);
});

test("projectProgress: Cancelled を除いた Done の割合", () => {
  const d = mk([{ id: "1", status: "Done" }, { id: "2", status: "Cancelled" }, { id: "3", status: "In Progress" }, { id: "4" }]);
  const p = projectProgress(d, "AA");
  assert.deepEqual([p.done, p.total], [1, 3]);
  assert.equal(p.rate, 1 / 3);
  assert.equal(projectProgress(mk([]), "AA").rate, 0);
});

test("taskFlags / projectFlags", () => {
  const s = { waitingLongDays: 7 };
  assert.deepEqual(taskFlags({ status: "To Do", due: "2026-10-19" }, TODAY, s), ["overdue"]);
  assert.deepEqual(taskFlags({ status: "Done", due: "2026-10-19" }, TODAY, s), []);
  assert.ok(taskFlags({ status: "Waiting", due: "2027-01-01", waitingOn: { party: "x", since: "2026-10-13" } }, TODAY, s).includes("waiting-long"));
  assert.ok(!taskFlags({ status: "Waiting", due: "2027-01-01", waitingOn: { party: "x", since: "2026-10-14" } }, TODAY, s).includes("waiting-long"));
  const d = load();
  assert.deepEqual(projectFlags(d, "AA", TODAY).sort(), ["overdue-tasks", "waiting-long"]);
  const late = mk([{ id: "1" }], { due: "2026-10-01" });
  assert.ok(projectFlags(late, "AA", TODAY).includes("past-due"));
});

test("週目盛り: 年をまたぐ週に yearStart が付く（M7）", () => {
  const w = timeTicks({ start: "2026-12-14", end: "2027-01-20" }, "week");
  assert.deepEqual(w.filter((t) => t.yearStart).map((t) => t.date), ["2026-12-28"]);
});

test("taskFlags: since が無くても落ちない（I4）", () => {
  assert.deepEqual(taskFlags({ status: "Waiting", due: "2027-01-01", waitingOn: { party: "x" } }, TODAY, { waitingLongDays: 7 }), []);
});

test("timeTicks: 年の打ち間違いで範囲が数百年になっても、日・週の目盛りは 4000 個までで止める", () => {
  const r = { start: "2026-01-01", end: "2226-05-01" };
  assert.equal(timeTicks(r, "day").length, 4000);
  assert.ok(timeTicks(r, "week").length <= 4000);
  assert.equal(timeTicks({ start: "2026-01-01", end: "2026-01-31" }, "day").length, 31, "通常の範囲は変わらない");
});

test("プロジェクトなしのタスク（ZZ-0001）は、プロジェクトの進捗・旗の数に入らない。ganttRows は projectId が null でも動く", () => {
  const d = load();
  assert.ok(d.tasks.some((t) => t.id === "ZZ-0001" && t.projectId === null));
  assert.equal(projectProgress(d, "AA").total, d.tasks.filter((t) => t.projectId === "AA" && t.status !== "Cancelled").length);
  for (const p of d.projects) assert.ok(!ganttRows(d, p.id).rows.some((r) => r.taskId === "ZZ-0001"));
  const g = ganttRows(d, null);
  assert.deepEqual(g.rows.map((r) => r.taskId), ["ZZ-0001"]);
  assert.deepEqual(g.milestones, []);
});

