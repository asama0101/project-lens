import { test } from "node:test";
import assert from "node:assert/strict";
import { weekTasks, weekSummary, mondayOf, setReview, todayTasks, chaseTasks } from "../plugins/project-lens/src/core/week.js";

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

test("mondayOf: 月〜日は、その週の月曜日（日曜は前の月曜日）", () => {
  assert.equal(mondayOf("2026-10-19"), "2026-10-19");
  assert.equal(mondayOf("2026-10-20"), "2026-10-19");
  assert.equal(mondayOf("2026-10-25"), "2026-10-19");
  assert.equal(mondayOf("2026-10-26"), "2026-10-26");
});

test("setReview: 保存し、空文字でキーが消える", () => {
  const a = setReview(mk([]), "2026-10-19", "気づき");
  assert.deepEqual(a.reviews, { "2026-10-19": "気づき" });
  assert.deepEqual(setReview(a, "2026-10-19", "").reviews, {});
});

/* ---------- todayTasks（今日の ToDo） ---------- */
const todayIds = (data) => todayTasks(data, TODAY).map((r) => r.task.id);

test("todayTasks: 今日に予定の枠のあるタスクが出る。今日に実績だけの枠・実績（actual.date）のあるタスクも出る。今日に何も無いタスクは出ない", () => {
  const d = mk([
    task("A", { sessions: [plan("S1", TODAY, "10:00", "11:00")] }),
    task("B", { sessions: [act("S2", TODAY, "09:00", "09:30")] }),
    task("C", { sessions: [plan("S3", TODAY, "13:00", "14:00", { date: TODAY, start: "13:00", end: "13:30" })] }),
    task("D", { due: TODAY, sessions: [plan("S4", "2026-11-24", "10:00", "11:00")] }),
    task("E"),
  ]);
  assert.deepEqual(todayIds(d).sort(), ["A", "B", "C"]);
});
test("todayTasks: Cancelled は出ない。Done は末尾", () => {
  const d = mk([
    task("A", { status: "Done", sessions: [plan("S1", TODAY, "08:00", "09:00")] }),
    task("B", { status: "Cancelled", sessions: [plan("S2", TODAY, "08:00", "09:00")] }),
    task("C", { sessions: [plan("S3", TODAY, "15:00", "16:00")] }),
    task("D", { status: "In Progress", sessions: [plan("S4", TODAY, "10:00", "11:00")] }),
    task("E", { sessions: [plan("S5", TODAY, "10:00", "10:30")] }),
  ]);
  assert.deepEqual(todayIds(d), ["D", "E", "C", "A"], "未完了は今日の最初の枠の開始順（同じなら ID）、Done は末尾");
});
test("todayTasks: slots が開始の昇順。予定の枠が実績を持つとき、actual が付く", () => {
  const d = mk([task("A", { sessions: [
    plan("S1", TODAY, "15:00", "16:00", { date: TODAY, start: "15:10", end: "15:50" }),
    act("S2", TODAY, "09:00", "09:30"),
    plan("S3", TODAY, "11:00", "12:00"),
    plan("S4", "2026-11-26", "08:00", "09:00"),
  ] })]);
  const [r] = todayTasks(d, TODAY);
  assert.deepEqual(r.slots.map((s) => [s.id, s.start, s.end, s.kind]), [["S2", "09:00", "09:30", "actual"], ["S3", "11:00", "12:00", "planned"], ["S1", "15:00", "16:00", "planned"]]);
  assert.deepEqual(r.slots[2].actual, { date: TODAY, start: "15:10", end: "15:50" });
  assert.equal(r.slots[1].actual, undefined);
  assert.ok(r.slots.every((s) => s.date === TODAY));
});
test("todayTasks: planned・actual は今日の分だけ。waiting・checked は weekTasks と同じ", () => {
  const d = mk([
    task("P", { status: "In Progress" }),
    task("A", { predecessors: ["P"], checklist: [{ id: "c1", text: "一", done: true }, { id: "c2", text: "二", done: false }], sessions: [
      plan("S1", TODAY, "10:00", "11:00", { date: TODAY, start: "10:00", end: "10:45" }),
      plan("S2", TODAY, "13:00", "13:30"),
      plan("S3", "2026-11-24", "10:00", "12:00", { date: "2026-11-24", start: "10:00", end: "12:00" }),
      act("S4", "2026-11-26", "09:00", "10:00"),
      act("S5", TODAY, "16:00", "16:15"),
    ] }),
  ]);
  const [r] = todayTasks(d, TODAY);
  assert.equal(r.planned, 90);
  assert.equal(r.actual, 60);
  assert.equal(r.waiting, true);
  assert.deepEqual(r.checked, { done: 1, total: 2 });
});
test("todayTasks: 予定の枠が別の日にあって、実績だけが今日にあるタスクも出る（今日の枠は、実績の時刻の actual）。予定の枠が今日で、実績が別の日なら、今日の予定の枠で、その actual が付く", () => {
  const d = mk([
    task("A", { sessions: [plan("S1", "2026-11-24", "10:00", "11:00", { date: TODAY, start: "14:00", end: "15:00" })] }),
    task("B", { sessions: [plan("S2", TODAY, "09:00", "10:00", { date: "2026-11-24", start: "09:00", end: "10:00" })] }),
  ]);
  const rows = todayTasks(d, TODAY);
  const a = rows.find((r) => r.task.id === "A"), b = rows.find((r) => r.task.id === "B");
  assert.deepEqual(a.slots.map((s) => [s.id, s.start, s.end, s.kind]), [["S1", "14:00", "15:00", "actual"]]);
  assert.deepEqual([a.planned, a.actual], [0, 60]);
  assert.deepEqual(b.slots.map((s) => [s.id, s.start, s.end, s.kind, s.actual]), [["S2", "09:00", "10:00", "planned", { date: "2026-11-24", start: "09:00", end: "10:00" }]]);
  assert.deepEqual([b.planned, b.actual], [60, 0]);
});
test("todayTasks: slots とタスクの並びは、今日に見せる時刻（actual が今日なら actual の開始）の順", () => {
  const d = mk([
    task("A", { sessions: [plan("S1", TODAY, "08:00", "09:00", { date: TODAY, start: "14:00", end: "15:00" }), plan("S2", TODAY, "10:00", "11:00")] }),
    task("B", { sessions: [plan("S3", TODAY, "12:00", "13:00")] }),
    task("C", { sessions: [plan("S4", TODAY, "07:00", "08:00", { date: "2026-11-24", start: "13:00", end: "14:00" })] }),
  ]);
  const rows = todayTasks(d, TODAY);
  assert.deepEqual(rows.map((r) => r.task.id), ["C", "A", "B"], "A の最初は 10:00（S1 は今日 14:00 に見せる）。C の実績は別の日なので予定の 07:00");
  assert.deepEqual(rows[1].slots.map((s) => s.id), ["S2", "S1"]);
});
test("todayTasks: projectId が null のタスクで例外にならない", () => {
  const d = mk([task("A", { projectId: null, sessions: [plan("S1", TODAY, "10:00", "11:00")] })]);
  assert.deepEqual(todayIds(d), ["A"]);
});

