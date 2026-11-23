import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addDays, diffDays, toMin, toHHMM, weekday } from "../plugins/project-lens/src/core/dates.js";
import { validate, isImportantMark, OP_KINDS, PROPOSE_OPS } from "../plugins/project-lens/src/core/schema.js";

const load = () => JSON.parse(readFileSync(new URL("../plugins/project-lens/data/sample.json", import.meta.url), "utf8"));
const NOW = { date: "2026-10-20", time: "12:00" };
const v = (d) => validate(d, NOW);
const task = (d, id) => d.tasks.find((t) => t.id === id);
const hit = (list, word) => list.some((m) => m.includes(word));

test("重要: important: true は error なし。false・文字列は error。旧 importance キーは無視する", () => {
  const ok = load();
  task(ok, ok.tasks[0].id).important = true;
  assert.deepEqual(v(ok).errors, []);
  for (const bad of [false, "true", 1]) {
    const d = load();
    task(d, d.tasks[0].id).important = bad;
    assert.ok(hit(v(d).errors, "重要 (important) は true にするか、項目を消してください"), String(bad));
  }
  const old = load();
  task(old, old.tasks[0].id).importance = "mid";
  const r = v(old);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, v(load()).warnings);
});
test("isImportantMark: 重要で、終わっていないときだけ true", () => {
  assert.equal(isImportantMark({ important: true, status: "To Do" }), true);
  assert.equal(isImportantMark({ important: true, status: "Done" }), false);
  assert.equal(isImportantMark({ important: true, status: "Cancelled" }), false);
  assert.equal(isImportantMark({ status: "To Do" }), false);
});

test("サンプルデータはエラーなし", () => {
  assert.deepEqual(v(load()).errors, []);
});

test("日付・時刻の演算", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(diffDays("2026-03-01", "2026-02-28"), 1);
  assert.equal(weekday("2026-10-20"), 2);
  assert.equal(toMin("09:30"), 570);
  assert.equal(toHHMM(570), "09:30");
  assert.throws(() => addDays("2026-02-30", 1));
});

test("チェックリスト: 正しい形はエラーなし。配列でない・id の重複・text が空・done が真偽値でない・id が文字列でないはエラー", () => {
  const d = load();
  task(d, "AA-0004").checklist = [{ id: "c1", text: "a", done: false }, { id: "c2", text: "b", done: true }];
  assert.deepEqual(v(d).errors, []);
  const bad = (cl) => { const e = load(); task(e, "AA-0004").checklist = cl; return v(e).errors; };
  assert.ok(hit(bad("x"), "AA-0004"));
  assert.ok(hit(bad([{ id: "c1", text: "a", done: false }, { id: "c1", text: "b", done: false }]), "c1"));
  assert.ok(hit(bad([{ id: "c1", text: "  ", done: false }]), "AA-0004"));
  assert.ok(hit(bad([{ id: "c1", text: "a", done: "yes" }]), "AA-0004"));
  assert.ok(hit(bad([{ id: 1, text: "a", done: false }]), "AA-0004"));
});

test("不明な状態値はエラー", () => {
  const d = load(); task(d, "AA-0001").status = "Not Started";
  assert.ok(hit(v(d).errors, "AA-0001"));
  const p = load(); p.projects[0].status = "不明";
  assert.ok(hit(v(p).errors, "プロジェクト AA"));
});

test("存在しない前のタスク・projectId はエラー", () => {
  const d = load(); task(d, "AA-0002").predecessors = ["ZZ"];
  assert.ok(hit(v(d).errors, "ZZ"));
  const e = load(); task(e, "AA-0002").projectId = "AQ";
  assert.ok(hit(v(e).errors, "projectId"));
});

test("前のタスクの循環はエラー", () => {
  const d = load(); task(d, "AA-0001").predecessors = ["AA-0002"];
  assert.ok(hit(v(d).errors, "循環"));
});

