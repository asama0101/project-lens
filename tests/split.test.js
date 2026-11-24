import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitData, mergeData, removeOrphanSessions, emptyPersonal, checkSharedShape, checkPersonalShape, exportFiles, dataFromTexts } from "../plugins/project-lens/src/core/split.js";
import { moveToProject } from "../plugins/project-lens/src/ui/edit.js";

const sample = () => JSON.parse(readFileSync(new URL("../plugins/project-lens/data/sample.json", import.meta.url), "utf8"));

test("(a) sample を分けて結合すると元に戻る（入力は変えない）", () => {
  const d = sample();
  const copy = structuredClone(d);
  const { shared, personal } = splitData(d);
  assert.deepEqual(d, copy);
  assert.deepEqual(mergeData(shared, personal), d);
});

test("(b) shared のタスクに sessions が無い。personal の枠は taskId を持つ", () => {
  const { shared, personal } = splitData(sample());
  assert.ok(shared.tasks.every((t) => !("sessions" in t)));
  assert.ok(personal.sessions.length > 0 && personal.sessions.every((s) => s.taskId));
  assert.ok(!("events" in shared) && !("inbox" in shared));
});

test("(c) 設定の振り分け", () => {
  const d = { ...sample(), settings: { holidays: ["2026-12-30"], selfNames: ["a"], nationalHolidays: ["2026-01-01"], projectRules: [], reportShowMeetingTitles: true, waitingLongDays: 7 } };
  const { shared, personal } = splitData(d);
  assert.deepEqual(Object.keys(personal.settings).sort(), ["holidays", "selfNames"]);
  assert.deepEqual(Object.keys(shared.settings).sort(), ["nationalHolidays", "projectRules", "reportShowMeetingTitles", "waitingLongDays"]);
});

test("(d) 共有に無い taskId の枠は orphanSessions に入る", () => {
  const { shared, personal } = splitData(sample());
  personal.sessions.push({ id: "X1", date: "2026-10-14", start: "09:00", end: "10:00", kind: "plan", taskId: "NOPE" });
  const m = mergeData(shared, personal);
  assert.deepEqual(m.orphanSessions.map((s) => s.id), ["X1"]);
  assert.equal(m.orphanSessions[0].taskId, "NOPE");
  assert.ok(m.tasks.every((t) => !t.sessions.some((s) => s.id === "X1")));
});

test("(e) orphanSessions を持つデータも、分けて結合しても消えない", () => {
  const d = { ...sample(), orphanSessions: [{ id: "O1", date: "2026-10-14", start: "09:00", end: "10:00", kind: "plan", taskId: "GONE" }] };
  const { shared, personal } = splitData(d);
  assert.ok(personal.sessions.some((s) => s.id === "O1"));
  assert.deepEqual(mergeData(shared, personal).orphanSessions.map((s) => s.id), ["O1"]);
});

test("(f) removeOrphanSessions は空にして、ほかを変えない", () => {
  const d = { ...sample(), orphanSessions: [{ id: "O1", taskId: "GONE" }] };
  const copy = structuredClone(d);
  const r = removeOrphanSessions(d);
  assert.deepEqual(r.orphanSessions, []);
  assert.deepEqual({ ...r, orphanSessions: copy.orphanSessions }, copy);
  assert.deepEqual(d, copy);
});

test("(g) 形の検査と emptyPersonal", () => {
  assert.throws(() => checkSharedShape({}), /data\.jsonのデータの形が違います（projects がありません）/);
  assert.throws(() => checkPersonalShape({ sessions: [] }), /personal\.json.*events/);
  assert.doesNotThrow(() => checkPersonalShape(emptyPersonal()));
  const { shared, personal } = splitData(sample());
  assert.doesNotThrow(() => checkSharedShape(shared));
  assert.doesNotThrow(() => checkPersonalShape(personal));
});

test("inbox が無ければ personal.inbox も作らない", () => {
  const d = sample();
  delete d.inbox;
  assert.ok(!("inbox" in splitData(d).personal));
});

test("(h) moveToProject のあとも、枠はタスクに結びついたまま", () => {
  const d = sample();
  const t = d.tasks.find((x) => x.sessions?.length && !(x.predecessors ?? []).length && !d.tasks.some((y) => (y.predecessors ?? []).includes(x.id)));
  const to = d.projects.find((p) => p.id !== t.projectId).id;
  const moved = moveToProject(d, t.id, to);
  const { shared, personal } = splitData(moved);
  const back = mergeData(shared, personal);
  assert.deepEqual(back.tasks.find((x) => x.id === t.id).sessions, t.sessions);
  assert.deepEqual(back, moved);
});

test("exportFiles: data.json と personal.json の 2 つを、この順で返し、結合すると元に戻る", () => {
  const d = sample();
  const files = exportFiles(d);
  assert.deepEqual(files.map((f) => f.name), ["data.json", "personal.json"]);
  assert.ok(files.every((f) => f.text.endsWith("}\n")));
  const [sh, pe] = files.map((f) => JSON.parse(f.text));
  assert.ok(Array.isArray(sh.projects) && !("sessions" in sh) && Array.isArray(pe.sessions));
  assert.deepEqual(mergeData(sh, pe), d);
});

