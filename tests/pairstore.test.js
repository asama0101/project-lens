import { test } from "node:test";
import assert from "node:assert/strict";
import { createPairStore } from "../plugins/project-lens/src/ui/store.js";
import { mergeData } from "../plugins/project-lens/src/core/split.js";

// 偽のファイルハンドル（tests/store.test.js と同じ作り。名前だけ受ける）
function fakeHandle(initial, name) {
  const h = {
    name, text: JSON.stringify(initial), modified: 1000, writes: 0, failWrite: null, perm: "granted", reqPerm: null,
    async getFile() { return { lastModified: h.modified, text: async () => h.text }; },
    async createWritable() {
      if (h.failWrite) throw h.failWrite;
      let buf = "";
      return { write: async (s) => { buf += s; }, close: async () => { h.text = buf; h.modified += 1; h.writes += 1; } };
    },
    async queryPermission() { return h.perm; },
    async requestPermission() { return h.reqPerm ?? h.perm; },
  };
  return h;
}
const memIdb = () => { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); } }; };

const S0 = { version: 1, projects: [{ id: "P1" }], tasks: [{ id: "T1", projectId: "P1", title: "a" }], changeLog: [], settings: { labels: [] } };
const P0 = { version: 1, sessions: [{ taskId: "T1", date: "2026-11-23", start: "09:00", end: "10:00" }], events: [], settings: { workday: { start: "09:00" } } };

/** 2 つのファイルを選んだストア。deps を渡すと、記憶（idb）を共有する */
async function opened(shared = S0, personal = P0) {
  const sh = fakeHandle(shared, "data.json"), pe = fakeHandle(personal, "personal.json");
  const queue = [];
  const deps = { showOpenFilePicker: async () => [queue.shift()], idb: memIdb() };
  const s = createPairStore(deps);
  queue.push(sh);
  assert.equal(await s.choose("shared"), null, "片方だけでは、データを返さない");
  assert.equal(s.hasFile, false);
  queue.push(pe);
  const data = await s.choose("personal");
  return { s, sh, pe, data, deps, queue };
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const file = (h) => JSON.parse(h.text);

test("(a) 2 つ選ぶと、結合したデータを返し、reload も結合したデータ", async () => {
  const { s, data, sh } = await opened();
  assert.equal(s.hasFile, true);
  assert.deepEqual(data, mergeData(S0, P0));
  assert.equal(data.tasks[0].sessions.length, 1);
  sh.text = JSON.stringify({ ...S0, tasks: [...S0.tasks, { id: "T2", projectId: "P1", title: "他" }] }); sh.modified += 5;
  const fresh = await s.reload();
  assert.deepEqual(fresh.tasks.map((t) => t.id), ["T1", "T2"]);
  assert.equal(fresh.tasks[0].sessions.length, 1);
  assert.equal(fresh.settings.workday.start, "09:00");
  assert.deepEqual(await s.lastFile(), { shared: { name: "data.json" }, personal: { name: "personal.json" } });
});

test("(b) 共有だけを変えた保存では、個人ファイルは書かない。何も変えなければ、どちらも書かない", async () => {
  const { s, data, sh, pe } = await opened();
  assert.deepEqual(await s.save(clone(data)), { ok: true });
  assert.deepEqual([sh.writes, pe.writes], [0, 0]);
  const d = clone(data); d.tasks[0].title = "b";
  assert.deepEqual(await s.save(d), { ok: true });
  assert.deepEqual([sh.writes, pe.writes], [1, 0]);
  assert.equal(file(sh).tasks[0].title, "b");
  assert.equal(file(sh).tasks[0].sessions, undefined, "作業枠は共有ファイルに入れない");
});

test("(c) 個人ファイルだけが外から更新されていたら、個人だけ conflict（ファイル名つき）で、共有は書く", async () => {
  const { s, data, sh, pe } = await opened();
  pe.modified += 5;
  const d = clone(data); d.tasks[0].title = "b"; d.tasks[0].sessions[0].end = "11:00";
  const r = await s.save(d);
  assert.deepEqual([r.ok, r.reason], [false, "conflict"]);
  assert.match(r.message, /^personal\.json: /);
  assert.deepEqual([sh.writes, pe.writes], [1, 0]);
  assert.equal(file(sh).tasks[0].title, "b");
});

test("(d) saveMerged: 他が共有ファイルに足したタスクを消さずに、自分の編集を当て直す", async () => {
  const { s, data, sh, pe } = await opened();
  sh.text = JSON.stringify({ ...S0, tasks: [...S0.tasks, { id: "T2", projectId: "P1", title: "他" }] }); sh.modified += 5;
  const edit = (d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === "T1" ? { ...t, title: "自分" } : t)) });
  const input = edit(data);
  const r = await s.saveMerged(edit, input);
  assert.equal(r.ok, true);
  assert.notEqual(r.data, input, "当て直したので、別のデータを返す");
  assert.deepEqual(file(sh).tasks.map((t) => [t.id, t.title]), [["T1", "自分"], ["T2", "他"]]);
  assert.deepEqual(r.data.tasks.map((t) => [t.id, t.sessions.length]), [["T1", 1], ["T2", 0]]);
  assert.equal(pe.writes, 0, "個人は変わっていないので書かない");
  const again = clone(r.data); again.tasks[1].title = "続けて";
  assert.deepEqual(await s.save(again), { ok: true }, "その後の保存も通る");
});