test("日付形式の不正・プロジェクト開始>期限・枠の不正はエラー", () => {
  const a = load(); task(a, "AA-0001").due = "2026/07/31";
  assert.ok(hit(v(a).errors, "AA-0001"));
  const b = load(); b.projects[0].start = "2027-04-01";
  assert.ok(hit(v(b).errors, "開始日"));
  const c = load(); task(c, "AA-0005").sessions[0].end = "12:00";
  assert.ok(hit(v(c).errors, "S1"));
  const e = load(); task(e, "AB-0002").sessions[0] = { id: "S4", date: "2026-10-14", start: "14:00", end: "16:00", kind: "actual" };
  assert.ok(hit(v(e).errors, "重な"));
});

test("警告: Waiting で待ち先なし／終了済みで未来の予定／start>due（前のタスクがあっても start は有効で、無視の警告は出ない）", () => {
  const a = load(); task(a, "AA-0003").waitingOn = null;
  assert.ok(hit(v(a).warnings, "AA-0003"));
  const b = load(); task(b, "AA-0006").start = "2026-12-01";
  assert.ok(!hit(v(b).warnings, "AA-0006"), "前のタスクがあっても、start は無視されない");
  const b2 = load(); task(b2, "AA-0006").start = "2027-03-01"; // 前のタスクがあるタスクも、start > due はエラー
  assert.ok(hit(v(b2).errors, "AA-0006"));
  const c = load(); task(c, "AA-0005").status = "Done"; task(c, "AA-0005").doneAt = "2026-10-20";
  assert.ok(hit(v(c).warnings, "AA-0005"));
  const d = load(); task(d, "AA-0005").start = "2027-01-10";
  assert.ok(hit(v(d).errors, "AA-0005"));
  assert.deepEqual(v(a).errors, []);
});

test("空データは有効", () => {
  const d = { version: 1, settings: { ...load().settings, projectRules: [] }, projects: [], tasks: [], events: [], changeLog: [] };
  assert.deepEqual(v(d).errors, []);
});

test("警告: 前のタスクの期限が自分の期限より後（I2）", () => {
  const d = load(); task(d, "AA-0002").due = "2020-01-01";
  assert.ok(hit(v(d).warnings, "AA-0002"));
});

test("waitingOn.since が無い・不正ならエラー、deltaDays が整数でなければエラー（I4, M5）", () => {
  const a = load(); delete task(a, "AA-0003").waitingOn.since;
  assert.ok(hit(v(a).errors, "AA-0003"));
  const b = load(); b.changeLog[0].deltaDays = "<b>";
  assert.ok(hit(v(b).errors, "deltaDays"));
});

// ---- 追加した項目（大項目・中項目、会議のひも付けと確認、設定、取り込みの記録） ----
test("会議の projectId が存在しないプロジェクトなら error", () => {
  const d = load(); d.events[0].projectId = "ZZ";
  assert.ok(hit(v(d).errors, "projectId"));
  const ok = load(); ok.events[0].projectId = "AA"; ok.events[0].projectBy = "rule";
  assert.deepEqual(v(ok).errors, []);
});

test("projectBy が rule/manual 以外なら error", () => {
  const d = load(); d.events[0].projectBy = "auto";
  assert.ok(hit(v(d).errors, "projectBy"));
});

test("confirmed が真偽値でなければ error", () => {
  const d = load(); d.events[0].confirmed = "yes";
  assert.ok(hit(v(d).errors, "confirmed"));
  const ok = load(); ok.events[0].confirmed = true;
  assert.deepEqual(v(ok).errors, []);
});

test("会議の actual の形式が不正（時刻でない・開始が終了以前）は error、正しければ通る", () => {
  for (const bad of [{ start: "9:00", end: "10:00" }, { start: "10:00", end: "10:00" }, { start: "11:00", end: "10:00" }]) {
    const d = load(); d.events[0].actual = bad;
    assert.ok(hit(v(d).errors, "actual"), JSON.stringify(bad));
  }
  const ok = load(); ok.events[0].actual = { start: "10:05", end: "10:50" };
  assert.deepEqual(v(ok).errors, []);
});

