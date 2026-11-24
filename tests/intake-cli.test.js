import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, relative, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { writeTwo, readTwo, rawTwo } from "./twofiles.js";
import { today, addDays } from "../plugins/project-lens/src/core/dates.js";

// 予定表の取り込みは、今日より前の会議を落とすので、calendar-* の日付は実行日からの相対にする
const T0 = today(), T1 = addDays(T0, 1), T3 = addDays(T0, 3), T4 = addDays(T0, 4), T6 = addDays(T0, 6);

const REPO = fileURLToPath(new URL("../plugins/project-lens/", import.meta.url));
const base = mkdtempSync(join(tmpdir(), "project-lens-intake-"));
after(() => rmSync(base, { recursive: true, force: true }));

let n = 0;
/** サンプルを複製した作業フォルダと、そこへ JSON を書く道具 */
function work() {
  const dir = join(base, String(++n));
  rmSync(dir, { recursive: true, force: true });
  const data = join(dir, "data.json");
  mkdirP(dir);
  writeTwo(data, JSON.parse(readFileSync(join(REPO, "data/sample.json"), "utf8")));
  const put = (name, obj) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p; };
  return { data, put, read: () => rawTwo(data), json: () => readTwo(data), dir };
}
import { mkdirSync } from "node:fs";
const mkdirP = (d) => mkdirSync(d, { recursive: true });
const run = (...args) => {
  const r = spawnSync(process.execPath, [join(REPO, "tools/intake.js"), ...args], { encoding: "utf8" });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* 出力が JSON でないこともある */ }
  return { status: r.status, out, err: r.stderr, raw: r.stdout };
};

const ROWS = [
  { group: "設計", subgroup: "要件", title: "要件の確認", due: "2026-11-10" },
  { group: "設計", subgroup: "要件", title: "基本設計", due: "2026-11-20", predecessorKeys: ["設計/要件/要件の確認"] },
];

test("wbs-plan は data.json を1バイトも変えない", () => {
  const w = work(); const before = w.read();
  const r = run("wbs-plan", w.data, "AA", w.put("rows.json", ROWS));
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.add.length, 2);
  assert.equal(w.read(), before);
});

test("wbs-apply: タスクが増え、2回目の wbs-plan は add が0件", () => {
  const w = work(); const rows = w.put("rows.json", ROWS);
  const before = w.json().tasks.length;
  const r = run("wbs-apply", w.data, "AA", rows);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out.summary, { added: 2, updated: 0 });
  assert.equal(w.json().tasks.length, before + 2);
  assert.equal(run("wbs-plan", w.data, "AA", rows).out.add.length, 0);
});

test("wbs-apply: --source のファイル名が取り込み記録に入る（なければ null）", () => {
  const w = work(); const rows = w.put("rows.json", ROWS);
  assert.equal(run("wbs-apply", w.data, "AA", rows, "--source", "plan.xlsx").status, 0);
  assert.deepEqual(w.json().settings.wbsImports.AA, { file: "plan.xlsx", at: w.json().settings.wbsImports.AA.at, added: 2, updated: 0 });
  const w2 = work(); const rows2 = w2.put("rows.json", ROWS);
  assert.equal(run("wbs-apply", w2.data, "AA", rows2).status, 0);
  assert.equal(w2.json().settings.wbsImports.AA.file, null);
});

test("wbs-apply: 前のタスクが循環する rows は、循環になる指定だけ設定せず、警告に出して取り込む（終了コード 0、data.json は検証に通る）", () => {
  const w = work();
  const rows = w.put("rows.json", [
    { title: "X1", due: "2026-11-01", predecessorKeys: ["X2"] }, { title: "X2", due: "2026-11-02", predecessorKeys: ["X1"] },
  ]);
  const r = run("wbs-apply", w.data, "AA", rows);
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.summary.added, 2);
  assert.ok(r.out.warnings.some((x) => /循環になるため設定しません/.test(x)), JSON.stringify(r.out.warnings));
  const d = w.json();
  const x1 = d.tasks.find((t) => t.title === "X1"), x2 = d.tasks.find((t) => t.title === "X2");
  assert.deepEqual([x1.predecessors.length, x2.predecessors.length], [1, 0]);
});

