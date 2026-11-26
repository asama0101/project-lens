import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { init, MARKER } from "../plugins/project-lens/tools/init.js";
import { validate } from "../plugins/project-lens/src/core/schema.js";
import { splitData, mergeData } from "../plugins/project-lens/src/core/split.js";

const REPO = fileURLToPath(new URL("../plugins/project-lens/", import.meta.url));
const base = mkdtempSync(join(tmpdir(), "projectlens-init-"));
after(() => rmSync(base, { recursive: true, force: true }));

let n = 0;
const proj = (name = "proj") => { const d = join(base, `${++n}-${name}`); mkdirSync(d, { recursive: true }); return d; };
/** 偽の pluginRoot: 同梱の完成版（目印つきのダミー）と、本物のサンプル */
const plugin = (html = `<html>${MARKER}v1</html>`) => {
  const d = proj("plugin");
  mkdirSync(join(d, "assets")); mkdirSync(join(d, "data"));
  writeFileSync(join(d, "assets/project-lens.html"), html);
  copyFileSync(join(REPO, "data/sample.json"), join(d, "data/sample.json"));
  return d;
};
const names = (d) => readdirSync(d).sort();
const status = (r, p) => r.results.find((x) => x.path === p)?.status;

test("空のフォルダ: project-lens.html と .project-lens/ の data.json・personal.json だけができる（.gitignore は作らない）", () => {
  const cwd = proj(), pluginRoot = plugin();
  const r = init({ cwd, pluginRoot });
  assert.equal(r.ok, true);
  assert.deepEqual(names(cwd), [".project-lens", "project-lens.html"]);
  assert.deepEqual(names(join(cwd, ".project-lens")), ["data.json", "personal.json"]);
  const rd = (f) => JSON.parse(readFileSync(join(cwd, ".project-lens", f), "utf8"));
  const data = mergeData(rd("data.json"), rd("personal.json"));
  assert.deepEqual(validate(data).errors, []);
  assert.ok(!("workday" in rd("personal.json").settings) && !("workday" in rd("data.json").settings), "勤務時間の設定は作らない");
  assert.equal(status(r, "project-lens.html"), "created");
});

test(".git のあるフォルダ: .gitignore に .project-lens/ が1行だけ入り、再実行しても増えない", () => {
  const cwd = proj(), pluginRoot = plugin();
  mkdirSync(join(cwd, ".git"));
  init({ cwd, pluginRoot });
  init({ cwd, pluginRoot });
  const lines = readFileSync(join(cwd, ".gitignore"), "utf8").split(/\r?\n/).filter(Boolean);
  assert.deepEqual(lines, [".project-lens/"]);
});

test("既存の data.json は再実行でも --sample でも1バイトも変わらない", () => {
  const cwd = proj(), pluginRoot = plugin();
  mkdirSync(join(cwd, ".project-lens"));
  const mine = '{"keep":"me",\n "日本語": true}';
  writeFileSync(join(cwd, ".project-lens/data.json"), mine);
  init({ cwd, pluginRoot });
  init({ cwd, pluginRoot, sample: true });
  assert.equal(readFileSync(join(cwd, ".project-lens/data.json"), "utf8"), mine);
});

test("目印のない既存 project-lens.html: 何も作らずに中断する（data.json も .gitignore も）", () => {
  const cwd = proj(), pluginRoot = plugin();
  mkdirSync(join(cwd, ".git"));
  writeFileSync(join(cwd, "project-lens.html"), "<html>自分のファイル</html>");
  const r = init({ cwd, pluginRoot });
  assert.equal(r.ok, false);
  assert.match(r.error, /project-lens\.html/);
  assert.deepEqual(r.results, []);
  assert.equal(existsSync(join(cwd, ".project-lens")), false);
  assert.equal(existsSync(join(cwd, ".gitignore")), false);
  assert.equal(readFileSync(join(cwd, "project-lens.html"), "utf8"), "<html>自分のファイル</html>");
});

test("目印つきの古い project-lens.html は updated、同じなら unchanged", () => {
  const cwd = proj();
  writeFileSync(join(cwd, "project-lens.html"), `<html>${MARKER}古い版</html>`);
  const pluginRoot = plugin(`<html>${MARKER}新しい版</html>`);
  assert.equal(status(init({ cwd, pluginRoot }), "project-lens.html"), "updated");
  assert.equal(readFileSync(join(cwd, "project-lens.html"), "utf8"), `<html>${MARKER}新しい版</html>`);
  assert.equal(status(init({ cwd, pluginRoot }), "project-lens.html"), "unchanged");
});

test("--sample: サンプルが splitData で 2 ファイルに入る（作業枠は personal.json）", () => {
  const cwd = proj(), pluginRoot = plugin();
  init({ cwd, pluginRoot, sample: true });
  const sample = JSON.parse(readFileSync(join(pluginRoot, "data/sample.json"), "utf8"));
  const { shared, personal } = splitData(sample);
  const rd = (f) => JSON.parse(readFileSync(join(cwd, ".project-lens", f), "utf8"));
  assert.deepEqual(rd("data.json"), shared);
  assert.deepEqual(rd("personal.json"), personal);
  assert.ok(personal.sessions.length > 0 && shared.tasks.every((t) => !("sessions" in t)));
});

