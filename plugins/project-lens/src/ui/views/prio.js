// 「今日のタスク」「この週のタスク候補」パネル（プロジェクト画面・スケジュール画面で共通。右の列に並ぶ）
import { rankTasks } from "../../core/schedule.js";
import { weekTasks, mondayOf } from "../../core/week.js";
import { lateInfo } from "../../core/metrics.js";
import { taskActual, sessionKind, actualSlots } from "../../core/sessions.js";
import { isClosed, isImportantMark } from "../../core/schema.js";
import { esc, checkMeterHtml, fmtMD } from "../common.js";

const PILL = { "To Do": "off", "In Progress": "ok", Waiting: "wait", Done: "done", Cancelled: "off" };
const IMP_BADGE = `<span class="impbadge">重要</span>`;
export const statusPill = (t) => `<span class="pill ${PILL[t.status] ?? "off"}">${esc(t.status)}</span>`;

/** 遅れの札（件名の横・下に置く）。期限超過・回答予定日の超過。色だけでなく文字と日数でも伝える。遅れが無ければ空文字 */
export const lateBadgesHtml = (info) =>
  (info.lapsed ? `<span class="latebadge">回答予定を ${info.lapsed} 日超過</span>` : "") + (info.overdue ? `<span class="latebadge">期限超過 ${info.overdue}日</span>` : "");

/** 期限の表示。期限を過ぎていれば、赤の太字で日数を添える（`<b>` の中身は呼び出し側の日付） */
export const dueLateHtml = (dueText, info) => (info.overdue ? `<span class="duelate">期限 <b class="mono">${dueText}</b>（${info.overdue} 日超過）</span>` : `<span>期限 <b class="mono">${dueText}</b></span>`);

/** 理由の文章から、札にした理由（期限超過・回答予定日の超過）を除く */
export const restReasons = (reasons) => reasons.filter((x) => !x.startsWith("期限超過 ") && !x.startsWith("回答予定日を過ぎています"));

/** 枠の種類の札（カレンダーの凡例と同じ色の class。文字でも出す） */
const KIND_TAG = { planned: ["plan", "予定"], actual: ["act", "実績"], unconfirmed: ["unconf", "未確認"] };

/** 今日のタスクの枠の時間（ToDo 画面の今日の ToDo も使う）。前に予定・実績・未確認の札を付ける（actuals は全タスクの実績の区間。過ぎた予定に重なる実績があれば、未確認にしない）。実績（actual）を持つ予定の枠は、実績の時刻に、予定の時刻を小さく添える（実績が枠と別の日なら、実績の日付も出す） */
export function slotHtml(s, now, actuals) {
  if (s.actual) return `<span class="ts"><span class="ktag act">実績</span>${esc(`${s.actual.date && s.actual.date !== s.date ? `${fmtMD(s.actual.date)} ` : ""}${s.actual.start}–${s.actual.end}`)}<small class="muted">${esc(`予定 ${s.start}–${s.end}`)}</small></span>`;
  const [cls, label] = KIND_TAG[sessionKind(s, now, actuals)];
  return `<span class="ts"><span class="ktag ${cls}">${label}</span>${esc(`${s.start}–${s.end}`)}</span>`;
}

/** Done・Cancelled にする前の確認（今日のタスクの行・リストの確認の行・ガントの編集の窓とスケジュールの編集欄の状態の欄が使う）。
 *  stage が "check" なら、未完了のチェック項目の警告（残りをすべてチェックして Done／やめる。不要な項目は削除してから Done にする）。
 *  それ以外（"future"、または stage なし）は、未来の予定の枠を解除する確認 */
export function doneAskHtml(pd) {
  const id = esc(pd.id);
  if (pd.stage === "check") {
    return `<div class="ask warn-ck" role="alert" style="max-width:none"><b>チェックリストに、未完了の項目が ${pd.open.length} 件あります。</b><ul>${pd.open.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><div class="muted">不要な項目は、削除してから ${esc(pd.status)} にできます。</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"><button class="btn" data-ckall="${id}">残りをすべてチェックして ${esc(pd.status)} にする</button><button class="btn" data-doneno>やめる</button></div></div>`;
  }
  return `<div class="ask" style="max-width:none">このタスクの未来の予定の枠 ${pd.n} 件を解除して ${esc(pd.status)} にします。<div style="display:flex;gap:6px;margin-top:4px"><button class="btn danger" data-doneok="${id}">解除して ${esc(pd.status)} にする</button><button class="btn" data-doneno>やめる</button></div></div>`;
}

/** 今日の日付に作業枠（予定・実績・未確認）があるタスクを [{ t, slots }] で返す。未完了を最初の枠の開始順に、Done・Cancelled を末尾に */
function todayList(data, today) {
  const rows = data.tasks
    .map((t) => ({ t, slots: (t.sessions ?? []).filter((s) => s.date === today).sort((a, b) => a.start.localeCompare(b.start)) }))
    .filter((r) => r.slots.length);
  return rows.sort((a, b) => isClosed(a.t) - isClosed(b.t) || a.slots[0].start.localeCompare(b.slots[0].start));
}

export const todayTaskIds = (data, today) => todayList(data, today).map((r) => r.t.id);

