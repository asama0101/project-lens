// ガントチャートでタスク名・バーをクリックしたときに開く、編集の小さな窓。
// 入力の属性（data-f・data-id・data-addpre・data-rmpre）は、リストの編集欄と同じ。保存と描き直しは、リストと同じ処理が受け持つ。
// 窓を閉じる ×: data-tpopclose / 窓: data-tpop。「リストで開く」は data-goto、削除は data-del（どちらも既存の処理）
import { esc, fmtMD, dateInputHtml } from "../common.js";
import { taskStart } from "../../core/metrics.js";
import { predecessorCandidates } from "../edit.js";
import { checklistEditorHtml } from "./checklist.js";

/** 前のタスクの足し方（選択。上）と外し方（選んだ札の ×。下）。リストの編集欄と共用。ids が false なら ID を出さず件名で出す（スケジュールの編集欄） */
export function predEditHtml(data, t, { ids = true } = {}) {
  const label = (id) => (ids ? id : data.tasks.find((u) => u.id === id)?.title ?? id);
  const chips = (t.predecessors ?? []).map((id) => `<span class="chip">${esc(label(id))}<button data-rmpre="${esc(t.id)}|${esc(id)}" aria-label="${esc(id)} を前のタスクから外す">×</button></span>`).join("");
  const cand = predecessorCandidates(data, t.id).map((id) => data.tasks.find((u) => u.id === id));
  const add = cand.length ? `<select class="in sm" data-addpre="${esc(t.id)}" aria-label="前のタスクを追加"><option value="">＋前のタスク</option>${cand.map((u) => `<option value="${esc(u.id)}">${ids ? `${esc(u.id)} ` : ""}${esc(u.title)}</option>`).join("")}</select>` : "";
  return `<div class="chips pred">${add}${chips ? `<div class="chips">${chips}</div>` : ""}</div>`; // 選ぶ欄が上、選んだ前のタスクの札は、その下
}

/** 開始日の入力。指定がなく前のタスクがあるときは、前のタスクの期限から決まる日を入れて「前のタスクから」と添える（空にすると指定を外す） */
export function startInputHtml(data, t) {
  const derived = !t.start && (t.predecessors ?? []).length > 0;
  const hint = derived ? ` <small class="muted" title="開始日を指定していないので、前のタスクの期限から決まります">前のタスクから</small>` : "";
  return `${dateInputHtml({ value: t.start || (derived ? taskStart(data, t.id) : ""), attrs: `data-f="start" data-id="${esc(t.id)}" aria-label="${esc(t.id)} の開始日"`, label: "開始日" })}${hint}`;
}

/**
 * 編集の項目 1 つの入力部分（ラベルは含まない）。窓とスケジュールの編集欄が共用する。リストの「繰り返し」の列も使う。
 * name = title|projectId|start|due|important|memo|party|expected|repeat。party・expected は状態が Waiting のときだけ（expected は待ち先が空なら disabled）。
 * ids が false なら、aria-label に ID を出さない（スケジュールの編集欄）
 */
export function taskFieldHtml(data, t, name, { ids = true } = {}) {
  const id = esc(t.id);
  const attrs = `data-f="${name}" data-id="${id}"`;
  switch (name) {
    case "title": return `<input class="in" ${attrs} value="${esc(t.title)}">`;
    case "projectId": {
      const opts = [["", "プロジェクトなし"], ...data.projects.map((p) => [p.id, p.name])].map(([v, l]) => `<option value="${esc(v)}" ${(t.projectId ?? "") === v ? "selected" : ""}>${esc(l)}</option>`).join("");
      return `<select class="in sm" ${attrs}>${opts}</select>`;
    }
    case "start": return startInputHtml(data, t);
    case "due": return dateInputHtml({ value: t.due, attrs, label: "期限" });
    case "important": return `<input type="checkbox" ${attrs} ${t.important === true ? "checked" : ""}>`;
    case "memo": return `<input class="in" ${attrs} value="${esc(t.memo ?? "")}" placeholder="メモ">`;
    case "party": return t.status === "Waiting" ? `<input class="in" ${attrs} value="${esc(t.waitingOn?.party ?? "")}" placeholder="ベンダー・部署名"${ids ? ` aria-label="${id} の待ち先"` : ""}>` : "";
    case "expected": return t.status === "Waiting" ? dateInputHtml({ value: t.waitingOn?.expected ?? "", cls: "in sm", attrs: `${attrs} title="回答予定日" ${t.waitingOn?.party ? "" : "disabled"}${ids ? ` aria-label="${id} の回答予定日"` : ""}`, label: "回答予定日" }) : "";
    case "repeat": return `<select class="in sm" ${attrs}${ids ? ` aria-label="${id} の繰り返し"` : ""}><option value="">なし</option><option value="week" ${t.repeat?.unit === "week" ? "selected" : ""}>毎週</option><option value="month" ${t.repeat?.unit === "month" ? "selected" : ""}>毎月${t.repeat?.unit === "month" ? `（${esc(t.repeat.day)} 日）` : ""}</option></select>`;
  }
  throw new Error(`taskFieldHtml: 知らない項目 ${name}`);
}

