import { test } from "node:test";
import assert from "node:assert/strict";
import { projectHours, workload, periodRange } from "../plugins/project-lens/src/core/workload.js";
import { readFileSync } from "node:fs";

const sess = (id, date, start, end, kind = "actual") => ({ id, date, start, end, kind });
const task = (id, projectId, sessions = []) => ({ id, projectId, title: id, due: "2026-12-31", status: "To Do", sessions });
const mtg = (id, date, start, end, extra = {}) => ({ id, date, start, end, title: id, source: "manual", skip: false, externalId: null, ...extra });
const data = (tasks, events) => ({ projects: [{ id: "AA" }, { id: "AB" }], tasks, events, changeLog: [], settings: {} });
const D = "2026-10-20";

test("projectHours: 実績の作業枠＋確認済みで参加する会議。予定・未確認・skip は含まない", () => {
  const d = data(
    [task("AA-0001", "AA", [sess("S1", D, "09:00", "10:30"), sess("S2", D, "11:00", "12:00", "planned")]), task("AB-0001", "AB", [sess("S3", D, "13:00", "14:00")])],
    [mtg("m1", D, "10:30", "11:30", { projectId: "AA", confirmed: true }), mtg("m2", D, "14:00", "15:00", { projectId: "AA" }),
     mtg("m3", D, "15:00", "16:00", { projectId: "AA", confirmed: true, skip: true })],
  );
  assert.deepEqual(projectHours(d, "AA"), { task: 1.5, meeting: 1 });
  assert.deepEqual(projectHours(d, "AB"), { task: 1, meeting: 0 });
});

test("workload: 期間の外は含めない。プロジェクト未設定／存在しないプロジェクトの会議は unassigned", () => {
  const d = data(
    [task("AA-0001", "AA", [sess("S1", D, "09:00", "10:00"), sess("S2", "2026-11-20", "09:00", "10:00")])],
    [mtg("m1", D, "10:00", "11:00", { confirmed: true }), mtg("m2", D, "11:00", "11:30", { projectId: "ZZ", confirmed: true }),
     mtg("m3", "2026-11-20", "10:00", "11:00", { confirmed: true, projectId: "AA" })],
  );
  const w = workload(d, { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(w.unassigned, { task: 0, meeting: 1.5 });
  assert.deepEqual(w.rows.find((r) => r.projectId === "AA"), { projectId: "AA", task: 1, meeting: 0, total: 1 });
  assert.equal(w.total, 2.5);
});

test("workload: projectId が null のタスクの実績の枠は unassigned.task。予定の枠は数えない", () => {
  const d = data([task("ZZ-0001", null, [sess("S1", D, "09:00", "09:30"), sess("S2", D, "10:00", "11:00", "planned")])], []);
  const w = workload(d, { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(w.unassigned, { task: 0.5, meeting: 0 });
  assert.equal(w.total, 0.5);
});

test("workload: 全プロジェクトが rows に並ぶ（0 時間でも）。total は rows の合計＋unassigned", () => {
  const d = data([task("AA-0001", "AA", [sess("S1", D, "09:00", "10:00")])], [mtg("m1", D, "10:00", "11:00", { confirmed: true })]);
  const w = workload(d, { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(w.rows.map((r) => r.projectId), ["AA", "AB"]);
  assert.equal(w.rows[1].total, 0);
  assert.equal(w.total, w.rows.reduce((a, r) => a + r.total, 0) + w.unassigned.task + w.unassigned.meeting);
});

test("workload: unconfirmed は過ぎた未確認の枠と会議の件数（now 省略時は 0）", () => {
  const d = data(
    [task("AA-0001", "AA", [sess("S1", D, "09:00", "10:00", "planned"), sess("S2", D, "17:00", "18:00", "planned")])],
    [mtg("m1", D, "10:00", "11:00"), mtg("m2", D, "11:00", "12:00", { skip: true }), mtg("m3", D, "12:00", "13:00", { confirmed: true })],
  );
  const now = { date: D, time: "14:00" };
  const r = { start: "2026-10-19", end: "2026-10-25" };
  assert.equal(workload(d, r, now).unconfirmed, 2, "S1 と m1");
  assert.equal(workload(d, r).unconfirmed, 0);
});

test("workload: 確認済みの会議は actual の時間で数える", () => {
  const d = data([], [mtg("m1", D, "10:00", "11:00", { confirmed: true, projectId: "AA", actual: { start: "10:05", end: "10:50" } })]);
  assert.equal(workload(d, null).rows[0].meeting, 0.75);
});

test("workload: confirmed だけで actual の無い会議は、予定の時間で数える", () => {
  const d = data([], [mtg("m1", D, "10:00", "11:00", { confirmed: true, projectId: "AA" })]);
  assert.equal(workload(d, null).rows[0].meeting, 1);
  assert.equal(projectHours(d, "AA").meeting, 1);
});

test("workload: unconfirmed は、重なる実績の無い過ぎた予定の枠と、過ぎた会議の件数", () => {
  const d = data([task("AA-0001", "AA", [sess("S1", D, "09:00", "10:00", "planned"), sess("S2", D, "11:00", "12:00", "planned"), sess("S3", D, "09:10", "09:50", "actual")])], []);
  assert.equal(workload(d, null, { date: D, time: "14:00" }).unconfirmedTasks, 1);
});

test("periodRange: day はその日だけ、week は月曜〜日曜、month は 2028-02 で 29 日まで", () => {
  assert.deepEqual(periodRange("day", "2026-10-20"), { start: "2026-10-20", end: "2026-10-20" });
  assert.deepEqual(periodRange("week", "2026-10-20"), { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(periodRange("week", "2026-10-25"), { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(periodRange("month", "2028-02-10"), { start: "2028-02-01", end: "2028-02-29" });
  assert.deepEqual(periodRange("month", "2026-12-31"), { start: "2026-12-01", end: "2026-12-31" });
});

const planned = (id, date, start, end, actual) => ({ id, date, start, end, kind: "planned", ...(actual && { actual }) });

test("workload: 予定の枠の actual の時間が、actual.date の日・持ち主のプロジェクトに数えられる", () => {
  const d = data([task("AA-0001", "AA", [planned("S1", D, "09:00", "10:00", { date: D, start: "09:10", end: "10:40" })])], []);
  assert.deepEqual(projectHours(d, "AA"), { task: 1.5, meeting: 0 });
  const w = workload(d, periodRange("day", D));
  assert.deepEqual(w.rows[0], { projectId: "AA", task: 1.5, meeting: 0, total: 1.5 });
});

test("workload: 予定の枠を別の日へ動かしても、実績は actual.date の日に数える", () => {
  const d = data([task("AA-0001", "AA", [planned("S1", "2026-10-27", "09:00", "10:00", { date: D, start: "09:00", end: "10:00" })])], []);
  assert.equal(workload(d, periodRange("day", D)).rows[0].task, 1);
  assert.equal(workload(d, periodRange("day", "2026-10-27")).rows[0].task, 0);
});

test("workload: 今の形のデータの数字は変わらない（サンプルの S8: 2026-10-15 の 09:10〜10:10 が AC に 1h）", () => {
  const d = JSON.parse(readFileSync(new URL("../plugins/project-lens/data/sample.json", import.meta.url), "utf8"));
  const w = workload(d, periodRange("day", "2026-10-15"));
  assert.equal(w.rows.find((r) => r.projectId === "AC").task, 1);
});
