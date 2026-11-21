import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, linkSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { save } from "../plugins/project-lens/tools/cli.js";

const dir = mkdtempSync(join(tmpdir(), "project-lens-cli-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const empty = { version: 1, settings: {}, projects: [], tasks: [], events: [], changeLog: [] };

test("save: 書き込みの途中で止まっても元のファイルが壊れないよう、その場で上書きせず、別のファイルに書いて置き換える", () => {
  const path = join(dir, "data.json");
  const link = join(dir, "link.json");
  writeFileSync(path, "OLD");
  linkSync(path, link); // 同じ中身を指す別名。その場で上書きすると、別名にも新しい中身が見える。置き換えなら、別名は古いまま
  save(path, empty);
  assert.equal(readFileSync(link, "utf8"), "OLD");
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), empty);
  assert.deepEqual(readdirSync(dir).sort(), ["data.json", "data.json.bak", "link.json"], "一時ファイルが残らない");
});

test("save: 置き換えが 3 回とも失敗したら、直接上書きせず例外にする。data.json も .bak も元のまま、一時ファイルも残らない", () => {
  const sub = mkdtempSync(join(dir, "fail-"));
  const path = join(sub, "data.json");
  writeFileSync(path, "KEEP");
  writeFileSync(`${path}.bak`, "PREV");
  let calls = 0;
  assert.throws(() => save(path, empty, () => { calls++; throw new Error("EBUSY"); }), /置き換えられませんでした/);
  assert.equal(calls, 3);
  assert.equal(readFileSync(path, "utf8"), "KEEP");
  assert.equal(readFileSync(`${path}.bak`, "utf8"), "PREV");
  assert.deepEqual(readdirSync(sub).sort(), ["data.json", "data.json.bak"]); // 一時ファイル（.bak.tmp を含む）は残らない
  const sub2 = mkdtempSync(join(dir, "fail2-"));
  const path2 = join(sub2, "data.json");
  writeFileSync(path2, "KEEP");
  assert.throws(() => save(path2, empty, () => { throw new Error("EBUSY"); }), /置き換えられませんでした/);
  assert.deepEqual(readdirSync(sub2), ["data.json"]); // もとの .bak が無ければ、作られない
});

test("save: 検証に通らないときは、元のファイルにも一時ファイルにも触れない", () => {
  const path = join(dir, "bad.json");
  writeFileSync(path, "KEEP");
  assert.throws(() => save(path, { ...empty, tasks: "x" }), /tasks/);
  assert.equal(readFileSync(path, "utf8"), "KEEP");
  assert.ok(!readdirSync(dir).some((f) => f.includes(".tmp")));
});

test("save: 保存すると data.json.bak に直前の内容が入る。初回（元が無い）は作らない", () => {
  const sub = mkdtempSync(join(dir, "bak-"));
  const path = join(sub, "data.json");
  save(path, empty);
  assert.deepEqual(readdirSync(sub), ["data.json"]);
  const next = { ...empty, settings: { a: 1 } };
  save(path, next);
  assert.deepEqual(JSON.parse(readFileSync(`${path}.bak`, "utf8")), empty);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), next);
});

test("save: { backup: false } では .bak が変わらない", () => {
  const sub = mkdtempSync(join(dir, "nobak-"));
  const path = join(sub, "data.json");
  writeFileSync(path, "OLD");
  writeFileSync(`${path}.bak`, "BAK");
  save(path, empty, undefined, { backup: false });
  assert.equal(readFileSync(`${path}.bak`, "utf8"), "BAK");
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), empty);
});

test("save: .bak が書けなくても保存は成功する", () => {
  const sub = mkdtempSync(join(dir, "badbak-"));
  const path = join(sub, "data.json");
  writeFileSync(path, "OLD");
  mkdirSync(`${path}.bak`); // ディレクトリがあると、控えの確定（.bak.tmp の rename）は失敗する
  const orig = process.stderr.write, errs = [];
  process.stderr.write = (s) => { errs.push(String(s)); return true; };
  try { save(path, empty); } finally { process.stderr.write = orig; }
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), empty);
  assert.match(errs.join(""), /data\.json\.bak を更新できませんでした: /);
});

// ---- 置き換え（rename）のやり直し ----
import { renameWithRetry } from "../plugins/project-lens/tools/cli.js";

test("renameWithRetry: 一時的な失敗（2 回）のあとに成功すれば成功。失敗のたびに待つ", () => {
  let calls = 0, waits = 0;
  renameWithRetry("a", "b", () => { if (++calls < 3) throw new Error("EBUSY"); }, () => { waits++; });
  assert.equal(calls, 3);
  assert.equal(waits, 2);
});

test("renameWithRetry: 最初に成功すれば待たない。3 回とも失敗したら、最後の例外を投げる（呼び出し側はエラーにする）", () => {
  let waits = 0;
  renameWithRetry("a", "b", () => {}, () => { waits++; });
  assert.equal(waits, 0);
  let calls = 0;
  assert.throws(() => renameWithRetry("a", "b", () => { calls++; throw new Error(`失敗${calls}`); }, () => {}), /失敗3/);
  assert.equal(calls, 3);
});

// ---- 読んでから書くまでの間の、他の更新 ----
import { readJson } from "../plugins/project-lens/tools/cli.js";

test("save: readJson のあとに他がファイルを書き換えていたら、上書きせず例外にする。読み直せば保存できる", () => {
  const path = join(dir, "race.json");
  writeFileSync(path, JSON.stringify(empty));
  const mine = readJson(path);
  const theirs = { ...empty, settings: { other: 1 } };
  writeFileSync(path, JSON.stringify(theirs, null, 2) + "\n"); // 他の更新（サイズが変わる）
  assert.throws(() => save(path, { ...mine, settings: { mine: 1 } }), /他で更新されました/);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), theirs, "他の更新が残る");
  save(path, { ...readJson(path), settings: { other: 1, mine: 1 } });
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).settings, { other: 1, mine: 1 });
});

test("save: 自分が保存したあとは、続けて保存できる（readJson を挟まなくてよい）", () => {
  const path = join(dir, "twice.json");
  writeFileSync(path, JSON.stringify(empty));
  const d = readJson(path);
  save(path, d);
  save(path, { ...d, settings: { a: 1 } });
});