test("projectRules の keyword が空、または projectId が存在しないなら error", () => {
  const a = load(); a.settings.projectRules = [{ keyword: "", projectId: "AA" }];
  assert.ok(hit(v(a).errors, "projectRules"));
  const b = load(); b.settings.projectRules = [{ keyword: "x", projectId: "ZZ" }];
  assert.ok(hit(v(b).errors, "projectRules"));
});

test("wbsImports は、存在するプロジェクトのキーと、file（文字列か null）・at（日付）・件数（0 以上の整数）を持つ。不正なら error", () => {
  const ok = load(); ok.settings.wbsImports = { AA: { file: "plan.xlsx", at: "2026-10-20", added: 2, updated: 0 }, AB: { file: null, at: "2026-10-20", added: 0, updated: 1 } };
  assert.deepEqual(v(ok).errors, []);
  for (const bad of [{ ZZ: { file: null, at: "2026-10-20", added: 0, updated: 0 } }, { AA: { file: 3, at: "2026-10-20", added: 0, updated: 0 } }, { AA: { file: null, at: "10/20", added: 0, updated: 0 } }, { AA: { file: null, at: "2026-10-20", added: -1, updated: 0 } }, { AA: { file: null, at: "2026-10-20", added: 1.5, updated: 0 } }, { A: null }]) {
    const d = load(); d.settings.wbsImports = bad;
    assert.ok(hit(v(d).errors, "wbsImports"), JSON.stringify(bad));
  }
});

test("wbsMappings のキーが存在しないプロジェクト、値が文字列でないなら error", () => {
  const a = load(); a.settings.wbsMappings = { ZZ: { title: "B" } };
  assert.ok(hit(v(a).errors, "wbsMappings"));
  const b = load(); b.settings.wbsMappings = { AA: { title: 3 } };
  assert.ok(hit(v(b).errors, "wbsMappings"));
  const ok = load(); ok.settings.wbsMappings = { AA: { title: "件名", due: "期限" } };
  assert.deepEqual(v(ok).errors, []);
});

test("changeLog の source が wbs/calendar/inbox 以外なら error", () => {
  const a = load(); a.changeLog.push({ at: "2026-10-20", taskIds: [], reason: "x", cause: null, deltaDays: 0, source: "fax" });
  assert.ok(hit(v(a).errors, "source"));
  const m = load(); m.changeLog.push({ at: "2026-10-20", taskIds: [], reason: "x", cause: null, deltaDays: 0, source: "mail" });
  assert.ok(hit(v(m).errors, "source"));
  const ok = load(); ok.changeLog.push({ at: "2026-10-20", taskIds: [], reason: "x", cause: null, deltaDays: 0, source: "wbs" });
  assert.deepEqual(v(ok).errors, []);
});

test("新しい項目が無い従来のデータも error にならない", () => {
  const d = load();
  for (const t of d.tasks) { delete t.group; delete t.subgroup; delete t.wbsKey; }
  for (const e of d.events) { delete e.projectId; delete e.projectBy; delete e.confirmed; }
  delete d.settings.projectRules; delete d.settings.labels; delete d.settings.wbsMappings;
  assert.deepEqual(v(d).errors, []);
});

test("サンプルは新しい項目を使っている（大項目・会議のひも付け・規則）", () => {
  const d = load();
  assert.ok(d.tasks.some((t) => t.group && t.subgroup));
  assert.ok(d.events.some((e) => e.projectId && e.projectBy === "rule"));
  assert.ok(d.events.some((e) => e.confirmed === true));
  assert.deepEqual(d.settings.projectRules, [{ keyword: "ベンダーX", projectId: "AA" }]);
  assert.equal(d.settings.labels.group, "大項目");
});

// ---- 受信箱（inbox） ----
const REQ = (extra = {}) => ({ id: "R1", at: "2026-10-21T10:00:00.000Z", projectId: null, status: "pending", thread: [{ role: "user", at: "2026-10-21T10:00:00.000Z", text: "依頼" }], proposal: null, result: null, ...extra });