test("calendar-apply: 会議が追加され、規則でプロジェクトが付く。calendar-plan は書かない", () => {
  const w = work();
  const fetched = w.put("fetched.json", [{ externalId: "ext-new", title: "ベンダーX 週次", date: T3, start: "15:00", end: "16:00" }]);
  const before = w.read();
  const p = run("calendar-plan", w.data, fetched, T0, T6);
  assert.equal(p.status, 0, p.err);
  assert.equal(p.out.added.length, 1);
  assert.equal(w.read(), before);
  assert.equal(run("calendar-apply", w.data, fetched, T0, T6, "--plan-key", p.out.planKey).status, 0);
  const e = w.json().events.find((x) => x.externalId === "ext-new");
  assert.deepEqual([e.projectId, e.projectBy], ["AA", "rule"]);
});

test("calendar-apply: 反映後のデータが検証に通らないときは、終了コード 1 で何も書かない", () => {
  const w = work();
  const d = w.json();
  d.events.push({ id: "mz", date: T3, start: "09:00", end: "10:00", title: "x", source: "mcp", skip: false, externalId: "ext-z", projectId: "ZZ" });
  writeTwo(w.data, d);
  const before = w.read();
  const fetched = w.put("fetched.json", [{ externalId: "ext-z", title: "x", date: T3, start: "09:00", end: "10:00" }]);
  const key = run("calendar-plan", w.data, fetched, T0, T6).out.planKey;
  const r = run("calendar-apply", w.data, fetched, T0, T6, "--plan-key", key);
  assert.equal(r.status, 1);
  assert.match(r.err, /ZZ/);
  assert.equal(w.read(), before);
});

test("calendar-apply: 確認した削除の一覧（planKey）と同じときだけ消す。取得し直しが欠けて一覧が変わった・キーがないときは、書かずに止める", () => {
  const w = work();
  const d = w.json();
  const ev = (i) => ({ id: `cm${i}`, date: T3, start: `0${i + 4}:00`, end: `0${i + 4}:30`, title: `会議${i}`, source: "mcp", skip: false, externalId: `ext-${i}` });
  d.events.push(...[1, 2, 3, 4, 5].map(ev));
  writeTwo(w.data, d);
  const all = [1, 2, 3, 4, 5].map((i) => ({ externalId: `ext-${i}`, title: `会議${i}`, date: T3, start: `0${i + 4}:00`, end: `0${i + 4}:30` }));
  const two = w.put("two.json", all.slice(0, 2)), none = w.put("none.json", []);
  const R = [T0, T6];
  const keyNone = run("calendar-plan", w.data, none, ...R).out.planKey; // 利用者が一覧を見て「はい」と答えた時点のキー（全件消える）
  const before = w.read();
  const bad = run("calendar-apply", w.data, two, ...R, "--plan-key", keyNone); // 取得し直しが 2 件に増えた → 消える会議が変わる
  assert.equal(bad.status, 1);
  assert.match(bad.err, /確認した削除の一覧/);
  const noKey = run("calendar-apply", w.data, two, ...R);
  assert.equal(noKey.status, 1);
  assert.match(noKey.err, /--plan-key/);
  assert.equal(w.read(), before);
  const keyTwo = run("calendar-plan", w.data, two, ...R).out.planKey;
  assert.notEqual(keyTwo, keyNone);
  const ok = run("calendar-apply", w.data, two, ...R, "--plan-key", keyTwo);
  assert.equal(ok.status, 0, ok.err);
  assert.equal(ok.out.summary.removed, 3); // cm3〜cm5（sample の m1・m3 は今日より前なので、範囲の外）
  assert.deepEqual(w.json().events.filter((e) => e.source === "mcp").map((e) => e.id).sort(), ["cm1", "cm2", "m1", "m3"]); // 今日より前の m1・m3 は残る
});

