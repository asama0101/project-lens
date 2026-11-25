import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFileChips } from "../plugins/project-lens/src/ui/views/filechips.js";

const AT = new Date(2026, 10, 26, 9, 12).getTime();
const proj = (n) => ({ id: `ZZ${n}`, name: `案件${n}` });
const DATA = {
  projects: [1, 2, 3, 4].map(proj),
  tasks: [
    { id: "ZZ1-0001", projectId: "ZZ1", status: "Done", sessions: [{ date: "2026-11-26", start: "09:00", end: "10:00" }, { date: "2026-11-26", start: "10:00", end: "11:00" }] },
    { id: "ZZ1-0002", projectId: "ZZ1", status: "Doing", sessions: [{ date: "2026-11-27", start: "09:00", end: "10:00" }] },
    { id: "ZZ2-0001", projectId: "ZZ2", status: "Done", sessions: [] },
  ],
  orphanSessions: [{ taskId: "XX-1", date: "2026-11-25", start: "09:00", end: "10:00" }],
  events: [{ id: "E1" }, { id: "E2" }],
};
const INFO = { shared: { name: "data.json", at: AT, writable: true }, personal: { name: "personal.json", at: AT, writable: true } };
const count = (s, re) => { const m = s.match(re) ?? []; return m.length; };

test("札が 2 つ。名前と data-fileinfo が出て、aria-expanded は open の札だけ true", () => {
  const closed = renderFileChips(DATA, INFO, null);
  assert.equal(count(closed, /<button class="chip-btn"[^>]*data-fileinfo="(shared|personal)"/g), 2);
  assert.ok(closed.includes("data.json") && closed.includes("personal.json"));
  assert.equal(count(closed, /aria-expanded="false"/g), 2);
  const open = renderFileChips(DATA, INFO, "shared");
  assert.equal(count(open, /data-fileinfo="shared"[^>]*aria-expanded="true"|aria-expanded="true"[^>]*data-fileinfo="shared"/g), 1);
  assert.equal(count(open, /aria-expanded="true"/g), 1);
  assert.equal(count(open, /aria-expanded="false"/g), 1);
});

test("open が null なら詳細は出ない", () => {
  const h = renderFileChips(DATA, INFO, null);
  assert.equal(count(h, /class="fileinfo"/g), 0);
  assert.equal(count(h, /data-open=/g), 0);
});

test("共有の詳細: プロジェクト 3 件と「ほか 1 件」・タスク件数（うち Done）・更新日時・書き込めます", () => {
  const h = renderFileChips(DATA, INFO, "shared");
  assert.equal(count(h, /<div class="fileinfo" role="group" aria-label="[^"]+">/g), 1);
  assert.ok(h.includes("案件1") && h.includes("案件2") && h.includes("案件3"));
  assert.ok(!h.includes("案件4"));
  assert.ok(h.includes("ほか 1 件"));
  assert.ok(h.includes("<dd>3 件（うち Done 2 件）</dd>"));
  assert.ok(h.includes("2026/11/26 09:12"));
  assert.ok(h.includes("書き込めます"));
  assert.equal(count(h, /<dl>/g), 1);
});

test("プロジェクトが 3 件以下なら「ほか」を出さない", () => {
  const h = renderFileChips({ ...DATA, projects: DATA.projects.slice(0, 3) }, INFO, "shared");
  assert.ok(h.includes("案件3"));
  assert.ok(!h.includes("ほか"));
});

test("at が null なら更新日時は「—」", () => {
  const h = renderFileChips(DATA, { ...INFO, shared: { name: "data.json", at: null, writable: true } }, "shared");
  assert.ok(h.includes("—"));
  assert.ok(!h.includes("NaN") && !h.includes("1970"));
});

test("writable が false なら「読み込み専用」と橙の点", () => {
  const h = renderFileChips(DATA, { ...INFO, shared: { ...INFO.shared, writable: false } }, "shared");
  assert.ok(h.includes("読み込み専用"));
  assert.ok(!h.includes("書き込めます"));
  assert.equal(count(h, /class="dot warn"/g), 1);
  assert.equal(count(h, /class="dot ok"/g), 1, "個人の札は緑");
});

test("個人の詳細: 作業枠と実績の区間の数・会議の数（個人の枠は、タスクの枠と孤立の枠の合計）", () => {
  const h = renderFileChips(DATA, INFO, "personal");
  assert.ok(h.includes("<dt>作業枠・実績</dt><dd>4 件</dd>"), "枠 3 + 孤立 1");
  assert.ok(h.includes("<dt>会議</dt><dd>2 件</dd>"), "会議");
  assert.ok(h.includes("personal.json"));
  assert.ok(!h.includes("案件1"));
});

test("詳細に、ファイルを選ぶボタンが 1 つ（札の側には無い）", () => {
  const s = renderFileChips(DATA, INFO, "shared");
  assert.equal(count(s, /<button class="btn" data-open="shared">別の共有ファイルを選ぶ<\/button>/g), 1);
  assert.equal(count(s, /data-open=/g), 1);
  const p = renderFileChips(DATA, INFO, "personal");
  assert.equal(count(p, /<button class="btn" data-open="personal">別の個人ファイルを選ぶ<\/button>/g), 1);
});

test("名前に < を含むプロジェクトとファイル名はエスケープされ、ID は出ない", () => {
  const d = { ...DATA, projects: [{ id: "QQ", name: "<b>x</b>" }, ...DATA.projects.slice(0, 1)] };
  const h = renderFileChips(d, { ...INFO, shared: { ...INFO.shared, name: "<i>.json" } }, "shared");
  assert.ok(!h.includes("<b>x") && !h.includes("<i>.json"));
  assert.ok(h.includes("&lt;b&gt;x&lt;/b&gt;") && h.includes("&lt;i&gt;.json"));
  assert.ok(!h.includes("QQ") && !h.includes("ZZ1"));
});

test("プロジェクトが 0 件なら「なし」、1 件ならその名前だけ", () => {
  const none = renderFileChips({ ...DATA, projects: [] }, INFO, "shared");
  assert.ok(none.includes("<dt>プロジェクト</dt><dd>なし</dd>"));
  const one = renderFileChips({ ...DATA, projects: [proj(1)] }, INFO, "shared");
  assert.ok(one.includes("<dt>プロジェクト</dt><dd>案件1</dd>"));
});

test("日時は 0 埋め（00:00・1 桁の月日分）", () => {
  const at = (ms) => renderFileChips(DATA, { ...INFO, shared: { ...INFO.shared, at: ms } }, "shared");
  assert.ok(at(new Date(2026, 0, 5, 0, 5).getTime()).includes("<dd>2026/01/05 00:05</dd>"));
  assert.ok(at(new Date(2026, 8, 9, 0, 0).getTime()).includes("<dd>2026/09/09 00:00</dd>"));
});
