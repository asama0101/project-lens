import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../plugins/project-lens/src/core/schema.js";
import { nextRepeatDue } from "../plugins/project-lens/src/core/repeat.js";
import { updateTask, spawnNextRepeat, duplicateTask } from "../plugins/project-lens/src/ui/edit.js";

const TODAY = "2026-10-21";
const load = () => JSON.parse(readFileSync(new URL("../plugins/project-lens/data/sample.json", import.meta.url), "utf8"));
const WEEK = { unit: "week" };
const month = (day) => ({ unit: "month", day });

test("nextRepeatDue: 毎週は、期限と今日のどちらよりも後の最初の周期日", () => {
  assert.equal(nextRepeatDue(WEEK, "2026-10-16", "2026-10-14"), "2026-10-23");
  assert.equal(nextRepeatDue(WEEK, "2026-10-16", "2026-10-16"), "2026-10-23");
  assert.equal(nextRepeatDue(WEEK, "2026-10-16", "2026-10-30"), "2026-11-06");
});

test("nextRepeatDue: 毎月は指定の日で、短い月は月末に丸める（うるう年を含む）", () => {
  assert.equal(nextRepeatDue(month(31), "2026-01-31", "2026-01-31"), "2026-02-28");
  assert.equal(nextRepeatDue(month(31), "2026-02-28", "2026-02-28"), "2026-03-31");
  assert.equal(nextRepeatDue(month(31), "2026-01-31", "2026-04-02"), "2026-04-30");
  assert.equal(nextRepeatDue(month(31), "2028-01-31", "2028-01-31"), "2028-02-29");
  assert.equal(nextRepeatDue(month(5), "2026-12-05", "2026-12-01"), "2027-01-05");
});

// A5 に定例の設定・チェックリスト・重要度・メモを付けて Done にしたデータ
function doneRepeating(extra = {}) {
  let d = load();
  const id = d.tasks.find((t) => t.status !== "Done" && t.status !== "Cancelled").id;
  d = { ...d, tasks: d.tasks.map((t) => (t.id === id ? {
    ...t, repeat: { ...WEEK }, importance: "high", memo: "メモ", group: "G", subgroup: "S", predecessors: [], start: "2026-10-01",
    checklist: [{ id: "c3", text: "一つ目", done: true }, { id: "c7", text: "二つ目", done: false }], ...extra,
  } : t)) };
  return { d: updateTask(d, id, { status: "Done" }, TODAY), id };
}

test("spawnNextRepeat: Done にした定例タスクの次回を 1 件作り、引き継ぐものと引き継がないものを守る", () => {
  const { d, id } = doneRepeating();
  const src = d.tasks.find((t) => t.id === id);
  const out = spawnNextRepeat(d, id, TODAY);
  assert.equal(out.tasks.length, d.tasks.length + 1);
  const n = out.tasks.find((t) => !d.tasks.some((x) => x.id === t.id));
  assert.equal(n.status, "To Do");
  assert.equal(n.due, nextDueOf(src));
  assert.deepEqual([n.title, n.projectId, n.group, n.subgroup, n.importance, n.memo], [src.title, src.projectId, "G", "S", "high", "メモ"]);
  assert.deepEqual(n.repeat, WEEK);
  assert.deepEqual(n.checklist, [{ id: "c1", text: "一つ目", done: false }, { id: "c2", text: "二つ目", done: false }]);
  assert.deepEqual([n.predecessors, n.waitingOn, n.sessions, n.start, n.doneAt], [[], null, [], null, null]);
  assert.equal(out.tasks.find((t) => t.id === id).repeat.spawned, n.id);
  assert.deepEqual(validate(out).errors, []);
});
const nextDueOf = (src) => nextRepeatDue(WEEK, src.due, TODAY);

test("spawnNextRepeat: 二重に作らない。Done でない・Cancelled・定例なしでは何もしない", () => {
  const { d, id } = doneRepeating();
  const once = spawnNextRepeat(d, id, TODAY);
  assert.equal(spawnNextRepeat(once, id, TODAY).tasks.length, once.tasks.length);
  const reopened = updateTask(once, id, { status: "To Do" }, TODAY);
  const again = spawnNextRepeat(updateTask(reopened, id, { status: "Done" }, TODAY), id, TODAY);
  assert.equal(again.tasks.length, once.tasks.length);
  assert.equal(spawnNextRepeat(reopened, id, TODAY).tasks.length, reopened.tasks.length);
  const canc = updateTask(d, id, { status: "Cancelled" }, TODAY);
  assert.equal(spawnNextRepeat(canc, id, TODAY).tasks.length, canc.tasks.length);
  const plain = load();
  assert.equal(spawnNextRepeat(plain, plain.tasks[0].id, TODAY).tasks.length, plain.tasks.length);
});

test("spawnNextRepeat: チェックリストのないタスクの次回に checklist キーを作らない", () => {
  const { d, id } = doneRepeating({ checklist: undefined });
  const out = spawnNextRepeat(d, id, TODAY);
  const n = out.tasks.find((t) => !d.tasks.some((x) => x.id === t.id));
  assert.equal("checklist" in n, false);
});

test("updateTask: repeat を保存・削除し、不正な値は例外・validate は error", () => {
  const base = load();
  const id = base.tasks[0].id;
  let d = updateTask(base, id, { repeat: month(15) }, TODAY);
  assert.deepEqual(d.tasks.find((t) => t.id === id).repeat, month(15));
  d = updateTask(d, id, { repeat: null }, TODAY);
  assert.equal(d.tasks.find((t) => t.id === id).repeat ?? null, null);
  assert.throws(() => updateTask(base, id, { repeat: month(0) }, TODAY));
  assert.throws(() => updateTask(base, id, { repeat: { unit: "year" } }, TODAY));
  const bad = { ...base, tasks: base.tasks.map((t) => (t.id === id ? { ...t, repeat: { unit: "month", day: 32 } } : t)) };
  assert.ok(validate(bad).errors.some((e) => e.includes("repeat")));
});

test("duplicateTask: 期限を今日にした未チェックのコピーを、同じ場所に作る", () => {
  const { d, id } = doneRepeating();
  const { data, id: nid } = duplicateTask(d, id, TODAY);
  const src = data.tasks.find((t) => t.id === id), n = data.tasks.find((t) => t.id === nid);
  assert.notEqual(nid, id);
  assert.deepEqual([n.title, n.projectId, n.group, n.subgroup, n.importance, n.memo], [src.title, src.projectId, "G", "S", "high", "メモ"]);
  assert.deepEqual([n.due, n.status, n.repeat], [TODAY, "To Do", undefined]);
  assert.ok(n.checklist.every((c) => c.done === false) && n.checklist.length === 2);
  assert.deepEqual(validate(data).errors, []);
});

test("nextRepeatDue: 期限を毎月の日より前に動かしていても、同じ月の指定日を飛ばさない", () => {
  assert.equal(nextRepeatDue(month(25), "2026-10-20", "2026-10-21"), "2026-10-25");
  assert.equal(nextRepeatDue(month(25), "2026-10-25", "2026-10-21"), "2026-11-25");
});

test("validate: repeat.spawned が文字列でなければ error", () => {
  const base = load();
  const id = base.tasks[0].id;
  const bad = { ...base, tasks: base.tasks.map((t) => (t.id === id ? { ...t, repeat: { unit: "week", spawned: 5 } } : t)) };
  assert.ok(validate(bad).errors.some((e) => e.includes("repeat")));
});
