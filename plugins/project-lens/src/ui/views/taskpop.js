// ガントチャートでタスク名・バーをクリックしたときに開く、編集の小さな窓。
// 入力の属性（data-f・data-id・data-addpre・data-rmpre）は、リストの編集欄と同じ。保存と描き直しは、リストと同じ処理が受け持つ。
// 窓を閉じる ×: data-tpopclose / 窓: data-tpop。「リストで開く」は data-goto、削除は data-del（どちらも既存の処理）
import { esc, fmtMD } from "../common.js";
import { taskStart } from "../../core/metrics.js";
import { predecessorCandidates } from "../edit.js";
import { checklistEditorHtml } from "./checklist.js";

/** 前のタスクの外し方（×）と足し方（選択）。リストの編集欄と共用 */
export function predEditHtml(data, t) {
  const chips = (t.predecessors ?? []).map((id) => `<span class="chip">${esc(id)}<button data-rmpre="${esc(t.id)}|${esc(id)}" aria-label="${esc(id)} を前のタスクから外す">×</button></span>`).join("");
  const cand = predecessorCandidates(data, t.id).map((id) => data.tasks.find((u) => u.id === id));
  const add = cand.length ? `<select class="in sm" data-addpre="${esc(t.id)}" aria-label="前のタスクを追加"><option value="">＋前のタスク</option>${cand.map((u) => `<option value="${esc(u.id)}">${esc(u.id)} ${esc(u.title)}</option>`).join("")}</select>` : "";
  return `<div class="chips">${chips}${add}</div>`;
}

/** 開始日の入力。指定がなく前のタスクがあるときは、前のタスクの期限から決まる日を入れて「前のタスクから」と添える（空にすると指定を外す） */
export function startInputHtml(data, t) {
  const derived = !t.start && (t.predecessors ?? []).length > 0;
  const hint = derived ? ` <small class="muted" title="開始日を指定していないので、前のタスクの期限から決まります">前のタスクから</small>` : "";
  return `<input class="in" type="date" data-f="start" data-id="${esc(t.id)}" value="${esc(t.start || (derived ? taskStart(data, t.id) : ""))}" aria-label="${esc(t.id)} の開始日">${hint}`;
}

/**
 * 窓の編集の項目の HTML（縦に並べる。窓は常に full: true）。スケジュールの編集欄は別の並べ方（taskRowFieldsHtml）。
 * 軽い欄 = 件名・プロジェクト・状態・開始・期限・重要・メモ。full で、チェックリスト・前のタスク・繰り返しを足す
 */
function taskFieldsHtml(data, t, { full, statusHtml }) {
  const id = esc(t.id);
  const field = (label, inner) => `<label class="tp-f"><span class="muted">${label}</span>${inner}</label>`;
  const projects = [["", "プロジェクトなし"], ...data.projects.map((p) => [p.id, p.name])].map(([v, l]) => `<option value="${esc(v)}" ${(t.projectId ?? "") === v ? "selected" : ""}>${esc(l)}</option>`).join("");
  const imp = field("重要", `<input type="checkbox" data-f="important" data-id="${id}" ${t.important === true ? "checked" : ""}>`);
  const repeat = field("繰り返し", `<select class="in sm" data-f="repeat" data-id="${id}"><option value="">なし</option><option value="week" ${t.repeat?.unit === "week" ? "selected" : ""}>毎週</option><option value="month" ${t.repeat?.unit === "month" ? "selected" : ""}>毎月${t.repeat?.unit === "month" ? `（${esc(t.repeat.day)} 日）` : ""}</option></select>`);
  return `${field("件名", `<input class="in" data-f="title" data-id="${id}" value="${esc(t.title)}">`)}
    ${field("プロジェクト", `<select class="in sm" data-f="projectId" data-id="${id}">${projects}</select>`)}
    <div class="tp-f"><span class="muted">状態</span><div>${statusHtml}</div></div>
    <div class="tp-r">${field("開始", startInputHtml(data, t))}${field("期限", `<input class="in" type="date" data-f="due" data-id="${id}" value="${esc(t.due)}">`)}</div>
    ${full ? checklistEditorHtml(t) : ""}
    ${full ? `<div class="tp-f"><span class="muted">前のタスク</span>${predEditHtml(data, t)}</div>` : ""}
    <div class="tp-r">${imp}${full ? repeat : ""}</div>
    ${field("メモ", `<input class="in" data-f="memo" data-id="${id}" value="${esc(t.memo ?? "")}" placeholder="メモ">`)}`;
}

/**
 * @param pop { id, x, y }  クリックした位置（画面の座標）。置き場所の調整は呼び出し側（画面の端に収める）
 * @param statusHtml 状態の欄（リストと同じ。待ち先・Done の確認の表示を含む）
 */
