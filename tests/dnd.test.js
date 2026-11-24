import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planDropAt, planOrderAt, planCkOrderAt } from "../plugins/project-lens/src/ui/dnd.js";

const load = () => JSON.parse(readFileSync(new URL("../plugins/project-lens/data/sample.json", import.meta.url), "utf8"));
const NOW = { date: "2026-11-24", time: "10:15" };
const withSession = () => {
  const d = load();
  d.tasks.find((t) => t.id === "AA-0004").sessions = [{ id: "s1", date: "2026-11-24", start: "09:00", end: "10:00", kind: "planned" }];
  d.events = [{ id: "m1", date: "2026-11-24", start: "13:00", end: "14:00", title: "定例", source: "manual", skip: false, externalId: null, confirmed: false, projectId: null }];
  return d;
};

test("planDropAt(task): 落とした位置を 15 分に丸めて 1 時間の予定にする。next を当てると枠が増える", () => {
  const d = withSession();
  const p = planDropAt(d, { kind: "task", id: "AA-0005" }, { date: "2026-11-24", at: 11 * 60 + 8 }, NOW);
  assert.deepEqual([p.st, p.end, p.error], [11 * 60 + 15, 12 * 60 + 15, undefined]);
  assert.match(p.msg, /切替手順書の作成 を 11\/24 11:15 に予定として配置しました/);
  const next = p.next(d);
  const count = (x) => (x.tasks.find((t) => t.id === "AA-0005").sessions ?? []).length;
  assert.equal(count(next), count(d) + 1);
});

test("planDropAt(task): 既存の枠と重なる位置は、error か warning が付く", () => {
  const d = withSession();
  const p = planDropAt(d, { kind: "task", id: "AA-0004" }, { date: "2026-11-24", at: 9 * 60 + 30 }, NOW);
  assert.ok(p.error || p.warning);
});

test("planDropAt(sess): 枠の長さを保って動かす。next を当てると、開始が変わる", () => {
  const d = withSession();
  const p = planDropAt(d, { kind: "sess", id: "s1" }, { date: "2026-11-25", at: 14 * 60 }, NOW);
  assert.deepEqual([p.st, p.end], [14 * 60, 15 * 60]);
  assert.match(p.msg, /検証環境の構築 を 11\/25 14:00 に移動しました/);
  const moved = p.next(d).tasks.find((t) => t.id === "AA-0004").sessions[0];
  assert.deepEqual([moved.date, moved.start, moved.end], ["2026-11-25", "14:00", "15:00"]);
});

test("planDropAt(mtg): 会議を動かす。配置済みの枠と重なれば warning", () => {
  const d = withSession();
  const ok = planDropAt(d, { kind: "mtg", id: "m1" }, { date: "2026-11-24", at: 15 * 60 }, NOW);
  assert.equal(ok.warning, "");
  assert.match(ok.msg, /会議「定例」を 11\/24 15:00 に移動しました/);
  assert.equal(ok.next(d).events[0].start, "15:00");
  const clash = planDropAt(d, { kind: "mtg", id: "m1" }, { date: "2026-11-24", at: 9 * 60 + 15 }, NOW);
  assert.equal(clash.warning, "配置済みの枠と重なっています");
});

// 行: タスク行は { id, pid }、見出し行は { pid, g, sg }
const rows = [{ pid: "AA", g: "構築", sg: "検証環境" }, { id: "AA-0004", pid: "AA" }, { pid: "AA", g: "構築", sg: "切替準備" }, { id: "AA-0005", pid: "AA" }];

test("planOrderAt: タスク行の上半分ならその前、下半分なら次の行の前（同じセクションに次のタスクがなければ末尾）", () => {
  const d = load();
  assert.deepEqual(planOrderAt(d, "AA-0005", rows, 1, true), { beforeId: "AA-0004", pos: "before" });
  const low = planOrderAt(d, "AA-0005", rows, 1, false);
  assert.deepEqual([low.beforeId, low.group, low.subgroup, low.pos], [null, "構築", "検証環境", "after"], "下の見出しに当たるので、そのセクションの末尾");
});

test("planOrderAt: 見出し行へ落とすと、そのセクションの先頭のタスクの前", () => {
  const p = planOrderAt(load(), "AA-0004", rows, 2, true);
  assert.deepEqual([p.beforeId, p.group, p.subgroup, p.pos], ["AA-0005", "構築", "切替準備", "after"]);
});

test("planOrderAt: 自分自身・別のプロジェクト・動かない落とし先は null", () => {
  const d = load();
  assert.equal(planOrderAt(d, "AA-0004", rows, 1, true), null, "自分の上半分");
  assert.equal(planOrderAt(d, "AB-0001", rows, 1, true), null, "別のプロジェクト");
  assert.equal(planOrderAt(d, "NOPE", rows, 1, true), null, "ドラッグ元がない");
});

const ck = ["c1", "c2", "c3", "c4"]; // AA-0005 のチェックリスト

test("planCkOrderAt: 上半分ならその項目の前、下半分なら次の項目の前（最後は末尾）", () => {
  const d = load();
  assert.deepEqual(planCkOrderAt(d, "AA-0005", "c4", ck, 0, true), { beforeId: "c1", pos: "before" });
  assert.deepEqual(planCkOrderAt(d, "AA-0005", "c1", ck, 1, false), { beforeId: "c3", pos: "after" });
  assert.deepEqual(planCkOrderAt(d, "AA-0005", "c1", ck, 3, false), { beforeId: null, pos: "after" });
});

test("planCkOrderAt: 動かない落とし先（自分の前後）は null", () => {
  const d = load();
  assert.equal(planCkOrderAt(d, "AA-0005", "c1", ck, 0, true), null, "自分の上半分");
  assert.equal(planCkOrderAt(d, "AA-0005", "c1", ck, 0, false), null, "自分の下半分（次の項目の前 = いまの位置）");
  assert.equal(planCkOrderAt(d, "AA-0005", "c2", ck, 0, false), null, "すぐ上の項目の下半分 = いまの位置");
});

test("planDropAt: ToDo のドラッグ（kind \"task\"）で予定の枠を置け、msg に ToDo の件名が入る。ToDo の枠の移動も件名で知らせる", () => {
  const d = withSession();
  const p = planDropAt(d, { kind: "task", id: "T-0004" }, { date: "2026-11-24", at: 11 * 60 }, NOW);
  assert.equal(p.error, undefined);
  assert.match(p.msg, /経費精算 を 11\/24 11:00 に予定として配置しました/);
  const next = p.next(d);
  assert.deepEqual(next.todos.find((t) => t.id === "T-0004").sessions.map((s) => [s.start, s.end, s.kind]), [["11:00", "12:00", "planned"]]);
  const m = planDropAt(next, { kind: "sess", id: "S7" }, { date: "2026-11-24", at: 15 * 60 }, NOW);
  assert.match(m.msg, /納期の問い合わせメールを送る を 11\/24 15:00 に移動しました/);
  const mtg = planDropAt(next, { kind: "mtg", id: "m1" }, { date: "2026-11-24", at: 11 * 60 }, NOW);
  assert.equal(mtg.warning, "配置済みの枠と重なっています", "ToDo の枠とも重なりを知らせる");
});

test("planDropAt(task): 持ち主の無い ID は、例外でなく error（タスク XX がありません）", () => {
  const p = planDropAt(withSession(), { kind: "task", id: "XX" }, { date: "2026-11-24", at: 11 * 60 }, NOW);
  assert.match(p.error, /タスク XX がありません/);
});
