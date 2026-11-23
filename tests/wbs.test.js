import { test } from "node:test";
import assert from "node:assert/strict";
import { wbsKey, planWbsImport, applyWbsImport, getWbsMapping, setWbsMapping } from "../plugins/project-lens/src/import/wbs.js";
import { validate } from "../plugins/project-lens/src/core/schema.js";

const empty = () => ({ version: 1, settings: {}, projects: [{ id: "AA", name: "更改", type: "更改", status: "進行中", start: "2026-10-01", due: "2027-03-31", milestones: [] }], tasks: [], events: [], changeLog: [] });
const rows = () => [
  { group: "設計", subgroup: "要件", title: "要件定義", due: "2026-11-10" },
  { group: "設計", subgroup: "要件", title: "基本設計", due: "2026-11-20", predecessorKeys: ["設計/要件/要件定義"] },
  { group: "構築", title: "機器設定", due: "2026-12-05", start: "2026-11-25", status: "In Progress" },
];
const TODAY = "2026-10-20";
const run = (d, r) => applyWbsImport(d, "AA", planWbsImport(d, "AA", r), { today: TODAY });
const byKey = (d, k) => d.tasks.find((t) => t.wbsKey === k);

test("wbsKey: 空の段は位置を残し（件名だけの行は件名のまま）、全角スペースと前後の空白を除く", () => {
  assert.equal(wbsKey({ group: "　設計　", subgroup: "  ", title: " 要件定義 " }), "設計//要件定義");
  assert.equal(wbsKey({ title: "単独" }), "単独");
});

test("plan: 空のプロジェクトへは全行 add。期限なしの新規行と重複キーと不正な状態は rejected", () => {
  const d = empty();
  const p = planWbsImport(d, "AA", rows());
  assert.equal(p.add.length, 3);
  assert.deepEqual(p.update, []);
  const bad = planWbsImport(d, "AA", [
    { title: "期限なし" }, { title: "重複", due: "2026-11-01" }, { title: "重複", due: "2026-11-02" },
    { title: "状態", due: "2026-11-01", status: "Waiting" }, { title: "日付", due: "2026/11/01" },
  ]);
  assert.deepEqual(bad.add.map((a) => a.key), ["重複"]);
  assert.deepEqual(bad.rejected.map((r) => r.index), [0, 2, 3, 4]);
  assert.match(bad.rejected[0].reason, /期限/);
  assert.match(bad.rejected[1].reason, /重複/);
});

test("plan: importance の列は取り込まない（タスクに important・importance が付かない）", () => {
  const d = run(empty(), [{ title: "高", due: "2026-11-01", importance: "high" }]);
  const t = d.tasks.find((x) => x.title === "高");
  assert.ok(t);
  assert.equal("important" in t, false);
  assert.equal("importance" in t, false);
});

test("plan: 再取り込みで同じ内容は same、期限が変わった行は update(before/after)、WBS に無い既存は missing", () => {
  const d = run(empty(), rows());
  const again = planWbsImport(d, "AA", rows());
  assert.equal(again.add.length + again.update.length, 0);
  assert.equal(again.same.length, 3);
  const changed = rows(); changed[1].due = "2026-11-25"; changed.pop();
  const p = planWbsImport(d, "AA", changed);
  assert.equal(p.update.length, 1);
  assert.deepEqual([p.update[0].before.due, p.update[0].after.due], ["2026-11-20", "2026-11-25"]);
  assert.deepEqual(p.missing, [byKey(d, "構築//機器設定").id]);
});

test("plan: 画面で直した title は update の対象にならない（title だけ違う行は same）", () => {
  let d = run(empty(), rows());
  d = { ...d, tasks: d.tasks.map((t) => (t.wbsKey === "設計/要件/基本設計" ? { ...t, title: "基本設計（改）" } : t)) };
  const p = planWbsImport(d, "AA", rows());
  assert.equal(p.update.length, 0);
  const n = applyWbsImport(d, "AA", p, { today: TODAY });
  assert.equal(byKey(n, "設計/要件/基本設計").title, "基本設計（改）");
});

