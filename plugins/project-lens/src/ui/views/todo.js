// 「ToDo」画面: 左に今日の ToDo（その下に、Waiting の催促の組）（todayTasks。今日の枠の時刻と札）、右に表示中の週のタスク候補（weekTasks のうち未完了を、今日の優先 rankTasks の順に 1 つの一覧で、理由つき。完了は見出し「完了」の下で末尾）、行の完了の入力欄、右の行の「今日へ」の入力欄。週の見返しは稼働画面（views/workload.js）。操作の結線は app.js（data-td*・data-tf*・data-tp*）。
import { addDays } from "../../core/dates.js";
import { rankTasks } from "../../core/schedule.js";
import { weekTasks, todayTasks, chaseTasks } from "../../core/week.js";
import { futurePlanned, actualSlots } from "../../core/sessions.js";
import { isClosed } from "../../core/schema.js";
import { esc, fmtMD, dateInputHtml } from "../common.js";
import { statusPill, slotHtml } from "./prio.js";
import { urgentForm, urgentDefaultStart } from "./schedule.js";

/** 完了の入力欄で選べる状態（completeTask と同じ。Waiting は選べない） */
const FORM_STATUSES = ["To Do", "In Progress", "Done", "Cancelled"];

/** 「今日へ」の入力欄で選べる長さ（分） */
const PLAN_MINUTES = [15, 30, 45, 60];

/** 「今日へ」の入力欄の初期値: 開始は今を 15 分刻みに切り上げた時刻（urgentDefaultStart の今日の規則）、長さ 60 分 */
export const planDefault = (now) => ({ start: urgentDefaultStart(now.date, now), minutes: 60 });

/** 「今日へ」の入力欄（今日の予定の枠を足す）。値は plan（{ key, start, minutes }） */
function planForm(t, plan) {
  return `<div class="actform tdplan" role="group" aria-label="今日へ入れる">
    <label>開始<input class="in" type="time" step="900" data-tp="start" value="${esc(plan.start)}"></label>
    <label>長さ<select class="in" data-tp="minutes">${PLAN_MINUTES.map((m) => `<option value="${m}"${m === +plan.minutes ? " selected" : ""}>${m} 分</option>`).join("")}</select></label>
    <div style="display:flex;gap:6px;align-items:center"><button class="btn primary" data-tdplansave="${esc(t.id)}">今日に入れる</button><button class="btn" data-tdplancancel>キャンセル</button></div>
  </div>`;
}

/** 催促の「次の回答予定日」で選べる日数 */
const CHASE_DAYS = [1, 2, 3, 5, 7];

/** 催促の入力欄。mode が done なら「催促した」の記録（次の回答予定日までの日数）、edit なら待ち先と回答予定日を直す。値は chase（{ key, mode, days, party, expected }） */
function chaseForm(t, chase) {
  const id = esc(t.id);
  const fields = chase.mode === "done"
    ? `<label>次の回答予定<select class="in" data-ch="days">${CHASE_DAYS.map((n) => `<option value="${n}"${n === +chase.days ? " selected" : ""}>${n} 日後</option>`).join("")}</select></label>`
    : `<label>待ち先<input class="in" data-ch="party" value="${esc(chase.party)}"></label><label>回答予定日${dateInputHtml({ value: chase.expected, attrs: 'data-ch="expected"', label: "回答予定日" })}</label>`;
  return `<div class="actform tdchaseform" role="group" aria-label="${chase.mode === "done" ? "催促の記録" : "待ち先・予定日を直す"}">
    ${fields}
    <div style="display:flex;gap:6px;align-items:center"><button class="btn primary" data-chasesave="${id}">${chase.mode === "done" ? "記録する" : "保存"}</button><button class="btn" data-chasecancel>キャンセル</button></div>
  </div>`;
}

/** 催促の組の 1 行（chaseTasks の 1 件） */
function chaseRow(data, r, chase) {
  const t = r.task, id = esc(t.id);
  const proj = esc(data.projects.find((p) => p.id === t.projectId)?.name ?? "プロジェクトなし");
  const who = r.party.trim() ? `待ち先: ${esc(r.party)}` : "待ち先: 未設定";
  const when = r.lapsedDays != null ? `回答予定 ${fmtMD(r.expected)}（${r.lapsedDays} 日超過）` : `回答待ち ${r.waitedDays} 日`;
  return `<li class="td-row" data-chaserow="${id}">
    <div class="td-main"><span class="pj">${proj}</span><span class="td-title">${esc(t.title)}</span></div>
    <div class="td-meta"><span>${who} ・ ${when}</span></div>
    <div class="td-main"><button class="btn primary" data-chasedone="${id}">催促した</button><button class="btn" data-chaseedit="${id}">待ち先・予定日を直す</button></div>
    ${chase?.key === t.id ? chaseForm(t, chase) : ""}
  </li>`;
}

const progress = (r) => (r.checked ? `${r.checked.done}/${r.checked.total}` : "—");