test("saveMerged: 競合がなければ、渡したデータをそのまま返す", async () => {
  const { s, data } = await opened();
  const d = clone(data); d.tasks[0].title = "b";
  const r = await s.saveMerged((x) => x, d);
  assert.equal(r.ok, true);
  assert.equal(r.data, d);
});

test("saveMerged: 個人ファイルの競合は、個人ファイルの最新に当て直す（外で足された予定を消さない）", async () => {
  const { s, data, pe } = await opened();
  pe.text = JSON.stringify({ ...P0, events: [{ id: "E1", title: "外" }] }); pe.modified += 5;
  const edit = (d) => ({ ...d, tasks: d.tasks.map((t) => ({ ...t, sessions: t.sessions.map((x) => ({ ...x, end: "11:00" })) })) });
  const r = await s.saveMerged(edit, edit(data));
  assert.equal(r.ok, true);
  assert.deepEqual(file(pe).events, [{ id: "E1", title: "外" }]);
  assert.equal(file(pe).sessions[0].end, "11:00");
  assert.deepEqual(r.data.events, [{ id: "E1", title: "外" }]);
});

test("(e) restore: 片方の記憶しか無いときは null で、missing が足りない方を返す。両方あれば結合したデータ", async () => {
  const sh = fakeHandle(S0, "data.json"), pe = fakeHandle(P0, "personal.json");
  const queue = [sh];
  const deps = { showOpenFilePicker: async () => [queue.shift()], idb: memIdb() };
  await createPairStore(deps).choose("shared");
  const s1 = createPairStore(deps);
  assert.equal(await s1.restore(), null);
  assert.deepEqual(s1.missing(), ["personal"]);
  assert.equal(s1.hasFile, false);
  queue.push(pe);
  assert.deepEqual(await s1.choose("personal"), mergeData(S0, P0));
  assert.equal(await deps.idb.get("personalFileHandle"), pe);
  assert.equal(await deps.idb.get("dataFileHandle"), sh);
  const s2 = createPairStore(deps);
  assert.deepEqual(await s2.restore(), mergeData(S0, P0));
  assert.deepEqual(s2.missing(), []);
  assert.equal(s2.hasFile, true);
});

test("(f) 片方の保存が失敗したら ok: false（ファイル名つき）。書けた方は読み込み時点が進み、失敗した方は次の保存で書く", async () => {
  const { s, data, sh, pe } = await opened();
  pe.failWrite = new Error("disk full");
  const d = clone(data); d.tasks[0].title = "b"; d.tasks[0].sessions[0].end = "11:00";
  const r = await s.save(d);
  assert.deepEqual([r.ok, r.reason], [false, "error"]);
  assert.match(r.message, /^personal\.json: .*disk full/);
  assert.equal(r.data, d);
  assert.deepEqual([sh.writes, pe.writes], [1, 0]);
  pe.failWrite = null;
  assert.deepEqual(await s.save(d), { ok: true });
  assert.deepEqual([sh.writes, pe.writes], [1, 1], "共有は書き直さず、個人だけ書く");
  assert.equal(file(pe).sessions[0].end, "11:00");
  const d2 = clone(d); d2.tasks[0].title = "c";
  assert.deepEqual(await s.save(d2), { ok: true }, "共有の読み込み時点は進んでいる（競合にならない）");
});

test("(g) 共有に無いタスクの枠は、保存しても個人ファイルに残る。peek は結合したデータ（orphanSessions を含む）", async () => {
  const P = { ...P0, sessions: [...P0.sessions, { taskId: "T9", date: "2026-11-24", start: "13:00", end: "14:00" }] };
  const { s, data, sh, pe } = await opened(S0, P);
  assert.equal(data.orphanSessions.length, 1);
  assert.deepEqual(await s.peek(), data);
  const d = clone(data); d.tasks[0].title = "b";
  assert.deepEqual(await s.save(d), { ok: true });
  assert.deepEqual([sh.writes, pe.writes], [1, 0]);
  const d2 = clone(d); d2.events = [{ id: "E1", title: "予定" }];
  assert.deepEqual(await s.save(d2), { ok: true });
  assert.equal(pe.writes, 1);
  assert.deepEqual(file(pe).sessions.map((x) => x.taskId).sort(), ["T1", "T9"]);
});

