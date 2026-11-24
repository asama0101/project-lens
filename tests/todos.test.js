import { test } from "node:test";
import assert from "node:assert/strict";
import { mondayOf, addTodo, renameTodo, setTodoDone, deleteTodo, assignToDay, carryTodo, addTodoCheck, toggleTodoCheck, removeTodoCheck, setReview, todoMinutes, weekReview } from "../plugins/project-lens/src/core/todos.js";
import { allSessions } from "../plugins/project-lens/src/core/sessions.js";

const base = (todos = [], extra = {}) => ({ tasks: [], events: [], settings: {}, todos, ...extra });
const todo = (o) => ({ scope: "day", title: "x", date: "2026-10-20", doneAt: null, carried: 0, sessions: [], ...o });
const slot = (id, date, start, end, kind = "planned") => ({ id, date, start, end, kind });
const freeze = (d) => JSON.parse(JSON.stringify(d));

test("mondayOf: 月曜日・日曜日・週の途中", () => {
  assert.equal(mondayOf("2026-10-20"), "2026-10-19");
  assert.equal(mondayOf("2026-10-25"), "2026-10-19");
  assert.equal(mondayOf("2026-10-19"), "2026-10-19");
});

test("addTodo: ID の採番・週は月曜に正規化・件名の空白除去・不正は例外", () => {
  const a = addTodo({ tasks: [], events: [] }, { scope: "week", title: " 資料 ", date: "2026-10-22" });
  assert.equal(a.id, "T-0001");
  assert.deepEqual(a.data.todos[0], { id: "T-0001", scope: "week", title: "資料", date: "2026-10-19", doneAt: null, carried: 0, sessions: [] });
  const b = addTodo(a.data, { scope: "day", title: "メール", date: "2026-10-22" });
  assert.equal(b.id, "T-0002");
  assert.equal(b.data.todos[1].date, "2026-10-22");
  assert.throws(() => addTodo(b.data, { scope: "day", title: "  ", date: "2026-10-22" }), /件名/);
  const c = addTodo(b.data, { scope: "day", title: "子", date: "2026-10-22", parentId: "T-0001" });
  assert.equal(c.data.todos[2].parentId, "T-0001");
  assert.throws(() => addTodo(b.data, { scope: "day", title: "子", date: "2026-10-22", parentId: "T-0002" }), /週の ToDo/);
  assert.throws(() => addTodo(b.data, { scope: "day", title: "子", date: "2026-10-22", parentId: "T-9999" }), /週の ToDo/);
});

test("renameTodo: 週の件名を直すと同じ件名の子も変わり、別の件名の子は変わらない", () => {
  const d = freeze(base([todo({ id: "T-0001", scope: "week", title: "旧", date: "2026-10-19" }), todo({ id: "T-0002", title: "旧", parentId: "T-0001" }), todo({ id: "T-0003", title: "別", parentId: "T-0001" })]));
  const before = freeze(d);
  const r = renameTodo(d, "T-0001", " 新 ");
  assert.deepEqual(r.todos.map((t) => t.title), ["新", "新", "別"]);
  assert.deepEqual(d, before);
  assert.deepEqual(renameTodo(d, "T-0002", "子だけ").todos.map((t) => t.title), ["旧", "子だけ", "別"]);
  assert.throws(() => renameTodo(d, "T-0001", " "), /件名/);
});

test("setTodoDone: doneAt を today か null に", () => {
  const d = base([todo({ id: "T-0001" })]);
  const r = setTodoDone(d, "T-0001", true, "2026-10-21");
  assert.equal(r.todos[0].doneAt, "2026-10-21");
  assert.equal(setTodoDone(r, "T-0001", false, "2026-10-21").todos[0].doneAt, null);
  assert.equal(d.todos[0].doneAt, null);
});

