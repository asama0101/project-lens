// 「ToDo」画面: 左に今日の ToDo（todayTasks。今日の枠の時刻と札）、右に表示中の週のタスク候補（weekTasks。組ごと）、行の完了の入力欄、週の見返し（weekSummary）。操作の結線は app.js（data-td*・data-tf*）。
import { addDays } from "../../core/dates.js";
import { weekTasks, weekSummary, todayTasks } from "../../core/week.js";
import { futurePlanned, actualSlots } from "../../core/sessions.js";
import { esc, fmtMD, dateInputHtml } from "../common.js";
import { statusPill, slotHtml } from "./prio.js";

const GROUP_JA = { overdue: "期限超過", scheduled: "今週に予定あり", due: "今週の期限", done: "完了" };
/** 完了の入力欄で選べる状態（completeTask と同じ。Waiting は選べない） */
const FORM_STATUSES = ["To Do", "In Progress", "Done", "Cancelled"];

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

/** 一覧の 1 行（左右の列で共通）。r.slots があれば（今日の ToDo）、今日の枠の時刻と札を足す。入力欄は、開いた列（ctx.col）の行にだけ出す */
function row(data, r, ctx) {
  const t = r.task, id = esc(t.id);
  const proj = esc(data.projects.find((p) => p.id === t.projectId)?.name ?? "プロジェクトなし");
  const done = t.status === "Done";
  const open = ctx.open === t.id && ctx.openCol === ctx.col;
  return `<li class="td-row${done ? " closed" : ""}" data-tdrow="${id}">
    <div class="td-main"><span class="pj">${proj}</span><span class="td-title">${esc(t.title)}</span>${statusPill(t)}${r.waiting ? `<span class="pill wait">前のタスク待ち</span>` : ""}${done ? "" : `<button class="btn" data-tdopen="${id}" data-tdcol="${ctx.col}" aria-expanded="${open}">完了</button>`}</div>
    ${r.slots ? `<div class="td-slots mono">${r.slots.map((s) => slotHtml(s, ctx.now, ctx.actuals)).join("")}</div>` : ""}
    <div class="td-meta">${t.due ? `<span>期限 <b class="mono">${fmtMD(t.due)}</b></span>` : ""}${r.checked ? `<span>チェック <b class="mono">${progress(r)}</b></span>` : ""}<span>予定 <b class="mono">${r.planned}</b> 分</span><span>実績 <b class="mono">${r.actual}</b> 分</span></div>
    ${open ? completeForm(data, t, ctx.day, ctx.now, ctx.draft) : ""}
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
 */
export function renderTodo(data, today, opts) {
  const { week, now, open = null, col = "week", draft = null } = opts;
  const weekEnd = addDays(week, 6);
  const base = { open, openCol: col, draft, now, actuals: actualSlots(data) };
  const ctx = { ...base, col: "week", day: today >= week && today <= weekEnd ? today : week };
  const todayCtx = { ...base, col: "today", day: today };
  const rows = weekTasks(data, week, today);
  const groups = Object.keys(GROUP_JA).map((g) => [g, rows.filter((r) => r.group === g)]).filter(([, rs]) => rs.length);
  const list = groups.length
    ? groups.map(([g, rs]) => `<h3>${GROUP_JA[g]}</h3><ul class="tdlist">${rs.map((r) => row(data, r, ctx)).join("")}</ul>`).join("")
    : `<p class="muted">この週のタスクはありません。</p>`;
  const trows = todayTasks(data, today);
  const tlist = trows.length
    ? `<ul class="tdlist">${trows.map((r) => row(data, r, todayCtx)).join("")}</ul>`
    : `<p class="muted">今日の枠のあるタスクはありません。</p>`;
  const rv = weekSummary(data, week, today);
  const trs = rv.rows.map((r) => `<tr><td>${esc(r.task.title)}</td><td class="num mono">${progress(r)}</td><td class="num mono">${r.planned} 分</td><td class="num mono">${r.actual} 分</td></tr>`).join("");
  return `<div class="tdpage">
    <div class="tdcols">
      <section class="panel tdtoday" aria-label="今日の ToDo"><h2>今日の ToDo（${fmtMD(today)}）</h2>${tlist}</section>
      <section class="panel tdweek" aria-label="この週のタスク候補"><h2>この週のタスク候補</h2>
        <div class="toolbar"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><button class="btn" data-tdweek="-1" aria-label="前の週">←</button><button class="btn" data-tdweek="1" aria-label="次の週">→</button><button class="btn" data-tdweek-today>今週</button><strong style="margin-left:6px">${fmtMD(week)}〜${fmtMD(weekEnd)} の週</strong></div></div>
        ${list}</section>
    </div>
    <section class="tdreview panel" aria-label="週の見返し"><h2>週の見返し（${fmtMD(week)}〜${fmtMD(weekEnd)}）</h2>
      <p class="td-sum"><b>完了 ${rv.done} / ${rv.total} 件</b>　予定 ${rv.planned} 分に対して実績 ${rv.actual} 分</p>
      <div class="tscroll"><table class="tbl"><thead><tr><th>タスク</th><th class="num">進捗</th><th class="num">予定</th><th class="num">実績</th></tr></thead><tbody>${trs}</tbody></table></div>
      <label class="td-note">気づき<textarea class="in" rows="3" data-tdnote="${esc(week)}">${esc(rv.note)}</textarea></label>
    </section>
  </div>`;
}