/**
 * 窓の編集の項目の HTML（縦に並べる。窓は常に full: true）。スケジュールの編集欄は別の並べ方（taskRowFieldsHtml）。
 * 軽い欄 = 件名・プロジェクト・状態・（Waiting なら待ち先・回答予定日）・開始・期限・重要・メモ。full で、チェックリスト・前のタスク・繰り返しを足す
 */
function taskFieldsHtml(data, t, { full, statusHtml }) {
  const f = (name) => taskFieldHtml(data, t, name);
  const field = (label, inner) => `<label class="tp-f"><span class="muted">${label}</span>${inner}</label>`;
  const waiting = t.status === "Waiting" ? `<div class="tp-r">${field("待ち先", f("party"))}${field("回答予定日", f("expected"))}</div>` : "";
  return `${field("件名", f("title"))}
    ${field("プロジェクト", f("projectId"))}
    <div class="tp-f"><span class="muted">状態</span><div>${statusHtml}</div></div>
    ${waiting}
    <div class="tp-r">${field("開始", f("start"))}${field("期限", f("due"))}</div>
    ${full ? checklistEditorHtml(t) : ""}
    ${full ? `<div class="tp-f"><span class="muted">前のタスク</span>${predEditHtml(data, t)}</div>` : ""}
    <div class="tp-r">${field("重要", f("important"))}${full ? field("繰り返し", f("repeat")) : ""}</div>
    ${field("メモ", f("memo"))}`;
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
    <div class="tp-a"><button class="btn" data-goto="${id}">リストで開く</button><button class="btn danger" data-del="${id}">削除</button></div>
  </div>`;
}

/**
 * スケジュールの編集欄の項目（会議の入力欄と同じ、ラベル付きの横並び）。窓の taskFieldsHtml とは別の並べ方。
 * fields = 軽い欄（1 行に折り返して並べる項目）、repeatField・wide = 詳細の入れ物に出す繰り返しと、全幅の行にする編集欄（full のときだけ）
 */
function taskRowFieldsHtml(data, t, { full, statusHtml }) {
  const f = (name) => taskFieldHtml(data, t, name, { ids: false });
  const field = (cls, label, inner) => `<label${cls ? ` class="${cls}"` : ""}><span>${label}</span>${inner}</label>`;
  const fields = [
    field("tp-title", "件名", f("title")),
    field("", "開始", f("start")),
    field("", "期限", f("due")),
    `<div class="tp-st"><span>状態</span><div>${statusHtml}</div></div>`,
    ...(t.status === "Waiting" ? [field("", "待ち先", f("party")), field("", "回答予定日", f("expected"))] : []),
    `<label class="chk">${f("important")}重要</label>`,
    field("", "プロジェクト", f("projectId")),
    field("tp-memo", "メモ", f("memo")),
  ].join("\n    ");
  const repeatField = full ? field("", "繰り返し", f("repeat")) : "";
  const wide = full ? `${checklistEditorHtml(t)}<div class="tp-wide"><span>前のタスク</span>${predEditHtml(data, t, { ids: false })}</div>` : "";
  return { fields, repeatField, wide };
}

/**
 * スケジュール画面の編集欄（#mtgslot に出す）。対象のタスクが無ければ空。見出しに ID は出さない（スケジュールは件名だけで表す）。会議の入力欄と同じ、ラベル付きの項目が折り返して並ぶ形
 * @param edit { id, full, askDel }  askDel が真なら削除の確認を出す。full が真なら、繰り返し・チェックリスト・前のタスク・削除も出す
 */
export function renderTaskEditPanel(data, edit, statusHtml) {
  const t = data.tasks.find((x) => x.id === edit.id);
  if (!t) return "";
  const id = esc(t.id);
  const { fields, repeatField, wide } = taskRowFieldsHtml(data, t, { full: edit.full, statusHtml });
  const del = edit.askDel ? `<span class="ask">このタスクを削除します。<button class="btn danger" data-delyes="${id}">削除する</button><button class="btn" data-tedit-delno>やめる</button></span>` : `<button class="btn danger" data-tedit-del="${id}">削除</button>`;
  // 詳細の項目は、軽い欄のあとの別の入れ物（全幅の行）に出す。軽い欄とボタンの行は、詳細の開閉で位置も大きさも変わらない
  const detail = edit.full ? `
    <div class="tedit-detail">${repeatField}<div class="tp-a">${del}</div>${wide}</div>` : "";
  return `<div class="mtgform tedit" role="group" aria-label="${id} を編集" data-tedit>
    <span class="tp-h"><span class="muted">${fmtMD(taskStart(data, t.id))}〜${fmtMD(t.due)}</span></span>
    ${fields}
    <div class="tp-a"><button class="btn" data-tedit-full aria-expanded="${edit.full}">${edit.full ? "詳細を閉じる" : "詳細を開く"}</button><button class="btn" data-tedit-close>閉じる</button></div>${detail}
  </div>`;
}
