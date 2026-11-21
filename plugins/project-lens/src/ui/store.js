// データファイル(JSON)の読み書き。File System Access API を使い、選んだファイルのハンドルを IndexedDB に覚える。
// 保存前に更新日時を比べ、他（Claude Code など）が更新していたら上書きせず conflict を返す。
// 開き直しは、権限が許可済みなら restore（確認なし）、確認が必要なら reopen（ボタンの押下で確認だけ）。ファイル選択は choose だけが出す。

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
      const saved = await idb.get(KEY);
      return saved ? { name: saved.name } : null;
    } catch (e) {
      return { error: e?.message ?? String(e) };
    }
  }

  /** 起動時の自動オープン。権限が許可済みのときだけ読み、確認もファイル選択も出さない。使えなければ null */
  async function restore() {
    let saved;
    try { saved = await idb.get(KEY); } catch { return null; }
    if (!saved || (await saved.queryPermission({ mode: "readwrite" })) !== "granted") return null;
    return switchTo(saved);
  }

  /** 「前回のファイルを開く」。権限の確認だけを出し（ボタン押下の中で呼ぶ）、拒否されてもファイル選択には切り替えない */
  async function reopen() {
    const saved = await idb.get(KEY);
    if (!(await ensureWritable(saved))) throw new Error("ファイルへの書き込みが許可されませんでした。もう一度押して許可するか、「別のファイルを開く」で選び直してください");
    return switchTo(saved);
  }

  /** 常にファイル選択を出す。読めて形が合ったときだけ、切り替えて記憶する */
  async function choose() {
    const [h] = await picker({ types: PICKER_TYPES, multiple: false });
    await ensureWritable(h);
    const data = await switchTo(h);
    rememberFailed = (await idb.set(KEY, h)) === false;
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

  return { restore, reopen, choose, lastFile, peek, reload, save, saveMerged, get hasFile() { return !!handle; }, get rememberFailed() { return rememberFailed; } };
}