test("fetched-remove: 一時フォルダの下（深さは問わない）の project-lens-fetched-*.json だけを消す。名前が違う・一時フォルダの外・.. で外へ出る形は、消さず非 0。無ければ成功", () => {
  const mk = (dir, name) => { const p = join(dir, name); writeFileSync(p, "[]"); return p; };
  const deepDir = join(base, "claude", "id", "scratchpad"); mkdirSync(deepDir, { recursive: true });
  const outDir = mkdtempSync(join(dirname(tmpdir()), "project-lens-outside-")); // 一時フォルダの外（親フォルダ）
  const good = mk(tmpdir(), `project-lens-fetched-test-${process.pid}.json`);
  const deep = mk(deepDir, "project-lens-fetched-deep.json");
  const badName = mk(tmpdir(), `project-lens-other-${process.pid}.json`);
  const outside = mk(outDir, "project-lens-fetched-x.json");
  try {
    assert.equal(run("fetched-remove", good).status, 0);
    assert.equal(existsSync(good), false);
    assert.equal(run("fetched-remove", deep).status, 0);
    assert.equal(existsSync(deep), false, "深い場所でも消える");
    const r1 = run("fetched-remove", badName);
    assert.equal(r1.status, 1); assert.match(r1.err, /project-lens-fetched-/); assert.equal(existsSync(badName), true);
    const r2 = run("fetched-remove", outside);
    assert.equal(r2.status, 1); assert.match(r2.err, /一時フォルダ/); assert.equal(existsSync(outside), true);
    const dotted = join(tmpdir(), relative(tmpdir(), outDir), "project-lens-fetched-x.json"); // .. を経て外へ出る形
    assert.ok(relative(tmpdir(), outDir).startsWith(".."));
    assert.equal(run("fetched-remove", dotted).status, 1); assert.equal(existsSync(outside), true);
    assert.equal(run("fetched-remove", join(tmpdir(), `project-lens-fetched-none-${process.pid}.json`)).status, 0, "無いファイルは成功");
    assert.equal(run("fetched-remove").status, 2);
  } finally { for (const p of [good, deep, badName]) rmSync(p, { force: true }); rmSync(outDir, { recursive: true, force: true }); }
});

test("rules-apply: manual のひも付けは変わらない", () => {
  const w = work();
  const d = w.json(); d.events.find((e) => e.id === "m3").projectId = "AB"; d.events.find((e) => e.id === "m3").projectBy = "manual";
  writeTwo(w.data, d);
  assert.equal(run("rules-apply", w.data).status, 0);
  const e = w.json().events;
  assert.equal(e.find((x) => x.id === "m3").projectId, "AB");
  assert.equal(e.find((x) => x.id === "m2").projectId, "AA");
});

test("rules-set→rules-list→rules-remove の往復。不明なプロジェクトは終了コード1で data.json は変わらない", () => {
  const w = work();
  assert.equal(run("rules-set", w.data, "部内", "AB").status, 0);
  assert.deepEqual(run("rules-list", w.data).out.map((r) => r.keyword), ["ベンダーX", "部内"]);
  assert.equal(w.json().events.find((e) => e.id === "m3").projectId, "AB");
  assert.equal(run("rules-remove", w.data, "部内").status, 0);
  assert.deepEqual(run("rules-list", w.data).out.map((r) => r.keyword), ["ベンダーX"]);
  const before = w.read();
  assert.equal(run("rules-set", w.data, "x", "ZZ").status, 1);
  assert.equal(w.read(), before);
});

test("mapping-set→mapping-get の往復。mapping-get は保存が無ければ null で、ファイルを書かない", () => {
  const w = work(); const before = w.read();
  assert.equal(run("mapping-get", w.data, "AA").out, null);
  assert.equal(w.read(), before);
  assert.equal(run("mapping-set", w.data, "AA", w.put("map.json", { title: "作業名", due: "期限" })).status, 0);
  assert.deepEqual(run("mapping-get", w.data, "AA").out, { title: "作業名", due: "期限" });
  assert.equal(run("mapping-set", w.data, "AA", w.put("bad.json", { due: "期限" })).status, 1);
});

test("引数が足りないと終了コード2と使い方を出す", () => {
  assert.equal(run().status, 2);
  const r = run("wbs-plan");
  assert.equal(r.status, 2);
  assert.match(r.err, /使い方/);
  assert.equal(run("unknown-cmd", "x").status, 2);
});

// ---- 自分だけ・自分と会議室だけの予定を除く（設定は project-lens-mcp.json から読む） ----
const runEnv = (env, ...args) => {
  const r = spawnSync(process.execPath, [join(REPO, "tools/intake.js"), ...args], { encoding: "utf8", env: { ...process.env, PROJECT_LENS_HOME: "", ...env } });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* 出力が JSON でないこともある */ }
  return { status: r.status, out, err: r.stderr };
};
const SELF = "me@example.com";
const fetchedSolo = () => [
  { externalId: "solo1", title: "作業ブロック", date: T3, start: "09:00", end: "10:00", attendees: [{ type: "person", email: SELF, name: "me" }] },
  { externalId: "solo2", title: "ひとりで会議室", date: T3, start: "10:00", end: "11:00", attendees: [{ type: "person", email: SELF, name: "me" }, { type: "resource", email: "r@example.com", name: "会議室 A" }] },
  { externalId: "mtg1", title: "ベンダーX 週次", date: T3, start: "15:00", end: "16:00", attendees: [{ type: "person", email: SELF, name: "me" }, { type: "person", email: "v@example.com", name: "v" }] },
];
const homeWith = (cal) => {
  const home = join(base, `home${++n}`);
  mkdirP(home);
  writeFileSync(join(home, "project-lens-mcp.json"), JSON.stringify({ schema_version: 1, calendar: { server: "s", listTool: "l", ...cal } }));
  return home;
};