/** 今日のタスク。今日に枠が無ければ空文字
 *  @param opts.pendingDone  未来の予定の枠を解除する確認待ち { id, status, n }（その行に確認を出す）
 *  @param opts.sched        true なら、終わっていないタスクの行をカレンダーへドラッグできる（同じタスクをもう 1 つ置く）
 *  @param opts.now          {date, time} 現在時刻（過ぎた予定を未確認にする。省略は today の 00:00） */
export function renderTodayTasks(data, today, opts = {}) {
  const rows = todayList(data, today);
  const now = opts.now ?? { date: today, time: "00:00" };
  if (!rows.length) return "";
  const actuals = actualSlots(data);
  const items = rows.map(({ t, slots }) => {
    const proj = esc(data.projects.find((p) => p.id === t.projectId)?.name ?? (t.projectId == null ? "プロジェクトなし" : ""));
    const times = slots.map((s) => slotHtml(s, now, actuals)).join("");
    const ask = opts.pendingDone?.id === t.id ? doneAskHtml(opts.pendingDone) : "";
    const drag = opts.sched && !isClosed(t) ? ` draggable="true" data-dragtask="${esc(t.id)}"` : "";
    const late = lateInfo(t, today), isLate = late.overdue || late.lapsed;
    return `<li data-today="${esc(t.id)}"${isClosed(t) ? ' class="closed"' : isLate ? ' class="late"' : ""}${drag}><span class="pj">${proj}</span><span class="t">${esc(t.title)} ${statusPill(t)}${isImportantMark(t) ? IMP_BADGE : ""}${lateBadgesHtml(late)}</span><span class="why mono tss">${times}</span>${isClosed(t) ? "" : checkMeterHtml(t, { remain: true })}${ask}</li>`;
  }).join("");
  return `<section class="panel todaytasks" aria-labelledby="h-td"><h2 id="h-td">今日のタスク</h2><ul class="rank tl">${items}</ul></section>`;
}

/**
 * 今週（today のある週）のタスク候補のうち未完了（weekTasks の完了の組を除く）を、優先順位（rankTasks の点数の順）に並べる。
 * 今日のタスクに入っているタスクは出さない（順位の計算は変えず、表示で除く）
 * @param opts.sched   true ならスケジュール画面用（ドラッグ可。「今日へ」は出さない）
 */
export function renderPrio(data, today, opts = {}) {
  const { sched = false } = opts;
  const inToday = new Set(todayTaskIds(data, today));
  const cand = new Set(weekTasks(data, mondayOf(today), today).filter((r) => r.group !== "done").map((r) => r.task.id));
  const shown = rankTasks(data, today).filter((r) => cand.has(r.taskId) && !inToday.has(r.taskId));
  const items = shown.map((r, i) => {
    const t = data.tasks.find((x) => x.id === r.taskId);
    const a = taskActual(data, t.id);
    const pill = a.count ? ` <span class="pill ok">${a.count}回・実績 ${a.hours.toFixed(1)}h</span>` : "";
    const proj = esc(data.projects.find((p) => p.id === t.projectId)?.name ?? (t.projectId == null ? "プロジェクトなし" : ""));
    const drag = sched ? ` draggable="true" data-dragtask="${esc(t.id)}"` : "";
    const late = lateInfo(t, today);
    return `<li${drag}${late.overdue || late.lapsed ? ' class="late"' : ""}><span class="n">${i + 1}</span><span class="pj">${proj}</span><span class="t">${r.action === "chase" ? `<span class="act">${r.reasons.some((x) => x.includes("催促")) ? "催促" : "確認"}</span>` : ""}${esc(t.title)} ${statusPill(t)}${pill}${lateBadgesHtml(late)}</span>${checkMeterHtml(t, { remain: true })}<span class="why">${isImportantMark(t) ? IMP_BADGE : ""}${esc(restReasons(r.reasons).filter((x) => x !== "重要").join("。"))}${late.overdue ? `<br>${dueLateHtml(fmtMD(t.due), late)}` : ""}</span></li>`;
  }).join("");
  const note = sched
    ? "タスクをカレンダーへドラッグして配置します(15分刻み・長さ1時間)。今日のタスクの行からも、同じタスクをもう 1 つ置けます。配置済みの枠もドラッグで移動できます。"
    : "スケジュール画面で、時間枠に配置できます。";
  return `<section class="panel prio" aria-labelledby="h-rk"><h2 id="h-rk">この週のタスク候補</h2>${shown.length ? `<ol class="rank">${items}</ol>` : `<p class="muted">この週のタスクはありません。</p>`}<p class="note" style="margin:10px 0 0">${note}</p></section>`;
}

/** 右の列: 今日のタスク（あれば）＋この週のタスク候補。列の直下の要素として固定表示（sticky）にするため、1 つの箱にまとめる */
export function renderSide(data, today, opts = {}) {
  return `<div class="side">${renderTodayTasks(data, today, opts)}${renderPrio(data, today, opts)}</div>`;
}

/** 本体と右の列の境界線の取っ手。押すと右の列（今日のタスク・この週のタスク候補）を開け閉めする。閉じても、この取っ手は残る */
export const renderSideToggle = (open) =>
  `<button class="side-toggle" data-pref="prio" aria-expanded="${open}" aria-label="${open ? "この週のタスク候補を閉じる" : "この週のタスク候補を開く"}" title="${open ? "右の「今日のタスク」「この週のタスク候補」を閉じます" : "右の「今日のタスク」「この週のタスク候補」を開きます"}">${open ? "›" : "‹"}</button>`;
