// CLI（tools/*.js）で共有する data.json の読み書き。saveData は検証に通ったときだけ書く。
import { readFileSync, writeFileSync, renameSync, rmSync, statSync, copyFileSync, existsSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { validate } from "../src/core/schema.js";
import { splitData, mergeData, emptyPersonal, checkSharedShape, checkPersonalShape } from "../src/core/split.js";

// 読んだ時点のファイルの印（更新日時とサイズ）。save が、読んでから書くまでの間に他が書き換えていないかを確かめる
const seen = new Map();
const STALE = "他で更新されました。読み直して、もう一度実行してください";
// 読んだとき個人ファイルが無かった場所（印が無いので、あとで他が作ったかを別に見張る）
const missing = new Set();
const stamp = (p) => { const s = statSync(p); return `${s.mtimeMs}:${s.size}`; };

/** 読んだ時点の印を覚える。印は、中身より先に取る（読む間に書き換わっても、あとの save が競合として気づく） */
export function readJson(p) {
  let sig = null;
  try { sig = stamp(p); } catch { /* 読めないときは、次の readFileSync が例外を投げる */ }
  const data = JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, "")); // メモ帳などが付ける BOM は除く（画面は BOM を除いて開くので、CLI も合わせる）
  if (sig) seen.set(resolve(p), sig);
  return data;
}
export const out = (v) => console.log(JSON.stringify(v, null, 2));

/** 置き換え（rename）を最大 3 回試す。ウイルス対策ソフトなどがファイルを開いている間の、一時的な失敗に備える。3 回とも失敗したら、最後の例外を投げる */
export function renameWithRetry(from, to, rename = renameSync, sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)) {
  for (let n = 1; ; n++) {
    try { return rename(from, to); } catch (e) { if (n === 3) throw e; sleep(100); }
  }
}

/** readJson で読んだあとに他が書き換えていたら例外 */
function assertFresh(path) {
  const read = seen.get(resolve(path));
  if (!read) return;
  let now;
  try { now = stamp(path); } catch { now = null; } // 読んだあとに消された
  if (read !== now) throw new Error(STALE);
}

/**
 * 一時ファイルに書いて置き換える。書き込みの途中で止まっても元のファイルが壊れないよう、同じフォルダの一時ファイルに書いてから置き換える。
 * 直前の版は、先に `<path>.bak.tmp` へコピーしておき、置き換えに成功したあとで `<path>.bak` にする（1 世代。backup: false で省く。置き換えに失敗したときは、`.bak` を変えない）。
 * 置き換えに 3 回失敗したときは、直接上書きせず例外にする（上書きの途中で止まると、ファイルが壊れるため）。rename は、テストで置き換えを失敗させるための差し込み口。成功したら、いまの印を覚える
 */
function writeText(path, text, rename, backup) {
  const tmp = `${path}.${process.pid}.tmp`, bakTmp = `${path}.bak.tmp`;
  try {
    writeFileSync(tmp, text);
    let bakReady = false;
    const warn = (e) => process.stderr.write(`${path}.bak を更新できませんでした: ${e.message}\n`);
    if (backup) { try { copyFileSync(path, bakTmp); bakReady = true; } catch (e) { if (e.code !== "ENOENT") warn(e); /* 初回（元が無い）や控えが書けないときも、本体は保存する */ } }
    try { renameWithRetry(tmp, path, rename); } catch (e) { throw new Error(`${path} を置き換えられませんでした（${e.message}）。ウイルス対策ソフトや同期ソフトなど、ほかのプログラムが ${basename(path)} を開いていないか確かめて、もう一度実行してください`); }
    if (bakReady) { try { renameSync(bakTmp, `${path}.bak`); } catch (e) { warn(e); } } // 置き換えに成功したあとで、控えを確定する（失敗したときは、1 つ前の控えを残す）
  } finally {
    try { rmSync(tmp, { force: true }); rmSync(bakTmp, { force: true }); } catch { /* 消せなくても、データは書けている */ }
  }
  seen.set(resolve(path), stamp(path));
}

/** `--mine <ファイル>` を引数から取り除く。値が無い（末尾、または空）ときは例外（黙って既定の場所を使わない） */
export function takeMine(args) {
  const i = args.indexOf("--mine");
  if (i < 0) return { mine: null, rest: args };
  const v = args[i + 1];
  if (!v) throw new Error("--mine にファイルを指定してください");
  return { mine: v, rest: args.filter((_, j) => j !== i && j !== i + 1) };
}

/** 各ツールの入口用: takeMine の例外を、使い方の誤り（標準エラーに理由、終了コード 2）にする */
export function takeMineOrExit(args) {
  try { return takeMine(args); } catch (e) { console.error(e.message); process.exit(2); }
}

/** 個人ファイルの場所。--mine があればそれ（いまのフォルダからの相対パスも可）、なければ共有ファイルと同じフォルダの personal.json */
export const personalPathOf = (path, mine) => mine ? resolve(mine) : join(dirname(path), "personal.json");

const noMine = (p) => `個人ファイル ${p} がありません。--mine の指定を確かめてください`;

/** 共有ファイルと個人ファイルを読んで 1 つのデータにする。個人ファイルが無い（ENOENT）ときは空の個人として扱う。共有ファイルが読めなければ例外 */
export function readData(path, mine) {
  const shared = readJson(path);
  checkSharedShape(shared);
  let personal;
  const pPath = personalPathOf(path, mine), key = resolve(pPath);
  try { personal = readJson(pPath); missing.delete(key); } catch (e) {
    if (e.code !== "ENOENT") throw e;
    if (mine) throw new Error(noMine(pPath)); // 明示した --mine が無い: 指定の誤りなので、空として読まない
    missing.add(key);
    personal = emptyPersonal();
  }
  checkPersonalShape(personal);
  return mergeData(shared, personal);
}

const text = (v) => JSON.stringify(v, null, 2) + "\n";
const textOf = (p) => { try { return readFileSync(p, "utf8").replace(/^\uFEFF/, ""); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };

/**
 * 結合したデータを 1 回検証し（エラーなら何も書かない）、共有と個人へ分けて、中身が変わった方だけ書く。
 * 書く前に、両方の競合を確かめる。書く順は共有 → 個人。2 つ目が失敗しても、1 つ目は戻さず、例外の文言に書けた方・書けなかった方を書く。
 */
export function saveData(path, data, rename = renameSync, { backup = true, mine } = {}) {
  const { errors } = validate(data);
  if (errors.length) throw new Error(errors.join(" / "));
  const pPath = personalPathOf(path, mine);
  if (mine && !existsSync(pPath)) throw new Error(noMine(pPath));
  assertFresh(path);
  assertFresh(pPath);
  if (missing.has(resolve(pPath)) && existsSync(pPath)) throw new Error(STALE); // 読んだときは無かった個人ファイルを、他が作った
  const { shared, personal } = splitData(data);
  const files = [[path, text(shared), textOf(path)], [pPath, text(personal), textOf(pPath) ?? text(emptyPersonal())]]
    .filter(([, next, now]) => next !== now);
  files.forEach(([p, t], i) => {
    try {
      if (missing.has(resolve(p)) && existsSync(p)) throw new Error(STALE); // 書く直前にも、無かったはずの個人ファイルを確かめる
      writeText(p, t, rename, backup);
      missing.delete(resolve(p));
    } catch (e) {
      if (i === 0) throw e;
      throw new Error(`${files[0][0]} は書けましたが、${p} は書けませんでした（${e.message}）。${p} を確かめて、もう一度実行してください`);
    }
  });
}
