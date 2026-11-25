// ヘッダーの、読み込み中のファイルの札（共有・個人）と、押したときに開く詳細。純関数。
// info は { shared: { name, at, writable }, personal: {...} }、open は詳細を開いている札（"shared" | "personal" | null）。
import { esc } from "../common.js";

const KINDS = {
  shared: { label: "共有", choose: "別の共有ファイルを選ぶ" },
  personal: { label: "個人", choose: "別の個人ファイルを選ぶ" },
};

const p2 = (n) => String(n).padStart(2, "0");
/** ファイルの更新日時（epoch ms）をローカル時刻の「YYYY/MM/DD HH:MM」で。分からなければ「—」 */
const fmtAt = (at) => {
  if (!Number.isFinite(at)) return "—";
  const d = new Date(at);
  return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

/** 詳細の中身（dt・dd の組）。ファイルの中身の手がかりは、種類ごとに違う */
function rows(which, data, f) {
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  const head = row("ファイル名", esc(f.name ?? "選んだファイル"));
  const tail = row("更新日時", fmtAt(f.at)) + row("保存", f.writable ? "書き込めます" : "読み込み専用");
  if (which === "shared") {
    const names = (data.projects ?? []).map((p) => p.name);
    const more = names.length > 3 ? `、ほか ${names.length - 3} 件` : "";
    const tasks = data.tasks ?? [];
    const done = tasks.filter((t) => t.status === "Done").length;
    return head + row("プロジェクト", (names.slice(0, 3).map(esc).join("、") || "なし") + more) + row("タスク", `${tasks.length} 件（うち Done ${done} 件）`) + tail;
  }
  const sessions = (data.tasks ?? []).reduce((n, t) => n + (t.sessions?.length ?? 0), 0) + (data.orphanSessions?.length ?? 0);
  return head + row("作業枠・実績", `${sessions} 件`) + row("会議", `${(data.events ?? []).length} 件`) + tail;
}

export function renderFileChips(data, info, open) {
  return ["shared", "personal"].map((which) => {
    const f = info[which], k = KINDS[which], on = open === which;
    const chip = `<button class="chip-btn" data-fileinfo="${which}" aria-expanded="${on}" title="読み込み中のファイルの詳細を開きます"><i class="dot ${f.writable ? "ok" : "warn"}" aria-hidden="true"></i> ${k.label} ${esc(f.name ?? "選んだファイル")}</button>`;
    const detail = on ? `<div class="fileinfo" role="group" aria-label="${k.label}ファイルの詳細"><dl>${rows(which, data, f)}</dl><button class="btn" data-open="${which}">${k.choose}</button></div>` : "";
    return `<span class="filechip">${chip}${detail}</span>`;
  }).join("");
}
