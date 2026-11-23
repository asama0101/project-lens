// データファイル(JSON)の読み書き。File System Access API を使い、選んだファイルのハンドルを IndexedDB に覚える。
// 保存前に更新日時を比べ、他（Claude Code など）が更新していたら上書きせず conflict を返す。
// 開き直しは、権限が許可済みなら restore（確認なし）、確認が必要なら reopen（ボタンの押下で確認だけ）。ファイル選択は choose だけが出す。
// createPairStore は、共有ファイル（data.json）と個人ファイル（personal.json）の 2 つの createStore を、結合した 1 つのデータで扱う。

import { splitData, mergeData, checkSharedShape, checkPersonalShape } from "../core/split.js";

const KEY = "dataFileHandle";
const PICKER_TYPES = [{ description: "プロジェクトデータ (JSON)", accept: { "application/json": [".json"] } }];

/** 既定の IndexedDB 保存先。get は失敗を投げ（理由を画面に出すため）、set は失敗しても false を返すだけ（記憶できないだけで、使えなくはしない） */
function defaultIdb() {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open("project-lens", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction("kv", mode).objectStore("kv"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };
  return {
    get: (k) => run("readonly", (s) => s.get(k)),
    set: (k, v) => run("readwrite", (s) => s.put(v, k)).then(() => true, () => false),
  };
}

/** データの形（4 つの配列）が無ければ例外。開く・読み直すのすべてが、画面に渡す前にこれを通る */
export function checkShape(data) {
  for (const k of ["projects", "tasks", "events", "changeLog"]) {
    if (!Array.isArray(data?.[k])) throw new Error(`データの形が違います（${k} がありません）`);
  }
}

export function createStore(deps = {}) {
  const picker = deps.showOpenFilePicker ?? ((o) => window.showOpenFilePicker(o));
  const idb = deps.idb ?? defaultIdb();
  const check = deps.check ?? (() => {});
  const key = deps.key ?? KEY;
  let handle = null;
  let loadedAt = null; // 読み込み（または直近の保存）時点のファイル更新日時
  let rememberFailed = false; // choose で選んだファイルを記憶できなかった（次回も選び直しになる）

  async function ensureWritable(h) {
    try {
      if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return true;
      return (await h.requestPermission({ mode: "readwrite" })) === "granted";
    } catch {
      return false;
    }
  }

  /** h のファイルを読み、形を検査する。handle と loadedAt は変えない（検査に通ってから、呼び出し側が切り替える） */
  async function readFrom(h) {
    const file = await h.getFile();
    const data = JSON.parse(await file.text());
    check(data);
    return { data, at: file.lastModified };
  }

  /** 今のファイルを読み直して、読み込み時点を更新する */
  async function load() {
    const r = await readFrom(handle);
    loadedAt = r.at;
    return r.data;
  }

  /** h を読んで検査し、通ったときだけ今のファイルに切り替える。読めない・形が違うときは例外で、handle と loadedAt は元のまま
   *  （先に切り替えると、開けなかったファイルへ、画面に残った前のデータを保存して上書きする） */
  async function switchTo(h) {
    const r = await readFrom(h);
    handle = h;
    loadedAt = r.at;
    return r.data;
  }

  /** 記憶したファイルの名前。なければ null、記憶を読めなければ { error } */
  async function lastFile() {
    try {
      const saved = await idb.get(key);
      return saved ? { name: saved.name } : null;
    } catch (e) {
      return { error: e?.message ?? String(e) };
    }
  }

  /** 起動時の自動オープン。権限が許可済みのときだけ読み、確認もファイル選択も出さない。使えなければ null */
  async function restore() {
    let saved;
    try { saved = await idb.get(key); } catch { return null; }
    if (!saved || (await saved.queryPermission({ mode: "readwrite" })) !== "granted") return null;
    return switchTo(saved);
  }

  /** 「前回のファイルを開く」。権限の確認だけを出し（ボタン押下の中で呼ぶ）、拒否されてもファイル選択には切り替えない */
  async function reopen() {
    const saved = await idb.get(key);
    if (!(await ensureWritable(saved))) throw new Error("ファイルへの書き込みが許可されませんでした。もう一度押して許可するか、「別のファイルを開く」で選び直してください");
    return switchTo(saved);
  }

  /** 常にファイル選択を出す。読めて形が合ったときだけ、切り替えて記憶する */
  async function choose() {
    const [h] = await picker({ types: PICKER_TYPES, multiple: false });
    await ensureWritable(h);
    const data = await switchTo(h);
    rememberFailed = (await idb.set(key, h)) === false;
    return data;
  }

  /** ファイルの最新を読むだけ（読込時点は変えない。他の更新があるかの確認用） */
  async function peek() {
    return JSON.parse(await (await handle.getFile()).text());
  }

  async function reload() {
    if (!handle) throw new Error("ファイルが選ばれていません");
    return load();
  }

  /** reload を 2 段に分けたもの（createPairStore 用）。読んで検査するだけで、読み込み時点は commit() を呼んだときに進める */
  async function read() {
    if (!handle) throw new Error("ファイルが選ばれていません");
    const r = await readFrom(handle);
    return { data: r.data, commit: () => { loadedAt = r.at; } };
  }

  async function save(data) {
    try {
      const current = await handle.getFile();
      if (current.lastModified !== loadedAt) {
        return { ok: false, reason: "conflict", message: "他で更新されました。再読込してください" };
      }
      const w = await handle.createWritable();
      await w.write(JSON.stringify(data, null, 2) + "\n");
      await w.close();
      loadedAt = (await handle.getFile()).lastModified;
      return { ok: true };
    } catch (e) {
      const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
      return { ok: false, reason: denied ? "denied" : "error", message: denied ? "書き込みが許可されていません" : `保存に失敗しました: ${e?.message ?? e}` };
    }
  }

  /**
   * 保存する。他（Claude Code など）がファイルを更新していて競合したときは、最新のファイルに、同じ編集（edit: data → data）を
   * 当てて、もう一度だけ保存する（他の更新も、この編集も消さない）。成功したら、保存したデータを data で返す。
   * 当て直せないとき（edit が例外）は、reason: "conflict" で返す
   */
  async function saveMerged(edit, data) {
    const first = await save(data);
    if (first.ok || first.reason !== "conflict") return { ...first, data };
    let merged, mod;
    try {
      const file = await handle.getFile();
      mod = file.lastModified;
      merged = edit(JSON.parse(await file.text()));
    } catch (e) {
      // 最新のファイルに、同じ編集を当てられない（すでに処理されている、など）。競合として返す。読み込み時点は進めない
      return { ok: false, reason: "conflict", message: e?.message ?? String(e), data };
    }
    const before = loadedAt;
    loadedAt = mod; // 当て直しが通ってから、読み込み時点を進める（先に進めると、次の保存が、他の更新を古いデータで上書きする）
    const second = await save(merged);
    if (second.ok) return { ok: true, data: merged };
    loadedAt = before; // 2 回目の保存が失敗したら戻す（進めたままだと、次の保存が競合を検出せず、画面の古いデータで他の更新を上書きする）
    return { ...second, data };
  }

  return { restore, reopen, choose, lastFile, peek, reload, read, save, saveMerged, get hasFile() { return !!handle; }, get rememberFailed() { return rememberFailed; } };
}

const PAIR = ["shared", "personal"];
const PAIR_NAMES = { shared: "data.json", personal: "personal.json" };

/**
 * 共有ファイル（data.json）と個人ファイル（personal.json）を、結合した 1 つのデータ（mergeData の形）で読み書きする。
 * 公開するメソッドは createStore と同じ形で、choose(which)・missing()・lastFile()（{ shared, personal }）が違う。
 * 保存は、splitData で分けた 2 つのうち、直前に読んだ（保存した）内容から変わった方だけを、共有 → 個人の順に書く。
 * 競合はファイルごとに検知し、当て直しは「そのファイルの最新 + もう片方の、編集を当てる前の内容」に edit を当てた、そのファイルの分
 */
export function createPairStore(deps = {}) {
  const stores = {
    shared: createStore({ ...deps, key: "dataFileHandle", check: checkSharedShape }),
    personal: createStore({ ...deps, key: "personalFileHandle", check: checkPersonalShape }),
  };
  const raw = { shared: null, personal: null }; // 直前に読んだ（または保存した）各ファイルの内容
  // 当て直して書けたが、もう片方の保存が失敗した（画面のデータが、そのファイルより古い）ファイルの、編集を当てる前の内容。
  // 次の保存は、画面のデータではなく、これに edit を当て直したものを、当て直さずに書く（画面の古いデータで、他の更新を上書きしない）
  let behind = {};
  const hasFile = () => stores.shared.hasFile && stores.personal.hasFile;
  const merged = () => (hasFile() ? mergeData(raw.shared, raw.personal) : null);
  const missing = () => PAIR.filter((w) => !stores[w].hasFile);
  const loaded = (w, d) => { raw[w] = d; behind = {}; };

  /** 起動時の自動オープン。2 つとも開けたときだけ結合したデータ、そうでなければ null（足りない方は missing で分かる） */
  async function restore() {
    for (const w of PAIR) { const d = await stores[w].restore(); if (d) loaded(w, d); }
    return merged();
  }

  /** まだ開いていない方を、権限の確認だけで開く。記憶の無い方は開かない（missing に残る） */
  async function reopen() {
    for (const w of missing()) {
      if ((await stores[w].lastFile()) === null) continue;
      loaded(w, await stores[w].reopen());
    }
    return merged();
  }

  /** which（"shared" | "personal"）のファイルを選ぶ。2 つとも開いたら結合したデータ、そうでなければ null */
  async function choose(which) {
    loaded(which, await stores[which].choose());
    return merged();
  }

  async function lastFile() {
    return { shared: await stores.shared.lastFile(), personal: await stores.personal.lastFile() };
  }

  async function peek() {
    return mergeData(await stores.shared.peek(), await stores.personal.peek());
  }

  /** 2 つとも読めて形が合ってから、両方の読み込み時点を進める。片方でも失敗したら、何も変えずに例外
   *  （片方だけ進めると、画面の古いデータが、その方の他の更新を競合なしで上書きする） */
  async function reload() {
    const fresh = { shared: await stores.shared.read(), personal: await stores.personal.read() };
    for (const w of PAIR) { fresh[w].commit(); loaded(w, fresh[w].data); }
    return merged();
  }

  /** edit が null なら当て直さない（save）。結果は createStore の saveMerged と同じ形で、message にファイル名を付ける */
  async function write(data, edit) {
    const base = { shared: behind.shared ?? raw.shared, personal: behind.personal ?? raw.personal }; // 編集を当てる前の内容
    const redo = (w, fresh) => { base[w] = fresh; return splitData(edit(mergeData(base.shared, base.personal)))[w]; };
    const before = splitData(mergeData(raw.shared, raw.personal)); // 直前の内容を splitData の形（キーの順）にそろえて比べる
    const next = splitData(data);
    const failed = [], ahead = [];
    for (const w of PAIR) {
      let part = next[w];
      if (behind[w]) {
        if (!edit) { failed.push({ w, r: { reason: "conflict", message: "他で更新されました。再読込してください" } }); continue; }
        try { part = redo(w, behind[w]); } catch (e) { failed.push({ w, r: { reason: "conflict", message: e?.message ?? String(e) } }); continue; }
      }
      if (JSON.stringify(part) !== JSON.stringify(before[w])) {
        // behind の方は、当て直した結果を、もう当て直さずに書く（その後にまた外から変わっていたら conflict。すでに書いた編集を 2 回当てない）
        const r = edit && !behind[w] ? await stores[w].saveMerged((fresh) => redo(w, fresh), part) : { ...(await stores[w].save(part)), data: part };
        if (!r.ok) { failed.push({ w, r }); continue; }
        raw[w] = r.data;
        part = r.data;
      }
      if (part !== next[w]) ahead.push(w); // ファイルが、画面のデータより新しい（当て直した）
      else delete behind[w];
    }
    if (!failed.length) {
      behind = {};
      return { ok: true, data: ahead.length ? mergeData(raw.shared, raw.personal) : data };
    }
    for (const w of ahead) behind[w] = base[w];
    const message = failed.map(({ w, r }) => `${PAIR_NAMES[w]}: ${r.message}`).join(" / ");
    return { ok: false, reason: failed[0].r.reason, message, data };
  }

  async function save(data) {
    const r = await write(data, null);
    return r.ok ? { ok: true } : r;
  }

  return {
    restore, reopen, choose, missing, lastFile, peek, reload, save,
    saveMerged: (edit, data) => write(data, edit),
    get hasFile() { return hasFile(); },
    get rememberFailed() { return stores.shared.rememberFailed || stores.personal.rememberFailed; },
  };
}
