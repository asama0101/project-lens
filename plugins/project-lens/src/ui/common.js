// 画面共通の小さな道具（HTML エスケープ、日付・時刻の表示、状態の見た目）。DOM には触れない。
import { weekday, toHHMM } from "../core/dates.js";
import { checklistCount } from "../core/checklist.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** 2026-10-20 → 10/20 */
export const fmtMD = (d) => { const [, m, day] = d.split("-"); return `${+m}/${+day}`; };

const WD_JA = ["日", "月", "火", "水", "木", "金", "土"];
export const wdJa = (d) => WD_JA[weekday(d)];

/** 分 → "9:05"（先頭の 0 なし） */
export const hm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
/** 分 → "09:05" */
export const hh = toHHMM;

/** タスク状態 → ドット／バーの CSS クラス */
export const STATUS_UI = {
  "To Do": { dot: "s-todo", bar: "b-todo" },
  "In Progress": { dot: "s-prog", bar: "b-prog" },
  Waiting: { dot: "s-wait", bar: "b-wait" },
  Done: { dot: "s-done", bar: "b-done" },
  Cancelled: { dot: "s-cancel", bar: "b-cancel" },
};

/** プロジェクトの遅延・リスクのバッジ */
export function flagPills(data, projectId, today, flags) {
  const out = [];
  if (flags.includes("overdue-tasks")) {
    const n = data.tasks.filter((t) => t.projectId === projectId && t.status !== "Done" && t.status !== "Cancelled" && t.due < today).length;
    out.push(`<span class="pill late">期限超過 ${n}件</span>`);
  }
  if (flags.includes("waiting-long")) out.push(`<span class="pill wait">待ち長期化</span>`);
  if (flags.includes("past-due")) out.push(`<span class="pill late">プロジェクト期限超過</span>`);
  return out.join("");
}

/** チェックリストの進み具合（細い線と「済み/全体」）。項目がなければ空。remain なら「（残り K 件）」を添える */
export function checkMeterHtml(t, { remain = false } = {}) {
  const { total, done, open } = checklistCount(t);
  if (!total) return "";
  const pct = Math.round((done / total) * 100);
  return `<span class="ck-meter"><span class="ck-bar"><i style="width:${pct}%"></i></span><b class="ck-n mono${done === total ? " all" : ""}">${done}/${total}${remain ? `（残り ${open} 件）` : ""}</b></span>`;
}

/** 「プロジェクトなし」の区切り（絞り込みの値は "none"）。id が null で、プロジェクトの見出し・進捗・マイルストーンは持たない */
export const NO_PROJECT = { id: null, name: "プロジェクトなし" };

/** バナーの HTML。orphans＝共有ファイルに無いタスクの作業枠の件数（あれば削除のボタン、pending なら確認） */
export function bannerHtml(msg, actions = {}, orphans = 0, pending = false) {
  const orphan = !orphans ? "" : pending
    ? ` ${esc(`${orphans} 件の作業枠を削除します。タスクが戻っていないか、少し待ってから確認してください`)} <button class="btn" data-orphan-ok>削除する</button> <button class="btn" data-orphan-cancel>やめる</button>`
    : ` <button class="btn" data-orphan-clear>該当の枠を削除</button>`;
  if (!msg && !orphan) return "";
  return `<div class="banner">${esc(msg)}${actions.reload ? ` <button class="btn" data-reload>再読込(画面の未保存の変更は破棄)</button>` : ""}${actions.download ? ` <button class="btn" data-download>変更を JSON で書き出す</button>` : ""}${orphan}</div>`;
}