test("deleteTodo: 週を消すと子の parentId が外れ子の枠は残る。ToDo の枠も消える", () => {
  const d = base([
    todo({ id: "T-0001", scope: "week", date: "2026-10-19", sessions: [slot("S1", "2026-10-20", "09:00", "10:00")] }),
    todo({ id: "T-0002", parentId: "T-0001", sessions: [slot("S2", "2026-10-20", "11:00", "12:00")] }),
  ]);
  const r = deleteTodo(d, "T-0001");
  assert.equal(r.todos.length, 1);
  assert.equal("parentId" in r.todos[0], false);
  assert.deepEqual(allSessions(r).map((s) => s.id), ["S2"]);
  assert.equal(d.todos[1].parentId, "T-0001");
});

test("assignToDay: 1 回目は作る、同じ日の 2 回目は何もしない、日の ToDo は例外", () => {
  const d = base([todo({ id: "T-0001", scope: "week", title: "週", date: "2026-10-19" })]);
  const a = assignToDay(d, "T-0001", "2026-10-21");
  assert.equal(a.created, true);
  assert.deepEqual(a.data.todos[1], { id: "T-0002", scope: "day", title: "週", date: "2026-10-21", parentId: "T-0001", doneAt: null, carried: 0, sessions: [] });
  const b = assignToDay(a.data, "T-0001", "2026-10-21");
  assert.equal(b.created, false);
  assert.equal(b.data, a.data);
  assert.equal(assignToDay(a.data, "T-0001", "2026-10-22").created, true);
  assert.throws(() => assignToDay(a.data, "T-0002", "2026-10-22"), /週の ToDo/);
});

test("carryTodo: 日は次の営業日（金→月、休みをまたぐと火）、週は +7 日、carried が増える", () => {
  const d = base([todo({ id: "T-0001", date: "2026-10-23" })]);
  const r = carryTodo(d, "T-0001");
  assert.equal(r.todos[0].date, "2026-10-26");
  assert.equal(r.todos[0].carried, 1);
  const h = base([todo({ id: "T-0001", date: "2026-10-23" })], { settings: { holidays: [{ date: "2026-10-26" }] } });
  assert.equal(carryTodo(h, "T-0001").todos[0].date, "2026-10-27");
  const w = base([todo({ id: "T-0001", scope: "week", date: "2026-10-19", carried: 2 })]);
  const rw = carryTodo(w, "T-0001");
  assert.equal(rw.todos[0].date, "2026-10-26");
  assert.equal(rw.todos[0].carried, 3);
});

test("carryTodo: 完了は例外。回す前の日の予定の枠は消え、実績が重なる予定と実績は残る", () => {
  const sessions = [
    slot("S1", "2026-10-23", "09:00", "10:00"),
    slot("S2", "2026-10-23", "11:00", "12:00"),
    slot("S3", "2026-10-23", "11:30", "12:30", "actual"),
    slot("S4", "2026-10-23", "14:00", "15:00", "actual"),
    slot("S5", "2026-10-28", "09:00", "10:00"),
  ];
  const d = base([todo({ id: "T-0001", date: "2026-10-23", sessions })]);
  const r = carryTodo(d, "T-0001");
  assert.deepEqual(r.todos[0].sessions.map((s) => s.id), ["S2", "S3", "S4", "S5"]);
  assert.throws(() => carryTodo(base([todo({ id: "T-0001", doneAt: "2026-10-20" })]), "T-0001"), /完了した ToDo は回せません/);
});

test("チェックリスト: 追加・切り替え・削除、空は例外", () => {
  let d = base([todo({ id: "T-0001" })]);
  d = addTodoCheck(d, "T-0001", " 一 ");
  d = addTodoCheck(d, "T-0001", "二");
  assert.deepEqual(d.todos[0].checklist, [{ id: "c1", text: "一", done: false }, { id: "c2", text: "二", done: false }]);
  d = toggleTodoCheck(d, "T-0001", "c2");
  assert.equal(d.todos[0].checklist[1].done, true);
  d = removeTodoCheck(d, "T-0001", "c1");
  assert.deepEqual(d.todos[0].checklist.map((x) => x.id), ["c2"]);
  assert.throws(() => addTodoCheck(d, "T-0001", "  "), /文言/);
});

test("setReview: 保存し、空文字でキーが消える", () => {
  const a = setReview(base(), "2026-10-19", "気づき");
  assert.deepEqual(a.reviews, { "2026-10-19": "気づき" });
  assert.deepEqual(setReview(a, "2026-10-19", "").reviews, {});
});

