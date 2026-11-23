import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, createPairStore } from "../plugins/project-lens/src/ui/store.js";
import { createSync } from "../plugins/project-lens/src/ui/sync.js";

// 偽のファイルハンドル（store.test.js と同じ。File System Access API の必要部分だけ）
function fakeHandle(initial) {
  const h = {
    name: "data.json", text: JSON.stringify(initial), modified: 1000,
    async getFile() { return { lastModified: h.modified, text: async () => h.text }; },
    async createWritable() {
      let buf = "";
      return { write: async (s) => { buf += s; }, close: async () => { h.text = buf; h.modified += 1; } };
    },
    async queryPermission() { return "granted"; },
    async requestPermission() { return "granted"; },
  };
  return h;
}
const memIdb = () => { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); } }; };
const base = () => ({ projects: [], tasks: [{ id: "A1", title: "a" }], events: [], changeLog: [], inbox: { watching: null, requests: [] } });

/** 画面の代わり: データの入れ物と、描画・通知の呼ばれた回数 */
async function setup(initial = base(), { isEditing } = {}) {
  const h = fakeHandle(initial);
  const store = createStore({ showOpenFilePicker: async () => [h], idb: memIdb() });
  const ui = { data: await store.choose(), render: 0, renderBar: 0, banner: [], toast: [] };
  const sync = createSync({
    store, getData: () => ui.data, setData: (d) => { ui.data = d; },
    render: () => { ui.render++; }, renderBar: () => { ui.renderBar++; }, banner: (m) => ui.banner.push(m), toast: (m) => ui.toast.push(m),
    visible: () => true, wantFast: () => false, isEditing,
  });
  return { h, store, ui, sync };
}
/** 他（Claude Code）がファイルを更新した */
const external = (h, patch) => { h.text = JSON.stringify({ ...JSON.parse(h.text), ...patch }); h.modified += 1; };
const rename = (title) => (d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === "A1" ? { ...t, title } : t)) });

test("persist: 保存の前に他がファイルを更新していても、最新のファイルに同じ編集を当てて保存し、他の更新も画面の編集も消えない", async () => {
  const { h, ui, sync } = await setup();
  external(h, { inbox: { watching: null, requests: [{ id: "R1", status: "proposed" }] } });
  const edit = rename("b");
  ui.data = edit(ui.data);
  sync.persist(edit);
  await sync.whenIdle();
  const saved = JSON.parse(h.text);
  assert.equal(saved.tasks[0].title, "b", "画面の編集が保存されている");
  assert.equal(saved.inbox.requests[0]?.id, "R1", "他の更新が消えていない");
  assert.equal(ui.data.inbox.requests[0]?.id, "R1", "当て直した結果が画面にも出る");
  assert.equal(sync.failed, false);
  assert.deepEqual(ui.banner, []);
});

test("pollInbox: 保存していない編集がある間は読み直さず、編集が無ければ他の更新を取り込む（受信箱だけの変化は帯だけ描き直す）", async () => {
  const { h, ui, sync } = await setup();
  const edit = rename("c");
  ui.data = edit(ui.data);
  sync.persist(edit);
  external(h, { tasks: [{ id: "A1", title: "x" }] }); // 保存が済む前に他が書いた（当て直しの対象）
  sync.pollInbox(true); // 保存が並んでいる間は、読み直しを積まない
  await sync.whenIdle();
  assert.equal(JSON.parse(h.text).tasks[0].title, "c", "画面の編集が、古い内容で上書きされない");
  assert.equal(ui.data.tasks[0].title, "c");
  assert.equal(ui.renderBar, 0, "保存が並んでいる間の pollInbox は、読み直しを積まない（積むと帯が描き直される）");

  const renders = ui.render;
  external(h, { inbox: { watching: { at: "2026-10-31T00:00:00Z" }, requests: [] } });
  sync.pollInbox(true);
  await sync.whenIdle();
  assert.equal(ui.data.inbox.watching.at, "2026-10-31T00:00:00Z", "他の更新を取り込む");
  assert.equal(ui.render, renders, "受信箱だけの変化では画面全体を描き直さない");
  assert.ok(ui.renderBar >= 1);
});

