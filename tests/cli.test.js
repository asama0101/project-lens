import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, linkSync, rmSync, mkdirSync, renameSync } from "node:fs";
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

// ---- 共有ファイル（data.json）と個人ファイル（personal.json）の 2 ファイル ----
import { readData, saveData, takeMine, personalPathOf } from "../plugins/project-lens/tools/cli.js";
import { splitData } from "../plugins/project-lens/src/core/split.js";
import { statSync, existsSync } from "node:fs";

const sample = JSON.parse(readFileSync(new URL("../plugins/project-lens/data/sample.json", import.meta.url), "utf8"));
const json = (v) => JSON.stringify(v, null, 2) + "\n";
function twoFiles(extra = "") {
  const d = mkdtempSync(join(dir, `two${extra}-`));
  const { shared, personal } = splitData(sample);
  writeFileSync(join(d, "data.json"), json(shared));
  writeFileSync(join(d, "personal.json"), json(personal));
  return d;
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

test("readData: 2 ファイルを読むと、sample.json と等しい", () => {
  const d = twoFiles();
  assert.deepEqual(readData(join(d, "data.json")), sample);
});

test("readData: 個人ファイルが無ければ、共有だけ読めて events は空", () => {
  const d = twoFiles();
  rmSync(join(d, "personal.json"));
  const data = readData(join(d, "data.json"));
  assert.deepEqual(data.events, []);
  assert.equal(data.tasks.length, sample.tasks.length);
  rmSync(join(d, "data.json"));
  assert.throws(() => readData(join(d, "data.json")), /ENOENT/);
});

test("saveData: 共有だけが変わるなら、personal.json を書かない", () => {
  const d = twoFiles();
  const p = join(d, "data.json"), pp = join(d, "personal.json");
  const data = readData(p);
  const before = statSync(pp).mtimeMs;
  sleep(30);
  data.tasks[0].title = "変えた件名";
  saveData(p, data);
  assert.equal(statSync(pp).mtimeMs, before);
  assert.equal(JSON.parse(readFileSync(p, "utf8")).tasks[0].title, "変えた件名");
  assert.deepEqual(readData(p), data);
});

test("saveData: 検証エラーなら、どちらも変えず例外", () => {
  const d = twoFiles();
  const p = join(d, "data.json"), pp = join(d, "personal.json");
  const a = readFileSync(p, "utf8"), b = readFileSync(pp, "utf8");
  const data = readData(p);
  data.projects[0].status = "でたらめ";
  assert.throws(() => saveData(p, data));
  assert.equal(readFileSync(p, "utf8"), a);
  assert.equal(readFileSync(pp, "utf8"), b);
});

test("--mine: 別の場所の個人ファイルを読み書きできる", () => {
  const d = twoFiles();
  const elsewhere = mkdtempSync(join(dir, "mine-"));
  const mine = join(elsewhere, "me.json");
  writeFileSync(mine, readFileSync(join(d, "personal.json")));
  rmSync(join(d, "personal.json"));
  assert.equal(personalPathOf(join(d, "data.json"), mine), mine);
  const p = join(d, "data.json");
  const data = readData(p, mine);
  assert.deepEqual(data, sample);
  data.events = [];
  saveData(p, data, undefined, { mine });
  assert.deepEqual(JSON.parse(readFileSync(mine, "utf8")).events, []);
  assert.ok(!existsSync(join(d, "personal.json")));
});

test("takeMine: --mine と値を取り除く", () => {
  assert.deepEqual(takeMine(["a.json", "--mine", "p.json", "x"]), { mine: "p.json", rest: ["a.json", "x"] });
  assert.deepEqual(takeMine(["a.json"]), { mine: null, rest: ["a.json"] });
});

test("saveData: 読んだあとに他が片方を書き換えていたら、どちらも書かず例外", () => {
  for (const other of ["data.json", "personal.json"]) {
    const d = twoFiles(other.slice(0, 1));
    const p = join(d, "data.json"), pp = join(d, "personal.json");
    const data = readData(p);
    writeFileSync(join(d, other), readFileSync(join(d, other), "utf8") + " "); // 他の更新
    const a = readFileSync(p, "utf8"), b = readFileSync(pp, "utf8");
    data.tasks[0].title = "x";
    data.events = [];
    assert.throws(() => saveData(p, data), /他で更新されました/);
    assert.equal(readFileSync(p, "utf8"), a);
    assert.equal(readFileSync(pp, "utf8"), b);
  }
});

test("saveData: 2 つ目の置き換えが失敗したら、1 つ目はそのままで、書けた方と書けなかった方を例外に書く", () => {
  const d = twoFiles("f");
  const p = join(d, "data.json"), pp = join(d, "personal.json");
  const data = readData(p);
  data.tasks[0].title = "x";
  data.events = [];
  const b = readFileSync(pp, "utf8");
  const rename = (from, to) => { if (to === pp) throw new Error("EBUSY"); renameSync(from, to); };
  assert.throws(() => saveData(p, data, rename), (e) => e.message.includes(`${p} は書けました`) && e.message.includes(`${pp} は書けませんでした`));
  assert.equal(JSON.parse(readFileSync(p, "utf8")).tasks[0].title, "x");
  assert.equal(readFileSync(pp, "utf8"), b);
  saveData(p, data); // 書けなかった方は、次の保存で書かれる（共有は変わっていないので書かれない）
  assert.deepEqual(JSON.parse(readFileSync(pp, "utf8")).events, []);
});

test("readData・saveData: 明示した --mine が無ければ、空として読まず、例外にする（共有は変えない）。既定の personal.json が無いときは空として読む", () => {
  const d = twoFiles("m");
  const p = join(d, "data.json"), wrong = join(d, "typo.json");
  const a = readFileSync(p, "utf8");
  assert.throws(() => readData(p, wrong), /個人ファイル .* がありません。--mine の指定を確かめてください/);
  const data = readData(p);
  data.tasks[0].title = "x";
  assert.throws(() => saveData(p, data, undefined, { mine: wrong }), /--mine の指定を確かめてください/);
  assert.equal(readFileSync(p, "utf8"), a);
  rmSync(join(d, "personal.json"));
  assert.deepEqual(readData(p).events, []);
});

test("saveData: 読んだとき無かった個人ファイルを、他が作っていたら、上書きせず例外にする", () => {
  const d = twoFiles("c");
  const p = join(d, "data.json"), pp = join(d, "personal.json");
  rmSync(pp);
  const data = readData(p);
  const theirs = json({ version: 1, sessions: [], events: [], settings: { selfNames: ["他"] } });
  writeFileSync(pp, theirs);
  assert.throws(() => saveData(p, data), /他で更新されました/);
  assert.equal(readFileSync(pp, "utf8"), theirs);
});

test("saveData: 読んだあとに共有ファイルが消されていても、生の ENOENT でなく「他で更新されました」にする", () => {
  const d = twoFiles("z");
  const p = join(d, "data.json");
  const data = readData(p);
  rmSync(p);
  assert.throws(() => saveData(p, data), /他で更新されました/);
});