const week = () => base([
  todo({ id: "T-0001", scope: "week", date: "2026-10-19", doneAt: "2026-10-23", checklist: [{ id: "c1", text: "a", done: true }, { id: "c2", text: "b", done: false }], sessions: [slot("S1", "2026-10-20", "09:00", "10:00")] }),
  todo({ id: "T-0002", date: "2026-10-21", parentId: "T-0001", doneAt: "2026-10-21", sessions: [slot("S2", "2026-10-21", "09:00", "10:30", "actual"), slot("S3", "2026-10-14", "09:00", "10:00", "actual")] }),
  todo({ id: "T-0003", date: "2026-10-22", sessions: [slot("S4", "2026-10-22", "13:00", "13:30")] }),
  todo({ id: "T-0004", date: "2026-10-26", carried: 1, sessions: [slot("S5", "2026-10-26", "09:00", "10:00")] }),
]);

test("todoMinutes: 自分と子の枠の合計。範囲外は含まない", () => {
  const d = week();
  assert.deepEqual(todoMinutes(d, "T-0001"), { planned: 60, actual: 150 });
  assert.deepEqual(todoMinutes(d, "T-0001", { start: "2026-10-19", end: "2026-10-25" }), { planned: 60, actual: 90 });
  assert.deepEqual(todoMinutes(d, "T-0002"), { planned: 0, actual: 150 });
});

test("weekReview: 件数・分数・行の並び。子は数えず、回した先の ToDo は入らない", () => {
  const r = weekReview(week(), "2026-10-19");
  assert.equal(r.total, 2);
  assert.equal(r.done, 1);
  assert.equal(r.planned, 90);
  assert.equal(r.actual, 90);
  assert.equal(r.note, "");
  assert.deepEqual(r.rows.map((x) => x.todo.id), ["T-0001", "T-0003"]);
  assert.deepEqual(r.rows[0].checked, { done: 1, total: 2 });
  assert.equal(r.rows[1].checked, null);
  assert.ok(r.done <= r.total);
  assert.equal(weekReview(setReview(week(), "2026-10-19", "メモ"), "2026-10-19").note, "メモ");
  assert.equal(weekReview(week(), "2026-10-26").total, 1);
});

test("data.todos / data.reviews が無くても読める", () => {
  const d = { tasks: [], events: [], settings: {} };
  assert.deepEqual(weekReview(d, "2026-10-19"), { done: 0, total: 0, planned: 0, actual: 0, note: "", rows: [] });
});

test("weekReview: 回した ToDo の、回す前の週にある枠は、旧週の見出しと行（inWeek: false）に残り、新週には入らない", () => {
  const d = carryTodo(base([todo({ id: "T-0001", date: "2026-10-23", sessions: [slot("S1", "2026-10-23", "09:00", "10:00", "actual")] })]), "T-0001");
  assert.equal(d.todos[0].date, "2026-10-26");
  const old = weekReview(d, "2026-10-19");
  assert.equal(old.actual, 60);
  assert.equal(old.total, 0);
  assert.equal(old.done, 0);
  assert.deepEqual(old.rows.map((r) => [r.todo.id, r.inWeek, r.actual]), [["T-0001", false, 60]]);
  const cur = weekReview(d, "2026-10-26");
  assert.deepEqual([cur.actual, cur.total], [0, 1]);
  assert.deepEqual(cur.rows.map((r) => [r.todo.id, r.inWeek, r.actual]), [["T-0001", true, 0]]);
});