test("pollInbox: 2 ファイルのストア（createPairStore）でも、他が個人ファイルに足した予定を、結合したデータで取り込む", async () => {
  const shared = { version: 1, projects: [], tasks: [{ id: "A1", title: "a" }], changeLog: [], settings: {} };
  const personal = { version: 1, sessions: [{ taskId: "A1", id: "S1", date: "2026-10-20", start: "09:00", end: "10:00", kind: "planned" }], events: [], settings: {}, inbox: { watching: null, requests: [] } };
  const sh = fakeHandle(shared), pe = fakeHandle(personal);
  const queue = [sh, pe];
  const store = createPairStore({ showOpenFilePicker: async () => [queue.shift()], idb: memIdb() });
  assert.equal(await store.choose("shared"), null);
  const ui = { data: await store.choose("personal"), render: 0, renderBar: 0 };
  assert.equal(ui.data.tasks[0].sessions[0].id, "S1", "結合したデータ");
  const sync = createSync({
    store, getData: () => ui.data, setData: (d) => { ui.data = d; },
    render: () => { ui.render++; }, renderBar: () => { ui.renderBar++; }, banner: () => {}, toast: () => {},
    visible: () => true, wantFast: () => false,
  });
  external(pe, { events: [{ id: "E1", title: "外の予定" }] });
  sync.pollInbox(true);
  await sync.whenIdle();
  assert.equal(ui.data.events[0]?.id, "E1", "個人ファイルの更新を取り込む");
  assert.equal(ui.data.tasks[0].title, "a", "共有の内容も残る（結合した形）");
  assert.equal(ui.data.tasks[0].sessions[0].id, "S1");
  assert.equal(ui.render, 1);
});

test("persist: 保存の失敗から戻ったとき、バナーを消す呼び出しの時点で failed は下りている（画面が、検証の注意を出し直せる）", async () => {
  const results = [{ ok: false, reason: "write", message: "書けません" }, { ok: true, data: null }];
  const store = { hasFile: true, saveMerged: async (_f, cur) => { const r = results.shift(); return r.ok ? { ok: true, data: cur } : r; } };
  const calls = [];
  let sync;
  sync = createSync({ store, getData: () => ({}), setData() {}, render() {}, renderBar() {}, banner: (m) => calls.push([m, sync.failed]), toast() {}, visible: () => true, wantFast: () => false });
  sync.persist((d) => d);
  await sync.whenIdle();
  assert.equal(sync.failed, true);
  sync.persist((d) => d);
  await sync.whenIdle();
  assert.deepEqual(calls.at(-1), ["", false]);
});

test("pollInbox: 入力欄で打ちかけ（isEditing）の間は、データは取り込むが描き直さず、flush で 1 回だけ描き直す", async () => {
  let editing = true;
  const { h, ui, sync } = await setup(base(), { isEditing: () => editing });
  external(h, { tasks: [{ id: "A1", title: "x" }] });
  sync.pollInbox(true);
  await sync.whenIdle();
  assert.equal(ui.data.tasks[0].title, "x", "データは取り込む");
  assert.equal(ui.render, 0, "打ちかけの間は描き直さない");
  sync.flush();
  assert.equal(ui.render, 0, "まだ打ちかけなら、flush でも描き直さない");
  editing = false;
  sync.flush();
  sync.flush();
  assert.equal(ui.render, 1, "打ち終えたら 1 回だけ");
});

test("pollInbox: 打ちかけでなければ、今までどおりすぐ描き直す。描き直しが済んだ（rendered）・開き直した（reset）ら、待っていた描き直しは捨てる", async () => {
  const { h, ui, sync } = await setup(base(), { isEditing: () => false });
  external(h, { tasks: [{ id: "A1", title: "x" }] });
  sync.pollInbox(true);
  await sync.whenIdle();
  assert.equal(ui.render, 1);
  sync.flush();
  assert.equal(ui.render, 1, "待っている描き直しが無ければ、flush は何もしない");

  let editing = true;
  const s2 = await setup(base(), { isEditing: () => editing });
  for (const drop of [(x) => x.sync.rendered(), (x) => x.sync.reset()]) {
    editing = true;
    external(s2.h, { tasks: [{ id: "A1", title: String(Math.random()) }] });
    s2.sync.pollInbox(true);
    await s2.sync.whenIdle();
    drop(s2);
    editing = false;
    const before = s2.ui.render;
    s2.sync.flush();
    assert.equal(s2.ui.render, before, "捨てたあとの flush は描き直さない");
  }
});
