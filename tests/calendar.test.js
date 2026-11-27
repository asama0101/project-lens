import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../plugins/project-lens/src/core/schema.js";
import { planCalendarSync, excludeSolo, excludeByTitle, planAutoSync } from "../plugins/project-lens/src/import/calendar.js";

const D = "2026-10-20";
const range = { start: "2026-10-19", end: "2026-10-25" };
const TODAY = "2026-10-19"; // 固定日付のテストデータで動かすための今日
const ev = (id, title, extra = {}) => ({ id, date: D, start: "10:00", end: "11:00", title, source: "mcp", skip: false, externalId: id, ...extra });
const f = (externalId, title, extra = {}) => ({ externalId, title, date: D, start: "10:00", end: "11:00", ...extra });
const mk = (events) => ({
  version: 1, settings: { projectRules: [{ keyword: "ベンダーX", projectId: "AA" }] },
  projects: [{ id: "AA", name: "A", type: "更改", status: "進行中", start: "2026-09-01", due: "2026-12-31", milestones: [] }],
  tasks: [], events, changeLog: [],
});

test("planCalendarSync: 追加・更新・削除の差分と、規則による projectId（rule）。手入力の会議と skip は変わらない", () => {
  const d = mk([ev("m1", "旧題", { externalId: "e1", skip: true }), ev("m2", "消える会議", { externalId: "e2" }), ev("m3", "手入力", { source: "manual", externalId: null })]);
  const p = planCalendarSync(d, [f("e1", "ベンダーX 打合せ"), f("e9", "ベンダーX 定例", { start: "13:00", end: "14:00" })], range, undefined, TODAY);
  assert.deepEqual(p.added.map((e) => [e.title, e.projectId, e.projectBy]), [["ベンダーX 定例", "AA", "rule"]]);
  assert.equal(p.updated.length, 1);
  assert.deepEqual([p.updated[0].after.title, p.updated[0].after.skip], ["ベンダーX 打合せ", true]);
  assert.deepEqual(p.removed.map((e) => e.id), ["m2"]);
  assert.ok(p.data.events.some((e) => e.id === "m3" && e.title === "手入力"));
});

test("planCalendarSync: 確認済み（confirmed）と手動のひも付けは保たれる", () => {
  const d = mk([ev("m1", "ベンダーX 打合せ", { externalId: "e1", confirmed: true, projectId: "AB", projectBy: "manual" })]);
  d.projects.push({ ...d.projects[0], id: "AB" });
  const n = planCalendarSync(d, [f("e1", "ベンダーX 打合せ（変更）")], range, undefined, TODAY).data;
  const m = n.events[0];
  assert.deepEqual([m.title, m.confirmed, m.projectId, m.projectBy], ["ベンダーX 打合せ（変更）", true, "AB", "manual"]);
});

test("planCalendarSync: 予定表で日時が変わった確認済みの会議は、confirmed と actual が外れる", () => {
  const d = mk([ev("m1", "定例", { externalId: "e1", confirmed: true, actual: { start: "10:05", end: "10:50" } })]);
  const m = planCalendarSync(d, [f("e1", "定例", { start: "11:00", end: "12:00" })], range, undefined, TODAY).data.events[0];
  assert.equal(m.confirmed, false);
  assert.equal("actual" in m, false);
});

// ---- 自分だけ・自分と会議室だけの予定を除く ----
const SELF = "me@example.com";
const cfg = { selfEmails: [SELF] };
const who = (email, extra = {}) => ({ type: "person", email, name: email, ...extra });
const room = (name = "会議室 A", extra = {}) => ({ type: "resource", email: "room-a@example.com", name, ...extra });

test("excludeSolo: 自分だけ、自分と会議室だけは対象外。他の人が 1 人でもいれば残す", () => {
  const cases = [
    ["自分だけ", [who(SELF)], true],
    ["自分と resource 種別の会議室", [who(SELF), room("Room 12")], true],
    ["自分と、名前に「会議室」を含む参加者（種別が person でも）", [who(SELF), { type: "person", email: "x@example.com", name: "第3会議室" }], true],
    ["自分と他の人", [who(SELF), who("a@example.com")], false],
    ["自分以外の 1 人だけ（自分が参加者に載らない）", [who("a@example.com")], false],
    ["自分と会議室と他の人", [who(SELF), room(), who("a@example.com")], false],
    ["メールの大文字小文字は区別しない", [who("ME@Example.com")], true],
    ["参加者が空（参加者なし）", [], true],
  ];
  for (const [name, attendees, excluded] of cases) {
    const r = excludeSolo([f("e1", name, { attendees })], cfg);
    assert.deepEqual([name, r.excluded.length, r.kept.length], [name, excluded ? 1 : 0, excluded ? 0 : 1]);
  }
});

