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

// ---- 個人ファイルの reviews と、残っている todos ----
const plain = () => { const { todos, reviews, ...d } = sample(); return d; }; // todos・reviews の無いデータ
const withReviews = () => ({ ...plain(), reviews: { "2026-10-19": "気づき" } });
const LEFT = [
  { id: "T-0001", scope: "week", title: "週の ToDo", date: "2026-10-19", doneAt: null, carried: 0 },
  { id: "T-0002", scope: "day", title: "日の ToDo", date: "2026-10-20", parentId: "T-0001", doneAt: null, carried: 1 },
];
const S90 = { id: "S90", date: "2026-10-20", start: "09:00", end: "10:00", kind: "planned", taskId: "T-0001" };
/** todos と、その枠が残っている個人ファイル */
const leftover = () => {
  const { shared, personal } = splitData(withReviews());
  return { shared, personal: { ...personal, todos: LEFT, sessions: [...personal.sessions, S90] } };
};

test("splitData: reviews は個人ファイルに入り、共有ファイルには入らない", () => {
  const { shared, personal } = splitData(withReviews());
  assert.deepEqual(personal.reviews, { "2026-10-19": "気づき" });
  assert.ok(!("reviews" in shared));
});

test("splitData: reviews が空なら、個人ファイルに reviews のキーを書かない", () => {
  const { personal } = splitData({ ...plain(), reviews: {} });
  assert.ok(!("reviews" in personal));
  assert.deepEqual(personal, splitData(plain()).personal);
});

test("splitData: 入力の todos は無視する（個人ファイルにも共有ファイルにも todos・その枠を書かない）", () => {
  const { shared, personal } = splitData({ ...plain(), todos: [{ ...LEFT[0], sessions: [S90] }] });
  assert.ok(!("todos" in personal) && !("todos" in shared));
  assert.ok(!personal.sessions.some((s) => s.id === "S90"));
  assert.deepEqual(personal, splitData(plain()).personal);
});

test("mergeData: reviews が個人ファイルに無いとき、data.reviews は {}。結合後のデータに todos のキーは無い", () => {
  const { shared, personal } = splitData(plain());
  const m = mergeData(shared, personal);
  assert.deepEqual(m.reviews, {});
  assert.ok(!("todos" in m));
});

test("mergeData: todos と、その ToDo の枠が残っている個人ファイルでも読める。todos は捨て、ToDo の枠は orphanSessions にも入れない。タスクの枠はそのまま", () => {
  const { shared, personal } = leftover();
  const m = mergeData(shared, personal);
  assert.ok(!("todos" in m));
  assert.ok(!m.orphanSessions);
  const clean = splitData(withReviews());
  assert.deepEqual(m, mergeData(clean.shared, clean.personal));
  assert.deepEqual(m.reviews, { "2026-10-19": "気づき" });
});

test("mergeData: ToDo の ID でも共有のタスクの ID でもない taskId の枠は、今までどおり orphanSessions に入る", () => {
  const { shared, personal } = leftover();
  const m = mergeData(shared, { ...personal, sessions: [...personal.sessions, { ...S90, id: "S91", taskId: "NOPE" }] });
  assert.deepEqual(m.orphanSessions.map((s) => s.id), ["S91"]);
});

test("todos が残っている個人ファイルは、読んで保存し直すと todos・その枠が消える", () => {
  const { shared, personal } = leftover();
  const again = splitData(mergeData(shared, personal)).personal;
  assert.ok(!("todos" in again));
  assert.ok(!again.sessions.some((s) => s.id === "S90"));
  assert.deepEqual(again, splitData(withReviews()).personal);
});

test("reviews ありのデータは、分けて結合すると元に戻る。無い個人ファイルは、結合して分け直しても同じ（キーが増えない）", () => {
  const d = withReviews();
  const { shared, personal } = splitData(d);
  assert.deepEqual(mergeData(shared, personal), d);
  const p = splitData(plain());
  assert.equal(JSON.stringify(splitData(mergeData(p.shared, p.personal)).personal), JSON.stringify(p.personal));
});

test("checkPersonalShape: todos の形は検査しない（配列でなくても通す）", () => {
  assert.doesNotThrow(() => checkPersonalShape({ sessions: [], events: [] }));
  assert.doesNotThrow(() => checkPersonalShape({ sessions: [], events: [], todos: [] }));
  assert.doesNotThrow(() => checkPersonalShape({ sessions: [], events: [], todos: {} }));
});