test("calendar-plan・calendar-apply: 設定の selfEmails（PROJECT_LENS_HOME か --data の置き場）で、自分だけ・自分と会議室だけの予定を取り込まず、excluded に出す。plan は書かない", () => {
  const w = work();
  const fetched = w.put("fetched.json", fetchedSolo());
  const home = homeWith({ selfEmails: [SELF] });
  const before = w.read();
  for (const env of [{ PROJECT_LENS_HOME: home }, {}]) {
    const args = env.PROJECT_LENS_HOME ? [] : ["--data", home];
    const p = runEnv(env, "calendar-plan", w.data, fetched, T0, T6, ...args);
    assert.equal(p.status, 0, p.err);
    assert.deepEqual([p.out.added.map((e) => e.externalId), p.out.excluded.map((e) => e.externalId), p.out.warnings], [["mtg1"], ["solo1", "solo2"], []]);
    assert.equal(w.read(), before);
  }
  const a = runEnv({ PROJECT_LENS_HOME: home }, "calendar-apply", w.data, fetched, T0, T6, "--plan-key", runEnv({ PROJECT_LENS_HOME: home }, "calendar-plan", w.data, fetched, T0, T6).out.planKey);
  assert.equal(a.status, 0, a.err);
  assert.deepEqual([a.out.summary.added, a.out.summary.excluded], [1, 2]);
  assert.deepEqual(w.json().events.filter((e) => e.source === "mcp" && e.externalId.startsWith("solo")), []);
});

test("calendar-plan: 設定の selfNames だけ（selfEmails なし）でも、名前が一致する自分だけの予定を除く", () => {
  const w = work();
  const fetched = w.put("fetched.json", fetchedSolo());
  const p = runEnv({ PROJECT_LENS_HOME: homeWith({ selfNames: ["me"] }) }, "calendar-plan", w.data, fetched, T0, T6);
  assert.equal(p.status, 0, p.err);
  assert.deepEqual([p.out.added.map((e) => e.externalId), p.out.excluded.map((e) => e.externalId), p.out.warnings], [["mtg1"], ["solo1", "solo2"], []]);
});

test("calendar-plan: 設定がない（置き場がない・selfEmails が未設定）ときは、何も除かず、warnings に出す", () => {
  const w = work();
  const fetched = w.put("fetched.json", fetchedSolo());
  for (const env of [{}, { PROJECT_LENS_HOME: homeWith({}) }]) {
    const p = runEnv(env, "calendar-plan", w.data, fetched, T0, T6);
    assert.equal(p.status, 0, p.err);
    assert.deepEqual([p.out.added.length, p.out.excluded.length], [3, 0]);
    assert.match(p.out.warnings[0], /selfEmails/);
  }
});

test("calendar-plan: excluded には、参加者（メールアドレス）を含めず、externalId・件名・日時だけを出す", () => {
  const w = work();
  const fetched = w.put("fetched.json", fetchedSolo());
  const p = runEnv({ PROJECT_LENS_HOME: homeWith({ selfEmails: [SELF] }) }, "calendar-plan", w.data, fetched, T0, T6);
  assert.equal(p.status, 0, p.err);
  assert.deepEqual(p.out.excluded[0], { externalId: "solo1", title: "作業ブロック", date: T3, start: "09:00", end: "10:00" });
  assert.ok(!JSON.stringify(p.out.excluded).includes("example.com"));
});

test("calendar-plan・calendar-apply: 設定ファイルの指定が正しくない（selfEmails が文字列、など）ときは、理由を出して止まり、何も書かない", () => {
  const w = work();
  const fetched = w.put("fetched.json", fetchedSolo());
  const before = w.read();
  const env = { PROJECT_LENS_HOME: homeWith({ selfEmails: SELF }) };
  for (const cmd of ["calendar-plan", "calendar-apply"]) {
    const r = runEnv(env, cmd, w.data, fetched, T0, T6, "--plan-key", "x");
    assert.equal(r.status, 1);
    assert.match(r.err, /project-lens-mcp\.json.*selfEmails/s);
  }
  assert.equal(w.read(), before);
});