test("inbox: 正しければ errors なし。inbox が無い従来のデータも通る。changeLog の source: inbox を認める", () => {
  const d = load();
  assert.deepEqual(v(d).errors, []);
  d.inbox = { watching: { at: "2026-10-21T10:00:00.000Z" }, requests: [REQ(), REQ({ id: "R2", status: "proposed", projectId: "AA", proposal: { summary: "s", ops: [{ op: "moveDue", taskId: "AA-0003", deltaDays: 5 }], sections: [], warnings: [], base: {} } })] };
  assert.deepEqual(v(d).errors, []);
  d.changeLog.push({ at: "2026-10-21", taskIds: ["AA-0003"], reason: "受信箱", cause: null, deltaDays: 0, source: "inbox" });
  assert.deepEqual(v(d).errors, []);
});

test("inbox: 不正な status・重複 id・不明な projectId・不正な op・不正な thread・不正な watching は error", () => {
  const bad = [
    { requests: [REQ({ status: "done" })] },
    { requests: [REQ(), REQ()] },
    { requests: [REQ({ projectId: "ZZ" })] },
    { requests: [REQ({ proposal: { summary: "s", ops: [{ op: "deleteTask" }] } })] },
    { requests: [REQ({ thread: [{ role: "bot", at: "x", text: "y" }] })] },
    { requests: [REQ({ thread: "x" })] },
    { requests: "x" },
    { watching: { at: 5 }, requests: [] },
  ];
  for (const inbox of bad) {
    const d = load(); d.inbox = inbox;
    assert.ok(hit(v(d).errors, "inbox"), JSON.stringify(inbox));
  }
});

// ---- settings の形の注意（エラーにはしない） ----
const withSettings = (s) => { const d = load(); d.settings = { ...d.settings, ...s }; return d; };
const settingsWarn = (d, key) => v(d).warnings.filter((m) => m.startsWith(`settings.${key}:`));

test("settings: 形が違う waitingLongDays・labels は注意（エラーにしない）", () => {
  const bad = {
    waitingLongDays: ["7", 0, 1.5, -2],
    labels: ["x", { group: 1 }, { subgroup: null }],
  };
  for (const [key, values] of Object.entries(bad)) {
    for (const value of values) {
      const d = withSettings({ [key]: value });
      assert.equal(settingsWarn(d, key).length, 1, `${key}=${JSON.stringify(value)}`);
      assert.deepEqual(v(d).errors, [], `${key}=${JSON.stringify(value)}`);
    }
  }
});

test("settings: 正しい値と settings なしのファイルに、settings の注意は出ない", () => {
  const ok = withSettings({ waitingLongDays: 3, labels: { group: "フェーズ" } });
  assert.deepEqual(v(withSettings({ workday: "x" })).warnings.filter((m) => m.startsWith("settings.")), [], "古いファイルに残った workday は、形が違っても何も言わない（使わない）");
  assert.deepEqual(v(ok).warnings.filter((m) => m.startsWith("settings.")), []);
  const none = load();
  delete none.settings;
  assert.deepEqual(v(none).warnings.filter((m) => m.startsWith("settings.")), []);
  assert.deepEqual(v(load()).warnings.filter((m) => m.startsWith("settings.")), []);
});

test("settings: null は未設定として扱い（読む側は既定で動く）、注意を出さない。waitingLongDays の注意は既定で動くとは言わない", () => {
  for (const key of ["waitingLongDays", "labels"]) assert.equal(settingsWarn(withSettings({ [key]: null }), key).length, 0, key);
  const [w] = settingsWarn(withSettings({ waitingLongDays: 0 }), "waitingLongDays");
  assert.ok(!w.includes("既定の 7 で動きます") && w.includes("遅延バッジ"), w);
});