test("excludeSolo: 予定表が email を表示名に置き換えて返すとき、selfNames（前後の空白と大文字小文字は区別しない完全一致）で自分と判定する。メールアドレスと併用できる", () => {
  const named = (name, extra = {}) => ({ type: "person", email: name, name, ...extra }); // email の欄にも表示名が入って返る
  const byName = { selfNames: ["山田 太郎", "Taro Yamada"] };
  const cases = [
    ["名前だけ（自分だけ）", [named("山田 太郎")], byName, true],
    ["前後の空白と大文字小文字は区別しない", [named("  taro yamada ")], byName, true],
    ["自分と会議室", [named("山田 太郎"), room()], byName, true],
    ["名前の一部だけ一致（完全一致ではない）は、自分ではない", [named("山田")], byName, false],
    ["自分と他の人", [named("山田 太郎"), named("鈴木 花子")], byName, false],
    ["名前だけを設定したとき、email が SELF でも、名前が違えば自分ではない", [who(SELF, { name: "別の表示名" })], byName, false],
    ["メールと名前を併用（片方はメール、片方は名前で一致）", [who(SELF, { name: "別の表示名" }), named("山田 太郎")], { selfEmails: [SELF], ...byName }, true],
  ];
  for (const [name, attendees, c, excluded] of cases) {
    const r = excludeSolo([f("e1", name, { attendees })], c);
    assert.deepEqual([name, r.excluded.length, r.kept.length], [name, excluded ? 1 : 0, excluded ? 0 : 1]);
  }
  assert.deepEqual(excludeSolo([f("e1", "x", { attendees: [named("山田 太郎")] })], byName).warnings, [], "selfNames だけでも、未設定の警告は出ない");
});

test("excludeSolo: 参加者の項目がない予定（不明）は残す。roomKeywords で会議室の名前を足せる。元の配列は変えない", () => {
  const input = [f("e1", "不明"), f("e2", "会議室 Z だけ", { attendees: [who(SELF), { type: "person", email: "z@example.com", name: "Z ルーム" }] })];
  const before = JSON.stringify(input);
  assert.deepEqual(excludeSolo(input, cfg).kept.map((e) => e.externalId), ["e1", "e2"]);
  assert.deepEqual(excludeSolo(input, { ...cfg, roomKeywords: ["ルーム"] }).excluded.map((e) => e.externalId), ["e2"]);
  assert.equal(JSON.stringify(input), before);
});

test("excludeSolo: 自分のメールアドレス（selfEmails）が未設定なら、何も除かず、参加者つきの予定があるときだけ警告する", () => {
  const withAtt = [f("e1", "x", { attendees: [who(SELF)] })];
  for (const c of [{}, { selfEmails: [] }, undefined]) {
    const r = excludeSolo(withAtt, c);
    assert.deepEqual([r.kept.length, r.excluded.length], [1, 0]);
    assert.match(r.warnings[0], /selfEmails/);
  }
  assert.deepEqual(excludeSolo([f("e1", "x")], {}).warnings, []);
});

test("excludeSolo: selfEmails も selfNames も空なら、何も除かず警告する（selfNames だけの空配列でも同じ）", () => {
  const withAtt = [f("e1", "x", { attendees: [who(SELF)] })];
  for (const c of [{ selfNames: [] }, { selfEmails: [], selfNames: [] }]) {
    const r = excludeSolo(withAtt, c);
    assert.deepEqual([r.kept.length, r.excluded.length], [1, 0]);
    assert.match(r.warnings[0], /selfEmails.*selfNames/);
  }
});