test("weekReview: 週の ToDo の子を回しても、旧週の見出しと親の行が子の分を含む。親が別の週にいても親の行に含む", () => {
  const w = week2();
  const d = carryTodo(w, "T-0002");
  const r = weekReview(d, "2026-10-19");
  assert.equal(r.actual, 180);
  assert.deepEqual(r.rows.map((x) => [x.todo.id, x.inWeek, x.actual]), [["T-0001", true, 120], ["T-0003", true, 60]]);
  assert.equal(r.rows.reduce((m, x) => m + x.actual, 0), r.actual);
  const far = carryTodo(carryTodo(d, "T-0001"), "T-0001");
  const r2 = weekReview(far, "2026-10-19");
  assert.equal(r2.actual, 180);
  assert.deepEqual(r2.rows.map((x) => [x.todo.id, x.inWeek, x.actual]), [["T-0003", true, 60], ["T-0001", false, 120]]);
  assert.equal(r2.total, 1);
});
const week2 = () => base([
  todo({ id: "T-0001", scope: "week", date: "2026-10-19", sessions: [slot("S1", "2026-10-20", "09:00", "10:00", "actual")] }),
  todo({ id: "T-0002", date: "2026-10-23", parentId: "T-0001", sessions: [slot("S2", "2026-10-23", "09:00", "10:00", "actual")] }),
  todo({ id: "T-0003", date: "2026-10-22", sessions: [slot("S3", "2026-10-22", "09:00", "10:00", "actual")] }),
]);

test("weekReview: parentId が null の日の ToDo も、親なしとして行に出す", () => {
  const r = weekReview(base([todo({ id: "T-0001", parentId: null })]), "2026-10-19");
  assert.deepEqual(r.rows.map((x) => x.todo.id), ["T-0001"]);
});

test("チェックリスト: 存在しない ToDo の id は例外", () => {
  const d = base([todo({ id: "T-0001" })]);
  assert.throws(() => addTodoCheck(d, "T-9", "a"), /ToDo T-9 がありません/);
  assert.throws(() => toggleTodoCheck(d, "T-9", "c1"), /ToDo T-9 がありません/);
  assert.throws(() => removeTodoCheck(d, "T-9", "c1"), /ToDo T-9 がありません/);
});

const withActual = (id, date, start, end, a) => ({ ...slot(id, date, start, end), actual: a });

test("todoMinutes: planned は予定の枠の自身の時間（actual を持っていても数える）、actual は実績の区間（actual.date で範囲を絞る）", () => {
  const d = base([todo({ id: "T-0001", date: "2026-10-20", sessions: [withActual("S1", "2026-10-20", "09:00", "10:00", { date: "2026-10-27", start: "09:00", end: "10:30" }), slot("S2", "2026-10-21", "09:00", "09:30", "actual")] })]);
  assert.deepEqual(todoMinutes(d, "T-0001"), { planned: 60, actual: 120 });
  assert.deepEqual(todoMinutes(d, "T-0001", { start: "2026-10-19", end: "2026-10-25" }), { planned: 60, actual: 30 });
  assert.deepEqual(todoMinutes(d, "T-0001", { start: "2026-10-26", end: "2026-11-01" }), { planned: 0, actual: 90 });
});

test("weekReview: 見出しと行の分数が同じ規則", () => {
  const d = base([todo({ id: "T-0001", date: "2026-10-20", sessions: [withActual("S1", "2026-10-20", "09:00", "10:00", { date: "2026-10-21", start: "09:00", end: "10:30" })] })]);
  const r = weekReview(d, "2026-10-19");
  assert.deepEqual([r.planned, r.actual], [60, 90]);
  assert.deepEqual([r.rows[0].planned, r.rows[0].actual], [60, 90]);
  const next = weekReview(base([todo({ id: "T-0001", date: "2026-10-20", sessions: [withActual("S1", "2026-10-20", "09:00", "10:00", { date: "2026-10-27", start: "09:00", end: "10:30" })] })]), "2026-10-26");
  assert.deepEqual([next.planned, next.actual], [0, 90]);
});

test("carryTodo: actual を持つ予定の枠は、回す前の日にあっても消さない", () => {
  const d = base([todo({ id: "T-0001", date: "2026-10-23", sessions: [withActual("S1", "2026-10-23", "09:00", "10:00", { date: "2026-10-23", start: "15:00", end: "16:00" }), slot("S2", "2026-10-23", "11:00", "12:00")] })]);
  assert.deepEqual(carryTodo(d, "T-0001").todos[0].sessions.map((s) => s.id), ["S1"]);
});