test("settings.holidays・workdays・nationalHolidays: 形が違うと注意（エラーにしない）。正しい形・未設定・null は出ない。前版の文字列の配列も注意", () => {
  const H = { date: "2026-10-26", kind: "有給", note: "x" };
  const bad = {
    holidays: ["2026-10-26", [H, { date: "2026-02-30", kind: "祝日" }], [{ date: "2026-10-26", kind: "休暇" }], [null], "x", {}],
    workdays: [["2026-10-26"], [{ date: "x" }], "x"],
    nationalHolidays: [5, { fetchedAt: "x", dates: [] }, { fetchedAt: "2026-10-25", dates: "x" }, { fetchedAt: "2026-10-25", dates: [{ date: "x" }] }],
  };
  for (const [key, values] of Object.entries(bad)) {
    for (const value of values) {
      const d = withSettings({ [key]: value });
      assert.equal(settingsWarn(d, key).length, 1, `${key}=${JSON.stringify(value)}`);
      assert.deepEqual(v(d).errors, [], `${key}=${JSON.stringify(value)}`);
    }
  }
  const ok = { holidays: [H, { date: "2026-11-23", kind: "祝日" }], workdays: [{ date: "2026-10-31" }], nationalHolidays: { fetchedAt: "2026-10-25", source: "u", dates: [{ date: "2026-11-03", name: "文化の日" }] } };
  for (const key of Object.keys(ok)) {
    assert.equal(settingsWarn(withSettings({ [key]: ok[key] }), key).length, 0, key);
    for (const value of [[], null]) if (key !== "nationalHolidays") assert.equal(settingsWarn(withSettings({ [key]: value }), key).length, 0, key);
    assert.equal(settingsWarn(withSettings({ [key]: null }), key).length, 0, key);
  }
});

test("settings.holidays の注意は、形の違う要素を data.json から直接直す旨を添える（画面から消せないため）", () => {
  const [w] = settingsWarn(withSettings({ holidays: ["2026-10-26"] }), "holidays");
  assert.match(w, /data\.json/);
});

test("警告: 終了済みのタスクに残る予定枠の警告は、まだ開始していない枠だけ（進行中の枠は、完了時に残す仕様なので警告しない）", () => {
  const d = load();
  const A1 = task(d, "AA-0001"); // Done
  A1.sessions = [
    { id: "S90", date: NOW.date, start: "10:00", end: "23:00", kind: "planned" }, // 開始済み・未終了（進行中）
    { id: "S91", date: NOW.date, start: "23:00", end: "23:30", kind: "planned" }, // 開始前
  ];
  const now = { date: NOW.date, time: "12:00" };
  const w = validate(d, now).warnings.filter((m) => m.includes("未来の予定枠"));
  assert.equal(w.length, 1, w.join(" / "));
  assert.ok(w[0].includes("S91") && !w[0].includes("S90"));
});

test("settings.countWeekendsAndHolidays: 真偽値でないと注意（エラーにしない）。true・false・null・無しは注意なし", () => {
  for (const value of ["true", 1, [true], {}]) {
    const d = withSettings({ countWeekendsAndHolidays: value });
    assert.equal(settingsWarn(d, "countWeekendsAndHolidays").length, 1, JSON.stringify(value));
    assert.deepEqual(v(d).errors, [], JSON.stringify(value));
  }
  for (const value of [true, false, null]) assert.equal(settingsWarn(withSettings({ countWeekendsAndHolidays: value }), "countWeekendsAndHolidays").length, 0, String(value));
  assert.equal(settingsWarn(load(), "countWeekendsAndHolidays").length, 0);
});

test("inbox: 依頼で受けなくなった操作（setStatus）を持つ保存済みの提案も、検証は通す（データを読み捨てない）", () => {
  const d = load();
  d.inbox = { requests: [REQ({ status: "proposed", projectId: "AA", proposal: { summary: "s", ops: [{ op: "setStatus", taskId: "AA-0001", status: "Done" }], sections: [], warnings: [], base: {} } })] };
  assert.deepEqual(v(d).errors, []);
});

test("PROPOSE_OPS は addTask と moveDue だけ。OP_KINDS は保存済みの検証用に残る", () => {
  assert.deepEqual(PROPOSE_OPS, ["addTask", "moveDue"]);
  for (const k of PROPOSE_OPS) assert.ok(OP_KINDS.includes(k), k);
  assert.ok(OP_KINDS.includes("setStatus"));
});