test("planCalendarSync: 対象外の予定は追加されない。取り込み済みの該当予定は削除に出て、確認済み（confirmed）かどうかが分かる。手入力の会議は変わらない", () => {
  const d = mk([ev("m1", "作業ブロック", { externalId: "e1", confirmed: true }), ev("m2", "作業ブロック2", { externalId: "e2" }), ev("m3", "手入力", { source: "manual", externalId: null })]);
  const fetched = [
    f("e1", "作業ブロック", { attendees: [who(SELF)] }),
    f("e2", "作業ブロック2", { attendees: [who(SELF), room()] }),
    f("e9", "新しい自分だけの予定", { attendees: [who(SELF)] }),
    f("e10", "ベンダーX 定例", { start: "13:00", end: "14:00", attendees: [who(SELF), who("v@example.com")] }),
  ];
  const p = planCalendarSync(d, fetched, range, cfg, TODAY);
  assert.deepEqual(p.excluded.map((e) => e.externalId), ["e1", "e2", "e9"]);
  assert.deepEqual(p.added.map((e) => e.title), ["ベンダーX 定例"]);
  assert.deepEqual(p.removed.map((e) => [e.id, !!e.confirmed]), [["m1", true], ["m2", false]]);
  assert.ok(p.data.events.some((e) => e.id === "m3"));
  assert.deepEqual(p.data.events.map((e) => e.id).sort(), ["m3", "m4"].sort());
  assert.deepEqual(validate(p.data).errors, []);
});

test("planCalendarSync: cfg を渡さなければ、従来どおりすべて取り込む（excluded は空）", () => {
  const p = planCalendarSync(mk([]), [f("e1", "x", { attendees: [who(SELF)] })], range, undefined, TODAY);
  assert.deepEqual([p.added.length, p.excluded.length], [1, 0]);
});

test("excludeSolo: attendees に null や文字列など、形が崩れた要素がある予定は、参加者が不明として残す（例外にしない）", () => {
  const input = [f("e1", "null", { attendees: [null] }), f("e2", "文字列", { attendees: [SELF] }), f("e3", "混在", { attendees: [who(SELF), null] })];
  const r = excludeSolo(input, cfg);
  assert.deepEqual([r.kept.map((e) => e.externalId), r.excluded.length], [["e1", "e2", "e3"], 0]);
});

test("excludeSolo: selfEmails を設定済みなのに、どの予定にも参加者の項目がないときは、判定できていないと警告する", () => {
  assert.match(excludeSolo([f("e1", "x"), f("e2", "y")], cfg).warnings[0], /参加者/);
  assert.deepEqual(excludeSolo([], cfg).warnings, []);
  assert.deepEqual(excludeSolo([f("e1", "x"), f("e2", "y", { attendees: [who("a@example.com")] })], cfg).warnings, []);
});

// ---- 見張り中の自動更新（planAutoSync）。終わった会議・確認済みの会議は変えず、取得が 0 件なら消さない ----
const NOW = { date: D, time: "10:30" };
const FUTURE = "2026-10-22";
const auto = (events, fetched, c = {}) => planAutoSync(mk(events), fetched, { start: "2026-10-19", end: "2026-10-25" }, c, NOW);
const ids = (xs) => xs.map((e) => e.id);

test("planAutoSync: 予定表から消えた会議は、終わっていなければ（進行中・これから）削除し、終わった会議は、実績になるので残す（held に出る）", () => {
  const p = auto([
    ev("m1", "終わった・未確認", { externalId: "e1", start: "08:00", end: "09:00" }),
    ev("m2", "進行中", { externalId: "e2", start: "10:00", end: "11:00" }),
    ev("m3", "これから", { externalId: "e3", date: FUTURE }),
    ev("m4", "終わった・確認済み", { externalId: "e4", start: "08:00", end: "09:00", confirmed: true }),
  ], [f("e9", "新しい会議", { date: FUTURE })]);
  assert.deepEqual(ids(p.removed).sort(), ["m2", "m3"]);
  assert.deepEqual(p.data.events.filter((e) => e.source === "mcp").map((e) => e.externalId).sort(), ["e1", "e4", "e9"]);
  assert.deepEqual(p.held.map((h) => [h.id, h.change]).sort(), [["m1", "removed"], ["m4", "removed"]]);
  assert.deepEqual(p.added.map((e) => e.title), ["新しい会議"]);
  assert.equal(p.blocked, null);
});