test("--mine: 個人ファイルをそこへ作る（無いフォルダも作る）。data.json の隣には作らない", () => {
  const cwd = proj(), pluginRoot = plugin(), other = join(proj("other"), "sub", "mine.json");
  const r = init({ cwd, pluginRoot, sample: true, mine: other });
  assert.equal(r.ok, true);
  assert.ok(existsSync(other));
  assert.equal(existsSync(join(cwd, ".project-lens/personal.json")), false);
  assert.equal(status(r, other), "created");
  assert.ok(JSON.parse(readFileSync(other, "utf8")).sessions.length > 0);
});

test("相対の --mine は、実行したフォルダ（cwd）から数える", () => {
  const cwd = proj(), pluginRoot = plugin();
  init({ cwd, pluginRoot, mine: "me/personal.json" });
  assert.ok(existsSync(join(cwd, "me/personal.json")));
});

test("既存の個人ファイルは、再実行でも --sample でも 1 バイトも変わらない。共有だけがあるときは、空の個人ファイルを足す", () => {
  const cwd = proj(), pluginRoot = plugin();
  init({ cwd, pluginRoot });
  const pp = join(cwd, ".project-lens/personal.json");
  writeFileSync(pp, '{"keep":"me"}');
  const r = init({ cwd, pluginRoot, sample: true });
  assert.equal(readFileSync(pp, "utf8"), '{"keep":"me"}');
  assert.equal(status(r, ".project-lens/personal.json"), "unchanged");
  rmSync(pp);
  const r2 = init({ cwd, pluginRoot, sample: true });
  assert.equal(status(r2, ".project-lens/personal.json"), "created");
  assert.deepEqual(JSON.parse(readFileSync(pp, "utf8")).sessions, []);
});

test("--sample で新しく作る data.json の隣に、既にある個人ファイルがあっても、個人ファイルは変えず、お知らせを出す", () => {
  const cwd = proj(), pluginRoot = plugin();
  mkdirSync(join(cwd, ".project-lens"));
  const pp = join(cwd, ".project-lens/personal.json");
  writeFileSync(pp, '{"keep":"me"}');
  const r = init({ cwd, pluginRoot, sample: true });
  assert.equal(readFileSync(pp, "utf8"), '{"keep":"me"}');
  assert.ok(r.results.some((x) => x.path === ".project-lens/personal.json" && /変えていません/.test(x.note ?? "")));
});

test("CLI: --mine に値が無いと、終了コード 2 で理由を出し、何も作らない", () => {
  const cwd = proj();
  for (const [script, args] of [["init.js", ["--mine"]], ["validate.js", ["x.json", "--mine"]], ["holidays.js", ["status", "x.json", "--mine"]], ["inbox.js", ["list", "x.json", "--mine"]], ["intake.js", ["rules-list", "x.json", "--mine"]]]) {
    const r = spawnSync(process.execPath, [join(REPO, "tools", script), ...args], { cwd, encoding: "utf8" });
    assert.equal(r.status, 2, script);
    assert.match(r.stderr, /--mine にファイルを指定してください/);
  }
  assert.deepEqual(readdirSync(cwd), []);
});

test("CLI: init に知らないフラグ・余分な引数を渡すと、終了コード 2 で使い方を出し、何も作らない・.gitignore も変えない", () => {
  for (const args of [["--help"], ["--sampel"], ["--sample", "-x"], ["extra"], ["--mine", "p.json", "--data", "d"]]) {
    const cwd = proj();
    mkdirSync(join(cwd, ".git"));
    writeFileSync(join(cwd, ".gitignore"), "node_modules/\n");
    const r = spawnSync(process.execPath, [join(REPO, "tools", "init.js"), ...args], { cwd, encoding: "utf8" });
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /使い方/);
    assert.deepEqual(names(cwd), [".git", ".gitignore"], args.join(" "));
    assert.equal(readFileSync(join(cwd, ".gitignore"), "utf8"), "node_modules/\n");
  }
});

test("CLI: init --mine で作った個人ファイルが、validate.js --mine で読める。個人ファイルが無い保存先の validate.js は共有だけで成功する", () => {
  const cwd = proj(), mine = join(proj("m"), "p.json");
  const run = (script, ...a) => spawnSync(process.execPath, [join(REPO, "tools", script), ...a], { cwd, encoding: "utf8" });
  const r = run("init.js", "--sample", "--mine", mine);
  assert.equal(r.status, 0, r.stderr);
  const data = join(cwd, ".project-lens/data.json");
  assert.equal(run("validate.js", data, "--mine", mine).status, 0);
  assert.equal(run("validate.js", data).status, 0, "既定の personal.json が無くても、共有だけで成功する");
  const bad = run("validate.js", data, "--mine", join(cwd, "nothing.json"));
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /個人ファイル .* がありません。--mine の指定を確かめてください/);
});