test("plan: predecessorKeys は既存・今回の行へ解決でき、解決できないキーは warnings", () => {
  const p = planWbsImport(empty(), "AA", [{ title: "X", due: "2026-11-01", predecessorKeys: ["存在しない"] }]);
  assert.equal(p.warnings.length, 1);
  assert.match(p.warnings[0], /存在しない/);
  assert.equal(planWbsImport(empty(), "AA", rows()).warnings.length, 0);
});

test("plan は data を変えない（deep equal）", () => {
  const d = run(empty(), rows());
  const before = JSON.stringify(d);
  planWbsImport(d, "AA", rows());
  assert.equal(JSON.stringify(d), before);
});

test("apply: 追加のタスクに group/subgroup/wbsKey/predecessors が入り、ID が重複しない。changeLog に source:'wbs'", () => {
  const d = run(empty(), rows());
  const t = byKey(d, "設計/要件/基本設計");
  assert.deepEqual([t.group, t.subgroup, t.projectId], ["設計", "要件", "AA"]);
  assert.deepEqual(t.predecessors, [byKey(d, "設計/要件/要件定義").id]);
  const k = byKey(d, "構築//機器設定");
  assert.deepEqual([k.group, k.subgroup ?? null, k.status, k.start], ["構築", null, "In Progress", "2026-11-25"]);
  assert.equal(new Set(d.tasks.map((x) => x.id)).size, 3);
  assert.deepEqual(d.changeLog.map((c) => [c.source, c.deltaDays, c.cause]), [["wbs", 0, null]]);
  assert.deepEqual(validate(d).errors, []);
});

test("apply: 2回続けて plan→apply しても追加は増えず、changeLog も増えない（冪等）", () => {
  const once = run(empty(), rows());
  const twice = run(once, rows());
  assert.equal(twice.tasks.length, 3);
  assert.equal(twice.changeLog.length, 1);
  assert.deepEqual(twice, once);
});

test("apply: 更新が反映される（期限・状態）。Done にすると完了日が入る", () => {
  const d = run(empty(), rows());
  const r = rows(); r[0].due = "2026-11-12"; r[0].status = "Done";
  const n = run(d, r);
  const t = byKey(n, "設計/要件/要件定義");
  assert.deepEqual([t.due, t.status, t.doneAt], ["2026-11-12", "Done", TODAY]);
  assert.equal(n.changeLog.length, 2);
});

test("plan・apply: 前のタスクが循環するときは、循環になる指定だけ設定せず、警告に出す（取り込み全体は止まらない）", () => {
  const r = [
    { title: "A1", due: "2026-11-01", predecessorKeys: ["A2"] },
    { title: "A2", due: "2026-11-02", predecessorKeys: ["A1"] },
    { title: "自分", due: "2026-11-03", predecessorKeys: ["自分"] },
    { title: "別", due: "2026-11-04" },
  ];
  const d = empty();
  const p = planWbsImport(d, "AA", r);
  assert.equal(p.rejected.length, 0);
  assert.deepEqual(p.warnings.filter((w) => /循環/.test(w)).map((w) => /^行 \d+「[^」]+」/.exec(w)[0]), ["行 2「A2」", "行 3「自分」"]);
  const out = applyWbsImport(d, "AA", p, { today: TODAY });
  assert.equal(out.tasks.length, 4, "ほかの行は取り込まれる");
  assert.deepEqual(byKey(out, "A1").predecessors, [byKey(out, "A2").id]);
  assert.deepEqual(byKey(out, "A2").predecessors, [], "循環になる A2 → A1 は設定しない");
  assert.deepEqual(byKey(out, "自分").predecessors, []);
  assert.deepEqual(validate(out).errors, []);
});

test("plan: 既存のタスクの前のタスクを含めて循環を見る（既存の B → A のとき、A の前のタスクに B は指定できない）", () => {
  const d = empty();
  d.tasks.push(
    { id: "AA-0001", projectId: "AA", title: "a", due: "2026-11-01", status: "To Do", wbsKey: "a", predecessors: [] },
    { id: "AA-0002", projectId: "AA", title: "b", due: "2026-11-02", status: "To Do", wbsKey: "b", predecessors: ["AA-0001"] },
  );
  const p = planWbsImport(d, "AA", [{ title: "a", predecessorKeys: ["b"] }]);
  assert.equal(p.update.length, 0);
  assert.match(p.warnings.join("\n"), /循環になるため設定しません/);
});

