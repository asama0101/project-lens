import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../plugins/project-lens/src/core/schema.js";
import { addDays } from "../plugins/project-lens/src/core/dates.js";
import { updateTask, recordDueChanges, setLogCause } from "../plugins/project-lens/src/ui/edit.js";

const TODAY = "2026-10-21";
const load = () => JSON.parse(readFileSync(new URL("../plugins/project-lens/data/sample.json", import.meta.url), "utf8"));
const screenRows = (d) => d.changeLog.filter((l) => l.source === "screen");
const shift = (d, id, n) => updateTask(d, id, { due: addDays(d.tasks.find((t) => t.id === id).due, n) }, TODAY);
const move = (d, id, n) => recordDueChanges(d, shift(d, id, n), TODAY);

test("recordDueChanges: 期限が変わると、画面の変更として履歴に 1 件足す", () => {
  const d = move(load(), "A3", 3);
  assert.deepEqual(d.changeLog.at(-1), { at: TODAY, taskIds: ["A3"], reason: "画面で期限を変更", cause: null, deltaDays: 3, source: "screen" });
  assert.deepEqual(validate(d).errors, []);
});

test("recordDueChanges: 同じ日・同じタスクは 1 件にまとめ、合計が 0 になれば消す", () => {
  let d = move(load(), "A3", 3);
  d = move(d, "A3", 2);
  assert.equal(screenRows(d).length, 1);
  assert.equal(screenRows(d)[0].deltaDays, 5);
  const before = load().changeLog.length;
  d = move(d, "A3", -5);
  assert.equal(screenRows(d).length, 0);
  assert.equal(d.changeLog.length, before);
});

test("recordDueChanges: 別の日の画面の行があっても、新しい行を足す", () => {
  const base = load();
  base.changeLog.push({ at: "2026-10-20", taskIds: ["A3"], reason: "画面で期限を変更", cause: null, deltaDays: 1, source: "screen" });
  const d = move(base, "A3", 2);
  assert.equal(screenRows(d).length, 2);
});

test("recordDueChanges: 開始日だけの変更・期限が同じ保存では、履歴を変えない", () => {
  const base = load();
  const t = base.tasks.find((x) => x.id === "A3");
  const startOnly = updateTask(base, "A3", { start: addDays(t.due, -2) }, TODAY);
  assert.deepEqual(recordDueChanges(base, startOnly, TODAY).changeLog, base.changeLog);
  const same = updateTask(base, "A3", { due: t.due }, TODAY);
  assert.deepEqual(recordDueChanges(base, same, TODAY).changeLog, base.changeLog);
});

test("setLogCause: 画面の行の原因を設定でき、不明な原因・該当なしは例外", () => {
  const d = move(load(), "A3", 3);
  const d2 = setLogCause(d, { at: TODAY, taskId: "A3" }, "ベンダー");
  assert.equal(screenRows(d2)[0].cause, "ベンダー");
  assert.deepEqual(validate(d2).errors, []);
  assert.equal(screenRows(setLogCause(d2, { at: TODAY, taskId: "A3" }, null))[0].cause, null);
  assert.throws(() => setLogCause(d, { at: TODAY, taskId: "A3" }, "x"));
  assert.throws(() => setLogCause(d, { at: TODAY, taskId: "A4" }, "社内"));
});