test("planAutoSync: 変更は、終わっていない未確認の会議だけ更新する。終わった会議・確認済みの会議は、予定表で変わっても、そのまま（held に出る）", () => {
  const p = auto([
    ev("m1", "終わった", { externalId: "e1", start: "08:00", end: "09:00", confirmed: true }),
    ev("m2", "これから", { externalId: "e2", date: FUTURE }),
  ], [f("e1", "終わった（変更）", { start: "08:00", end: "09:00" }), f("e2", "これから（変更）", { date: FUTURE })]);
  assert.deepEqual(p.updated.map((u) => u.after.title), ["これから（変更）"]);
  const m1 = p.data.events.find((e) => e.id === "m1");
  assert.deepEqual([m1.title, m1.confirmed], ["終わった", true]);
  assert.deepEqual(p.held.map((h) => [h.id, h.change]), [["m1", "updated"]]);
});

test("planAutoSync: 取得が 0 件のときは、削除しない（取得の失敗かもしれないため）。blocked に理由が出る。削除の対象がなければ、blocked は null", () => {
  const events = [ev("m1", "これから", { externalId: "e1", date: FUTURE }), ev("m2", "手入力", { source: "manual", externalId: null })];
  const p = auto(events, []);
  assert.deepEqual([p.removed.length, ids(p.data.events).sort()], [0, ["m1", "m2"]]);
  assert.match(p.blocked.reason, /0 件/);
  assert.equal(p.blocked.count, 1);
  assert.equal(auto([ev("m2", "手入力", { source: "manual", externalId: null })], []).blocked, null);
});

test("planAutoSync: 取得が空でなければ、自分だけの予定（対象外）になって消える会議は、削除する。範囲の外・手入力の会議は変わらない。書き込み後のデータは検証に通る", () => {
  const events = [
    ev("m1", "自分だけになった", { externalId: "e1", date: FUTURE }),
    ev("m2", "手入力", { source: "manual", externalId: null }),
    ev("m3", "範囲の外", { externalId: "e3", date: "2026-11-30" }),
  ];
  const p = auto(events, [f("e1", "自分だけになった", { date: FUTURE, attendees: [who(SELF)] }), f("e2", "別の会議", { date: FUTURE, attendees: [who(SELF), who("a@example.com")] })], cfg);
  assert.deepEqual(ids(p.removed), ["m1"]);
  assert.deepEqual(p.excluded.map((e) => e.externalId), ["e1"]);
  assert.deepEqual(ids(p.data.events).filter((i) => ["m2", "m3"].includes(i)).sort(), ["m2", "m3"]);
  assert.deepEqual(validate(p.data).errors, []);
});

test("planAutoSync: 終わった会議は、予定表の内容（件名・日時）が変わったときだけ held に出す。規則でプロジェクトが付いただけの変更は、予定表の変更ではないので、held にせず、そのまま反映する", () => {
  const d = mk([ev("m1", "ベンダーX 打合せ", { externalId: "e1", start: "08:00", end: "09:00", projectId: undefined })]);
  delete d.events[0].projectId;
  const p = planAutoSync(d, [f("e1", "ベンダーX 打合せ", { start: "08:00", end: "09:00" })], range, {}, NOW);
  assert.deepEqual(p.held, []);
  assert.equal(p.data.events[0].projectId, "AA"); // 規則（ベンダーX → AA）が付く
});

test("planAutoSync: 終了時刻が現在と同じ会議は、終わった会議として扱う。終わった会議が、未来の日時に変わっても、そのまま残す（held の updated）", () => {
  const p = auto([
    ev("m1", "ちょうど終わった", { externalId: "e1", start: "09:30", end: "10:30" }),
    ev("m2", "終わった", { externalId: "e2", start: "08:00", end: "09:00" }),
  ], [f("e2", "終わった", { date: FUTURE, start: "08:00", end: "09:00" })]);
  assert.deepEqual(p.held.map((h) => [h.id, h.change]).sort(), [["m1", "removed"], ["m2", "updated"]]);
  assert.deepEqual(p.data.events.find((e) => e.id === "m2").date, D);
  assert.equal(p.removed.length, 0);
});

test("planAutoSync: 取得した予定がすべて対象外（自分だけ）になるときも、削除しない。自分のメールアドレスの設定の誤りかもしれないため", () => {
  const p = auto([ev("m1", "これから", { externalId: "e1", date: FUTURE })], [f("e1", "これから", { date: FUTURE, attendees: [who(SELF)] })], cfg);
  assert.deepEqual([p.removed.length, ids(p.data.events)], [0, ["m1"]]);
  assert.match(p.blocked.reason, /対象外/);
  assert.equal(p.blocked.count, 1);
});