test("作業枠の ID が別のタスクで重複していたら warning（保存は止めない）", () => {
  const d = load();
  const [a, b] = d.tasks.filter((t) => (t.sessions ?? []).length === 0).slice(0, 2);
  a.sessions = [{ id: "S99", date: "2026-10-26", start: "10:00", end: "11:00", kind: "planned" }];
  b.sessions = [{ id: "S99", date: "2026-10-27", start: "10:00", end: "11:00", kind: "planned" }];
  const r = v(d);
  assert.deepEqual(r.errors, []);
  assert.ok(hit(r.warnings, "作業枠の ID が重複しています: S99"));
  assert.ok(!hit(v(load()).warnings, "作業枠の ID が重複"), "サンプルは重複なし");
});

test("共有ファイルに無いタスクの作業枠(orphanSessions)も、作業枠の ID の重複を warning にする（error にはしない）", () => {
  const orphan = (id) => ({ id, taskId: "ZZ-0099", date: "2026-10-21", start: "09:00", end: "10:00", kind: "planned" });
  const live = load().tasks.flatMap((t) => t.sessions ?? [])[0].id;
  const withLive = load();
  withLive.orphanSessions = [orphan(live)];
  const r = v(withLive);
  assert.deepEqual(r.errors, []);
  assert.ok(hit(r.warnings, `作業枠の ID が重複しています: ${live}`), "生きている枠と同じ ID");
  const twoOrphans = load();
  twoOrphans.orphanSessions = [orphan("S900"), orphan("S900")];
  assert.ok(hit(v(twoOrphans).warnings, "作業枠の ID が重複しています: S900"), "共有に無い枠どうし");
  const distinct = load();
  distinct.orphanSessions = [orphan("S900"), orphan("S901")];
  assert.ok(!hit(v(distinct).warnings, "作業枠の ID が重複"), "ID が別なら出さない");
});

