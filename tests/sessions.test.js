import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sessionKind, actualSlots, addSession, addActual, moveSession, resizeSession, removeSession, taskActual, futurePlanned, runningPlanned } from "../plugins/project-lens/src/core/sessions.js";
import * as sessionsMod from "../plugins/project-lens/src/core/sessions.js";

test("予定の枠を実績に書き換える confirmSession は持たない（実績は addActual で、予定とは別の枠として入れる）", () => {
  assert.equal("confirmSession" in sessionsMod, false);
});

const load = () => JSON.parse(readFileSync(new URL("../plugins/project-lens/data/sample.json", import.meta.url), "utf8"));
const NOW = { date: "2026-10-20", time: "12:00" }; // 火曜
const task = (d, id) => d.tasks.find((t) => t.id === id);
const sess = (d, id) => d.tasks.flatMap((t) => t.sessions).find((s) => s.id === id);

test("sessionKind: 実績は常に actual、過ぎた予定は unconfirmed、途中は planned", () => {
  assert.equal(sessionKind({ kind: "actual", date: "2026-10-30", start: "10:00", end: "11:00" }, NOW), "actual");
  const p = { kind: "planned", date: "2026-10-20", start: "10:00", end: "11:00" };
  assert.equal(sessionKind(p, { date: "2026-10-20", time: "11:00" }), "unconfirmed");
  assert.equal(sessionKind(p, { date: "2026-10-20", time: "10:30" }), "planned");
  assert.equal(sessionKind(p, { date: "2026-10-21", time: "08:00" }), "unconfirmed");
});