// ---- 取得が一部しか返らないとき・取得に形が不正な予定があるとき ----
test("planAutoSync: 取得が一部だけで、消える会議が 3 件以上かつ範囲内の取り込み済みの半数を超えるときは、削除せず blocked にする", () => {
  const events = [1, 2, 3, 4, 5].map((n) => ev(`m${n}`, `会議${n}`, { externalId: `e${n}`, date: FUTURE }));
  const p = auto(events, [f("e1", "会議1", { date: FUTURE })]); // 5 件のうち 4 件が取得に無い
  assert.equal(p.removed.length, 0);
  assert.equal(p.data.events.filter((e) => e.source === "mcp").length, 5, "取り込み済みの会議は、すべて残る");
  assert.match(p.blocked.reason, /5 件のうち 4 件/);
  assert.equal(p.blocked.count, 4);
});

test("planAutoSync: 消える会議が半数以下、または 3 件未満なら、これまでどおり削除する（blocked にしない）", () => {
  const events = [1, 2, 3, 4, 5, 6].map((n) => ev(`m${n}`, `会議${n}`, { externalId: `e${n}`, date: FUTURE }));
  const fewer = auto(events, [1, 2, 3, 4].map((n) => f(`e${n}`, `会議${n}`, { date: FUTURE }))); // 6 件のうち 2 件
  assert.deepEqual([fewer.removed.length, fewer.blocked], [2, null]);
  const half = auto(events, [1, 2, 3].map((n) => f(`e${n}`, `会議${n}`, { date: FUTURE }))); // 6 件のうち 3 件（ちょうど半数。超えてはいない）
  assert.deepEqual([half.removed.length, half.blocked], [3, null]);
});

test("planCalendarSync: 形が不正な予定（終日・24:00・秒つき・externalId なし）は、警告つきで除き、保存の検証が通る形で残りを同期する", () => {
  const d = mk([ev("m1", "既存", { externalId: "e1" })]);
  const p = planCalendarSync(d, [
    f("e1", "既存"),
    f("e2", "終日", { start: "00:00", end: "00:00" }),
    f("e3", "24時", { end: "24:00" }),
    f("e4", "秒つき", { start: "09:00:00" }),
    { title: "id なし", date: D, start: "10:00", end: "11:00" },
    null,
    f("e5", "正常", { start: "13:00", end: "14:00" }),
  ], range, undefined, TODAY);
  assert.deepEqual(p.added.map((e) => e.title), ["正常"]);
  assert.equal(validate(p.data).errors.length, 0);
  assert.match(p.warnings.join("\n"), /5 件は、形が不正/);
});

test("planCalendarSync: 取得で形が不正だった予定でも、externalId が読めれば、取り込み済みの会議は消さない", () => {
  const d = mk([ev("m1", "既存", { externalId: "e1" })]);
  const p = planCalendarSync(d, [f("e1", "既存", { start: "09:00:00" }), f("e9", "別", { start: "13:00", end: "14:00" })], range, undefined, TODAY);
  assert.deepEqual(p.removed, []);
  assert.deepEqual(p.data.events.filter((e) => e.externalId === "e1").map((e) => [e.title, e.start]), [["既存", "10:00"]]);
});

test("planCalendarSync: 同じ externalId が重なると、最初の 1 件だけ取り込み、警告に出す（黙って消さない）", () => {
  const p = planCalendarSync(mk([]), [f("s", "定例", { date: "2026-10-21" }), f("s", "定例", { date: "2026-10-28" })], { start: "2026-10-19", end: "2026-10-31" }, undefined, TODAY);
  assert.equal(p.added.length, 1);
  assert.match(p.warnings.join("\n"), /1 件は、同じ externalId/);
});

test("planAutoSync: 取得の全件が形の不正なら、取り込める予定は 0 件として、削除せず blocked にする", () => {
  const p = auto([ev("m1", "これから", { externalId: "e1", date: FUTURE }), ev("m2", "これから2", { externalId: "e2", date: FUTURE })], [{ title: "壊れた" }]);
  assert.equal(p.removed.length, 0);
  assert.match(p.blocked.reason, /0 件/);
});