test("片方を当て直して書けたが、もう片方が失敗したとき、次の保存は画面の古いデータで、他の更新を上書きしない", async () => {
  const { s, data, sh, pe } = await opened();
  sh.text = JSON.stringify({ ...S0, tasks: [...S0.tasks, { id: "T2", projectId: "P1", title: "他" }] }); sh.modified += 5;
  pe.failWrite = new Error("disk full");
  const edit = (d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === "T1" ? { ...t, title: "自分", sessions: t.sessions.map((x) => ({ ...x, end: "11:00" })) } : t)) });
  const r = await s.saveMerged(edit, edit(data));
  assert.equal(r.ok, false);
  assert.deepEqual(file(sh).tasks.map((t) => t.id), ["T1", "T2"], "共有は当て直して書けた");
  assert.equal((await s.save(edit(data))).reason, "conflict", "当て直さない保存は、古い画面のデータで共有を上書きしない");
  pe.failWrite = null;
  const again = await s.saveMerged(edit, edit(data)); // 画面は、まだ T2 を知らないデータのまま、同じ編集で保存し直す
  assert.equal(again.ok, true);
  assert.deepEqual(file(sh).tasks.map((t) => [t.id, t.title]), [["T1", "自分"], ["T2", "他"]], "他の更新が残る");
  assert.equal(file(pe).sessions[0].end, "11:00");
  assert.deepEqual(again.data.tasks.map((t) => t.id), ["T1", "T2"], "画面へ、最新を返す");
  assert.equal(sh.writes, 1, "共有は書き直さない（中身が同じ）");
});

test("reload: 片方だけ読み直せて、もう片方が失敗したとき、次の保存は他の更新を消さない", async () => {
  const { s, data, sh, pe } = await opened();
  sh.text = JSON.stringify({ ...S0, tasks: [...S0.tasks, { id: "EXT", projectId: "P1", title: "他" }] }); sh.modified += 5;
  const getFile = pe.getFile;
  pe.getFile = async () => { pe.getFile = getFile; throw new Error("読めません"); }; // 1 回だけ失敗
  await assert.rejects(s.reload(), /読めません/);
  const edit = (d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === "T1" ? { ...t, title: "自分" } : t)) });
  const r = await s.saveMerged(edit, edit(data)); // 画面は、まだ EXT を知らない
  assert.equal(r.ok, true);
  assert.deepEqual(file(sh).tasks.map((t) => [t.id, t.title]), [["T1", "自分"], ["EXT", "他"]], "EXT が残る");
  assert.deepEqual(r.data.tasks.map((t) => t.id), ["T1", "EXT"]);
});

test("当て直して書いたあと、もう片方の失敗中に、そのファイルがまた外から変わったら conflict で、書かない（編集を 2 回当てない）", async () => {
  const { s, data, sh, pe } = await opened();
  const ext = (ids) => { sh.text = JSON.stringify({ ...S0, tasks: [...S0.tasks, ...ids.map((id) => ({ id, projectId: "P1", title: "他" }))] }); sh.modified += 5; };
  ext(["T2"]);
  pe.failWrite = new Error("disk full");
  const log = (d) => ({ ...d, changeLog: [...d.changeLog, { id: "L1" }], tasks: d.tasks.map((t) => ({ ...t, sessions: t.sessions.map((x) => ({ ...x, end: "11:00" })) })) });
  assert.equal((await s.saveMerged(log, log(data))).ok, false);
  assert.equal(sh.writes, 1);
  const afterFirst = JSON.parse(sh.text);
  ext(["T2", "T3"]); sh.text = JSON.stringify({ ...JSON.parse(sh.text), changeLog: afterFirst.changeLog }); // 他が、さらに T3 を足した
  pe.failWrite = null;
  const title = (d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === "T1" ? { ...t, title: "自分" } : t)) });
  const both = (d) => title(log(d));
  const r = await s.saveMerged(both, both(data));
  assert.deepEqual([r.ok, r.reason], [false, "conflict"]);
  assert.match(r.message, /data\.json: /);
  assert.equal(sh.writes, 1, "共有は書かない");
  assert.deepEqual(JSON.parse(sh.text).changeLog, [{ id: "L1" }], "編集を 2 回当てない");
});

test("reopen: 記憶の無い方は開かず、権限の誤った文言を出さない。足りない方は missing で分かる", async () => {
  const sh = fakeHandle(S0, "data.json");
  const deps = { showOpenFilePicker: async () => [sh], idb: memIdb() };
  await createPairStore(deps).choose("shared");
  sh.perm = "prompt"; sh.reqPerm = "granted";
  const s = createPairStore(deps);
  assert.equal(await s.reopen(), null);
  assert.deepEqual(s.missing(), ["personal"]);
});