test("末尾に改行のない .gitignore へ、最後の行と連結せずに追記する", () => {
  const cwd = proj(), pluginRoot = plugin();
  mkdirSync(join(cwd, ".git"));
  writeFileSync(join(cwd, ".gitignore"), "node_modules/");
  init({ cwd, pluginRoot });
  assert.equal(readFileSync(join(cwd, ".gitignore"), "utf8"), "node_modules/\n.project-lens/\n");
});

test("CRLF の .gitignore には CRLF で追記する", () => {
  const cwd = proj(), pluginRoot = plugin();
  mkdirSync(join(cwd, ".git"));
  writeFileSync(join(cwd, ".gitignore"), "dist/\r\n");
  init({ cwd, pluginRoot });
  assert.equal(readFileSync(join(cwd, ".gitignore"), "utf8"), "dist/\r\n.project-lens/\r\n");
});

test("空白と日本語を含むフォルダ名でも動く", () => {
  const cwd = proj("プロジェクト A"), pluginRoot = plugin();
  assert.equal(init({ cwd, pluginRoot }).ok, true);
  assert.ok(existsSync(join(cwd, "project-lens.html")) && existsSync(join(cwd, ".project-lens/data.json")));
});

test(".git のないサブフォルダ: .gitignore を作らず、skipped と理由を返す", () => {
  const cwd = proj(), pluginRoot = plugin();
  const r = init({ cwd, pluginRoot });
  assert.equal(existsSync(join(cwd, ".gitignore")), false);
  const g = r.results.find((x) => x.path === ".gitignore");
  assert.equal(g.status, "skipped");
  assert.match(g.note, /\.git/);
});

test("空のひな形に対して validate が落ちない", () => {
  const cwd = proj(), pluginRoot = plugin();
  init({ cwd, pluginRoot });
  const data = join(cwd, ".project-lens/data.json");
  for (const args of [["validate.js", data]]) {
    const r = spawnSync(process.execPath, [join(REPO, "tools", args[0]), ...args.slice(1)], { encoding: "utf8" });
    assert.equal(r.status, 0, `${args[0]}: ${r.stderr}${r.stdout}`);
  }
});

test("親フォルダが git 管理のとき、サブフォルダにも .gitignore を作って .project-lens/ を除外する", () => {
  const parent = proj("repo"), pluginRoot = plugin();
  mkdirSync(join(parent, ".git"));
  const cwd = join(parent, "network");
  mkdirSync(cwd);
  const r = init({ cwd, pluginRoot });
  assert.equal(status(r, ".gitignore"), "created");
  assert.equal(readFileSync(join(cwd, ".gitignore"), "utf8"), ".project-lens/\n");
});

test("UTF-16 の .gitignore は壊さずに、変更しないで知らせる", () => {
  const cwd = proj(), pluginRoot = plugin();
  mkdirSync(join(cwd, ".git"));
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("dist/\r\n", "utf16le")]);
  writeFileSync(join(cwd, ".gitignore"), utf16);
  const r = init({ cwd, pluginRoot });
  assert.ok(readFileSync(join(cwd, ".gitignore")).equals(utf16));
  const g = r.results.find((x) => x.path === ".gitignore");
  assert.equal(g.status, "skipped");
  assert.match(g.note, /UTF-8/);
});

test("空のひな形: projectRules が空で、見出しの既定が入る", () => {
  const cwd = proj(), pluginRoot = plugin();
  init({ cwd, pluginRoot });
  const d = JSON.parse(readFileSync(join(cwd, ".project-lens/data.json"), "utf8"));
  assert.deepEqual(d.settings.projectRules, []);
  assert.deepEqual(d.settings.labels, { group: "大項目", subgroup: "中項目" });
});

test("既存の data.json が、作業枠・予定を含む旧形式なら、何も作らずに止める（空の個人ファイルを隣に足さない）", () => {
  const cwd = proj(), pluginRoot = plugin();
  mkdirSync(join(cwd, ".project-lens"));
  const old = readFileSync(join(REPO, "data/sample.json"), "utf8");
  writeFileSync(join(cwd, ".project-lens/data.json"), old);
  const r = init({ cwd, pluginRoot });
  assert.equal(r.ok, false);
  assert.match(r.error, /旧形式の data\.json/);
  assert.deepEqual(names(cwd), [".project-lens"]);
  assert.deepEqual(names(join(cwd, ".project-lens")), ["data.json"]);
  assert.equal(readFileSync(join(cwd, ".project-lens/data.json"), "utf8"), old);
});

test("親のフォルダに data.json があるとき、子フォルダでの init は何も作らずに止める。cwd 自身にあれば、これまでどおり", () => {
  const parent = proj(), pluginRoot = plugin();
  init({ cwd: parent, pluginRoot });
  const child = join(parent, "sub");
  mkdirSync(child);
  const r = init({ cwd: child, pluginRoot });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes(parent) && r.error.includes("何も変更せずに止めました"));
  assert.deepEqual(names(child), [], "子には何も作らない");
  assert.equal(status(init({ cwd: parent, pluginRoot }), ".project-lens/data.json"), "unchanged");
});