export function renderTaskPop(data, pop, statusHtml) {
  const t = data.tasks.find((x) => x.id === pop.id);
  if (!t) return "";
  const id = esc(t.id);
  return `<div class="tpop" role="dialog" aria-label="${id} を編集" data-tpop style="left:${Math.round(pop.x)}px;top:${Math.round(pop.y)}px">
    <div class="tp-h"><b class="mono">${id}</b><span class="muted">${fmtMD(taskStart(data, t.id))}〜${fmtMD(t.due)}</span><button class="gx" data-tpopclose aria-label="編集を閉じる" style="opacity:1">×</button></div>
    ${taskFieldsHtml(data, t, { full: true, statusHtml })}
    <div class="tp-a"><button class="btn" data-goto="${id}">リストで開く</button><button class="btn" data-dup="${id}">複製</button><button class="btn danger" data-del="${id}">削除</button></div>
  </div>`;
}

/**
 * スケジュールの編集欄の項目（会議の入力欄と同じ、ラベル付きの横並び）。窓の taskFieldsHtml とは別の並べ方。
 * fields = 1 行に折り返して並べる項目、wide = 全幅の行にする編集欄（full のときだけ）
 */
function taskRowFieldsHtml(data, t, { full, statusHtml }) {
  const id = esc(t.id);
  const field = (cls, label, inner) => `<label${cls ? ` class="${cls}"` : ""}><span>${label}</span>${inner}</label>`;
  const projects = [["", "プロジェクトなし"], ...data.projects.map((p) => [p.id, p.name])].map(([v, l]) => `<option value="${esc(v)}" ${(t.projectId ?? "") === v ? "selected" : ""}>${esc(l)}</option>`).join("");
  const repeat = `<option value="">なし</option><option value="week" ${t.repeat?.unit === "week" ? "selected" : ""}>毎週</option><option value="month" ${t.repeat?.unit === "month" ? "selected" : ""}>毎月${t.repeat?.unit === "month" ? `（${esc(t.repeat.day)} 日）` : ""}</option>`;
  const fields = [
    field("tp-title", "件名", `<input class="in" data-f="title" data-id="${id}" value="${esc(t.title)}">`),
    field("", "期限", `<input class="in" type="date" data-f="due" data-id="${id}" value="${esc(t.due)}">`),
    field("", "開始", startInputHtml(data, t)),
    `<div class="tp-st"><span>状態</span><div>${statusHtml}</div></div>`,
    `<label class="chk"><input type="checkbox" data-f="important" data-id="${id}" ${t.important === true ? "checked" : ""}>重要</label>`,
    field("", "プロジェクト", `<select class="in sm" data-f="projectId" data-id="${id}">${projects}</select>`),
    full ? field("", "繰り返し", `<select class="in sm" data-f="repeat" data-id="${id}">${repeat}</select>`) : "",
    field("tp-memo", "メモ", `<input class="in" data-f="memo" data-id="${id}" value="${esc(t.memo ?? "")}" placeholder="メモ">`),
  ].join("\n    ");
  const wide = full ? `${checklistEditorHtml(t)}<div class="tp-wide"><span>前のタスク</span>${predEditHtml(data, t)}</div>` : "";
  return { fields, wide };
}

/**
 * スケジュール画面の編集欄（#mtgslot に出す）。対象のタスクが無ければ空。会議の入力欄と同じ、ラベル付きの項目が折り返して並ぶ形
 * @param edit { id, full, askDel }  askDel が真なら削除の確認を出す。full が真なら、繰り返し・チェックリスト・前のタスク・複製・削除も出す
 */
export function renderTaskEditPanel(data, edit, statusHtml) {
  const t = data.tasks.find((x) => x.id === edit.id);
  if (!t) return "";
  const id = esc(t.id);
  const { fields, wide } = taskRowFieldsHtml(data, t, { full: edit.full, statusHtml });
  const del = edit.askDel ? `<span class="ask">このタスクを削除します。<button class="btn danger" data-delyes="${id}">削除する</button><button class="btn" data-tedit-delno>やめる</button></span>` : `<button class="btn danger" data-tedit-del="${id}">削除</button>`;
  return `<div class="mtgform tedit" role="group" aria-label="${id} を編集" data-tedit>
    <span class="tp-h"><b class="mono">${id}</b><span class="muted">${fmtMD(taskStart(data, t.id))}〜${fmtMD(t.due)}</span></span>
    ${fields}
    <div class="tp-a"><button class="btn" data-tedit-full aria-expanded="${edit.full}">${edit.full ? "詳細を閉じる" : "詳細を開く"}</button>${edit.full ? `<button class="btn" data-dup="${id}">複製</button>${del}` : ""}<button class="btn" data-tedit-close>閉じる</button></div>
    ${wide}
  </div>`;
}