test("dataFromTexts: 選ぶ順に関係なく、形で共有・個人を見分けて結合する。1 つだけ・同じ種類 2 つは例外", () => {
  const d = sample();
  const [a, b] = exportFiles(d).map((f) => f.text);
  assert.deepEqual(dataFromTexts([a, b]), d);
  assert.deepEqual(dataFromTexts([b, a]), d);
  assert.throws(() => dataFromTexts([a]), /1 つずつ/);
  assert.throws(() => dataFromTexts([a, a]), /1 つずつ/);
  assert.throws(() => dataFromTexts([b, b]), /1 つずつ/);
});

test("checkSharedShape: 作業枠・予定を含む 1 ファイルの旧形式は例外（読み込んで、次の保存で枠・予定を消さない）", () => {
  const OLD = /作業枠・予定を含む 1 ファイルの旧形式の data\.json です/;
  assert.throws(() => checkSharedShape(sample()), OLD);
  const ok = { projects: [], tasks: [{ id: "AA-0001" }], changeLog: [] };
  assert.doesNotThrow(() => checkSharedShape(ok));
  assert.throws(() => checkSharedShape({ ...ok, tasks: [{ id: "AA-0001", sessions: [] }] }), OLD);
  assert.throws(() => checkSharedShape({ ...ok, events: [] }), OLD);
  assert.throws(() => dataFromTexts([JSON.stringify(sample()), JSON.stringify(emptyPersonal())]), OLD);
});

test("dataFromTexts: JSON でないファイルは、ファイル名つきで「JSON として読めません」", () => {
  assert.throws(() => dataFromTexts(["{ x", JSON.stringify(emptyPersonal())], ["data.json", "personal.json"]), /JSON として読めません（data\.json）/);
});

// ---- ToDo（個人ファイルの todos・reviews） ----
const plain = () => { const { todos, reviews, ...d } = sample(); return d; }; // ToDo の無いデータ
const todoData = () => {
  const d = plain();
  d.todos = [
    { id: "T-0001", scope: "week", title: "週の ToDo", date: "2026-10-19", doneAt: null, carried: 0, sessions: [{ id: "S90", date: "2026-10-20", start: "09:00", end: "10:00", kind: "planned" }] },
    { id: "T-0002", scope: "day", title: "日の ToDo", date: "2026-10-20", parentId: "T-0001", doneAt: null, carried: 1, checklist: [{ id: "c1", text: "a", done: false }], sessions: [] },
  ];
  d.reviews = { "2026-10-19": "気づき" };
  return d;
};

test("splitData: ToDo の枠は、taskId つきで個人の sessions に入り、todos には sessions が入らない", () => {
  const { shared, personal } = splitData(todoData());
  assert.deepEqual(personal.sessions.find((s) => s.id === "S90"), { id: "S90", date: "2026-10-20", start: "09:00", end: "10:00", kind: "planned", taskId: "T-0001" });
  assert.ok(personal.todos.length === 2 && personal.todos.every((t) => !("sessions" in t)));
  assert.deepEqual(personal.reviews, { "2026-10-19": "気づき" });
  assert.ok(!("todos" in shared) && !("reviews" in shared));
});

test("splitData: todos が空・reviews が空なら、個人ファイルに todos・reviews のキーを書かない", () => {
  const d = { ...plain(), todos: [], reviews: {} };
  const { personal } = splitData(d);
  assert.ok(!("todos" in personal) && !("reviews" in personal));
  assert.deepEqual(personal, splitData(plain()).personal);
});

test("mergeData: taskId が ToDo の ID の枠は、その ToDo の sessions に戻り、orphanSessions にならない", () => {
  const { shared, personal } = splitData(todoData());
  const m = mergeData(shared, personal);
  assert.deepEqual(m.todos[0].sessions.map((s) => s.id), ["S90"]);
  assert.ok(!("taskId" in m.todos[0].sessions[0]));
  assert.ok(!m.orphanSessions);
});

test("mergeData: 共有のタスクの枠は、今までどおりタスクへ", () => {
  const { shared, personal } = splitData(todoData());
  const m = mergeData(shared, personal);
  assert.ok(m.tasks.some((t) => t.sessions.length > 0));
  assert.ok(m.tasks.every((t) => !t.sessions.some((s) => s.id === "S90")));
});

test("mergeData: todos・reviews が個人ファイルに無いとき、data.todos は []・data.reviews は {}", () => {
  const { shared, personal } = splitData(plain());
  const m = mergeData(shared, personal);
  assert.deepEqual(m.todos, []);
  assert.deepEqual(m.reviews, {});
});

test("ToDo ありのデータは、分けて結合すると元に戻る", () => {
  const d = todoData();
  const { shared, personal } = splitData(d);
  assert.deepEqual(mergeData(shared, personal), d);
});

test("ToDo の無い個人ファイルは、結合して分け直しても同じ（todos・reviews のキーが増えない）", () => {
  const { shared, personal } = splitData(plain());
  const again = splitData(mergeData(shared, personal));
  assert.equal(JSON.stringify(again.personal), JSON.stringify(personal));
});

test("checkPersonalShape: todos があるとき、配列でなければ例外", () => {
  assert.doesNotThrow(() => checkPersonalShape({ sessions: [], events: [] }));
  assert.doesNotThrow(() => checkPersonalShape({ sessions: [], events: [], todos: [] }));
  assert.throws(() => checkPersonalShape({ sessions: [], events: [], todos: {} }), /todos/);
});