test("plan: 弾いた行の既存タスクは、「WBS に無い（missing）」に入れない（WBS には書かれているため）", () => {
  const d = empty();
  d.tasks.push({ id: "AA-0001", projectId: "AA", title: "a", due: "2026-11-01", status: "To Do", wbsKey: "a", predecessors: [] }, { id: "AA-0002", projectId: "AA", title: "z", due: "2026-11-01", status: "To Do", wbsKey: "z", predecessors: [] });
  const p = planWbsImport(d, "AA", [{ title: "a", due: "2026-13-40" }]);
  assert.equal(p.rejected.length, 1);
  assert.deepEqual(p.missing, ["AA-0002"], "WBS に書かれていない z だけが missing");
});

test("plan: 開始日が期限より後の行は、前のタスクとして解決せず、その行を前のタスクにした行に警告を出す（黙って消さない）", () => {
  const d = empty();
  const p = planWbsImport(d, "AA", [
    { title: "B", start: "2026-12-01", due: "2026-11-01" },
    { title: "C", due: "2026-11-20", predecessorKeys: ["B"] },
  ]);
  assert.deepEqual(p.rejected.map((x) => [x.key, x.reason]), [["B", "開始日が期限より後です"]]);
  assert.match(p.warnings.join("\n"), /行 2「C」: 前のタスク "B" が見つかりません/);
});

test("setWbsMapping/getWbsMapping: 保存して読み戻せる。title の列が無ければ例外、他のプロジェクトの対応は変わらない", () => {
  const d = empty(); d.projects.push({ ...d.projects[0], id: "AB" });
  const a = setWbsMapping(d, "AA", { title: "作業名", due: "期限" });
  assert.deepEqual(getWbsMapping(a, "AA"), { title: "作業名", due: "期限" });
  assert.equal(getWbsMapping(a, "AB"), null);
  const b = setWbsMapping(a, "AB", { title: "件名" });
  assert.deepEqual(getWbsMapping(b, "AA"), { title: "作業名", due: "期限" });
  assert.throws(() => setWbsMapping(d, "AA", { due: "期限" }), /件名/);
  assert.throws(() => setWbsMapping(d, "ZZ", { title: "x" }));
  assert.deepEqual(validate(b).errors, []);
});

// ---- 最終レビューの修正 ----
test("plan/apply: 既存の行で期限・状態のセルが空（\"\" や null）でも、更新案に出さず、apply も失敗しない", () => {
  const d = run(empty(), rows());
  const blank = rows().map((r) => ({ ...r, due: "", status: null, start: null }));
  const p = planWbsImport(d, "AA", blank);
  assert.equal(p.update.length, 0);
  assert.equal(p.same.length, 3);
  assert.deepEqual(applyWbsImport(d, "AA", p, { today: TODAY }), d);
});

test("plan: predecessorKeys が null でも落ちず、『指定なし』として扱う", () => {
  const d = run(empty(), rows());
  const r = rows(); r[1].predecessorKeys = null;
  const p = planWbsImport(d, "AA", r);
  assert.equal(p.update.length, 0);
  assert.doesNotThrow(() => planWbsImport(empty(), "AA", [{ title: "X", due: "2026-11-01", predecessorKeys: null }]));
});

// ---- 見送った Minor の修正 ----
test("wbsKey: 空の段の位置や、名前に含まれる / が違えば、別のキーになる。普通の3段と件名だけはそのまま", () => {
  assert.notEqual(wbsKey({ group: "X", subgroup: "", title: "Y" }), wbsKey({ group: "", subgroup: "X", title: "Y" }));
  assert.notEqual(wbsKey({ group: "X/Y", subgroup: "", title: "Z" }), wbsKey({ group: "X", subgroup: "Y", title: "Z" }));
  assert.equal(wbsKey({ group: "設計", subgroup: "要件", title: "要件定義" }), "設計/要件/要件定義");
  assert.equal(wbsKey({ title: "単独" }), "単独");
});

