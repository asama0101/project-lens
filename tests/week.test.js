import { test } from "node:test";
import assert from "node:assert/strict";
import { weekTasks, weekSummary } from "../plugins/project-lens/src/core/week.js";

const WS = "2026-11-23"; // 月曜。日曜は 2026-11-29
const TODAY = "2026-11-25";
const task = (id, o = {}) => ({ id, title: id, projectId: "P1", status: "To Do", due: null, predecessors: [], sessions: [], ...o });
const plan = (id, date, start, end, actual) => ({ id, date, start, end, kind: "planned", ...(actual && { actual }) });
const act = (id, date, start, end) => ({ id, date, start, end, kind: "actual" });
const mk = (tasks, extra = {}) => ({ tasks, events: [], settings: {}, ...extra });
const rowOf = (data, id) => weekTasks(data, WS, TODAY).find((r) => r.task.id === id);
const groupOf = (data, id) => rowOf(data, id)?.group;

test("期限が週の中の未完了を、due の組に出す", () => {
  assert.equal(groupOf(mk([task("A", { due: "2026-11-27" })]), "A"), "due");
});
test("期限超過（due < today）の未完了は、overdue の組", () => {
  assert.equal(groupOf(mk([task("A", { due: "2026-11-24" })]), "A"), "overdue");
});
test("週の中に予定の枠か実績の区間のある未完了で、期限が週より後のものは scheduled の組", () => {
  const d = mk([task("A", { due: "2026-12-10", sessions: [plan("S1", "2026-11-26", "10:00", "11:00")] }), task("B", { due: "2026-12-10", sessions: [act("S2", "2026-11-24", "10:00", "11:00")] })]);
  assert.equal(groupOf(d, "A"), "scheduled");
  assert.equal(groupOf(d, "B"), "scheduled");
});
test("期限が今日以降で週の終わりより後の、枠も無い未完了は出ない", () => {
  assert.equal(groupOf(mk([task("A", { due: "2026-12-10" }), task("B")]), "A"), undefined);
  assert.equal(weekTasks(mk([task("A", { due: "2026-12-10" }), task("B")]), WS, TODAY).length, 0);
});
test("Done で doneAt が週の中、または週の中に枠か実績の区間があるものは done の組", () => {
  const d = mk([
    task("A", { status: "Done", doneAt: "2026-11-24" }),
    task("B", { status: "Done", doneAt: "2026-11-01", sessions: [plan("S1", "2026-11-25", "10:00", "11:00")] }),
    task("C", { status: "Done", doneAt: "2026-11-01", sessions: [act("S2", "2026-11-25", "10:00", "11:00")] }),
  ]);
  for (const id of ["A", "B", "C"]) assert.equal(groupOf(d, id), "done");
});
test("Done で、どちらも週の外のものは出ない", () => {
  assert.equal(groupOf(mk([task("A", { status: "Done", doneAt: "2026-11-01", sessions: [plan("S1", "2026-11-02", "10:00", "11:00")] })]), "A"), undefined);
});
test("Cancelled は、期限超過でも枠があっても、どの週にも出ない", () => {
  const d = mk([task("A", { status: "Cancelled", due: "2026-11-01", sessions: [plan("S1", "2026-11-25", "10:00", "11:00")] })]);
  assert.equal(groupOf(d, "A"), undefined);
});
test("境界: 期限が週の日曜は出る・次の月曜は（枠が無ければ）出ない", () => {
  const d = mk([task("A", { due: "2026-11-29" }), task("B", { due: "2026-11-30" })]);
  assert.equal(groupOf(d, "A"), "due");
  assert.equal(groupOf(d, "B"), undefined);
});
test("境界: doneAt が日曜は出る・次の月曜は出ない", () => {
  const d = mk([task("A", { status: "Done", doneAt: "2026-11-29" }), task("B", { status: "Done", doneAt: "2026-11-30" })]);
  assert.equal(groupOf(d, "A"), "done");
  assert.equal(groupOf(d, "B"), undefined);
});
test("複数の規則に当たるタスクは 1 行だけ（期限超過が優先）", () => {
  const d = mk([task("A", { due: "2026-11-20", sessions: [plan("S1", "2026-11-25", "10:00", "11:00")] })]);
  const rows = weekTasks(d, WS, TODAY);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].group, "overdue");
});
test("前のタスクが未完了なら waiting: true。完了、または存在しない ID だけなら false", () => {
  const d = mk([
    task("A", { due: "2026-11-27", predecessors: ["B"] }),
    task("B", { due: "2026-11-27" }),
    task("C", { due: "2026-11-27", predecessors: ["D"] }),
    task("D", { status: "Done", doneAt: "2026-11-01" }),
    task("E", { due: "2026-11-27", predecessors: ["ZZ"] }),
  ]);
  assert.equal(rowOf(d, "A").waiting, true);
  assert.equal(rowOf(d, "C").waiting, false);
  assert.equal(rowOf(d, "E").waiting, false);
});
test("projectId: null のタスクを含んでも、例外にならない", () => {
  const d = mk([task("A", { projectId: null, due: "2026-11-27", sessions: [plan("S1", "2026-11-26", "10:00", "11:00")] })]);
  assert.doesNotThrow(() => weekTasks(d, WS, TODAY));
});
test("並び: 組の順 → 期限 → ID", () => {
  const d = mk([
    task("D1", { status: "Done", doneAt: "2026-11-24" }),
    task("U2", { due: "2026-11-28" }),
    task("U1", { due: "2026-11-27" }),
    task("S1", { due: "2026-12-10", sessions: [plan("X1", "2026-11-26", "10:00", "11:00")] }),
    task("O2", { due: "2026-11-20" }),
    task("O1", { due: "2026-11-20" }),
    task("O0", { due: "2026-11-10" }),
  ]);
  assert.deepEqual(weekTasks(d, WS, TODAY).map((r) => r.task.id), ["O0", "O1", "O2", "S1", "U1", "U2", "D1"]);
});
test("planned・actual は週の日付の分。actual を持つ予定の枠も planned に数える。checked は無ければ null", () => {
  const d = mk([task("A", {
    due: "2026-11-27",
    checklist: [{ id: "c1", text: "a", done: true }, { id: "c2", text: "b", done: false }],
    sessions: [
      plan("S1", "2026-11-24", "10:00", "11:00", { date: "2026-11-24", start: "10:00", end: "10:45" }),
      plan("S2", "2026-11-25", "10:00", "10:30"),
      plan("S3", "2026-12-01", "10:00", "12:00"),
      act("S4", "2026-11-26", "13:00", "13:15"),
      act("S5", "2026-11-20", "13:00", "14:00"),
    ],
  }), task("B", { due: "2026-11-27" })]);
  const a = rowOf(d, "A");
  assert.equal(a.planned, 90);
  assert.equal(a.actual, 60);
  assert.deepEqual(a.checked, { done: 1, total: 2 });
  assert.equal(rowOf(d, "B").checked, null);
});
test("weekSummary: done / total / planned / actual / note", () => {
  const d = mk([
    task("A", { status: "Done", doneAt: "2026-11-24", sessions: [plan("S1", "2026-11-24", "10:00", "11:00", { date: "2026-11-24", start: "10:00", end: "10:30" })] }),
    task("B", { due: "2026-11-27", sessions: [plan("S2", "2026-11-25", "10:00", "10:30")] }),
  ], { reviews: { [WS]: "気づき" } });
  const s = weekSummary(d, WS, TODAY);
  assert.deepEqual({ done: s.done, total: s.total, planned: s.planned, actual: s.actual, note: s.note }, { done: 1, total: 2, planned: 90, actual: 30, note: "気づき" });
  assert.equal(s.rows.length, 2);
  assert.equal(weekSummary(mk([]), WS, TODAY).note, "");
});
