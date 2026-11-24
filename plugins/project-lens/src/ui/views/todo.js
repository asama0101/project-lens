// 「ToDo」画面: 左に表示中の週の ToDo、右に表示中の日の ToDo（2 列）、下に週の見返し。操作の結線は app.js（data-td*）。
import { addDays } from "../../core/dates.js";
import { todoMinutes, weekReview } from "../../core/todos.js";
import { esc, fmtMD, wdJa, dateInputHtml } from "../common.js";
import { actAddSpan } from "./schedule.js";

/** 実績の入力欄。初期値は、その日のその ToDo の予定の枠の時刻、なければ actAddSpan（今日は今から 60 分、ほかの日は 09:00–10:00）。下書き（key が同じ）があれば、その値 */
function actForm(t, day, now, draft) {
  const plan = (t.sessions ?? []).filter((s) => s.kind === "planned" && s.date === day).sort((a, b) => a.start.localeCompare(b.start))[0];
  const [start, end] = plan ? [plan.start, plan.end] : actAddSpan(day, now);
  const dr = draft?.key === t.id ? draft : null;
  const time = (k, v) => `<label>${k === "start" ? "開始" : "終了"}<input class="in" type="time" step="900" data-ta="${k}" value="${esc(dr?.[k] ?? v)}"></label>`;
  return `<div class="actform" role="group" aria-label="実績の入力">
    <span class="note" style="flex-basis:100%;margin:0">「${esc(t.title)}」の実績を入れます</span>
    <label>日付${dateInputHtml({ value: dr?.date || day, attrs: 'data-ta="date"', label: "実績の日付" })}</label>
    ${time("start", start)}${time("end", end)}
    <div style="display:flex;gap:6px;align-items:center"><button class="btn" data-tdactsave="${esc(t.id)}">実績を保存</button><button class="btn" data-tdactcancel>キャンセル</button></div>
  </div>`;
}

/** ToDo の 1 行。range は分数を数える範囲（左は週、右は日） */
function row(data, t, ctx, range) {
  const id = esc(t.id), title = esc(t.title), ck = t.checklist ?? [];
  const { planned, actual } = todoMinutes(data, t.id, range);
  const items = ck.map((c) => `<div class="ck-row"><input type="checkbox" data-tdcktoggle="${id}:${esc(c.id)}"${c.done ? " checked" : ""} aria-label="${esc(c.text)} を済みにする"><span class="td-cktext${c.done ? " done" : ""}">${esc(c.text)}</span><button class="btn" data-tdckdel="${id}:${esc(c.id)}" aria-label="${esc(c.text)} を削除">×</button></div>`).join("");
  return `<li class="td-row${t.doneAt ? " closed" : ""}" data-todo="${id}">
    <div class="td-main"><input type="checkbox" data-tdone="${id}"${t.doneAt ? " checked" : ""} aria-label="「${title}」を完了にする"><input class="in td-title" data-tdtitle="${id}" value="${title}" aria-label="件名"></div>
    <div class="td-meta">${ck.length ? `<span class="mono">${ck.filter((c) => c.done).length}/${ck.length}</span>` : ""}<span>予定 <b class="mono">${planned}</b> 分</span><span>実績 <b class="mono">${actual}</b> 分</span>${t.carried ? `<span class="pill wait">${t.carried} 回回しています</span>` : ""}</div>
    <div class="td-ops">${t.scope === "week" ? `<button class="btn" data-tdassign="${id}">${ctx.dayIsToday ? "今日へ" : "この日へ"}</button>` : ""}${t.doneAt ? "" : `<button class="btn" data-tdcarry="${id}">${t.scope === "week" ? "来週へ回す" : "明日へ回す"}</button>`}<button class="btn" data-tdact="${id}">実績を入れる</button><button class="btn danger" data-tddel="${id}">削除</button></div>
    <div class="td-ck">${items}<input class="in" data-tdck="${id}" placeholder="＋ 項目を追加（Enter）" aria-label="「${title}」のチェックリストに項目を追加"></div>
    ${ctx.actFor === t.id ? actForm(t, ctx.day, ctx.now, ctx.draft) : ""}
  </li>`;
}

