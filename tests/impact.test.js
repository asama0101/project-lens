import { test } from "node:test";
import assert from "node:assert/strict";
import { computeImpact } from "../plugins/project-lens/src/core/impact.js";

const mk = (tasks, projectDue = "2026-12-31") => ({
  projects: [{ id: "AA", due: projectDue }],
  tasks: tasks.map(([id, due, preds = [], status = "To Do"]) => ({ id, projectId: "AA", due, predecessors: preds, status })),
});
const chain = () => mk([["AA-0001", "2026-10-10"], ["AA-0002", "2026-10-12", ["AA-0001"]], ["AA-0003", "2026-10-20", ["AA-0002"]]]);
const byId = (r) => Object.fromEntries(r.changes.map((c) => [c.taskId, c]));

test("AA-0001 を +5 日: AA-0001・AA-0002 が 10/15 になり、AA-0003 は据え置き", () => {
  const r = computeImpact(chain(), "AA-0001", 5);
  assert.equal(r.changes[0].taskId, "AA-0001");
  const c = byId(r);
  assert.equal(c["AA-0001"].newDue, "2026-10-15");
  assert.deepEqual([c["AA-0002"].oldDue, c["AA-0002"].newDue, c["AA-0002"].reason], ["2026-10-12", "2026-10-15", "前のタスク AA-0001 の遅れ"]);
  assert.equal(c["AA-0003"], undefined);
});

test("AA-0001 を +12 日: AA-0003 まで動く", () => {
  const c = byId(computeImpact(chain(), "AA-0001", 12));
  assert.equal(c["AA-0003"].newDue, "2026-10-22");
});

test("次のタスクが Done なら動かさない", () => {
  const d = mk([["AA-0001", "2026-10-10"], ["AA-0002", "2026-10-12", ["AA-0001"], "Done"]]);
  assert.deepEqual(computeImpact(d, "AA-0001", 5).changes.map((c) => c.taskId), ["AA-0001"]);
});

test("複数の前のタスクがある次のタスクは、最も遅い前のタスクに合わせる", () => {
  const d = mk([["AA-0001", "2026-10-10"], ["AA-0002", "2026-10-14"], ["AA-0003", "2026-10-13", ["AA-0001", "AA-0002"]]]);
  assert.equal(byId(computeImpact(d, "AA-0001", 10))["AA-0003"].newDue, "2026-10-20");
  assert.equal(byId(computeImpact(d, "AA-0001", 2))["AA-0003"], undefined);
});

test("前倒し（負の日数）は次のタスクを動かさない", () => {
  const r = computeImpact(chain(), "AA-0001", -3);
  assert.deepEqual(r.changes.map((c) => [c.taskId, c.newDue]), [["AA-0001", "2026-10-07"]]);
});

test("循環データでも終了する", () => {
  const d = mk([["AA-0001", "2026-10-10", ["AA-0002"]], ["AA-0002", "2026-10-12", ["AA-0001"]]]);
  const r = computeImpact(d, "AA-0001", 5);
  assert.equal(byId(r)["AA-0001"].newDue, "2026-10-15");
});

test("プロジェクト期限を超えたら projectDueExceeded に入る", () => {
  const r = computeImpact(mk([["AA-0001", "2026-10-10"]], "2026-10-12"), "AA-0001", 5);
  assert.deepEqual(r.projectDueExceeded, [{ projectId: "AA", due: "2026-10-12", latestTaskDue: "2026-10-15" }]);
  assert.deepEqual(computeImpact(chain(), "AA-0001", 1).projectDueExceeded, []);
});

// ---- 前倒しの詰め（Task 5） ----

test("compress なしの前倒しは、対象だけ動き次のタスクは動かない（従来どおり）", () => {
  const r = computeImpact(chain(), "AA-0001", -3);
  assert.deepEqual(r.changes.map((c) => [c.taskId, c.newDue]), [["AA-0001", "2026-10-07"]]);
});

test("compress: 前倒しで次のタスクが同じ日数まで詰まる。ただし前のタスクの新しい期限より前にはならない", () => {
  const c = byId(computeImpact(chain(), "AA-0001", -3, { compress: true }));
  assert.deepEqual([c["AA-0002"].oldDue, c["AA-0002"].newDue, c["AA-0002"].reason], ["2026-10-12", "2026-10-09", "前のタスク AA-0001 の前倒し"]);
  assert.equal(c["AA-0003"].newDue, "2026-10-17", "2段目にも波及");
  const d = mk([["AA-0001", "2026-10-10"], ["AA-0024", "2026-10-20"], ["AA-0002", "2026-10-21", ["AA-0001", "AA-0024"]]]);
  const e = byId(computeImpact(d, "AA-0001", -5, { compress: true }));
  assert.equal(e["AA-0002"].newDue, "2026-10-20", "別の前のタスク AA-0024 の期限より前にはならない");
});

test("compress: Done の次のタスクは動かない。次のタスクが前倒しされても今より後ろにはならない", () => {
  const d = mk([["AA-0001", "2026-10-10"], ["AA-0002", "2026-10-12", ["AA-0001"], "Done"], ["AA-0003", "2026-10-12", ["AA-0001"]]]);
  const r = computeImpact(d, "AA-0001", -3, { compress: true });
  assert.deepEqual(r.changes.map((c) => c.taskId).sort(), ["AA-0001", "AA-0003"]);
  assert.ok(r.changes.every((c) => c.newDue < c.oldDue));
});

test("compress: deltaDays が正のときは従来の結果と一致する", () => {
  assert.deepEqual(computeImpact(chain(), "AA-0001", 5, { compress: true }), computeImpact(chain(), "AA-0001", 5));
});

test("projectDueExceeded: 前倒しは、プロジェクト期限をまだ超えていても「超える」に出さない。後ろへ動かして超えるときは出す", () => {
  const over = mk([["AA-0001", "2026-02-01"]], "2026-01-10");
  assert.deepEqual(computeImpact(over, "AA-0001", -1).projectDueExceeded, []);
  assert.equal(computeImpact(over, "AA-0001", 1).projectDueExceeded.length, 1, "超過が広がる");
  assert.equal(computeImpact(mk([["AA-0001", "2026-01-05"]], "2026-01-10"), "AA-0001", 10).projectDueExceeded.length, 1, "新たに超える");
});
