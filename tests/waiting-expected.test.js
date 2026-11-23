import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../plugins/project-lens/src/core/schema.js";
import { rankTasks } from "../plugins/project-lens/src/core/schedule.js";
import { updateTask } from "../plugins/project-lens/src/ui/edit.js";

const TODAY = "2026-10-21";
const load = () => JSON.parse(readFileSync(new URL("../plugins/project-lens/data/sample.json", import.meta.url), "utf8"));
const waiting = (expected) => ({
  tasks: [{ id: "AA-0001", projectId: "AA", title: "t", due: "2026-10-26", status: "Waiting", predecessors: [],
    waitingOn: { party: "ベンダーX", since: "2026-10-10", ...(expected ? { expected } : {}) } }],
});
const rank = (expected) => rankTasks(waiting(expected), TODAY)[0];

test("rankTasks: 回答予定日を過ぎた Waiting は +40 で、理由に日数が出て、催促になる", () => {
  const r = rank("2026-10-19");
  assert.equal(r.score, 77.5);
  assert.ok(r.reasons.includes("回答予定日を過ぎています（2日）"));
  assert.equal(r.action, "chase");
  assert.ok(r.reasons[0].startsWith("ベンダーX への催促"));
});

test("rankTasks: 予定日が今日・なしなら、点数は変わらない", () => {
  assert.equal(rank("2026-10-21").score, 37.5);
  assert.equal(rank(null).score, 37.5);
  assert.ok(rank("2026-10-21").reasons[0].startsWith("ベンダーX への確認"));
});

test("updateTask: 回答予定日を保存・保持・削除し、Waiting を外すと消える", () => {
  const base = load();
  const id = base.tasks.find((t) => t.status !== "Done" && t.status !== "Cancelled").id;
  let d = updateTask(base, id, { status: "Waiting", waitingOn: { party: "P", expected: "2026-10-30" } }, TODAY);
  assert.equal(d.tasks.find((t) => t.id === id).waitingOn.expected, "2026-10-30");
  d = updateTask(d, id, { title: "x" }, TODAY);
  assert.equal(d.tasks.find((t) => t.id === id).waitingOn.expected, "2026-10-30");
  d = updateTask(d, id, { waitingOn: { party: "Q" } }, TODAY); // expected を書かない更新では保つ
  assert.equal(d.tasks.find((t) => t.id === id).waitingOn.expected, "2026-10-30");
  d = updateTask(d, id, { waitingOn: { party: "Q", expected: "" } }, TODAY);
  assert.equal("expected" in d.tasks.find((t) => t.id === id).waitingOn, false);
  d = updateTask(d, id, { waitingOn: { party: "Q", expected: "2026-11-02" } }, TODAY);
  d = updateTask(d, id, { status: "In Progress" }, TODAY);
  assert.equal(d.tasks.find((t) => t.id === id).waitingOn, null);
  assert.deepEqual(validate(d).errors, []);
});

test("updateTask: 回答予定日が日付の形でなければ例外、validate も error", () => {
  const base = load();
  const id = base.tasks.find((t) => t.status !== "Done" && t.status !== "Cancelled").id;
  assert.throws(() => updateTask(base, id, { status: "Waiting", waitingOn: { party: "P", expected: "10/30" } }, TODAY), /回答予定日/);
  const bad = updateTask(base, id, { status: "Waiting", waitingOn: { party: "P", expected: "2026-10-30" } }, TODAY);
  bad.tasks.find((t) => t.id === id).waitingOn.expected = "bad";
  assert.ok(validate(bad).errors.some((e) => e.includes("回答予定日")));
});