/**
 * 完了の入力欄。初期値は、日付が day、時刻がその日のそのタスクの、始まった予定の枠（actual なし）の時刻（なければ空）、状態が Done、チェックがタスクの今の状態。
 * 下書き（key が同じ）があれば、その値（下書きに無い項目は、タスクの状態）。各項目の「×」と末尾の追加の欄は、押すとすぐタスクへ保存する（app.js）。Done・Cancelled で解除される未来の予定の枠があれば、その件数を添える
 */
function completeForm(data, t, day, now, draft) {
  const dr = draft?.key === t.id ? draft : null;
  const started = (s) => s.date < now.date || (s.date === now.date && s.start <= now.time); // 始まっていない枠の時刻は、実績に入れられないので初期値にしない
  const plan = (t.sessions ?? []).filter((s) => s.kind === "planned" && s.date === day && !s.actual && started(s)).sort((a, b) => a.start.localeCompare(b.start))[0];
  const time = (k) => `<label>${k === "start" ? "開始" : "終了"}<input class="in" type="time" step="900" data-tf="${k}" value="${esc(dr ? dr[k] : plan?.[k] ?? "")}"></label>`;
  const status = dr?.status ?? "Done";
  const ck = t.checklist ?? [];
  const items = ck.map((c) => `<span class="tf-ckitem"><label class="tf-ck"><input type="checkbox" data-tfck="${esc(c.id)}"${(dr?.checks?.[c.id] ?? c.done) ? " checked" : ""}>${esc(c.text)}</label><button class="gx" data-tdckdel="${esc(t.id)}:${esc(c.id)}" aria-label="${esc(c.text)} を削除">×</button></span>`).join("");
  const add = `<input class="in" data-tdckadd="${esc(t.id)}" placeholder="＋ 項目を追加（Enter）" aria-label="項目を追加">`;
  const n = futurePlanned(data, t.id, now).length;
  return `<div class="actform tdform" role="group" aria-label="完了の入力">
    <span class="note" style="flex-basis:100%;margin:0">実績（省略できます）・状態・チェックリストを、まとめて保存します</span>
    <label>日付${dateInputHtml({ value: dr ? dr.date : day, attrs: 'data-tf="date"', label: "実績の日付" })}</label>
    ${time("start")}${time("end")}
    <label>状態<select class="in" data-tf="status">${FORM_STATUSES.map((s) => `<option value="${s}"${s === status ? " selected" : ""}>${s}</option>`).join("")}</select></label>
    <div class="tf-cks">${items}${ck.length ? `<button class="btn" data-tdckall>残りをすべてチェック</button>` : ""}${add}</div>
    ${n ? `<span class="note" style="flex-basis:100%;margin:0">Done・Cancelled にすると、未来の予定の枠 ${n} 件を解除します</span>` : ""}
    <div style="display:flex;gap:6px;align-items:center"><button class="btn primary" data-tdsave="${esc(t.id)}">保存</button><button class="btn" data-tdcancel>キャンセル</button></div>
  </div>`;
}

/** 一覧の 1 行（左右の列で共通）。r.slots があれば（今日の ToDo）、今日の枠の時刻と札を足す。完了の入力欄は、開いた列（ctx.col）の行にだけ出す。「今日へ」とその入力欄、ドラッグ（data-tdrag）は、右の列（week）の未完了の行にだけ出す */
function row(data, r, ctx, why = []) {
  const t = r.task, id = esc(t.id);
  const proj = esc(data.projects.find((p) => p.id === t.projectId)?.name ?? "プロジェクトなし");
  const done = t.status === "Done";
  const open = ctx.open === t.id && ctx.openCol === ctx.col;
  const canPlan = ctx.col === "week" && !isClosed(t), planOpen = canPlan && ctx.plan?.key === t.id;
  const drag = canPlan && !open && !planOpen ? ` draggable="true" data-tdrag="${id}"` : ""; // 左の列へドラッグして「今日へ」。入力欄を開いた行は、欄の文字を選べるよう動かさない
  return `<li class="td-row${done ? " closed" : ""}"${drag} data-tdrow="${id}">
    <div class="td-main"><span class="pj">${proj}</span><span class="td-title">${esc(t.title)}</span>${statusPill(t)}${r.waiting ? `<span class="pill wait">前のタスク待ち</span>` : ""}${done ? "" : `<button class="btn" data-tdopen="${id}" data-tdcol="${ctx.col}" aria-expanded="${open}">完了</button>`}${canPlan ? `<button class="btn" data-tdplan="${id}" aria-expanded="${planOpen}">今日へ</button>` : ""}</div>
    ${r.slots ? `<div class="td-slots mono">${r.slots.map((s) => slotHtml(s, ctx.now, ctx.actuals)).join("")}</div>` : ""}
    ${why.length ? `<div class="td-why">${why.map(esc).join("・")}</div>` : ""}
    <div class="td-meta">${t.due ? `<span>期限 <b class="mono">${fmtMD(t.due)}</b></span>` : ""}${r.checked ? `<span>チェック <b class="mono">${progress(r)}</b></span>` : ""}<span>予定 <b class="mono">${r.planned}</b> 分</span><span>実績 <b class="mono">${r.actual}</b> 分</span></div>
    ${open ? completeForm(data, t, ctx.day, ctx.now, ctx.draft) : planOpen ? planForm(t, ctx.plan) : ""}
  </li>`;
}