test("calendar-plan: 取り込み済みの会議が対象外になって削除される場合は、removedByExclusion に、確認済み（confirmed）かどうかとあわせて出る（エージェントの文章に頼らず、確認済みの実績が消えることを見せるため）", () => {
  const w = work();
  const d = w.json();
  d.events.push({ id: "m90", date: T3, start: "09:00", end: "10:00", title: "作業ブロック", source: "mcp", skip: false, externalId: "solo1", confirmed: true });
  d.events.push({ id: "m91", date: T3, start: "10:00", end: "11:00", title: "ひとりで会議室", source: "mcp", skip: true, externalId: "solo2" });
  d.events.push({ id: "m92", date: T4, start: "10:00", end: "11:00", title: "予定表から消えた会議", source: "mcp", skip: false, externalId: "gone" });
  writeTwo(w.data, d);
  const fetched = w.put("fetched.json", fetchedSolo());
  const p = runEnv({ PROJECT_LENS_HOME: homeWith({ selfEmails: [SELF] }) }, "calendar-plan", w.data, fetched, T0, T6);
  assert.equal(p.status, 0, p.err);
  assert.deepEqual(p.out.removedByExclusion, [
    { id: "m90", title: "作業ブロック", date: T3, confirmed: true },
    { id: "m91", title: "ひとりで会議室", date: T3, confirmed: false },
  ]);
  const removedIds = p.out.removed.map((e) => e.id);
  assert.ok(["m90", "m91", "m92"].every((id) => removedIds.includes(id)), "3 件とも removed に出る");
  assert.ok(!p.out.removedByExclusion.some((e) => e.id === "m92"), "予定表から消えた会議（m92）は、removedByExclusion に出ない");
});

// ---- calendar-auto（見張り中の自動更新。承認の確認なしで書く）。時刻に依存しないよう、十分に古い日・先の日を使う ----
const OLD = "2000-01-01", FAR = "2999-01-01";
const autoWork = () => {
  const w = work();
  const d = w.json();
  d.events = [
    { id: "m1", date: OLD, start: "09:00", end: "10:00", title: "終わった会議", source: "mcp", skip: false, externalId: "old", confirmed: true },
    { id: "m2", date: FAR, start: "09:00", end: "10:00", title: "予定表から消えた会議", source: "mcp", skip: false, externalId: "gone" },
    { id: "m3", date: FAR, start: "11:00", end: "12:00", title: "手入力", source: "manual", skip: false },
  ];
  writeTwo(w.data, d);
  return w;
};

test("calendar-auto: 承認の確認なしで書く。消えた未来の会議は削除し、今日より前の会議（確認済み）は変えずに残す。結果に summary・held が出る", () => {
  const w = autoWork();
  const fetched = w.put("fetched.json", [{ externalId: "new", title: "新しい会議", date: FAR, start: "15:00", end: "16:00" }]);
  const r = run("calendar-auto", w.data, fetched, OLD, "2999-12-31");
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out.summary, { added: 1, updated: 0, removed: 1, excluded: 0, held: 0 }); // 今日より前は範囲の外なので、held にも出ない（held は calendar.test.js で確かめる）
  assert.deepEqual(r.out.held, []);
  assert.equal(r.out.blocked, null);
  assert.deepEqual(w.json().events.map((e) => e.externalId ?? e.id).sort(), ["m3", "new", "old"]);
});

test("calendar-auto: 取得が 0 件なら、削除しない。blocked に理由が出る", () => {
  const w = autoWork();
  const fetched = w.put("fetched.json", []);
  const r = run("calendar-auto", w.data, fetched, OLD, "2999-12-31");
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.summary.removed, 0);
  assert.equal(r.out.blocked.count, 1);
  assert.deepEqual(w.json().events.map((e) => e.id).sort(), ["m1", "m2", "m3"]);
});

test("calendar-auto: 日付が正しくないときは使い方を出して終了コード 2。何も書かない", () => {
  const w = autoWork();
  const fetched = w.put("fetched.json", []);
  const before = w.read();
  assert.equal(run("calendar-auto", w.data, fetched, "x", "y").status, 2);
  assert.equal(w.read(), before);
});