test("plan: 空の段の位置だけが違う2行は、重複として弾かれず、別の項目になる", () => {
  const p = planWbsImport(empty(), "AA", [
    { group: "X", subgroup: "", title: "Y", due: "2026-11-01" }, { group: "", subgroup: "X", title: "Y", due: "2026-11-02" },
  ]);
  assert.equal(p.add.length, 2);
  assert.equal(p.rejected.length, 0);
});

test("plan: 前のタスクキーは、空の段を詰めた書き方（構築/機器設定）でも、曖昧でなければ解決できる", () => {
  const p = planWbsImport(empty(), "AA", [
    { group: "構築", title: "機器設定", due: "2026-12-05" },
    { group: "構築", subgroup: "試験", title: "疎通", due: "2026-12-10", predecessorKeys: ["構築/機器設定"] },
  ]);
  assert.equal(p.warnings.length, 0);
  assert.deepEqual(p.add[1].row.predecessorKeys, ["構築//機器設定"]);
  const d = applyWbsImport(empty(), "AA", p, { today: TODAY });
  const pre = d.tasks.find((t) => t.title === "疎通").predecessors;
  assert.deepEqual(pre, [d.tasks.find((t) => t.title === "機器設定").id]);
});

const legacy = (id, title, extra = {}) => ({ id, projectId: "AA", title, due: "2026-11-01", start: null, status: "To Do", memo: "", predecessors: [], waitingOn: null, doneAt: null, sessions: [], ...extra });

test("plan/apply: wbsKey の無い手入力のタスクと同じ件名の行は、追加ではなく更新（wbsKey を付ける）として照合する", () => {
  const d = empty(); d.tasks.push(legacy("AA-0001", "要件定義"));
  const p = planWbsImport(d, "AA", rows());
  assert.equal(p.add.length, 2);
  assert.equal(p.update.length, 1);
  assert.equal(p.update[0].taskId, "AA-0001");
  assert.equal(p.update[0].after.wbsKey, "設計/要件/要件定義");
  assert.equal(p.update[0].after.due, "2026-11-10");
  const n = applyWbsImport(d, "AA", p, { today: TODAY });
  assert.equal(n.tasks.length, 3);
  const a1 = n.tasks.find((t) => t.id === "AA-0001");
  assert.deepEqual([a1.wbsKey, a1.group, a1.title], ["設計/要件/要件定義", "設計", "要件定義"]);
  const again = planWbsImport(n, "AA", rows());
  assert.equal(again.add.length + again.update.length, 0);
  assert.equal(n.tasks.find((t) => t.title === "基本設計").predecessors[0], "AA-0001", "前のタスクも手入力のタスクへ解決される");
});

test("plan: 同じ件名の手入力のタスクが複数あるときは曖昧なので、照合せず追加にする", () => {
  const d = empty(); d.tasks.push(legacy("AA-0001", "要件定義"), legacy("AA-0002", "要件定義"));
  const p = planWbsImport(d, "AA", rows());
  assert.equal(p.add.length, 3);
  assert.equal(p.update.length, 0);
});

test("applyWbsImport: 取り込み記録（ファイル名・日付・件数）を、プロジェクトごとに最後の 1 件だけ書く。変更がなければ書かない", () => {
  const d0 = empty();
  const d1 = applyWbsImport(d0, "AA", planWbsImport(d0, "AA", rows()), { today: TODAY, source: "plan.xlsx" });
  assert.deepEqual(d1.settings.wbsImports.AA, { file: "plan.xlsx", at: TODAY, added: 3, updated: 0 });
  const changed = rows().map((r, i) => (i === 0 ? { ...r, due: "2026-11-11" } : r));
  const d2 = applyWbsImport(d1, "AA", planWbsImport(d1, "AA", changed), { today: "2026-10-25" });
  assert.deepEqual(d2.settings.wbsImports.AA, { file: null, at: "2026-10-25", added: 0, updated: 1 }, "source なしは null で、前の記録を置き換える");
  const same = applyWbsImport(d2, "AA", planWbsImport(d2, "AA", changed), { today: "2026-10-30", source: "x.xlsx" });
  assert.equal(same, d2, "変更がなければ、データも記録も変えない");
  assert.equal(d0.settings.wbsImports, undefined, "元のデータは変わらない");
});