/** 完了していないものを先に、完了したものを末尾に（それぞれ元の並びのまま） */
const openFirst = (list) => [...list.filter((t) => !t.doneAt), ...list.filter((t) => t.doneAt)];

/**
 * @param opts.week   表示中の週の月曜日
 * @param opts.day    右の列の日
 * @param opts.now    {date, time} 実績の入力欄の時刻の初期値
 * @param opts.actFor 実績の入力欄を開いている ToDo の id か null
 * @param opts.draft  実績の入力欄の下書き（{ key: ToDo の id, date, start, end }）か null
 */
export function renderTodo(data, today, opts) {
  const { week, day, now, actFor = null, draft = null } = opts;
  const todos = data.todos ?? [];
  const weekEnd = addDays(week, 6);
  const ctx = { day, now, actFor, draft, dayIsToday: day === today };
  const list = (items, range) => `<ul class="tdlist">${openFirst(items).map((t) => row(data, t, ctx, range)).join("")}</ul>`;
  const weekItems = todos.filter((t) => t.scope === "week" && t.date === week);
  const dayItems = todos.filter((t) => t.scope === "day" && t.date === day);
  const rv = weekReview(data, week);
  const rows = rv.rows.map((r) => `<tr${r.todo.carried ? ' class="hot"' : ""}><td>${esc(r.todo.title)} <span class="note">${r.todo.scope === "week" ? "週" : `${fmtMD(r.todo.date)}(${wdJa(r.todo.date)})`}</span></td><td class="num mono">${r.checked ? `${r.checked.done}/${r.checked.total}` : "—"}</td><td class="num mono">${r.planned} 分</td><td class="num mono">${r.actual} 分</td><td class="num mono">${r.todo.carried} 回</td></tr>`).join("");
  return `<div class="tdpage">
    <div class="toolbar"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><button class="btn" data-tdweek="-1" aria-label="前の週">←</button><button class="btn" data-tdweek="1" aria-label="次の週">→</button><button class="btn" data-tdweek-today>今週</button><strong style="margin-left:6px">${fmtMD(week)}〜${fmtMD(weekEnd)} の週</strong></div></div>
    <div class="tdcols">
      <section class="panel tdcol" data-tdcol="week" aria-label="この週の ToDo"><h2>この週の ToDo</h2>${list(weekItems, { start: week, end: weekEnd })}<input class="in" data-tdnew="week" placeholder="＋ 週の ToDo を追加（件名を入れて Enter）" aria-label="週の ToDo を追加"></section>
      <section class="panel tdcol" data-tdcol="day" aria-label="${fmtMD(day)} の ToDo"><div class="td-dayhead"><h2>${fmtMD(day)}(${wdJa(day)}) の ToDo</h2><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn" data-tdday="-1">‹ 前の日</button><button class="btn" data-tdday="1">次の日 ›</button><button class="btn" data-tdday-today>今日</button></div></div>${list(dayItems, { start: day, end: day })}<input class="in" data-tdnew="day" placeholder="＋ 日の ToDo を追加（件名を入れて Enter）" aria-label="日の ToDo を追加"></section>
    </div>
    <section class="tdreview panel" aria-label="週の見返し"><h2>週の見返し（${fmtMD(week)}〜${fmtMD(weekEnd)}）</h2>
      <p class="td-sum"><b>完了 ${rv.done} / ${rv.total} 件</b>　予定 ${rv.planned} 分に対して実績 ${rv.actual} 分</p>
      <div class="tscroll"><table class="tbl"><thead><tr><th>ToDo</th><th class="num">進捗</th><th class="num">予定</th><th class="num">実績</th><th class="num">回した回数</th></tr></thead><tbody>${rows}</tbody></table></div>
      <label class="td-note">気づき<textarea class="in" rows="3" data-tdnote="${esc(week)}">${esc(rv.note)}</textarea></label>
    </section>
  </div>`;
}