/** 完了の入力欄の下書き → completeTask の入力。開始・終了がどちらも空なら、日付が入っていても実績は送らない（日付は初期値で埋まるため）。片方だけなら送って、completeTask の検査で止める */
export const completeInput = (dr) => ({ actual: dr.start || dr.end ? { date: dr.date, start: dr.start, end: dr.end } : undefined, status: dr.status, checks: dr.checks });

/**
 * @param opts.week  表示中の週の月曜日
 * @param opts.now   {date, time} 未来の予定の枠の判定
 * @param opts.open  完了の入力欄を開いているタスクの ID か null
 * @param opts.col   入力欄を開いた列（"today" か "week"。省略は "week"）。同じタスクが左右にあっても、この列の行にだけ出す
 * @param opts.draft 完了の入力欄の下書き（{ key: タスクの ID, date, start, end, status, checks: { 項目 ID: 済みか } }）か null
 * @param opts.plan  「今日へ」の入力欄（{ key: タスクの ID, start, minutes }）か null。右の列の行にだけ出す
 * @param opts.chase 催促の入力欄（{ key: タスクの ID, mode: "done"|"edit", days, party, expected }）か null。催促の組の行にだけ出す
 */
export function renderTodo(data, today, opts) {
  const { week, now, open = null, col = "week", draft = null, plan = null, chase = null, urgentDraft = null } = opts;
  const weekEnd = addDays(week, 6);
  const base = { open, openCol: col, draft, plan, now, actuals: actualSlots(data) };
  const ctx = { ...base, col: "week", day: today >= week && today <= weekEnd ? today : week };
  const todayCtx = { ...base, col: "today", day: today };
  const rows = weekTasks(data, week, today);
  const ranked = rankTasks(data, today);
  const rank = new Map(ranked.map((k, i) => [k.taskId, i]));
  const todo = rows.filter((r) => r.group !== "done").sort((a, b) => (rank.get(a.task.id) ?? Infinity) - (rank.get(b.task.id) ?? Infinity)); // 順位に無い行は、元の順のまま末尾
  const closed = rows.filter((r) => r.group === "done");
  const whyOf = (r) => [...(r.group === "scheduled" ? ["今週に予定あり"] : []), ...(ranked[rank.get(r.task.id)]?.reasons ?? [])];
  const list = rows.length
    ? (todo.length ? `<ul class="tdlist">${todo.map((r) => row(data, r, ctx, whyOf(r))).join("")}</ul>` : "") + (closed.length ? `<h3>完了</h3><ul class="tdlist">${closed.map((r) => row(data, r, ctx)).join("")}</ul>` : "")
    : `<p class="muted">この週のタスクはありません。</p>`;
  const pt = plan && data.tasks.find((t) => t.id === plan.key);
  const extra = pt && !isClosed(pt) && !rows.some((r) => r.task.id === pt.id) // 「今日の優先」から来たタスクが、この週の候補に無いとき、入力欄の行を候補の先頭に足す
    ? `<h3>今日へ入れるタスク</h3><ul class="tdlist">${row(data, { task: pt, group: null, waiting: (pt.predecessors ?? []).some((id) => { const x = data.tasks.find((k) => k.id === id); return x && !isClosed(x); }), planned: 0, actual: 0, checked: null }, ctx)}</ul>`
    : "";
  const trows = todayTasks(data, today);
  const tlist = trows.length
    ? `<ul class="tdlist">${trows.map((r) => row(data, r, todayCtx)).join("")}</ul>`
    : `<p class="muted">今日の枠のあるタスクはありません。</p>`;
  const crows = chaseTasks(data, today);
  const chasePanel = crows.length
    ? `<section class="panel tdchase" aria-label="催促"><h2>催促（${crows.length} 件）</h2><ul class="tdlist">${crows.map((r) => chaseRow(data, r, chase)).join("")}</ul></section>`
    : "";
  return `<div class="tdpage">
    <div class="tdcols">
      <div class="tdleft">
      <section class="panel tdtoday" data-tddrop aria-label="今日の ToDo"><div style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap"><h2>今日の ToDo（${fmtMD(today)}）</h2><button class="btn" data-urgent-open title="突発タスクの入力欄を開きます">＋ 突発タスク</button></div>${urgentForm(data, urgentDraft)}${tlist}</section>
      ${chasePanel}
      </div>
      <section class="panel tdweek" aria-label="この週のタスク候補"><h2>この週のタスク候補</h2>
        <div class="toolbar"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><button class="btn" data-tdweek="-1" aria-label="前の週">←</button><button class="btn" data-tdweek="1" aria-label="次の週">→</button><button class="btn" data-tdweek-today>今週</button><strong style="margin-left:6px">${fmtMD(week)}〜${fmtMD(weekEnd)} の週</strong></div></div>
        ${extra}${list}</section>
    </div>
  </div>`;
}