test("planAutoSync: 割合の分母は、終わった会議・確認済みの会議・「参加しない」を除く（過去の会議が多くても、未来の会議が欠けたら止める）", () => {
  const past = [1, 2, 3, 4, 5, 6].map((n) => ev(`p${n}`, `過去${n}`, { externalId: `p${n}`, start: "08:00", end: "09:00" }));
  const future = [1, 2, 3, 4].map((n) => ev(`m${n}`, `未来${n}`, { externalId: `e${n}`, date: FUTURE }));
  const p = auto([...past, ...future], past.map((e) => f(e.externalId, e.title, { start: "08:00", end: "09:00" }))); // 過去 6 件は取得にあり、未来 4 件がすべて欠けた
  assert.equal(p.removed.length, 0);
  assert.equal(p.blocked.count, 4);
  assert.match(p.blocked.reason, /4 件のうち 4 件/);
});

// ---- today より前の会議は取り込まない。範囲の開始も today に切り上げるので、過去の取り込み済みの会議は消えない ----
test("planCalendarSync: today より前の会議は追加しない（valid も、落としたあとの件数）", () => {
  const p = planCalendarSync(mk([]), [f("p", "昨日", { date: "2026-10-19" }), f("t", "今日", { date: "2026-10-20" })], range, undefined, "2026-10-20");
  assert.deepEqual(p.added.map((e) => e.title), ["今日"]);
  assert.equal(p.valid, 1);
});

test("planCalendarSync: 取り込み済みの過去の会議は、取得に無くても消えない", () => {
  const d = mk([ev("m1", "過去", { externalId: "e1", date: "2026-10-19" }), ev("m2", "未来", { externalId: "e2", date: "2026-10-21" })]);
  const p = planCalendarSync(d, [], range, undefined, "2026-10-20");
  assert.deepEqual(p.removed.map((e) => e.id), ["m2"]);
});

test("planCalendarSync: 当日のすでに終わった会議は取り込む", () => {
  const p = planCalendarSync(mk([]), [f("e1", "朝の会議", { start: "08:00", end: "09:00" })], range, undefined, D);
  assert.deepEqual(p.added.map((e) => e.title), ["朝の会議"]);
});

test("planAutoSync: now.date より前の会議も取り込まず、過去の取り込み済みの会議を消さない", () => {
  const p = auto([ev("m1", "過去", { externalId: "e1", date: "2026-10-19" })], [f("p", "昨日", { date: "2026-10-19" }), f("t", "今日", { externalId: "t" })]);
  assert.deepEqual(p.added.map((e) => e.title), ["今日"]);
  assert.deepEqual(p.removed, []);
  assert.equal(p.valid, 1);
});

test("excludeByTitle: 件名に文字列を含む予定は対象外（前後の空白・大文字小文字は区別しない）。参加者の情報がなくても効く。未設定なら何も除かない", () => {
  const input = [f("e1", "朝会 定例"), f("e2", "Weekly 1ON1"), f("e3", "設計レビュー")];
  const before = JSON.stringify(input);
  const r = excludeByTitle(input, { excludeTitles: ["朝会", " 1on1 "] });
  assert.deepEqual([r.excluded.map((e) => e.externalId), r.kept.map((e) => e.externalId)], [["e1", "e2"], ["e3"]]);
  assert.equal(excludeByTitle(input, {}).excluded.length, 0);
  assert.equal(excludeByTitle(input, undefined).kept.length, 3);
  assert.equal(JSON.stringify(input), before);
});

test("planCalendarSync: excludeTitles に当たる予定は取り込まず、取り込み済みなら消え、excluded に出る。excludeSolo の除外と合算する", () => {
  const d = mk([ev("m1", "朝会", { externalId: "e1" })]);
  const c = { selfEmails: [SELF], excludeTitles: ["朝会"] };
  const p = planCalendarSync(d, [f("e1", "朝会"), f("e2", "1人作業", { attendees: [who(SELF)] }), f("e3", "本物の会議", { attendees: [who(SELF), who("a@example.com")] })], range, c, TODAY);
  assert.deepEqual(p.excluded.map((e) => e.externalId).sort(), ["e1", "e2"]);
  assert.deepEqual(p.added.map((e) => e.title), ["本物の会議"]);
  assert.deepEqual(p.removed.map((e) => e.id), ["m1"]);
});