test("apply: 再取り込みで、既存タスクのチェックリストは消えない", () => {
  const d = run(empty(), rows());
  const k = "設計/要件/要件定義";
  const withCk = { ...d, tasks: d.tasks.map((t) => (t.wbsKey === k ? { ...t, checklist: [{ id: "c1", text: "a", done: true }] } : t)) };
  const r = rows(); r[0].due = "2026-11-12";
  assert.deepEqual(byKey(run(withCk, r), k).checklist, [{ id: "c1", text: "a", done: true }]);
});

test("planWbsImport: 開始日が期限より後の行は、新規でも更新でも弾く（取り込み全体は止めない）", () => {
  const d = empty();
  const bad = { title: "逆転", start: "2026-12-01", due: "2026-11-15" };
  const p = planWbsImport(d, "AA", [bad, { title: "正常", due: "2026-11-20" }]);
  assert.deepEqual(p.rejected.map((r) => [r.key, r.reason]), [["逆転", "開始日が期限より後です"]]);
  assert.equal(p.add.length, 1);
  const d2 = run(d, [{ title: "既存", start: "2026-11-01", due: "2026-11-30" }]);
  const p2 = planWbsImport(d2, "AA", [{ title: "既存", due: "2026-10-15" }]); // 既存の開始日 11/01 より前の期限
  assert.equal(p2.rejected.length, 1);
  assert.equal(p2.update.length, 0);
  assert.deepEqual(validate(run(d, [bad, { title: "正常", due: "2026-11-20" }])).errors, []);
});

// ---- 前のタスクの循環の検出: 別プロジェクトの同じキー・行の順序 ----
const proj = (id) => ({ id, name: id, type: "更改", status: "進行中", start: "2026-10-01", due: "2027-03-31", milestones: [] });
const keyed = (id, projectId, key, predecessors = []) => ({ id, projectId, title: key, due: "2026-11-10", start: null, status: "To Do", memo: "", predecessors, waitingOn: null, doneAt: null, checklist: [], sessions: [], wbsKey: key });
const two = (tasks) => ({ ...empty(), projects: [proj("AA"), proj("AB")], tasks });

test("plan: 別のプロジェクトの同じ wbsKey の関係は、循環の判定に混ぜない（同じ雛形の WBS を複数のプロジェクトで使える）", () => {
  const d = two([keyed("AA-0001", "AA", "設計"), keyed("AA-0002", "AA", "施工"), keyed("AB-0001", "AB", "施工"), keyed("AB-0002", "AB", "設計", ["AB-0001"])]);
  const p = planWbsImport(d, "AA", [{ title: "設計", due: "2026-11-10" }, { title: "施工", due: "2026-11-10", predecessorKeys: ["設計"] }]);
  assert.deepEqual(p.warnings, [], "A の「施工 → 設計」は、B の「設計 → 施工」と無関係");
  assert.equal(p.update.length, 1);
});

test("plan: 同じ名前のキーが別のプロジェクトにあっても、このプロジェクトの本物の循環は見逃さない", () => {
  const d = two([keyed("AA-0001", "AA", "設計", ["AA-0002"]), keyed("AA-0002", "AA", "施工"), keyed("AB-0001", "AB", "設計"), keyed("AB-0002", "AB", "施工")]);
  const p = planWbsImport(d, "AA", [{ title: "施工", predecessorKeys: ["設計"] }]);
  assert.match(p.warnings.join("\n"), /循環になるため設定しません/);
  assert.doesNotThrow(() => applyWbsImport(d, "AA", p, { today: TODAY }), "apply は例外にならない");
});

test("plan: 行の順序で、結果は変わらない（先の行の判定に、あとの行が置き換える古い関係を残さない）", () => {
  const d = two([keyed("AA-0001", "AA", "A", ["AA-0002"]), keyed("AA-0002", "AA", "B")]); // 既存: A の前のタスクは B
  const flip = [{ title: "B", predecessorKeys: ["A"] }, { title: "A", predecessorKeys: [] }]; // WBS: B の前が A、A の前は無し
  for (const rows of [flip, [...flip].reverse()]) {
    const p = planWbsImport(d, "AA", rows);
    assert.deepEqual(p.warnings, [], JSON.stringify(rows));
    assert.equal(p.update.length, 2);
  }
});