test("addSession: 過去に置いても planned（未確認として出て、確認で実績になる）／未来も planned／同じタスクに複数／ID は重複しない", () => {
  const d = load();
  const a = addSession(d, "AA-0004", { date: "2026-10-19", start: "13:00", end: "14:00" });
  assert.equal(a.error, undefined);
  assert.equal(task(a.data, "AA-0004").sessions[0].kind, "planned");
  assert.equal(sessionKind(task(a.data, "AA-0004").sessions[0], NOW), "unconfirmed");
  const b = addSession(a.data, "AA-0004", { date: "2026-10-22", start: "13:00", end: "14:00" });
  assert.equal(task(b.data, "AA-0004").sessions[1].kind, "planned");
  const ids = b.data.tasks.flatMap((t) => t.sessions.map((s) => s.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(task(d, "AA-0004").sessions.length, 0, "元のデータは変えない");
});

test("addSession: 土日・重なり・終了≦開始・23:59 を超える終了は error、会議との重なりは warning。勤務時間の制限はない", () => {
  const d = load();
  const add = (slot) => addSession(d, "AA-0004", slot);
  assert.equal(add({ date: "2026-10-22", start: "06:00", end: "07:30" }).error, undefined, "早朝にも置ける");
  assert.equal(add({ date: "2026-10-22", start: "22:00", end: "23:59" }).error, undefined, "夜にも置ける（終了は 23:59 まで）");
  assert.match(add({ date: "2026-10-22", start: "23:00", end: "24:00" }).error, /23:59/);
  assert.ok(add({ date: "2026-10-24", start: "10:00", end: "11:00" }).error); // 土曜
  assert.ok(add({ date: "2026-10-22", start: "11:00", end: "11:00" }).error);
  assert.ok(add({ date: "2026-10-22", start: "11:00", end: "10:00" }).error);
  assert.ok(add({ date: "2026-10-22", start: "11:00", end: "12:30" }).error, "S5(10-12)と重なる");
  const w = add({ date: "2026-10-21", start: "10:30", end: "11:30" });
  assert.equal(w.error, undefined);
  assert.ok(w.warning);
});

test("スキップした会議とは重ならない扱い", () => {
  const d = load(); d.events.find((e) => e.id === "m3").skip = true;
  const r = addSession(d, "AA-0004", { date: "2026-10-21", start: "10:00", end: "11:00" });
  assert.equal(r.warning, undefined);
});

test("moveSession: 別の日へ移動、長さを保つ、自分の旧枠とは重ならない", () => {
  const d = load();
  const m = moveSession(d, "S5", { date: "2026-10-23", start: "14:00" }, NOW);
  assert.equal(m.error, undefined);
  assert.deepEqual([sess(m.data, "S5").date, sess(m.data, "S5").start, sess(m.data, "S5").end], ["2026-10-23", "14:00", "16:00"]);
  const self = moveSession(d, "S5", { date: "2026-10-22", start: "10:30" }, NOW);
  assert.equal(self.error, undefined);
  assert.ok(moveSession(d, "S5", { date: "2026-10-21", start: "14:30" }, NOW).error, "S3(14-16)と重なる");
  assert.equal(moveSession(d, "S5", { date: "2026-10-22", start: "17:00" }, NOW).error, undefined, "勤務時間の制限はない（18:00 を超えてよい）");
  assert.equal(moveSession(d, "S5", { date: "2026-10-22", start: "21:59" }, NOW).error, undefined, "終了 23:59 まで");
  assert.match(moveSession(d, "S5", { date: "2026-10-22", start: "22:15" }, NOW).error, /23:59/, "23:59 を超える");
});

test("resizeSession: 15分未満・23:59 超過・重なりは error", () => {
  const d = load();
  assert.equal(sess(resizeSession(d, "S5", "13:00").data, "S5").end, "13:00");
  assert.ok(resizeSession(d, "S5", "10:10").error);
  assert.equal(resizeSession(d, "S3", "18:15").error, undefined, "勤務時間の制限はない");
  assert.match(resizeSession(d, "S3", "24:00").error, /23:59/);
  const d2 = load(); task(d2, "AA-0004").sessions.push({ id: "S9", date: "2026-10-22", start: "12:30", end: "13:30", kind: "planned" });
  assert.ok(resizeSession(d2, "S5", "13:00").error);
});

test("removeSession と、枠の操作でタスクの状態は変わらない", () => {
  const d = load();
  const r = removeSession(d, "S1");
  assert.equal(sess(r, "S1"), undefined);
  assert.ok(sess(r, "S2"));
  const before = JSON.stringify(d.tasks.map((t) => [t.id, t.status, t.doneAt]));
  let x = addSession(d, "AA-0004", { date: "2026-10-19", start: "13:00", end: "14:00" }).data;
  x = moveSession(x, "S5", { date: "2026-10-23", start: "14:00" }, NOW).data;
  x = resizeSession(x, "S5", "17:00").data;
  x = removeSession(x, "S2");
  assert.equal(JSON.stringify(x.tasks.map((t) => [t.id, t.status, t.doneAt])), before);
});

test("taskActual / futurePlanned", () => {
  const d = load();
  const t = task(d, "AA-0005");
  assert.deepEqual(taskActual(d, "AA-0005"), { hours: 3.5, firstDate: "2026-10-14", count: 3 });
  assert.deepEqual(taskActual(d, "AA-0004"), { hours: 0, firstDate: null, count: 0 });
  assert.deepEqual(futurePlanned(d, "AA-0005", NOW), ["S3"]);
  assert.deepEqual(futurePlanned(d, "AA-0001", NOW), []);
  assert.equal(t.sessions.length, 3);
});

test("実績の枠を未来へ動かすと error（予定へは戻らない）。過去へ動かす・延ばすのは実績のまま", () => {
  const d = load();
  const m = moveSession(d, "S1", { date: "2026-10-28", start: "13:00" }, NOW);
  assert.match(m.error, /今より後/);
  assert.equal(m.data, d, "データは変わらない");
  assert.equal(sess(moveSession(d, "S1", { date: "2026-10-16", start: "13:00" }, NOW).data, "S1").kind, "actual", "過去へなら実績のまま");
  const d2 = load(); d2.tasks.find((t) => t.id === "AA-0004").sessions.push({ id: "S9", date: "2026-10-20", start: "09:00", end: "10:00", kind: "actual" });
  d2.events = [];
  assert.equal(sess(resizeSession(d2, "S9", "14:00", NOW).data, "S9").kind, "actual", "開始が過去なら、終了が未来でも実績のまま");
  assert.equal(sess(resizeSession(d2, "S9", "11:00", NOW).data, "S9").kind, "actual");
});

test("addSession・moveSession: 土日・手動の休み・日本の祝日には置けない。営業日として扱う日に指定した日には置ける", () => {
  const d = load();
  d.settings = {
    ...d.settings,
    holidays: [{ date: "2026-10-27", kind: "有給" }],
    nationalHolidays: { fetchedAt: "2026-10-25", source: "u", dates: [{ date: "2026-11-03", name: "文化の日" }] },
  };
  const slot = (date) => ({ date, start: "10:00", end: "11:00" });
  const add = (date, data = d) => addSession(data, "AA-0004", slot(date));
  assert.match(add("2026-10-24").error, /土日には置けません/);
  assert.match(add("2026-10-27").error, /休みの日には置けません/);
  assert.match(add("2026-11-03").error, /休みの日には置けません/);
  assert.match(add("2026-10-27").error, /営業日として扱う日/, "置く方法を添える");
  assert.equal(add("2026-10-29").error, undefined, "平日は置ける");
  const w = { ...d, settings: { ...d.settings, workdays: [{ date: "2026-10-24" }, { date: "2026-10-27" }, { date: "2026-11-03" }] } };
  for (const date of ["2026-10-24", "2026-10-27", "2026-11-03"]) assert.equal(add(date, w).error, undefined, date);
  const moved = moveSession(w, "S5", { date: "2026-10-24", start: "10:00" }, NOW);
  assert.equal(moved.error, undefined, "動かす先にも効く");
  assert.match(moveSession(d, "S5", { date: "2026-10-27", start: "10:00" }, NOW).error, /休みの日には置けません/);
});

test("休みの日にすでにある枠は、同じ日の中なら伸縮も移動もできる（日付を変えて休みの日へ動かすことはできない）", () => {
  const d = load();
  d.settings = { ...d.settings, holidays: [{ date: "2026-10-22", kind: "有給" }] }; // S5 は 10-22 10:00-12:00
  assert.equal(resizeSession(d, "S5", "12:30", NOW).error, undefined, "伸縮");
  assert.equal(moveSession(d, "S5", { date: "2026-10-22", start: "13:00" }, NOW).error, undefined, "同じ日の中の移動");
  assert.match(moveSession(d, "S3", { date: "2026-10-22", start: "13:00" }, NOW).error, /休みの日には置けません/, "別の日の枠を休みの日へ動かすのは不可");
  assert.equal(moveSession(d, "S5", { date: "2026-10-23", start: "13:00" }, NOW).error, undefined, "休みの日から平日へは動かせる");
});

test("置けない日のエラーは、どこで指定するかを添える（設定タブ）", () => {
  const e = addSession(load(), "AA-0004", { date: "2026-10-24", start: "10:00", end: "11:00" }).error;
  assert.match(e, /設定タブ.*営業日として扱う日/);
});

test("futurePlanned: まだ開始していない予定の枠だけ。進行中（開始済みで未終了）の枠・終了した枠・実績は含めない", () => {
  const d = load();
  const A5 = task(d, "AA-0005");
  A5.sessions.push(
    { id: "S20", date: "2026-10-20", start: "11:00", end: "13:00", kind: "planned" }, // NOW 12:00: 進行中
    { id: "S21", date: "2026-10-20", start: "12:00", end: "13:00", kind: "planned" }, // ちょうど開始した枠も進行中
    { id: "S22", date: "2026-10-20", start: "12:30", end: "13:30", kind: "planned" }, // 開始前
    { id: "S23", date: "2026-10-20", start: "09:00", end: "10:00", kind: "planned" }, // 終了済み（未確認）
  );
  assert.deepEqual(futurePlanned(d, "AA-0005", NOW), ["S3", "S22"]);
});

test("runningPlanned: 進行中（開始済みで未終了）の予定枠の ID。開始前・終了済み・実績は含めない", () => {
  const d = load();
  task(d, "AA-0005").sessions.push(
    { id: "S20", date: "2026-10-20", start: "11:00", end: "13:00", kind: "planned" }, // NOW 12:00: 進行中
    { id: "S21", date: "2026-10-20", start: "12:00", end: "13:00", kind: "planned" }, // ちょうど開始: 進行中
    { id: "S22", date: "2026-10-20", start: "12:30", end: "13:30", kind: "planned" }, // 開始前
    { id: "S23", date: "2026-10-20", start: "09:00", end: "12:00", kind: "planned" }, // ちょうど終了: 終了済み
  );
  assert.deepEqual(runningPlanned(d, "AA-0005", NOW), ["S20", "S21"]);
  assert.deepEqual(runningPlanned(d, "AA-0001", NOW), []);
});

test("addSession: 土日祝を営業日に数える設定がオンなら、土日・祝日にも置ける。手動の休みには置けず、文は「休みの日」。オフに戻すと再び置けない", () => {
  const d = load();
  d.settings = {
    ...d.settings,
    countWeekendsAndHolidays: true,
    holidays: [{ date: "2026-10-31", kind: "有給" }],
    nationalHolidays: { fetchedAt: "2026-10-25", source: "u", dates: [{ date: "2026-11-03", name: "文化の日" }] },
  };
  const add = (date, data = d) => addSession(data, "AA-0004", { date, start: "10:00", end: "11:00" });
  assert.equal(add("2026-10-24").error, undefined, "土");
  assert.equal(add("2026-10-25").error, undefined, "日");
  assert.equal(add("2026-11-03").error, undefined, "祝日");
  const e = add("2026-10-31").error; // 土曜の手動の休み
  assert.match(e, /休みの日には置けません/);
  assert.doesNotMatch(e, /土日/);
  const off = { ...d, settings: { ...d.settings, countWeekendsAndHolidays: false } };
  assert.match(add("2026-10-24", off).error, /土日には置けません/);
  assert.match(add("2026-11-03", off).error, /休みの日には置けません/);
});

test("resizeSession: 会議と重なると warning を返す（moveSession と同じ。画面が注意を出せるように）。重ならなければ warning なし", () => {
  const d = load();
  const t = d.tasks.find((x) => (x.sessions ?? []).length === 0 && x.projectId);
  t.sessions = [{ id: "SX", date: "2026-10-21", start: "09:00", end: "09:30", kind: "planned" }];
  d.events = [{ id: "mX", date: "2026-10-21", start: "10:00", end: "11:00", title: "会議X", source: "manual", skip: false, externalId: null, confirmed: false, projectId: null }];
  const NOW0 = { date: "2026-10-20", time: "10:00" };
  const over = resizeSession(d, "SX", "10:30", NOW0);
  assert.equal(over.error, undefined);
  assert.match(over.warning, /会議「会議X」/);
  assert.equal(resizeSession(d, "SX", "09:45", NOW0).warning, undefined);
});

test("moveSession・resizeSession: 実績は今より後へ動かせない。予定と実績は重なって動かせ、同じ種別どうしは error", () => {
  const d = load();
  task(d, "AA-0004").sessions.push({ id: "S9", date: "2026-10-20", start: "09:00", end: "10:00", kind: "actual" });
  d.events = [];
  assert.equal(sess(resizeSession(d, "S9", "14:00", NOW).data, "S9").kind, "actual", "終了が未来でも実績");
  assert.equal(sess(moveSession(d, "S9", { date: "2026-10-20", start: "11:30" }, NOW).data, "S9").kind, "actual", "開始が今より前なら実績");
  assert.match(moveSession(d, "S9", { date: "2026-10-20", start: "12:30" }, NOW).error, /今より後/);
  task(d, "AA-0004").sessions.push({ id: "S10", date: "2026-10-20", start: "15:00", end: "16:00", kind: "planned" });
  assert.equal(moveSession(d, "S9", { date: "2026-10-20", start: "10:30" }, NOW).error, undefined);
  assert.equal(moveSession(d, "S10", { date: "2026-10-20", start: "09:30" }, NOW).error, undefined, "予定は実績と重なって動かせる");
  assert.equal(resizeSession(d, "S10", "16:30", NOW).error, undefined);
  task(d, "AA-0004").sessions.push({ id: "S11", date: "2026-10-20", start: "10:00", end: "11:00", kind: "actual" });
  assert.match(moveSession(d, "S9", { date: "2026-10-20", start: "10:30" }, NOW).error, /他の実績の枠（/);
  assert.match(resizeSession(d, "S9", "10:30", NOW).error, /他の実績の枠（/);
});

test("sessionKind: 重なる実績があれば planned、無ければ unconfirmed（接するだけは重ならない）", () => {
  const p = { kind: "planned", date: "2026-10-20", start: "09:00", end: "10:00" };
  assert.equal(sessionKind(p, NOW, [{ date: "2026-10-20", start: "09:30", end: "10:00" }]), "planned");
  assert.equal(sessionKind(p, NOW, []), "unconfirmed");
  assert.equal(sessionKind(p, NOW, [{ date: "2026-10-20", start: "10:00", end: "11:00" }]), "unconfirmed");
});

test("actualSlots: 全タスクの実績の枠だけ", () => {
  const d = load();
  task(d, "AA-0004").sessions.push({ id: "S9", date: "2026-10-20", start: "09:00", end: "10:00", kind: "actual" }, { id: "S10", date: "2026-10-20", start: "15:00", end: "16:00", kind: "planned" });
  const a = actualSlots(d);
  assert.ok(a.some((x) => x.date === "2026-10-20" && x.start === "09:00" && x.end === "10:00"));
  assert.ok(!a.some((x) => x.start === "15:00" && x.date === "2026-10-20"));
});

test("addActual: 予定と重なって置ける。実績どうしの重なりは error で data は変わらない", () => {
  const d = load(); d.events = [];
  const slot = { date: "2026-10-20", start: "10:00", end: "11:00" };
  const p = addSession(d, "AA-0004", slot).data;
  const a = addActual(p, "AA-0004", slot, NOW);
  assert.equal(a.error, undefined);
  assert.deepEqual(task(a.data, "AA-0004").sessions.map((s) => s.kind), ["planned", "actual"]);
  const b = addActual(a.data, "AA-0005", slot, NOW);
  assert.match(b.error, /他の実績の枠（/);
  assert.equal(b.data, a.data);
});

test("addActual: 開始が今より後は error、終了が今より後でも開始が前なら通る", () => {
  const d = load(); d.events = [];
  const now = { date: "2026-10-20", time: "10:15" };
  assert.match(addActual(d, "AA-0004", { date: "2026-10-20", start: "10:30", end: "11:00" }, now).error, /まだ始まっていない/);
  assert.equal(addActual(d, "AA-0004", { date: "2026-10-20", start: "10:00", end: "11:00" }, now).error, undefined);
});

test("addActual: 休みの日にも置ける（予定は置けない）。15 分未満・存在しないタスクは error", () => {
  const d = load(); d.events = [];
  const sat = { date: "2026-10-17", start: "10:00", end: "11:00" };
  assert.equal(addActual(d, "AA-0004", sat, NOW).error, undefined);
  assert.ok(addSession(d, "AA-0004", sat).error);
  assert.ok(addActual(d, "AA-0004", { date: "2026-10-20", start: "10:00", end: "10:10" }, NOW).error);
  assert.match(addActual(d, "XX", sat, NOW).error, /タスク XX がありません/);
});

// ---- ToDo の枠（taskId に ToDo の ID） ----
const todo = (d, id) => d.todos.find((t) => t.id === id);

test("allSessions: ToDo の枠も、taskId・title・projectId:null つきで返る（タスクの枠は projectId がタスクのもの）", async () => {
  const { allSessions } = await import("../plugins/project-lens/src/core/sessions.js");
  const all = allSessions(load());
  const s7 = all.find((s) => s.id === "S7");
  assert.deepEqual([s7.taskId, s7.title, s7.projectId], ["T-0003", "納期の問い合わせメールを送る", null]);
  const s6 = all.find((s) => s.id === "S6");
  assert.deepEqual([s6.taskId, s6.projectId], ["ZZ-0001", null]);
  assert.equal(all.find((s) => s.taskId === "AA-0005").projectId, "AA");
  const d = load(); delete d.todos;
  assert.ok(!allSessions(d).some((s) => s.id === "S7"), "todos が無くてもよい");
});

test("addSession・addActual: ToDo の ID に枠を足せる（todo.sessions に入る。タスクは変えない）", () => {
  const d = load();
  const a = addSession(d, "T-0004", { date: "2026-10-21", start: "13:00", end: "14:00" });
  assert.equal(a.error, undefined);
  assert.deepEqual(todo(a.data, "T-0004").sessions.map((s) => [s.date, s.start, s.kind]), [["2026-10-21", "13:00", "planned"]]);
  assert.deepEqual(a.data.tasks, d.tasks);
  const b = addActual(d, "T-0004", { date: "2026-10-20", start: "08:00", end: "09:00" }, NOW);
  assert.equal(b.error, undefined);
  assert.deepEqual(todo(b.data, "T-0004").sessions.map((s) => s.kind), ["actual"]);
  assert.ok(addActual(d, "T-0004", { date: "2026-10-20", start: "13:00", end: "14:00" }, { date: "2026-10-20", time: "15:00" }).error, "ToDo の実績（S7）とも重ねられない");
  assert.match(addSession(d, "XX", { date: "2026-10-21", start: "13:00", end: "14:00" }).error, /タスク XX がありません/);
  assert.match(addActual(d, "XX", { date: "2026-10-20", start: "08:00", end: "09:00" }, NOW).error, /タスク XX がありません/);
});

test("removeSession・moveSession・resizeSession は、ToDo の枠にも効く", () => {
  const d = load();
  const m = moveSession(d, "S7", { date: "2026-10-19", start: "13:00" }, NOW);
  assert.equal(m.error, undefined);
  assert.deepEqual([todo(m.data, "T-0003").sessions[0].date, todo(m.data, "T-0003").sessions[0].end], ["2026-10-19", "13:30"]);
  const r = resizeSession(d, "S7", "14:00", NOW);
  assert.equal(r.error, undefined);
  assert.equal(todo(r.data, "T-0003").sessions[0].end, "14:00");
  assert.deepEqual(todo(removeSession(d, "S7"), "T-0003").sessions, []);
  const n = load(); delete n.todos;
  assert.equal(removeSession(n, "S6").todos, undefined, "todos が無いデータに todos を足さない");
});

test("sessionKind: ToDo の過ぎた予定で、重なる実績が無ければ unconfirmed（actualSlots は ToDo の実績の枠も含む）", () => {
  const d = load();
  todo(d, "T-0004").sessions = [{ id: "S20", date: "2026-10-20", start: "13:00", end: "13:30", kind: "planned" }, { id: "S21", date: "2026-10-20", start: "08:00", end: "08:30", kind: "planned" }];
  const acts = actualSlots(d);
  assert.ok(acts.some((a) => a.start === "13:00" && a.end === "13:30"), "S7（ToDo の実績）");
  const after = { date: "2026-10-20", time: "15:00" };
  assert.equal(sessionKind(todo(d, "T-0004").sessions[0], after, acts), "planned", "S7 と重なる");
  assert.equal(sessionKind(todo(d, "T-0004").sessions[1], after, acts), "unconfirmed");
});