test("reportShowMeetingTitles が残っていても検証は何も言わない", () => {
  const r = v(withSettings({ reportShowMeetingTitles: "x" }));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test("タスクの開始日が期限より後はエラー（警告にしない）。プロジェクトと同じ扱い", () => {
  const t = load(); task(t, "AA-0005").start = "2027-01-10"; task(t, "AA-0005").due = "2027-01-09";
  const r = v(t);
  assert.deepEqual(r.errors.filter((m) => m.includes("開始日が期限より後です")), ["タスク AA-0005: 開始日が期限より後です"]);
  assert.ok(!hit(r.warnings, "開始日が期限より後"));
  const p = load(); p.projects[0].start = "2027-04-01"; p.projects[0].due = "2027-03-01";
  assert.ok(hit(v(p).errors, `プロジェクト ${p.projects[0].id}: 開始日が期限より後です`));
});

test("前のタスクの期限が自分の期限より後は、警告のまま（エラーにしない）", () => {
  const d = load(); task(d, "AA-0002").due = "2020-01-01"; task(d, "AA-0002").start = "2020-01-01";
  const r = v(d);
  assert.ok(hit(r.warnings, "前のタスクの期限が自分の期限より後です"));
  assert.ok(!hit(r.errors, "前のタスクの期限"));
});

test("validate: 要素の形が崩れた data.json は、例外ではなく日本語の errors を返す（画面と CLI が原因を出せるように）", () => {
  const cases = [
    ["tasks[0] がオブジェクトではありません", (d) => { d.tasks = [null]; }],
    ["events[0] がオブジェクトではありません", (d) => { d.events = [null]; }],
    ["changeLog[0] がオブジェクトではありません", (d) => { d.changeLog = [null]; }],
    ["tasks[0].predecessors が配列ではありません", (d) => { d.tasks[0].predecessors = "AA-0002"; }],
    ["tasks[0].predecessors が配列ではありません", (d) => { d.tasks[0].predecessors = 5; }],
    ["tasks[0].sessions が配列ではありません", (d) => { d.tasks[0].sessions = {}; }],
    ["tasks[0].sessions[0] がオブジェクトではありません", (d) => { d.tasks[0].sessions = [null]; }],
    ["projects[0].milestones が配列ではありません", (d) => { d.projects[0].milestones = {}; }],
    ["settings.projectRules が配列ではありません", (d) => { d.settings.projectRules = {}; }],
  ];
  for (const [word, mutate] of cases) {
    const d = load();
    mutate(d);
    let r;
    assert.doesNotThrow(() => { r = v(d); }, word);
    assert.ok(hit(r.errors, word), `${word}: ${r.errors.join(" / ")}`);
  }
  assert.deepEqual(v(load()).errors, [], "正しいサンプルは、エラーなし");
});

test("validate: 期限が今日から 10 年以上離れていたら注意（年の打ち間違い）。エラーにはしない", () => {
  const d = load();
  task(d, "AA-0001").due = "2226-05-01";
  d.projects[0].due = "2226-05-01";
  const r = v(d);
  assert.ok(hit(r.warnings, "タスク AA-0001: 期限 2226-05-01 が今日から 10 年以上離れています"), r.warnings.join(" / "));
  assert.ok(hit(r.warnings, `プロジェクト ${d.projects[0].id}: 期限 2226-05-01`));
  assert.ok(!hit(r.errors, "2226"));
  assert.ok(!hit(v(load()).warnings, "10 年以上"), "サンプルは注意なし");
});

test("projectId が null のタスクはエラーなし。存在しない projectId はエラー", () => {
  const d = load();
  task(d, "AC-0001").projectId = null;
  assert.deepEqual(v(d).errors, []);
  task(d, "AC-0001").projectId = "ZZ";
  assert.ok(hit(v(d).errors, "不明な projectId"));
  delete task(d, "AC-0001").projectId;
  assert.ok(hit(v(d).errors, "不明な projectId"));
});

test("changeLog の source が screen の履歴は error（画面の期限変更は記録しない）", () => {
  const a = load(); a.changeLog.push({ at: "2026-10-20", taskIds: [], reason: "x", cause: null, deltaDays: 0, source: "screen" });
  assert.ok(hit(v(a).errors, "不明な source"));
});

test("共有ファイルに無いタスクの作業枠(orphanSessions): あれば警告（error ではない）、無い・空なら警告なし", () => {
  const word = "共有ファイルに無いタスクの作業枠が 1 件あります";
  const d = load();
  d.orphanSessions = [{ id: "S9", taskId: "ZZ-0099", date: "2026-10-21", start: "09:00", end: "10:00", kind: "planned" }];
  const r = v(d);
  assert.deepEqual(r.errors, []);
  assert.ok(hit(r.warnings, word));
  for (const none of [undefined, []]) {
    const e = load();
    if (none) e.orphanSessions = none;
    assert.ok(!hit(v(e).warnings, "共有ファイルに無いタスクの作業枠"));
  }
});

test("作業枠の重なりは、同じ種別どうしだけ error（予定と実績は重なってよい）。古いデータに残った running のキーは読まず、検証も何も言わない", () => {
  const base = () => { const d = load(); d.tasks.find((t) => t.id === "AA-0004").sessions = [{ id: "S50", date: "2026-10-20", start: "10:00", end: "10:15", kind: "actual", running: true }]; return d; };
  assert.deepEqual(v(base()).errors, []);
  assert.ok(!v(base()).warnings.some((w) => w.includes("running")));
  for (const running of [false, "true"]) { const d = base(); d.tasks.find((t) => t.id === "AA-0004").sessions[0].running = running; assert.deepEqual(v(d).errors, [], String(running)); }
  const ov = base(); ov.tasks.find((t) => t.id === "AA-0005").sessions.push({ id: "S51", date: "2026-10-20", start: "10:05", end: "11:00", kind: "planned" });
  assert.deepEqual(v(ov).errors, [], "実績と予定の重なりは error にならない");
  const aa = base(); aa.tasks.find((t) => t.id === "AA-0005").sessions.push({ id: "S52", date: "2026-10-20", start: "10:05", end: "11:00", kind: "actual" });
  assert.ok(v(aa).errors.some((e) => e.includes("S50") && e.includes("S52")), "実績どうしの重なりは error");
});