// ---- chaseTasks（催促の対象） ----
const wt = (id, w, o = {}) => task(id, { status: "Waiting", waitingOn: w, ...o });
const chase = (tasks, settings = {}) => chaseTasks(mk(tasks, { settings }), TODAY);
const ids = (rows) => rows.map((r) => r.task.id);

test("chaseTasks: 予定日が昨日は入り（lapsedDays 1）、今日・明日は入らない", () => {
  const rows = chase([wt("A", { party: "X", since: "2026-11-20", expected: "2026-11-24" }), wt("B", { party: "X", since: "2026-11-20", expected: TODAY }), wt("C", { party: "X", since: "2026-10-01", expected: "2026-11-26" })]);
  assert.deepEqual(ids(rows), ["A"]);
  assert.deepEqual([rows[0].party, rows[0].since, rows[0].expected, rows[0].lapsedDays, rows[0].waitedDays], ["X", "2026-11-20", "2026-11-24", 1, 5]);
});
test("chaseTasks: 予定日なしは、待ち始めから 7 日で入り、6 日では入らない。待ち始めなしは入らない", () => {
  const rows = chase([wt("A", { party: "X", since: "2026-11-18" }), wt("B", { party: "X", since: "2026-11-19" }), wt("C", { party: "X" })]);
  assert.deepEqual(ids(rows), ["A"]);
  assert.deepEqual([rows[0].lapsedDays, rows[0].waitedDays], [null, 7]);
});
test("chaseTasks: Waiting 以外は入らない", () => {
  assert.deepEqual(chase([task("A", { status: "In Progress", waitingOn: { party: "X", since: "2026-01-01" } })]), []);
});
test("chaseTasks: 並びは、超過日数の多い順、予定日なしの待ち日数の多い順、ID", () => {
  const rows = chase([
    wt("D", { party: "X", since: "2026-11-10" }),
    wt("C", { party: "X", since: "2026-11-01" }),
    wt("B", { party: "X", since: "2026-11-01", expected: "2026-11-23" }),
    wt("A", { party: "X", since: "2026-11-01", expected: "2026-11-24" }),
    wt("E", { party: "X", since: "2026-11-10" }),
    wt("F", { party: "X", since: "2026-11-01", expected: "2026-11-23" }),
  ]);
  assert.deepEqual(ids(rows), ["B", "F", "A", "C", "D", "E"]);
});
test("chaseTasks: waitingLongDays で境界が変わる", () => {
  const t = [wt("A", { party: "X", since: "2026-11-22" })];
  assert.deepEqual(chase(t), []);
  assert.deepEqual(ids(chase(t, { waitingLongDays: 3 })), ["A"]);
});
test("chaseTasks: 超過日数が同じなら、待ち始めに関わらず ID の順", () => {
  const rows = chase([wt("B", { party: "X", since: "2026-11-20", expected: "2026-11-23" }), wt("A", { party: "X", since: "2026-11-01", expected: "2026-11-23" })]);
  assert.deepEqual(ids(rows), ["A", "B"]);
  const rev = chase([wt("A", { party: "X", since: "2026-11-24", expected: "2026-11-23" }), wt("B", { party: "X", since: "2026-11-01", expected: "2026-11-23" })]);
  assert.deepEqual(ids(rev), ["A", "B"]);
});
test("chaseTasks: 不正な since・expected は無いものとして扱い、例外にしない", () => {
  const rows = chase([
    wt("A", { party: "X", since: "2026-11-01", expected: "abc" }),
    wt("B", { party: "X", since: "xx", expected: "2026-11-20" }),
    wt("C", { party: "X", since: "xx" }),
  ]);
  assert.deepEqual(ids(rows), ["B", "A"]);
  assert.equal(rows[0].waitedDays, null);
  assert.equal(rows[1].expected, null);
});
test("chaseTasks: waitingOn が null・無しの Waiting は入れず、例外にしない", () => {
  assert.deepEqual(chase([wt("A", null), task("B", { status: "Waiting" })]), []);
});