test("wbs-plan は planKey を出す。wbs-apply --plan-key が一致すれば書き、承認の間に変更案が変わっていれば、何も書かずに終了コード 1", () => {
  const w = work();
  const pid = w.json().projects[0].id;
  const rows = w.put("rows.json", [{ title: "承認後にずれる新規項目", due: "2026-12-01" }]);
  const plan = run("wbs-plan", w.data, pid, rows);
  assert.match(plan.out.planKey, /^[0-9a-f]{16}$/);
  // 承認待ちの間に、同じ件名のタスクが手で足された（wbsKey なし）。いまの案は「追加」でなく「更新」になる
  const d = w.json();
  d.tasks.push({ id: "ZZ1", projectId: pid, title: "承認後にずれる新規項目", due: "2026-11-30", start: null, status: "To Do", memo: "", predecessors: [], waitingOn: null, doneAt: null, checklist: [], sessions: [] });
  writeTwo(w.data, d);
  const before = w.read();
  const bad = run("wbs-apply", w.data, pid, rows, "--plan-key", plan.out.planKey);
  assert.equal(bad.status, 1);
  assert.match(bad.err, /承認した変更案と、いまのデータでの変更案が違います/);
  assert.equal(w.read(), before, "何も書かない");
  // 取り直した案の planKey なら、書ける
  const again = run("wbs-plan", w.data, pid, rows);
  assert.notEqual(again.out.planKey, plan.out.planKey);
  const ok = run("wbs-apply", w.data, pid, rows, "--plan-key", again.out.planKey);
  assert.equal(ok.status, 0, ok.err);
  assert.equal(ok.out.summary.updated, 1);
});

test("wbs-apply: --plan-key に値が無いときは、照合を黙って省かず、終了コード 2 で止まる", () => {
  const w = work(); const before = w.read();
  const rows = w.put("rows.json", [{ title: "x", due: "2026-12-01" }]);
  const r = run("wbs-apply", w.data, "AA", rows, "--plan-key");
  assert.equal(r.status, 2);
  assert.equal(w.read(), before);
});

// ---- 共有ファイル（data.json）と個人ファイル（personal.json） ----
const rdJson = (p) => JSON.parse(readFileSync(p, "utf8"));

test("2 ファイル: calendar-apply は personal.json の events だけ、wbs-apply は data.json の tasks だけを変える", () => {
  const w = work(), pp = join(w.dir, "personal.json");
  const fetched = w.put("fetched.json", [{ externalId: "x1", title: "新しい会議", date: T1, start: "10:00", end: "11:00" }]);
  const p = run("calendar-plan", w.data, fetched, T0, T6);
  const sharedBefore = readFileSync(w.data, "utf8"), personalBefore = readFileSync(pp, "utf8");
  assert.equal(run("calendar-apply", w.data, fetched, T0, T6, "--plan-key", p.out.planKey).status, 0);
  assert.equal(readFileSync(w.data, "utf8"), sharedBefore, "共有は変わらない");
  assert.ok(rdJson(pp).events.some((e) => e.title === "新しい会議"));
  const mid = readFileSync(pp, "utf8");
  assert.equal(run("wbs-apply", w.data, "AA", w.put("rows.json", ROWS)).status, 0);
  assert.equal(readFileSync(pp, "utf8"), mid, "個人は変わらない");
  assert.ok(rdJson(w.data).tasks.some((t) => t.title === "基本設計"));
  assert.notEqual(readFileSync(w.data, "utf8"), sharedBefore);
  assert.notEqual(mid, personalBefore);
});

test("--mine: 別の場所の個人ファイルへ events が書かれる。指定先が無ければ、終了コード 1 で何も書かない", () => {
  const w = work(), pp = join(w.dir, "personal.json"), other = join(w.dir, "elsewhere.json");
  copyFileSync(pp, other); rmSync(pp);
  const fetched = w.put("fetched.json", [{ externalId: "x1", title: "別の場所の会議", date: T1, start: "10:00", end: "11:00" }]);
  const p = run("calendar-plan", w.data, fetched, T0, T6, "--mine", other);
  assert.equal(run("calendar-apply", "--mine", other, w.data, fetched, T0, T6, "--plan-key", p.out.planKey).status, 0);
  assert.ok(rdJson(other).events.some((e) => e.title === "別の場所の会議"));
  assert.equal(existsSync(pp), false);
  const nope = join(w.dir, "nope.json"), before = w.read();
  const r = run("rules-set", w.data, "週次", "AA", "--mine", nope);
  assert.equal(r.status, 1);
  assert.match(r.err, /個人ファイル .*nope\.json がありません。--mine の指定を確かめてください/);
  assert.equal(existsSync(nope), false);
  assert.equal(w.read(), before);
});
